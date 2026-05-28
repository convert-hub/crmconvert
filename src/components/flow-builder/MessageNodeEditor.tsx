import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { extractTemplateSlots, renderPreview } from '@/lib/metaTemplateVars';
import { VariableInput, VariableTextarea } from '@/components/shared/VariableField';
import { useSystemVariables } from '@/hooks/useSystemVariables';
import MessageItemsEditor, { type ContentItem } from './MessageItemsEditor';

interface MessageNodeData {
  label?: string;
  mode?: 'text' | 'template' | 'items';
  content?: string;
  items?: ContentItem[];
  templateInstanceId?: string;
  templateId?: string;
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: Record<string, string>;
}

interface Props {
  tenantId: string | null;
  data: MessageNodeData;
  onChange: (data: MessageNodeData) => void;
}

interface MetaInstance { id: string; display_name: string | null; instance_name: string; }
interface Template { id: string; name: string; language: string; whatsapp_instance_id: string; components: any; }

export default function MessageNodeEditor({ tenantId, data, onChange }: Props) {
  const mode = data.mode ?? 'text';
  const flowVars = useSystemVariables({ tenantId, scope: 'flow' });
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    (supabase.from as any)('whatsapp_instances_public')
      .select('id, display_name, instance_name')
      .eq('tenant_id', tenantId).eq('provider', 'meta_cloud').eq('is_active', true)
      .then(({ data }) => setInstances(data ?? []));
    supabase.from('whatsapp_message_templates')
      .select('id, name, language, whatsapp_instance_id, components')
      .eq('tenant_id', tenantId).eq('status', 'APPROVED').order('name')
      .then(({ data }) => setTemplates((data as any) ?? []));
  }, [tenantId]);

  const selectedTpl = templates.find(t => t.id === data.templateId);
  const slots = useMemo(() => extractTemplateSlots(selectedTpl?.components ?? []), [selectedTpl]);
  const headerComp = selectedTpl?.components?.find?.((c: any) => String(c.type).toUpperCase() === 'HEADER');
  const bodyComp = selectedTpl?.components?.find?.((c: any) => String(c.type).toUpperCase() === 'BODY');
  const tplsForInstance = templates.filter(t => !data.templateInstanceId || t.whatsapp_instance_id === data.templateInstanceId);

  const valuesByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of slots) {
      const v = data.templateVariables?.[s.id];
      if (v) out[s.key] = v;
    }
    return out;
  }, [slots, data.templateVariables]);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Tipo de mensagem</Label>
        <RadioGroup
          value={mode}
          onValueChange={v => onChange({ ...data, mode: v as 'text' | 'template' | 'items' })}
          className="flex flex-wrap gap-3"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="text" id="msg-mode-text" />
            <Label htmlFor="msg-mode-text" className="text-xs font-normal cursor-pointer">Texto livre</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="items" id="msg-mode-items" />
            <Label htmlFor="msg-mode-items" className="text-xs font-normal cursor-pointer">Conteúdo (vários itens)</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="template" id="msg-mode-template" />
            <Label htmlFor="msg-mode-template" className="text-xs font-normal cursor-pointer">Template Meta</Label>
          </div>
        </RadioGroup>
        <p className="text-[11px] text-muted-foreground">
          {mode === 'text'
            ? 'Mensagem livre — só envia se a janela 24h estiver aberta.'
            : mode === 'items'
            ? 'Empilhe texto, mídia, atrasos e ações inline (ex.: desligar IA). Itens são processados na ordem.'
            : 'Template aprovado pela Meta — funciona a qualquer momento em conversas Meta. Em UAZAPI, faz fallback para o texto livre.'}
        </p>
      </div>

      {mode === 'items' && (
        <MessageItemsEditor
          tenantId={tenantId}
          items={data.items ?? []}
          onChange={(items) => onChange({ ...data, items })}
        />
      )}

      {mode === 'text' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Conteúdo da mensagem</Label>
          <VariableTextarea
            variables={flowVars}
            value={data.content ?? ''}
            onChange={v => onChange({ ...data, content: v })}
            rows={4} className="text-sm"
            placeholder="Olá {{contact.name}}, como posso ajudar?"
          />
        </div>
      )}

      {mode === 'template' && (
        <>
          {instances.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma instância Meta Cloud ativa. Configure em Configurações → Conexões.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Instância Meta</Label>
                  <Select
                    value={data.templateInstanceId ?? ''}
                    onValueChange={v => onChange({ ...data, templateInstanceId: v, templateId: '', templateName: '', templateVariables: {} })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {instances.map(i => <SelectItem key={i.id} value={i.id}>{i.display_name || i.instance_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Template</Label>
                  <Select
                    value={data.templateId ?? ''}
                    onValueChange={v => {
                      const tpl = templates.find(t => t.id === v);
                      onChange({ ...data, templateId: v, templateName: tpl?.name ?? '', templateLanguage: tpl?.language ?? '', templateVariables: {} });
                    }}
                    disabled={!data.templateInstanceId}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {tplsForInstance.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.language})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedTpl && (headerComp?.text || bodyComp?.text) && (
                <div className="rounded-lg bg-muted/50 p-2 text-[11px] whitespace-pre-wrap space-y-1">
                  {headerComp?.text && <p className="font-semibold">{renderPreview(headerComp.text, valuesByKey)}</p>}
                  {bodyComp?.text && <p>{renderPreview(bodyComp.text, valuesByKey)}</p>}
                </div>
              )}

              {slots.map(s => (
                <div key={s.id} className="space-y-1">
                  <Label className="text-[11px]">{s.label}</Label>
                  <VariableInput
                    variables={flowVars}
                    value={data.templateVariables?.[s.id] ?? ''}
                    onChange={v => onChange({ ...data, templateVariables: { ...(data.templateVariables || {}), [s.id]: v } })}
                    placeholder="Texto fixo ou variável"
                    className="h-8 text-xs"
                  />
                </div>
              ))}
              {selectedTpl && slots.length === 0 && (
                <p className="text-[10px] text-muted-foreground">Este template não tem variáveis.</p>
              )}

              <div className="space-y-1">
                <Label className="text-[11px]">Fallback texto livre (UAZAPI / janela aberta)</Label>
                <VariableTextarea
                  variables={flowVars}
                  value={data.content ?? ''}
                  onChange={v => onChange({ ...data, content: v })}
                  rows={2} className="text-xs"
                  placeholder="Texto opcional usado em conversas UAZAPI"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
