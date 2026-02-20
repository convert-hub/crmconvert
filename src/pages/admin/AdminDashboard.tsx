import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Users, MessageSquare, Zap } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ tenants: 0, users: 0, conversations: 0, whatsappInstances: 0 });

  useEffect(() => {
    const load = async () => {
      const [t, p, c, w] = await Promise.all([
        supabase.from('tenants').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase.from('whatsapp_instances').select('id', { count: 'exact', head: true }),
      ]);
      setStats({
        tenants: t.count ?? 0,
        users: p.count ?? 0,
        conversations: c.count ?? 0,
        whatsappInstances: w.count ?? 0,
      });
    };
    load();
  }, []);

  const cards = [
    { label: 'Empresas', value: stats.tenants, icon: Building2, color: 'text-primary' },
    { label: 'Usuários', value: stats.users, icon: Users, color: 'text-info' },
    { label: 'Conversas', value: stats.conversations, icon: MessageSquare, color: 'text-success' },
    { label: 'WhatsApp Instances', value: stats.whatsappInstances, icon: Zap, color: 'text-warning' },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Painel SaaS Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral do sistema</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map(c => (
          <div key={c.label} className="glass-card rounded-2xl p-6 hover-lift">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{c.value}</p>
              </div>
              <div className={`h-12 w-12 rounded-xl bg-muted flex items-center justify-center ${c.color}`}>
                <c.icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
