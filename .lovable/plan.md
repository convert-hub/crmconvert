

## Plano: Remover hand-off automático em `checkQualification`

Bug: `checkQualification` muda `contact.status='customer'` e `conversation.status='waiting_agent'` quando o GPT qualifica o lead. Como `handleAiAutoReply` tem guard `if (contact.status !== 'lead') return;`, a IA para de responder.

### Alteração em `worker/index.js` (linhas 1288–1312)

Dentro do bloco `if (qualification?.qualified && qualification.confidence >= threshold)`:

1. **Remover** `supabase.from('contacts').update({ status: 'customer' })` (linha 1291)
2. **Remover** o update de `conversations.status = 'waiting_agent'` (linhas 1293–1296), substituindo por um update que apenas grava `metadata.qualification` preservando os demais campos do metadata
3. **Manter** update de `opportunities.qualification_data` (1298–1302)
4. **Manter** activity `'note'` "Lead qualificado pela IA" (1304–1311)
5. **Adicionar** nova activity `type: 'task'` com title "Revisar lead qualificado pela IA" e `due_date = now + 10min`, vinculada ao `contact_id` e `conversation_id`
6. **Atualizar logs** para "qualificação registrada, aguardando revisão humana, IA continua ativa"

### Comportamento resultante

- `contact.status` permanece `'lead'` → guard de `handleAiAutoReply` continua passando → IA segue respondendo
- `conversation.status` não é alterado pela qualificação
- Qualificação fica registrada em `conversations.metadata.qualification` + `opportunities.qualification_data`
- Humano recebe task de revisão com vencimento em 10 minutos

### Não muda

- `handleAiAutoReply`, `checkKeywordAndActivateAi`, leitura do threshold via `tenants.ai_confidence_threshold`, tratamento de erros, prompt template, logging de AI call

