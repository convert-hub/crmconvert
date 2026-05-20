import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';
import type { Filter, FilterField, FilterOperator } from '@/types/automation';

interface FieldDef {
  field: FilterField;
  label: string;
  category: 'Oportunidade' | 'Contato' | 'Conversa' | 'Contexto';
  type: 'select' | 'multi-select' | 'number' | 'text' | 'boolean' | 'tags' | 'stage' | 'pipeline' | 'wa_instance' | 'weekday';
  ops: FilterOperator[];
  options?: Array<{ value: string; label: string }>;
}

const FIELDS: FieldDef[] = [
  // Opportunity
  { field: 'opportunity.pipeline_id', label: 'Pipeline', category: 'Oportunidade', type: 'pipeline', ops: ['eq', 'neq'] },
  { field: 'opportunity.stage_id', label: 'Etapa', category: 'Oportunidade', type: 'stage', ops: ['eq', 'neq', 'in', 'nin'] },
  { field: 'opportunity.status', label: 'Status', category: 'Oportunidade', type: 'select', ops: ['eq', 'neq'],
    options: [{ value: 'open', label: 'Aberta' }, { value: 'won', label: 'Ganha' }, { value: 'lost', label: 'Perdida' }] },
  { field: 'opportunity.priority', label: 'Prioridade', category: 'Oportunidade', type: 'select', ops: ['eq', 'neq', 'in'],
    options: [{ value: 'low', label: 'Baixa' }, { value: 'medium', label: 'Média' }, { value: 'high', label: 'Alta' }, { value: 'urgent', label: 'Urgente' }] },
  { field: 'opportunity.value', label: 'Valor', category: 'Oportunidade', type: 'number', ops: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] },
  { field: 'opportunity.assigned_to', label: 'Responsável', category: 'Oportunidade', type: 'text', ops: ['eq', 'neq', 'is_empty', 'is_not_empty'] },
  { field: 'opportunity.source', label: 'Origem (opp)', category: 'Oportunidade', type: 'text', ops: ['eq', 'contains', 'is_empty'] },
  // Contact
  { field: 'contact.status', label: 'Status do contato', category: 'Contato', type: 'select', ops: ['eq', 'neq', 'in'],
    options: [{ value: 'lead', label: 'Lead' }, { value: 'customer', label: 'Cliente' }, { value: 'churned', label: 'Churned' }, { value: 'inactive', label: 'Inativo' }] },
  { field: 'contact.tags', label: 'Tags', category: 'Contato', type: 'tags', ops: ['has_any', 'has_all', 'is_empty', 'is_not_empty'] },
  { field: 'contact.source', label: 'Origem (contato)', category: 'Contato', type: 'text', ops: ['eq', 'contains', 'is_empty'] },
  { field: 'contact.utm_source', label: 'UTM source', category: 'Contato', type: 'text', ops: ['eq', 'contains'] },
  { field: 'contact.utm_medium', label: 'UTM medium', category: 'Contato', type: 'text', ops: ['eq', 'contains'] },
  { field: 'contact.utm_campaign', label: 'UTM campaign', category: 'Contato', type: 'text', ops: ['eq', 'contains'] },
  { field: 'contact.city', label: 'Cidade', category: 'Contato', type: 'text', ops: ['eq', 'contains'] },
  { field: 'contact.state', label: 'Estado', category: 'Contato', type: 'text', ops: ['eq', 'contains'] },
  { field: 'contact.has_phone', label: 'Tem telefone', category: 'Contato', type: 'boolean', ops: ['eq'] },
  { field: 'contact.has_email', label: 'Tem e-mail', category: 'Contato', type: 'boolean', ops: ['eq'] },
  { field: 'contact.do_not_contact', label: 'Não contatar', category: 'Contato', type: 'boolean', ops: ['eq'] },
  { field: 'contact.age_days', label: 'Idade do contato (dias)', category: 'Contato', type: 'number', ops: ['gt', 'gte', 'lt', 'lte'] },
  // Conversation
  { field: 'conversation.channel', label: 'Canal', category: 'Conversa', type: 'select', ops: ['eq', 'neq'],
    options: [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'E-mail' }, { value: 'phone', label: 'Telefone' }, { value: 'web', label: 'Web' }] },
  { field: 'conversation.status', label: 'Status conversa', category: 'Conversa', type: 'select', ops: ['eq', 'neq', 'in'],
    options: [{ value: 'open', label: 'Aberta' }, { value: 'waiting_customer', label: 'Aguard. cliente' }, { value: 'waiting_agent', label: 'Aguard. atendente' }, { value: 'closed', label: 'Fechada' }] },
  { field: 'conversation.whatsapp_instance_id', label: 'Instância WhatsApp', category: 'Conversa', type: 'wa_instance', ops: ['eq', 'neq'] },
  { field: 'conversation.assigned_to', label: 'Atribuição', category: 'Conversa', type: 'text', ops: ['is_empty', 'is_not_empty'] },
  // Context
  { field: 'context.business_hours', label: 'Em horário comercial', category: 'Contexto', type: 'boolean', ops: ['eq'] },
  { field: 'context.weekday', label: 'Dia da semana', category: 'Contexto', type: 'weekday', ops: ['in', 'eq'] },
  { field: 'context.hour', label: 'Hora do dia (0-23)', category: 'Contexto', type: 'number', ops: ['gte', 'lte', 'between', 'eq'] },
];

const OP_LABELS: Record<FilterOperator, string> = {
  eq: 'é', neq: 'não é', in: 'está em', nin: 'não está em',
  gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'entre',
  contains: 'contém', has_any: 'tem alguma', has_all: 'tem todas',
  is_empty: 'vazio', is_not_empty: 'preenchido',
};

const WEEKDAYS = [
  { value: '0', label: 'Dom' }, { value: '1', label: 'Seg' }, { value: '2', label: 'Ter' },
  { value: '3', label: 'Qua' }, { value: '4', label: 'Qui' }, { value: '5', label: 'Sex' }, { value: '6', label: 'Sáb' },
];

interface Props {
  value: Filter[];
  onChange: (filters: Filter[]) => void;
}

export default function ConditionsBuilder({ value, onChange }: Props) {
  const { tenant } = useAuth();
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([]);
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string }>>([]);
  const [instances, setInstances] = useState<Array<{ id: string; display_name: string | null; instance_name: string }>>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('pipelines').select('id, name').eq('tenant_id', tenant.id).then(({ data }) => setPipelines(data ?? []));
    supabase.from('stages').select('id, name').eq('tenant_id', tenant.id).order('position').then(({ data }) => setStages(data ?? []));
    (supabase.from as any)('whatsapp_instances_public').select('id, display_name, instance_name').eq('tenant_id', tenant.id).eq('is_active', true)
      .then(({ data }: any) => setInstances(data ?? []));
    supabase.from('tenant_memberships').select('id, profiles:user_id(full_name)').eq('tenant_id', tenant.id).eq('is_active', true)
      .then(({ data }: any) => {
        setMembers((data ?? []).map((m: any) => ({ id: m.id, name: m.profiles?.full_name ?? '—' })));
      });
  }, [tenant]);

  const add = () => onChange([...value, { field: 'opportunity.stage_id', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const patch = (i: number, p: Partial<Filter>) => onChange(value.map((f, idx) => idx === i ? { ...f, ...p } : f));

  const renderValue = (filter: Filter, i: number) => {
    const def = FIELDS.find(f => f.field === filter.field);
    if (!def) return null;
    if (filter.op === 'is_empty' || filter.op === 'is_not_empty') return null;
    const isMulti = filter.op === 'in' || filter.op === 'nin' || filter.op === 'has_any' || filter.op === 'has_all';

    if (def.type === 'pipeline') {
      return (
        <Select value={(filter.value as string) || ''} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Pipeline" /></SelectTrigger>
          <SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (def.type === 'stage') {
      if (isMulti) {
        const arr = Array.isArray(filter.value) ? (filter.value as string[]) : [];
        return (
          <div className="flex flex-wrap gap-1 flex-1 min-h-8 rounded-md border border-input p-1">
            {stages.map(s => {
              const active = arr.includes(s.id);
              return (
                <button key={s.id} type="button"
                  onClick={() => patch(i, { value: active ? arr.filter(x => x !== s.id) : [...arr, s.id] })}
                  className={`text-[10px] px-2 py-0.5 rounded ${active ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}>
                  {s.name}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select value={(filter.value as string) || ''} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Etapa" /></SelectTrigger>
          <SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (def.type === 'wa_instance') {
      return (
        <Select value={(filter.value as string) || ''} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Instância" /></SelectTrigger>
          <SelectContent>{instances.map(x => <SelectItem key={x.id} value={x.id}>{x.display_name || x.instance_name}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (def.type === 'tags') {
      const arr = Array.isArray(filter.value) ? (filter.value as string[]) : [];
      // simple single-tag picker; user can add more rows
      return (
        <div className="flex-1 flex items-center gap-1">
          <TagPickerSelect value={arr[0] || ''} onChange={v => patch(i, { value: v ? [v] : [] })} className="flex-1" />
        </div>
      );
    }
    if (def.type === 'weekday') {
      const arr = Array.isArray(filter.value) ? (filter.value as string[]) : (filter.value ? [String(filter.value)] : []);
      return (
        <div className="flex gap-1 flex-1">
          {WEEKDAYS.map(d => {
            const active = arr.includes(d.value);
            return (
              <button key={d.value} type="button"
                onClick={() => {
                  const next = active ? arr.filter(x => x !== d.value) : [...arr, d.value];
                  patch(i, { value: filter.op === 'eq' ? next[0] ?? '' : next });
                }}
                className={`text-[10px] px-2 py-1 rounded ${active ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}>
                {d.label}
              </button>
            );
          })}
        </div>
      );
    }
    if (def.type === 'select') {
      if (isMulti) {
        const arr = Array.isArray(filter.value) ? (filter.value as string[]) : [];
        return (
          <div className="flex flex-wrap gap-1 flex-1">
            {def.options!.map(o => {
              const active = arr.includes(o.value);
              return (
                <button key={o.value} type="button"
                  onClick={() => patch(i, { value: active ? arr.filter(x => x !== o.value) : [...arr, o.value] })}
                  className={`text-[10px] px-2 py-1 rounded ${active ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select value={(filter.value as string) || ''} onValueChange={v => patch(i, { value: v })}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>{def.options!.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (def.type === 'boolean') {
      return (
        <Select value={String(filter.value ?? 'true')} onValueChange={v => patch(i, { value: v === 'true' })}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Sim</SelectItem>
            <SelectItem value="false">Não</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (def.type === 'number') {
      if (filter.op === 'between') {
        const arr = Array.isArray(filter.value) ? (filter.value as number[]) : [0, 0];
        return (
          <div className="flex gap-1 flex-1">
            <Input type="number" value={arr[0] ?? ''} onChange={e => patch(i, { value: [Number(e.target.value), arr[1] ?? 0] })} className="h-8 text-xs" placeholder="mín" />
            <Input type="number" value={arr[1] ?? ''} onChange={e => patch(i, { value: [arr[0] ?? 0, Number(e.target.value)] })} className="h-8 text-xs" placeholder="máx" />
          </div>
        );
      }
      return <Input type="number" value={(filter.value as number) ?? ''} onChange={e => patch(i, { value: Number(e.target.value) })} className="h-8 text-xs flex-1" />;
    }
    // text default
    return <Input value={(filter.value as string) ?? ''} onChange={e => patch(i, { value: e.target.value })} className="h-8 text-xs flex-1" placeholder="Valor" />;
  };

  const grouped = FIELDS.reduce<Record<string, FieldDef[]>>((acc, f) => {
    (acc[f.category] ||= []).push(f); return acc;
  }, {});

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">Nenhuma condição adicional. A automação dispara sempre que o gatilho ocorrer.</p>
      )}
      {value.map((f, i) => {
        const def = FIELDS.find(x => x.field === f.field);
        const ops = def?.ops ?? ['eq'];
        return (
          <div key={i} className="flex items-center gap-1.5">
            <Select value={f.field} onValueChange={v => {
              const nd = FIELDS.find(x => x.field === v as FilterField)!;
              patch(i, { field: v as FilterField, op: nd.ops[0], value: nd.type === 'boolean' ? true : (nd.type === 'multi-select' || nd.type === 'tags' ? [] : '') });
            }}>
              <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">{cat}</div>
                    {items.map(it => <SelectItem key={it.field} value={it.field}>{it.label}</SelectItem>)}
                  </div>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.op} onValueChange={v => patch(i, { op: v as FilterOperator })}>
              <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{ops.map(o => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
            {renderValue(f, i)}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={add} className="h-7 text-xs text-primary">
        <Plus className="h-3 w-3 mr-1" />Adicionar condição
      </Button>
    </div>
  );
}
