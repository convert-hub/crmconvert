import { Handle, Position } from '@xyflow/react';
import { MessageSquare, FileCheck2 } from 'lucide-react';

export default function MessageNode({ data }: { data: Record<string, unknown> }) {
  const content = (data.content as string) || '';
  const mode = (data.mode as string) || 'text';
  const isTemplate = mode === 'template';
  const templateName = (data.templateName as string) || '';
  return (
    <div className="rounded-xl border-2 border-blue-500/40 bg-card px-4 py-3 shadow-sm min-w-[180px] max-w-[260px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-card" />
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10">
          {isTemplate ? <FileCheck2 className="h-3 w-3 text-blue-600" strokeWidth={2} /> : <MessageSquare className="h-3 w-3 text-blue-600" strokeWidth={2} />}
        </div>
        <p className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">
          {isTemplate ? 'Template Meta' : 'Mensagem'}
        </p>
      </div>
      <p className="text-xs text-foreground font-medium truncate">{(data.label as string) || (isTemplate ? 'Template' : 'Mensagem')}</p>
      {isTemplate && templateName && <p className="text-[11px] text-muted-foreground mt-1 truncate">📋 {templateName}</p>}
      {!isTemplate && content && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{content}</p>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-card" />
    </div>
  );
}
