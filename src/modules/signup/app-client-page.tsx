/**
 * Page publique /app-client, mode « bientôt disponible » (décision W-5, 19/09).
 * Pensée téléphone d'abord : un visiteur arrive depuis le menu « Espace client »
 * du site Shopify. Présentation de ce qu'apportera l'application, formulaire
 * FACULTATIF « Prévenez-moi à l'ouverture », retour au site.
 * Le mode « ouvert » (redirection vers /inscription) est géré par la route.
 */
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Bike, CalendarClock, Check, FileText, Loader2, Medal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import {
  startAppClientNotify, submitAppClientNotify, type AppClientNotifyErrorCode,
} from './app-client.functions';

export const PUBLIC_SITE_URL = 'https://ducatibruxelles.be';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 space-y-1">
        <span className="block font-ui text-[15px] font-bold leading-5">{title}</span>
        <span className="block text-[14px] leading-5 text-muted-foreground">{text}</span>
      </span>
    </li>
  );
}

function errorText(code: AppClientNotifyErrorCode | 'email' | 'consent'): string {
  switch (code) {
    case 'email': return t('appClient.errors.email');
    case 'consent': return t('appClient.errors.consent');
    case 'too_fast': return t('appClient.errors.tooFast');
    case 'expired': return t('appClient.errors.expired');
    case 'rate_limited': return t('appClient.errors.rateLimited');
    default: return t('appClient.errors.generic');
  }
}

function NotifyForm() {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ field?: 'email' | 'consent'; msg: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    startAppClientNotify().then((r) => { if (alive.current) setTicket(r.ticket); }).catch(() => {});
    return () => { alive.current = false; };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) { setError({ field: 'email', msg: errorText('email') }); return; }
    if (!consent) { setError({ field: 'consent', msg: errorText('consent') }); return; }
    setError(null);
    setBusy(true);
    try {
      const tk = ticket ?? (await startAppClientNotify()).ticket;
      const r = await submitAppClientNotify({
        data: { ticket: tk, website: honeypot, email: value, consent: true, consent_text: t('appClient.consent') },
      });
      if (!alive.current) return;
      if (r.status === 'ok') { setDone(true); return; }
      setError({ msg: errorText(r.code) });
      if (r.code === 'expired') {
        const fresh = await startAppClientNotify();
        if (alive.current) setTicket(fresh.ticket);
      }
    } catch {
      if (alive.current) setError({ msg: errorText('generic') });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex gap-3 rounded-md border border-border bg-success-bg p-4" role="status">
        <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-ui text-[15px] font-bold">{t('appClient.doneTitle')}</p>
          <p className="text-[14px] text-muted-foreground">{t('appClient.doneText')}</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {/* Champ piège : invisible pour un humain, rempli par les robots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="ac-website">{t('appClient.honeypot')}</label>
        <input id="ac-website" name="website" type="text" tabIndex={-1} autoComplete="off"
          value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ac-email" className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
          {t('appClient.email')}
        </Label>
        <Input
          id="ac-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          placeholder={t('appClient.emailPlaceholder')} value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 text-[16px]" aria-invalid={error?.field === 'email'}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-5">
        <Checkbox
          checked={consent} onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5 size-5" aria-invalid={error?.field === 'consent'}
        />
        <span className="space-y-1">
          <span className="block">{t('appClient.consent')}</span>
          <span className="block text-[12px] text-muted-foreground">{t('appClient.consentHint')}</span>
        </span>
      </label>

      {error && <p className="text-[13px] text-danger" role="alert">{error.msg}</p>}

      <Button type="submit" size="lg" className="h-12 w-full text-[15px] sm:w-auto sm:px-8" disabled={busy}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        {busy ? t('appClient.submitting') : t('appClient.submit')}
      </Button>
    </form>
  );
}

export function AppClientComingSoon() {
  return (
    <main className="min-h-screen bg-background">
      {/* Bandeau d'identité */}
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <a href={PUBLIC_SITE_URL} className="flex min-h-11 items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-md bg-primary font-display text-lg font-bold text-primary-foreground">D</span>
            <span className="font-display text-[15px] font-bold uppercase tracking-[0.02em]">{t('appClient.brand')}</span>
          </a>
          <a href={PUBLIC_SITE_URL} aria-label={t('appClient.backToSite')} className="inline-flex min-h-11 min-w-11 items-center justify-end gap-1.5 text-[13px] font-medium underline-offset-2 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('appClient.backToSite')}</span>
          </a>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-8 sm:pb-14 sm:pt-12">
          <p className="text-[12px] font-bold uppercase tracking-[0.04em] opacity-80">{t('appClient.eyebrow')}</p>
          <h1 className="mt-2 font-display text-[26px] font-bold uppercase leading-[32px] sm:text-[34px] sm:leading-[40px]">
            {t('appClient.title')}
          </h1>
          <div className="mt-4 h-1 w-16 rounded-sm bg-primary" aria-hidden="true" />
          <p className="mt-4 max-w-xl text-[15px] leading-6 opacity-90">{t('appClient.intro')}</p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:py-10">
        <section className="space-y-4" aria-labelledby="ac-features">
          <h2 id="ac-features" className="font-ui text-[17px] font-bold leading-6">{t('appClient.featuresTitle')}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Bike className="size-5" />} title={t('appClient.features.bikeTitle')} text={t('appClient.features.bikeText')} />
            <Feature icon={<FileText className="size-5" />} title={t('appClient.features.invoicesTitle')} text={t('appClient.features.invoicesText')} />
            <Feature icon={<CalendarClock className="size-5" />} title={t('appClient.features.workshopTitle')} text={t('appClient.features.workshopText')} />
            <Feature icon={<Medal className="size-5" />} title={t('appClient.features.loyaltyTitle')} text={t('appClient.features.loyaltyText')} />
          </ul>
        </section>

        <section className="space-y-3 rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-6" aria-labelledby="ac-notify">
          <h2 id="ac-notify" className="font-ui text-[17px] font-bold leading-6">{t('appClient.notifyTitle')}</h2>
          <p className="text-[14px] text-muted-foreground">{t('appClient.notifyIntro')}</p>
          <NotifyForm />
        </section>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="outline" size="lg" className="h-12 text-[15px]">
            <a href={PUBLIC_SITE_URL}><ArrowLeft className="size-5" /> {t('appClient.backToSite')}</a>
          </Button>
          <p className="text-center text-[14px] text-muted-foreground sm:text-right">
            {t('appClient.alreadyClient')}{' '}
            <Link to="/login" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2">
              {t('appClient.signIn')}
            </Link>
          </p>
        </div>

        <p className="pb-4 text-center text-[12px] text-muted-foreground">{t('appClient.footer')}</p>
      </div>
    </main>
  );
}
