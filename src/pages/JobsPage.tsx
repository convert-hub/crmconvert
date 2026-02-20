import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Job {
  id: string; type: string; status: string; attempts: number; max_attempts: number;
  last_error: string | null; created_at: string; payload: Record<string, unknown>;
}

export default function JobsPage() {
  const { tenant } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = () => {
    if (!tenant) return;
    supabase.from('job_queue').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setJobs((data as unknown as Job[]) ?? []));
  };

  useEffect(() => { load(); }, [tenant]);

  const retry = async (jobId: string) => {
    await supabase.from('job_queue').update({ status: 'queued', attempts: 0, last_error: null }).eq('id', jobId);
    toast.success('Job reenfileirado');
    load();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'done': return 'default';
      case 'queued': return 'secondary';
      case 'running': return 'outline';
      case 'failed': case 'dead': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Jobs & Falhas</h1>
        <Button variant="outline" size="sm" onClick={load}><RefreshCcw className="h-4 w-4 mr-1" />Atualizar</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tentativas</TableHead>
            <TableHead>Erro</TableHead>
            <TableHead>Criado</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map(j => (
            <TableRow key={j.id}>
              <TableCell className="font-mono text-sm">{j.type}</TableCell>
              <TableCell><Badge variant={statusColor(j.status) as any} className="capitalize">{j.status}</Badge></TableCell>
              <TableCell>{j.attempts}/{j.max_attempts}</TableCell>
              <TableCell className="max-w-xs truncate text-xs text-destructive">{j.last_error}</TableCell>
              <TableCell className="text-xs">{format(new Date(j.created_at), 'dd/MM HH:mm')}</TableCell>
              <TableCell>
                {(j.status === 'failed' || j.status === 'dead') && (
                  <Button size="sm" variant="outline" onClick={() => retry(j.id)}>Reprocessar</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {jobs.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum job encontrado</p>}
    </div>
  );
}
