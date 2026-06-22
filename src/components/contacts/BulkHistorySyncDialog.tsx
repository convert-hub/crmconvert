import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { listUazapiInstances, syncWhatsappHistoryForPhones } from '@/lib/historySync';

type Instance = { id: string; display_name: string | null; instance_name: string | null };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  /** Telefones já filtrados pela página chamadora. Se omitido, busca todos do tenant. */
  filteredPhones?: string[];
  onDone?: () => void;
}

export default function BulkHistorySyncDialog({ open, onOpenChange, tenantId, filteredPhones, onDone }: Props) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string>('');
  const [scope, setScope] = useState<'no_conv' | 'all'>('no_conv');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ chats: number; messages: number; errors: number; winner?: string | null; fallback?: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setProgress(null);
    listUazapiInstances(tenantId).then(list => {
      setInstances(list);
      if (list.length === 1) setInstanceId(list[0].id);
    });
  }, [open, tenantId]);

  useEffect(() => {
    if (!open || !instanceId) { setEstimate(null); return; }
    (async () => {
      const phones = await resolvePhones();
      setEstimate(phones.length);
    })();
  }, [open, instanceId, scope, filteredPhones]);

  const resolvePhones = async (): Promise<string[]> => {
    let phones: string[] = [];
    if (filteredPhones && filteredPhones.length > 0) {
      phones = filteredPhones.filter(Boolean);
    } else {
      const { data } = await supabase
        .from('contacts')
        .select('phone')
        .eq('tenant_id', tenantId)
        .not('phone', 'is', null)
        .limit(5000);
      phones = (data ?? []).map((r: any) => r.phone).filter(Boolean);
    }
    if (scope === 'no_conv' && instanceId) {
      // Remove telefones que já têm conversation nesta instância
      const { data: convs } = await supabase
        .from('conversations')
        .select('provider_chat_id')
        .eq('tenant_id', tenantId)
        .eq('whatsapp_instance_id', instanceId)
        .limit(10000);
      const withChat = new Set((convs ?? []).map((c: any) => String(c.provider_chat_id || '').split('@')[0]));
      phones = phones.filter(p => !withChat.has(p));
    }
    return phones;
  };

  const run = async () => {
    if (!instanceId) return;
    setRunning(true);
    setResult(null);
    try {
      const phones = await resolvePhones();
      if (phones.length === 0) {
        toast.info('Nenhum telefone para processar');
        setRunning(false);
        return;
      }
      setProgress({ done: 0, total: phones.length });
      const res = await syncWhatsappHistoryForPhones(tenantId, instanceId, phones, (done, total) => {
        setProgress({ done, total });
      });
      setResult({ chats: res.chats_found, messages: res.messages_inserted, errors: res.errors.length, winner: res.winner_variant, fallback: res.fallback_scan });
      toast.success(`Histórico importado: ${res.chats_found} conversa(s), ${res.messages_inserted} mensagem(ns)`);
      onDone?.();
    } catch (e) {
      toast.error('Falha ao importar histórico');
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Importar histórico WhatsApp</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {instances.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma instância UAZAPI ativa neste tenant.</p>
          )}
          {instances.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Número</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {instances.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.display_name || i.instance_name || i.id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {instances.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Escopo</Label>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as any)} className="space-y-1">
                <div className="flex items-center gap-2"><RadioGroupItem value="no_conv" id="s1" /><label htmlFor="s1" className="text-sm cursor-pointer">Apenas contatos sem conversa nesta instância</label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="all" id="s2" /><label htmlFor="s2" className="text-sm cursor-pointer">{filteredPhones ? 'Todos os contatos filtrados' : 'Todos os contatos do tenant'}</label></div>
              </RadioGroup>
            </div>
          )}
          {instanceId && (
            <p className="text-xs text-muted-foreground">Estimativa: {estimate ?? '…'} telefone(s) · janela de 30 dias</p>
          )}
          {progress && (
            <div className="space-y-1">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <p className="text-xs text-muted-foreground text-center">{progress.done}/{progress.total}</p>
            </div>
          )}
          {result && (
            <div className="text-xs bg-muted/50 rounded p-2 space-y-0.5">
              <div>{result.chats} conversa(s) encontradas</div>
              <div>{result.messages} mensagem(ns) importadas</div>
              {result.winner && <div className="text-muted-foreground">variante UAZAPI: {result.winner}</div>}
              {result.fallback && <div className="text-muted-foreground">modo varredura (fallback)</div>}
              {result.errors > 0 && <div className="text-destructive">{result.errors} falha(s)</div>}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running} className="flex-1">Fechar</Button>
            <Button onClick={run} disabled={!instanceId || running || (estimate === 0)} className="flex-1">
              {running ? 'Importando…' : 'Iniciar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
