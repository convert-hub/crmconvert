# Plano: importação de histórico UAZAPI ao conectar instância

## 1. Nova edge function `supabase/functions/uazapi-history-sync/index.ts`

POST `{ tenant_id, instance_id }`. Cliente com `SUPABASE_SERVICE_ROLE_KEY`. CORS padrão.

### Passo A — Credenciais
- `whatsapp_instances` por `id = instance_id` e `tenant_id` → `instToken = api_token_encrypted`. Se não achar → `{ ok: true, skipped: 'instance not found' }`.
- `global_api_keys` com `provider='uazapi'`, `is_active=true`, limit 1 → `apiBase = metadata.base_url.replace(/\/+$/, '')`.

### Passo B — Lookup de contatos
- `SELECT id, phone FROM contacts WHERE tenant_id=? AND phone IS NOT NULL`.
- `Map<normalizeBrazilPhone(phone), id>` (helper de `_shared/phone.ts`).

### Passo C — Paginação `POST ${apiBase}/message/find`
- Headers `{ token: instToken, 'Content-Type': 'application/json' }`, body `{ limit: 100, offset }`.
- Cutoff 30 dias. Stop em: página vazia / todas antes do cutoff / 10 páginas / HTTP error (log + parada graciosa).
- Log: `console.log('UAZAPI /message/find first page:', JSON.stringify(firstPage).slice(0, 500))`.

### Passo D — Persistência

Agrupar por `chatid`. Para cada chat:

1. **Contato**: `raw = chatid.replace('@s.whatsapp.net','').split(/[:@]/)[0]`; `normalizeBrazilPhone(raw)`; lookup → `contactId | null`.
2. **Conversa**: `SELECT id FROM conversations WHERE tenant_id=? AND whatsapp_instance_id=? AND provider_chat_id=? maybeSingle()`. Se não existir, inserir com `channel:'whatsapp'`, `status:'open'`, `unread_count:0`, `is_unanswered:false`, e `last_message_at`/`last_customer_message_at`/`last_agent_message_at` calculados a partir das mensagens do chat.
3. **Mensagens** (`provider_message_id = msg.messageid ?? msg.id`, skip se vazio; `direction = msg.fromMe ? 'outbound' : 'inbound'`; `created_at = new Date(msg.messageTimestamp * 1000).toISOString()`; `content = msg.text ?? msg.body ?? msg.caption ?? ''`; `provider_metadata = msg`):
   - Inbound: `.upsert(batch, { onConflict: 'tenant_id,provider_message_id', ignoreDuplicates: true })` em lotes de 50.
   - Outbound: pré-check `SELECT id WHERE tenant_id=? AND conversation_id=? AND provider_message_id IN (...)`, filtrar, insert do restante em batch.

### Passo E — Retorno
`{ ok: true, chats, messages_inserted, messages_skipped, contacts_linked }`.

## 2. `supabase/config.toml`
Adicionar:
```toml
[functions.uazapi-history-sync]
verify_jwt = false
```

## 3. Trigger em `webhook-uazapi/index.ts` (mudança mínima)

`instanceId` já existe no escopo do handler principal onde `handleConnectionEvent` é chamado (linha ~78). **Sem alterar a assinatura**, adicionar logo após a chamada:

```ts
await handleConnectionEvent(supabase, tenantId, body);
// Fire-and-forget: sync de histórico ao conectar
const evStatus = body.instance?.status || body.type || body.Type;
if (evStatus === 'connected' && instanceId) {
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/uazapi-history-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ tenant_id: tenantId, instance_id: instanceId }),
  }).catch(() => {});
}
```

Sem `await` no fetch. Nenhuma outra alteração no webhook.

## 4. Restrições
- Todas as queries filtram por `tenant_id`.
- Sem migration — apenas colunas existentes.
- Helper de telefone reaproveitado de `_shared/phone.ts`.
