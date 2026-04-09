

## Plano: Corrigir RAG e adicionar filtro por categoria no Prompt Studio

### 1. Migration: adicionar coluna `knowledge_category`

```sql
ALTER TABLE public.prompt_templates
  ADD COLUMN IF NOT EXISTS knowledge_category text DEFAULT NULL;
```

### 2. Corrigir `supabase/functions/ai-generate/index.ts`

- Linha 95: incluir `knowledge_category` no select do promptTemplate
- Linha 181: passar `_category: promptTemplate?.knowledge_category || null` no `search_knowledge`
- Linha 199: reescrever instrução RAG para responder diretamente em vez de perguntar ao lead qual procedimento

### 3. Atualizar `src/pages/PromptStudioPage.tsx`

- Adicionar estado `knowledgeCategory` e `categories` (lista de categorias distintas dos `knowledge_documents`)
- Carregar categorias via query em `knowledge_documents` no `useEffect`
- Adicionar Select de categoria no dialog de criação/edição
- Incluir `knowledge_category` nos inserts e updates do `handleSave`
- Incluir na interface `PromptTemplate`, em `openEdit`, em `resetForm`, e em `handleDuplicate`

### Arquivos

| Arquivo | Alteração |
|---|---|
| Nova migration SQL | `ADD COLUMN knowledge_category` |
| `supabase/functions/ai-generate/index.ts` | Select com campo, filtro por categoria, instrução RAG corrigida |
| `src/pages/PromptStudioPage.tsx` | UI: Select de categoria + lógica de save |

### O que NÃO muda

- RPC `search_knowledge` (já aceita `_category`)
- `knowledge_documents` (já tem `category`)
- KnowledgeBaseSettings, ingest-document

