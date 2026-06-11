import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { WhatsAppMessageTemplate } from '@/types/crm';
import { extractTemplateSlots, buildMetaComponents, renderPreview, type TemplateSlot } from '@/lib/metaTemplateVars';
import { VariableInput } from '@/components/shared/VariableField';
import { useSystemVariables } from '@/hooks/useSystemVariables';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  whatsappInstanceId: string;
  conversationId: string;
  contactName?: string | null;
  onSent?: () => void;
}

export default function SendTemplateDialog({ open, onOpenChange, tenantId, whatsappInstanceId, conversationId, contactName, onSent }: Props) {
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [realData, setRealData] = useState<{ contact: any | null; opportunity: any | null }>({ contact: null, opportunity: null });

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('whatsapp_message_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('whatsapp_instance_id', whatsappInstanceId)
        .eq('status', 'APPROVED')
        .order('name');
      if (error) toast.error(error.message);
      setTemplates((data ?? []) as WhatsAppMessageTemplate[]);
      setLoading(false);
    })();
  }, [open, tenantId, whatsappInstanceId]);

  // Carrega dados reais da conversa para resolver tokens na pré-visualização
  useEffect(() => {
    if (!open || !conversationId) return;
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
  }, [open, conversationId]);

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

  // Pre-fill the first slot with the contact name, if available — saves typing
  useEffect(() => {
    if (!selected || slots.length === 0 || !contactName) return;
    setValues(prev => {
      if (prev[slots[0].id]) return prev;
      return { ...prev, [slots[0].id]: contactName };
    });
  }, [selected, slots, contactName]);

  const headerComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'HEADER');
  const bodyComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'BODY');

  // Map slot.id → value, but also build a "by key" view for preview.
  // Se o valor digitado for um token puro {{x}}, resolve contra os dados reais
  // da conversa para que o operador veja o conteúdo final antes de enviar.
  const valuesByKey = useMemo(() => {
    const out: Record<string, string> = {};
    const tokenOnly = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/;
    for (const s of slots) {
      const raw = values[s.id];
      if (!raw) continue;
      const m = raw.match(tokenOnly);
      if (m) {
        const resolved = resolveToken(m[1]);
        out[s.key] = resolved ?? `(${m[1]} vazio)`;
      } else {
        out[s.key] = raw;
      }
    }
    return out;
  }, [slots, values, realData]);

  const tokenOnlyRe = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/;
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

  const handleSend = async () => {
    if (!selected) return;
    if (missingCount > 0) {
      toast.error(`Preencha as ${missingCount} variável(is) restantes`);
      return;
    }
    if (emptyTokenCount > 0) {
      toast.error('Há variáveis selecionadas sem valor para este contato. A Meta vai rejeitar o envio.');
      return;
    }
    setSending(true);
    try {
      const components = buildMetaComponents(slots, values);
      const { data, error } = await supabase.functions.invoke('wa-meta-send', {
        body: {
          action: 'send',
          conversation_id: conversationId,
          whatsapp_instance_id: whatsappInstanceId,
          type: 'template',
          template: {
            name: selected.name,
            language: selected.language,
            components,
          },
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        const detail = data?.details?.error?.message || data?.error || 'Falha ao enviar';
        throw new Error(detail);
      }
      toast.success('Template enviado');
      onSent?.();
      onOpenChange(false);
      setSelectedId('');
      setValues({});
    } catch (e: any) {
      toast.error(e.message ?? 'Erro');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar template aprovado</DialogTitle>
          <DialogDescription>
            A janela de 24h expirou. Use um template aprovado pela Meta para reabrir a conversa.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum template aprovado. Sincronize em Configurações → Integrações.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Template</Label>
              <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setValues({}); }}>
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
                {headerComp?.text && (
                  <p className="font-semibold">{renderPreview(headerComp.text, valuesByKey)}</p>
                )}
                {bodyComp?.text && (
                  <p>{renderPreview(bodyComp.text, valuesByKey)}</p>
                )}
                {realData.contact?.name && (
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">Pré-visualizando com dados de <span className="font-medium text-foreground">{realData.contact.name}</span></p>
                )}
              </div>
            )}


            {slots.map(s => (
              <div key={s.id} className="space-y-1">
                <Label htmlFor={`var-${s.id}`} className="text-xs">{s.label}</Label>
                <VariableInput
                  id={`var-${s.id}`}
                  variables={tplVars}
                  value={values[s.id] ?? ''}
                  onChange={v => setValues(prev => ({ ...prev, [s.id]: v }))}
                  placeholder={s.named ? s.key : `Valor para {{${s.key}}}`}
                />
              </div>
            ))}

            {selected && slots.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Este template não tem variáveis — pode enviar direto.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="rounded-xl" disabled={!selectedId || sending || missingCount > 0} onClick={handleSend}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
