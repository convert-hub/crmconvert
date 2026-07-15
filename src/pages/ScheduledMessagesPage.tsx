import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ScheduledMessage } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Clock, Pencil, Ban, FileCheck2, MessageSquare, Loader2, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, CalendarClock, Search, ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import EditScheduledMessageDialog from '@/components/scheduled/EditScheduledMessageDialog';

interface ScheduledMessageRow extends ScheduledMessage {
  conversation?: { id: string; contact?: { id: string; name: string | null; phone: string | null } | null } | null;
}

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

const statusBadgeClasses: Record<string, string> = {
  pending: 'text-primary border-primary/30',
  sent: 'text-success border-success/30',
  failed: 'text-destructive border-destructive/30',
  cancelled: 'text-muted-foreground',
};

export default function ScheduledMessagesPage() {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ScheduledMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ScheduledMessageRow | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // membership_id → nome (não há FK memberships→profiles, então o join é feito à mão)
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('*, conversation:conversations(id, contact:contacts(id, name, phone))')
      .eq('tenant_id', tenant.id)
      .order('scheduled_at', { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    const list = (data as unknown as ScheduledMessageRow[]) ?? [];
    setRows(list);
    setLoading(false);

    const memberIds = Array.from(new Set(list.map(r => r.created_by).filter(Boolean))) as string[];
    if (memberIds.length === 0) { setCreatorNames({}); return; }
    const { data: mems } = await supabase.from('tenant_memberships').select('id, user_id').in('id', memberIds);
    const userIds = Array.from(new Set((mems ?? []).map(m => m.user_id)));
    if (userIds.length === 0) { setCreatorNames({}); return; }
    const { data: profs } = await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds);
    const nameByUser: Record<string, string> = {};
    (profs ?? []).forEach(p => { if (p.full_name) nameByUser[p.user_id] = p.full_name; });
    const map: Record<string, string> = {};
    (mems ?? []).forEach(m => { if (nameByUser[m.user_id]) map[m.id] = nameByUser[m.user_id]; });
    setCreatorNames(map);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleCancel = async (msg: ScheduledMessageRow) => {
    const contactName = msg.conversation?.contact?.name ?? 'este contato';
    if (!confirm(`Cancelar o envio agendado para ${contactName} em ${format(new Date(msg.scheduled_at), "dd/MM/yyyy 'às' HH:mm")}?`)) return;
    setCancellingId(msg.id);
    try {
      const { error } = await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', msg.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Agendamento cancelado');
      await load();
    } finally {
      setCancellingId(null);
    }
  };

  const bySearch = (r: ScheduledMessageRow) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const name = r.conversation?.contact?.name?.toLowerCase() ?? '';
    const phone = r.conversation?.contact?.phone ?? '';
    return name.includes(q) || phone.includes(q.replace(/\D/g, '') || q);
  };

  const counts = {
    pending: rows.filter(r => r.status === 'pending').length,
    sent: rows.filter(r => r.status === 'sent').length,
    failed: rows.filter(r => r.status === 'failed').length,
    cancelled: rows.filter(r => r.status === 'cancelled').length,
  };

  const filtered = rows
    .filter(r => r.status === tab)
    .filter(bySearch)
    // Pendentes: próximo envio primeiro; histórico: mais recente primeiro
    .sort((a, b) => tab === 'pending'
      ? new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      : new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

  if (loading) return <div className="p-6"><p className="text-sm text-muted-foreground">Carregando...</p></div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Mensagens Agendadas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {counts.pending > 0 && <span className="text-primary font-medium">{counts.pending} pendente{counts.pending !== 1 ? 's' : ''}</span>}
            {counts.pending > 0 && counts.failed > 0 && ' · '}
            {counts.failed > 0 && <span className="text-destructive font-medium">{counts.failed} falha{counts.failed !== 1 ? 's' : ''}</span>}
            {(counts.pending > 0 || counts.failed > 0) && ' · '}
            {counts.sent} enviada{counts.sent !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-1.5">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Pendentes ({counts.pending})
            </TabsTrigger>
            <TabsTrigger value="sent" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Enviadas ({counts.sent})
            </TabsTrigger>
            <TabsTrigger value="failed" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Falhas ({counts.failed})
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> Canceladas ({counts.cancelled})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por contato..." className="pl-8 h-9 text-sm" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {search.trim() ? 'Nenhum agendamento encontrado para essa busca.' : `Nenhuma mensagem ${statusLabels[tab]?.toLowerCase() ?? ''}.`}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(msg => {
            const contact = msg.conversation?.contact;
            const creatorName = msg.created_by ? creatorNames[msg.created_by] : null;
            return (
              <Card key={msg.id} className={cn(
                "flex items-start gap-3 p-3 border-border/60",
                msg.status === 'failed' && "border-destructive/30",
                msg.status === 'cancelled' && "opacity-60",
              )}>
                {msg.template
                  ? <FileCheck2 className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  : <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />}

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{contact?.name ?? 'Contato desconhecido'}</p>
                    {contact?.phone && <span className="text-xs text-muted-foreground">{contact.phone}</span>}
                    <Badge variant="outline" className="text-[10px]">{msg.template ? 'Template' : 'Texto'}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{msg.content || '—'}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(msg.scheduled_at), 'dd/MM/yyyy HH:mm')}
                    </span>
                    {msg.status === 'sent' && msg.sent_at && (
                      <span>· enviada {format(new Date(msg.sent_at), 'dd/MM HH:mm')}</span>
                    )}
                    {creatorName && <span>· por {creatorName}</span>}
                  </div>
                  {msg.status === 'failed' && msg.error_message && (
                    <p className="text-[11px] text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {msg.error_message}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className={cn('text-[10px]', statusBadgeClasses[msg.status])}>
                    {statusLabels[msg.status] ?? msg.status}
                  </Badge>
                  {msg.status === 'pending' && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title={msg.template ? 'Alterar data/hora' : 'Editar'}
                        onClick={() => setEditing(msg)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Cancelar envio"
                        disabled={cancellingId === msg.id} onClick={() => handleCancel(msg)}>
                        {cancellingId === msg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      </Button>
                    </>
                  )}
                  {msg.status === 'failed' && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" title="Reagendar envio"
                      onClick={() => setEditing(msg)}>
                      <CalendarClock className="h-3.5 w-3.5" /> Reagendar
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Abrir conversa"
                    onClick={() => navigate(`/inbox?conv=${msg.conversation_id}`)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <EditScheduledMessageDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        message={editing}
        onSaved={load}
      />
    </div>
  );
}
