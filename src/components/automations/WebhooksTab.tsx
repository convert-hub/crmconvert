import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { toast } from 'sonner';
import WebhookEditor from './WebhookEditor';

export type Webhook = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  secret: string;
  flow_id: string | null;
  is_active: boolean;
  test_mode: boolean;
  sample_payload: any;
  sample_received_at: string | null;
  request_history: any[];
  actions: any[];
  whatsapp_instance_id: string | null;
};

function genSlug() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
function genSecret() {
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  return 'whsec_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function WebhooksTab() {
  const { tenant } = useAuth();
  const [items, setItems] = useState<Webhook[]>([]);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('webhook_endpoints').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false });
    setItems((data as Webhook[]) ?? []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const create = async () => {
    if (!tenant || !newName.trim()) return;
    const { data, error } = await supabase.from('webhook_endpoints').insert({
      tenant_id: tenant.id, name: newName.trim(),
      slug: genSlug(), secret: genSecret(), test_mode: true, is_active: true,
    }).select().single();
    if (error) return toast.error(error.message);
    setOpen(false); setNewName('');
    setItems(prev => [data as Webhook, ...prev]);
    setEditing(data as Webhook);
  };

  const remove = async (id: string) => {
    if (!confirm('Excluir webhook? A URL deixará de funcionar.')) return;
    await supabase.from('webhook_endpoints').delete().eq('id', id);
    if (editing?.id === id) setEditing(null);
    load();
  };

  if (editing) {
    return <WebhookEditor webhook={editing} onChange={(w) => { setEditing(w); setItems(prev => prev.map(i => i.id === w.id ? w : i)); }} onBack={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Endpoints públicos para receber eventos de qualquer sistema externo.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Novo webhook</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Novo webhook</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label className="text-[11px]">Nome interno</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs mt-1" placeholder="Ex: Formulário Site Principal" />
              </div>
              <Button className="w-full h-8 text-xs" onClick={create}>Criar e configurar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <WebhookIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">Nenhum webhook criado</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map(w => (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:border-primary/30 cursor-pointer transition-colors" onClick={() => setEditing(w)}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{w.name}</p>
                  {w.test_mode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">Teste</span>}
                  {!w.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">/{w.slug}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); remove(w.id); }}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
