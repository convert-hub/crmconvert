import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const logo = 'https://zhywwrhzaqfcjcwywkwf.supabase.co/storage/v1/object/public/tenant-logos/logo-crm.png';

let processedToken: string | null = null;

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [canUpdate, setCanUpdate] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hash = window.location.hash || '';
    const hasRecoveryHash = hash.includes('type=recovery');
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type');

    if (tokenHash && type === 'recovery') {
      if (processedToken === tokenHash) {
        supabase.auth.getSession().then(({ data }) => {
          setCanUpdate(!!data.session);
        });
        return;
      }

      processedToken = tokenHash;
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        .then(({ error }) => {
          if (error) {
            setCanUpdate(false);
          } else {
            setCanUpdate(true);
          }
          window.history.replaceState({}, '', '/update-password');
        });
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setCanUpdate(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setCanUpdate(true);
        return;
      }
      if (!hasRecoveryHash) {
        setCanUpdate(false);
      }
    });

    if (hasRecoveryHash) {
      timerRef.current = setTimeout(() => {
        setCanUpdate((prev) => (prev === null ? false : prev));
      }, 3000);
    }

    return () => {
      subscription.unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Senha atualizada com sucesso');
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/60">
        <CardHeader className="text-center pb-4">
          <img src={logo} alt="Logo" className="mx-auto mb-4 h-40 w-auto object-contain" />
          <CardDescription className="text-[13px]">Definir nova senha</CardDescription>
        </CardHeader>
        <CardContent>
          {canUpdate === null && (
            <div className="flex flex-col items-center gap-2 py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">Validando link…</p>
            </div>
          )}

          {canUpdate === false && (
            <div className="space-y-3 py-2">
              <p className="text-[13px] text-center text-muted-foreground">
                Link inválido ou expirado.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Voltar ao login
              </Button>
            </div>
          )}

          {canUpdate === true && (
            <form onSubmit={handleSubmit} className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-[13px]">Nova senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-[13px]">Confirmar senha</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Atualizar senha
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
