import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, GitBranch, Download, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface ShareRecord {
  id: string;
  token: string;
  title: string | null;
  description: string | null;
  snapshot: any;
  cloned_count: number;
  is_active: boolean;
  expires_at: string | null;
}

export default function FlowInstallPage() {
  const { token } = useParams<{ token: string }>();
  const { session, tenant } = useAuth();
  const navigate = useNavigate();
  const [share, setShare] = useState<ShareRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // Falha de sistema (rede/timeout/permissão) é diferente de "não existe":
  // sem separar, um erro transitório virava "link expirou ou foi desativado"
  // (mensagem enganosa) e o visitante não tinha como tentar de novo.
  const [loadError, setLoadError] = useState(false);

  const loadShare = async () => {
    if (!token) return;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    // Via RPC (não leitura direta da tabela): flow_shares deixou de ser
    // legível por anon, senão qualquer visitante listava os templates —
    // e os tenant_id — de todos os clientes. A RPC exige o token exato.
    const { data, error } = await (supabase as any).rpc('get_flow_share', { _token: token });
    if (error) {
      console.error('[FlowInstallPage] get_flow_share falhou:', error.message);
      setLoadError(true);
      setLoading(false);
      return;
    }
    const record = Array.isArray(data) ? data[0] : data;
    if (!record) setNotFound(true);
    else setShare(record as ShareRecord);
    setLoading(false);
  };

  useEffect(() => { loadShare(); }, [token]);

  const install = async () => {
    if (!session) { navigate(`/login?next=${encodeURIComponent(`/flow/install/${token}`)}`); return; }
    if (!tenant) { toast.error('Sem workspace ativo'); return; }
    setInstalling(true);
    const { data, error } = await (supabase as any).rpc('install_flow_share', {
      _token: token,
      _target_tenant_id: tenant.id,
      _target_folder_id: null,
    });
    setInstalling(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Fluxo instalado no seu workspace');
    navigate('/flow-builder');
    void data;
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  // Falha ao carregar (≠ não encontrado): não afirmar que o link expirou —
  // pode ser problema momentâneo. Oferece retry.
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-base font-semibold">Não foi possível carregar o template</h1>
          <p className="text-xs text-muted-foreground mt-1">Ocorreu um problema ao buscar este link. Tente novamente.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadShare}>Tentar novamente</Button>
        </Card>
      </div>
    );
  }

  if (notFound || !share) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md text-center">
          <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-base font-semibold">Template indisponível</h1>
          <p className="text-xs text-muted-foreground mt-1">O link expirou ou foi desativado.</p>
        </Card>
      </div>
    );
  }

  const snap = share.snapshot || {};
  const nodes: any[] = snap.nodes || [];
  const nodeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="p-8 max-w-xl w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Template de fluxo</p>
            <h1 className="text-lg font-semibold">{share.title || snap.name || 'Fluxo'}</h1>
          </div>
        </div>

        {share.description && (
          <p className="text-sm text-muted-foreground mb-4">{share.description}</p>
        )}

        <div className="grid grid-cols-2 gap-2 mb-5 text-xs">
          <div className="rounded-md border border-border p-2.5">
            <p className="text-[10px] uppercase text-muted-foreground">Nós</p>
            <p className="font-semibold">{nodes.length}</p>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <p className="text-[10px] uppercase text-muted-foreground">Instalações</p>
            <p className="font-semibold">{share.cloned_count}</p>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Composição</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(nodeCounts).map(([k, v]) => (
              <span key={k} className="text-[11px] bg-muted px-2 py-0.5 rounded-full">{k} × {v}</span>
            ))}
          </div>
        </div>

        <Button onClick={install} disabled={installing} className="w-full">
          {installing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {session ? `Instalar no meu workspace${tenant ? ` (${tenant.name})` : ''}` : 'Entrar para instalar'}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          O fluxo será criado <strong>inativo</strong> para você revisar antes de ligar.
        </p>
      </Card>
    </div>
  );
}
