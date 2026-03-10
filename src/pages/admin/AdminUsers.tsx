import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Users, Loader2, Trash2, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
}

interface MembershipRow {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  is_active: boolean;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminUsers() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);

  // assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedRole, setSelectedRole] = useState('attendant');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [pRes, mRes, tRes] = await Promise.all([
      supabase.from('profiles').select('id, user_id, full_name, phone'),
      supabase.from('tenant_memberships').select('id, user_id, tenant_id, role, is_active'),
      supabase.from('tenants').select('id, name'),
    ]);
    setProfiles(pRes.data ?? []);
    setMemberships(mRes.data ?? []);
    setTenants(tRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getUserMemberships = (userId: string) => memberships.filter(m => m.user_id === userId);
  const getTenantName = (tenantId: string) => tenants.find(t => t.id === tenantId)?.name ?? '—';

  const handleAssign = async () => {
    if (!selectedUserId || !selectedTenantId) return;
    setSaving(true);
    const { error } = await supabase.from('tenant_memberships').insert({
      user_id: selectedUserId,
      tenant_id: selectedTenantId,
      role: selectedRole as any,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Usuário vinculado à empresa!');
      setAssignOpen(false);
      setSelectedUserId('');
      setSelectedTenantId('');
      setSelectedRole('attendant');
      load();
    }
    setSaving(false);
  };

  const handleRemoveMembership = async (membershipId: string) => {
    if (!confirm('Remover este vínculo?')) return;
    const { error } = await supabase.from('tenant_memberships').delete().eq('id', membershipId);
    if (error) { toast.error(error.message); return; }
    toast.success('Vínculo removido');
    load();
  };

  const handleChangeRole = async (membershipId: string, newRole: string) => {
    const { error } = await supabase.from('tenant_memberships').update({ role: newRole as any }).eq('id', membershipId);
    if (error) { toast.error(error.message); return; }
    toast.success('Permissão atualizada!');
    load();
  };

  const openAssignFor = (userId: string) => {
    setSelectedUserId(userId);
    setAssignOpen(true);
  };

  const roleColors: Record<string, string> = {
    admin: 'bg-destructive/10 text-destructive',
    manager: 'bg-warning/10 text-warning-foreground',
    attendant: 'bg-primary/10 text-primary',
    readonly: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie usuários e vínculos com empresas</p>
      </div>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Vincular Usuário à Empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Gerente</SelectItem>
                  <SelectItem value="attendant">Atendente</SelectItem>
                  <SelectItem value="readonly">Somente Leitura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAssign} disabled={saving || !selectedTenantId} className="w-full rounded-xl gradient-primary text-white border-0">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Vincular
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : profiles.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum usuário cadastrado</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {profiles.map(p => {
            const userMemberships = getUserMemberships(p.user_id);
            const hasNoTenant = userMemberships.length === 0;
            return (
              <div key={p.id} className={`glass-card rounded-2xl p-5 hover-lift ${hasNoTenant ? 'border-warning/50 border-2' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className="h-11 w-11 rounded-full gradient-warm text-white flex items-center justify-center font-bold text-sm shadow-sm">
                    {p.full_name?.[0]?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">{p.full_name ?? 'Sem nome'}</p>
                      {hasNoTenant && (
                        <Badge variant="outline" className="text-[10px] border-warning text-warning">
                          Sem empresa
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.phone ?? 'Sem telefone'}</p>
                  </div>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => openAssignFor(p.user_id)}>
                    <UserPlus className="h-4 w-4 mr-1" /> Vincular
                  </Button>
                </div>

                {userMemberships.length > 0 && (
                  <div className="mt-3 pl-15 flex flex-wrap gap-2">
                    {userMemberships.map(m => (
                      <div key={m.id} className="flex items-center gap-2 bg-muted rounded-xl px-3 py-1.5 text-xs">
                        <span className="font-medium">{getTenantName(m.tenant_id)}</span>
                        <Select value={m.role} onValueChange={(val) => handleChangeRole(m.id, val)}>
                          <SelectTrigger className="h-6 w-auto min-w-[100px] rounded-lg text-[10px] border-0 bg-transparent p-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Gerente</SelectItem>
                            <SelectItem value="attendant">Atendente</SelectItem>
                            <SelectItem value="readonly">Somente Leitura</SelectItem>
                          </SelectContent>
                        </Select>
                        <button onClick={() => handleRemoveMembership(m.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
