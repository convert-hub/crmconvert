
Diagnóstico confirmado

- O código-fonte atual já tenta transcrever antes da IA, mas os dados em produção mostram outro comportamento:
  - a mensagem inbound ficou como `[AudioMessage]`
  - `provider_metadata.audio_transcription` continuou `null`
  - a IA gerou 2 respostas iguais para o mesmo áudio
  - houve 2 jobs `process_uazapi_message` para o mesmo evento
- Isso indica 2 problemas ao mesmo tempo:
  1. o worker em produção provavelmente não está rodando exatamente a lógica nova
  2. a transcrição ainda não está resolvendo a mídia corretamente em todos os casos
- O `ai-generate` e a UI já estão preparados; o gargalo real está antes deles.

Plano de correção

1. Sincronizar o runtime do worker
- Garantir que o worker em produção esteja com a versão atual do `worker/index.js`
- Adicionar logs claros no worker para cada áudio:
  - `message_id`
  - se é áudio
  - se transcreveu
  - se pulou IA por falta de transcrição
  - se respondeu

2. Tornar o fluxo baseado na mensagem exata
- No `webhook-uazapi`, enfileirar `process_uazapi_message` com o `message_id` salvo no banco
- No worker, parar de buscar “a última inbound da conversa”
- Sempre carregar a mensagem exata pelo `message_id`
- Isso evita pegar a mensagem errada e reduz corrida entre o evento inicial e o `FileDownloaded`

3. Corrigir o download da mídia na `transcribe-audio`
- Hoje a função usa `/message/download` com contrato diferente do caminho que já funciona no `uazapi-proxy`
- Ajustar para espelhar a lógica já validada:
  - usar `id`
  - tentar `owner:messageId`
  - fallback para `messageId` curto
  - aceitar resposta em `base64`, `fileURL` ou binário
- Manter `media_url` bruto apenas como fallback final

4. Bloquear resposta da IA sem transcrição válida
- Se a mensagem for áudio e a transcrição não existir, o worker não deve chamar `handleAiAutoReply`
- Em vez disso, ele só encerra e espera o retry do `FileDownloaded`
- Isso elimina a resposta errada “não consigo ouvir áudio”

5. Impedir resposta duplicada
- O mesmo áudio hoje está sendo processado 2 vezes
- Antes de responder, o worker deve checar se aquela mensagem já foi processada
- Marcar no `provider_metadata` da própria mensagem algo como:
  - `audio_ai_processed_at`
  - ou `audio_reply_sent: true`
- O retry por `FileDownloaded` só deve rodar se ainda não houver transcrição e ainda não houver resposta enviada para aquela mensagem

6. Validar ponta a ponta
- Cenário 1: áudio novo ainda não disponível
  - primeira execução não responde
  - `FileDownloaded` reenfileira
  - transcreve
  - envia 1 única resposta
- Cenário 2: áudio já disponível
  - transcreve na primeira tentativa
  - salva `audio_transcription`
  - IA responde com base no conteúdo falado
- Cenário 3: falha real de mídia
  - não envia resposta automática errada
  - mantém comportamento controlado sem duplicidade

Arquivos envolvidos

- `worker/index.js`
- `supabase/functions/transcribe-audio/index.ts`
- `supabase/functions/webhook-uazapi/index.ts`

Detalhes técnicos

- Não precisa migration; dá para usar `provider_metadata` para flags de processamento
- O ajuste principal é operacional:
  - usar a mensagem exata
  - espelhar o download correto da UAZAPI
  - garantir idempotência por mensagem
- O `ai-generate` pode ficar como está, porque ele já aceita `incoming_message`

Resultado esperado

- Áudio gera no máximo 1 resposta automática
- A transcrição passa a ser salva no banco
- A IA responde sobre o conteúdo falado, não sobre o placeholder `[AudioMessage]`
- Se a mídia ainda não estiver pronta, o sistema espera o retry em vez de inventar que “não consegue ouvir áudio”
