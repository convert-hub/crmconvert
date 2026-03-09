import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Contact } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, MessageSquare, Plus, Pencil, Trash2, Kanban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { conversationStatusLabels, channelLabels } from '@/lib/labels';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import StartConversationDialog from '@/components/crm/StartConversationDialog';
import CreateOpportunityFromContactDialog from '@/components/crm/CreateOpportunityFromContactDialog';
import ChatPanel from '@/components/inbox/ChatPanel';

function ChatHeader({ contact, channel, status, statusColors, onNameSaved }: {
  contact?: Contact;
  channel?: string;
  status?: string;
  statusColors: Record<string, string>;
  onNameSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact?.name ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setName(contact?.name ?? ''); }, [contact?.name]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || !contact) { setEditing(false); return; }
    if (trimmed === contact.name) { setEditing(false); return; }
    const { error } = await supabase.from('contacts').update({ name: trimmed }).eq('id', contact.id);
    if (error) { toast.error(error.message); return; }
    onNameSaved(trimmed);
    setEditing(false);
    toast.success('Nome atualizado!');
  };

  return (
    <div className="flex items-center gap-3 group flex-1">
      <Avatar className="h-10 w-10">
        {(contact as any)?.avatar_url && <AvatarImage src={(contact as any).avatar_url} alt={contact?.name ?? ''} />}
        <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">{(contact?.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div>
        {editing ? (
          <Input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={save}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(contact?.name ?? ''); setEditing(false); } }}
            className="h-8 text-base font-semibold rounded-lg w-56"
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-foreground">{contact?.name ?? 'Conversa'}</h3>
            {contact && (
              <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent" title="Editar nome">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
        <span className="text-xs text-muted-foreground">{contact?.phone} · {channel}</span>
      </div>
      <div className="ml-auto">
        <Badge variant="outline" className={`rounded-full ${statusColors[status ?? ''] ?? ''}`}>{conversationStatusLabels[status ?? ''] ?? status}</Badge>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { tenant, membership, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<(Conversation & { contact?: Contact })[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(searchParams.get('conv'));
  const [search, setSearch] = useState('');
  const [showNewConv, setShowNewConv] = useState(false);
  const [oppContact, setOppContact] = useState<Contact | null>(null);

  const loadConversations = () => {
    if (!tenant) return;
    let query = supabase.from('conversations').select('*, contact:contacts(*)').eq('tenant_id', tenant.id).order('last_message_at', { ascending: false }).limit(100);

    // Attendants only see unassigned chats + chats assigned to themselves
    if (role === 'attendant' && membership) {
      query = query.or(`assigned_to.is.null,assigned_to.eq.${membership.id}`);
    }

    query.then(({ data }) => {
        const convs = (data as unknown as (Conversation & { contact?: Contact })[]) ?? [];
        setConversations(convs);
        const urlConv = searchParams.get('conv');
        if (urlConv && convs.some(c => c.id === urlConv)) {
          setSelectedConv(urlConv);
          setSearchParams({}, { replace: true });
        }
      });
  };

  useEffect(() => { loadConversations(); }, [tenant, role, membership?.id]);

  // Realtime: listen for new/updated conversations
  useEffect(() => {
    if (!tenant) return;
    const channel = supabase.channel(`inbox-convs-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => {
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant, role, membership?.id]);

  useEffect(() => {
    if (!selectedConv) return;
    // Reset unread count when opening conversation
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', selectedConv).then(() => {
      setConversations(prev => prev.map(c => c.id === selectedConv ? { ...c, unread_count: 0 } : c));
    });
  }, [selectedConv]);

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Excluir esta conversa e todas as mensagens?')) return;
    const { error } = await supabase.from('conversations').delete().eq('id', convId);
    if (error) { toast.error(error.message); return; }
    toast.success('Conversa excluída');
    if (selectedConv === convId) { setSelectedConv(null); }
    setConversations(prev => prev.filter(c => c.id !== convId));
  };

  const filtered = conversations.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    const digitsOnly = s.replace(/\D/g, '');
    const nameMatch = c.contact?.name?.toLowerCase().includes(s);
    const phoneRaw = c.contact?.phone || '';
    const phoneMatch = phoneRaw.includes(s) || (digitsOnly.length >= 3 && phoneRaw.replace(/\D/g, '').includes(digitsOnly));
    return nameMatch || phoneMatch;
  });

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
            <div key={conv.id} onClick={() => setSelectedConv(conv.id)}
              className={cn(
                "w-full text-left px-4 py-3.5 border-b border-border/30 hover:bg-accent/50 transition-all duration-150 group relative cursor-pointer",
                selectedConv === conv.id && "bg-accent/80 border-l-2 border-l-primary"
              )}>
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  {(conv.contact as any)?.avatar_url && <AvatarImage src={(conv.contact as any).avatar_url} alt={conv.contact?.name ?? ''} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">{(conv.contact?.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate text-foreground">{conv.contact?.name ?? 'Desconhecido'}</span>
                    <div className="flex items-center gap-1">
                      {conv.unread_count > 0 && (
                        <span className="h-5 w-5 flex items-center justify-center p-0 rounded-full text-[10px] font-bold gradient-primary text-white">{conv.unread_count}</span>
                      )}
                      <button onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="h-6 w-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all"
                        title="Excluir conversa">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                  {conv.contact?.phone && (
                    <span className="text-[11px] text-muted-foreground truncate block">{conv.contact.phone}</span>
                  )}
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{channelLabels[conv.channel] ?? conv.channel}</span>
                    {conv.last_message_at && <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(conv.last_message_at), { locale: ptBR, addSuffix: true })}</span>}
                  </div>
                  <Badge variant="outline" className={`text-[10px] mt-1.5 rounded-full ${statusColors[conv.status] ?? ''}`}>{conversationStatusLabels[conv.status] ?? conv.status}</Badge>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Nenhuma conversa</p>}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {selectedConv ? (
          <>
            <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between bg-card/50">
              <ChatHeader
                contact={selectedData?.contact}
                channel={selectedData?.channel}
                status={selectedData?.status}
                statusColors={statusColors}
                onNameSaved={(newName) => {
                  setConversations(prev => prev.map(c => c.id === selectedConv && c.contact ? { ...c, contact: { ...c.contact, name: newName } } : c));
                }}
              />
              {selectedData?.contact && (
                <Button size="sm" variant="outline" className="ml-2 h-8 text-xs" onClick={() => setOppContact(selectedData.contact!)}>
                  <Kanban className="h-3.5 w-3.5 mr-1.5" />Criar Oportunidade
                </Button>
              )}
            </div>
            <ChatPanel
              conversationId={selectedConv}
              contact={selectedData?.contact}
              channel={selectedData?.channel}
              status={selectedData?.status}
              showHeader={false}
              className="flex-1"
            />
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

      {oppContact && (
        <CreateOpportunityFromContactDialog
          open={!!oppContact}
          onOpenChange={(v) => { if (!v) setOppContact(null); }}
          contact={oppContact}
        />
      )}
    </div>
  );
}
