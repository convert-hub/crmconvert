import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Brain, Edit, Trash2, Copy } from 'lucide-react';
import { toast } from 'sonner';

const TASK_TYPES = [
  { value: 'message_generation', label: 'Geração de Mensagens' },
  { value: 'qualification', label: 'Qualificação' },
];

interface PromptTemplate {
  id: string; name: string; task_type: string; content: string;
  variables: string[]; forbidden_terms: string[]; version: number;
  is_active: boolean; created_at: string; knowledge_category: string | null;
}

export default function PromptStudioPage() {
  const { tenant } = useAuth();
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [taskType, setTaskType] = useState('message_generation');
  const [content, setContent] = useState('');
  const [variables, setVariables] = useState('');
  const [forbiddenTerms, setForbiddenTerms] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [knowledgeCategory, setKnowledgeCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  const load = () => {
    if (!tenant) return;
    supabase.from('prompt_templates').select('*').eq('tenant_id', tenant.id).order('task_type').order('version', { ascending: false })
      .then(({ data }) => setTemplates((data as unknown as PromptTemplate[]) ?? []));
  };

  const loadCategories = () => {
    if (!tenant) return;
    supabase.from('knowledge_documents').select('category').eq('tenant_id', tenant.id).not('category', 'is', null)
      .then(({ data }) => {
        const cats = [...new Set(data?.map(d => d.category).filter(Boolean) as string[])];
        setCategories(cats);
      });
  };

  useEffect(() => { load(); loadCategories(); }, [tenant]);

  const resetForm = () => { setName(''); setTaskType('message_generation'); setContent(''); setVariables(''); setForbiddenTerms(''); setIsActive(true); setEditId(null); setKnowledgeCategory(null); };

  const openEdit = (t: PromptTemplate) => {
    setEditId(t.id); setName(t.name); setTaskType(t.task_type); setContent(t.content);
    setVariables(t.variables?.join(', ') ?? ''); setForbiddenTerms(t.forbidden_terms?.join(', ') ?? '');
    setIsActive(t.is_active); setKnowledgeCategory(t.knowledge_category); setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenant || !name.trim() || !content.trim()) return;
    const vars = variables.split(',').map(v => v.trim()).filter(Boolean);
    const forbidden = forbiddenTerms.split(',').map(v => v.trim()).filter(Boolean);

    if (editId) {
      const existing = templates.find(t => t.id === editId);
      const contentChanged = existing && (existing.content !== content || existing.name !== name || existing.task_type !== taskType);
      
      if (contentChanged) {
        const newVersion = (existing?.version ?? 0) + 1;
        await supabase.from('prompt_templates').update({ is_active: false }).eq('id', editId);
        const { error } = await supabase.from('prompt_templates').insert({
          tenant_id: tenant.id, name, task_type: taskType as any, content, variables: vars,
          forbidden_terms: forbidden, version: newVersion, is_active: isActive,
          knowledge_category: knowledgeCategory,
        });
        if (error) toast.error(error.message); else toast.success(`Prompt v${newVersion} salvo`);
      } else {
        const { error } = await supabase.from('prompt_templates').update({
          variables: vars, forbidden_terms: forbidden, is_active: isActive,
          knowledge_category: knowledgeCategory,
        }).eq('id', editId);
        if (error) toast.error(error.message); else toast.success('Prompt atualizado');
      }
    } else {
      const { error } = await supabase.from('prompt_templates').insert({
        tenant_id: tenant.id, name, task_type: taskType as any, content, variables: vars,
        forbidden_terms: forbidden, version: 1, is_active: isActive,
        knowledge_category: knowledgeCategory,
      });
      if (error) toast.error(error.message); else toast.success('Prompt criado');
    }
    setDialogOpen(false); resetForm(); load();
  };

  const handleDelete = async (id: string) => { await supabase.from('prompt_templates').delete().eq('id', id); toast.success('Prompt removido'); load(); };

  const handleDuplicate = async (t: PromptTemplate) => {
    if (!tenant) return;
    await supabase.from('prompt_templates').insert({
      tenant_id: tenant.id, name: `${t.name} (cópia)`, task_type: t.task_type as any,
      content: t.content, variables: t.variables, forbidden_terms: t.forbidden_terms, version: 1, is_active: false,
      knowledge_category: t.knowledge_category,
    });
    toast.success('Prompt duplicado'); load();
  };

  return (
    <div className="p-6 max-w-5xl space-y-6 bg-background">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Prompt Studio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Gerencie prompts de IA com versionamento por tarefa</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { if (!v) resetForm(); setDialogOpen(v); }}>
          <DialogTrigger asChild><Button className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Novo Prompt</Button></DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
            <DialogHeader><DialogTitle>{editId ? 'Nova Versão' : 'Novo Prompt'}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} className="rounded-xl" /></div>
                <div className="space-y-2">
                  <Label>Tipo de Tarefa</Label>
                  <Select value={taskType} onValueChange={setTaskType}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Conteúdo do Prompt</Label><Textarea value={content} onChange={e => setContent(e.target.value)} className="font-mono text-sm min-h-[200px] rounded-xl" placeholder="Você é um assistente..." /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Variáveis</Label><Input value={variables} onChange={e => setVariables(e.target.value)} placeholder="contact_name, stage_name" className="rounded-xl" /></div>
                <div className="space-y-2"><Label>Termos proibidos</Label><Input value={forbiddenTerms} onChange={e => setForbiddenTerms(e.target.value)} placeholder="garantia, gratuito" className="rounded-xl" /></div>
              </div>
              <div className="space-y-2">
                <Label>Categoria da Base de Conhecimento</Label>
                <Select value={knowledgeCategory || "all"} onValueChange={v => setKnowledgeCategory(v === "all" ? null : v)}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Filtra quais documentos da base de conhecimento este agente pode consultar.</p>
              </div>
              <div className="flex items-center gap-2"><Switch checked={isActive} onCheckedChange={setIsActive} /><Label>Ativo</Label></div>
              <Button className="w-full rounded-xl" onClick={handleSave}>Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {templates.map(t => (
          <Card key={t.id} className="glass-card rounded-2xl hover-lift">
            <CardContent className="flex items-center justify-between py-4 px-5">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">{t.name}</p>
                    <Badge variant="outline" className="text-[10px] rounded-full">v{t.version}</Badge>
                    {!t.is_active && <Badge variant="secondary" className="text-[10px] rounded-full">Inativo</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className="text-xs rounded-full">{TASK_TYPES.find(x => x.value === t.task_type)?.label ?? t.task_type}</Badge>
                    {t.knowledge_category && <Badge variant="outline" className="text-xs rounded-full">{t.knowledge_category}</Badge>}
                    {t.forbidden_terms?.length > 0 && <span className="text-xs text-muted-foreground">{t.forbidden_terms.length} termos proibidos</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => handleDuplicate(t)}><Copy className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => openEdit(t)}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => handleDelete(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <div className="text-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"><Brain className="h-8 w-8 text-primary" /></div>
            <p className="text-muted-foreground font-medium">Nenhum prompt configurado</p>
          </div>
        )}
      </div>
    </div>
  );
}
