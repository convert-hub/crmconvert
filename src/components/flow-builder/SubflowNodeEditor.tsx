import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface Props {
  tenantId: string | null;
  currentFlowId?: string | null;
  data: any;
  onChange: (data: any) => void;
}

export default function SubflowNodeEditor({ tenantId, currentFlowId, data, onChange }: Props) {
  const [flows, setFlows] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('chatbot_flows').select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .then(({ data }) => setFlows((data ?? []).filter(f => f.id !== currentFlowId)));
  }, [tenantId, currentFlowId]);

  const set = (patch: any) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Fluxo alvo</Label>
        <Select
          value={data.targetFlowId ?? ''}
          onValueChange={(v) => {
            const f = flows.find(x => x.id === v);
            set({ targetFlowId: v, targetFlowName: f?.name ?? '' });
          }}
        >
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
          <SelectContent>
            {flows.length === 0 && <SelectItem value="__empty__" disabled>Nenhum outro fluxo</SelectItem>}
            {flows.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Modo de execução</Label>
        <RadioGroup
          value={data.mode ?? 'call'}
          onValueChange={(v) => set({ mode: v })}
          className="space-y-1.5"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="call" id="m-call" className="mt-0.5" />
            <Label htmlFor="m-call" className="text-xs font-normal cursor-pointer leading-snug">
              <strong>Chamar</strong> — executa o fluxo alvo e continua depois neste fluxo.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="transfer" id="m-transfer" className="mt-0.5" />
            <Label htmlFor="m-transfer" className="text-xs font-normal cursor-pointer leading-snug">
              <strong>Transferir</strong> — entrega o controle ao fluxo alvo e encerra este.
            </Label>
          </div>
        </RadioGroup>
      </div>

      <p className="text-[10px] text-muted-foreground">
        O fluxo alvo precisa estar ativo. Variáveis e contato/conversa atuais são propagados.
      </p>
    </div>
  );
}
