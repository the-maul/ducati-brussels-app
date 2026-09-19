/**
 * M6 — Paiement par QR de virement SEPA sur le 2e écran du comptoir (mission 02, carte 9 ; P-2 étape 1).
 * Sur le document de vente : « Payer par QR (virement) » → montant (reste à payer / acompte 10 % /
 * libre) et communication (structurée belge ou libre) → règlement ATTENDU « VIRQR » + affichage sur
 * l'écran client (/ecran-client). « Paiement reçu » → règlement perçu (date, qui), tracé dans events.
 * Composant autonome : n'altère ni le panneau des règlements ni le calcul du reste à payer.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MonitorUp, QrCode, Undo2, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { supabase } from '@/integrations/supabase/client';
import {
  buildEpcPayload, freeTextReference, isValidIban, qrProposedAmount, structuredReferenceForDocument,
  type QrAmountChoice,
} from './epc-qr';
import { QrCodeSvg } from './qr-code-svg';
import {
  cancelQrPayment, confirmQrPayment, listPendingQrPayments, showOnCounterDisplay, startQrPayment,
} from './qr-payment-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export const COUNTER_DISPLAY_PATH = '/ecran-client';
const COUNTER_DISPLAY_WINDOW = 'ducati-ecran-client';

let displayWindow: Window | null = null;

/**
 * Ouvre la fenêtre de l'écran client (même session, autre fenêtre à glisser sur le 2e écran),
 * sauf si elle est déjà ouverte : elle se met à jour seule (Realtime). À appeler directement dans
 * le clic (sinon le navigateur bloque la fenêtre).
 */
export function openCounterDisplay(force = false) {
  if (!force && displayWindow && !displayWindow.closed) return;
  displayWindow = window.open(COUNTER_DISPLAY_PATH, COUNTER_DISPLAY_WINDOW, 'popup,width=1280,height=800');
}

type CompanyBank = { beneficiary: string; iban: string | null; bic: string | null };

async function getCompanyBank(companyId: string): Promise<CompanyBank> {
  const { data, error } = await supabase.from('companies').select('name, legal_name, iban, bic').eq('id', companyId).single();
  if (error) throw error;
  return { beneficiary: (data.legal_name?.trim() || data.name), iban: data.iban, bic: data.bic };
}

export function QrPaymentCard({ documentId, companyId, docType, docNumber, customerName, totalTtc, clientDue }: {
  documentId: string; companyId: string; docType: string; docNumber: string | null;
  customerName: string | null; totalTtc: number; clientDue: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const bankQ = useQuery({ queryKey: ['company-bank', companyId], queryFn: () => getCompanyBank(companyId), staleTime: 5 * 60_000 });
  const pendingQ = useQuery({ queryKey: ['qr-pending', documentId], queryFn: () => listPendingQrPayments(documentId) });
  const ibanOk = !!bankQ.data?.iban && isValidIban(bankQ.data.iban);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['qr-pending', documentId] });
    qc.invalidateQueries({ queryKey: ['payments', documentId] });
    qc.invalidateQueries({ queryKey: ['doc-full', documentId] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['client-docs'] });
    qc.invalidateQueries({ queryKey: ['client-payments'] });
  };
  const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

  const confirm = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => confirmQrPayment(id),
    onSuccess: () => { toast.success(t('qrPay.confirmed')); refresh(); },
    onError: (e) => toast.error(errMsg(e, t('sales.errSave'))),
  });
  const cancel = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => cancelQrPayment(id),
    onSuccess: () => { toast.success(t('qrPay.cancelled')); refresh(); },
    onError: (e) => toast.error(errMsg(e, t('sales.errSave'))),
  });
  const show = useMutation({
    meta: { success: false, error: false },
    mutationFn: (id: string) => showOnCounterDisplay(companyId, id),
    onSuccess: () => toast.success(t('qrPay.started')),
    onError: (e) => toast.error(errMsg(e, t('sales.errSave'))),
  });

  const pending = pendingQ.data ?? [];

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('qrPay.title')}</p>
        <Button variant="outline" size="sm" onClick={() => openCounterDisplay(true)} title={t('qrPay.screenHint')}><Tv /> {t('qrPay.openScreen')}</Button>
        <Button size="sm" onClick={() => setOpen(true)} disabled={clientDue <= 0.005 || !ibanOk}><QrCode /> {t('qrPay.payByQr')}</Button>
      </div>
      {bankQ.data && !ibanOk && <p className="rounded-md bg-warning-bg px-3 py-2 text-[12px] text-warning">{t('qrPay.noIban')}</p>}

      {pending.length > 0 && (
        <table className="w-full border-collapse font-data text-[13px]">
          <tbody>
            {pending.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-1.5"><StatusBadge tone="warning" label={t('qrPay.pending')} /></td>
                <td className="py-1.5 font-mono text-[12px] text-muted-foreground">{p.reference}</td>
                <td className="py-1.5 text-right tabular-nums">{eur(p.amount)}</td>
                <td className="py-1.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { openCounterDisplay(); show.mutate(p.id); }} disabled={show.isPending}><MonitorUp className="size-4" /> {t('qrPay.show')}</Button>
                    <Button
                      size="sm" variant="outline" disabled={confirm.isPending}
                      onClick={() => { if (window.confirm(t('qrPay.receivedConfirm').replace('{amount}', eur(p.amount)))) confirm.mutate(p.id); }}
                    >
                      {confirm.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-success" />} {t('qrPay.received')}
                    </Button>
                    <Button
                      size="sm" variant="ghost" disabled={cancel.isPending}
                      onClick={() => { if (window.confirm(t('qrPay.cancelConfirm'))) cancel.mutate(p.id); }}
                    >
                      <Undo2 className="size-4" /> {t('qrPay.cancel')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[12px] text-muted-foreground">{t('qrPay.hint')}</p>

      {open && bankQ.data && (
        <QrPaymentDialog
          documentId={documentId} docType={docType} docNumber={docNumber} customerName={customerName}
          totalTtc={totalTtc} clientDue={clientDue} bank={bankQ.data}
          onClose={() => setOpen(false)}
          onStarted={() => { setOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

function QrPaymentDialog({ documentId, docType, docNumber, customerName, totalTtc, clientDue, bank, onClose, onStarted }: {
  documentId: string; docType: string; docNumber: string | null; customerName: string | null;
  totalTtc: number; clientDue: number; bank: CompanyBank; onClose: () => void; onStarted: () => void;
}) {
  const [choice, setChoice] = useState<QrAmountChoice>('solde');
  const [free, setFree] = useState('');
  const structured = structuredReferenceForDocument(docType, docNumber);
  const [refKind, setRefKind] = useState<'structured' | 'free'>(structured ? 'structured' : 'free');
  const amount = qrProposedAmount(choice, clientDue, totalTtc, num(free));
  const reference = refKind === 'structured' && structured ? structured : freeTextReference(docNumber, customerName);
  const amountOk = amount >= 0.01 && amount <= clientDue + 0.005;

  const preview = useMemo(() => {
    if (!amountOk) return { payload: null, error: t('qrPay.errAmount').replace('{due}', eur(clientDue)) };
    try {
      const payload = buildEpcPayload({
        name: bank.beneficiary, iban: bank.iban ?? '', bic: bank.bic, amount,
        structuredReference: refKind === 'structured' ? reference : null,
        text: refKind === 'free' ? reference : null,
      });
      return { payload, error: null };
    } catch (e) {
      return { payload: null, error: t('qrPay.invalidQr').replace('{error}', e instanceof Error ? e.message : '') };
    }
  }, [amountOk, amount, bank, refKind, reference, clientDue]);

  const start = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => startQrPayment(documentId, amount, reference),
    onSuccess: () => { toast.success(t('qrPay.started')); onStarted(); },
    onError: (e) => toast.error(e instanceof Error && e.message ? e.message : t('sales.errSave')),
  });

  const choices: { v: QrAmountChoice; label: string; amount: number | null }[] = [
    { v: 'solde', label: t('qrPay.choiceSolde'), amount: qrProposedAmount('solde', clientDue, totalTtc, 0) },
    { v: 'acompte10', label: t('qrPay.choiceAcompte'), amount: qrProposedAmount('acompte10', clientDue, totalTtc, 0) },
    { v: 'libre', label: t('qrPay.choiceLibre'), amount: null },
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{t('qrPay.dialogTitle')}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('qrPay.amountLabel')}</Label>
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
                <Input
                  type="number" step="0.01" min="0.01" autoFocus value={free}
                  onChange={(e) => setFree(e.target.value)} className="w-36 text-right tabular-nums"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('qrPay.referenceLabel')}</Label>
              <RadioGroup value={refKind} onValueChange={(v) => setRefKind(v as 'structured' | 'free')}>
                {structured && (
                  <label className="flex items-center gap-2 text-[13px]">
                    <RadioGroupItem value="structured" /> {t('qrPay.refStructured')}
                  </label>
                )}
                <label className="flex items-center gap-2 text-[13px]">
                  <RadioGroupItem value="free" /> {t('qrPay.refFree')}
                </label>
              </RadioGroup>
              <p className="break-all font-mono text-[12px]">{reference}</p>
            </div>
          </div>
          <div className="flex w-44 flex-col items-center gap-1">
            <span className="text-[11px] text-muted-foreground">{t('qrPay.preview')}</span>
            {preview.payload
              ? <QrCodeSvg value={preview.payload} label={t('qrPay.qrAlt')} className="w-44 rounded-[var(--radius-card)] border border-border" />
              : <p className="rounded-md bg-danger-bg px-2 py-1 text-[12px] text-danger">{preview.error}</p>}
            <span className="font-data text-lg font-bold tabular-nums">{eur(amount)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { openCounterDisplay(); start.mutate(); }} disabled={!preview.payload || start.isPending}>
            {start.isPending ? <Loader2 className="animate-spin" /> : <MonitorUp />} {t('qrPay.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
