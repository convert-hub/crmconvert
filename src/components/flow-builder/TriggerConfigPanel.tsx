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

  // ── Palavra-chave ──
  if (triggerType === 'keyword_match') {
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Palavras-chave</Label>
          <div className="mt-1">
            <TagInput value={config.keywords || []} onChange={(v) => set({ keywords: v })} />
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Comparação</Label>
          <Select value={config.match || 'contains'} onValueChange={(v) => set({ match: v as TriggerConfig['match'] })}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">Contém</SelectItem>
              <SelectItem value="equals">Igual</SelectItem>
              <SelectItem value="starts_with">Começa com</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between pt-1">
          <Label className="text-[11px] text-muted-foreground">Diferenciar maiúsculas</Label>
          <Switch
            checked={!!config.case_sensitive}
            onCheckedChange={(v) => set({ case_sensitive: v })}
          />
        </div>
      </div>
    );
  }

  // ── Tag adicionada ──
  if (triggerType === 'tag_added') {
    return (
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tag</Label>
        <div className="mt-1">
          <TagPickerSelect
            value={config.tag ? [config.tag] : []}
            onChange={(v) => set({ tag: v[0] || undefined })}
            singleSelect
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

  // ── Webhook ──
  if (triggerType === 'webhook') {
    if (!flowId) {
      return (
        <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
          Salve o fluxo primeiro para gerar a URL do webhook.
        </p>
      );
    }
    if (!config.secret) ensureSecret();

    const copy = (txt: string) => {
      navigator.clipboard.writeText(txt);
      setCopied(true);
      toast.success('Copiado');
      setTimeout(() => setCopied(false), 1200);
    };

    return (
      <div className="space-y-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">URL</Label>
          <div className="flex gap-1 mt-1">
            <Input readOnly value={webhookUrl} className="h-8 text-[10px] font-mono" />
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copy(webhookUrl)}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Secret</Label>
          <div className="flex gap-1 mt-1">
            <Input readOnly value={config.secret || ''} className="h-8 text-[10px] font-mono" />
            <Button
              size="icon" variant="outline" className="h-8 w-8 shrink-0"
              onClick={() => copy(config.secret || '')}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              size="icon" variant="outline" className="h-8 w-8 shrink-0"
              onClick={() => set({ secret: genSecret() })}
              title="Regerar"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
          Envie POST com header <span className="font-mono">X-Flow-Secret</span> e corpo JSON. Os campos do JSON ficam disponíveis como variáveis dentro do fluxo.
        </p>
      </div>
    );
  }

  return null;
}
