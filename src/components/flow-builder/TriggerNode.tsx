import { Handle, Position } from '@xyflow/react';
import { Play } from 'lucide-react';

export default function TriggerNode({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-xl border-2 border-green-500/40 bg-card px-4 py-3 shadow-sm min-w-[160px]">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-500/10">
          <Play className="h-3.5 w-3.5 text-green-600" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-green-600 font-semibold">Gatilho</p>
          <p className="text-xs font-medium text-foreground">{(data.label as string) ?? 'Início'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500 !border-2 !border-card" />
    </div>
  );
}
