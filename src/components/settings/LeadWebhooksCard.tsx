import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, RefreshCw, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

type Pipeline = { id: string; name: string; is_default: boolean };

function genToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success('Copiado');
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

export default function LeadWebhooksCard() {
  const { tenant, role } = useAuth();
  const isAdmin = role === 'admin';
  const [token, setToken] = useState<string | null>(null);
  const [defaultPipelineId, setDefaultPipelineId] = useState<string>('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    const s = (tenant.settings as any) ?? {};
    setToken(s.lead_webhook_token ?? null);
    setDefaultPipelineId(s.lead_default_pipeline_id ?? '');
    supabase
      .from('pipelines')
      .select('id, name, is_default')
      .eq('tenant_id', tenant.id)
      .order('position')
      .then(({ data }) => setPipelines((data ?? []) as Pipeline[]));
  }, [tenant?.id]);

  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
  const tenantId = tenant?.id ?? '';
  const tokenQs = token ? `&token=${token}` : '';
  const metaUrl = `${baseUrl}/webhook-meta-leads?tenant_id=${tenantId}${tokenQs}`;
  const formUrl = `${baseUrl}/webhook-form-intake?tenant_id=${tenantId}${tokenQs}`;

  const samplePayload = useMemo(
    () => JSON.stringify(
      {
        name: 'Maria Silva',
        phone: '+55 11 91234-5678',
        email: 'maria@exemplo.com',
        source: 'Facebook Lead Ads',
        campaign: 'Promo Junho',
        lead_id: '1234567890',
        extra: { interesse: 'Plano Premium' },
      },
      null,
      2,
    ),
    [],
  );

  async function patchSettings(patch: Record<string, unknown>) {
    if (!tenant || !isAdmin) return false;
    setSaving(true);
    const next = { ...((tenant.settings as any) ?? {}), ...patch };
    const { error } = await supabase.from('tenants').update({ settings: next }).eq('id', tenant.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  }

  async function handleGenerateToken() {
    const t = genToken();
    const wasSet = !!token;
    if (await patchSettings({ lead_webhook_token: t })) {
      setToken(t);
      toast.success(wasSet ? 'Token regenerado — URLs antigas invalidadas' : 'Token gerado');
    }
  }

  async function handleRemoveToken() {
    if (!confirm('Remover token? As URLs voltam a aceitar qualquer chamada com tenant_id.')) return;
    if (await patchSettings({ lead_webhook_token: null })) {
      setToken(null);
      toast.success('Token removido');
    }
  }

  async function handlePipelineChange(value: string) {
    const v = value === '__default__' ? null : value;
    if (await patchSettings({ lead_default_pipeline_id: v })) {
      setDefaultPipelineId(value === '__default__' ? '' : value);
    }
  }

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <CardTitle>Webhooks de Leads</CardTitle>
        <CardDescription>
          Endpoints para receber leads de Facebook Lead Ads, formulários e integrações via Make/Zapier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Pipeline de destino</div>
          <Select
            value={defaultPipelineId || '__default__'}
            onValueChange={handlePipelineChange}
            disabled={!isAdmin || saving}
          >
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Pipeline padrão do tenant</SelectItem>
              {pipelines.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{p.is_default ? ' (padrão)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Token de autenticação
            </div>
            <div className="flex gap-1.5">
              {token && isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleRemoveToken}>
                  Remover
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleGenerateToken}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {token ? 'Regenerar' : 'Gerar token'}
                </Button>
              )}
            </div>
          </div>
          {token ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <code className="text-[11px] font-mono truncate flex-1">{token}</code>
              <CopyButton value={token} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Sem token, as URLs aceitam qualquer chamada com o <code>tenant_id</code> correto. Recomendado em produção.
            </p>
          )}
          {token && (
            <p className="text-[11px] text-muted-foreground">
              Envie no header <code className="bg-muted px-1 rounded">x-webhook-token</code> (recomendado).
              Query <code>?token=…</code> aceito como fallback, mas vaza em logs.
            </p>
          )}
          {!isAdmin && (
            <p className="text-[11px] text-amber-600">Apenas administradores podem alterar token/pipeline.</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">URLs</div>
          {[
            { label: 'Facebook Lead Ads', url: metaUrl },
            { label: 'Formulário genérico', url: formUrl },
          ].map(({ label, url }) => (
            <div key={label}>
              <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
              <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                <code className="text-[11px] font-mono truncate flex-1">{url}</code>
                <CopyButton value={url} />
              </div>
            </div>
          ))}
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Formato esperado do payload (JSON, POST)
          </summary>
          <div className="mt-2 space-y-2">
            <pre className="rounded-md border border-border bg-muted/30 p-3 text-[11px] font-mono overflow-x-auto">
{samplePayload}
            </pre>
            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
              <li><code>phone</code> é normalizado automaticamente para o padrão BR (DDD + 9).</li>
              <li>Contato existente não é sobrescrito — atividade é registrada na oportunidade aberta.</li>
              <li><code>lead_id</code> (Meta) bloqueia reprocessamento do mesmo lead.</li>
              <li>Campos não previstos vão em <code>extra</code> e ficam em <code>custom_fields</code> da oportunidade.</li>
            </ul>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
