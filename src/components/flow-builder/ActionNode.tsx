import { Handle, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';

const ACTION_LABELS: Record<string, string> = {
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  assign_agent: 'Atribuir atendente',
  move_stage: 'Mover etapa',
  send_whatsapp: 'Enviar WhatsApp',
  close_conversation: 'Encerrar conversa',
  create_opportunity: 'Criar oportunidade',
};

export default function ActionNode({ data }: { data: Record<string, unknown> }) {
  const actionType = (data.actionType as string) || 'add_tag';
  return (
    <div className="rounded-xl border-2 border-red-500/40 bg-card px-4 py-3 shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10">
          <Zap className="h-3 w-3 text-red-600" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-red-600 font-semibold">Ação</p>
          <p className="text-xs font-medium text-foreground">{(data.label as string) || ACTION_LABELS[actionType] || actionType}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
    </div>
  );
}
