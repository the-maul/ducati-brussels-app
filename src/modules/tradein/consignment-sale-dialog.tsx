/**
 * M7 — Vente d'un dépôt-vente (G8 « Vente d'un produit fini en dépôt », parcours 16) :
 * acquéreur, prix de vente, frais, réparations, date de livraison prévue ; décompte en direct ;
 * en une transaction SQL (`consignment_sell`) : facture à l'acheteur, facture au déposant
 * (commission + frais + réparations, TVA), avoir au déposant si choisi, décompte enregistré.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, HandCoins, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listPaymentMethods } from '@/modules/sales/write-api';
import { t } from '@/lib/i18n';
import { computeSettlement, saleCheck, belowReserve, settingNumber, settingTruthy } from './consignment-rules';
import { sellConsignment, listLinkedRepairs, uninvoicedRepairsTotal, type ConsignmentFull, type SaleResult } from './consignment-api';
import { ContactSearch, Field, MoneyInput, eur, num } from './consignment-ui';

export function ConsignmentSaleDialog({ open, onOpenChange, companyId, settings, consignment, onSold }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; settings: Record<string, string>;
  consignment: ConsignmentFull; onSold: (r: SaleResult) => void;
}) {
  const c = consignment;
  const [buyer, setBuyer] = useState<{ id: string; label: string } | null>(null);
  const [sale, setSale] = useState(String(c.agreed_price));
  const [fees, setFees] = useState(String(c.deposit_fee));
  const [repairs, setRepairs] = useState('0');
  const [delivery, setDelivery] = useState('');
  const [forceMin, setForceMin] = useState(false);
  const [buyerInvoice, setBuyerInvoice] = useState(settingTruthy(settings.buyer_invoice ?? 'oui'));
  const [commInvoice, setCommInvoice] = useState(settingTruthy(settings.commission_invoice ?? 'oui'));
  const [creditNote, setCreditNote] = useState(settingTruthy(settings.auto_credit_note ?? 'non'));
  const [receipt, setReceipt] = useState('');
  useEffect(() => {
    if (!open) return;
    setBuyer(null); setSale(String(c.agreed_price)); setFees(String(c.deposit_fee)); setRepairs('0'); setDelivery(''); setForceMin(false);
    setBuyerInvoice(settingTruthy(settings.buyer_invoice ?? 'oui'));
    setCommInvoice(settingTruthy(settings.commission_invoice ?? 'oui'));
    setCreditNote(settingTruthy(settings.auto_credit_note ?? 'non'));
    setReceipt('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, c.id]);

  const vatRate = settingNumber(settings.commission_vat_rate, 21);
  const buyerRate = settingNumber(settings[`buyer_vat_rate_${c.depositor_kind}`], c.depositor_kind === 'professionnel' ? 21 : 0);
  const s = useMemo(() => computeSettlement({
    salePrice: num(sale), askedPrice: c.asked_price, mode: c.commission_mode, pct: c.commission_pct, fixed: c.commission_amount,
    fees: num(fees), repairs: num(repairs), vatRate,
  }), [sale, fees, repairs, c, vatRate]);
  const below = belowReserve(num(sale), c.min_price);

  const repairsQ = useQuery({
    queryKey: ['consign-repairs', c.vehicle_id, c.entry_date],
    queryFn: () => listLinkedRepairs(c.vehicle_id!, c.entry_date),
    enabled: open && !!c.vehicle_id,
  });
  const suggested = uninvoicedRepairsTotal(repairsQ.data ?? []);
  const methods = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), enabled: open && !buyerInvoice });

  const sell = useMutation({
    meta: { success: false, error: false },
    mutationFn: () => {
      const why = saleCheck({ buyerId: buyer?.id ?? null, depositorId: c.depositor_id, salePrice: num(sale), minPrice: c.min_price, net: s.net, forceBelowMin: forceMin });
      if (why) throw new Error(t(`consign.chk_${why}`));
      return sellConsignment(c.id, {
        buyer_id: buyer!.id, sale_price: num(sale), fees: num(fees), repairs: num(repairs),
        expected_delivery_date: delivery || null, force_below_min: forceMin,
        buyer_invoice: buyerInvoice, commission_invoice: commInvoice, credit_note: creditNote,
        receipt_method: buyerInvoice ? null : receipt || null,
      });
    },
    onSuccess: (r) => {
      toast.success(t('consign.soldDone').replace('{n}', eur(r.net)));
      onSold(r); onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || t('consign.errSave')),
  });

  const Row = ({ label, value, strong = false, minus = false }: { label: string; value: number; strong?: boolean; minus?: boolean }) => (
    <tr className={strong ? 'border-t border-border font-bold' : ''}>
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 text-right tabular-nums">{minus && value > 0 ? '− ' : ''}{eur(value)}</td>
    </tr>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('consign.sellTitle')} {c.number}</DialogTitle>
          <DialogDescription>{t('consign.sellHint')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('consign.buyer')} className="sm:col-span-2">
            <ContactSearch companyId={companyId} picked={buyer} onPick={setBuyer} placeholder={t('consign.searchBuyer')} />
          </Field>
          <Field label={t('consign.salePrice')}><MoneyInput value={sale} onChange={setSale} /></Field>
          <Field label={t('consign.deliveryDate')}><Input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="h-9" /></Field>
          <Field label={t('consign.fees')}><MoneyInput value={fees} onChange={setFees} /></Field>
          <Field label={t('consign.repairs')}>
            <MoneyInput value={repairs} onChange={setRepairs} />
            {suggested > 0 && (
              <button type="button" className="text-xs text-info underline" onClick={() => setRepairs(String(suggested))}>
                {t('consign.repairsSuggest').replace('{m}', eur(suggested))}
              </button>
            )}
          </Field>
        </div>

        {below && (
          <div className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{t('consign.belowMin').replace('{m}', eur(c.min_price))}</p>
              <label className="mt-1 flex items-center gap-2"><Checkbox checked={forceMin} onCheckedChange={(v) => setForceMin(v === true)} />{t('consign.belowMinAgree')}</label>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.settlementTitle')}</p>
          <table className="w-full font-data text-[13px]">
            <tbody>
              <Row label={t('consign.salePrice')} value={s.salePrice} />
              <Row label={`${t('consign.commission')} (${t('consign.vatIncluded')} ${eur(s.commissionVat)})`} value={s.commissionTtc} minus />
              <Row label={t('consign.fees')} value={s.feesTtc} minus />
              <Row label={t('consign.repairs')} value={s.repairsTtc} minus />
              <Row label={t('consign.net')} value={s.net} strong />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('consign.buyerVatInfo').replace('{r}', String(buyerRate)).replace('{k}', t(`consign.kind_${c.depositor_kind}`))}
            {' · '}{t('consign.invoiceVatInfo').replace('{r}', String(vatRate)).replace('{m}', eur(s.invoiceTtc))}
          </p>
          {s.net < 0 && <p className="mt-1 text-sm text-danger">{t('consign.chk_negativeNet')}</p>}
        </div>

        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={buyerInvoice} onCheckedChange={(v) => setBuyerInvoice(v === true)} />{t('consign.optBuyerInvoice')}</label>
          {!buyerInvoice && (
            <div className="ml-6 flex items-center gap-2">
              <span className="text-muted-foreground">{t('consign.receiptMethod')}</span>
              <Select value={receipt} onValueChange={setReceipt}>
                <SelectTrigger className="h-8 w-48"><SelectValue placeholder={t('consign.receiptNone')} /></SelectTrigger>
                <SelectContent>{(methods.data ?? []).filter((m) => m.code !== 'DEP' && m.code !== 'ARR').map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2"><Checkbox checked={commInvoice} onCheckedChange={(v) => setCommInvoice(v === true)} />{t('consign.optCommissionInvoice')}</label>
          <label className="flex items-center gap-2"><Checkbox checked={creditNote} onCheckedChange={(v) => setCreditNote(v === true)} />{t('consign.optCreditNote')}</label>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button>
          <Button onClick={() => sell.mutate()} disabled={sell.isPending || !buyer}>
            {sell.isPending ? <Loader2 className="animate-spin" /> : <HandCoins />} {t('consign.sellConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
