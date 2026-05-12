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

  // Map slot.id → value, but also build a "by key" view for preview
  const valuesByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of slots) {
      if (values[s.id]) out[s.key] = values[s.id];
    }
    return out;
  }, [slots, values]);

  const missingCount = slots.filter(s => !values[s.id]?.trim()).length;

  const handleSend = async () => {
    if (!selected) return;
    if (missingCount > 0) {
      toast.error(`Preencha as ${missingCount} variável(is) restantes`);
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
              </div>
            )}

            {slots.map(s => (
              <div key={s.id} className="space-y-1">
                <Label htmlFor={`var-${s.id}`} className="text-xs">{s.label}</Label>
                <Input
                  id={`var-${s.id}`}
                  value={values[s.id] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [s.id]: e.target.value }))}
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
