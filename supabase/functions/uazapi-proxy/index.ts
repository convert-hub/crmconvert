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

        // 2. Set webhook (uses instance token header)
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi`;
        try {
          const whRes = await fetch(`${apiBase}/webhook/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            body: JSON.stringify({
              webhookUrl,
              webhookEvents: ['messages.upsert', 'connection.update', 'messages.update'],
              headers: { 'x-tenant-id': effectiveTenantId },
            }),
          });
          console.log('Webhook setup status:', whRes.status);
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
            qrcode = connectData.qrcode || connectData.base64 || connectData.urlcode || connectData.pairingCode || null;
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

        const qrcode = statusData.qrcode || statusData.base64 || statusData.urlcode || statusData.pairingCode || null;
        const state = statusData.state || statusData.status || (qrcode ? 'connecting' : 'disconnected');
        const phoneNumber = statusData.instance?.phone || statusData.phone || instance.phone_number;

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

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error('uazapi-proxy error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});
