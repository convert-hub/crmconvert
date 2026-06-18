import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaignRealtime } from '@/hooks/useCampaignRealtime';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, RefreshCw, Loader2, Download } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportCampaignCsv } from '@/lib/exportCampaign';


const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', color: 'bg-blue-500/10 text-blue-600' },
  running: { label: 'Em execução', color: 'bg-green-500/10 text-green-600' },
  paused: { label: 'Pausada', color: 'bg-amber-500/10 text-amber-600' },
  completed: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600' },
  failed: { label: 'Falhou', color: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelada', color: 'bg-muted text-muted-foreground' },
};

const RECIPIENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-muted text-muted-foreground' },
  sending: { label: 'Enviando', color: 'bg-blue-500/10 text-blue-600' },
  skipped: { label: 'Ignorado', color: 'bg-muted text-muted-foreground' },
  sent: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-600' },
  delivered: { label: 'Entregue', color: 'bg-cyan-500/10 text-cyan-600' },
  read: { label: 'Lida', color: 'bg-violet-500/10 text-violet-600' },
  replied: { label: 'Respondeu', color: 'bg-emerald-500/10 text-emerald-600' },
  failed: { label: 'Falha', color: 'bg-destructive/10 text-destructive' },
};

const STATUS_OPTIONS = Object.keys(RECIPIENT_STATUS);
const PAGE_SIZE = 50;

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenant, role } = useAuth();
  const canRecompute = role === 'admin' || role === 'manager';

  const [campaign, setCampaign] = useState<any | null>(null);
  const [template, setTemplate] = useState<any | null>(null);
  const [instance, setInstance] = useState<any | null>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, { name: string; phone: string | null }>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [distribution, setDistribution] = useState<Record<string, number>>({});

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchDebounced, setSearchDebounced] = useState('');

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // Load campaign + template + instance
  useEffect(() => {
    if (!id || !tenant) return;
    (async () => {
      const { data: c } = await supabase.from('campaigns').select('*').eq('id', id).eq('tenant_id', tenant.id).maybeSingle();
      setCampaign(c);
      if (c?.template_id) {
        const { data: t } = await supabase.from('whatsapp_message_templates').select('id, name, language').eq('id', c.template_id).maybeSingle();
        setTemplate(t);
      }
      if (c?.whatsapp_instance_id) {
        const { data: i } = await (supabase.from as any)('whatsapp_instances_public')
          .select('id, display_name, instance_name').eq('id', c.whatsapp_instance_id).maybeSingle();
        setInstance(i);
      }
    })();
  }, [id, tenant]);

  // Load recipients (server-side filter + pagination)
  const loadRecipients = async () => {
    if (!id || !tenant) return;
    let q = supabase.from('campaign_recipients')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenant.id).eq('campaign_id', id);
    if (statusFilter.length > 0) q = q.in('status', statusFilter);
    if (searchDebounced) {
      // need contact_ids matching search
      const { data: cs } = await supabase.from('contacts').select('id')
        .eq('tenant_id', tenant.id)
        .or(`name.ilike.%${searchDebounced}%,phone.ilike.%${searchDebounced}%`)
        .limit(500);
      const ids = (cs ?? []).map((x: any) => x.id);
      if (ids.length === 0) { setRecipients([]); setTotal(0); return; }
      q = q.in('contact_id', ids);
    }
    const from = page * PAGE_SIZE;
    const { data, count } = await q.order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    const rows = (data as any[]) ?? [];
    setRecipients(rows);
    setTotal(count ?? 0);
    // resolve contacts
    const missingIds = Array.from(new Set(rows.map(r => r.contact_id).filter((cid: string) => cid && !contactsMap[cid])));
    if (missingIds.length > 0) {
      const { data: cs } = await supabase.from('contacts').select('id, name, phone').in('id', missingIds);
      const next: Record<string, { name: string; phone: string | null }> = { ...contactsMap };
      (cs ?? []).forEach((c: any) => { next[c.id] = { name: c.name, phone: c.phone }; });
      setContactsMap(next);
    }
  };

  useEffect(() => { loadRecipients(); }, [id, tenant?.id, page, statusFilter.join(','), searchDebounced]);

  // Real distribution by status (independent of pagination/filters)
  const loadDistribution = async () => {
    if (!id || !tenant) return;
    const statuses = ['pending', 'sending', 'skipped', 'sent', 'delivered', 'read', 'replied', 'failed'];
    const next: Record<string, number> = {};
    await Promise.all(statuses.map(async (s) => {
      const { count } = await supabase.from('campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id).eq('campaign_id', id).eq('status', s);
      next[s] = count ?? 0;
    }));
    setDistribution(next);
  };
  useEffect(() => { loadDistribution(); }, [id, tenant?.id, campaign?.updated_at]);



  // Realtime: campaign updates + recipient deltas
  useCampaignRealtime({
    tenantId: tenant?.id ?? null,
    campaignId: id ?? null,
    onCampaignChange: (row) => {
      if (row?.id === id) setCampaign((prev: any) => prev ? { ...prev, ...row } : row);
    },
    onRecipientChange: (rows) => {
      setRecipients(prev => {
        const byId = new Map(prev.map(r => [r.id, r]));
        for (const r of rows) {
          if (byId.has(r.id)) byId.set(r.id, { ...byId.get(r.id), ...r });
        }
        return Array.from(byId.values());
      });
    },
  });

  const recompute = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc('recompute_campaign_counters', { _campaign_id: id });
      if (error) throw error;
      const { data: c } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle();
      setCampaign(c);
      toast.success('Contadores recalculados');
    } catch (e: any) {
      toast.error(e.message ?? 'Falha ao recalcular');
    } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (!campaign || !tenant) return;
    setBusy(true);
    try {
      await exportCampaignCsv({ id: campaign.id, name: campaign.name, tenant_id: tenant.id });
      toast.success('Planilha exportada');
    } catch (e: any) {
      toast.error(e.message ?? 'Falha ao exportar');
    } finally { setBusy(false); }
  };

  const status = campaign ? (STATUS_LABELS[campaign.status] ?? STATUS_LABELS.draft) : null;
  const totalRec = campaign?.total_recipients ?? 0;
  const pending = Math.max(0, totalRec - (campaign?.sent_count ?? 0) - (campaign?.failed_count ?? 0));
  const progressPct = totalRec > 0 ? Math.min(100, Math.round(((campaign?.sent_count ?? 0) / totalRec) * 100)) : 0;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleStatus = (s: string) => {
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(0);
  };

  const cards = useMemo(() => ([
    { label: 'Pendentes', value: pending, color: 'text-muted-foreground' },
    { label: 'Enviadas', value: campaign?.sent_count ?? 0, color: 'text-blue-600' },
    { label: 'Entregues', value: campaign?.delivered_count ?? 0, color: 'text-cyan-600' },
    { label: 'Lidas', value: campaign?.read_count ?? 0, color: 'text-violet-600' },
    { label: 'Respondidas', value: campaign?.replied_count ?? 0, color: 'text-emerald-600' },
    { label: 'Falhas', value: campaign?.failed_count ?? 0, color: 'text-destructive' },
  ]), [campaign, pending]);

  if (!campaign) {
    return <div className="p-6 text-xs text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6 max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/campaigns" className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" />Voltar
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold text-foreground truncate">{campaign.name}</h1>
            {status && <Badge className={`text-[10px] h-5 rounded-md font-normal ${status.color}`}>{status.label}</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Template: <strong>{template?.name ?? campaign.template_id}</strong>
            {' · '}Instância: {instance?.display_name || instance?.instance_name || '?'}
            {' · '}{campaign.throttle_per_minute}/min
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCsv} disabled={busy}>
            <Download className="h-3 w-3 mr-1.5" />Exportar
          </Button>
          {canRecompute && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={recompute} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
              Recalcular
            </Button>
          )}
        </div>

      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {cards.map(c => (
          <Card key={c.label}>
            <CardContent className="py-3 px-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{c.label}</div>
              <div className={`text-lg font-semibold ${c.color}`}>{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progresso de envio</span>
          <span>{campaign.sent_count ?? 0} / {totalRec} ({progressPct}%)</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground border-t border-border pt-2.5">
        <span className="text-foreground/70 font-medium">Distribuição:</span>
        <span>Pendentes <strong className="text-foreground">{distribution.pending ?? 0}</strong></span>
        <span>·</span>
        <span>Em envio <strong className="text-foreground">{distribution.sending ?? 0}</strong></span>
        <span>·</span>
        <span>Puladas <strong className="text-foreground">{distribution.skipped ?? 0}</strong></span>
        <span>·</span>
        <span>Falhas <strong className="text-foreground">{distribution.failed ?? 0}</strong></span>
        <span>·</span>
        <span>Total <strong className="text-foreground">{totalRec}</strong></span>
        <span className="ml-auto text-muted-foreground/70" title="Lida ⊂ Entregue ⊂ Enviada. Os contadores acima são cumulativos.">ⓘ contadores cumulativos</span>
      </div>




      <div className="flex items-center gap-2 flex-wrap">
        <Input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Buscar por nome ou telefone..." className="h-8 text-xs max-w-xs" />
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_OPTIONS.map(s => {
            const active = statusFilter.includes(s);
            const def = RECIPIENT_STATUS[s];
            return (
              <button key={s} onClick={() => toggleStatus(s)}
                className={`text-[10px] px-2 h-6 rounded-md border ${active ? def.color + ' border-transparent' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                {def.label}
              </button>
            );
          })}
          {statusFilter.length > 0 && (
            <button onClick={() => { setStatusFilter([]); setPage(0); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5">Limpar</button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-normal px-3 py-2">Contato</th>
              <th className="text-left font-normal px-3 py-2">Status</th>
              <th className="text-left font-normal px-3 py-2">Enviada</th>
              <th className="text-left font-normal px-3 py-2">Entregue</th>
              <th className="text-left font-normal px-3 py-2">Lida</th>
              <th className="text-left font-normal px-3 py-2">Erro</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum destinatário</td></tr>
            ) : recipients.map(r => {
              const def = RECIPIENT_STATUS[r.status] ?? RECIPIENT_STATUS.pending;
              const c = contactsMap[r.contact_id];
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground truncate">{c?.name ?? r.contact_id.slice(0, 8)}</div>
                    <div className="text-[10px] text-muted-foreground">{c?.phone ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2"><Badge className={`text-[10px] h-5 rounded-md font-normal ${def.color}`}>{def.label}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{r.sent_at ? format(new Date(r.sent_at), 'dd/MM HH:mm:ss') : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.delivered_at ? format(new Date(r.delivered_at), 'dd/MM HH:mm:ss') : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.read_at ? format(new Date(r.read_at), 'dd/MM HH:mm:ss') : '—'}</td>
                  <td className="px-3 py-2 text-destructive truncate max-w-[200px]" title={r.error ?? ''}>{r.error ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{total} destinatários · página {page + 1} de {pageCount}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Anterior</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
