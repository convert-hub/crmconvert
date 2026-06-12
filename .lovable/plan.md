# Plano aprovado — Webhooks de leads (FB Lead Ads + formulário)

## Diagnóstico
Os handlers `process_form_webhook` e `process_meta_lead` já existem em `worker/index.js` (linhas 24 e 81), mas:
- `process_meta_lead` só lê formato Graph API cru — payload flat do Make cai em `undefined`.
- Não respeitam o contrato `{name, phone, email, source, campaign, extra, lead_id?}`.
- Não fazem dedup de oportunidade aberta (criam nova a cada lead).
- Não marcam `webhook_events.processed`.
- `process_form_webhook` chama `.update()` no contato existente, sobrescrevendo dados.
- URL na tela de Integrações vai sem `tenant_id` → function rejeita.

## Ajustes obrigatórios incorporados

### 1) Idempotência por `external_id`
- **Meta:** prefere `body.lead_id` (campo adicionado ao contrato flat) → fallback `entry[0].changes[0].value.leadgen_id`.
- **Form genérico:** `sha256(phoneDigits + "|" + campaign + "|" + YYYY-MM-DD UTC)` — permite re-entrada do mesmo lead em dias diferentes.
- UNIQUE parcial `webhook_events(tenant_id, source, external_id) WHERE external_id IS NOT NULL`.

### 2) Token via header (não query)
- Aceita `x-webhook-token` (recomendado) **e** `?token=` (fallback, documentado como inseguro pois vaza em logs).
- Tela de Integrações instrui o uso do header.

### 3) Upsert sem sobrescrever contato existente
- `upsertContactByPhone` (já race-safe, só insere se ausente) — preserva nome/status/email.
- Remove o `.update()` que rebaixava status/sobrescrevia nome.
- Para contato existente com oportunidade aberta: cria atividade na oportunidade.
- Sem oportunidade aberta: cria nova no pipeline configurado.

## Pontos confirmados
- `contacts` já tem colunas `utm_source/medium/campaign/content/term` → grava direto, sem `custom_fields`.
- RLS `tenants UPDATE` exige `has_tenant_role(id, 'admin')` → UI desabilita botões para não-admin.

## Arquivos

**Migration (já aplicada):**
- `webhook_events.external_id TEXT`
- UNIQUE parcial `(tenant_id, source, external_id)`
- Index parcial `opportunities(tenant_id, contact_id) WHERE status='open'`

**Edge Functions reescritas:**
- `supabase/functions/webhook-meta-leads/index.ts`
- `supabase/functions/webhook-form-intake/index.ts`
  - Validam tenant + token (header > query).
  - Calculam `external_id` e tratam `23505 → {duplicated:true}`.
  - Enfileiram job só para evento novo. GET = healthcheck.

**Worker (`worker/index.js`):**
- Novo helper `processLeadIntake({ tenant_id, event_id, source_default, raw })`:
  1. Checa `webhook_events.processed` — se true, skip.
  2. Parser flat com fallback para Graph API.
  3. `normalizeBrazilPhone` + `upsertContactByPhone` (não sobrescreve campo existente).
  4. Resolve pipeline: `tenants.settings.lead_default_pipeline_id` → `is_default` → primeiro por `position`. Estágio = menor `position`.
  5. Busca oportunidade aberta do contato → cria atividade OU cria oportunidade nova.
  6. Dispara `executeAutomations('lead_created')` + `triggerLeadCreatedFlows`.
  7. Marca `webhook_events.processed=true` (ou `processing_error` em catch).
- Reescreve `process_form_webhook` e `process_meta_lead` chamando o helper.

**Frontend:**
- `src/components/settings/LeadWebhooksCard.tsx` (novo): URLs prontas com `tenant_id` + token opcional, botão copiar, gerar/regenerar/remover token (admin-only), selector de pipeline destino, contrato JSON em `<details>`.
- `src/pages/SettingsPage.tsx`: troca o Card antigo de Webhooks por `<LeadWebhooksCard />` + import.

**Não tocado:** `ChatPanel`, `whatsappRouter`, `wa-meta-send`, `webhook-meta`, `webhook-uazapi`.

**Operacional:** worker é processo Node em container — após alterar `worker/index.js` é necessário rebuild/restart do serviço worker.
