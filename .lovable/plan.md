# Transcoding cliente webm-opus → ogg-opus via ffmpeg.wasm (v2 — com ajustes)

Hipótese validada em produção: Meta Cloud aceita `audio/ogg;codecs=opus` puro. Como webm-opus e ogg-opus compartilham o mesmo codec Opus, basta re-muxar (sem re-encode).

## 1. Dependências

- `@ffmpeg/ffmpeg@^0.12.10`
- `@ffmpeg/util@^0.12.1`

Versão `@ffmpeg/core` pinada em **`0.12.10`** (constante exportada de `audioTranscode.ts` — sem wildcard).

## 2. `src/lib/audioTranscode.ts` (novo)

```ts
const FFMPEG_CORE_VERSION = '0.12.10';
const CDN_PRIMARY = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const CDN_FALLBACK = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export async function transcodeToOggOpus(file: File): Promise<File>
```

Detalhes:
- Singleton module-level: `ffmpegInstance` + `loadPromise` para deduplicar inicialização concorrente.
- `getFFmpeg()`:
  - `await import('@ffmpeg/ffmpeg')` e `await import('@ffmpeg/util')` (lazy / code-split).
  - Tenta `toBlobURL(`${CDN_PRIMARY}/ffmpeg-core.js`, 'text/javascript')` + `.wasm` (`application/wasm`).
  - Em caso de erro de rede/fetch no unpkg, retry automático contra `CDN_FALLBACK` (jsdelivr). Log explícito de qual CDN serviu.
  - `ffmpeg.load({ coreURL, wasmURL })`.
- Transcodificação:
  1. `const t0 = performance.now();`
  2. `const sizeIn = file.size;`
  3. `writeFile('in.webm', await fetchFile(file))`
  4. `exec(['-i', 'in.webm', '-c:a', 'copy', '-f', 'ogg', 'out.ogg'])`
  5. `readFile('out.ogg')` → `Uint8Array`
  6. Limpar FS (`deleteFile` em ambos, try/catch silencioso).
  7. Construir `out = new File([data], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' })`.
  8. Log estruturado:
     ```
     console.info('[audioTranscode] done', {
       inputType: file.type, inputSize: sizeIn,
       outputType: out.type, outputSize: out.size,
       durationMs: Math.round(performance.now() - t0),
     });
     ```
  9. Log no início também: `console.info('[audioTranscode] start', { inputType, inputSize })`.
- Erros do `exec` lançam `Error('Falha ao converter áudio para OGG')` com `cause` original e log `console.error('[audioTranscode] failed', { ... })`.

## 3. `src/components/inbox/AudioRecorder.tsx`

- Adicionar `PREFERRED_RECORDING_MIMES = ['audio/webm;codecs=opus', 'audio/webm']` como primeira tentativa.
- Se nenhum suportado, cair para `pickRecorderMime(provider)` (cascata atual — Safari mp4/aac).
- Não emitir `onUnsupported` para `meta_cloud` quando webm está disponível (transcode resolve).
- Só dispara `onUnsupported` se nem webm nem nada da cascata existir.

## 4. `src/components/inbox/ChatPanel.tsx` — `handleSendMedia`

Logo após determinar `mediaType` e ANTES do bloco de tamanho MAX, inserir:

```ts
let fileToUpload = file;

if (
  file.type.startsWith('audio/') &&
  providerInfo?.provider === 'meta_cloud' &&
  !file.type.startsWith('audio/ogg')
) {
  const t = toast.loading('Processando áudio...');
  try {
    const { transcodeToOggOpus } = await import('@/lib/audioTranscode');
    fileToUpload = await transcodeToOggOpus(file);
  } catch (e) {
    toast.dismiss(t);
    toast.error('Não foi possível processar o áudio para envio.');
    return;
  }
  toast.dismiss(t);
}

// RE-VALIDAÇÃO de tamanho após transcode (re-mux pode alterar o size)
const MAX = mediaType === 'audio' ? 16 * 1024 * 1024
          : mediaType === 'image' ? 5 * 1024 * 1024
          : mediaType === 'video' ? 16 * 1024 * 1024
          : 100 * 1024 * 1024;
if (fileToUpload.size > MAX) {
  toast.error('Arquivo excede o limite após processamento.');
  return;
}
```

Substituir todos os usos subsequentes de `file` por `fileToUpload` dentro de `handleSendMedia` — incluindo:
- derivação de `ext`/`storagePath`,
- `supabase.storage.from('whatsapp-media').upload(storagePath, fileToUpload, ...)`,
- `mimeType: fileToUpload.type` em `sendMedia(...)`,
- qualquer `filename`/preview otimista derivado do arquivo.

Confirmado: o condicional usa `providerInfo?.provider === 'meta_cloud'` (a variável existe no escopo do componente em `ChatPanel.tsx:277`), **não** `provider`.

## 5. Sem alterações

- `src/lib/mimeCodec.ts` — cascata e fallback Safari permanecem.
- `src/lib/whatsappRouter.ts` — assinatura `sendMedia(mediaUrl)` intacta.
- `supabase/functions/wa-meta-send` — validação MIME mantida.
- Fluxo Storage-first (upload → signed URL → sendMedia) inalterado.

## 6. Bundle / performance

- ffmpeg.wasm (~25MB core+wasm) é lazy-loaded via dynamic `import()` + `toBlobURL` do CDN, fora do bundle inicial.
- Singleton em memória: gravações subsequentes na sessão reusam a instância.
- Re-mux com `-c:a copy`: tipicamente < 500ms para áudios de poucos minutos.

## 7. Validação manual pós-deploy (sem deploy automático)

- Chrome desktop (Mac/Win): webm → transcode → OGG → Meta aceita.
- Firefox: idem.
- Safari (sem webm): cai no fallback mp4/aac da cascata; **não** entra no bloco de transcode (já é MIME aceito Meta).
- PC antigo SOS: confirmar custo do transcode aceitável.
- Conferir logs `[audioTranscode] start` / `done` no console com sizes e ms.

## 8. Restrições respeitadas

- Sem deploy automático.
- Storage-first intacto.
- Cascata `pickRecorderMime` mantida como fallback Safari.
- Versão `@ffmpeg/core` pinada (`0.12.10`).
- Fallback CDN unpkg → jsdelivr.
- Re-validação de 16MB pós-transcode.
- Logs estruturados antes/depois com size e duração.
