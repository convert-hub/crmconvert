import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Pipeline { id: string; name: string }
interface Stage { id: string; name: string; pipeline_id: string; position: number }

interface Props {
  tenantId: string | null;
  pipelineId?: string;
  stageId?: string;
  onChange: (val: { pipeline_id?: string; stage_id?: string }) => void;
  /** When true, both fields are required; otherwise empty = "use default" */
  requireBoth?: boolean;
}

export default function PipelineStagePicker({ tenantId, pipelineId, stageId, onChange, requireBoth }: Props) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('pipelines').select('id, name').eq('tenant_id', tenantId).order('position')
      .then(({ data }) => setPipelines((data as Pipeline[]) || []));
  }, [tenantId]);

  useEffect(() => {
    if (!pipelineId) { setStages([]); return; }
    supabase.from('stages').select('id, name, pipeline_id, position').eq('pipeline_id', pipelineId).order('position')
      .then(({ data }) => setStages((data as Stage[]) || []));
  }, [pipelineId]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-[11px]">Pipeline {requireBoth ? '' : '(opcional)'}</Label>
        <Select value={pipelineId ?? ''} onValueChange={v => onChange({ pipeline_id: v, stage_id: undefined })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={requireBoth ? 'Escolha' : 'Padrão'} /></SelectTrigger>
          <SelectContent>
            {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Etapa {requireBoth ? '' : '(opcional)'}</Label>
        <Select value={stageId ?? ''} onValueChange={v => onChange({ pipeline_id: pipelineId, stage_id: v })} disabled={!pipelineId}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={requireBoth ? 'Escolha' : 'Primeira'} /></SelectTrigger>
          <SelectContent>
            {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
