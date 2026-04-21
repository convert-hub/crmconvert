import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Send, Play, Pause, Trash2, Users, FileCheck2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Campaign, CampaignAudienceFilter } from '@/types/crm';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';

interface MetaInstance { id: string; display_name: string | null; instance_name: string; }
interface Template { id: string; name: string; language: string; whatsapp_instance_id: string; components: any; }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', color: 'bg-blue-500/10 text-blue-600' },
  running: { label: 'Em execução', color: 'bg-green-500/10 text-green-600' },
  paused: { label: 'Pausada', color: 'bg-amber-500/10 text-amber-600' },
  completed: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600' },
  failed: { label: 'Falhou', color: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelada', color: 'bg-muted text-muted-foreground' },
};

export default function CampaignsPage() {
  const { tenant } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [throttle, setThrottle] = useState(60);
  const [scheduledAt, setScheduledAt] = useState('');
  const [filter, setFilter] = useState<CampaignAudienceFilter>({ exclude_do_not_contact: true, has_phone: true });
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  const load = () => {
    if (!tenant) return;
    supabase.from('campaigns').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false })
      .then(({ data }) => setCampaigns((data as any) ?? []));
  };

  useEffect(() => {
    if (!tenant) return;
    load();
    supabase.from('whatsapp_instances').select('id, display_name, instance_name')
      .eq('tenant_id', tenant.id).eq('provider', 'meta_cloud').eq('is_active', true)
      .then(({ data }) => setInstances(data ?? []));
    supabase.from('whatsapp_message_templates').select('id, name, language, whatsapp_instance_id, components')
      .eq('tenant_id', tenant.id).eq('status', 'APPROVED').order('name')
      .then(({ data }) => setTemplates((data as any) ?? []));
  }, [tenant]);

  const selectedTpl = templates.find(t => t.id === templateId);
  const bodyComp = selectedTpl?.components?.find?.((c: any) => c.type === 'BODY');
  const placeholders = bodyComp ? Array.from(new Set(((bodyComp.text as string) ?? '').match(/\{\{(\d+)\}\}/g) || []))
    .map((m: string) => m.replace(/[{}]/g, '')).sort((a, b) => Number(a) - Number(b)) : [];
  const tplsForInstance = templates.filter(t => !instanceId || t.whatsapp_instance_id === instanceId);

  const buildAudienceQuery = () => {
    if (!tenant) return null;
    let q = supabase.from('contacts').select('id, name, phone, email', { count: 'exact' }).eq('tenant_id', tenant.id);
    if (filter.has_phone) q = q.not('phone', 'is', null);
    if (filter.exclude_do_not_contact) q = q.eq('do_not_contact', false);
    if (filter.tags && filter.tags.length > 0) q = q.contains('tags', filter.tags);
    if (filter.status && filter.status.length > 0) q = q.in('status', filter.status);
    if (filter.utm_source) q = q.eq('utm_source', filter.utm_source);
    if (filter.utm_campaign) q = q.eq('utm_campaign', filter.utm_campaign);
    if (filter.source) q = q.eq('source', filter.source);
    return q;
  };

  const previewAudience = async () => {
    const q = buildAudienceQuery();
    if (!q) return;
    const { count } = await q.range(0, 0);
    setAudienceCount(count ?? 0);
  };

  const resetForm = () => {
    setName(''); setDescription(''); setInstanceId(''); setTemplateId('');
    setThrottle(60); setScheduledAt(''); setVariables({});
    setFilter({ exclude_do_not_contact: true, has_phone: true });
    setAudienceCount(null);
  };

  const handleCreate = async () => {
    if (!tenant) return;
    if (!name.trim() || !instanceId || !templateId) {
      toast.error('Preencha nome, instância e template');
      return;
    }
    setBusy('create');
    try {
      // 1) Create campaign
      const { data: campaign, error } = await supabase.from('campaigns').insert({
        tenant_id: tenant.id,
        name,
        description: description || null,
        whatsapp_instance_id: instanceId,
        template_id: templateId,
        template_variables: variables,
        audience_filter: filter as any,
        throttle_per_minute: throttle,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        status: scheduledAt ? 'scheduled' : 'draft',
      }).select('*').single();
      if (error) throw error;

      // 2) Snapshot audience as recipients
      const q = buildAudienceQuery();
      if (q) {
        const { data: contacts } = await q.range(0, 9999); // up to 10k
        if (contacts && contacts.length > 0) {
          const rows = contacts.map((c: any) => ({
            tenant_id: tenant.id,
            campaign_id: campaign.id,
            contact_id: c.id,
            variables_used: {},
            status: 'pending',
          }));
          // chunk insert
          for (let i = 0; i < rows.length; i += 500) {
            await supabase.from('campaign_recipients').insert(rows.slice(i, i + 500));
          }
          await supabase.from('campaigns').update({ total_recipients: rows.length }).eq('id', campaign.id);
        }
      }

      toast.success('Campanha criada');
      setDialogOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar campanha');
    } finally {
      setBusy(null);
    }
  };

  const dispatch = async (campaign: Campaign, action: 'start' | 'pause' | 'cancel') => {
    setBusy(campaign.id);
    try {
      const { data, error } = await supabase.functions.invoke('campaign-dispatch', {
        body: { action, campaign_id: campaign.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao despachar');
      toast.success(action === 'start' ? `Iniciada · ${data.sent ?? 0} enviadas` : action === 'pause' ? 'Pausada' : 'Cancelada');
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta campanha?')) return;
    await supabase.from('campaigns').delete().eq('id', id);
    toast.success('Campanha removida');
    load();
  };

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Campanhas</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Disparos em massa via templates aprovados (Meta Cloud)</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) resetForm(); setDialogOpen(v); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9 text-xs"><Plus className="h-3.5 w-3.5 mr-1.5" />Nova Campanha</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-base">Nova Campanha</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" placeholder="Ex: Reaquecimento Black Friday" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Throttle (msgs/min)</Label>
                  <Input type="number" min={1} max={200} value={throttle} onChange={e => setThrottle(Number(e.target.value))} className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição (opcional)</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Instância Meta</Label>
                  <Select value={instanceId} onValueChange={v => { setInstanceId(v); setTemplateId(''); setVariables({}); }}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {instances.map(i => <SelectItem key={i.id} value={i.id}>{i.display_name || i.instance_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Template aprovado</Label>
                  <Select value={templateId} onValueChange={setTemplateId} disabled={!instanceId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {tplsForInstance.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.language})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedTpl && bodyComp?.text && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">{bodyComp.text}</div>
              )}

              {placeholders.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Variáveis do template</Label>
                  {placeholders.map(p => (
                    <div key={p} className="flex items-center gap-2">
                      <Label className="text-[11px] whitespace-nowrap">{`{{${p}}}`}</Label>
                      <Input
                        value={variables[p] ?? ''}
                        onChange={e => setVariables(v => ({ ...v, [p]: e.target.value }))}
                        placeholder="Texto fixo ou {{contact.name}} / {{contact.email}}"
                        className="h-8 text-xs flex-1"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-border p-3 bg-accent/30">
                <Label className="text-xs font-medium">Público</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Tag (opcional)</Label>
                    <TagPickerSelect value={filter.tags?.[0] ?? ''} onChange={v => setFilter(f => ({ ...f, tags: v ? [v] : undefined }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Status</Label>
                    <Select value={filter.status?.[0] ?? '_any'} onValueChange={v => setFilter(f => ({ ...f, status: v === '_any' ? undefined : [v as any] }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_any">Qualquer</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="customer">Cliente</SelectItem>
                        <SelectItem value="churned">Churned</SelectItem>
                        <SelectItem value="inactive">Inativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">UTM source</Label>
                    <Input value={filter.utm_source ?? ''} onChange={e => setFilter(f => ({ ...f, utm_source: e.target.value || null }))} placeholder="ex: facebook_ads" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">UTM campaign</Label>
                    <Input value={filter.utm_campaign ?? ''} onChange={e => setFilter(f => ({ ...f, utm_campaign: e.target.value || null }))} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={!!filter.exclude_do_not_contact} onCheckedChange={v => setFilter(f => ({ ...f, exclude_do_not_contact: v }))} />
                    <Label className="text-[11px]">Excluir "não contatar"</Label>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={previewAudience}>
                    <Users className="h-3 w-3 mr-1.5" />Calcular público
                  </Button>
                </div>
                {audienceCount !== null && (
                  <p className="text-xs text-foreground font-medium">{audienceCount} contato(s) atendem aos critérios</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Agendar para (opcional)</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={busy === 'create'}>
                {busy === 'create' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                Criar campanha
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {instances.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          Para criar campanhas, configure pelo menos uma instância <strong>Meta Cloud</strong> em Configurações → Conexões.
        </div>
      )}

      <div className="space-y-2">
        {campaigns.length === 0 ? (
          <div className="text-center py-16">
            <FileCheck2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma campanha criada</p>
          </div>
        ) : campaigns.map(c => {
          const status = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft;
          const tpl = templates.find(t => t.id === c.template_id);
          const inst = instances.find(i => i.id === c.whatsapp_instance_id);
          return (
            <Card key={c.id} className="hover-lift">
              <CardContent className="py-3.5 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium truncate">{c.name}</h3>
                      <Badge className={`text-[10px] h-5 rounded-md font-normal ${status.color}`}>{status.label}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Template: <strong>{tpl?.name ?? c.template_id}</strong> · Instância: {inst?.display_name || inst?.instance_name || '?'} · {c.throttle_per_minute}/min
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span>📋 {c.total_recipients} dest.</span>
                      <span>✓ {c.sent_count} enviadas</span>
                      <span>📨 {c.delivered_count} entregues</span>
                      <span>👁 {c.read_count} lidas</span>
                      <span>💬 {c.replied_count} respostas</span>
                      <span className="text-destructive">⚠ {c.failed_count} falhas</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(c.status === 'draft' || c.status === 'scheduled' || c.status === 'paused') && (
                      <Button size="sm" variant="default" className="h-8 text-xs" disabled={busy === c.id} onClick={() => dispatch(c, 'start')}>
                        {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Play className="h-3 w-3 mr-1" />Iniciar</>}
                      </Button>
                    )}
                    {c.status === 'running' && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === c.id} onClick={() => dispatch(c, 'pause')}>
                        <Pause className="h-3 w-3 mr-1" />Pausar
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Criada em {format(new Date(c.created_at), 'dd/MM/yyyy HH:mm')}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
