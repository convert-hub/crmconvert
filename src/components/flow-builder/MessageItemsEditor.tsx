import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus, GripVertical, MessageSquare, Image, Video, Mic, File, Clock, BotOff, ArrowUp, ArrowDown } from 'lucide-react';
import { VariableTextarea } from '@/components/shared/VariableField';
import { useSystemVariables } from '@/hooks/useSystemVariables';

export type ContentItem =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'image' | 'video' | 'audio' | 'file'; url: string; caption?: string; filename?: string }
  | { id: string; kind: 'delay'; seconds: number }
  | { id: string; kind: 'autooff' };

const KIND_META: Record<string, { label: string; icon: any; color: string }> = {
  text:    { label: 'Texto',         icon: MessageSquare, color: 'text-blue-500' },
  image:   { label: 'Imagem',        icon: Image,         color: 'text-emerald-500' },
  video:   { label: 'Vídeo',         icon: Video,         color: 'text-purple-500' },
  audio:   { label: 'Áudio',         icon: Mic,           color: 'text-amber-500' },
  file:    { label: 'Arquivo',       icon: File,          color: 'text-slate-500' },
  delay:   { label: 'Atraso',        icon: Clock,         color: 'text-cyan-500' },
  autooff: { label: 'Desligar IA',   icon: BotOff,        color: 'text-red-500' },
};

const newItem = (kind: ContentItem['kind']): ContentItem => {
  const id = `i-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  if (kind === 'text') return { id, kind, content: '' };
  if (kind === 'delay') return { id, kind, seconds: 5 };
  if (kind === 'autooff') return { id, kind };
  return { id, kind, url: '' };
};

interface Props {
  tenantId: string | null;
  items: ContentItem[];
  onChange: (items: ContentItem[]) => void;
}

export default function MessageItemsEditor({ tenantId, items, onChange }: Props) {
  const flowVars = useSystemVariables({ tenantId, scope: 'flow' });
  const [addOpen, setAddOpen] = useState(false);

  const update = (id: string, patch: Partial<ContentItem>) => {
    onChange(items.map(it => it.id === id ? ({ ...it, ...patch } as ContentItem) : it));
  };
  const remove = (id: string) => onChange(items.filter(it => it.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex(it => it.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground text-center py-3 border border-dashed rounded-md">
          Nenhum item ainda. Adicione blocos abaixo.
        </p>
      )}

      {items.map((it, idx) => {
        const meta = KIND_META[it.kind];
        const Icon = meta.icon;
        return (
          <div key={it.id} className="rounded-md border border-border bg-card p-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <Icon className={`h-3.5 w-3.5 ${meta.color}`} strokeWidth={2} />
              <span className="text-[11px] font-medium flex-1">{meta.label} <span className="text-muted-foreground">#{idx+1}</span></span>
              <button onClick={() => move(it.id, -1)} disabled={idx === 0} className="p-1 rounded hover:bg-accent disabled:opacity-30">
                <ArrowUp className="h-3 w-3" />
              </button>
              <button onClick={() => move(it.id, 1)} disabled={idx === items.length-1} className="p-1 rounded hover:bg-accent disabled:opacity-30">
                <ArrowDown className="h-3 w-3" />
              </button>
              <button onClick={() => remove(it.id)} className="p-1 rounded hover:bg-accent">
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>

            {it.kind === 'text' && (
              <VariableTextarea
                variables={flowVars}
                value={it.content}
                onChange={(v) => update(it.id, { content: v } as any)}
                rows={2}
                className="text-xs"
                placeholder="Mensagem… {{contact.name}}"
              />
            )}

            {(it.kind === 'image' || it.kind === 'video' || it.kind === 'audio' || it.kind === 'file') && (
              <div className="space-y-1.5">
                <Input
                  value={it.url}
                  onChange={(e) => update(it.id, { url: e.target.value } as any)}
                  placeholder="URL pública da mídia"
                  className="h-7 text-xs"
                />
                {it.kind !== 'audio' && (
                  <Input
                    value={(it as any).caption ?? ''}
                    onChange={(e) => update(it.id, { caption: e.target.value } as any)}
                    placeholder={it.kind === 'file' ? 'Nome do arquivo (opcional)' : 'Legenda (opcional)'}
                    className="h-7 text-xs"
                  />
                )}
              </div>
            )}

            {it.kind === 'delay' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} max={300}
                  value={it.seconds}
                  onChange={(e) => update(it.id, { seconds: Number(e.target.value) } as any)}
                  className="h-7 text-xs w-20"
                />
                <span className="text-[11px] text-muted-foreground">segundos antes do próximo item</span>
              </div>
            )}

            {it.kind === 'autooff' && (
              <p className="text-[11px] text-muted-foreground">Desativa a resposta automática da IA nesta conversa.</p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-1 pt-1">
        {(Object.keys(KIND_META) as Array<ContentItem['kind']>).map(k => {
          const m = KIND_META[k];
          const Icon = m.icon;
          return (
            <Button
              key={k} variant="outline" size="sm" className="h-7 text-[11px]"
              onClick={() => onChange([...items, newItem(k)])}
            >
              <Icon className={`h-3 w-3 mr-1 ${m.color}`} />{m.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
