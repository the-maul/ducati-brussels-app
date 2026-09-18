/**
 * M0 — Choisir (ou changer) son mot de passe.
 *
 * Deux façons d'arriver ici :
 *   1. par le lien de l'e-mail d'invitation (send-account-invitation) :
 *      /reset-password?token_hash=…&type=recovery
 *      Le jeton n'est consommé qu'au moment où la personne valide le formulaire.
 *      Un antivirus qui ouvre les liens des e-mails ne peut donc pas le griller.
 *   2. déjà connecté, depuis le menu utilisateur (« Changer mon mot de passe ») :
 *      utile pour quitter le mot de passe commun provisoire.
 * Après validation : le personnel va sur /dashboard, un client sur /mon-espace.
 *
 * Règles du mot de passe : src/lib/password-policy.ts (décision U-4), avec l'indicateur
 * des règles remplies. Après tout changement réussi, un e-mail « Votre mot de passe a
 * été modifié » part par Outlook (décision U-5), sans jamais contenir le mot de passe.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { resolveHomePath } from '@/lib/auth/home-path';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput, PasswordRules } from '@/components/password-field';
import { isStrongPassword } from '@/lib/password-policy';
import { notifyPasswordChanged } from '@/lib/auth/password-notify';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: 'Mot de passe — Ducati Bruxelles' }] }),
  // Paramètres facultatifs : absents quand on vient du menu « Changer mon mot de passe ».
  validateSearch: (s: Record<string, unknown>): { token_hash?: string; type?: string } => ({
    ...(typeof s.token_hash === 'string' ? { token_hash: s.token_hash } : {}),
    ...(typeof s.type === 'string' ? { type: s.type } : {}),
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token_hash } = Route.useSearch();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viaLink = !!token_hash;
  const canUse = viaLink || !!session;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isStrongPassword(password)) { setError(t('pwd.tooShort')); return; }
    if (password !== confirm) { setError(t('pwd.mismatch')); return; }
    setSubmitting(true);
    try {
      if (viaLink) {
        const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: token_hash!, type: 'recovery' });
        if (vErr) { setError(t('pwd.linkInvalid')); return; }
      }
      const { error: uErr } = await supabase.auth.updateUser({ password });
      if (uErr) { setError(uErr.message); return; }

      // Mail de sécurité « Votre mot de passe a été modifié » (sans le mot de passe).
      // Un échec d'envoi ne bloque pas la personne.
      await notifyPasswordChanged();

      // Membre de l'équipe → l'application. Client → son espace (/mon-espace).
      const { data: { user } } = await supabase.auth.getUser();
      navigate({ to: await resolveHomePath(user?.id) });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : t('auth.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-xl font-bold text-primary-foreground">D</span>
          <h1 className="text-center font-display text-[28px] font-bold uppercase leading-[34px] text-foreground">Ducati Bruxelles</h1>
        </div>

        <div className="space-y-4 rounded-md border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-[16px] font-medium">{viaLink ? t('pwd.titleChoose') : t('pwd.titleChange')}</h2>

          {loading && !viaLink ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : !canUse ? (
            <>
              <p className="text-[13px] text-muted-foreground">{t('pwd.noLink')}</p>
              <Button className="w-full" onClick={() => navigate({ to: '/login' })}>{t('pwd.toLogin')}</Button>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pwd1" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pwd.new')}</Label>
                <PasswordInput id="pwd1" required value={password} onChange={(e) => setPassword(e.target.value)} inputClassName="h-11 lg:h-10" />
                <PasswordRules value={password} className="pt-1 sm:grid-cols-1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pwd2" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('pwd.confirm')}</Label>
                <PasswordInput id="pwd2" required value={confirm} onChange={(e) => setConfirm(e.target.value)} inputClassName="h-11 lg:h-10" />
              </div>
              {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}
              <Button type="submit" className="h-11 w-full" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />} {t('pwd.save')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
