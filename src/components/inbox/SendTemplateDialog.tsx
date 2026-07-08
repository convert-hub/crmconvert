import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send, Image as ImageIcon, Upload } from 'lucide-react';
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
  // Header de mídia: 'default' = veio do padrão salvo no template; 'custom' = upload/URL desta sessão
  const [mediaSource, setMediaSource] = useState<'default' | 'custom' | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);

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

  // Pre-fill the first TEXT slot with the contact name, if available — saves typing.
  // (media slots são preenchidos pelo default do template, não pelo nome do contato)
  useEffect(() => {
    if (!selected || slots.length === 0 || !contactName) return;
    const firstText = slots.find(s => s.kind !== 'media');
    if (!firstText) return;
    setValues(prev => {
      if (prev[firstText.id]) return prev;
      return { ...prev, [firstText.id]: contactName };
    });
  }, [selected, slots, contactName]);

  const mediaSlot = slots.find(s => s.kind === 'media');

  // Header de mídia: pré-preenche com a mídia padrão salva no template (se houver).
  // storage_path → signed URL de 24h; url → usa direto.
  useEffect(() => {
    if (!selected || !mediaSlot) { setMediaSource(null); return; }
    const def = (selected as any).default_header_media as { storage_path?: string; url?: string } | null;
    if (!def || values[mediaSlot.id]) return;
    let cancelled = false;
    (async () => {
      try {
        let url: string | null = null;
        if (def.storage_path) {
          const { data: signed } = await supabase.storage
            .from('whatsapp-media')
            .createSignedUrl(def.storage_path, 60 * 60 * 24);
          url = signed?.signedUrl ?? null;
        } else if (def.url) {
          url = def.url;
        }
        if (url && !cancelled) {
          setValues(prev => prev[mediaSlot.id] ? prev : { ...prev, [mediaSlot.id]: url! });
          setMediaSource('default');
        }
      } catch (e) {
        console.warn('[SendTemplateDialog] falha ao resolver mídia padrão do template', e);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, mediaSlot?.id]);

  const handleMediaUpload = async (file: File) => {
    if (!selected || !mediaSlot) return;
    setMediaBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.split('/')[1] ?? 'bin');
      const storagePath = `${tenantId}/template-headers/${selected.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('whatsapp-media')
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: true });
      if (upErr) { toast.error('Falha ao subir arquivo: ' + upErr.message); return; }
      const { data: signed, error: signErr } = await supabase.storage
        .from('whatsapp-media')
        .createSignedUrl(storagePath, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) { toast.error('Falha ao gerar URL do arquivo.'); return; }
      setValues(prev => ({ ...prev, [mediaSlot.id]: signed.signedUrl }));
      setMediaSource('custom');
      // Salva como padrão do template (best-effort — RLS permite admin/manager;
      // para atendentes o update falha silencioso e o envio segue normal).
      try {
        await (supabase.from('whatsapp_message_templates') as any)
          .update({ default_header_media: { storage_path: storagePath, mime: file.type, format: mediaSlot.mediaFormat } })
          .eq('id', selected.id);
        setTemplates(prev => prev.map(t => t.id === selected.id
          ? { ...t, default_header_media: { storage_path: storagePath, mime: file.type, format: mediaSlot.mediaFormat } } as any
          : t));
      } catch { /* noop */ }
    } finally {
      setMediaBusy(false);
    }
  };

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
      if (s.kind === 'media') continue; // valor é URL, não token
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
      // Replace any {{contact.*}} / {{opportunity.*}} tokens with real values
      // BEFORE shipping to Meta. Without this, the literal token reaches the
      // customer (regression seen on 2026-06-15 with contact.custom.*).
      const VAR_TOKEN_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
      const resolvedValues: Record<string, string> = {};
      for (const s of slots) {
        const raw = values[s.id] ?? '';
        // Media slots carregam URL — nunca aplicar substituição de tokens nelas
        resolvedValues[s.id] = s.kind === 'media' ? raw : raw.replace(VAR_TOKEN_RE, (match, path) => {
          const r = resolveToken(path);
          return r ?? match;
        });
      }
      const components = buildMetaComponents(slots, resolvedValues);
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
              <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setValues({}); setMediaSource(null); }}>
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

            {selected && (headerComp?.text || bodyComp?.text || mediaSlot) && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap space-y-2">
                {mediaSlot && (
                  values[mediaSlot.id] && mediaSlot.mediaFormat === 'image' ? (
                    <img src={values[mediaSlot.id]} alt="Cabeçalho" className="rounded-md max-h-28 w-auto" />
                  ) : (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {mediaSlot.mediaFormat === 'image' ? 'Imagem no cabeçalho' : mediaSlot.mediaFormat === 'video' ? 'Vídeo no cabeçalho' : 'Documento no cabeçalho'}
                      {!values[mediaSlot.id] && ' — pendente'}
                    </p>
                  )
                )}
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


            {slots.map(s => s.kind === 'media' ? (
              <div key={s.id} className="space-y-1">
                <Label className="text-xs">{s.label}</Label>
                <input
                  type="file"
                  ref={mediaFileRef}
                  className="hidden"
                  accept={MEDIA_ACCEPT[s.mediaFormat ?? 'image']}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleMediaUpload(f); e.target.value = ''; }}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" className="rounded-xl h-8 text-xs"
                    disabled={mediaBusy} onClick={() => mediaFileRef.current?.click()}>
                    {mediaBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                    {values[s.id] ? 'Trocar arquivo' : 'Enviar arquivo'}
                  </Button>
                  {values[s.id] && (
                    <span className="text-[11px] text-muted-foreground">
                      {mediaSource === 'default' ? 'Usando mídia padrão do template' : 'Arquivo anexado (salvo como padrão)'}
                    </span>
                  )}
                </div>
                {!values[s.id] && (
                  <p className="text-[11px] text-muted-foreground">
                    Este template tem {s.mediaFormat === 'image' ? 'imagem' : s.mediaFormat === 'video' ? 'vídeo' : 'documento'} no cabeçalho.
                    A Meta exige o arquivo em todo envio — a imagem cadastrada na aprovação é só amostra.
                  </p>
                )}
              </div>
            ) : (
              <div key={s.id} className="space-y-1">
                <Label htmlFor={`var-${s.id}`} className="text-xs">{s.label}</Label>
                <VariableInput
                  id={`var-${s.id}`}
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
              <p className="text-[11px] text-muted-foreground">Este template não tem variáveis — pode enviar direto.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="rounded-xl" disabled={!selectedId || sending || missingCount > 0 || emptyTokenCount > 0} onClick={handleSend}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
