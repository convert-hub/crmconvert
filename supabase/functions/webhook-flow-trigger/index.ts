import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Public endpoint — autenticação por X-Flow-Secret no body do trigger_config.
// URL: POST /functions/v1/webhook-flow-trigger/<flow_id>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // pathname: /webhook-flow-trigger/<flow_id> ou /functions/v1/webhook-flow-trigger/<flow_id>
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((s) => s === 'webhook-flow-trigger');
    const flowId = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1];

    if (!flowId || !/^[0-9a-f-]{36}$/i.test(flowId)) {
      return jsonError(400, 'invalid flow id');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: flow, error: flowErr } = await supabase
      .from('chatbot_flows')
      .select('id, tenant_id, trigger_type, trigger_config, is_active')
      .eq('id', flowId)
      .maybeSingle();

    if (flowErr || !flow) return jsonError(404, 'flow not found');
    if (flow.trigger_type !== 'webhook') return jsonError(400, 'flow trigger is not webhook');
    if (!flow.is_active) return jsonError(403, 'flow inactive');

    const expectedSecret = (flow.trigger_config as Record<string, unknown> | null)?.secret as string | undefined;
    const providedSecret =
      req.headers.get('x-flow-secret') ||
      req.headers.get('X-Flow-Secret') ||
      url.searchParams.get('secret');

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return jsonError(401, 'invalid secret');
    }

    let body: Record<string, unknown> = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return jsonError(400, 'invalid json');
      }
    }

    // Field mapping (payload key -> variable name)
    const mapping = ((flow.trigger_config as Record<string, unknown> | null)?.field_mapping || {}) as Record<string, string>;
    const triggerData: Record<string, unknown> = { ...body, _raw: body };
    for (const [from, to] of Object.entries(mapping)) {
      if (from && to && body[from] !== undefined) triggerData[to] = body[from];
    }

    // Resolve contact: try phone or email from body
    const phone = (body.phone || body.telefone || triggerData.phone) as string | undefined;
    const email = (body.email || triggerData.email) as string | undefined;
    let contactId: string | null = null;
    if (phone || email) {
      let q = supabase.from('contacts').select('id').eq('tenant_id', flow.tenant_id).limit(1);
      if (phone) q = q.eq('phone', String(phone).replace(/\D/g, ''));
      else if (email) q = q.eq('email', String(email).toLowerCase());
      const { data: c } = await q.maybeSingle();
      contactId = c?.id ?? null;

      if (!contactId && (body.create_contact === true || body.name)) {
        const { data: newC } = await supabase.from('contacts').insert({
          tenant_id: flow.tenant_id,
          name: (body.name as string) || (phone as string) || (email as string) || 'Webhook',
          phone: phone ? String(phone).replace(/\D/g, '') : null,
          email: email ? String(email).toLowerCase() : null,
          source: (body.source as string) || 'webhook',
          status: 'lead',
        }).select('id').single();
        contactId = newC?.id ?? null;
      }
    }

    const { data: jobId, error: jobErr } = await supabase.rpc('enqueue_job', {
      _type: 'execute_flow',
      _payload: JSON.stringify({
        flow_id: flow.id,
        tenant_id: flow.tenant_id,
        contact_id: contactId,
        conversation_id: null,
        trigger_data: triggerData,
      }),
      _tenant_id: flow.tenant_id,
    });

    if (jobErr) return jsonError(500, jobErr.message);

    return new Response(
      JSON.stringify({ ok: true, job_id: jobId, contact_id: contactId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'unknown error');
  }
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
