import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface StageStats { stage_name: string; count: number; total_value: number; color: string; }

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
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).then(({ count }) => setTotalContacts(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).then(({ count }) => setTotalOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'won').then(({ count }) => setWonOpps(count ?? 0));
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'lost').then(({ count }) => setLostOpps(count ?? 0));
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).neq('status', 'closed').then(({ count }) => setOpenConvs(count ?? 0));
    supabase.from('conversation_reviews').select('rating').eq('tenant_id', tid).then(({ data }) => {
      if (data && data.length > 0) { const avg = data.reduce((s, r) => s + (Number(r.rating) || 0), 0) / data.length; setAvgQA(Math.round(avg * 10) / 10); }
    });
    supabase.from('stages').select('id, name, color, pipeline:pipelines!inner(is_default)').eq('tenant_id', tid).then(async ({ data: stagesData }) => {
      if (!stagesData) return;
      const defaultStages = (stagesData as any[]).filter(s => s.pipeline?.is_default);
      const stats: StageStats[] = [];
      for (const stage of defaultStages) {
        const { count } = await supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('stage_id', stage.id).eq('status', 'open');
        const { data: valData } = await supabase.from('opportunities').select('value').eq('stage_id', stage.id).eq('status', 'open');
        const totalVal = valData?.reduce((s, o) => s + (Number(o.value) || 0), 0) ?? 0;
        stats.push({ stage_name: stage.name, count: count ?? 0, total_value: totalVal, color: stage.color ?? '#6366f1' });
      }
      setStageStats(stats);
    });
  }, [tenant]);

  const conversionRate = totalOpps > 0 ? Math.round((wonOpps / totalOpps) * 100) : 0;

  const kpis = [
    { label: 'Contatos', value: totalContacts, color: 'text-foreground' },
    { label: 'Oportunidades', value: totalOpps, color: 'text-foreground' },
    { label: 'Ganhas', value: wonOpps, color: 'text-success' },
    { label: 'Perdidas', value: lostOpps, color: 'text-destructive' },
    { label: 'Conversão', value: `${conversionRate}%`, color: 'text-primary' },
    { label: 'QA Média', value: avgQA ?? '—', color: 'text-foreground' },
  ];

  return (
    <div className="p-6 max-w-6xl space-y-6 bg-background">
      <h1 className="text-xl font-bold text-foreground">Relatórios</h1>

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

      <Card className="glass-card rounded-2xl">
        <CardContent className="py-4 flex items-center gap-4">
          <Badge className="text-lg px-3 py-1 rounded-full gradient-primary text-white">{openConvs}</Badge>
          <span className="text-sm text-foreground">Conversas abertas no momento</span>
        </CardContent>
      </Card>
    </div>
  );
}
