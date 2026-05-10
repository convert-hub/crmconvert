import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, RefreshCw, Search, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface MetaInstance {
  id: string;
  display_name: string | null;
  instance_name: string;
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: any;
  meta_template_id: string | null;
  whatsapp_instance_id: string;
  updated_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  REJECTED: 'bg-red-500/10 text-red-600 border-red-500/20',
  PAUSED: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/20',
  DISABLED: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/20',
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desabilitado',
};

export default function MetaTemplatesCard() {
  const { tenant } = useAuth();
  const [instances, setInstances] = useState<MetaInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [previewTpl, setPreviewTpl] = useState<TemplateRow | null>(null);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const { data } = await (supabase.from as any)('whatsapp_instances_public')
        .select('id, display_name, instance_name')
        .eq('tenant_id', tenant.id)
        .eq('provider', 'meta_cloud')
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      const list = (data ?? []) as MetaInstance[];
      setInstances(list);
      if (list.length > 0 && !selectedInstance) setSelectedInstance(list[0].id);
    })();
  }, [tenant]);

  const loadTemplates = async () => {
    if (!tenant || !selectedInstance) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('whatsapp_message_templates')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('whatsapp_instance_id', selectedInstance)
      .order('name');
    if (error) toast.error(error.message);
    setTemplates((data ?? []) as TemplateRow[]);
    setLoading(false);
  };

  useEffect(() => { loadTemplates(); }, [tenant?.id, selectedInstance]);

  const handleSync = async () => {
    if (!selectedInstance) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-meta-templates-sync', {
        body: { whatsapp_instance_id: selectedInstance },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success(`${data.count} de ${data.total} templates sincronizados`);
        await loadTemplates();
      } else {
        toast.error(data?.error ?? 'Falha ao sincronizar');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Erro');
    } finally {
      setSyncing(false);
    }
  };

  const languages = useMemo(
    () => Array.from(new Set(templates.map(t => t.language))).sort(),
    [templates],
  );

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (statusFilter !== 'all' && (t.status ?? '').toUpperCase() !== statusFilter) return false;
      if (langFilter !== 'all' && t.language !== langFilter) return false;
      if (search.trim() && !t.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [templates, statusFilter, langFilter, search]);

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Templates Meta (WABA)</CardTitle>
            <CardDescription>Visualize os templates baixados da Meta e seus respectivos status de aprovação</CardDescription>
          </div>
          <Button onClick={handleSync} disabled={!selectedInstance || syncing} className="rounded-xl">
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar agora
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {instances.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhuma instância Meta Cloud ativa. Configure em <strong>Integrações → Conexões Meta</strong>.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-1">
                <Label className="text-xs">Instância Meta</Label>
                <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {instances.map(i => (
                      <SelectItem key={i.id} value={i.id}>{i.display_name || i.instance_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="APPROVED">Aprovado</SelectItem>
                    <SelectItem value="PENDING">Pendente</SelectItem>
                    <SelectItem value="REJECTED">Rejeitado</SelectItem>
                    <SelectItem value="PAUSED">Pausado</SelectItem>
                    <SelectItem value="DISABLED">Desabilitado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Idioma</Label>
                <Select value={langFilter} onValueChange={setLangFilter}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {languages.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buscar nome</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="welcome..."
                    className="rounded-xl pl-8"
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                {templates.length === 0
                  ? 'Nenhum template sincronizado ainda. Clique em "Sincronizar agora".'
                  : 'Nenhum template corresponde aos filtros.'}
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Idioma</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Atualizado</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(t => {
                      const status = (t.status ?? '').toUpperCase();
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell><Badge variant="outline" className="rounded-full">{t.language}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.category ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={`rounded-full border ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
                              {STATUS_LABEL[status] ?? (t.status ?? '—')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(t.updated_at).toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setPreviewTpl(t)}>
                              <Eye className="h-4 w-4 mr-1" />Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        <Dialog open={!!previewTpl} onOpenChange={v => !v && setPreviewTpl(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{previewTpl?.name}</DialogTitle>
              <DialogDescription>
                {previewTpl?.language} · {previewTpl?.category ?? '—'} · {STATUS_LABEL[(previewTpl?.status ?? '').toUpperCase()] ?? previewTpl?.status}
              </DialogDescription>
            </DialogHeader>
            {previewTpl && Array.isArray(previewTpl.components) && (
              <div className="space-y-3">
                {previewTpl.components.map((c: any, i: number) => (
                  <div key={i} className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.type}</Label>
                    {c.text && (
                      <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">{c.text}</div>
                    )}
                    {c.format && c.type === 'HEADER' && !c.text && (
                      <div className="text-xs text-muted-foreground">Formato: {c.format}</div>
                    )}
                    {Array.isArray(c.buttons) && c.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {c.buttons.map((b: any, bi: number) => (
                          <Badge key={bi} variant="outline" className="rounded-full">
                            {b.text} {b.type ? `(${b.type})` : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {previewTpl.meta_template_id && (
                  <div className="text-[11px] text-muted-foreground">ID Meta: <code>{previewTpl.meta_template_id}</code></div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
