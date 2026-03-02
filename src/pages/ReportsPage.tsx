import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { format, differenceInMinutes, subDays, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface StageStats { stage_name: string; count: number; total_value: number; color: string; position: number; }
interface SLAData { date: string; avg_first_response_min: number; avg_resolution_min: number; }
interface AgentStats { name: string; conversations: number; avg_response_min: number; won: number; lost: number; }

export default function ReportsPage() {
  const { tenant } = useAuth();
  const [stageStats, setStageStats] = useState<StageStats[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [totalOpps, setTotalOpps] = useState(0);
  const [wonOpps, setWonOpps] = useState(0);
  const [lostOpps, setLostOpps] = useState(0);
  const [avgQA, setAvgQA] = useState<number | null>(null);
  const [openConvs, setOpenConvs] = useState(0);
  const [slaData, setSlaData] = useState<SLAData[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [avgFirstResponse, setAvgFirstResponse] = useState<number | null>(null);
  const [avgResolution, setAvgResolution] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const tid = tenant.id;

    // KPIs
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).then(({ count }) => setTotalContacts(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).then(({ count }) => setTotalOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'won').then(({ count }) => setWonOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'lost').then(({ count }) => setLostOpps(count ?? 0));
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).neq('status', 'closed').then(({ count }) => setOpenConvs(count ?? 0));
    supabase.from('conversation_reviews').select('rating').eq('tenant_id', tid).then(({ data }) => {
      if (data && data.length > 0) { const avg = data.reduce((s, r) => s + (Number(r.rating) || 0), 0) / data.length; setAvgQA(Math.round(avg * 10) / 10); }
    });

    // Stage stats (funnel)
    supabase.from('stages').select('id, name, color, position, pipeline:pipelines!inner(is_default)').eq('tenant_id', tid).then(async ({ data: stagesData }) => {
      if (!stagesData) return;
      const defaultStages = (stagesData as any[]).filter(s => s.pipeline?.is_default);
      const stats: StageStats[] = [];
      for (const stage of defaultStages) {
        const { count } = await supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('stage_id', stage.id).eq('status', 'open');
        const { data: valData } = await supabase.from('opportunities').select('value').eq('stage_id', stage.id).eq('status', 'open');
        const totalVal = valData?.reduce((s, o) => s + (Number(o.value) || 0), 0) ?? 0;
        stats.push({ stage_name: stage.name, count: count ?? 0, total_value: totalVal, color: stage.color ?? '#6366f1', position: stage.position });
      }
      stats.sort((a, b) => a.position - b.position);
      setStageStats(stats);
    });

    // SLA metrics - analyze conversations from last 30 days
    loadSLAData(tid);
    loadAgentStats(tid);
  }, [tenant]);

  const loadSLAData = async (tid: string) => {
    const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
    
    const { data: conversations } = await supabase.from('conversations')
      .select('id, created_at, last_agent_message_at, last_customer_message_at, status, assigned_to')
      .eq('tenant_id', tid)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at');
    
    if (!conversations || conversations.length === 0) return;

    // Calculate average first response time
    const responseTimes: number[] = [];
    const resolutionTimes: number[] = [];
    const dailyMap: Record<string, { responses: number[]; resolutions: number[] }> = {};

    for (const conv of conversations) {
      const created = new Date(conv.created_at);
      const dayKey = format(created, 'dd/MM');

      if (!dailyMap[dayKey]) dailyMap[dayKey] = { responses: [], resolutions: [] };

      if (conv.last_agent_message_at) {
        const firstResp = differenceInMinutes(new Date(conv.last_agent_message_at), created);
        if (firstResp >= 0 && firstResp < 1440) { // Max 24h
          responseTimes.push(firstResp);
          dailyMap[dayKey].responses.push(firstResp);
        }
      }

      if (conv.status === 'closed' && conv.last_agent_message_at) {
        const resolution = differenceInMinutes(new Date(conv.last_agent_message_at), created);
        if (resolution >= 0) {
          resolutionTimes.push(resolution);
          dailyMap[dayKey].resolutions.push(resolution);
        }
      }
    }

    if (responseTimes.length > 0) {
      setAvgFirstResponse(Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length));
    }
    if (resolutionTimes.length > 0) {
      setAvgResolution(Math.round(resolutionTimes.reduce((s, v) => s + v, 0) / resolutionTimes.length));
    }

    const slaArr: SLAData[] = Object.entries(dailyMap).map(([date, d]) => ({
      date,
      avg_first_response_min: d.responses.length > 0 ? Math.round(d.responses.reduce((s, v) => s + v, 0) / d.responses.length) : 0,
      avg_resolution_min: d.resolutions.length > 0 ? Math.round(d.resolutions.reduce((s, v) => s + v, 0) / d.resolutions.length) : 0,
    }));
    setSlaData(slaArr.slice(-14)); // Last 14 days
  };

  const loadAgentStats = async (tid: string) => {
    const { data: members } = await supabase.from('tenant_memberships')
      .select('id, user_id, profile:profiles(full_name)')
      .eq('tenant_id', tid)
      .eq('is_active', true);
    
    if (!members) return;

    const stats: AgentStats[] = [];
    for (const m of members as any[]) {
      const name = m.profile?.full_name || m.user_id.slice(0, 8);
      const { count: convCount } = await supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('assigned_to', m.id);
      const { count: wonCount } = await supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('assigned_to', m.id).eq('status', 'won');
      const { count: lostCount } = await supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('assigned_to', m.id).eq('status', 'lost');
      
      stats.push({
        name,
        conversations: convCount ?? 0,
        avg_response_min: 0, // Would need deeper query
        won: wonCount ?? 0,
        lost: lostCount ?? 0,
      });
    }
    setAgentStats(stats.filter(s => s.conversations > 0 || s.won > 0));
  };

  const conversionRate = totalOpps > 0 ? Math.round((wonOpps / totalOpps) * 100) : 0;

  const kpis = [
    { label: 'Contatos', value: totalContacts, color: 'text-foreground' },
    { label: 'Oportunidades', value: totalOpps, color: 'text-foreground' },
    { label: 'Ganhas', value: wonOpps, color: 'text-success' },
    { label: 'Perdidas', value: lostOpps, color: 'text-destructive' },
    { label: 'Conversão', value: `${conversionRate}%`, color: 'text-primary' },
    { label: 'QA Média', value: avgQA ?? '—', color: 'text-foreground' },
  ];

  const funnelData = stageStats.map(s => ({
    name: s.stage_name,
    value: s.count,
    fill: s.color,
  }));

  const formatMinutes = (min: number | null) => {
    if (min === null) return '—';
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h${m > 0 ? `${m}m` : ''}`;
  };

  return (
    <div className="p-6 max-w-6xl space-y-6 bg-background">
      <h1 className="text-xl font-bold text-foreground">Relatórios</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="glass-card rounded-2xl hover-lift">
            <CardContent className="pt-5 pb-4 text-center">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{k.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="pipeline" className="space-y-4">
        <TabsList className="rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="pipeline" className="rounded-lg">Pipeline</TabsTrigger>
          <TabsTrigger value="funnel" className="rounded-lg">Funil</TabsTrigger>
          <TabsTrigger value="sla" className="rounded-lg">SLA</TabsTrigger>
          <TabsTrigger value="agents" className="rounded-lg">Atendentes</TabsTrigger>
        </TabsList>

        {/* Pipeline Charts */}
        <TabsContent value="pipeline" className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="glass-card rounded-2xl">
              <CardHeader><CardTitle className="text-base">Oportunidades por Etapa</CardTitle></CardHeader>
              <CardContent>
                {stageStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={stageStats}>
                      <XAxis dataKey="stage_name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
                      <Bar dataKey="count" name="Quantidade" radius={[6, 6, 0, 0]}>{stageStats.map((s, i) => <Cell key={i} fill={s.color} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados</p>}
              </CardContent>
            </Card>

            <Card className="glass-card rounded-2xl">
              <CardHeader><CardTitle className="text-base">Valor por Etapa</CardTitle></CardHeader>
              <CardContent>
                {stageStats.filter(s => s.total_value > 0).length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={stageStats.filter(s => s.total_value > 0)} dataKey="total_value" nameKey="stage_name" cx="50%" cy="50%" outerRadius={100} label={({ stage_name, total_value }) => `${stage_name}: R$${total_value.toLocaleString('pt-BR')}`}>
                        {stageStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `R$ ${v.toLocaleString('pt-BR')}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de valor</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Funnel */}
        <TabsContent value="funnel" className="space-y-6">
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle className="text-base">Funil de Conversão</CardTitle></CardHeader>
            <CardContent>
              {funnelData.length > 0 ? (
                <div className="space-y-2">
                  {stageStats.map((stage, i) => {
                    const maxCount = Math.max(...stageStats.map(s => s.count), 1);
                    const widthPct = Math.max((stage.count / maxCount) * 100, 8);
                    const prevCount = i > 0 ? stageStats[i - 1].count : stage.count;
                    const dropRate = prevCount > 0 && i > 0 ? Math.round(((prevCount - stage.count) / prevCount) * 100) : 0;
                    return (
                      <div key={stage.stage_name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{stage.stage_name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{stage.count} oportunidades</span>
                            {i > 0 && dropRate > 0 && (
                              <Badge variant="outline" className="text-[10px] rounded-full text-destructive border-destructive/30">
                                −{dropRate}%
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="h-8 rounded-lg overflow-hidden bg-muted/30">
                          <div
                            className="h-full rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
                            style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                          >
                            <span className="text-[10px] font-bold text-white drop-shadow">{stage.count}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Overall conversion */}
                  <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Taxa de conversão geral</span>
                    <Badge className="text-lg px-3 py-1 rounded-full gradient-primary text-white">{conversionRate}%</Badge>
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de funil</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SLA */}
        <TabsContent value="sla" className="space-y-6">
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="glass-card rounded-2xl">
              <CardContent className="pt-5 pb-4 text-center">
                <p className="text-2xl font-bold text-primary">{formatMinutes(avgFirstResponse)}</p>
                <p className="text-xs text-muted-foreground mt-1">Tempo médio 1ª resposta</p>
              </CardContent>
            </Card>
            <Card className="glass-card rounded-2xl">
              <CardContent className="pt-5 pb-4 text-center">
                <p className="text-2xl font-bold text-foreground">{formatMinutes(avgResolution)}</p>
                <p className="text-xs text-muted-foreground mt-1">Tempo médio resolução</p>
              </CardContent>
            </Card>
            <Card className="glass-card rounded-2xl">
              <CardContent className="pt-5 pb-4 text-center">
                <Badge className="text-lg px-3 py-1 rounded-full gradient-primary text-white">{openConvs}</Badge>
                <p className="text-xs text-muted-foreground mt-2">Conversas abertas agora</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle className="text-base">SLA — Tempo de Resposta (últimos 14 dias)</CardTitle></CardHeader>
            <CardContent>
              {slaData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={slaData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} label={{ value: 'minutos', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                    <Tooltip formatter={(v: number) => `${v} min`} />
                    <Legend />
                    <Line type="monotone" dataKey="avg_first_response_min" name="1ª Resposta" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="avg_resolution_min" name="Resolução" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de SLA</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents */}
        <TabsContent value="agents" className="space-y-6">
          <Card className="glass-card rounded-2xl">
            <CardHeader><CardTitle className="text-base">Performance por Atendente</CardTitle></CardHeader>
            <CardContent>
              {agentStats.length > 0 ? (
                <div className="space-y-3">
                  {agentStats.map(agent => {
                    const total = agent.won + agent.lost;
                    const winRate = total > 0 ? Math.round((agent.won / total) * 100) : 0;
                    return (
                      <div key={agent.name} className="rounded-xl border border-border/50 p-4 bg-card/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{agent.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px] rounded-full">{agent.conversations} conversas</Badge>
                            {total > 0 && (
                              <Badge variant={winRate >= 50 ? 'default' : 'outline'} className="text-[10px] rounded-full">
                                {winRate}% win rate
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span className="text-success">✓ {agent.won} ganhas</span>
                          <span className="text-destructive">✗ {agent.lost} perdidas</span>
                        </div>
                        {total > 0 && (
                          <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${winRate}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados de atendentes</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
