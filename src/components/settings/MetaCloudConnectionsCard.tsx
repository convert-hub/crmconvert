import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2, Globe, Copy, RefreshCw, CheckCircle2, AlertCircle, KeyRound, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface MetaInstance {
  id: string;
  display_name: string | null;
  instance_name: string;
  meta_phone_number_id: string | null;
  meta_waba_id: string | null;
  meta_verify_token: string | null;
  is_active: boolean;
  phone_number: string | null;
  created_at: string;
  meta_token_status: string | null;
  meta_token_last_error: string | null;
  meta_token_last_error_at: string | null;
  meta_token_type: string | null;
}

function generateVerifyToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function MetaCloudConnectionsCard() {
  const { tenant, role } = useAuth();
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [lastEvents, setLastEvents] = useState<Record<string, { last_at: string | null; count_24h: number }>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // form
  const [displayName, setDisplayName] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [tokenType, setTokenType] = useState<'system_user' | 'user'>('system_user');

  // update token dialog
  const [updateTokenInst, setUpdateTokenInst] = useState<MetaInstance | null>(null);
  const [updateTokenValue, setUpdateTokenValue] = useState('');
  const [updateTokenType, setUpdateTokenType] = useState<'system_user' | 'user'>('system_user');
  const [updatingToken, setUpdatingToken] = useState(false);

  const draftKey = tenant?.id ? `meta_connection_draft_${tenant.id}` : '';

  // Hydrate draft from sessionStorage when dialog opens
  useEffect(() => {
    if (!createOpen || !draftKey) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        setDisplayName(d.displayName ?? '');
        setPhoneNumberId(d.phoneNumberId ?? '');
        setWabaId(d.wabaId ?? '');
        setAccessToken(d.accessToken ?? '');
        setAppSecret(d.appSecret ?? '');
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen, draftKey]);

  // Persist draft (debounced)
  useEffect(() => {
    if (!createOpen || !draftKey) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify({
          displayName, phoneNumberId, wabaId, accessToken, appSecret,
        }));
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [createOpen, draftKey, displayName, phoneNumberId, wabaId, accessToken, appSecret]);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-meta`;

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('id, display_name, instance_name, meta_phone_number_id, meta_waba_id, meta_verify_token, is_active, phone_number, created_at, meta_token_status, meta_token_last_error, meta_token_last_error_at, meta_token_type')
      .eq('tenant_id', tenant.id)
      .eq('provider', 'meta_cloud')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    const list = (data ?? []) as MetaInstance[];
    setInstances(list);

    // Diagnóstico: para cada instância, busca último webhook_event e contagem 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const diag: Record<string, { last_at: string | null; count_24h: number }> = {};
    await Promise.all(list.map(async inst => {
      if (!inst.meta_phone_number_id) {
        diag[inst.id] = { last_at: null, count_24h: 0 };
        return;
      }
      const filter = `raw_payload->entry->0->changes->0->value->metadata->>phone_number_id.eq.${inst.meta_phone_number_id}`;
      const [{ data: last }, { count }] = await Promise.all([
        supabase.from('webhook_events').select('created_at')
          .eq('tenant_id', tenant.id).eq('source', 'meta_cloud')
          .filter('raw_payload->entry->0->changes->0->value->metadata->>phone_number_id', 'eq', inst.meta_phone_number_id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('webhook_events').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id).eq('source', 'meta_cloud')
          .filter('raw_payload->entry->0->changes->0->value->metadata->>phone_number_id', 'eq', inst.meta_phone_number_id)
          .gte('created_at', since),
      ]);
      void filter;
      diag[inst.id] = { last_at: (last as any)?.created_at ?? null, count_24h: count ?? 0 };
    }));
    setLastEvents(diag);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  if (role !== 'admin') return null;

  const resetForm = () => {
    setDisplayName('');
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setAppSecret('');
    if (draftKey) {
      try { sessionStorage.removeItem(draftKey); } catch {}
    }
  };

  const handleCreate = async () => {
    if (!tenant?.id) return;
    if (!displayName.trim() || !phoneNumberId.trim() || !wabaId.trim() || !accessToken.trim()) {
      toast.error('Preencha os campos obrigatórios');
      return;
    }
    setCreating(true);
    try {
      const verifyToken = generateVerifyToken();
      const instanceName = `meta_${tenant.id.slice(0, 8)}_${Date.now()}`;
      const { error } = await supabase.from('whatsapp_instances').insert({
        tenant_id: tenant.id,
        provider: 'meta_cloud',
        instance_name: instanceName,
        api_url: 'https://graph.facebook.com',
        display_name: displayName.trim(),
        meta_phone_number_id: phoneNumberId.trim(),
        meta_waba_id: wabaId.trim(),
        meta_access_token_encrypted: accessToken.trim(),
        meta_app_secret_encrypted: appSecret.trim() || null,
        meta_verify_token: verifyToken,
        meta_token_type: tokenType,
        meta_token_status: 'unknown',
        is_active: true,
      });
      if (error) throw error;
      toast.success('Conexão Meta criada. Configure o webhook no painel da Meta.');
      resetForm();
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar conexão');
    } finally {
      setCreating(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('wa-meta-send', {
        body: { action: 'test_connection', whatsapp_instance_id: id },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success(`Conectado: ${data.info?.display_phone_number ?? 'OK'}`);
      } else {
        toast.error(data?.error ?? 'Falha no teste');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Erro');
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncTemplates = async (id: string) => {
    setSyncingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('wa-meta-templates-sync', {
        body: { whatsapp_instance_id: id },
      });
      if (error) throw error;
      if (data?.ok) toast.success(`${data.count} de ${data.total} templates sincronizados`);
      else toast.error(data?.error ?? 'Falha na sincronização');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro');
    } finally {
      setSyncingId(null);
    }
  };

  const handleUpdateToken = async () => {
    if (!updateTokenInst || !updateTokenValue.trim()) return;
    setUpdatingToken(true);
    try {
      // 1. Salva o novo token
      const { error: upErr } = await supabase
        .from('whatsapp_instances')
        .update({
          meta_access_token_encrypted: updateTokenValue.trim(),
          meta_token_type: updateTokenType,
          meta_token_status: 'unknown',
          meta_token_last_error: null,
        })
        .eq('id', updateTokenInst.id);
      if (upErr) throw upErr;

      // 2. Valida via test_connection (vai marcar status correto)
      const { data: testData } = await supabase.functions.invoke('wa-meta-send', {
        body: { action: 'test_connection', whatsapp_instance_id: updateTokenInst.id },
      });
      if (testData?.ok) {
        toast.success('Token atualizado e validado com sucesso');
        // 3. Sincroniza templates de imediato
        supabase.functions.invoke('wa-meta-templates-sync', {
          body: { whatsapp_instance_id: updateTokenInst.id },
        }).then(({ data }) => {
          if (data?.ok) toast.success(`${data.count} templates sincronizados`);
        });
      } else {
        toast.error(testData?.error ?? 'Token salvo mas validação falhou');
      }
      setUpdateTokenInst(null);
      setUpdateTokenValue('');
      await load();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar token');
    } finally {
      setUpdatingToken(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta conexão Meta? Conversas existentes serão preservadas, mas perderão o vínculo.')) return;
    const { error } = await supabase.from('whatsapp_instances').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Conexão removida'); await load(); }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              WhatsApp Oficial (Meta Cloud API)
            </CardTitle>
            <CardDescription>
              Conexão direta com a API oficial do WhatsApp Business da Meta. Independente da conexão UAZAPI.
            </CardDescription>
          </div>
          <Button size="sm" className="rounded-xl" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar conexão
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : instances.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Nenhuma conexão Meta cadastrada. A integração UAZAPI continua funcionando normalmente.
          </div>
        ) : (
          instances.map(inst => {
            const tokenExpired = inst.meta_token_status === 'expired' || inst.meta_token_status === 'invalid';
            return (
            <div key={inst.id} className={`rounded-xl border p-4 space-y-3 ${tokenExpired ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/30'}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{inst.display_name ?? inst.instance_name}</span>
                  <Badge variant="secondary" className="rounded-full text-xs">Meta Cloud</Badge>
                  {inst.is_active && !tokenExpired && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 rounded-full text-xs">Ativo</Badge>}
                  {tokenExpired && (
                    <Badge className="bg-destructive/10 text-destructive border-destructive/30 rounded-full text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" /> Token expirado
                    </Badge>
                  )}
                  {inst.meta_token_type === 'user' && !tokenExpired && (
                    <Badge variant="outline" className="rounded-full text-xs text-amber-600 border-amber-500/30">
                      Token temporário
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={tokenExpired ? 'default' : 'outline'}
                    className="rounded-xl"
                    onClick={() => {
                      setUpdateTokenInst(inst);
                      setUpdateTokenValue('');
                      setUpdateTokenType((inst.meta_token_type as any) || 'system_user');
                    }}
                  >
                    <KeyRound className="h-3 w-3 mr-1" />
                    {tokenExpired ? 'Reconectar' : 'Atualizar token'}
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={testingId === inst.id} onClick={() => handleTest(inst.id)}>
                    {testingId === inst.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                    Testar
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={syncingId === inst.id || tokenExpired} onClick={() => handleSyncTemplates(inst.id)}>
                    {syncingId === inst.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Templates
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl text-destructive" onClick={() => handleDelete(inst.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {tokenExpired && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">Token Meta inválido — todas as ações WABA estão bloqueadas.</div>
                    {inst.meta_token_last_error && <div className="opacity-80 mt-0.5">{inst.meta_token_last_error}</div>}
                    <div className="mt-1 opacity-80">Clique em <strong>Reconectar</strong> e cole um novo token (preferência: System User permanente).</div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><span className="font-mono">phone_number_id:</span> {inst.meta_phone_number_id}</div>
                <div><span className="font-mono">waba_id:</span> {inst.meta_waba_id}</div>
              </div>
              <div className="rounded-lg bg-background/50 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Webhook URL (cole no painel da Meta):</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(webhookUrl, 'URL')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <code className="block break-all font-mono text-[11px]">{webhookUrl}</code>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-muted-foreground">Verify Token:</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(inst.meta_verify_token ?? '', 'Token')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <code className="block break-all font-mono text-[11px]">{inst.meta_verify_token}</code>
                {(() => {
                  const d = lastEvents[inst.id];
                  if (!d) return null;
                  const never = !d.last_at;
                  return (
                    <div className={`mt-2 rounded-md border p-2 flex items-start gap-2 ${never ? 'border-amber-500/40 bg-amber-500/5 text-amber-700' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        {never ? (
                          <>
                            <div className="font-medium">Nenhum webhook recebido</div>
                            <div className="opacity-90">A Meta nunca enviou eventos para este número. Verifique no painel Meta Business → WhatsApp → Configuration → Webhook se a URL e o Verify Token acima estão cadastrados e o campo <code>messages</code> está inscrito.</div>
                          </>
                        ) : (
                          <div>
                            Último webhook: {new Date(d.last_at!).toLocaleString('pt-BR')} · {d.count_24h} evento(s) nas últimas 24h
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );})
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Adicionar conexão Meta Cloud API</DialogTitle>
            <DialogDescription>
              Cadastre as credenciais obtidas no Meta Business Manager. Um Verify Token será gerado automaticamente para o webhook.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="meta-display-name">Nome de exibição *</Label>
              <Input id="meta-display-name" autoComplete="off" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Atendimento Principal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-phone-id">Phone Number ID *</Label>
              <Input id="meta-phone-id" autoComplete="off" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="123456789012345" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-waba-id">WABA ID (WhatsApp Business Account) *</Label>
              <Input id="meta-waba-id" autoComplete="off" value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="987654321098765" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-token">Access Token *</Label>
              <Input id="meta-token" type="password" autoComplete="off" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAG..." />
              <div className="flex gap-3 pt-1 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={tokenType === 'system_user'} onChange={() => setTokenType('system_user')} />
                  <span>System User (permanente) — recomendado</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={tokenType === 'user'} onChange={() => setTokenType('user')} />
                  <span>Usuário (curta duração)</span>
                </label>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-secret">App Secret (recomendado para validação HMAC)</Label>
              <Input id="meta-secret" type="password" autoComplete="off" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="opcional, mas recomendado" />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1.5">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Após salvar, copie a Webhook URL e o Verify Token gerados e configure no app Meta Business em <code>WhatsApp → Configuration → Webhook</code>.</span>
              </div>
              <div className="pl-6 opacity-90">
                <strong>Como gerar token permanente:</strong> Meta Business Settings → Users → System Users → Add → Generate token com permissões <code>whatsapp_business_management</code> + <code>whatsapp_business_messaging</code>.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { resetForm(); setCreateOpen(false); }}>Cancelar</Button>
            <Button className="rounded-xl" disabled={creating} onClick={handleCreate}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!updateTokenInst} onOpenChange={(o) => { if (!o) { setUpdateTokenInst(null); setUpdateTokenValue(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Atualizar token Meta — {updateTokenInst?.display_name ?? updateTokenInst?.instance_name}</DialogTitle>
            <DialogDescription>
              Cole um novo Access Token. Validamos automaticamente na Meta antes de salvar e disparamos o sync de templates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="upd-token">Novo Access Token</Label>
              <Input id="upd-token" type="password" autoComplete="off" value={updateTokenValue} onChange={e => setUpdateTokenValue(e.target.value)} placeholder="EAAG..." />
              <div className="flex gap-3 pt-1 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={updateTokenType === 'system_user'} onChange={() => setUpdateTokenType('system_user')} />
                  <span>System User (permanente)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={updateTokenType === 'user'} onChange={() => setUpdateTokenType('user')} />
                  <span>Usuário (curta duração)</span>
                </label>
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <strong>Para token permanente:</strong> Meta Business Settings → Users → System Users → Generate token com permissões <code>whatsapp_business_management</code> + <code>whatsapp_business_messaging</code>.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => { setUpdateTokenInst(null); setUpdateTokenValue(''); }}>Cancelar</Button>
            <Button className="rounded-xl" disabled={updatingToken || !updateTokenValue.trim()} onClick={handleUpdateToken}>
              {updatingToken && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Validar e salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
