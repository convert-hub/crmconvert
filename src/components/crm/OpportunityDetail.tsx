import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Opportunity, Contact, Stage, Message, Activity, TenantMembership, Profile } from '@/types/crm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Phone, Mail, MessageSquare, Plus, CheckCircle2, XCircle, Save, CalendarClock, Check, Cake, Clock, ArrowRight, StickyNote, TrendingUp, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { opportunityStatusLabels, priorityLabels, activityTypeLabels } from '@/lib/labels';
import { Checkbox } from '@/components/ui/checkbox';

interface CustomFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  options?: string[];
}

interface StageMove {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  created_at: string;
  is_ai_move: boolean;
  ai_reason: string | null;
}

interface TimelineItem {
  id: string;
  type: 'message' | 'activity' | 'stage_move' | 'note';
  timestamp: string;
  data: any;
}

interface Props {
  opportunityId: string;
  stages: Stage[];
  onMoveStage: (oppId: string, stageId: string) => void;
  onClose: () => void;
  onActivityChange?: () => void;
}

export default function OpportunityDetail({ opportunityId, stages, onMoveStage, onClose, onActivityChange }: Props) {
  const { tenant, membership } = useAuth();
  const [opp, setOpp] = useState<Opportunity & { contact?: Contact } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stageMoves, setStageMoves] = useState<StageMove[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [newNote, setNewNote] = useState('');
  const [sending, setSending] = useState(false);

  // New activity form
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [actTitle, setActTitle] = useState('');
  const [actDescription, setActDescription] = useState('');
  const [actDueDate, setActDueDate] = useState('');
  const [actType, setActType] = useState<string>('task');

  // Edit state
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editNextAction, setEditNextAction] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});

  // Team members for assignment
  const [teamMembers, setTeamMembers] = useState<(TenantMembership & { profile?: Profile })[]>([]);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('tenants').select('settings').eq('id', tenant.id).single()
      .then(({ data }) => {
        if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
          setCustomFieldDefs((data.settings as Record<string, any>).custom_opportunity_fields || []);
        }
      });
    // Load team members (attendants, managers, admins)
    supabase.from('tenant_memberships').select('*, profile:profiles(*)').eq('tenant_id', tenant.id).eq('is_active', true)
      .then(({ data }) => {
        setTeamMembers((data as unknown as (TenantMembership & { profile?: Profile })[]) ?? []);
      });
  }, [tenant]);

  useEffect(() => {
    supabase.from('opportunities').select('*, contact:contacts(*)').eq('id', opportunityId).single()
      .then(({ data }) => {
        const o = data as unknown as Opportunity & { contact?: Contact };
        setOpp(o);
        if (o) {
          setEditTitle(o.title);
          setEditValue(String(o.value ?? 0));
          setEditPriority(o.priority ?? 'medium');
          setEditNextAction(o.next_action ?? '');
          setCustomFieldValues((o as any).custom_fields || {});
        }
      });

    // Find the contact's main conversation (prefer by contact_id to get ALL messages)
    supabase.from('opportunities').select('contact_id').eq('id', opportunityId).single()
      .then(async ({ data: oppData }) => {
        let convId: string | null = null;
        if (oppData?.contact_id) {
          // Get the contact's primary conversation (most recent, with messages)
          const { data: contactConvs } = await supabase.from('conversations')
            .select('id').eq('contact_id', oppData.contact_id).eq('channel', 'whatsapp')
            .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1);
          if (contactConvs && contactConvs.length > 0) convId = contactConvs[0].id;
        }
        // Fallback: try by opportunity_id
        if (!convId) {
          const { data: oppConvs } = await supabase.from('conversations')
            .select('id').eq('opportunity_id', opportunityId).limit(1);
          if (oppConvs && oppConvs.length > 0) convId = oppConvs[0].id;
        }
        if (convId) {
          supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at')
            .then(({ data }) => setMessages((data as unknown as Message[]) ?? []));
        }
      });

    // Load stage moves
    supabase.from('stage_moves').select('*').eq('opportunity_id', opportunityId).order('created_at')
      .then(({ data }) => setStageMoves((data as unknown as StageMove[]) ?? []));

    loadActivities();
  }, [opportunityId]);

  const loadActivities = () => {
    supabase.from('activities').select('*').eq('opportunity_id', opportunityId).order('created_at', { ascending: false })
      .then(({ data }) => setActivities((data as unknown as Activity[]) ?? []));
  };

  useEffect(() => {
    const channel = supabase.channel(`opp-messages-${opportunityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => [...prev, payload.new as unknown as Message]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [opportunityId]);

  // Build unified timeline
  const timeline: TimelineItem[] = (() => {
    const items: TimelineItem[] = [];

    for (const msg of messages) {
      items.push({ id: `msg-${msg.id}`, type: 'message', timestamp: msg.created_at, data: msg });
    }
    for (const act of activities) {
      items.push({ id: `act-${act.id}`, type: act.type === 'note' ? 'note' : 'activity', timestamp: act.created_at, data: act });
    }
    for (const sm of stageMoves) {
      items.push({ id: `sm-${sm.id}`, type: 'stage_move', timestamp: sm.created_at, data: sm });
    }

    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return items;
  })();

  const handleSaveEdit = async () => {
    if (!opp) return;
    const { error } = await supabase.from('opportunities').update({
      title: editTitle,
      value: parseFloat(editValue) || 0,
      priority: editPriority as any,
      next_action: editNextAction || null,
      custom_fields: customFieldValues as any,
    }).eq('id', opp.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Oportunidade atualizada');
    setOpp(prev => prev ? { ...prev, title: editTitle, value: parseFloat(editValue) || 0, priority: editPriority as any, next_action: editNextAction } : null);
    setIsEditing(false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !tenant || !membership) return;
    setSending(true);
    try {
      let convId: string | null = null;

      // 1. Find existing conversation by contact_id (primary - same one the webhook uses)
      if (opp?.contact_id) {
        const { data: contactConvs } = await supabase.from('conversations')
          .select('id').eq('contact_id', opp.contact_id).eq('channel', 'whatsapp')
          .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1);
        if (contactConvs && contactConvs.length > 0) convId = contactConvs[0].id;
      }

      // 2. Fallback: find by opportunity_id
      if (!convId) {
        const { data: oppConvs } = await supabase.from('conversations')
          .select('id').eq('opportunity_id', opportunityId).limit(1);
        if (oppConvs && oppConvs.length > 0) convId = oppConvs[0].id;
      }

      // 3. Last resort: create new conversation
      if (!convId) {
        const { data: newConv } = await supabase.from('conversations').insert({
          tenant_id: tenant.id, contact_id: opp?.contact_id, opportunity_id: opportunityId,
          channel: 'whatsapp', status: 'open', assigned_to: membership.id,
        }).select().single();
        convId = newConv!.id;
      }

      const { data: savedMsg } = await supabase.from('messages').insert({
        tenant_id: tenant.id, conversation_id: convId, direction: 'outbound',
        content: newMessage, sender_membership_id: membership.id,
      }).select('id').single();

      if (opp?.contact?.phone) {
        const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
          body: { action: 'send_message', tenant_id: tenant.id, phone: opp.contact.phone, message: newMessage, conversation_id: convId },
        });
        if (error || data?.error) {
          toast.warning('Falha ao enviar via WhatsApp: ' + (data?.error || error?.message));
        } else if (savedMsg?.id && data?.provider_message_id) {
          await supabase.from('messages').update({ provider_message_id: data.provider_message_id }).eq('id', savedMsg.id);
        }
      }
      setNewMessage(''); toast.success('Mensagem enviada');
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !tenant) return;
    await supabase.from('activities').insert({
      tenant_id: tenant.id, type: 'note', title: 'Nota interna', description: newNote,
      opportunity_id: opportunityId, contact_id: opp?.contact_id, assigned_to: membership?.id,
    });
    setActivities(prev => [{ id: crypto.randomUUID(), tenant_id: tenant.id, type: 'note', title: 'Nota interna', description: newNote, opportunity_id: opportunityId, contact_id: opp?.contact_id ?? null, conversation_id: null, assigned_to: null, due_date: null, is_completed: false, created_at: new Date().toISOString() }, ...prev]);
    setNewNote(''); toast.success('Nota adicionada');
  };

  const handleCreateActivity = async () => {
    if (!actTitle.trim() || !actDueDate || !tenant) return;
    const { error } = await supabase.from('activities').insert({
      tenant_id: tenant.id,
      type: actType as any,
      title: actTitle,
      description: actDescription || null,
      opportunity_id: opportunityId,
      contact_id: opp?.contact_id,
      assigned_to: membership?.id,
      due_date: new Date(actDueDate).toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Atividade agendada');
    setActTitle(''); setActDescription(''); setActDueDate(''); setActType('task'); setShowNewActivity(false);
    loadActivities();
    onActivityChange?.();
  };

  const handleCompleteActivity = async (activityId: string) => {
    const { error } = await supabase.from('activities').update({
      is_completed: true,
      completed_at: new Date().toISOString(),
    }).eq('id', activityId);
    if (error) { toast.error(error.message); return; }
    setActivities(prev => prev.map(a => a.id === activityId ? { ...a, is_completed: true } : a));
    toast.success('Atividade concluída');
    onActivityChange?.();
  };

  const getStageName = (stageId: string | null) => {
    if (!stageId) return '—';
    return stages.find(s => s.id === stageId)?.name ?? stageId.slice(0, 8);
  };

  if (!opp) return <div className="p-6 text-center text-muted-foreground">Carregando...</div>;

  const priorityColors: Record<string, string> = {
    low: 'bg-muted text-muted-foreground', medium: 'bg-info/10 text-info', high: 'bg-warning/10 text-warning', urgent: 'bg-destructive/10 text-destructive',
  };

  const getActivityDueStatus = (a: Activity) => {
    if (a.is_completed || !a.due_date) return 'none';
    const now = Date.now();
    const due = new Date(a.due_date).getTime();
    if (now >= due) return 'overdue';
    if (due - now <= 2 * 60 * 60 * 1000) return 'soon';
    return 'normal';
  };

  const dueStatusColors: Record<string, string> = {
    overdue: 'border-destructive/60 bg-destructive/5',
    soon: 'border-warning/60 bg-warning/5',
    normal: 'border-border/50 bg-card/50',
    none: 'border-border/50 bg-card/50',
  };

  return (
    <div className="space-y-6 py-4">
      {/* Contact Info */}
      {opp.contact && (
        <div className="rounded-2xl bg-accent/50 p-4 space-y-2">
          <h3 className="font-semibold text-foreground">{opp.contact.name}</h3>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {opp.contact.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{opp.contact.phone}</span>}
            {opp.contact.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{opp.contact.email}</span>}
            {opp.contact.birth_date && <span className="flex items-center gap-1"><Cake className="h-3.5 w-3.5" />{format(new Date(opp.contact.birth_date + 'T00:00:00'), 'dd/MM/yyyy')}</span>}
          </div>
          {opp.contact.tags && opp.contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {opp.contact.tags.map(t => <Badge key={t} variant="secondary" className="text-xs rounded-full">{t}</Badge>)}
            </div>
          )}
        </div>
      )}

      {/* Stage & Status */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={opp.stage_id} onValueChange={v => onMoveStage(opp.id, v)}>
          <SelectTrigger className="w-[200px] rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <Badge variant={opp.status === 'won' ? 'default' : opp.status === 'lost' ? 'destructive' : 'secondary'} className="rounded-full">
          {opp.status === 'won' && <CheckCircle2 className="h-3 w-3 mr-1" />}
          {opp.status === 'lost' && <XCircle className="h-3 w-3 mr-1" />}
          {opportunityStatusLabels[opp.status] ?? opp.status}
        </Badge>
        <Badge variant="outline" className={`rounded-full ${priorityColors[opp.priority ?? 'medium']}`}>{priorityLabels[opp.priority ?? 'medium'] ?? opp.priority}</Badge>
        {(opp.value ?? 0) > 0 && <span className="text-sm font-semibold text-success">R$ {opp.value.toLocaleString('pt-BR')}</span>}
      </div>

      {/* Edit section */}
      {isEditing ? (
        <div className="space-y-3 rounded-2xl border border-border/50 p-4 bg-card/50">
          <div className="space-y-2"><Label>Título</Label><Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="rounded-xl" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Valor (R$)</Label><Input type="number" step="0.01" value={editValue} onChange={e => setEditValue(e.target.value)} className="rounded-xl" /></div>
            <div className="space-y-2"><Label>Prioridade</Label>
              <Select value={editPriority} onValueChange={setEditPriority}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem><SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem><SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label>Próxima ação</Label><Input value={editNextAction} onChange={e => setEditNextAction(e.target.value)} placeholder="Ex: Ligar na segunda" className="rounded-xl" /></div>
          {/* Custom Fields */}
          {customFieldDefs.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-border/50">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campos Personalizados</p>
              <div className="grid grid-cols-2 gap-3">
                {customFieldDefs.map(fd => (
                  <div key={fd.key} className="space-y-1.5">
                    <Label className="text-xs">{fd.label}</Label>
                    {fd.type === 'text' && (
                      <Input value={String(customFieldValues[fd.key] ?? '')} onChange={e => setCustomFieldValues(prev => ({ ...prev, [fd.key]: e.target.value }))} className="rounded-xl h-9" />
                    )}
                    {fd.type === 'number' && (
                      <Input type="number" value={String(customFieldValues[fd.key] ?? '')} onChange={e => setCustomFieldValues(prev => ({ ...prev, [fd.key]: e.target.value ? parseFloat(e.target.value) : '' }))} className="rounded-xl h-9" />
                    )}
                    {fd.type === 'date' && (
                      <Input type="date" value={String(customFieldValues[fd.key] ?? '')} onChange={e => setCustomFieldValues(prev => ({ ...prev, [fd.key]: e.target.value }))} className="rounded-xl h-9" />
                    )}
                    {fd.type === 'select' && (
                      <Select value={String(customFieldValues[fd.key] ?? '')} onValueChange={v => setCustomFieldValues(prev => ({ ...prev, [fd.key]: v }))}>
                        <SelectTrigger className="rounded-xl h-9"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {fd.options?.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {fd.type === 'boolean' && (
                      <div className="flex items-center gap-2 h-9">
                        <Checkbox checked={!!customFieldValues[fd.key]} onCheckedChange={v => setCustomFieldValues(prev => ({ ...prev, [fd.key]: v }))} />
                        <span className="text-sm text-muted-foreground">{customFieldValues[fd.key] ? 'Sim' : 'Não'}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSaveEdit} className="rounded-xl"><Save className="h-4 w-4 mr-1" />Salvar</Button>
            <Button variant="outline" onClick={() => setIsEditing(false)} className="rounded-xl">Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="rounded-xl">Editar Oportunidade</Button>
          {customFieldDefs.length > 0 && Object.keys(customFieldValues).some(k => customFieldValues[k] !== '' && customFieldValues[k] !== undefined && customFieldValues[k] !== null) && (
            <div className="flex flex-wrap gap-1.5">
              {customFieldDefs.map(fd => {
                const val = customFieldValues[fd.key];
                if (val === undefined || val === null || val === '') return null;
                const display = fd.type === 'boolean' ? (val ? 'Sim' : 'Não') : fd.type === 'date' ? String(val).substring(0, 10) : String(val);
                return <Badge key={fd.key} variant="secondary" className="text-xs rounded-full">{fd.label}: {display}</Badge>;
              })}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="flex-1">
        <TabsList className="rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="timeline" className="rounded-lg"><Clock className="h-4 w-4 mr-1" />Timeline</TabsTrigger>
          <TabsTrigger value="chat" className="rounded-lg"><MessageSquare className="h-4 w-4 mr-1" />Chat</TabsTrigger>
          <TabsTrigger value="notes" className="rounded-lg">Notas</TabsTrigger>
          <TabsTrigger value="activities" className="rounded-lg"><CalendarClock className="h-4 w-4 mr-1" />Atividades</TabsTrigger>
        </TabsList>

        {/* ─── Timeline Tab ─── */}
        <TabsContent value="timeline" className="space-y-2">
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin space-y-1 pr-1">
            {timeline.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum evento registrado</p>}
            {timeline.map(item => (
              <div key={item.id} className="flex gap-3 group">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className={cn("h-2 w-2 rounded-full mt-2 shrink-0",
                    item.type === 'message' ? 'bg-primary' :
                    item.type === 'stage_move' ? 'bg-warning' :
                    item.type === 'note' ? 'bg-accent-foreground/50' :
                    'bg-info'
                  )} />
                  <div className="w-px flex-1 bg-border/50" />
                </div>
                {/* Content */}
                <div className="pb-3 flex-1 min-w-0">
                  {item.type === 'message' && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-primary">{item.data.direction === 'inbound' ? '← Recebida' : '→ Enviada'}</span>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(item.timestamp), "dd/MM HH:mm")}</span>
                      </div>
                      <p className="text-xs text-foreground mt-0.5 line-clamp-2">{item.data.content || '[Mídia]'}</p>
                    </div>
                  )}
                  {item.type === 'stage_move' && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-warning">Movido de etapa</span>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(item.timestamp), "dd/MM HH:mm")}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-foreground mt-0.5">
                        <span>{getStageName(item.data.from_stage_id)}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{getStageName(item.data.to_stage_id)}</span>
                        {item.data.is_ai_move && <Badge variant="secondary" className="text-[9px] px-1 py-0 rounded-full">IA</Badge>}
                      </div>
                      {item.data.ai_reason && <p className="text-[10px] text-muted-foreground mt-0.5 italic">{item.data.ai_reason}</p>}
                    </div>
                  )}
                  {item.type === 'note' && (
                    <div>
                      <div className="flex items-center gap-2">
                        <StickyNote className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground">Nota</span>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(item.timestamp), "dd/MM HH:mm")}</span>
                      </div>
                      <p className="text-xs text-foreground mt-0.5">{item.data.description}</p>
                    </div>
                  )}
                  {item.type === 'activity' && (
                    <div>
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-3 w-3 text-info" />
                        <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0">{activityTypeLabels[item.data.type] ?? item.data.type}</Badge>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(item.timestamp), "dd/MM HH:mm")}</span>
                        {item.data.is_completed && <CheckCircle2 className="h-3 w-3 text-primary" />}
                      </div>
                      <p className="text-xs text-foreground mt-0.5">{item.data.title}</p>
                      {item.data.due_date && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Prazo: {format(new Date(item.data.due_date), "dd/MM/yyyy HH:mm")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="chat" className="space-y-4">
          <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-2 rounded-2xl border border-border/50 p-3">
            {messages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda</p>}
            {messages.map(msg => (
              <div key={msg.id} className={cn("flex", msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                <div className={cn("max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                  msg.direction === 'outbound' ? 'gradient-primary text-white' : 'bg-muted text-foreground')}>
                  {msg.content}
                  <div className={cn("text-[10px] mt-1", msg.direction === 'outbound' ? 'text-white/70' : 'text-muted-foreground')}>
                    {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                    {msg.is_ai_generated && ' • IA'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Digite uma mensagem..." className="min-h-[60px] resize-none rounded-xl"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
            <Button size="icon" onClick={handleSendMessage} disabled={sending || !newMessage.trim()} className="rounded-xl h-12 w-12"><Send className="h-4 w-4" /></Button>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <div className="flex gap-2">
            <Input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Adicionar nota interna..." className="rounded-xl"
              onKeyDown={e => { if (e.key === 'Enter') handleAddNote(); }} />
            <Button size="icon" onClick={handleAddNote} className="rounded-xl"><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-2">
            {activities.filter(a => a.type === 'note').map(a => (
              <div key={a.id} className="rounded-2xl border border-border/50 p-3 text-sm bg-card/50">
                <p className="text-foreground">{a.description}</p>
                <p className="text-xs text-muted-foreground mt-1">{format(new Date(a.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="activities" className="space-y-3">
          {showNewActivity ? (
            <div className="rounded-2xl border border-primary/30 p-4 space-y-3 bg-card/50">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={actType} onValueChange={setActType}>
                    <SelectTrigger className="rounded-xl h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="task">Tarefa</SelectItem>
                      <SelectItem value="call">Ligação</SelectItem>
                      <SelectItem value="meeting">Reunião</SelectItem>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data/Hora</Label>
                  <Input type="datetime-local" value={actDueDate} onChange={e => setActDueDate(e.target.value)} className="rounded-xl h-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Título</Label>
                <Input value={actTitle} onChange={e => setActTitle(e.target.value)} placeholder="Ex: Ligar para confirmar proposta" className="rounded-xl h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição (opcional)</Label>
                <Input value={actDescription} onChange={e => setActDescription(e.target.value)} placeholder="Detalhes adicionais..." className="rounded-xl h-9" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreateActivity} disabled={!actTitle.trim() || !actDueDate} className="rounded-xl">
                  <CalendarClock className="h-3.5 w-3.5 mr-1" />Agendar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowNewActivity(false)} className="rounded-xl">Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowNewActivity(true)} className="rounded-xl w-full">
              <Plus className="h-4 w-4 mr-1" />Agendar Atividade
            </Button>
          )}

          {activities.filter(a => a.type !== 'note').map(a => {
            const dueStatus = getActivityDueStatus(a);
            return (
              <div key={a.id} className={cn("rounded-2xl border p-3 text-sm flex items-start gap-3 transition-colors", dueStatusColors[dueStatus], a.is_completed && 'opacity-50')}>
                {!a.is_completed && a.due_date && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-full hover:bg-primary/10"
                    onClick={() => handleCompleteActivity(a.id)} title="Concluir atividade">
                    <Check className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                {a.is_completed && <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] capitalize rounded-full shrink-0">{a.type}</Badge>
                    <p className={cn("font-medium text-foreground truncate", a.is_completed && 'line-through')}>{a.title}</p>
                  </div>
                  {a.description && <p className="text-muted-foreground text-xs mt-0.5">{a.description}</p>}
                  {a.due_date && (
                    <p className={cn("text-xs mt-1",
                      dueStatus === 'overdue' ? 'text-destructive font-semibold' :
                      dueStatus === 'soon' ? 'text-warning font-semibold' :
                      'text-muted-foreground'
                    )}>
                      <CalendarClock className="h-3 w-3 inline mr-1" />
                      {format(new Date(a.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      {dueStatus === 'overdue' && ' — Vencida'}
                      {dueStatus === 'soon' && ' — Em breve'}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{format(new Date(a.created_at), "dd/MM HH:mm")}</span>
              </div>
            );
          })}
          {activities.filter(a => a.type !== 'note').length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma atividade agendada</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
