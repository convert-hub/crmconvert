import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tenantName, setTenantName] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const tenantId = crypto.randomUUID();

    // Create tenant (no .select() — SELECT policy requires membership which doesn't exist yet)
    const { error: tErr } = await supabase
      .from('tenants')
      .insert({ id: tenantId, name: tenantName, slug });

    if (tErr) {
      toast.error('Erro ao criar empresa: ' + tErr.message);
      setLoading(false);
      return;
    }

    // Create admin membership
    const { error: mErr } = await supabase
      .from('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: user.id, role: 'admin' });

    if (mErr) {
      toast.error('Erro ao criar membership: ' + mErr.message);
      setLoading(false);
      return;
    }

    // Create default pipeline (now user is a member, so .select() works)
    const pipelineId = crypto.randomUUID();
    const { error: pErr } = await supabase
      .from('pipelines')
      .insert({ id: pipelineId, tenant_id: tenantId, name: 'Pipeline Principal', is_default: true, position: 0 });

    if (!pErr) {
      const stages = [
        { name: 'Novo Lead', position: 0, color: '#6366f1' },
        { name: 'Contato Feito', position: 1, color: '#8b5cf6' },
        { name: 'Qualificado', position: 2, color: '#f59e0b' },
        { name: 'Proposta Enviada', position: 3, color: '#3b82f6' },
        { name: 'Negociação', position: 4, color: '#ef4444' },
        { name: 'Fechado Ganho', position: 5, color: '#22c55e', is_won: true },
        { name: 'Perdido', position: 6, color: '#94a3b8', is_lost: true },
      ];
      await supabase.from('stages').insert(
        stages.map(s => ({ ...s, tenant_id: tenantId, pipeline_id: pipelineId }))
      );
    }

    toast.success('Empresa criada com sucesso!');
    // Reload to pick up new membership
    window.location.href = '/pipeline';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Criar sua Empresa</CardTitle>
          <CardDescription>Configure seu CRM para começar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Empresa</Label>
              <Input value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Minha Empresa" required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar e Começar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
