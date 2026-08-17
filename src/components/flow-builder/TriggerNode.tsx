import { Handle, Position } from '@xyflow/react';
import { Play } from 'lucide-react';

export default function TriggerNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[170px] ${selected ? 'border-green-500/60 ring-2 ring-green-500/25' : 'border-border/70'}`}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
          <Play className="h-4 w-4 text-green-600" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-green-600 font-semibold">Gatilho</p>
          <p className="text-xs font-medium text-foreground">{(data.label as string) ?? 'Início'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-green-500 !border-2 !border-card" />
    </div>
  );
}
