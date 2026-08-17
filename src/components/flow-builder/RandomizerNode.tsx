import { Handle, Position } from '@xyflow/react';
import { Shuffle } from 'lucide-react';

interface RandomizerOption {
  id?: string; // opções antigas (pré-16/08) não têm id; o handle cai no formato por índice
  label: string;
  weight: number;
}

export default function RandomizerNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const mode = (data.mode as string) || 'random';
  const options = (data.options as RandomizerOption[]) || [];

  return (
    <div className={`rounded-xl border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow min-w-[190px] ${selected ? 'border-cyan-500/60 ring-2 ring-cyan-500/25' : 'border-border/70'}`}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-card" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 shrink-0">
          <Shuffle className="h-4 w-4 text-cyan-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-cyan-600 font-semibold">Randomizador</p>
          <p className="text-xs font-medium text-foreground truncate">{(data.label as string) || 'Randomizador'}</p>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        {mode === 'random' ? 'Aleatório' : 'Sequencial'} · {options.length} opções
      </p>
      {options.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="text-foreground/70 truncate max-w-[120px]">{opt.label || `Opção ${i + 1}`}</span>
              {mode === 'random' && <span className="text-cyan-600 font-medium">{opt.weight}%</span>}
            </div>
          ))}
        </div>
      )}
      {/* Multiple output handles - one per option (id estável quando a opção tem id) */}
      {options.map((opt, i) => (
        <Handle
          key={opt.id ? `opt-${opt.id}` : `option-${i}`}
          type="source"
          position={Position.Bottom}
          id={opt.id ? `opt-${opt.id}` : `option-${i}`}
          className="!w-2.5 !h-2.5 !bg-cyan-500 !border-2 !border-card"
          style={{
            left: `${((i + 1) / (options.length + 1)) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
