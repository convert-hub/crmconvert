import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Building2, Loader2, Trash2, Edit2 } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  _member_count?: number;
}

export default function AdminTenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('tenants').select('id, name, slug, created_at');
    if (data) {
      // Get member counts
      const { data: memberships } = await supabase.from('tenant_memberships').select('tenant_id');
      const counts: Record<string, number> = {};
      memberships?.forEach(m => { counts[m.tenant_id] = (counts[m.tenant_id] || 0) + 1; });
      setTenants(data.map(t => ({ ...t, _member_count: counts[t.id] || 0 })));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const tenantId = crypto.randomUUID();
    
    const { error } = await supabase.from('tenants').insert({ id: tenantId, name, slug });
    if (error) { toast.error(error.message); setSaving(false); return; }

    // Create default pipeline
    const pipelineId = crypto.randomUUID();
    await supabase.from('pipelines').insert({ id: pipelineId, tenant_id: tenantId, name: 'Pipeline Principal', is_default: true, position: 0 });
    const stages = [
      { name: 'Novo Lead', position: 0, color: '#6366f1' },
      { name: 'Contato Feito', position: 1, color: '#8b5cf6' },
      { name: 'Qualificado', position: 2, color: '#f59e0b' },
      { name: 'Proposta Enviada', position: 3, color: '#3b82f6' },
      { name: 'Negociação', position: 4, color: '#ef4444' },
      { name: 'Fechado Ganho', position: 5, color: '#22c55e', is_won: true },
      { name: 'Perdido', position: 6, color: '#94a3b8', is_lost: true },
    ];
    await supabase.from('stages').insert(stages.map(s => ({ ...s, tenant_id: tenantId, pipeline_id: pipelineId })));

    toast.success('Empresa criada!');
    setName('');
    setOpen(false);
    setSaving(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza? Todos os dados desta empresa serão perdidos.')) return;
    const { error, count } = await supabase.from('tenants').delete({ count: 'exact' }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (count === 0) { toast.error('Não foi possível remover a empresa. Verifique se não há dados vinculados.'); return; }
    toast.success('Empresa removida');
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Empresas (Tenants)</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie todas as empresas do sistema</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gradient-primary text-white border-0">
              <Plus className="h-4 w-4 mr-2" /> Nova Empresa
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>Criar Nova Empresa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Empresa ABC" className="rounded-xl" />
              </div>
              <Button onClick={handleCreate} disabled={saving} className="w-full rounded-xl gradient-primary text-white border-0">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar Empresa
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : tenants.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhuma empresa cadastrada</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {tenants.map(t => (
            <div key={t.id} className="glass-card rounded-2xl p-5 flex items-center gap-4 hover-lift">
              <div className="h-12 w-12 rounded-xl gradient-primary text-white flex items-center justify-center font-bold text-lg shadow-md">
                {t.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">Slug: {t.slug} · {t._member_count} membro(s) · Criado em {new Date(t.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
              <Button variant="ghost" size="icon" className="rounded-xl text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
