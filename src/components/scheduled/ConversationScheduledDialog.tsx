import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Pencil, Ban, FileCheck2, MessageSquare, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ScheduledMessage } from '@/types/crm';
import EditScheduledMessageDialog from './EditScheduledMessageDialog';

interface ConversationScheduledDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** Chamado após qualquer mudança (editar/cancelar) pra atualizar o chip do chat */
  onChanged: () => void;
}

export default function ConversationScheduledDialog({ open, onOpenChange, conversationId, onChanged }: ConversationScheduledDialogProps) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });
    if (error) toast.error(error.message);
    setItems((data as unknown as ScheduledMessage[]) ?? []);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleCancel = async (msg: ScheduledMessage) => {
    if (!confirm(`Cancelar o envio agendado para ${format(new Date(msg.scheduled_at), "dd/MM/yyyy 'às' HH:mm")}?`)) return;
    setCancellingId(msg.id);
    try {
      const { error } = await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', msg.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Agendamento cancelado');
      await load();
      onChanged();
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" /> Mensagens Agendadas
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma mensagem agendada nesta conversa.</p>
          ) : (
            <div className="space-y-2">
              {items.map(msg => (
                <div key={msg.id} className="rounded-lg border border-border/60 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {msg.template ? <FileCheck2 className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                      {msg.template ? 'Template' : 'Texto'}
                    </Badge>
                    <span className="text-xs font-medium text-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {format(new Date(msg.scheduled_at), 'dd/MM/yyyy HH:mm')}
                    </span>
                    <div className="flex-1" />
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={msg.template ? 'Alterar data/hora' : 'Editar'}
                      onClick={() => setEditing(msg)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Cancelar envio"
                      disabled={cancellingId === msg.id} onClick={() => handleCancel(msg)}>
                      {cancellingId === msg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{msg.content || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <EditScheduledMessageDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        message={editing}
        onSaved={() => { load(); onChanged(); }}
      />
    </>
  );
}
