import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id, x-webhook-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SOURCE = 'facebook_lead_ads';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractLeadgenId(body: any): string | null {
  if (body?.lead_id) return String(body.lead_id);
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (value?.leadgen_id) return String(value.leadgen_id);
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const challenge = url.searchParams.get('hub.challenge');
    if (challenge) return new Response(challenge, { status: 200 });
    return jsonResponse({ ok: true, service: 'webhook-meta-leads' });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as any));
    const tenantId =
      req.headers.get('x-tenant-id') ??
      url.searchParams.get('tenant_id') ??
      body?.tenant_id;

    if (!tenantId) {
      return jsonResponse({ error: 'tenant_id required (header x-tenant-id, query ou body)' }, 400);
    }

    const providedToken =
      req.headers.get('x-webhook-token') ??
      url.searchParams.get('token') ??
      null;

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, settings')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantErr || !tenant) return jsonResponse({ error: 'tenant not found' }, 404);

    const expectedToken = (tenant.settings as any)?.lead_webhook_token ?? null;
    if (expectedToken && providedToken !== expectedToken) {
      return jsonResponse({ error: 'invalid token' }, 401);
    }

    const externalId = extractLeadgenId(body);

    const ins = await supabase
      .from('webhook_events')
      .insert({ tenant_id: tenantId, source: SOURCE, raw_payload: body, external_id: externalId })
      .select('id')
      .single();

    if (ins.error) {
      if ((ins.error as any).code === '23505' && externalId) {
        return jsonResponse({ ok: true, duplicated: true });
      }
      return jsonResponse({ error: ins.error.message }, 500);
    }
    const eventId = ins.data?.id ?? null;

    await supabase.rpc('enqueue_job', {
      _type: 'process_meta_lead',
      _payload: JSON.stringify({ event_id: eventId, tenant_id: tenantId, data: body }),
      _tenant_id: tenantId,
      _idempotency_key: `meta-${eventId}`,
    });

    return jsonResponse({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
