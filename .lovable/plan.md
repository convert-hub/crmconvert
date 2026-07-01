# Migrar `ai-stage-classifier` para OpenAI direto

Alterar apenas `supabase/functions/ai-stage-classifier/index.ts`, mantendo intactos prompt, guard-rails, lógica de `stage_moves`, obsolescência e modo suggestion/auto.

## Mudanças

**1. Topo do arquivo**
- Remover `GATEWAY_URL` (Lovable).
- Remover a constante `MODEL` (modelo passa a vir do `ai_configs` ou default `gpt-4o-mini`).
- Remover leitura de `LOVABLE_API_KEY`.

**2. Resolução de API key (após carregar config do tenant, seção 1)**
Adicionar cadeia de fallback idêntica à do `ai-generate`:
1. `ai_configs` do tenant com `task_type = "stage_classifier"` (join com `global_api_keys`).
2. Se `api_key_encrypted` do registro do tenant existir, usa.
3. Senão, `global_api_key.api_key_encrypted`.
4. Senão, `Deno.env.get("OPENAI_API_KEY")`.
5. Se nenhuma → retornar `{ error: "ai_not_configured" }` com status 400.

Também extrair `model` do `aiConfig.model` (default `gpt-4o-mini`).

**3. Chamada da IA (seção 7)**
Substituir `fetch(GATEWAY_URL, ...)` por `fetch("https://api.openai.com/v1/chat/completions", ...)` com:
- Header `Authorization: Bearer ${apiKey}`.
- Body: `{ model, messages, response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 300 }`.
- Manter o parse do JSON de resposta e o tratamento de erros existente.

**4. Log de uso (após insert em `stage_moves`, seção 9)**
Após persistir a sugestão/movimento (em ambos os modos `suggestion` e `auto`), inserir em `ai_logs`:
- `tenant_id`, `task_type: "stage_classifier"`, `provider: "openai"`, `model`,
- `tokens_used: aiData?.usage?.total_tokens || 0`,
- `input_data: { conversation_id, opportunity_id }`,
- `output_data: { suggested_stage_id, confidence, reason }`.

E, se `aiConfig?.id` existir, atualizar contadores:
- `daily_usage += 1`, `monthly_usage += 1`, `usage_reset_at = now()`.

## O que NÃO muda
- Debounce, obsolescência, filtros `exclude_won_lost`, guard-rail de etapas terminais, formato do prompt, criação de `stage_moves`, RLS.
- Nenhum outro arquivo é tocado.

## Riscos
- Se o tenant não tiver `ai_configs(stage_classifier)` nem `OPENAI_API_KEY` no env, a classificação passa a falhar com `ai_not_configured` (antes funcionava via `LOVABLE_API_KEY`). Aceitável — é o padrão já usado no `ai-generate`.
- O seletor de modelo introduzido recentemente no `AiPipelineCard` (`settings.ai_pipeline.model`) não é lido por esta função; continuará sem efeito para o classifier até uma tarefa futura (fora do escopo desta alteração).
