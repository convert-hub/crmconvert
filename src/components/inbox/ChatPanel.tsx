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
import { format } from 'date-fns';
import { toast } from 'sonner';
import AudioRecorder from '@/components/inbox/AudioRecorder';
import AudioPlayer from '@/components/inbox/AudioPlayer';
import ScheduleMessageDialog from '@/components/inbox/ScheduleMessageDialog';
import SendTemplateDialog from '@/components/inbox/SendTemplateDialog';
import { sendText, sendMedia, downloadMedia, getConversationProvider, type ProviderInfo } from '@/lib/whatsappRouter';
import VariablePicker from '@/components/shared/VariablePicker';
import { useSystemVariables } from '@/hooks/useSystemVariables';

interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  variables: string[];
}

// Media cache to avoid re-downloading
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
      // 1. Prefer persisted Storage (works forever, any device)
      if (storagePath) {
        const { data: signed } = await supabase.storage
          .from('whatsapp-media')
          .createSignedUrl(storagePath, 60 * 60 * 6); // 6h
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

      // 2. Fallback: provider (UAZAPI/Meta) — may already be expired
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

        // 3. Self-healing: persist audio so the next device/load doesn't need provider
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guard contra trocas de conversa durante operações assíncronas
  const currentConvIdRef = useRef<string>(conversationId);
  useEffect(() => { currentConvIdRef.current = conversationId; }, [conversationId]);
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

  // Load quick replies
  useEffect(() => {
    if (!tenant) return;
    supabase.from('quick_replies').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('position')
      .then(({ data }) => setQuickReplies((data as unknown as QuickReply[]) ?? []));
  }, [tenant]);

  const replaceVariables = (text: string): string => {
    return text
      .replace(/\{\{nome\}\}/gi, contact?.name || '')
      .replace(/\{\{telefone\}\}/gi, contact?.phone || '')
      .replace(/\{\{email\}\}/gi, contact?.email || '');
  };

  const handleSelectQuickReply = (qr: QuickReply) => {
    const replaced = replaceVariables(qr.content);
    setNewMsg(replaced);
    setShowQuickReplies(false);
    setQrFilter('');
  };

  // Close quick replies on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) setShowQuickReplies(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    getConversationProvider(conversationId).then(setProviderInfo).catch(() => setProviderInfo(null));
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
        setMessages(prev => {
          // dedup por id
          if (prev.some(m => m.id === newMsg.id)) return prev;
          // dedup por conteúdo+timestamp (janela 15s) para casar com a optimistic
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
        setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new as unknown as Message : m));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);

  const handleSend = async () => {
    if (!newMsg.trim() || !tenant || !membership || !conversationId) return;
    const isWhatsApp = channel === 'whatsapp';
    const contactPhone = contact?.phone;
    const msgContent = newMsg;
    const sendAsInternal = isInternal;
    setNewMsg('');

    const optimisticId = crypto.randomUUID();
    const optimisticMsg: any = {
      id: optimisticId, tenant_id: tenant.id, conversation_id: conversationId,
      direction: 'outbound', content: msgContent, sender_membership_id: membership.id,
      created_at: new Date().toISOString(), is_ai_generated: false, media_type: null, media_url: null,
      is_internal: sendAsInternal,
    };
    setMessages(prev => [...prev, optimisticMsg as Message]);

    setSending(true);
    try {
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: conversationId, direction: 'outbound',
        content: msgContent, sender_membership_id: membership.id, is_internal: sendAsInternal,
      } as any).select('id').single();

      if (savedMsg?.id) setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: savedMsg.id } : m));

      // Only update conversation status and send to WhatsApp if NOT internal note
      if (!sendAsInternal) {
        supabase.from('conversations').update({
          last_message_at: new Date().toISOString(), last_agent_message_at: new Date().toISOString(), status: 'waiting_customer',
        }).eq('id', conversationId);

        if (isWhatsApp && contactPhone) {
          const res = await sendText({
            conversationId,
            tenantId: tenant.id,
            phone: contactPhone,
            text: msgContent,
            providerInfo: providerInfo ?? undefined,
          });
          if (!res.ok) {
            // Remove a mensagem persistida e otimista — não foi entregue
            if (savedMsg?.id) await supabase.from('messages').delete().eq('id', savedMsg.id);
            setMessages(prev => prev.filter(m => m.id !== optimisticId && m.id !== savedMsg?.id));
            setNewMsg(msgContent);
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
      if (error) {
        toast.error('Erro ao gerar sugestão: ' + error.message);
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.suggestion) {
        setNewMsg(data.suggestion);
        toast.success('Sugestão de IA inserida');
      }
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleSendMedia = async (file: File) => {
    if (!tenant || !membership || !conversationId) return;
    const contactPhone = contact?.phone;
    const isWhatsApp = channel === 'whatsapp';
    if (!isWhatsApp || !contactPhone) { toast.error('Envio de mídia só disponível para WhatsApp'); return; }

    setSending(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { resolve((reader.result as string).split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      let mediaType = 'image';
      if (file.type.startsWith('audio/')) mediaType = 'audio';
      else if (file.type.startsWith('video/')) mediaType = 'video';
      else if (file.type.includes('pdf') || file.type.includes('document')) mediaType = 'document';

      const extFromName = file.name.split('.').pop()?.toLowerCase();
      const audioExt = extFromName && ['ogg', 'mp3', 'm4a', 'wav', 'webm', 'flac'].includes(extFromName)
        ? extFromName
        : file.type.includes('mpeg') ? 'mp3' : file.type.includes('mp4') ? 'm4a' : file.type.includes('wav') ? 'wav' : file.type.includes('webm') ? 'webm' : 'ogg';

      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: conversationId, direction: 'outbound',
        content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Vídeo' : 'Documento'}]`,
        sender_membership_id: membership.id,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : file.type.startsWith('image/') ? 'ImageMessage' : file.type.startsWith('video/') ? 'VideoMessage' : 'DocumentMessage',
      }).select('id').single();

      let storagePath: string | null = null;
      if (mediaType === 'audio' && savedMsg?.id) {
        const path = `${tenant.id}/${savedMsg.id}.${audioExt}`;
        const { error: uploadError } = await supabase.storage
          .from('whatsapp-media')
          .upload(path, file, { contentType: file.type || 'audio/ogg', upsert: true });
        if (!uploadError) {
          storagePath = path;
          await supabase.from('messages').update({ storage_path: path }).eq('id', savedMsg.id);
        } else {
          console.warn('Outbound audio persist failed:', uploadError.message);
        }
      }

      const optimisticMsg: Message = {
        id: savedMsg?.id || crypto.randomUUID(), tenant_id: tenant.id, conversation_id: conversationId,
        direction: 'outbound', content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : 'Mídia'}]`,
        sender_membership_id: membership.id, created_at: new Date().toISOString(), is_ai_generated: false,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : 'ImageMessage', media_url: null,
        storage_path: storagePath,
      };
      setMessages(prev => [...prev, optimisticMsg]);

      const res = await sendMedia({
        conversationId,
        tenantId: tenant.id,
        phone: contactPhone,
        fileBase64: base64,
        mimeType: file.type,
        mediaType: mediaType as any,
        filename: file.name,
        caption: '',
        providerInfo: providerInfo ?? undefined,
      });

      if (!res.ok) {
        if (savedMsg?.id) await supabase.from('messages').delete().eq('id', savedMsg.id);
        setMessages(prev => prev.filter(m => m.id !== savedMsg?.id));
        if (res.code === 'outside_24h_window') {
          toast.error(res.error ?? 'Cliente fora da janela de 24h.', {
            duration: 8000,
            action: { label: 'Enviar template', onClick: () => setShowTemplate(true) },
          });
        } else {
          toast.error(res.error ?? 'Falha ao enviar mídia');
        }
      } else if (savedMsg?.id) {
        const update: { provider_message_id?: string; provider_metadata?: any } = {};
        if (res.provider_message_id) update.provider_message_id = res.provider_message_id;
        if (res.meta_media_id) update.provider_metadata = { provider: 'meta_cloud', meta_media_id: res.meta_media_id };
        if (Object.keys(update).length) {
          await supabase.from('messages').update(update).eq('id', savedMsg.id);
        }
      }

      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(), last_agent_message_at: new Date().toISOString(), status: 'waiting_customer',
      }).eq('id', conversationId);
    } catch (err: any) {
      toast.error('Erro ao enviar mídia: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {showHeader && contact && (
        <div className="border-b border-border/50 px-4 py-3 flex items-center gap-3 bg-card/50">
          <Avatar className="h-9 w-9">
            {(contact as any)?.avatar_url && <AvatarImage src={(contact as any).avatar_url} alt={contact.name} />}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">{contact.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-sm truncate">{contact.name}</h3>
            <span className="text-xs text-muted-foreground">
              {contact.phone} · {channel}
              {providerInfo?.provider === 'meta_cloud' && <> · <span className="text-primary">WhatsApp Oficial</span></>}
              {providerInfo?.provider === 'uazapi' && providerInfo.instance_id && <> · UAZAPI</>}
            </span>
          </div>
          {status && <Badge variant="outline" className={`rounded-full text-[10px] ${statusColors[status] ?? ''}`}>{conversationStatusLabels[status] ?? status}</Badge>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 bg-background">
        {messages.map(msg => {
          const pmeta = (msg as any).provider_metadata ?? {};
          const msgStatus = pmeta.status ?? pmeta.last_status;
          const isFailed = msgStatus === 'failed';
          const failedErr = isFailed && Array.isArray(pmeta.statuses)
            ? pmeta.statuses.slice().reverse().find((s: any) => s?.status === 'failed')?.raw?.errors?.[0]
            : null;
          const failedCode = failedErr?.code;
          const isOutsideWindow = failedCode === 131047;
          const failedMsg = isOutsideWindow
            ? 'Cliente fora da janela de 24h. Envie um template para reativar a conversa.'
            : (failedErr?.error_data?.details || failedErr?.message || failedErr?.title || 'Falha no envio pela Meta.');
          const isMedia = hasMedia(msg);
          const msgIsInternal = (msg as any).is_internal === true;
          const isTemplate = ((msg as any).media_type || '').toLowerCase() === 'templatemessage';
          return (
            <div key={msg.id} className={cn("flex flex-col", msg.direction === 'outbound' ? 'items-end' : 'items-start')}>
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
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border/50 bg-card/50">
        {/* Internal note indicator */}
        {isInternal && (
          <div className="px-3 pt-2 flex items-center gap-1.5 text-xs text-warning font-medium">
            <Lock className="h-3 w-3" /> Modo nota interna — não será enviada ao cliente
          </div>
        )}

        {/* Quick replies dropdown */}
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
          {!isInternal && <AudioRecorder onRecorded={handleSendMedia} disabled={sending} provider={providerInfo?.provider ?? null} />}
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
        />
      )}
      {tenant && providerInfo?.provider === 'meta_cloud' && providerInfo.instance_id && (
        <SendTemplateDialog
          open={showTemplate}
          onOpenChange={setShowTemplate}
          tenantId={tenant.id}
          whatsappInstanceId={providerInfo.instance_id}
          conversationId={conversationId}
          contactName={contact?.name ?? null}
        />
      )}
    </div>
  );
}
