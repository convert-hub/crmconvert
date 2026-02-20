import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = claimsData.claims.sub;

    const body = await req.json();
    const { action, tenant_id, instance_name } = body;

    // Get user's tenant membership
    const { data: membership } = await supabaseAdmin.from('tenant_memberships')
      .select('id, role, tenant_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();

    const effectiveTenantId = tenant_id || membership?.tenant_id;
    if (!effectiveTenantId) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get UAZAPI global key (admin token + base_url)
    const { data: uazapiKey } = await supabaseAdmin.from('global_api_keys')
      .select('*')
      .eq('provider', 'uazapi')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!uazapiKey) {
      return new Response(JSON.stringify({ error: 'UAZAPI não configurado. Adicione a chave global do provider "uazapi" no painel admin.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const adminToken = uazapiKey.api_key_encrypted;
    const baseUrl = (uazapiKey as any).metadata?.base_url;
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: 'URL base do UAZAPI não configurada na chave global.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Ensure baseUrl has no trailing slash
    const apiBase = baseUrl.replace(/\/+$/, '');

    // Route actions
    switch (action) {
      case 'create_instance': {
        const instName = instance_name || `tenant_${effectiveTenantId.slice(0, 8)}`;
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi`;

        // 1. Create instance via POST /instance/init (UAZAPI v2)
        const createRes = await fetch(`${apiBase}/instance/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'admintoken': adminToken },
          body: JSON.stringify({ name: instName }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('UAZAPI create error:', createRes.status, errText);
          return new Response(JSON.stringify({ error: `Falha ao criar instância: ${createRes.status} ${errText}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const createData = await createRes.json();
        console.log('UAZAPI create response:', JSON.stringify(createData));
        const instanceToken = createData.token || createData.apikey || createData.instance?.token || '';

        // 2. Set webhook
        try {
          const whRes = await fetch(`${apiBase}/instance/setWebhook/${instName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            body: JSON.stringify({
              webhookUrl: webhookUrl,
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

        // 4. Immediately get QR code via GET /instance/connectionState/{name}
        let qrcode = null;
        try {
          const qrRes = await fetch(`${apiBase}/instance/connectionState/${instName}`, {
            method: 'GET',
            headers: { 'token': instanceToken },
          });
          if (qrRes.ok) {
            const qrData = await qrRes.json();
            console.log('UAZAPI connectionState after create:', JSON.stringify(qrData));
            qrcode = qrData.qrcode || qrData.base64 || qrData.urlcode || null;
          }
        } catch (qrErr) {
          console.error('QR fetch after create failed:', qrErr);
        }

        return new Response(JSON.stringify({ ok: true, instance_name: instName, token: instanceToken, qrcode }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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
            return new Response(JSON.stringify({ status: 'no_instance' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({ error: 'Nenhuma instância encontrada. Crie uma primeiro.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // GET /instance/connectionState/{instanceName} returns state + qrcode
        const stateRes = await fetch(`${apiBase}/instance/connectionState/${instance.instance_name}`, {
          method: 'GET',
          headers: { 'token': instance.api_token_encrypted || '' },
        });

        if (!stateRes.ok) {
          const errText = await stateRes.text();
          console.error('UAZAPI connectionState error:', stateRes.status, errText);
          return new Response(JSON.stringify({ error: `Falha ao obter status: ${stateRes.status} ${errText}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const stateData = await stateRes.json();
        console.log('UAZAPI connectionState:', JSON.stringify(stateData));

        // Extract state - UAZAPI returns { state: "disconnected"|"connecting"|"connected", ... }
        const state = stateData.state || stateData.status || 'unknown';
        const qrcode = stateData.qrcode || stateData.base64 || stateData.urlcode || null;
        const phoneNumber = stateData.instance?.phone || stateData.phone || instance.phone_number;

        // Update phone number if connected
        if (state === 'connected' && phoneNumber) {
          await supabaseAdmin.from('whatsapp_instances')
            .update({ phone_number: phoneNumber })
            .eq('id', instance.id);
        }

        return new Response(JSON.stringify({
          status: state,
          phone: phoneNumber || null,
          instance_name: instance.instance_name,
          qrcode: qrcode,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'disconnect': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (instance) {
          try {
            await fetch(`${apiBase}/instance/logout/${instance.instance_name}`, {
              method: 'DELETE',
              headers: { 'token': instance.api_token_encrypted || '' },
            });
          } catch (e) {
            console.error('Logout request failed:', e);
          }
          await supabaseAdmin.from('whatsapp_instances').update({ is_active: false }).eq('id', instance.id);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    console.error('uazapi-proxy error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
