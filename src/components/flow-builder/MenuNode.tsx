import { Handle, Position } from '@xyflow/react';
import { List } from 'lucide-react';

interface MenuOption { id: string; label: string; value?: string }

export default function MenuNode({ data }: { data: Record<string, unknown> }) {
  const options = (data.options as MenuOption[]) || [];
  const question = (data.question as string) || 'Menu...';
  const maxRetries = (data.maxRetries as number) ?? 3;

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-card px-4 py-3 shadow-sm min-w-[200px] max-w-[280px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/10 shrink-0">
          <List className="h-3 w-3 text-indigo-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">Menu</p>
          <p className="text-xs font-medium text-foreground truncate">{(data.label as string) || 'Menu'}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{question}</p>

      <div className="mt-2 space-y-0.5">
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center justify-between text-[10px]">
            <span className="text-foreground/80 truncate max-w-[180px]">{i + 1}. {opt.label || `Opção ${i + 1}`}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        {options.length} opções · {maxRetries} tentativas
      </p>

      {/* Per-option handles */}
      {options.map((opt, i) => (
        <Handle
          key={`opt-${opt.id}`}
          type="source"
          position={Position.Bottom}
          id={`option-${opt.id}`}
          className="!w-2.5 !h-2.5 !bg-indigo-500 !border-2 !border-card"
          style={{ left: `${((i + 1) / (options.length + 2)) * 100}%` }}
        />
      ))}
      {/* Invalid (max retries exceeded) handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="invalid"
        className="!w-2.5 !h-2.5 !bg-red-500 !border-2 !border-card"
        style={{ left: `${((options.length + 1) / (options.length + 2)) * 100}%` }}
        title="Tentativas esgotadas"
      />
    </div>
  );
}
