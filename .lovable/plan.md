## Correção do plano anterior

Auditei os três alvos e o que eu havia listado para `webhook-meta-leads` / `webhook-form-intake` estava **errado**: essas duas edge functions NÃO escrevem em `contacts` — só salvam `webhook_events` e enfileiram job (`process_meta_lead` / `process_form_webhook`). Quem cria/atualiza contatos a partir desses eventos é o **worker** (`worker/index.js`).

Portanto a normalização precisa entrar no worker, não nessas edge functions.

## Achados da auditoria

### `supabase/functions/webhook-meta-leads/index.ts`
Apenas insert em `webhook_events` + `rpc('enqueue_job', ...)`. **Nada a fazer.**

### `supabase/functions/webhook-form-intake/index.ts`
Mesmo padrão. **Nada a fazer.**

### `worker/automation-handler.js`
Só faz `select` / `update` em `contacts` por `id` (tags, status, assigned_to). **Não cria contatos** e **não altera `phone`**. **Nada a fazer.**

### `worker/index.js` (TEM problema — 3 sites)
Atualmente usa `normalizePhone` local que devolve `+5511...` (com `+`) — incompatível com nossa normalização digits-only. Consequência depois das migrations: `findContact` nunca casa (busca `+...`, banco guarda `55...`), insert dispara 23505, worker quebra.

Inserts/lookups afetados:
- linha 25-45 — `process_form_webhook`
- linha 81-100 — `process_meta_lead`
- linha 294-310 — fluxo WhatsApp (sender → contato)

Helpers compartilhados:
- linha 1411 — `normalizePhone`
- linha 1420 — `findContact`

## Mudanças propostas

### 1. Novo arquivo `worker/lib/phone.js` (CommonJS)
Espelho 1:1 de `src/lib/phone.ts` / `supabase/functions/_shared/phone.ts`:
- mesmo `VALID_BR_DDDS`
- `normalizeBrazilPhone(input)` com mesma lógica (digits-only, sem `+`)
- `phoneDigitsOnly(input)`
- `upsertContactByPhone(supabase, tenantId, phoneRaw, extra)` com fallback 23505

Não importo o `.ts` pra não introduzir transpile no Node. Cópia explícita, com comentário apontando o arquivo-fonte de verdade.

### 2. `worker/index.js`
- Trocar `normalizePhone` local pelo `normalizeBrazilPhone` do novo módulo (mesmo nome de variável local pra minimizar diff).
- `findContact`: continua igual (já busca por `.eq('phone', phone)`), mas agora `phone` chega normalizado digits-only.
- Nos 3 sites de insert (`form_webhook`, `facebook_lead_ads`, `whatsapp`), envolver o `insert` com try/catch e, em erro `code === '23505'`, refazer `select * from contacts where tenant_id=? and phone=?` e seguir com o existente — ou simplesmente trocar `findContact + insert` por `upsertContactByPhone` quando os campos extras encaixarem direto.

### 3. `worker/automation-handler.js`
Nenhuma alteração. Documentado no resumo final.

### 4. Edge functions de webhook (leads / form-intake)
Nenhuma alteração. Plano anterior tinha um erro — corrijo aqui.

## Diff resumido (worker/index.js)

```text
- function normalizePhone(phone) {
-   ...lógica antiga +5511...
- }
+ const { normalizeBrazilPhone, upsertContactByPhone } = require('./lib/phone');
+ const normalizePhone = normalizeBrazilPhone; // alias p/ minimizar diff

  // process_form_webhook
- const { data: c } = await supabase.from('contacts').insert({
-   tenant_id, name, phone, email, source: 'form_webhook', ...
- }).select().single();
+ const c = await upsertContactByPhone(supabase, tenant_id, phone, {
+   name, email, source: 'form_webhook', ...
+ }, '*');

  // idem process_meta_lead e fluxo whatsapp
```

(Detalhes: nos 2 primeiros sites o contato pode chegar sem phone — manter caminho legado por email; só usar upsert quando phone presente.)

## Re-preview de dedup (pós-backfill, atual)

25 grupos duplicados, 27 contatos a serem mesclados (2 grupos com 3 ids, 23 com 2):

```text
tenant 770531cc-...  6 grupos  (inclui o caso 5531980175217 da SOS? — não, SOS é 4c4064bd)
tenant 3e1d7df9-...  9 grupos
tenant cab34c54-...  8 grupos
tenant 4c4064bd-... (SOS)  1 grupo — 5531980175217 (o caso original do bug)
tenant af071ce4-...  1 grupo
```

O caso reproduzido em produção (SOS, `5531980175217`) aparece confirmado: 2 ids (`dcabc211...` cadastrado manualmente, `9698bd51...` criado pelo webhook).

## FKs em `contacts.id` (confirmadas via `pg_constraint`)

| Tabela | ON DELETE |
|---|---|
| `conversations` | SET NULL |
| `opportunities` | SET NULL |
| `activities` | SET NULL |
| `flow_executions` | SET NULL |
| `campaign_recipients` | CASCADE ⚠ |

Migration 2 (dedup) **precisa reapontar todas as 5** antes do delete, senão `campaign_recipients` válidos são destruídos por cascade.

## Próximos passos manuais (depois deste loop)

1. Você revisa o diff do worker.
2. Rebuild + redeploy do worker (process Node não recarrega sozinho).
3. Aplica `supabase/migrations_pending/20260527004300_dedup_contacts_phone.sql`.
4. Aplica `supabase/migrations_pending/20260527004400_contacts_phone_unique.sql`.
5. Roda a query de verificação (`SELECT ... GROUP BY ... HAVING COUNT>1` → deve retornar 0).

## Fora de escopo

- `companies.phone` (outra tabela, fora do bug).
- Refator UAZAPI além do mínimo.
- Aplicar as 2 migrations pending automaticamente.
- Mexer em RLS.
