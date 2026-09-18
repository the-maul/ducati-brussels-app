/**
 * Mission 01, lot 4 — Page publique d'inscription client (étape 1 « Créer mon compte »).
 * Arrivée typique : le lien du pied de mail (décision P-5),
 *   /inscription?email=<destinataire>  → l'e-mail est pré-rempli.
 * Intégrable au site Shopify par un simple lien. Même formulaire que la borne.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SignupForm, SignupWelcome, type SignupSuccess } from '@/modules/signup/signup-form';
import { t } from '@/lib/i18n';

export const Route = createFileRoute('/inscription')({
  head: () => ({ meta: [{ title: t('signup.pageTitle') }] }),
  validateSearch: (s: Record<string, unknown>): { email?: string } => {
    const e = typeof s.email === 'string' ? s.email.trim().slice(0, 200) : '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { email: e.toLowerCase() } : {};
  },
  component: SignupPage,
});

function SignupPage() {
  const { email } = Route.useSearch();
  const [result, setResult] = useState<SignupSuccess | null>(null);

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-xl font-bold text-primary-foreground">D</span>
          <p className="text-center font-display text-[28px] font-bold uppercase leading-[34px] text-foreground">{t('signup.brand')}</p>
        </div>

        <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-8">
          {result ? (
            <SignupWelcome
              result={result}
              mode="web"
              footer={result.mail === 'welcome' ? (
                <Button asChild size="lg" className="h-12 w-full text-[15px]">
                  <Link to="/login">{t('signup.welcomeLogin')}</Link>
                </Button>
              ) : null}
            />
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-primary">{t('signup.stepLabel')}</p>
                <h1 className="font-display text-[28px] font-bold uppercase leading-[34px]">{t('signup.stepTitle')}</h1>
                <p className="text-[14px] text-muted-foreground">{t('signup.intro')}</p>
              </div>
              <SignupForm mode="web" initialEmail={email} onSuccess={setResult} />
              <p className="text-center text-[14px] text-muted-foreground">
                {t('signup.alreadyClient')}{' '}
                <Link to="/login" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2">{t('signup.signIn')}</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
