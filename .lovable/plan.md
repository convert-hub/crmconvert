
# Condições avançadas em Regras de Automação

Hoje cada gatilho só aceita 1-2 condições muito específicas (etapa, tag, horas, origem). O usuário precisa combinar filtros do tipo "quando X acontecer **e** o lead estiver na etapa Y **e** tiver a tag Z **e** valor > R$ 1000". Vou espelhar o padrão Bitrix24 / RD Station: manter as condições específicas do gatilho **e** adicionar um bloco genérico de **Condições adicionais** (lista AND) que se aplica a qualquer gatilho.

## Catálogo de condições adicionais

Agrupadas em 4 categorias, com operadores apropriados:

**Oportunidade**
- Pipeline é / não é (select)
- Etapa atual é / não é / está em (multi-select)  ← caso "lead na coluna X"
- Status é (aberta / ganha / perdida)
- Prioridade é / está em (low/medium/high/urgent)
- Valor `>`, `<`, `=`, `entre`
- Responsável é / não é / é vazio
- Data de fechamento prevista: antes/depois/em N dias
- Campo customizado X = valor

**Contato**
- Status (lead/customer/churned/inactive)
- Tem tag(s) / não tem tag(s) (multi)
- Origem (`source`) é / contém
- UTM source/medium/campaign é / contém
- Cidade / Estado é
- Tem telefone / e-mail
- `do_not_contact` é falso (recomendado por padrão)
- Idade do contato (dias desde `created_at`) `>`, `<`

**Conversa / canal**
- Canal é (whatsapp/email/...)
- Status (open/waiting_customer/waiting_agent/closed)
- Instância WhatsApp é
- Não respondida há X horas (já existe; vira condição reusável)
- Atribuída a / não atribuída

**Tempo / contexto**
- Horário comercial (sim/não) — usa `business_hours` do tenant
- Dia da semana ∈ {seg..dom}
- Faixa de horário (HH:MM–HH:MM)

## UX no `RulesTab`

```text
Quando isso acontecer  ▾ [Gatilho]
  └─ [campos específicos do gatilho — como hoje]

Condições adicionais (todas devem ser verdadeiras)
  • [Categoria ▾] [Campo ▾] [Operador ▾] [Valor]   [×]
  • [Categoria ▾] [Campo ▾] [Operador ▾] [Valor]   [×]
  [+ Adicionar condição]

Então faça isso
  └─ [Ações — como hoje]
```

- Modo apenas **AND** nesta primeira versão (Bitrix permite OR via grupos; deixar para v2 se pedido).
- Resumo legível no card da regra: `Sem resposta 24h · Etapa = "Negociação" · Valor > R$ 1.000 → Enviar WhatsApp`.

## Detalhes técnicos

### Schema
Migration alterando o formato de `automations.conditions` (jsonb, já existe):
```json
{
  "trigger": { "hours": 24, "from_stage_id": "...", ... },   // específicas do gatilho (compat)
  "filters": [
    { "field": "opportunity.stage_id", "op": "in",  "value": ["uuid1","uuid2"] },
    { "field": "contact.tags",         "op": "has_any", "value": ["vip"] },
    { "field": "opportunity.value",    "op": "gt",  "value": 1000 },
    { "field": "context.business_hours", "op": "eq", "value": true }
  ]
}
```
Sem mudança de coluna — só evolução do JSON. Migração lê regras antigas (campos soltos `from_stage_id`, `tag`, `hours`, `source`) e move para `trigger`, deixando `filters: []`. Backward compatible.

### Avaliação (`worker/automation-handler.js`)
- Reescrever `matchConditions(conditions, context, triggerType)`:
  1. Validar `trigger.*` (lógica atual mantida).
  2. Se `filters.length > 0`, carregar dados necessários **uma vez** (opportunity + contact + conversation + tenant.business_hours/timezone) usando `context.{opportunity_id, contact_id, conversation_id}` e avaliar cada filtro.
- Implementar `evalFilter(filter, data)` com operadores: `eq, neq, in, nin, gt, gte, lt, lte, between, contains, has_any, has_all, is_empty, is_not_empty`.
- `context.business_hours`: usar `tenants.business_hours` + `timezone` (já existem) com `date-fns-tz` (já no projeto? se não, fallback simples com `Intl.DateTimeFormat`).
- `check-inactivity` (edge function): ao enfileirar, manter o context completo; nenhuma mudança de assinatura.

### Front (`src/components/automations/RulesTab.tsx`)
- Novo componente `ConditionsBuilder.tsx` (mesma pasta) reusável: recebe `value: Filter[]` + `onChange`, carrega pipelines/stages/tags/instâncias internamente (via hooks já usados).
- Substituir bloco "renderConditions" por: condições do gatilho (como hoje) + `<ConditionsBuilder />`.
- Atualizar `getActionSummary`/render do card para listar filtros em chips compactos.
- Tipagem: novo `types/automation.ts` com `Filter`, `FilterField`, `FilterOperator`.

### Compat
- Ao ler regra antiga: se `conditions` não tem `filters`/`trigger`, normalizar em memória.
- Ao salvar: sempre gravar no novo formato.
- Migração SQL única para reescrever linhas existentes (idempotente).

## Arquivos afetados
- `supabase/migrations/<ts>_automation_conditions_v2.sql` (data migration apenas)
- `src/types/automation.ts` (novo)
- `src/components/automations/RulesTab.tsx`
- `src/components/automations/ConditionsBuilder.tsx` (novo)
- `worker/automation-handler.js`
- `worker/index.js` (se precisar passar mais campos no context — verificar emissores de `executeAutomations`)

## Fora do escopo (v2)
- Grupos OR aninhados.
- Condições que dependem de histórico (ex: "lead ficou X dias na etapa Y") — exige novas queries; posso adicionar depois se quiser.
- Editor visual de árvore de lógica.

Confirma que posso seguir com este desenho? Se quiser cortar/adicionar alguma condição da lista acima, me diga antes de implementar.
