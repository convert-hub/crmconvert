import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Trash2, Loader2, FileText, CheckCircle2, AlertCircle, Brain } from 'lucide-react';
import { toast } from 'sonner';

interface KnowledgeDoc {
  id: string;
  name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  status: string;
  chunk_count: number;
  error: string | null;
  created_at: string;
}

export default function KnowledgeBaseSettings() {
  const { tenant, role } = useAuth();
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const isAdmin = role === 'admin' || role === 'manager';

  const loadDocuments = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from('knowledge_documents' as any)
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    setDocuments((data as any[]) || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // Poll for processing documents
  useEffect(() => {
    const processing = documents.some(d => d.status === 'pending' || d.status === 'processing');
    if (!processing) return;
    const interval = setInterval(loadDocuments, 3000);
    return () => clearInterval(interval);
  }, [documents, loadDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenant) return;

    const allowedTypes = [
      'text/plain', 'text/csv', 'text/markdown',
      'application/json', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isAllowed = allowedTypes.includes(file.type) || ['txt', 'md', 'csv', 'json', 'pdf', 'docx'].includes(ext || '');

    if (!isAllowed) {
      toast.error('Tipo de arquivo não suportado. Use TXT, CSV, MD, JSON ou PDF.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 10MB.');
      return;
    }

    setUploading(true);
    try {
      const storagePath = `${tenant.id}/knowledge/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('crm-files')
        .upload(storagePath, file);

      if (uploadErr) throw uploadErr;

      // Get membership ID
      const { data: membership } = await supabase
        .from('tenant_memberships')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .eq('is_active', true)
        .single();

      // Create document record
      const { data: doc, error: docErr } = await supabase
        .from('knowledge_documents' as any)
        .insert({
          tenant_id: tenant.id,
          name: file.name,
          mime_type: file.type || `text/${ext}`,
          file_size: file.size,
          storage_path: storagePath,
          status: 'pending',
          created_by: membership?.id || null,
        })
        .select()
        .single();

      if (docErr) throw docErr;

      toast.success('Arquivo enviado! Processando...');
      loadDocuments();

      // Trigger ingestion
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          document_id: (doc as any).id,
          tenant_id: tenant.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Erro ao processar documento');
      }

      loadDocuments();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar arquivo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const deleteDocument = async (id: string, storagePath?: string) => {
    if (!confirm('Excluir documento e todos os seus chunks?')) return;
    
    // Delete chunks first, then document
    await supabase.from('knowledge_chunks' as any).delete().eq('document_id', id);
    await supabase.from('knowledge_documents' as any).delete().eq('id', id);
    
    if (storagePath) {
      await supabase.storage.from('crm-files').remove([storagePath]);
    }

    toast.success('Documento excluído');
    loadDocuments();
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusBadge = (status: string, error: string | null) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 rounded-full"><CheckCircle2 className="h-3 w-3 mr-1" />Indexado</Badge>;
      case 'processing':
      case 'pending':
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 rounded-full"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processando</Badge>;
      case 'error':
        return (
          <Badge variant="destructive" className="rounded-full" title={error || ''}>
            <AlertCircle className="h-3 w-3 mr-1" />Erro
          </Badge>
        );
      default:
        return <Badge variant="secondary" className="rounded-full">{status}</Badge>;
    }
  };

  return (
    <Card className="glass-card rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Base de Conhecimento (RAG)
            </CardTitle>
            <CardDescription>
              Envie documentos para que a IA use como referência nas respostas automáticas e sugestões
            </CardDescription>
          </div>
          {isAdmin && (
            <div className="relative">
              <input
                type="file"
                accept=".txt,.csv,.md,.json,.pdf,.docx"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleUpload}
                disabled={uploading}
              />
              <Button className="rounded-xl" disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Enviar Documento
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Nenhum documento na base de conhecimento.
            </p>
            <p className="text-xs text-muted-foreground">
              Envie arquivos TXT, CSV, MD, JSON ou PDF para treinar a IA com informações do seu negócio.
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Documento</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground text-sm">{doc.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatSize(doc.file_size)}</TableCell>
                    <TableCell className="text-sm font-mono">{doc.chunk_count || '—'}</TableCell>
                    <TableCell>{statusBadge(doc.status, doc.error)}</TableCell>
                    <TableCell>
                      {isAdmin && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => deleteDocument(doc.id, doc.storage_path as string | undefined)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {documents.some(d => d.status === 'error') && (
              <p className="text-xs text-muted-foreground mt-2">
                💡 Para melhores resultados, use arquivos .txt ou .md. PDFs com imagens ou formatação complexa podem não ser extraídos corretamente.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
