## Reestruturação de Automações

Unifico Palavras-chave, Sequências e Webhooks numa única página `/automations` com 3 abas, no estilo enxuto dos screenshots.

### Decisões registradas
1. **Mapeamento de webhook**: drag-and-drop dos campos da requisição para as ações.
2. **Modo Teste**: histórico das últimas 10 requisições (jsonb array).
3. **Renomear webhook**: só muda nome de exibição — slug/URL nunca muda.
4. **Regras atuais** (mover etapa, criar atividade por evento) → 4ª aba **"Regras"** dentro de Automações.
5. **Sequências = drip WhatsApp** (passos com delay, gatilho de entrada, regras de saída).

### Estrutura da página

```
/automations
├── Palavras-chave  (tabela enxuta)
├── Sequências      (drip de mensagens)
├── Webhooks        (lista + editor full-screen)
└── Regras          (atual AutomationsPage por evento)
```

### Banco de dados

**`keyword_automations`**
- `id`, `tenant_id`, `flow_id` (FK chatbot_flows), `keywords text[]`, `match` (`contains|equals|starts_with`), `case_sensitive bool`, `is_active bool`, `executions_count int`, `created_at`, `updated_at`

**`webhook_endpoints`**
- `id`, `tenant_id`, `name`, `slug` (único, gerado, imutável), `secret`, `flow_id` (nullable), `is_active`, `test_mode bool`, `sample_payload jsonb`, `request_history jsonb` (últimas 10), `actions jsonb` (mapeamentos: `{field, source_path, action: 'set_phone'|'set_name'|'set_custom_field'|'trigger_flow', target?}`), `created_at`, `updated_at`

**`message_sequences`** + **`sequence_steps`** + **`sequence_enrollments`**
- Sequência: nome, gatilho de entrada (tag/lead/manual), regra de saída (resposta/conversão/tag).
- Step: ordem, delay (minutos), tipo (texto/template), conteúdo, respeita horário comercial.
- Enrollment: contato + sequência + step atual + próximo disparo + status.

RLS: padrão tenant (membros viewam, admin/manager escrevem, saas_admin bypass).

### Backend

**`webhook-flow-trigger`** reescrito:
- Lê `webhook_endpoints` por `slug` (não mais por flow_id).
- Valida `secret` via header.
- Se `test_mode=true`: salva payload em `sample_payload` + prepend em `request_history` (max 10), retorna `{ok, captured: true}` SEM disparar fluxo.
- Se `test_mode=false`: aplica `actions` (resolve `source_path` tipo `body.telefone` via lodash get), cria/atualiza contato, enfileira `execute_flow`.

**`triggerMessageReceivedFlows`** (worker): passa a consultar `keyword_automations` em vez de `chatbot_flows.trigger_type='keyword_match'`.

**Sequências**: pg_cron a cada 5min → função `process_sequence_enrollments` enfileira jobs `send_sequence_step` no worker.

**Migração de dados**: porta `chatbot_flows` com `trigger_type in ('keyword_match','webhook')` para as novas tabelas, mantendo o flow.

### Frontend

- `src/pages/AutomationsPage.tsx` vira shell com Tabs.
- `src/components/automations/KeywordsTab.tsx` — tabela: Fluxo | Modo (select inline) | Palavras (TagInput inline) | Case | Ativa | Execuções | ⋮.
- `src/components/automations/SequencesTab.tsx` — lista de sequências + editor de passos.
- `src/components/automations/WebhooksTab.tsx` — lista + botão "Novo".
- `src/components/automations/WebhookEditor.tsx` — full screen, 2 colunas:
  - Esquerda: header (nome, URL, secret, toggle Teste), painel "Campos recebidos" mostrando flat keys do `sample_payload` (chips draggáveis).
  - Direita: cards de ação (`Telefone do contato`, `Nome do contato`, `Campo personalizado`, `Disparar fluxo`) — drop zones, mostram chip mapeado, removível.
- `src/components/automations/RulesTab.tsx` — move conteúdo atual de `AutomationsPage`.
- Remove configuração de `keyword_match` e `webhook` do `TriggerConfigPanel` no FlowBuilder (esses tipos passam a ser geridos só pela página de Automações; trigger node mostra aviso "Configure em Automações").

### Implementação faseada

1. Migration (tabelas + porta dados).
2. Backend: webhook-flow-trigger reescrito, worker ajustado para keyword_automations.
3. Página: shell + KeywordsTab + WebhooksTab + WebhookEditor (drag-drop).
4. Sequências: tabela base + UI mínima (criar/listar/passos); cron e disparo num passo seguinte se necessário.
5. RulesTab (move atual).
6. FlowBuilder: TriggerConfigPanel simplificado.

Começo pela migration.
