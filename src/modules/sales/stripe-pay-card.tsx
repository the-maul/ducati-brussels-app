/**
 * Mission 12, carte P3 -- PDV040 « Payer par QR (Bancontact / carte) », SANS SUPPLEMENT.
 * Dans le panneau de reglement (comptoir et document) : montant (reste a payer / acompte 10 % /
 * libre) et canal (comptoir : QR 30 min ; a distance : lien 24 h par mail ou SMS) -> la fonction
 * Edge `stripe-checkout` cree le reglement ATTENDU et la session Stripe du montant exact -> QR
 * affiche ici (et sur l ecran client appaire, mode « qr ») ; statut en direct (Realtime +
 * relecture 3 s) : attendu -> recu par le webhook Stripe, jamais a la main.
 * Sans cle Stripe, reglage desactive ou mode different : bouton masque, message.
 * Les frais Stripe s affichent pour l equipe (a charge du magasin), jamais au client.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, FlaskConical, Loader2, Mail, MessageSquare, MonitorUp, QrCode, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { useAuth } from '@/lib/auth/auth-context';
import { t, fillVars } from '@/lib/i18n';
import { errorMessage } from '@/lib/mutation-feedback';
import { QrCodeSvg } from './qr-code-svg';
import type { QrAmountChoice } from './epc-qr';
import {
  cancelStripeCheckout, createStripeCheckout, getStripeStatus, listStripePayments, publishStripeOnCustomerScreen,
  stripeStatusKey, subscribeDocumentPayments, type StripePaymentRow,
} from './stripe-pay-api';
import {
  minutesLeft, stripeMailtoLink, stripeProposedAmount, stripeReasonKey, stripeSmsLink, stripeStatusView, type StripeChannel,
} from './stripe-pay-rules';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function StripePayCard({ documentId, companyId, due, totalTtc, docNumber, customerName, customerEmail, customerPhone }: {
  documentId: string; companyId: string; due: number; totalTtc?: number;
  docNumber?: string | null; customerName?: string | null; customerEmail?: string | null; customerPhone?: string | null;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const statusQ = useQuery({ queryKey: stripeStatusKey(companyId), queryFn: () => getStripeStatus(companyId), staleTime: 60_000, retry: false });
  const paymentsQ = useQuery({
    queryKey: ['stripe-payments', documentId],
    queryFn: () => listStripePayments(documentId),
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => p.status === 'attendu') ? 3000 : false),
  });
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  // Numero du document rendu par la fonction serveur (la caisse ne le connait pas toujours).
  const [knownNumber, setKnownNumber] = useState<string | null>(null);
  const number = docNumber ?? knownNumber;

  // Realtime : chaque changement d un reglement du document relit la liste.
  useEffect(() => subscribeDocumentPayments(documentId, () => {
    qc.invalidateQueries({ queryKey: ['stripe-payments', documentId] });
  }), [documentId, qc]);

  const refreshDoc = () => {
    qc.invalidateQueries({ queryKey: ['stripe-payments', documentId] });
    qc.invalidateQueries({ queryKey: ['payments', documentId] });
    qc.invalidateQueries({ queryKey: ['doc-full', documentId] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['client-docs'] });
    qc.invalidateQueries({ queryKey: ['client-payments'] });
  };

  // attendu -> recu : on le dit et on rafraichit le document (reste a payer, statut).
  const previous = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const rows = paymentsQ.data;
    if (!rows) return;
    let changed = false;
    for (const p of rows) {
      const before = previous.current.get(p.id);
      if (before === 'attendu' && p.status !== 'attendu') {
        changed = true;
        if (p.status === 'recu') toast.success(fillVars(t('stripePay.paidToast'), { amount: eur(p.amount) }));
      }
    }
    previous.current = new Map(rows.map((p) => [p.id, p.status]));
    if (changed) refreshDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentsQ.data]);

  const cancel = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => cancelStripeCheckout(companyId, id, t('stripePay.cancel')),
    onSuccess: () => { toast.success(t('stripePay.cancelled')); setShown(null); refreshDoc(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const askCancel = async (id: string) => {
    if (await confirm({ title: t('stripePay.cancel'), message: t('stripePay.cancelConfirm'), confirmLabel: t('stripePay.cancel'), variant: 'delete' })) cancel.mutate(id);
  };

  const status = statusQ.data;
  const rows = paymentsQ.data ?? [];
  const reasonKey = statusQ.isError ? 'stripePay.unavailableOther' : stripeReasonKey(status?.reason);
  // Rien a montrer : ni bouton possible (pas de cle) ni historique Stripe sur ce document.
  if (statusQ.isLoading) return null;
  if (!status?.configured && rows.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">{t(reasonKey ?? 'stripePay.unavailableNoKey')}</p>;
  }
  const shownRow = rows.find((p) => p.id === shown) ?? null;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('stripePay.title')}</p>
        {status?.keyMode === 'test' && <StatusBadge tone="info" icon={FlaskConical} label={t('stripePay.testMode')} />}
        {status?.ready && (
          <Button size="sm" onClick={() => setCreating(true)} disabled={due < 0.5}><QrCode /> {t('stripePay.payByQr')}</Button>
        )}
      </div>
      {!status?.ready && reasonKey && <p className="rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t(reasonKey)}</p>}

      {rows.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {rows.map((p) => {
              const v = stripeStatusView(p.status);
              return (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="py-1.5"><StatusBadge tone={v.tone} icon={v.icon} label={t(v.labelKey)} /></td>
                  <td className="py-1.5 text-muted-foreground">
                    {p.channel === 'distance' ? t('stripePay.channelRemoteShort') : t('stripePay.channelCounterShort')}
                    {p.status === 'recu' && p.methodType && <> · {fillVars(t('stripePay.paidWith'), { method: methodLabel(p.methodType) })}</>}
                    {p.status === 'recu' && p.fee !== null && <> · {fillVars(t('stripePay.fee'), { fee: eur(p.fee) })}</>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{eur(p.amount)}</td>
                  <td className="py-1.5 text-right">
                    {p.status === 'attendu' && (
                      <div className="flex justify-end gap-1">
                        {p.url && <Button size="sm" variant="ghost" onClick={() => setShown(p.id)}><QrCode className="size-4" /> {t('stripePay.show')}</Button>}
                        <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => void askCancel(p.id)}><Ban className="size-4 text-danger" /> {t('stripePay.cancel')}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {status?.ready && <p className="text-[12px] text-muted-foreground">{t('stripePay.noSurcharge')}</p>}

      {creating && status && (
        <CreateDialog
          companyId={companyId} documentId={documentId} due={due} totalTtc={totalTtc ?? due} counterMinutes={status.settings.counterMinutes}
          onClose={() => setCreating(false)}
          onCreated={(paymentId, channel, url, expiresAt, amount, createdNumber) => {
            setCreating(false); setShown(paymentId); setKnownNumber(createdNumber); refreshDoc();
            if (channel === 'comptoir') {
              publishStripeOnCustomerScreen(companyId, 'qr', { paymentId, url, expiresAt, amount, documentNumber: createdNumber ?? number, customerName })
                .catch(() => undefined);
            }
          }}
        />
      )}
      {shownRow && (
        <ShowDialog
          row={shownRow} companyId={companyId} docNumber={number} customerName={customerName ?? null}
          customerEmail={customerEmail ?? null} customerPhone={customerPhone ?? null}
          onCancel={() => void askCancel(shownRow.id)} cancelling={cancel.isPending}
          onClose={() => setShown(null)}
        />
      )}
    </div>
  );
}

const methodLabel = (m: string) => (['bancontact', 'card', 'wero'].includes(m) ? t(`stripePay.method_${m}`) : m);

function CreateDialog({ companyId, documentId, due, totalTtc, counterMinutes, onClose, onCreated }: {
  companyId: string; documentId: string; due: number; totalTtc: number; counterMinutes: number;
  onClose: () => void;
  onCreated: (paymentId: string, channel: StripeChannel, url: string, expiresAt: string, amount: number, number: string | null) => void;
}) {
  const [choice, setChoice] = useState<QrAmountChoice>('solde');
  const [free, setFree] = useState('');
  const [channel, setChannel] = useState<StripeChannel>('comptoir');
  const amount = stripeProposedAmount(choice, due, totalTtc, num(free));
  const amountOk = amount >= 0.5 && amount <= due + 0.005;
  const create = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => createStripeCheckout(companyId, documentId, amount, channel),
    onSuccess: (r) => onCreated(r.paymentId, r.channel, r.url, r.expiresAt, r.amount, r.documentNumber),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const choices: { v: QrAmountChoice; label: string; amount: number | null }[] = [
    { v: 'solde', label: t('stripePay.choiceSolde'), amount: stripeProposedAmount('solde', due, totalTtc, 0) },
    { v: 'acompte10', label: t('stripePay.choiceAcompte'), amount: stripeProposedAmount('acompte10', due, totalTtc, 0) },
    { v: 'libre', label: t('stripePay.choiceLibre'), amount: null },
  ];
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('stripePay.dialogTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('stripePay.amountLabel')}</Label>
            <RadioGroup value={choice} onValueChange={(v) => setChoice(v as QrAmountChoice)}>
              {choices.map((c) => (
                <label key={c.v} className="flex items-center gap-2 text-[13px]">
                  <RadioGroupItem value={c.v} />
                  <span>{c.label}</span>
                  {c.amount !== null && <span className="ml-auto font-data tabular-nums">{eur(c.amount)}</span>}
                </label>
              ))}
            </RadioGroup>
            {choice === 'libre' && (
              <Input type="number" step="0.01" min="0.5" autoFocus value={free} onChange={(e) => setFree(e.target.value)} className="w-36 text-right tabular-nums" />
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('stripePay.channelLabel')}</Label>
            <RadioGroup value={channel} onValueChange={(v) => setChannel(v as StripeChannel)}>
              <label className="flex items-center gap-2 text-[13px]"><RadioGroupItem value="comptoir" /> {fillVars(t('stripePay.channelCounter'), { minutes: counterMinutes })}</label>
              <label className="flex items-center gap-2 text-[13px]"><RadioGroupItem value="distance" /> {t('stripePay.channelRemote')}</label>
            </RadioGroup>
          </div>
          <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-2">
            <span className="text-[12px] text-muted-foreground">{t('stripePay.noSurcharge')}</span>
            <span className="ml-3 font-data text-lg font-bold tabular-nums">{eur(amount)}</span>
          </div>
          {!amountOk && <p className="rounded-md bg-danger-bg px-3 py-2 text-[12px] text-danger">{fillVars(t('stripePay.errAmount'), { due: eur(due) })}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>{t('action.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={!amountOk || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <QrCode />} {t('stripePay.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShowDialog({ row, companyId, docNumber, customerName, customerEmail, customerPhone, onCancel, cancelling, onClose }: {
  row: StripePaymentRow; companyId: string; docNumber: string | null; customerName: string | null;
  customerEmail: string | null; customerPhone: string | null; onCancel: () => void; cancelling: boolean; onClose: () => void;
}) {
  const { activeCompany } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(id); }, []);
  const v = stripeStatusView(row.status);
  const left = minutesLeft(row.expiresAt, now);
  const link = { url: row.url ?? '', amount: row.amount, documentNumber: docNumber, company: activeCompany?.name ?? '' };
  const screen = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => publishStripeOnCustomerScreen(companyId, 'qr', {
      paymentId: row.id, url: row.url ?? '', expiresAt: row.expiresAt ?? undefined, amount: row.amount, documentNumber: docNumber, customerName,
    }),
    onSuccess: (ok) => (ok ? toast.success(t('stripePay.screenShown')) : toast.info(t('stripePay.noScreen'))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(row.url ?? ''); toast.success(t('stripePay.copied')); } catch { toast.error(row.url ?? ''); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{t('stripePay.dialogTitle')}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {row.url && row.status === 'attendu'
            ? <QrCodeSvg value={row.url} label={t('stripePay.qrAlt')} className="w-56 rounded-[var(--radius-card)] border border-border" />
            : <div className="grid w-56 place-items-center"><v.icon className={`size-24 ${row.status === 'recu' ? 'text-success' : 'text-muted-foreground'}`} aria-hidden /></div>}
          <div className="space-y-3">
            <p className="font-data text-[32px] font-extrabold leading-none tabular-nums">{eur(row.amount)}</p>
            <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
              <StatusBadge tone={v.tone} icon={v.icon} label={t(v.labelKey)} />
              {row.status === 'attendu' && left !== null && (
                <span className="text-[12px] text-muted-foreground">{left > 0 ? fillVars(t('stripePay.expiresIn'), { minutes: left }) : t('stripePay.expired')}</span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {row.status === 'recu' ? t('stripePay.paidBig') : row.channel === 'distance' ? t('stripePay.remoteHint') : t('stripePay.scanHint')}
            </p>
            {row.status === 'attendu' && row.url && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copy()}><Copy /> {t('stripePay.copyLink')}</Button>
                <Button size="sm" variant="outline" asChild><a href={stripeMailtoLink({ ...link, to: customerEmail })}><Mail /> {t('stripePay.sendMail')}</a></Button>
                <Button size="sm" variant="outline" asChild><a href={stripeSmsLink({ ...link, phone: customerPhone })}><MessageSquare /> {t('stripePay.sendSms')}</a></Button>
                <Button size="sm" variant="outline" onClick={() => screen.mutate()} disabled={screen.isPending}><MonitorUp /> {t('stripePay.showOnScreen')}</Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          {row.status === 'attendu' && (
            <Button variant="ghost" onClick={onCancel} disabled={cancelling}>{cancelling ? <Loader2 className="animate-spin" /> : <Ban />} {t('stripePay.cancel')}</Button>
          )}
          <Button variant="outline" onClick={onClose}><X /> {t('stripePay.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
