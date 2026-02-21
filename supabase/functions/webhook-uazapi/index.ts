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
      const instanceName = body.instance?.name || body.instanceName || body.owner;
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

    // Detect event type from UAZAPI v2 payload
    const eventType = detectEventType(body);
    console.log(`webhook-uazapi tenant=${tenantId} event=${eventType}`);

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
        console.log('webhook-uazapi: unhandled event type, body keys:', Object.keys(body));
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
  // Status update events (messages_update): have Type field like "Read", "Delivered", "Sent"
  if (body.Type && ['Read', 'Delivered', 'Sent', 'Played'].includes(body.Type)) {
    return 'status_update';
  }

  // Connection events
  if (body.Type === 'Connected' || body.Type === 'Disconnected' || body.Type === 'LoggedOut') {
    return 'connection';
  }

  // Incoming message: has text/messageType/messageid fields (UAZAPI v2 flat format)
  if (body.messageid || body.messageType || (body.text !== undefined && body.chatid)) {
    return 'message';
  }

  // Baileys-style fallback: has key.remoteJid
  if (body.key?.remoteJid) {
    return 'message';
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
  // UAZAPI v2 flat message format
  const chatid = body.chatid || body.key?.remoteJid || '';
  const isGroup = chatid.endsWith('@g.us') || body.isGroup === true;
  
  // Skip group messages
  if (isGroup) {
    console.log('webhook-uazapi: skipping group message');
    return;
  }

  const fromMe = body.fromMe === true || body.key?.fromMe === true;
  const text = body.text || body.message?.conversation || body.message?.extendedTextMessage?.text || body.content?.text || '';
  const senderName = body.senderName || body.pushName || body.notifyName || '';
  const messageId = body.messageid || body.id || body.key?.id || '';
  const sender = body.sender || body.chatid || body.key?.remoteJid || '';
  const mediaType = body.messageType || body.media_type || null;
  const mediaUrl = body.media_url || body.mediaUrl || null;

  // Extract phone from sender/chatid
  const phone = normalizePhone(sender);
  
  if (!phone) {
    console.log('webhook-uazapi: no phone extracted from message');
    return;
  }

  // Skip messages without content (reactions, presence, etc.)
  if (!text && !mediaUrl && !['image', 'video', 'audio', 'document', 'sticker'].some(t => mediaType?.toLowerCase().includes(t))) {
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
    const name = senderName || phone;
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
  }
  await supabase.from('conversations').update(updates).eq('id', conversation.id);

  console.log(`webhook-uazapi: saved ${fromMe ? 'outbound' : 'inbound'} message for conversation ${conversation.id}`);

  // Enqueue AI processing for inbound messages (worker handles AI auto-reply)
  if (!fromMe) {
    try {
      await supabase.rpc('enqueue_job', {
        _type: 'process_uazapi_message',
        _payload: JSON.stringify({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          contact_id: contact.id,
          message_text: text,
          already_saved: true, // Flag so worker knows message is already in DB
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
  // UAZAPI v2 status update format:
  // { Type: "Read"|"Delivered"|"Sent", MessageIDs: [...], Chat: "...@s.whatsapp.net", ... }
  const statusType = body.Type; // "Read", "Delivered", "Sent"
  const messageIds = body.MessageIDs || [];
  const chat = body.Chat || body.chatid || '';

  if (!messageIds.length) {
    console.log('webhook-uazapi: status update without MessageIDs');
    return;
  }

  console.log(`webhook-uazapi: status ${statusType} for ${messageIds.length} message(s) in ${chat}`);

  // Update provider_metadata for matching messages
  for (const msgId of messageIds) {
    const { data: msgs } = await supabase.from('messages')
      .select('id, provider_metadata')
      .eq('provider_message_id', msgId)
      .limit(1);

    if (msgs && msgs.length > 0) {
      const msg = msgs[0];
      const metadata = msg.provider_metadata || {};
      metadata.status = statusType.toLowerCase();
      metadata.status_updated_at = new Date().toISOString();

      // We can't update messages table (no UPDATE RLS), so we use service role which bypasses RLS
      await supabase.from('messages')
        .update({ provider_metadata: metadata })
        .eq('id', msg.id);
      
      console.log(`webhook-uazapi: updated message ${msg.id} status to ${statusType}`);
    }
  }
}

async function handleConnectionEvent(supabase: any, tenantId: string, body: any) {
  const status = body.Type; // "Connected", "Disconnected", "LoggedOut"
  console.log(`webhook-uazapi: connection event ${status} for tenant ${tenantId}`);

  // Update instance status
  if (status === 'Connected') {
    const phone = body.phone || body.owner || '';
    await supabase.from('whatsapp_instances')
      .update({ phone_number: phone ? normalizePhone(phone) : undefined })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
  } else if (status === 'LoggedOut') {
    await supabase.from('whatsapp_instances')
      .update({ is_active: false })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
  }
}
