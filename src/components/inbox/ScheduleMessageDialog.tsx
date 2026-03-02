import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  tenantId: string;
  membershipId: string;
}

export default function ScheduleMessageDialog({ open, onOpenChange, conversationId, tenantId, membershipId }: ScheduleMessageDialogProps) {
  const [content, setContent] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [saving, setSaving] = useState(false);

  const handleSchedule = async () => {
    if (!content.trim() || !date) {
      toast.error('Preencha a mensagem e selecione uma data');
      return;
    }

    const scheduledAt = new Date(date);
    scheduledAt.setHours(parseInt(hour), parseInt(minute), 0, 0);

    if (scheduledAt <= new Date()) {
      toast.error('A data/hora deve ser no futuro');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('scheduled_messages' as any).insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        content: content.trim(),
        scheduled_at: scheduledAt.toISOString(),
        created_by: membershipId,
      } as any);

      if (error) { toast.error(error.message); return; }
      toast.success(`Mensagem agendada para ${format(scheduledAt, "dd/MM/yyyy 'às' HH:mm")}`);
      setContent('');
      setDate(undefined);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const minutes = ['00', '15', '30', '45'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Agendar Mensagem
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Mensagem *</Label>
            <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Digite a mensagem..." className="min-h-[80px]" />
          </div>

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

          <Button onClick={handleSchedule} disabled={saving || !content.trim() || !date} className="w-full">
            {saving ? 'Agendando...' : 'Agendar Envio'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
