import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Zap, Trash2, Edit, ArrowRight, Clock, Tag, UserPlus, MessageSquare, Move } from 'lucide-react';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ---- Trigger definitions ----
const TRIGGERS = [
  { value: 'lead_created', label: 'Lead criado', icon: UserPlus, description: 'Quando um novo lead é criado no sistema' },
  { value: 'opportunity_stage_changed', label: 'Oportunidade mudou de etapa', icon: Move, description: 'Quando um card muda de coluna no kanban' },
  { value: 'conversation_no_customer_reply', label: 'Sem resposta do cliente', icon: Clock, description: 'Quando o cliente não responde há X horas' },
  { value: 'conversation_no_agent_reply', label: 'Sem resposta do atendente', icon: Clock, description: 'Quando o atendente não responde há X horas' },
  { value: 'conversation_closed', label: 'Conversa encerrada', icon: MessageSquare, description: 'Quando uma conversa é encerrada' },
  { value: 'tag_added', label: 'Tag adicionada', icon: Tag, description: 'Quando uma tag é adicionada ao contato' },
  { value: 'tag_removed', label: 'Tag removida', icon: Tag, description: 'Quando uma tag é removida do contato' },
];

// ---- Action definitions ----
const ACTION_TYPES = [
  { value: 'move_to_stage', label: 'Mover para etapa', icon: Move },
  { value: 'add_tag', label: 'Adicionar tag', icon: Tag },
  { value: 'remove_tag', label: 'Remover tag', icon: Tag },
  { value: 'create_activity', label: 'Criar atividade', icon: Clock },
  { value: 'change_contact_status', label: 'Mudar status do contato', icon: UserPlus },
  { value: 'send_whatsapp', label: 'Enviar WhatsApp (texto livre)', icon: MessageSquare },
  { value: 'send_whatsapp_template', label: 'Enviar template WhatsApp (Meta)', icon: MessageSquare },
  { value: 'assign_round_robin', label: 'Atribuir (round-robin)', icon: UserPlus },
];

const CONTACT_STATUSES = [
  { value: 'lead', label: 'Lead' },
  { value: 'customer', label: 'Cliente' },
  { value: 'churned', label: 'Churned' },
  { value: 'inactive', label: 'Inativo' },
];

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Ligação' },
  { value: 'task', label: 'Tarefa' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'email', label: 'E-mail' },
];

interface Stage { id: string; name: string; pipeline_id: string; }
interface Pipeline { id: string; name: string; }

interface ActionConfig {
  type: string;
  stage_id?: string;
  tag?: string;
  activity_type?: string;
  activity_title?: string;
  activity_due_hours?: number;
  contact_status?: string;
  whatsapp_message?: string;
  whatsapp_instance_id?: string;
  template_id?: string;
  template_variables?: Record<string, string>;
}

interface ConditionConfig {
  from_stage_id?: string;
  to_stage_id?: string;
  tag?: string;
  hours?: number;
  min_value?: number;
  source?: string;
}

interface Automation {
  id: string; name: string; trigger_type: string; conditions: ConditionConfig;
  actions: ActionConfig[]; is_active: boolean; created_at: string;
}

export default function AutomationsPage() {
  const { tenant } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState(TRIGGERS[0].value);
  const [conditions, setConditions] = useState<ConditionConfig>({});
  const [actions, setActions] = useState<ActionConfig[]>([{ type: 'move_to_stage' }]);

  // Reference data
  const [stages, setStages] = useState<Stage[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  const load = () => {
    if (!tenant) return;
    supabase.from('automations').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false })
      .then(({ data }) => setAutomations((data as unknown as Automation[]) ?? []));
  };

  const loadRefs = () => {
    if (!tenant) return;
    supabase.from('pipelines').select('id, name').eq('tenant_id', tenant.id).then(({ data }) => setPipelines(data ?? []));
    supabase.from('stages').select('id, name, pipeline_id').eq('tenant_id', tenant.id).order('position').then(({ data }) => setStages(data ?? []));
  };

  useEffect(() => { load(); loadRefs(); }, [tenant]);

  const resetForm = () => {
    setName(''); setTriggerType(TRIGGERS[0].value);
    setConditions({}); setActions([{ type: 'move_to_stage' }]); setEditId(null);
  };

  const openEdit = (a: Automation) => {
    setEditId(a.id); setName(a.name); setTriggerType(a.trigger_type);
    setConditions(a.conditions || {});
    setActions(Array.isArray(a.actions) && a.actions.length > 0 ? a.actions : [{ type: 'move_to_stage' }]);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenant || !name.trim()) { toast.error('Preencha o nome da automação'); return; }

    const payload = {
      name,
      trigger_type: triggerType as any,
      conditions: conditions as any,
      actions: actions as any,
    };

    if (editId) {
      const { error } = await supabase.from('automations').update(payload).eq('id', editId);
      if (error) toast.error(error.message); else toast.success('Automação atualizada');
    } else {
      const { error } = await supabase.from('automations').insert({ tenant_id: tenant.id, ...payload });
      if (error) toast.error(error.message); else toast.success('Automação criada');
    }
    setDialogOpen(false); resetForm(); load();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('automations').update({ is_active: active }).eq('id', id);
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_active: active } : a));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('automations').delete().eq('id', id); toast.success('Automação removida'); load();
  };

  const updateAction = (index: number, updates: Partial<ActionConfig>) => {
    setActions(prev => prev.map((a, i) => i === index ? { ...a, ...updates } : a));
  };

  const addAction = () => setActions(prev => [...prev, { type: 'move_to_stage' }]);
  const removeAction = (index: number) => setActions(prev => prev.filter((_, i) => i !== index));

  const triggerInfo = TRIGGERS.find(t => t.value === triggerType);

  // ---- Condition Fields based on trigger ----
  const renderConditions = () => {
    switch (triggerType) {
      case 'opportunity_stage_changed':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">De etapa (opcional)</Label>
              <Select value={conditions.from_stage_id || '_any'} onValueChange={v => setConditions(c => ({ ...c, from_stage_id: v === '_any' ? undefined : v }))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Qualquer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Qualquer etapa</SelectItem>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Para etapa (opcional)</Label>
              <Select value={conditions.to_stage_id || '_any'} onValueChange={v => setConditions(c => ({ ...c, to_stage_id: v === '_any' ? undefined : v }))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Qualquer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Qualquer etapa</SelectItem>
                  {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      case 'conversation_no_customer_reply':
      case 'conversation_no_agent_reply':
        return (
          <div className="space-y-1.5">
            <Label className="text-xs">Horas sem resposta</Label>
            <Input type="number" min={1} value={conditions.hours || ''} onChange={e => setConditions(c => ({ ...c, hours: Number(e.target.value) }))} placeholder="Ex: 24" className="h-9 text-xs" />
          </div>
        );
      case 'tag_added':
      case 'tag_removed':
        return (
          <div className="space-y-1.5">
            <Label className="text-xs">Nome da tag</Label>
            <TagPickerSelect value={conditions.tag || ''} onChange={v => setConditions(c => ({ ...c, tag: v }))} />
          </div>
        );
      case 'lead_created':
        return (
          <div className="space-y-1.5">
            <Label className="text-xs">Origem do lead (opcional)</Label>
            <Input value={conditions.source || ''} onChange={e => setConditions(c => ({ ...c, source: e.target.value }))} placeholder="Ex: facebook_lead_ads" className="h-9 text-xs" />
          </div>
        );
      default:
        return <p className="text-xs text-muted-foreground">Nenhuma condição necessária para este trigger.</p>;
    }
  };

  // ---- Action Fields ----
  const renderActionFields = (action: ActionConfig, index: number) => {
    switch (action.type) {
      case 'move_to_stage':
        return (
          <Select value={action.stage_id || ''} onValueChange={v => updateAction(index, { stage_id: v })}>
            <SelectTrigger className="h-9 text-xs flex-1"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
            <SelectContent>
              {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      case 'add_tag':
      case 'remove_tag':
        return <TagPickerSelect value={action.tag || ''} onChange={v => updateAction(index, { tag: v })} className="flex-1" />;
      case 'create_activity':
        return (
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <Select value={action.activity_type || 'follow_up'} onValueChange={v => updateAction(index, { activity_type: v })}>
                <SelectTrigger className="h-9 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={action.activity_title || ''} onChange={e => updateAction(index, { activity_title: e.target.value })} placeholder="Título da atividade" className="h-9 text-xs flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Prazo em horas:</Label>
              <Input type="number" min={1} value={action.activity_due_hours || ''} onChange={e => updateAction(index, { activity_due_hours: Number(e.target.value) })} placeholder="24" className="h-9 text-xs w-20" />
            </div>
          </div>
        );
      case 'change_contact_status':
        return (
          <Select value={action.contact_status || 'customer'} onValueChange={v => updateAction(index, { contact_status: v })}>
            <SelectTrigger className="h-9 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTACT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      case 'send_whatsapp':
        return <Input value={action.whatsapp_message || ''} onChange={e => updateAction(index, { whatsapp_message: e.target.value })} placeholder="Mensagem a enviar" className="h-9 text-xs flex-1" />;
      case 'assign_round_robin':
        return <span className="text-xs text-muted-foreground">Atribui automaticamente ao atendente com menos leads abertos</span>;
      default:
        return null;
    }
  };

  const getActionSummary = (action: ActionConfig): string => {
    const actionDef = ACTION_TYPES.find(a => a.value === action.type);
    switch (action.type) {
      case 'move_to_stage': {
        const stage = stages.find(s => s.id === action.stage_id);
        return `Mover para "${stage?.name || '?'}"`;
      }
      case 'add_tag': return `Adicionar tag "${action.tag || '?'}"`;
      case 'remove_tag': return `Remover tag "${action.tag || '?'}"`;
      case 'create_activity': return `Criar ${action.activity_type || 'atividade'}: "${action.activity_title || '?'}"`;
      case 'change_contact_status': {
        const st = CONTACT_STATUSES.find(s => s.value === action.contact_status);
        return `Status → ${st?.label || '?'}`;
      }
      case 'send_whatsapp': return `Enviar WhatsApp`;
      case 'assign_round_robin': return `Atribuir round-robin`;
      default: return actionDef?.label || action.type;
    }
  };

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Automações</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Configure regras automáticas para seus leads</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { if (!v) resetForm(); setDialogOpen(v); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9 text-xs"><Plus className="h-3.5 w-3.5 mr-1.5" />Nova Automação</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-base">{editId ? 'Editar' : 'Nova'} Automação</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-2">
              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Nome</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Follow-up automático 24h" className="h-9 text-sm" />
              </div>

              {/* Trigger */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Quando isso acontecer</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  {TRIGGERS.map(t => {
                    const Icon = t.icon;
                    const isSelected = triggerType === t.value;
                    return (
                      <button
                        key={t.value}
                        onClick={() => { setTriggerType(t.value); setConditions({}); }}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                          isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/30 hover:bg-accent/50'
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={1.75} />
                        <div className="min-w-0">
                          <p className={`text-xs font-medium ${isSelected ? 'text-foreground' : 'text-foreground/80'}`}>{t.label}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{t.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conditions */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Condições</Label>
                <div className="rounded-lg border border-border bg-accent/30 p-3">
                  {renderConditions()}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Então faça isso</Label>
                  <Button variant="ghost" size="sm" onClick={addAction} className="h-7 text-xs text-primary">
                    <Plus className="h-3 w-3 mr-1" />Adicionar ação
                  </Button>
                </div>
                <div className="space-y-2">
                  {actions.map((action, i) => {
                    const actionDef = ACTION_TYPES.find(a => a.value === action.type);
                    const Icon = actionDef?.icon || Zap;
                    return (
                      <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.75} />
                            <Select value={action.type} onValueChange={v => updateAction(i, { type: v, stage_id: undefined, tag: undefined, activity_type: undefined, activity_title: undefined, activity_due_hours: undefined, contact_status: undefined, whatsapp_message: undefined })}>
                              <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ACTION_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          {actions.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAction(i)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                        <div className="flex items-start gap-2">
                          {renderActionFields(action, i)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button className="w-full h-9 text-sm" onClick={handleSave}>Salvar automação</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      <div className="space-y-2">
        {automations.map(a => {
          const trigger = TRIGGERS.find(t => t.value === a.trigger_type);
          const TriggerIcon = trigger?.icon || Zap;
          const actionsList = Array.isArray(a.actions) ? a.actions as ActionConfig[] : [];
          return (
            <Card key={a.id} className="hover-lift">
              <CardContent className="flex items-center justify-between py-3.5 px-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center shrink-0">
                    <TriggerIcon className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] h-5 rounded-md font-normal">{trigger?.label ?? a.trigger_type}</Badge>
                      {actionsList.length > 0 && (
                        <>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          {actionsList.slice(0, 2).map((act, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] h-5 rounded-md font-normal">
                              {getActionSummary(act)}
                            </Badge>
                          ))}
                          {actionsList.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">+{actionsList.length - 2}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">{format(new Date(a.created_at), 'dd/MM/yyyy')}</span>
                  <Switch checked={a.is_active} onCheckedChange={v => toggleActive(a.id, v)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(a)}><Edit className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(a.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {automations.length === 0 && (
          <div className="text-center py-16">
            <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center mx-auto mb-3">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">Nenhuma automação configurada</p>
            <p className="text-xs text-muted-foreground mt-1">Crie sua primeira automação para automatizar seus processos</p>
          </div>
        )}
      </div>
    </div>
  );
}
