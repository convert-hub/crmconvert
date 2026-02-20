import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCcw, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Job { id: string; type: string; status: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string; payload: Record<string, unknown>; }
interface AuditEntry { id: string; action: string; target_table: string | null; target_id: string | null; user_id: string | null; created_at: string; old_data: unknown; new_data: unknown; }
interface WebhookEvent { id: string; source: string; processed: boolean; processing_error: string | null; created_at: string; raw_payload: unknown; }

export default function JobsPage() {
  const { tenant } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [inspectPayload, setInspectPayload] = useState<unknown>(null);

  const loadJobs = () => { if (!tenant) return; supabase.from('job_queue').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100).then(({ data }) => setJobs((data as unknown as Job[]) ?? [])); };
  const loadAudits = () => { if (!tenant) return; supabase.from('audit_log').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100).then(({ data }) => setAudits((data as unknown as AuditEntry[]) ?? [])); };
  const loadWebhooks = () => { if (!tenant) return; supabase.from('webhook_events').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100).then(({ data }) => setWebhooks((data as unknown as WebhookEvent[]) ?? [])); };

  useEffect(() => { loadJobs(); loadAudits(); loadWebhooks(); }, [tenant]);

  const retry = async (jobId: string) => { await supabase.from('job_queue').update({ status: 'queued' as any, attempts: 0, last_error: null }).eq('id', jobId); toast.success('Job reenfileirado'); loadJobs(); };

  const statusColors: Record<string, string> = {
    done: 'bg-success/10 text-success border-success/20',
    queued: 'bg-muted text-muted-foreground',
    running: 'bg-info/10 text-info border-info/20',
    failed: 'bg-destructive/10 text-destructive border-destructive/20',
    dead: 'bg-destructive/10 text-destructive border-destructive/20',
  };

  return (
    <div className="p-6 space-y-4 bg-background">
      <h1 className="text-xl font-bold text-foreground">Jobs, Webhooks & Auditoria</h1>

      <Tabs defaultValue="jobs">
        <TabsList className="rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="jobs" className="rounded-lg">Fila de Jobs</TabsTrigger>
          <TabsTrigger value="webhooks" className="rounded-lg">Webhook Events</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-lg">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="pt-4">
          <div className="flex justify-end mb-2"><Button variant="outline" size="sm" onClick={loadJobs} className="rounded-xl"><RefreshCcw className="h-4 w-4 mr-1" />Atualizar</Button></div>
          <div className="glass-card rounded-2xl overflow-hidden">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead>Tentativas</TableHead><TableHead>Erro</TableHead><TableHead>Criado</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {jobs.map(j => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-sm text-foreground">{j.type}</TableCell>
                    <TableCell><Badge variant="outline" className={`capitalize rounded-full ${statusColors[j.status] ?? ''}`}>{j.status}</Badge></TableCell>
                    <TableCell>{j.attempts}/{j.max_attempts}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">{j.last_error}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(j.created_at), 'dd/MM HH:mm')}</TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" className="rounded-lg" onClick={() => setInspectPayload(j.payload)}><Eye className="h-4 w-4" /></Button>
                      {(j.status === 'failed' || j.status === 'dead') && <Button size="sm" variant="outline" className="rounded-lg" onClick={() => retry(j.id)}>Retry</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {jobs.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum job</p>}
          </div>
        </TabsContent>

        <TabsContent value="webhooks" className="pt-4">
          <div className="flex justify-end mb-2"><Button variant="outline" size="sm" onClick={loadWebhooks} className="rounded-xl"><RefreshCcw className="h-4 w-4 mr-1" />Atualizar</Button></div>
          <div className="glass-card rounded-2xl overflow-hidden">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Fonte</TableHead><TableHead>Status</TableHead><TableHead>Erro</TableHead><TableHead>Criado</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {webhooks.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-sm text-foreground">{w.source}</TableCell>
                    <TableCell><Badge variant="outline" className={`rounded-full ${w.processed ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{w.processed ? 'Processado' : 'Pendente'}</Badge></TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">{w.processing_error}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(w.created_at), 'dd/MM HH:mm')}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="rounded-lg" onClick={() => setInspectPayload(w.raw_payload)}><Eye className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {webhooks.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum webhook recebido</p>}
          </div>
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <div className="flex justify-end mb-2"><Button variant="outline" size="sm" onClick={loadAudits} className="rounded-xl"><RefreshCcw className="h-4 w-4 mr-1" />Atualizar</Button></div>
          <div className="glass-card rounded-2xl overflow-hidden">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Ação</TableHead><TableHead>Tabela</TableHead><TableHead>Target ID</TableHead><TableHead>Data</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {audits.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-foreground">{a.action}</TableCell>
                    <TableCell className="font-mono text-sm">{a.target_table}</TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[120px]">{a.target_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'dd/MM HH:mm')}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="rounded-lg" onClick={() => setInspectPayload({ old: a.old_data, new: a.new_data })}><Eye className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {audits.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum registro de auditoria</p>}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!inspectPayload} onOpenChange={() => setInspectPayload(null)}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle>Detalhes</DialogTitle></DialogHeader>
          <pre className="bg-muted rounded-xl p-4 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(inspectPayload, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
