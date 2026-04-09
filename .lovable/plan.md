

## Plano: Correções de robustez no fluxo de transcrição de áudio

### 3 alterações cirúrgicas, sem mudança de lógica

### 1. Idempotência real no enqueue (`webhook-uazapi`)

- Linha 340: trocar `uazapi-ai-${messageId || conversation.id}-${Date.now()}` por `uazapi-ai-${savedMsg.id}`
- Linha 407: trocar `uazapi-audio-retry-${msgId}-${Date.now()}` por `uazapi-audio-retry-${msg.id}`

### 2. Lock otimista antes do AI reply (`worker/index.js`)

- Linhas 200-213: mover a marcação `audio_reply_sent` para ANTES de `handleAiAutoReply`
- Usar UPDATE condicional com `.is('provider_metadata->audio_reply_sent', null)` como lock otimista
- Se falhar a marcação, pular o envio (outro worker já processou)
- Se falhar o envio, desmarcar o flag para permitir retry

### 3. Self-retry com contador para transcrição falha (`worker/index.js`)

- Linhas 179-182: quando transcrição falha, incrementar `audio_transcription_retries` no metadata
- Se < 3 tentativas, re-enfileirar o job com idempotency key versionada
- Se >= 3 tentativas, desistir com log claro

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/webhook-uazapi/index.ts` | Remover `Date.now()` de 2 idempotency keys |
| `worker/index.js` | Lock otimista + self-retry com contador |

### O que NÃO muda

- `transcribe-audio/index.ts` -- sem alteração
- `ai-generate/index.ts` -- sem alteração
- Lógica de flows, keywords, automations -- sem alteração

