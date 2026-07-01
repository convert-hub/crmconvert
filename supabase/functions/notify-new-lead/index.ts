import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeBrazilPhone, phoneDigitsOnly } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const TRIGGER_LABEL: Record<string, string> = {
  inbound: 'Mensagem recebida',
  keyword: 'Palavra-chave',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') || '';
    if (auth !== `Bearer ${SERVICE}`) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const tenant_id = body?.tenant_id as string | undefined;
    const contact_id = body?.contact_id as string | undefined;
    const trigger = body?.trigger as 'inbound' | 'keyword' | undefined;
    if (!tenant_id || !contact_id || !trigger || !TRIGGER_LABEL[trigger]) {
      return json({ error: 'Invalid input' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE);

    // 1. Config
    const { data: tenant } = await supabase.from('tenants').select('settings').eq('id', tenant_id).single();
    const cfg = (tenant?.settings as any)?.lead_notifications ?? {};
    if (cfg.enabled !== true) return json({ skipped: 'disabled' });
    if (cfg.triggers?.[trigger] !== true) return json({ skipped: 'trigger_disabled' });
    const recipientIds: string[] = Array.isArray(cfg.recipient_membership_ids) ? cfg.recipient_membership_ids : [];
    if (recipientIds.length === 0) return json({ skipped: 'no_recipients' });

    // 2. Idempotency lock (atomic): only proceed if lead_notified_at is null.
    const { data: contact, error: contactErr } = await supabase.from('contacts')
      .select('id, name, phone, source, custom_fields')
      .eq('id', contact_id).eq('tenant_id', tenant_id).maybeSingle();
    if (contactErr || !contact) return json({ skipped: 'contact_not_found' });

    const cf = (contact.custom_fields as any) ?? {};
    if (cf.lead_notified_at) return json({ skipped: 'already_notified' });

    const nowIso = new Date().toISOString();
    const nextCf = { ...cf, lead_notified_at: nowIso, lead_notified_trigger: trigger };
    // Atomic-ish: only update if still null.
    const { data: locked, error: lockErr } = await supabase.from('contacts')
      .update({ custom_fields: nextCf })
      .eq('id', contact_id).eq('tenant_id', tenant_id)
      .is('custom_fields->>lead_notified_at', null)
      .select('id');
    if (lockErr) { console.error('notify-new-lead lock err', lockErr); return json({ skipped: 'lock_error' }); }
    if (!locked || locked.length === 0) return json({ skipped: 'already_notified' });

    // 3. UAZAPI instance
    const { data: instance } = await supabase.from('whatsapp_instances')
      .select('api_url, api_token_encrypted')
      .eq('tenant_id', tenant_id).eq('provider', 'uazapi').eq('is_active', true)
      .limit(1).maybeSingle();
    if (!instance?.api_url || !instance?.api_token_encrypted) {
      console.log(`notify-new-lead: no active UAZAPI for tenant ${tenant_id}`);
      return json({ skipped: 'no_uazapi' });
    }

    // 4. Recipients + phones
    const { data: memberships } = await supabase.from('tenant_memberships')
      .select('id, user_id')
      .eq('tenant_id', tenant_id).eq('is_active', true)
      .in('id', recipientIds);
    const userIds = (memberships ?? []).map(m => m.user_id);
    const { data: profs } = await supabase.from('profiles')
      .select('user_id, full_name, phone')
      .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
    const profByUser = new Map((profs ?? []).map(p => [p.user_id, p]));

    const targets: { name: string; phone: string }[] = [];
    let missingPhone = 0;
    for (const m of memberships ?? []) {
      const p = profByUser.get(m.user_id);
      const digits = phoneDigitsOnly(p?.phone);
      if (!digits || digits.length < 10) { missingPhone++; continue; }
      targets.push({ name: p?.full_name || 'atendente', phone: digits });
    }
    if (targets.length === 0) {
      console.log('notify-new-lead: no recipients with phone');
      return json({ skipped: 'no_phones', missing_phone: missingPhone });
    }

    // 5. Message
    const leadPhoneFmt = contact.phone ? contact.phone : '—';
    const text = `🟢 Novo lead recebido!\nNome: ${contact.name || 'Sem nome'}\nTelefone: ${leadPhoneFmt}\nOrigem: ${TRIGGER_LABEL[trigger]}\nAbra o CRM para atender.`;

    // 6. Fire each send
    const apiBase = instance.api_url.replace(/\/+$/, '');
    let sent = 0, failed = 0;
    for (const t of targets) {
      try {
        const r = await fetch(`${apiBase}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: instance.api_token_encrypted },
          body: JSON.stringify({ number: t.phone, text, delay: 0 }),
        });
        const rt = await r.text();
        if (!r.ok) { failed++; console.error(`notify-new-lead send fail ${t.phone}: ${r.status} ${rt.slice(0, 200)}`); }
        else sent++;
      } catch (e) { failed++; console.error('notify-new-lead send err', e); }
    }

    return json({ ok: true, sent, failed, missing_phone: missingPhone });
  } catch (e) {
    console.error('notify-new-lead fatal', e);
    return json({ error: 'internal' }, 200);
  }
});
