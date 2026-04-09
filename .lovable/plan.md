
Diagnóstico atual

O fluxo não está correto hoje. Pela leitura do código, existem 4 pontos que explicam por que a IA ainda responde “não consigo ouvir áudios”:

1. A transcrição acontece tarde demais no `worker/index.js`:
   - ela só roda dentro do bloco de auto-reply, quando `metadata.ai_activated === true`
   - então áudio não entra em keyword activation nem em flows antes disso

2. Se a transcrição falha, o worker continua chamando a IA com texto vazio:
   - isso deixa o `ai-generate` enxergar só o placeholder da mídia (`[AudioMessage]` / `[mídia]`)

3. O `ai-generate` recebe `incoming_message`, mas hoje usa isso só no RAG:
   - a conversa enviada ao OpenAI continua vindo do histórico salvo no banco
   - para áudio, esse histórico ainda contém o placeholder, não a transcrição

4. A `transcribe-audio` está baixando a URL bruta do WhatsApp:
   - os logs mostram `application/octet-stream` + `Invalid file format`
   - isso indica que a fonte do áudio precisa ser resolvida pelo fluxo normal de download da UAZAPI, não só por `fetch(media_url)`

Plano de correção

1. Centralizar a “mensagem efetiva” no worker
   - criar um helper para resolver o texto real da entrada:
     - se for texto, usa o texto
     - se for áudio, transcreve
   - esse helper deve rodar antes de:
     - `checkKeywordAndActivateAi`
     - `handleAiAutoReply`
     - `triggerMessageReceivedFlows`

2. Mover a transcrição para antes das decisões de negócio
   - no `process_uazapi_message`, calcular `effectiveText` logo após localizar a mensagem inbound
   - assim áudio passa a participar do fluxo completo, e não só do trecho de auto-reply já ativado

3. Corrigir a fonte do áudio em `transcribe-audio`
   - usar a mensagem salva para buscar `provider_message_id`
   - baixar a mídia pela lógica da UAZAPI (`/message/download`, com `base64` / `fileURL` / `mimetype`), reaproveitando o mesmo padrão do `uazapi-proxy`
   - deixar `media_url` bruto só como fallback
   - continuar salvando `provider_metadata.audio_transcription`

4. Impedir que áudio sem transcrição vá para a IA
   - se a mensagem for áudio e a transcrição vier vazia/erro, não chamar `handleAiAutoReply`
   - para não perder a resposta automática, reprocessar quando a mídia estiver pronta:
     - opção principal: reenfileirar no `webhook-uazapi` ao receber status `FileDownloaded`
     - isso garante a ordem correta: mídia pronta → transcrição → IA

5. Fazer o `ai-generate` realmente usar a transcrição
   - em `mode: "auto_reply"`, se existir `incoming_message`, substituir ou anexar esse texto como última mensagem inbound enviada ao OpenAI
   - hoje ele só usa `incoming_message` para RAG; após o ajuste, o modelo passa a responder com base no áudio transcrito de fato

6. Aplicar o texto transcrito ao restante do fluxo
   - `checkKeywordAndActivateAi` deve usar `effectiveText`
   - `triggerMessageReceivedFlows` também deve usar `effectiveText`
   - isso permite:
     - áudio ativar IA por keyword
     - áudio disparar flows baseados em mensagem recebida

Arquivos envolvidos

- `worker/index.js`
- `supabase/functions/transcribe-audio/index.ts`
- `supabase/functions/ai-generate/index.ts`
- `supabase/functions/webhook-uazapi/index.ts`

Detalhes técnicos

- Melhor regra no `ai-generate`: se a última inbound do histórico for placeholder/`null`, trocar pelo `incoming_message`; se não houver placeholder, anexar uma última mensagem `user` sintética.
- Melhor regra no worker: para áudio, sem transcrição válida não existe chamada de IA.
- A UI já está preparada para exibir `provider_metadata.audio_transcription`, então o foco aqui é corrigir o backend e a ordem do fluxo.
- Não precisa migration de banco.

Validação final

- Conversa já ativada + áudio: transcreve, salva no metadata, mostra no inbox e responde sobre o conteúdo falado
- Conversa não ativada + áudio com keyword: transcreve, ativa IA e responde
- Transcrição falhou ou mídia ainda não pronta: IA não responde “não consigo ouvir áudios”; fluxo aguarda/reprocessa
- Texto normal continua igual, sem regressão
