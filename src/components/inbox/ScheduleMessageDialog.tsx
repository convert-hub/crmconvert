import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Clock, Info, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { WhatsAppMessageTemplate } from '@/types/crm';
import { extractTemplateSlots, buildMetaComponents, renderPreview, type TemplateSlot } from '@/lib/metaTemplateVars';
import { VariableInput } from '@/components/shared/VariableField';
import { useSystemVariables } from '@/hooks/useSystemVariables';

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  tenantId: string;
  membershipId: string;
  /** Presentes quando a conversa é da API Oficial (Meta) — habilita o modo template */
  provider?: 'meta_cloud' | 'uazapi' | null;
  whatsappInstanceId?: string | null;
}

export default function ScheduleMessageDialog({ open, onOpenChange, conversationId, tenantId, membershipId, provider, whatsappInstanceId }: ScheduleMessageDialogProps) {
  const isMeta = provider === 'meta_cloud' && !!whatsappInstanceId;

  const [mode, setMode] = useState<'text' | 'template'>('text');
  const [content, setContent] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [saving, setSaving] = useState(false);

  // ── Template state (só usado quando isMeta) ──
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [realData, setRealData] = useState<{ contact: any | null; opportunity: any | null }>({ contact: null, opportunity: null });

  useEffect(() => {
    if (!open || !isMeta) return;
    (async () => {
      setLoadingTpl(true);
      const { data, error } = await supabase
        .from('whatsapp_message_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('whatsapp_instance_id', whatsappInstanceId!)
        .eq('status', 'APPROVED')
        .order('name');
      if (error) toast.error(error.message);
      setTemplates((data ?? []) as WhatsAppMessageTemplate[]);
      setLoadingTpl(false);
    })();
  }, [open, isMeta, tenantId, whatsappInstanceId]);

  // Dados reais da conversa para resolver tokens {{contact.*}} / {{opportunity.*}}
  useEffect(() => {
    if (!open || !conversationId || !isMeta) return;
    (async () => {
      const { data: conv } = await supabase
        .from('conversations')
        .select('contact_id, opportunity_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (!conv) return;
      const [{ data: contact }, oppRes] = await Promise.all([
        conv.contact_id
          ? supabase.from('contacts').select('name, email, phone, custom_fields').eq('id', conv.contact_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
        conv.opportunity_id
          ? supabase.from('opportunities').select('title, value, custom_fields').eq('id', conv.opportunity_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      setRealData({ contact: contact ?? null, opportunity: oppRes?.data ?? null });
    })();
  }, [open, conversationId, isMeta]);

  const resolveToken = (raw: string): string | null => {
    const path = raw.trim();
    const c = realData.contact || {};
    const o = realData.opportunity || {};
    const cc = (c.custom_fields && typeof c.custom_fields === 'object') ? c.custom_fields as Record<string, unknown> : {};
    const oc = (o.custom_fields && typeof o.custom_fields === 'object') ? o.custom_fields as Record<string, unknown> : {};
    let v: unknown = undefined;
    if (path === 'contact.name') v = c.name;
    else if (path === 'contact.email') v = c.email;
    else if (path === 'contact.phone') v = c.phone;
    else if (path.startsWith('contact.custom.')) v = cc[path.slice('contact.custom.'.length)];
    else if (path === 'opportunity.title') v = o.title;
    else if (path === 'opportunity.value') v = o.value;
    else if (path.startsWith('opportunity.custom.')) v = oc[path.slice('opportunity.custom.'.length)];
    if (v === undefined || v === null || v === '') return null;
    return String(v);
  };

  const selected = templates.find(t => t.id === selectedId);
  const slots: TemplateSlot[] = useMemo(
    () => extractTemplateSlots((selected?.components as any) ?? []),
    [selected],
  );

  const headerComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'HEADER');
  const bodyComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'BODY');

  const tokenOnlyRe = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/;
  const valuesByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of slots) {
      const raw = values[s.id];
      if (!raw) continue;
      const m = raw.match(tokenOnlyRe);
      if (m) {
        const resolved = resolveToken(m[1]);
        out[s.key] = resolved ?? `(${m[1]} vazio)`;
      } else {
        out[s.key] = raw;
      }
    }
    return out;
  }, [slots, values, realData]);

  const emptyTokenSlots = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of slots) {
      const raw = values[s.id];
      if (!raw) continue;
      const m = raw.match(tokenOnlyRe);
      if (!m) continue;
      const resolved = resolveToken(m[1]);
      if (resolved === null) out[s.id] = m[1];
    }
    return out;
  }, [slots, values, realData]);

  const missingCount = slots.filter(s => !values[s.id]?.trim()).length;
  const emptyTokenCount = Object.keys(emptyTokenSlots).length;
  const tplVars = useSystemVariables({ tenantId, scope: 'template-meta', templateComponents: (selected?.components as any[]) ?? null });

  const handleSchedule = async () => {
    const isTemplate = isMeta && mode === 'template';
    if (isTemplate) {
      if (!selected || !date) { toast.error('Escolha o template e selecione uma data'); return; }
      if (missingCount > 0) { toast.error(`Preencha as ${missingCount} variável(is) restantes`); return; }
      if (emptyTokenCount > 0) { toast.error('Há variáveis selecionadas sem valor para este contato. A Meta vai rejeitar o envio.'); return; }
    } else if (!content.trim() || !date) {
      toast.error('Preencha a mensagem e selecione uma data');
      return;
    }

    const scheduledAt = new Date(date!);
    scheduledAt.setHours(parseInt(hour), parseInt(minute), 0, 0);

    if (scheduledAt <= new Date()) {
      toast.error('A data/hora deve ser no futuro');
      return;
    }

    setSaving(true);
    try {
      let template: Record<string, unknown> | null = null;
      let finalContent = content.trim();

      if (isTemplate && selected) {
        // Resolve tokens {{contact.*}} / {{opportunity.*}} agora (dados atuais da conversa),
        // igual ao envio manual de template — o que fica salvo já é o valor final.
        const VAR_TOKEN_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
        const resolvedValues: Record<string, string> = {};
        for (const s of slots) {
          const raw = values[s.id] ?? '';
          resolvedValues[s.id] = raw.replace(VAR_TOKEN_RE, (match, path) => resolveToken(path) ?? match);
        }
        const components = buildMetaComponents(slots, resolvedValues);
        template = {
          name: selected.name,
          language: selected.language,
          components,
          whatsapp_instance_id: whatsappInstanceId,
        };
        // Conteúdo textual salvo na conversa = pré-visualização renderizada do template
        const parts: string[] = [];
        if (headerComp?.text) parts.push(renderPreview(headerComp.text, valuesByKey));
        if (bodyComp?.text) parts.push(renderPreview(bodyComp.text, valuesByKey));
        finalContent = parts.join('\n') || `[template: ${selected.name}]`;
      }

      const { error } = await supabase.from('scheduled_messages').insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        content: finalContent,
        scheduled_at: scheduledAt.toISOString(),
        created_by: membershipId,
        template: template as any,
      } as any);

      if (error) { toast.error(error.message); return; }
      toast.success(`${isTemplate ? 'Template agendado' : 'Mensagem agendada'} para ${format(scheduledAt, "dd/MM/yyyy 'às' HH:mm")}`);
      setContent('');
      setDate(undefined);
      setSelectedId('');
      setValues({});
      setMode('text');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const minutes = ['00', '15', '30', '45'];

  const canSubmit = (isMeta && mode === 'template')
    ? !!selectedId && !!date && missingCount === 0 && emptyTokenCount === 0
    : !!content.trim() && !!date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Agendar Mensagem
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isMeta && (
            <>
              <div className="rounded-lg bg-muted/60 border border-border/60 p-2.5 flex gap-2 text-[12px] text-muted-foreground">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Se a mensagem agendada for enviada fora da janela de 24 horas, você precisa utilizar um template.</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Tipo de mensagem</Label>
                <Select value={mode} onValueChange={v => setMode(v as 'text' | 'template')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Mensagem de texto</SelectItem>
                    <SelectItem value="template">Template aprovado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {(!isMeta || mode === 'text') && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">Mensagem *</Label>
              <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Digite a mensagem..." className="min-h-[80px]" />
            </div>
          )}

          {isMeta && mode === 'template' && (
            loadingTpl ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 text-center">
                Nenhum template aprovado. Sincronize em Configurações → Integrações.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-[13px]">Template *</Label>
                  <Select value={selectedId} onValueChange={v => { setSelectedId(v); setValues({}); }}>
                    <SelectTrigger><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} <span className="text-muted-foreground text-xs ml-1">({t.language})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selected && (headerComp?.text || bodyComp?.text) && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap space-y-2">
                    {headerComp?.text && <p className="font-semibold">{renderPreview(headerComp.text, valuesByKey)}</p>}
                    {bodyComp?.text && <p>{renderPreview(bodyComp.text, valuesByKey)}</p>}
                    {realData.contact?.name && (
                      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                        Pré-visualizando com dados de <span className="font-medium text-foreground">{realData.contact.name}</span>
                      </p>
                    )}
                  </div>
                )}

                {slots.map(s => (
                  <div key={s.id} className="space-y-1">
                    <Label htmlFor={`sched-var-${s.id}`} className="text-xs">{s.label}</Label>
                    <VariableInput
                      id={`sched-var-${s.id}`}
                      variables={tplVars}
                      value={values[s.id] ?? ''}
                      onChange={v => setValues(prev => ({ ...prev, [s.id]: v }))}
                      placeholder={s.named ? s.key : `Valor para {{${s.key}}}`}
                    />
                    {emptyTokenSlots[s.id] && (
                      <p className="text-[11px] text-destructive">
                        ⚠ <span className="font-mono">{`{{${emptyTokenSlots[s.id]}}}`}</span> está vazio para {realData.contact?.name ?? 'este contato'}. A Meta vai rejeitar o envio.
                      </p>
                    )}
                  </div>
                ))}

                {selected && slots.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">Este template não tem variáveis — pode agendar direto.</p>
                )}
              </div>
            )
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px]">Data *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {date ? format(date, 'dd/MM/yyyy') : 'Selecionar data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={d => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Hora</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  {hours.map(h => <SelectItem key={h} value={h}>{h}h</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Minuto</Label>
              <Select value={minute} onValueChange={setMinute}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {minutes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleSchedule} disabled={saving || !canSubmit} className="w-full">
            {saving ? 'Agendando...' : 'Agendar Envio'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
