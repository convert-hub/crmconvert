import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

interface StageStats {
  stage_name: string;
  count: number;
  total_value: number;
  color: string;
}

export default function ReportsPage() {
  const { tenant } = useAuth();
  const [stageStats, setStageStats] = useState<StageStats[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [totalOpps, setTotalOpps] = useState(0);
  const [wonOpps, setWonOpps] = useState(0);
  const [lostOpps, setLostOpps] = useState(0);
  const [avgQA, setAvgQA] = useState<number | null>(null);
  const [openConvs, setOpenConvs] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    const tid = tenant.id;

    // Contacts count
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tid)
      .then(({ count }) => setTotalContacts(count ?? 0));

    // Opportunities counts
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid)
      .then(({ count }) => setTotalOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'won')
      .then(({ count }) => setWonOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'lost')
      .then(({ count }) => setLostOpps(count ?? 0));

    // Open conversations
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).neq('status', 'closed')
      .then(({ count }) => setOpenConvs(count ?? 0));

    // QA average
    supabase.from('conversation_reviews').select('rating').eq('tenant_id', tid)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const avg = data.reduce((s, r) => s + (Number(r.rating) || 0), 0) / data.length;
          setAvgQA(Math.round(avg * 10) / 10);
        }
      });

    // Stage breakdown
    supabase.from('stages').select('id, name, color, pipeline:pipelines!inner(is_default)').eq('tenant_id', tid)
      .then(async ({ data: stagesData }) => {
        if (!stagesData) return;
        const defaultStages = (stagesData as any[]).filter(s => s.pipeline?.is_default);
        const stats: StageStats[] = [];
        for (const stage of defaultStages) {
          const { count } = await supabase.from('opportunities').select('id', { count: 'exact', head: true })
            .eq('stage_id', stage.id).eq('status', 'open');
          const { data: valData } = await supabase.from('opportunities').select('value')
            .eq('stage_id', stage.id).eq('status', 'open');
          const totalVal = valData?.reduce((s, o) => s + (Number(o.value) || 0), 0) ?? 0;
          stats.push({ stage_name: stage.name, count: count ?? 0, total_value: totalVal, color: stage.color ?? '#6366f1' });
        }
        setStageStats(stats);
      });
  }, [tenant]);

  const conversionRate = totalOpps > 0 ? Math.round((wonOpps / totalOpps) * 100) : 0;

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Relatórios</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{totalContacts}</p>
          <p className="text-xs text-muted-foreground">Contatos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{totalOpps}</p>
          <p className="text-xs text-muted-foreground">Oportunidades</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-success">{wonOpps}</p>
          <p className="text-xs text-muted-foreground">Ganhas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-destructive">{lostOpps}</p>
          <p className="text-xs text-muted-foreground">Perdidas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{conversionRate}%</p>
          <p className="text-xs text-muted-foreground">Conversão</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{avgQA ?? '—'}</p>
          <p className="text-xs text-muted-foreground">QA Média</p>
        </CardContent></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Stage bar chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">Oportunidades por Etapa</CardTitle></CardHeader>
          <CardContent>
            {stageStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stageStats}>
                  <XAxis dataKey="stage_name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Quantidade">
                    {stageStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center py-12">Sem dados</p>}
          </CardContent>
        </Card>

        {/* Value pie chart */}
        <Card>
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

      {/* Open conversations */}
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <Badge className="text-lg px-3 py-1">{openConvs}</Badge>
          <span className="text-sm">Conversas abertas no momento</span>
        </CardContent>
      </Card>
    </div>
  );
}
