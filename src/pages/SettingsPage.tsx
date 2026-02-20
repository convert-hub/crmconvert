import { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, GripVertical, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface Member {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  profile?: { full_name: string | null; phone: string | null };
}

interface StageRow {
  id: string;
  name: string;
  color: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

interface AiConfig {
  id: string;
  task_type: string;
  provider: string;
  model: string;
  daily_limit: number;
  monthly_limit: number;
  daily_usage: number;
  monthly_usage: number;
}

const AI_TASK_LABELS: Record<string, string> = {
  message_generation: 'Geração de Mensagens',
  qa_review: 'QA / Review',
  qualification: 'Qualificação',
  stage_classifier: 'Classificador de Etapa',
};

export default function SettingsPage() {
  const { tenant, role } = useAuth();
  const [tenantName, setTenantName] = useState(tenant?.name ?? '');
  const [members, setMembers] = useState<Member[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('attendant');

  // New stage form
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6366f1');

  // AI config form
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiTaskType, setAiTaskType] = useState('message_generation');
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiDailyLimit, setAiDailyLimit] = useState('100');
  const [aiMonthlyLimit, setAiMonthlyLimit] = useState('3000');

  useEffect(() => { if (tenant) { setTenantName(tenant.name); loadAll(); } }, [tenant]);

  const loadAll = async () => {
    if (!tenant) return;
    // Members with profiles
    const { data: mems } = await supabase.from('tenant_memberships').select('*').eq('tenant_id', tenant.id);
    if (mems) {
      const enriched: Member[] = [];
      for (const m of mems as any[]) {
        const { data: prof } = await supabase.from('profiles').select('full_name, phone').eq('user_id', m.user_id).single();
        enriched.push({ ...m, profile: prof as any });
      }
      setMembers(enriched);
    }

    // Default pipeline stages
    const { data: pipelines } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant.id).eq('is_default', true).limit(1);
    if (pipelines && pipelines.length > 0) {
      const { data: stgs } = await supabase.from('stages').select('*').eq('pipeline_id', pipelines[0].id).order('position');
      setStages((stgs as unknown as StageRow[]) ?? []);
    }

    // AI configs
    const { data: ais } = await supabase.from('ai_configs').select('*').eq('tenant_id', tenant.id);
    setAiConfigs((ais as unknown as AiConfig[]) ?? []);
  };

  const saveTenant = async () => {
    if (!tenant) return;
    const { error } = await supabase.from('tenants').update({ name: tenantName }).eq('id', tenant.id);
    if (error) toast.error(error.message); else toast.success('Salvo!');
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    await supabase.from('tenant_memberships').update({ role: newRole as any }).eq('id', memberId);
    toast.success('Papel atualizado');
    loadAll();
  };

  const removeMember = async (memberId: string) => {
    await supabase.from('tenant_memberships').update({ is_active: false }).eq('id', memberId);
    toast.success('Membro desativado');
    loadAll();
  };

  const addStage = async () => {
    if (!tenant || !newStageName.trim()) return;
    const { data: pipelines } = await supabase.from('pipelines').select('id').eq('tenant_id', tenant.id).eq('is_default', true).limit(1);
    if (!pipelines || pipelines.length === 0) return;
    await supabase.from('stages').insert({
      tenant_id: tenant.id,
      pipeline_id: pipelines[0].id,
      name: newStageName,
      color: newStageColor,
      position: stages.length,
    });
    setNewStageName('');
    toast.success('Etapa adicionada');
    loadAll();
  };

  const deleteStage = async (id: string) => {
    await supabase.from('stages').delete().eq('id', id);
    toast.success('Etapa removida');
    loadAll();
  };

  const saveAiConfig = async () => {
    if (!tenant) return;
    // Check if exists
    const existing = aiConfigs.find(c => c.task_type === aiTaskType);
    if (existing) {
      await supabase.from('ai_configs').update({
        provider: aiProvider,
        model: aiModel,
        daily_limit: parseInt(aiDailyLimit),
        monthly_limit: parseInt(aiMonthlyLimit),
      }).eq('id', existing.id);
    } else {
      await supabase.from('ai_configs').insert({
        tenant_id: tenant.id,
        task_type: aiTaskType as any,
        provider: aiProvider,
        model: aiModel,
        daily_limit: parseInt(aiDailyLimit),
        monthly_limit: parseInt(aiMonthlyLimit),
      });
    }
    toast.success('Configuração de IA salva');
    setAiDialogOpen(false);
    loadAll();
  };

  const isAdmin = role === 'admin';

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Configurações</h1>
      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="team">Equipe</TabsTrigger>
          <TabsTrigger value="ai">IA</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Dados da Empresa</CardTitle>
              <CardDescription>Informações básicas do seu tenant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input value={tenantName} onChange={e => setTenantName(e.target.value)} />
              </div>
              <Button onClick={saveTenant} disabled={!isAdmin}>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pipeline / Stages */}
        <TabsContent value="pipeline" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Etapas do Pipeline Padrão</CardTitle>
              <CardDescription>Gerencie as etapas do funil principal</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pos.</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stages.map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell><div className="h-4 w-4 rounded" style={{ backgroundColor: s.color }} /></TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        {s.is_won && <Badge variant="default">Ganho</Badge>}
                        {s.is_lost && <Badge variant="destructive">Perdido</Badge>}
                        {!s.is_won && !s.is_lost && <Badge variant="secondary">Normal</Badge>}
                      </TableCell>
                      <TableCell>
                        {isAdmin && !s.is_won && !s.is_lost && (
                          <Button variant="ghost" size="icon" onClick={() => deleteStage(s.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {isAdmin && (
                <div className="flex gap-2 items-end">
                  <div className="space-y-1 flex-1">
                    <Label>Nova etapa</Label>
                    <Input value={newStageName} onChange={e => setNewStageName(e.target.value)} placeholder="Nome da etapa" />
                  </div>
                  <Input type="color" value={newStageColor} onChange={e => setNewStageColor(e.target.value)} className="w-14 h-10 p-1" />
                  <Button onClick={addStage}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team */}
        <TabsContent value="team" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Membros da Equipe</CardTitle>
              <CardDescription>Gerencie usuários e papéis do tenant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.profile?.full_name ?? 'Sem nome'}</TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Select value={m.role} onValueChange={v => updateMemberRole(m.id, v)}>
                            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="manager">Gerente</SelectItem>
                              <SelectItem value="attendant">Atendente</SelectItem>
                              <SelectItem value="readonly">Somente Leitura</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="capitalize">{m.role}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.is_active ? 'default' : 'secondary'}>{m.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      </TableCell>
                      <TableCell>
                        {isAdmin && m.is_active && (
                          <Button variant="ghost" size="sm" onClick={() => removeMember(m.id)}>Desativar</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Para convidar novos membros, crie a conta no Supabase Auth e adicione via SQL ou API.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Config */}
        <TabsContent value="ai" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Configuração de IA</CardTitle>
                <CardDescription>Provedores, modelos e limites por tarefa</CardDescription>
              </div>
              <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" />Configurar</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Configurar Provedor IA</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>Tipo de Tarefa</Label>
                      <Select value={aiTaskType} onValueChange={setAiTaskType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(AI_TASK_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Provedor</Label>
                        <Input value={aiProvider} onChange={e => setAiProvider(e.target.value)} placeholder="openai" />
                      </div>
                      <div className="space-y-2">
                        <Label>Modelo</Label>
                        <Input value={aiModel} onChange={e => setAiModel(e.target.value)} placeholder="gpt-4o-mini" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Limite Diário</Label>
                        <Input type="number" value={aiDailyLimit} onChange={e => setAiDailyLimit(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Limite Mensal</Label>
                        <Input type="number" value={aiMonthlyLimit} onChange={e => setAiMonthlyLimit(e.target.value)} />
                      </div>
                    </div>
                    <Button className="w-full" onClick={saveAiConfig}>Salvar</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {aiConfigs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tarefa</TableHead>
                      <TableHead>Provedor</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Uso Diário</TableHead>
                      <TableHead>Uso Mensal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiConfigs.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>{AI_TASK_LABELS[c.task_type] ?? c.task_type}</TableCell>
                        <TableCell className="font-mono text-sm">{c.provider}</TableCell>
                        <TableCell className="font-mono text-sm">{c.model}</TableCell>
                        <TableCell>{c.daily_usage}/{c.daily_limit}</TableCell>
                        <TableCell>{c.monthly_usage}/{c.monthly_limit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhuma configuração de IA. Adicione para habilitar os módulos de IA.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp (UAZAPI)</CardTitle>
              <CardDescription>Configure sua instância WhatsApp</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Configure na seção de integrações do admin.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>URLs de webhook para formulários e Facebook Lead Ads</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><strong>Webhook genérico:</strong> <code className="bg-muted px-2 py-0.5 rounded text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-form-intake`}</code></p>
              <p><strong>Facebook Lead Ads:</strong> <code className="bg-muted px-2 py-0.5 rounded text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-meta-leads`}</code></p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
