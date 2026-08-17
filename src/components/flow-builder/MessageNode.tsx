import { Handle, Position } from '@xyflow/react';
import { MessageSquare, FileCheck2, Layers } from 'lucide-react';

export default function MessageNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const content = (data.content as string) || '';
  const mode = (data.mode as string) || 'text';
  const isTemplate = mode === 'template';
  const isItems = mode === 'items';
  const items = (data.items as any[]) || [];
  const templateName = (data.templateName as string) || '';
  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[190px] max-w-[260px] ${selected ? 'border-blue-500/60 ring-2 ring-blue-500/25' : 'border-border/70'}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-card" />
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
          {isTemplate ? <FileCheck2 className="h-4 w-4 text-blue-600" strokeWidth={2} />
            : isItems ? <Layers className="h-4 w-4 text-blue-600" strokeWidth={2} />
            : <MessageSquare className="h-4 w-4 text-blue-600" strokeWidth={2} />}
        </div>
        <p className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">
          {isTemplate ? 'Template Meta' : isItems ? 'Conteúdo' : 'Mensagem'}
        </p>
      </div>
      <p className="text-xs text-foreground font-medium truncate">{(data.label as string) || (isTemplate ? 'Template' : isItems ? 'Conteúdo' : 'Mensagem')}</p>
      {isTemplate && templateName && <p className="text-[11px] text-muted-foreground mt-1 truncate">📋 {templateName}</p>}
      {isItems && <p className="text-[11px] text-muted-foreground mt-1">{items.length} {items.length === 1 ? 'item' : 'itens'}</p>}
      {!isTemplate && !isItems && content && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{content}</p>}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-card" />
    </div>
  );
}
