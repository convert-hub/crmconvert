import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  META_ACCEPTED_AUDIO_MIMES,
  FALLBACK_AUDIO_MIMES,
  pickSupportedMime,
  pickRecorderMime,
  extFromMime,
} from '@/lib/mimeCodec';

function mockIsTypeSupported(accepted: string[]) {
  (globalThis as any).MediaRecorder = {
    isTypeSupported: (m: string) => accepted.includes(m),
  };
}

describe('mimeCodec', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).MediaRecorder;
  });

  it('extFromMime maps known MIMEs', () => {
    expect(extFromMime('audio/mp4')).toBe('m4a');
    expect(extFromMime('audio/aac')).toBe('m4a');
    expect(extFromMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extFromMime('audio/webm')).toBe('webm');
    expect(extFromMime('audio/mpeg')).toBe('mp3');
    expect(extFromMime('image/jpeg')).toBe('jpg');
  });

  it('pickSupportedMime returns null without MediaRecorder', () => {
    expect(pickSupportedMime(['audio/mp4'])).toBeNull();
  });

  it('modern browser: prefers Meta-friendly mp4/aac for meta_cloud', () => {
    mockIsTypeSupported(['audio/mp4', 'audio/webm', 'audio/webm;codecs=opus']);
    const r = pickRecorderMime('meta_cloud');
    expect(META_ACCEPTED_AUDIO_MIMES).toContain(r.mime!);
    expect(r.fallbackUsed).toBe(false);
  });

  it('modern browser: prefers ogg/opus when mp4 unavailable', () => {
    mockIsTypeSupported(['audio/ogg;codecs=opus', 'audio/webm;codecs=opus']);
    const r = pickRecorderMime('meta_cloud');
    expect(r.mime).toBe('audio/ogg;codecs=opus');
    expect(r.fallbackUsed).toBe(false);
  });

  it('webm-only browser triggers fallback flag for meta_cloud', () => {
    mockIsTypeSupported(['audio/webm;codecs=opus', 'audio/webm']);
    const r = pickRecorderMime('meta_cloud');
    expect(FALLBACK_AUDIO_MIMES).toContain(r.mime!);
    expect(r.fallbackUsed).toBe(true);
  });

  it('webm-only browser is fine for uazapi (no fallback flag)', () => {
    mockIsTypeSupported(['audio/webm;codecs=opus']);
    const r = pickRecorderMime('uazapi');
    expect(r.mime).toBe('audio/webm;codecs=opus');
    expect(r.fallbackUsed).toBe(false);
  });

  it('no codec supported -> mime null', () => {
    mockIsTypeSupported([]);
    const r = pickRecorderMime('meta_cloud');
    expect(r.mime).toBeNull();
    expect(r.fallbackUsed).toBe(false);
  });
});
