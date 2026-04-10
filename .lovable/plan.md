

## Plano: Seletor de Documentos por Agente (N:N)

### 1. Migration SQL

- Criar tabela `prompt_template_documents` (N:N) com FK CASCADE para ambos os lados, RLS e índices
- Adicionar overload de `search_knowledge` com parâmetro `_document_ids uuid[] DEFAULT NULL` que filtra por `kc.document_id = ANY(_document_ids)`

### 2. Alterar `supabase/functions/ai-generate/index.ts`

- Linha 95: incluir `id` no select do promptTemplate
- Antes da linha 182: buscar `document_ids` da tabela `prompt_template_documents` usando o `promptTemplate.id`
- Linha 182-188: passar `_document_ids` ao `search_knowledge`; se tem document_ids, ignorar `_category`

### 3. Reescrever `src/pages/PromptStudioPage.tsx`

- Adicionar estados: `documents`, `selectedDocIds`, `templateDocMap`
- `load()`: carregar documentos ready + todos os vínculos `prompt_template_documents` para montar `templateDocMap`
- `openEdit()`: carregar vínculos do template específico em `selectedDocIds`
- `resetForm()`: limpar `selectedDocIds`
- Substituir Select de categoria (linhas 141-151) por multi-select com checkboxes agrupados por categoria, usando `Checkbox` de shadcn
- `handleSave()`: após insert/update, deletar vínculos antigos e inserir novos; no fluxo de versionamento, usar o id da nova versão retornado pelo `.insert().select()`
- `handleDuplicate()`: usar `.insert().select()` para obter o id, depois copiar vínculos
- Card: substituir badge de `knowledge_category` por badge "X docs" ou "Todos os docs"

### Arquivos

| Arquivo | Alteração |
|---|---|
| Nova migration SQL | Tabela N:N + overload `search_knowledge` |
| `supabase/functions/ai-generate/index.ts` | Buscar document_ids, passar ao RPC |
| `src/pages/PromptStudioPage.tsx` | Multi-select de documentos, salvar/carregar vínculos |

### O que NÃO muda

- Coluna `knowledge_category` em `prompt_templates` (backward compat/fallback)
- Fluxo de upload, ingest, embedding
- RLS das outras tabelas

