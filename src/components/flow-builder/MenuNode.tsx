import { Handle, Position } from '@xyflow/react';
import { List } from 'lucide-react';

interface MenuOption { id: string; label: string; value?: string }

export default function MenuNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const options = (data.options as MenuOption[]) || [];
  const question = (data.question as string) || 'Menu...';
  const maxRetries = (data.maxRetries as number) ?? 3;

  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[200px] max-w-[280px] ${selected ? 'border-indigo-500/60 ring-2 ring-indigo-500/25' : 'border-border/70'}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-card" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 shrink-0">
          <List className="h-4 w-4 text-indigo-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">Menu</p>
          <p className="text-xs font-medium text-foreground truncate">{(data.label as string) || 'Menu'}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{question}</p>

      {/* Uma saída por opção, alinhada à própria linha */}
      <div className="mt-2 space-y-1">
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="text-foreground/80 truncate max-w-[180px]">{i + 1}. {opt.label || `Opção ${i + 1}`}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={`option-${opt.id}`}
              className="!w-2.5 !h-2.5 !bg-indigo-500 !border-2 !border-card !relative !left-0 !top-0 !translate-x-0 !translate-y-0 !-mr-[21px]"
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-red-500/80 truncate">Tentativas esgotadas ({maxRetries})</span>
          <Handle
            type="source"
            position={Position.Right}
            id="invalid"
            className="!w-2.5 !h-2.5 !bg-red-500 !border-2 !border-card !relative !left-0 !top-0 !translate-x-0 !translate-y-0 !-mr-[21px]"
          />
        </div>
      </div>
    </div>
  );
}
