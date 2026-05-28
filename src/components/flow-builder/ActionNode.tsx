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
  const actions = (data.actions as any[]) || [];
  const hasList = actions.length > 0;
  return (
    <div className="rounded-xl border-2 border-red-500/40 bg-card px-4 py-3 shadow-sm min-w-[160px] max-w-[260px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10">
          <Zap className="h-3 w-3 text-red-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-red-600 font-semibold">Ação</p>
          <p className="text-xs font-medium text-foreground truncate">
            {(data.label as string) || (hasList ? `${actions.length} ${actions.length === 1 ? 'ação' : 'ações'}` : ACTION_LABELS[actionType] || actionType)}
          </p>
        </div>
      </div>
      {hasList && (
        <ul className="mt-1.5 space-y-0.5">
          {actions.slice(0, 3).map((a, i) => (
            <li key={i} className="text-[10px] text-muted-foreground truncate">• {ACTION_LABELS[a.type] || a.type}</li>
          ))}
          {actions.length > 3 && <li className="text-[10px] text-muted-foreground">+ {actions.length - 3}…</li>}
        </ul>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
    </div>
  );
}
