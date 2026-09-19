/**
 * Écran client du comptoir — « 2e écran » tourné vers le client (mission 02, carte 9 ; P-2 étape 1).
 * Ouvert par le vendeur dans une autre fenêtre (même session équipe) : affiche en très grand le QR de
 * virement SEPA, le montant, le bénéficiaire, la communication ; « Merci, paiement reçu » quand le vendeur
 * confirme, puis revient à l'accueil neutre. Mise à jour en direct (Realtime Supabase sur
 * counter_displays) + relecture toutes les 5 s en secours.
 * Seules données du client affichées : son nom et le montant.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { buildEpcPayload, formatIban } from './epc-qr';
import { QrCodeSvg } from './qr-code-svg';
import { getCounterDisplay, showOnCounterDisplay, subscribeCounterDisplay } from './qr-payment-api';
import { t } from '@/lib/i18n';

const THANKS_MS = 8000;
const eur = (n: number) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;

export function CustomerDisplay() {
  const { user, activeCompanyId, activeCompany } = useAuth();
  const qc = useQueryClient();
  const queryKey = ['counter-display', activeCompanyId];
  const displayQ = useQuery({
    queryKey,
    queryFn: () => getCounterDisplay(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  // Realtime : chaque changement de l'écran du vendeur relit l'état
  useEffect(() => {
    if (!user?.id) return;
    return subscribeCounterDisplay(user.id, () => { qc.invalidateQueries({ queryKey: ['counter-display'] }); });
  }, [user?.id, qc]);

  const state = displayQ.data;
  const status = state?.paymentId ? state.status : null;

  // « Merci » pendant quelques secondes, puis retour à l'accueil (l'écran est remis à zéro côté serveur)
  const [thanksFor, setThanksFor] = useState<string | null>(null);
  const cleared = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'recu' || !state?.paymentId || !activeCompanyId) return;
    const pid = state.paymentId;
    if (cleared.current === pid) return;
    const age = state.receivedAt ? Date.now() - new Date(state.receivedAt).getTime() : 0;
    const wait = Math.max(THANKS_MS - age, 0);
    setThanksFor(wait > 0 ? pid : null);
    const timer = window.setTimeout(() => {
      cleared.current = pid;
      setThanksFor(null);
      showOnCounterDisplay(activeCompanyId, null)
        .then(() => qc.invalidateQueries({ queryKey: ['counter-display'] }))
        .catch(() => { /* l'écran reste sur l'accueil local ; relu au prochain passage */ });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [status, state?.paymentId, state?.receivedAt, activeCompanyId, qc]);

  const payload = useMemo(() => {
    if (status !== 'attendu' || !state?.iban) return null;
    const ref = state.reference ?? '';
    try {
      return buildEpcPayload({
        name: state.beneficiary, iban: state.iban, bic: state.bic, amount: state.amount,
        structuredReference: ref.startsWith('+++') ? ref : null,
        text: ref.startsWith('+++') ? null : ref,
      });
    } catch {
      return null;
    }
  }, [status, state]);

  const companyName = state?.beneficiary ?? activeCompany?.name ?? '';

  const fullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => undefined);
  };

  let body;
  if (!activeCompanyId) {
    body = <p className="text-[22px] text-muted-foreground">{t('qrPay.noCompany')}</p>;
  } else if (status === 'attendu' && payload && state) {
    body = (
      <div className="grid w-full max-w-6xl items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-4">
          <QrCodeSvg value={payload} label={t('qrPay.qrAlt')} className="aspect-square w-full max-w-[min(70vh,560px)]" />
          <p className="text-center text-[20px] font-bold">{t('qrPay.scan')}</p>
        </div>
        <dl className="space-y-6">
          {state.customerName && <Field label={t('qrPay.customer')} value={state.customerName} />}
          <div>
            <dt className="text-[14px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{t('qrPay.amountToPay')}</dt>
            <dd className="font-data text-[72px] font-extrabold leading-none tabular-nums">{eur(state.amount)}</dd>
          </div>
          <Field label={t('qrPay.beneficiary')} value={state.beneficiary} />
          {state.iban && <Field label={t('qrPay.iban')} value={formatIban(state.iban)} mono />}
          {state.reference && <Field label={t('qrPay.communication')} value={state.reference} mono />}
          <p className="flex items-center gap-2 rounded-[var(--radius-card)] bg-warning-bg px-4 py-3 text-[18px] text-warning">
            <Clock className="size-6 shrink-0" /> {t('qrPay.waiting')}
          </p>
        </dl>
      </div>
    );
  } else if (thanksFor && status === 'recu') {
    body = (
      <div className="flex flex-col items-center gap-6 text-center">
        <CheckCircle2 className="size-32 text-success" />
        <p className="font-display text-[48px] uppercase leading-tight text-success">{t('qrPay.thanks')}</p>
        {state && <p className="font-data text-[40px] font-bold tabular-nums">{eur(state.amount)}</p>}
        <p className="text-[24px] text-muted-foreground">{t('qrPay.thanksSub')}</p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="h-1 w-24 bg-primary" />
        <p className="text-[28px] text-muted-foreground">{t('qrPay.welcome')}</p>
        <p className="font-display text-[56px] uppercase leading-tight">{companyName}</p>
        <p className="text-[22px] text-muted-foreground">{t('qrPay.welcomeSub')}</p>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-background p-8 text-foreground">
      {body}
      <Button variant="ghost" size="sm" className="absolute bottom-3 right-3 opacity-40 hover:opacity-100" onClick={fullscreen} title={t('qrPay.fullscreen')}>
        <Maximize className="size-4" />
      </Button>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[14px] font-bold uppercase tracking-[var(--tracking-label)] text-muted-foreground">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} break-all text-[28px] font-bold`}>{value}</dd>
    </div>
  );
}
