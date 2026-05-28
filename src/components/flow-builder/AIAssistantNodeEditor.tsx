import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface Props {
  data: any;
  onChange: (d: any) => void;
}

const MODELS = [
  { v: 'google/gemini-3-flash-preview', l: 'Gemini 3 Flash (rápido, recomendado)' },
  { v: 'google/gemini-3.5-flash', l: 'Gemini 3.5 Flash' },
  { v: 'google/gemini-2.5-pro', l: 'Gemini 2.5 Pro (raciocínio profundo)' },
  { v: 'openai/gpt-5-mini', l: 'GPT-5 Mini' },
  { v: 'openai/gpt-5', l: 'GPT-5' },
];

export default function AIAssistantNodeEditor({ data, onChange }: Props) {
  const set = (patch: any) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Modelo</Label>
        <Select value={data.model ?? 'google/gemini-3-flash-preview'} onValueChange={(v) => set({ model: v })}>
          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODELS.map(m => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Instruções (system prompt)</Label>
        <Textarea
          rows={5}
          value={data.system ?? ''}
          onChange={e => set({ system: e.target.value })}
          placeholder="Você é um atendente da clínica X. Responda de forma cordial e objetiva. Se o usuário pedir agendamento, encerre com [[HANDOFF]] para transferir a um humano."
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Inclua <code className="bg-muted px-1 rounded">[[HANDOFF]]</code> nas instruções: quando o modelo emitir esse token na resposta, o fluxo segue pela saída <strong>Handoff</strong>.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Mensagem do usuário (template)</Label>
        <Textarea
          rows={3}
          value={data.prompt ?? '{{message}}'}
          onChange={e => set({ prompt: e.target.value })}
          placeholder="{{message}}"
          className="text-xs"
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border p-2.5">
        <div>
          <Label className="text-xs">Usar base de conhecimento (RAG)</Label>
          <p className="text-[10px] text-muted-foreground">Busca semântica nos documentos do tenant antes de responder.</p>
        </div>
        <Switch checked={!!data.useRag} onCheckedChange={(v) => set({ useRag: v })} />
      </div>

      {data.useRag && (
        <div className="space-y-1.5">
          <Label className="text-xs">Categoria (opcional)</Label>
          <Input
            value={data.ragCategory ?? ''}
            onChange={e => set({ ragCategory: e.target.value })}
            placeholder="ex: faq, planos"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Debounce de mensagens (segundos)</Label>
        <Input
          type="number" min={0} max={60}
          value={data.debounceSeconds ?? 8}
          onChange={e => set({ debounceSeconds: Number(e.target.value) })}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground">Aguarda o usuário terminar de digitar antes de chamar o modelo.</p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Saídas</p>
        <div className="text-[11px] space-y-0.5">
          <p><span className="text-green-600 font-medium">Sucesso</span> — resposta normal enviada ao contato.</p>
          <p><span className="text-amber-600 font-medium">Handoff</span> — modelo emitiu <code>[[HANDOFF]]</code>; IA é desativada e fluxo segue daqui.</p>
          <p><span className="text-rose-600 font-medium">Inativo</span> — sem resposta do contato após o período de inatividade.</p>
        </div>
      </div>
    </div>
  );
}
