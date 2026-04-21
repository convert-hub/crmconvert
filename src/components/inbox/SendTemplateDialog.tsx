import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { WhatsAppMessageTemplate } from '@/types/crm';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  whatsappInstanceId: string;
  conversationId: string;
  onSent?: () => void;
}

interface TemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  text?: string;
  parameters?: any[];
  example?: { body_text?: string[][]; header_text?: string[] };
}

export default function SendTemplateDialog({ open, onOpenChange, tenantId, whatsappInstanceId, conversationId, onSent }: Props) {
  const [templates, setTemplates] = useState<WhatsAppMessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [variables, setVariables] = useState<Record<string, string>>({});

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
  const bodyComponent = selected?.components.find((c: any) => c.type === 'BODY') as TemplateComponent | undefined;
  const placeholders = extractPlaceholders(bodyComponent?.text ?? '');

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      const components: any[] = [];
      if (placeholders.length > 0) {
        components.push({
          type: 'body',
          parameters: placeholders.map(p => ({ type: 'text', text: variables[p] ?? '' })),
        });
      }
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
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao enviar');
      toast.success('Template enviado');
      onSent?.();
      onOpenChange(false);
      setSelectedId('');
      setVariables({});
    } catch (e: any) {
      toast.error(e.message ?? 'Erro');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
              <Select value={selectedId} onValueChange={setSelectedId}>
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

            {selected && bodyComponent?.text && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">{bodyComponent.text}</div>
            )}

            {placeholders.map(p => (
              <div key={p} className="space-y-1">
                <Label htmlFor={`var-${p}`}>Variável {`{{${p}}}`}</Label>
                <Input
                  id={`var-${p}`}
                  value={variables[p] ?? ''}
                  onChange={e => setVariables(v => ({ ...v, [p]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="rounded-xl" disabled={!selectedId || sending} onClick={handleSend}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractPlaceholders(text: string): string[] {
  const re = /\{\{(\d+)\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}
