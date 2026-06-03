import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, membership, tenant, isSaasAdmin } = useAuth();

  // Gate 1: ainda carregando sessão/dados iniciais
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Gate 2: sem sessão -> login
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Gate 3: usuário tem session mas ainda não tem tenant E não é SaaS admin.
  // Isso só acontece se houver race no carregamento (tenant select demorou/falhou).
  // Segura na tela de loading em vez de renderizar uma página vazia.
  // Exceção: SaaS admin pode entrar mesmo sem tenant (vai pra /admin).
  // Exceção: usuário sem membership vai pra /waiting (deixa o App.tsx decidir).
  if (membership && !tenant && !isSaasAdmin) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
