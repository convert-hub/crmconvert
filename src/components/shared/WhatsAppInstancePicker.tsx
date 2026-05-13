import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Instance = { id: string; display_name: string | null; instance_name: string | null; provider: string };

interface Props {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  className?: string;
  placeholder?: string;
  /** When true, hides the "Automático" option (forces a choice). */
  required?: boolean;
}

const AUTO = '__auto__';

export default function WhatsAppInstancePicker({ value, onChange, className, placeholder = 'Automático', required }: Props) {
  const { tenant } = useAuth();
  const [instances, setInstances] = useState<Instance[]>([]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('whatsapp_instances')
      .select('id, display_name, instance_name, provider')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('display_name')
      .then(({ data }) => setInstances((data as any) ?? []));
  }, [tenant?.id]);

  return (
    <Select
      value={value ?? AUTO}
      onValueChange={(v) => onChange(v === AUTO ? null : v)}
    >
      <SelectTrigger className={className ?? 'h-8 text-xs'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {!required && <SelectItem value={AUTO}>Automático (padrão)</SelectItem>}
        {instances.map(i => (
          <SelectItem key={i.id} value={i.id}>
            {i.display_name || i.instance_name || i.id.slice(0, 8)} {i.provider === 'meta_cloud' ? '· Meta' : ''}
          </SelectItem>
        ))}
        {instances.length === 0 && <SelectItem value="__none__" disabled>Nenhum número ativo</SelectItem>}
      </SelectContent>
    </Select>
  );
}
