import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Activity } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, Clock, AlertTriangle, Phone, Mail, Calendar, StickyNote, ListTodo, Users } from 'lucide-react';
import { format, isPast, differenceInHours } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const typeIcons: Record<string, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  note: StickyNote,
  task: ListTodo,
  follow_up: Users,
};

const typeLabels: Record<string, string> = {
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
  note: 'Nota',
  task: 'Tarefa',
  follow_up: 'Follow-up',
};

interface ActivityWithRelations extends Activity {
  contact?: { id: string; name: string } | null;
  opportunity?: { id: string; title: string } | null;
}

export default function ActivitiesPage() {
  const { tenant } = useAuth();
  const [activities, setActivities] = useState<ActivityWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  useEffect(() => {
    if (!tenant) return;
    loadActivities();
  }, [tenant]);

  const loadActivities = async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from('activities')
      .select('*, contact:contacts(id, name), opportunity:opportunities(id, title)')
      .eq('tenant_id', tenant.id)
      .not('due_date', 'is', null)
      .in('type', ['call', 'task', 'meeting', 'follow_up', 'email'])
      .order('due_date', { ascending: true, nullsFirst: false });
    setActivities((data as ActivityWithRelations[]) ?? []);
    setLoading(false);
  };

  const toggleComplete = async (act: ActivityWithRelations) => {
    const newCompleted = !act.is_completed;
    await supabase.from('activities').update({
      is_completed: newCompleted,
      completed_at: newCompleted ? new Date().toISOString() : null,
    }).eq('id', act.id);
    setActivities(prev => prev.map(a => a.id === act.id ? { ...a, is_completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null } : a));
  };

  const pending = activities.filter(a => !a.is_completed);
  const completed = activities.filter(a => a.is_completed);

  const overdue = pending.filter(a => a.due_date && isPast(new Date(a.due_date)));
  const soon = pending.filter(a => a.due_date && !isPast(new Date(a.due_date)) && differenceInHours(new Date(a.due_date), new Date()) <= 2);
  const scheduled = pending.filter(a => a.due_date && !isPast(new Date(a.due_date)) && differenceInHours(new Date(a.due_date), new Date()) > 2);
  // noDue removed - we only show scheduled activities with due_date

  const getStatusBadge = (act: ActivityWithRelations) => {
    if (act.is_completed) return <Badge variant="outline" className="text-success border-success/30">Concluída</Badge>;
    if (!act.due_date) return <Badge variant="outline" className="text-muted-foreground">Sem prazo</Badge>;
    if (isPast(new Date(act.due_date))) return <Badge variant="outline" className="text-destructive border-destructive/30">Vencida</Badge>;
    if (differenceInHours(new Date(act.due_date), new Date()) <= 2) return <Badge variant="outline" className="text-warning border-warning/30">Em breve</Badge>;
    return <Badge variant="outline" className="text-primary border-primary/30">Agendada</Badge>;
  };

  const renderList = (list: ActivityWithRelations[]) => {
    if (list.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma atividade encontrada.</p>;
    return (
      <div className="space-y-2">
        {list.map(act => {
          const Icon = typeIcons[act.type] || ListTodo;
          const isOverdue = act.due_date && isPast(new Date(act.due_date)) && !act.is_completed;
          const isSoon = act.due_date && !isPast(new Date(act.due_date)) && differenceInHours(new Date(act.due_date), new Date()) <= 2 && !act.is_completed;
          return (
            <Card
              key={act.id}
              className={cn(
                "flex items-center gap-3 p-3 transition-colors border-border/60",
                isOverdue && "border-destructive/30",
                isSoon && "border-warning/30",
                act.is_completed && "opacity-60"
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => toggleComplete(act)}
              >
                <CheckCircle2 className={cn("h-5 w-5", act.is_completed ? "text-success" : "text-muted-foreground")} />
              </Button>

              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />

              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium truncate", act.is_completed && "line-through")}>{act.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {act.contact?.name && <span>{act.contact.name}</span>}
                  {act.opportunity?.title && (
                    <>
                      {act.contact?.name && <span>•</span>}
                      <span>{act.opportunity.title}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {act.due_date && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(act.due_date), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                )}
                {getStatusBadge(act)}
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  if (loading) return <div className="p-6"><p className="text-sm text-muted-foreground">Carregando...</p></div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Atividades</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {overdue.length > 0 && <span className="text-destructive font-medium">{overdue.length} vencida{overdue.length > 1 ? 's' : ''}</span>}
            {overdue.length > 0 && soon.length > 0 && ' · '}
            {soon.length > 0 && <span className="text-warning font-medium">{soon.length} em breve</span>}
            {(overdue.length > 0 || soon.length > 0) && ' · '}
            {pending.length} pendente{pending.length !== 1 ? 's' : ''} · {completed.length} concluída{completed.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Pendentes ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Concluídas ({completed.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {overdue.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-destructive font-medium mb-2">Vencidas</h3>
              {renderList(overdue)}
            </div>
          )}
          {soon.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-warning font-medium mb-2">Em breve (próximas 2h)</h3>
              {renderList(soon)}
            </div>
          )}
          {scheduled.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Agendadas</h3>
              {renderList(scheduled)}
            </div>
          )}
          {pending.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma atividade pendente 🎉</p>}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {renderList(completed)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
