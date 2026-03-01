import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, Zap } from 'lucide-react';
import { toast } from 'sonner';

interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  variables: string[];
  is_active: boolean;
  position: number;
}

export default function QuickRepliesSettings() {
  const { tenant, membership, role } = useAuth();
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const isAdminOrManager = role === 'admin' || role === 'manager';

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from('quick_replies')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('position');
    setReplies((data as unknown as QuickReply[]) ?? []);
  };

  useEffect(() => { load(); }, [tenant]);

  const extractVariables = (text: string): string[] => {
    const matches = text.match(/\{\{(\w+)\}\}/g);
    return matches ? [...new Set(matches.map(m => m.replace(/\{|\}/g, '')))] : [];
  };

  const handleSave = async () => {
    if (!tenant || !membership || !shortcut.trim() || !content.trim()) return;
    const vars = extractVariables(content);
    const cleanShortcut = shortcut.trim().toLowerCase().replace(/^\//, '');

    if (editId) {
      const { error } = await supabase.from('quick_replies')
        .update({ shortcut: cleanShortcut, title: title.trim() || cleanShortcut, content: content.trim(), variables: vars })
        .eq('id', editId);
      if (error) { toast.error(error.message); return; }
      toast.success('Resposta rápida atualizada');
    } else {
      const { error } = await supabase.from('quick_replies')
        .insert({
          tenant_id: tenant.id, shortcut: cleanShortcut, title: title.trim() || cleanShortcut,
          content: content.trim(), variables: vars, created_by: membership.id, position: replies.length,
        });
      if (error) {
        if (error.message.includes('unique')) toast.error('Já existe um atalho com esse nome');
        else toast.error(error.message);
        return;
      }
      toast.success('Resposta rápida criada');
    }

    resetForm();
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('quick_replies').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Removida'); load(); }
  };

  const handleEdit = (r: QuickReply) => {
    setEditId(r.id);
    setShortcut(r.shortcut);
    setTitle(r.title);
    setContent(r.content);
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditId(null);
    setShortcut('');
    setTitle('');
    setContent('');
    setDialogOpen(false);
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Respostas Rápidas</CardTitle>
          <CardDescription>Crie atalhos de texto para o chat. Digite <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/atalho</code> no campo de mensagem para usar.</CardDescription>
        </div>
        {isAdminOrManager && (
          <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); else setDialogOpen(true); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Nova</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader><DialogTitle>{editId ? 'Editar' : 'Nova'} Resposta Rápida</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Atalho</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/</span>
                      <Input value={shortcut} onChange={e => setShortcut(e.target.value)} placeholder="saudacao" className="rounded-xl pl-7" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Título</Label>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Saudação inicial" className="rounded-xl" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Conteúdo</Label>
                  <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Olá {{nome}}, tudo bem? 😊" className="rounded-xl min-h-[100px]" />
                  <p className="text-[11px] text-muted-foreground">
                    Variáveis disponíveis: <code className="bg-muted px-1 rounded">{'{{nome}}'}</code> <code className="bg-muted px-1 rounded">{'{{telefone}}'}</code> <code className="bg-muted px-1 rounded">{'{{email}}'}</code>
                  </p>
                </div>
                <Button className="w-full rounded-xl" onClick={handleSave} disabled={!shortcut.trim() || !content.trim()}>
                  {editId ? 'Salvar Alterações' : 'Criar Resposta Rápida'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {replies.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Atalho</TableHead><TableHead>Título</TableHead><TableHead>Conteúdo</TableHead><TableHead>Variáveis</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {replies.map(r => (
                <TableRow key={r.id}>
                  <TableCell><code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">/{r.shortcut}</code></TableCell>
                  <TableCell className="font-medium text-foreground">{r.title}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">{r.content}</TableCell>
                  <TableCell>
                    {r.variables.map(v => (
                      <Badge key={v} variant="secondary" className="rounded-full text-[10px] mr-1">{v}</Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {isAdminOrManager && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(r.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma resposta rápida configurada.</p>
        )}
      </CardContent>
    </Card>
  );
}
