
## Objetivo
IA que lê as últimas mensagens de cada conversa com oportunidade vinculada, decide em qual `stage` o lead está e — conforme o modo — SUGERE ou MOVE o cartão, sempre gravando motivo, confiança e critérios em `stage_moves`. Default seguro: sugestão. Reaproveita `stages`, `stage_moves`, `enqueue_job`/worker e o padrão do `ai-copilot`.

## Ordem de execução (migrations → backend → UI)

### 1. Migration A — schema
- `stages`: adicionar `ai_criteria text null`.
- `stage_moves`:
  - `status text not null default 'applied'` com `CHECK (status in ('suggested','applied','rejected'))`.
  - `resolved_by uuid null`, `resolved_at timestamptz null`.
  - Backfill implícito: linhas antigas ficam `applied` pelo default.
  - Índice parcial `(tenant_id, created_at desc) WHERE status='suggested'` para a central.
- `job_queue.idempotency_key`: **garantir `UNIQUE`** (se ainda não for). Sem isso, dois webhooks simultâneos com a mesma chave podem inserir dois jobs (ver Risco 1). Se a coluna já for única, é no-op.
- RLS: acrescentar UPDATE em `stage_moves` para `admin/manager/attendant` do tenant (necessário para Aprovar/Ignorar/Desfazer). `readonly` fica de fora.
- Config em `tenants.settings.ai_pipeline` — sem migration, JSONB livre. Defaults lidos no código:
  ```json
  { "enabled": false, "mode": "suggestion", "min_confidence": 0.7,
    "exclude_won_lost": true, "direction": "forward_only" }
  ```

### 2. Edge Function `ai-stage-classifier` (nova, `verify_jwt=false`, chamada só pelo worker)
Entrada: `{ tenant_id, conversation_id }`.
1. Resolve `opportunity` (via `conversations.opportunity_id` ou última opp aberta do contato). Sem opp → sai.
2. Lê `tenants.settings.ai_pipeline`. `enabled=false` → sai.
3. **Debounce em nível de dado** (segunda linha de defesa): se existir `stage_moves` para essa opp criada nos últimos 120s por IA, sai. Cobre o caso do idempotency_key falhar por race.
4. Carrega stages do pipeline da opp, exclui `is_won`/`is_lost`, ordena por `position`.
5. Carrega últimas 6 messages **não internas** + contato (nome, `custom_fields.ctwa`) + stage atual.
6. Chama Claude Haiku (`claude-haiku-4-5`) com JSON estrito e catálogo fechado de stages:
   ```json
   { "suggested_stage_id": "...", "confidence": 0.0-1.0,
     "reason": "curto", "criteria_met": ["..."] }
   ```
7. **Guard-rails**: id ∈ lista carregada; `!= stage atual`; `confidence >= min_confidence`; se `forward_only`, `position` > atual; nunca is_won/is_lost.
8. Modo `suggestion` → insere `stage_moves { is_ai_move:true, status:'suggested', confidence_score, ai_reason, criteria_met, moved_by:null }`. Modo `auto` → transação: `update opportunities.stage_id` + insert `stage_moves status='applied'`.
9. Grava último parecer em `opportunities.qualification_data.ai_pipeline_last` para debug/UI.

### 3. Gatilho (enfileiramento nos webhooks)
Após persistir mensagem INBOUND real, em `webhook-uazapi/index.ts` (dentro de `handleIncomingMessage`) e `webhook-meta/index.ts` (ramo equivalente):
```ts
await supabase.rpc('enqueue_job', {
  _type: 'ai_stage_classify',
  _payload: { tenant_id, conversation_id },
  _tenant_id: tenant_id,
  _idempotency_key: `ai_stage:${conversation_id}:${Math.floor(Date.now()/120000)}`
});
```
`enqueue_job` já faz lookup por `idempotency_key` e retorna o id existente antes de inserir — confirmado no código da função. A chave por janela de 2 min garante 1 chamada de modelo por conversa por janela.

### 4. Worker — handler `ai_stage_classify`
Em `worker/index.js`: novo `case` que invoca `functions/v1/ai-stage-classifier` com service role. Falha → `fail_job` cuida do backoff.

### 5. UI
- **`PipelinePage.tsx`** — editor de stage ganha textarea "Como a IA reconhece esta etapa" → `stages.ai_criteria`.
- **`SettingsPage.tsx`** — nova aba "IA de Pipeline" com card `AiPipelineCard.tsx`:
  - Switch enabled, RadioGroup mode (Sugestão/Automático — trocar pra auto exige confirm), Slider min_confidence (0.5–0.95), Select direction, Switch informativo "nunca mexer em Ganho/Perdido" (sempre on nesta v1). Persiste merge em `tenants.settings.ai_pipeline`.
  - Tabela das stages do pipeline default com `ai_criteria` editável inline.
- **Central `/ai-suggestions`** — lista `stage_moves status='suggested'` com lead, de→para, motivo, confiança, ações Aprovar/Ignorar. Contador na sidebar (polling 30s).
  - **Aprovar**: revalida `stage_moves.from_stage_id == opportunity.stage_id atual`. Se divergir, marca automaticamente `rejected` com motivo "stage já mudou" e avisa na UI. Se bater, transação: update opp + `status='applied' + resolved_by/at`.
  - **Ignorar**: `status='rejected' + resolved_by/at`.
- **Tarjinha inline** em `OpportunityDetail.tsx` quando houver sugestão pendente da opp.
- **Histórico** em `OpportunityDetail.tsx`: timeline das últimas 10 `stage_moves`. Botão **Desfazer** aparece só para `is_ai_move=true, status='applied'` das últimas 24h.
  - **Trava anti-obsolescência do Desfazer** (simétrica ao Aprovar): antes de reverter, checa `opportunity.stage_id == stage_moves.to_stage_id`. Se divergir (alguém já moveu para outra etapa depois), bloqueia com toast "o cartão já mudou de etapa — desfazer indisponível" e não toca em nada. Se bater, transação: `update opportunities.stage_id = from_stage_id` + `update stage_moves set undone=true`.

## Riscos e mitigações
1. **Race no enqueue_job** — `SELECT ... IF NULL THEN INSERT` sem UNIQUE deixa brecha para dois webhooks concorrentes inserirem duplicata. Mitigação primária: `UNIQUE` em `job_queue.idempotency_key` (na Migration A). Mitigação secundária dentro da função: checagem de `stage_moves` recente (últimos 120s) — cobre até o caso do UNIQUE falhar por qualquer motivo.
2. **Custo/latência** — debounce 120s + Haiku + máx 6 msgs + catálogo fechado.
3. **Alucinação de stage** — valida id ∈ lista antes de gravar.
4. **Ligar sem querer em massa** — default `enabled=false`, `mode='suggestion'`; trocar pra auto exige confirm.
5. **Regressão de etapa** — `forward_only` bloqueia por padrão.
6. **Aprovar sugestão obsoleta** — revalida `from_stage_id == stage atual`, senão auto-rejeita.
7. **Desfazer movimento obsoleto** — mesma trava: só reverte se `stage_id atual == to_stage_id`.
8. **RLS de UPDATE em `stage_moves`** — precisa policy nova para permitir Aprovar/Ignorar/Desfazer respeitando papel.
9. **Ruído em conversas sem opp** — v1 não cria opp automaticamente.
10. **Nota interna** — filtro `is_internal=false` na leitura das mensagens.

## Fora do escopo desta v1
- Criar opp automaticamente quando não existir.
- Backfill de conversas antigas.
- Métricas de acurácia da IA (aprovadas vs ignoradas).
- Multi-pipeline por opp.

## Detalhes técnicos
- Modelo: `claude-haiku-4-5` via mesma secret do `ai-copilot`; resposta JSON, sem streaming.
- `stage_moves.moved_by` fica `null` para sugestões da IA (`is_ai_move=true` é o sinal).
- Movimento manual segue gravando `stage_moves { is_ai_move:false, status:'applied' }` pelo default — comportamento inalterado.
- Realtime opcional em `stage_moves` filtrado por `status='suggested'` para o badge; se pesar, cai pra polling 30s.
