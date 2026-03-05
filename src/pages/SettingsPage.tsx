import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Loader2, QrCode, Wifi, WifiOff, RefreshCw, LogOut, Settings2, Palette, Zap, Tag } from 'lucide-react';
import { toast } from 'sonner';
import BrandingSettings from '@/components/settings/BrandingSettings';
import QuickRepliesSettings from '@/components/settings/QuickRepliesSettings';
import TagsSettings from '@/components/settings/TagsSettings';

interface CustomFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  options?: string[];
}

interface Member { id: string; user_id: string; role: string; is_active: boolean; profile?: { full_name: string | null; phone: string | null }; }
interface StageRow { id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean; inactivity_minutes: number | null; }
interface AiConfig { id: string; task_type: string; provider: string; model: string; daily_limit: number; monthly_limit: number; daily_usage: number; monthly_usage: number; }

const AI_TASK_LABELS: Record<string, string> = { message_generation: 'Geração de Mensagens', qa_review: 'QA / Review', qualification: 'Qualificação', stage_classifier: 'Classificador de Etapa' };

function WhatsAppIntegrationCard({ tenantId }: { tenantId?: string }) {
  const [waStatus, setWaStatus] = useState<'loading' | 'no_instance' | 'disconnected' | 'connecting' | 'connected' | 'error'>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [creating, setCreating] = useState(false);

  const callProxy = useCallback(async (action: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/uazapi-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, tenant_id: tenantId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [tenantId]);

  const checkStatus = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await callProxy('get_status');
      const state = data.status;
      setPhone(data.phone || null);
      setInstanceName(data.instance_name || null);
      setQrCode(data.qrcode || null);
      if (state === 'no_instance') { setWaStatus('no_instance'); }
      else if (state === 'connected') { setWaStatus('connected'); setPolling(false); }
      else if (state === 'connecting' || data.qrcode) { setWaStatus('connecting'); }
      else { setWaStatus('disconnected'); }
    } catch (e: any) {
      console.warn('WhatsApp status check failed:', e?.message);
      setWaStatus('error');
      setPolling(false);
    }
  }, [tenantId, callProxy]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [polling, checkStatus]);

  const handleCreateInstance = async () => {
    setCreating(true);
    try {
      const data = await callProxy('create_instance');
      if (data.qrcode) {
        setQrCode(data.qrcode);
        setWaStatus('connecting');
        setPolling(true);
        toast.success('Instância criada! Escaneie o QR code.');
      } else {
        toast.success('Instância criada! Clique em "Obter QR Code" para conectar.');
        setWaStatus('connecting');
        setPolling(true);
      }
      setInstanceName(data.instance_name || null);
    } catch (e: any) { toast.error(e.message); }
    setCreating(false);
  };

  const handleGetQr = async () => {
    try {
      const data = await callProxy('get_qr');
      setQrCode(data.qrcode || data.base64 || null);
      setWaStatus('connecting');
      setPolling(true);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDisconnect = async () => {
    if (!confirm('Desconectar WhatsApp?')) return;
    try {
      await callProxy('disconnect');
      toast.success('WhatsApp desconectado');
      setWaStatus('no_instance');
      setQrCode(null);
      setPhone(null);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />WhatsApp (UAZAPI)</CardTitle>
            <CardDescription>Conecte sua conta do WhatsApp Business</CardDescription>
          </div>
          {waStatus === 'connected' && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 rounded-full"><Wifi className="h-3 w-3 mr-1" />Conectado</Badge>}
          {(waStatus === 'disconnected' || waStatus === 'no_instance') && <Badge variant="secondary" className="rounded-full"><WifiOff className="h-3 w-3 mr-1" />Desconectado</Badge>}
          {waStatus === 'connecting' && <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 rounded-full"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Aguardando QR</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {waStatus === 'loading' && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

        {waStatus === 'no_instance' && (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">Nenhuma instância WhatsApp configurada.</p>
            <Button onClick={handleCreateInstance} disabled={creating} className="rounded-xl">
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar Instância e Conectar
            </Button>
          </div>
        )}

        {waStatus === 'connecting' && qrCode && (
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">Escaneie o QR code com seu WhatsApp Business:</p>
            <div className="inline-block p-4 bg-white rounded-2xl shadow-lg">
              <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code WhatsApp" className="w-64 h-64" />
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleGetQr}><RefreshCw className="h-4 w-4 mr-1" />Atualizar QR</Button>
            </div>
            <p className="text-xs text-muted-foreground">O status será atualizado automaticamente ao escanear.</p>
          </div>
        )}

        {waStatus === 'connecting' && !qrCode && (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">Instância criada. Gere o QR code para conectar.</p>
            <Button onClick={handleGetQr} className="rounded-xl"><QrCode className="h-4 w-4 mr-2" />Obter QR Code</Button>
          </div>
        )}

        {waStatus === 'disconnected' && (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">Instância existente mas desconectada.</p>
            <Button onClick={handleGetQr} className="rounded-xl"><QrCode className="h-4 w-4 mr-2" />Reconectar via QR Code</Button>
          </div>
        )}

        {waStatus === 'connected' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Telefone:</span><span className="font-mono text-foreground">{phone || '—'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Instância:</span><span className="font-mono text-foreground">{instanceName || '—'}</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={async () => {
                try {
                  await callProxy('setup_webhook');
                  toast.success('Webhook reconfigurado com sucesso');
                } catch (e: any) {
                  console.warn('Webhook setup failed:', e.message);
                }
                await checkStatus();
              }}><RefreshCw className="h-4 w-4 mr-1" />Verificar Status</Button>
              <Button variant="outline" size="sm" className="rounded-xl text-destructive" onClick={handleDisconnect}><LogOut className="h-4 w-4 mr-1" />Desconectar</Button>
            </div>
          </div>
        )}

        {waStatus === 'error' && (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-destructive">Erro ao verificar status. Verifique se o UAZAPI está configurado no painel admin.</p>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={checkStatus}><RefreshCw className="h-4 w-4 mr-1" />Tentar Novamente</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { tenant, role } = useAuth();
  const [tenantName, setTenantName] = useState(tenant?.name ?? '');
  const [leadKeywords, setLeadKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6366f1');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiTaskType, setAiTaskType] = useState('message_generation');
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiDailyLimit, setAiDailyLimit] = useState('100');
  const [aiMonthlyLimit, setAiMonthlyLimit] = useState('3000');
  const [aiGlobalKeyId, setAiGlobalKeyId] = useState('');
  const [globalApiKeys, setGlobalApiKeys] = useState<{ id: string; label: string; provider: string }[]>([]);

  // Custom fields state
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [cfLabel, setCfLabel] = useState('');
  const [cfType, setCfType] = useState<CustomFieldDef['type']>('text');
  const [cfOptions, setCfOptions] = useState('');

  useEffect(() => { if (tenant) { setTenantName(tenant.name); loadAll(); } }, [tenant]);

  const loadAll = async () => {
    if (!tenant) return;
    // Load keywords from tenant settings
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    if (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) {
      const s = tenantData.settings as Record<string, any>;
      setLeadKeywords(s.lead_keywords || []);
      setCustomFields(s.custom_opportunity_fields || []);
    }
    const { data: mems } = await supabase.from('tenant_memberships').select('*').eq('tenant_id', tenant.id);
    if (mems) {
      const enriched: Member[] = [];
      for (const m of mems as any[]) {
        const { data: prof } = await supabase.from('profiles').select('full_name, phone').eq('user_id', m.user_id).single();
        enriched.push({ ...m, profile: prof as any });
      }
      setMembers(enriched);
    }
    const { data: pipelines } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant.id).eq('is_default', true).limit(1);
    if (pipelines && pipelines.length > 0) {
      const { data: stgs } = await supabase.from('stages').select('*').eq('pipeline_id', pipelines[0].id).order('position');
      setStages((stgs as unknown as StageRow[]) ?? []);
    }
    const { data: ais } = await supabase.from('ai_configs').select('*').eq('tenant_id', tenant.id);
    setAiConfigs((ais as unknown as AiConfig[]) ?? []);
    const { data: gKeys } = await supabase.from('global_api_keys').select('id, label, provider').eq('is_active', true);
    setGlobalApiKeys((gKeys as any[]) ?? []);
  };

  const saveTenant = async () => { if (!tenant) return; const { error } = await supabase.from('tenants').update({ name: tenantName }).eq('id', tenant.id); if (error) toast.error(error.message); else toast.success('Salvo!'); };

  const addKeyword = async () => {
    if (!tenant || !newKeyword.trim()) return;
    const updated = [...leadKeywords, newKeyword.trim().toLowerCase()];
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, lead_keywords: updated } }).eq('id', tenant.id);
    if (error) { toast.error(error.message); return; }
    setLeadKeywords(updated);
    setNewKeyword('');
    toast.success('Palavra-chave adicionada');
  };

  const removeKeyword = async (keyword: string) => {
    if (!tenant) return;
    const updated = leadKeywords.filter(k => k !== keyword);
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, lead_keywords: updated } }).eq('id', tenant.id);
    if (error) { toast.error(error.message); return; }
    setLeadKeywords(updated);
    toast.success('Palavra-chave removida');
  };
  const updateMemberRole = async (memberId: string, newRole: string) => { await supabase.from('tenant_memberships').update({ role: newRole as any }).eq('id', memberId); toast.success('Papel atualizado'); loadAll(); };
  const removeMember = async (memberId: string) => { await supabase.from('tenant_memberships').update({ is_active: false }).eq('id', memberId); toast.success('Membro desativado'); loadAll(); };

  const addStage = async () => {
    if (!tenant || !newStageName.trim()) return;
    const { data: pipelines } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant.id).eq('is_default', true).limit(1);
    if (!pipelines || pipelines.length === 0) {
      toast.error('Nenhum pipeline padrão encontrado. Crie a empresa novamente ou contate o administrador.');
      return;
    }
    const { error } = await supabase.from('stages').insert({ tenant_id: tenant.id, pipeline_id: pipelines[0].id, name: newStageName, color: newStageColor, position: stages.length });
    if (error) { toast.error('Erro ao adicionar etapa: ' + error.message); return; }
    setNewStageName(''); toast.success('Etapa adicionada'); loadAll();
  };
  const deleteStage = async (id: string) => { await supabase.from('stages').delete().eq('id', id); toast.success('Etapa removida'); loadAll(); };

  const saveAiConfig = async () => {
    if (!tenant) return;
    const existing = aiConfigs.find(c => c.task_type === aiTaskType);
    const configData = { provider: aiProvider, model: aiModel, daily_limit: parseInt(aiDailyLimit), monthly_limit: parseInt(aiMonthlyLimit), global_api_key_id: aiGlobalKeyId || null };
    if (existing) {
      await supabase.from('ai_configs').update(configData).eq('id', existing.id);
    } else {
      await supabase.from('ai_configs').insert({ tenant_id: tenant.id, task_type: aiTaskType as any, ...configData });
    }
    toast.success('Configuração de IA salva'); setAiDialogOpen(false); loadAll();
  };

  const isAdmin = role === 'admin';

  const slugify = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const addCustomField = async () => {
    if (!tenant || !cfLabel.trim()) return;
    const key = slugify(cfLabel);
    if (customFields.some(f => f.key === key)) { toast.error('Já existe um campo com essa chave'); return; }
    const newField: CustomFieldDef = { key, label: cfLabel.trim(), type: cfType };
    if (cfType === 'select' && cfOptions.trim()) {
      newField.options = cfOptions.split(',').map(o => o.trim()).filter(Boolean);
    }
    const updated = [...customFields, newField];
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, custom_opportunity_fields: updated } as any }).eq('id', tenant.id);
    if (error) { toast.error(error.message); return; }
    setCustomFields(updated);
    setCfLabel(''); setCfType('text'); setCfOptions('');
    toast.success('Campo adicionado');
  };

  const removeCustomField = async (key: string) => {
    if (!tenant) return;
    const updated = customFields.filter(f => f.key !== key);
    const { data: tenantData } = await supabase.from('tenants').select('settings').eq('id', tenant.id).single();
    const currentSettings = (tenantData?.settings && typeof tenantData.settings === 'object' && !Array.isArray(tenantData.settings)) ? tenantData.settings as Record<string, any> : {};
    const { error } = await supabase.from('tenants').update({ settings: { ...currentSettings, custom_opportunity_fields: updated } as any }).eq('id', tenant.id);
    if (error) { toast.error(error.message); return; }
    setCustomFields(updated);
    toast.success('Campo removido');
  };

  const CF_TYPE_LABELS: Record<string, string> = { text: 'Texto', number: 'Número', select: 'Seleção', date: 'Data', boolean: 'Sim/Não' };

  return (
    <div className="p-6 max-w-5xl bg-background">
      <h1 className="text-xl font-bold mb-6 text-foreground">Configurações</h1>
      <Tabs defaultValue="general">
        <TabsList className="flex-wrap rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="general" className="rounded-lg">Geral</TabsTrigger>
          <TabsTrigger value="branding" className="rounded-lg"><Palette className="h-3.5 w-3.5 mr-1" />Marca</TabsTrigger>
          <TabsTrigger value="pipeline" className="rounded-lg">Pipeline</TabsTrigger>
          <TabsTrigger value="custom_fields" className="rounded-lg"><Settings2 className="h-3.5 w-3.5 mr-1" />Campos Personalizados</TabsTrigger>
          <TabsTrigger value="team" className="rounded-lg">Equipe</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-lg">IA</TabsTrigger>
          <TabsTrigger value="tags" className="rounded-lg"><Tag className="h-3.5 w-3.5 mr-1" />Tags</TabsTrigger>
          <TabsTrigger value="quick_replies" className="rounded-lg"><Zap className="h-3.5 w-3.5 mr-1" />Respostas Rápidas</TabsTrigger>
          <TabsTrigger value="integrations" className="rounded-lg">Integrações</TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="space-y-4 pt-4">
          <BrandingSettings />
        </TabsContent>

        <TabsContent value="general" className="space-y-4 pt-4">
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle>Dados da Empresa</CardTitle><CardDescription>Informações básicas do seu tenant</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Nome da Empresa</Label><Input value={tenantName} onChange={e => setTenantName(e.target.value)} className="rounded-xl" /></div>
              <Button onClick={saveTenant} disabled={!isAdmin} className="rounded-xl">Salvar</Button>
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl">
            <CardHeader>
              <CardTitle>Palavras-chave para Leads</CardTitle>
              <CardDescription>Mensagens do WhatsApp contendo essas palavras criarão automaticamente uma oportunidade no pipeline para contatos com status "lead"</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {leadKeywords.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma palavra-chave configurada.</p>}
                {leadKeywords.map(kw => (
                  <Badge key={kw} variant="secondary" className="rounded-full text-sm gap-1 px-3 py-1">
                    {kw}
                    {isAdmin && (
                      <button onClick={() => removeKeyword(kw)} className="ml-1 hover:text-destructive transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <Input
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="Ex: preço, orçamento, comprar..."
                    className="rounded-xl flex-1"
                    onKeyDown={e => e.key === 'Enter' && addKeyword()}
                  />
                  <Button onClick={addKeyword} className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle>Etapas do Pipeline Padrão</CardTitle><CardDescription>Gerencie as etapas do funil principal</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>Pos.</TableHead><TableHead>Cor</TableHead><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Inatividade (HH:MM)</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {stages.map((s, i) => {
                    const totalMin = s.inactivity_minutes ?? 0;
                    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
                    const mm = String(totalMin % 60).padStart(2, '0');
                    return (
                      <TableRow key={s.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell><div className="h-4 w-4 rounded-full" style={{ backgroundColor: s.color }} /></TableCell>
                        <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                        <TableCell>
                          {s.is_won && <Badge className="rounded-full">Ganho</Badge>}
                          {s.is_lost && <Badge variant="destructive" className="rounded-full">Perdido</Badge>}
                          {!s.is_won && !s.is_lost && <Badge variant="secondary" className="rounded-full">Normal</Badge>}
                        </TableCell>
                        <TableCell>
                          {isAdmin && !s.is_won && !s.is_lost ? (
                            <Input
                              type="text"
                              className="w-24 rounded-xl font-mono text-center"
                              placeholder="00:00"
                              defaultValue={totalMin > 0 ? `${hh}:${mm}` : ''}
                              onBlur={async (e) => {
                                const raw = e.target.value.trim();
                                if (!raw || raw === '00:00') {
                                  const { error } = await supabase.from('stages').update({ inactivity_minutes: null } as any).eq('id', s.id);
                                  if (error) toast.error(error.message);
                                  else toast.success('Inatividade desativada');
                                  return;
                                }
                                const match = raw.match(/^(\d{1,3}):(\d{2})$/);
                                if (!match) { toast.error('Formato inválido. Use HH:MM (ex: 01:30)'); return; }
                                const minutes = parseInt(match[1]) * 60 + parseInt(match[2]);
                                if (minutes <= 0) { toast.error('Valor deve ser maior que 00:00'); return; }
                                const { error } = await supabase.from('stages').update({ inactivity_minutes: minutes } as any).eq('id', s.id);
                                if (error) toast.error(error.message);
                                else toast.success('Inatividade atualizada');
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">{totalMin > 0 ? `${hh}:${mm}` : '—'}</span>
                          )}
                        </TableCell>
                        <TableCell>{isAdmin && !s.is_won && !s.is_lost && <Button variant="ghost" size="icon" onClick={() => deleteStage(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">💡 Defina o tempo de inatividade por etapa no formato HH:MM para criar lembretes automáticos de follow-up. Ex: 01:30 = 1h30min. Vazio ou 00:00 = desativado.</p>
              {isAdmin && (
                <div className="flex gap-2 items-end">
                  <div className="space-y-1 flex-1"><Label>Nova etapa</Label><Input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Nome da etapa" className="rounded-xl" /></div>
                  <Input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-14 h-10 p-1 rounded-xl" />
                  <Button onClick={addStage} className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom_fields" className="space-y-4 pt-4">
          <Card className="glass-card rounded-2xl">
            <CardHeader>
              <CardTitle>Campos Personalizados de Oportunidade</CardTitle>
              <CardDescription>Defina campos extras que aparecerão nos cards do pipeline e no detalhe da oportunidade</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {customFields.length > 0 ? (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>Nome</TableHead><TableHead>Chave</TableHead><TableHead>Tipo</TableHead><TableHead>Opções</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {customFields.map(f => (
                      <TableRow key={f.key}>
                        <TableCell className="font-medium text-foreground">{f.label}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{f.key}</TableCell>
                        <TableCell><Badge variant="secondary" className="rounded-full">{CF_TYPE_LABELS[f.type] ?? f.type}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.options?.join(', ') || '—'}</TableCell>
                        <TableCell>{isAdmin && <Button variant="ghost" size="icon" onClick={() => removeCustomField(f.key)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-sm text-muted-foreground text-center py-4">Nenhum campo personalizado definido.</p>}

              {isAdmin && (
                <div className="space-y-3 rounded-2xl border border-border/50 p-4 bg-card/50">
                  <p className="text-sm font-medium text-foreground">Novo campo</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome do campo</Label>
                      <Input value={cfLabel} onChange={e => setCfLabel(e.target.value)} placeholder="Ex: Produto" className="rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo</Label>
                      <Select value={cfType} onValueChange={v => setCfType(v as CustomFieldDef['type'])}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Texto</SelectItem>
                          <SelectItem value="number">Número</SelectItem>
                          <SelectItem value="select">Seleção</SelectItem>
                          <SelectItem value="date">Data</SelectItem>
                          <SelectItem value="boolean">Sim/Não</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {cfType === 'select' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Opções (separadas por vírgula)</Label>
                      <Input value={cfOptions} onChange={e => setCfOptions(e.target.value)} placeholder="Ex: Baixa, Média, Alta" className="rounded-xl" />
                    </div>
                  )}
                  <Button onClick={addCustomField} disabled={!cfLabel.trim()} className="rounded-xl">
                    <Plus className="h-4 w-4 mr-1" />Adicionar Campo
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4 pt-4">
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle>Membros da Equipe</CardTitle><CardDescription>Gerencie usuários e papéis</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Nome</TableHead><TableHead>Papel</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {members.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium text-foreground">{m.profile?.full_name ?? 'Sem nome'}</TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Select value={m.role} onValueChange={v => updateMemberRole(m.id, v)}>
                            <SelectTrigger className="w-[140px] rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem><SelectItem value="manager">Gerente</SelectItem>
                              <SelectItem value="attendant">Atendente</SelectItem><SelectItem value="readonly">Somente Leitura</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : <Badge variant="outline" className="capitalize rounded-full">{m.role}</Badge>}
                      </TableCell>
                      <TableCell><Badge variant={m.is_active ? 'default' : 'secondary'} className="rounded-full">{m.is_active ? 'Ativo' : 'Inativo'}</Badge></TableCell>
                      <TableCell>{isAdmin && m.is_active && <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => removeMember(m.id)}>Desativar</Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Para convidar novos membros, crie a conta no Supabase Auth e adicione via SQL ou API.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4 pt-4">
          <Card className="glass-card rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Configuração de IA</CardTitle><CardDescription>Provedores, modelos e limites</CardDescription></div>
              <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
                <DialogTrigger asChild><Button size="sm" className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Configurar</Button></DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader><DialogTitle>Configurar Provedor IA</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2"><Label>Tipo de Tarefa</Label><Select value={aiTaskType} onValueChange={setAiTaskType}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AI_TASK_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Provedor</Label><Input value={aiProvider} onChange={e => setAiProvider(e.target.value)} className="rounded-xl" /></div>
                      <div className="space-y-2"><Label>Modelo</Label><Input value={aiModel} onChange={e => setAiModel(e.target.value)} className="rounded-xl" /></div>
                    </div>
                    <div className="space-y-2">
                      <Label>Chave de API Global</Label>
                      <Select value={aiGlobalKeyId} onValueChange={setAiGlobalKeyId}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione uma chave" /></SelectTrigger>
                        <SelectContent>
                          {globalApiKeys.map(k => <SelectItem key={k.id} value={k.id}>{k.label} ({k.provider})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Limite Diário</Label><Input type="number" value={aiDailyLimit} onChange={e => setAiDailyLimit(e.target.value)} className="rounded-xl" /></div>
                      <div className="space-y-2"><Label>Limite Mensal</Label><Input type="number" value={aiMonthlyLimit} onChange={e => setAiMonthlyLimit(e.target.value)} className="rounded-xl" /></div>
                    </div>
                    <Button className="w-full rounded-xl" onClick={saveAiConfig}>Salvar</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {aiConfigs.length > 0 ? (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Tarefa</TableHead><TableHead>Provedor</TableHead><TableHead>Modelo</TableHead><TableHead>Uso Diário</TableHead><TableHead>Uso Mensal</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {aiConfigs.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-foreground">{AI_TASK_LABELS[c.task_type] ?? c.task_type}</TableCell>
                        <TableCell className="font-mono text-sm">{c.provider}</TableCell>
                        <TableCell className="font-mono text-sm">{c.model}</TableCell>
                        <TableCell>{c.daily_usage}/{c.daily_limit}</TableCell>
                        <TableCell>{c.monthly_usage}/{c.monthly_limit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-sm text-muted-foreground text-center py-6">Nenhuma configuração de IA.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tags" className="space-y-4 pt-4">
          <TagsSettings />
        </TabsContent>

        <TabsContent value="quick_replies" className="space-y-4 pt-4">
          <QuickRepliesSettings />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4 pt-4">
          <WhatsAppIntegrationCard tenantId={tenant?.id} />
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle>Webhooks</CardTitle><CardDescription>URLs de webhook para formulários e Facebook Lead Ads</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><strong>Webhook genérico:</strong> <code className="bg-muted px-2 py-0.5 rounded-lg text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-form-intake`}</code></p>
              <p><strong>Facebook Lead Ads:</strong> <code className="bg-muted px-2 py-0.5 rounded-lg text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-meta-leads`}</code></p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
