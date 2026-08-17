import { Handle, Position } from '@xyflow/react';
import { GitBranch } from 'lucide-react';

export default function ConditionNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const criteria = (data.criteria as any[]) || [];
  const combinator = ((data.combinator as string) || 'AND').toUpperCase();
  const hasList = criteria.length > 0;
  const field = (data.field as string) || 'message';
  const operator = (data.operator as string) || 'contains';
  const value = (data.value as string) || '';
  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[190px] max-w-[260px] ${selected ? 'border-amber-500/60 ring-2 ring-amber-500/25' : 'border-border/70'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-card" />
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
          <GitBranch className="h-4 w-4 text-amber-600" strokeWidth={2} />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold">Condição</p>
      </div>
      <p className="text-xs text-foreground font-medium truncate">{(data.label as string) || 'Condição'}</p>
      {hasList ? (
        <p className="text-[11px] text-muted-foreground mt-1">
          {criteria.length} {criteria.length === 1 ? 'critério' : 'critérios'} · {combinator === 'OR' ? 'OU' : 'E'}
        </p>
      ) : value ? (
        <p className="text-[11px] text-muted-foreground mt-1">{field} {operator} "{value}"</p>
      ) : null}
      <div className="flex justify-between mt-2 px-2">
        <span className="text-[10px] text-green-600 font-medium">Sim</span>
        <span className="text-[10px] text-red-500 font-medium">Não</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: '30%' }} className="!w-3 !h-3 !bg-green-500 !border-2 !border-card" />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: '70%' }} className="!w-3 !h-3 !bg-red-500 !border-2 !border-card" />
    </div>
  );
}
