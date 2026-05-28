import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2 } from 'lucide-react';

export interface Criterion { id: string; field: string; operator: string; value: string }

interface Props {
  combinator: 'AND' | 'OR';
  criteria: Criterion[];
  onChange: (criteria: Criterion[], combinator: 'AND' | 'OR') => void;
}

const newCriterion = (): Criterion => ({
  id: `c-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
  field: 'message', operator: 'contains', value: '',
});

export default function ConditionCriteriaEditor({ combinator, criteria, onChange }: Props) {
  const update = (id: string, patch: Partial<Criterion>) =>
    onChange(criteria.map(c => c.id === id ? { ...c, ...patch } : c), combinator);
  const remove = (id: string) => onChange(criteria.filter(c => c.id !== id), combinator);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Label className="text-xs">Combinar critérios com</Label>
        <RadioGroup
          value={combinator}
          onValueChange={(v) => onChange(criteria, v as 'AND' | 'OR')}
          className="flex gap-3"
        >
          <div className="flex items-center gap-1"><RadioGroupItem value="AND" id="comb-and" /><Label htmlFor="comb-and" className="text-xs font-normal cursor-pointer">E (todos)</Label></div>
          <div className="flex items-center gap-1"><RadioGroupItem value="OR" id="comb-or" /><Label htmlFor="comb-or" className="text-xs font-normal cursor-pointer">OU (qualquer)</Label></div>
        </RadioGroup>
      </div>

      {criteria.map((c, idx) => (
        <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end">
          <div>
            {idx === 0 && <Label className="text-[10px]">Campo</Label>}
            <Select value={c.field} onValueChange={(v) => update(c.id, { field: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="message">Mensagem</SelectItem>
                <SelectItem value="contact_name">Nome</SelectItem>
                <SelectItem value="contact_tag">Tag</SelectItem>
                <SelectItem value="contact_status">Status</SelectItem>
                <SelectItem value="contact_email">E-mail</SelectItem>
                <SelectItem value="contact_phone">Telefone</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            {idx === 0 && <Label className="text-[10px]">Operador</Label>}
            <Select value={c.operator} onValueChange={(v) => update(c.id, { operator: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">Contém</SelectItem>
                <SelectItem value="not_contains">Não contém</SelectItem>
                <SelectItem value="equals">Igual</SelectItem>
                <SelectItem value="not_equals">Diferente</SelectItem>
                <SelectItem value="starts_with">Começa com</SelectItem>
                <SelectItem value="ends_with">Termina com</SelectItem>
                <SelectItem value="exists">Existe</SelectItem>
                <SelectItem value="not_exists">Não existe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            {idx === 0 && <Label className="text-[10px]">Valor</Label>}
            <Input
              value={c.value}
              onChange={(e) => update(c.id, { value: e.target.value })}
              className="h-8 text-xs"
              disabled={c.operator === 'exists' || c.operator === 'not_exists'}
            />
          </div>
          <button
            onClick={() => remove(c.id)}
            disabled={criteria.length === 1}
            className="p-1.5 rounded hover:bg-accent disabled:opacity-30"
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      ))}

      <Button
        variant="outline" size="sm"
        className="w-full h-7 text-[11px] border-dashed"
        onClick={() => onChange([...criteria, newCriterion()], combinator)}
      >
        <Plus className="h-3 w-3 mr-1" />Adicionar critério
      </Button>
    </div>
  );
}
