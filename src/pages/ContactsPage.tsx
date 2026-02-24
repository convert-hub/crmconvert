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
import { Plus, Search, Download, Phone, Mail, Edit, Trash2, MoreHorizontal, CalendarIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function ContactsPage() {
  const { tenant, role } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', status: 'lead' as const, tags: '', birth_date: undefined as Date | undefined });

  const loadContacts = () => {
    if (!tenant) return;
    let query = supabase.from('contacts').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200);
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    query.then(({ data }) => setContacts((data as unknown as Contact[]) ?? []));
  };

  useEffect(() => { loadContacts(); }, [tenant, search]);

  const openCreate = () => {
    setEditingContact(null);
    setForm({ name: '', phone: '', email: '', status: 'lead', tags: '', birth_date: undefined });
    setShowDialog(true);
  };

  const openEdit = (c: Contact) => {
    setEditingContact(c);
    setForm({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', status: c.status as any, tags: c.tags?.join(', ') ?? '', birth_date: c.birth_date ? new Date(c.birth_date + 'T00:00:00') : undefined });
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
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
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
    lead: 'bg-warning/10 text-warning border-warning/20',
    customer: 'bg-success/10 text-success border-success/20',
    churned: 'bg-destructive/10 text-destructive border-destructive/20',
    inactive: 'bg-muted text-muted-foreground',
  };

  const isReadonly = role === 'readonly';

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Contatos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contacts.length} contato{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 w-64 rounded-xl" placeholder="Buscar contatos..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} className="rounded-xl"><Download className="h-4 w-4 mr-1" />CSV</Button>
          {!isReadonly && (
            <Button size="sm" onClick={openCreate} className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Novo Contato</Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="glass-card rounded-2xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-semibold">Nome</TableHead>
                <TableHead className="font-semibold">Telefone</TableHead>
                <TableHead className="font-semibold">Email</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Tags</TableHead>
                <TableHead className="font-semibold">Nascimento</TableHead>
                <TableHead className="font-semibold">Origem</TableHead>
                <TableHead className="font-semibold">Criado</TableHead>
                {!isReadonly && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map(c => (
                <TableRow key={c.id} className="group cursor-pointer" onClick={() => !isReadonly && openEdit(c)}>
                  <TableCell className="font-medium text-foreground">
                    <span className="group-hover:underline">{c.name}</span>
                  </TableCell>
                  <TableCell>{c.phone && <span className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</span>}</TableCell>
                  <TableCell>{c.email && <span className="flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</span>}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize rounded-full ${statusColors[c.status] ?? ''}`}>{c.status}</Badge>
                  </TableCell>
                  <TableCell><div className="flex gap-1 flex-wrap">{c.tags?.slice(0, 3).map(t => <Badge key={t} variant="outline" className="text-[10px] rounded-full">{t}</Badge>)}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.birth_date ? format(new Date(c.birth_date + 'T00:00:00'), 'dd/MM/yyyy') : '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.source ?? '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd/MM/yy')}</TableCell>
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
                          <DropdownMenuItem onClick={() => handleDelete(c.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" />Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {contacts.length === 0 && <p className="text-center text-muted-foreground py-12">Nenhum contato encontrado</p>}
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{editingContact ? 'Editar Contato' : 'Novo Contato'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="rounded-xl" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+5511999999999" className="rounded-xl" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" /></div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="customer">Cliente</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data de Nascimento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal rounded-xl", !form.birth_date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.birth_date ? format(form.birth_date, 'dd/MM/yyyy') : 'Selecionar data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={form.birth_date} onSelect={d => setForm(f => ({ ...f, birth_date: d }))} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2"><Label>Tags (separadas por vírgula)</Label><Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="tag1, tag2" className="rounded-xl" /></div>
            <Button type="submit" className="w-full rounded-xl">{editingContact ? 'Salvar' : 'Criar Contato'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
