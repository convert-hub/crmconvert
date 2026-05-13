import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import TagInput from '@/components/contacts/TagInput';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';

type KA = {
  id: string;
  flow_id: string;
  keywords: string[];
  match: 'contains' | 'equals' | 'starts_with';
  case_sensitive: boolean;
  is_active: boolean;
  executions_count: number;
};

type Flow = { id: string; name: string };

const MATCH_LABEL: Record<string, string> = {
  contains: 'Contém',
  equals: 'Igual',
  starts_with: 'Começa com',
};

export default function KeywordsTab() {
  const { tenant } = useAuth();
  const [items, setItems] = useState<KA[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [open, setOpen] = useState(false);
  const [newFlowId, setNewFlowId] = useState<string>('');
  const [newKeywordsText, setNewKeywordsText] = useState<string>('');
  const [newMatch, setNewMatch] = useState<KA['match']>('contains');

  const load = async () => {
    if (!tenant) return;
    const [{ data: kw }, { data: fl }] = await Promise.all([
      supabase.from('keyword_automations').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('chatbot_flows').select('id, name').eq('tenant_id', tenant.id).order('name'),
    ]);
    setItems((kw as KA[]) ?? []);
    setFlows((fl as Flow[]) ?? []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const flowName = (id: string) => flows.find(f => f.id === id)?.name ?? '—';

  const update = async (id: string, patch: Partial<KA>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    const { error } = await supabase.from('keyword_automations').update(patch).eq('id', id);
    if (error) { toast.error(error.message); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm('Remover esta regra?')) return;
    await supabase.from('keyword_automations').delete().eq('id', id);
    load();
  };

  const create = async () => {
    if (!tenant) return;
    if (!newFlowId) { toast.error('Selecione um fluxo'); return; }
    const parsed = newKeywordsText.split(/[;\n,]/).map(s => s.trim()).filter(Boolean);
    if (parsed.length === 0) { toast.error('Informe ao menos uma palavra-chave'); return; }
    const { error } = await supabase.from('keyword_automations').insert({
      tenant_id: tenant.id, flow_id: newFlowId,
      keywords: parsed, match: newMatch, is_active: true,
    });
    if (error) return toast.error(error.message);
    setOpen(false); setNewFlowId(''); setNewKeywordsText(''); setNewMatch('contains');
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Dispare fluxos quando o cliente enviar palavras-chave específicas.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Nova regra</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Nova regra de palavra-chave</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label className="text-[11px]">Fluxo a disparar</Label>
                <Select value={newFlowId} onValueChange={setNewFlowId}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
                  <SelectContent>
                    {flows.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Comparação</Label>
                <Select value={newMatch} onValueChange={v => setNewMatch(v as KA['match'])}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contém</SelectItem>
                    <SelectItem value="equals">Igual</SelectItem>
                    <SelectItem value="starts_with">Começa com</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Palavras-chave</Label>
                <Textarea
                  className="mt-1 text-xs min-h-[72px]"
                  placeholder="agendar; preço; horário"
                  value={newKeywordsText}
                  onChange={e => setNewKeywordsText(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Separe com ; , ou nova linha.</p>
              </div>
              <Button className="w-full h-8 text-xs" onClick={create}>Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Zap className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">Nenhuma palavra-chave configurada</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] h-9">Fluxo</TableHead>
                <TableHead className="text-[11px] h-9 w-32">Modo</TableHead>
                <TableHead className="text-[11px] h-9">Palavras-chave</TableHead>
                <TableHead className="text-[11px] h-9 w-20">Case</TableHead>
                <TableHead className="text-[11px] h-9 w-20">Ativa</TableHead>
                <TableHead className="text-[11px] h-9 w-20 text-right">Disparos</TableHead>
                <TableHead className="text-[11px] h-9 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="text-xs font-medium py-2">{flowName(it.flow_id)}</TableCell>
                  <TableCell className="py-2">
                    <Select value={it.match} onValueChange={v => update(it.id, { match: v as KA['match'] })}>
                      <SelectTrigger className="h-7 text-[11px] border-none bg-transparent hover:bg-accent px-2 -mx-2 w-fit gap-1">
                        <SelectValue>{MATCH_LABEL[it.match]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contains">Contém</SelectItem>
                        <SelectItem value="equals">Igual</SelectItem>
                        <SelectItem value="starts_with">Começa com</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="py-2 max-w-md">
                    <TagInput value={it.keywords} onChange={v => update(it.id, { keywords: v })} />
                  </TableCell>
                  <TableCell className="py-2">
                    <Switch checked={it.case_sensitive} onCheckedChange={v => update(it.id, { case_sensitive: v })} />
                  </TableCell>
                  <TableCell className="py-2">
                    <Switch checked={it.is_active} onCheckedChange={v => update(it.id, { is_active: v })} />
                  </TableCell>
                  <TableCell className="py-2 text-right text-xs tabular-nums">{it.executions_count}</TableCell>
                  <TableCell className="py-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(it.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
