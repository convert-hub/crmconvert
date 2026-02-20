import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Loader2, Trash2, Plug, MessageCircle, Brain } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface WhatsAppInstance {
  id: string;
  tenant_id: string;
  instance_name: string;
  api_url: string;
  phone_number: string | null;
  is_active: boolean;
}

interface AiConfig {
  id: string;
  tenant_id: string;
  task_type: string;
  provider: string;
  model: string;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminApis() {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [whatsappInstances, setWhatsappInstances] = useState<WhatsAppInstance[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // WhatsApp form
  const [waOpen, setWaOpen] = useState(false);
  const [waForm, setWaForm] = useState({ tenant_id: '', instance_name: '', api_url: '', api_token: '', phone_number: '' });
  const [waSaving, setWaSaving] = useState(false);

  // AI form
  const [aiOpen, setAiOpen] = useState(false);
  const [aiForm, setAiForm] = useState({ tenant_id: '', task_type: 'message_generation', provider: 'openai', model: 'gpt-4o-mini', api_key: '' });
  const [aiSaving, setAiSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [tRes, wRes, aRes] = await Promise.all([
      supabase.from('tenants').select('id, name'),
      supabase.from('whatsapp_instances').select('id, tenant_id, instance_name, api_url, phone_number, is_active'),
      supabase.from('ai_configs').select('id, tenant_id, task_type, provider, model'),
    ]);
    setTenants(tRes.data ?? []);
    setWhatsappInstances(wRes.data ?? []);
    setAiConfigs(aRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getTenantName = (id: string) => tenants.find(t => t.id === id)?.name ?? '—';

  const handleCreateWhatsApp = async () => {
    setWaSaving(true);
    const { error } = await supabase.from('whatsapp_instances').insert({
      tenant_id: waForm.tenant_id,
      instance_name: waForm.instance_name,
      api_url: waForm.api_url,
      api_token_encrypted: waForm.api_token,
      phone_number: waForm.phone_number || null,
    });
    if (error) { toast.error(error.message); } else {
      toast.success('Instância WhatsApp criada!');
      setWaOpen(false);
      setWaForm({ tenant_id: '', instance_name: '', api_url: '', api_token: '', phone_number: '' });
      load();
    }
    setWaSaving(false);
  };

  const handleCreateAi = async () => {
    setAiSaving(true);
    const { error } = await supabase.from('ai_configs').insert({
      tenant_id: aiForm.tenant_id,
      task_type: aiForm.task_type as any,
      provider: aiForm.provider,
      model: aiForm.model,
      api_key_encrypted: aiForm.api_key,
    });
    if (error) { toast.error(error.message); } else {
      toast.success('Configuração de IA criada!');
      setAiOpen(false);
      setAiForm({ tenant_id: '', task_type: 'message_generation', provider: 'openai', model: 'gpt-4o-mini', api_key: '' });
      load();
    }
    setAiSaving(false);
  };

  const handleDeleteWa = async (id: string) => {
    if (!confirm('Remover esta instância?')) return;
    await supabase.from('whatsapp_instances').delete().eq('id', id);
    toast.success('Removido');
    load();
  };

  const handleDeleteAi = async (id: string) => {
    if (!confirm('Remover esta configuração?')) return;
    await supabase.from('ai_configs').delete().eq('id', id);
    toast.success('Removido');
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">APIs & Integrações</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure WhatsApp e IA por empresa</p>
      </div>

      <Tabs defaultValue="whatsapp" className="w-full">
        <TabsList className="rounded-xl bg-muted">
          <TabsTrigger value="whatsapp" className="rounded-lg"><MessageCircle className="h-4 w-4 mr-2" />WhatsApp</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-lg"><Brain className="h-4 w-4 mr-2" />IA / LLM</TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Dialog open={waOpen} onOpenChange={setWaOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl gradient-primary text-white border-0"><Plus className="h-4 w-4 mr-2" />Nova Instância</Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader><DialogTitle>Nova Instância WhatsApp</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <Label>Empresa</Label>
                    <Select value={waForm.tenant_id} onValueChange={v => setWaForm(f => ({ ...f, tenant_id: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Nome da Instância</Label><Input className="rounded-xl" value={waForm.instance_name} onChange={e => setWaForm(f => ({ ...f, instance_name: e.target.value }))} placeholder="principal" /></div>
                  <div className="space-y-1"><Label>URL da API</Label><Input className="rounded-xl" value={waForm.api_url} onChange={e => setWaForm(f => ({ ...f, api_url: e.target.value }))} placeholder="https://api.uazapi.com/..." /></div>
                  <div className="space-y-1"><Label>Token da API</Label><Input className="rounded-xl" type="password" value={waForm.api_token} onChange={e => setWaForm(f => ({ ...f, api_token: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Telefone (opcional)</Label><Input className="rounded-xl" value={waForm.phone_number} onChange={e => setWaForm(f => ({ ...f, phone_number: e.target.value }))} placeholder="+5511..." /></div>
                  <Button onClick={handleCreateWhatsApp} disabled={waSaving || !waForm.tenant_id || !waForm.api_url} className="w-full rounded-xl gradient-primary text-white border-0">
                    {waSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {whatsappInstances.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Plug className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhuma instância configurada</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {whatsappInstances.map(w => (
                <div key={w.id} className="glass-card rounded-2xl p-4 flex items-center gap-4 hover-lift">
                  <div className="h-10 w-10 rounded-xl bg-success/10 text-success flex items-center justify-center">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{w.instance_name}</p>
                      <Badge variant={w.is_active ? 'default' : 'secondary'} className="text-[10px]">{w.is_active ? 'Ativo' : 'Inativo'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{getTenantName(w.tenant_id)} · {w.phone_number ?? 'Sem telefone'}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-xl text-destructive" onClick={() => handleDeleteWa(w.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Dialog open={aiOpen} onOpenChange={setAiOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl gradient-primary text-white border-0"><Plus className="h-4 w-4 mr-2" />Nova Config IA</Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader><DialogTitle>Nova Configuração de IA</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <Label>Empresa</Label>
                    <Select value={aiForm.tenant_id} onValueChange={v => setAiForm(f => ({ ...f, tenant_id: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
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
                  <div className="space-y-1"><Label>API Key</Label><Input className="rounded-xl" type="password" value={aiForm.api_key} onChange={e => setAiForm(f => ({ ...f, api_key: e.target.value }))} /></div>
                  <Button onClick={handleCreateAi} disabled={aiSaving || !aiForm.tenant_id} className="w-full rounded-xl gradient-primary text-white border-0">
                    {aiSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {aiConfigs.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhuma configuração de IA</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {aiConfigs.map(a => (
                <div key={a.id} className="glass-card rounded-2xl p-4 flex items-center gap-4 hover-lift">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">{a.task_type}</p>
                    <p className="text-xs text-muted-foreground">{getTenantName(a.tenant_id)} · {a.provider}/{a.model}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-xl text-destructive" onClick={() => handleDeleteAi(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
