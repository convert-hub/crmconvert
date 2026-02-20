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
    const tenantId = req.headers.get('x-tenant-id') ?? body.tenant_id;
    
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Save raw webhook event
    const { data: event } = await supabase.from('webhook_events').insert({
      tenant_id: tenantId,
      source: 'uazapi',
      raw_payload: body,
    }).select().single();

    // Enqueue message processing
    await supabase.rpc('enqueue_job', {
      _type: 'process_uazapi_message',
      _payload: JSON.stringify({ event_id: event?.id, tenant_id: tenantId, data: body }),
      _tenant_id: tenantId,
      _idempotency_key: `uazapi-${body?.key?.id ?? event?.id}`,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
