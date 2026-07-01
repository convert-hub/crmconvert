import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { normalizeBrazilPhone } from '@/lib/phone';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (newName: string) => void;
}

export default function ProfileDialog({ open, onOpenChange, onSaved }: Props) {
  const { user, role } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('user_id', user.id)
        .maybeSingle();
      setFullName(data?.full_name ?? '');
      setPhone(data?.phone ?? '');
      setLoading(false);
    })();
  }, [open, user?.id]);

  async function save() {
    if (!user) return;
    const normalized = phone.trim() ? normalizeBrazilPhone(phone) : '';
    if (phone.trim() && !normalized) {
      toast.error('Telefone inválido. Use o formato brasileiro com DDD.');
      return;
    }
    const cleanName = fullName.trim();
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: cleanName || null, phone: normalized || null })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Perfil atualizado');
    if (normalized) setPhone(normalized);
    onSaved?.(cleanName);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Meus dados</DialogTitle>
          <DialogDescription>Dados usados para atribuições e notificações internas.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">E-mail</Label>
              <Input value={user?.email ?? ''} readOnly disabled className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Função</Label>
              <div className="h-9 flex items-center">
                <Badge variant="secondary" className="capitalize">{role ?? '—'}</Badge>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="rounded-xl">
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || loading} size="sm" className="rounded-xl">
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
