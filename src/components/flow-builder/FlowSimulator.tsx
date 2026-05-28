import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { RotateCcw, Send, Phone, Bot, User as UserIcon } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface SimMsg {
  id: string;
  who: 'bot' | 'me' | 'system';
  text: string;
  ts: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nodes: Node[];
  edges: Edge[];
  triggerType: string;
}

const removeAccents = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalize = (s: unknown) =>
  removeAccents(String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' '));

export default function FlowSimulator({ open, onOpenChange, nodes, edges, triggerType }: Props) {
  const [messages, setMessages] = useState<SimMsg[]>([]);
  const [input, setInput] = useState('');
  const [vars, setVars] = useState<Record<string, any>>({});
  const [pending, setPending] = useState<{ nodeId: string; type: 'question' | 'menu'; saveField?: string; options?: any[] } | null>(null);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const adjacency = useMemo(() => {
    const map: Record<string, string[]> = {};
    edges.forEach(e => {
      const key = e.sourceHandle ? `${e.source}:${e.sourceHandle}` : e.source;
      (map[key] ||= []).push(e.target);
    });
    return map;
  }, [edges]);

  const triggerNode = useMemo(() => nodes.find(n => n.type === 'trigger'), [nodes]);

  const push = (m: Omit<SimMsg, 'id' | 'ts'>) =>
    setMessages(prev => [...prev, { ...m, id: `${Date.now()}-${Math.random()}`, ts: Date.now() }]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const interp = (s: string, v = vars) =>
    String(s ?? '').replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, k) => v[k] ?? '');

  const reset = () => {
    setMessages([]);
    setVars({});
    setPending(null);
    setInput('');
  };

  const start = async () => {
    reset();
    push({ who: 'system', text: `Simulando trigger: ${triggerType}` });
    if (!triggerNode) {
      push({ who: 'system', text: '⚠ Nenhum gatilho encontrado' });
      return;
    }
    await runFrom(triggerNode.id, {});
  };

  const runFrom = async (startNodeId: string, extraVars: Record<string, any>) => {
    if (running) return;
    setRunning(true);
    const localVars = { ...vars, ...extraVars };
    const queue: string[] = [startNodeId];
    const visited = new Set<string>();
    let steps = 0;

    while (queue.length && steps < 100) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      steps++;

      const node = nodes.find(n => n.id === id);
      if (!node) continue;
      const data: any = node.data || {};

      switch (node.type) {
        case 'trigger':
          (adjacency[id] || []).forEach(n => queue.push(n));
          break;
        case 'message': {
          const mode = data.mode || 'text';
          if (mode === 'items' && Array.isArray(data.items)) {
            for (const item of data.items) {
              if (item.kind === 'text' && item.content) {
                push({ who: 'bot', text: interp(item.content, localVars) });
                await new Promise(r => setTimeout(r, 220));
              } else if (['image', 'video', 'audio', 'file'].includes(item.kind)) {
                push({ who: 'bot', text: `[${item.kind.toUpperCase()}] ${interp(item.caption || item.url || '', localVars)}` });
                await new Promise(r => setTimeout(r, 220));
              } else if (item.kind === 'delay') {
                await new Promise(r => setTimeout(r, Math.min(1500, (Number(item.seconds) || 1) * 250)));
              } else if (item.kind === 'autooff') {
                push({ who: 'system', text: 'IA desativada na conversa' });
              }
            }
          } else if (data.content) {
            push({ who: 'bot', text: interp(data.content, localVars) });
          }
          (adjacency[id] || []).forEach(n => queue.push(n));
          break;
        }
        case 'delay': {
          const mins = data.delayMinutes || 1;
          push({ who: 'system', text: `⏱ Aguarda ${mins} min (simulado em 500ms)` });
          await new Promise(r => setTimeout(r, 500));
          (adjacency[id] || []).forEach(n => queue.push(n));
          break;
        }
        case 'condition': {
          const criteria = Array.isArray(data.criteria) && data.criteria.length
            ? data.criteria
            : [{ field: data.field || 'message', operator: data.operator || 'contains', value: data.value || '' }];
          const combinator = String(data.combinator || 'AND').toUpperCase();
          const evalOne = (c: any) => {
            const test = localVars[c.field] ?? localVars.message ?? '';
            const nt = normalize(test);
            const nv = normalize(c.value);
            switch (c.operator) {
              case 'contains': return nt.includes(nv);
              case 'not_contains': return !nt.includes(nv);
              case 'equals': return nt === nv;
              case 'not_equals': return nt !== nv;
              case 'starts_with': return nt.startsWith(nv);
              case 'ends_with': return nt.endsWith(nv);
              case 'exists': return String(test).trim().length > 0;
              case 'not_exists': return String(test).trim().length === 0;
              default: return false;
            }
          };
          const results = criteria.map(evalOne);
          const ok = combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
          push({ who: 'system', text: `Condição: ${ok ? '✓ sim' : '✗ não'}` });
          const next = ok
            ? (adjacency[`${id}:yes`] || adjacency[id] || [])
            : (adjacency[`${id}:no`] || []);
          next.forEach(n => queue.push(n));
          break;
        }
        case 'randomizer': {
          const opts = data.options || [];
          if (!opts.length) { (adjacency[id] || []).forEach(n => queue.push(n)); break; }
          let idx = 0;
          const total = opts.reduce((s: number, o: any) => s + (o.weight || 0), 0) || opts.length;
          const r = Math.random() * total;
          let cum = 0;
          for (let i = 0; i < opts.length; i++) {
            cum += opts[i].weight || (total / opts.length);
            if (r <= cum) { idx = i; break; }
          }
          push({ who: 'system', text: `Random → "${opts[idx]?.label}"` });
          (adjacency[`${id}:option-${idx}`] || []).forEach(n => queue.push(n));
          break;
        }
        case 'action': {
          const list = Array.isArray(data.actions) && data.actions.length
            ? data.actions
            : [{ type: data.actionType, config: data.config || {} }];
          list.forEach((a: any) => {
            push({ who: 'system', text: `🛠 Ação: ${a.type}${a.config?.tag ? ` "${a.config.tag}"` : ''}` });
          });
          (adjacency[id] || []).forEach(n => queue.push(n));
          break;
        }
        case 'aiassistant': {
          push({ who: 'bot', text: `[IA · ${(data.model || 'gemini-3-flash').split('/').pop()}] simulada: "${interp(data.prompt || '{{message}}', localVars).slice(0, 80) || 'resposta gerada'}"` });
          (adjacency[`${id}:success`] || []).forEach(n => queue.push(n));
          break;
        }
        case 'question': {
          if (data.question) push({ who: 'bot', text: interp(data.question, localVars) });
          setVars(localVars);
          setPending({ nodeId: id, type: 'question', saveField: data.saveField });
          setRunning(false);
          return;
        }
        case 'menu': {
          if (data.question) {
            const opts = data.options || [];
            const text = `${interp(data.question, localVars)}\n${opts.map((o: any, i: number) => `${i + 1}. ${o.label}`).join('\n')}`;
            push({ who: 'bot', text });
          }
          setVars(localVars);
          setPending({ nodeId: id, type: 'menu', options: data.options || [] });
          setRunning(false);
          return;
        }
        case 'subflow': {
          push({ who: 'system', text: `↪ Conecta fluxo "${data.targetFlowName || data.targetFlowId || '?'}" (${data.mode || 'call'})` });
          if (data.mode !== 'transfer') (adjacency[id] || []).forEach(n => queue.push(n));
          break;
        }
        default:
          (adjacency[id] || []).forEach(n => queue.push(n));
      }
    }

    setVars(localVars);
    setRunning(false);
    if (steps >= 100) push({ who: 'system', text: '⚠ Limite de passos atingido' });
    else if (!queue.length && !pending) push({ who: 'system', text: '— fim do fluxo —' });
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    push({ who: 'me', text });
    setInput('');

    if (!pending) {
      // No active wait → re-trigger with the message
      const newVars = { ...vars, message: text, last_answer: text };
      setVars(newVars);
      if (triggerNode) await runFrom(triggerNode.id, newVars);
      return;
    }

    const p = pending;
    setPending(null);

    if (p.type === 'menu') {
      const opts = p.options || [];
      const norm = normalize(text);
      const num = parseInt(norm, 10);
      let idx = -1;
      if (!isNaN(num) && num >= 1 && num <= opts.length) idx = num - 1;
      else idx = opts.findIndex((o: any) => normalize(o.label) === norm || normalize(o.label).includes(norm));
      if (idx >= 0) {
        const newVars = { ...vars, message: text, menu_choice: opts[idx].label };
        const targets = (edges.filter(e => e.source === p.nodeId && e.sourceHandle === `option-${opts[idx].id}`)).map(e => e.target);
        for (const t of targets) await runFrom(t, newVars);
      } else {
        push({ who: 'bot', text: 'Não entendi a opção. Tente novamente.' });
        setPending(p);
      }
      return;
    }

    // question
    const newVars: Record<string, any> = { ...vars, message: text, last_answer: text };
    if (p.saveField && p.saveField !== 'custom') newVars[p.saveField] = text;
    const next = adjacency[p.nodeId] || [];
    for (const t of next) await runFrom(t, newVars);
  };

  useEffect(() => { if (open && messages.length === 0) start(); /* eslint-disable-next-line */ }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm flex items-center gap-2">
              <Phone className="h-4 w-4 text-green-600" /> Simulador
            </SheetTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={start} title="Reiniciar">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#e5ddd5]/30 dark:bg-muted/20">
          {messages.map(m => (
            <div key={m.id} className={cn(
              'flex',
              m.who === 'me' ? 'justify-end' : m.who === 'system' ? 'justify-center' : 'justify-start'
            )}>
              {m.who === 'system' ? (
                <div className="text-[10px] text-muted-foreground bg-background/60 rounded-full px-2.5 py-0.5">{m.text}</div>
              ) : (
                <div className={cn(
                  'max-w-[80%] rounded-lg px-3 py-1.5 text-xs whitespace-pre-wrap shadow-sm',
                  m.who === 'me' ? 'bg-green-500/90 text-white rounded-tr-sm' : 'bg-card border border-border rounded-tl-sm'
                )}>
                  <div className="flex items-center gap-1 mb-0.5 opacity-70">
                    {m.who === 'me' ? <UserIcon className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                    <span className="text-[9px]">{m.who === 'me' ? 'Você' : 'Bot'}</span>
                  </div>
                  {m.text}
                </div>
              )}
            </div>
          ))}
          {running && <div className="text-center text-[10px] text-muted-foreground animate-pulse">processando…</div>}
        </div>

        <div className="p-3 border-t border-border bg-card shrink-0 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={pending ? 'Digite sua resposta…' : 'Enviar mensagem ao bot…'}
            className="h-9 text-sm"
            disabled={running}
          />
          <Button size="icon" className="h-9 w-9" onClick={send} disabled={running}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
