import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Public endpoint — webhook receiver baseado em slug.
// URL: POST /functions/v1/webhook-flow-trigger/<slug>
// Auth: header X-Flow-Secret deve bater com webhook_endpoints.secret
//
// test_mode=true  → grava sample_payload + request_history e retorna sem disparar
// test_mode=false → resolve actions[] (set_phone, set_name, set_email, set_custom_field, trigger_flow),
//                   cria/atualiza contato e enfileira execute_flow

type ActionMap = {
  id: string;
  type: 'set_phone' | 'set_name' | 'set_email' | 'set_custom_field' | 'trigger_flow';
  source_path?: string;
  target?: string;
  flow_id?: string;
};

function getByPath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function normalizePhone(p: any): string | null {
  if (p === undefined || p === null) return null;
  const digits = String(p).replace(/\D/g, '');
  return digits || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((s) => s === 'webhook-flow-trigger');
    const slug = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1];

    if (!slug) return jsonError(400, 'missing slug');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: wh, error: whErr } = await supabase
      .from('webhook_endpoints')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (whErr || !wh) return jsonError(404, 'webhook not found');
    if (!wh.is_active) return jsonError(403, 'webhook inactive');

    const provided =
      req.headers.get('x-flow-secret') ||
      req.headers.get('X-Flow-Secret') ||
      url.searchParams.get('secret');
    if (provided !== wh.secret) return jsonError(401, 'invalid secret');

    let body: Record<string, unknown> = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return jsonError(400, 'invalid json');
      }
    }

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const fullPayload = { body, query: Object.fromEntries(url.searchParams.entries()), headers };

    // ── TEST MODE ──
    if (wh.test_mode) {
      const history = Array.isArray(wh.request_history) ? wh.request_history : [];
      const newHistory = [
        { received_at: new Date().toISOString(), payload: fullPayload },
        ...history,
      ].slice(0, 10);

      await supabase.from('webhook_endpoints').update({
        sample_payload: fullPayload,
        sample_received_at: new Date().toISOString(),
        request_history: newHistory,
      }).eq('id', wh.id);

      return json(200, { ok: true, captured: true, message: 'Modo teste ativo — payload registrado' });
    }

    // ── LIVE MODE ──
    const actions: ActionMap[] = Array.isArray(wh.actions) ? wh.actions : [];

    // Resolve mapped values from payload
    const phone = normalizePhone(getByPath(fullPayload, actions.find(a => a.type === 'set_phone')?.source_path || ''));
    const name = String(getByPath(fullPayload, actions.find(a => a.type === 'set_name')?.source_path || '') ?? '').trim() || null;
    const email = String(getByPath(fullPayload, actions.find(a => a.type === 'set_email')?.source_path || '') ?? '').trim().toLowerCase() || null;

    let contactId: string | null = null;
    if (phone || email) {
      let q = supabase.from('contacts').select('id, custom_fields').eq('tenant_id', wh.tenant_id).limit(1);
      if (phone) q = q.eq('phone', phone);
      else if (email) q = q.eq('email', email);
      const { data: c } = await q.maybeSingle();
      contactId = c?.id ?? null;

      // Build custom fields from set_custom_field actions
      const customFields: Record<string, unknown> = c?.custom_fields ?? {};
      for (const a of actions.filter(x => x.type === 'set_custom_field' && x.target && x.source_path)) {
        const val = getByPath(fullPayload, a.source_path!);
        if (val !== undefined) customFields[a.target!] = val;
      }

      if (!contactId) {
        const { data: newC } = await supabase.from('contacts').insert({
          tenant_id: wh.tenant_id,
          name: name || phone || email || 'Webhook',
          phone, email, custom_fields: customFields,
          source: 'webhook', status: 'lead',
        }).select('id').single();
        contactId = newC?.id ?? null;
      } else {
        const update: Record<string, unknown> = { custom_fields: customFields };
        if (name) update.name = name;
        await supabase.from('contacts').update(update).eq('id', contactId);
      }
    }

    // Trigger flow(s)
    const flowAction = actions.find(a => a.type === 'trigger_flow' && a.flow_id);
    const flowId = flowAction?.flow_id || wh.flow_id;
    let jobId: string | null = null;
    if (flowId) {
      const triggerData: Record<string, unknown> = { ...body, _webhook: { slug: wh.slug, name: wh.name } };
      // Also expose mapped fields by their target name for convenience
      for (const a of actions) {
        if (a.source_path && a.target) {
          triggerData[a.target] = getByPath(fullPayload, a.source_path);
        }
      }
      const { data: enq } = await supabase.rpc('enqueue_job', {
        _type: 'execute_flow',
        _payload: JSON.stringify({
          flow_id: flowId,
          tenant_id: wh.tenant_id,
          contact_id: contactId,
          conversation_id: null,
          trigger_data: triggerData,
        }),
        _tenant_id: wh.tenant_id,
      });
      jobId = enq as unknown as string;
    }

    return json(200, { ok: true, contact_id: contactId, job_id: jobId });
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'unknown error');
  }
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(status: number, message: string) {
  return json(status, { ok: false, error: message });
}
