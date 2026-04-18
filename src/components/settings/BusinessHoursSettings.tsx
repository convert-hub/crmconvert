import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Clock, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta',
  fri: 'Sexta', sat: 'Sábado', sun: 'Domingo',
};

const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'São Paulo (UTC-3)' },
  { value: 'America/Belem', label: 'Belém (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (UTC-3)' },
  { value: 'America/Recife', label: 'Recife (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus (UTC-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (UTC-5)' },
  { value: 'America/Noronha', label: 'Noronha (UTC-2)' },
];

type DayState = { open: boolean; start: string; end: string };

const defaultDays = (): Record<DayKey, DayState> => ({
  mon: { open: true, start: '09:00', end: '18:00' },
  tue: { open: true, start: '09:00', end: '18:00' },
  wed: { open: true, start: '09:00', end: '18:00' },
  thu: { open: true, start: '09:00', end: '18:00' },
  fri: { open: true, start: '09:00', end: '18:00' },
  sat: { open: false, start: '09:00', end: '13:00' },
  sun: { open: false, start: '09:00', end: '13:00' },
});

export default function BusinessHoursSettings() {
  const { tenant, role, refreshTenant } = useAuth();
  const [timezone, setTimezone] = useState<string>('America/Sao_Paulo');
  const [days, setDays] = useState<Record<DayKey, DayState>>(defaultDays());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('tenants')
        .select('business_hours, timezone')
        .eq('id', tenant.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error('Erro ao carregar horários: ' + error.message);
        setLoading(false);
        return;
      }
      setTimezone(data?.timezone || 'America/Sao_Paulo');
      const bh = (data?.business_hours as Record<string, { start?: string; end?: string }>) || {};
      const next = defaultDays();
      for (const k of DAY_ORDER) {
        const entry = bh[k];
        if (entry?.start && entry?.end) {
          next[k] = { open: true, start: entry.start, end: entry.end };
        } else {
          next[k] = { ...next[k], open: false };
        }
      }
      setDays(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  // Refresh status indicator every 30s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const status = useMemo(() => {
    try {
      const now = new Date();
      const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
      const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
      const dayKey = dayFmt.format(now).toLowerCase().slice(0, 3) as DayKey;
      // Intl returns "24" for midnight in some envs; normalize
      const currentTime = timeFmt.format(now).replace('24:', '00:');
      const today = days[dayKey];
      const inside = !!(today?.open && currentTime >= today.start && currentTime < today.end);
      return { dayKey, currentTime, inside };
    } catch {
      return { dayKey: 'mon' as DayKey, currentTime: '--:--', inside: false };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, days, tick]);

  const updateDay = (key: DayKey, patch: Partial<DayState>) => {
    setDays(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleSave = async () => {
    if (!tenant) return;
    // Validate
    for (const k of DAY_ORDER) {
      const d = days[k];
      if (d.open && !(d.end > d.start)) {
        toast.error(`${DAY_LABELS[k]}: horário de fechamento deve ser maior que o de abertura.`);
        return;
      }
    }
    const businessHours: Record<string, { start: string; end: string }> = {};
    for (const k of DAY_ORDER) {
      if (days[k].open) businessHours[k] = { start: days[k].start, end: days[k].end };
    }
    setSaving(true);
    const { error } = await supabase
      .from('tenants')
      .update({ business_hours: businessHours, timezone })
      .eq('id', tenant.id);
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
      return;
    }
    toast.success('Horários salvos com sucesso');
    refreshTenant();
  };

  if (role !== 'admin') return null;

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Horário de funcionamento
        </CardTitle>
        <CardDescription>
          Configure o fuso horário e os dias/horários de atendimento. A IA usa essas informações para responder
          de forma adequada dentro e fora do expediente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="space-y-2 max-w-md">
              <Label htmlFor="bh-timezone">Fuso horário</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="bh-timezone" aria-label="Fuso horário" className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Agora no fuso selecionado: </span>
                <span className="font-mono text-foreground">{status.currentTime}</span>
              </div>
              <Badge
                variant="secondary"
                className={
                  status.inside
                    ? 'rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : 'rounded-full bg-amber-500/10 text-amber-600 border-amber-500/20'
                }
              >
                {status.inside ? 'Dentro do expediente' : 'Fora do expediente'}
              </Badge>
            </div>

            <div className="space-y-2">
              {DAY_ORDER.map(k => {
                const d = days[k];
                const invalid = d.open && !(d.end > d.start);
                return (
                  <div
                    key={k}
                    className="grid grid-cols-1 sm:grid-cols-[160px_120px_1fr_1fr] gap-3 items-center rounded-xl border border-border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`bh-${k}-open`}
                        checked={d.open}
                        onCheckedChange={(v) => updateDay(k, { open: !!v })}
                      />
                      <Label htmlFor={`bh-${k}-open`} className="cursor-pointer">{DAY_LABELS[k]}</Label>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {d.open ? 'Aberto' : 'Fechado'}
                    </span>
                    <div className="space-y-1">
                      <Label htmlFor={`bh-${k}-start`} className="text-xs text-muted-foreground">Abre</Label>
                      <Input
                        id={`bh-${k}-start`}
                        type="time"
                        value={d.start}
                        disabled={!d.open}
                        onChange={(e) => updateDay(k, { start: e.target.value })}
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`bh-${k}-end`} className="text-xs text-muted-foreground">Fecha</Label>
                      <Input
                        id={`bh-${k}-end`}
                        type="time"
                        value={d.end}
                        disabled={!d.open}
                        onChange={(e) => updateDay(k, { end: e.target.value })}
                        className={`rounded-xl ${invalid ? 'border-destructive' : ''}`}
                        aria-invalid={invalid}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar horários
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
