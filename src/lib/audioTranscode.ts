// Browser-side re-mux webm/opus -> ogg/opus via ffmpeg.wasm.
// Meta Cloud aceita audio/ogg;codecs=opus puro. webm-opus e ogg-opus compartilham o
// mesmo codec; basta trocar o container (-c:a copy), sem re-encode. Operação é
// rápida (<500ms para áudios típicos) mas o core ffmpeg (~25MB) precisa ser baixado
// na primeira chamada — por isso lazy-load + singleton em memória.

export const FFMPEG_CORE_VERSION = '0.12.10';
const CDN_PRIMARY = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const CDN_FALLBACK = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

type FFmpegInstance = any; // tipo opaco para evitar import síncrono do pacote pesado

let ffmpegInstance: FFmpegInstance | null = null;
let loadPromise: Promise<FFmpegInstance> | null = null;

async function loadFromCdn(base: string): Promise<FFmpegInstance> {
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);
  const ffmpeg = new FFmpeg();
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  ]);
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const inst = await loadFromCdn(CDN_PRIMARY);
      console.info('[audioTranscode] ffmpeg loaded', { cdn: 'unpkg' });
      ffmpegInstance = inst;
      return inst;
    } catch (e1) {
      console.warn('[audioTranscode] unpkg load failed, trying jsdelivr', e1);
      try {
        const inst = await loadFromCdn(CDN_FALLBACK);
        console.info('[audioTranscode] ffmpeg loaded', { cdn: 'jsdelivr' });
        ffmpegInstance = inst;
        return inst;
      } catch (e2) {
        loadPromise = null;
        throw new Error('Falha ao carregar ffmpeg.wasm', { cause: e2 });
      }
    }
  })();
  return loadPromise;
}

export async function transcodeToOggOpus(file: File): Promise<File> {
  const t0 = performance.now();
  const sizeIn = file.size;
  console.info('[audioTranscode] start', { inputType: file.type, inputSize: sizeIn });

  let ffmpeg: FFmpegInstance;
  try {
    ffmpeg = await getFFmpeg();
  } catch (e) {
    console.error('[audioTranscode] failed (load)', e);
    throw e;
  }

  const { fetchFile } = await import('@ffmpeg/util');
  const inName = 'in.webm';
  const outName = 'out.ogg';

  try {
    await ffmpeg.writeFile(inName, await fetchFile(file));
    const code = await ffmpeg.exec(['-i', inName, '-c:a', 'copy', '-f', 'ogg', outName]);
    if (code !== 0) {
      throw new Error(`ffmpeg exec returned ${code}`);
    }
    const data = await ffmpeg.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const out = new File([bytes], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' });
    console.info('[audioTranscode] done', {
      inputType: file.type,
      inputSize: sizeIn,
      outputType: out.type,
      outputSize: out.size,
      durationMs: Math.round(performance.now() - t0),
    });
    return out;
  } catch (e) {
    console.error('[audioTranscode] failed (exec)', {
      inputType: file.type,
      inputSize: sizeIn,
      durationMs: Math.round(performance.now() - t0),
      error: e,
    });
    throw new Error('Falha ao converter áudio para OGG', { cause: e as Error });
  } finally {
    try { await ffmpeg.deleteFile(inName); } catch { /* noop */ }
    try { await ffmpeg.deleteFile(outName); } catch { /* noop */ }
  }
}
