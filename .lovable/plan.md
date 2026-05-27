# Normalização de telefones BR + dedup de contatos (revisado)

Ajustes aplicados: race-safe insert (23505 fallback), FKs reais verificadas, `CREATE UNIQUE INDEX` sem `CONCURRENTLY`, log de divergência em `wa-meta-send`.

## FKs reais para `public.contacts.id` (verificadas via `pg_constraint`)

| Tabela | ON DELETE |
|---|---|
| `opportunities` | SET NULL |
| `activities` | SET NULL |
| `flow_executions` | SET NULL |
| `conversations` | SET NULL |
| `campaign_recipients` | CASCADE |

A migration de dedup precisa reapontar todas as 5 antes de deletar duplicatas (CASCADE em `campaign_recipients` significa que apagar duplicado sem reapontar destruiria recipients válidos).

## 1. `src/lib/phone.ts` + `supabase/functions/_shared/phone.ts`

Conteúdo idêntico. Exporta:
- `normalizeBrazilPhone(input): string` — só dígitos (sem `+`):
  1. Strip não-dígitos, remove zeros à esquerda.
  2. `55` + 12 dígitos e 5º dígito ∈ {6,7,8,9} → insere `9` após DDD → 13.
  3. 11 dígitos com DDD BR válido → prefixa `55`.
  4. 10 dígitos com DDD BR válido + local começando 6–9 → insere `9` e prefixa `55`.
  5. Caso contrário (não-BR / já 13 com 55) → só dígitos.
  6. Vazio / `null` / < 8 dígitos pós-strip → `""`.
- `phoneDigitsOnly(input): string` — strip puro.

DDDs válidos: lista ANATEL hardcoded.

## 2. Aplicar `normalizeBrazilPhone` em todos os writes

**Race-safe insert** (ajuste 1): em todos os webhooks, ao tentar `insert` em `contacts` e receber Postgres `23505` (unique violation), refazer `SELECT … WHERE tenant_id=? AND phone=?` e usar o ID retornado. Defende contra dois webhooks simultâneos para o mesmo phone.

Padrão helper compartilhado em `supabase/functions/_shared/phone.ts`:
```ts
export async function upsertContactByPhone(supabase, tenantId, phone, extra) {
  const norm = normalizeBrazilPhone(phone);
  const { data: existing } = await supabase.from('contacts').select('id').eq('tenant_id', tenantId).eq('phone', norm).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from('contacts').insert({ tenant_id: tenantId, phone: norm, ...extra }).select('id').single();
  if (error?.code === '23505') {
    const { data: race } = await supabase.from('contacts').select('id').eq('tenant_id', tenantId).eq('phone', norm).single();
    return race;
  }
  return data;
}
```

Edge functions a editar:
- `webhook-meta/index.ts` — normalizar `fromPhone`, usar fallback 23505 no insert (linhas 158–188).
- `webhook-uazapi/index.ts` — normalizar `phone`, fallback 23505 (linhas 207–223).
- `webhook-flow-trigger/index.ts` — normalizar `phone`, fallback 23505 (linhas 102–128).
- `webhook-meta-leads/index.ts` e `webhook-form-intake/index.ts` — hoje só enfileiram job (não escrevem em contacts). Documentar no resumo que o worker (`worker/automation-handler.js`) é quem cria contato; auditar no worker e aplicar mesmo padrão race-safe.
- `wa-meta-send/index.ts` — substituir `normalizePhone` local por `normalizeBrazilPhone`. **Ajuste 4**: antes do `messagePayload.to`, comparar com `body.to` original; se diferente, `console.log("[wa-meta-send] phone normalized", { original: body.to, normalized: norm })`. Sem bloqueio.

Frontend:
- `src/pages/ContactsPage.tsx` (linhas 91, 95) — normalizar `form.phone` antes do save.
- `src/components/contacts/ImportContactsDialog.tsx` — substituir `normalizePhone` local (linha 57) por `normalizeBrazilPhone`; aplicar no lookup (linha 130) também.
- Demais arquivos auditados (`InboxPage`, `CampaignsPage`, `CampaignDetailPage`) só leem/atualizam name — sem mudança.

Tratamento de erro 23505 no frontend: `ContactsPage` e `ImportContactsDialog` capturam `error.code === '23505'` e mostram toast pt-BR: "Já existe um contato com este número."

## 3. Migration 1 — função SQL + backfill (aplicar via tool)

`<ts>_normalize_contacts_phone.sql`:
- `CREATE OR REPLACE FUNCTION public.normalize_brazil_phone(text) RETURNS text LANGUAGE plpgsql IMMUTABLE` — lógica equivalente, sem SECURITY DEFINER.
- `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_raw_pre_normalization text;`
- `UPDATE contacts SET phone_raw_pre_normalization = phone WHERE phone_raw_pre_normalization IS NULL;`
- `UPDATE contacts SET phone = normalize_brazil_phone(phone) WHERE phone IS NOT NULL AND phone <> normalize_brazil_phone(phone);`
- **Sem UNIQUE ainda, sem trigger ainda.**

## 4. Migration 2 — dedup (gerar como arquivo, NÃO aplicar)

`<ts+1>_dedup_contacts_phone.sql` salvo no repo mas não rodado. Antes de gerar, executar via `supabase--read_query` a query de pré-visualização e incluir resultado no resumo:
```sql
SELECT tenant_id, phone, count(*) AS dup_count, array_agg(id ORDER BY created_at)
FROM contacts WHERE phone IS NOT NULL AND phone <> ''
GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC;
```

SQL da migration (idempotente):
1. CTE `canonical` por `(tenant_id, phone)`: vencedor = `MIN(created_at)`, desempate `source NOT LIKE 'whatsapp_%' OR source IS NULL` primeiro.
2. CTE `dups` com mapping `dup_id → canonical_id`.
3. `UPDATE` nas 5 FKs (`conversations`, `opportunities`, `activities`, `flow_executions`, `campaign_recipients`) reapontando `contact_id`.
4. `UPDATE contacts c SET name = COALESCE(NULLIF(c.name, c.phone), d.name), utm_source = COALESCE(c.utm_source, d.utm_source), ad_id = COALESCE(c.ad_id, d.ad_id), email = COALESCE(c.email, d.email), notes = COALESCE(c.notes, d.notes)` etc., mesclando do dup para o canônico.
5. `DELETE FROM contacts WHERE id IN (dup_ids)`.

## 5. Migration 3 — unique + trigger (aplicar via tool depois de dedup)

`<ts+2>_contacts_phone_unique.sql`:
- **Ajuste 3**: `CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_unique ON contacts(tenant_id, phone) WHERE phone IS NOT NULL AND phone <> '';` — sem `CONCURRENTLY`, roda na transação Lovable normal.
- Trigger `BEFORE INSERT OR UPDATE OF phone` em `contacts`: `NEW.phone := normalize_brazil_phone(NEW.phone);` — defesa em profundidade.

> Entregue como arquivo pronto; só aplicar após o dedup ser revisado e rodado manualmente.

## 6. Testes

`src/lib/phone.test.ts` (vitest) cobrindo os 11 casos do pedido. Rodar `bunx vitest run src/lib/phone.test.ts`.

## Entregáveis

1. `src/lib/phone.ts`, `supabase/functions/_shared/phone.ts`, `src/lib/phone.test.ts`.
2. Edits em 4 edge functions + 2 arquivos do frontend.
3. Migration 1 aplicada via tool.
4. Migrations 2 e 3 commitadas como arquivos `.sql` no repo, **não aplicadas**.
5. Resumo final: arquivos modificados, FKs confirmadas (tabela acima), output da query de pré-visualização do dedup, próximos passos.

## Fora de escopo

Worker (será auditado em separado se confirmar criação de contact), refator UAZAPI, mudança de RLS, dedup automático, outras colunas com phone (`companies.phone`).
