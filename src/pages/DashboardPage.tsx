import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Target, MessageSquare, TrendingUp, ArrowUpRight, ArrowDownRight, Calendar, BarChart3, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { tenant, profile } = useAuth();
  const [stats, setStats] = useState({ contacts: 0, opportunities: 0, conversations: 0, totalValue: 0, inactive: 0 });

  useEffect(() => {
    if (!tenant) return;
    Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      supabase.from('opportunities').select('id, value, stage_id, updated_at').eq('tenant_id', tenant.id).eq('status', 'open'),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'open'),
      supabase.from('stages').select('id, inactivity_minutes').eq('tenant_id', tenant.id).gt('inactivity_minutes', 0),
    ]).then(([cRes, oRes, convRes, stagesRes]) => {
      const opps = (oRes.data ?? []) as unknown as { id: string; value: number; stage_id: string; updated_at: string }[];
      const stagesMap = new Map<string, number>();
      for (const s of (stagesRes.data ?? []) as unknown as { id: string; inactivity_minutes: number }[]) {
        stagesMap.set(s.id, s.inactivity_minutes);
      }
      const now = Date.now();
      const inactiveCount = opps.filter(o => {
        const mins = stagesMap.get(o.stage_id);
        if (!mins) return false;
        return new Date(o.updated_at).getTime() < now - mins * 60 * 1000;
      }).length;
      setStats({
        contacts: cRes.count ?? 0,
        opportunities: opps.length,
        conversations: convRes.count ?? 0,
        totalValue: opps.reduce((s, o) => s + (o.value || 0), 0),
        inactive: inactiveCount,
      });
    });
  }, [tenant]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Usuário';

  const cards = [
    { title: 'Contatos', value: stats.contacts, icon: Users, trend: '+12%', up: true },
    { title: 'Oportunidades', value: stats.opportunities, icon: Target, trend: '+8%', up: true },
    { title: 'Conversas Abertas', value: stats.conversations, icon: MessageSquare, trend: '-3%', up: false },
    { title: 'Pipeline', value: `R$ ${stats.totalValue.toLocaleString('pt-BR')}`, icon: TrendingUp, trend: '+22%', up: true },
    { title: 'Oport. Inativas', value: stats.inactive, icon: AlertTriangle, trend: stats.inactive > 0 ? `${stats.inactive} pendente${stats.inactive !== 1 ? 's' : ''}` : 'Nenhuma', up: false, isAlert: stats.inactive > 0 },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight">
          Olá, {firstName}!
        </h1>
        <p className="text-muted-foreground mt-1">
          Aqui está o resumo do seu workspace.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(c => (
          <Card key={c.title} className={cn("hover-lift border-border/50 shadow-sm", (c as any).isAlert && "border-destructive/50 bg-destructive/5")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", (c as any).isAlert ? "bg-destructive/10" : "bg-accent")}>
                <c.icon className={cn("h-[18px] w-[18px]", (c as any).isAlert ? "text-destructive" : "text-accent-foreground")} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-extrabold", (c as any).isAlert && "text-destructive")}>{c.value}</div>
              <div className="flex items-center gap-1 mt-1">
                {(c as any).isAlert ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                ) : c.up ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className={cn(
                  "text-xs font-semibold",
                  (c as any).isAlert ? "text-destructive" : c.up ? "text-success" : "text-destructive"
                )}>
                  {c.trend}
                </span>
                {!(c as any).isAlert && <span className="text-xs text-muted-foreground ml-1">vs semana anterior</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Grid de widgets */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Banner CTA */}
        <Card className="lg:col-span-2 overflow-hidden border-0 gradient-primary text-white shadow-lg shadow-primary/20">
          <CardContent className="p-6 flex items-center justify-between min-h-[160px]">
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Maximize sua produtividade</h3>
              <p className="text-white/80 text-sm max-w-sm">
                Configure automações e IA para qualificar leads automaticamente e fechar mais negócios.
              </p>
              <button className="mt-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition-colors backdrop-blur-sm">
                Explorar Automações →
              </button>
            </div>
            <div className="hidden sm:flex items-center justify-center">
              <div className="w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <BarChart3 className="h-12 w-12 text-white/70" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mini Calendar placeholder */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Agenda</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { title: 'Follow-up com lead', time: '09:30' },
              { title: 'Reunião de equipe', time: '14:00' },
              { title: 'Demo do produto', time: '16:30' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-accent/50 hover:bg-accent transition-colors">
                <div className="w-1 h-8 rounded-full gradient-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
