import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Brain, Zap } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type AiPipelineSettings = {
  enabled: boolean;
  mode: 'suggestion' | 'auto';
  min_confidence: number;
  exclude_won_lost: boolean;
  direction: 'forward_only' | 'any';
  model: string;
};

const DEFAULTS: AiPipelineSettings = {
  enabled: false,
  mode: 'suggestion',
  min_confidence: 0.7,
  exclude_won_lost: true,
  direction: 'forward_only',
  model: 'gpt-4.1-mini',
};

export default function AiPipelineCard() {
  const { tenant, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'manager';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<AiPipelineSettings>(DEFAULTS);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [confirmAllowTerminal, setConfirmAllowTerminal] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    supabase.from('tenants').select('settings').eq('id', tenant.id).maybeSingle().then(({ data }) => {
      const s = (data?.settings as any)?.ai_pipeline || {};
      setCfg({ ...DEFAULTS, ...s });
      setLoading(false);
    });
  }, [tenant?.id]);

  const persist = async (next: AiPipelineSettings) => {
    if (!tenant?.id) return;
    setSaving(true);
    const { data: cur } = await supabase.from('tenants').select('settings').eq('id', tenant.id).maybeSingle();
    const merged = { ...((cur?.settings as any) || {}), ai_pipeline: next };
    const { error } = await supabase.from('tenants').update({ settings: merged }).eq('id', tenant.id);
    setSaving(false);
    if (error) { toast.error('Falha ao salvar: ' + error.message); return; }
    setCfg(next);
    toast.success('Configuração salva');
  };

  const requestModeChange = (mode: 'suggestion' | 'auto') => {
    if (mode === 'auto' && cfg.mode !== 'auto') { setConfirmAuto(true); return; }
    persist({ ...cfg, mode });
  };

  const requestExcludeChange = (checked: boolean) => {
    // switch checked = "excluir terminais" (preservar). Desligar = permitir mover para terminal.
    if (!checked && cfg.exclude_won_lost) { setConfirmAllowTerminal(true); return; }
    persist({ ...cfg, exclude_won_lost: checked });
  };

  const runBackfill = async () => {
    if (!tenant?.id) return;
    setBackfilling(true);
    const { data, error } = await supabase.rpc('backfill_ai_stage_classify' as any, { _tenant_id: tenant.id });
    setBackfilling(false);
    if (error) { toast.error('Erro: ' + error.message); return; }
    const count = (data as number) ?? 0;
    if (count === 0) toast.info('Nenhuma conversa elegível encontrada.');
    else toast.success(`${count} conversas enfileiradas para classificação.`);
  };

  if (loading) return (
    <Card className="glass-card rounded-2xl"><CardContent className="py-8 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
  );

  return (
    <>
      <Card className="glass-card rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Brain className="h-4 w-4" />IA de Pipeline</CardTitle>
          <CardDescription>
            A IA lê as últimas mensagens de cada conversa e decide em qual etapa do funil o lead está.
            Começa em modo Sugestão — humano aprova antes de mover.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativar IA de Pipeline</Label>
              <p className="text-xs text-muted-foreground">Quando desligada, nenhuma classificação é feita.</p>
            </div>
            <Switch checked={cfg.enabled} disabled={!isAdmin || saving} onCheckedChange={(v) => persist({ ...cfg, enabled: v })} />
          </div>

          <div className="space-y-2">
            <Label>Modo de operação</Label>
            <RadioGroup value={cfg.mode} onValueChange={(v) => requestModeChange(v as any)} disabled={!isAdmin || saving} className="grid gap-2">
              <label className="flex items-start gap-2 rounded-xl border border-border px-3 py-2 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="suggestion" id="mode-sug" className="mt-1" />
                <div>
                  <p className="text-sm font-medium">Sugestão (recomendado)</p>
                  <p className="text-xs text-muted-foreground">A IA cria sugestões pendentes; um humano aprova ou ignora.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-border px-3 py-2 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="auto" id="mode-auto" className="mt-1" />
                <div>
                  <p className="text-sm font-medium">Automático</p>
                  <p className="text-xs text-muted-foreground">A IA move o cartão sozinha. Ainda registra motivo e permite desfazer.</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Confiança mínima</Label>
              <span className="text-sm tabular-nums text-muted-foreground">{cfg.min_confidence.toFixed(2)}</span>
            </div>
            <Slider min={0.5} max={0.95} step={0.05} value={[cfg.min_confidence]} disabled={!isAdmin || saving}
              onValueChange={(v) => setCfg({ ...cfg, min_confidence: v[0] })}
              onValueCommit={(v) => persist({ ...cfg, min_confidence: v[0] })} />
            <p className="text-xs text-muted-foreground">Sugestões abaixo desse limiar são descartadas.</p>
          </div>

          <div className="space-y-2">
            <Label>Modelo de IA</Label>
            <Select value={cfg.model} disabled={!isAdmin || saving} onValueChange={(v) => persist({ ...cfg, model: v })}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4.1-mini">GPT-4.1 Mini (rápido, recomendado)</SelectItem>
                <SelectItem value="gpt-4.1">GPT-4.1 (mais preciso)</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini (rápido)</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o (equilibrado)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Direção permitida</Label>
            <Select value={cfg.direction} disabled={!isAdmin || saving} onValueChange={(v) => persist({ ...cfg, direction: v as any })}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="forward_only">Apenas avançar (recomendado)</SelectItem>
                <SelectItem value="any">Avançar e voltar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>{cfg.exclude_won_lost ? 'Nunca mover para Ganho/Perdido' : 'Permitir mover para Ganho/Perdido'}</Label>
              <p className="text-xs text-muted-foreground">
                {cfg.exclude_won_lost
                  ? 'Etapas terminais são sempre preservadas.'
                  : 'A IA pode sugerir ou mover cartões para etapas terminais.'}
              </p>
            </div>
            <Switch
              checked={cfg.exclude_won_lost}
              disabled={!isAdmin || saving}
              onCheckedChange={requestExcludeChange}
            />
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <Label>Classificação em lote</Label>
              <p className="text-xs text-muted-foreground">Analisa todas as conversas ativas que têm oportunidade aberta e gera sugestões de etapa. Útil ao ativar a IA pela primeira vez.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-2"
              disabled={!cfg.enabled || saving || !isAdmin || backfilling}
              onClick={runBackfill}
            >
              {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Classificar conversas existentes
            </Button>
          </div>

          {!isAdmin && <p className="text-xs text-muted-foreground">Apenas admins e gerentes podem alterar essas configurações.</p>}
        </CardContent>
      </Card>

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar modo Automático?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA vai mover cartões sem confirmação. Movimentos ficam registrados e podem ser desfeitos em até 24h.
              Recomendamos manter em Sugestão até validar o comportamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmAuto(false); persist({ ...cfg, mode: 'auto' }); }}>Ativar automático</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAllowTerminal} onOpenChange={setConfirmAllowTerminal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permitir etapas terminais?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA poderá mover cartões para etapas de Ganho ou Perdido. Movimentos ficam registrados e podem ser desfeitos.
              Recomendamos manter ativado até validar o comportamento da IA.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmAllowTerminal(false); persist({ ...cfg, exclude_won_lost: false }); }}>Permitir etapas terminais</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
