/**
 * M6 -- Ecran client sur tablette (PDV020) : le DESSIN de l ecran, sans aucun appel reseau.
 * Sert deux fois : la tablette plein ecran (/ecran-client, interactif) et l apercu reduit du vendeur
 * a la caisse (`preview`, non interactif). Tous les textes sont dans la langue de l ecran (`locale`,
 * celle du client si on la connait, I18N004), jamais dans celle du vendeur. Grands caracteres,
 * lisibles a 1 m. Couleurs de la charte uniquement ; le rouge Ducati ne sert qu a l identite.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, CreditCard, Loader2, Mail, PenLine, QrCode, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from '@/modules/documents/signature-pad';
import { LOCALES, tIn, fillVars, type Locale } from '@/lib/i18n';
import { buildEpcPayload, formatIban } from './epc-qr';
import { QrCodeSvg } from './qr-code-svg';
import { amountToPay, isScreenEmail, type ResolvedScreen, type ScreenMethod, type ScreenSnapshot } from './customer-screen';

const money = (n: number, locale: Locale) =>
  `${new Intl.NumberFormat(`${locale}-BE`, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const timeOf = (iso: string | null | undefined, locale: Locale) =>
  iso ? new Date(iso).toLocaleTimeString(`${locale}-BE`, { hour: '2-digit', minute: '2-digit' }) : '';

const LOCALE_KEY: Record<Locale, string> = { fr: 'langFr', nl: 'langNl', en: 'langEn', it: 'langIt' };

export type CustomerScreenViewProps = {
  snapshot: ScreenSnapshot | null;
  resolved: ResolvedScreen;
  locale: Locale;
  companyName: string;
  registerCode?: string | null;
  /** Le client peut choisir sa langue (langue inconnue). */
  chooseLocale?: boolean;
  onLocale?: (l: Locale) => void;
  /** Apercu du vendeur : pas d interaction, hauteur du cadre. */
  preview?: boolean;
  onEmail?: (email: string) => Promise<void>;
  onSignature?: (png: string, signerName: string) => Promise<void>;
};

export function CustomerScreenView(props: CustomerScreenViewProps) {
  const { snapshot, resolved, locale, companyName, registerCode, chooseLocale, onLocale, preview } = props;
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const p = snapshot?.payload ?? {};

  let body;
  switch (resolved.mode) {
    case 'ticket':
      body = <TicketBody {...props} stage={resolved.stage} />;
      break;
    case 'qr':
      body = <QrBody {...props} resolved={resolved} />;
      break;
    case 'terminal':
      body = (
        <div className="flex flex-col items-center gap-8 text-center">
          <CreditCard className="size-32 text-info" aria-hidden />
          <p className="font-display text-[56px] uppercase leading-tight">{tc('terminalTitle')}</p>
          <Amount label={tc('toPay')} value={money(resolved.amount, locale)} />
          <p className="max-w-3xl text-[28px] text-muted-foreground">{tc('terminalSub')}</p>
        </div>
      );
      break;
    case 'signature':
      body = <SignatureBody {...props} resolved={resolved} />;
      break;
    case 'merci':
      body = <ThanksBody {...props} resolved={resolved} />;
      break;
    default:
      body = (
        <div className="flex flex-col items-center gap-6 text-center">
          <img src="/brands/ducati.webp" alt={tIn(locale, 'app.name')} className="h-32 w-auto object-contain" />
          <span className="h-1 w-24 bg-primary" aria-hidden />
          <p className="text-[36px] text-muted-foreground">{tc('welcomeTitle')}</p>
          <p className="font-display text-[64px] uppercase leading-tight">{companyName || tIn(locale, 'app.name')}</p>
          <p className="text-[26px] text-muted-foreground">{p.message || tc('welcomeSub')}</p>
        </div>
      );
  }

  const showLocales = !!chooseLocale && (resolved.mode === 'accueil' || resolved.mode === 'ticket');
  return (
    <div className={`relative flex flex-col bg-background text-foreground ${preview ? 'h-full' : 'min-h-screen'}`}>
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <span className="h-10 w-1.5 bg-primary" aria-hidden />
        <span className="font-display text-[26px] uppercase">{companyName || tIn(locale, 'app.name')}</span>
        {registerCode && <span className="font-data text-[18px] text-muted-foreground">{fillVars(tc('registerLabel'), { register: registerCode })}</span>}
        {showLocales && (
          <nav className="ml-auto flex items-center gap-2" aria-label={tc('chooseLanguage')}>
            {LOCALES.map((l) => (
              <Button
                key={l} type="button" size="lg" variant={l === locale ? 'secondary' : 'outline'}
                className={`h-14 min-w-28 text-[20px] ${l === locale ? 'border-2 border-foreground font-bold' : ''}`} disabled={preview}
                onClick={() => onLocale?.(l)} aria-pressed={l === locale}
              >
                {tIn(l, `customerScreen.${LOCALE_KEY[l]}`)}
              </Button>
            ))}
          </nav>
        )}
      </header>
      <main className="grid flex-1 place-items-center p-8">{body}</main>
    </div>
  );
}

function Amount({ label, value, big = true }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[20px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{label}</span>
      <span className={`font-data font-extrabold leading-none tabular-nums ${big ? 'text-[96px]' : 'text-[56px]'}`}>{value}</span>
    </div>
  );
}

function TicketBody({ snapshot, locale, stage }: CustomerScreenViewProps & { stage: 'saisie' | 'a_payer' }) {
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const p = snapshot?.payload ?? {};
  const lines = p.lines ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [lines.length]);
  const methods = p.methods ?? [];

  return (
    <div className="grid h-full w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col rounded-[var(--radius-card)] border border-border bg-card">
        <div className="flex items-baseline gap-4 border-b border-border px-6 py-4">
          <h1 className="font-display text-[30px] uppercase">{tc('ticketTitle')}</h1>
          {p.document_number && <span className="font-mono text-[20px] text-muted-foreground">{fillVars(tc('docNumber'), { number: p.document_number })}</span>}
          {p.customer_name && <span className="ml-auto truncate text-[22px]">{p.customer_name}</span>}
        </div>
        <div ref={listRef} className="max-h-[60vh] flex-1 overflow-auto">
          <table className="w-full border-collapse font-data text-[24px]">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-[16px] uppercase tracking-[var(--tracking-label)] text-muted-foreground">
                <th className="px-6 py-2 text-left">{tc('colArticle')}</th>
                <th className="px-3 py-2 text-right">{tc('colQty')}</th>
                <th className="px-3 py-2 text-right">{tc('colUnit')}</th>
                <th className="px-6 py-2 text-right">{tc('colTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">{tc('emptyTicket')}</td></tr>}
              {lines.map((l, i) => l.text ? (
                <tr key={i} className="border-b border-border"><td colSpan={4} className="px-6 py-2 text-[20px] text-muted-foreground">{l.designation}</td></tr>
              ) : (
                <tr key={i} className="border-b border-border align-top">
                  <td className="px-6 py-3">
                    <span className="block">{l.designation}</span>
                    {l.discount_pct > 0 && <span className="block text-[18px] text-success">{fillVars(tc('discount'), { pct: l.discount_pct })}</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(l.unit_ttc, locale)}</td>
                  <td className="px-6 py-3 text-right font-bold tabular-nums">{money(l.total_ttc, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="flex flex-col justify-center gap-5 font-data text-[24px]">
        <Row label={tc('totalHt')} value={money(p.totals?.ht ?? 0, locale)} />
        {(p.vat ?? []).filter((v) => v.vat !== 0).map((v) => (
          <Row key={v.rate} label={fillVars(tc('vatLine'), { rate: v.rate })} value={money(v.vat, locale)} />
        ))}
        {(p.vat ?? []).length === 0 && (p.totals?.vat ?? 0) !== 0 && <Row label={tc('vatTotal')} value={money(p.totals!.vat, locale)} />}
        {(p.totals?.discount ?? 0) > 0.004 && <Row label={tc('savings')} value={money(p.totals!.discount, locale)} tone="success" />}
        <div className="border-t-2 border-foreground pt-4">
          {stage === 'a_payer'
            ? <Amount label={tc('toPay')} value={money(amountToPay(p), locale)} />
            : <Amount label={tc('totalTtc')} value={money(p.totals?.ttc ?? 0, locale)} big={false} />}
        </div>
        {stage === 'a_payer' && methods.length > 0 && (
          <div className="space-y-3">
            <p className="text-[18px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{tc('methodsTitle')}</p>
            <ul className="space-y-2 text-[24px]">{methods.map((m) => <MethodItem key={m} method={m} locale={locale} />)}</ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function MethodItem({ method, locale }: { method: ScreenMethod; locale: Locale }) {
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const map: Record<ScreenMethod, { icon: typeof CreditCard; key: string }> = {
    card: { icon: CreditCard, key: 'methodCard' },
    cash: { icon: Banknote, key: 'methodCash' },
    qr_sepa: { icon: QrCode, key: 'methodQrSepa' },
    qr_stripe: { icon: QrCode, key: 'methodQrStripe' },
  };
  const m = map[method];
  if (!m) return null;
  const Icon = m.icon;
  return <li className="flex items-center gap-3"><Icon className="size-8 text-info" aria-hidden /> {tc(m.key)}</li>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className={`flex items-baseline justify-between gap-6 ${tone === 'success' ? 'text-success' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function QrBody({ snapshot, locale, resolved }: CustomerScreenViewProps & { resolved: Extract<ResolvedScreen, { mode: 'qr' }> }) {
  const tq = (key: string) => tIn(locale, `qrPay.${key}`);
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const bank = snapshot?.bank;
  const pay = resolved.payment;
  const value = useMemo(() => {
    if (resolved.qr.kind !== 'sepa') return resolved.qr.url;
    if (!bank?.iban || !pay) return null;
    const ref = pay.reference ?? '';
    try {
      return buildEpcPayload({
        name: bank.beneficiary, iban: bank.iban, bic: bank.bic, amount: resolved.amount,
        structuredReference: ref.startsWith('+++') ? ref : null, text: ref.startsWith('+++') ? null : ref,
      });
    } catch { return null; }
  }, [resolved, bank, pay]);
  if (!value) return null;
  const sepa = resolved.qr.kind === 'sepa';
  return (
    <div className="grid w-full max-w-6xl items-center gap-10 md:grid-cols-2">
      <div className="flex flex-col items-center gap-4">
        <QrCodeSvg value={value} label={tq('qrAlt')} className="aspect-square w-full max-w-[min(64vh,560px)]" />
        <p className="text-center text-[24px] font-bold">{sepa ? tq('scan') : tc('qrLinkScan')}</p>
      </div>
      <dl className="space-y-6">
        {pay?.customer_name && <Field label={tq('customer')} value={pay.customer_name} />}
        <Amount label={tq('amountToPay')} value={money(resolved.amount, locale)} />
        {sepa && bank && <Field label={tq('beneficiary')} value={bank.beneficiary} />}
        {sepa && bank?.iban && <Field label={tq('iban')} value={formatIban(bank.iban)} mono />}
        {sepa && pay?.reference && <Field label={tq('communication')} value={pay.reference} mono />}
        {!sepa && 'expires_at' in resolved.qr && resolved.qr.expires_at && (
          <p className="text-[22px] text-muted-foreground">{fillVars(tc('qrExpires'), { time: timeOf(resolved.qr.expires_at, locale) })}</p>
        )}
        {sepa && (
          <p className="flex items-center gap-3 rounded-[var(--radius-card)] bg-warning-bg px-5 py-4 text-[22px] text-warning">
            <Clock className="size-8 shrink-0" aria-hidden /> {tq('waiting')}
          </p>
        )}
      </dl>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[18px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} break-all text-[32px] font-bold`}>{value}</dd>
    </div>
  );
}

function SignatureBody({ locale, resolved, preview, onSignature }: CustomerScreenViewProps & { resolved: Extract<ResolvedScreen, { mode: 'signature' }> }) {
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const [png, setPng] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  if (resolved.signed) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <CheckCircle2 className="size-32 text-success" aria-hidden />
        <p className="font-display text-[48px] uppercase text-success">{tc('signDone')}</p>
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <h1 className="flex items-center gap-3 font-display text-[40px] uppercase"><PenLine className="size-10" aria-hidden /> {resolved.signature.title}</h1>
      <p className="whitespace-pre-line text-[26px] leading-snug">{resolved.signature.text}</p>
      <p className="text-[20px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{tc('signHere')}</p>
      {preview
        ? <div className="aspect-[560/180] w-full rounded-[var(--radius-card)] border border-border bg-card" />
        : <SignaturePad onChange={setPng} hint={tc('signHere')} clearLabel={tc('signClear')} />}
      <div className="flex flex-wrap items-center gap-4">
        <Input
          value={name} onChange={(e) => setName(e.target.value)} placeholder={tc('signerName')} disabled={preview}
          className="h-16 max-w-md text-[24px]" maxLength={120} autoComplete="off"
        />
        <Button
          type="button" size="lg" className="ml-auto h-16 px-8 text-[24px]" disabled={preview || !png || state === 'busy'}
          onClick={async () => {
            if (!png || !onSignature) return;
            setState('busy');
            try { await onSignature(png, name.trim()); setState('idle'); } catch { setState('error'); }
          }}
        >
          {state === 'busy' ? <Loader2 className="size-6 animate-spin" /> : <CheckCircle2 className="size-6" />} {tc('signValidate')}
        </Button>
      </div>
      {state === 'error' && <p className="rounded-[var(--radius-card)] bg-danger-bg px-5 py-3 text-[22px] text-danger">{tc('signError')}</p>}
    </div>
  );
}

function ThanksBody({ locale, resolved, preview, onEmail }: CustomerScreenViewProps & { resolved: Extract<ResolvedScreen, { mode: 'merci' }> }) {
  const tc = (key: string) => tIn(locale, `customerScreen.${key}`);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'invalid' | 'error'>('idle');
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <CheckCircle2 className="size-32 text-success" aria-hidden />
      <p className="font-display text-[56px] uppercase leading-tight text-success">{tc('thanksTitle')}</p>
      {resolved.amount != null && <p className="font-data text-[48px] font-bold tabular-nums">{money(resolved.amount, locale)}</p>}
      <p className="text-[28px] text-muted-foreground">{tc('thanksSub')}</p>
      {resolved.allowEmail && (resolved.emailSent ? (
        <p className="flex items-center gap-3 rounded-[var(--radius-card)] bg-success-bg px-6 py-4 text-[24px] text-success"><Mail className="size-8" aria-hidden /> {tc('emailDone')}</p>
      ) : (
        <form
          className="mt-4 flex w-full max-w-3xl flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!isScreenEmail(email)) { setState('invalid'); return; }
            if (!onEmail) return;
            setState('busy');
            try { await onEmail(email.trim()); setState('idle'); } catch { setState('error'); }
          }}
        >
          <label htmlFor="screen-email" className="flex items-center justify-center gap-3 text-[26px] font-bold"><Mail className="size-8" aria-hidden /> {tc('emailAsk')}</label>
          <div className="flex gap-3">
            <Input
              id="screen-email" type="email" inputMode="email" autoComplete="off" value={email} disabled={preview}
              onChange={(e) => { setEmail(e.target.value); setState('idle'); }} placeholder={tc('emailPlaceholder')}
              className="h-16 flex-1 text-[26px]" maxLength={254}
            />
            <Button type="submit" size="lg" className="h-16 px-8 text-[24px]" disabled={preview || state === 'busy' || !email.trim()}>
              {state === 'busy' ? <Loader2 className="size-6 animate-spin" /> : <Mail className="size-6" />} {tc('emailSend')}
            </Button>
          </div>
          {state === 'invalid' && <p className="text-[22px] text-danger">{tc('emailInvalid')}</p>}
          {state === 'error' && <p className="text-[22px] text-danger">{tc('emailError')}</p>}
        </form>
      ))}
    </div>
  );
}

/**
 * Apercu reduit pour le vendeur : l ecran dessine a 1280 x 800 puis mis a l echelle du cadre.
 */
export function CustomerScreenPreview(props: Omit<CustomerScreenViewProps, 'preview'> & { width?: number }) {
  const width = props.width ?? 320;
  const scale = width / 1280;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-background" style={{ width, height: 800 * scale }} aria-hidden>
      <div style={{ width: 1280, height: 800, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="pointer-events-none">
        <CustomerScreenView {...props} preview />
      </div>
    </div>
  );
}
