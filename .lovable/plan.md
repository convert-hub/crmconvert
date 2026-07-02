## Objetivo

Corrigir `src/pages/PipelinePage.tsx` para escalar em tenants com muitos milhares de oportunidades, eliminando o corte silencioso em ~1000 linhas do PostgREST e garantindo que contadores, totais e busca reflitam a base inteira — sem abrir brecha entre tenants.

## Diagnóstico

- `loadOpps` faz `.select('*, contact:contacts(*)').eq('pipeline_id', ...)` sem `.range/.limit` → PostgREST corta em ~1000. Com 1680 opps abertas, ~680 ficam invisíveis para quadro, busca e totais.
- `filteredOpportunities`, `allTags`, `oppsByStage` e `count`/`stageTotal` derivam do array truncado.
- Realtime/polling chama `loadOpps` inteira → custo amplificado em tenants grandes.

## Arquitetura

Dois modos derivados de estado (`mode = (search.trim() || hasActiveFilter(filters)) ? 'search' : 'navigation'`) + agregados sempre vindos de RPC segura.

```text
Header de cada coluna  → SEMPRE RPC de agregados (count + sum), por stage_id
Corpo da coluna:
  navigation → paginação por coluna (50/página, botão "Carregar mais")
  search     → RPC única de busca (limit 300), distribuída por etapa
```

## Migration (obrigatória — sem fallback client-side)

Duas RPCs `SECURITY DEFINER` com checagem de tenant embutida (mesmo padrão de `get_conversation_provider`). Nenhuma alteração de schema/RLS.

### 1) `pipeline_stage_aggregates` — contadores/totais reais

```sql
create or replace function public.pipeline_stage_aggregates(
  _pipeline_id uuid,
  _assignee uuid default null,
  _priority text default null,
  _tag text default null,
  _value_min numeric default null,
  _value_max numeric default null
) returns table(stage_id uuid, cnt bigint, total numeric)
language sql stable security definer set search_path=public as $$
  select o.stage_id, count(*)::bigint, coalesce(sum(o.value),0)::numeric
  from public.opportunities o
  left join public.contacts c on c.id = o.contact_id
  where o.pipeline_id = _pipeline_id
    and exists (
      select 1 from public.pipelines p
      where p.id = _pipeline_id
        and (public.is_saas_admin() or public.is_member_of_tenant(p.tenant_id))
    )
    and (_assignee is null or o.assigned_to = _assignee)
    and (_priority is null or o.priority::text = _priority)
    and (_tag is null or _tag = any(c.tags))
    and (_value_min is null or o.value >= _value_min)
    and (_value_max is null or o.value <= _value_max)
  group by o.stage_id;
$$;
```

Sem acesso ao tenant → 0 linhas. Fecha o mesmo tipo de furo dos incidentes anteriores.

### 2) `search_pipeline_opportunities` — busca server-side confiável

Substitui o `.or()` frágil misturando tabela base + relacionamento embutido (que o PostgREST não suporta bem).

```sql
create or replace function public.search_pipeline_opportunities(
  _pipeline_id uuid,
  _term text default null,
  _assignee uuid default null,
  _priority text default null,
  _tag text default null,
  _value_min numeric default null,
  _value_max numeric default null,
  _limit int default 300
) returns setof public.opportunities
language sql stable security definer set search_path=public as $$
  select o.*
  from public.opportunities o
  left join public.contacts c on c.id = o.contact_id
  where o.pipeline_id = _pipeline_id
    and exists (
      select 1 from public.pipelines p
      where p.id = _pipeline_id
        and (public.is_saas_admin() or public.is_member_of_tenant(p.tenant_id))
    )
    and (_assignee is null or o.assigned_to = _assignee)
    and (_priority is null or o.priority::text = _priority)
    and (_tag  is null or _tag = any(c.tags))
    and (_value_min is null or o.value >= _value_min)
    and (_value_max is null or o.value <= _value_max)
    and (
      _term is null
      or o.title ilike '%'||_term||'%'
      or c.name  ilike '%'||_term||'%'
      or regexp_replace(coalesce(c.phone,''),'\D','','g')
         ilike '%'||regexp_replace(_term,'\D','','g')||'%'
    )
  order by o.position asc, o.updated_at desc
  limit _limit;
$$;
```

Frontend hidrata `contact` num segundo `select` (`contacts.in('id', contactIds)`), evitando shape customizado no retorno da RPC.

## Refactor de `PipelinePage.tsx`

### Estados novos
`aggregatesByStage: Record<stageId, {count, total}>`, `oppsByStageState: Record<stageId, Opp[]>`, `pageByStage: Record<stageId, number>`, `loadingByStage`, `searchResults: Opp[]`, `searchLoading`, `mode` (derivado). Manter `opportunities` como visão achatada derivada (compat com engagement/activities/drag lookup).

### Loaders

- `loadStageAggregates()` → `supabase.rpc('pipeline_stage_aggregates', {...filters})`. Disparado em mudança de pipeline, filtros, e após cada `moveOpportunity`/refresh.
- `loadStagePage(stageId, page=0)` — apenas em modo navegação:
  ```ts
  supabase.from('opportunities')
    .select('id,title,value,priority,status,stage_id,assigned_to,contact_id,updated_at,position,custom_fields, contact:contacts(id,name,phone,tags,birth_date)')
    .eq('pipeline_id', selectedPipeline).eq('stage_id', stageId)
    .order('position', { ascending: true }).order('updated_at', { ascending: false })
    .range(page*50, page*50+49);
  ```
  Página 0 carregada para todas as etapas em paralelo ao entrar no pipeline. "Carregar mais" aparece quando `loaded.length < aggregate.count`.
- `loadSearchResults()` (debounced 250ms) — em modo busca: chama a RPC, depois `supabase.from('contacts').select(...).in('id', contactIds)` para hidratar. Agrupa por `stage_id` em memória (`searchByStage`).

### Renderização de colunas
- Header: `aggregatesByStage[stage.id]` (fonte única — nunca usar `.length` do array carregado).
- Corpo: `mode === 'search' ? searchByStage[stage.id] : oppsByStageState[stage.id]`.
- Em modo busca, mostrar badge por coluna com a contagem de resultados daquela etapa (derivada de `searchByStage[stage.id].length`) além do total real da etapa no header — resolve a confusão de "coluna diz 1660, mostra 1 card".
- Badge global "Busca — X resultados (limitado a 300, refine se necessário)".

### Realtime / polling
`scheduleRefresh` deixa de recarregar tudo. Passa a:
- Sempre re-invocar `loadStageAggregates()` (linhas pequenas).
- Modo navegação: para cada etapa com dados carregados, re-buscar página 0 e mergear por `id` preservando páginas extras já carregadas.
- Modo busca: re-invocar `loadSearchResults()`.

### Drag-and-drop
`moveOpportunity` inalterado no essencial (update + `enqueue_job run_automations`). Otimização otimista:
- Remover card do bucket de origem, prepender no destino.
- Ajustar `aggregatesByStage` localmente: `origem.count--`, `origem.total -= value`; `destino.count++`, `destino.total += value`. `loadStageAggregates()` reconcilia após refresh.
- Lookup passa a considerar `searchResults` também (`activeOpp = oppsByStageState[...].find(...) ?? searchResults.find(...)`).

### Ordenação
Todas as queries usam `.order('position', { ascending: true }).order('updated_at', { ascending: false })` — estável e coerente com hoje (position=0 em massa → efetivamente updated_at desc).

## Fora de escopo
Reescrever semântica de `position`; alterar drawer, criar oportunidade, exclusão em cascata, abrir chat, cálculo de engagement/badges/alertas.

## Riscos

1. **Vazamento entre tenants nas RPCs** — mitigado com checagem `is_saas_admin() OR is_member_of_tenant(pipeline.tenant_id)` embutida em ambas.
2. **`.or()` do PostgREST com colunas de tabela base + embed é frágil** — eliminado ao mover a busca para a RPC `search_pipeline_opportunities`.
3. **Reordenação dentro da coluna quando só parte foi paginada** — mover para "o fim do carregado" mantém comportamento atual; aceito.
4. **Realtime + paginação duplicando/ocultando cards** — merge por `id` preserva páginas extras já carregadas.
5. **Debounce da busca** — 250ms para evitar N queries por tecla.
6. **Hidratação de contatos na busca** — segundo round-trip por `contacts.in('id', ...)` limitado a 300 ids (uma query só).
7. **Custo do polling de 2s** — cai drasticamente: agregados são leves; página 0 tem 50 linhas por etapa.

## Ordem de implementação

1. Migration com as duas RPCs `SECURITY DEFINER` + checagem de tenant.
2. Refactor de `PipelinePage.tsx` (estados, loaders, render, realtime, drag).
3. Verificação manual no tenant de 1680 opps: header correto por etapa, "Carregar mais" funciona, busca acha itens fora da primeira página, drag entre etapas atualiza header sem esperar refetch.
