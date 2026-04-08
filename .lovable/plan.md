
Resumo

O problema não é mais “esfriar” o worker. O upload do arquivo está funcionando; o que quebra é a ingestão depois do upload. Pela leitura do código + logs, hoje existem 3 causas reais:

1. `ingest-document` entra em loop infinito no chunking quando o texto final fica com tamanho igual ao overlap. Foi exatamente o caso do log: texto com 385 chars, depois o `start` para de avançar e a função morre com `Memory limit exceeded`.
2. A tela ainda tenta extrair PDF no browser com `pdfjs-dist` e enviar `extracted_text`, mas isso já se mostrou instável.
3. A UI chama a edge function com `fetch` manual, enquanto o projeto já usa `supabase.functions.invoke()` em vários lugares. Isso deixa o reprocessamento mais frágil e pode explicar o `Failed to fetch`.

Plano de correção

1. Mover a ingestão pesada para o Worker
- Criar um job `ingest_document` no `worker/index.js`.
- O worker passa a fazer: download do arquivo no bucket, extração de texto, chunking, embeddings e gravação em `knowledge_chunks`.
- A edge function `ingest-document` fica curta: valida `document_id/tenant_id`, marca o documento como `processing`, limpa erro antigo e enfileira o job.
- Isso evita limite de memória/timeout da Edge para PDFs reais.

2. Corrigir o algoritmo de chunking
- Reescrever o loop para nunca reutilizar o mesmo `start`.
- Encerrar explicitamente ao atingir o trecho final.
- Adicionar guarda do tipo `if (nextStart <= start) break`.
- Isso remove a causa imediata do `WORKER_LIMIT`.

3. Simplificar a UI de upload/reprocessamento
- Remover `extractPdfTextInBrowser`, `extractPdfTextFromBlob` e toda dependência de `pdfjs-dist`.
- Trocar a chamada manual por `supabase.functions.invoke('ingest-document', { body: { document_id, tenant_id } })`.
- `handleUpload` fica: upload no storage → insert em `knowledge_documents` → invoke.
- `reprocessDocument` fica: reset status/erro/chunks → invoke novamente.

4. Normalizar status e timestamps
- Garantir transição consistente: `pending` → `processing` → `completed` ou `error`.
- Sempre atualizar `error` com mensagem clara ao falhar.
- Apagar chunks antigos antes de reprocessar.
- Adicionar trigger `update_updated_at_column` em `knowledge_documents` para o botão de “Reprocessar” detectar travamentos de forma confiável.

5. Dependências e observabilidade
- Remover `pdfjs-dist` do frontend.
- Adicionar `pdf-parse` no ambiente do worker.
- Melhorar logs por etapa: download, extração, tamanho do texto, quantidade de chunks, lote de embeddings e conclusão.

Arquivos que entram nessa correção
- `src/components/settings/KnowledgeBaseSettings.tsx`
- `supabase/functions/ingest-document/index.ts`
- `worker/index.js`
- `worker/package.json`
- `package.json`
- nova migration para trigger de `updated_at` em `knowledge_documents`

Resultado esperado
- O upload volta a funcionar porque a etapa pesada sai da Edge.
- O botão “Reprocessar” deixa de depender de parse no navegador.
- O erro de memória some porque o loop infinito no chunking é eliminado.
- Os documentos deixam de ficar presos em “Processando”.

Detalhes técnicos
```text
UI
  upload arquivo
    -> storage crm-files
    -> insert knowledge_documents (pending)
    -> invoke ingest-document

Edge function (rápida)
  valida request
    -> update knowledge_documents = processing
    -> enqueue_job('ingest_document')
    -> responde 200

Worker
  download storage
    -> extract text (PDF via pdf-parse / texto via .text())
    -> chunking seguro
    -> embeddings em lotes
    -> insert knowledge_chunks
    -> update knowledge_documents = completed | error
```

Observação importante
Como a lógica passará pelo `worker/index.js`, essa parte só entra em vigor em produção após restart/rebuild do serviço worker.
