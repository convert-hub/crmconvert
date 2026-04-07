

## Plano: RAG Completo com Categorização por Procedimento/Campanha

### Resumo
Cinco alterações coordenadas para que o agente de IA identifique automaticamente o procedimento do lead e responda com o contexto correto da base de conhecimento.

---

### 1. Migration SQL

Adicionar colunas e recriar a função de busca:

```sql
ALTER TABLE public.knowledge_documents 
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.knowledge_chunks 
  ADD COLUMN IF NOT EXISTS document_name text;

CREATE OR REPLACE FUNCTION public.search_knowledge(
  _tenant_id uuid,
  _query_embedding vector,
  _match_count integer DEFAULT 5,
  _match_threshold double precision DEFAULT 0.7,
  _category text DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, document_id uuid, similarity double precision, document_name text, category text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    kc.id, kc.content, kc.document_id,
    (1 - (kc.embedding <=> _query_embedding))::FLOAT AS similarity,
    kc.document_name,
    kd.category
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.tenant_id = _tenant_id
    AND (1 - (kc.embedding <=> _query_embedding)) > _match_threshold
    AND (_category IS NULL OR kd.category = _category)
  ORDER BY kc.embedding <=> _query_embedding
  LIMIT _match_count;
$$;
```

---

### 2. KnowledgeBaseSettings.tsx

- Add `category` state and a text input labeled "Categoria / Procedimento" in the upload area
- Pass `category` when inserting into `knowledge_documents`
- Add "Categoria" column to the documents table showing `doc.category || '—'`

---

### 3. ingest-document/index.ts

- Fetch `doc.name` and `doc.category` (already available from the document query)
- When inserting chunk rows, add `document_name: doc.name`
- In metadata, add `category: doc.category || null`

---

### 4. ai-copilot/index.ts (RAG section ~lines 144-154)

Replace flat `chunks.map(c => c.content).join(...)` with grouped logic:

```typescript
if (chunks && chunks.length > 0) {
  const groups = new Map<string, string[]>();
  for (const c of chunks) {
    const key = c.document_name || c.category || "Geral";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c.content);
  }
  ragContext = "\n\n--- BASE DE CONHECIMENTO ---\nInformações organizadas por procedimento:\n\n";
  for (const [name, contents] of groups) {
    ragContext += `Procedimento: ${name}\n${contents.join("\n---\n")}\n\n`;
  }
  ragContext += "INSTRUÇÃO: Identifique sobre qual procedimento o lead pergunta e responda APENAS com informações do procedimento correto. Se não houver na base, diga que vai verificar com a equipe.";
}
```

---

### 5. worker/index.js (RAG section ~lines 851-859)

Apply identical grouping logic as item 4, replacing the flat join with the `Map`-based grouping and the instruction suffix.

---

### Arquivos alterados

| Arquivo | Tipo de alteração |
|---|---|
| Migration SQL (nova) | Adicionar colunas + recriar função |
| `src/components/settings/KnowledgeBaseSettings.tsx` | Campo categoria + coluna na tabela |
| `supabase/functions/ingest-document/index.ts` | `document_name` nos chunks |
| `supabase/functions/ai-copilot/index.ts` | Agrupamento RAG por procedimento |
| `worker/index.js` | Agrupamento RAG por procedimento |

