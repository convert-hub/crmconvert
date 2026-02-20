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
    
    // Facebook sends a verification challenge on GET
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const challenge = url.searchParams.get('hub.challenge');
      if (challenge) return new Response(challenge, { status: 200 });
    }

    // Extract tenant_id from query param or header
    const tenantId = url.searchParams.get('tenant_id') ?? req.headers.get('x-tenant-id');
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'tenant_id required as query param' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Save raw event
    const { data: event } = await supabase.from('webhook_events').insert({
      tenant_id: tenantId,
      source: 'facebook_lead_ads',
      raw_payload: body,
    }).select().single();

    // Enqueue processing job
    await supabase.rpc('enqueue_job', {
      _type: 'process_meta_lead',
      _payload: JSON.stringify({ event_id: event?.id, tenant_id: tenantId, data: body }),
      _tenant_id: tenantId,
      _idempotency_key: `meta-${event?.id}`,
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
