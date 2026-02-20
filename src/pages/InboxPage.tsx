import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Contact, Message } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Search, MessageSquare, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

export default function InboxPage() {
  const { tenant, membership } = useAuth();
  const [conversations, setConversations] = useState<(Conversation & { contact?: Contact })[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!tenant) return;
    supabase.from('conversations').select('*, contact:contacts(*)').eq('tenant_id', tenant.id).order('last_message_at', { ascending: false }).limit(100)
      .then(({ data }) => setConversations((data as unknown as (Conversation & { contact?: Contact })[]) ?? []));
  }, [tenant]);

  useEffect(() => {
    if (!selectedConv) return;
    supabase.from('messages').select('*').eq('conversation_id', selectedConv).order('created_at')
      .then(({ data }) => setMessages((data as unknown as Message[]) ?? []));

    const channel = supabase.channel(`inbox-${selectedConv}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConv}` }, payload => {
        setMessages(prev => [...prev, payload.new as unknown as Message]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedConv]);

  const handleSend = async () => {
    if (!newMsg.trim() || !tenant || !membership || !selectedConv) return;
    await supabase.from('messages').insert({
      tenant_id: tenant.id,
      conversation_id: selectedConv,
      direction: 'outbound',
      content: newMsg,
      sender_membership_id: membership.id,
    });
    setNewMsg('');
    toast.success('Mensagem enviada');
  };

  const filtered = conversations.filter(c =>
    !search || c.contact?.name?.toLowerCase().includes(search.toLowerCase()) || c.contact?.phone?.includes(search)
  );

  const selectedData = conversations.find(c => c.id === selectedConv);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-bold mb-3">Conversas</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filtered.map(conv => (
            <button
              key={conv.id}
              onClick={() => setSelectedConv(conv.id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors",
                selectedConv === conv.id && "bg-accent"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate">{conv.contact?.name ?? 'Desconhecido'}</span>
                {conv.unread_count > 0 && <Badge className="text-xs h-5 w-5 flex items-center justify-center p-0 rounded-full">{conv.unread_count}</Badge>}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground capitalize">{conv.channel}</span>
                {conv.last_message_at && <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(conv.last_message_at), { locale: ptBR, addSuffix: true })}</span>}
              </div>
              <Badge variant={conv.status === 'open' ? 'default' : 'secondary'} className="text-[10px] mt-1 capitalize">{conv.status.replace('_', ' ')}</Badge>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Nenhuma conversa</p>}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {selectedConv ? (
          <>
            {/* Chat header */}
            <div className="border-b px-6 py-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{selectedData?.contact?.name ?? 'Conversa'}</h3>
                <span className="text-xs text-muted-foreground">{selectedData?.contact?.phone}</span>
              </div>
              <Badge variant="outline" className="capitalize">{selectedData?.status?.replace('_', ' ')}</Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2">
              {messages.map(msg => (
                <div key={msg.id} className={cn("flex", msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                  <div className={cn("max-w-[70%] rounded-xl px-3 py-2 text-sm", msg.direction === 'outbound' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                    {msg.content}
                    <div className={cn("text-[10px] mt-1", msg.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                      {format(new Date(msg.created_at), "HH:mm")}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="border-t p-4 flex gap-2">
              <Textarea value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Mensagem..." className="min-h-[50px] resize-none"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
              <Button size="icon" onClick={handleSend}><Send className="h-4 w-4" /></Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mb-3" />
            <p>Selecione uma conversa</p>
          </div>
        )}
      </div>
    </div>
  );
}
