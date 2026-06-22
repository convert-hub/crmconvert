// uazapi-history-sync-contacts: backfill de histórico (30 dias) por lista de telefones.
// Estratégia: lista todos os chats reais da instância via /chat/find, cruza com os
// telefones pedidos e só então pagina /message/find com o chatid correto.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeBrazilPhone } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MAX_PAGES_PER_CHAT = 10;
const CHAT_LIST_MAX_PAGES = 50;
const PAGE_SIZE = 100;
const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 50;
const MAX_PHONES = 500;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function msgTimestampMs(m: any): number {
  const t = m?.messageTimestamp ?? m?.timestamp ?? m?.t;
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function extractList(data: any): any[] {
  return Array.isArray(data) ? data
    : Array.isArray(data?.messages) ? data.messages
    : Array.isArray(data?.chats) ? data.chats
    : Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.result) ? data.result
    : [];
}

function pickChatId(c: any): string | null {
  const v = c?.wa_chatid || c?.chatid || c?.chatId || c?.chat_id || c?.id || c?.jid || c?.remoteJid;
  return v ? String(v) : null;
}

function isIndividualChat(chatid: string): boolean {
  return /@(s\.whatsapp\.net|c\.us|lid)$/i.test(chatid);
}

function chatIdToPhone(chatid: string): string | null {
  if (/@lid$/i.test(chatid)) return null; // pseudônimo, não dá pra inferir telefone
  const left = chatid.split('@')[0].split(':')[0];
  return normalizeBrazilPhone(left) || null;
}

async function callJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: any; bodyPreview: string }> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* */ }
  return { ok: resp.ok, status: resp.status, data, bodyPreview: text.slice(0, 400) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { tenant_id, instance_id, phones } = await req.json().catch(() => ({}));
    if (!tenant_id || !instance_id || !Array.isArray(phones)) {
      return json({ ok: false, error: 'tenant_id, instance_id e phones[] são obrigatórios' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, api_token_encrypted')
      .eq('id', instance_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (!instance) return json({ ok: false, error: 'instance not found' }, 404);
    const instToken = instance.api_token_encrypted;
    if (!instToken) return json({ ok: false, error: 'instance token missing' }, 400);

    const { data: key } = await supabase
      .from('global_api_keys')
      .select('api_key_encrypted, metadata')
      .eq('provider', 'uazapi')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (!key) return json({ ok: false, error: 'uazapi api key not configured' }, 400);
    const apiBase = String((key.metadata as any)?.base_url || '').replace(/\/+$/, '');
    if (!apiBase) return json({ ok: false, error: 'uazapi base_url missing' }, 400);

    const normSet = new Set<string>();
    for (const raw of phones) {
      const n = normalizeBrazilPhone(raw);
      if (n) normSet.add(n);
    }
    const normPhones = Array.from(normSet).slice(0, MAX_PHONES);

    if (normPhones.length === 0) {
      return json({ ok: true, contacts_processed: 0, phones_requested: 0, phones_matched: 0, phones_without_chat: 0, chats_listed: 0, chats_found: 0, messages_inserted: 0, messages_skipped: 0, errors: [] });
    }

    const phoneSet = new Set(normPhones);
    const phoneToContactId = new Map<string, string>();
    {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, phone')
        .eq('tenant_id', tenant_id)
        .in('phone', normPhones);
      for (const c of contacts ?? []) {
        if (c.phone) phoneToContactId.set(c.phone, c.id);
      }
    }

    const errors: { phone: string; error: string }[] = [];

    // ============ Fase 1 — listar chats reais da instância ============
    // Tenta POST /chat/find primeiro; se 404/405, cai para GET.
    const phoneToChatId = new Map<string, string>();
    let chatsListed = 0;
    let listMode: 'post' | 'get' = 'post';

    for (let page = 0; page < CHAT_LIST_MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let r: { ok: boolean; status: number; data: any; bodyPreview: string };

      if (listMode === 'post') {
        r = await callJson(`${apiBase}/chat/find`, {
          method: 'POST',
          headers: { token: instToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: PAGE_SIZE, offset, operator: 'AND' }),
        });
        if (page === 0 && (r.status === 404 || r.status === 405)) {
          listMode = 'get';
          r = await callJson(`${apiBase}/chat/find?limit=${PAGE_SIZE}&offset=${offset}`, {
            method: 'GET',
            headers: { token: instToken },
          });
        }
      } else {
        r = await callJson(`${apiBase}/chat/find?limit=${PAGE_SIZE}&offset=${offset}`, {
          method: 'GET',
          headers: { token: instToken },
        });
      }

      if (page === 0) {
        console.log(`chat/find mode=${listMode} status=${r.status} bodyPreview=${r.bodyPreview}`);
      }
      if (!r.ok) {
        errors.push({ phone: '', error: `chat/find HTTP ${r.status}: ${r.bodyPreview}` });
        break;
      }
      const list = extractList(r.data);
      if (list.length === 0) break;

      for (const c of list) {
        const cid = pickChatId(c);
        if (!cid || !isIndividualChat(cid)) continue;
        chatsListed++;
        const ph = chatIdToPhone(cid);
        if (ph && phoneSet.has(ph) && !phoneToChatId.has(ph)) {
          phoneToChatId.set(ph, cid);
        }
      }
      if (list.length < PAGE_SIZE) break;
    }

    console.log(`chats_listed=${chatsListed} phones_requested=${normPhones.length} phones_matched=${phoneToChatId.size}`);

    // ============ Fase 2 — backfill por chat conhecido ============
    const cutoffMs = Date.now() - CUTOFF_MS;
    const msgsByPhone = new Map<string, any[]>();

    for (const [phone, chatid] of phoneToChatId.entries()) {
      const collected: any[] = [];
      let stop = false;
      for (let page = 0; page < MAX_PAGES_PER_CHAT && !stop; page++) {
        const offset = page * PAGE_SIZE;
        try {
          const r = await callJson(`${apiBase}/message/find`, {
            method: 'POST',
            headers: { token: instToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatid, limit: PAGE_SIZE, offset }),
          });
          if (!r.ok) { errors.push({ phone, error: `message/find HTTP ${r.status}: ${r.bodyPreview}` }); break; }
          const list = extractList(r.data);
          if (list.length === 0) break;
          let recent = false;
          for (const m of list) {
            const ts = msgTimestampMs(m);
            if (ts >= cutoffMs) { collected.push(m); recent = true; }
          }
          if (!recent) break;
          if (list.length < PAGE_SIZE) break;
        } catch (err) {
          errors.push({ phone, error: `fetch failed: ${(err as Error).message}` });
          stop = true;
        }
      }
      if (collected.length) msgsByPhone.set(phone, collected);
    }

    // ============ Persistência ============
    let chatsFound = 0;
    let insertedCount = 0;
    let skippedCount = 0;

    for (const [phone, msgs] of msgsByPhone.entries()) {
      if (!msgs.length) continue;
      chatsFound++;
      const chatid = phoneToChatId.get(phone) || `${phone}@s.whatsapp.net`;
      const contactId = phoneToContactId.get(phone) ?? null;

      let lastMs = 0, lastInMs = 0, lastOutMs = 0;
      for (const m of msgs) {
        const ts = msgTimestampMs(m);
        if (ts > lastMs) lastMs = ts;
        if (m.fromMe === true) { if (ts > lastOutMs) lastOutMs = ts; }
        else { if (ts > lastInMs) lastInMs = ts; }
      }
      const toIso = (ms: number) => ms ? new Date(ms).toISOString() : null;

      let conversationId: string | null = null;
      {
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .eq('tenant_id', tenant_id)
          .eq('whatsapp_instance_id', instance_id)
          .eq('provider_chat_id', chatid)
          .maybeSingle();
        if (existing) {
          conversationId = existing.id;
          if (contactId) {
            await supabase.from('conversations').update({ contact_id: contactId }).eq('id', existing.id).is('contact_id', null);
          }
        } else {
          const { data: created, error: convErr } = await supabase
            .from('conversations')
            .insert({
              tenant_id,
              contact_id: contactId,
              channel: 'whatsapp',
              status: 'open',
              whatsapp_instance_id: instance_id,
              provider_chat_id: chatid,
              last_message_at: toIso(lastMs),
              last_customer_message_at: toIso(lastInMs),
              last_agent_message_at: toIso(lastOutMs),
              unread_count: 0,
              is_unanswered: false,
            })
            .select('id')
            .single();
          if (convErr) {
            errors.push({ phone, error: `insert conversation: ${convErr.message}` });
            continue;
          }
          conversationId = created!.id;
        }
      }

      const inboundRows: any[] = [];
      const outboundRows: any[] = [];
      for (const m of msgs) {
        const pmid = m.messageid ?? m.id;
        if (!pmid) continue;
        const direction = m.fromMe === true ? 'outbound' : 'inbound';
        const row = {
          tenant_id,
          conversation_id: conversationId,
          direction,
          content: m.text ?? m.body ?? m.caption ?? '',
          provider_message_id: String(pmid),
          provider_metadata: m,
          is_ai_generated: false,
          is_internal: false,
          created_at: new Date(msgTimestampMs(m) || Date.now()).toISOString(),
        };
        if (direction === 'inbound') inboundRows.push(row);
        else outboundRows.push(row);
      }

      for (const batch of chunk(inboundRows, BATCH)) {
        const { error, count } = await supabase
          .from('messages')
          .upsert(batch, { onConflict: 'tenant_id,provider_message_id', ignoreDuplicates: true, count: 'exact' });
        if (error) {
          errors.push({ phone, error: `inbound upsert: ${error.message}` });
          skippedCount += batch.length;
        } else {
          const ins = count ?? 0;
          insertedCount += ins;
          skippedCount += batch.length - ins;
        }
      }

      for (const batch of chunk(outboundRows, BATCH)) {
        const ids = batch.map(r => r.provider_message_id);
        const { data: existing } = await supabase
          .from('messages')
          .select('provider_message_id')
          .eq('tenant_id', tenant_id)
          .eq('conversation_id', conversationId)
          .in('provider_message_id', ids);
        const have = new Set((existing ?? []).map((x: any) => x.provider_message_id));
        const toInsert = batch.filter(r => !have.has(r.provider_message_id));
        skippedCount += batch.length - toInsert.length;
        if (toInsert.length) {
          const { error } = await supabase.from('messages').insert(toInsert);
          if (error) {
            errors.push({ phone, error: `outbound insert: ${error.message}` });
            skippedCount += toInsert.length;
          } else {
            insertedCount += toInsert.length;
          }
        }
      }
    }

    return json({
      ok: true,
      contacts_processed: normPhones.length,
      phones_requested: normPhones.length,
      phones_matched: phoneToChatId.size,
      phones_without_chat: normPhones.length - phoneToChatId.size,
      chats_listed: chatsListed,
      chats_found: chatsFound,
      messages_inserted: insertedCount,
      messages_skipped: skippedCount,
      errors,
    });
  } catch (err) {
    console.error('uazapi-history-sync-contacts fatal:', err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
