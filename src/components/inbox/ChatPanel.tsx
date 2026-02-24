import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact, Message } from '@/types/crm';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Check, CheckCheck, Image, Mic, Paperclip, Play, FileText, Download, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import AudioRecorder from '@/components/inbox/AudioRecorder';
import AudioPlayer from '@/components/inbox/AudioPlayer';

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

function MediaBubble({ msg, tenantId }: { msg: Message; tenantId: string }) {
  const [mediaData, setMediaData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const mediaType = ((msg as any).media_type || '').toLowerCase();
  const isAudio = mediaType.includes('audio') || mediaType.includes('ptt');
  const isImage = mediaType.includes('image');
  const isVideo = mediaType.includes('video');
  const isDocument = mediaType.includes('document') || mediaType.includes('pdf');
  const providerMsgId = (msg as any).provider_message_id;

  const loadMedia = async () => {
    if (!providerMsgId || loading) return;
    const cached = mediaCache.get(providerMsgId);
    if (cached) { setMediaData(cached); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
        body: { action: 'download_media', tenant_id: tenantId, message_id: providerMsgId },
      });

      if (error || data?.error) {
        if (data?.expired) setMediaData('expired');
        return;
      }

      let result: string | null = null;
      if (data?.base64) {
        const mime = data.mimetype || (isAudio ? 'audio/ogg' : isImage ? 'image/jpeg' : 'application/octet-stream');
        result = `data:${mime};base64,${data.base64}`;
      } else if (data?.url) {
        result = data.url;
      } else if (data?.data?.fileURL) {
        result = data.data.fileURL;
      } else if (data?.data?.base64) {
        const mime = data.data.mimetype || (isAudio ? 'audio/ogg' : 'image/jpeg');
        result = `data:${mime};base64,${data.data.base64}`;
      }

      if (result) { mediaCache.set(providerMsgId, result); setMediaData(result); }
    } catch (e) {
      console.error('Media load failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isImage || isAudio) loadMedia(); }, [providerMsgId]);

  const isOutbound = msg.direction === 'outbound';

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
            <Mic className="h-3.5 w-3.5" /> Áudio indisponível
          </div>
        ) : mediaData ? (
          <AudioPlayer src={mediaData} isOutbound={isOutbound} />
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
          <div className="h-20 w-full flex items-center justify-center bg-muted/20 rounded-lg text-xs text-muted-foreground">Imagem indisponível</div>
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
        {mediaData ? <video src={mediaData} controls className="rounded-lg max-h-60 w-auto" /> : (
          <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs"><Play className="h-3 w-3 mr-1" /> Carregar vídeo</Button>
        )}
      </div>
    );
  }

  if (isDocument) {
    return (
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" /><span className="text-xs">Documento</span>
        <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs"><Download className="h-3 w-3" /></Button>
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const statusColors: Record<string, string> = {
    open: 'bg-success/10 text-success border-success/20',
    waiting_customer: 'bg-warning/10 text-warning border-warning/20',
    waiting_agent: 'bg-info/10 text-info border-info/20',
    closed: 'bg-muted text-muted-foreground',
  };

  useEffect(() => {
    if (!conversationId) return;
    supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at')
      .then(({ data }) => {
        setMessages((data as unknown as Message[]) ?? []);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50);
      });

    supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId);

    const ch = supabase.channel(`chat-panel-msgs-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        const newMsg = payload.new as any;
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          const isOptimistic = prev.find(m =>
            m.direction === 'outbound' && m.content === newMsg.content &&
            Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime()) < 5000
          );
          if (isOptimistic) return prev.map(m => m.id === isOptimistic.id ? (newMsg as unknown as Message) : m);
          return [...prev, newMsg as unknown as Message];
        });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
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
    setNewMsg('');

    const optimisticId = crypto.randomUUID();
    const optimisticMsg: Message = {
      id: optimisticId, tenant_id: tenant.id, conversation_id: conversationId,
      direction: 'outbound', content: msgContent, sender_membership_id: membership.id,
      created_at: new Date().toISOString(), is_ai_generated: false, media_type: null, media_url: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    setSending(true);
    try {
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: conversationId, direction: 'outbound',
        content: msgContent, sender_membership_id: membership.id,
      }).select('id').single();

      if (savedMsg?.id) setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: savedMsg.id } : m));

      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(), last_agent_message_at: new Date().toISOString(), status: 'waiting_customer',
      }).eq('id', conversationId);

      if (isWhatsApp && contactPhone) {
        const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
          body: { action: 'send_message', tenant_id: tenant.id, phone: contactPhone, message: msgContent, conversation_id: conversationId },
        });
        if (error || data?.error) {
          toast.warning('Falha ao enviar via WhatsApp: ' + (data?.error || error?.message));
        } else if (savedMsg?.id && data?.provider_message_id) {
          await supabase.from('messages').update({ provider_message_id: data.provider_message_id }).eq('id', savedMsg.id);
        }
      }
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSending(false);
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

      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: conversationId, direction: 'outbound',
        content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Vídeo' : 'Documento'}]`,
        sender_membership_id: membership.id,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : file.type.startsWith('image/') ? 'ImageMessage' : file.type.startsWith('video/') ? 'VideoMessage' : 'DocumentMessage',
      }).select('id').single();

      const optimisticMsg: Message = {
        id: savedMsg?.id || crypto.randomUUID(), tenant_id: tenant.id, conversation_id: conversationId,
        direction: 'outbound', content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : 'Mídia'}]`,
        sender_membership_id: membership.id, created_at: new Date().toISOString(), is_ai_generated: false,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : 'ImageMessage', media_url: null,
      };
      setMessages(prev => [...prev, optimisticMsg]);

      const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
        body: { action: 'send_media', tenant_id: tenant.id, phone: contactPhone, media_base64: `data:${file.type};base64,${base64}`, media_type: mediaType, caption: '' },
      });

      if (error || data?.error) {
        toast.warning('Falha ao enviar mídia: ' + (data?.error || error?.message));
      } else if (savedMsg?.id && data?.provider_message_id) {
        await supabase.from('messages').update({ provider_message_id: data.provider_message_id }).eq('id', savedMsg.id);
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
            <span className="text-xs text-muted-foreground">{contact.phone} · {channel}</span>
          </div>
          {status && <Badge variant="outline" className={`capitalize rounded-full text-[10px] ${statusColors[status] ?? ''}`}>{status.replace('_', ' ')}</Badge>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 bg-background">
        {messages.map(msg => {
          const msgStatus = (msg as any).provider_metadata?.status;
          const isMedia = hasMedia(msg);
          return (
            <div key={msg.id} className={cn("flex", msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
              <div className={cn("max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                msg.direction === 'outbound' ? 'gradient-primary text-white' : 'bg-card border border-border/50 text-foreground')}>
                {isMedia && tenant && <MediaBubble msg={msg} tenantId={tenant.id} />}
                {(!isMedia || (msg.content && !msg.content.startsWith('['))) && <span>{msg.content}</span>}
                <div className={cn("text-[10px] mt-1 flex items-center gap-1", msg.direction === 'outbound' ? 'text-white/70 justify-end' : 'text-muted-foreground')}>
                  {format(new Date(msg.created_at), "HH:mm")}
                  {msg.direction === 'outbound' && (
                    msgStatus === 'read' ? <CheckCheck className="h-3 w-3 text-blue-300" /> :
                    msgStatus === 'delivered' ? <CheckCheck className="h-3 w-3" /> :
                    <Check className="h-3 w-3" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border/50 p-3 flex gap-2 bg-card/50">
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
          onChange={e => { const file = e.target.files?.[0]; if (file) handleSendMedia(file); e.target.value = ''; }} />
        <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={sending} className="rounded-xl h-10 w-10 shrink-0">
          <Paperclip className="h-4 w-4" />
        </Button>
        <AudioRecorder onRecorded={handleSendMedia} disabled={sending} />
        <Textarea value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Mensagem..." className="min-h-[40px] max-h-[120px] resize-none rounded-xl text-sm"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
        <Button size="icon" onClick={handleSend} disabled={sending || !newMsg.trim()} className="rounded-xl h-10 w-10">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
