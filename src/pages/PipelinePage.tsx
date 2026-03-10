import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Pipeline, Stage, Opportunity, Contact, Conversation, Activity, TenantMembership, Profile } from '@/types/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, User, DollarSign, Clock, GripVertical, MessageCircle, AlertTriangle, CalendarClock, Cake, Filter, X, Flame, Trash2, Kanban } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import OpportunityDetail from '@/components/crm/OpportunityDetail';
import CreateOpportunityDialog from '@/components/crm/CreateOpportunityDialog';
import ChatPanel from '@/components/inbox/ChatPanel';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

// Card status type based on scheduled activities
type CardAlertStatus = 'overdue' | 'soon' | 'scheduled' | 'inactive' | 'normal';

interface CustomFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  options?: string[];
}

interface Filters {
  assignee: string; // 'all' | membership_id
  priority: string; // 'all' | priority value
  tag: string;      // '' | tag name
  valueMin: string;
  valueMax: string;
}

const emptyFilters: Filters = { assignee: 'all', priority: 'all', tag: '', valueMin: '', valueMax: '' };

// ─── Engagement Score ───
function calcEngagementScore(opp: Opportunity & { contact?: Contact }, msgCounts: Record<string, number>): number {
  let score = 0;
  const contactId = opp.contact_id;
  const msgs = contactId ? (msgCounts[contactId] || 0) : 0;

  // Message volume (max 30 pts)
  score += Math.min(msgs * 3, 30);

  // Recency (max 30 pts) — how recently updated
  const daysSinceUpdate = differenceInDays(new Date(), new Date(opp.updated_at));
  if (daysSinceUpdate <= 1) score += 30;
  else if (daysSinceUpdate <= 3) score += 20;
  else if (daysSinceUpdate <= 7) score += 10;
  else if (daysSinceUpdate <= 14) score += 5;

  // Value (max 20 pts)
  const val = Number(opp.value || 0);
  if (val >= 10000) score += 20;
  else if (val >= 5000) score += 15;
  else if (val >= 1000) score += 10;
  else if (val > 0) score += 5;

  // Priority (max 20 pts)
  const pMap: Record<string, number> = { urgent: 20, high: 15, medium: 10, low: 5 };
  score += pMap[opp.priority] || 0;

  return Math.min(score, 100);
}

function EngagementBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-success' : score >= 40 ? 'text-warning' : 'text-muted-foreground';
  return (
    <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${color}`} title={`Temperatura: ${score}/100`}>
      <Flame className="h-3 w-3" />
      {score}
    </div>
  );
}

// ─── Droppable Column ───
function DroppableColumn({ stage, children, count, total, onAdd }: {
  stage: Stage; children: React.ReactNode; count: number; total: number;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-2xl bg-card/60 backdrop-blur-sm border border-border/50 transition-all duration-200"
      style={{ boxShadow: isOver ? `0 0 0 2px ${stage.color}, 0 4px 20px ${stage.color}30` : undefined }}>
      <div className="flex items-center justify-between p-3.5 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-foreground">{stage.name}</span>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 rounded-full bg-muted">{count}</Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" onClick={onAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {total > 0 && (
        <div className="px-3.5 py-2 text-xs font-medium text-muted-foreground">
          R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
      )}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2 min-h-[100px]">
        {children}
      </div>
    </div>
  );
}

// ─── Sortable Opp Card ───
function SortableOppCard({ opp, onClick, onWhatsApp, onDelete, alertStatus, unreadCount, customFieldDefs, engagementScore, canDelete }: {
  opp: Opportunity & { contact?: Contact };
  onClick: () => void;
  onWhatsApp: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  alertStatus: CardAlertStatus;
  unreadCount: number;
  customFieldDefs: CustomFieldDef[];
  engagementScore: number;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: opp.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const borderClass =
    alertStatus === 'overdue' ? 'border-destructive/60 ring-1 ring-destructive/30' :
    alertStatus === 'soon' ? 'border-warning/60 ring-1 ring-warning/30' :
    alertStatus === 'inactive' ? 'border-destructive/60 ring-1 ring-destructive/30' :
    'border-border/50';

  return (
    <Card ref={setNodeRef} style={style}
      className={`cursor-pointer p-3.5 hover-lift border bg-card rounded-xl group ${borderClass}`}
      onClick={onClick}>
      <div className="space-y-2.5">
        <div className="flex items-start gap-2">
          <div {...attributes} {...listeners} className="mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium leading-tight flex-1 text-foreground">{opp.title}</p>
          {alertStatus === 'inactive' && (
            <div className="shrink-0" title="Oportunidade inativa — necessita follow-up">
              <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
            </div>
          )}
          {alertStatus === 'overdue' && (
            <div className="shrink-0" title="Atividade vencida">
              <CalendarClock className="h-4 w-4 text-destructive animate-pulse" />
            </div>
          )}
          {alertStatus === 'soon' && (
            <div className="shrink-0" title="Atividade próxima (< 2h)">
              <CalendarClock className="h-4 w-4 text-warning animate-pulse" />
            </div>
          )}
          {opp.contact?.phone && (
            <div className="relative shrink-0">
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={onWhatsApp} title="Conversar no WhatsApp">
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
              </Button>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1 animate-pulse">
                  {unreadCount}
                </span>
              )}
            </div>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={onDelete} title="Excluir oportunidade">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
        {opp.contact && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
            <User className="h-3 w-3" />
            <span className="truncate">{opp.contact.name}</span>
          </div>
        )}
        {opp.contact?.birth_date && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
            <Cake className="h-3 w-3" />
            <span>{format(new Date(opp.contact.birth_date + 'T00:00:00'), 'dd/MM/yyyy')}</span>
          </div>
        )}
        <div className="flex items-center justify-between pl-5">
          {Number(opp.value ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-success">
              <DollarSign className="h-3 w-3" />
              R$ {Number(opp.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          )}
          <EngagementBadge score={engagementScore} />
          <div className={`flex items-center gap-1 text-[10px] ml-auto ${alertStatus === 'inactive' ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(opp.updated_at), { locale: ptBR, addSuffix: true })}
          </div>
        </div>
        {opp.contact?.tags && opp.contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-5">
            {opp.contact.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 rounded-full">{tag}</Badge>
            ))}
          </div>
        )}
        {/* Custom fields */}
        {customFieldDefs.length > 0 && (opp as any).custom_fields && Object.keys((opp as any).custom_fields).length > 0 && (
          <div className="flex flex-wrap gap-1 pl-5">
            {customFieldDefs.slice(0, 3).map(fd => {
              const val = (opp as any).custom_fields?.[fd.key];
              if (val === undefined || val === null || val === '') return null;
              const display = fd.type === 'boolean' ? (val ? '✓' : '✗') : fd.type === 'date' ? String(val).substring(0, 10) : String(val);
              return (
                <Badge key={fd.key} variant="secondary" className="text-[10px] px-1.5 py-0 rounded-full">
                  {fd.label}: {display}
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Filter Bar ───
function FilterBar({ filters, onChange, members, allTags }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  members: (TenantMembership & { profile?: Profile })[];
  allTags: string[];
}) {
  const hasFilters = filters.assignee !== 'all' || filters.priority !== 'all' || filters.tag !== '' || filters.valueMin !== '' || filters.valueMax !== '';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-xl gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filtros
          {hasFilters && <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px] rounded-full">{[filters.assignee !== 'all', filters.priority !== 'all', filters.tag !== '', filters.valueMin !== '', filters.valueMax !== ''].filter(Boolean).length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Filtros</span>
          {hasFilters && <Button variant="ghost" size="sm" className="h-6 text-xs rounded-lg" onClick={() => onChange(emptyFilters)}><X className="h-3 w-3 mr-1" />Limpar</Button>}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Atendente</label>
          <Select value={filters.assignee} onValueChange={v => onChange({ ...filters, assignee: v })}>
            <SelectTrigger className="rounded-xl h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="unassigned">Sem atendente</SelectItem>
              {members.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.profile?.full_name || m.user_id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Prioridade</label>
          <Select value={filters.priority} onValueChange={v => onChange({ ...filters, priority: v })}>
            <SelectTrigger className="rounded-xl h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="low">Baixa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Tag</label>
          <Select value={filters.tag || '__none__'} onValueChange={v => onChange({ ...filters, tag: v === '__none__' ? '' : v })}>
            <SelectTrigger className="rounded-xl h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Todas</SelectItem>
              {allTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Valor (R$)</label>
          <div className="flex gap-2">
            <Input type="number" placeholder="Mín" value={filters.valueMin} onChange={e => onChange({ ...filters, valueMin: e.target.value })} className="rounded-xl h-8 text-xs" />
            <Input type="number" placeholder="Máx" value={filters.valueMax} onChange={e => onChange({ ...filters, valueMax: e.target.value })} className="rounded-xl h-8 text-xs" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Component ───
export default function PipelinePage() {
  const { tenant, role } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [opportunities, setOpportunities] = useState<(Opportunity & { contact?: Contact })[]>([]);
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStageId, setCreateStageId] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatOpp, setChatOpp] = useState<(Opportunity & { contact?: Contact }) | null>(null);
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [chatConvStatus, setChatConvStatus] = useState<string>('open');
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({});
  const [activitiesByOpp, setActivitiesByOpp] = useState<Record<string, Activity[]>>({});
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [members, setMembers] = useState<(TenantMembership & { profile?: Profile })[]>([]);
  const [msgCountsByContact, setMsgCountsByContact] = useState<Record<string, number>>({});
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [deleteOppId, setDeleteOppId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Tick every 60s to refresh inactivity/due calculations
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Collect all unique tags for filter
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const o of opportunities) {
      if (o.contact?.tags) o.contact.tags.forEach(t => set.add(t));
    }
    return [...set].sort();
  }, [opportunities]);

  // Apply filters
  const filteredOpportunities = useMemo(() => {
    return opportunities.filter(o => {
      if (filters.assignee === 'unassigned' && o.assigned_to) return false;
      if (filters.assignee !== 'all' && filters.assignee !== 'unassigned' && o.assigned_to !== filters.assignee) return false;
      if (filters.priority !== 'all' && o.priority !== filters.priority) return false;
      if (filters.tag && (!o.contact?.tags || !o.contact.tags.includes(filters.tag))) return false;
      if (filters.valueMin && Number(o.value || 0) < Number(filters.valueMin)) return false;
      if (filters.valueMax && Number(o.value || 0) > Number(filters.valueMax)) return false;
      return true;
    });
  }, [opportunities, filters]);

  const resetUnreadForContact = useCallback(async (contactId: string | null) => {
    if (!tenant || !contactId) return;
    const { data: convs } = await supabase.from('conversations')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('contact_id', contactId)
      .gt('unread_count', 0);
    if (convs && convs.length > 0) {
      for (const c of convs) {
        await supabase.from('conversations').update({ unread_count: 0 }).eq('id', c.id);
      }
    }
    setUnreadByContact(prev => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
  }, [tenant]);

  const openChat = async (opp: Opportunity & { contact?: Contact }) => {
    if (!tenant || !opp.contact_id) return;
    const { data: convs } = await supabase.from('conversations')
      .select('id, status, channel')
      .eq('tenant_id', tenant.id)
      .eq('contact_id', opp.contact_id)
      .in('status', ['open', 'waiting_customer', 'waiting_agent'])
      .order('last_message_at', { ascending: false })
      .limit(1);

    if (convs && convs.length > 0) {
      setChatConvId(convs[0].id);
      setChatConvStatus(convs[0].status);
      setChatOpp(opp);
      resetUnreadForContact(opp.contact_id);
    } else {
      const { data: newConv, error } = await supabase.from('conversations').insert({
        tenant_id: tenant.id,
        contact_id: opp.contact_id,
        opportunity_id: opp.id,
        channel: 'whatsapp',
        status: 'open',
      }).select('id, status').single();

      if (error) { toast.error('Erro ao criar conversa: ' + error.message); return; }
      if (newConv) {
        setChatConvId(newConv.id);
        setChatConvStatus(newConv.status);
        setChatOpp(opp);
      }
    }
  };

  useEffect(() => {
    if (!tenant) return;
    supabase.from('tenants').select('settings').eq('id', tenant.id).single()
      .then(({ data }) => {
        if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
          setCustomFieldDefs((data.settings as Record<string, any>).custom_opportunity_fields || []);
        }
      });
    supabase.from('pipelines').select('*').eq('tenant_id', tenant.id).order('position')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const p = data as unknown as Pipeline[];
          setPipelines(p);
          const def = p.find(x => x.is_default) ?? p[0];
          setSelectedPipeline(def.id);
        }
      });
    // Load members for filter
    supabase.from('tenant_memberships').select('*, profile:profiles(*)').eq('tenant_id', tenant.id).eq('is_active', true)
      .then(({ data }) => {
        setMembers((data as unknown as (TenantMembership & { profile?: Profile })[]) ?? []);
      });
  }, [tenant]);

  const loadOpps = useCallback(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('opportunities').select('*, contact:contacts(*)').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setOpportunities((data as unknown as (Opportunity & { contact?: Contact })[]) ?? []));
  }, [selectedPipeline, tenant]);

  // Load message counts per contact for engagement score
  const loadMsgCounts = useCallback(() => {
    if (!tenant) return;
    supabase.from('conversations')
      .select('contact_id')
      .eq('tenant_id', tenant.id)
      .not('contact_id', 'is', null)
      .then(async ({ data: convs }) => {
        if (!convs || convs.length === 0) return;
        // Get unique contact_ids that have opportunities
        const contactIds = [...new Set(convs.map(c => c.contact_id).filter(Boolean) as string[])];
        // Count messages per conversation, then aggregate per contact
        const counts: Record<string, number> = {};
        // Use a simpler approach: count recent messages (last 30 days) grouped by contact
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: msgs } = await supabase.from('messages')
          .select('conversation_id')
          .eq('tenant_id', tenant.id)
          .gte('created_at', thirtyDaysAgo);
        
        if (msgs) {
          // Map conversation to contact
          const convToContact: Record<string, string> = {};
          for (const c of convs) {
            if (c.contact_id) convToContact[c.contact_id] = c.contact_id;
          }
          // We need conv_id -> contact_id mapping
          const { data: convData } = await supabase.from('conversations')
            .select('id, contact_id')
            .eq('tenant_id', tenant.id)
            .not('contact_id', 'is', null);
          const convMap: Record<string, string> = {};
          for (const c of (convData ?? [])) {
            if (c.contact_id) convMap[c.id] = c.contact_id;
          }
          for (const m of msgs) {
            const cid = convMap[m.conversation_id];
            if (cid) counts[cid] = (counts[cid] || 0) + 1;
          }
        }
        setMsgCountsByContact(counts);
      });
  }, [tenant]);

  // Load pending activities for all opportunities in the pipeline
  const loadActivities = useCallback(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('activities')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('is_completed', false)
      .not('due_date', 'is', null)
      .not('opportunity_id', 'is', null)
      .in('type', ['task', 'call', 'meeting', 'email', 'follow_up'])
      .then(({ data }) => {
        const map: Record<string, Activity[]> = {};
        for (const a of (data ?? []) as unknown as Activity[]) {
          if (a.opportunity_id) {
            if (!map[a.opportunity_id]) map[a.opportunity_id] = [];
            map[a.opportunity_id].push(a);
          }
        }
        setActivitiesByOpp(map);
      });
  }, [selectedPipeline, tenant]);

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('stages').select('*').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setStages((data as unknown as Stage[]) ?? []));
    loadOpps();
    loadActivities();
    loadMsgCounts();
  }, [selectedPipeline, tenant, loadOpps, loadActivities, loadMsgCounts]);

  // Load unread counts per contact
  const loadUnreads = useCallback(() => {
    if (!tenant) return;
    supabase.from('conversations')
      .select('contact_id, unread_count')
      .eq('tenant_id', tenant.id)
      .gt('unread_count', 0)
      .in('status', ['open', 'waiting_customer', 'waiting_agent'])
      .then(({ data }) => {
        const map: Record<string, number> = {};
        for (const c of (data ?? []) as { contact_id: string | null; unread_count: number | null }[]) {
          if (c.contact_id && c.unread_count) map[c.contact_id] = (map[c.contact_id] || 0) + c.unread_count;
        }
        setUnreadByContact(map);
      });
  }, [tenant]);

  useEffect(() => { loadUnreads(); }, [loadUnreads]);

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    const channel = supabase
      .channel('pipeline-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities', filter: `pipeline_id=eq.${selectedPipeline}` }, () => loadOpps())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => loadUnreads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `tenant_id=eq.${tenant.id}` }, () => loadActivities())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedPipeline, tenant, loadOpps, loadUnreads, loadActivities]);

  const moveOpportunity = async (oppId: string, newStageId: string) => {
    const opp = opportunities.find(o => o.id === oppId);
    if (!opp || !tenant) return;
    const fromStageId = opp.stage_id;
    const stage = stages.find(s => s.id === newStageId);
    const newStatus = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage_id: newStageId, status: newStatus as any } : o));
    await supabase.from('opportunities').update({ stage_id: newStageId, status: newStatus }).eq('id', oppId);

    await supabase.rpc('enqueue_job', {
      _type: 'run_automations',
      _payload: JSON.stringify({
        tenant_id: tenant.id,
        trigger_type: 'opportunity_stage_changed',
        context: {
          opportunity_id: oppId,
          contact_id: opp.contact_id,
          from_stage_id: fromStageId,
          to_stage_id: newStageId,
        },
      }),
      _tenant_id: tenant.id,
    });
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const overId = over.id as string;
    const activeOpp = opportunities.find(o => o.id === active.id);
    if (!activeOpp) return;

    if (overId.startsWith('stage-')) {
      const stageId = overId.replace('stage-', '');
      if (stageId !== activeOpp.stage_id) {
        moveOpportunity(activeOpp.id, stageId);
      }
    } else {
      const overOpp = opportunities.find(o => o.id === overId);
      if (overOpp && overOpp.stage_id !== activeOpp.stage_id) {
        moveOpportunity(activeOpp.id, overOpp.stage_id);
      }
    }
  };

  const handleDeleteOpportunity = async (oppId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (role !== 'admin' && role !== 'manager') {
      toast.error('Apenas admins e gerentes podem excluir oportunidades');
      return;
    }
    setDeleteOppId(oppId);
  };

  const confirmDeleteOpportunity = async () => {
    if (!deleteOppId) return;
    const oppId = deleteOppId;
    setDeleteOppId(null);

    // Clear FK references first (conversations, activities, stage_moves)
    await Promise.all([
      supabase.from('conversations').update({ opportunity_id: null }).eq('opportunity_id', oppId),
      supabase.from('activities').update({ opportunity_id: null }).eq('opportunity_id', oppId),
      supabase.from('stage_moves').delete().eq('opportunity_id', oppId),
    ]);

    const { error } = await supabase.from('opportunities').delete().eq('id', oppId);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      loadOpps();
      return;
    }

    const { data: remaining, error: checkError } = await supabase
      .from('opportunities')
      .select('id')
      .eq('id', oppId)
      .maybeSingle();

    if (checkError) {
      toast.error(`Erro ao validar exclusão: ${checkError.message}`);
      loadOpps();
      return;
    }

    if (remaining) {
      toast.error('Sem permissão para excluir esta oportunidade');
      loadOpps();
      return;
    }

    setOpportunities(prev => prev.filter(o => o.id !== oppId));
    toast.success('Oportunidade excluída');
  };

  const oppsByStage = (stageId: string) => filteredOpportunities.filter(o => o.stage_id === stageId);
  const stageTotal = (stageId: string) => oppsByStage(stageId).reduce((s, o) => s + Number(o.value || 0), 0);

  // Determine the alert status for each card
  const getOppAlertStatus = (opp: Opportunity): CardAlertStatus => {
    if (opp.status !== 'open') return 'normal';

    const pendingActivities = activitiesByOpp[opp.id];
    if (pendingActivities && pendingActivities.length > 0) {
      const now = Date.now();
      let hasOverdue = false;
      let hasSoon = false;
      for (const a of pendingActivities) {
        if (!a.due_date) continue;
        const due = new Date(a.due_date).getTime();
        if (now >= due) hasOverdue = true;
        else if (due - now <= 2 * 60 * 60 * 1000) hasSoon = true;
      }
      if (hasOverdue) return 'overdue';
      if (hasSoon) return 'soon';
      return 'scheduled';
    }

    const stage = stages.find(s => s.id === opp.stage_id);
    if (!stage || !stage.inactivity_minutes || stage.inactivity_minutes <= 0) return 'normal';
    const threshold = Date.now() - stage.inactivity_minutes * 60 * 1000;
    if (new Date(opp.updated_at).getTime() < threshold) return 'inactive';

    return 'normal';
  };

  const createDefaultPipeline = async () => {
    if (!tenant) return;
    setCreatingPipeline(true);
    try {
      const { data: newPipeline, error: pError } = await supabase
        .from('pipelines')
        .insert({ tenant_id: tenant.id, name: 'Pipeline Principal', is_default: true, position: 0 })
        .select()
        .single();
      if (pError || !newPipeline) { toast.error('Erro ao criar pipeline: ' + (pError?.message || '')); return; }

      const defaultStages = [
        { name: 'Novo Lead', color: '#6366f1', position: 0 },
        { name: 'Qualificação', color: '#f59e0b', position: 1 },
        { name: 'Proposta', color: '#3b82f6', position: 2 },
        { name: 'Negociação', color: '#8b5cf6', position: 3 },
        { name: 'Ganho', color: '#22c55e', position: 4, is_won: true },
        { name: 'Perdido', color: '#ef4444', position: 5, is_lost: true },
      ];
      const { error: sError } = await supabase.from('stages').insert(
        defaultStages.map(s => ({ ...s, tenant_id: tenant.id, pipeline_id: newPipeline.id }))
      );
      if (sError) { toast.error('Erro ao criar etapas: ' + sError.message); return; }

      const p = newPipeline as unknown as Pipeline;
      setPipelines([p]);
      setSelectedPipeline(p.id);
      toast.success('Pipeline criado com sucesso!');
    } catch (e) {
      toast.error('Erro inesperado ao criar pipeline');
    } finally {
      setCreatingPipeline(false);
    }
  };

  const activeOpp = activeId ? opportunities.find(o => o.id === activeId) : null;

  const hasActiveFilters = filters.assignee !== 'all' || filters.priority !== 'all' || filters.tag !== '' || filters.valueMin !== '' || filters.valueMax !== '';

  // Empty state: no pipeline exists
  if (pipelines.length === 0 && !selectedPipeline) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background gap-4 p-8">
        <Kanban className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-bold text-foreground">Nenhum pipeline encontrado</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Esta empresa ainda não possui um pipeline configurado. Crie o pipeline padrão para começar a gerenciar suas oportunidades.
        </p>
        {(role === 'admin' || role === 'manager') ? (
          <Button onClick={createDefaultPipeline} disabled={creatingPipeline} className="rounded-xl gap-2">
            {creatingPipeline ? <Clock className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Criar Pipeline Padrão
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Contate o administrador para criar o pipeline.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-foreground">Pipeline</h1>
          {pipelines.length > 1 && (
            <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
              <SelectTrigger className="w-[200px] rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <FilterBar filters={filters} onChange={setFilters} members={members} allTags={allTags} />
        </div>
        <div className="text-sm text-muted-foreground">
          {hasActiveFilters && <span className="text-primary font-medium mr-2">{filteredOpportunities.length} de {opportunities.length}</span>}
          {!hasActiveFilters && <>{opportunities.length} oportunidade{opportunities.length !== 1 ? 's' : ''} · </>}
          R$ {filteredOpportunities.reduce((s, o) => s + (o.value || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
      </header>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto p-4 pt-0">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full min-w-max">
            {stages.map(stage => (
              <DroppableColumn key={stage.id} stage={stage} count={oppsByStage(stage.id).length}
                total={stageTotal(stage.id)} onAdd={() => { setCreateStageId(stage.id); setShowCreate(true); }}>
                <SortableContext items={oppsByStage(stage.id).map(o => o.id)} strategy={verticalListSortingStrategy}>
                  {oppsByStage(stage.id).map(opp => (
                    <SortableOppCard key={opp.id} opp={opp} onClick={() => { setSelectedOpp(opp.id); resetUnreadForContact(opp.contact_id); }}
                      onWhatsApp={(e) => { e.stopPropagation(); openChat(opp); }}
                      onDelete={(e) => handleDeleteOpportunity(opp.id, e)}
                      alertStatus={getOppAlertStatus(opp)}
                      unreadCount={opp.contact_id ? (unreadByContact[opp.contact_id] || 0) : 0}
                      customFieldDefs={customFieldDefs}
                      engagementScore={calcEngagementScore(opp, msgCountsByContact)} />
                  ))}
                </SortableContext>
              </DroppableColumn>
            ))}
          </div>
          <DragOverlay>
            {activeOpp && (
              <Card className="p-3.5 border border-primary/30 bg-card rounded-xl shadow-xl w-72 rotate-2">
                <p className="text-sm font-medium">{activeOpp.title}</p>
                {activeOpp.contact && <p className="text-xs text-muted-foreground mt-1">{activeOpp.contact.name}</p>}
              </Card>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Detail Drawer */}
      <Sheet open={!!selectedOpp} onOpenChange={() => setSelectedOpp(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>Detalhes da Oportunidade</SheetTitle></SheetHeader>
          {selectedOpp && (
            <OpportunityDetail opportunityId={selectedOpp} stages={stages} onMoveStage={moveOpportunity}
              onClose={() => setSelectedOpp(null)} onActivityChange={loadActivities} />
          )}
        </SheetContent>
      </Sheet>

      <CreateOpportunityDialog open={showCreate} onOpenChange={setShowCreate} stageId={createStageId}
        pipelineId={selectedPipeline} onCreated={loadOpps} />

      {/* WhatsApp Chat Dialog */}
      <Dialog open={!!chatOpp} onOpenChange={(open) => { if (!open) {
        if (chatOpp) {
          setOpportunities(prev => prev.map(o => o.id === chatOpp.id ? { ...o, updated_at: new Date().toISOString() } : o));
        }
        setChatOpp(null); setChatConvId(null);
      } }}>
        <DialogContent className="max-w-2xl h-[80vh] p-0 rounded-2xl overflow-hidden flex flex-col">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-base">
              Conversa com {chatOpp?.contact?.name ?? 'Contato'}
            </DialogTitle>
          </DialogHeader>
          {chatConvId && chatOpp && (
            <ChatPanel
              conversationId={chatConvId}
              contact={chatOpp.contact}
              channel="whatsapp"
              status={chatConvStatus}
              showHeader={false}
              className="flex-1 min-h-0"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteOppId} onOpenChange={(open) => { if (!open) setDeleteOppId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir oportunidade</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta oportunidade permanentemente? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteOpportunity} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
