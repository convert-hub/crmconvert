import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact, Pipeline, Stage } from '@/types/crm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Kanban } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  onCreated?: () => void;
}

export default function CreateOpportunityFromContactDialog({ open, onOpenChange, contact, onCreated }: Props) {
  const { tenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!open || !tenant) return;
    setTitle(`Oportunidade - ${contact.name}`);
    setValue('');
    setSelectedStage('');

    supabase.from('pipelines').select('*').eq('tenant_id', tenant.id).order('position')
      .then(({ data }) => {
        const pipes = (data as unknown as Pipeline[]) ?? [];
        setPipelines(pipes);
        if (pipes.length > 0) {
          const defaultPipe = pipes.find(p => p.is_default) || pipes[0];
          setSelectedPipeline(defaultPipe.id);
        }
      });
  }, [open, tenant, contact]);

  useEffect(() => {
    if (!selectedPipeline || !tenant) return;
    supabase.from('stages').select('*').eq('pipeline_id', selectedPipeline).eq('tenant_id', tenant.id).order('position')
      .then(({ data }) => {
        const stgs = (data as unknown as Stage[]) ?? [];
        setStages(stgs);
        if (stgs.length > 0 && !selectedStage) {
          setSelectedStage(stgs[0].id);
        }
      });
  }, [selectedPipeline, tenant]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !selectedPipeline || !selectedStage) return;
    setLoading(true);

    const { error } = await supabase.from('opportunities').insert({
      tenant_id: tenant.id,
      pipeline_id: selectedPipeline,
      stage_id: selectedStage,
      title,
      value: value ? parseFloat(value) : 0,
      contact_id: contact.id,
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Oportunidade criada no pipeline!');
      onOpenChange(false);
      onCreated?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Kanban className="h-5 w-5 text-primary" />
            Criar Oportunidade
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2">
          Contato: <span className="font-medium text-foreground">{contact.name}</span>
          {contact.phone && <span className="ml-2">· {contact.phone}</span>}
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" />
          </div>
          {pipelines.length > 1 && (
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={selectedPipeline} onValueChange={v => { setSelectedPipeline(v); setSelectedStage(''); }}>
                <SelectTrigger><SelectValue placeholder="Selecione o pipeline" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Etapa no Pipeline</Label>
            <Select value={selectedStage} onValueChange={setSelectedStage}>
              <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
              <SelectContent>
                {stages.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color || '#6366f1' }} />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={loading || !selectedStage}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar Oportunidade
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
