import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';
import PipelineStagePicker from '@/components/flow-builder/PipelineStagePicker';

function AgentPicker({ tenantId, value, onChange }: { tenantId: string | null; value?: string; onChange: (v: string) => void }) {
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data: mems } = await supabase
        .from('tenant_memberships')
        .select('id,user_id,role')
        .eq('tenant_id', tenantId)
        .eq('is_active', true);
      if (!mems?.length) { setMembers([]); return; }
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', mems.map((m: any) => m.user_id));
      const pmap = new Map((profs || []).map((p: any) => [p.user_id, p.full_name]));
      setMembers(mems.map((m: any) => ({ id: m.id, name: pmap.get(m.user_id) || m.role || 'Sem nome' })));
    })();
  }, [tenantId]);
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione um atendente…" /></SelectTrigger>
      <SelectContent>
        {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}


export const ACTION_LABELS: Record<string, string> = {
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  assign_agent: 'Atribuir atendente',
  move_stage: 'Mover etapa',
  send_whatsapp: 'Enviar WhatsApp',
  close_conversation: 'Encerrar conversa',
  create_opportunity: 'Criar oportunidade',
  webhook: 'Webhook (HTTP)',
  google_sheets_append: 'Google Sheets — adicionar linha',
  ai_assistant: 'Assistente IA (GPT)',
};

interface Props {
  tenantId: string | null;
  type: string;
  config: any;
  onChange: (type: string, config: any) => void;
}

export default function ActionConfigFields({ tenantId, type, config, onChange }: Props) {
  const patch = (p: any) => onChange(type, { ...(config || {}), ...p });
  return (
    <div className="space-y-2">
      <Select value={type} onValueChange={(v) => onChange(v, {})}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(ACTION_LABELS).map(([k, l]) => (
            <SelectItem key={k} value={k}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(type === 'add_tag' || type === 'remove_tag') && (
        <TagPickerSelect value={config?.tag ?? ''} onChange={(v) => patch({ tag: v })} />
      )}

      {type === 'assign_agent' && (
        <div className="space-y-2">
          <Select value={config?.mode || 'auto'} onValueChange={(v) => patch({ mode: v, membership_id: v === 'auto' ? undefined : config?.membership_id })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automático (menor carga)</SelectItem>
              <SelectItem value="specific">Atendente específico</SelectItem>
            </SelectContent>
          </Select>
          {config?.mode === 'specific' && (
            <AgentPicker tenantId={tenantId} value={config?.membership_id} onChange={(v) => patch({ membership_id: v })} />
          )}
        </div>
      )}

      {type === 'send_whatsapp' && (
        <Textarea
          value={config?.message ?? ''}
          onChange={(e) => patch({ message: e.target.value })}
          rows={2} className="text-xs"
          placeholder="Texto da mensagem…"
        />
      )}

      {type === 'move_stage' && (
        <PipelineStagePicker
          tenantId={tenantId}
          pipelineId={config?.pipeline_id}
          stageId={config?.stage_id}
          onChange={(v) => patch(v)}
          requireBoth
        />
      )}

      {type === 'create_opportunity' && (
        <PipelineStagePicker
          tenantId={tenantId}
          pipelineId={config?.pipeline_id}
          stageId={config?.stage_id}
          onChange={(v) => patch(v)}
        />
      )}

      {type === 'webhook' && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Método</Label>
            <Select value={config?.method || 'POST'} onValueChange={(v) => patch({ method: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">URL</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={config?.url || ''}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://exemplo.com/webhook"
            />
          </div>
          <div>
            <Label className="text-xs">Headers (JSON)</Label>
            <Textarea
              className="text-xs font-mono"
              rows={2}
              value={config?.headers || ''}
              onChange={(e) => patch({ headers: e.target.value })}
              placeholder='{"Authorization":"Bearer ..."}'
            />
          </div>
          <div>
            <Label className="text-xs">Body (JSON ou texto, suporta {`{{variavel}}`})</Label>
            <Textarea
              className="text-xs font-mono"
              rows={3}
              value={config?.body || ''}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder='{"nome":"{{nome}}","telefone":"{{telefone}}"}'
            />
          </div>
          <div>
            <Label className="text-xs">Salvar resposta na variável (opcional)</Label>
            <Input
              className="h-8 text-xs"
              value={config?.save_to || ''}
              onChange={(e) => patch({ save_to: e.target.value })}
              placeholder="resposta_webhook"
            />
          </div>
        </div>
      )}

      {type === 'google_sheets_append' && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Requer conexão Google Sheets ativa (LOVABLE_API_KEY + GOOGLE_SHEETS_API_KEY).
          </p>
          <div>
            <Label className="text-xs">Spreadsheet ID</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={config?.spreadsheet_id || ''}
              onChange={(e) => patch({ spreadsheet_id: e.target.value })}
              placeholder="1BxiMVs0XRA5n..."
            />
          </div>
          <div>
            <Label className="text-xs">Range (aba!coluna)</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={config?.range || 'Sheet1!A:Z'}
              onChange={(e) => patch({ range: e.target.value })}
              placeholder="Sheet1!A:Z"
            />
          </div>
          <div>
            <Label className="text-xs">Valores da linha (uma coluna por campo)</Label>
            <div className="space-y-1">
              {(config?.values || ['']).map((v: string, i: number) => (
                <div key={i} className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    value={v}
                    onChange={(e) => {
                      const next = [...(config?.values || [''])];
                      next[i] = e.target.value;
                      patch({ values: next });
                    }}
                    placeholder={`Coluna ${i + 1} — {{variavel}}`}
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => {
                      const next = (config?.values || ['']).filter((_: any, j: number) => j !== i);
                      patch({ values: next.length ? next : [''] });
                    }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-full"
                onClick={() => patch({ values: [...(config?.values || ['']), ''] })}>
                <Plus className="h-3 w-3 mr-1" /> Adicionar coluna
              </Button>
            </div>
          </div>
        </div>
      )}

      {type === 'ai_assistant' && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Modelo</Label>
            <Select value={config?.model || 'google/gemini-3-flash-preview'} onValueChange={(v) => patch({ model: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google/gemini-3-flash-preview">Gemini 3 Flash (rápido)</SelectItem>
                <SelectItem value="google/gemini-3-pro-preview">Gemini 3 Pro</SelectItem>
                <SelectItem value="openai/gpt-5-mini">GPT-5 mini</SelectItem>
                <SelectItem value="openai/gpt-5">GPT-5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Prompt do sistema</Label>
            <Textarea
              className="text-xs"
              rows={2}
              value={config?.system || ''}
              onChange={(e) => patch({ system: e.target.value })}
              placeholder="Você é um assistente de atendimento..."
            />
          </div>
          <div>
            <Label className="text-xs">Instrução (suporta {`{{variavel}}`})</Label>
            <Textarea
              className="text-xs"
              rows={3}
              value={config?.prompt || ''}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="Responda a dúvida: {{message}}"
            />
          </div>
          <div>
            <Label className="text-xs">Destino da resposta</Label>
            <Select value={config?.output || 'send_whatsapp'} onValueChange={(v) => patch({ output: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="send_whatsapp">Enviar como WhatsApp</SelectItem>
                <SelectItem value="save_variable">Salvar em variável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {config?.output === 'save_variable' && (
            <div>
              <Label className="text-xs">Nome da variável</Label>
              <Input
                className="h-8 text-xs"
                value={config?.save_to || ''}
                onChange={(e) => patch({ save_to: e.target.value })}
                placeholder="resposta_ia"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
