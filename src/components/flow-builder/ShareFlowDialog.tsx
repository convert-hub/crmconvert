import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Copy, Link2, Loader2, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  flowId: string;
  flowName: string;
  flowDescription: string;
  triggerType: string;
  triggerConfig: any;
  nodes: any[];
  edges: any[];
}

interface ShareRow {
  id: string;
  token: string;
  title: string | null;
  description: string | null;
  is_active: boolean;
  cloned_count: number;
  created_at: string;
}

const genToken = () =>
  Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export default function ShareFlowDialog(props: Props) {
  const { open, onOpenChange, tenantId, flowId, flowName, flowDescription, triggerType, triggerConfig, nodes, edges } = props;
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [title, setTitle] = useState(flowName);
  const [description, setDescription] = useState(flowDescription || '');
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(flowName);
    setDescription(flowDescription || '');
    (supabase as any).from('flow_shares')
      .select('id, token, title, description, is_active, cloned_count, created_at')
      .eq('flow_id', flowId)
      .order('created_at', { ascending: false })
      .then(({ data }: any) => setShares(data ?? []));
  }, [open, flowId, flowName, flowDescription]);

  const create = async () => {
    setCreating(true);
    const token = genToken();
    const snapshot = {
      name: title || flowName,
      description: description || null,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      nodes,
      edges,
    };
    const { data, error } = await (supabase as any).from('flow_shares').insert({
      tenant_id: tenantId,
      flow_id: flowId,
      token,
      title: title || flowName,
      description: description || null,
      snapshot,
      is_active: active,
    }).select('id, token, title, description, is_active, cloned_count, created_at').single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    setShares(prev => [data as ShareRow, ...prev]);
    toast.success('Template publicado');
  };

  const toggleActive = async (id: string, value: boolean) => {
    setShares(prev => prev.map(s => s.id === id ? { ...s, is_active: value } : s));
    await (supabase as any).from('flow_shares').update({ is_active: value }).eq('id', id);
  };

  const removeShare = async (id: string) => {
    if (!window.confirm('Excluir este link?')) return;
    await (supabase as any).from('flow_shares').delete().eq('id', id);
    setShares(prev => prev.filter(s => s.id !== id));
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/flow/install/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Compartilhar como template</DialogTitle>
          <DialogDescription className="text-xs">
            Gere um link público. Qualquer usuário do Lovable pode instalar este fluxo no próprio workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Título exibido</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="text-xs" />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-2.5">
            <Label className="text-xs">Link ativo</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          <Button onClick={create} disabled={creating} size="sm" className="w-full">
            {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5 mr-1.5" />}
            Gerar novo link
          </Button>
        </div>

        {shares.length > 0 && (
          <div className="space-y-1.5 mt-2 max-h-60 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Links existentes</p>
            {shares.map(s => (
              <div key={s.id} className="rounded-md border border-border p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded truncate flex-1">/flow/install/{s.token}</code>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyLink(s.token)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeShare(s.id)}>
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{s.cloned_count} instalação{s.cloned_count === 1 ? '' : 'es'}</span>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={s.is_active} onCheckedChange={(v) => toggleActive(s.id, v)} />
                    <span>{s.is_active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
