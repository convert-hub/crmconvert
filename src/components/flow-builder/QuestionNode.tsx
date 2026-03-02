import { Handle, Position } from '@xyflow/react';
import { HelpCircle } from 'lucide-react';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  city: 'Cidade',
  state: 'Estado',
  birth_date: 'Data de nascimento',
  notes: 'Observações',
  custom: 'Campo personalizado',
};

export default function QuestionNode({ data }: { data: Record<string, unknown> }) {
  const question = (data.question as string) || 'Pergunta...';
  const saveField = (data.saveField as string) || '';
  const fieldLabel = saveField.startsWith('custom:')
    ? `📝 ${(data.customFieldLabel as string) || saveField.replace('custom:', '')}`
    : FIELD_LABELS[saveField] || saveField;

  return (
    <div className="rounded-xl border-2 border-teal-500/40 bg-card px-4 py-3 shadow-sm min-w-[180px] max-w-[240px]">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-card" />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-500/10 shrink-0">
          <HelpCircle className="h-3 w-3 text-teal-600" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-teal-600 font-semibold">Pergunta</p>
          <p className="text-xs font-medium text-foreground truncate">{(data.label as string) || 'Pergunta'}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{question}</p>
      {saveField && (
        <p className="text-[10px] text-teal-600 mt-1">→ {fieldLabel}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-card" />
    </div>
  );
}
