## Objetivo
Levar o Flow Builder atual ao patamar do construtor analisado (estilo Botconversa) sem quebrar nada: hoje já temos xyflow + handles nomeados + worker `execute_flow` com fila/adjacência/pausa-retomada. O plano abaixo só **adiciona** tipos de bloco, melhora UX e fecha lacunas funcionais — schema atual de `chatbot_flows.nodes/edges` é mantido (JSON).

## O que já temos (não mexer)
- xyflow com `trigger, message, condition, delay, action, question, randomizer`
- Handles nomeados (`yes/no`, `option-N`) com `sourceHandle` lido pelo worker
- `execute_flow` no worker com adjacência, fila, pausa em `question`, retomada por `_resume`
- `flow_executions` com `pending_queue`, `pending_save_field`, `whatsapp_instance_id` no fluxo
- `VariablePicker` + `useSystemVariables` (já interpolam `{{contact.*}}` e custom fields)

## Lacunas vs. construtor analisado e como fechar

### 1. Bloco "Conteúdo" multi-item (substitui/expande `message`)
Hoje `message` envia 1 texto/template. Adicionar modo **lista de sub-itens** no mesmo nó (sem novo tipo, retrocompatível):
- `data.items: Array<{ kind: 'text'|'image'|'video'|'audio'|'file'|'contact'|'save'|'delay'|'autooff', ... }>`
- Editor lateral renderiza lista ordenável (dnd-kit já não está; usar setas ↑↓ simples)
- Quando `items` existe, worker itera; senão usa `content` antigo (fallback)
- `save` = pausa execução e grava resposta em campo (reutiliza pause/resume do `question`)
- `autooff` = ação interna de pausar automação IA na conversa
- `delay` inline = mesmo efeito do bloco Atraso, sem nova aresta

### 2. Novo bloco **Menu** (`type: 'menu'`)
- `data.options: Array<{ id, label, value }>` → cada opção gera handle `option-<id>` (handles dinâmicos)
- `data.invalidText`, `data.maxRetries`, `data.timeout: { days, hours }`
- Handles extras: `error-count` (estourou tentativas) e `right-timeout`
- Worker: envia pergunta, pausa execução salvando `pending_menu: { options, retries, deadline_at }`; webhook de mensagem recebida procura execução pausada e roteia
- pg_cron job para disparar timeout (mesma infra de inatividade)

### 3. Condição multi-critério (evoluir `ConditionNode`)
- `data.operator: 'AND' | 'OR'`, `data.criteria: Filter[]` (reaproveitar `src/types/automation.ts`)
- Reusar `ConditionsBuilder` já existente em automações
- Worker: avaliador único compartilhado entre automações e flow (extrair para `worker/lib/filterEval.js`)
- Saídas `right-true` / `right-false` (já suportadas)

### 4. Novo bloco **Conexão de Fluxo** (`type: 'subflow'`)
- `data.targetFlowId` → worker enfileira novo `execute_flow` e encerra/continua o atual conforme `data.mode: 'transfer' | 'call'`

### 5. Novo bloco **Integração** (`type: 'integration'`)
- `data.provider: 'webhook'|'zapier'|'sheets'|'rdstation'`, `data.config`
- Worker: handler `flow_integration` faz HTTP outbound; saídas `success`/`error`

### 6. Novo bloco **Assistente GPT** (`type: 'ai_assistant'`)
- Reaproveitar `ai-generate` edge function + RAG (`search_knowledge`)
- Config: prompt sistema, modelo, temperatura, debounce (segundos), mensagem de erro, base de conhecimento (multi-select de `knowledge_documents`)
- Pausa execução acumulando mensagens do contato durante `debounce`; após silêncio, gera resposta
- Saídas: `success`, `handoff` (LLM detecta intenção de falar com humano via tool/keywords), `inactivity` (timeout sem resposta)
- Idempotente por `message_id` (regra de projeto)

### 7. Bloco **Ação** — empilhar múltiplas ações
- `data.actions: Array<{ type, config }>` (hoje só 1)
- Worker executa em ordem; mantém compat com `actionType` legado

### 8. UX do editor
- **Auto-save** com debounce 1.5s (substitui botão; mantém botão como "Salvar agora")
- **Painel lateral** (Sheet) em vez de Dialog para edição — mais espaço, fecha com Esc
- **Botão "+" flutuante** sobre o canvas abrindo paleta como Popover (mantém sidebar)
- **Fullscreen** (`document.fullscreenElement`)
- **Validação visual**: nós sem saída conectada ganham borda âmbar + tooltip
- **Pastas de fluxos**: nova tabela `flow_folders(id, tenant_id, name)` + coluna `folder_id` em `chatbot_flows`

### 9. Simulador "Visualização"
- Botão na top bar abre Sheet à direita com mock de WhatsApp
- Executa o grafo em **memória no client** (não toca DB): mesma lógica do worker portada para TS em `src/lib/flowSimulator.ts`
- Input para responder, botão "reiniciar"
- Não suporta integração externa nem GPT real (mostra placeholder)

### 10. Compartilhamento público
- Nova tabela `flow_shares(id, flow_id, tenant_id, share_token unique, created_at)`
- Página pública `/flow/install/:token` que, para usuário logado em outro tenant, clona `nodes/edges/trigger_config` (sem `whatsapp_instance_id`)

## Mudanças de banco (resumo)
```sql
-- pastas
CREATE TABLE flow_folders(...); GRANT ...; RLS por tenant.
ALTER TABLE chatbot_flows ADD COLUMN folder_id uuid REFERENCES flow_folders(id) ON DELETE SET NULL;

-- compartilhamento
CREATE TABLE flow_shares(...); GRANT ...; RLS: SELECT público por token, INSERT/DELETE por membro do tenant.
```
Nada destrutivo. Schema `nodes/edges` continua JSON livre — novos tipos convivem com fluxos antigos.

## Detalhes técnicos
- Tipos novos vão em `src/components/flow-builder/` (`MenuNode`, `SubflowNode`, `IntegrationNode`, `AiAssistantNode`) + editores correspondentes
- Worker: novos handlers em `worker/index.js` dentro do switch de `execute_flow`; extrair grafo/fila para `worker/lib/flowEngine.js` para reduzir o arquivo
- Reaproveitar `VariableField` em todo editor de texto dos blocos
- Manter `pending_*` em `flow_executions`; adicionar `pending_menu jsonb`, `pending_ai jsonb`
- Worker de timeout: `check-flow-timeouts` edge function chamada por pg_cron a cada minuto (mesmo padrão de `check-inactivity`)

## Entrega faseada (sugestão)
1. **Fase 1 — UX**: auto-save, painel lateral, "+" flutuante, fullscreen, pastas
2. **Fase 2 — Blocos básicos**: Conteúdo multi-item, Ação empilhada, Condição multi-critério
3. **Fase 3 — Roteamento**: Menu (com timeout/retries), Subflow
4. **Fase 4 — Integrações & IA**: Integration block, AI Assistant, simulador
5. **Fase 5 — Templates públicos**: flow_shares + página install

Cada fase é independente e não quebra fluxos existentes. Posso começar pela Fase 1 assim que aprovar — ou priorize a fase que quer primeiro.