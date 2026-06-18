# Importação de contatos com criação de oportunidades

Toda a mudança fica contida em `src/components/contacts/ImportContactsDialog.tsx`. Reaproveita parsing de CSV, dedupe, `normKey`, relatório de erros e CSV de falhas existentes. Quem não mapear `pipeline_stage` segue com o fluxo atual inalterado.

## 1. Novo campo de mapeamento
- Em `CONTACT_FIELDS`, adicionar `{ value: 'pipeline_stage', label: 'Etapa do Pipeline' }`.
- Em `guessMapping`, adicionar regex `/^etapa|stage|pipeline|funil|fase/i` → `'pipeline_stage'`.

## 2. Seleção do pipeline na tela de mapeamento
- Novos estados: `pipelines`, `stages`, `selectedPipeline`.
- Ao entrar em `step === 'mapping'`: `supabase.from('pipelines').select('id,name').eq('tenant_id', tenantId).order('position')`.
- Se algum mapeamento for `pipeline_stage`, renderizar `<Select>` obrigatório de Pipeline acima do botão de importar.
- Ao escolher pipeline: `supabase.from('stages').select('id,name').eq('pipeline_id', selectedPipeline).order('position')`.
- Bloquear "Importar" enquanto faltar pipeline selecionado.

## 3. Match da etapa por linha
- `stagesByNormName = new Map(stages.map(s => [normKey(s.name), s]))`.
- No loop, capturar `rawStage` da coluna mapeada e resolver `matchedStage = stagesByNormName.get(normKey(rawStage))`.

## 4. Etapa não encontrada = erro só na oportunidade
- Contato é criado/atualizado normalmente.
- Se `rawStage` não-vazio e sem match: push em `errors` com `Etapa "<rawStage>" não corresponde a nenhuma etapa do pipeline "<nome do pipeline>"` e incrementa `stageErrors`.
- `rawStage` vazio → sem oportunidade, sem erro.

## 5. Criar oportunidade + cache em memória da execução
- Novo `Map<string, { opportunityId: string; stageId: string }> createdOrSeenOpps` indexado por `contact_id`, populado durante a execução.
- Para cada linha com `matchedStage`:
  1. Se `createdOrSeenOpps.has(contactId)` → usar essa entrada (não consulta o banco).
  2. Caso contrário, `supabase.from('opportunities').select('id, stage_id').eq('tenant_id', tenantId).eq('contact_id', contactId).eq('pipeline_id', selectedPipeline).eq('status', 'open').limit(1)` e popular o cache com o resultado (se houver).
  3. Se ainda não existir: `insert({ tenant_id, contact_id, pipeline_id: selectedPipeline, stage_id: matchedStage.id, title: c.name, value: 0, priority: 'medium', status: 'open' })`, popular `createdOrSeenOpps` com a oportunidade recém-criada e `oppsCreated++`.

## 6. Já existente igual = ignorar
- Entrada do cache existe e `entry.stageId === matchedStage.id` → `oppsIgnored++`. Aplica tanto a oportunidades que vieram do banco quanto às criadas em linhas anteriores do mesmo CSV.

## 7. Já existente com etapa diferente = conflito
- Entrada do cache com `stageId !== matchedStage.id`: empilhar em `conflicts: { opportunityId, contactName, currentStageId, currentStageName, targetStageId, targetStageName, selected }`.
- Importante: como o cache reflete o estado mais recente (inclusive oportunidades recém-criadas), uma segunda linha com a mesma pessoa e etapa diferente vira conflito real (não duplicata).
- Para evitar conflitos duplicados do mesmo `opportunityId`: manter `Set<opportunityId>` e só empilhar a primeira ocorrência (`targetStage` da primeira linha conflitante prevalece; demais com mesmo target viram `oppsIgnored`, demais com targets diferentes são reportadas em `errors` como conflito ambíguo dentro do CSV).
- Nomes da etapa atual resolvidos em batch no fim: `supabase.from('stages').select('id,name').in('id', [...currentStageIds]).eq('pipeline_id', selectedPipeline)`.
- Novo `step: 'conflicts'` após `'importing'` quando `conflicts.length > 0`: lista com checkbox por item (`Contato — Etapa atual → Etapa da planilha`), "Selecionar todos", botão "Atualizar selecionadas" (executa `update({ stage_id: targetStageId }).eq('id', opportunityId).eq('tenant_id', tenantId)` em série e incrementa `oppsUpdated`) e botão "Pular" (vai ao resumo sem alterar).

## 8. Resumo final
- `importResult` estendido: `oppsCreated`, `oppsIgnored`, `oppsConflicts` (inicial), `oppsUpdated` (pós-confirmação), `stageErrors`.
- Tela de resultado mostra contadores separados: contatos criados, contatos atualizados, oportunidades criadas, oportunidades ignoradas, oportunidades em conflito, oportunidades atualizadas, erros de etapa.
- Erros de etapa entram no mesmo `errors[]` e portanto no CSV via `downloadErrorsCsv`.

## Isolamento por tenant
- Todas as queries de `pipelines`, `opportunities` filtradas por `tenant_id`; `stages` por `pipeline_id` (pipeline já é do tenant).

## Fora de escopo
- Não alterar `normKey`, `parseCSV`, `guessMapping` para outros usos.
- Sem novos arquivos, hooks ou utilitários globais.
- Sem mudança no fluxo de quem não mapeia `pipeline_stage`.
