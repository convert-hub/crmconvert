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
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Brain, Edit, Trash2, Copy, FileText } from 'lucide-react';
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

interface KnowledgeDoc {
  id: string; name: string; category: string | null; status: string;
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

  // Document multi-select states
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [templateDocMap, setTemplateDocMap] = useState<Map<string, string[]>>(new Map());

  const load = async () => {
    if (!tenant) return;

    const [templatesRes, docsRes, ptDocsRes] = await Promise.all([
      supabase.from('prompt_templates').select('*').eq('tenant_id', tenant.id)
        .order('task_type').order('version', { ascending: false }),
      supabase.from('knowledge_documents').select('id, name, category, status')
        .eq('tenant_id', tenant.id).eq('status', 'ready').order('category').order('name'),
      supabase.from('prompt_template_documents' as any).select('prompt_template_id, document_id'),
    ]);

    setTemplates((templatesRes.data as unknown as PromptTemplate[]) ?? []);
    const docs = (docsRes.data as KnowledgeDoc[]) ?? [];
    setDocuments(docs);

    // Build template -> doc names map
    const docMap = new Map<string, string[]>();
    const ptDocs = (ptDocsRes.data as any[]) ?? [];
    for (const ptd of ptDocs) {
      const docName = docs.find(d => d.id === ptd.document_id)?.name;
      if (docName) {
        if (!docMap.has(ptd.prompt_template_id)) docMap.set(ptd.prompt_template_id, []);
        docMap.get(ptd.prompt_template_id)!.push(docName);
      }
    }
    setTemplateDocMap(docMap);
  };

  useEffect(() => { load(); }, [tenant]);

  const resetForm = () => {
    setName(''); setTaskType('message_generation'); setContent(''); setVariables('');
    setForbiddenTerms(''); setIsActive(true); setEditId(null); setKnowledgeCategory(null);
    setSelectedDocIds([]);
  };

  const openEdit = async (t: PromptTemplate) => {
    setEditId(t.id); setName(t.name); setTaskType(t.task_type); setContent(t.content);
    setVariables(t.variables?.join(', ') ?? ''); setForbiddenTerms(t.forbidden_terms?.join(', ') ?? '');
    setIsActive(t.is_active); setKnowledgeCategory(t.knowledge_category);

    // Load linked documents
    const { data: ptDocs } = await supabase
      .from('prompt_template_documents' as any)
      .select('document_id')
      .eq('prompt_template_id', t.id);
    setSelectedDocIds((ptDocs as any[])?.map((d: any) => d.document_id) ?? []);

    setDialogOpen(true);
  };

  const saveDocLinks = async (templateId: string) => {
    // Clear existing links
    await supabase.from('prompt_template_documents' as any).delete().eq('prompt_template_id', templateId);
    // Insert new links
    if (selectedDocIds.length > 0) {
      const inserts = selectedDocIds.map(docId => ({
        prompt_template_id: templateId,
        document_id: docId,
      }));
      await supabase.from('prompt_template_documents' as any).insert(inserts);
    }
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
        const { data, error } = await supabase.from('prompt_templates').insert({
          tenant_id: tenant.id, name, task_type: taskType as any, content, variables: vars,
          forbidden_terms: forbidden, version: newVersion, is_active: isActive,
          knowledge_category: knowledgeCategory,
        }).select('id').single();
        if (error) { toast.error(error.message); return; }
        if (data) await saveDocLinks(data.id);
        toast.success(`Prompt v${newVersion} salvo`);
      } else {
        const { error } = await supabase.from('prompt_templates').update({
          variables: vars, forbidden_terms: forbidden, is_active: isActive,
          knowledge_category: knowledgeCategory,
        }).eq('id', editId);
        if (error) { toast.error(error.message); return; }
        await saveDocLinks(editId);
        toast.success('Prompt atualizado');
      }
    } else {
      const { data, error } = await supabase.from('prompt_templates').insert({
        tenant_id: tenant.id, name, task_type: taskType as any, content, variables: vars,
        forbidden_terms: forbidden, version: 1, is_active: isActive,
        knowledge_category: knowledgeCategory,
      }).select('id').single();
      if (error) { toast.error(error.message); return; }
      if (data) await saveDocLinks(data.id);
      toast.success('Prompt criado');
    }
    setDialogOpen(false); resetForm(); load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('prompt_templates').delete().eq('id', id);
    toast.success('Prompt removido'); load();
  };

  const handleDuplicate = async (t: PromptTemplate) => {
    if (!tenant) return;
    const { data, error } = await supabase.from('prompt_templates').insert({
      tenant_id: tenant.id, name: `${t.name} (cópia)`, task_type: t.task_type as any,
      content: t.content, variables: t.variables, forbidden_terms: t.forbidden_terms, version: 1, is_active: false,
      knowledge_category: t.knowledge_category,
    }).select('id').single();

    if (error) { toast.error(error.message); return; }

    // Copy doc links
    if (data) {
      const { data: originalDocs } = await supabase
        .from('prompt_template_documents' as any)
        .select('document_id')
        .eq('prompt_template_id', t.id);
      if (originalDocs && (originalDocs as any[]).length > 0) {
        const inserts = (originalDocs as any[]).map((d: any) => ({
          prompt_template_id: data.id,
          document_id: d.document_id,
        }));
        await supabase.from('prompt_template_documents' as any).insert(inserts);
      }
    }

    toast.success('Prompt duplicado'); load();
  };

  // Group documents by category
  const docsByCategory = documents.reduce((acc, doc) => {
    const cat = doc.category || 'Sem categoria';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {} as Record<string, KnowledgeDoc[]>);

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

              {/* Document multi-select */}
              <div className="space-y-2">
                <Label>Documentos da Base de Conhecimento</Label>
                <p className="text-xs text-muted-foreground">
                  Selecione quais documentos este agente pode acessar. Se nenhum for selecionado, acessa todos.
                </p>
                <div className="border rounded-xl p-3 max-h-48 overflow-y-auto space-y-3">
                  {documents.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Nenhum documento disponível. Faça upload na página de Base de Conhecimento.
                    </p>
                  ) : (
                    Object.entries(docsByCategory).map(([category, docs]) => (
                      <div key={category}>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">{category}</p>
                        {docs.map(doc => (
                          <label key={doc.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-1">
                            <Checkbox
                              checked={selectedDocIds.includes(doc.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedDocIds(prev => [...prev, doc.id]);
                                } else {
                                  setSelectedDocIds(prev => prev.filter(id => id !== doc.id));
                                }
                              }}
                            />
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm">{doc.name}</span>
                          </label>
                        ))}
                      </div>
                    ))
                  )}
                </div>
                {selectedDocIds.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {selectedDocIds.length} documento{selectedDocIds.length > 1 ? 's' : ''} selecionado{selectedDocIds.length > 1 ? 's' : ''}
                    </span>
                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setSelectedDocIds([])}>
                      Limpar seleção
                    </Button>
                  </div>
                )}
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
                    {templateDocMap.get(t.id)?.length ? (
                      <Badge variant="outline" className="text-xs rounded-full">
                        {templateDocMap.get(t.id)!.length} doc{templateDocMap.get(t.id)!.length > 1 ? 's' : ''}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs rounded-full text-muted-foreground">
                        Todos os docs
                      </Badge>
                    )}
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
