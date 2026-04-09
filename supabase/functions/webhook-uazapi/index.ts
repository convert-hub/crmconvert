import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();

    // Get tenant_id from query param > header > body > instance lookup
    const url = new URL(req.url);
    let tenantId = url.searchParams.get('tenant_id')
      || req.headers.get('x-tenant-id')
      || body.tenant_id;

    if (!tenantId) {
      const instanceName = body.instanceName || body.instance?.name || body.owner;
      if (instanceName) {
        const { data: inst } = await supabase.from('whatsapp_instances')
          .select('tenant_id')
          .eq('instance_name', instanceName)
          .eq('is_active', true)
          .limit(1)
          .single();
        if (inst) tenantId = inst.tenant_id;
      }
    }

    if (!tenantId) {
      console.error('webhook-uazapi: no tenant_id found. Body keys:', Object.keys(body));
      return jsonOk({ error: 'tenant_id required' });
    }

    // Save raw webhook event (fire and forget)
    supabase.from('webhook_events').insert({
      tenant_id: tenantId, source: 'uazapi', raw_payload: body,
    }).then(() => {});

    // UAZAPI v2 uses body.EventType for routing
    const eventType = detectEventType(body);
    console.log(`webhook-uazapi tenant=${tenantId} event=${eventType} EventType=${body.EventType || 'none'}`);

    switch (eventType) {
      case 'message':
        await handleIncomingMessage(supabase, tenantId, body);
        break;
      case 'status_update':
        await handleStatusUpdate(supabase, tenantId, body);
        break;
      case 'connection':
        await handleConnectionEvent(supabase, tenantId, body);
        break;
      default:
        console.log('webhook-uazapi: unhandled event type, EventType:', body.EventType, 'body keys:', Object.keys(body));
    }

    return jsonOk({ ok: true });
  } catch (error) {
    console.error('webhook-uazapi error:', error);
    return jsonOk({ error: error.message });
  }
});

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function detectEventType(body: any): string {
  // UAZAPI v2 sends EventType at top level
  const eventType = body.EventType;

  if (eventType === 'messages') {
    return 'message';
  }

  if (eventType === 'messages_update') {
    return 'status_update';
  }

  if (eventType === 'connection') {
    return 'connection';
  }

  // Fallback: check for nested message data (legacy/alternative formats)
  if (body.message && (body.message.chatid || body.message.messageid || body.message.text !== undefined)) {
    return 'message';
  }

  // Fallback: check for event with Type field (status updates)
  if (body.event && body.event.Type && ['Read', 'Delivered', 'Sent', 'Played'].includes(body.event.Type)) {
    return 'status_update';
  }

  // Fallback: check instance status in body
  if (body.instance && body.instance.status) {
    return 'connection';
  }

  return 'unknown';
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '').replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function handleIncomingMessage(supabase: any, tenantId: string, body: any) {
  // UAZAPI v2: message data is nested inside body.message
  const msg = body.message || body;
  
  const chatid = msg.chatid || msg.key?.remoteJid || '';
  const isGroup = chatid.endsWith('@g.us') || msg.isGroup === true;
  
  // Skip group messages
  if (isGroup) {
    console.log('webhook-uazapi: skipping group message');
    return;
  }

  const fromMe = msg.fromMe === true || msg.key?.fromMe === true;
  const text = msg.text || msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  const senderName = msg.senderName || msg.pushName || msg.notifyName || '';
  const messageId = msg.messageid || msg.id || msg.key?.id || '';
  const mediaType = msg.messageType || msg.media_type || null;
  // UAZAPI v2: media URL is in msg.content.URL (encrypted WhatsApp CDN), or msg.content.directPath
  const mediaUrl = msg.content?.URL || msg.media_url || msg.mediaUrl || msg.fileURL || null;
  const mediaMimetype = msg.content?.mimetype || null;

  // UAZAPI v2 uses LIDs (e.g. 96293317787655@lid) in `sender` field.
  // The real phone number is in `sender_pn` (e.g. 553193089817@s.whatsapp.net) or `chatid`.
  // For outbound (fromMe), the contact is always `chatid`.
  // For inbound, prefer `sender_pn` > `chatid` > `sender` to avoid LIDs.
  let contactIdentifier: string;
  if (fromMe) {
    contactIdentifier = chatid;
  } else {
    const senderPn = msg.sender_pn || '';
    // Avoid LIDs - they end with @lid and are not phone numbers
    const senderField = msg.sender || '';
    const isSenderLid = senderField.endsWith('@lid') || (!senderField.includes('@s.whatsapp.net') && senderField.length > 15);
    contactIdentifier = senderPn || (isSenderLid ? chatid : senderField) || chatid;
  }
  const phone = normalizePhone(contactIdentifier);
  
  if (!phone) {
    console.log('webhook-uazapi: no phone extracted from message');
    return;
  }

  // Skip messages sent by API (we already saved those)
  if (msg.wasSentByApi === true) {
    console.log('webhook-uazapi: skipping wasSentByApi message');
    return;
  }

  // Skip messages without content (reactions, presence, etc.)
  if (!text && !mediaUrl && !['image', 'video', 'audio', 'document', 'sticker'].some(t => mediaType?.toLowerCase?.()?.includes(t))) {
    console.log(`webhook-uazapi: skipping message without text content, type=${mediaType}`);
    return;
  }

  // Find or create contact
  const { data: existingContacts } = await supabase.from('contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .limit(1);
  
  let contact = existingContacts?.[0];
  if (!contact) {
    // For outbound (fromMe) messages, senderName is the agent's name, not the contact's.
    // Use phone as fallback name for outbound; use senderName only for inbound.
    const name = fromMe ? phone : (senderName || phone);
    const { data: newContact } = await supabase.from('contacts').insert({
      tenant_id: tenantId, name, phone, source: 'whatsapp', status: 'lead',
    }).select().single();
    contact = newContact;
    console.log(`webhook-uazapi: created contact ${contact?.id} for ${phone}`);
  }

  if (!contact) {
    console.error('webhook-uazapi: failed to find/create contact');
    return;
  }

  // Find or create conversation
  const { data: existingConvs } = await supabase.from('conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contact.id)
    .eq('channel', 'whatsapp')
    .in('status', ['open', 'waiting_customer', 'waiting_agent'])
    .limit(1);

  let conversation = existingConvs?.[0];
  if (!conversation) {
    const { data: newConv } = await supabase.from('conversations').insert({
      tenant_id: tenantId,
      contact_id: contact.id,
      channel: 'whatsapp',
      status: 'open',
      provider_chat_id: chatid,
      last_message_at: new Date().toISOString(),
    }).select().single();
    conversation = newConv;
    console.log(`webhook-uazapi: created conversation ${conversation?.id}`);
  }

  if (!conversation) {
    console.error('webhook-uazapi: failed to find/create conversation');
    return;
  }

  // Check for duplicate message
  if (messageId) {
    const { data: existing } = await supabase.from('messages')
      .select('id')
      .eq('provider_message_id', messageId)
      .eq('conversation_id', conversation.id)
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`webhook-uazapi: duplicate message ${messageId}, skipping`);
      return;
    }
  }

  // Save message
  const { error: msgError } = await supabase.from('messages').insert({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    direction: fromMe ? 'outbound' : 'inbound',
    content: text || `[${mediaType || 'mídia'}]`,
    provider_message_id: messageId,
    media_type: mediaType,
    media_url: mediaUrl,
    provider_metadata: body,
  });

  if (msgError) {
    console.error('webhook-uazapi: failed to save message:', msgError);
    return;
  }

  // Update conversation timestamps
  const updates: any = {
    last_message_at: new Date().toISOString(),
    provider_chat_id: chatid || conversation.provider_chat_id,
  };
  if (!fromMe) {
    updates.last_customer_message_at = new Date().toISOString();
    updates.unread_count = (conversation.unread_count || 0) + 1;
    updates.status = 'waiting_agent';
  } else {
    updates.last_agent_message_at = new Date().toISOString();
    updates.unread_count = 0;
    updates.status = 'waiting_customer';
  }
  await supabase.from('conversations').update(updates).eq('id', conversation.id);

  console.log(`webhook-uazapi: saved ${fromMe ? 'outbound' : 'inbound'} message for conversation ${conversation.id}`);

  // Reset inactivity and bring open opportunities to top on message activity
  try {
    await supabase.from('opportunities')
      .update({ updated_at: new Date().toISOString(), position: 0 })
      .eq('contact_id', contact.id)
      .eq('tenant_id', tenantId)
      .eq('status', 'open');
    console.log(`webhook-uazapi: reset inactivity and bumped opportunities for contact ${contact.id}`);
  } catch (e) {
    console.error('webhook-uazapi: failed to reset opportunity inactivity:', e);
  }

  // Fetch profile picture asynchronously (fire and forget) to avoid delaying webhook response
  if (!fromMe && !contact.avatar_url) {
    (async () => {
      try {
        const { data: inst } = await supabase.from('whatsapp_instances')
          .select('api_url, api_token_encrypted')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (inst) {
          const ab = inst.api_url.replace(/\/+$/, '');
          const cleanPh = phone.replace(/\D/g, '');
          const detailsRes = await fetch(`${ab}/chat/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': inst.api_token_encrypted || '' },
            body: JSON.stringify({ number: cleanPh, preview: false }),
          });
          if (detailsRes.ok) {
            const details = await detailsRes.json();
            const avatarUrl = details.imagePreview || details.image || details.profilePicture || details.wa_profilePicture || details.picture || null;
            if (avatarUrl) {
              await supabase.from('contacts').update({ avatar_url: avatarUrl }).eq('id', contact.id);
            }
          }
        }
      } catch (e) {
        console.log('webhook-uazapi: avatar fetch error (non-critical):', e);
      }
    })();
  }

  // Enqueue AI processing for inbound messages (worker handles keyword lead creation + AI reply)
  if (!fromMe) {
    try {
      await supabase.rpc('enqueue_job', {
        _type: 'process_uazapi_message',
        _payload: JSON.stringify({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          contact_id: contact.id,
          message_text: text,
          already_saved: true,
        }),
        _tenant_id: tenantId,
        _idempotency_key: `uazapi-ai-${messageId || conversation.id}-${Date.now()}`,
      });
    } catch (e) {
      console.error('webhook-uazapi: failed to enqueue AI job:', e);
    }
  }
}

async function handleStatusUpdate(supabase: any, tenantId: string, body: any) {
  // UAZAPI v2: status data is nested inside body.event
  const event = body.event || body;
  
  const statusType = event.Type || body.state; // "Read", "Delivered", "Sent", "FileDownloaded"
  const messageIds = event.MessageIDs || [];
  const chat = event.Chat || event.chatid || '';

  if (!messageIds.length) {
    console.log('webhook-uazapi: status update without MessageIDs');
    return;
  }

  console.log(`webhook-uazapi: status ${statusType} for ${messageIds.length} message(s) in ${chat}`);

  // Update provider_metadata for matching messages
  for (const msgId of messageIds) {
    const { data: msgs } = await supabase.from('messages')
      .select('id, provider_metadata, media_type, conversation_id, content, direction')
      .eq('provider_message_id', msgId)
      .limit(1);

    if (msgs && msgs.length > 0) {
      const msg = msgs[0];
      const metadata = msg.provider_metadata || {};
      metadata.status = statusType.toLowerCase();
      metadata.status_updated_at = new Date().toISOString();

      await supabase.from('messages')
        .update({ provider_metadata: metadata })
        .eq('id', msg.id);
      
      console.log(`webhook-uazapi: updated message ${msg.id} status to ${statusType}`);

      // Re-enqueue AI processing for audio messages when FileDownloaded arrives
      // This handles the case where audio wasn't ready for transcription on first attempt
      if (statusType === 'FileDownloaded' && msg.direction === 'inbound' &&
          msg.media_type && msg.media_type.toLowerCase().includes('audio') &&
          !metadata.audio_transcription) {
        try {
          // Find conversation to get contact_id
          const { data: conv } = await supabase.from('conversations')
            .select('contact_id')
            .eq('id', msg.conversation_id)
            .single();

          if (conv?.contact_id) {
            console.log(`webhook-uazapi: re-enqueuing audio transcription for message ${msg.id}`);
            await supabase.rpc('enqueue_job', {
              _type: 'process_uazapi_message',
              _payload: JSON.stringify({
                tenant_id: tenantId,
                conversation_id: msg.conversation_id,
                contact_id: conv.contact_id,
                message_text: '',
                already_saved: true,
              }),
              _tenant_id: tenantId,
              _idempotency_key: `uazapi-audio-retry-${msgId}-${Date.now()}`,
            });
          }
        } catch (e) {
          console.error('webhook-uazapi: failed to re-enqueue audio transcription:', e);
        }
      }
    }
  }
}

async function handleConnectionEvent(supabase: any, tenantId: string, body: any) {
  // UAZAPI v2: instance data nested in body.instance
  const instance = body.instance || {};
  const status = instance.status || body.type || body.Type; // "connected", "disconnected", etc.
  
  console.log(`webhook-uazapi: connection event status=${status} for tenant ${tenantId}`);

  if (status === 'connected') {
    const phone = instance.owner || body.owner || '';
    const updateData: any = {};
    if (phone) updateData.phone_number = normalizePhone(phone);
    
    if (Object.keys(updateData).length > 0) {
      await supabase.from('whatsapp_instances')
        .update(updateData)
        .eq('tenant_id', tenantId)
        .eq('is_active', true);
    }
  } else if (status === 'disconnected' && (body.type === 'LoggedOut' || instance.lastDisconnectReason?.includes('logged out'))) {
    // Only deactivate on explicit logout, not temporary disconnects
    await supabase.from('whatsapp_instances')
      .update({ is_active: false })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    console.log(`webhook-uazapi: instance deactivated due to logout for tenant ${tenantId}`);
  }
}

