import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact } from '@/types/crm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageId: string;
  pipelineId: string;
  onCreated: () => void;
}

export default function CreateOpportunityDialog({ open, onOpenChange, stageId, pipelineId, onCreated }: Props) {
  const { tenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (!open || !tenant) return;
    supabase.from('contacts').select('*').eq('tenant_id', tenant.id).order('name').limit(100)
      .then(({ data }) => setContacts((data as unknown as Contact[]) ?? []));
  }, [open, tenant]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    setLoading(true);

    const { error } = await supabase.from('opportunities').insert({
      tenant_id: tenant.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      title,
      value: value ? parseFloat(value) : 0,
      contact_id: contactId || null,
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Oportunidade criada!');
      setTitle('');
      setValue('');
      setContactId('');
      onOpenChange(false);
      onCreated();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Oportunidade</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Ex: Proposta para empresa X" />
          </div>
          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input type="number" step="0.01" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <Label>Contato</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
              <SelectContent>
                {contacts.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar Oportunidade
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
