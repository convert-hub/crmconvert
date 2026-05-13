import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/contacts/TagInput';
import TagPickerSelect from '@/components/contacts/TagPickerSelect';
import { Copy, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';

export type TriggerConfig = {
  // keyword_match
  keywords?: string[];
  match?: 'contains' | 'equals' | 'starts_with';
  case_sensitive?: boolean;
  // tag_added
  tag?: string;
  // lead_created
  source?: string;
  require_phone?: boolean;
  // webhook
  secret?: string;
  field_mapping?: Record<string, string>;
};

interface Props {
  triggerType: string;
  config: TriggerConfig;
  onChange: (cfg: TriggerConfig) => void;
  flowId?: string | null;
}

const PROJECT_REF = 'zhywwrhzaqfcjcwywkwf';

function genSecret() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return 'whsec_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function TriggerConfigPanel({ triggerType, config, onChange, flowId }: Props) {
  const [copied, setCopied] = useState(false);

  const set = (patch: Partial<TriggerConfig>) => onChange({ ...config, ...patch });

  const webhookUrl = useMemo(() => {
    if (!flowId) return '';
    return `https://${PROJECT_REF}.functions.supabase.co/webhook-flow-trigger/${flowId}`;
  }, [flowId]);

  const ensureSecret = () => {
    if (!config.secret) set({ secret: genSecret() });
  };

  // ── Tipos sem configuração ──
  if (triggerType === 'message_received' || triggerType === 'manual') {
    return (
      <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
        {triggerType === 'message_received'
          ? 'Dispara em qualquer mensagem recebida.'
          : 'Disparado manualmente em conversas e oportunidades.'}
      </p>
    );
  }

  // ── Palavra-chave ── (gerenciado em Automações)
  if (triggerType === 'keyword_match') {
    return (
      <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
        Configure as palavras-chave em <span className="font-medium text-foreground">Automações → Palavras-chave</span>. Salve este fluxo e adicione a regra lá.
      </p>
    );
  }

  // ── Tag adicionada ──
  if (triggerType === 'tag_added') {
    return (
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tag</Label>
        <div className="mt-1">
          <TagPickerSelect
            value={config.tag || ''}
            onChange={(v) => set({ tag: v || undefined })}
          />
        </div>
      </div>
    );
  }

  // ── Lead criado ──
  if (triggerType === 'lead_created') {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Origem (opcional)</Label>
          <Input
            className="h-8 text-xs mt-1"
            placeholder="Ex: facebook_ads"
            value={config.source || ''}
            onChange={(e) => set({ source: e.target.value || undefined })}
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <Label className="text-[11px] text-muted-foreground">Apenas com telefone</Label>
          <Switch
            checked={!!config.require_phone}
            onCheckedChange={(v) => set({ require_phone: v })}
          />
        </div>
      </div>
    );
  }

  // ── Webhook ── (gerenciado em Automações)
  if (triggerType === 'webhook') {
    return (
      <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
        Configure URL, secret e mapeamento de campos em <span className="font-medium text-foreground">Automações → Webhooks</span>. Use a ação "Disparar fluxo" e selecione este fluxo.
      </p>
    );
  }

  return null;
}
