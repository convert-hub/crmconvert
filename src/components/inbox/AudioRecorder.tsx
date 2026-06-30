import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Trash2, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface AudioRecorderProps {
  onRecorded: (file: File) => void;
  disabled?: boolean;
  /**
   * 'meta_cloud' = WhatsApp Cloud API oficial. EXIGE ogg/opus.
   * 'uazapi'     = UAZAPI não-oficial. Aceita webm.
   * null         = provider ainda não resolvido. Botão fica desabilitado.
   */
  provider?: 'meta_cloud' | 'uazapi' | null;
}

type OpusReady = 'loading' | 'ready' | 'failed';

const ENCODER_PATH = `/encoderWorker.min.js?v=${(import.meta as any).env?.VITE_APP_BUILD ?? '20260630'}`;

async function instantiateOpusRecorder(): Promise<any> {
  const mod: any = await import('opus-recorder' as any);
  const Recorder = mod.default ?? mod;
  return new Recorder({
    encoderPath: ENCODER_PATH,
    encoderApplication: 2048,
    encoderSampleRate: 48000,
    numberOfChannels: 1,
    streamPages: false,
  });
}

export default function AudioRecorder({ onRecorded, disabled, provider }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [opusReady, setOpusReady] = useState<OpusReady>('loading');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const opusRecorderRef = useRef<any>(null);
  const opusBlobRef = useRef<Blob | null>(null);
  const usingOpusRef = useRef(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pré-instancia o opus-recorder ao montar. 1 retry se falhar.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const tryInit = async () => {
      attempt += 1;
      try {
        const rec = await instantiateOpusRecorder();
        if (cancelled) { try { rec.close?.(); } catch { /* noop */ } return; }
        opusRecorderRef.current = rec;
        setOpusReady('ready');
      } catch (e) {
        console.warn('[AudioRecorder] opus-recorder init falhou', { attempt, error: e });
        if (cancelled) return;
        if (attempt < 2) {
          setTimeout(tryInit, 800);
        } else {
          setOpusReady('failed');
        }
      }
    };
    tryInit();
    return () => {
      cancelled = true;
      try { opusRecorderRef.current?.close?.(); } catch { /* noop */ }
      opusRecorderRef.current = null;
    };
  }, []);

  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    opusBlobRef.current = null;
    usingOpusRef.current = false;
  }, []);

  useEffect(() => cleanupRecording, [cleanupRecording]);

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
    let rec = opusRecorderRef.current;
    if (!rec) {
      // Pré-instanciação falhou ou ainda não terminou — tenta criar agora.
      rec = await instantiateOpusRecorder();
      opusRecorderRef.current = rec;
    }
    rec.ondataavailable = (typedArray: Uint8Array) => {
      const ab = typedArray.buffer.slice(typedArray.byteOffset, typedArray.byteOffset + typedArray.byteLength) as ArrayBuffer;
      opusBlobRef.current = new Blob([ab], { type: 'audio/ogg' });
    };
    await rec.start();
    usingOpusRef.current = true;
  }, []);

  const blockMetaToast = () =>
    toast.error('Não foi possível gravar áudio compatível com o WhatsApp Oficial. Recarregue a página e tente novamente.');

  const startRecording = useCallback(async () => {
    // Provider ainda não resolvido → não arrisca.
    if (provider == null) {
      toast.error('Canal de envio ainda não identificado. Aguarde alguns segundos.');
      return;
    }

    const requiresOgg = provider === 'meta_cloud';

    try {
      if (requiresOgg) {
        if (opusReady !== 'ready') {
          blockMetaToast();
          return;
        }
        try {
          await startOpus();
        } catch (e) {
          console.error('[AudioRecorder] opus start falhou em meta_cloud', e);
          blockMetaToast();
          cleanupRecording();
          return;
        }
      } else {
        // uazapi: webm é aceito.
        await startNative();
      }
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (e) {
      console.error('[AudioRecorder] startRecording erro', e);
      cleanupRecording();
      if (requiresOgg) blockMetaToast();
      else toast.error('Falha ao iniciar gravação de áudio.');
    }
  }, [provider, opusReady, startOpus, startNative, cleanupRecording]);

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
      // Mantém o recorder instanciado para a próxima gravação; só limpa stream/timer.
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      opusBlobRef.current = null;
      usingOpusRef.current = false;
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
    cleanupRecording();
  }, [onRecorded, cleanupRecording]);

  const cancelRecording = useCallback(() => {
    if (usingOpusRef.current && opusRecorderRef.current) {
      try { opusRecorderRef.current.stop(); } catch { /* noop */ }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      opusBlobRef.current = null;
      usingOpusRef.current = false;
    } else {
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      cleanupRecording();
    }
    setRecording(false);
    setDuration(0);
  }, [cleanupRecording]);

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

  const providerPending = provider == null;
  const opusBlockingMeta = provider === 'meta_cloud' && opusReady === 'loading';
  const opusFailedForMeta = provider === 'meta_cloud' && opusReady === 'failed';
  const isDisabled = !!disabled || providerPending || opusBlockingMeta || opusFailedForMeta;

  const title = providerPending
    ? 'Identificando canal de envio…'
    : opusBlockingMeta
      ? 'Preparando gravador compatível com o WhatsApp Oficial…'
      : opusFailedForMeta
        ? 'Gravador de áudio indisponível — recarregue a página'
        : 'Gravar áudio';

  return (
    <Button
      size="icon"
      variant="ghost"
      className="rounded-xl h-12 w-12 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={startRecording}
      disabled={isDisabled}
      title={title}
    >
      {opusBlockingMeta || providerPending
        ? <Loader2 className="h-5 w-5 animate-spin" />
        : <Mic className="h-5 w-5" />}
    </Button>
  );
}
