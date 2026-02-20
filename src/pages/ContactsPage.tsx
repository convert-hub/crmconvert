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
import { Plus, Search, Download, Phone, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ContactsPage() {
  const { tenant, role } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', status: 'lead' as const, tags: '' });

  const loadContacts = () => {
    if (!tenant) return;
    let query = supabase.from('contacts').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200);
    if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    query.then(({ data }) => setContacts((data as unknown as Contact[]) ?? []));
  };

  useEffect(() => { loadContacts(); }, [tenant, search]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    const { error } = await supabase.from('contacts').insert({
      tenant_id: tenant.id,
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      status: form.status,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Contato criado!');
    setShowCreate(false);
    setForm({ name: '', phone: '', email: '', status: 'lead', tags: '' });
    loadContacts();
  };

  const exportCSV = () => {
    const headers = 'Nome,Telefone,Email,Status,Tags,Criado em\n';
    const rows = contacts.map(c => `"${c.name}","${c.phone ?? ''}","${c.email ?? ''}","${c.status}","${c.tags?.join(';') ?? ''}","${c.created_at}"`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contatos.csv';
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-xl font-bold">Contatos</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 w-64" placeholder="Buscar contatos..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />CSV</Button>
          {role !== 'readonly' && (
            <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" />Novo Contato</Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}</TableCell>
                <TableCell>{c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}</TableCell>
                <TableCell><Badge variant={c.status === 'customer' ? 'default' : 'secondary'} className="capitalize text-xs">{c.status}</Badge></TableCell>
                <TableCell><div className="flex gap-1 flex-wrap">{c.tags?.slice(0, 3).map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div></TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.source ?? '-'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd/MM/yy')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {contacts.length === 0 && <p className="text-center text-muted-foreground py-12">Nenhum contato encontrado</p>}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Contato</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+5511999999999" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="customer">Cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Tags (separadas por vírgula)</Label><Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="tag1, tag2" /></div>
            <Button type="submit" className="w-full">Criar Contato</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
