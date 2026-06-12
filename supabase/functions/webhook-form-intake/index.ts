import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id, x-webhook-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SOURCE = 'generic_form';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  if (req.method === 'GET') {
    return jsonResponse({ ok: true, service: 'webhook-form-intake' });
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

    const phoneDigits = String(body?.phone ?? body?.telefone ?? body?.whatsapp ?? '').replace(/\D/g, '');
    const campaign = String(body?.campaign ?? body?.utm_campaign ?? '');
    let externalId: string | null = null;
    if (phoneDigits) {
      externalId = await sha256Hex(`${phoneDigits}|${campaign}|${todayUTC()}`);
    }

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
      _type: 'process_form_webhook',
      _payload: JSON.stringify({ event_id: eventId, tenant_id: tenantId, data: body }),
      _tenant_id: tenantId,
      _idempotency_key: `form-${eventId}`,
    });

    return jsonResponse({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
