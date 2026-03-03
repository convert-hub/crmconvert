import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Target, MessageSquare, TrendingUp, ArrowUpRight, ArrowDownRight, Calendar, BarChart3, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface UpcomingActivity {
  id: string;
  title: string;
  due_date: string;
  type: string;
}

export default function DashboardPage() {
  const { tenant, profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ contacts: 0, opportunities: 0, conversations: 0, totalValue: 0, inactive: 0 });
  const [activities, setActivities] = useState<UpcomingActivity[]>([]);

  useEffect(() => {
    if (!tenant) return;

    // Fetch stats
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

    // Fetch upcoming activities (separate call)
    supabase.from('activities').select('id, title, due_date, type')
      .eq('tenant_id', tenant.id)
      .eq('is_completed', false)
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
      .limit(5)
      .then(({ data }) => setActivities((data as unknown as UpcomingActivity[]) ?? []));
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
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {firstName}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Aqui está o resumo do seu workspace.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(c => (
          <Card key={c.title} className={cn(
            "hover-lift border-border/60",
            (c as any).isAlert && "border-destructive/30"
          )}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{c.title}</CardTitle>
              <c.icon className={cn(
                "h-4 w-4",
                (c as any).isAlert ? "text-destructive/70" : "text-muted-foreground/50"
              )} strokeWidth={1.5} />
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-semibold", (c as any).isAlert && "text-destructive")}>{c.value}</div>
              <div className="flex items-center gap-1 mt-1.5">
                {(c as any).isAlert ? (
                  <AlertTriangle className="h-3 w-3 text-destructive/70" />
                ) : c.up ? (
                  <ArrowUpRight className="h-3 w-3 text-success" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-destructive/70" />
                )}
                <span className={cn(
                  "text-xs font-medium",
                  (c as any).isAlert ? "text-destructive/70" : c.up ? "text-success" : "text-destructive/70"
                )}>
                  {c.trend}
                </span>
                {!(c as any).isAlert && <span className="text-[11px] text-muted-foreground ml-1">vs anterior</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Grid de widgets */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Banner CTA */}
        <Card className="lg:col-span-2 overflow-hidden border-0 bg-primary text-primary-foreground">
          <CardContent className="p-6 flex items-center justify-between min-h-[150px]">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Maximize sua produtividade</h3>
              <p className="text-primary-foreground/70 text-sm max-w-sm">
                Configure automações e IA para qualificar leads automaticamente e fechar mais negócios.
              </p>
              <button className="mt-2 px-4 py-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 rounded-lg text-sm font-medium transition-colors">
                Explorar Automações →
              </button>
            </div>
            <div className="hidden sm:flex items-center justify-center">
              <BarChart3 className="h-16 w-16 text-primary-foreground/20" strokeWidth={1} />
            </div>
          </CardContent>
        </Card>

        {/* Mini Calendar placeholder */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Agenda</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {activities.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">Nenhuma atividade agendada</p>
            )}
            {activities.map((item) => (
              <div key={item.id} onClick={() => navigate('/activities')}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent transition-colors cursor-pointer">
                <div className="w-0.5 h-7 rounded-full bg-primary/40" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground">{format(new Date(item.due_date), 'dd/MM · HH:mm')}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
