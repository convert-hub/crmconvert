import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Target, MessageSquare, TrendingUp } from 'lucide-react';

export default function DashboardPage() {
  const { tenant } = useAuth();
  const [stats, setStats] = useState({ contacts: 0, opportunities: 0, conversations: 0, totalValue: 0 });

  useEffect(() => {
    if (!tenant) return;
    Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('opportunities').select('id, value').eq('tenant_id', tenant.id).eq('status', 'open'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'open'),
    ]).then(([cRes, oRes, convRes]) => {
      const opps = (oRes.data ?? []) as unknown as { id: string; value: number }[];
      setStats({
        contacts: cRes.count ?? 0,
        opportunities: opps.length,
        conversations: convRes.count ?? 0,
        totalValue: opps.reduce((s, o) => s + (o.value || 0), 0),
      });
    });
  }, [tenant]);

  const cards = [
    { title: 'Contatos', value: stats.contacts, icon: Users, color: 'text-info' },
    { title: 'Oportunidades Abertas', value: stats.opportunities, icon: Target, color: 'text-warning' },
    { title: 'Conversas Abertas', value: stats.conversations, icon: MessageSquare, color: 'text-success' },
    { title: 'Valor no Pipeline', value: `R$ ${stats.totalValue.toLocaleString('pt-BR')}`, icon: TrendingUp, color: 'text-primary' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(c => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className={cn("h-5 w-5", c.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}
