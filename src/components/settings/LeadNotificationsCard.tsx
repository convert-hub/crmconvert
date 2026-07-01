import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

type Member = {
  id: string;
  user_id: string;
  role: string;
  full_name: string | null;
  phone: string | null;
};

type Config = {
  enabled: boolean;
  triggers: { inbound: boolean; keyword: boolean };
  recipient_membership_ids: string[];
};

const DEFAULT: Config = {
  enabled: false,
  triggers: { inbound: true, keyword: true },
  recipient_membership_ids: [],
};

export default function LeadNotificationsCard() {
  const { tenant, role } = useAuth();
  const isAdmin = role === 'admin';
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    const s = ((tenant.settings as any) ?? {}).lead_notifications ?? {};
    setCfg({
      enabled: !!s.enabled,
      triggers: { inbound: s.triggers?.inbound !== false, keyword: s.triggers?.keyword !== false },
      recipient_membership_ids: Array.isArray(s.recipient_membership_ids) ? s.recipient_membership_ids : [],
    });

    (async () => {
      const { data: mems } = await supabase
        .from('tenant_memberships')
        .select('id, user_id, role')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .in('role', ['admin', 'manager', 'attendant']);
      if (!mems) return;
      const userIds = mems.map(m => m.user_id);
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
      const byUser = new Map((profs ?? []).map(p => [p.user_id, p]));
      setMembers(mems.map(m => ({
        id: m.id, user_id: m.user_id, role: m.role,
        full_name: byUser.get(m.user_id)?.full_name ?? null,
        phone: byUser.get(m.user_id)?.phone ?? null,
      })));
    })();
  }, [tenant?.id]);

  async function persist(next: Config) {
    if (!tenant || !isAdmin) return;
    setSaving(true);
    const merged = { ...((tenant.settings as any) ?? {}), lead_notifications: next };
    const { error } = await supabase.from('tenants').update({ settings: merged }).eq('id', tenant.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else setCfg(next);
  }

  const toggleRecipient = (id: string) => {
    const s = new Set(cfg.recipient_membership_ids);
    s.has(id) ? s.delete(id) : s.add(id);
    persist({ ...cfg, recipient_membership_ids: Array.from(s) });
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <CardTitle>Notificação de novos leads</CardTitle>
        <CardDescription>
          Avisa atendentes via WhatsApp (UAZAPI do próprio tenant) quando um novo lead entra. Sem custo, não usa API oficial.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Ativar notificações</div>
            <div className="text-[11px] text-muted-foreground">Requer instância UAZAPI conectada.</div>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={v => persist({ ...cfg, enabled: v })}
            disabled={!isAdmin || saving}
          />
        </div>

        <div className={cfg.enabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className="text-xs font-medium text-muted-foreground mb-2">Disparar quando</div>
          <div className="space-y-2">
            {[
              { key: 'inbound' as const, label: 'Mensagem recebida (WhatsApp inbound)' },
              { key: 'keyword' as const, label: 'Palavra-chave detectada' },
            ].map(t => (
              <label key={t.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={cfg.triggers[t.key]}
                  onCheckedChange={v => persist({ ...cfg, triggers: { ...cfg.triggers, [t.key]: !!v } })}
                  disabled={!isAdmin || saving}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className={cfg.enabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className="text-xs font-medium text-muted-foreground mb-2">Atendentes que recebem</div>
          {members.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Nenhum membro ativo.</p>
          ) : (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2">
              {members.map(m => {
                const checked = cfg.recipient_membership_ids.includes(m.id);
                const noPhone = !m.phone;
                return (
                  <label key={m.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer">
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleRecipient(m.id)}
                        disabled={!isAdmin || saving}
                      />
                      <span className="text-sm truncate">{m.full_name || m.user_id.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{m.role}</span>
                    </div>
                    {noPhone ? (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                        <AlertTriangle className="h-3 w-3 mr-1" /> sem telefone
                      </Badge>
                    ) : (
                      <code className="text-[11px] text-muted-foreground font-mono">{m.phone}</code>
                    )}
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Telefone vem do perfil de cada atendente. Quem estiver sem telefone é ignorado silenciosamente.
          </p>
        </div>

        {!isAdmin && <p className="text-[11px] text-amber-600">Somente administradores podem alterar.</p>}
      </CardContent>
    </Card>
  );
}
