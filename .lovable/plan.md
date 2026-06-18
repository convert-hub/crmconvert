Plano aprovado — preciso do modo Build para aplicar as mudanças e rodar o backfill.

## A. `supabase/functions/webhook-uazapi/index.ts`
Logo após o log `saved ... inbound`, dentro do `if (!fromMe)`: buscar `campaign_recipients` mais recente (`tenant_id + contact_id`, `status ∈ ('sent','delivered','read')`, `sent_at` nos últimos 30 dias, `order sent_at desc limit 1`) e atualizar para `status='replied'`, `replied_at=now()`. Try/catch, best-effort.

## B. `supabase/functions/webhook-meta/index.ts`
Mesmo bloco aplicado após o `insert` do inbound (~linha 339), usando `tenantId` e `contact.id` já disponíveis no escopo.

## C. `supabase/functions/campaign-dispatch/index.ts`
No branch `action === 'start'`, após `UPDATE campaigns SET status='running'`, responder imediatamente com `jsonOk({ ok: true, status: 'running' })` e mover todo o restante do processamento (lease + claim + loop) para dentro de `EdgeRuntime.waitUntil((async () => { ... })())`. Para `action === 'tick'` (cron) manter síncrono. Resultado: clique em "Pausar" fica disponível em <1s.

## D. Backfill retroativo (via supabase--insert, uma única vez)
```sql
WITH first_replies AS (
  SELECT cr.id, MIN(m.created_at) AS first_reply_at
    FROM public.campaign_recipients cr
    JOIN public.conversations conv
      ON conv.contact_id = cr.contact_id AND conv.tenant_id = cr.tenant_id
    JOIN public.messages m
      ON m.conversation_id = conv.id
     AND m.tenant_id = cr.tenant_id
     AND m.direction = 'inbound'
     AND COALESCE(m.is_internal, false) = false
     AND m.created_at > cr.sent_at
     AND m.created_at < cr.sent_at + interval '30 days'
   WHERE cr.status IN ('sent','delivered','read')
     AND cr.sent_at IS NOT NULL
   GROUP BY cr.id
)
UPDATE public.campaign_recipients cr
   SET status = 'replied', replied_at = fr.first_reply_at, updated_at = now()
  FROM first_replies fr
 WHERE cr.id = fr.id;
```
Seguido por `SELECT public.recompute_campaign_counters(id) FROM public.campaigns;` para garantir os contadores agregados.

Tudo escopado por `tenant_id` em todas as queries. A trigger existente cuida do `replied_count` incrementalmente.
