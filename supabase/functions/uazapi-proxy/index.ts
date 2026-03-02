import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const userId = claimsData.claims.sub;

    const body = await req.json();
    const { action, tenant_id, instance_name } = body;

    const { data: membership } = await supabaseAdmin.from('tenant_memberships')
      .select('id, role, tenant_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    const effectiveTenantId = tenant_id || membership?.tenant_id;
    if (!effectiveTenantId) {
      return jsonResponse({ error: 'No tenant found' }, 400);
    }

    // Get UAZAPI global key (admin token + base_url)
    const { data: uazapiKey } = await supabaseAdmin.from('global_api_keys')
      .select('*')
      .eq('provider', 'uazapi')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!uazapiKey) {
      return jsonResponse({ error: 'UAZAPI não configurado. Adicione a chave global do provider "uazapi" no painel admin.' }, 400);
    }

    const adminToken = uazapiKey.api_key_encrypted;
    const baseUrl = (uazapiKey as any).metadata?.base_url;
    if (!baseUrl) {
      return jsonResponse({ error: 'URL base do UAZAPI não configurada na chave global.' }, 400);
    }

    const apiBase = baseUrl.replace(/\/+$/, '');

    switch (action) {
      // ── CREATE INSTANCE ──
      case 'create_instance': {
        const instName = instance_name || `tenant_${effectiveTenantId.slice(0, 8)}`;

        // 1. Create instance via POST /instance/init (admintoken header)
        const createRes = await fetch(`${apiBase}/instance/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'admintoken': adminToken },
          body: JSON.stringify({ name: instName }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('UAZAPI create error:', createRes.status, errText);
          return jsonResponse({ error: `Falha ao criar instância: ${createRes.status} ${errText}` }, 500);
        }

        const createData = await createRes.json();
        console.log('UAZAPI create response:', JSON.stringify(createData));
        const instanceToken = createData.token || createData.apikey || createData.instance?.token || '';

        // 2. Set webhook with tenant_id in URL (uses instance token header)
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi?tenant_id=${effectiveTenantId}`;
        try {
          const whRes = await fetch(`${apiBase}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instanceToken },
          body: JSON.stringify({
            enabled: true,
            url: webhookUrl,
            events: ['messages', 'messages_update', 'connection'],
            excludeMessages: ['wasSentByApi', 'isGroupYes'],
          }),
          });
          const whBody = await whRes.text();
          console.log('Webhook setup status:', whRes.status, whBody);
        } catch (whErr) {
          console.error('Webhook setup failed (non-critical):', whErr);
        }

        // 3. Save instance to DB
        await supabaseAdmin.from('whatsapp_instances').insert({
          tenant_id: effectiveTenantId,
          instance_name: instName,
          api_url: apiBase,
          api_token_encrypted: instanceToken,
          is_active: true,
        });

        // 4. Connect (POST /instance/connect with token header, empty body = QR code)
        let qrcode = null;
        try {
          const connectRes = await fetch(`${apiBase}/instance/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            body: JSON.stringify({}),
          });
          if (connectRes.ok) {
            const connectData = await connectRes.json();
            console.log('UAZAPI connect response:', JSON.stringify(connectData));
            qrcode = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
            if (qrcode === '') qrcode = null;
          } else {
            const errText = await connectRes.text();
            console.error('UAZAPI connect error:', connectRes.status, errText);
          }
        } catch (qrErr) {
          console.error('Connect after create failed:', qrErr);
        }

        return jsonResponse({ ok: true, instance_name: instName, token: instanceToken, qrcode });
      }

      // ── GET QR / GET STATUS ──
      case 'get_qr':
      case 'get_status': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          if (action === 'get_status') {
            return jsonResponse({ status: 'no_instance' });
          }
          return jsonResponse({ error: 'Nenhuma instância encontrada. Crie uma primeiro.' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';

        // GET /instance/status with token header
        const statusRes = await fetch(`${apiBase}/instance/status`, {
          method: 'GET',
          headers: { 'token': instToken },
        });

        console.log(`UAZAPI /instance/status: ${statusRes.status}`);

        if (!statusRes.ok) {
          const errText = await statusRes.text();
          console.error('UAZAPI status error:', statusRes.status, errText);
          return jsonResponse({ error: `Falha ao obter status: ${statusRes.status} ${errText}` }, 500);
        }

        const statusData = await statusRes.json();
        console.log('UAZAPI status response:', JSON.stringify(statusData));

        let qrcode = statusData.instance?.qrcode || statusData.qrcode || statusData.base64 || null;
        if (qrcode === '') qrcode = null; // UAZAPI returns empty string when no QR
        let paircode = statusData.instance?.paircode || statusData.paircode || null;
        if (paircode === '') paircode = null;
        let state = statusData.instance?.status || statusData.state || statusData.status || 'disconnected';
        const phoneNumber = statusData.instance?.phone || statusData.phone || instance.phone_number;

        // If disconnected and no QR, call POST /instance/connect to initiate connection and get QR
        if ((state === 'disconnected' || (!qrcode && state !== 'connected'))) {
          console.log(`Instance state=${state}, triggering POST /instance/connect to generate QR...`);
          try {
            const connectRes = await fetch(`${apiBase}/instance/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instToken },
              body: JSON.stringify({}),
            });
            if (connectRes.ok) {
              const connectData = await connectRes.json();
              console.log('UAZAPI connect response:', JSON.stringify(connectData));
              const newQr = connectData.instance?.qrcode || connectData.qrcode || connectData.base64 || null;
              if (newQr && newQr !== '') {
                qrcode = newQr;
                state = 'connecting';
              }
            } else {
              const errText = await connectRes.text();
              console.error('UAZAPI connect error:', connectRes.status, errText);
            }
          } catch (e) {
            console.error('Connect call failed:', e);
          }
        }

        if (state === 'connected' && phoneNumber) {
          await supabaseAdmin.from('whatsapp_instances').update({ phone_number: phoneNumber }).eq('id', instance.id);
        }

        return jsonResponse({
          status: state,
          phone: phoneNumber || null,
          instance_name: instance.instance_name,
          qrcode,
        });
      }

      // ── DISCONNECT ──
      case 'disconnect': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (instance) {
          try {
            await fetch(`${apiBase}/instance/disconnect`, {
              method: 'POST',
              headers: { 'token': instance.api_token_encrypted || '' },
            });
          } catch (e) {
            console.error('Disconnect request failed:', e);
          }
          await supabaseAdmin.from('whatsapp_instances').update({ is_active: false }).eq('id', instance.id);
        }

        return jsonResponse({ ok: true });
      }

      // ── SEND MESSAGE ──
      case 'send_message': {
        const { phone, message, conversation_id } = body;
        if (!phone || !message) {
          return jsonResponse({ error: 'phone and message required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        
        // Format phone: remove + and non-digits, ensure no @s.whatsapp.net
        const cleanPhone = phone.replace(/\D/g, '');

        if (!cleanPhone || cleanPhone.length < 10) {
          return jsonResponse({ error: 'Número de telefone inválido' }, 400);
        }

        const sendRes = await fetch(`${apiBase}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify({
            number: cleanPhone,
            text: message,
            delay: 0,
            readchat: true,
            readmessages: true,
          }),
        });

        const sendData = await sendRes.json();
        console.log('UAZAPI send response:', sendRes.status, JSON.stringify(sendData));

        if (!sendRes.ok) {
          const errMsg = sendData.error || sendData.message || `Falha ao enviar: ${sendRes.status}`;
          // Return 400 for client errors (invalid number, etc.), 502 for upstream issues
          const isClientError = errMsg.includes('not on WhatsApp') || errMsg.includes('invalid') || sendRes.status === 400 || sendRes.status === 404;
          return jsonResponse({ error: errMsg, details: sendData }, isClientError ? 400 : 502);
        }

        // Reset inactivity: update opportunities linked to this contact
        if (conversation_id) {
          try {
            const { data: conv } = await supabaseAdmin.from('conversations')
              .select('contact_id')
              .eq('id', conversation_id)
              .single();
            if (conv?.contact_id) {
              await supabaseAdmin.from('opportunities')
                .update({ updated_at: new Date().toISOString() })
                .eq('contact_id', conv.contact_id)
                .eq('tenant_id', effectiveTenantId)
                .eq('status', 'open');
              console.log(`uazapi-proxy: reset inactivity for contact ${conv.contact_id}`);
            }
          } catch (e) {
            console.error('uazapi-proxy: failed to reset inactivity:', e);
          }
        }

        return jsonResponse({ ok: true, provider_message_id: sendData.key?.id || sendData.messageid || sendData.id || null });
      }

      // ── SETUP WEBHOOK (re-configure) ──
      case 'setup_webhook': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância encontrada' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi?tenant_id=${effectiveTenantId}`;
        
        const whRes = await fetch(`${apiBase}/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify({
            enabled: true,
            url: webhookUrl,
            events: ['messages', 'messages_update', 'connection'],
            excludeMessages: ['wasSentByApi', 'isGroupYes'],
          }),
        });
        
        const whBody = await whRes.text();
        console.log('Webhook setup:', whRes.status, whBody);

        return jsonResponse({ ok: true, status: whRes.status, response: whBody });
      }

      // ── SET PRESENCE ──
      case 'set_presence': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância encontrada' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const presence = body.presence || 'available';

        try {
          const presRes = await fetch(`${apiBase}/instance/setpresence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instToken },
            body: JSON.stringify({ presence }),
          });
          const presBody = await presRes.text();
          console.log('Set presence:', presRes.status, presBody);
          return jsonResponse({ ok: true, status: presRes.status, response: presBody });
        } catch (e) {
          console.error('Set presence failed:', e);
          return jsonResponse({ error: 'Failed to set presence' }, 500);
        }
      }

      // ── DOWNLOAD MEDIA ──
      case 'download_media': {
        const { message_id } = body;
        if (!message_id) {
          return jsonResponse({ error: 'message_id required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const instancePhone = (instance.phone_number || '').replace(/\D/g, '');

        // UAZAPI v2: POST /message/download with { id: "owner:messageId" }
        // Try full format first (owner:messageId), then short format
        const fullId = instancePhone ? `${instancePhone}:${message_id}` : message_id;
        console.log(`download_media: trying ID: ${fullId}, apiBase: ${apiBase}`);
        
        let dlRes = await fetch(`${apiBase}/message/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify({ id: fullId }),
        });

        console.log(`download_media: response status=${dlRes.status}, content-type=${dlRes.headers.get('content-type')}`);

        // Fallback: try short ID if full ID failed
        if (!dlRes.ok && instancePhone) {
          console.log(`download_media: full ID failed (${dlRes.status}), trying short ID: ${message_id}`);
          dlRes = await fetch(`${apiBase}/message/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instToken },
            body: JSON.stringify({ id: message_id }),
          });
          console.log(`download_media: fallback status=${dlRes.status}`);
        }

        if (!dlRes.ok) {
          const errText = await dlRes.text();
          console.error('UAZAPI download media error:', dlRes.status, errText);
          // Return 404 with friendly message for expired/unavailable media (upstream 500 = media no longer available)
          const isExpired = dlRes.status === 500 || errText.includes('download failed');
          return jsonResponse({ 
            error: isExpired ? 'Mídia expirada ou indisponível no WhatsApp' : `Falha ao baixar mídia: ${dlRes.status}`,
            expired: isExpired,
          }, isExpired ? 404 : 502);
        }

        // Check if response is JSON (URL/link) or binary (file data)
        const contentType = dlRes.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          const dlData = await dlRes.json();
          console.log(`download_media: JSON response keys: ${Object.keys(dlData).join(',')}`);
          
          // UAZAPI returns { fileURL: "...", mimetype: "..." } or { base64: "...", mimetype: "..." }
          if (dlData.base64) {
            return jsonResponse({ ok: true, base64: dlData.base64, mimetype: dlData.mimetype || 'application/octet-stream' });
          }
          if (dlData.fileURL || dlData.url || dlData.link) {
            return jsonResponse({ ok: true, url: dlData.fileURL || dlData.url || dlData.link, mimetype: dlData.mimetype });
          }
          // Return full data for inspection
          return jsonResponse({ ok: true, data: dlData });
        }

        // Binary response - convert to base64
        const arrayBuffer = await dlRes.arrayBuffer();
        console.log(`download_media: binary response size=${arrayBuffer.byteLength}, type=${contentType}`);
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        return jsonResponse({ ok: true, base64: b64, mimetype: contentType });
      }

      // ── SEND MEDIA ──
      case 'send_media': {
        const { phone, media_base64, media_url: sendMediaUrl, media_type: sendMediaType, caption, conversation_id: convId } = body;
        if (!phone || (!media_base64 && !sendMediaUrl)) {
          return jsonResponse({ error: 'phone and media_base64 or media_url required' }, 400);
        }

        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return jsonResponse({ error: 'Nenhuma instância WhatsApp ativa' }, 404);
        }

        const instToken = instance.api_token_encrypted || '';
        const cleanPhone = phone.replace(/\D/g, '');

        // UAZAPI v2: POST /send/media with { number, type, file, caption? }
        const type = (sendMediaType || 'image').toLowerCase();
        let uazapiType = 'image';
        if (type.includes('audio') || type.includes('ptt') || type.includes('ogg')) uazapiType = 'audio';
        else if (type.includes('video')) uazapiType = 'video';
        else if (type.includes('document') || type.includes('pdf')) uazapiType = 'document';

        const sendBody: any = {
          number: cleanPhone,
          type: uazapiType,
          file: media_base64 || sendMediaUrl,
        };
        if (caption) sendBody.caption = caption;

        const sendRes = await fetch(`${apiBase}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instToken },
          body: JSON.stringify(sendBody),
        });

        const sendData = await sendRes.json();
        console.log('UAZAPI send media response:', sendRes.status, JSON.stringify(sendData));

        if (!sendRes.ok) {
          return jsonResponse({ error: sendData.error || sendData.message || `Falha ao enviar mídia: ${sendRes.status}`, details: sendData }, 502);
        }

        return jsonResponse({ ok: true, provider_message_id: sendData.key?.id || sendData.messageid || sendData.id || null });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error('uazapi-proxy error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
