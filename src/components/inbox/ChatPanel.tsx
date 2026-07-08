import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact, Message } from '@/types/crm';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Check, CheckCheck, Image, Mic, Paperclip, Play, FileText, Download, Pencil, Lock, StickyNote, Zap, Sparkles, Clock, FileCheck2, Smile } from 'lucide-react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { conversationStatusLabels } from '@/lib/labels';
import { format, isSameDay, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function formatDateSeparator(date: Date): string {
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  const diff = Math.abs(differenceInCalendarDays(new Date(), date));
  if (diff < 7) {
    const label = format(date, 'EEEE', { locale: ptBR });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}
import { toast } from 'sonner';
import AudioRecorder from '@/components/inbox/AudioRecorder';
import AudioPlayer from '@/components/inbox/AudioPlayer';
import ScheduleMessageDialog from '@/components/inbox/ScheduleMessageDialog';
import SendTemplateDialog from '@/components/inbox/SendTemplateDialog';
import { sendText, sendMedia, downloadMedia, getConversationProvider, type ProviderInfo } from '@/lib/whatsappRouter';
import VariablePicker from '@/components/shared/VariablePicker';
import { useSystemVariables } from '@/hooks/useSystemVariables';
import { CtwaBadge } from '@/components/shared/CtwaBadge';
interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  variables: string[];
}
const mediaCache = new Map<string, string>();
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = src;
    a.download = `imagem-${Date.now()}.jpg`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in-0 duration-200" onClick={onClose}>
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button onClick={handleDownload} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors" title="Baixar imagem">
          <Download className="h-5 w-5" />
        </button>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors text-2xl leading-none" title="Fechar">&times;</button>
      </div>
      <img src={src} alt="Imagem ampliada" className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl object-contain animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
function MediaBubble({ msg, tenantId, conversationId, providerInfo }: { msg: Message; tenantId: string; conversationId: string; providerInfo: ProviderInfo | null }) {
  const [mediaData, setMediaData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mediaType = ((msg as any).media_type || '').toLowerCase();
  const isAudio = mediaType.includes('audio') || mediaType.includes('ptt');
  const isImage = mediaType.includes('image');
  const isVideo = mediaType.includes('video');
  const isDocument = mediaType.includes('document') || mediaType.includes('pdf');
  const providerMsgId = (msg as any).provider_message_id;
  const metaMediaId = (msg as any).provider_metadata?.meta_media_id ?? null;
  const isOutbound = msg.direction === 'outbound';
  const unavailableMessage = isAudio
    ? 'Áudio expirado ou indisponível no WhatsApp'
    : isImage
      ? 'Imagem expirada ou indisponível no WhatsApp'
      : isVideo
        ? 'Vídeo expirado ou indisponível no WhatsApp'
        : 'Documento expirado ou indisponível no WhatsApp';
  const downloadDocument = (src: string) => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `documento-${Date.now()}`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  const loadMedia = async () => {
    if (loading) return;
    const storagePath = (msg as any).storage_path as string | null;
    const cacheKey = storagePath ? `storage:${storagePath}` : providerMsgId || (msg as any).id;
    setLoading(true);
    try {
      if (storagePath) {
        const { data: signed } = await supabase.storage
          .from('whatsapp-media')
          .createSignedUrl(storagePath, 60 * 60 * 6);
        if (signed?.signedUrl) {
          mediaCache.set(cacheKey, signed.signedUrl);
          setMediaData(signed.signedUrl);
          if (isDocument) downloadDocument(signed.signedUrl);
          return;
        }
      }
      const cached = mediaCache.get(cacheKey);
      if (cached) {
        setMediaData(cached);
        if (isDocument && cached !== 'expired') downloadDocument(cached);
        return;
      }
      if (!providerMsgId) {
        mediaCache.set(cacheKey, 'expired');
        setMediaData('expired');
        return;
      }
      const res = await downloadMedia({
        conversationId,
        tenantId,
        providerMessageId: providerMsgId,
        metaMediaId,
        providerInfo: providerInfo ?? undefined,
      });
      if (!res.ok) {
        mediaCache.set(cacheKey, 'expired');
        setMediaData('expired');
        return;
      }
      let result: string | null = null;
      if (res.base64) {
        const mime = res.mimetype || (isAudio ? 'audio/ogg' : isImage ? 'image/jpeg' : 'application/octet-stream');
        result = `data:${mime};base64,${res.base64}`;
        if (isAudio && (msg as any).id && !storagePath) {
          try {
            const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'ogg';
            const path = `${tenantId}/${(msg as any).id}.${ext}`;
            const bin = atob(res.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const { error: upErr } = await supabase.storage
              .from('whatsapp-media')
              .upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: true });
            if (!upErr) {
              await supabase.from('messages').update({ storage_path: path }).eq('id', (msg as any).id);
            }
          } catch (e) {
            console.warn('Opportunistic audio persist failed:', (e as Error).message);
          }
        }
      } else if (res.url) {
        result = res.url;
      }
      if (result) {
        mediaCache.set(cacheKey, result);
        setMediaData(result);
        if (isDocument) downloadDocument(result);
        return;
      }
      mediaCache.set(cacheKey, 'expired');
      setMediaData('expired');
    } catch (e: any) {
      console.warn('Media load failed (non-critical):', e?.message || e);
      mediaCache.set(cacheKey, 'expired');
      setMediaData('expired');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (isImage || isAudio) loadMedia(); }, [providerMsgId, (msg as any).storage_path]);
  if (isAudio) {
    return (
      <div className="min-w-[220px]">
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className={cn("text-xs", isOutbound ? "text-white/70" : "text-muted-foreground")}>Carregando áudio...</span>
          </div>
        ) : mediaData === 'expired' ? (
          <div className={cn("flex items-center gap-2 text-xs py-1 opacity-60", isOutbound ? "text-white/70" : "text-muted-foreground")}>
            <Mic className="h-3.5 w-3.5" /> {unavailableMessage}
          </div>
        ) : mediaData ? (
          <>
            <AudioPlayer src={mediaData} isOutbound={isOutbound} />
            {(msg as any).provider_metadata?.audio_transcription && (
              <p className={cn("text-xs italic mt-1 opacity-70", isOutbound ? "text-white/70" : "text-muted-foreground")}>
                📝 {(msg as any).provider_metadata.audio_transcription}
              </p>
            )}
          </>
        ) : (
          <button onClick={loadMedia} className={cn("flex items-center gap-2 text-xs py-1 opacity-70 hover:opacity-100 transition-opacity", isOutbound ? "text-white" : "text-foreground")}>
            <Mic className="h-3.5 w-3.5" /> Carregar áudio
          </button>
        )}
      </div>
    );
  }
  if (isImage) {
    return (
      <div className="max-w-[280px]">
        {loading ? (
          <div className="h-40 w-full flex items-center justify-center bg-muted/20 rounded-lg"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : mediaData === 'expired' ? (
          <div className="h-20 w-full flex items-center justify-center bg-muted/20 rounded-lg px-3 text-center text-xs text-muted-foreground">{unavailableMessage}</div>
        ) : mediaData ? (
          <>
            <img src={mediaData} alt="Imagem" className="rounded-lg max-h-60 w-auto cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setLightboxOpen(true)} />
            {lightboxOpen && <ImageLightbox src={mediaData} onClose={() => setLightboxOpen(false)} />}
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs"><Image className="h-3 w-3 mr-1" /> Carregar imagem</Button>
        )}
      </div>
    );
  }
  if (isVideo) {
    return (
      <div className="max-w-[280px]">
        {loading ? (
          <div className="h-40 w-full flex items-center justify-center bg-muted/20 rounded-lg"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : mediaData === 'expired' ? (
          <div className="h-20 w-full flex items-center justify-center bg-muted/20 rounded-lg px-3 text-center text-xs text-muted-foreground">{unavailableMessage}</div>
        ) : mediaData ? (
          <video src={mediaData} controls className="rounded-lg max-h-60 w-auto" />
        ) : (
          <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs"><Play className="h-3 w-3 mr-1" /> Carregar vídeo</Button>
        )}
      </div>
    );
  }
  if (isDocument) {
    return (
      <div className="max-w-[280px] rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="text-xs">Documento</span>
        </div>
        <div className="mt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Carregando documento...</span>
            </div>
          ) : mediaData === 'expired' ? (
            <div className="text-xs text-muted-foreground">{unavailableMessage}</div>
          ) : mediaData ? (
            <Button size="sm" variant="ghost" onClick={() => downloadDocument(mediaData)} className="text-xs"><Download className="h-3 w-3 mr-1" /> Baixar documento novamente</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs"><Download className="h-3 w-3 mr-1" /> Baixar documento</Button>
          )}
        </div>
      </div>
    );
  }
  return null;
}
const hasMedia = (msg: Message) => {
  const mt = ((msg as any).media_type || '').toLowerCase();
  return mt.includes('audio') || mt.includes('image') || mt.includes('video') || mt.includes('document') || mt.includes('ptt');
};

// Imagem do cabeçalho de um template Meta (persistida em messages.storage_path
// pelo wa-meta-send). Assina a URL do bucket sob demanda e cacheia.
function TemplateHeaderImage({ storagePath }: { storagePath: string }) {
  const cacheKey = `storage:${storagePath}`;
  const [url, setUrl] = useState<string | null>(mediaCache.get(cacheKey) ?? null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (url) return;
    let cancelled = false;
    supabase.storage.from('whatsapp-media').createSignedUrl(storagePath, 60 * 60 * 6)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) {
          mediaCache.set(cacheKey, data.signedUrl);
          setUrl(data.signedUrl);
        }
      });
    return () => { cancelled = true; };
  }, [storagePath]);
  if (!url || url === 'expired') return null;
  return (
    <>
      <img src={url} alt="Cabeçalho do template" onClick={() => setLightboxOpen(true)}
        className="rounded-lg max-h-48 w-auto mb-1.5 cursor-pointer hover:opacity-90 transition-opacity" />
      {lightboxOpen && <ImageLightbox src={url} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}
interface ChatPanelProps {
  conversationId: string;
  contact?: Contact;
  channel?: string;
  status?: string;
  showHeader?: boolean;
  className?: string;
}
export default function ChatPanel({ conversationId, contact, channel, status, showHeader = true, className }: ChatPanelProps) {
  const { tenant, membership } = useAuth();
  const composerVars = useSystemVariables({ tenantId: tenant?.id ?? null, scope: 'inbox-composer' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [qrFilter, setQrFilter] = useState('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  // Fallback: quando o pai não passa contact/channel (deep-link, race de carregamento,
  // payload de realtime sem join), resolvemos a partir do próprio conversationId.
  const [resolvedContact, setResolvedContact] = useState<Contact | null>(null);
  const [resolvedChannel, setResolvedChannel] = useState<string | null>(null);
  const effectiveContact = (contact ?? resolvedContact) as Contact | null;
  const effectiveChannel = channel ?? resolvedChannel ?? undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentConvIdRef = useRef<string>(conversationId);
  useEffect(() => { currentConvIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setResolvedContact(null);
    setResolvedChannel(null);
    supabase.from('conversations')
      .select('channel, contact:contacts(id, tenant_id, name, phone, email, avatar_url)')
      .eq('id', conversationId).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setResolvedChannel((data as any).channel ?? null);
        setResolvedContact(((data as any).contact ?? null) as Contact | null);
      });
    return () => { cancelled = true; };
  }, [conversationId]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) { setNewMsg(prev => prev + emoji); return; }
    const start = ta.selectionStart ?? newMsg.length;
    const end = ta.selectionEnd ?? newMsg.length;
    const next = newMsg.slice(0, start) + emoji + newMsg.slice(end);
    setNewMsg(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };
  const statusColors: Record<string, string> = {
    open: 'bg-success/10 text-success border-success/20',
    waiting_customer: 'bg-warning/10 text-warning border-warning/20',
    waiting_agent: 'bg-info/10 text-info border-info/20',
    closed: 'bg-muted text-muted-foreground',
  };
  useEffect(() => {
    if (!tenant) return;
    supabase.from('quick_replies').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('position')
      .then(({ data }) => setQuickReplies((data as unknown as QuickReply[]) ?? []));
  }, [tenant]);
  const replaceVariables = (text: string): string => {
    return text
      .replace(/\{\{nome\}\}/gi, effectiveContact?.name || '')
      .replace(/\{\{telefone\}\}/gi, effectiveContact?.phone || '')
      .replace(/\{\{email\}\}/gi, effectiveContact?.email || '');
  };
  const handleSelectQuickReply = (qr: QuickReply) => {
    const replaced = replaceVariables(qr.content);
    setNewMsg(replaced);
    setShowQuickReplies(false);
    setQrFilter('');
  };
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) setShowQuickReplies(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => {
    if (!conversationId) return;
    setProviderLoading(true);
    setProviderInfo(null);
    getConversationProvider(conversationId)
      .then(setProviderInfo)
      .catch((e) => { console.warn('[ChatPanel] getConversationProvider falhou', e); setProviderInfo(null); })
      .finally(() => setProviderLoading(false));
    supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at')
      .then(({ data }) => {
        setMessages((data as unknown as Message[]) ?? []);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
      });
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId);
    const ch = supabase.channel(`chat-panel-msgs-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        if (currentConvIdRef.current !== conversationId) return;
        const newMsg = payload.new as any;
        // Defense in depth: explicitly verify conversation_id on payload.
        // The Realtime filter SHOULD prevent cross-conversation leakage, but in practice
        // it sometimes doesn't (race during channel re-subscribe, payload from a previous
        // open channel arriving late, etc). This guard ensures we never inject a message
        // from another conversation into the active chat.
        if (newMsg.conversation_id !== conversationId) return;
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          const isOptimistic = prev.find(m =>
            m.direction === 'outbound' && m.content === newMsg.content &&
            Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime()) < 15000
          );
          if (isOptimistic) return prev.map(m => m.id === isOptimistic.id ? (newMsg as unknown as Message) : m);
          return [...prev, newMsg as unknown as Message];
        });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        if (currentConvIdRef.current !== conversationId) return;
        const updated = payload.new as any;
        // Defense in depth: same as INSERT — verify conversation_id explicitly.
        if (updated.conversation_id !== conversationId) return;
        setMessages(prev => prev.map(m => m.id === updated.id ? updated as unknown as Message : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);
  const handleSend = async () => {
    if (!newMsg.trim() || !tenant || !membership || !conversationId) return;
    const isWhatsApp = effectiveChannel === 'whatsapp';
    const contactPhone = effectiveContact?.phone;
    const msgContent = newMsg;
    const sendAsInternal = isInternal;
    const capturedConvId = conversationId;
    setNewMsg('');
    const optimisticId = crypto.randomUUID();
    const optimisticMsg: any = {
      id: optimisticId, tenant_id: tenant.id, conversation_id: capturedConvId,
      direction: 'outbound', content: msgContent, sender_membership_id: membership.id,
      created_at: new Date().toISOString(), is_ai_generated: false, media_type: null, media_url: null,
      is_internal: sendAsInternal,
    };
    if (currentConvIdRef.current === capturedConvId) {
      setMessages(prev => [...prev, optimisticMsg as Message]);
    }
    setSending(true);
    try {
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: capturedConvId, direction: 'outbound',
        content: msgContent, sender_membership_id: membership.id, is_internal: sendAsInternal,
      } as any).select('id').single();
      if (savedMsg?.id && currentConvIdRef.current === capturedConvId) {
        setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: savedMsg.id } : m));
      }
      if (!sendAsInternal) {
        supabase.from('conversations').update({
          last_message_at: new Date().toISOString(), last_agent_message_at: new Date().toISOString(), status: 'waiting_customer',
        }).eq('id', capturedConvId);
        if (isWhatsApp && contactPhone) {
          const res = await sendText({
            conversationId: capturedConvId,
            tenantId: tenant.id,
            phone: contactPhone,
            text: msgContent,
            providerInfo: providerInfo ?? undefined,
          });
          if (!res.ok) {
            // Mark as failed instead of deleting — message may have actually been delivered to WhatsApp
            // despite the upstream error. UI renders it with failed indicator (red bubble + "!" badge).
            if (savedMsg?.id) {
              await supabase.from('messages').update({
                provider_metadata: { status: 'failed', error_message: (typeof res.error === 'string' ? res.error : 'Falha no envio'), failed_at: new Date().toISOString() } as any,
              }).eq('id', savedMsg.id);
              if (currentConvIdRef.current === capturedConvId) {
                setMessages(prev => prev.map(m => (m.id === optimisticId || m.id === savedMsg.id)
                  ? { ...m, id: savedMsg.id, provider_metadata: { status: 'failed', error_message: (typeof res.error === 'string' ? res.error : 'Falha no envio') } } as any
                  : m));
              }
            }
            if (res.code === 'outside_24h_window') {
              toast.error(res.error ?? 'Cliente fora da janela de 24h.', {
                duration: 8000,
                action: { label: 'Enviar template', onClick: () => setShowTemplate(true) },
              });
            } else {
              toast.error(res.error ?? 'Falha ao enviar via WhatsApp');
            }
          } else if (savedMsg?.id && res.provider_message_id) {
            await supabase.from('messages').update({ provider_message_id: res.provider_message_id }).eq('id', savedMsg.id);
          }
        }
      }
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };
  const handleAiSuggest = async () => {
    if (!tenant || !conversationId || aiSuggesting) return;
    setAiSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-copilot', {
        body: { conversation_id: conversationId, tenant_id: tenant.id },
      });
      if (error) { toast.error('Erro ao gerar sugestão: ' + error.message); return; }
      if (data?.error) { toast.error(data.error); return; }
      if (data?.suggestion) { setNewMsg(data.suggestion); toast.success('Sugestão de IA inserida'); }
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setAiSuggesting(false);
    }
  };
  const handleSendMedia = async (file: File) => {
    if (!tenant || !membership || !conversationId) return;
    const capturedConvId = conversationId;
    const contactPhone = effectiveContact?.phone;
    const isWhatsApp = effectiveChannel === 'whatsapp';
    if (!isWhatsApp || !contactPhone) { toast.error('Envio de mídia só disponível para WhatsApp'); return; }
    let mediaType: 'audio' | 'image' | 'video' | 'document' = 'image';
    if (file.type.startsWith('audio/')) mediaType = 'audio';
    else if (file.type.startsWith('video/')) mediaType = 'video';
    else if (!file.type.startsWith('image/')) mediaType = 'document';
    const MAX = mediaType === 'audio' ? 16 * 1024 * 1024
              : mediaType === 'image' ? 5 * 1024 * 1024
              : mediaType === 'video' ? 16 * 1024 * 1024
              : 100 * 1024 * 1024;
    if (file.size > MAX) {
      const mb = Math.round(MAX / 1024 / 1024);
      toast.error(`Arquivo excede o limite de ${mb}MB para ${mediaType === 'audio' ? 'áudios' : mediaType === 'image' ? 'imagens' : mediaType === 'video' ? 'vídeos' : 'documentos'}.`);
      return;
    }


    setSending(true);
    try {
      const mediaTypeLabel = mediaType === 'audio' ? 'AudioMessage'
                           : mediaType === 'image' ? 'ImageMessage'
                           : mediaType === 'video' ? 'VideoMessage' : 'DocumentMessage';
      const contentLabel = `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Vídeo' : 'Documento'}]`;
      const { data: savedMsg, error: insertErr } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: capturedConvId, direction: 'outbound',
        content: contentLabel,
        sender_membership_id: membership.id,
        media_type: mediaTypeLabel,
      } as any).select('id').single();
      if (insertErr || !savedMsg?.id) { toast.error('Falha ao registrar mensagem.'); return; }
      const ext = file.name.split('.').pop()?.toLowerCase()
        || (file.type.split('/')[1]?.split(';')[0] ?? 'bin');
      const storagePath = `${tenant.id}/${savedMsg.id}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('whatsapp-media')
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: true });
      if (uploadError) {
        console.error('[ChatPanel] upload bucket falhou', uploadError.message);
        await supabase.from('messages').delete().eq('id', savedMsg.id);
        toast.error('Falha ao enviar arquivo para o storage.');
        return;
      }
      await supabase.from('messages').update({ storage_path: storagePath }).eq('id', savedMsg.id);
      const { data: signed, error: signErr } = await supabase.storage
        .from('whatsapp-media')
        .createSignedUrl(storagePath, 60 * 60);
      if (signErr || !signed?.signedUrl) {
        await supabase.from('messages').delete().eq('id', savedMsg.id);
        toast.error('Falha ao gerar URL temporária do arquivo.');
        return;
      }
      if (currentConvIdRef.current === capturedConvId) {
        const optimisticMsg: Message = {
          id: savedMsg.id, tenant_id: tenant.id, conversation_id: capturedConvId,
          direction: 'outbound', content: contentLabel,
          sender_membership_id: membership.id, created_at: new Date().toISOString(), is_ai_generated: false,
          media_type: mediaTypeLabel, media_url: null,
          storage_path: storagePath,
        } as any;
        setMessages(prev => [...prev, optimisticMsg]);
      }
      const res = await sendMedia({
        conversationId: capturedConvId,
        tenantId: tenant.id,
        phone: contactPhone,
        mediaUrl: signed.signedUrl,
        mimeType: file.type,
        mediaType,
        filename: file.name,
        caption: '',
        providerInfo: providerInfo ?? undefined,
      });
      if (!res.ok) {
        // Mark as failed instead of deleting — media may have actually been delivered despite error.
        await supabase.from('messages').update({
          provider_metadata: { status: 'failed', error_message: (typeof res.error === 'string' ? res.error : 'Falha no envio'), failed_at: new Date().toISOString() } as any,
        }).eq('id', savedMsg.id);
        if (currentConvIdRef.current === capturedConvId) {
          setMessages(prev => prev.map(m => m.id === savedMsg.id
            ? { ...m, provider_metadata: { status: 'failed', error_message: (typeof res.error === 'string' ? res.error : 'Falha no envio') } } as any
            : m));
        }
        if (res.code?.endsWith('_mime_unsupported')) {
          toast.error(res.error ?? 'Formato de mídia não aceito pelo WhatsApp.');
        } else if (res.code === 'media_fetch_failed') {
          toast.error('Falha ao baixar arquivo do storage. Tente novamente.');
        } else if (res.code === 'outside_24h_window') {
          toast.error(res.error ?? 'Cliente fora da janela de 24h.', {
            duration: 8000,
            action: { label: 'Enviar template', onClick: () => setShowTemplate(true) },
          });
        } else {
          toast.error(res.error ?? 'Falha ao enviar mídia');
        }
      } else {
        const update: { provider_message_id?: string; provider_metadata?: any } = {};
        if (res.provider_message_id) update.provider_message_id = res.provider_message_id;
        if (res.meta_media_id) update.provider_metadata = { provider: 'meta_cloud', meta_media_id: res.meta_media_id };
        if (Object.keys(update).length) {
          await supabase.from('messages').update(update).eq('id', savedMsg.id);
        }
      }
      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(), last_agent_message_at: new Date().toISOString(), status: 'waiting_customer',
      }).eq('id', capturedConvId);
    } catch (err: any) {
      toast.error('Erro ao enviar mídia: ' + err.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {showHeader && effectiveContact && (
        <div className="border-b border-border/50 px-4 py-3 flex items-center gap-3 bg-card/50">
          <Avatar className="h-9 w-9">
            {(effectiveContact as any)?.avatar_url && <AvatarImage src={(effectiveContact as any).avatar_url} alt={effectiveContact.name} />}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">{effectiveContact.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold text-foreground text-sm truncate">{effectiveContact.name}</h3>
              <CtwaBadge contact={effectiveContact as any} />
            </div>
            <span className="text-xs text-muted-foreground">
              {effectiveContact.phone} · {effectiveChannel}
              {providerInfo?.provider === 'meta_cloud' && <> · <span className="text-primary">WhatsApp Oficial</span></>}
              {providerInfo?.provider === 'uazapi' && providerInfo.instance_id && <> · UAZAPI</>}
            </span>
          </div>
          {status && <Badge variant="outline" className={`rounded-full text-[10px] ${statusColors[status] ?? ''}`}>{conversationStatusLabels[status] ?? status}</Badge>}
        </div>
      )}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 bg-background">
        {messages.map((msg, idx) => {
          const msgDate = new Date(msg.created_at);
          const prevDate = idx > 0 ? new Date(messages[idx - 1].created_at) : null;
          const showDateSeparator = !prevDate || !isSameDay(msgDate, prevDate);
          const pmeta = (msg as any).provider_metadata ?? {};
          const msgStatus = pmeta.status ?? pmeta.last_status;
          const isFailed = msgStatus === 'failed';
          const failedErr = isFailed && Array.isArray(pmeta.statuses)
            ? pmeta.statuses.slice().reverse().find((s: any) => s?.status === 'failed')?.raw?.errors?.[0]
            : null;
          const failedCode = failedErr?.code;
          const isOutsideWindow = failedCode === 131047;
          const providerLabel = providerInfo?.provider === 'meta_cloud' ? 'WhatsApp Oficial' : 'WhatsApp';
          const failedMsg = isOutsideWindow
            ? 'Cliente fora da janela de 24h. Envie um template para reativar a conversa.'
            : (failedErr?.error_data?.details || failedErr?.message || failedErr?.title || pmeta.error_message || `Falha no envio via ${providerLabel}.`);
          const isMedia = hasMedia(msg);
          const msgIsInternal = (msg as any).is_internal === true;
          const isTemplate = ((msg as any).media_type || '').toLowerCase() === 'templatemessage';
          return (
            <div key={msg.id} className="contents">
            {showDateSeparator && (
              <div className="flex justify-center my-2">
                <span className="bg-muted/70 text-muted-foreground text-[11px] px-3 py-1 rounded-full shadow-sm">
                  {formatDateSeparator(msgDate)}
                </span>
              </div>
            )}
            <div className={cn("flex flex-col", msg.direction === 'outbound' ? 'items-end' : 'items-start')}>
              <div className={cn("max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                msgIsInternal
                  ? 'bg-warning/10 border border-warning/30 text-foreground'
                  : msg.direction === 'outbound'
                    ? isFailed ? 'bg-destructive/10 border border-destructive/30 text-foreground' : 'gradient-primary text-white'
                    : 'bg-card border border-border/50 text-foreground')}>
                {msgIsInternal && (
                  <div className="flex items-center gap-1 text-[10px] text-warning font-medium mb-1">
                    <Lock className="h-3 w-3" /> Nota interna
                  </div>
                )}
                {isTemplate && (
                  <div className={cn("text-[10px] font-medium mb-1 uppercase tracking-wide",
                    msg.direction === 'outbound' && !isFailed ? 'text-white/80' : 'text-muted-foreground')}>
                    Template
                  </div>
                )}
                {isTemplate && ((msg as any).storage_path || pmeta.header_media_storage_path) && (
                  <TemplateHeaderImage storagePath={(msg as any).storage_path || pmeta.header_media_storage_path} />
                )}
                {isMedia && tenant && <MediaBubble msg={msg} tenantId={tenant.id} conversationId={conversationId} providerInfo={providerInfo} />}
                {(!isMedia || (msg.content && !msg.content.startsWith('['))) && <span className="whitespace-pre-wrap">{msg.content}</span>}
                <div className={cn("text-[10px] mt-1 flex items-center gap-1 justify-end",
                  msgIsInternal ? 'text-warning/70' :
                  isFailed ? 'text-destructive' :
                  msg.direction === 'outbound' ? 'text-white/70' : 'text-muted-foreground')}>
                  {format(new Date(msg.created_at), "HH:mm")}
                  {msg.direction === 'outbound' && !msgIsInternal && (
                    isFailed ? <span title={failedMsg} className="font-semibold">!</span> :
                    msgStatus === 'read' ? <CheckCheck className="h-3 w-3 text-blue-300" /> :
                    msgStatus === 'delivered' ? <CheckCheck className="h-3 w-3" /> :
                    <Check className="h-3 w-3" />
                  )}
                </div>
              </div>
              {isFailed && msg.direction === 'outbound' && !msgIsInternal && (
                <div className="mt-1 max-w-[75%] flex items-center gap-2 text-[11px] text-destructive">
                  <span>{failedMsg}</span>
                  {isOutsideWindow && providerInfo?.provider === 'meta_cloud' && (
                    <button onClick={() => setShowTemplate(true)} className="underline hover:no-underline font-medium">
                      Enviar template
                    </button>
                  )}
                </div>
              )}
            </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t border-border/50 bg-card/50">
        {isInternal && (
          <div className="px-3 pt-2 flex items-center gap-1.5 text-xs text-warning font-medium">
            <Lock className="h-3 w-3" /> Modo nota interna — não será enviada ao cliente
          </div>
        )}
        {showQuickReplies && quickReplies.length > 0 && (
          <div ref={qrRef} className="mx-3 mt-2 rounded-xl border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
            {quickReplies
              .filter(qr => !qrFilter || qr.shortcut.includes(qrFilter) || qr.title.toLowerCase().includes(qrFilter.toLowerCase()))
              .map(qr => (
                <button key={qr.id} onClick={() => handleSelectQuickReply(qr)}
                  className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 text-sm">
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">/{qr.shortcut}</code>
                  <span className="font-medium text-foreground">{qr.title}</span>
                  <span className="text-xs text-muted-foreground truncate flex-1">{qr.content.substring(0, 50)}...</span>
                </button>
              ))}
            {quickReplies.filter(qr => !qrFilter || qr.shortcut.includes(qrFilter) || qr.title.toLowerCase().includes(qrFilter.toLowerCase())).length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum atalho encontrado</div>
            )}
          </div>
        )}
        <div className="p-3 flex gap-2 items-end">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
            onChange={e => { const file = e.target.files?.[0]; if (file) handleSendMedia(file); e.target.value = ''; }} />
          <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={sending || isInternal} className="rounded-xl h-10 w-10 shrink-0" title="Anexar arquivo">
            <Paperclip className="h-4 w-4" />
          </Button>
          {!isInternal && (
            <AudioRecorder
              onRecorded={handleSendMedia}
              disabled={sending}
              provider={providerLoading ? null : (providerInfo?.provider ?? null)}
            />
          )}
          <Button size="icon" variant={isInternal ? 'default' : 'ghost'} onClick={() => setIsInternal(!isInternal)}
            className={cn("rounded-xl h-10 w-10 shrink-0", isInternal && 'bg-warning text-warning-foreground hover:bg-warning/90')} title="Nota interna">
            <StickyNote className="h-4 w-4" />
          </Button>
          {quickReplies.length > 0 && (
            <Button size="icon" variant="ghost" onClick={() => setShowQuickReplies(!showQuickReplies)} className="rounded-xl h-10 w-10 shrink-0" title="Respostas rápidas">
              <Zap className="h-4 w-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={handleAiSuggest} disabled={aiSuggesting || sending}
            className="rounded-xl h-10 w-10 shrink-0 text-primary hover:bg-primary/10" title="Sugestão de IA">
            {aiSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setShowSchedule(true)} disabled={sending || isInternal}
            className="rounded-xl h-10 w-10 shrink-0" title="Agendar mensagem">
            <Clock className="h-4 w-4" />
          </Button>
          {providerInfo?.provider === 'meta_cloud' && providerInfo.instance_id && (
            <Button size="icon" variant="ghost" onClick={() => setShowTemplate(true)} disabled={sending || isInternal}
              className="rounded-xl h-10 w-10 shrink-0 text-primary hover:bg-primary/10" title="Enviar template Meta aprovado">
              <FileCheck2 className="h-4 w-4" />
            </Button>
          )}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" disabled={sending} className="rounded-xl h-10 w-10 shrink-0" title="Emojis">
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="p-0 border-0 bg-transparent shadow-none w-auto">
              <EmojiPicker
                onEmojiClick={(e) => { insertEmoji(e.emoji); setEmojiOpen(false); }}
                theme={Theme.AUTO}
                emojiStyle={EmojiStyle.NATIVE}
                lazyLoadEmojis
                searchPlaceHolder="Buscar emoji..."
                width={320}
                height={400}
              />
            </PopoverContent>
          </Popover>
          <div className="relative flex-1">
            <Textarea ref={textareaRef} value={newMsg} onChange={e => {
              const val = e.target.value;
              setNewMsg(val);
              if (val.startsWith('/') && val.length > 1) {
                setQrFilter(val.slice(1).toLowerCase());
                setShowQuickReplies(true);
              } else if (val === '/') {
                setQrFilter('');
                setShowQuickReplies(true);
              } else {
                setShowQuickReplies(false);
              }
            }} placeholder={isInternal ? "Escreva uma nota interna..." : "Mensagem..."}
              className={cn("min-h-[40px] max-h-[120px] resize-none rounded-xl text-sm pr-9", isInternal && "border-warning/50 bg-warning/5")}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
            <div className="absolute right-1 top-1">
              <VariablePicker
                size="xs"
                variables={composerVars}
                onPick={(token) => setNewMsg(prev => prev + token)}
              />
            </div>
          </div>
          <Button size="icon" onClick={handleSend} disabled={sending || !newMsg.trim()}
            className={cn("rounded-xl h-10 w-10", isInternal && 'bg-warning text-warning-foreground hover:bg-warning/90')}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : isInternal ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {tenant && membership && (
        <ScheduleMessageDialog
          open={showSchedule}
          onOpenChange={setShowSchedule}
          conversationId={conversationId}
          tenantId={tenant.id}
          membershipId={membership.id}
          provider={providerInfo?.provider ?? null}
          whatsappInstanceId={providerInfo?.instance_id ?? null}
        />
      )}
      {tenant && providerInfo?.provider === 'meta_cloud' && providerInfo.instance_id && (
        <SendTemplateDialog
          open={showTemplate}
          onOpenChange={setShowTemplate}
          tenantId={tenant.id}
          whatsappInstanceId={providerInfo.instance_id}
          conversationId={conversationId}
          contactName={effectiveContact?.name ?? null}
        />
      )}
    </div>
  );
}
// sync-touch: handleSendMedia storage-first (mediaUrl), currentConvIdRef guard, dedup window 15s, onUnsupported toast
