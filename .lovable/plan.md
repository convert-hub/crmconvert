## Problema

Hoje não há como dizer "este fluxo deve enviar pelo número X". O worker decide o número assim:
1. Se a execução já tem `conversation_id` → usa o número daquela conversa.
2. Senão → pega o **primeiro** número ativo do tenant (imprevisível com múltiplos números).

Resultado: fluxos disparados por webhook, sequência ou lead novo (sem conversa) saem por um número aleatório.

## Solução

Adicionar seletor de número (WhatsApp instance) nos lugares onde o disparo cria a conversa:

- **Fluxo (chatbot_flows)** — número padrão do fluxo.
- **Sequência (message_sequences)** — número da campanha de mensagens.
- **Webhook (webhook_endpoints)** — número usado quando o webhook dispara um fluxo.

Regra de resolução final no worker (ordem de prioridade):
1. Instance explicitamente passado no payload da ação.
2. Instance da conversa (quando já existe).
3. **Instance configurado no fluxo** (novo).
4. Primeiro instance ativo do tenant (fallback atual).

## Mudanças

### Banco
- `chatbot_flows.whatsapp_instance_id uuid null`
- `message_sequences.whatsapp_instance_id uuid null`
- `webhook_endpoints.whatsapp_instance_id uuid null`

### UI
- **FlowBuilderPage**: no painel lateral de configuração do fluxo (onde já tem nome/trigger/ativo), adicionar `Select` "Número de WhatsApp" listando as instâncias ativas do tenant. Opção "Automático (padrão do tenant / da conversa)".
- **SequencesTab**: mesmo seletor no editor da sequência.
- **WebhookEditor**: mesmo seletor no header (ao lado do switch Ativo).

### Worker / Edge functions
- `worker/index.js` `send_whatsapp` e `send_whatsapp_template`: aceitar fallback do `flow.whatsapp_instance_id` quando não vier no payload nem na conversa. Para isso, ao enfileirar a action `send_whatsapp` a partir de um nó de fluxo, preencher `whatsapp_instance_id` com o do fluxo se não houver da conversa.
- `webhook-flow-trigger`: ao criar conversa nova a partir do webhook, gravar `conversations.whatsapp_instance_id` = webhook.whatsapp_instance_id ?? flow.whatsapp_instance_id.
- Lógica de criação de conversa no worker (quando flow dispara sem conversa existente): usar a mesma cascata.

### Fora de escopo
- Trigger `keyword_match` e `message_received` não precisam — já há conversa com instance vinculado.
- Roteamento round-robin entre múltiplos números (futuro).

## Arquivos afetados
- migration nova
- `src/pages/FlowBuilderPage.tsx`
- `src/components/automations/SequencesTab.tsx`
- `src/components/automations/WebhookEditor.tsx` + `WebhooksTab.tsx` (tipo)
- `worker/index.js`
- `supabase/functions/webhook-flow-trigger/index.ts`
- `src/integrations/supabase/types.ts` (regenerado)