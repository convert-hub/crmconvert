import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Opportunity, Contact, Stage, Message, Activity } from '@/types/crm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Phone, Mail, MessageSquare, Plus, CheckCircle2, XCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  opportunityId: string;
  stages: Stage[];
  onMoveStage: (oppId: string, stageId: string) => void;
  onClose: () => void;
}

export default function OpportunityDetail({ opportunityId, stages, onMoveStage, onClose }: Props) {
  const { tenant, membership } = useAuth();
  const [opp, setOpp] = useState<Opportunity & { contact?: Contact } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [newNote, setNewNote] = useState('');
  const [sending, setSending] = useState(false);

  // Edit state
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editNextAction, setEditNextAction] = useState('');
  const [isEditing, setIsEditing] = useState(false);

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
        }
      });

    supabase.from('conversations').select('id').eq('opportunity_id', opportunityId).limit(1)
      .then(({ data: convs }) => {
        if (convs && convs.length > 0) {
          supabase.from('messages').select('*').eq('conversation_id', convs[0].id).order('created_at')
            .then(({ data }) => setMessages((data as unknown as Message[]) ?? []));
        }
      });

    supabase.from('activities').select('*').eq('opportunity_id', opportunityId).order('created_at', { ascending: false })
      .then(({ data }) => setActivities((data as unknown as Activity[]) ?? []));
  }, [opportunityId]);

  useEffect(() => {
    const channel = supabase.channel(`opp-messages-${opportunityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => [...prev, payload.new as unknown as Message]);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [opportunityId]);

  const handleSaveEdit = async () => {
    if (!opp) return;
    const { error } = await supabase.from('opportunities').update({
      title: editTitle,
      value: parseFloat(editValue) || 0,
      priority: editPriority as any,
      next_action: editNextAction || null,
    }).eq('id', opp.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Oportunidade atualizada');
    setOpp(prev => prev ? { ...prev, title: editTitle, value: parseFloat(editValue) || 0, priority: editPriority as any, next_action: editNextAction } : null);
    setIsEditing(false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !tenant || !membership) return;
    setSending(true);
    let convId: string;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('opportunity_id', opportunityId).limit(1);
    if (existingConv && existingConv.length > 0) {
      convId = existingConv[0].id;
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        tenant_id: tenant.id, contact_id: opp?.contact_id, opportunity_id: opportunityId,
        channel: 'whatsapp', status: 'open', assigned_to: membership.id,
      }).select().single();
      convId = newConv!.id;
    }
    await supabase.from('messages').insert({
      tenant_id: tenant.id, conversation_id: convId, direction: 'outbound',
      content: newMessage, sender_membership_id: membership.id,
    });
    if (opp?.contact?.phone) {
      await supabase.rpc('enqueue_job', {
        _type: 'send_whatsapp', _payload: JSON.stringify({ phone: opp.contact.phone, message: newMessage, conversation_id: convId }),
        _tenant_id: tenant.id, _idempotency_key: `wha-${convId}-${Date.now()}`,
      });
    }
    setNewMessage(''); setSending(false); toast.success('Mensagem enviada');
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

  if (!opp) return <div className="p-6 text-center text-muted-foreground">Carregando...</div>;

  const priorityColors: Record<string, string> = {
    low: 'bg-muted text-muted-foreground', medium: 'bg-info/10 text-info', high: 'bg-warning/10 text-warning', urgent: 'bg-destructive/10 text-destructive',
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
          {opp.status}
        </Badge>
        <Badge variant="outline" className={`rounded-full capitalize ${priorityColors[opp.priority ?? 'medium']}`}>{opp.priority ?? 'medium'}</Badge>
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
          <div className="flex gap-2">
            <Button onClick={handleSaveEdit} className="rounded-xl"><Save className="h-4 w-4 mr-1" />Salvar</Button>
            <Button variant="outline" onClick={() => setIsEditing(false)} className="rounded-xl">Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="rounded-xl">Editar Oportunidade</Button>
      )}

      {/* Tabs */}
      <Tabs defaultValue="chat" className="flex-1">
        <TabsList className="rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="chat" className="rounded-lg"><MessageSquare className="h-4 w-4 mr-1" />Chat</TabsTrigger>
          <TabsTrigger value="notes" className="rounded-lg">Notas</TabsTrigger>
          <TabsTrigger value="activities" className="rounded-lg">Atividades</TabsTrigger>
        </TabsList>

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

        <TabsContent value="activities" className="space-y-2">
          {activities.filter(a => a.type !== 'note').map(a => (
            <div key={a.id} className="rounded-2xl border border-border/50 p-3 text-sm flex items-center gap-3 bg-card/50">
              <Badge variant="outline" className="text-xs capitalize rounded-full">{a.type}</Badge>
              <div className="flex-1">
                <p className="font-medium text-foreground">{a.title}</p>
                {a.description && <p className="text-muted-foreground text-xs">{a.description}</p>}
              </div>
              <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), "dd/MM HH:mm")}</span>
            </div>
          ))}
          {activities.filter(a => a.type !== 'note').length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma atividade</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
