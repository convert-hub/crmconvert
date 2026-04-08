

## Plano: Transcrição de áudio (Speech-to-Text) com OpenAI Whisper

### Resumo

Quando o contato envia áudio, o worker transcreve via Whisper antes de passar para a IA. A transcrição é salva no `provider_metadata` da mensagem e exibida na UI abaixo do player de áudio.

### 1. Nova edge function `supabase/functions/transcribe-audio/index.ts`

- Recebe `media_url`, `message_id`, `tenant_id`
- Obtém API key via hierarquia existente (tenant ai_config → global_api_key → env OPENAI_API_KEY)
- Baixa o áudio da URL
- Envia para `https://api.openai.com/v1/audio/transcriptions` (modelo `whisper-1`, language `pt`)
- Salva transcrição em `messages.provider_metadata.audio_transcription`
- Retorna `{ transcription: "..." }`
- CORS headers padrão

### 2. Nova função `transcribeAudio()` no `worker/index.js`

- Função auxiliar isolada que chama a edge function `transcribe-audio` via fetch
- Retorna `null` em caso de falha (fail-safe, não impacta fluxo)

### 3. Integrar transcrição nos dois paths de auto-reply

**Path 1 — `already_saved` (linha ~151-153):**
- Antes de `handleAiAutoReply`, verificar se `message_text` está vazio
- Se vazio, buscar última mensagem inbound da conversa
- Se `media_type` contém "audio", chamar `transcribeAudio`
- Usar transcrição como `effectiveMessageText`

**Path 2 — Legacy (linha ~187-254):**
- Problema: a linha 187 faz `if (!phone || !text) return` — áudios sem texto são descartados
- Solução: relaxar a condição para `if (!phone) return` (permitir mensagens sem texto se tiverem mídia)
- Extrair `mediaType` e `mediaUrl` do payload UAZAPI
- Antes do `handleAiAutoReply` (linha 254), se não há texto mas há áudio, transcrever
- Usar transcrição como `effectiveText`

**Nota importante**: No path legacy, o campo `text` vazio faz o worker ignorar a mensagem inteira (linha 187). É necessário ajustar essa condição para permitir mensagens de áudio (que não têm texto). A mídia será extraída dos campos `msg.mediaUrl` ou `msg.media?.url` do payload UAZAPI.

### 4. Exibir transcrição na UI — `ChatPanel.tsx`

No componente `MediaBubble`, após o `AudioPlayer` (linha 155), adicionar:

```tsx
{(msg as any).provider_metadata?.audio_transcription && (
  <p className="text-xs italic opacity-70 mt-1">
    📝 {(msg as any).provider_metadata.audio_transcription}
  </p>
)}
```

A transcrição aparece automaticamente quando o `provider_metadata` é atualizado (via realtime subscription que já escuta UPDATE na tabela messages).

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/transcribe-audio/index.ts` | **Novo** — edge function de transcrição |
| `worker/index.js` | Nova função `transcribeAudio`, integração nos 2 paths, relaxar guard clause do legacy path |
| `src/components/inbox/ChatPanel.tsx` | Exibir transcrição abaixo do AudioPlayer |

### O que NÃO muda

- `ai-generate`, `ai-copilot`, `uazapi-proxy` — sem alteração
- `handleAiAutoReply` — recebe texto como sempre
- Webhook functions — sem alteração
- AudioPlayer/AudioRecorder — sem alteração
- Flows/Automações — sem alteração

### Nota

Requer rebuild do container Docker do worker e deploy da edge function para funcionar em produção.

