import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { normalizeBrazilPhone } from '@/lib/phone';

export default function ProfileSettingsCard() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('full_name, phone').eq('user_id', user.id).maybeSingle();
      setFullName(data?.full_name ?? '');
      setPhone(data?.phone ?? '');
      setLoading(false);
    })();
  }, [user?.id]);

  async function save() {
    if (!user) return;
    const normalized = phone.trim() ? normalizeBrazilPhone(phone) : '';
    if (phone.trim() && !normalized) {
      toast.error('Telefone inválido. Use o formato brasileiro com DDD.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null, phone: normalized || null })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success('Perfil atualizado');
      if (normalized) setPhone(normalized);
    }
  }

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <CardTitle>Meu perfil</CardTitle>
        <CardDescription>Dados usados para atribuições e notificações internas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <Label className="text-xs">Nome completo</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} disabled={loading} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Telefone (WhatsApp)</Label>
          <Input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="Ex.: (11) 98765-4321"
            disabled={loading}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            Número onde você vai receber notificações de novos leads. Formato BR (com DDD).
          </p>
        </div>
        <Button onClick={save} disabled={saving || loading} size="sm" className="rounded-xl">
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </CardContent>
    </Card>
  );
}
