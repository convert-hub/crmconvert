import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { listUazapiInstances, syncWhatsappHistoryForPhones, type HistorySyncResult } from '@/lib/historySync';

type Instance = { id: string; display_name: string | null; instance_name: string | null };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  filteredPhones?: string[];
  onDone?: () => void;
}

export default function BulkHistorySyncDialog({ open, onOpenChange, tenantId, filteredPhones, onDone }: Props) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string>('');
  const [scope, setScope] = useState<'no_conv' | 'all'>('no_conv');
  const [estimateNoConv, setEstimateNoConv] = useState<number | null>(null);
  const [estimateAll, setEstimateAll] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<HistorySyncResult | null>(null);

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
    if (!open || !instanceId) { setEstimateNoConv(null); setEstimateAll(null); return; }
    (async () => {
      const all = await resolvePhones('all');
      const noConv = await resolvePhones('no_conv');
      setEstimateAll(all.length);
      setEstimateNoConv(noConv.length);
    })();
  }, [open, instanceId, filteredPhones]);

  const resolvePhones = async (effectiveScope: 'all' | 'no_conv'): Promise<string[]> => {
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
    if (effectiveScope === 'no_conv' && instanceId) {
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
      const phones = await resolvePhones(scope);
      if (phones.length === 0) {
        toast.info('Nenhum telefone para processar');
        setRunning(false);
        return;
      }
      setProgress({ done: 0, total: phones.length });
      const res = await syncWhatsappHistoryForPhones(tenantId, instanceId, phones, (done, total) => {
        setProgress({ done, total });
      });
      setResult(res);
      toast.success(`${res.phones_matched} contato(s) com chat · ${res.messages_inserted} mensagem(ns) importadas`);
      onDone?.();
    } catch (e) {
      toast.error('Falha ao importar histórico');
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  const estimate = scope === 'no_conv' ? estimateNoConv : estimateAll;
  const sameEstimate = estimateNoConv !== null && estimateAll !== null && estimateNoConv === estimateAll;

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
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as any)} className="space-y-2">
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="no_conv" id="s1" className="mt-0.5" />
                  <label htmlFor="s1" className="text-sm cursor-pointer leading-tight">
                    Apenas sem conversa nesta instância
                    <span className="block text-[11px] text-muted-foreground">Pula contatos já registrados em conversa no CRM para este número.</span>
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="all" id="s2" className="mt-0.5" />
                  <label htmlFor="s2" className="text-sm cursor-pointer leading-tight">
                    {filteredPhones ? 'Todos os contatos filtrados' : 'Todos os contatos do tenant'}
                    <span className="block text-[11px] text-muted-foreground">Inclui também quem já tem conversa (reprocessa).</span>
                  </label>
                </div>
              </RadioGroup>
            </div>
          )}
          {instanceId && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Estimativa: {estimate ?? '…'} telefone(s) · janela de 30 dias</div>
              {sameEstimate && (
                <div className="text-[11px]">Nenhum contato tem conversa nesta instância ainda — os dois escopos cobrem o mesmo conjunto.</div>
              )}
            </div>
          )}
          {progress && (
            <div className="space-y-1">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <p className="text-xs text-muted-foreground text-center">{progress.done}/{progress.total}</p>
            </div>
          )}
          {result && (
            <div className="text-xs bg-muted/50 rounded p-2 space-y-0.5">
              <div>Chats individuais na instância: <span className="font-medium">{result.chats_listed}</span></div>
              <div>Contatos com chat encontrado: <span className="font-medium">{result.phones_matched}</span> de {result.phones_requested}</div>
              {result.phones_without_chat > 0 && (
                <div className="text-muted-foreground">{result.phones_without_chat} sem histórico armazenado pela UAZAPI</div>
              )}
              <div>{result.messages_inserted} mensagem(ns) importadas{result.messages_skipped ? ` · ${result.messages_skipped} já existiam` : ''}</div>
              {result.errors.length > 0 && <div className="text-destructive">{result.errors.length} falha(s) — ver logs</div>}
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
