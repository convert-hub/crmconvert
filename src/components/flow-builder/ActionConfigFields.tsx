import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';
import PipelineStagePicker from '@/components/flow-builder/PipelineStagePicker';

export const ACTION_LABELS: Record<string, string> = {
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  assign_agent: 'Atribuir atendente',
  move_stage: 'Mover etapa',
  send_whatsapp: 'Enviar WhatsApp',
  close_conversation: 'Encerrar conversa',
  create_opportunity: 'Criar oportunidade',
};

interface Props {
  tenantId: string | null;
  type: string;
  config: any;
  onChange: (type: string, config: any) => void;
}

export default function ActionConfigFields({ tenantId, type, config, onChange }: Props) {
  const patch = (p: any) => onChange(type, { ...(config || {}), ...p });
  return (
    <div className="space-y-2">
      <Select value={type} onValueChange={(v) => onChange(v, {})}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(ACTION_LABELS).map(([k, l]) => (
            <SelectItem key={k} value={k}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(type === 'add_tag' || type === 'remove_tag') && (
        <TagPickerSelect value={config?.tag ?? ''} onChange={(v) => patch({ tag: v })} />
      )}

      {type === 'send_whatsapp' && (
        <Textarea
          value={config?.message ?? ''}
          onChange={(e) => patch({ message: e.target.value })}
          rows={2} className="text-xs"
          placeholder="Texto da mensagem…"
        />
      )}

      {type === 'move_stage' && (
        <PipelineStagePicker
          tenantId={tenantId}
          pipelineId={config?.pipeline_id}
          stageId={config?.stage_id}
          onChange={(v) => patch(v)}
          requireBoth
        />
      )}

      {type === 'create_opportunity' && (
        <PipelineStagePicker
          tenantId={tenantId}
          pipelineId={config?.pipeline_id}
          stageId={config?.stage_id}
          onChange={(v) => patch(v)}
        />
      )}
    </div>
  );
}
