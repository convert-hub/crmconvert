import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Clock, FileCheck2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ScheduledMessage } from '@/types/crm';

interface EditScheduledMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ScheduledMessage | null;
  /** Chamado após salvar com sucesso (pra recarregar a lista de quem abriu) */
  onSaved: () => void;
}

export default function EditScheduledMessageDialog({ open, onOpenChange, message, onSaved }: EditScheduledMessageDialogProps) {
  const isTemplate = !!message?.template;
  // Agendamento que falhou é reagendado: volta pra fila (pending) com nova data e erro limpo
  const isReschedule = message?.status === 'failed';

  const [content, setContent] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !message) return;
    const dt = new Date(message.scheduled_at);
    setContent(message.content ?? '');
    setDate(dt);
    setHour(dt.getHours().toString().padStart(2, '0'));
    setMinute(dt.getMinutes().toString().padStart(2, '0'));
  }, [open, message]);

  const handleSave = async () => {
    if (!message) return;
    if (!isTemplate && !content.trim()) { toast.error('A mensagem não pode ficar vazia'); return; }
    if (!date) { toast.error('Selecione uma data'); return; }

    const scheduledAt = new Date(date);
    scheduledAt.setHours(parseInt(hour), parseInt(minute), 0, 0);
    if (scheduledAt <= new Date()) { toast.error('A data/hora deve ser no futuro'); return; }

    setSaving(true);
    try {
      const update: Record<string, unknown> = { scheduled_at: scheduledAt.toISOString() };
      if (!isTemplate) update.content = content.trim();
      if (isReschedule) { update.status = 'pending'; update.error_message = null; }

      const { error } = await supabase.from('scheduled_messages').update(update as any).eq('id', message.id);
      if (error) { toast.error(error.message); return; }

      toast.success(`${isReschedule ? 'Mensagem reagendada' : 'Agendamento atualizado'} para ${format(scheduledAt, "dd/MM/yyyy 'às' HH:mm")}`);
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  // Passos de 15min + o minuto atual do agendamento (pra não "sumir" com o valor original)
  const minutes = Array.from(new Set(['00', '15', '30', '45', minute])).sort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> {isReschedule ? 'Reagendar Mensagem' : 'Editar Agendamento'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isReschedule && message?.error_message && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 flex gap-2 text-[12px] text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>O envio falhou: {message.error_message}</span>
            </div>
          )}

          {isTemplate ? (
            <div className="space-y-1.5">
              <Label className="text-[13px] flex items-center gap-1.5">
                <FileCheck2 className="h-3.5 w-3.5" /> Template (não editável)
              </Label>
              <div className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                {message?.content || `[template: ${(message?.template as any)?.name ?? '—'}]`}
              </div>
              <p className="text-[11px] text-muted-foreground">
                O conteúdo do template já foi resolvido no agendamento — só a data/hora pode ser alterada.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-[13px]">Mensagem *</Label>
              <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Digite a mensagem..." className="min-h-[80px]" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px]">Data *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {date ? format(date, 'dd/MM/yyyy') : 'Selecionar data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={d => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Hora</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  {hours.map(h => <SelectItem key={h} value={h}>{h}h</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Minuto</Label>
              <Select value={minute} onValueChange={setMinute}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {minutes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving || !date} className="w-full">
            {saving ? 'Salvando...' : isReschedule ? 'Reagendar Envio' : 'Salvar Alterações'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
