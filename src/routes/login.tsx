import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Connexion — Ducati Bruxelles' }] }),
  component: LoginPage,
});

function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Déjà connecté → dashboard
  useEffect(() => {
    if (!loading && session) navigate({ to: '/dashboard' });
  }, [loading, session, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        // On affiche le message réel (en plus du libellé convivial) pour pouvoir diagnostiquer.
        setError(
          err.message.toLowerCase().includes('invalid')
            ? t('auth.invalidCredentials')
            : err.message,
        );
        return;
      }
      navigate({ to: '/dashboard' });
    } catch (e2) {
      // Erreur réseau / client mal configuré : on ne laisse JAMAIS le spinner tourner.
      setError(e2 instanceof Error ? e2.message : t('auth.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-xl font-bold text-primary-foreground">
            D
          </span>
          <h1 className="text-center font-display text-[28px] font-bold uppercase leading-[34px] text-foreground">
            Ducati Bruxelles
          </h1>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-md border border-border bg-card p-6 shadow-[var(--shadow-card)]"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {t('auth.email')}
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              {t('auth.password')}
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </div>
    </main>
  );
}
