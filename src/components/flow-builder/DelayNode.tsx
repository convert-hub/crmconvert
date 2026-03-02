import { Handle, Position } from '@xyflow/react';
import { Clock } from 'lucide-react';

export default function DelayNode({ data }: { data: Record<string, unknown> }) {
  const minutes = (data.delayMinutes as number) || 5;
  const display = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}min`;
  return (
    <div className="rounded-xl border-2 border-purple-500/40 bg-card px-4 py-3 shadow-sm min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/10">
          <Clock className="h-3 w-3 text-purple-600" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-purple-600 font-semibold">Atraso</p>
          <p className="text-xs font-medium text-foreground">{display}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-card" />
    </div>
  );
}
