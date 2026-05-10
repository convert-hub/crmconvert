## Objetivo

Permitir que UAZAPI e Meta Cloud API coexistam ativas no mesmo tenant, com **roteamento automático por conversa** + **seletor de instância** quando há mais de uma opção. Nada de remover UAZAPI — apenas adicionar a camada de decisão.

## Princípio do roteamento

A `conversations.whatsapp_instance_id` é a fonte da verdade. A partir dela lemos `whatsapp_instances.provider` e despachamos:

```text
provider = 'meta_cloud'  → wa-meta-send  (envio + upload + download via Graph)
provider = 'uazapi'      → uazapi-proxy  (comportamento atual)
provider null/ausente    → fallback para UAZAPI (compat retroativa)
```

Conversas novas precisam escolher a instância na criação se houver mais de uma ativa.

---

## Mudanças

### 1. Helper centralizado de roteamento (frontend)

Criar `src/lib/whatsappRouter.ts` com:

- `getInstanceProvider(conversationId)` — busca `conversations.whatsapp_instance_id` e retorna `{ instance_id, provider }`.
- `sendText({ conversationId, phone, text })` — escolhe edge function correta.
- `sendMedia({ conversationId, phone, file, mediaType, caption })` — idem (faz upload Meta quando `meta_cloud`).
- `downloadMedia({ conversationId, providerMessageId, instanceId? })` — para Meta usa `wa-meta-send action=download_media` (a criar); para UAZAPI mantém atual.

Esse helper concentra a lógica e padroniza retornos `{ ok, provider_message_id, error }`.

### 2. ChatPanel — usar o router

Substituir as 3 chamadas diretas a `uazapi-proxy` (linhas 96, 365, 443) por `whatsappRouter.*`. Sem mudança de UX.

### 3. wa-meta-send — adicionar ações faltantes

- `action: 'download_media'` — recebe `media_id` (extraído de `provider_metadata.meta_media_id`), chama `GET /{media_id}` no Graph, baixa o binário, retorna base64 + mimetype. Tratamento de "expirado" devolvendo `{ ok:false }` igual ao padrão UAZAPI (sem crashar).
- `action: 'send_media'` por upload de arquivo (base64) — já existe `upload_media` por URL; adicionar variante que aceita `media_base64` direto e depois envia.

### 4. Seletor de instância na criação de conversa

`StartConversationDialog`: quando o canal for `whatsapp` e o tenant tiver **2+ instâncias ativas** (somando providers), exibir `<Select>` "Número de envio" listando `whatsapp_instances` ativas (display_name + badge UAZAPI/Meta). Persistir em `conversations.whatsapp_instance_id` no insert.

Se houver só 1 instância ativa, seleciona automaticamente sem mostrar o campo.

### 5. SettingsPage — visão unificada

Garantir que `MetaCloudConnectionsCard` e o card UAZAPI existente fiquem visíveis lado a lado com explicação "Você pode usar ambos simultaneamente; cada conversa fica vinculada ao número que recebeu/iniciou o contato."

### 6. ScheduleMessageDialog + check-scheduled-messages

`check-scheduled-messages` hoje sempre enfileira `send_whatsapp` (worker UAZAPI). Mudar para:

1. Ler `conversation.whatsapp_instance_id` + provider.
2. Se `meta_cloud` → invocar `wa-meta-send` direto (não passa pelo worker).
3. Caso contrário → mantém `enqueue_job send_whatsapp`.

### 7. ChatPanel — indicador visual

No header da conversa, mostrar pequeno badge: "via WhatsApp Oficial" ou "via UAZAPI" (cinza, sutil) baseado no provider. Ajuda o atendente a saber por qual número está respondendo.

### 8. Compat retroativa

Conversas antigas sem `whatsapp_instance_id` continuam roteando via UAZAPI (comportamento atual). Nenhuma migração de dados necessária.

---

## Detalhes técnicos

- Nenhuma mudança de schema. Tudo se apoia em colunas existentes (`whatsapp_instances.provider`, `conversations.whatsapp_instance_id`).
- `wa-meta-send` ganha 2 novas actions; manter assinatura `{ ok, error, ... }` compatível com o padrão UAZAPI para o router não precisar de branches.
- Cache de mídia (`mediaCache` no ChatPanel) continua funcionando — chave segue sendo `provider_message_id`.
- Edge function `check-scheduled-messages` precisa do `Authorization: Bearer <SERVICE_ROLE>` ao invocar `wa-meta-send` (que valida JWT). Alternativa mais limpa: tornar `wa-meta-send` aceitar uma chamada interna autenticada por service role detectando `req.headers.get('x-internal-call')` + comparação com env. Vou implementar passando service-role no Authorization (mais simples e já usado em outros pontos).

---

## Arquivos afetados

**Novos**
- `src/lib/whatsappRouter.ts`

**Editados**
- `src/components/inbox/ChatPanel.tsx` (3 call sites + badge no header)
- `src/components/crm/StartConversationDialog.tsx` (seletor de instância)
- `supabase/functions/wa-meta-send/index.ts` (actions `download_media`, `send_media` base64)
- `supabase/functions/check-scheduled-messages/index.ts` (roteamento por provider)

**Não muda**
- `webhook-meta`, `webhook-uazapi`, `campaign-dispatch`, `uazapi-proxy`, schema do banco.

---

## Resultado para o usuário

- Tenant pode cadastrar UAZAPI **e** Meta simultaneamente.
- Cada conversa fica "amarrada" ao número/provider pelo qual entrou.
- Ao iniciar conversa nova, escolhe pelo qual número quer mandar.
- Inbox mostra qual provider está em uso na conversa.
- Campanhas e templates continuam usando Meta (já estava ok).
- Mensagens agendadas respeitam o provider da conversa.