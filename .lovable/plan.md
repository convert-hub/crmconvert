

## Plano: Mover extração de PDF para o servidor e simplificar o frontend

### Problema
O `pdfjs-dist` no browser falha silenciosamente e o `EdgeRuntime.waitUntil()` causa `Memory limit exceeded` porque o processamento continua após o request encerrar, sem controle de recursos. O documento fica preso em "Processando".

### Mudanças

#### 1. `supabase/functions/ingest-document/index.ts` — Reescrever

- Importar `pdf-parse` via `https://esm.sh/pdf-parse@1.1.1/lib/pdf-parse.js`
- `extractTextFromStorage`: para PDFs, ler como `arrayBuffer()` → `Uint8Array` → `pdf(uint8)` → `result.text`, com try/catch (retorna string vazia se falhar)
- `processDocument`: remover parâmetro `preExtractedText`. Sempre extrair do arquivo no storage
- Handler `serve()`: body aceita apenas `document_id` e `tenant_id`
- Remover `EdgeRuntime.waitUntil()` — processar de forma síncrona dentro do request
- Batch de embeddings reduzido para 3 chunks por vez
- `console.log` em cada etapa (início, texto extraído, chunks, batches, conclusão)
- Todos os pontos de erro atualizam status para "error" com mensagem descritiva

#### 2. `src/components/settings/KnowledgeBaseSettings.tsx` — Simplificar

- Remover função `extractPdfTextInBrowser` e import de `pdfjs-dist`
- `handleUpload`: remover extração de PDF no browser. Apenas upload → insert → chamar edge function com `{document_id, tenant_id}`
- `callIngestFunction`: remover parâmetro `extractedText`, body só com `document_id` e `tenant_id`
- `reprocessDocument`: remover lógica de re-download e extração. Apenas resetar status + chamar `callIngestFunction`
- Manter todo o resto (UI, listagem, delete, status, botão reprocessar)

#### 3. `package.json` — Remover `pdfjs-dist`

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/ingest-document/index.ts` | Reescrito: PDF via pdf-parse no servidor, síncrono, sem waitUntil |
| `src/components/settings/KnowledgeBaseSettings.tsx` | Removida extração client-side, simplificado upload e reprocessamento |
| `package.json` | Removido `pdfjs-dist` |

