import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Contact, Message } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Search, MessageSquare, Plus, Loader2, Check, CheckCheck, Image, Mic, Paperclip, Play, Pause, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import StartConversationDialog from '@/components/crm/StartConversationDialog';
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
    
    // Check cache first
    const cached = mediaCache.get(providerMsgId);
    if (cached) {
      setMediaData(cached);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
        body: {
          action: 'download_media',
          tenant_id: tenantId,
          message_id: providerMsgId,
        },
      });

      if (error || data?.error) {
        console.error('Media download error:', error || data?.error);
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

      if (result) {
        mediaCache.set(providerMsgId, result);
        setMediaData(result);
      }
    } catch (e) {
      console.error('Media load failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isImage || isAudio) loadMedia();
  }, [providerMsgId]);

  const isOutbound = msg.direction === 'outbound';

  if (isAudio) {
    return (
      <div className="min-w-[220px]">
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className={cn("text-xs", isOutbound ? "text-white/70" : "text-muted-foreground")}>Carregando áudio...</span>
          </div>
        ) : mediaData ? (
          <AudioPlayer src={mediaData} isOutbound={isOutbound} />
        ) : (
          <button onClick={loadMedia} className={cn(
            "flex items-center gap-2 text-xs py-1 opacity-70 hover:opacity-100 transition-opacity",
            isOutbound ? "text-white" : "text-foreground"
          )}>
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
          <div className="h-40 w-full flex items-center justify-center bg-muted/20 rounded-lg">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : mediaData ? (
          <>
            <img src={mediaData} alt="Imagem" className="rounded-lg max-h-60 w-auto cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setLightboxOpen(true)} />
            {lightboxOpen && <ImageLightbox src={mediaData} onClose={() => setLightboxOpen(false)} />}
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs">
            <Image className="h-3 w-3 mr-1" /> Carregar imagem
          </Button>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="max-w-[280px]">
        {mediaData ? (
          <video src={mediaData} controls className="rounded-lg max-h-60 w-auto" />
        ) : (
          <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs">
            <Play className="h-3 w-3 mr-1" /> Carregar vídeo
          </Button>
        )}
      </div>
    );
  }

  if (isDocument) {
    return (
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        <span className="text-xs">Documento</span>
        <Button size="sm" variant="ghost" onClick={loadMedia} className="text-xs">
          <Download className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return null;
}

export default function InboxPage() {
  const { tenant, membership } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<(Conversation & { contact?: Contact })[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(searchParams.get('conv'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [search, setSearch] = useState('');
  const [showNewConv, setShowNewConv] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadConversations = () => {
    if (!tenant) return;
    supabase.from('conversations').select('*, contact:contacts(*)').eq('tenant_id', tenant.id).order('last_message_at', { ascending: false }).limit(100)
      .then(({ data }) => {
        const convs = (data as unknown as (Conversation & { contact?: Contact })[]) ?? [];
        setConversations(convs);
        const urlConv = searchParams.get('conv');
        if (urlConv && convs.some(c => c.id === urlConv)) {
          setSelectedConv(urlConv);
          setSearchParams({}, { replace: true });
        }
      });
  };

  useEffect(() => { loadConversations(); }, [tenant]);

  // Realtime: listen for new/updated conversations
  useEffect(() => {
    if (!tenant) return;
    const channel = supabase.channel(`inbox-convs-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => {
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant]);

  useEffect(() => {
    const urlConv = searchParams.get('conv');
    if (urlConv && urlConv !== selectedConv) {
      setSelectedConv(urlConv);
      setSearchParams({}, { replace: true });
      loadConversations();
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedConv) return;
    supabase.from('messages').select('*').eq('conversation_id', selectedConv).order('created_at')
      .then(({ data }) => setMessages((data as unknown as Message[]) ?? []));

    // Reset unread count when opening conversation
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', selectedConv).then(() => {
      setConversations(prev => prev.map(c => c.id === selectedConv ? { ...c, unread_count: 0 } : c));
    });

    const channel = supabase.channel(`inbox-msgs-${selectedConv}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConv}` }, payload => {
        const newMsg = payload.new as any;
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          const isOptimistic = prev.find(m => 
            m.direction === 'outbound' && 
            m.content === newMsg.content && 
            !prev.some(p => p.id === newMsg.id) &&
            Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime()) < 5000
          );
          if (isOptimistic) {
            return prev.map(m => m.id === isOptimistic.id ? (newMsg as unknown as Message) : m);
          }
          return [...prev, newMsg as unknown as Message];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConv}` }, payload => {
        setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new as unknown as Message : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedConv]);

  const handleSend = async () => {
    if (!newMsg.trim() || !tenant || !membership || !selectedConv) return;
    
    const selectedData = conversations.find(c => c.id === selectedConv);
    const contactPhone = selectedData?.contact?.phone;
    const isWhatsApp = selectedData?.channel === 'whatsapp';

    const msgContent = newMsg;
    setNewMsg('');

    const optimisticId = crypto.randomUUID();
    const optimisticMsg: Message = {
      id: optimisticId,
      tenant_id: tenant.id,
      conversation_id: selectedConv,
      direction: 'outbound',
      content: msgContent,
      sender_membership_id: membership.id,
      created_at: new Date().toISOString(),
      is_ai_generated: false,
      media_type: null,
      media_url: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    setSending(true);
    try {
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: selectedConv, direction: 'outbound',
        content: msgContent, sender_membership_id: membership.id,
      }).select('id').single();

      if (savedMsg?.id) {
        setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: savedMsg.id } : m));
      }

      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_agent_message_at: new Date().toISOString(),
        status: 'waiting_customer',
      }).eq('id', selectedConv);

      if (isWhatsApp && contactPhone) {
        const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
          body: {
            action: 'send_message',
            tenant_id: tenant.id,
            phone: contactPhone,
            message: msgContent,
            conversation_id: selectedConv,
          },
        });

        if (error || data?.error) {
          console.error('WhatsApp send error:', error || data?.error);
          toast.warning('Falha ao enviar via WhatsApp: ' + (data?.error || error?.message));
        } else if (savedMsg?.id && data?.provider_message_id) {
          await supabase.from('messages').update({
            provider_message_id: data.provider_message_id,
          }).eq('id', savedMsg.id);
        }
      }
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleSendMedia = async (file: File) => {
    if (!tenant || !membership || !selectedConv) return;
    
    const selectedData = conversations.find(c => c.id === selectedConv);
    const contactPhone = selectedData?.contact?.phone;
    const isWhatsApp = selectedData?.channel === 'whatsapp';

    if (!isWhatsApp || !contactPhone) {
      toast.error('Envio de mídia só disponível para WhatsApp');
      return;
    }

    setSending(true);
    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data:xxx;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      let mediaType = 'image';
      if (file.type.startsWith('audio/')) mediaType = 'audio';
      else if (file.type.startsWith('video/')) mediaType = 'video';
      else if (file.type.includes('pdf') || file.type.includes('document')) mediaType = 'document';

      // Save message to DB first
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id,
        conversation_id: selectedConv,
        direction: 'outbound',
        content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Vídeo' : 'Documento'}]`,
        sender_membership_id: membership.id,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : file.type.startsWith('image/') ? 'ImageMessage' : file.type.startsWith('video/') ? 'VideoMessage' : 'DocumentMessage',
      }).select('id').single();

      // Add optimistic message
      const optimisticMsg: Message = {
        id: savedMsg?.id || crypto.randomUUID(),
        tenant_id: tenant.id,
        conversation_id: selectedConv,
        direction: 'outbound',
        content: `[${mediaType === 'audio' ? 'Áudio' : mediaType === 'image' ? 'Imagem' : 'Mídia'}]`,
        sender_membership_id: membership.id,
        created_at: new Date().toISOString(),
        is_ai_generated: false,
        media_type: file.type.startsWith('audio/') ? 'AudioMessage' : 'ImageMessage',
        media_url: null,
      };
      setMessages(prev => [...prev, optimisticMsg]);

      // Send via UAZAPI
      const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
        body: {
          action: 'send_media',
          tenant_id: tenant.id,
          phone: contactPhone,
          media_base64: `data:${file.type};base64,${base64}`,
          media_type: mediaType,
          caption: '',
        },
      });

      if (error || data?.error) {
        console.error('WhatsApp send media error:', error || data?.error);
        toast.warning('Falha ao enviar mídia: ' + (data?.error || error?.message));
      } else if (savedMsg?.id && data?.provider_message_id) {
        await supabase.from('messages').update({
          provider_message_id: data.provider_message_id,
        }).eq('id', savedMsg.id);
        toast.success('Mídia enviada!');
      }

      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_agent_message_at: new Date().toISOString(),
        status: 'waiting_customer',
      }).eq('id', selectedConv);
    } catch (err: any) {
      toast.error('Erro ao enviar mídia: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const filtered = conversations.filter(c =>
    !search || c.contact?.name?.toLowerCase().includes(search.toLowerCase()) || c.contact?.phone?.includes(search)
  );

  const selectedData = conversations.find(c => c.id === selectedConv);

  const statusColors: Record<string, string> = {
    open: 'bg-success/10 text-success border-success/20',
    waiting_customer: 'bg-warning/10 text-warning border-warning/20',
    waiting_agent: 'bg-info/10 text-info border-info/20',
    closed: 'bg-muted text-muted-foreground',
  };

  const hasMedia = (msg: Message) => {
    const mt = ((msg as any).media_type || '').toLowerCase();
    return mt.includes('audio') || mt.includes('image') || mt.includes('video') || mt.includes('document') || mt.includes('ptt');
  };

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      <div className="w-80 border-r border-border/50 flex flex-col bg-card/50">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-foreground">Conversas</h2>
            <Button size="sm" variant="outline" className="rounded-xl h-8" onClick={() => setShowNewConv(true)}>
              <Plus className="h-4 w-4 mr-1" />Nova
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 rounded-xl" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filtered.map(conv => (
            <button key={conv.id} onClick={() => setSelectedConv(conv.id)}
              className={cn(
                "w-full text-left px-4 py-3.5 border-b border-border/30 hover:bg-accent/50 transition-all duration-150",
                selectedConv === conv.id && "bg-accent/80 border-l-2 border-l-primary"
              )}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate text-foreground">{conv.contact?.name ?? 'Desconhecido'}</span>
                {conv.unread_count > 0 && (
                  <span className="h-5 w-5 flex items-center justify-center p-0 rounded-full text-[10px] font-bold gradient-primary text-white">{conv.unread_count}</span>
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-muted-foreground capitalize">{conv.channel}</span>
                {conv.last_message_at && <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(conv.last_message_at), { locale: ptBR, addSuffix: true })}</span>}
              </div>
              <Badge variant="outline" className={`text-[10px] mt-1.5 capitalize rounded-full ${statusColors[conv.status] ?? ''}`}>{conv.status.replace('_', ' ')}</Badge>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Nenhuma conversa</p>}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {selectedConv ? (
          <>
            <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between bg-card/50">
              <div>
                <h3 className="font-semibold text-foreground">{selectedData?.contact?.name ?? 'Conversa'}</h3>
                <span className="text-xs text-muted-foreground">{selectedData?.contact?.phone} · {selectedData?.channel}</span>
              </div>
              <Badge variant="outline" className={`capitalize rounded-full ${statusColors[selectedData?.status ?? ''] ?? ''}`}>{selectedData?.status?.replace('_', ' ')}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-3 bg-background">
              {messages.map(msg => {
                const status = (msg as any).provider_metadata?.status;
                const isMedia = hasMedia(msg);
                return (
                  <div key={msg.id} className={cn("flex", msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div className={cn("max-w-[70%] rounded-2xl px-4 py-2.5 text-sm",
                      msg.direction === 'outbound' ? 'gradient-primary text-white' : 'bg-card border border-border/50 text-foreground')}>
                      {isMedia && tenant && <MediaBubble msg={msg} tenantId={tenant.id} />}
                      {(!isMedia || (msg.content && !msg.content.startsWith('['))) && <span>{msg.content}</span>}
                      <div className={cn("text-[10px] mt-1 flex items-center gap-1", msg.direction === 'outbound' ? 'text-white/70 justify-end' : 'text-muted-foreground')}>
                        {format(new Date(msg.created_at), "HH:mm")}
                        {msg.direction === 'outbound' && (
                          status === 'read' ? <CheckCheck className="h-3 w-3 text-blue-300" /> :
                          status === 'delivered' ? <CheckCheck className="h-3 w-3" /> :
                          <Check className="h-3 w-3" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border/50 p-4 flex gap-2 bg-card/50">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleSendMedia(file);
                  e.target.value = '';
                }}
              />
              <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={sending} className="rounded-xl h-12 w-12 shrink-0">
                <Paperclip className="h-4 w-4" />
              </Button>
              <AudioRecorder onRecorded={handleSendMedia} disabled={sending} />
              <Textarea value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Mensagem..." className="min-h-[50px] resize-none rounded-xl"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
              <Button size="icon" onClick={handleSend} disabled={sending || !newMsg.trim()} className="rounded-xl h-12 w-12">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="h-16 w-16 rounded-2xl bg-accent/50 flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-accent-foreground" />
            </div>
            <p className="font-medium">Selecione uma conversa</p>
            <p className="text-sm mt-1">Escolha uma conversa da lista para começar</p>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => setShowNewConv(true)}>
              <Plus className="h-4 w-4 mr-2" />Nova Conversa
            </Button>
          </div>
        )}
      </div>

      <StartConversationDialog open={showNewConv} onOpenChange={setShowNewConv} />
    </div>
  );
}
