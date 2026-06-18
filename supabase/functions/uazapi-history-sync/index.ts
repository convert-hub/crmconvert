// uazapi-history-sync: importa histórico de 30 dias de uma instância UAZAPI
// recém-conectada, criando/atualizando conversations e messages do tenant.
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

const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH = 50;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function pickPhoneFromChatId(chatid: string): string {
  return String(chatid || '').replace('@s.whatsapp.net', '').split(/[:@]/)[0];
}

function msgTimestampMs(m: any): number {
  const t = m?.messageTimestamp ?? m?.timestamp ?? m?.t;
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  // segundos -> ms se vier em segundos
  return n < 1e12 ? n * 1000 : n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { tenant_id, instance_id } = await req.json().catch(() => ({}));
    if (!tenant_id || !instance_id) {
      return json({ ok: false, error: 'tenant_id and instance_id required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Passo A — credenciais
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, api_token_encrypted')
      .eq('id', instance_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (!instance) return json({ ok: true, skipped: 'instance not found' });
    const instToken = instance.api_token_encrypted;
    if (!instToken) return json({ ok: true, skipped: 'instance token missing' });

    const { data: key } = await supabase
      .from('global_api_keys')
      .select('api_key_encrypted, metadata')
      .eq('provider', 'uazapi')
      .eq('is_active', true)
      .limit(1)
      .single();
    if (!key) return json({ ok: true, skipped: 'uazapi api key not configured' });
    const apiBase = String((key.metadata as any)?.base_url || '').replace(/\/+$/, '');
    if (!apiBase) return json({ ok: true, skipped: 'uazapi base_url missing' });

    // Passo B — lookup de contatos
    const phoneToContactId = new Map<string, string>();
    {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, phone')
        .eq('tenant_id', tenant_id)
        .not('phone', 'is', null);
      for (const c of contacts ?? []) {
        const norm = normalizeBrazilPhone(c.phone);
        if (norm) phoneToContactId.set(norm, c.id);
      }
    }

    // Passo C — paginação UAZAPI /message/find
    const cutoffMs = Date.now() - CUTOFF_MS;
    const allMessages: any[] = [];
    let stoppedByCutoff = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let resp: Response;
      try {
        resp = await fetch(`${apiBase}/message/find`, {
          method: 'POST',
          headers: { token: instToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: PAGE_SIZE, offset }),
        });
      } catch (err) {
        console.error('uazapi-history-sync: fetch failed', err);
        break;
      }

      if (!resp.ok) {
        console.error(`uazapi-history-sync: /message/find HTTP ${resp.status}`);
        try { console.error('body:', (await resp.text()).slice(0, 500)); } catch {}
        break;
      }

      const data = await resp.json().catch(() => null);
      if (page === 0) {
        console.log('UAZAPI /message/find first page:', JSON.stringify(data).slice(0, 500));
      }

      const list: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.messages) ? data.messages
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.result) ? data.result
        : [];

      if (list.length === 0) break;

      let pageHasRecent = false;
      for (const m of list) {
        const ts = msgTimestampMs(m);
        if (ts >= cutoffMs) {
          allMessages.push(m);
          pageHasRecent = true;
        }
      }

      if (!pageHasRecent) { stoppedByCutoff = true; break; }
      if (list.length < PAGE_SIZE) break;
    }

    // Passo D — agrupar e persistir
    const byChat = new Map<string, any[]>();
    for (const m of allMessages) {
      const cid = m.chatid || m.chatId || m.chat_id || m.from || m.remoteJid;
      if (!cid) continue;
      if (!byChat.has(cid)) byChat.set(cid, []);
      byChat.get(cid)!.push(m);
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let linkedCount = 0;

    for (const [chatid, msgs] of byChat.entries()) {
      // Contato
      const raw = pickPhoneFromChatId(chatid);
      const norm = normalizeBrazilPhone(raw);
      const contactId = norm ? phoneToContactId.get(norm) ?? null : null;
      if (contactId) linkedCount++;

      // Timestamps agregados
      let lastMs = 0, lastInMs = 0, lastOutMs = 0;
      for (const m of msgs) {
        const ts = msgTimestampMs(m);
        if (ts > lastMs) lastMs = ts;
        if (m.fromMe === true) { if (ts > lastOutMs) lastOutMs = ts; }
        else { if (ts > lastInMs) lastInMs = ts; }
      }
      const toIso = (ms: number) => ms ? new Date(ms).toISOString() : null;

      // Conversa
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
            console.error('uazapi-history-sync: insert conversation failed', convErr);
            continue;
          }
          conversationId = created!.id;
        }
      }

      // Construir rows
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

      // Inbound — upsert por (tenant_id, provider_message_id)
      for (const batch of chunk(inboundRows, BATCH)) {
        const { error, count } = await supabase
          .from('messages')
          .upsert(batch, { onConflict: 'tenant_id,provider_message_id', ignoreDuplicates: true, count: 'exact' });
        if (error) {
          console.error('uazapi-history-sync: inbound upsert error', error);
          skippedCount += batch.length;
        } else {
          const ins = count ?? 0;
          insertedCount += ins;
          skippedCount += batch.length - ins;
        }
      }

      // Outbound — pré-check + insert
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
            console.error('uazapi-history-sync: outbound insert error', error);
            skippedCount += toInsert.length;
          } else {
            insertedCount += toInsert.length;
          }
        }
      }
    }

    return json({
      ok: true,
      chats: byChat.size,
      messages_inserted: insertedCount,
      messages_skipped: skippedCount,
      contacts_linked: linkedCount,
      stopped_by_cutoff: stoppedByCutoff,
    });
  } catch (err) {
    console.error('uazapi-history-sync fatal:', err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
