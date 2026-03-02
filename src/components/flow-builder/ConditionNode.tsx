import { Handle, Position } from '@xyflow/react';
import { GitBranch } from 'lucide-react';

export default function ConditionNode({ data }: { data: Record<string, unknown> }) {
  const field = (data.field as string) || 'message';
  const operator = (data.operator as string) || 'contains';
  const value = (data.value as string) || '';
  return (
    <div className="rounded-xl border-2 border-amber-500/40 bg-card px-4 py-3 shadow-sm min-w-[180px] max-w-[260px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-card" />
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10">
          <GitBranch className="h-3 w-3 text-amber-600" strokeWidth={2} />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold">Condição</p>
      </div>
      <p className="text-xs text-foreground font-medium">{(data.label as string) || 'Condição'}</p>
      {value && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {field} {operator} "{value}"
        </p>
      )}
      {/* Two outputs: yes / no */}
      <div className="flex justify-between mt-2 px-2">
        <span className="text-[10px] text-green-600 font-medium">Sim</span>
        <span className="text-[10px] text-red-500 font-medium">Não</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: '30%' }} className="!w-3 !h-3 !bg-green-500 !border-2 !border-card" />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: '70%' }} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
    </div>
  );
}
