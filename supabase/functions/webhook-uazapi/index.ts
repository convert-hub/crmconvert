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
    
    // Get tenant_id from: query param > header > body
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenant_id') 
      || req.headers.get('x-tenant-id') 
      || body.tenant_id;
    
    if (!tenantId) {
      // Try to find tenant by looking up the instance
      // UAZAPI sends instance info in some events
      const instanceName = body.instance?.name || body.instanceName;
      if (instanceName) {
        const { data: inst } = await supabase.from('whatsapp_instances')
          .select('tenant_id')
          .eq('instance_name', instanceName)
          .eq('is_active', true)
          .limit(1)
          .single();
        if (inst) {
          return await processWebhook(supabase, inst.tenant_id, body);
        }
      }
      
      console.error('webhook-uazapi: no tenant_id found. Body keys:', Object.keys(body));
      return new Response(JSON.stringify({ error: 'tenant_id required' }), { 
        status: 200, // Return 200 to avoid UAZAPI retries
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return await processWebhook(supabase, tenantId, body);
  } catch (error) {
    console.error('webhook-uazapi error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 200, // Return 200 to avoid UAZAPI retries
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processWebhook(supabase: any, tenantId: string, body: any) {
  console.log('webhook-uazapi processing for tenant:', tenantId, 'event type:', body.event || body.type || 'unknown');

  // Save raw webhook event
  const { data: event } = await supabase.from('webhook_events').insert({
    tenant_id: tenantId,
    source: 'uazapi',
    raw_payload: body,
  }).select().single();

  // Determine idempotency key from various UAZAPI payload formats
  const msgId = body.key?.id || body.data?.key?.id || body.id || event?.id;

  // Enqueue message processing
  await supabase.rpc('enqueue_job', {
    _type: 'process_uazapi_message',
    _payload: JSON.stringify({ event_id: event?.id, tenant_id: tenantId, data: body }),
    _tenant_id: tenantId,
    _idempotency_key: `uazapi-${msgId}`,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
