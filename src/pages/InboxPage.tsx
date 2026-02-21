import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Contact, Message } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Search, MessageSquare, Plus, Loader2, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import StartConversationDialog from '@/components/crm/StartConversationDialog';

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
          // Deduplicate: skip if already exists (optimistic or duplicate event)
          if (prev.some(m => m.id === newMsg.id)) return prev;
          // Also replace optimistic messages with same content/direction/time proximity
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

    // Optimistic: add message to UI immediately
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
      // Save message to DB
      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: selectedConv, direction: 'outbound',
        content: msgContent, sender_membership_id: membership.id,
      }).select('id').single();

      // Replace optimistic ID with real DB ID so realtime UPDATEs (delivered/read) match
      if (savedMsg?.id) {
        setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: savedMsg.id } : m));
      }

      // Update conversation timestamps (fire and forget)
      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_agent_message_at: new Date().toISOString(),
        status: 'waiting_customer',
      }).eq('id', selectedConv);

      // If WhatsApp channel and contact has phone, send via UAZAPI
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
          console.log('Saved provider_message_id:', data.provider_message_id, 'for message:', savedMsg.id);
        }
      }
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
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
                return (
                  <div key={msg.id} className={cn("flex", msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div className={cn("max-w-[70%] rounded-2xl px-4 py-2.5 text-sm",
                      msg.direction === 'outbound' ? 'gradient-primary text-white' : 'bg-card border border-border/50 text-foreground')}>
                      {msg.content}
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
