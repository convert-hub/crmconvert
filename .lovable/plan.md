Diagnóstico forense

- A regra atual do filtro ainda depende da coluna `conversations.is_unanswered`, calculada por timestamps:
  - `last_customer_message_at IS NOT NULL`
  - e `last_agent_message_at IS NULL OR last_customer_message_at > last_agent_message_at`
- Isso corrigiu parte dos dados, mas ainda é frágil porque não olha a mensagem real mais recente da conversa.
- No banco, as conversas dos prints `35450 - Thiago` e `35447 - Raissa` já aparecem hoje como `is_unanswered = false`, com última mensagem `outbound`, então elas não deveriam mais entrar no filtro se a lista estiver recarregada.
- O problema restante é que a tela ainda consulta exatamente `is_unanswered=eq.true`; se algum timestamp ficar errado, se a aba estiver com estado antigo, ou se um webhook registrar um template com direção errada, a conversa volta a aparecer indevidamente.
- Também encontrei um caso real no filtro em que a última mensagem é `TemplateMessage` com `direction = inbound`. Pela definição desejada, template não deve ser usado para classificar “Sem resposta” como cliente aguardando atendimento; precisamos excluir templates dessa regra.

Sobre o erro “In order to...”

- Não é erro SQL nem erro do sistema.
- É uma resposta da Meta/WhatsApp Cloud API, código `131049`:
  - `In order to maintain a healthy ecosystem engagement, the message failed to be delivered.`
- Em português: a Meta bloqueou a entrega para preservar a qualidade/engajamento do ecossistema.
- Na prática, o WhatsApp aceitou a tentativa inicialmente, mas depois marcou a mensagem como `failed`. Isso pode acontecer por qualidade/engajamento baixo, políticas anti-spam, limite de envio, baixa probabilidade de interação ou proteção do usuário.
- Essa mensagem não significa que o CRM classificou errado por si só; ela é só o motivo de falha de entrega retornado pela Meta e exibido no balão vermelho.

Plano de correção

1. Substituir a fonte da verdade do filtro
   - Criar uma função no banco que responda: “esta conversa precisa de resposta da empresa?”
   - A função vai olhar a última mensagem real da tabela `messages`, não apenas timestamps agregados.
   - Ela só retorna verdadeiro quando a última mensagem relevante for do cliente.

2. Excluir templates da regra “Sem resposta”
   - Mensagens com `media_type = TemplateMessage` não devem fazer a conversa entrar em “Sem resposta”.
   - Templates enviados pela empresa ficam como `waiting_customer`, mas fora do filtro.
   - Templates recebidos/registrados por webhook também não entram sozinhos no filtro.

3. Atualizar `conversations.is_unanswered`
   - Trocar a coluna gerada por uma coluna normal sincronizada por trigger.
   - A trigger em `messages` recalcula `is_unanswered` após cada mensagem nova.
   - A regra passa a ser baseada na última mensagem relevante, não em `last_customer_message_at > last_agent_message_at`.

4. Fazer backfill dos dados atuais
   - Recalcular `is_unanswered` para todas as conversas existentes.
   - Remover imediatamente do filtro conversas cuja última mensagem seja template/outbound/falha de entrega da empresa.

5. Ajustar a tela do Inbox
   - Manter o filtro usando `is_unanswered = true`, mas agora com a coluna corrigida.
   - Ajustar o contador para refletir a lista recarregada.
   - Opcionalmente forçar reload ao trocar para “Sem resposta” para evitar estado antigo na aba.

6. Verificar com casos reais
   - Confirmar que `35450 - Thiago` e `35447 - Raissa` não aparecem mais no filtro.
   - Confirmar que conversas onde o cliente mandou a última mensagem normal continuam aparecendo.
   - Confirmar que templates falhados da Meta continuam visíveis no chat, mas não contam como “Sem resposta”.