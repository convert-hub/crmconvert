import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact } from '@/types/crm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Search, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedContact?: Contact | null;
}

interface Instance {
  id: string;
  display_name: string | null;
  instance_name: string | null;
  provider: string | null;
}

export default function StartConversationDialog({ open, onOpenChange, preselectedContact }: Props) {
  const { tenant, membership } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [channel, setChannel] = useState<string>('whatsapp');
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !tenant || preselectedContact) return;
    let query = supabase.from('contacts').select('*').eq('tenant_id', tenant.id).order('name').limit(100);
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    query.then(({ data }) => setContacts((data as unknown as Contact[]) ?? []));
  }, [open, tenant, search, preselectedContact]);

  useEffect(() => {
    if (preselectedContact) setSelectedContactId(preselectedContact.id);
  }, [preselectedContact]);

  // Carrega instâncias WhatsApp ativas do tenant
  useEffect(() => {
    if (!open || !tenant) return;
    supabase.from('whatsapp_instances')
      .select('id, display_name, instance_name, provider')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .then(({ data }) => {
        const list = (data as Instance[] | null) ?? [];
        setInstances(list);
        if (list.length === 1) setInstanceId(list[0].id);
        else if (list.length === 0) setInstanceId('');
      });
  }, [open, tenant]);

  const handleStart = async () => {
    if (!tenant || !membership || !selectedContactId) return;
    if (channel === 'whatsapp' && instances.length > 1 && !instanceId) {
      toast.error('Selecione o número de envio.');
      return;
    }
    setLoading(true);
    try {
      // Procura conversa aberta deste contato
      const { data: openConvs } = await supabase.from('conversations')
        .select('id, whatsapp_instance_id')
        .eq('tenant_id', tenant.id).eq('contact_id', selectedContactId)
        .in('status', ['open', 'waiting_customer', 'waiting_agent']);

      const list = (openConvs as any[]) ?? [];
      // 1) Já existe conversa nesta MESMA instância → reaproveita
      const sameInstance = list.find(c =>
        channel === 'whatsapp' ? (c.whatsapp_instance_id ?? null) === (instanceId || null) : true
      );
      if (sameInstance) {
        toast.info('Conversa já existente, abrindo...');
        onOpenChange(false);
        navigate(`/inbox?conv=${sameInstance.id}`);
        return;
      }
      // 2) Existe em outra instância → confirma abrir paralela
      if (list.length > 0 && channel === 'whatsapp') {
        const otherInst = list[0].whatsapp_instance_id;
        const otherName = instances.find(i => i.id === otherInst)?.display_name
          ?? instances.find(i => i.id === otherInst)?.instance_name
          ?? 'outro número';
        const ok = window.confirm(
          `Este contato já tem uma conversa aberta em "${otherName}". Deseja abrir uma conversa paralela no número selecionado?`
        );
        if (!ok) { setLoading(false); return; }
      }

      const insertPayload: any = {
        tenant_id: tenant.id, contact_id: selectedContactId, channel: channel as any,
        status: 'open', assigned_to: membership.id,
      };
      if (channel === 'whatsapp' && instanceId) insertPayload.whatsapp_instance_id = instanceId;

      const { data: conv, error } = await supabase.from('conversations').insert(insertPayload)
        .select('id').single();

      if (error) { toast.error(error.message); return; }
      toast.success('Conversa iniciada!');
      onOpenChange(false);
      navigate(`/inbox?conv=${(conv as any).id}`);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao iniciar conversa');
    } finally {
      setLoading(false);
    }
  };

  const contactList = preselectedContact ? [preselectedContact] : contacts;
  const showInstanceSelector = channel === 'whatsapp' && instances.length > 1;
  const providerLabel = (p: string | null) => p === 'meta_cloud' ? 'Oficial' : 'UAZAPI';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />Nova Conversa
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!preselectedContact && (
            <div className="space-y-2">
              <Label>Contato</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9 rounded-xl" placeholder="Buscar contato..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="max-h-48 overflow-y-auto border border-border/50 rounded-xl">
                {contactList.map(c => (
                  <button key={c.id} onClick={() => setSelectedContactId(c.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors ${selectedContactId === c.id ? 'bg-accent' : ''}`}>
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone || c.email || 'Sem contato'}</div>
                  </button>
                ))}
                {contactList.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">Nenhum contato</p>}
              </div>
            </div>
          )}
          {preselectedContact && (
            <div className="p-3 bg-accent/30 rounded-xl">
              <div className="font-medium text-sm text-foreground">{preselectedContact.name}</div>
              <div className="text-xs text-muted-foreground">{preselectedContact.phone || preselectedContact.email}</div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Canal</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Telefone</SelectItem>
                <SelectItem value="web">Web</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showInstanceSelector && (
            <div className="space-y-2">
              <Label>Número de envio</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Escolha o número" /></SelectTrigger>
                <SelectContent>
                  {instances.map(i => (
                    <SelectItem key={i.id} value={i.id}>
                      {(i.display_name || i.instance_name || i.id.slice(0, 8))} · {providerLabel(i.provider)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {channel === 'whatsapp' && instances.length === 0 && (
            <p className="text-xs text-warning">Nenhuma instância de WhatsApp ativa. A conversa será criada, mas sem provider vinculado.</p>
          )}
          <Button onClick={handleStart} disabled={!selectedContactId || loading} className="w-full rounded-xl">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
            Iniciar Conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
