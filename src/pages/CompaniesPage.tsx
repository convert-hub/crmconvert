import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, Search, Building2, Globe, Phone, Mail, Edit, Trash2, MoreHorizontal, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Company {
  id: string;
  tenant_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export default function CompaniesPage() {
  const { tenant, role } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', industry: '', website: '', phone: '', email: '', address: '', notes: '' });

  const load = () => {
    if (!tenant) return;
    let query = supabase.from('companies').select('*').eq('tenant_id', tenant.id).order('name');
    if (search) query = query.or(`name.ilike.%${search}%,industry.ilike.%${search}%`);
    query.then(({ data }) => setCompanies((data as unknown as Company[]) ?? []));
  };

  useEffect(() => { load(); }, [tenant, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', industry: '', website: '', phone: '', email: '', address: '', notes: '' });
    setShowDialog(true);
  };

  const openEdit = (c: Company) => {
    setEditing(c);
    setForm({ name: c.name, industry: c.industry ?? '', website: c.website ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '' });
    setShowDialog(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;
    const payload = {
      name: form.name,
      industry: form.industry || null,
      website: form.website || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
    };

    if (editing) {
      const { error } = await supabase.from('companies').update(payload).eq('id', editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Empresa atualizada!');
    } else {
      const { error } = await supabase.from('companies').insert({ ...payload, tenant_id: tenant.id });
      if (error) { toast.error(error.message); return; }
      toast.success('Empresa criada!');
    }
    setShowDialog(false);
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('companies').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Empresa removida');
    load();
  };

  const isReadonly = role === 'readonly';

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Empresas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{companies.length} empresa{companies.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 w-64 rounded-xl" placeholder="Buscar empresas..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {!isReadonly && (
            <Button size="sm" onClick={openCreate} className="rounded-xl"><Plus className="h-4 w-4 mr-1" />Nova Empresa</Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map(c => (
            <Card key={c.id} className="glass-card rounded-2xl hover-lift group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{c.name}</h3>
                      {c.industry && <p className="text-xs text-muted-foreground">{c.industry}</p>}
                    </div>
                  </div>
                  {!isReadonly && (
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
                  )}
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{c.phone}</div>}
                  {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{c.email}</div>}
                  {c.website && <div className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /><a href={c.website} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{c.website}</a></div>}
                  {c.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /><span className="truncate">{c.address}</span></div>}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground">Criado em {format(new Date(c.created_at), 'dd/MM/yyyy')}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {companies.length === 0 && (
          <div className="text-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-accent/50 flex items-center justify-center mx-auto mb-4">
              <Building2 className="h-8 w-8 text-accent-foreground" />
            </div>
            <p className="text-muted-foreground font-medium">Nenhuma empresa cadastrada</p>
            <p className="text-sm text-muted-foreground mt-1">Crie a primeira empresa para organizar seus contatos</p>
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="rounded-xl" /></div>
              <div className="space-y-2"><Label>Segmento</Label><Input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Ex: Tecnologia" className="rounded-xl" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="rounded-xl" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" /></div>
            </div>
            <div className="space-y-2"><Label>Website</Label><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://" className="rounded-xl" /></div>
            <div className="space-y-2"><Label>Endereço</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="rounded-xl" /></div>
            <div className="space-y-2"><Label>Notas</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="rounded-xl" /></div>
            <Button type="submit" className="w-full rounded-xl">{editing ? 'Salvar' : 'Criar Empresa'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
