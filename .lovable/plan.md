## Objetivo
Notificar atendentes via WhatsApp (UAZAPI do próprio tenant) quando um **novo lead** for criado por (a) mensagem inbound do WhatsApp ou (b) automação de palavra-chave. Nunca por criação manual/importação. Configurável por admin, opcional, silencioso quando faltar UAZAPI.

---

## 1. Schema / Configuração

**Sem migration de tabela** — reaproveita `tenants.settings` (jsonb).

Chave nova: `settings.lead_notifications`:
```json
{
  "enabled": false,
  "triggers": { "inbound": true, "keyword": true },
  "recipient_membership_ids": []
}
```

**Idempotência**: em vez de nova tabela, usar `contacts.custom_fields.lead_notified_at` (timestamp ISO). Um único UPDATE condicional `where id=? and (custom_fields->>'lead_notified_at') is null` garante trava atômica sem race (usar `.is('custom_fields->lead_notified_at', null)` no PostgREST). Se o UPDATE retornar 0 linhas → já notificado, sair.

Nenhuma trigger de banco (não distingue origem).

---

## 2. Nova Edge Function: `supabase/functions/notify-new-lead/index.ts`

- `verify_jwt = false` (adicionar em `supabase/config.toml`).
- Autenticação interna: exigir header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; qualquer outro valor → 401.
- Input (zod): `{ tenant_id: uuid, contact_id: uuid, trigger: 'inbound' | 'keyword' }`.
- Fluxo:
  1. Ler `tenants.settings.lead_notifications`. Se `enabled !== true` ou `triggers[trigger] !== true` → 200 `{ skipped: 'disabled' }`.
  2. Trava idempotência via UPDATE condicional em `contacts.custom_fields` (merge preservando outras chaves com `jsonb_set` — usar RPC ou update com objeto reconstruído lido antes). Se já notificado → 200 `{ skipped: 'already_notified' }`.
  3. Buscar instância UAZAPI ativa: `whatsapp_instances` where `tenant_id`, `provider='uazapi'`, `is_active=true` limit 1. Se não houver → log + 200 `{ skipped: 'no_uazapi' }`.
  4. Buscar destinatários: `tenant_memberships` (ativos, in `recipient_membership_ids`) join `profiles(phone, full_name)`. Filtrar `phone` não nulo; logar warning dos sem telefone.
  5. Buscar `contacts` (name, phone, source) do lead.
  6. Montar mensagem pt-BR:
     ```
     🟢 Novo lead recebido!
     Nome: {name}
     Telefone: {phone}
     Origem: {'Mensagem recebida' | 'Palavra-chave'}
     Abra o CRM para atender.
     ```
  7. Para cada telefone: `POST {instance.api_url}/send/text` com header `token: instance.api_token_encrypted`, body `{ number: <digits>, text, delay: 0 }`. Try/catch por destinatário; logar falhas e seguir. Nunca throw.
  8. Responder 200 `{ sent, failed, skipped_no_phone }`.

Reuso: helper de normalização de telefone (`../_shared/phone.ts` já existe).

---

## 3. Ganchos

### A) `supabase/functions/webhook-uazapi/index.ts`
No bloco `if (!contact) { insert ... }` (linhas ~230-244), **apenas no ramo `newContact` (não no race-recovered, não quando `fromMe`)**, disparar fire-and-forget:
```ts
if (!fromMe && contact && contact.id === newContact?.id) {
  EdgeRuntime.waitUntil(
    fetch(`${SUPABASE_URL}/functions/v1/notify-new-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ tenant_id: tenantId, contact_id: contact.id, trigger: 'inbound' }),
    }).catch(e => console.error('notify-new-lead inbound failed', e))
  );
}
```
Não chamar no ramo `existingContacts?.[0]` nem em `race-recovered`.

### B) `worker/index.js` — `checkKeywordAndActivateAi` (~linha 2254)
Logo após o log `Created opportunity and activity for contact ...`:
```js
fetch(`${process.env.SUPABASE_URL}/functions/v1/notify-new-lead`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  body: JSON.stringify({ tenant_id: tenantId, contact_id: contactId, trigger: 'keyword' }),
}).catch(err => console.error('[Worker] notify-new-lead keyword failed', err));
```
Bloco já é gated por "não havia oportunidade aberta" → trava natural. A idempotência da edge cobre o caso de inbound+keyword no mesmo lead.

Nenhum outro insert de `contacts` é tocado (manual/importação continuam silenciosos).

---

## 4. UI

### a) Campo "Telefone (WhatsApp)" no perfil do usuário
Localizar tela de perfil atual (provavelmente em `SettingsPage.tsx` / componente de perfil). Adicionar input com máscara BR gravando `profiles.phone`. Validação via `normalizeBrazilPhone` (`src/lib/phone.ts`). Texto de apoio: "Número usado para receber notificações de novos leads."

### b) Novo card `src/components/settings/LeadNotificationsCard.tsx`
Padrão visual do `LeadWebhooksCard`:
- Switch **Ativar notificações** (`enabled`).
- Dois switches de gatilho: **Mensagem recebida (webhook)**, **Palavra-chave**.
- Multi-seletor de atendentes: lista `tenant_memberships` ativos (join profiles pra mostrar nome + telefone). Badge âmbar "sem telefone" ao lado de quem faltar `profiles.phone`. Grava `recipient_membership_ids`.
- Somente `role === 'admin'` edita; outros veem read-only.
- Persiste via `update tenants set settings = jsonb_set(...)` mantendo demais chaves.

Registrar o card na `SettingsPage.tsx` ao lado do `LeadWebhooksCard`.

---

## 5. Ordem de execução

1. `supabase/functions/notify-new-lead/index.ts` (+ entrada em `config.toml`).
2. Gancho no `webhook-uazapi` (apenas no ramo de contato novo, não `fromMe`).
3. Gancho no `worker/index.js` dentro do bloco de criação de oportunidade por keyword.
4. Campo `phone` na UI de perfil.
5. `LeadNotificationsCard` + registro em `SettingsPage`.
6. Teste manual: (a) ativar, escolher 1 atendente com telefone, enviar mensagem de número novo → recebe notificação; (b) mesmo lead disparando keyword depois → não duplica; (c) tenant sem UAZAPI → skip silencioso.

---

## Riscos e mitigações

1. **Duplicação inbound+keyword** — resolvida pela trava atômica em `contacts.custom_fields.lead_notified_at`.
2. **Race em criação de contato** — só notifica no ramo `newContact` (não em race-recovered nem existente).
3. **Perda de outras chaves em `custom_fields`** — merge feito lendo antes e reescrevendo objeto, ou via `jsonb_set` explícito.
4. **Preservar outras chaves em `settings`** — mesmo padrão do `LeadWebhooksCard` (spread do settings atual + patch).
5. **UAZAPI ausente / envio falho** — nunca lançar erro; sempre 200 com `skipped/failed` para não travar o webhook chamador.
6. **`fromMe`** — não notificar mensagens enviadas pelo próprio operador (checar antes do fire-and-forget).
7. **Importação/criação manual** — não são tocadas; nenhum trigger de banco.
8. **Segurança da edge** — só aceita chamadas com `SUPABASE_SERVICE_ROLE_KEY`; nunca exposta ao front.
