

## Plano: Corrigir extração de PDF e adicionar botão Reprocessar

### Problema
O `ingest-document` usa `fileData.text()` + regex para PDFs, o que não funciona para PDFs binários comprimidos. O documento fica preso em "Processando" e causa `Memory limit exceeded`.

### Mudanças

#### 1. `supabase/functions/ingest-document/index.ts`

- Adicionar `import pdf from "https://esm.sh/pdf-parse@1.1.1";` no topo
- Substituir o bloco de extração de texto (linhas 44-75) por:
  - Para `text/plain`, `text/csv`, `text/markdown`, `application/json`: manter `fileData.text()` como está
  - Para PDFs (`mime.includes("pdf")`): usar `pdf-parse` com `arrayBuffer()` → `Uint8Array` → `pdf(uint8)` → `pdfResult.text`, com try/catch dedicado e fallback para regex
  - Para outros tipos: manter fallback com `fileData.text()` + limpeza de caracteres
- Adicionar `console.log` em pontos-chave: início do processamento, tamanho do texto extraído, quantidade de chunks, cada batch de embeddings
- No `catch` geral, garantir `console.error` detalhado + atualização de status para "error"
- Antes de processar, limpar chunks antigos do mesmo documento (para suportar reprocessamento): `DELETE FROM knowledge_chunks WHERE document_id = X`

#### 2. `src/components/settings/KnowledgeBaseSettings.tsx`

- Adicionar interface `updated_at` ao tipo `KnowledgeDoc`
- Criar função `reprocessDocument(doc)` que:
  - Deleta chunks existentes do documento
  - Reseta status para "pending" e chunk_count para 0
  - Chama a edge function `ingest-document` com `document_id` e `tenant_id`
- Criar helper `isStuckProcessing(doc)`: retorna `true` se status é "processing" e `updated_at` é > 2 minutos atrás
- Na coluna de ações da tabela, ao lado do botão de deletar, mostrar botão "Reprocessar" (ícone `RefreshCw`) quando `isStuckProcessing(doc)` ou status é "error"

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/ingest-document/index.ts` | PDF via pdf-parse, logs, limpeza de chunks antigos |
| `src/components/settings/KnowledgeBaseSettings.tsx` | Botão reprocessar para docs stuck/error |

