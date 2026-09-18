/**
 * M0 — Connexion.
 * Propose aussi « Pas encore de compte ? Créer mon compte » (→ /inscription) et
 * « Mot de passe oublié ? » : formulaire e-mail qui fait envoyer un lien de
 * réinitialisation par Outlook (src/lib/auth/password-reset.ts). Le message affiché
 * est toujours le même, que le compte existe ou non.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { resolveHomePath } from '@/lib/auth/home-path';
import { requestPasswordReset } from '@/lib/auth/password-reset';
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
  // « Mot de passe oublié ? »
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const openForgot = () => {
    setResetEmail(email);
    setResetSent(false);
    setResetError(null);
    setMode('forgot');
  };
  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetSending(true);
    try {
      const ok = await requestPasswordReset(resetEmail);
      if (ok) setResetSent(true);
      else setResetError(t('auth.forgotError'));
    } finally {
      setResetSending(false);
    }
  };

  // Déjà connecté → tableau de bord (personnel) ou espace client (client).
  useEffect(() => {
    if (loading || !session) return;
    let cancelled = false;
    resolveHomePath(session.user.id).then((to) => { if (!cancelled) navigate({ to }); });
    return () => { cancelled = true; };
  }, [loading, session, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data: signed, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        // On affiche le message réel (en plus du libellé convivial) pour pouvoir diagnostiquer.
        setError(
          err.message.toLowerCase().includes('invalid')
            ? t('auth.invalidCredentials')
            : err.message,
        );
        return;
      }
      navigate({ to: await resolveHomePath(signed.user?.id) });
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

        {mode === 'forgot' ? (
          <div className="space-y-4 rounded-md border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <h2 className="text-[16px] font-medium">{t('auth.forgot')}</h2>
            {resetSent ? (
              <p className="rounded-md bg-muted px-3 py-2 text-[13px]" role="status">
                {t('auth.forgotSent')}
                <span className="mt-1 block text-[12px] text-muted-foreground">{t('auth.forgotHint')}</span>
              </p>
            ) : (
              <form onSubmit={onForgot} className="space-y-4">
                <p className="text-[13px] text-muted-foreground">{t('auth.forgotIntro')}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                    {t('auth.email')}
                  </Label>
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="h-11 lg:h-10"
                  />
                </div>
                {resetError && (
                  <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger" role="alert">{resetError}</p>
                )}
                <Button type="submit" className="h-11 w-full" disabled={resetSending}>
                  {resetSending && <Loader2 className="animate-spin" />}
                  {resetSending ? t('auth.forgotSending') : t('auth.forgotSend')}
                </Button>
              </form>
            )}
            <button
              type="button"
              onClick={() => setMode('login')}
              className="min-h-11 w-full text-center text-[13px] font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('auth.backToLogin')}
            </button>
          </div>
        ) : (
        <>
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

          <button
            type="button"
            onClick={openForgot}
            className="min-h-11 w-full text-center text-[13px] font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('auth.forgot')}
          </button>
        </form>

        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          {t('auth.noAccount')}{' '}
          <Link to="/inscription" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
            {t('auth.createAccount')}
          </Link>
        </p>
        </>
        )}
      </div>
    </main>
  );
}
