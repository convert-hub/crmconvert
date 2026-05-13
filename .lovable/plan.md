## Diagnóstico

Olhei o handler de `execute_flow` no `worker/index.js` (linhas 942–963). O nó `question` hoje:

1. **Não envia nada para o contato.** Só nó `message` envia WhatsApp. O texto digitado em "Pergunta" fica preso no editor, nunca vai para o canal.
2. **Não pausa o fluxo.** Lê `ctx.variables.message` (que é a mensagem do gatilho — ex.: "Branco"), salva como resposta no campo configurado e segue para o próximo nó imediatamente.
3. **Não tem mecanismo de retomada.** A tabela `flow_executions` tem `status` e `current_node_id`, mas o `webhook-uazapi` não consulta execuções pausadas ao receber uma nova mensagem.

Resultado prático no caso do Bruno: a mensagem foi enviada, o nó pergunta "executou" sem efeito visível, e o fluxo terminou em `completed` sem nunca conversar de verdade.

## Solução

Transformar `question` em um nó que **envia + pausa + retoma**.

### 1. Banco (migration)
- Adicionar a `flow_executions`:
  - `pending_queue jsonb` — fila de nodeIds restantes quando pausa.
  - `pending_save_field text` — campo onde gravar a próxima resposta.
  - `pending_custom_field_key text` — chave quando `saveField = 'custom'`.
- Permitir `status = 'awaiting_input'` (já é text, sem constraint).
- Índice parcial: `(tenant_id, conversation_id) WHERE status = 'awaiting_input'` para lookup rápido na retomada.

### 2. Worker — nó `question` (worker/index.js ~942)
Quando entrar no nó:
1. Enviar `node.data.question` como mensagem WhatsApp (mesma lógica do nó `message`: insert em `messages`, enqueue `send_whatsapp` com fallback de instance idêntico).
2. Persistir em `flow_executions`: `status = 'awaiting_input'`, `current_node_id = nodeId`, `pending_queue = [próximos da adjacency]`, `pending_save_field`, `pending_custom_field_key`, `context = ctx`.
3. **Parar o loop** (return / break do while).

### 3. Worker — novo job `resume_flow_execution`
Payload: `{ execution_id, answer }`. Faz:
1. Carrega execução, valida `status = 'awaiting_input'`.
2. Salva resposta no contato (lógica atual de `saveField` / `custom_fields`).
3. Reidrata `ctx`, monta `queue = pending_queue`, marca `status = 'running'`, limpa campos `pending_*`.
4. Continua o loop normal de execução do fluxo (refatorar o while atual em função reutilizável `runFlowQueue(execution, ctx, queue, flow, adjacency, nodes)`).

### 4. webhook-uazapi — disparar retomada
Em `handleIncomingMessage`, depois de criar/atualizar a `messages` inbound:
- `SELECT id FROM flow_executions WHERE tenant_id=? AND conversation_id=? AND status='awaiting_input' ORDER BY started_at DESC LIMIT 1`
- Se existir, `enqueue_job('resume_flow_execution', { execution_id, answer: text })` e **bloquear** outros gatilhos de fluxo (keyword/auto-reply de IA) para essa mensagem, para não disparar dois fluxos concorrentes.

### 5. Timeout (opcional, fora desta entrega)
Anotar para depois: pg_cron marcando `awaiting_input` antigos (> X horas) como `expired`. Não implementar agora para manter o escopo enxuto.

## Fora de escopo
- Validação do tipo da resposta (regex/email/telefone) — virá depois.
- Reenvio automático se o contato não responder.
- UI para visualizar execuções pausadas (dá pra ver via `JobsPage` se quiser).

## Arquivos afetados
- migration nova (colunas + índice)
- `worker/index.js` (nó `question` + novo handler `resume_flow_execution` + refator do loop)
- `supabase/functions/webhook-uazapi/index.ts` (lookup + enqueue de retomada)
- `src/integrations/supabase/types.ts` (regenerado)

## Detalhes técnicos
- Refatorar o while de `execute_flow` em `runFlowQueue(...)` para reuso entre primeira execução e `resume_flow_execution`.
- `pending_queue` guarda só strings (nodeIds + handles tipo `nodeId:option-0`); nada de funções/closures.
- Worker precisa ser rebuilt para carregar novo job type (memória do projeto).
