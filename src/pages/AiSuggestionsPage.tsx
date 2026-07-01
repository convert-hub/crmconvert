import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Brain, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type Suggestion = {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  confidence_score: number | null;
  ai_reason: string | null;
  criteria_met: any;
  created_at: string;
  opp?: { title: string; contact?: { name: string | null } | null };
  from_stage?: { name: string; color: string | null } | null;
  to_stage?: { name: string; color: string | null } | null;
};

export default function AiSuggestionsPage() {
  const { tenant, role, membership } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const canAct = role === 'admin' || role === 'manager' || role === 'attendant';

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('stage_moves')
      .select('id,tenant_id,opportunity_id,from_stage_id,to_stage_id,confidence_score,ai_reason,criteria_met,created_at, opp:opportunities!inner(title, contact:contacts(name)), from_stage:stages!stage_moves_from_stage_id_fkey(name,color), to_stage:stages!stage_moves_to_stage_id_fkey(name,color)')
      .eq('tenant_id', tenant.id)
      .eq('status', 'suggested')
      .order('created_at', { ascending: false })
      .limit(200);
    setItems((data as any) || []);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const approve = async (s: Suggestion) => {
    if (!canAct || !membership?.id) return;
    setBusy(s.id);
    try {
      // Revalidate current stage
      const { data: opp } = await supabase.from('opportunities').select('stage_id').eq('id', s.opportunity_id).maybeSingle();
      if (!opp) { toast.error('Oportunidade não encontrada'); return; }

      if (opp.stage_id !== s.from_stage_id) {
        await supabase.from('stage_moves').update({
          status: 'rejected',
          resolved_by: membership.id,
          resolved_at: new Date().toISOString(),
          ai_reason: (s.ai_reason || '') + ' [auto-rejeitada: cartão já mudou de etapa]',
        }).eq('id', s.id);
        toast.info('Sugestão descartada — o cartão já mudou de etapa.');
        await load();
        return;
      }

      const { error: updErr } = await supabase.from('opportunities')
        .update({ stage_id: s.to_stage_id, updated_at: new Date().toISOString() })
        .eq('id', s.opportunity_id);
      if (updErr) { toast.error('Falha ao mover: ' + updErr.message); return; }

      // Register applied AI move (from suggestion → applied)
      await supabase.from('stage_moves').update({
        status: 'applied',
        resolved_by: membership.id,
        resolved_at: new Date().toISOString(),
      }).eq('id', s.id);

      toast.success('Sugestão aplicada.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const ignore = async (s: Suggestion) => {
    if (!canAct || !membership?.id) return;
    setBusy(s.id);
    try {
      const { error } = await supabase.from('stage_moves').update({
        status: 'rejected',
        resolved_by: membership.id,
        resolved_at: new Date().toISOString(),
      }).eq('id', s.id);
      if (error) toast.error(error.message);
      else { toast.success('Sugestão ignorada.'); await load(); }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Sugestões da IA</h1>
        {items.length > 0 && <Badge variant="secondary" className="rounded-full">{items.length}</Badge>}
      </div>

      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <Card className="glass-card rounded-2xl">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma sugestão pendente no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <Card key={s.id} className="glass-card rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <button className="hover:underline text-left" onClick={() => navigate(`/pipeline?opportunity=${s.opportunity_id}`)}>
                    {(s.opp?.contact?.name || s.opp?.title || 'Oportunidade')}
                  </button>
                  <Badge variant="outline" className="rounded-full text-xs">
                    {s.confidence_score != null ? `${Math.round(s.confidence_score * 100)}%` : '—'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <StagePill stage={s.from_stage} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <StagePill stage={s.to_stage} />
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                {s.ai_reason && <p className="text-sm text-muted-foreground">{s.ai_reason}</p>}
                {Array.isArray(s.criteria_met) && s.criteria_met.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                    {s.criteria_met.slice(0, 4).map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                )}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="rounded-xl" disabled={!canAct || busy === s.id} onClick={() => approve(s)}>
                    <Check className="h-4 w-4 mr-1" />Aprovar
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" disabled={!canAct || busy === s.id} onClick={() => ignore(s)}>
                    <X className="h-4 w-4 mr-1" />Ignorar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StagePill({ stage }: { stage?: { name: string; color: string | null } | null }) {
  if (!stage) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color || '#6366f1' }} />
      {stage.name}
    </span>
  );
}
