import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Clock, Image as ImageIcon, Info, Loader2, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { WhatsAppMessageTemplate } from '@/types/crm';
import { extractTemplateSlots, buildMetaComponents, renderPreview, type TemplateSlot } from '@/lib/metaTemplateVars';
import { VariableInput } from '@/components/shared/VariableField';
import { useSystemVariables } from '@/hooks/useSystemVariables';

// Extensões/accept por formato de header de mídia (limites da Cloud API)
const MEDIA_ACCEPT: Record<string, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4',
  document: 'application/pdf',
};

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
  // Header de mídia: path no bucket whatsapp-media — fica salvo no agendamento
  // para a check-scheduled-messages gerar URL fresca NA HORA do disparo
  // (a URL assinada expira em 24h; o agendamento pode ser para depois disso).
  const [mediaStoragePath, setMediaStoragePath] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);

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
  const mediaSlot = slots.find(s => s.kind === 'media');
  const textSlots = slots.filter(s => s.kind !== 'media');

  const headerComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'HEADER');
  const bodyComp = (selected?.components as any[] | undefined)?.find((c: any) => String(c.type).toUpperCase() === 'BODY');

  // Pré-preenche o header de mídia com o padrão salvo no template (se houver),
  // igual ao envio manual: storage_path → URL assinada p/ preview; url → direto.
  useEffect(() => {
    setMediaStoragePath(null);
    if (!selected || !mediaSlot) return;
    const def = (selected as any).default_header_media as { storage_path?: string; url?: string } | null;
    if (!def) return;
    (async () => {
      try {
        if (def.storage_path) {
          const { data: signed } = await supabase.storage
            .from('whatsapp-media')
            .createSignedUrl(def.storage_path, 60 * 60 * 24);
          if (signed?.signedUrl) {
            setValues(prev => ({ ...prev, [mediaSlot.id]: signed.signedUrl }));
            setMediaStoragePath(def.storage_path);
          }
        } else if (def.url) {
          setValues(prev => ({ ...prev, [mediaSlot.id]: def.url! }));
        }
      } catch { /* sem mídia padrão utilizável — usuário faz upload */ }
    })();
  }, [selectedId, templates]);

  const handleMediaUpload = async (file: File) => {
    if (!selected || !mediaSlot) return;
    setMediaBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.split('/')[1] ?? 'bin');
      const storagePath = `${tenantId}/template-headers/${selected.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('whatsapp-media')
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: true });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from('whatsapp-media')
        .createSignedUrl(storagePath, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error('Falha ao gerar URL da mídia');
      setValues(prev => ({ ...prev, [mediaSlot.id]: signed.signedUrl }));
      setMediaStoragePath(storagePath);
      // Salva como mídia padrão do template — pré-preenche próximos envios/agendamentos
      supabase.from('whatsapp_message_templates')
        .update({ default_header_media: { storage_path: storagePath, mime: file.type, format: mediaSlot.mediaFormat } } as any)
        .eq('id', selected.id)
        .then(() => {
          setTemplates(prev => prev.map(t => t.id === selected.id
            ? { ...t, default_header_media: { storage_path: storagePath, mime: file.type, format: mediaSlot.mediaFormat } } as any
            : t));
        });
    } catch (e: any) {
      toast.error('Falha no upload: ' + (e?.message ?? e));
    } finally {
      setMediaBusy(false);
    }
  };

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
          // Caminho permanente da mídia do header: a check-scheduled-messages gera
          // uma URL assinada FRESCA na hora do disparo (a daqui expira em 24h)
          ...(mediaStoragePath ? { header_media_storage_path: mediaStoragePath } : {}),
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
      setMediaStoragePath(null);
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
                  <Select value={selectedId} onValueChange={v => { setSelectedId(v); setValues({}); setMediaStoragePath(null); }}>
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

                {mediaSlot && (
                  <div className="space-y-2 rounded-lg border border-border/60 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {mediaSlot.mediaFormat === 'image' ? 'Imagem no cabeçalho' : mediaSlot.mediaFormat === 'video' ? 'Vídeo no cabeçalho' : 'Documento no cabeçalho'}
                    </div>
                    {values[mediaSlot.id] && mediaSlot.mediaFormat === 'image' && (
                      <img src={values[mediaSlot.id]} alt="Cabeçalho do template" className="max-h-32 rounded-md border border-border/50" />
                    )}
                    <input
                      type="file"
                      ref={mediaFileRef}
                      className="hidden"
                      accept={MEDIA_ACCEPT[mediaSlot.mediaFormat ?? 'image']}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleMediaUpload(f); e.target.value = ''; }}
                    />
                    <Button type="button" size="sm" variant="outline" className="w-full" disabled={mediaBusy} onClick={() => mediaFileRef.current?.click()}>
                      {mediaBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                      {values[mediaSlot.id]
                        ? 'Trocar arquivo'
                        : mediaSlot.mediaFormat === 'image' ? 'Enviar imagem' : mediaSlot.mediaFormat === 'video' ? 'Enviar vídeo' : 'Enviar documento'}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      Este template tem {mediaSlot.mediaFormat === 'image' ? 'imagem' : mediaSlot.mediaFormat === 'video' ? 'vídeo' : 'documento'} no cabeçalho — a Meta exige o arquivo em todo envio.{' '}
                      {values[mediaSlot.id]
                        ? 'Arquivo pronto: será usado no disparo agendado.'
                        : 'Envie o arquivo acima para liberar o agendamento.'}
                    </p>
                  </div>
                )}

                {textSlots.map(s => (
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
