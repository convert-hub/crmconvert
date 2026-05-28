import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ArrowUp, ArrowDown, Zap } from 'lucide-react';
import ActionConfigFields, { ACTION_LABELS } from './ActionConfigFields';

export interface ActionItem { id: string; type: string; config: any }

interface Props {
  tenantId: string | null;
  actions: ActionItem[];
  onChange: (actions: ActionItem[]) => void;
}

const newAction = (): ActionItem => ({
  id: `a-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
  type: 'add_tag',
  config: {},
});

export default function ActionsListEditor({ tenantId, actions, onChange }: Props) {
  const update = (id: string, type: string, config: any) =>
    onChange(actions.map(a => a.id === id ? { ...a, type, config } : a));
  const remove = (id: string) => onChange(actions.filter(a => a.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = actions.findIndex(a => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= actions.length) return;
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {actions.map((a, idx) => (
        <div key={a.id} className="rounded-md border border-border bg-card p-2 space-y-2">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-red-500" />
            <span className="text-[11px] font-medium flex-1">Ação #{idx+1} <span className="text-muted-foreground">— {ACTION_LABELS[a.type] || a.type}</span></span>
            <button onClick={() => move(a.id, -1)} disabled={idx===0} className="p-1 rounded hover:bg-accent disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button onClick={() => move(a.id, 1)} disabled={idx===actions.length-1} className="p-1 rounded hover:bg-accent disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            <button onClick={() => remove(a.id)} className="p-1 rounded hover:bg-accent"><Trash2 className="h-3 w-3 text-muted-foreground" /></button>
          </div>
          <ActionConfigFields
            tenantId={tenantId}
            type={a.type}
            config={a.config}
            onChange={(t, c) => update(a.id, t, c)}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full h-8 text-xs border-dashed" onClick={() => onChange([...actions, newAction()])}>
        <Plus className="h-3 w-3 mr-1" />Adicionar ação
      </Button>
    </div>
  );
}
