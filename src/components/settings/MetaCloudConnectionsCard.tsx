import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2, Globe, Copy, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
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
}

function generateVerifyToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function MetaCloudConnectionsCard() {
  const { tenant, role } = useAuth();
  const [instances, setInstances] = useState<MetaInstance[]>([]);
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

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-meta`;

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('id, display_name, instance_name, meta_phone_number_id, meta_waba_id, meta_verify_token, is_active, phone_number, created_at')
      .eq('tenant_id', tenant.id)
      .eq('provider', 'meta_cloud')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setInstances((data ?? []) as MetaInstance[]);
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
          instances.map(inst => (
            <div key={inst.id} className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{inst.display_name ?? inst.instance_name}</span>
                  <Badge variant="secondary" className="rounded-full text-xs">Meta Cloud</Badge>
                  {inst.is_active && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 rounded-full text-xs">Ativo</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={testingId === inst.id} onClick={() => handleTest(inst.id)}>
                    {testingId === inst.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                    Testar
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={syncingId === inst.id} onClick={() => handleSyncTemplates(inst.id)}>
                    {syncingId === inst.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Templates
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl text-destructive" onClick={() => handleDelete(inst.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
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
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar conexão Meta Cloud API</DialogTitle>
            <DialogDescription>
              Cadastre as credenciais obtidas no Meta Business Manager. Um Verify Token será gerado automaticamente para o webhook.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="meta-display-name">Nome de exibição *</Label>
              <Input id="meta-display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Atendimento Principal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-phone-id">Phone Number ID *</Label>
              <Input id="meta-phone-id" value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="123456789012345" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-waba-id">WABA ID (WhatsApp Business Account) *</Label>
              <Input id="meta-waba-id" value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="987654321098765" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-token">Access Token (System User permanente) *</Label>
              <Input id="meta-token" type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAG..." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meta-secret">App Secret (recomendado para validação HMAC)</Label>
              <Input id="meta-secret" type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="opcional, mas recomendado" />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Após salvar, copie a Webhook URL e o Verify Token gerados e configure no app Meta Business em <code>WhatsApp → Configuration → Webhook</code>.</span>
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
    </Card>
  );
}
