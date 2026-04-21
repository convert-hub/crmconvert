import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface MessageNodeData {
  label?: string;
  mode?: 'text' | 'template';
  content?: string;
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
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('whatsapp_instances')
      .select('id, display_name, instance_name')
      .eq('tenant_id', tenantId).eq('provider', 'meta_cloud').eq('is_active', true)
      .then(({ data }) => setInstances(data ?? []));
    supabase.from('whatsapp_message_templates')
      .select('id, name, language, whatsapp_instance_id, components')
      .eq('tenant_id', tenantId).eq('status', 'APPROVED').order('name')
      .then(({ data }) => setTemplates((data as any) ?? []));
  }, [tenantId]);

  const selectedTpl = templates.find(t => t.id === data.templateId);
  const bodyComp = selectedTpl?.components?.find?.((c: any) => c.type === 'BODY');
  const placeholders = bodyComp ? Array.from(new Set(((bodyComp.text as string) ?? '').match(/\{\{(\d+)\}\}/g) || []))
    .map((m: string) => m.replace(/[{}]/g, '')).sort((a, b) => Number(a) - Number(b)) : [];
  const tplsForInstance = templates.filter(t => !data.templateInstanceId || t.whatsapp_instance_id === data.templateInstanceId);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Tipo de mensagem</Label>
        <RadioGroup
          value={mode}
          onValueChange={v => onChange({ ...data, mode: v as 'text' | 'template' })}
          className="flex gap-4"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="text" id="msg-mode-text" />
            <Label htmlFor="msg-mode-text" className="text-xs font-normal cursor-pointer">Texto livre (24h)</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="template" id="msg-mode-template" />
            <Label htmlFor="msg-mode-template" className="text-xs font-normal cursor-pointer">Template aprovado (Meta)</Label>
          </div>
        </RadioGroup>
        <p className="text-[11px] text-muted-foreground">
          {mode === 'text'
            ? 'Mensagem livre — só envia se a janela 24h estiver aberta. Em conversas Meta fora da janela, o nó é ignorado.'
            : 'Template aprovado pela Meta — funciona a qualquer momento em conversas de instâncias Meta. Em conversas UAZAPI, faz fallback para o texto livre.'}
        </p>
      </div>

      {mode === 'text' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Conteúdo da mensagem</Label>
          <Textarea
            value={data.content ?? ''}
            onChange={e => onChange({ ...data, content: e.target.value })}
            rows={4} className="text-sm"
            placeholder="Olá {{nome}}, como posso ajudar?"
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

              {selectedTpl && bodyComp?.text && (
                <div className="rounded-lg bg-muted/50 p-2 text-[11px] whitespace-pre-wrap">{bodyComp.text}</div>
              )}

              {placeholders.map(p => (
                <div key={p} className="space-y-1">
                  <Label className="text-[11px]">Variável {`{{${p}}}`}</Label>
                  <Input
                    value={data.templateVariables?.[p] ?? ''}
                    onChange={e => onChange({ ...data, templateVariables: { ...(data.templateVariables || {}), [p]: e.target.value } })}
                    placeholder="Texto fixo ou {{contact.name}}"
                    className="h-8 text-xs"
                  />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Variáveis suportadas: <code>{'{{contact.name}}'}</code>, <code>{'{{contact.email}}'}</code>, <code>{'{{contact.phone}}'}</code>.</p>

              <div className="space-y-1">
                <Label className="text-[11px]">Fallback texto livre (UAZAPI / janela aberta)</Label>
                <Textarea
                  value={data.content ?? ''}
                  onChange={e => onChange({ ...data, content: e.target.value })}
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
