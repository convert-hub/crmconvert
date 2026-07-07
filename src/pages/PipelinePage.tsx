import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Pipeline, Stage, Opportunity, Contact, Activity, TenantMembership, Profile } from '@/types/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, User, DollarSign, Clock, GripVertical, MessageCircle, AlertTriangle, CalendarClock, Cake, Filter, X, Flame, Trash2, Kanban, CheckSquare, MessageSquare, Search } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CascadeDeleteDialog } from '@/components/shared/CascadeDeleteDialog';
import { useCascadeDelete, type OpportunityLinked } from '@/hooks/useCascadeDelete';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import OpportunityDetail from '@/components/crm/OpportunityDetail';
import CreateOpportunityDialog from '@/components/crm/CreateOpportunityDialog';
import ChatPanel from '@/components/inbox/ChatPanel';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  DndContext, closestCorners, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
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
  assignee: string; // 'all' | 'unassigned' | membership_id
  priority: string;
  tag: string;
  valueMin: string;
  valueMax: string;
}

const emptyFilters: Filters = { assignee: 'all', priority: 'all', tag: '', valueMin: '', valueMax: '' };

const PAGE_SIZE = 50;
const SEARCH_LIMIT = 300;
const SELECT_COLS = 'id,tenant_id,title,value,priority,status,stage_id,pipeline_id,assigned_to,contact_id,updated_at,created_at,position,custom_fields,tags, contact:contacts(id,name,phone,tags,birth_date)';

// ─── Engagement Score ───
function calcEngagementScore(opp: Opportunity & { contact?: Contact }, msgCounts: Record<string, number>): number {
  let score = 0;
  const contactId = opp.contact_id;
  const msgs = contactId ? (msgCounts[contactId] || 0) : 0;
  score += Math.min(msgs * 3, 30);
  const daysSinceUpdate = differenceInDays(new Date(), new Date(opp.updated_at));
  if (daysSinceUpdate <= 1) score += 30;
  else if (daysSinceUpdate <= 3) score += 20;
  else if (daysSinceUpdate <= 7) score += 10;
  else if (daysSinceUpdate <= 14) score += 5;
  const val = Number(opp.value || 0);
  if (val >= 10000) score += 20;
  else if (val >= 5000) score += 15;
  else if (val >= 1000) score += 10;
  else if (val > 0) score += 5;
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
function DroppableColumn({ stage, children, count, total, onAdd, matchCount }: {
  stage: Stage; children: React.ReactNode; count: number; total: number;
  onAdd: () => void;
  matchCount?: number | null;
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
          {matchCount != null && (
            <Badge variant="default" className="text-[10px] h-5 px-1.5 rounded-full" title="Resultados na busca">
              {matchCount}
            </Badge>
          )}
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
function SortableOppCard({ opp, onClick, onWhatsApp, onDelete, alertStatus, unreadCount, customFieldDefs, engagementScore, canDelete, lastContactInteractionAt }: {
  opp: Opportunity & { contact?: Contact };
  onClick: () => void;
  onWhatsApp: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  alertStatus: CardAlertStatus;
  unreadCount: number;
  customFieldDefs: CustomFieldDef[];
  engagementScore: number;
  canDelete: boolean;
  lastContactInteractionAt?: string | null;
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
              <Button variant="ghost" size="icon"
                className={`h-6 w-6 rounded-lg transition-opacity ${unreadCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={onWhatsApp} title="Conversar no WhatsApp">
                <MessageCircle className={`h-3.5 w-3.5 ${unreadCount > 0 ? 'text-destructive' : 'text-primary'}`} />
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
          <div className={`flex items-center gap-1 text-[10px] ml-auto ${alertStatus === 'inactive' ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}
            title={lastContactInteractionAt ? `Última msg do contato: ${format(new Date(lastContactInteractionAt), "dd/MM/yyyy HH:mm")}` : `Atualizado: ${format(new Date(opp.updated_at), "dd/MM/yyyy HH:mm")}`}>
            <Clock className="h-3 w-3" />
            {lastContactInteractionAt
              ? formatDistanceToNow(new Date(lastContactInteractionAt), { locale: ptBR, addSuffix: true })
              : formatDistanceToNow(new Date(opp.updated_at), { locale: ptBR, addSuffix: true })}
          </div>
        </div>
        {opp.tags && opp.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-5">
            {opp.tags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 rounded-full">{tag}</Badge>
            ))}
          </div>
        )}
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

type Opp = Opportunity & { contact?: Contact };

// ─── Main Component ───
export default function PipelinePage() {
  const { tenant, role } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [stages, setStages] = useState<Stage[]>([]);

  // Paginated data per stage (navigation mode)
  const [oppsByStageState, setOppsByStageState] = useState<Record<string, Opp[]>>({});
  const [pageByStage, setPageByStage] = useState<Record<string, number>>({});
  const [loadingByStage, setLoadingByStage] = useState<Record<string, boolean>>({});

  // Real aggregates from RPC (source of truth for column headers + global totals)
  const [aggregatesByStage, setAggregatesByStage] = useState<Record<string, { count: number; total: number }>>({});

  // Search results (search mode)
  const [searchResults, setSearchResults] = useState<Opp[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStageId, setCreateStageId] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatOpp, setChatOpp] = useState<Opp | null>(null);
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [chatConvStatus, setChatConvStatus] = useState<string>('open');
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({});
  const [activitiesByOpp, setActivitiesByOpp] = useState<Record<string, Activity[]>>({});
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [members, setMembers] = useState<(TenantMembership & { profile?: Profile })[]>([]);
  const [msgCountsByContact, setMsgCountsByContact] = useState<Record<string, number>>({});
  const [lastContactInteractionByContact, setLastContactInteractionByContact] = useState<Record<string, string>>({});
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [deleteOppId, setDeleteOppId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Tick every 60s to refresh inactivity/due calculations
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const hasActiveFilters = filters.assignee !== 'all' || filters.priority !== 'all' || filters.tag !== '' || filters.valueMin !== '' || filters.valueMax !== '';
  const isSearchMode = search.trim().length > 0 || hasActiveFilters;

  // Flat view — used for engagement/activities/drag lookups
  const allLoadedOpps = useMemo<Opp[]>(() => {
    if (isSearchMode) return searchResults;
    return Object.values(oppsByStageState).flat();
  }, [isSearchMode, searchResults, oppsByStageState]);

  // Group search results by stage
  const searchByStage = useMemo(() => {
    const map: Record<string, Opp[]> = {};
    for (const o of searchResults) {
      (map[o.stage_id] ||= []).push(o);
    }
    return map;
  }, [searchResults]);

  const oppsByStage = useCallback((stageId: string): Opp[] => {
    const src = isSearchMode ? (searchByStage[stageId] || []) : (oppsByStageState[stageId] || []);
    return [...src].sort((a, b) => {
      const posA = Number.isFinite(Number(a.position)) ? Number(a.position) : Number.MAX_SAFE_INTEGER;
      const posB = Number.isFinite(Number(b.position)) ? Number(b.position) : Number.MAX_SAFE_INTEGER;
      if (posA !== posB) return posA - posB;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [isSearchMode, searchByStage, oppsByStageState]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const o of allLoadedOpps) {
      if (o.contact?.tags) o.contact.tags.forEach(t => set.add(t));
      if (o.tags) o.tags.forEach(t => set.add(t));
    }
    return [...set].sort();
  }, [allLoadedOpps]);

  // Build RPC filter args
  const filterArgs = useMemo(() => ({
    _assignee: filters.assignee !== 'all' && filters.assignee !== 'unassigned' ? filters.assignee : null,
    _unassigned: filters.assignee === 'unassigned',
    _priority: filters.priority !== 'all' ? filters.priority : null,
    _tag: filters.tag || null,
    _value_min: filters.valueMin ? Number(filters.valueMin) : null,
    _value_max: filters.valueMax ? Number(filters.valueMax) : null,
  }), [filters]);

  // Global totals from aggregates
  const globalAggregate = useMemo(() => {
    let count = 0, total = 0;
    for (const a of Object.values(aggregatesByStage)) { count += a.count; total += a.total; }
    return { count, total };
  }, [aggregatesByStage]);

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

  const openChat = async (opp: Opp) => {
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
    supabase.from('tenant_memberships').select('*, profile:profiles(*)').eq('tenant_id', tenant.id).eq('is_active', true)
      .then(({ data }) => {
        setMembers((data as unknown as (TenantMembership & { profile?: Profile })[]) ?? []);
      });
  }, [tenant]);

  // Update last-customer-interaction map from loaded contacts (best-effort, scoped to visible cards)
  const refreshLastInteraction = useCallback(async (opps: Opp[]) => {
    if (!tenant || opps.length === 0) return;
    const contactIds = [...new Set(opps.map(o => o.contact_id).filter(Boolean) as string[])];
    if (contactIds.length === 0) return;
    const { data: convs } = await supabase.from('conversations')
      .select('contact_id, last_customer_message_at')
      .eq('tenant_id', tenant.id)
      .in('contact_id', contactIds)
      .not('last_customer_message_at', 'is', null);
    const map: Record<string, string> = {};
    for (const c of (convs ?? []) as { contact_id: string; last_customer_message_at: string }[]) {
      if (!c.contact_id || !c.last_customer_message_at) continue;
      const prev = map[c.contact_id];
      if (!prev || new Date(c.last_customer_message_at) > new Date(prev)) {
        map[c.contact_id] = c.last_customer_message_at;
      }
    }
    setLastContactInteractionByContact(prev => ({ ...prev, ...map }));
  }, [tenant]);

  const loadStageAggregates = useCallback(async () => {
    if (!selectedPipeline) return;
    const { data, error } = await supabase.rpc('pipeline_stage_aggregates' as any, {
      _pipeline_id: selectedPipeline,
      ...filterArgs,
    });
    if (error) { console.error('[pipeline_stage_aggregates]', error); return; }
    const map: Record<string, { count: number; total: number }> = {};
    for (const r of ((data as any[]) || [])) {
      map[r.stage_id] = { count: Number(r.cnt || 0), total: Number(r.total || 0) };
    }
    setAggregatesByStage(map);
  }, [selectedPipeline, filterArgs]);

  const mergeStageRows = (existing: Opp[], rows: Opp[]): Opp[] => {
    const byId: Record<string, Opp> = {};
    for (const o of existing) byId[o.id] = o;
    for (const o of rows) byId[o.id] = o;
    return Object.values(byId);
  };

  const fetchStagePage = useCallback(async (stageId: string, page: number): Promise<Opp[]> => {
    if (!selectedPipeline) return [];
    const { data, error } = await supabase.from('opportunities')
      .select(SELECT_COLS)
      .eq('pipeline_id', selectedPipeline)
      .eq('stage_id', stageId)
      .order('position', { ascending: true })
      .order('updated_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) { console.error('[fetchStagePage]', error); return []; }
    return (data as unknown as Opp[]) || [];
  }, [selectedPipeline]);

  const loadStagePage = useCallback(async (stageId: string, page: number, append: boolean) => {
    setLoadingByStage(prev => ({ ...prev, [stageId]: true }));
    const rows = await fetchStagePage(stageId, page);
    setOppsByStageState(prev => {
      const next = append ? mergeStageRows(prev[stageId] || [], rows) : rows;
      return { ...prev, [stageId]: next };
    });
    setPageByStage(prev => ({ ...prev, [stageId]: page }));
    setLoadingByStage(prev => ({ ...prev, [stageId]: false }));
    refreshLastInteraction(rows);
  }, [fetchStagePage, refreshLastInteraction]);

  const loadAllStagesFirstPage = useCallback(async () => {
    if (stages.length === 0) return;
    const results = await Promise.all(stages.map(s => fetchStagePage(s.id, 0).then(rows => [s.id, rows] as const)));
    const map: Record<string, Opp[]> = {};
    const pages: Record<string, number> = {};
    const allRows: Opp[] = [];
    for (const [id, rows] of results) {
      map[id] = rows;
      pages[id] = 0;
      allRows.push(...rows);
    }
    setOppsByStageState(map);
    setPageByStage(pages);
    refreshLastInteraction(allRows);
  }, [stages, fetchStagePage, refreshLastInteraction]);

  // Refetch page 0 for each already-visible stage; merge to preserve loaded extras
  const refreshLoadedStages = useCallback(async () => {
    if (stages.length === 0) return;
    const targets = stages.filter(s => (oppsByStageState[s.id]?.length ?? 0) > 0);
    if (targets.length === 0) return;
    await Promise.all(targets.map(async s => {
      const rows = await fetchStagePage(s.id, 0);
      setOppsByStageState(prev => ({ ...prev, [s.id]: mergeStageRows(prev[s.id] || [], rows) }));
    }));
  }, [stages, oppsByStageState, fetchStagePage]);

  const loadSearchResults = useCallback(async () => {
    if (!selectedPipeline) return;
    setSearchLoading(true);
    const term = search.trim();
    const { data, error } = await supabase.rpc('search_pipeline_opportunities' as any, {
      _pipeline_id: selectedPipeline,
      _term: term || null,
      ...filterArgs,
      _limit: SEARCH_LIMIT,
    });
    if (error) { console.error('[search_pipeline_opportunities]', error); setSearchLoading(false); return; }
    const rows = ((data as any[]) || []);
    // Hydrate contacts
    const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))] as string[];
    let contactsMap: Record<string, Contact> = {};
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase.from('contacts')
        .select('id,name,phone,tags,birth_date')
        .in('id', contactIds);
      for (const c of ((contacts as unknown as Contact[]) || [])) contactsMap[c.id] = c;
    }
    const hydrated = rows.map(r => ({ ...r, contact: r.contact_id ? contactsMap[r.contact_id] : undefined })) as Opp[];
    setSearchResults(hydrated);
    setSearchLoading(false);
    refreshLastInteraction(hydrated);
  }, [selectedPipeline, search, filterArgs, refreshLastInteraction]);

  // Debounced search
  useEffect(() => {
    if (!isSearchMode) { setSearchResults([]); return; }
    const t = setTimeout(() => { loadSearchResults(); }, 250);
    return () => clearTimeout(t);
  }, [isSearchMode, loadSearchResults]);

  // Aggregates reload whenever pipeline or filters change
  useEffect(() => { loadStageAggregates(); }, [loadStageAggregates]);

  // Load message counts (best-effort — engagement score)
  const loadMsgCounts = useCallback(() => {
    if (!tenant) return;
    supabase.from('conversations')
      .select('id, contact_id')
      .eq('tenant_id', tenant.id)
      .not('contact_id', 'is', null)
      .then(async ({ data: convData }) => {
        if (!convData || convData.length === 0) { setMsgCountsByContact({}); return; }
        const convMap: Record<string, string> = {};
        for (const c of convData) { if (c.contact_id) convMap[c.id] = c.contact_id; }
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: msgs } = await supabase.from('messages')
          .select('conversation_id')
          .eq('tenant_id', tenant.id)
          .gte('created_at', thirtyDaysAgo);
        const counts: Record<string, number> = {};
        for (const m of (msgs ?? [])) {
          const cid = convMap[m.conversation_id];
          if (cid) counts[cid] = (counts[cid] || 0) + 1;
        }
        setMsgCountsByContact(counts);
      });
  }, [tenant]);

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

  // Load stages when pipeline changes
  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('stages').select('*').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setStages((data as unknown as Stage[]) ?? []));
    setOppsByStageState({});
    setPageByStage({});
    loadActivities();
    loadMsgCounts();
  }, [selectedPipeline, tenant, loadActivities, loadMsgCounts]);

  // Load first page for all stages once stages arrive (navigation mode)
  useEffect(() => {
    if (isSearchMode) return;
    if (stages.length === 0) return;
    loadAllStagesFirstPage();
  }, [stages, isSearchMode, loadAllStagesFirstPage]);

  const loadUnreads = useCallback(async () => {
    if (!tenant) return;
    const { data: conversations } = await supabase.from('conversations')
      .select('id, contact_id, unread_count, status')
      .eq('tenant_id', tenant.id)
      .in('status', ['open', 'waiting_customer', 'waiting_agent']);

    const convs = (conversations ?? []) as {
      id: string; contact_id: string | null; unread_count: number | null; status: string;
    }[];

    if (convs.length === 0) { setUnreadByContact({}); return; }

    const convIds = convs.map(c => c.id);
    const { data: messages } = await supabase.from('messages')
      .select('conversation_id, direction, created_at')
      .eq('tenant_id', tenant.id)
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    const lastDirectionByConversation: Record<string, 'inbound' | 'outbound'> = {};
    for (const m of (messages ?? []) as { conversation_id: string; direction: 'inbound' | 'outbound'; created_at: string }[]) {
      if (!lastDirectionByConversation[m.conversation_id]) {
        lastDirectionByConversation[m.conversation_id] = m.direction;
      }
    }

    const map: Record<string, number> = {};
    for (const c of convs) {
      if (!c.contact_id) continue;
      const lastDirection = lastDirectionByConversation[c.id];
      const isLastInbound = lastDirection === 'inbound';
      if (!isLastInbound) continue;
      const unread = c.unread_count || 0;
      const pendingByStatus = c.status === 'waiting_agent';
      const signal = pendingByStatus ? Math.max(unread, 1) : unread;
      if (signal > 0) map[c.contact_id] = (map[c.contact_id] || 0) + signal;
    }
    setUnreadByContact(map);
  }, [tenant]);

  useEffect(() => { loadUnreads(); }, [loadUnreads]);

  // Realtime + polling. Refresh only what's needed.
  const isSearchModeRef = useRef(isSearchMode);
  useEffect(() => { isSearchModeRef.current = isSearchMode; }, [isSearchMode]);

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;

    let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const refreshAll = () => {
      loadStageAggregates();
      loadUnreads();
      if (isSearchModeRef.current) loadSearchResults();
      else refreshLoadedStages();
    };

    const scheduleRefresh = (delay = 700) => {
      if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = setTimeout(() => { refreshAll(); }, delay);
    };

    pollingTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAll();
    }, 2000);

    const handleForegroundRefresh = () => {
      if (document.visibilityState === 'visible') scheduleRefresh(120);
    };

    const channel = supabase
      .channel(`pipeline-updates-${tenant.id}-${selectedPipeline}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities', filter: `pipeline_id=eq.${selectedPipeline}` }, () => scheduleRefresh(120))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenant.id}` }, () => scheduleRefresh(120))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenant.id}` }, () => scheduleRefresh(120))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `tenant_id=eq.${tenant.id}` }, () => loadActivities())
      .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleRefresh(80); });

    window.addEventListener('focus', handleForegroundRefresh);
    document.addEventListener('visibilitychange', handleForegroundRefresh);

    return () => {
      if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
      if (pollingTimer) clearInterval(pollingTimer);
      window.removeEventListener('focus', handleForegroundRefresh);
      document.removeEventListener('visibilitychange', handleForegroundRefresh);
      supabase.removeChannel(channel);
    };
  }, [selectedPipeline, tenant, loadStageAggregates, loadUnreads, loadSearchResults, refreshLoadedStages, loadActivities]);

  const touchOppUpdatedAt = useCallback((oppId: string) => {
    const iso = new Date().toISOString();
    setOppsByStageState(prev => {
      const next: Record<string, Opp[]> = {};
      for (const k of Object.keys(prev)) next[k] = prev[k].map(o => o.id === oppId ? { ...o, updated_at: iso } : o);
      return next;
    });
    setSearchResults(prev => prev.map(o => o.id === oppId ? { ...o, updated_at: iso } : o));
  }, []);

  const moveOpportunity = async (oppId: string, newStageId: string) => {
    const opp = allLoadedOpps.find(o => o.id === oppId);
    if (!opp || !tenant) return;
    const fromStageId = opp.stage_id;
    if (fromStageId === newStageId) return;
    const stage = stages.find(s => s.id === newStageId);
    const newStatus = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
    const nowIso = new Date().toISOString();
    const value = Number(opp.value || 0);

    // Optimistic bucket transfer
    setOppsByStageState(prev => {
      const from = (prev[fromStageId] || []).filter(o => o.id !== oppId);
      const moved: Opp = { ...opp, stage_id: newStageId, status: newStatus as any, position: 0, updated_at: nowIso };
      const to = [moved, ...(prev[newStageId] || []).filter(o => o.id !== oppId)];
      return { ...prev, [fromStageId]: from, [newStageId]: to };
    });
    setSearchResults(prev => prev.map(o => o.id === oppId ? { ...o, stage_id: newStageId, status: newStatus as any, position: 0, updated_at: nowIso } : o));

    // Optimistic aggregate adjust
    setAggregatesByStage(prev => {
      const from = prev[fromStageId] || { count: 0, total: 0 };
      const to = prev[newStageId] || { count: 0, total: 0 };
      return {
        ...prev,
        [fromStageId]: { count: Math.max(0, from.count - 1), total: Math.max(0, from.total - value) },
        [newStageId]: { count: to.count + 1, total: to.total + value },
      };
    });

    await supabase.from('opportunities').update({ stage_id: newStageId, status: newStatus, position: 0, updated_at: nowIso }).eq('id', oppId);

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

    // Reconcile aggregates from server after the write settles
    loadStageAggregates();
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const overId = over.id as string;
    const activeOpp = allLoadedOpps.find(o => o.id === active.id);
    if (!activeOpp) return;

    const overOpp = overId.startsWith('stage-') ? null : allLoadedOpps.find(o => o.id === overId);
    const targetStageId = overId.startsWith('stage-')
      ? overId.replace('stage-', '')
      : overOpp?.stage_id;

    if (!targetStageId) return;

    if (targetStageId !== activeOpp.stage_id) {
      await moveOpportunity(activeOpp.id, targetStageId);
      return;
    }

    const stageOpps = oppsByStage(activeOpp.stage_id);
    const oldIndex = stageOpps.findIndex(o => o.id === activeOpp.id);
    let newIndex = overOpp
      ? stageOpps.findIndex(o => o.id === overOpp.id)
      : stageOpps.length - 1;

    if (oldIndex === -1) return;
    if (newIndex === -1) newIndex = stageOpps.length - 1;
    if (newIndex === oldIndex) return;

    const reordered = arrayMove(stageOpps, oldIndex, newIndex);
    const updates = reordered.map((o, index) => ({ id: o.id, position: index + 1 }));
    const positionById = Object.fromEntries(updates.map(u => [u.id, u.position]));

    // Update local state in the correct bucket
    setOppsByStageState(prev => ({
      ...prev,
      [activeOpp.stage_id]: (prev[activeOpp.stage_id] || []).map(o => (
        positionById[o.id] !== undefined ? { ...o, position: positionById[o.id] as number } : o
      )),
    }));
    setSearchResults(prev => prev.map(o => (
      positionById[o.id] !== undefined ? { ...o, position: positionById[o.id] as number } : o
    )));

    await Promise.all(
      updates.map(u =>
        supabase.from('opportunities').update({ position: u.position }).eq('id', u.id)
      )
    );
  };

  const { getOpportunityLinked, deleteOpportunityCascade, loading: cascadeLoading } = useCascadeDelete();
  const [cascadeData, setCascadeData] = useState<OpportunityLinked | null>(null);

  const canDeleteOpportunity = role !== 'readonly' && role !== null;

  const handleDeleteOpportunity = async (oppId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDeleteOpportunity) {
      toast.error('Você não tem permissão para excluir oportunidades');
      return;
    }
    setDeleteOppId(oppId);
    const linked = await getOpportunityLinked(oppId);
    setCascadeData(linked);
  };

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
    } catch {
      toast.error('Erro inesperado ao criar pipeline');
    } finally {
      setCreatingPipeline(false);
    }
  };

  const refreshAfterMutation = useCallback(() => {
    loadStageAggregates();
    if (isSearchMode) loadSearchResults();
    else loadAllStagesFirstPage();
  }, [loadStageAggregates, isSearchMode, loadSearchResults, loadAllStagesFirstPage]);

  const activeOpp = activeId ? allLoadedOpps.find(o => o.id === activeId) : null;

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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-9 w-64 h-9 text-[13px] rounded-xl" placeholder="Buscar por nome, telefone ou título..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <FilterBar filters={filters} onChange={setFilters} members={members} allTags={allTags} />
        </div>
        <div className="text-sm text-muted-foreground">
          {isSearchMode ? (
            <span className="text-primary font-medium">
              {searchLoading ? 'Buscando…' : `Busca — ${searchResults.length} resultado${searchResults.length !== 1 ? 's' : ''}${searchResults.length >= SEARCH_LIMIT ? ' (limite 300, refine)' : ''}`}
            </span>
          ) : (
            <>
              {globalAggregate.count} oportunidade{globalAggregate.count !== 1 ? 's' : ''} ·{' '}
              R$ {globalAggregate.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </>
          )}
        </div>
      </header>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto p-4 pt-0">
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full min-w-max">
            {stages.map(stage => {
              const stageOpps = oppsByStage(stage.id);
              const agg = aggregatesByStage[stage.id] || { count: 0, total: 0 };
              const loadedCount = (oppsByStageState[stage.id] || []).length;
              const showLoadMore = !isSearchMode && loadedCount < agg.count;
              const remaining = Math.max(0, agg.count - loadedCount);
              return (
                <DroppableColumn key={stage.id} stage={stage}
                  count={agg.count}
                  total={agg.total}
                  matchCount={isSearchMode ? stageOpps.length : null}
                  onAdd={() => { setCreateStageId(stage.id); setShowCreate(true); }}>
                  <SortableContext items={stageOpps.map(o => o.id)} strategy={verticalListSortingStrategy}>
                    {stageOpps.map(opp => (
                      <SortableOppCard key={opp.id} opp={opp} onClick={() => { setSelectedOpp(opp.id); resetUnreadForContact(opp.contact_id); }}
                        onWhatsApp={(e) => { e.stopPropagation(); openChat(opp); }}
                        onDelete={(e) => handleDeleteOpportunity(opp.id, e)}
                        alertStatus={getOppAlertStatus(opp)}
                        unreadCount={opp.contact_id ? (unreadByContact[opp.contact_id] || 0) : 0}
                        customFieldDefs={customFieldDefs}
                        canDelete={canDeleteOpportunity}
                        lastContactInteractionAt={opp.contact_id ? lastContactInteractionByContact[opp.contact_id] : null}
                        engagementScore={calcEngagementScore(opp, msgCountsByContact)} />
                    ))}
                  </SortableContext>
                  {showLoadMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-[11px] rounded-lg text-muted-foreground hover:text-foreground"
                      disabled={!!loadingByStage[stage.id]}
                      onClick={() => loadStagePage(stage.id, (pageByStage[stage.id] ?? 0) + 1, true)}>
                      {loadingByStage[stage.id] ? 'Carregando…' : `Carregar mais (${remaining})`}
                    </Button>
                  )}
                </DroppableColumn>
              );
            })}
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
        pipelineId={selectedPipeline} onCreated={refreshAfterMutation} />

      {/* WhatsApp Chat Dialog */}
      <Dialog open={!!chatOpp} onOpenChange={(open) => { if (!open) {
        if (chatOpp) touchOppUpdatedAt(chatOpp.id);
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

      <CascadeDeleteDialog
        open={!!deleteOppId}
        onOpenChange={(open) => { if (!open) { setDeleteOppId(null); setCascadeData(null); } }}
        title="Excluir oportunidade"
        description="Esta oportunidade será excluída permanentemente."
        linkedEntities={cascadeData ? [
          { type: "activities", label: "Atividades desta oportunidade", count: cascadeData.activities, icon: <CheckSquare className="h-4 w-4" />, checked: true },
          { type: "conversations", label: `Conversas de ${cascadeData.contactName || "este contato"}`, count: cascadeData.conversations, icon: <MessageSquare className="h-4 w-4" />, checked: false },
          { type: "contact", label: `Contato: ${cascadeData.contactName || "Desconhecido"}`, count: cascadeData.contactId ? 1 : 0, icon: <User className="h-4 w-4" />, checked: false },
        ] : []}
        onConfirm={async (toDelete) => {
          if (!deleteOppId) return;
          const oppId = deleteOppId;
          const contactId = cascadeData?.contactId || null;
          const success = await deleteOpportunityCascade(oppId, contactId, toDelete);
          if (success) {
            setOppsByStageState(prev => {
              const next: Record<string, Opp[]> = {};
              for (const k of Object.keys(prev)) next[k] = prev[k].filter(o => o.id !== oppId);
              return next;
            });
            setSearchResults(prev => prev.filter(o => o.id !== oppId));
            refreshAfterMutation();
          }
          setDeleteOppId(null);
          setCascadeData(null);
        }}
        isLoading={cascadeLoading}
      />
    </div>
  );
}
