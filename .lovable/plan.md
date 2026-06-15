## Diagnóstico

A regra atual usa apenas `conversations.last_customer_message_at > last_agent_message_at`. Isso falha quando uma resposta da empresa foi enviada, mas `last_agent_message_at` ficou desatualizado ou nulo em algum caminho de envio. Encontrei exemplos no banco em que a última mensagem da conversa é `outbound`, mas `is_unanswered` continua `true`.

Exemplo real: na conversa `c7fa...`, o cliente mandou mensagem às 19:34 e a empresa respondeu às 19:35, porém a conversa segue no filtro porque `last_agent_message_at` ainda está 17:36.

## Plano de correção

1. **Trocar a definição de “Sem resposta”**
   - O filtro passará a considerar a última mensagem real da conversa.
   - Só entra em “Sem resposta” quando a mensagem mais recente em `messages` for `inbound`.
   - Se a última mensagem for `outbound` — texto normal, áudio, mídia, IA, template ou mensagem agendada — a conversa sai do filtro.

2. **Criar uma função segura no banco**
   - Adicionar uma função `public.conversation_needs_company_reply(conversation_id)` que consulta a última mensagem por `created_at`.
   - Retorna `true` somente se a última mensagem não-interna for do cliente.
   - Assim o significado fica centralizado e não depende de timestamps potencialmente inconsistentes.

3. **Atualizar o filtro da Inbox**
   - Em `src/pages/InboxPage.tsx`, substituir `.eq('is_unanswered', true)` por uma filtragem baseada na nova regra.
   - Manter a ordenação por `last_customer_message_at` para priorizar clientes esperando há mais tempo.
   - Aplicar a mesma regra no fluxo de busca.

4. **Corrigir dados já inconsistentes**
   - Rodar uma atualização única para sincronizar `last_agent_message_at` nas conversas onde a última mensagem real já é `outbound`.
   - Isso remove do filtro conversas que já tiveram resposta da empresa.

5. **Blindagem nos caminhos de envio**
   - Revisar os pontos principais que gravam mensagens `outbound` para garantir que também atualizem `last_agent_message_at`, `last_message_at` e `status = 'waiting_customer'`.
   - Prioridade: templates Meta, mensagens do ChatPanel, mensagens agendadas e respostas geradas pelo worker.

## Resultado esperado

O filtro “Sem resposta” vai listar apenas conversas em que o cliente foi o último a falar e a empresa ainda não respondeu. Conversas em que a empresa mandou mensagem — inclusive templates aguardando resposta do cliente — não aparecerão mais ali.