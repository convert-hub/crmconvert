import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Pipeline, Stage, Opportunity, Contact } from '@/types/crm';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, User, DollarSign, Clock } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import OpportunityDetail from '@/components/crm/OpportunityDetail';
import CreateOpportunityDialog from '@/components/crm/CreateOpportunityDialog';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function PipelinePage() {
  const { tenant } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [opportunities, setOpportunities] = useState<(Opportunity & { contact?: Contact })[]>([]);
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStageId, setCreateStageId] = useState<string>('');

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

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    // Load stages
    supabase.from('stages').select('*').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setStages((data as unknown as Stage[]) ?? []));
    // Load opportunities with contact
    supabase.from('opportunities').select('*, contact:contacts(*)').eq('pipeline_id', selectedPipeline).order('position')
      .then(({ data }) => setOpportunities((data as unknown as (Opportunity & { contact?: Contact })[]) ?? []));
  }, [selectedPipeline, tenant]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    const channel = supabase
      .channel('pipeline-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities', filter: `pipeline_id=eq.${selectedPipeline}` }, () => {
        // Reload opportunities
        supabase.from('opportunities').select('*, contact:contacts(*)').eq('pipeline_id', selectedPipeline).order('position')
          .then(({ data }) => setOpportunities((data as unknown as (Opportunity & { contact?: Contact })[]) ?? []));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedPipeline, tenant]);

  const moveOpportunity = async (oppId: string, newStageId: string) => {
    const stage = stages.find(s => s.id === newStageId);
    const newStatus = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
    await supabase.from('opportunities').update({ stage_id: newStageId, status: newStatus }).eq('id', oppId);
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage_id: newStageId, status: newStatus as any } : o));
  };

  const oppsByStage = (stageId: string) => opportunities.filter(o => o.stage_id === stageId);

  const stageTotal = (stageId: string) => oppsByStage(stageId).reduce((s, o) => s + (o.value || 0), 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Pipeline</h1>
          {pipelines.length > 1 && (
            <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {stages.map(stage => (
            <div key={stage.id} className="flex w-72 flex-col rounded-xl bg-muted/50">
              {/* Stage header */}
              <div className="flex items-center justify-between p-3 border-b">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-sm font-semibold">{stage.name}</span>
                  <Badge variant="secondary" className="text-xs">{oppsByStage(stage.id).length}</Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setCreateStageId(stage.id); setShowCreate(true); }}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Stage total */}
              {stageTotal(stage.id) > 0 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  R$ {stageTotal(stage.id).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              )}

              {/* Cards */}
              <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2">
                {oppsByStage(stage.id).map(opp => (
                  <Card
                    key={opp.id}
                    className="cursor-pointer p-3 hover:shadow-md transition-shadow border"
                    onClick={() => setSelectedOpp(opp.id)}
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-medium leading-tight">{opp.title}</p>
                      {opp.contact && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span className="truncate">{opp.contact.name}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {opp.value > 0 && (
                          <div className="flex items-center gap-1 text-xs font-medium text-success">
                            <DollarSign className="h-3 w-3" />
                            R$ {opp.value.toLocaleString('pt-BR')}
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(opp.created_at), { locale: ptBR, addSuffix: true })}
                        </div>
                      </div>
                      {opp.contact?.tags && opp.contact.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {opp.contact.tags.slice(0, 3).map(tag => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Opportunity Detail Drawer */}
      <Sheet open={!!selectedOpp} onOpenChange={() => setSelectedOpp(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes da Oportunidade</SheetTitle>
          </SheetHeader>
          {selectedOpp && (
            <OpportunityDetail
              opportunityId={selectedOpp}
              stages={stages}
              onMoveStage={moveOpportunity}
              onClose={() => setSelectedOpp(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <CreateOpportunityDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        stageId={createStageId}
        pipelineId={selectedPipeline}
        onCreated={() => {
          supabase.from('opportunities').select('*, contact:contacts(*)').eq('pipeline_id', selectedPipeline).order('position')
            .then(({ data }) => setOpportunities((data as unknown as (Opportunity & { contact?: Contact })[]) ?? []));
        }}
      />
    </div>
  );
}
