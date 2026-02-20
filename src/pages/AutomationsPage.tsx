import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Zap, Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const TRIGGER_LABELS: Record<string, string> = {
  lead_created: 'Lead criado',
  opportunity_stage_changed: 'Oportunidade mudou de etapa',
  conversation_no_customer_reply: 'Sem resposta do cliente',
  conversation_no_agent_reply: 'Sem resposta do atendente',
  conversation_closed: 'Conversa encerrada',
  tag_added: 'Tag adicionada',
  tag_removed: 'Tag removida',
};

const TRIGGER_VALUES = Object.keys(TRIGGER_LABELS);

interface Automation {
  id: string;
  name: string;
  trigger_type: string;
  conditions: Record<string, unknown>;
  actions: unknown[];
  is_active: boolean;
  created_at: string;
}

export default function AutomationsPage() {
  const { tenant } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState(TRIGGER_VALUES[0]);
  const [conditionsJson, setConditionsJson] = useState('{}');
  const [actionsJson, setActionsJson] = useState('[]');

  const load = () => {
    if (!tenant) return;
    supabase.from('automations').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false })
      .then(({ data }) => setAutomations((data as unknown as Automation[]) ?? []));
  };

  useEffect(() => { load(); }, [tenant]);

  const resetForm = () => {
    setName(''); setTriggerType(TRIGGER_VALUES[0]); setConditionsJson('{}'); setActionsJson('[]'); setEditId(null);
  };

  const openEdit = (a: Automation) => {
    setEditId(a.id);
    setName(a.name);
    setTriggerType(a.trigger_type);
    setConditionsJson(JSON.stringify(a.conditions, null, 2));
    setActionsJson(JSON.stringify(a.actions, null, 2));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenant || !name.trim()) return;
    let conditions: Record<string, unknown>, actions: unknown[];
    try { conditions = JSON.parse(conditionsJson); } catch { toast.error('JSON de condições inválido'); return; }
    try { actions = JSON.parse(actionsJson); } catch { toast.error('JSON de ações inválido'); return; }

    if (editId) {
      const { error } = await supabase.from('automations').update({
        name,
        trigger_type: triggerType as any,
        conditions: conditions as any,
        actions: actions as any,
      }).eq('id', editId);
      if (error) toast.error(error.message); else toast.success('Automação atualizada');
    } else {
      const { error } = await supabase.from('automations').insert({
        tenant_id: tenant.id,
        name,
        trigger_type: triggerType as any,
        conditions: conditions as any,
        actions: actions as any,
      });
      if (error) toast.error(error.message); else toast.success('Automação criada');
    }
    setDialogOpen(false);
    resetForm();
    load();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('automations').update({ is_active: active }).eq('id', id);
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_active: active } : a));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('automations').delete().eq('id', id);
    toast.success('Automação removida');
    load();
  };

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automações</h1>
          <p className="text-sm text-muted-foreground mt-1">Motor de regras event-driven por tenant</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { if (!v) resetForm(); setDialogOpen(v); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" />Nova Automação</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{editId ? 'Editar' : 'Nova'} Automação</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Follow-up automático" />
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_VALUES.map(t => <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Condições (JSON)</Label>
                <Textarea value={conditionsJson} onChange={e => setConditionsJson(e.target.value)} className="font-mono text-xs min-h-[80px]" />
              </div>
              <div className="space-y-2">
                <Label>Ações (JSON array)</Label>
                <Textarea value={actionsJson} onChange={e => setActionsJson(e.target.value)} className="font-mono text-xs min-h-[80px]" />
              </div>
              <Button className="w-full" onClick={handleSave}>Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {automations.map(a => (
          <Card key={a.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <Zap className="h-5 w-5 text-warning" />
                <div>
                  <p className="font-medium">{a.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">{TRIGGER_LABELS[a.trigger_type] ?? a.trigger_type}</Badge>
                    <span className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'dd/MM/yyyy')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={a.is_active} onCheckedChange={v => toggleActive(a.id, v)} />
                <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {automations.length === 0 && (
          <p className="text-center text-muted-foreground py-12">Nenhuma automação configurada</p>
        )}
      </div>
    </div>
  );
}
