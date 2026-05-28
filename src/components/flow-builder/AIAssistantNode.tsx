import { Handle, Position } from '@xyflow/react';
import { Sparkles } from 'lucide-react';

export default function AIAssistantNode({ data }: { data: Record<string, unknown> }) {
  const label = (data.label as string) || 'Assistente IA';
  const model = (data.model as string) || 'google/gemini-3-flash-preview';
  const useRag = !!data.useRag;

  return (
    <div className="rounded-xl border-2 border-violet-500/40 bg-card px-4 py-3 shadow-sm min-w-[220px] max-w-[280px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 shrink-0">
          <Sparkles className="h-3 w-3 text-violet-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-violet-600 font-semibold">Assistente IA</p>
          <p className="text-xs font-medium text-foreground truncate">{label}</p>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
        {model.split('/').pop()}{useRag ? ' · RAG' : ''}
      </p>
      <div className="flex justify-between items-center mt-2 pt-2 border-t border-border/50">
        <div className="flex flex-col items-center gap-0.5 relative">
          <span className="text-[9px] uppercase tracking-wider text-green-600 font-semibold">Sucesso</span>
          <Handle type="source" position={Position.Bottom} id="success" className="!w-2.5 !h-2.5 !bg-green-500 !border-2 !border-card !relative !left-0 !top-0 !translate-x-0 !translate-y-0" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-amber-600 font-semibold">Handoff</span>
          <Handle type="source" position={Position.Bottom} id="handoff" className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-card !relative !left-0 !top-0 !translate-x-0 !translate-y-0" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-rose-600 font-semibold">Inativo</span>
          <Handle type="source" position={Position.Bottom} id="inactivity" className="!w-2.5 !h-2.5 !bg-rose-500 !border-2 !border-card !relative !left-0 !top-0 !translate-x-0 !translate-y-0" />
        </div>
      </div>
    </div>
  );
}
