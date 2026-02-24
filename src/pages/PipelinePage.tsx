import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Pipeline, Stage, Opportunity, Contact, Conversation, Activity } from '@/types/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, User, DollarSign, Clock, GripVertical, MessageCircle, AlertTriangle, CalendarClock, Cake } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import OpportunityDetail from '@/components/crm/OpportunityDetail';
import CreateOpportunityDialog from '@/components/crm/CreateOpportunityDialog';
import ChatPanel from '@/components/inbox/ChatPanel';
import { formatDistanceToNow, format } from 'date-fns';
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

function SortableOppCard({ opp, onClick, onWhatsApp, alertStatus, unreadCount, customFieldDefs }: {
  opp: Opportunity & { contact?: Contact };
  onClick: () => void;
  onWhatsApp: (e: React.MouseEvent) => void;
  alertStatus: CardAlertStatus;
  unreadCount: number;
  customFieldDefs: CustomFieldDef[];
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

export default function PipelinePage() {
  const { tenant } = useAuth();
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Tick every 60s to refresh inactivity/due calculations
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

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
    // Load custom field definitions from tenant settings
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
  }, [tenant]);

  const loadOpps = useCallback(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('opportunities').select('*, contact:contacts(*)').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setOpportunities((data as unknown as (Opportunity & { contact?: Contact })[]) ?? []));
  }, [selectedPipeline, tenant]);

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
  }, [selectedPipeline, tenant, loadOpps, loadActivities]);

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

    // Enqueue automation trigger for stage change
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

  const oppsByStage = (stageId: string) => opportunities.filter(o => o.stage_id === stageId);
  const stageTotal = (stageId: string) => oppsByStage(stageId).reduce((s, o) => s + Number(o.value || 0), 0);

  // Determine the alert status for each card
  const getOppAlertStatus = (opp: Opportunity): CardAlertStatus => {
    if (opp.status !== 'open') return 'normal';

    const pendingActivities = activitiesByOpp[opp.id];
    if (pendingActivities && pendingActivities.length > 0) {
      // Has scheduled activities — check earliest due_date
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
      return 'scheduled'; // has future activity, suppress inactivity
    }

    // No scheduled activities — fall back to inactivity check
    const stage = stages.find(s => s.id === opp.stage_id);
    if (!stage || !stage.inactivity_minutes || stage.inactivity_minutes <= 0) return 'normal';
    const threshold = Date.now() - stage.inactivity_minutes * 60 * 1000;
    if (new Date(opp.updated_at).getTime() < threshold) return 'inactive';

    return 'normal';
  };

  const activeOpp = activeId ? opportunities.find(o => o.id === activeId) : null;

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
        </div>
        <div className="text-sm text-muted-foreground">
          {opportunities.length} oportunidade{opportunities.length !== 1 ? 's' : ''} · R$ {opportunities.reduce((s, o) => s + (o.value || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                      alertStatus={getOppAlertStatus(opp)}
                      unreadCount={opp.contact_id ? (unreadByContact[opp.contact_id] || 0) : 0}
                      customFieldDefs={customFieldDefs} />
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
    </div>
  );
}
