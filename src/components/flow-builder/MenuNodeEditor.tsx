import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

interface MenuOption { id: string; label: string; value?: string }

interface Props {
  data: any;
  onChange: (data: any) => void;
}

export default function MenuNodeEditor({ data, onChange }: Props) {
  const options: MenuOption[] = Array.isArray(data.options) ? data.options : [];
  const set = (patch: any) => onChange({ ...data, ...patch });

  const addOption = () => {
    const id = `o${Date.now().toString(36).slice(-5)}`;
    set({ options: [...options, { id, label: `Opção ${options.length + 1}`, value: '' }] });
  };
  const updateOpt = (i: number, patch: Partial<MenuOption>) => {
    const next = options.map((o, idx) => idx === i ? { ...o, ...patch } : o);
    set({ options: next });
  };
  const removeOpt = (i: number) => set({ options: options.filter((_, idx) => idx !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    set({ options: next });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Pergunta do menu</Label>
        <Textarea
          value={data.question ?? ''}
          onChange={(e) => set({ question: e.target.value })}
          rows={3}
          placeholder="Ex: Como posso te ajudar?&#10;1 - Falar com vendas&#10;2 - Suporte"
          className="text-sm"
        />
        <p className="text-[10px] text-muted-foreground">A numeração é adicionada automaticamente pelo contato — você pode incluir no texto também.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Opções</Label>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addOption}>
            <Plus className="h-3 w-3 mr-1" />Adicionar
          </Button>
        </div>
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhuma opção. Adicione pelo menos uma.</p>
        )}
        {options.map((opt, i) => (
          <div key={opt.id} className="rounded-md border border-border p-2 space-y-1.5 bg-muted/30">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
              <Input
                value={opt.label}
                onChange={(e) => updateOpt(i, { label: e.target.value })}
                placeholder="Rótulo visível"
                className="h-7 text-xs flex-1"
              />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === options.length - 1}>
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeOpt(i)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <Input
              value={opt.value ?? ''}
              onChange={(e) => updateOpt(i, { value: e.target.value })}
              placeholder="Sinônimos (separados por vírgula): vendas, comprar"
              className="h-7 text-[11px]"
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Máx. tentativas</Label>
          <Input
            type="number" min={1} max={10}
            value={data.maxRetries ?? 3}
            onChange={(e) => set({ maxRetries: Number(e.target.value) || 3 })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Salvar resposta em (opcional)</Label>
          <Input
            value={data.saveVariable ?? ''}
            onChange={(e) => set({ saveVariable: e.target.value })}
            placeholder="ex: menu_choice"
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Mensagem de resposta inválida</Label>
        <Textarea
          value={data.invalidText ?? 'Desculpe, não entendi. Por favor, escolha uma das opções.'}
          onChange={(e) => set({ invalidText: e.target.value })}
          rows={2}
          className="text-sm"
        />
      </div>

      <p className="text-[10px] text-muted-foreground">
        Cada opção gera uma saída no canvas. A saída vermelha "inválido" é seguida quando o usuário esgota as tentativas.
      </p>
    </div>
  );
}
