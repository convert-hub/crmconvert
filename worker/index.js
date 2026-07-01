// CRM Worker - Node.js Docker service
// Consumes jobs from Postgres queue with retry and idempotency
// Run via: docker-compose up worker

const { createClient } = require('@supabase/supabase-js');
const { executeAutomations } = require('./automation-handler');
const { normalizeBrazilPhone, upsertContactByPhone } = require('./lib/phone');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL = process.env.POLL_INTERVAL || 2000;
const MIN_INBOUND_FOR_QUALIFICATION = 5;
const AI_REPLY_DEBOUNCE_SECONDS = 8;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Job handlers registry
const handlers = {
  async process_form_webhook(payload) {
    return processLeadIntake({
      tenant_id: payload.tenant_id,
      event_id: payload.event_id,
      source_default: 'form_webhook',
      raw: payload.data || {},
    });
  },

  async process_meta_lead(payload) {
    return processLeadIntake({
      tenant_id: payload.tenant_id,
      event_id: payload.event_id,
      source_default: 'facebook_lead_ads',
      raw: payload.data || {},
    });
  },


  async process_uazapi_message(payload) {
    const { tenant_id, conversation_id, contact_id, message_text, message_id, already_saved, data } = payload;

    // If the webhook already saved the message (new flow), only handle AI auto-reply
    if (already_saved) {
      console.log(`[Worker] Message already saved by webhook, checking AI auto-reply for conv=${conversation_id} msg=${message_id || 'unknown'}`);
      
      if (!conversation_id || !contact_id) {
        return { skipped: true, reason: 'missing conversation_id or contact_id' };
      }

      // Get conversation and contact
      const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversation_id).single();
      const { data: contact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();

      if (!conv || !contact) {
        return { skipped: true, reason: 'conversation or contact not found' };
      }

      // 0. RESOLVE EFFECTIVE TEXT: use exact message_id if available
      let effectiveText = message_text || '';
      let targetMsg = null;

      if (message_id) {
        // Load exact message by ID
        const { data: msg } = await supabase.from('messages')
          .select('id, media_type, media_url, content, provider_metadata')
          .eq('id', message_id)
          .single();
        targetMsg = msg;
      } else if (!effectiveText && !data?.fromMe) {
        // Fallback: find last inbound message
        const { data: msg } = await supabase.from('messages')
          .select('id, media_type, media_url, content, provider_metadata')
          .eq('conversation_id', conversation_id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        targetMsg = msg;
      }

      // Check idempotency: if this audio was already processed, skip
      if (targetMsg?.provider_metadata?.audio_reply_sent) {
        console.log(`[Worker] Message ${targetMsg.id} already processed (audio_reply_sent=true), skipping`);
        return { conversation_id, contact_id, ai_processed: false, reason: 'already_processed' };
      }

      // Transcribe audio if needed
      const isAudio = targetMsg?.media_type && targetMsg.media_type.toLowerCase().includes('audio');
      if (!effectiveText && targetMsg && isAudio) {
        // Check if transcription already exists
        if (targetMsg.provider_metadata?.audio_transcription) {
          effectiveText = targetMsg.provider_metadata.audio_transcription;
          console.log('[Worker] Using existing transcription:', effectiveText.substring(0, 80));
        } else {
          console.log(`[Worker] Transcribing audio message ${targetMsg.id}...`);
          const transcription = await transcribeAudio(tenant_id, targetMsg.media_url, targetMsg.id);
          if (transcription) {
            effectiveText = transcription;
            console.log('[Worker] Audio transcribed successfully:', transcription.substring(0, 80));
          } else {
            // Increment retry counter and self-retry if under limit
            const currentMeta = targetMsg.provider_metadata || {};
            const retryCount = (currentMeta.audio_transcription_retries || 0) + 1;
            await supabase.from('messages').update({
              provider_metadata: { ...currentMeta, audio_transcription_retries: retryCount },
            }).eq('id', targetMsg.id);

            if (retryCount < 3) {
              console.log(`[Worker] Audio transcription failed for ${targetMsg.id}, retry ${retryCount}/3, re-enqueuing with delay`);
              await supabase.rpc('enqueue_job', {
                _type: 'process_uazapi_message',
                _payload: JSON.stringify({
                  tenant_id, conversation_id, contact_id,
                  message_text: '',
                  message_id: targetMsg.id,
                  already_saved: true,
                }),
                _tenant_id: tenant_id,
                _idempotency_key: `uazapi-audio-selfretry-${targetMsg.id}-r${retryCount}`,
              });
              return { conversation_id, contact_id, ai_processed: false, reason: 'audio_transcription_retry_enqueued' };
            } else {
              console.log(`[Worker] Audio transcription failed after ${retryCount} retries for ${targetMsg.id}, giving up`);
              return { conversation_id, contact_id, ai_processed: false, reason: 'audio_transcription_failed_final' };
            }
          }
        }
      }

      // 1. FIRST: Check keyword and activate AI if needed (using effectiveText so audio can trigger keywords)
      if (effectiveText && !data?.fromMe) {
        try {
          await checkKeywordAndActivateAi(tenant_id, contact_id, conversation_id, effectiveText);
        } catch (err) {
          console.error('[Worker] Keyword/AI activation error:', err.message);
        }
      }

      // 2. SECOND: Re-fetch fresh conversation and contact from DB
      const { data: freshConv } = await supabase.from('conversations').select('*').eq('id', conversation_id).single();
      const { data: freshContact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();

      // 3. THIRD: Auto-reply only if AI activated AND no human agent assigned (DEBOUNCED)
      if (freshConv && !freshConv.assigned_to && freshConv.metadata?.ai_activated === true) {
        try {
          // For audio: mark BEFORE enqueuing to guarantee atomicity via optimistic lock
          if (targetMsg && isAudio && message_id) {
            const currentMeta = targetMsg.provider_metadata || {};
            const { data: updated, error: updateErr } = await supabase.from('messages').update({
              provider_metadata: { ...currentMeta, audio_reply_sent: true, audio_reply_sent_at: new Date().toISOString() },
            }).eq('id', message_id)
              .is('provider_metadata->audio_reply_sent', null)
              .select('id');

            if (updateErr || !updated || updated.length === 0) {
              console.log(`[Worker] Message ${message_id} already marked as processed, skipping AI reply`);
              return { conversation_id, contact_id, ai_processed: false, reason: 'already_marked' };
            }
          }

          // Record last inbound timestamp (merge metadata)
          const nowIso = new Date().toISOString();
          await supabase.from('conversations').update({
            metadata: { ...(freshConv.metadata || {}), last_inbound_at: nowIso },
          }).eq('id', freshConv.id);

          // Enqueue debounced job (idempotency by 8s window bucket)
          const windowBucket = Math.floor(Date.now() / (AI_REPLY_DEBOUNCE_SECONDS * 1000));
          await supabase.rpc('enqueue_job', {
            _type: 'debounced_ai_reply',
            _payload: JSON.stringify({ tenant_id, conversation_id: freshConv.id, contact_id: (freshContact || contact).id }),
            _tenant_id: tenant_id,
            _run_after: new Date(Date.now() + AI_REPLY_DEBOUNCE_SECONDS * 1000).toISOString(),
            _idempotency_key: `debounced-ai-reply-${freshConv.id}-${windowBucket}`,
          });
        } catch (err) {
          console.error('[Worker] AI auto-reply enqueue error:', err.message);
        }
      }

      // Trigger active chatbot flows with trigger_type='message_received' (using effectiveText)
      if (effectiveText && !data?.fromMe) {
        try {
          await triggerMessageReceivedFlows(tenant_id, contact_id, conversation_id, effectiveText);
        } catch (err) {
          console.error('[Worker] Flow trigger error:', err.message);
        }
      }

      return { conversation_id, contact_id, ai_processed: true };
    }

    // Legacy flow: webhook didn't save the message, process from raw data
    const msg = data || {};
    
    // UAZAPI v2 flat format
    const chatid = msg.chatid || msg.key?.remoteJid || '';
    const isGroup = chatid.endsWith('@g.us') || msg.isGroup === true;
    if (isGroup) return { skipped: true, reason: 'group message' };

    const fromMe = msg.fromMe === true || msg.key?.fromMe === true;
    const text = msg.text || msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content?.text || '';
    const senderName = msg.senderName || msg.pushName || msg.notifyName || '';
    const messageId = msg.messageid || msg.id || msg.key?.id || '';
    const sender = msg.sender || msg.chatid || msg.key?.remoteJid || '';
    
    // Extract media info from UAZAPI payload
    const mediaType = msg.mediaType || msg.type || msg.message_type || '';
    const mediaUrl = msg.mediaUrl || msg.media?.url || msg.content?.url || '';

    const phone = normalizePhone(sender.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, ''));

    if (!phone || (!text && !mediaUrl)) {
      return { skipped: true, reason: 'no phone or content' };
    }

    // Find or create contact
    let contact = await findContact(tenant_id, phone, null);
    if (!contact) {
      const name = senderName || phone;
      const ins = await supabase.from('contacts').insert({
        tenant_id, name, phone, source: 'whatsapp', status: 'lead',
      }).select().single();
      if (ins.error && ins.error.code === '23505') {
        const { data: race } = await supabase.from('contacts').select('*')
          .eq('tenant_id', tenant_id).eq('phone', phone).single();
        contact = race;
      } else {
        contact = ins.data;
      }
    }

    // Find or create conversation
    let conversation;
    const { data: existingConv } = await supabase.from('conversations')
      .select('*').eq('tenant_id', tenant_id).eq('contact_id', contact.id)
      .eq('channel', 'whatsapp').in('status', ['open', 'waiting_customer', 'waiting_agent']).limit(1);

    if (existingConv && existingConv.length > 0) {
      conversation = existingConv[0];
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        tenant_id, contact_id: contact.id, channel: 'whatsapp', status: 'open',
        provider_chat_id: chatid,
      }).select().single();
      conversation = newConv;
    }

    // Save message (include media info if present)
    const msgInsert = {
      tenant_id, conversation_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      content: text || null, provider_message_id: messageId,
      provider_metadata: msg,
    };
    if (mediaType) msgInsert.media_type = mediaType;
    if (mediaUrl) msgInsert.media_url = mediaUrl;
    const { data: savedMsg } = await supabase.from('messages').insert(msgInsert).select('id').single();

    // Update conversation timestamps
    const updates = { last_message_at: new Date().toISOString() };
    if (!fromMe) {
      updates.last_customer_message_at = new Date().toISOString();
      updates.unread_count = (conversation.unread_count || 0) + 1;
      updates.status = 'waiting_agent';
    } else {
      updates.last_agent_message_at = new Date().toISOString();
    }
    await supabase.from('conversations').update(updates).eq('id', conversation.id);

    // 0. RESOLVE EFFECTIVE TEXT for legacy path
    let effectiveText = text || '';
    if (!fromMe && !text && mediaType && mediaType.toLowerCase().includes('audio') && mediaUrl && savedMsg?.id) {
      const transcription = await transcribeAudio(tenant_id, mediaUrl, savedMsg.id);
      if (transcription) {
        effectiveText = transcription;
        console.log('[Worker] Legacy: audio transcribed:', transcription.substring(0, 80));
      }
    }

    // 1. FIRST: Check keyword and activate AI if needed (using effectiveText)
    if (!fromMe && effectiveText) {
      try {
        await checkKeywordAndActivateAi(tenant_id, contact.id, conversation.id, effectiveText);
      } catch (err) {
        console.error('[Worker] Keyword/AI activation error:', err.message);
      }
    }

    // 2. SECOND: Re-fetch fresh conversation and contact from DB
    const { data: freshConv2 } = await supabase.from('conversations').select('*').eq('id', conversation.id).single();
    const { data: freshContact2 } = await supabase.from('contacts').select('*').eq('id', contact.id).single();
    if (freshConv2) conversation = freshConv2;
    if (freshContact2) contact = freshContact2;

    // 3. THIRD: Auto-reply only if AI activated AND no human agent assigned (DEBOUNCED)
    if (!fromMe && effectiveText && !conversation.assigned_to && conversation.metadata?.ai_activated === true) {
      try {
        // Record last inbound timestamp (merge metadata)
        const nowIso = new Date().toISOString();
        await supabase.from('conversations').update({
          metadata: { ...(conversation.metadata || {}), last_inbound_at: nowIso },
        }).eq('id', conversation.id);

        // Enqueue debounced job (idempotency by 8s window bucket)
        const windowBucket = Math.floor(Date.now() / (AI_REPLY_DEBOUNCE_SECONDS * 1000));
        await supabase.rpc('enqueue_job', {
          _type: 'debounced_ai_reply',
          _payload: JSON.stringify({ tenant_id, conversation_id: conversation.id, contact_id: contact.id }),
          _tenant_id: tenant_id,
          _run_after: new Date(Date.now() + AI_REPLY_DEBOUNCE_SECONDS * 1000).toISOString(),
          _idempotency_key: `debounced-ai-reply-${conversation.id}-${windowBucket}`,
        });
      } catch (err) {
        console.error('[Worker] AI auto-reply enqueue error:', err.message);
      }
    }

    // Trigger chatbot flows for inbound messages (using effectiveText)
    if (!fromMe && effectiveText) {
      try {
        await triggerMessageReceivedFlows(tenant_id, contact.id, conversation.id, effectiveText);
      } catch (err) {
        console.error('[Worker] Flow trigger error:', err.message);
      }
    }

    return { contact_id: contact.id, conversation_id: conversation.id };
  },

  async send_whatsapp(payload) {
    const { tenant_id, phone, message, conversation_id, whatsapp_instance_id } = payload;

    // Resolve instance: prefer explicit, fallback to conversation's instance, fallback to active uazapi
    let instance = null;
    if (whatsapp_instance_id) {
      const { data } = await supabase.from('whatsapp_instances')
        .select('*').eq('id', whatsapp_instance_id).maybeSingle();
      instance = data;
    }
    if (!instance && conversation_id) {
      const { data: conv } = await supabase.from('conversations')
        .select('whatsapp_instance_id').eq('id', conversation_id).maybeSingle();
      if (conv?.whatsapp_instance_id) {
        const { data } = await supabase.from('whatsapp_instances')
          .select('*').eq('id', conv.whatsapp_instance_id).maybeSingle();
        instance = data;
      }
    }
    if (!instance) {
      const { data } = await supabase.from('whatsapp_instances')
        .select('*').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).maybeSingle();
      instance = data;
    }

    if (!instance) {
      throw new Error('No active WhatsApp instance for tenant');
    }

    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (!cleanPhone) {
      throw new Error('No phone number provided');
    }

    // Meta Cloud → use wa-meta-send edge function
    if (instance.provider === 'meta_cloud') {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'send',
          type: 'text',
          text: message,
          phone: cleanPhone,
          conversation_id: conversation_id || null,
          whatsapp_instance_id: instance.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(`Meta send failed: ${data?.error || response.status}`);
      }
      return data;
    }

    // UAZAPI (default)
    const instToken = instance.api_token_encrypted || '';
    const response = await fetch(`${instance.api_url}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instToken,
      },
      body: JSON.stringify({
        number: cleanPhone,
        text: message,
        delay: 0,
        readchat: true,
        readmessages: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`UAZAPI send failed: ${response.status} ${errText}`);
    }

    return await response.json();
  },

  async send_whatsapp_media(payload) {
    const { tenant_id, phone, media_kind, media_url, caption, filename, conversation_id, whatsapp_instance_id } = payload;
    if (!media_url || !media_kind) throw new Error('send_whatsapp_media requires media_url and media_kind');

    let instance = null;
    if (whatsapp_instance_id) {
      const { data } = await supabase.from('whatsapp_instances').select('*').eq('id', whatsapp_instance_id).maybeSingle();
      instance = data;
    }
    if (!instance && conversation_id) {
      const { data: conv } = await supabase.from('conversations').select('whatsapp_instance_id').eq('id', conversation_id).maybeSingle();
      if (conv?.whatsapp_instance_id) {
        const { data } = await supabase.from('whatsapp_instances').select('*').eq('id', conv.whatsapp_instance_id).maybeSingle();
        instance = data;
      }
    }
    if (!instance) {
      const { data } = await supabase.from('whatsapp_instances').select('*').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).maybeSingle();
      instance = data;
    }
    if (!instance) throw new Error('No active WhatsApp instance for tenant');

    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (!cleanPhone) throw new Error('No phone number provided');

    const metaType = media_kind === 'file' ? 'document' : media_kind;

    if (instance.provider === 'meta_cloud') {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send', type: metaType, media_url, caption: caption || undefined,
          filename: filename || undefined, phone: cleanPhone,
          conversation_id: conversation_id || null, whatsapp_instance_id: instance.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(`Meta media send failed: ${data?.error || response.status}`);
      return data;
    }

    // UAZAPI /send/media
    const uazType = media_kind === 'file' ? 'document' : media_kind;
    const response = await fetch(`${instance.api_url}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instance.api_token_encrypted || '' },
      body: JSON.stringify({
        number: cleanPhone, type: uazType, file: media_url,
        text: caption || '', docName: filename || undefined, readchat: true,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`UAZAPI media send failed: ${response.status} ${errText}`);
    }
    return await response.json();
  },



  async send_whatsapp_template(payload) {
    const { tenant_id, whatsapp_instance_id, template_id, template_variables, phone, conversation_id, contact_id } = payload;
    if (!whatsapp_instance_id || !template_id) {
      throw new Error('send_whatsapp_template requires whatsapp_instance_id and template_id');
    }

    const { data: instance } = await supabase.from('whatsapp_instances')
      .select('*').eq('id', whatsapp_instance_id).maybeSingle();
    if (!instance || instance.provider !== 'meta_cloud') {
      throw new Error('Template send requires a Meta Cloud instance');
    }

    const { data: template } = await supabase.from('whatsapp_message_templates')
      .select('*').eq('id', template_id).maybeSingle();
    if (!template) throw new Error('Template not found');

    // Resolve contact + latest open opportunity for variable interpolation
    let contact = null;
    let opportunity = null;
    if (contact_id) {
      const { data } = await supabase.from('contacts').select('*').eq('id', contact_id).maybeSingle();
      contact = data;
      const { data: oppRow } = await supabase
        .from('opportunities')
        .select('title, value, custom_fields')
        .eq('contact_id', contact_id)
        .eq('status', 'open')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      opportunity = oppRow || null;
    }
    const cc = (contact?.custom_fields && typeof contact.custom_fields === 'object') ? contact.custom_fields : {};
    const oc = (opportunity?.custom_fields && typeof opportunity.custom_fields === 'object') ? opportunity.custom_fields : {};
    const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
    const interp = (s) => {
      if (typeof s !== 'string') return s;
      return s.replace(TOKEN_RE, (raw, path) => {
        let v;
        if (path === 'contact.name') v = contact?.name;
        else if (path === 'contact.email') v = contact?.email;
        else if (path === 'contact.phone') v = contact?.phone;
        else if (path.startsWith('contact.custom.')) v = cc[path.slice('contact.custom.'.length)];
        else if (path === 'opportunity.title') v = opportunity?.title;
        else if (path === 'opportunity.value') v = opportunity?.value;
        else if (path.startsWith('opportunity.custom.')) v = oc[path.slice('opportunity.custom.'.length)];
        if (v === undefined || v === null || v === '') {
          console.warn(`[send_whatsapp_template] unresolved variable ${path} for contact ${contact_id}`);
          return raw;
        }
        return String(v);
      });
    };

    // Build components for HEADER (text), BODY and URL BUTTONS — supports
    // both positional ({{1}}) and named ({{nome}}) placeholders.
    const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
    const extractKeys = (text) => {
      if (!text) return [];
      const seen = new Set();
      const out = [];
      let m;
      VAR_RE.lastIndex = 0;
      while ((m = VAR_RE.exec(text)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ key: m[1], named: !/^\d+$/.test(m[1]) });
      }
      out.sort((a, b) => (!a.named && !b.named ? Number(a.key) - Number(b.key) : 0));
      return out;
    };
    const valueFor = (slotId, key) => {
      // Accept new slot-keyed format (header:nome, body:1) and legacy bare key ("1", "nome")
      const raw = template_variables?.[slotId] ?? template_variables?.[key] ?? '';
      return interp(raw);
    };
    const toParam = (slotId, k) => {
      const text = valueFor(slotId, k.key);
      return k.named ? { type: 'text', parameter_name: k.key, text } : { type: 'text', text };
    };

    const components = [];
    const comps = template.components || [];
    const headerC = comps.find((c) => String(c.type).toUpperCase() === 'HEADER' && String(c.format || 'TEXT').toUpperCase() === 'TEXT');
    const bodyC = comps.find((c) => String(c.type).toUpperCase() === 'BODY');
    const buttonsC = comps.find((c) => String(c.type).toUpperCase() === 'BUTTONS');

    if (headerC?.text) {
      const keys = extractKeys(headerC.text);
      if (keys.length) components.push({ type: 'header', parameters: keys.map((k) => toParam(`header:${k.key}`, k)) });
    }
    if (bodyC?.text) {
      const keys = extractKeys(bodyC.text);
      if (keys.length) components.push({ type: 'body', parameters: keys.map((k) => toParam(`body:${k.key}`, k)) });
    }
    if (Array.isArray(buttonsC?.buttons)) {
      buttonsC.buttons.forEach((btn, idx) => {
        if (String(btn?.type).toUpperCase() !== 'URL') return;
        const keys = extractKeys(btn.url || '');
        if (!keys.length) return;
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(idx),
          parameters: keys.map((k) => ({ type: 'text', text: valueFor(`button:${idx}:${k.key}`, k.key) })),
        });
      });
    }

    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    if (!cleanPhone) throw new Error('No phone number');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'send',
        type: 'template',
        phone: cleanPhone,
        conversation_id: conversation_id || null,
        whatsapp_instance_id: instance.id,
        template: {
          name: template.name,
          language: template.language,
          components,
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(`Template send failed: ${data?.error || response.status}`);
    }
    return data;
  },
  async run_automations(payload) {
    const { tenant_id, trigger_type, context } = payload;
    if (!tenant_id || !trigger_type) throw new Error('Missing tenant_id or trigger_type');
    await executeAutomations(supabase, tenant_id, trigger_type, context || {});
    return { trigger_type, executed: true };
  },

  async execute_flow(payload) {
    const { flow_id, tenant_id, contact_id, conversation_id, trigger_data, _resume } = payload;
    if (!flow_id || !tenant_id) throw new Error('Missing flow_id or tenant_id');

    const { data: flow } = await supabase.from('chatbot_flows').select('*').eq('id', flow_id).eq('is_active', true).single();
    if (!flow) return { skipped: true, reason: 'flow not found or inactive' };

    // Resume vs fresh execution
    let execution;
    let ctx;
    let initialQueue;
    let visited;

    if (_resume?.execution_id) {
      const { data: existing } = await supabase.from('flow_executions').select('*').eq('id', _resume.execution_id).single();
      if (!existing) return { skipped: true, reason: 'execution not found' };
      execution = existing;
      ctx = { ...(existing.context || {}), contact_id: existing.contact_id, conversation_id: existing.conversation_id, tenant_id };
      ctx.variables = { ...(ctx.variables || {}), ...(_resume.extra_vars || {}) };
      initialQueue = Array.isArray(_resume.queue) ? [..._resume.queue] : (Array.isArray(existing.pending_queue) ? [...existing.pending_queue] : []);
      visited = new Set();
      await supabase.from('flow_executions').update({
        status: 'running', pending_queue: null, pending_save_field: null, pending_custom_field_key: null,
      }).eq('id', execution.id);
    } else {
      const { data: created } = await supabase.from('flow_executions').insert({
        flow_id, tenant_id, contact_id: contact_id || null, conversation_id: conversation_id || null,
        status: 'running', context: { trigger_data: trigger_data || {} },
      }).select().single();
      execution = created;
      ctx = { contact_id, conversation_id, tenant_id, variables: { ...(trigger_data || {}) } };
      if (contact_id) {
        const { data: ctc } = await supabase.from('contacts').select('name, email, phone').eq('id', contact_id).maybeSingle();
        if (ctc) {
          ctx.variables['contact.name'] = ctc.name || '';
          ctx.variables['contact.email'] = ctc.email || '';
          ctx.variables['contact.phone'] = ctc.phone || '';
        }
      }
      initialQueue = null; // will be set after trigger node lookup
      visited = new Set();
    }

    try {
      const nodes = flow.nodes || [];
      const edges = flow.edges || [];

      // Build adjacency map
      const adjacency = {};
      edges.forEach(e => {
        const key = e.sourceHandle ? `${e.source}:${e.sourceHandle}` : e.source;
        if (!adjacency[key]) adjacency[key] = [];
        adjacency[key].push(e.target);
      });

      let queue;
      if (initialQueue) {
        queue = initialQueue;
      } else {
        const triggerNode = nodes.find(n => n.type === 'trigger');
        if (!triggerNode) throw new Error('No trigger node found');
        queue = [triggerNode.id];
      }

      // If no conversation but we have contact + flow has a default WhatsApp number,
      // auto-create/reuse an open conversation on that number so messages can be sent.
      if (!ctx.conversation_id && ctx.contact_id && flow.whatsapp_instance_id) {
        const { data: existingConv } = await supabase.from('conversations')
          .select('id')
          .eq('tenant_id', tenant_id)
          .eq('contact_id', ctx.contact_id)
          .eq('whatsapp_instance_id', flow.whatsapp_instance_id)
          .in('status', ['open', 'waiting_customer', 'waiting_agent'])
          .maybeSingle();
        if (existingConv?.id) {
          ctx.conversation_id = existingConv.id;
        } else {
          const { data: newConv } = await supabase.from('conversations').insert({
            tenant_id, contact_id: ctx.contact_id,
            channel: 'whatsapp', status: 'open',
            whatsapp_instance_id: flow.whatsapp_instance_id,
          }).select('id').single();
          ctx.conversation_id = newConv?.id || null;
        }
        if (ctx.conversation_id) {
          await supabase.from('flow_executions').update({ conversation_id: ctx.conversation_id }).eq('id', execution.id);
        }
      }
      let stepCount = 0;
      const MAX_STEPS = 50;
      let paused = false;

      while (queue.length > 0 && stepCount < MAX_STEPS && !paused) {
        const nodeId = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        stepCount++;

        const node = nodes.find(n => n.id === nodeId);
        if (!node) continue;

        await supabase.from('flow_executions').update({ current_node_id: nodeId }).eq('id', execution.id);

        if (node.type === 'trigger') {
          // Just proceed to next
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'message') {
          const mode = node.data?.mode || 'text';
          // Resolve conversation's instance + provider once
          let convInstance = null;
          if (ctx.conversation_id) {
            const { data: conv } = await supabase.from('conversations')
              .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
            if (conv?.whatsapp_instance_id) {
              const { data: inst } = await supabase.from('whatsapp_instances')
                .select('id, provider').eq('id', conv.whatsapp_instance_id).maybeSingle();
              convInstance = inst;
            }
          }
          const isMetaConv = convInstance?.provider === 'meta_cloud';

          // Resolve contact phone for sending
          let contactPhone = null;
          if (ctx.contact_id) {
            const { data: c } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
            contactPhone = c?.phone || null;
          }

          const interpolate = (s) => (typeof s === 'string' ? s : '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => ctx.variables[key] || '');
          const sendInstanceId = convInstance?.id || flow.whatsapp_instance_id || null;

          if (mode === 'items' && Array.isArray(node.data?.items)) {
            // Multi-item content: process in order
            for (const item of node.data.items) {
              if (!item || !item.kind) continue;
              if (item.kind === 'text') {
                const content = interpolate(item.content || '');
                if (content && ctx.conversation_id) {
                  await supabase.from('messages').insert({
                    tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
                    content, is_ai_generated: false,
                  });
                  if (contactPhone) {
                    await supabase.rpc('enqueue_job', {
                      _type: 'send_whatsapp',
                      _payload: JSON.stringify({
                        tenant_id, phone: contactPhone, message: content,
                        conversation_id: ctx.conversation_id,
                        whatsapp_instance_id: sendInstanceId,
                      }),
                      _tenant_id: tenant_id,
                    });
                  }
                }
              } else if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' || item.kind === 'file') {
                const mediaUrl = interpolate(item.url || '');
                const caption = interpolate(item.caption || '');
                if (mediaUrl && contactPhone) {
                  // Persist message stub
                  if (ctx.conversation_id) {
                    await supabase.from('messages').insert({
                      tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
                      content: caption || null, media_url: mediaUrl, media_type: item.kind,
                      is_ai_generated: false,
                    });
                  }
                  await supabase.rpc('enqueue_job', {
                    _type: 'send_whatsapp_media',
                    _payload: JSON.stringify({
                      tenant_id, phone: contactPhone,
                      media_kind: item.kind, media_url: mediaUrl,
                      caption: caption || null, filename: item.filename || null,
                      conversation_id: ctx.conversation_id,
                      whatsapp_instance_id: sendInstanceId,
                    }),
                    _tenant_id: tenant_id,
                  });
                }
              } else if (item.kind === 'delay') {
                const secs = Math.max(1, Math.min(60, Number(item.seconds) || 5));
                await new Promise(r => setTimeout(r, secs * 1000));
              } else if (item.kind === 'autooff') {
                if (ctx.conversation_id) {
                  const { data: conv } = await supabase.from('conversations')
                    .select('metadata').eq('id', ctx.conversation_id).maybeSingle();
                  const metadata = { ...(conv?.metadata || {}), ai_activated: false, ai_deactivated_at: new Date().toISOString(), ai_deactivated_reason: 'flow_autooff' };
                  await supabase.from('conversations').update({ metadata }).eq('id', ctx.conversation_id);
                  console.log(`[Worker] Flow ${flow_id}: autooff aplicado em conv ${ctx.conversation_id}`);
                }
              }
            }
          } else if (mode === 'template' && isMetaConv && node.data?.templateId && contactPhone) {
            // Send Meta template via dedicated handler
            await supabase.rpc('enqueue_job', {
              _type: 'send_whatsapp_template',
              _payload: JSON.stringify({
                tenant_id,
                whatsapp_instance_id: convInstance.id,
                template_id: node.data.templateId,
                template_variables: node.data.templateVariables || {},
                phone: contactPhone,
                conversation_id: ctx.conversation_id,
                contact_id: ctx.contact_id,
              }),
              _tenant_id: tenant_id,
            });
            console.log(`[Worker] Flow ${flow_id}: enqueued Meta template "${node.data.templateName || node.data.templateId}"`);
          } else {
            // Text mode (or template fallback for UAZAPI / sem instância Meta)
            const content = interpolate(node.data?.content || '');
            if (content && ctx.conversation_id) {
              await supabase.from('messages').insert({
                tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
                content, is_ai_generated: false,
              });
              if (contactPhone) {
                await supabase.rpc('enqueue_job', {
                  _type: 'send_whatsapp',
                  _payload: JSON.stringify({
                    tenant_id, phone: contactPhone, message: content,
                    conversation_id: ctx.conversation_id,
                    whatsapp_instance_id: sendInstanceId,
                  }),
                  _tenant_id: tenant_id,
                });
              }
            } else if (mode === 'template' && !isMetaConv) {
              console.log(`[Worker] Flow ${flow_id}: template node sem fallback de texto e conversa não-Meta — ignorado`);
            }
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'delay') {
          // Schedule continuation as a delayed job
          const delayMinutes = node.data?.delayMinutes || 5;
          const runAfter = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
          // For simplicity, we just wait inline (for short delays) or enqueue continuation
          if (delayMinutes <= 1) {
            await new Promise(r => setTimeout(r, delayMinutes * 60 * 1000));
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
          } else {
            // For longer delays, we stop here and enqueue a continuation job
            // This is a simplified approach - full implementation would save state
            console.log(`[Worker] Flow ${flow_id}: delay node ${nodeId} - ${delayMinutes}min`);
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
            // In production, you'd save queue state and resume later
          }
        } else if (node.type === 'condition') {
          const normalize = (s) => removeAccents(String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' '));
          const evalOne = (field, operator, value) => {
            const testValue = ctx.variables[field] ?? ctx.variables.message ?? '';
            const normTest = normalize(testValue);
            const normValue = normalize(value);
            switch (operator) {
              case 'contains':     return normTest.includes(normValue);
              case 'not_contains': return !normTest.includes(normValue);
              case 'equals':       return normTest === normValue;
              case 'not_equals':   return normTest !== normValue;
              case 'starts_with':  return normTest.startsWith(normValue);
              case 'ends_with':    return normTest.endsWith(normValue);
              case 'exists':       return String(testValue ?? '').trim().length > 0;
              case 'not_exists':   return String(testValue ?? '').trim().length === 0;
              default:             return false;
            }
          };

          const criteria = Array.isArray(node.data?.criteria) && node.data.criteria.length > 0
            ? node.data.criteria
            : [{ field: node.data?.field || 'message', operator: node.data?.operator || 'contains', value: node.data?.value || '' }];
          const combinator = String(node.data?.combinator || 'AND').toUpperCase();
          const results = criteria.map(c => evalOne(c.field, c.operator, c.value));
          const result = combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);

          const yesTargets = adjacency[`${nodeId}:yes`] || adjacency[nodeId] || [];
          const noTargets = adjacency[`${nodeId}:no`] || [];
          if (result) yesTargets.forEach(n => queue.push(n));
          else noTargets.forEach(n => queue.push(n));
        } else if (node.type === 'action') {
          const runAction = async (actionType, config) => {
            config = config || {};
            switch (actionType) {
              case 'add_tag':
                if (ctx.contact_id && config.tag) {
                  const { data: c } = await supabase.from('contacts').select('tags').eq('id', ctx.contact_id).single();
                  const tags = [...new Set([...(c?.tags || []), config.tag])];
                  await supabase.from('contacts').update({ tags }).eq('id', ctx.contact_id);
                }
                break;
              case 'remove_tag':
                if (ctx.contact_id && config.tag) {
                  const { data: c } = await supabase.from('contacts').select('tags').eq('id', ctx.contact_id).single();
                  const tags = (c?.tags || []).filter(t => t !== config.tag);
                  await supabase.from('contacts').update({ tags }).eq('id', ctx.contact_id);
                }
                break;
              case 'send_whatsapp':
                if (ctx.contact_id && config.message) {
                  const { data: contact } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
                  if (contact?.phone) {
                    let convInstId = null;
                    if (ctx.conversation_id) {
                      const { data: conv } = await supabase.from('conversations')
                        .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
                      convInstId = conv?.whatsapp_instance_id || null;
                    }
                    await supabase.rpc('enqueue_job', {
                      _type: 'send_whatsapp',
                      _payload: JSON.stringify({
                        tenant_id, phone: contact.phone, message: config.message,
                        conversation_id: ctx.conversation_id,
                        whatsapp_instance_id: convInstId || flow.whatsapp_instance_id || null,
                      }),
                      _tenant_id: tenant_id,
                    });
                  }
                }
                break;
              case 'create_opportunity': {
                if (!ctx.contact_id) break;
                const { data: existingOpp } = await supabase.from('opportunities')
                  .select('id').eq('tenant_id', tenant_id).eq('contact_id', ctx.contact_id).eq('status', 'open').limit(1);
                if (existingOpp && existingOpp.length > 0) break;
                let pipelineId = config.pipeline_id || null;
                if (!pipelineId) {
                  const { data: pipeline } = await supabase.from('pipelines')
                    .select('id').eq('tenant_id', tenant_id).eq('is_default', true).maybeSingle();
                  pipelineId = pipeline?.id || null;
                }
                if (!pipelineId) break;
                let stageId = config.stage_id || null;
                if (!stageId) {
                  const { data: stage } = await supabase.from('stages')
                    .select('id').eq('pipeline_id', pipelineId).order('position').limit(1).maybeSingle();
                  stageId = stage?.id || null;
                }
                if (!stageId) break;
                const { data: contact } = await supabase.from('contacts').select('name').eq('id', ctx.contact_id).single();
                await supabase.from('opportunities').insert({
                  tenant_id, contact_id: ctx.contact_id, pipeline_id: pipelineId, stage_id: stageId,
                  title: `Lead: ${contact?.name || 'Contato'}`, source: 'flow_builder',
                });
                break;
              }
              case 'move_stage': {
                if (!ctx.contact_id || !config.stage_id) break;
                let targetOpp = null;
                if (config.pipeline_id) {
                  const { data: opps } = await supabase.from('opportunities')
                    .select('id, stage_id').eq('tenant_id', tenant_id).eq('contact_id', ctx.contact_id)
                    .eq('pipeline_id', config.pipeline_id).eq('status', 'open')
                    .order('updated_at', { ascending: false }).limit(1);
                  targetOpp = opps?.[0] || null;
                }
                if (!targetOpp) {
                  const { data: opps } = await supabase.from('opportunities')
                    .select('id, stage_id, pipeline_id').eq('tenant_id', tenant_id).eq('contact_id', ctx.contact_id)
                    .eq('status', 'open').order('updated_at', { ascending: false }).limit(1);
                  targetOpp = opps?.[0] || null;
                }
                if (!targetOpp) {
                  console.log(`[Worker] Flow ${flow_id}: move_stage — sem oportunidade aberta para contato ${ctx.contact_id}`);
                  break;
                }
                if (targetOpp.stage_id === config.stage_id) break;
                const fromStage = targetOpp.stage_id;
                await supabase.from('opportunities').update({ stage_id: config.stage_id }).eq('id', targetOpp.id);
                await supabase.from('stage_moves').insert({
                  tenant_id, opportunity_id: targetOpp.id,
                  from_stage_id: fromStage, to_stage_id: config.stage_id,
                  is_ai_move: false, ai_reason: 'Flow Builder action',
                });
                console.log(`[Worker] Flow ${flow_id}: moved opp ${targetOpp.id} to stage ${config.stage_id}`);
                break;
              }
              case 'close_conversation':
                if (ctx.conversation_id) {
                  await supabase.from('conversations').update({ status: 'closed' }).eq('id', ctx.conversation_id);
                }
                break;
              case 'assign_agent':
                if (ctx.conversation_id) {
                  let assignTo = null;
                  if (config.mode === 'specific' && config.membership_id) {
                    const { data: mem } = await supabase
                      .from('tenant_memberships')
                      .select('id')
                      .eq('id', config.membership_id)
                      .eq('tenant_id', tenant_id)
                      .eq('is_active', true)
                      .maybeSingle();
                    if (mem) assignTo = mem.id;
                  }
                  if (!assignTo) {
                    const { data: workload } = await supabase.rpc('get_member_workload', { p_tenant_id: tenant_id });
                    if (workload && workload.length > 0) assignTo = workload[0].membership_id;
                  }
                  if (assignTo) {
                    await supabase.from('conversations').update({ assigned_to: assignTo }).eq('id', ctx.conversation_id);
                  }
                }
                break;
              case 'webhook': {
                const interp = (s) => (typeof s === 'string' ? s : '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, k) => ctx.variables[k] || '');
                const url = interp(config.url || '');
                if (!url) break;
                const method = (config.method || 'POST').toUpperCase();
                let headers = { 'Content-Type': 'application/json' };
                try { if (config.headers) headers = { ...headers, ...JSON.parse(config.headers) }; } catch {}
                let body;
                if (method !== 'GET' && method !== 'DELETE') {
                  const raw = interp(config.body || '');
                  body = raw || JSON.stringify({ contact_id: ctx.contact_id, conversation_id: ctx.conversation_id, variables: ctx.variables });
                }
                try {
                  const resp = await fetch(url, { method, headers, body });
                  const text = await resp.text();
                  console.log(`[Worker] Flow ${flow_id}: webhook ${method} ${url} → ${resp.status}`);
                  if (config.save_to) {
                    let parsed = text;
                    try { parsed = JSON.parse(text); } catch {}
                    ctx.variables[config.save_to] = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                  }
                } catch (err) {
                  console.error(`[Worker] Flow ${flow_id}: webhook error:`, err.message);
                }
                break;
              }
              case 'google_sheets_append': {
                const interp = (s) => (typeof s === 'string' ? s : '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, k) => ctx.variables[k] || '');
                const lovableKey = process.env.LOVABLE_API_KEY;
                const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
                if (!lovableKey || !sheetsKey) {
                  console.error(`[Worker] Flow ${flow_id}: google_sheets_append — credenciais ausentes (LOVABLE_API_KEY/GOOGLE_SHEETS_API_KEY)`);
                  break;
                }
                const spreadsheetId = config.spreadsheet_id;
                const range = config.range || 'Sheet1!A:Z';
                if (!spreadsheetId) break;
                const values = [(config.values || []).map((v) => interp(v))];
                const url = `https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
                try {
                  const resp = await fetch(url, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${lovableKey}`,
                      'X-Connection-Api-Key': sheetsKey,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ values }),
                  });
                  if (!resp.ok) {
                    const t = await resp.text();
                    console.error(`[Worker] Flow ${flow_id}: sheets append ${resp.status}: ${t}`);
                  } else {
                    console.log(`[Worker] Flow ${flow_id}: sheets append ok (${values[0].length} cols)`);
                  }
                } catch (err) {
                  console.error(`[Worker] Flow ${flow_id}: sheets error:`, err.message);
                }
                break;
              }
              case 'ai_assistant': {
                const interp = (s) => (typeof s === 'string' ? s : '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, k) => ctx.variables[k] || '');
                const lovableKey = process.env.LOVABLE_API_KEY;
                if (!lovableKey) {
                  console.error(`[Worker] Flow ${flow_id}: ai_assistant — LOVABLE_API_KEY ausente`);
                  break;
                }
                const model = config.model || 'google/gemini-3-flash-preview';
                const messages = [];
                if (config.system) messages.push({ role: 'system', content: interp(config.system) });
                messages.push({ role: 'user', content: interp(config.prompt || '') });
                try {
                  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${lovableKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ model, messages }),
                  });
                  const data = await resp.json();
                  if (!resp.ok) {
                    console.error(`[Worker] Flow ${flow_id}: ai_assistant ${resp.status}:`, JSON.stringify(data));
                    break;
                  }
                  const out = data?.choices?.[0]?.message?.content || '';
                  if (!out) break;
                  if (config.output === 'save_variable' && config.save_to) {
                    ctx.variables[config.save_to] = out;
                  } else {
                    // send via WhatsApp
                    if (ctx.contact_id && ctx.conversation_id) {
                      const { data: c } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
                      if (c?.phone) {
                        const { data: conv } = await supabase.from('conversations')
                          .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
                        await supabase.from('messages').insert({
                          tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
                          content: out, is_ai_generated: true,
                        });
                        await supabase.rpc('enqueue_job', {
                          _type: 'send_whatsapp',
                          _payload: JSON.stringify({
                            tenant_id, phone: c.phone, message: out,
                            conversation_id: ctx.conversation_id,
                            whatsapp_instance_id: conv?.whatsapp_instance_id || flow.whatsapp_instance_id || null,
                          }),
                          _tenant_id: tenant_id,
                        });
                      }
                    }
                  }
                } catch (err) {
                  console.error(`[Worker] Flow ${flow_id}: ai_assistant error:`, err.message);
                }
                break;
              }
            }
          };

          const actionsList = Array.isArray(node.data?.actions) && node.data.actions.length > 0
            ? node.data.actions
            : [{ type: node.data?.actionType || '', config: node.data?.config || {} }];
          for (const a of actionsList) {
            try { await runAction(a.type, a.config); }
            catch (err) { console.error(`[Worker] Flow ${flow_id}: action ${a.type} error:`, err.message); }
          }

          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'question') {
          // Send the question text to the contact, then pause execution waiting for reply.
          const questionText = (node.data?.question || node.data?.label || '').trim();
          const saveField = node.data?.saveField || '';
          const customKey = saveField === 'custom' ? (node.data?.customFieldKey || '') : null;

          // Resolve conversation instance for sending
          let convInstance = null;
          if (ctx.conversation_id) {
            const { data: conv } = await supabase.from('conversations')
              .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
            if (conv?.whatsapp_instance_id) {
              const { data: inst } = await supabase.from('whatsapp_instances')
                .select('id').eq('id', conv.whatsapp_instance_id).maybeSingle();
              convInstance = inst;
            }
          }
          let contactPhone = null;
          if (ctx.contact_id) {
            const { data: c } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
            contactPhone = c?.phone || null;
          }

          if (questionText && ctx.conversation_id) {
            const interpolated = questionText.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => ctx.variables[key] || '');
            await supabase.from('messages').insert({
              tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
              content: interpolated, is_ai_generated: false,
            });
            if (contactPhone) {
              await supabase.rpc('enqueue_job', {
                _type: 'send_whatsapp',
                _payload: JSON.stringify({
                  tenant_id, phone: contactPhone, message: interpolated,
                  conversation_id: ctx.conversation_id,
                  whatsapp_instance_id: convInstance?.id || flow.whatsapp_instance_id || null,
                }),
                _tenant_id: tenant_id,
              });
            }
          }

          // Persist pending state and pause
          const nextNodes = adjacency[nodeId] || [];
          await supabase.from('flow_executions').update({
            status: 'awaiting_input',
            current_node_id: nodeId,
            pending_queue: nextNodes,
            pending_save_field: saveField || null,
            pending_custom_field_key: customKey || null,
            context: { ...ctx },
          }).eq('id', execution.id);
          console.log(`[Worker] Flow ${flow_id}: question node ${nodeId} sent — awaiting reply`);
          paused = true;
          break;
        } else if (node.type === 'randomizer') {
          const mode = node.data?.mode || 'random';
          const options = node.data?.options || [];
          if (options.length === 0) {
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
          } else {
            let chosenIndex = 0;
            if (mode === 'random') {
              // Weighted random selection
              const totalWeight = options.reduce((s, o) => s + (o.weight || 0), 0);
              const rand = Math.random() * totalWeight;
              let cumulative = 0;
              for (let i = 0; i < options.length; i++) {
                cumulative += options[i].weight || 0;
                if (rand <= cumulative) { chosenIndex = i; break; }
              }
            } else {
              // Sequential round-robin using execution context
              const counterKey = `randomizer_${nodeId}`;
              const counters = ctx.variables._randomizer_counters || {};
              const current = counters[counterKey] || 0;
              chosenIndex = current % options.length;
              // Update counter in context and flow_executions
              counters[counterKey] = current + 1;
              ctx.variables._randomizer_counters = counters;
              await supabase.from('flow_executions').update({
                context: { ...ctx, variables: ctx.variables },
              }).eq('id', execution.id);
            }
            console.log(`[Worker] Flow: randomizer ${mode} chose option ${chosenIndex} "${options[chosenIndex]?.label}"`);
            // Follow edges from the chosen option handle
            const handleKey = `${nodeId}:option-${chosenIndex}`;
            const next = adjacency[handleKey] || [];
            next.forEach(n => queue.push(n));
          }
        } else if (node.type === 'menu') {
          // Send menu question and pause waiting for reply
          const options = Array.isArray(node.data?.options) ? node.data.options : [];
          const questionText = node.data?.question || '';
          const maxRetries = Math.max(1, Number(node.data?.maxRetries) || 3);

          let convInstance = null;
          if (ctx.conversation_id) {
            const { data: conv } = await supabase.from('conversations')
              .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
            convInstance = conv;
          }
          let contactPhone = null;
          if (ctx.contact_id) {
            const { data: c } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
            contactPhone = c?.phone || null;
          }

          if (questionText && ctx.conversation_id) {
            const interpolated = questionText.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => ctx.variables[key] || '');
            await supabase.from('messages').insert({
              tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
              content: interpolated, is_ai_generated: false,
            });
            if (contactPhone) {
              await supabase.rpc('enqueue_job', {
                _type: 'send_whatsapp',
                _payload: JSON.stringify({
                  tenant_id, phone: contactPhone, message: interpolated,
                  conversation_id: ctx.conversation_id,
                  whatsapp_instance_id: convInstance?.whatsapp_instance_id || flow.whatsapp_instance_id || null,
                }),
                _tenant_id: tenant_id,
              });
            }
          }

          await supabase.from('flow_executions').update({
            status: 'awaiting_input',
            current_node_id: nodeId,
            pending_queue: [],
            pending_menu: {
              node_id: nodeId,
              options,
              max_retries: maxRetries,
              retries: 0,
              invalid_text: node.data?.invalidText || 'Desculpe, não entendi. Por favor, escolha uma das opções.',
              save_variable: node.data?.saveVariable || null,
            },
            context: { ...ctx },
          }).eq('id', execution.id);
          console.log(`[Worker] Flow ${flow_id}: menu node ${nodeId} sent — awaiting choice`);
          paused = true;
          break;
        } else if (node.type === 'subflow') {
          const targetFlowId = node.data?.targetFlowId;
          const mode = node.data?.mode || 'call';
          if (targetFlowId) {
            await supabase.rpc('enqueue_job', {
              _type: 'execute_flow',
              _payload: JSON.stringify({
                flow_id: targetFlowId,
                tenant_id,
                contact_id: ctx.contact_id || null,
                conversation_id: ctx.conversation_id || null,
                trigger_data: { ...(ctx.variables || {}), _parent_flow: flow_id },
              }),
              _tenant_id: tenant_id,
            });
            console.log(`[Worker] Flow ${flow_id}: subflow ${mode} → ${targetFlowId}`);
          }
          if (mode === 'transfer') {
            queue = [];
          } else {
            const next = adjacency[nodeId] || [];
            next.forEach(n => queue.push(n));
          }
        } else if (node.type === 'aiassistant') {
          const data = node.data || {};
          const interp = (s) => (typeof s === 'string' ? s : '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, k) => ctx.variables[k] || '');
          const lovableKey = process.env.LOVABLE_API_KEY;
          let branch = 'success';

          if (!lovableKey) {
            console.error(`[Worker] Flow ${flow_id}: aiassistant — LOVABLE_API_KEY ausente`);
          } else {
            try {
              // Optional RAG retrieval
              let ragContext = '';
              if (data.useRag && ctx.variables.message) {
                try {
                  const embResp = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'google/gemini-embedding-001', input: ctx.variables.message }),
                  });
                  const embData = await embResp.json();
                  const emb = embData?.data?.[0]?.embedding;
                  if (emb) {
                    const { data: chunks } = await supabase.rpc('search_knowledge', {
                      _tenant_id: tenant_id,
                      _query_embedding: emb,
                      _match_count: 4,
                      _match_threshold: 0.65,
                      _category: data.ragCategory || null,
                    });
                    if (chunks && chunks.length) {
                      ragContext = '\n\nContexto (base de conhecimento):\n' + chunks.map((c, i) => `[${i+1}] ${c.content}`).join('\n---\n');
                    }
                  }
                } catch (ragErr) {
                  console.warn(`[Worker] Flow ${flow_id}: aiassistant RAG falhou:`, ragErr.message);
                }
              }

              const systemPrompt = interp(data.system || 'Você é um atendente atencioso.') + ragContext;
              const userPrompt = interp(data.prompt || '{{message}}');
              const model = data.model || 'google/gemini-3-flash-preview';

              const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                  ],
                }),
              });
              const json = await resp.json();
              if (!resp.ok) {
                console.error(`[Worker] Flow ${flow_id}: aiassistant ${resp.status}:`, JSON.stringify(json));
              } else {
                let out = json?.choices?.[0]?.message?.content || '';
                const hasHandoff = /\[\[HANDOFF\]\]/i.test(out);
                if (hasHandoff) {
                  branch = 'handoff';
                  out = out.replace(/\[\[HANDOFF\]\]/gi, '').trim();
                  // Deactivate AI on conversation
                  if (ctx.conversation_id) {
                    const { data: conv } = await supabase.from('conversations')
                      .select('metadata').eq('id', ctx.conversation_id).maybeSingle();
                    const metadata = { ...(conv?.metadata || {}), ai_activated: false, ai_deactivated_at: new Date().toISOString(), ai_deactivated_reason: 'flow_aiassistant_handoff' };
                    await supabase.from('conversations').update({ metadata, status: 'waiting_agent' }).eq('id', ctx.conversation_id);
                  }
                }

                if (out && ctx.conversation_id) {
                  const { data: conv } = await supabase.from('conversations')
                    .select('whatsapp_instance_id').eq('id', ctx.conversation_id).maybeSingle();
                  await supabase.from('messages').insert({
                    tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
                    content: out, is_ai_generated: true,
                  });
                  if (ctx.contact_id) {
                    const { data: c } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
                    if (c?.phone) {
                      await supabase.rpc('enqueue_job', {
                        _type: 'send_whatsapp',
                        _payload: JSON.stringify({
                          tenant_id, phone: c.phone, message: out,
                          conversation_id: ctx.conversation_id,
                          whatsapp_instance_id: conv?.whatsapp_instance_id || flow.whatsapp_instance_id || null,
                        }),
                        _tenant_id: tenant_id,
                      });
                    }
                  }
                }
                console.log(`[Worker] Flow ${flow_id}: aiassistant branch=${branch}`);
              }
            } catch (err) {
              console.error(`[Worker] Flow ${flow_id}: aiassistant error:`, err.message);
            }
          }

          const next = adjacency[`${nodeId}:${branch}`] || adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        }

      }

      if (!paused) {
        await supabase.from('flow_executions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', execution.id);
      }
      return { execution_id: execution.id, steps: stepCount, paused };
    } catch (err) {
      await supabase.from('flow_executions').update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() }).eq('id', execution.id);
      throw err;
    }
  },

  async resume_flow_execution(payload) {
    const { execution_id, answer } = payload;
    if (!execution_id) throw new Error('Missing execution_id');

    const { data: execution } = await supabase.from('flow_executions').select('*').eq('id', execution_id).single();
    if (!execution) return { skipped: true, reason: 'execution not found' };
    if (execution.status !== 'awaiting_input') {
      return { skipped: true, reason: `status is ${execution.status}` };
    }

    const text = (answer || '').trim();

    // --- MENU resume path -----------------------------------------------
    const pendingMenu = execution.pending_menu;
    if (pendingMenu && pendingMenu.node_id) {
      const normalize = (s) => removeAccents(String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' '));
      const normAnswer = normalize(text);
      const options = Array.isArray(pendingMenu.options) ? pendingMenu.options : [];

      // 1) try numeric "1", "2"...; 2) match label; 3) match value (comma list)
      let matchedIndex = -1;
      const asNum = parseInt(normAnswer, 10);
      if (!isNaN(asNum) && asNum >= 1 && asNum <= options.length) {
        matchedIndex = asNum - 1;
      } else {
        matchedIndex = options.findIndex(opt => {
          if (normalize(opt.label) === normAnswer) return true;
          const synonyms = String(opt.value || '').split(',').map(s => normalize(s)).filter(Boolean);
          if (synonyms.includes(normAnswer)) return true;
          // partial: answer contains label or vice-versa
          const lbl = normalize(opt.label);
          if (lbl && (normAnswer.includes(lbl) || synonyms.some(s => normAnswer.includes(s)))) return true;
          return false;
        });
      }

      if (matchedIndex >= 0) {
        const matched = options[matchedIndex];
        // Save chosen value as variable if requested
        const extraVars = { message: text, last_answer: text, menu_choice: matched.label };
        if (pendingMenu.save_variable) extraVars[pendingMenu.save_variable] = matched.label;

        // Resume from option handle
        const { data: flow } = await supabase.from('chatbot_flows').select('edges').eq('id', execution.flow_id).single();
        const edges = flow?.edges || [];
        const targets = edges
          .filter(e => e.source === pendingMenu.node_id && e.sourceHandle === `option-${matched.id}`)
          .map(e => e.target);

        await supabase.from('flow_executions').update({ pending_menu: null }).eq('id', execution_id);
        return await handlers.execute_flow({
          flow_id: execution.flow_id,
          tenant_id: execution.tenant_id,
          _resume: { execution_id, queue: targets, extra_vars: extraVars },
        });
      }

      // No match → increment retries
      const newRetries = (pendingMenu.retries || 0) + 1;
      if (newRetries >= pendingMenu.max_retries) {
        // Follow "invalid" handle
        const { data: flow } = await supabase.from('chatbot_flows').select('edges').eq('id', execution.flow_id).single();
        const edges = flow?.edges || [];
        const targets = edges
          .filter(e => e.source === pendingMenu.node_id && e.sourceHandle === 'invalid')
          .map(e => e.target);
        await supabase.from('flow_executions').update({ pending_menu: null }).eq('id', execution_id);
        console.log(`[Worker] Menu ${pendingMenu.node_id}: max retries exceeded, following invalid handle`);
        return await handlers.execute_flow({
          flow_id: execution.flow_id,
          tenant_id: execution.tenant_id,
          _resume: { execution_id, queue: targets, extra_vars: { message: text, last_answer: text } },
        });
      }

      // Resend invalid message, keep paused
      if (execution.conversation_id) {
        const { data: contact } = await supabase.from('contacts').select('phone').eq('id', execution.contact_id).single();
        const { data: conv } = await supabase.from('conversations').select('whatsapp_instance_id').eq('id', execution.conversation_id).maybeSingle();
        await supabase.from('messages').insert({
          tenant_id: execution.tenant_id, conversation_id: execution.conversation_id,
          direction: 'outbound', content: pendingMenu.invalid_text, is_ai_generated: false,
        });
        if (contact?.phone) {
          await supabase.rpc('enqueue_job', {
            _type: 'send_whatsapp',
            _payload: JSON.stringify({
              tenant_id: execution.tenant_id, phone: contact.phone,
              message: pendingMenu.invalid_text,
              conversation_id: execution.conversation_id,
              whatsapp_instance_id: conv?.whatsapp_instance_id || null,
            }),
            _tenant_id: execution.tenant_id,
          });
        }
      }
      await supabase.from('flow_executions').update({
        pending_menu: { ...pendingMenu, retries: newRetries },
      }).eq('id', execution_id);
      console.log(`[Worker] Menu ${pendingMenu.node_id}: retry ${newRetries}/${pendingMenu.max_retries}`);
      return { execution_id, menu_retry: newRetries };
    }

    // --- QUESTION resume path (existing behavior) -----------------------
    const saveField = execution.pending_save_field;
    const customKey = execution.pending_custom_field_key;

    if (execution.contact_id && saveField && text) {
      if (saveField === 'custom' && customKey) {
        const { data: c } = await supabase.from('contacts').select('custom_fields').eq('id', execution.contact_id).single();
        const customFields = { ...(c?.custom_fields || {}), [customKey]: text };
        await supabase.from('contacts').update({ custom_fields: customFields }).eq('id', execution.contact_id);
        console.log(`[Worker] Flow resume: saved custom field "${customKey}" = "${text}"`);
      } else if (saveField !== 'custom') {
        await supabase.from('contacts').update({ [saveField]: text }).eq('id', execution.contact_id);
        console.log(`[Worker] Flow resume: saved "${saveField}" = "${text}"`);
      }
    }

    // Re-enter execute_flow in resume mode with the pending queue
    return await handlers.execute_flow({
      flow_id: execution.flow_id,
      tenant_id: execution.tenant_id,
      _resume: {
        execution_id,
        queue: Array.isArray(execution.pending_queue) ? execution.pending_queue : [],
        extra_vars: { message: text, last_answer: text },
      },
    });
  },

  async send_scheduled_message(payload) {
    const { scheduled_message_id } = payload;
    if (!scheduled_message_id) throw new Error('Missing scheduled_message_id');

    const { data: msg } = await supabase.from('scheduled_messages')
      .select('*, conversations!inner(contact_id, channel)')
      .eq('id', scheduled_message_id)
      .eq('status', 'pending')
      .single();

    if (!msg) return { skipped: true, reason: 'not found or not pending' };

    const conv = msg.conversations;

    // Insert message
    await supabase.from('messages').insert({
      tenant_id: msg.tenant_id,
      conversation_id: msg.conversation_id,
      direction: 'outbound',
      content: msg.content,
      sender_membership_id: msg.created_by,
      is_ai_generated: false,
    });

    // Send via WhatsApp if applicable
    if (conv.channel === 'whatsapp' && conv.contact_id) {
      const { data: contact } = await supabase.from('contacts').select('phone').eq('id', conv.contact_id).single();
      if (contact?.phone) {
        await supabase.rpc('enqueue_job', {
          _type: 'send_whatsapp',
          _payload: JSON.stringify({
            tenant_id: msg.tenant_id,
            phone: contact.phone,
            message: msg.content,
            conversation_id: msg.conversation_id,
          }),
          _tenant_id: msg.tenant_id,
        });
      }
    }

    // Update conversation
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      last_agent_message_at: new Date().toISOString(),
      status: 'waiting_customer',
    }).eq('id', msg.conversation_id);

    // Mark as sent
    await supabase.from('scheduled_messages').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', msg.id);

    return { sent: true, scheduled_message_id };
  },

  async ingest_document(payload) {
    const { document_id, tenant_id } = payload;
    if (!document_id || !tenant_id) throw new Error('Missing document_id or tenant_id');

    console.log(`[Worker] ingest_document: starting for ${document_id}`);

    try {
      // Get document metadata
      const { data: doc, error: docErr } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('id', document_id)
        .eq('tenant_id', tenant_id)
        .single();

      if (docErr || !doc) {
        await supabase.from('knowledge_documents').update({ status: 'error', error: 'Documento não encontrado' }).eq('id', document_id);
        throw new Error('Document not found');
      }

      // Download file from storage
      console.log(`[Worker] ingest_document: downloading ${doc.storage_path}`);
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('crm-files')
        .download(doc.storage_path);

      if (dlErr || !fileData) {
        await supabase.from('knowledge_documents').update({ status: 'error', error: 'Falha no download do arquivo' }).eq('id', document_id);
        throw new Error('Download failed: ' + (dlErr?.message || 'no data'));
      }

      // Extract text
      const mime = doc.mime_type || '';
      let text = '';

      if (mime.includes('pdf') || doc.name?.toLowerCase().endsWith('.pdf')) {
        console.log(`[Worker] ingest_document: extracting PDF text`);
        try {
          const pdfParse = require('pdf-parse');
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const result = await pdfParse(buffer);
          text = result.text || '';
          console.log(`[Worker] ingest_document: PDF extracted ${text.length} chars`);
        } catch (pdfErr) {
          console.error('[Worker] ingest_document: PDF parse error:', pdfErr.message);
          await supabase.from('knowledge_documents').update({
            status: 'error',
            error: 'Erro ao extrair texto do PDF: ' + pdfErr.message,
          }).eq('id', document_id);
          throw pdfErr;
        }
      } else {
        text = await fileData.text();
        console.log(`[Worker] ingest_document: text file ${text.length} chars`);
      }

      if (!text || text.trim().length < 10) {
        await supabase.from('knowledge_documents').update({
          status: 'error',
          error: 'Texto insuficiente extraído do documento.',
        }).eq('id', document_id);
        return { success: false, message: 'Insufficient text' };
      }

      // Chunk text with safe algorithm
      const CHUNK_SIZE = 2000;
      const CHUNK_OVERLAP = 200;
      const chunks = [];
      let start = 0;

      while (start < text.length) {
        const end = Math.min(start + CHUNK_SIZE, text.length);
        let chunk = text.slice(start, end);

        // Try to break at sentence/paragraph boundary
        if (end < text.length) {
          const bp = Math.max(chunk.lastIndexOf('.'), chunk.lastIndexOf('\n'));
          if (bp > CHUNK_SIZE * 0.5) {
            chunk = chunk.slice(0, bp + 1);
          }
        }

        if (chunk.trim().length > 20) {
          chunks.push(chunk.trim());
        }

        // Advance cursor - NEVER stay at same position
        const nextStart = start + Math.max(chunk.length - CHUNK_OVERLAP, 1);
        if (nextStart <= start) break; // Safety guard
        start = nextStart;

        // Final segment guard
        if (end >= text.length) break;
      }

      console.log(`[Worker] ingest_document: ${chunks.length} chunks created`);

      if (chunks.length === 0) {
        await supabase.from('knowledge_documents').update({ status: 'error', error: 'Nenhum chunk gerado' }).eq('id', document_id);
        return { success: false, message: 'No chunks' };
      }

      // Get API key for embeddings
      let apiKey = null;
      const { data: aiConfig } = await supabase
        .from('ai_configs')
        .select('*, global_api_key:global_api_keys(*)')
        .eq('tenant_id', tenant_id)
        .eq('task_type', 'message_generation')
        .maybeSingle();
      if (aiConfig) apiKey = aiConfig.api_key_encrypted || aiConfig.global_api_key?.api_key_encrypted || null;
      if (!apiKey) {
        const { data: globalKey } = await supabase
          .from('global_api_keys')
          .select('api_key_encrypted')
          .eq('provider', 'openai')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (globalKey) apiKey = globalKey.api_key_encrypted;
      }
      if (!apiKey) apiKey = process.env.OPENAI_API_KEY || null;

      if (!apiKey) {
        await supabase.from('knowledge_documents').update({ status: 'error', error: 'API key não configurada para embeddings' }).eq('id', document_id);
        return { success: false, message: 'No API key' };
      }

      // Generate embeddings in batches of 3
      const BATCH_SIZE = 3;
      let inserted = 0;

      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        console.log(`[Worker] ingest_document: embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}`);

        const resp = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: batch, dimensions: 1536 }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error('[Worker] ingest_document: embedding error:', errText);
          await supabase.from('knowledge_documents').update({
            status: 'error',
            error: `Erro de embedding: HTTP ${resp.status}`,
          }).eq('id', document_id);
          throw new Error(`Embedding error: HTTP ${resp.status}`);
        }

        const result = await resp.json();
        const rows = batch.map((content, idx) => ({
          tenant_id,
          document_id,
          content,
          embedding: JSON.stringify(result.data[idx].embedding),
          chunk_index: i + idx,
          document_name: doc.name,
          metadata: { char_count: content.length, category: doc.category || null },
        }));

        const { error: insErr } = await supabase.from('knowledge_chunks').insert(rows);
        if (insErr) {
          console.error('[Worker] ingest_document: insert error:', insErr);
          await supabase.from('knowledge_documents').update({
            status: 'error',
            error: 'Erro ao salvar chunks: ' + insErr.message,
          }).eq('id', document_id);
          throw new Error('Insert error: ' + insErr.message);
        }
        inserted += batch.length;
      }

      // Mark as completed
      await supabase.from('knowledge_documents').update({
        status: 'completed',
        chunk_count: inserted,
      }).eq('id', document_id);

      console.log(`[Worker] ingest_document: DONE - ${inserted} chunks for ${document_id}`);
      return { success: true, document_id, chunks: inserted };

    } catch (err) {
      console.error(`[Worker] ingest_document: fatal error for ${document_id}:`, err.message);
      // Ensure status is error
      await supabase.from('knowledge_documents').update({
        status: 'error',
        error: err.message || 'Erro desconhecido no processamento',
      }).eq('id', document_id);
      throw err;
    }
  },

  async debounced_ai_reply(payload) {
    const { tenant_id, conversation_id, contact_id } = payload;

    // Fetch fresh conversation
    const { data: freshConv } = await supabase.from('conversations')
      .select('*').eq('id', conversation_id).maybeSingle();
    if (!freshConv) return { skipped: true, reason: 'conversation_not_found' };
    if (freshConv.assigned_to) return { skipped: true, reason: 'assigned_to_human' };
    if (freshConv.metadata?.ai_activated !== true) return { skipped: true, reason: 'ai_not_activated' };

    // Window still hot? Reschedule.
    const lastInboundAt = freshConv.metadata?.last_inbound_at;
    if (lastInboundAt) {
      const elapsed = Date.now() - new Date(lastInboundAt).getTime();
      if (elapsed < (AI_REPLY_DEBOUNCE_SECONDS - 1) * 1000) {
        const newRunAfter = new Date(new Date(lastInboundAt).getTime() + AI_REPLY_DEBOUNCE_SECONDS * 1000).toISOString();
        const newBucket = Math.floor(new Date(newRunAfter).getTime() / (AI_REPLY_DEBOUNCE_SECONDS * 1000));
        await supabase.rpc('enqueue_job', {
          _type: 'debounced_ai_reply',
          _payload: JSON.stringify({ tenant_id, conversation_id, contact_id }),
          _tenant_id: tenant_id,
          _run_after: newRunAfter,
          _idempotency_key: `debounced-ai-reply-${conversation_id}-${newBucket}`,
        });
        return { skipped: true, reason: 'debounce_rescheduled' };
      }
    }

    // Collect inbounds since last AI outbound
    const { data: msgs } = await supabase.from('messages')
      .select('id, content, direction, is_ai_generated, created_at')
      .eq('conversation_id', conversation_id).eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false }).limit(30);

    const collected = [];
    for (const m of (msgs || [])) {
      if (m.direction === 'outbound' && m.is_ai_generated) break;
      if (m.direction === 'inbound' && m.content?.trim()) collected.push(m.content.trim());
    }
    collected.reverse();
    const concatenated = collected.join('\n');

    // Fetch fresh contact
    const { data: freshContact } = await supabase.from('contacts')
      .select('*').eq('id', contact_id).maybeSingle();

    await handleAiAutoReply(tenant_id, freshConv, freshContact, concatenated);
    return { ai_processed: true, messages_grouped: collected.length };
  },
};

// Helpers
// normalizePhone: agora devolve apenas dígitos (sem '+') e aplica o nono dígito BR,
// alinhado a src/lib/phone.ts / supabase/functions/_shared/phone.ts / SQL normalize_brazil_phone.
// Retorna '' (não null) quando inválido — chamadores devem tratar string vazia.
function normalizePhone(phone) {
  const out = normalizeBrazilPhone(phone);
  return out || null;
}

async function findContact(tenantId, phone, email) {
  if (phone) {
    const { data } = await supabase.from('contacts').select('*')
      .eq('tenant_id', tenantId).eq('phone', phone).limit(1);
    if (data && data.length > 0) return data[0];
  }
  if (email) {
    const { data } = await supabase.from('contacts').select('*')
      .eq('tenant_id', tenantId).eq('email', email).limit(1);
    if (data && data.length > 0) return data[0];
  }
  return null;
}

// Lead intake unificado: Facebook Lead Ads (Make) + formulário genérico.
// Contrato flat: { name, phone, email?, source?, campaign?, lead_id?, extra? }
// Fallback: payload cru da Graph API do Facebook.
async function processLeadIntake({ tenant_id, event_id, source_default, raw }) {
  if (!tenant_id) throw new Error('processLeadIntake: tenant_id required');

  // Idempotência: se o evento já foi processado, skip.
  if (event_id) {
    const { data: ev } = await supabase
      .from('webhook_events')
      .select('processed')
      .eq('id', event_id)
      .maybeSingle();
    if (ev?.processed) {
      console.log(`[Lead] event ${event_id} já processado, skip`);
      return { skipped: true };
    }
  }

  try {
    // Parser flat com fallback para Graph API.
    const flat = (raw && (raw.name || raw.phone || raw.email || raw.lead_id))
      ? raw
      : (() => {
          const value = raw?.entry?.[0]?.changes?.[0]?.value || {};
          return {
            name: value.full_name || value.name || raw?.full_name || raw?.name,
            phone: value.phone_number || value.phone || raw?.phone_number,
            email: value.email || raw?.email,
            campaign: value.campaign_name || raw?.campaign_name,
            lead_id: value.leadgen_id || raw?.leadgen_id,
            extra: value,
          };
        })();

    const name = String(flat.name || raw?.nome || raw?.full_name || 'Lead sem nome').trim();
    const phoneRaw = flat.phone || raw?.telefone || raw?.whatsapp || null;
    const phone = normalizePhone(phoneRaw);
    const email = flat.email || null;
    const source = flat.source || source_default;
    const campaign = flat.campaign || flat.utm_campaign || raw?.utm_campaign || null;
    const extra = flat.extra && typeof flat.extra === 'object' ? flat.extra : {};

    if (!phone && !email) {
      throw new Error('Lead sem phone nem email — payload inválido');
    }

    // Find-or-create contato (não sobrescreve existente).
    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const ins = await supabase.from('contacts').insert({
        tenant_id,
        name,
        phone,
        email,
        source,
        status: 'lead',
        utm_source: source_default === 'facebook_lead_ads' ? 'facebook_lead_ads' : (raw?.utm_source || null),
        utm_medium: raw?.utm_medium || (source_default === 'facebook_lead_ads' ? 'paid' : null),
        utm_campaign: campaign,
        utm_content: raw?.utm_content || null,
        utm_term: raw?.utm_term || null,
      }).select('*').single();

      if (ins.error) {
        if (ins.error.code === '23505' && phone) {
          const { data: race } = await supabase.from('contacts').select('*')
            .eq('tenant_id', tenant_id).eq('phone', phone).single();
          contact = race;
        } else {
          throw new Error(`contact insert failed: ${ins.error.message}`);
        }
      } else {
        contact = ins.data;
      }
    }
    // contato existente: NÃO atualiza (preserva name, status, etc.)

    // Resolve pipeline: settings.lead_default_pipeline_id → is_default → primeiro por position.
    const { data: tenantRow } = await supabase
      .from('tenants').select('settings').eq('id', tenant_id).maybeSingle();
    const preferredPipelineId = tenantRow?.settings?.lead_default_pipeline_id || null;

    let pipeline = null;
    if (preferredPipelineId) {
      const { data } = await supabase.from('pipelines')
        .select('id').eq('tenant_id', tenant_id).eq('id', preferredPipelineId).maybeSingle();
      pipeline = data;
    }
    if (!pipeline) {
      const { data } = await supabase.from('pipelines')
        .select('id').eq('tenant_id', tenant_id).eq('is_default', true).maybeSingle();
      pipeline = data;
    }
    if (!pipeline) {
      const { data } = await supabase.from('pipelines')
        .select('id').eq('tenant_id', tenant_id).order('position').limit(1).maybeSingle();
      pipeline = data;
    }

    if (pipeline) {
      const { data: stage } = await supabase.from('stages')
        .select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).maybeSingle();

      if (stage) {
        // Dedup: se já há oportunidade aberta, só registra atividade.
        const { data: openOpp } = await supabase.from('opportunities')
          .select('id')
          .eq('tenant_id', tenant_id)
          .eq('contact_id', contact.id)
          .eq('status', 'open')
          .limit(1)
          .maybeSingle();

        const extrasSummary = Object.keys(extra).length
          ? `\nDados extras: ${JSON.stringify(extra)}`
          : '';

        if (openOpp) {
          await supabase.from('activities').insert({
            tenant_id,
            type: 'note',
            title: `Novo lead recebido (duplicado) — ${source}`,
            description: `Contato já possui oportunidade aberta. Campanha: ${campaign || 'n/d'}.${extrasSummary}`,
            contact_id: contact.id,
            opportunity_id: openOpp.id,
          });
        } else {
          await supabase.from('opportunities').insert({
            tenant_id,
            contact_id: contact.id,
            pipeline_id: pipeline.id,
            stage_id: stage.id,
            title: `Lead: ${name}`,
            source,
            custom_fields: { campaign, lead_id: flat.lead_id || null, extra },
          });
        }
      }
    }

    // Triggers downstream
    await executeAutomations(supabase, tenant_id, 'lead_created', {
      contact_id: contact.id, source,
    });
    await triggerLeadCreatedFlows(tenant_id, { ...contact, source });

    if (event_id) {
      await supabase.from('webhook_events')
        .update({ processed: true, processing_error: null })
        .eq('id', event_id);
    }

    return { contact_id: contact.id };
  } catch (err) {
    if (event_id) {
      await supabase.from('webhook_events')
        .update({ processing_error: String(err?.message || err) })
        .eq('id', event_id);
    }
    throw err;
  }
}


// Keyword Lead Creation
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForPhraseMatch(str) {
  return removeAccents(str.toLowerCase())
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enqueueFlowExecution(flow, { tenantId, contactId, conversationId, triggerData }) {
  await supabase.rpc('enqueue_job', {
    _type: 'execute_flow',
    _payload: JSON.stringify({
      flow_id: flow.id,
      tenant_id: tenantId,
      contact_id: contactId,
      conversation_id: conversationId,
      trigger_data: triggerData,
    }),
    _tenant_id: tenantId,
    _idempotency_key: `flow-${flow.id}-${conversationId || contactId}-${Date.now()}`,
  });
}

function keywordMatches(text, cfg) {
  const keywords = Array.isArray(cfg?.keywords) ? cfg.keywords : [];
  if (keywords.length === 0) return false;
  const mode = cfg?.match || 'contains';
  const cs = !!cfg?.case_sensitive;
  const haystack = cs ? text : normalizeForPhraseMatch(text);
  return keywords.some((kw) => {
    if (!kw) return false;
    const needle = cs ? String(kw) : normalizeForPhraseMatch(String(kw));
    if (!needle) return false;
    if (mode === 'equals') return haystack === needle;
    if (mode === 'starts_with') return haystack.startsWith(needle);
    return haystack.includes(needle);
  });
}

async function triggerMessageReceivedFlows(tenantId, contactId, conversationId, messageText) {
  const triggerData = { message: messageText, message_text: messageText, last_answer: messageText };

  // 1) message_received flows (any inbound message)
  const { data: msgFlows } = await supabase.from('chatbot_flows')
    .select('id, trigger_type, trigger_config')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('trigger_type', 'message_received');
  for (const flow of msgFlows || []) {
    await enqueueFlowExecution(flow, { tenantId, contactId, conversationId, triggerData });
  }

  // 2) keyword_automations (new unified table)
  const { data: kwRules } = await supabase.from('keyword_automations')
    .select('id, flow_id, keywords, match, case_sensitive')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);
  if (!kwRules || kwRules.length === 0) return;

  const flowIds = [...new Set(kwRules.map(r => r.flow_id))];
  const { data: kwFlows } = await supabase.from('chatbot_flows')
    .select('id, trigger_type, trigger_config')
    .in('id', flowIds)
    .eq('is_active', true);
  const flowMap = new Map((kwFlows || []).map(f => [f.id, f]));

  for (const rule of kwRules) {
    const flow = flowMap.get(rule.flow_id);
    if (!flow) continue;
    if (!keywordMatches(messageText || '', { keywords: rule.keywords, match: rule.match, case_sensitive: rule.case_sensitive })) continue;
    await enqueueFlowExecution(flow, { tenantId, contactId, conversationId, triggerData });
    await supabase.from('keyword_automations').update({ executions_count: (rule.executions_count || 0) + 1 }).eq('id', rule.id);
  }
}

async function triggerLeadCreatedFlows(tenantId, contact) {
  const { data: flows } = await supabase.from('chatbot_flows')
    .select('id, trigger_type, trigger_config')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('trigger_type', 'lead_created');

  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    const cfg = flow.trigger_config || {};
    if (cfg.source && contact?.source !== cfg.source) continue;
    if (cfg.require_phone && !contact?.phone) continue;
    await enqueueFlowExecution(flow, {
      tenantId,
      contactId: contact?.id,
      conversationId: null,
      triggerData: { contact_name: contact?.name, contact_phone: contact?.phone, source: contact?.source },
    });
  }
}

// ── Transcribe audio via Whisper edge function ──
async function transcribeAudio(tenantId, mediaUrl, messageId) {
  try {
    console.log('[Worker] Transcribing audio for message', messageId);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_url: mediaUrl,
        message_id: messageId,
        tenant_id: tenantId,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.transcription) {
      console.log('[Worker] Audio transcription failed or empty:', data.error || 'no transcription');
      return null;
    }

    console.log('[Worker] Audio transcription success:', data.transcription.substring(0, 100));
    return data.transcription;
  } catch (err) {
    console.error('[Worker] Audio transcription error:', err.message);
    return null; // Fail-safe — does not impact normal flow
  }
}

async function checkKeywordAndActivateAi(tenantId, contactId, conversationId, messageText) {
  // 1. Get tenant keywords
  const { data: tenant } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
  const keywords = tenant?.settings?.lead_keywords || [];
  if (keywords.length === 0) return false;

  // 2. Normalize and match
  const normalizedMessage = normalizeForPhraseMatch(messageText);
  const matchedKeyword = keywords.find(k => normalizedMessage.includes(normalizeForPhraseMatch(k)));
  if (!matchedKeyword) return false;

  console.log(`[Worker] Keyword match "${matchedKeyword}" for contact ${contactId} in conversation ${conversationId}`);

  // 3. Activate AI on conversation (set metadata.ai_activated = true)
  const { data: conv } = await supabase.from('conversations').select('metadata').eq('id', conversationId).single();
  const currentMetadata = conv?.metadata || {};
  await supabase.from('conversations').update({
    metadata: { ...currentMetadata, ai_activated: true, ai_activated_at: new Date().toISOString(), ai_activated_keyword: matchedKeyword }
  }).eq('id', conversationId);

  // 4. Ensure contact is a lead (convert if necessary)
  const { data: contact } = await supabase.from('contacts').select('id, name, status')
    .eq('id', contactId).eq('tenant_id', tenantId).single();

  if (contact && contact.status !== 'lead') {
    await supabase.from('contacts').update({ status: 'lead' }).eq('id', contactId);
    console.log(`[Worker] Contact ${contactId} converted to lead via keyword "${matchedKeyword}"`);
  }

  // 5. Create opportunity if none open
  const { data: existingOpps } = await supabase.from('opportunities')
    .select('id').eq('contact_id', contactId).eq('tenant_id', tenantId).eq('status', 'open').limit(1);

  if (existingOpps && existingOpps.length > 0) {
    console.log(`[Worker] Open opportunity already exists for contact ${contactId}, skipping`);
  } else {
    const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenantId).eq('is_default', true).single();
    if (pipeline) {
      const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
      if (stage) {
        const { data: existingByKey } = await supabase.from('opportunities')
          .select('id').eq('contact_id', contactId).eq('tenant_id', tenantId).eq('source', 'whatsapp_keyword').limit(1);
        if (!existingByKey || existingByKey.length === 0) {
          await supabase.from('opportunities').insert({
            tenant_id: tenantId, contact_id: contactId,
            pipeline_id: pipeline.id, stage_id: stage.id,
            title: `Lead: ${contact?.name || 'Sem nome'}`, source: 'whatsapp_keyword',
          });
        }
      }
    }

    // Create notification activity
    await supabase.from('activities').insert({
      tenant_id: tenantId, type: 'note',
      title: 'Lead acionado por palavra-chave',
      description: `Palavra-chave detectada: "${matchedKeyword}". IA ativada na conversa. Mensagem: "${messageText.substring(0, 200)}"`,
      contact_id: contactId, conversation_id: conversationId,
    });
    console.log(`[Worker] Created opportunity and activity for contact ${contactId} via keyword "${matchedKeyword}"`);

    // Notify agents (fire-and-forget)
    try {
      fetch(`${process.env.SUPABASE_URL}/functions/v1/notify-new-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ tenant_id: tenantId, contact_id: contactId, trigger: 'keyword' }),
      }).catch(err => console.error('[Worker] notify-new-lead keyword failed', err));
    } catch (err) { console.error('[Worker] notify-new-lead dispatch err', err); }
  }

  return true; // keyword matched and AI activated
}

// AI Functions
async function getAiConfig(tenantId, taskType) {
  const { data } = await supabase.from('ai_configs').select('*, global_api_key:global_api_keys(*)')
    .eq('tenant_id', tenantId).eq('task_type', taskType).limit(1);
  if (!data || data.length === 0) return null;
  const config = data[0];
  const now = new Date();
  const resetAt = config.usage_reset_at ? new Date(config.usage_reset_at) : null;
  if (resetAt && now.toDateString() !== resetAt.toDateString()) {
    await supabase.from('ai_configs').update({ daily_usage: 0, usage_reset_at: now.toISOString() }).eq('id', config.id);
    config.daily_usage = 0;
  }
  if (config.daily_usage >= (config.daily_limit || 100)) return null;
  if (config.monthly_usage >= (config.monthly_limit || 3000)) return null;
  return config;
}

async function callOpenAI(apiKey, model, messages) {
  const startTime = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI error: ${data.error?.message || response.status}`);
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokens: data.usage?.total_tokens || 0,
    duration: Date.now() - startTime,
  };
}

async function getConversationHistory(conversationId, limit = 20) {
  const { data } = await supabase.from('messages').select('direction, content, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(limit);
  return (data || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content || '',
  }));
}

async function getPromptTemplate(tenantId, taskType) {
  const { data } = await supabase.from('prompt_templates').select('*')
    .eq('tenant_id', tenantId).eq('task_type', taskType).eq('is_active', true)
    .order('version', { ascending: false }).limit(1);
  return data?.[0] || null;
}

async function incrementAiUsage(configId) {
  const { data: config } = await supabase.from('ai_configs').select('daily_usage, monthly_usage').eq('id', configId).single();
  if (config) {
    await supabase.from('ai_configs').update({
      daily_usage: (config.daily_usage || 0) + 1,
      monthly_usage: (config.monthly_usage || 0) + 1,
      usage_reset_at: new Date().toISOString(),
    }).eq('id', configId);
  }
}

async function logAiCall(tenantId, taskType, model, provider, tokens, duration, input, output, error) {
  await supabase.from('ai_logs').insert({
    tenant_id: tenantId, task_type: taskType, model, provider,
    tokens_used: tokens, duration_ms: duration,
    input_data: input, output_data: output, error,
  });
}

async function handleAiAutoReply(tenantId, conversation, contact, incomingMessage) {
  // Guard: only reply if AI is activated by keyword
  if (conversation.metadata?.ai_activated !== true) {
    console.log('[Worker] AI auto-reply skipped: conversation not activated by keyword');
    return;
  }
  if (contact.status !== 'lead') {
    console.log('[Worker] AI auto-reply skipped: contact status is', contact.status);
    return;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversation.id,
        tenant_id: tenantId,
        mode: 'auto_reply',
        incoming_message: incomingMessage,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`[Worker] ai-generate error (${response.status}):`, data.error);
      return;
    }

    if (!data.suggestion) {
      console.log('[Worker] ai-generate returned empty suggestion, skipping auto-reply');
      return;
    }

    // Send via WhatsApp
    await supabase.rpc('enqueue_job', {
      _type: 'send_whatsapp',
      _payload: JSON.stringify({
        tenant_id: tenantId,
        phone: contact.phone,
        message: data.suggestion,
        conversation_id: conversation.id,
      }),
      _tenant_id: tenantId,
    });

    // Save AI message to DB
    await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: 'outbound',
      content: data.suggestion,
      is_ai_generated: true,
    });

    // Run qualification check with history
    const history = await getConversationHistory(conversation.id);
    await checkQualification(tenantId, conversation, contact, history.concat([
      { role: 'user', content: incomingMessage },
      { role: 'assistant', content: data.suggestion },
    ]));
  } catch (err) {
    console.error('[Worker] handleAiAutoReply error:', err.message);
  }
}

async function checkQualification(tenantId, conversation, contact, history) {
  const inboundCount = history.filter(m => m.role === 'user').length;
  if (inboundCount < MIN_INBOUND_FOR_QUALIFICATION) {
    console.log(`[Worker] Qualification skipped: only ${inboundCount} inbound messages, waiting for ${MIN_INBOUND_FOR_QUALIFICATION}`);
    return;
  }

  const config = await getAiConfig(tenantId, 'qualification');
  if (!config) return;

  const apiKey = config.api_key_encrypted || config.global_api_key?.api_key_encrypted || process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const template = await getPromptTemplate(tenantId, 'qualification');
  const systemPrompt = template?.content || `Analise a conversa a seguir e determine se o lead está QUALIFICADO para falar com um atendente humano.
Um lead qualificado demonstra:
- Interesse real em comprar/contratar
- Fez perguntas sobre preço, disponibilidade ou como funciona
- Forneceu informações de contato ou demonstrou urgência

Responda APENAS com JSON: {"qualified": true/false, "reason": "motivo breve", "confidence": 0.0-1.0}`;

  try {
    const result = await callOpenAI(apiKey, config.model || 'gpt-4o-mini', [
      { role: 'system', content: systemPrompt },
      ...history,
    ]);

    await incrementAiUsage(config.id);

    let qualification;
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      qualification = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { qualification = null; }

    await logAiCall(tenantId, 'qualification', config.model, config.provider, result.tokens, result.duration, { history_length: history.length }, qualification, null);

    // Use tenant's configurable threshold instead of hardcoded 0.7
    const { data: tenantData } = await supabase.from('tenants').select('ai_confidence_threshold').eq('id', tenantId).single();
    const threshold = tenantData?.ai_confidence_threshold ?? 0.7;

    if (qualification?.qualified && qualification.confidence >= threshold) {
      console.log(`[Worker] Lead ${contact.id} qualificação registrada (confidence ${qualification.confidence} >= threshold ${threshold}) - aguardando revisão humana, IA continua ativa`);

      // Preserve existing metadata fields, only add/update qualification.
      // Do NOT change conversation.status — keep AI active.
      await supabase.from('conversations').update({
        metadata: { ...((conversation.metadata || {})), qualification: qualification },
      }).eq('id', conversation.id);

      const { data: opps } = await supabase.from('opportunities')
        .select('id').eq('contact_id', contact.id).eq('tenant_id', tenantId).eq('status', 'open').limit(1);
      if (opps && opps.length > 0) {
        await supabase.from('opportunities').update({ qualification_data: qualification }).eq('id', opps[0].id);
      }

      await supabase.from('activities').insert({
        tenant_id: tenantId,
        type: 'note',
        title: 'Lead qualificado pela IA',
        description: `Motivo: ${qualification.reason || 'Lead demonstrou interesse'}. Confiança: ${Math.round((qualification.confidence || 0) * 100)}%`,
        contact_id: contact.id,
        conversation_id: conversation.id,
      });

      // Create human review task with 10-minute due date
      const dueDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from('activities').insert({
        tenant_id: tenantId,
        type: 'task',
        title: 'Revisar lead qualificado pela IA',
        description: `IA marcou este lead como qualificado (confiança ${Math.round((qualification.confidence || 0) * 100)}%). Motivo: ${qualification.reason || 'Lead demonstrou interesse'}. Revise e decida o próximo passo.`,
        contact_id: contact.id,
        conversation_id: conversation.id,
        due_date: dueDate,
      });

      console.log(`[Worker] Qualificação registrada para contact ${contact.id} - task de revisão criada (vence em 10min). contact.status e conversation.status NÃO foram alterados, IA segue respondendo.`);
    }
  } catch (err) {
    console.error('[Worker] Qualification error:', err.message);
  }
}

// Poll loop
async function pollJobs() {
  try {
    const { data: job } = await supabase.rpc('acquire_next_job', {
      _types: Object.keys(handlers),
    });

    if (!job || !job.id) return;

    console.log(`[Worker] Processing job ${job.id} type=${job.type} attempt=${job.attempts}`);

    const handler = handlers[job.type];
    if (!handler) {
      await supabase.rpc('fail_job', { _job_id: job.id, _error: `Unknown job type: ${job.type}` });
      return;
    }

    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      const result = await handler(payload);
      await supabase.rpc('complete_job', { _job_id: job.id, _result: JSON.stringify(result) });
      console.log(`[Worker] Job ${job.id} completed`);
    } catch (err) {
      console.error(`[Worker] Job ${job.id} failed:`, err.message);
      await supabase.rpc('fail_job', { _job_id: job.id, _error: err.message });
    }
  } catch (err) {
    console.error('[Worker] Poll error:', err.message);
  }
}

// Listen for NOTIFY and poll
async function start() {
  console.log('[Worker] Starting job worker...');
  setInterval(pollJobs, POLL_INTERVAL);
  pollJobs();
}

start();
