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

    // Route actions
    switch (action) {
      case 'create_instance': {
        // Create instance in UAZAPI
        const instName = instance_name || `tenant_${effectiveTenantId.slice(0, 8)}`;
        
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-uazapi`;
        
        const createRes = await fetch(`${baseUrl}/instance/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'admintoken': adminToken },
          body: JSON.stringify({ instanceName: instName }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          return new Response(JSON.stringify({ error: `Falha ao criar instância: ${createRes.status} ${errText}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const createData = await createRes.json();
        const instanceToken = createData.token || createData.apikey || createData.instance?.token || '';

        // Set webhook in UAZAPI
        await fetch(`${baseUrl}/instance/setWebhook/${instName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instanceToken },
          body: JSON.stringify({
            webhookUrl: webhookUrl,
            webhookEvents: ['messages.upsert', 'connection.update', 'messages.update'],
            headers: { 'x-tenant-id': effectiveTenantId },
          }),
        });

        // Save instance to DB
        await supabaseAdmin.from('whatsapp_instances').insert({
          tenant_id: effectiveTenantId,
          instance_name: instName,
          api_url: baseUrl,
          api_token_encrypted: instanceToken,
          is_active: true,
        });

        return new Response(JSON.stringify({ ok: true, instance_name: instName, token: instanceToken }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get_qr': {
        // Get existing instance for tenant
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return new Response(JSON.stringify({ error: 'Nenhuma instância encontrada. Crie uma primeiro.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const qrRes = await fetch(`${baseUrl}/instance/connectionState/${instance.instance_name}`, {
          method: 'GET',
          headers: { 'token': instance.api_token_encrypted || '' },
        });

        if (!qrRes.ok) {
          const errText = await qrRes.text();
          return new Response(JSON.stringify({ error: `Falha ao obter QR: ${qrRes.status} ${errText}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const qrData = await qrRes.json();
        return new Response(JSON.stringify(qrData), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get_status': {
        const { data: instance } = await supabaseAdmin.from('whatsapp_instances')
          .select('*')
          .eq('tenant_id', effectiveTenantId)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (!instance) {
          return new Response(JSON.stringify({ status: 'no_instance' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const statusRes = await fetch(`${baseUrl}/instance/connectionState/${instance.instance_name}`, {
          method: 'GET',
          headers: { 'token': instance.api_token_encrypted || '' },
        });

        const statusData = statusRes.ok ? await statusRes.json() : { state: 'error' };

        // Update phone number if connected
        if (statusData.state === 'connected' && statusData.instance?.phone) {
          await supabaseAdmin.from('whatsapp_instances')
            .update({ phone_number: statusData.instance.phone })
            .eq('id', instance.id);
        }

        return new Response(JSON.stringify({ 
          status: statusData.state || statusData.status || 'unknown',
          phone: statusData.instance?.phone || instance.phone_number,
          instance_name: instance.instance_name,
          qrcode: statusData.qrcode || statusData.base64 || null,
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
          await fetch(`${baseUrl}/instance/logout/${instance.instance_name}`, {
            method: 'DELETE',
            headers: { 'token': instance.api_token_encrypted || '' },
          });
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
