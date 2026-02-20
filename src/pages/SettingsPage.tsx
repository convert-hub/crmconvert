import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { tenant } = useAuth();
  const [tenantName, setTenantName] = useState(tenant?.name ?? '');

  const saveTenant = async () => {
    if (!tenant) return;
    const { error } = await supabase.from('tenants').update({ name: tenantName }).eq('id', tenant.id);
    if (error) toast.error(error.message);
    else toast.success('Salvo!');
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Configurações</h1>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="team">Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Dados da Empresa</CardTitle>
              <CardDescription>Informações básicas do seu tenant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input value={tenantName} onChange={e => setTenantName(e.target.value)} />
              </div>
              <Button onClick={saveTenant}>Salvar</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp (UAZAPI)</CardTitle>
              <CardDescription>Configure sua instância WhatsApp</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Configure na seção de integrações do admin.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>URLs de webhook para formulários e Facebook Lead Ads</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><strong>Webhook genérico:</strong> <code className="bg-muted px-2 py-0.5 rounded text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-form-intake`}</code></p>
              <p><strong>Facebook Lead Ads:</strong> <code className="bg-muted px-2 py-0.5 rounded text-xs">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-meta-leads`}</code></p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Equipe</CardTitle>
              <CardDescription>Gerencie membros do seu tenant</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Gestão de equipe será expandida em breve.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
