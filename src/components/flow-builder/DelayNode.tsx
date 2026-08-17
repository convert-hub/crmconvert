import { Handle, Position } from '@xyflow/react';
import { Clock } from 'lucide-react';

export default function DelayNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const minutes = (data.delayMinutes as number) || 5;
  const display = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}min`;
  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[150px] ${selected ? 'border-purple-500/60 ring-2 ring-purple-500/25' : 'border-border/70'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-card" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
          <Clock className="h-4 w-4 text-purple-600" strokeWidth={2} />
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
