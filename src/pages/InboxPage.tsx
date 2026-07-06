import { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Conversation, Contact, WhatsAppInstance } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { CascadeDeleteDialog } from '@/components/shared/CascadeDeleteDialog';
import { useCascadeDelete, type ConversationLinked } from '@/hooks/useCascadeDelete';
import { User, Target, CheckSquare } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, MessageSquare, Plus, Pencil, Trash2, Kanban, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { conversationStatusLabels, channelLabels } from '@/lib/labels';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import StartConversationDialog from '@/components/crm/StartConversationDialog';
import CreateOpportunityFromContactDialog from '@/components/crm/CreateOpportunityFromContactDialog';
import ChatPanel from '@/components/inbox/ChatPanel';

const last4Digits = (phone?: string | null) => {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : d;
};

const instanceLabel = (inst?: WhatsAppInstance | null) => {
  if (!inst) return 'Sem canal';
  const base = inst.provider === 'meta_cloud' ? 'API Oficial' : 'UAZAPI';
  const tail = last4Digits(inst.phone_number) || inst.display_name || inst.id.slice(0, 4);
  return `${base} (${tail})`;
};


function ChatHeader({ contact, channel, status, statusColors, onNameSaved, aiActivated, instanceText }: {
  contact?: Contact;
  channel?: string;
  status?: string;
  statusColors: Record<string, string>;
  onNameSaved: (name: string) => void;
  aiActivated?: boolean;
  instanceText?: string | null;
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
        <span className="text-xs text-muted-foreground">{contact?.phone} · {channel}{instanceText ? ` · ${instanceText}` : ''}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {aiActivated && (
          <Badge variant="outline" className="rounded-full bg-violet-500/10 text-violet-600 border-violet-500/20 gap-1 text-xs">
            <Bot className="h-3 w-3" />IA Ativa
          </Badge>
        )}
        <Badge variant="outline" className={`rounded-full ${statusColors[status ?? ''] ?? ''}`}>{conversationStatusLabels[status ?? ''] ?? status}</Badge>
      </div>
    </div>
  );
}

const PAGE_SIZE = 300;

export default function InboxPage() {
  const { tenant, membership, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<(Conversation & { contact?: Contact })[]>([]);
  const [selectedConv, setSelectedConv] = useState<string | null>(searchParams.get('conv'));
  const [search, setSearch] = useState('');
  const [showNewConv, setShowNewConv] = useState(false);
  const [oppContact, setOppContact] = useState<Contact | null>(null);
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'unanswered'>(() => {
    try {
      const v = localStorage.getItem('inbox:filter');
      return (v === 'unread' || v === 'unanswered') ? v : 'all';
    } catch { return 'all'; }
  });
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(() => {
    try { return localStorage.getItem('inbox:instanceFilter') || null; } catch { return null; }
  });

  const instancesById = useMemo(() => {
    const map: Record<string, WhatsAppInstance> = {};
    for (const i of instances) map[i.id] = i;
    return map;
  }, [instances]);
  const showInstanceUI = instances.length >= 2;

  useEffect(() => {
    if (!tenant) return;
    supabase.from('whatsapp_instances')
      .select('id, provider, phone_number, display_name, instance_name, is_active, tenant_id, api_url, created_at, updated_at')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .then(({ data }) => {
        const list = (data as unknown as WhatsAppInstance[]) ?? [];
        setInstances(list);
        setSelectedInstanceId(prev => {
          if (prev && !list.some(i => i.id === prev)) {
            try { localStorage.removeItem('inbox:instanceFilter'); } catch {}
            return null;
          }
          return prev;
        });
      });
  }, [tenant?.id]);

  useEffect(() => {
    try {
      if (selectedInstanceId) localStorage.setItem('inbox:instanceFilter', selectedInstanceId);
      else localStorage.removeItem('inbox:instanceFilter');
    } catch {}
  }, [selectedInstanceId]);

  const changeInstanceFilter = (id: string | null) => {
    if (id === selectedInstanceId) return;
    setConversations([]);
    setLoadedCount(0);
    setTotalCount(null);
    setSelectedInstanceId(id);
  };


  useEffect(() => {
    try { localStorage.setItem('inbox:filter', filterMode); } catch {}
  }, [filterMode]);

  const changeFilterMode = (next: 'all' | 'unread' | 'unanswered') => {
    if (next === filterMode) return;
    setConversations([]);
    setLoadedCount(0);
    setTotalCount(null);
    setFilterMode(next);
  };

  const baseQuery = () => {
    let query = supabase
      .from('conversations')
      .select('*, contact:contacts(*)', { count: 'exact' })
      .eq('tenant_id', tenant!.id);
    if (filterMode === 'unanswered') {
      query = query.order('last_customer_message_at', { ascending: true, nullsFirst: false });
    } else {
      query = query.order('last_message_at', { ascending: false });
    }
    const canViewAll = (membership as any)?.can_view_all === true;
    if (role === 'attendant' && membership && !canViewAll) {
      query = query.or(`assigned_to.is.null,assigned_to.eq.${membership.id}`);
    }
    if (filterMode === 'unread') query = query.gt('unread_count', 0);
    if (filterMode === 'unanswered') query = query.eq('is_unanswered', true);
    if (selectedInstanceId) query = query.eq('whatsapp_instance_id', selectedInstanceId);
    return query;
  };


  const loadConversations = async () => {
    if (!tenant) return;
    const { data, count } = await baseQuery().range(0, PAGE_SIZE - 1);
    const convs = (data as unknown as (Conversation & { contact?: Contact })[]) ?? [];
    setConversations(convs);
    setLoadedCount(convs.length);
    setTotalCount(count ?? null);
    const urlConv = searchParams.get('conv');
    if (urlConv && convs.some(c => c.id === urlConv) && selectedConv !== urlConv) {
      setSelectedConv(urlConv);
    }
  };

  const loadMore = async () => {
    if (!tenant || loadingMore) return;
    setLoadingMore(true);
    const from = loadedCount;
    const to = from + PAGE_SIZE - 1;
    const { data } = await baseQuery().range(from, to);
    const more = (data as unknown as (Conversation & { contact?: Contact })[]) ?? [];
    setConversations(prev => {
      const seen = new Set(prev.map(c => c.id));
      return [...prev, ...more.filter(c => !seen.has(c.id))];
    });
    setLoadedCount(prev => prev + more.length);
    setLoadingMore(false);
  };

  useEffect(() => { if (!searching) loadConversations(); }, [tenant?.id, role, membership?.id, filterMode, selectedInstanceId]);

  // Server-side search: when user types, query DB directly so old conversations are findable.
  useEffect(() => {
    if (!tenant) return;
    const term = search.trim();
    if (term.length < 2) { setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      const digits = term.replace(/\D/g, '');
      // Find matching contacts first (by name or phone), then fetch their conversations.
      const contactFilter = digits.length >= 3
        ? `name.ilike.%${term}%,phone.ilike.%${digits}%`
        : `name.ilike.%${term}%`;
      const { data: contactIds } = await supabase
        .from('contacts').select('id').eq('tenant_id', tenant.id).or(contactFilter).limit(500);
      const ids = (contactIds ?? []).map((c: any) => c.id);
      if (ids.length === 0) { setConversations([]); setLoadedCount(0); return; }
      let q = supabase.from('conversations').select('*, contact:contacts(*)')
        .eq('tenant_id', tenant.id).in('contact_id', ids).limit(500);
      if (filterMode === 'unanswered') {
        q = q.order('last_customer_message_at', { ascending: true, nullsFirst: false });
      } else {
        q = q.order('last_message_at', { ascending: false });
      }
      const canViewAll = (membership as any)?.can_view_all === true;
      if (role === 'attendant' && membership && !canViewAll) {
        q = q.or(`assigned_to.is.null,assigned_to.eq.${membership.id}`);
      }
      if (filterMode === 'unread') q = q.gt('unread_count', 0);
      if (filterMode === 'unanswered') q = q.eq('is_unanswered', true);
      if (selectedInstanceId) q = q.eq('whatsapp_instance_id', selectedInstanceId);
      const { data } = await q;
      const convs = (data as unknown as (Conversation & { contact?: Contact })[]) ?? [];
      setConversations(convs);
      setLoadedCount(convs.length);
    }, 300);
    return () => clearTimeout(handle);
  }, [search, tenant?.id, role, membership?.id, filterMode, selectedInstanceId]);


  // Reload base list when search is cleared
  useEffect(() => {
    if (search.trim().length < 2 && searching) {
      setSearching(false);
      loadConversations();
    }
  }, [search]);

  // Keep ?conv= in URL in sync with selectedConv so the open chat survives remounts/refreshes.
  useEffect(() => {
    const current = searchParams.get('conv');
    if (selectedConv && current !== selectedConv) {
      setSearchParams({ conv: selectedConv }, { replace: true });
    } else if (!selectedConv && current) {
      setSearchParams({}, { replace: true });
    }
  }, [selectedConv]);


  // Realtime: listen for new/updated conversations
  useEffect(() => {
    if (!tenant) return;
    const channel = supabase.channel(`inbox-convs-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => {
        if (!searching) loadConversations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenant.id}` }, payload => {
        const newMsg = payload.new as any;
        const convId = newMsg?.conversation_id;
        if (!convId) return;
        setConversations(prev => {
          if (!prev.some(c => c.id === convId) && !searching) {
            loadConversations();
          }
          return prev;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id, role, membership?.id, searching]);

  useEffect(() => {
    if (!selectedConv) return;
    // Reset unread count when opening conversation
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', selectedConv).then(() => {
      setConversations(prev => prev.map(c => c.id === selectedConv ? { ...c, unread_count: 0 } : c));
    });
  }, [selectedConv]);

  const { getConversationLinked, deleteConversationCascade, loading: cascadeLoading } = useCascadeDelete();
  const [cascadeData, setCascadeData] = useState<ConversationLinked | null>(null);

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConvId(convId);
    const linked = await getConversationLinked(convId);
    setCascadeData(linked);
  };

  const unreadLoaded = conversations.reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0);
  const unansweredLoaded = conversations.reduce((n, c) => n + ((c as any).is_unanswered ? 1 : 0), 0);
  const filtered = conversations.filter(c => {
    if (filterMode === 'unanswered' && (c as any).is_unanswered !== true) return false;
    if (filterMode === 'unread' && c.unread_count <= 0) return false;
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
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={() => changeFilterMode('all')}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
                filterMode === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
              )}>Todas</button>
            <button
              onClick={() => changeFilterMode('unread')}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border inline-flex items-center gap-1",
                filterMode === 'unread' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
              )}>
              Não lidas
              {unreadLoaded > 0 && (
                <span className={cn(
                  "px-1.5 rounded-full text-[10px] font-bold",
                  filterMode === 'unread' ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'
                )}>{unreadLoaded}</span>
              )}
            </button>
            <button
              onClick={() => changeFilterMode('unanswered')}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border inline-flex items-center gap-1",
                filterMode === 'unanswered' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
              )}>
              Sem resposta
              {unansweredLoaded > 0 && (
                <span className={cn(
                  "px-1.5 rounded-full text-[10px] font-bold",
                  filterMode === 'unanswered' ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'
                )}>{unansweredLoaded}</span>
              )}
            </button>
          </div>
          {showInstanceUI && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <button
                onClick={() => changeInstanceFilter(null)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
                  selectedInstanceId === null ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
                )}>Todos os canais</button>
              {instances.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => changeInstanceFilter(inst.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
                    selectedInstanceId === inst.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
                  )}>{instanceLabel(inst)}</button>
              ))}
            </div>
          )}
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
                    {(conv.last_customer_message_at || conv.last_message_at) && (
                      <span className="text-[10px] text-muted-foreground" title={conv.last_customer_message_at ? 'Última msg do contato' : 'Última atividade'}>
                        {conv.last_customer_message_at ? '↩ ' : ''}{formatDistanceToNow(new Date(conv.last_customer_message_at || conv.last_message_at!), { locale: ptBR, addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] rounded-full ${statusColors[conv.status] ?? ''}`}>{conversationStatusLabels[conv.status] ?? conv.status}</Badge>
                    {(conv.metadata as any)?.ai_activated === true && (
                      <Badge variant="outline" className="text-[10px] rounded-full bg-violet-500/10 text-violet-600 border-violet-500/20 gap-0.5">
                        <Bot className="h-2.5 w-2.5" />IA
                      </Badge>
                    )}
                    {showInstanceUI && (() => {
                      const inst = conv.whatsapp_instance_id ? instancesById[conv.whatsapp_instance_id] : null;
                      if (!inst) {
                        return <Badge variant="outline" className="text-[10px] rounded-full bg-muted text-muted-foreground border-border">Sem canal</Badge>;
                      }
                      return inst.provider === 'meta_cloud'
                        ? <Badge variant="outline" className="text-[10px] rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Oficial</Badge>
                        : <Badge variant="outline" className="text-[10px] rounded-full bg-orange-500/10 text-orange-600 border-orange-500/20">UAZAPI</Badge>;
                    })()}
                  </div>

                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Nenhuma conversa</p>}
          {!searching && totalCount !== null && loadedCount < totalCount && (
            <div className="p-3 text-center">
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : `Carregar mais (${loadedCount}/${totalCount})`}
              </Button>
            </div>
          )}
          {!searching && totalCount !== null && loadedCount >= totalCount && totalCount > PAGE_SIZE && (
            <p className="text-center text-[10px] text-muted-foreground py-2">{totalCount} conversas</p>
          )}
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
                aiActivated={(selectedData?.metadata as any)?.ai_activated === true}
                instanceText={showInstanceUI ? instanceLabel(selectedData?.whatsapp_instance_id ? instancesById[selectedData.whatsapp_instance_id] : null) : null}

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

      <CascadeDeleteDialog
        open={!!deleteConvId}
        onOpenChange={(open) => { if (!open) { setDeleteConvId(null); setCascadeData(null); } }}
        title="Excluir conversa"
        description="Esta conversa e todas as suas mensagens serão excluídas permanentemente."
        linkedEntities={cascadeData ? [
          { type: "activities", label: "Atividades desta conversa", count: cascadeData.activities, icon: <CheckSquare className="h-4 w-4" />, checked: true },
          { type: "opportunities", label: "Oportunidades do contato", count: cascadeData.opportunities, icon: <Target className="h-4 w-4" />, checked: false },
          { type: "conversations", label: `Outras conversas de ${cascadeData.contactName || "este contato"}`, count: cascadeData.conversations, icon: <MessageSquare className="h-4 w-4" />, checked: false },
          { type: "contact", label: `Contato: ${cascadeData.contactName || "Desconhecido"}`, count: cascadeData.contactId ? 1 : 0, icon: <User className="h-4 w-4" />, checked: false },
        ] : []}
        onConfirm={async (toDelete) => {
          if (!deleteConvId) return;
          const convId = deleteConvId;
          const contactId = cascadeData?.contactId || null;
          const success = await deleteConversationCascade(convId, contactId, toDelete);
          if (success) {
            if (selectedConv === convId) setSelectedConv(null);
            if (toDelete.includes("contact") && contactId) {
              setConversations(prev => prev.filter(c => c.contact_id !== contactId));
            } else if (toDelete.includes("conversations") && contactId) {
              setConversations(prev => prev.filter(c => c.contact_id !== contactId));
            } else {
              setConversations(prev => prev.filter(c => c.id !== convId));
            }
          }
          setDeleteConvId(null);
          setCascadeData(null);
        }}
        isLoading={cascadeLoading}
      />
    </div>
  );
}
