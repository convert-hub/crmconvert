import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Copy, RefreshCw, Phone, User, Mail, FileCog, GitBranch, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { DndContext, useDraggable, useDroppable, DragEndEvent, DragOverlay, closestCenter } from '@dnd-kit/core';
import WhatsAppInstancePicker from '@/components/shared/WhatsAppInstancePicker';
import type { Webhook } from './WebhooksTab';

type ActionType = 'set_phone' | 'set_name' | 'set_email' | 'set_custom_field' | 'trigger_flow';
type ActionMap = { id: string; type: ActionType; source_path?: string; target?: string; flow_id?: string };

const PROJECT_REF = 'zhywwrhzaqfcjcwywkwf';

const ACTION_DEFS: { type: ActionType; icon: any; label: string; needsField: boolean }[] = [
  { type: 'set_phone', icon: Phone, label: 'Telefone do contato', needsField: true },
  { type: 'set_name', icon: User, label: 'Nome do contato', needsField: true },
  { type: 'set_email', icon: Mail, label: 'E-mail do contato', needsField: true },
  { type: 'set_custom_field', icon: FileCog, label: 'Campo personalizado', needsField: true },
  { type: 'trigger_flow', icon: GitBranch, label: 'Disparar fluxo', needsField: false },
];

function flattenKeys(obj: any, prefix = ''): { path: string; preview: string }[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [{ path: prefix, preview: String(obj).slice(0, 50) }] : [];
  }
  return Object.entries(obj).flatMap(([k, v]) => {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return flattenKeys(v, next);
    return [{ path: next, preview: Array.isArray(v) ? `[${v.length} itens]` : String(v ?? '').slice(0, 50) }];
  });
}

function FieldChip({ path, preview, used }: { path: string; preview: string; used: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `field:${path}`, data: { path } });
  return (
    <div
      ref={setNodeRef}
      {...listeners} {...attributes}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`group flex flex-col gap-0.5 rounded-md border px-2 py-1.5 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-30' : ''
      } ${used ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-primary/30'}`}
    >
      <span className="text-[11px] font-mono text-foreground truncate">{path}</span>
      <span className="text-[10px] text-muted-foreground truncate">{preview || '—'}</span>
    </div>
  );
}

function ActionCard({
  action, flows, onChangeAction, onRemoveMapping,
}: {
  action: ActionMap;
  flows: { id: string; name: string }[];
  onChangeAction: (patch: Partial<ActionMap>) => void;
  onRemoveMapping: () => void;
}) {
  const def = ACTION_DEFS.find(d => d.type === action.type)!;
  const Icon = def.icon;
  const { setNodeRef, isOver } = useDroppable({ id: `action:${action.id}`, data: { actionId: action.id } });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border p-3 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">{def.label}</span>
      </div>

      {action.type === 'set_custom_field' && (
        <Input
          placeholder="Nome do campo (ex: cidade)"
          value={action.target ?? ''}
          onChange={e => onChangeAction({ target: e.target.value })}
          className="h-7 text-[11px] mb-2"
        />
      )}

      {action.type === 'trigger_flow' ? (
        <Select value={action.flow_id ?? ''} onValueChange={v => onChangeAction({ flow_id: v })}>
          <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
          <SelectContent>
            {flows.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : action.source_path ? (
        <div className="flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-1">
          <Check className="h-3 w-3 text-primary" />
          <span className="text-[11px] font-mono text-primary flex-1 truncate">{action.source_path}</span>
          <button onClick={onRemoveMapping} className="text-muted-foreground hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground italic">Arraste um campo recebido aqui</p>
      )}
    </div>
  );
}

export default function WebhookEditor({
  webhook, onChange, onBack,
}: {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
  onBack: () => void;
}) {
  const { tenant } = useAuth();
  const [w, setW] = useState<Webhook>(webhook);
  const [flows, setFlows] = useState<{ id: string; name: string }[]>([]);
  const [activeDrag, setActiveDrag] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('chatbot_flows').select('id, name').eq('tenant_id', tenant.id).order('name')
      .then(({ data }) => setFlows((data as any) ?? []));
  }, [tenant?.id]);

  // Poll for new sample while in test mode
  useEffect(() => {
    if (!w.test_mode || !polling) return;
    const i = setInterval(async () => {
      const { data } = await supabase.from('webhook_endpoints').select('*').eq('id', w.id).single();
      if (data && (data as Webhook).sample_received_at !== w.sample_received_at) {
        setW(data as Webhook); onChange(data as Webhook);
        toast.success('Payload de teste recebido');
        setPolling(false);
      }
    }, 2000);
    return () => clearInterval(i);
  }, [w.test_mode, polling, w.id, w.sample_received_at]);

  const fields = useMemo(() => flattenKeys(w.sample_payload), [w.sample_payload]);
  const actions: ActionMap[] = (w.actions as ActionMap[]) ?? [];
  const usedPaths = new Set(actions.map(a => a.source_path).filter(Boolean) as string[]);

  const url = `https://${PROJECT_REF}.functions.supabase.co/webhook-flow-trigger/${w.slug}`;

  const persist = async (patch: Partial<Webhook>) => {
    const next = { ...w, ...patch };
    setW(next); onChange(next);
    const { error } = await supabase.from('webhook_endpoints').update(patch).eq('id', w.id);
    if (error) toast.error(error.message);
  };

  const persistName = (name: string) => persist({ name });

  const addAction = (type: ActionType) => {
    const id = crypto.randomUUID();
    const next = [...actions, { id, type } as ActionMap];
    persist({ actions: next });
  };
  const updateAction = (id: string, patch: Partial<ActionMap>) => {
    const next = actions.map(a => a.id === id ? { ...a, ...patch } : a);
    persist({ actions: next });
  };
  const removeAction = (id: string) => persist({ actions: actions.filter(a => a.id !== id) });

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const path = e.active.data.current?.path as string | undefined;
    const actionId = e.over?.data.current?.actionId as string | undefined;
    if (path && actionId) updateAction(actionId, { source_path: path });
  };

  const copy = (txt: string) => { navigator.clipboard.writeText(txt); toast.success('Copiado'); };

  const regenSecret = () => {
    const arr = new Uint8Array(20); crypto.getRandomValues(arr);
    const secret = 'whsec_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    persist({ secret });
  };

  const enableTestMode = async () => {
    await persist({ test_mode: true, sample_payload: null, sample_received_at: null });
    setPolling(true);
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragStart={(e) => setActiveDrag(e.active.id as string)} onDragEnd={onDragEnd} onDragCancel={() => setActiveDrag(null)}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Input
            value={w.name}
            onChange={e => setW({ ...w, name: e.target.value })}
            onBlur={() => persistName(w.name)}
            className="h-8 text-sm font-medium border-none bg-transparent focus-visible:ring-1 max-w-sm"
          />
          <div className="ml-auto flex items-center gap-3">
            <Label className="text-xs text-muted-foreground">Ativo</Label>
            <Switch checked={w.is_active} onCheckedChange={v => persist({ is_active: v })} />
          </div>
        </div>

        {/* URL + secret */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-card">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">URL (POST)</Label>
            <div className="flex gap-1 mt-1">
              <Input readOnly value={url} className="h-8 text-[10px] font-mono" />
              <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copy(url)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Header X-Flow-Secret</Label>
            <div className="flex gap-1 mt-1">
              <Input readOnly value={w.secret} className="h-8 text-[10px] font-mono" />
              <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copy(w.secret)}>
                <Copy className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={regenSecret} title="Regerar">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Left: received fields */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-3 min-h-[400px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Campos recebidos</span>
              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-muted-foreground">Modo teste</Label>
                <Switch checked={w.test_mode} onCheckedChange={async v => {
                  await persist({ test_mode: v });
                  if (v) setPolling(true); else setPolling(false);
                }} />
              </div>
            </div>

            {w.test_mode && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                {polling ? '⏳ Aguardando primeira requisição POST...' : 'Modo teste ativo. Envie um POST para a URL acima para capturar o exemplo.'}
                {fields.length > 0 && (
                  <button onClick={enableTestMode} className="underline ml-2">Capturar novamente</button>
                )}
              </div>
            )}

            {fields.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-xs">Nenhum payload capturado ainda</p>
                <p className="text-[10px] mt-1">Envie uma requisição de teste para mapear os campos</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {fields.map(f => <FieldChip key={f.path} path={f.path} preview={f.preview} used={usedPaths.has(f.path)} />)}
              </div>
            )}
          </div>

          {/* Right: action cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Ações ao receber</span>
              <Select value="" onValueChange={(v) => addAction(v as ActionType)}>
                <SelectTrigger className="h-7 text-[11px] w-44"><SelectValue placeholder="+ Adicionar ação" /></SelectTrigger>
                <SelectContent>
                  {ACTION_DEFS.map(d => <SelectItem key={d.type} value={d.type}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {actions.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-lg">
                <p className="text-xs text-muted-foreground">Adicione uma ação e arraste um campo recebido</p>
              </div>
            ) : (
              <div className="space-y-2">
                {actions.map(a => (
                  <div key={a.id} className="relative group">
                    <ActionCard
                      action={a}
                      flows={flows}
                      onChangeAction={(p) => updateAction(a.id, p)}
                      onRemoveMapping={() => updateAction(a.id, { source_path: undefined })}
                    />
                    <button
                      onClick={() => removeAction(a.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeDrag?.startsWith('field:') && (
            <div className="rounded-md border border-primary bg-primary/10 px-2 py-1 text-[11px] font-mono shadow-lg">
              {activeDrag.replace('field:', '')}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
