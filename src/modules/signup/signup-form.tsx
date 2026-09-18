/**
 * Mission 01, lot 4 — Formulaire d'inscription client, étape 1 « Créer mon compte »
 * (décision P-4). Un seul formulaire pour deux usages :
 *   - `web`   : page publique /inscription ; le client choisit son mot de passe ;
 *   - `kiosk` : borne du comptoir /borne ; AUCUN mot de passe saisi sur la tablette
 *     partagée, AUCUNE auto-complétion, aucun lien sortant ; l'invitation « choisir
 *     mon mot de passe » part par e-mail.
 * La logique serveur est dans signup.functions.ts.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Mail, PhoneCall, ShieldCheck, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PhoneInput } from '@/components/phone-input';
import { MotoPicker, isMotoComplete, type MotoChoice } from '@/components/moto-picker';
import { splitPhone } from '@/lib/dial-codes';
import { clientAppHost, clientAppUrl } from '@/lib/client-app-url';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import {
  SIGNUP_INTERESTS, startSignup, submitSignup, type SignupErrorCode, type SignupResult,
} from './signup.functions';

export type SignupMode = 'web' | 'kiosk';
export type SignupSuccess = Extract<SignupResult, { status: 'ok' }> & { email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Délai entre deux tentatives quand la connexion est tombée. */
const RETRY_MS = 5_000;

type Errors = Partial<Record<'first_name' | 'last_name' | 'email' | 'password' | 'confirm' | 'moto', string>>;

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="border-b border-border pb-2 text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
      {children}
    </h2>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[13px] text-danger" role="alert">{msg}</p>;
}

export function SignupForm({ mode, initialEmail, onSuccess }: {
  mode: SignupMode;
  initialEmail?: string;
  onSuccess: (r: SignupSuccess) => void;
}) {
  const kiosk = mode === 'kiosk';
  const ac = kiosk ? 'off' : undefined;
  const inputCls = kiosk ? 'h-12 text-[16px]' : undefined;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [moto, setMoto] = useState<MotoChoice | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [recontact, setRecontact] = useState(false);
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const [ticket, setTicket] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<SignupErrorCode | 'offline' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const loadTicket = async () => {
    try {
      const r = await startSignup();
      if (alive.current) setTicket(r.ticket);
    } catch {
      // Hors ligne à l'affichage : on réessaiera à l'envoi.
    }
  };

  useEffect(() => {
    alive.current = true;
    void loadTicket();
    return () => {
      alive.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const toggleInterest = (k: string) =>
    setInterests((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const validate = (): boolean => {
    const e: Errors = {};
    if (!firstName.trim()) e.first_name = t('signup.errors.required');
    if (!lastName.trim()) e.last_name = t('signup.errors.required');
    if (!EMAIL_RE.test(email.trim())) e.email = t('signup.errors.email');
    if (!isMotoComplete(moto)) e.moto = t('signup.errors.moto');
    if (!kiosk) {
      if (password.length < 8) e.password = t('signup.errors.passwordShort');
      else if (password !== confirm) e.confirm = t('signup.errors.passwordMismatch');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const send = async (): Promise<void> => {
    let tk = ticket;
    setSubmitting(true);
    setFormError(null);
    try {
      if (!tk) {
        // Ticket manquant (connexion tombée à l'affichage) : on en demande un et on
        // laisse le délai minimal s'écouler avant l'envoi.
        const r = await startSignup();
        tk = r.ticket;
        setTicket(tk);
        await new Promise((res) => setTimeout(res, 4_500));
      }
      const local = splitPhone(phone).local.trim();
      const res = await submitSignup({
        data: {
          mode,
          ticket: tk,
          website: honeypot,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: local ? phone.trim() : undefined,
          password: kiosk ? undefined : password,
          moto: moto!,
          interests: interests as (typeof SIGNUP_INTERESTS)[number][],
          marketing_consent: consent,
          recontact,
          message: recontact && message.trim() ? message.trim() : undefined,
          origin: clientAppUrl(),
        },
      });
      if (!alive.current) return;
      if (res.status === 'ok') {
        onSuccess({ ...res, email: email.trim().toLowerCase() });
        return;
      }
      setFormError(res.code);
      if (res.code === 'expired') { setTicket(null); void loadTicket(); }
    } catch (err) {
      if (!alive.current) return;
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const network = offline || (err instanceof TypeError);
      if (network) {
        // Connexion tombée : message clair et nouvelle tentative automatique.
        setFormError('offline');
        retryTimer.current = setTimeout(() => { if (alive.current) void sendRef.current(); }, RETRY_MS);
        return;
      }
      setFormError('generic');
    } finally {
      if (alive.current) setSubmitting(false);
    }
  };

  // La nouvelle tentative utilise toujours les valeurs à jour du formulaire.
  const sendRef = useRef(send);
  sendRef.current = send;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting || formError === 'offline') return;
    if (!validate()) {
      setFormError(null);
      return;
    }
    void send();
  };

  const errorText = (code: SignupErrorCode | 'offline'): string => {
    switch (code) {
      case 'account_exists': return kiosk ? t('signup.errors.accountExistsKiosk') : t('signup.errors.accountExists');
      case 'too_fast': return t('signup.errors.tooFast');
      case 'expired': return t('signup.errors.expired');
      case 'closed': return t('signup.errors.closed');
      case 'invalid': return t('signup.errors.invalid');
      case 'offline': return t('signup.errors.offline');
      default: return t('signup.errors.generic');
    }
  };

  const labelCls = 'text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground';

  return (
    <form onSubmit={onSubmit} autoComplete={ac} noValidate className="space-y-8">
      {/* Champ piège : invisible pour un humain, rempli par les robots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="signup-website">{t('signup.honeypot')}</label>
        <input id="signup-website" name="website" type="text" tabIndex={-1} autoComplete="off"
          value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      {/* Vous */}
      <section className="space-y-4">
        <SectionTitle>{t('signup.sectionYou')}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="su-first" className={labelCls}>{t('signup.firstName')} *</Label>
            <Input id="su-first" autoComplete={ac ?? 'given-name'} value={firstName}
              onChange={(e) => setFirstName(e.target.value)} className={inputCls} aria-invalid={!!errors.first_name} />
            <FieldError msg={errors.first_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-last" className={labelCls}>{t('signup.lastName')} *</Label>
            <Input id="su-last" autoComplete={ac ?? 'family-name'} value={lastName}
              onChange={(e) => setLastName(e.target.value)} className={inputCls} aria-invalid={!!errors.last_name} />
            <FieldError msg={errors.last_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-email" className={labelCls}>{t('signup.email')} *</Label>
            <Input id="su-email" type="email" inputMode="email" autoComplete={ac ?? 'email'} autoCapitalize="none"
              spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls}
              aria-invalid={!!errors.email} />
            <FieldError msg={errors.email} />
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>{t('signup.phone')}</Label>
            <PhoneInput value={phone} onChange={setPhone} />
          </div>
        </div>
      </section>

      {/* Moto */}
      <section className="space-y-4">
        <SectionTitle>{t('signup.sectionMoto')} *</SectionTitle>
        <MotoPicker value={moto} onChange={setMoto} size={kiosk ? 'kiosk' : 'default'} autoComplete={ac} />
        <FieldError msg={errors.moto} />
      </section>

      {/* Intérêts */}
      <section className="space-y-4">
        <SectionTitle>{t('signup.sectionInterests')}</SectionTitle>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SIGNUP_INTERESTS.map((k) => {
            const on = interests.includes(k);
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => toggleInterest(k)}
                className={cn(
                  'flex items-center gap-3 rounded-md border border-border bg-card px-3 text-left transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  kiosk ? 'min-h-14 text-[16px]' : 'min-h-11 text-[14px]',
                  on && 'border-primary bg-[var(--ducati-red-tint)]',
                )}>
                <span className={cn('grid size-4 shrink-0 place-items-center rounded-sm border border-primary', on && 'bg-primary text-primary-foreground')}>
                  {on && <CheckCircle2 className="size-3" aria-hidden />}
                </span>
                <span>{t(`signup.interest.${k}`)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Mot de passe (en ligne seulement) */}
      <section className="space-y-4">
        <SectionTitle>{t('signup.sectionAccount')}</SectionTitle>
        {kiosk ? (
          <p className="flex items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-[14px] text-info">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('signup.kioskPasswordNote')}</span>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="su-pwd" className={labelCls}>{t('signup.password')} *</Label>
              <Input id="su-pwd" type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
              <p className="text-[12px] text-muted-foreground">{t('signup.passwordHint')}</p>
              <FieldError msg={errors.password} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-pwd2" className={labelCls}>{t('signup.passwordConfirm')} *</Label>
              <Input id="su-pwd2" type="password" autoComplete="new-password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
              <FieldError msg={errors.confirm} />
            </div>
          </div>
        )}
      </section>

      {/* Consentement et recontact */}
      <section className="space-y-4">
        <SectionTitle>{t('signup.sectionContact')}</SectionTitle>
        <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border border-border p-3', kiosk && 'p-4')}>
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className={cn('mt-0.5', kiosk && 'size-5')} />
          <span className={cn('space-y-1', kiosk ? 'text-[16px]' : 'text-[14px]')}>
            <span className="block">{t('signup.consent')}</span>
            <span className="block text-[12px] text-muted-foreground">{t('signup.consentHint')}</span>
          </span>
        </label>
        <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border border-border p-3', kiosk && 'p-4')}>
          <Checkbox checked={recontact} onCheckedChange={(v) => setRecontact(v === true)} className={cn('mt-0.5', kiosk && 'size-5')} />
          <span className={cn('space-y-1', kiosk ? 'text-[16px]' : 'text-[14px]')}>
            <span className="flex items-center gap-2"><PhoneCall className="size-4 shrink-0" aria-hidden />{t('signup.recontact')}</span>
            <span className="block text-[12px] text-muted-foreground">{t('signup.recontactHint')}</span>
          </span>
        </label>
        {recontact && (
          <div className="space-y-1.5">
            <Label htmlFor="su-msg" className={labelCls}>{t('signup.message')}</Label>
            <Textarea id="su-msg" rows={3} autoComplete={ac} value={message} maxLength={1000}
              placeholder={t('signup.messagePlaceholder')} onChange={(e) => setMessage(e.target.value)}
              className={kiosk ? 'text-[16px]' : undefined} />
          </div>
        )}
        <button type="button" onClick={() => setPrivacyOpen(true)}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ShieldCheck className="size-4" aria-hidden />
          {t('signup.privacyLink')}
        </button>
      </section>

      {formError && (
        <p className={cn(
          'flex items-start gap-2 rounded-md px-3 py-2 text-[14px]',
          formError === 'offline' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger',
        )} role="alert">
          {formError === 'offline' && <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{errorText(formError)}</span>
        </p>
      )}

      <Button type="submit" size="lg" className={cn('w-full', kiosk && 'h-14 text-[16px]')}
        disabled={submitting || formError === 'offline'}>
        {(submitting || formError === 'offline') && <Loader2 className="animate-spin" />}
        {submitting || formError === 'offline' ? t('signup.submitting') : t('signup.submit')}
      </Button>

      {/* Données personnelles : en surimpression, jamais un lien sortant (borne). */}
      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signup.privacyTitle')}</DialogTitle>
            <DialogDescription>{t('signup.privacyIntro')}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-[14px]">
            <li>{t('signup.privacyUse')}</li>
            <li>{t('signup.privacyMarketing')}</li>
            <li>{t('signup.privacyRights')}</li>
          </ul>
          <Button type="button" variant="outline" onClick={() => setPrivacyOpen(false)}>{t('signup.close')}</Button>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** Message de bienvenue (décision K / K-4) : l'adresse est celle de l'application CLIENT. */
export function SignupWelcome({ result, mode, footer }: {
  result: SignupSuccess;
  mode: SignupMode;
  footer?: ReactNode;
}) {
  const kiosk = mode === 'kiosk';
  const host = clientAppHost();
  return (
    <div className="space-y-5 text-center" role="status" aria-live="polite">
      <CheckCircle2 className={cn('mx-auto text-success', kiosk ? 'size-16' : 'size-12')} aria-hidden />
      <h2 className={cn('font-display font-bold uppercase', kiosk ? 'text-[28px] leading-[34px]' : 'text-[22px] leading-[28px]')}>
        {t('signup.welcomeTitle')}
      </h2>
      <p className={kiosk ? 'text-[18px]' : 'text-[16px]'}>{t('signup.welcomeLine')}</p>
      <p className={kiosk ? 'text-[18px]' : 'text-[16px]'}>
        {t('signup.welcomeAddress')}{' '}
        <span className="font-bold text-foreground">{host}</span>
      </p>
      {result.invite === 'sent' && (
        <p className="mx-auto flex max-w-md items-start gap-2 rounded-md bg-info-bg px-3 py-2 text-left text-[14px] text-info">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {(mode === 'web' ? t('signup.welcomeConfirmEmail') : t('signup.welcomeInvite')).replace('{email}', result.email)}
          </span>
        </p>
      )}
      {result.invite === 'failed' && (
        <p className="mx-auto max-w-md rounded-md bg-warning-bg px-3 py-2 text-left text-[14px] text-warning">
          {t('signup.welcomeInviteFailed')}
        </p>
      )}
      {result.recontact && (
        <p className="mx-auto flex max-w-md items-start gap-2 text-left text-[14px] text-muted-foreground">
          <PhoneCall className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('signup.welcomeRecontact')}</span>
        </p>
      )}
      {footer}
    </div>
  );
}
