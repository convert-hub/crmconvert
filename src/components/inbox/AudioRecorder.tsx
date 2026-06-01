import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { pickRecorderMime, extFromMime } from '@/lib/mimeCodec';

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  disabled?: boolean;
  /**
   * 'meta_cloud' tenta selecionar um MIME aceito pela WhatsApp Cloud API
   * (mp4/aac/ogg). Se apenas webm estiver disponível, dispara onUnsupported
   * e NÃO grava (Meta rejeita webm).
   */
  provider?: 'meta_cloud' | 'uazapi' | null;
  /** Callback quando o navegador não suporta nenhum codec aceito pelo provider. */
  onUnsupported?: (info: { provider: string; reason: string }) => void;
}

export default function AudioRecorder({ onRecorded, disabled, provider, onUnsupported }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async () => {
    const picked = pickRecorderMime(provider ?? null);
    if (!picked.mime) {
      onUnsupported?.({ provider: provider ?? 'unknown', reason: 'no-codec' });
      return;
    }
    if (picked.fallbackUsed && provider === 'meta_cloud') {
      onUnsupported?.({ provider: 'meta_cloud', reason: 'webm-only-browser' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: picked.mime });
      mimeRef.current = picked.mime;
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (e) {
      console.warn('[AudioRecorder] start failed', e);
      cleanup();
    }
  }, [provider, onUnsupported, cleanup]);

  const stopAndSend = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.onstop = () => {
      const mime = mimeRef.current;
      const ext = extFromMime(mime);
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] });
      const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: mime.split(';')[0] });
      onRecorded(file);
    };
    mr.stop();
    setRecording(false);
    setDuration(0);
    cleanup();
  }, [onRecorded, cleanup]);

  const cancelRecording = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
    setDuration(0);
    cleanup();
  }, [cleanup]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (recording) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
        <Button size="icon" variant="ghost" className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive" onClick={cancelRecording} title="Cancelar">
          <Trash2 className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-sm font-medium text-destructive tabular-nums min-w-[32px]">{fmt(duration)}</span>
        </div>
        <Button size="icon" className="rounded-full h-10 w-10 shrink-0" onClick={stopAndSend} title="Enviar áudio">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button size="icon" variant="ghost" className={cn("rounded-xl h-12 w-12 shrink-0 text-muted-foreground hover:text-foreground")} onClick={startRecording} disabled={disabled} title="Gravar áudio">
      <Mic className="h-5 w-5" />
    </Button>
  );
}
// sync-touch: pickRecorderMime from mimeCodec, no opus-recorder, onUnsupported callback

