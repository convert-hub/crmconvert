// CRM Worker - Node.js Docker service
// Consumes jobs from Postgres queue with retry and idempotency
// Run via: docker-compose up worker

const { createClient } = require('@supabase/supabase-js');
const { executeAutomations } = require('./automation-handler');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL = process.env.POLL_INTERVAL || 2000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Job handlers registry
const handlers = {
  async process_form_webhook(payload) {
    const { tenant_id, data } = payload;
    const phone = normalizePhone(data.phone || data.telefone || data.whatsapp);
    const email = data.email || null;
    const name = data.name || data.nome || data.full_name || 'Lead sem nome';

    const utm = {
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      utm_content: data.utm_content || null,
      utm_term: data.utm_term || null,
    };

    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, email, source: 'form_webhook',
        status: 'lead', ...utm,
      }).select().single();
      contact = c;
    } else {
      await supabase.from('contacts').update({ ...utm, source: 'form_webhook' }).eq('id', contact.id);
    }

    const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant_id).eq('is_default', true).single();
    if (pipeline) {
      const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
      if (stage) {
        await supabase.from('opportunities').insert({
          tenant_id, contact_id: contact.id, pipeline_id: pipeline.id, stage_id: stage.id,
          title: `Lead: ${name}`, source: 'form_webhook', ...utm,
        });
      }
    }

    await supabase.from('activities').insert({
      tenant_id, type: 'note', title: 'Lead via formulário',
      description: `Novo lead recebido via webhook de formulário.`,
      contact_id: contact.id,
    });

    // Trigger automations
    await executeAutomations(supabase, tenant_id, 'lead_created', {
      contact_id: contact.id, source: 'form_webhook',
    });

    return { contact_id: contact.id };
  },

  async process_meta_lead(payload) {
    const { tenant_id, data } = payload;
    const entry = data.entry?.[0];
    const changes = entry?.changes?.[0];
    const leadData = changes?.value || data;

    const name = leadData.full_name || leadData.name || 'Lead Facebook';
    const phone = normalizePhone(leadData.phone_number || leadData.phone);
    const email = leadData.email || null;

    const utm = {
      utm_source: leadData.utm_source || 'facebook_lead_ads',
      utm_medium: leadData.utm_medium || 'paid',
      utm_campaign: leadData.campaign_name || leadData.utm_campaign || null,
      campaign_id: leadData.campaign_id || null,
      adset_id: leadData.adset_id || null,
      ad_id: leadData.ad_id || null,
    };

    let contact = await findContact(tenant_id, phone, email);
    if (!contact) {
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, email, source: 'facebook_lead_ads',
        status: 'lead', ...utm,
      }).select().single();
      contact = c;
    }

    const { data: pipeline } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant_id).eq('is_default', true).single();
    if (pipeline) {
      const { data: stage } = await supabase.from('stages').select('id').eq('pipeline_id', pipeline.id).order('position').limit(1).single();
      if (stage) {
        await supabase.from('opportunities').insert({
          tenant_id, contact_id: contact.id, pipeline_id: pipeline.id, stage_id: stage.id,
          title: `Lead FB: ${name}`, source: 'facebook_lead_ads',
        });
      }
    }

    // Trigger automations
    await executeAutomations(supabase, tenant_id, 'lead_created', {
      contact_id: contact.id, source: 'facebook_lead_ads',
    });

    return { contact_id: contact.id };
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

      // 3. THIRD: Auto-reply only if AI activated AND no human agent assigned
      if (freshConv && !freshConv.assigned_to && freshConv.metadata?.ai_activated === true) {
        try {
          // For audio: mark BEFORE sending to guarantee atomicity via optimistic lock
          // Better to miss a reply than to send duplicates
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

          await handleAiAutoReply(tenant_id, freshConv, freshContact || contact, effectiveText);
        } catch (err) {
          console.error('[Worker] AI auto-reply error:', err.message);
          // If send failed but already marked, unmark to allow retry
          if (targetMsg && isAudio && message_id) {
            const currentMeta = targetMsg.provider_metadata || {};
            delete currentMeta.audio_reply_sent;
            delete currentMeta.audio_reply_sent_at;
            await supabase.from('messages').update({
              provider_metadata: currentMeta,
            }).eq('id', message_id);
          }
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
      const { data: c } = await supabase.from('contacts').insert({
        tenant_id, name, phone, source: 'whatsapp', status: 'lead',
      }).select().single();
      contact = c;
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

    // 3. THIRD: Auto-reply only if AI activated AND no human agent assigned
    if (!fromMe && effectiveText && !conversation.assigned_to && conversation.metadata?.ai_activated === true) {
      try {
        await handleAiAutoReply(tenant_id, conversation, contact, effectiveText);
      } catch (err) {
        console.error('[Worker] AI auto-reply error:', err.message);
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
    const { tenant_id, phone, message, conversation_id } = payload;

    const { data: instance } = await supabase.from('whatsapp_instances')
      .select('*').eq('tenant_id', tenant_id).eq('is_active', true).limit(1).single();

    if (!instance) {
      throw new Error('No active WhatsApp instance for tenant');
    }

    const instToken = instance.api_token_encrypted || '';
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

    if (!cleanPhone) {
      throw new Error('No phone number provided');
    }

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
  async run_automations(payload) {
    const { tenant_id, trigger_type, context } = payload;
    if (!tenant_id || !trigger_type) throw new Error('Missing tenant_id or trigger_type');
    await executeAutomations(supabase, tenant_id, trigger_type, context || {});
    return { trigger_type, executed: true };
  },

  async execute_flow(payload) {
    const { flow_id, tenant_id, contact_id, conversation_id, trigger_data } = payload;
    if (!flow_id || !tenant_id) throw new Error('Missing flow_id or tenant_id');

    const { data: flow } = await supabase.from('chatbot_flows').select('*').eq('id', flow_id).eq('is_active', true).single();
    if (!flow) return { skipped: true, reason: 'flow not found or inactive' };

    // Create execution record
    const { data: execution } = await supabase.from('flow_executions').insert({
      flow_id, tenant_id, contact_id: contact_id || null, conversation_id: conversation_id || null,
      status: 'running', context: { trigger_data: trigger_data || {} },
    }).select().single();

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

      // Find trigger node
      const triggerNode = nodes.find(n => n.type === 'trigger');
      if (!triggerNode) throw new Error('No trigger node found');

      // BFS execution
      const queue = [triggerNode.id];
      const visited = new Set();
      const ctx = { contact_id, conversation_id, tenant_id, variables: { ...(trigger_data || {}) } };
      let stepCount = 0;
      const MAX_STEPS = 50;

      while (queue.length > 0 && stepCount < MAX_STEPS) {
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
          // Send message via WhatsApp
          const content = (node.data?.content || '').replace(/\{\{(\w+)\}\}/g, (_, key) => ctx.variables[key] || '');
          if (content && ctx.conversation_id) {
            await supabase.from('messages').insert({
              tenant_id, conversation_id: ctx.conversation_id, direction: 'outbound',
              content, is_ai_generated: false,
            });
            // Send via WhatsApp
            if (ctx.contact_id) {
              const { data: contact } = await supabase.from('contacts').select('phone').eq('id', ctx.contact_id).single();
              if (contact?.phone) {
                await supabase.rpc('enqueue_job', {
                  _type: 'send_whatsapp',
                  _payload: JSON.stringify({ tenant_id, phone: contact.phone, message: content, conversation_id: ctx.conversation_id }),
                  _tenant_id: tenant_id,
                });
              }
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
          const field = node.data?.field || 'message';
          const operator = node.data?.operator || 'contains';
          const value = node.data?.value || '';
          let testValue = ctx.variables[field] || ctx.variables.message || '';

          // Normalize both values: lowercase, remove accents, trim whitespace
          const normalize = (s) => removeAccents(s.toLowerCase().trim().replace(/\s+/g, ' '));
          const normTest = normalize(testValue);
          const normValue = normalize(value);

          let result = false;
          switch (operator) {
            case 'contains': result = normTest.includes(normValue); break;
            case 'equals': result = normTest === normValue; break;
            case 'starts_with': result = normTest.startsWith(normValue); break;
            case 'not_contains': result = !normTest.includes(normValue); break;
          }

          // Route to yes or no handle
          const yesTargets = adjacency[`${nodeId}:yes`] || adjacency[nodeId] || [];
          const noTargets = adjacency[`${nodeId}:no`] || [];
          if (result) yesTargets.forEach(n => queue.push(n));
          else noTargets.forEach(n => queue.push(n));
        } else if (node.type === 'action') {
          const actionType = node.data?.actionType || '';
          const config = node.data?.config || {};
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
                  await supabase.rpc('enqueue_job', {
                    _type: 'send_whatsapp',
                    _payload: JSON.stringify({ tenant_id, phone: contact.phone, message: config.message, conversation_id: ctx.conversation_id }),
                    _tenant_id: tenant_id,
                  });
                }
              }
              break;
            case 'create_opportunity': {
              if (!ctx.contact_id) break;
              const { data: existingOpp } = await supabase.from('opportunities')
                .select('id')
                .eq('tenant_id', tenant_id)
                .eq('contact_id', ctx.contact_id)
                .eq('status', 'open')
                .limit(1);
              if (existingOpp && existingOpp.length > 0) break;

              const { data: pipeline } = await supabase.from('pipelines')
                .select('id')
                .eq('tenant_id', tenant_id)
                .eq('is_default', true)
                .single();
              if (!pipeline) break;

              const { data: stage } = await supabase.from('stages')
                .select('id')
                .eq('pipeline_id', pipeline.id)
                .order('position')
                .limit(1)
                .single();
              if (!stage) break;

              const { data: contact } = await supabase.from('contacts')
                .select('name')
                .eq('id', ctx.contact_id)
                .single();

              await supabase.from('opportunities').insert({
                tenant_id,
                contact_id: ctx.contact_id,
                pipeline_id: pipeline.id,
                stage_id: stage.id,
                title: `Lead: ${contact?.name || 'Contato'}`,
                source: 'flow_builder',
              });
              break;
            }
            case 'close_conversation':
              if (ctx.conversation_id) {
                await supabase.from('conversations').update({ status: 'closed' }).eq('id', ctx.conversation_id);
              }
              break;
            case 'assign_agent':
              if (ctx.conversation_id) {
                const { data: workload } = await supabase.rpc('get_member_workload', { p_tenant_id: tenant_id });
                if (workload && workload.length > 0) {
                  await supabase.from('conversations').update({ assigned_to: workload[0].membership_id }).eq('id', ctx.conversation_id);
                }
              }
              break;
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
        } else if (node.type === 'question') {
          // Question node: the response is expected in ctx.variables.message (the user's reply)
          // Save the answer to the configured contact field
          const saveField = node.data?.saveField || '';
          const answer = ctx.variables.message || ctx.variables.last_answer || '';
          if (ctx.contact_id && saveField && answer) {
            if (saveField === 'custom') {
              const customKey = node.data?.customFieldKey || '';
              if (customKey) {
                const { data: c } = await supabase.from('contacts').select('custom_fields').eq('id', ctx.contact_id).single();
                const customFields = { ...(c?.custom_fields || {}), [customKey]: answer };
                await supabase.from('contacts').update({ custom_fields: customFields }).eq('id', ctx.contact_id);
                console.log(`[Worker] Flow: saved custom field "${customKey}" = "${answer}"`);
              }
            } else {
              const updateData = { [saveField]: answer };
              await supabase.from('contacts').update(updateData).eq('id', ctx.contact_id);
              console.log(`[Worker] Flow: saved "${saveField}" = "${answer}"`);
            }
          }
          const next = adjacency[nodeId] || [];
          next.forEach(n => queue.push(n));
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
        }
      }

      await supabase.from('flow_executions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', execution.id);
      return { execution_id: execution.id, steps: stepCount };
    } catch (err) {
      await supabase.from('flow_executions').update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() }).eq('id', execution.id);
      throw err;
    }
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
};

// Helpers
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
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

// Keyword Lead Creation
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function triggerMessageReceivedFlows(tenantId, contactId, conversationId, messageText) {
  const { data: flows } = await supabase.from('chatbot_flows')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('trigger_type', 'message_received');

  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    await supabase.rpc('enqueue_job', {
      _type: 'execute_flow',
      _payload: JSON.stringify({
        flow_id: flow.id,
        tenant_id: tenantId,
        contact_id: contactId,
        conversation_id: conversationId,
        trigger_data: {
          message: messageText,
          message_text: messageText,
          last_answer: messageText,
        },
      }),
      _tenant_id: tenantId,
      _idempotency_key: `flow-${flow.id}-${conversationId}-${Date.now()}`,
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
  const normalizedMessage = removeAccents(messageText.toLowerCase());
  const matchedKeyword = keywords.find(k => normalizedMessage.includes(removeAccents(k.toLowerCase())));
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
      console.log(`[Worker] Lead ${contact.id} QUALIFIED (confidence ${qualification.confidence} >= threshold ${threshold}) - handing off to human`);

      await supabase.from('contacts').update({ status: 'customer' }).eq('id', contact.id);

      await supabase.from('conversations').update({
        status: 'waiting_agent',
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
