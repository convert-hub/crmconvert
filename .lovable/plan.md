

## Plano: Corrigir transcrição de áudio (formato de arquivo inválido)

### Problema

Os logs da edge function `transcribe-audio` mostram:
```
Whisper error 400: Invalid file format. Supported formats: ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']
```

O áudio é baixado do WhatsApp como blob e enviado ao Whisper sempre como `"audio.ogg"`, sem preservar o content-type real. O Whisper rejeita o arquivo, a transcrição falha, e a IA recebe mensagem vazia -- respondendo "não consigo ouvir áudios".

### Solução

Alterar `supabase/functions/transcribe-audio/index.ts` para:

1. Capturar o `Content-Type` da resposta HTTP ao baixar o áudio do WhatsApp
2. Mapear o MIME type para a extensão correta (ex: `audio/ogg` -> `.ogg`, `audio/mp4` -> `.m4a`, `audio/mpeg` -> `.mp3`)
3. Usar a extensão correta no `formData.append("file", audioBlob, "audio.EXT")`
4. Se o Content-Type não for reconhecido, tentar inferir da URL ou usar fallback `.ogg`

### Detalhes técnicos

Mapa de MIME types para extensões Whisper:
```typescript
const mimeToExt: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'application/ogg': 'ogg',
  'audio/opus': 'ogg',  // WhatsApp PTT uses opus in ogg container
};
```

WhatsApp frequentemente envia áudios PTT (push-to-talk) como `audio/ogg; codecs=opus`. O código deve fazer split no `;` antes de buscar no mapa.

### Arquivo alterado

| Arquivo | Alteração |
|---|---|
| `supabase/functions/transcribe-audio/index.ts` | Detectar content-type real, mapear para extensão correta |

