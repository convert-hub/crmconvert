// MIME / codec helpers for browser MediaRecorder + WhatsApp providers.
// Meta Cloud aceita: audio/aac, audio/mp4, audio/mpeg, audio/amr, audio/ogg.
// UAZAPI tipicamente aceita audio/ogg ou webm.

export const META_ACCEPTED_AUDIO_MIMES = [
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

export const FALLBACK_AUDIO_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
];

export function pickSupportedMime(candidates: string[]): string | null {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return null;
}

// Mapeia MIME -> extensão de arquivo apropriada.
export function extFromMime(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/amr':
      return 'amr';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/3gpp':
      return '3gp';
    case 'application/pdf':
      return 'pdf';
    default:
      return base.includes('/') ? base.split('/')[1] : 'bin';
  }
}

// Escolhe o MIME que será usado para gravar, baseado no provider.
// Retorna { mime: string|null, fallbackUsed: boolean }.
// fallbackUsed=true significa que estamos gravando em webm e a Meta vai rejeitar
// (caller deve avisar via onUnsupported quando provider==='meta_cloud').
export function pickRecorderMime(provider: 'meta_cloud' | 'uazapi' | null | undefined): {
  mime: string | null;
  fallbackUsed: boolean;
} {
  const metaMime = pickSupportedMime(META_ACCEPTED_AUDIO_MIMES);
  if (metaMime) return { mime: metaMime, fallbackUsed: false };
  const fallback = pickSupportedMime(FALLBACK_AUDIO_MIMES);
  return { mime: fallback, fallbackUsed: !!fallback && provider === 'meta_cloud' };
}
