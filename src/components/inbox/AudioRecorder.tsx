import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  disabled?: boolean;
  /**
   * Quando 'meta_cloud', tenta gravar em audio/ogg (Opus) via opus-recorder,
   * que é o formato exigido pela WhatsApp Cloud API.
   * Para 'uazapi' (ou indefinido) usa MediaRecorder nativo (audio/webm).
   */
  provider?: 'meta_cloud' | 'uazapi' | null;
}

export default function AudioRecorder({ onRecorded, disabled, provider }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  // Native MediaRecorder path (uazapi)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // opus-recorder path (meta_cloud)
  const opusRecorderRef = useRef<any>(null);
  const opusBlobRef = useRef<Blob | null>(null);
  const usingOpusRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    try { opusRecorderRef.current?.close?.(); } catch { /* noop */ }
    opusRecorderRef.current = null;
    opusBlobRef.current = null;
    usingOpusRef.current = false;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startNative = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRecorder.start();
    usingOpusRef.current = false;
  }, []);

  const startOpus = useCallback(async () => {
    // dynamic import keeps bundle lean and lets us fall back on failure
    const mod: any = await import('opus-recorder');
    const Recorder = mod.default ?? mod;
    const rec = new Recorder({
      encoderPath: '/encoderWorker.min.js',
      encoderApplication: 2048, // VOIP
      encoderSampleRate: 48000,
      numberOfChannels: 1,
      streamPages: false,
    });
    rec.ondataavailable = (typedArray: Uint8Array) => {
      opusBlobRef.current = new Blob([typedArray], { type: 'audio/ogg' });
    };
    await rec.start();
    opusRecorderRef.current = rec;
    usingOpusRef.current = true;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (provider === 'meta_cloud') {
        try {
          await startOpus();
        } catch (e) {
          console.warn('[AudioRecorder] opus-recorder falhou, usando webm fallback', e);
          await startNative();
        }
      } else {
        await startNative();
      }
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch {
      cleanup();
    }
  }, [provider, startOpus, startNative, cleanup]);

  const stopAndSend = useCallback(async () => {
    if (usingOpusRef.current && opusRecorderRef.current) {
      const rec = opusRecorderRef.current;
      try {
        await rec.stop();
        const blob = opusBlobRef.current;
        if (blob && blob.size > 0) {
          const file = new File([blob], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' });
          onRecorded(file);
        }
      } catch (e) {
        console.warn('[AudioRecorder] stop opus failed', e);
      }
      setRecording(false);
      setDuration(0);
      cleanup();
      return;
    }
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
      onRecorded(file);
    };
    mediaRecorderRef.current.stop();
    setRecording(false);
    setDuration(0);
    cleanup();
  }, [onRecorded, cleanup]);

  const cancelRecording = useCallback(() => {
    if (usingOpusRef.current && opusRecorderRef.current) {
      try { opusRecorderRef.current.stop(); } catch { /* noop */ }
    } else {
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    }
    setRecording(false);
    setDuration(0);
    cleanup();
  }, [cleanup]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (recording) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
        <Button
          size="icon"
          variant="ghost"
          className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={cancelRecording}
          title="Cancelar"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-sm font-medium text-destructive tabular-nums min-w-[32px]">
            {fmt(duration)}
          </span>
        </div>

        <Button
          size="icon"
          className="rounded-full h-10 w-10 shrink-0"
          onClick={stopAndSend}
          title="Enviar áudio"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      className="rounded-xl h-12 w-12 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={startRecording}
      disabled={disabled}
      title="Gravar áudio"
    >
      <Mic className="h-5 w-5" />
    </Button>
  );
}
