# Plano — Ajustes IA de Pipeline

## 1. Switch funcional "Ganho/Perdido" — `src/components/settings/AiPipelineCard.tsx`

- Remover `opacity-60` do wrapper.
- Trocar `<Switch checked disabled />` por switch controlado por `cfg.exclude_won_lost`.
- Label/descrição dinâmicos:
  - `true` (default): "Nunca mover para Ganho/Perdido" / "Etapas terminais são sempre preservadas."
  - `false`: "Permitir mover para Ganho/Perdido" / "A IA pode sugerir ou mover cartões para etapas terminais."
- Ao DESLIGAR (`true → false`), abrir `AlertDialog` (state `confirmAllowTerminal`) no mesmo padrão do `confirmAuto`:
  - Título: "Permitir etapas terminais?"
  - Descrição: "A IA poderá mover cartões para etapas de Ganho ou Perdido. Movimentos ficam registrados e podem ser desfeitos. Recomendamos manter ativado até validar o comportamento da IA."
  - Ação: "Permitir etapas terminais" → `persist({ ...cfg, exclude_won_lost: false })`
- Ligar para `true` persiste direto.

## 2. Backend respeita `exclude_won_lost` — `supabase/functions/ai-stage-classifier/index.ts`

- Extrair: `const excludeWonLost: boolean = cfg.exclude_won_lost !== false;`
- Substituir bloco "4) Load stages":
  ```ts
  const currentStage = (allStages || []).find(s => s.id === opp.stage_id);
  if (!currentStage) return json({ skipped: "stage_not_found" });
  if (currentStage.is_won || currentStage.is_lost) return json({ skipped: "already_terminal" });
  const stages = excludeWonLost
    ? (allStages || []).filter(s => !s.is_won && !s.is_lost) as Stage[]
    : (allStages || []) as Stage[];
  ```
- Remove early return `current_stage_terminal_or_unknown`. Regra: nunca reclassificar quem já está em terminal; desbloqueio serve só para MOVER PARA terminal.

## 3. Editor de `ai_criteria` em terminais — `src/pages/SettingsPage.tsx`

- Popover de critério IA na tab pipeline: remover `s.is_won || s.is_lost` do `disabled` do Textarea (manter só `!isAdmin`).
- Nova mensagem: "Defina critérios para que a IA saiba quando um lead chegou a esta etapa (se permitido nas configurações de IA)."

## 4. Botão "Classificar conversas existentes" — `AiPipelineCard.tsx`

Dentro do mesmo Card, antes do aviso de "Apenas admins":
- Separador (`border-t pt-4`).
- Título "Classificação em lote" + descrição "Analisa todas as conversas ativas que têm oportunidade aberta e gera sugestões de etapa. Útil ao ativar a IA pela primeira vez."
- Botão com ícone `Zap` + estado `backfilling`:
  - `disabled = !cfg.enabled || saving || !isAdmin || backfilling`
  - Ao clicar: `supabase.rpc('backfill_ai_stage_classify', { _tenant_id: tenant.id })`
  - `count === 0` → `toast.info('Nenhuma conversa elegível encontrada.')`
  - `count > 0` → `toast.success(\`\${count} conversas enfileiradas para classificação.\`)`
  - Erro → `toast.error('Erro: ' + error.message)`

## 5. Migration — RPC `backfill_ai_stage_classify`

Criar via `supabase--migration` a função `public.backfill_ai_stage_classify(_tenant_id uuid) RETURNS integer`:
- Checagem de segurança no início: `if not is_member_of_tenant(_tenant_id) and not is_saas_admin() then raise exception 'forbidden'; end if;`
- Percorre `conversations` do tenant vinculadas a `opportunities` `status='open'` (por `opportunity_id` ou por `contact_id`).
- Só inclui conversas com pelo menos uma mensagem não interna.
- Ignora quando já existe `job_queue` (`type='ai_stage_classify'`) `pending`/`running` para a mesma conversa.
- Enfileira via `enqueue_job` com idempotency única por minuto:
  ```
  'ai_classify_bf_' || _conv.conversation_id::text || '_' || to_char(now(), 'YYYYMMDD_HH24MI')
  ```
  Permite re-rodar o backfill (no máximo 1x por minuto por conversa).
- `GRANT EXECUTE ... TO authenticated;` (SECURITY DEFINER).

## 6. Deploy da edge function

Reeditar `supabase/functions/ai-stage-classifier/index.ts` (a alteração do item 2 já força o deploy automático).

## Riscos

- **Reclassificação de contas já ganhas/perdidas:** mitigado pelo guard `already_terminal`.
- **Backfill em massa:** pode gerar muitos jobs de IA (custo). O `min_confidence` e o debounce protegem; texto do card avisa o admin.
- **RPC exposta ao `authenticated`:** protegida por membership check + filtro `_tenant_id`, sem SQL dinâmico.
