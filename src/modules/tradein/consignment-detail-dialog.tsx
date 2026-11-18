/**
 * M7 — Fiche d'un dépôt-vente : tout se fait d'ici (un seul écran, décision du 18/11) :
 * imprimer le document de dépôt, modifier, vendre, retour client, voir les réparations,
 * verser le net au déposant (décaissement « dépôt » ou virement), imprimer le décompte.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2, Printer, Pencil, HandCoins, Undo2, Banknote, FileText, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useConfirm } from '@/components/confirm-provider';
import { listPaymentMethods } from '@/modules/sales/write-api';
import { vehiclePickLabel } from '@/modules/vehicles/api';
import { t } from '@/lib/i18n';
import { CHECKLIST_KEYS } from './validate-data';
import { payDepositor, returnConsignment, listLinkedRepairs, type ConsignmentFull, type DocBrief } from './consignment-api';
import { printDepositSheet, printSettlementSheet, partyName } from './consignment-print';
import { ConsignmentStatusBadge, Field, MoneyInput, eur, num, dateFr } from './consignment-ui';

export function ConsignmentDetailDialog({ open, onOpenChange, companyId, companyName, consignment: c, canWrite, onEdit, onSell, onChanged }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; companyName: string;
  consignment: ConsignmentFull; canWrite: boolean;
  onEdit: () => void; onSell: () => void; onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [method, setMethod] = useState('VIR');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('0');
  const [showRepairs, setShowRepairs] = useState(false);

  const methods = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), enabled: open });
  const repairs = useQuery({
    queryKey: ['consign-repairs', c.vehicle_id, c.entry_date],
    queryFn: () => listLinkedRepairs(c.vehicle_id!, c.entry_date),
    enabled: open && showRepairs && !!c.vehicle_id,
  });

  const pay = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      const ok = await confirm({ title: t('consign.payoutTitle'), message: t('consign.payoutConfirm').replace('{m}', eur(c.sold_reversal)).replace('{p}', partyName(c.depositor)), confirmLabel: t('consign.payoutDo') });
      if (!ok) return false;
      await payDepositor(c.id, method, reference);
      return true;
    },
    onSuccess: (done) => { if (done) { toast.success(t('consign.payoutDone')); onChanged(); } },
    onError: (e: Error) => toast.error(e.message || t('consign.errSave')),
  });
  const giveBack = useMutation({
    meta: { success: false, error: false },
    mutationFn: async () => {
      if (!reason.trim()) throw new Error(t('consign.errReason'));
      const ok = await confirm({ title: t('consign.returnTitle'), message: t('consign.returnConfirm'), confirmLabel: t('consign.returnDo') });
      if (!ok) return false;
      await returnConsignment(c.id, reason.trim(), num(fee));
      return true;
    },
    onSuccess: (done) => { if (done) { toast.success(t('consign.returnDone')); onChanged(); } },
    onError: (e: Error) => toast.error(e.message || t('consign.errSave')),
  });

  const docLink = (label: string, d: DocBrief | null) => d ? (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Link to="/sales/$documentId" params={{ documentId: d.id }} className="inline-flex items-center gap-1 font-mono text-info underline">
        <FileText className="size-3.5" />{d.number ?? '—'} · <span className="tabular-nums">{eur(d.total_ttc)}</span>
      </Link>
    </div>
  ) : null;
  const info = (label: string, value: string | null | undefined) => (
    <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || '—'}</span></div>
  );
  const remis = CHECKLIST_KEYS.filter((k) => c.checklist?.[k]).map((k) => t(`tradein.chk_${k}`));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3"><span className="font-mono">{c.number}</span><ConsignmentStatusBadge status={c.status} /></DialogTitle>
          <DialogDescription>{c.vehicle ? vehiclePickLabel(c.vehicle) : t('consign.noVehicle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => printDepositSheet(c, companyName)}><Printer /> {t('consign.printSheet')}</Button>
          {c.status === 'vendu' && <Button size="sm" variant="outline" onClick={() => printSettlementSheet(c, companyName)}><Printer /> {t('consign.printSettlement')}</Button>}
          {c.vehicle_id && <Button size="sm" variant="outline" onClick={() => setShowRepairs((v) => !v)}><Wrench /> {t('consign.seeRepairs')}</Button>}
          {canWrite && c.status === 'en_depot' && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> {t('action.edit')}</Button>
              <Button size="sm" onClick={onSell} disabled={!c.vehicle_id}><HandCoins /> {t('consign.sell')}</Button>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 rounded-md border border-border p-3">
            {info(t('consign.depositor'), partyName(c.depositor))}
            {info(t('consign.kind'), t(`consign.kind_${c.depositor_kind}`))}
            {info(t('consign.entryDate'), dateFr(c.entry_date))}
            {info(t('consign.policeBook'), c.police_book_number)}
            {info(t('consign.reference'), c.article?.reference ?? c.vehicle?.reference)}
            {info(t('consign.checklistTitle'), remis.length ? remis.join(', ') : null)}
          </div>
          <div className="space-y-1 rounded-md border border-border p-3 font-data tabular-nums">
            {info(t('consign.asked'), eur(c.asked_price))}
            {info(t('consign.salePrice'), eur(c.agreed_price))}
            {info(t('consign.minPrice'), c.min_price > 0 ? eur(c.min_price) : null)}
            {info(t('consign.commissionMode'), c.commission_mode === 'pourcentage' ? `${t('consign.mode_pourcentage')} ${c.commission_pct} %`
              : c.commission_mode === 'forfait' ? `${t('consign.mode_forfait')} ${eur(c.commission_amount)}` : t('consign.mode_ecart'))}
            {info(t('consign.depositFee'), eur(c.deposit_fee))}
          </div>
        </div>

        {c.status === 'vendu' && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.settlementTitle')}</p>
            <div className="grid gap-1 font-data tabular-nums sm:grid-cols-2">
              {info(t('consign.buyer'), partyName(c.buyer))}
              {info(t('consign.soldOn'), dateFr(c.sold_at))}
              {info(t('consign.salePrice'), eur(c.sold_price))}
              {info(t('consign.commission'), `${eur(c.sold_commission)} (${t('consign.vatIncluded')} ${eur(c.sold_commission_vat)})`)}
              {info(t('consign.fees'), eur(c.sold_fees))}
              {info(t('consign.repairs'), eur(c.sold_repairs))}
              {info(t('consign.net'), eur(c.sold_reversal))}
              {info(t('consign.deliveryDate'), dateFr(c.expected_delivery_date))}
            </div>
            <div className="space-y-1 pt-1">
              {docLink(t('consign.saleInvoice'), c.sale_doc)}
              {docLink(t('consign.commissionInvoice'), c.commission_doc)}
              {docLink(t('consign.creditNote'), c.credit_doc)}
              {c.sale_doc && c.sale_doc.paid_amount + 0.005 < c.sale_doc.total_ttc && (
                <p className="text-xs text-warning">{t('consign.buyerNotPaid').replace('{m}', eur(c.sale_doc.total_ttc - c.sale_doc.paid_amount))}</p>
              )}
            </div>
            {c.payout_at ? (
              <p className="text-sm text-success">{t('consign.paidOn').replace('{d}', dateFr(c.payout_at)).replace('{m}', eur(c.payout_amount)).replace('{p}', c.payout_method ?? '')}{c.payout_reference ? ` · ${c.payout_reference}` : ''}</p>
            ) : canWrite && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
                <Field label={t('consign.payoutMethod')}>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>{(methods.data ?? []).filter((m) => !['DEP', 'ARR', 'AVO', 'STRIPE'].includes(m.code)).map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label={t('consign.payoutReference')}><Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-9 w-56" /></Field>
                <Button onClick={() => pay.mutate()} disabled={pay.isPending}>{pay.isPending ? <Loader2 className="animate-spin" /> : <Banknote />} {t('consign.payoutDo')} {eur(c.sold_reversal)}</Button>
              </div>
            )}
          </div>
        )}

        {c.status === 'restitue' && (
          <div className="space-y-1 rounded-md border border-border p-3">
            {info(t('consign.returnedOn'), dateFr(c.returned_at))}
            {info(t('consign.returnReason'), c.return_reason)}
            {info(t('consign.returnFee'), c.return_fee ? eur(c.return_fee) : null)}
            {docLink(t('consign.returnInvoice'), c.return_doc)}
          </div>
        )}

        {canWrite && c.status === 'en_depot' && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <p className="w-full text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.returnTitle')}</p>
            <Field label={t('consign.returnReason')} className="min-w-[16rem] flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" /></Field>
            <Field label={t('consign.returnFee')}><div className="w-32"><MoneyInput value={fee} onChange={setFee} /></div></Field>
            <Button variant="outline" onClick={() => giveBack.mutate()} disabled={giveBack.isPending}>{giveBack.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} {t('consign.returnDo')}</Button>
          </div>
        )}

        {showRepairs && (
          <div className="rounded-md border border-border p-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('consign.repairsTitle')}</p>
            {repairs.isLoading ? <Loader2 className="size-4 animate-spin" /> : (repairs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('consign.repairsNone')}</p>
            ) : (
              <table className="w-full font-data text-[13px]">
                <tbody>
                  {(repairs.data ?? []).map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-b border-border last:border-0">
                      <td className="py-1 pr-2">{t(`consign.repairKind_${r.kind}`)}</td>
                      <td className="py-1 pr-2 font-mono">{r.number ?? '—'}</td>
                      <td className="py-1 pr-2">{dateFr(r.date)}</td>
                      <td className="py-1 pr-2">{r.status}{r.invoiced ? ` · ${t('consign.invoiced')}` : ''}</td>
                      <td className="py-1 text-right tabular-nums">{eur(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {c.notes && <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{c.notes}</p>}
      </DialogContent>
    </Dialog>
  );
}
