## Objetivo
Permitir, na aba "Pipeline" das Configurações: editar nome/cor das etapas, reordenar via drag-and-drop e (já existe) criar novas. Sem quebrar fluxos atuais (kanban, automações de inatividade, regras dependentes de `is_won`/`is_lost`).

## Mudanças (apenas `src/pages/SettingsPage.tsx`)

1. **Edição inline**
   - Nome: célula vira `Input` (onBlur salva via `update({ name })`).
   - Cor: o atual swatch vira um `<input type="color">` que dispara `update({ color })` no `onChange`.
   - Disponível somente para `isAdmin`. Etapas `is_won`/`is_lost` continuam editáveis em nome/cor (não no tipo).

2. **Reordenação por drag-and-drop**
   - Reaproveitar `@dnd-kit/core` + `@dnd-kit/sortable` (já no projeto, usado em `PipelinePage`).
   - Coluna "Pos." vira handle com `GripVertical`.
   - Ao soltar: aplicar `arrayMove`, atualizar estado local imediatamente (otimista) e persistir em lote chamando `supabase.from('stages').update({ position: i }).eq('id', s.id)` para cada etapa cuja posição mudou (Promise.all). Em caso de erro, recarregar via `loadAll()`.

3. **Sem mudanças** em: criação (já funciona), exclusão, campo de inatividade, schema do banco, RLS, types, ou no consumo do kanban (que já faz `.order('position')`).

## Detalhes técnicos
- `stages` continua ordenado por `position` ao carregar.
- A reordenação não altera `is_won`/`is_lost` nem `inactivity_minutes`.
- Otimização: só envia update para etapas cujo índice mudou.
- O kanban (`PipelinePage`) lê stages com `.order('position')`, portanto refletirá a nova ordem automaticamente.

## Riscos / Mitigações
- **Concorrência**: dois admins reordenando simultaneamente — risco baixo; `loadAll()` no erro/sucesso reconcilia.
- **Validação de nome vazio**: bloquear `update` se trimmed vazio (mantém valor anterior).
- **Sem impacto** em automações: elas referenciam `stage_id`, não posição.
