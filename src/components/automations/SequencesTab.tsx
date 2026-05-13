import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Clock, MessageSquare, ArrowLeft, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppInstancePicker from '@/components/shared/WhatsAppInstancePicker';

type Seq = {
  id: string;
  name: string;
  description: string | null;
  enrollment_trigger: string;
  exit_on_reply: boolean;
  is_active: boolean;
  whatsapp_instance_id: string | null;
};
type Step = {
  id: string;
  sequence_id: string;
  position: number;
  delay_minutes: number;
  message_type: string;
  content: string | null;
};

export default function SequencesTab() {
  const { tenant } = useAuth();
  const [items, setItems] = useState<Seq[]>([]);
  const [editing, setEditing] = useState<Seq | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('message_sequences').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false });
    setItems((data as Seq[]) ?? []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const loadSteps = async (seqId: string) => {
    const { data } = await supabase.from('sequence_steps').select('*').eq('sequence_id', seqId).order('position');
    setSteps((data as Step[]) ?? []);
  };

  const openSeq = async (s: Seq) => { setEditing(s); await loadSteps(s.id); };

  const create = async () => {
    if (!tenant || !newName.trim()) return;
    const { data, error } = await supabase.from('message_sequences')
      .insert({ tenant_id: tenant.id, name: newName.trim() })
      .select().single();
    if (error) return toast.error(error.message);
    setOpen(false); setNewName('');
    setItems(prev => [data as Seq, ...prev]);
    openSeq(data as Seq);
  };

  const updateSeq = async (patch: Partial<Seq>) => {
    if (!editing) return;
    setEditing({ ...editing, ...patch });
    await supabase.from('message_sequences').update(patch).eq('id', editing.id);
    setItems(prev => prev.map(i => i.id === editing.id ? { ...i, ...patch } : i));
  };

  const removeSeq = async (id: string) => {
    if (!confirm('Excluir sequência e todos os passos?')) return;
    await supabase.from('message_sequences').delete().eq('id', id);
    if (editing?.id === id) setEditing(null);
    load();
  };

  const addStep = async () => {
    if (!editing || !tenant) return;
    const position = steps.length;
    const { data } = await supabase.from('sequence_steps').insert({
      sequence_id: editing.id, tenant_id: tenant.id,
      position, delay_minutes: position === 0 ? 0 : 1440, message_type: 'text', content: '',
    }).select().single();
    if (data) setSteps(prev => [...prev, data as Step]);
  };

  const updateStep = async (id: string, patch: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    await supabase.from('sequence_steps').update(patch).eq('id', id);
  };

  const removeStep = async (id: string) => {
    await supabase.from('sequence_steps').delete().eq('id', id);
    setSteps(prev => prev.filter(s => s.id !== id));
  };

  // ── Editor view ──
  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Input
            value={editing.name}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
            onBlur={() => updateSeq({ name: editing.name })}
            className="h-8 text-sm font-medium border-none bg-transparent focus-visible:ring-1 max-w-sm"
          />
          <div className="ml-auto flex items-center gap-3">
            <Label className="text-xs text-muted-foreground">Ativa</Label>
            <Switch checked={editing.is_active} onCheckedChange={v => updateSeq({ is_active: v })} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 p-3 rounded-lg border border-border bg-card">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada</Label>
            <Select value={editing.enrollment_trigger} onValueChange={v => updateSeq({ enrollment_trigger: v })}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual / via fluxo</SelectItem>
                <SelectItem value="tag_added">Tag adicionada</SelectItem>
                <SelectItem value="lead_created">Lead criado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Número de envio</Label>
            <div className="mt-1">
              <WhatsAppInstancePicker
                value={editing.whatsapp_instance_id}
                onChange={(id) => updateSeq({ whatsapp_instance_id: id })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <Label className="text-xs">Sair se cliente responder</Label>
            <Switch checked={editing.exit_on_reply} onCheckedChange={v => updateSeq({ exit_on_reply: v })} />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Descrição</Label>
            <Input
              value={editing.description ?? ''}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              onBlur={() => updateSeq({ description: editing.description })}
              className="h-8 text-xs mt-1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Passos da sequência</p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addStep}>
              <Plus className="h-3 w-3 mr-1" />Adicionar passo
            </Button>
          </div>
          {steps.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-border rounded-lg">
              <MessageSquare className="h-7 w-7 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">Adicione o primeiro passo</p>
            </div>
          ) : (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={s.id} className="flex gap-2 items-start p-3 rounded-lg border border-border bg-card">
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 mt-1.5" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Passo {i + 1}</span>
                      <span className="text-muted-foreground">·</span>
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <Input
                        type="number" min={0}
                        value={s.delay_minutes}
                        onChange={e => updateStep(s.id, { delay_minutes: Number(e.target.value) })}
                        className="h-7 text-xs w-20"
                      />
                      <span className="text-[11px] text-muted-foreground">min de espera</span>
                    </div>
                    <Textarea
                      value={s.content ?? ''}
                      onChange={e => updateStep(s.id, { content: e.target.value })}
                      placeholder="Mensagem a enviar (use variáveis como {{contact.name}})"
                      className="text-xs min-h-[60px] resize-none"
                    />
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeStep(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
          ⚙️ O disparo automático dos passos acontece via worker em segundo plano. A configuração e os passos já ficam salvos.
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Cadências de mensagens automáticas no WhatsApp (estilo email drip).
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Nova sequência</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Nova sequência</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label className="text-[11px]">Nome</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs mt-1" placeholder="Ex: Onboarding 7 dias" />
              </div>
              <Button className="w-full h-8 text-xs" onClick={create}>Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">Nenhuma sequência criada</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map(s => (
            <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:border-primary/30 cursor-pointer transition-colors" onClick={() => openSeq(s)}>
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                {s.description && <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                  {s.is_active ? 'Ativa' : 'Inativa'}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); removeSeq(s.id); }}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
