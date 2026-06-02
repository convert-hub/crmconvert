## Objetivo
Rollback de ffmpeg.wasm → opus-recorder, mantendo todas as melhorias estruturais (Storage-first, currentConvIdRef, dedup, idempotência inbound, normalização de telefone, assinatura `sendMedia(mediaUrl)`).

## Mudanças

### 1. `package.json`
- **Remover** de `dependencies`: `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`.
- **Adicionar** em `dependencies`: `"opus-recorder": "^8.0.5"`.
- **Scripts**:
  - Remover `prebuild`.
  - `build`: `"vite build"` (sem `npm run prebuild &&`).
  - `build:dev`: `"vite build --mode development"`.

### 2. `public/encoderWorker.min.js`
Restaurar arquivo. Fonte (em ordem):
1. `node_modules/opus-recorder/dist/encoderWorker.min.js` após `npm install`.
2. Fallback: `https://raw.githubusercontent.com/convert-hub/crmconvert/84b90e128ee04d798f2291235da2495dcea6f19f/public/encoderWorker.min.js`.

### 3. `src/components/inbox/AudioRecorder.tsx`
Restaurar para versão do commit `13048dd3`:
- URL: `https://raw.githubusercontent.com/convert-hub/crmconvert/13048dd3/src/components/inbox/AudioRecorder.tsx`.
- Características: `await import('opus-recorder')` com `encoderPath: '/encoderWorker.min.js'` em modo `meta_cloud`; produz `File` com `type: 'audio/ogg'`; fallback nativo `audio/webm` para UAZAPI ou quando opus-recorder falhar.

### 4. `src/lib/audioTranscode.ts`
**DELETAR** o arquivo.

### 5. `src/components/inbox/ChatPanel.tsx`
Em `handleSendMedia`, remover o bloco do transcode (`let fileToUpload: File = file;` até o fechamento do `if`, ~linhas 317–337). Voltar a usar `file` direto no upload do Storage, signed URL e `sendMedia`. Manter intactos: `currentConvIdRef`, validação de tamanho, validação `providerInfo`, fluxo Storage-first.

### 6. `nginx.conf`
Restaurar para versão do commit `cbfc2404`:
- URL: `https://raw.githubusercontent.com/convert-hub/crmconvert/cbfc2404/nginx.conf`.
- Sem `types {}`, sem headers COEP/COOP/CORP, sem `wasm` no `location ~*` nem em `gzip_types`.

### 7. `.gitignore`
Remover a linha `public/ffmpeg/`.

## Arquivos NÃO tocados
- `src/lib/whatsappRouter.ts` (assinatura `sendMedia(mediaUrl)` mantida).
- `supabase/functions/wa-meta-send/index.ts` (validação MIME já aceita `audio/ogg`).
- `supabase/functions/webhook-meta/index.ts` (idempotência inbound).
- `src/lib/phone.ts`, `src/lib/mimeCodec.ts`.
- Migrations e demais arquivos.

## Validação
1. Antes de aplicar: revisar diff de cada arquivo no GitHub.
2. Após `npm install`: confirmar que `node_modules/opus-recorder/dist/encoderWorker.min.js` existe e foi copiado para `public/`.
3. No VPS: `docker compose build app && docker compose up -d --no-deps --force-recreate app`.
4. Browser (Ctrl+Shift+R): gravar áudio em conversa Meta Cloud, confirmar upload `audio/ogg` direto, sem chamadas a ffmpeg.

Sem deploy automático.