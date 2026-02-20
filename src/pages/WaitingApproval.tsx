import { useAuth } from '@/contexts/AuthContext';
import { Clock, LogOut, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function WaitingApproval() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glass-card rounded-3xl p-10 max-w-md w-full text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary text-white shadow-lg shadow-primary/30">
          <Clock className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Aguardando Aprovação</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Seu cadastro foi recebido com sucesso. O administrador do sistema irá vinculá-lo a uma empresa em breve.
          </p>
        </div>
        <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground bg-muted rounded-xl px-4 py-3">
          <Mail className="h-4 w-4" />
          <span className="truncate">{user?.email}</span>
        </div>
        <Button variant="outline" onClick={signOut} className="w-full rounded-xl">
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </div>
    </div>
  );
}
