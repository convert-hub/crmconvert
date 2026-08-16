import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GitBranch, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

interface ManualFlow {
  id: string;
  name: string;
}

interface Props {
  tenantId: string;
  contactId: string;
  conversationId?: string | null;
  /** 'icon' = botão compacto para cabeçalhos; 'button' = com rótulo */
  variant?: 'icon' | 'button';
}

/**
 * Dispara fluxos com gatilho "Manual" para o contato/conversa atual.
 * Lista apenas fluxos ativos com trigger_type='manual' do tenant.
 */
export default function StartFlowButton({ tenantId, contactId, conversationId, variant = 'icon' }: Props) {
  const [open, setOpen] = useState(false);
  const [flows, setFlows] = useState<ManualFlow[] | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const loadFlows = async () => {
    const { data, error } = await supabase
      .from('chatbot_flows')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('trigger_type', 'manual')
      .eq('is_active', true)
      .order('name');
    if (error) {
      toast.error(`Erro ao carregar fluxos: ${error.message}`);
      setFlows([]);
      return;
    }
    setFlows((data as ManualFlow[]) ?? []);
  };

  const startFlow = async (flow: ManualFlow) => {
    setStartingId(flow.id);
    try {
      // Não inicia de novo se este fluxo já está rodando para este contato
      const { data: active, error: activeErr } = await supabase
        .from('flow_executions')
        .select('id')
        .eq('flow_id', flow.id)
        .eq('contact_id', contactId)
        .in('status', ['running', 'awaiting_input'])
        .limit(1);
      if (activeErr) throw activeErr;
      if (active && active.length > 0) {
        toast.warning(`O fluxo "${flow.name}" já está em andamento para este contato.`);
        return;
      }

      const { error } = await supabase.rpc('enqueue_job', {
        _type: 'execute_flow',
        _payload: JSON.stringify({
          flow_id: flow.id,
          tenant_id: tenantId,
          contact_id: contactId,
          conversation_id: conversationId ?? null,
          trigger_data: { trigger: 'manual' },
        }),
        _tenant_id: tenantId,
      });
      if (error) throw error;
      toast.success(`Fluxo "${flow.name}" iniciado`);
      setOpen(false);
    } catch (e: any) {
      toast.error(`Erro ao iniciar fluxo: ${e.message}`);
    } finally {
      setStartingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v && flows === null) loadFlows(); }}>
      <PopoverTrigger asChild>
        {variant === 'icon' ? (
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Iniciar fluxo">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />Iniciar fluxo
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 pb-1.5">
          Iniciar fluxo
        </p>
        {flows === null ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : flows.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-2 leading-relaxed">
            Nenhum fluxo com gatilho "Manual" está ativo. Crie um no Flow Builder
            escolhendo o gatilho Manual.
          </p>
        ) : (
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {flows.map(f => (
              <button
                key={f.id}
                onClick={() => startFlow(f)}
                disabled={startingId !== null}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left hover:bg-accent transition-colors disabled:opacity-50"
              >
                {startingId === f.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : <Play className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
