import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Pipeline, Stage, Opportunity, Contact, Conversation } from '@/types/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, User, DollarSign, Clock, GripVertical, MessageCircle, AlertTriangle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import OpportunityDetail from '@/components/crm/OpportunityDetail';
import CreateOpportunityDialog from '@/components/crm/CreateOpportunityDialog';
import ChatPanel from '@/components/inbox/ChatPanel';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

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

function SortableOppCard({ opp, onClick, onWhatsApp, isInactive }: { opp: Opportunity & { contact?: Contact }; onClick: () => void; onWhatsApp: (e: React.MouseEvent) => void; isInactive: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: opp.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <Card ref={setNodeRef} style={style}
      className={`cursor-pointer p-3.5 hover-lift border bg-card rounded-xl group ${isInactive ? 'border-destructive/60 ring-1 ring-destructive/30' : 'border-border/50'}`}
      onClick={onClick}>
      <div className="space-y-2.5">
        <div className="flex items-start gap-2">
          <div {...attributes} {...listeners} className="mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium leading-tight flex-1 text-foreground">{opp.title}</p>
          {isInactive && (
            <div className="shrink-0" title="Oportunidade inativa — necessita follow-up">
              <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
            </div>
          )}
          {opp.contact?.phone && (
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={onWhatsApp} title="Conversar no WhatsApp">
              <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
            </Button>
          )}
        </div>
        {opp.contact && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
            <User className="h-3 w-3" />
            <span className="truncate">{opp.contact.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between pl-5">
          {Number(opp.value ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-success">
              <DollarSign className="h-3 w-3" />
              R$ {Number(opp.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          )}
          <div className={`flex items-center gap-1 text-[10px] ml-auto ${isInactive ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const openChat = async (opp: Opportunity & { contact?: Contact }) => {
    if (!tenant || !opp.contact_id) return;
    // Find or create conversation for this contact
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
    } else {
      // Create new conversation
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

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('stages').select('*').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setStages((data as unknown as Stage[]) ?? []));
    loadOpps();
  }, [selectedPipeline, tenant, loadOpps]);

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    const channel = supabase
      .channel('pipeline-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities', filter: `pipeline_id=eq.${selectedPipeline}` }, () => loadOpps())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedPipeline, tenant, loadOpps]);

  const moveOpportunity = async (oppId: string, newStageId: string) => {
    const stage = stages.find(s => s.id === newStageId);
    const newStatus = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage_id: newStageId, status: newStatus as any } : o));
    await supabase.from('opportunities').update({ stage_id: newStageId, status: newStatus }).eq('id', oppId);
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const overId = over.id as string;
    const activeOpp = opportunities.find(o => o.id === active.id);
    if (!activeOpp) return;

    // Dropped on a stage column
    if (overId.startsWith('stage-')) {
      const stageId = overId.replace('stage-', '');
      if (stageId !== activeOpp.stage_id) {
        moveOpportunity(activeOpp.id, stageId);
      }
    }
    // Dropped on another opportunity
    else {
      const overOpp = opportunities.find(o => o.id === overId);
      if (overOpp && overOpp.stage_id !== activeOpp.stage_id) {
        moveOpportunity(activeOpp.id, overOpp.stage_id);
      }
    }
  };

  const oppsByStage = (stageId: string) => opportunities.filter(o => o.stage_id === stageId);
  const stageTotal = (stageId: string) => oppsByStage(stageId).reduce((s, o) => s + Number(o.value || 0), 0);
  const isOppInactive = (opp: Opportunity) => {
    const stage = stages.find(s => s.id === opp.stage_id);
    if (!stage || !stage.inactivity_minutes || stage.inactivity_minutes <= 0) return false;
    const threshold = Date.now() - stage.inactivity_minutes * 60 * 1000;
    return new Date(opp.updated_at).getTime() < threshold;
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
                    <SortableOppCard key={opp.id} opp={opp} onClick={() => setSelectedOpp(opp.id)}
                      onWhatsApp={(e) => { e.stopPropagation(); openChat(opp); }}
                      isInactive={opp.status === 'open' && isOppInactive(opp)} />
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
            <OpportunityDetail opportunityId={selectedOpp} stages={stages} onMoveStage={moveOpportunity} onClose={() => setSelectedOpp(null)} />
          )}
        </SheetContent>
      </Sheet>

      <CreateOpportunityDialog open={showCreate} onOpenChange={setShowCreate} stageId={createStageId}
        pipelineId={selectedPipeline} onCreated={loadOpps} />

      {/* WhatsApp Chat Dialog */}
      <Dialog open={!!chatOpp} onOpenChange={(open) => { if (!open) { setChatOpp(null); setChatConvId(null); } }}>
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
