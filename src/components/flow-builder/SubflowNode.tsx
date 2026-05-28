import { Handle, Position } from '@xyflow/react';
import { GitMerge } from 'lucide-react';

export default function SubflowNode({ data }: { data: Record<string, unknown> }) {
  const targetName = (data.targetFlowName as string) || (data.targetFlowId ? 'Fluxo vinculado' : 'Nenhum fluxo');
  const mode = (data.mode as string) || 'call';

  return (
    <div className="rounded-xl border-2 border-fuchsia-500/40 bg-card px-4 py-3 shadow-sm min-w-[200px] max-w-[260px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-fuchsia-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-fuchsia-500/10 shrink-0">
          <GitMerge className="h-3 w-3 text-fuchsia-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-fuchsia-600 font-semibold">Conectar fluxo</p>
          <p className="text-xs font-medium text-foreground truncate">{targetName}</p>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        {mode === 'transfer' ? 'Transferir (encerra atual)' : 'Chamar (continua depois)'}
      </p>
      {mode === 'call' && (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-fuchsia-500 !border-2 !border-card" />
      )}
    </div>
  );
}
