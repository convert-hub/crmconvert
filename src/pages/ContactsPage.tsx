import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Contact } from '@/types/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Download, Upload, Phone, Mail, Edit, Trash2, MoreHorizontal, CalendarIcon, Tag, Kanban } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { contactStatusLabels } from '@/lib/labels';
import ImportContactsDialog from '@/components/contacts/ImportContactsDialog';
import TagInput from '@/components/contacts/TagInput';
import type { TagDef } from '@/components/settings/TagsSettings';
import CreateOpportunityFromContactDialog from '@/components/crm/CreateOpportunityFromContactDialog';

export default function ContactsPage() {
  const { tenant, role } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', status: 'lead' as const, tags: [] as string[], birth_date: undefined as Date | undefined });
  const [showImport, setShowImport] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [registeredTags, setRegisteredTags] = useState<TagDef[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [oppContact, setOppContact] = useState<Contact | null>(null);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('tenants').select('settings').eq('id', tenant.id).single().then(({ data }) => {
      if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        setRegisteredTags((data.settings as Record<string, any>).tags || []);
      }
    });
  }, [tenant]);

  const getTagColor = (name: string) => registeredTags.find(t => t.name.toLowerCase() === name.toLowerCase())?.color;

  const loadContacts = () => {
    if (!tenant) return;
    let query = supabase.from('contacts').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200);
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter as any);
    if (tagFilter.length > 0) query = query.contains('tags', tagFilter);
    query.then(({ data }) => setContacts((data as unknown as Contact[]) ?? []));
  };

  useEffect(() => { loadContacts(); }, [tenant, search, statusFilter, tagFilter]);

  const openCreate = () => {
    setEditingContact(null);
    setForm({ name: '', phone: '', email: '', status: 'lead', tags: [], birth_date: undefined });
    setShowDialog(true);
  };

  const openEdit = (c: Contact) => {
    setEditingContact(c);
    setForm({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', status: c.status as any, tags: c.tags ?? [], birth_date: c.birth_date ? new Date(c.birth_date + 'T00:00:00') : undefined });
    setShowDialog(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    const payload = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      tags: form.tags,
      birth_date: form.birth_date ? format(form.birth_date, 'yyyy-MM-dd') : null,
    };

    if (editingContact) {
      const { error } = await supabase.from('contacts').update(payload).eq('id', editingContact.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Contato atualizado!');
    } else {
      const { error } = await supabase.from('contacts').insert({ ...payload, tenant_id: tenant.id });
      if (error) { toast.error(error.message); return; }
      toast.success('Contato criado!');
    }
    setShowDialog(false);
    loadContacts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza? Isso excluirá também todas as conversas e mensagens deste contato.')) return;
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Contato removido');
    loadContacts();
  };

  const exportCSV = () => {
    const headers = 'Nome,Telefone,Email,Status,Tags,Data Nascimento,Criado em\n';
    const rows = contacts.map(c => `"${c.name}","${c.phone ?? ''}","${c.email ?? ''}","${c.status}","${c.tags?.join(';') ?? ''}","${c.birth_date ? format(new Date(c.birth_date + 'T00:00:00'), 'dd/MM/yyyy') : ''}","${c.created_at}"`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'contatos.csv'; a.click();
  };

  const statusColors: Record<string, string> = {
    lead: 'bg-warning/8 text-warning border-warning/15',
    customer: 'bg-success/8 text-success border-success/15',
    churned: 'bg-destructive/8 text-destructive border-destructive/15',
    inactive: 'bg-muted text-muted-foreground border-border',
  };

  const isReadonly = role === 'readonly';

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Contatos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{contacts.length} contato{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-9 text-[13px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="customer">Cliente</SelectItem>
              <SelectItem value="churned">Churned</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
          <Popover open={showTagFilter} onOpenChange={setShowTagFilter}>
            <PopoverTrigger asChild>
              <Button variant={tagFilter.length > 0 ? 'default' : 'outline'} size="sm" className="h-9 text-[13px]">
                <Tag className="h-3.5 w-3.5 mr-1.5" />Tags{tagFilter.length > 0 && ` (${tagFilter.length})`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="space-y-1">
                {registeredTags.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma tag cadastrada</p>}
                {registeredTags.map(t => (
                  <button
                    key={t.name}
                    className={cn("w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors", tagFilter.includes(t.name) ? 'bg-accent' : 'hover:bg-accent/50')}
                    onClick={() => setTagFilter(prev => prev.includes(t.name) ? prev.filter(x => x !== t.name) : [...prev, t.name])}
                  >
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                    {tagFilter.includes(t.name) && <span className="ml-auto text-xs">✓</span>}
                  </button>
                ))}
                {tagFilter.length > 0 && (
                  <button className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1" onClick={() => setTagFilter([])}>
                    Limpar filtro
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-9 w-56 h-9 text-[13px]" placeholder="Buscar contatos..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 text-[13px]"><Download className="h-3.5 w-3.5 mr-1.5" />CSV</Button>
          {!isReadonly && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)} className="h-9 text-[13px]"><Upload className="h-3.5 w-3.5 mr-1.5" />Importar</Button>
              <Button size="sm" onClick={openCreate} className="h-9 text-[13px]"><Plus className="h-3.5 w-3.5 mr-1.5" />Novo Contato</Button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/60">
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Telefone</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tags</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nascimento</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Origem</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Criado</TableHead>
                {!isReadonly && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map(c => (
                <TableRow key={c.id} className="group cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => !isReadonly && openEdit(c)}>
                  <TableCell className="text-[13px] font-medium text-foreground">{c.name}</TableCell>
                  <TableCell className="text-[13px]">{c.phone && <span className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3 w-3" strokeWidth={1.5} />{c.phone}</span>}</TableCell>
                  <TableCell className="text-[13px]">{c.email && <span className="flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3 w-3" strokeWidth={1.5} />{c.email}</span>}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[11px] rounded-full font-normal ${statusColors[c.status] ?? ''}`}>{contactStatusLabels[c.status] ?? c.status}</Badge>
                  </TableCell>
                  <TableCell><div className="flex gap-1 flex-wrap">{c.tags?.slice(0, 3).map(t => { const color = getTagColor(t); return <Badge key={t} variant="outline" className="text-[10px] rounded-full font-normal" style={color ? { borderColor: color, color } : undefined}>{t}</Badge>; })}</div></TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{c.birth_date ? format(new Date(c.birth_date + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{c.source ?? '-'}</TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">{format(new Date(c.created_at), 'dd/MM/yy')}</TableCell>
                  {!isReadonly && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(c)}><Edit className="h-3.5 w-3.5 mr-2" />Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setOppContact(c); }}><Kanban className="h-3.5 w-3.5 mr-2" />Criar Oportunidade</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(c.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" />Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {contacts.length === 0 && <p className="text-center text-muted-foreground text-sm py-12">Nenhum contato encontrado</p>}
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-base font-semibold">{editingContact ? 'Editar Contato' : 'Novo Contato'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5"><Label className="text-[13px]">Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-[13px]">Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+5511999999999" /></div>
              <div className="space-y-1.5"><Label className="text-[13px]">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="customer">Cliente</SelectItem>
                  <SelectItem value="churned">Perdido</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Data de Nascimento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.birth_date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {form.birth_date ? format(form.birth_date, 'dd/MM/yyyy') : 'Selecionar data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={form.birth_date} onSelect={d => setForm(f => ({ ...f, birth_date: d }))} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5"><Label className="text-[13px]">Tags</Label><TagInput value={form.tags} onChange={tags => setForm(f => ({ ...f, tags }))} /></div>
            <Button type="submit" className="w-full">{editingContact ? 'Salvar' : 'Criar Contato'}</Button>
          </form>
        </DialogContent>
      </Dialog>

      {tenant && (
        <ImportContactsDialog
          open={showImport}
          onOpenChange={setShowImport}
          tenantId={tenant.id}
          onImported={loadContacts}
        />
      )}

      {oppContact && (
        <CreateOpportunityFromContactDialog
          open={!!oppContact}
          onOpenChange={(v) => { if (!v) setOppContact(null); }}
          contact={oppContact}
          onCreated={() => toast.success('Card criado no pipeline!')}
        />
      )}
    </div>
  );
}
