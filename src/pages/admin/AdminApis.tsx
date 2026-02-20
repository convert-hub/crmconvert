import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Loader2, Trash2, Brain, Key, Eye, EyeOff, Edit2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface WhatsAppInstance {
  id: string;
  tenant_id: string;
  instance_name: string;
  api_url: string;
  phone_number: string | null;
  is_active: boolean;
}

interface GlobalApiKey {
  id: string;
  provider: string;
  label: string;
  api_key_encrypted: string;
  is_active: boolean;
  created_at: string;
}

interface AiConfig {
  id: string;
  tenant_id: string;
  task_type: string;
  provider: string;
  model: string;
  global_api_key_id: string | null;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminApis() {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [whatsappInstances, setWhatsappInstances] = useState<WhatsAppInstance[]>([]);
  const [globalKeys, setGlobalKeys] = useState<GlobalApiKey[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Global Key form
  const [gkOpen, setGkOpen] = useState(false);
  const [gkForm, setGkForm] = useState({ provider: 'openai', label: '', api_key: '', base_url: '' });
  const [gkSaving, setGkSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Edit Global Key
  const [editGkOpen, setEditGkOpen] = useState(false);
  const [editGkId, setEditGkId] = useState<string | null>(null);
  const [editGkForm, setEditGkForm] = useState({ provider: 'openai', label: '', api_key: '', base_url: '' });
  const [editGkSaving, setEditGkSaving] = useState(false);

  // WhatsApp form
  const [waOpen, setWaOpen] = useState(false);
  const [waForm, setWaForm] = useState({ tenant_id: '', instance_name: '' });
  const [waSaving, setWaSaving] = useState(false);

  // AI Agent form
  const [aiOpen, setAiOpen] = useState(false);
  const [aiForm, setAiForm] = useState({ tenant_id: '', task_type: 'message_generation', provider: 'openai', model: 'gpt-4o-mini', global_api_key_id: '' });
  const [aiSaving, setAiSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [tRes, wRes, gkRes, aRes] = await Promise.all([
      supabase.from('tenants').select('id, name'),
      supabase.from('whatsapp_instances').select('id, tenant_id, instance_name, api_url, phone_number, is_active'),
      supabase.from('global_api_keys').select('*').order('created_at', { ascending: false }),
      supabase.from('ai_configs').select('id, tenant_id, task_type, provider, model, global_api_key_id'),
    ]);
    setTenants(tRes.data ?? []);
    setWhatsappInstances(wRes.data ?? []);
    setGlobalKeys((gkRes.data as unknown as GlobalApiKey[]) ?? []);
    setAiConfigs((aRes.data as unknown as AiConfig[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getTenantName = (id: string) => tenants.find(t => t.id === id)?.name ?? '—';
  const getKeyLabel = (id: string | null) => globalKeys.find(k => k.id === id)?.label ?? '—';

  // Global Key handlers
  const handleCreateGlobalKey = async () => {
    if (!gkForm.label.trim() || !gkForm.api_key.trim()) return;
    setGkSaving(true);
    const insertData: any = {
      provider: gkForm.provider,
      label: gkForm.label,
      api_key_encrypted: gkForm.api_key,
    };
    if (gkForm.provider === 'uazapi' && gkForm.base_url.trim()) {
      insertData.metadata = { base_url: gkForm.base_url.trim().replace(/\/+$/, '') };
    }
    const { error } = await supabase.from('global_api_keys').insert(insertData as any);
    if (error) { toast.error(error.message); } else {
      toast.success('Chave API global criada!');
      setGkOpen(false);
      setGkForm({ provider: 'openai', label: '', api_key: '', base_url: '' });
      load();
    }
    setGkSaving(false);
  };

  const handleDeleteGlobalKey = async (id: string) => {
    if (!confirm('Remover esta chave? Configs de IA que usam ela perderão a referência.')) return;
    await supabase.from('global_api_keys').delete().eq('id', id);
    toast.success('Chave removida');
    load();
  };

  const handleToggleKeyActive = async (id: string, active: boolean) => {
    await supabase.from('global_api_keys').update({ is_active: active } as any).eq('id', id);
    load();
  };

  const openEditGk = (k: GlobalApiKey) => {
    setEditGkId(k.id);
    setEditGkForm({ provider: k.provider, label: k.label, api_key: '', base_url: (k as any).metadata?.base_url || '' });
    setEditGkOpen(true);
  };

  const handleEditGlobalKey = async () => {
    if (!editGkId || !editGkForm.label.trim()) return;
    setEditGkSaving(true);
    const updates: any = { provider: editGkForm.provider, label: editGkForm.label };
    if (editGkForm.api_key.trim()) updates.api_key_encrypted = editGkForm.api_key;
    if (editGkForm.provider === 'uazapi') {
      updates.metadata = { base_url: editGkForm.base_url.trim().replace(/\/+$/, '') };
    }
    const { error } = await supabase.from('global_api_keys').update(updates).eq('id', editGkId);
    if (error) { toast.error(error.message); } else {
      toast.success('Chave atualizada!');
      setEditGkOpen(false);
      load();
    }
    setEditGkSaving(false);
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  };

  // WhatsApp handlers - uses uazapi-proxy edge function with global key
  const handleCreateWhatsAppViaProxy = async () => {
    if (!waForm.tenant_id) return;
    setWaSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('uazapi-proxy', {
        body: {
          action: 'create_instance',
          tenant_id: waForm.tenant_id,
          instance_name: waForm.instance_name || undefined,
        },
      });
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || res.error?.message || 'Erro ao criar instância');
      } else {
        toast.success(`Instância "${res.data.instance_name}" criada! O tenant pode escanear o QR Code em Configurações.`);
        setWaOpen(false);
        setWaForm({ tenant_id: '', instance_name: '' });
        load();
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro inesperado');
    }
    setWaSaving(false);
  };

  const handleCreateWhatsApp = async () => {
    // kept for backwards compat but unused
  };

  const handleDeleteWa = async (id: string) => {
    if (!confirm('Remover esta instância?')) return;
    await supabase.from('whatsapp_instances').delete().eq('id', id);
    toast.success('Removido');
    load();
  };

  // AI Agent handlers
  const handleCreateAi = async () => {
    setAiSaving(true);
    const { error } = await supabase.from('ai_configs').insert({
      tenant_id: aiForm.tenant_id,
      task_type: aiForm.task_type as any,
      provider: aiForm.provider,
      model: aiForm.model,
      global_api_key_id: aiForm.global_api_key_id || null,
    } as any);
    if (error) { toast.error(error.message); } else {
      toast.success('Agente de IA criado!');
      setAiOpen(false);
      setAiForm({ tenant_id: '', task_type: 'message_generation', provider: 'openai', model: 'gpt-4o-mini', global_api_key_id: '' });
      load();
    }
    setAiSaving(false);
  };

  const handleDeleteAi = async (id: string) => {
    if (!confirm('Remover este agente?')) return;
    await supabase.from('ai_configs').delete().eq('id', id);
    toast.success('Removido');
    load();
  };

  const activeGlobalKeys = globalKeys.filter(k => k.is_active);
  const taskTypeLabels: Record<string, string> = {
    message_generation: 'Geração de Mensagem',
    qa_review: 'QA Review',
    qualification: 'Qualificação',
    stage_classifier: 'Classificador de Estágio',
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">APIs & Integrações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie chaves globais e agentes de IA por empresa</p>
      </div>

      <Tabs defaultValue="global-keys" className="w-full">
        <TabsList className="rounded-xl bg-muted">
          <TabsTrigger value="global-keys" className="rounded-lg"><Key className="h-4 w-4 mr-2" />Chaves Globais</TabsTrigger>
          <TabsTrigger value="ai-agents" className="rounded-lg"><Brain className="h-4 w-4 mr-2" />Agentes IA</TabsTrigger>
        </TabsList>

        {/* ── Global API Keys ── */}
        <TabsContent value="global-keys" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Chaves API cadastradas no nível SaaS Admin. Usadas por todos os agentes de IA.</p>
            <Dialog open={gkOpen} onOpenChange={setGkOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl gradient-primary text-white border-0"><Plus className="h-4 w-4 mr-2" />Nova Chave</Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader><DialogTitle>Nova Chave API Global</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <Label>Provider</Label>
                    <Select value={gkForm.provider} onValueChange={v => setGkForm(f => ({ ...f, provider: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                        <SelectItem value="uazapi">UAZAPI (WhatsApp)</SelectItem>
                        <SelectItem value="other">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Nome / Label</Label>
                    <Input className="rounded-xl" value={gkForm.label} onChange={e => setGkForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex: OpenAI Produção" />
                  </div>
                  <div className="space-y-1">
                    <Label>{gkForm.provider === 'uazapi' ? 'Admin Token' : 'API Key'}</Label>
                    <Input className="rounded-xl" type="password" value={gkForm.api_key} onChange={e => setGkForm(f => ({ ...f, api_key: e.target.value }))} placeholder={gkForm.provider === 'uazapi' ? 'admin-token...' : 'sk-...'} />
                  </div>
                  {gkForm.provider === 'uazapi' && (
                    <div className="space-y-1">
                      <Label>URL Base do Servidor UAZAPI</Label>
                      <Input className="rounded-xl" value={gkForm.base_url} onChange={e => setGkForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://seuservidor.uazapi.com" />
                    </div>
                  )}
                  <Button onClick={handleCreateGlobalKey} disabled={gkSaving || !gkForm.label || !gkForm.api_key} className="w-full rounded-xl gradient-primary text-white border-0">
                    {gkSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar Chave
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {globalKeys.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhuma chave API global cadastrada</p>
              <p className="text-xs text-muted-foreground mt-1">Cadastre uma chave para usá-la nos agentes de IA</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {globalKeys.map(k => (
                <div key={k.id} className="glass-card rounded-2xl p-4 flex items-center gap-4 hover-lift">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Key className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{k.label}</p>
                      <Badge variant="outline" className="text-[10px] uppercase">{k.provider}</Badge>
                      <Badge variant={k.is_active ? 'default' : 'secondary'} className="text-[10px]">{k.is_active ? 'Ativa' : 'Inativa'}</Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-xs text-muted-foreground font-mono">
                        {showKeys[k.id] ? k.api_key_encrypted : maskKey(k.api_key_encrypted)}
                      </p>
                      <button onClick={() => setShowKeys(s => ({ ...s, [k.id]: !s[k.id] }))} className="text-muted-foreground hover:text-foreground p-0.5">
                        {showKeys[k.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  <Switch checked={k.is_active} onCheckedChange={v => handleToggleKeyActive(k.id, v)} />
                  <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => openEditGk(k)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-xl text-destructive" onClick={() => handleDeleteGlobalKey(k.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Edit Global Key Dialog */}
          <Dialog open={editGkOpen} onOpenChange={setEditGkOpen}>
            <DialogContent className="rounded-2xl">
              <DialogHeader><DialogTitle>Editar Chave API Global</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label>Provider</Label>
                  <Select value={editGkForm.provider} onValueChange={v => setEditGkForm(f => ({ ...f, provider: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="uazapi">UAZAPI (WhatsApp)</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nome / Label</Label>
                  <Input className="rounded-xl" value={editGkForm.label} onChange={e => setEditGkForm(f => ({ ...f, label: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Nova API Key (deixe vazio para manter a atual)</Label>
                  <Input className="rounded-xl" type="password" value={editGkForm.api_key} onChange={e => setEditGkForm(f => ({ ...f, api_key: e.target.value }))} placeholder="sk-..." />
                </div>
                {editGkForm.provider === 'uazapi' && (
                  <div className="space-y-1">
                    <Label>URL Base do Servidor UAZAPI</Label>
                    <Input className="rounded-xl" value={editGkForm.base_url} onChange={e => setEditGkForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://seuservidor.uazapi.com" />
                  </div>
                )}
                <Button onClick={handleEditGlobalKey} disabled={editGkSaving || !editGkForm.label} className="w-full rounded-xl gradient-primary text-white border-0">
                  {editGkSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar Alterações
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── AI Agents (per tenant) ── */}
        <TabsContent value="ai-agents" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Agentes de IA criados por empresa, usando chaves globais.</p>
            <Dialog open={aiOpen} onOpenChange={setAiOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl gradient-primary text-white border-0" disabled={activeGlobalKeys.length === 0}>
                  <Plus className="h-4 w-4 mr-2" />Novo Agente
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader><DialogTitle>Novo Agente de IA</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <Label>Empresa</Label>
                    <Select value={aiForm.tenant_id} onValueChange={v => setAiForm(f => ({ ...f, tenant_id: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Chave API Global</Label>
                    <Select value={aiForm.global_api_key_id} onValueChange={v => setAiForm(f => ({ ...f, global_api_key_id: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione a chave..." /></SelectTrigger>
                      <SelectContent>
                        {activeGlobalKeys.map(k => (
                          <SelectItem key={k.id} value={k.id}>{k.label} ({k.provider})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Tipo de Tarefa</Label>
                    <Select value={aiForm.task_type} onValueChange={v => setAiForm(f => ({ ...f, task_type: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="message_generation">Geração de Mensagem</SelectItem>
                        <SelectItem value="qa_review">QA Review</SelectItem>
                        <SelectItem value="qualification">Qualificação</SelectItem>
                        <SelectItem value="stage_classifier">Classificador de Estágio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Provider</Label><Input className="rounded-xl" value={aiForm.provider} onChange={e => setAiForm(f => ({ ...f, provider: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Modelo</Label><Input className="rounded-xl" value={aiForm.model} onChange={e => setAiForm(f => ({ ...f, model: e.target.value }))} /></div>
                  <Button onClick={handleCreateAi} disabled={aiSaving || !aiForm.tenant_id || !aiForm.global_api_key_id} className="w-full rounded-xl gradient-primary text-white border-0">
                    {aiSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar Agente
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {activeGlobalKeys.length === 0 && (
            <div className="rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-4 text-sm text-amber-600">
              ⚠️ Cadastre uma chave API global na aba "Chaves Globais" antes de criar agentes.
            </div>
          )}

          {aiConfigs.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhum agente de IA configurado</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {aiConfigs.map(a => (
                <div key={a.id} className="glass-card rounded-2xl p-4 flex items-center gap-4 hover-lift">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{taskTypeLabels[a.task_type] ?? a.task_type}</p>
                      <Badge variant="outline" className="text-[10px]">{a.provider}/{a.model}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {getTenantName(a.tenant_id)} · Chave: {getKeyLabel(a.global_api_key_id)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-xl text-destructive" onClick={() => handleDeleteAi(a.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
