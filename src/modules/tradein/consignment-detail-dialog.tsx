/**
 * M7 — Fiche d'un dépôt-vente : tout se fait d'ici (un seul écran, décision du 18/11) :
 * imprimer le document de dépôt, modifier, vendre, retour client, voir les réparations,
 * verser le net au déposant (décaissement « dépôt » ou virement), imprimer le décompte.
 * Chantier C8 (23/11/2026, REP-03 à REP-05) : ces actions sont rangées dans un fil d'étapes cliquable.
 * Chaque étape montre l'action, les montants utiles et les documents. Étape courante et alertes :
 * `consignment-steps.ts`. Aucun montant ni aucune règle de vente, de versement ou de retour ne change.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Loader2, Printer, Pencil, HandCoins, Undo2, Banknote, FileText, Wrench, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { listPaymentMethods } from '@/modules/sales/write-api';
import { StepTrail } from '@/modules/sales/step-trail';
import { vehiclePickLabel } from '@/modules/vehicles/api';
import { t } from '@/lib/i18n';
import { CHECKLIST_KEYS } from './validate-data';
import {
  payDepositor, returnConsignment, listLinkedRepairs, uninvoicedRepairsTotal, getDepotCosts, listDepotCessions,
  type ConsignmentFull, type DocBrief,
} from './consignment-api';
import { computeSettlement } from './consignment-rules';
import {
  canReturnToOwner, depotCurrentStep, depotSteps, depotWarnings, docDue, returnFeesSummary, summarizeDepotCessions,
  type DepotCessionRow, type DepotFacts, type DepotStepKey,
} from './consignment-steps';
import { printDepositSheet, printSettlementSheet, partyName } from './consignment-print';
import { ConsignmentStatusBadge, Field, MoneyInput, eur, num, dateFr } from './consignment-ui';

export function ConsignmentDetailDialog({ open, onOpenChange, companyId, companyName, consignment: c, canWrite, onEdit, onSell, onChanged }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; companyName: string;
  consignment: ConsignmentFull; canWrite: boolean;
  onEdit: () => void; onSell: () => void; onChanged: () => void;
}) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [method, setMethod] = useState('VIR');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('0');
  const [showRepairs, setShowRepairs] = useState(false);
  const [selected, setSelected] = useState<DepotStepKey | null>(null);

  const methods = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => listPaymentMethods(companyId), enabled: open });
  const repairs = useQuery({
    queryKey: ['consign-repairs', c.vehicle_id, c.entry_date],
    queryFn: () => listLinkedRepairs(c.vehicle_id!, c.entry_date),
    enabled: open && !!c.vehicle_id, staleTime: 0,
  });
  // Relues à chaque ouverture : une cession se valide sur un autre écran (/stock/cessions).
  const depotQ = useQuery({ queryKey: ['consign-depot-costs', c.id], queryFn: () => getDepotCosts(c.id), enabled: open, staleTime: 0 });
  const cessionsQ = useQuery({ queryKey: ['consign-cessions', c.id], queryFn: () => listDepotCessions(c.id), enabled: open, staleTime: 0 });
  // Une vente ou un retour archive les cessions et fait avancer le dépôt : on relit, et le fil revient à l'étape courante.
  const stateKey = `${c.id}|${c.status}|${c.payout_at ?? ''}`;
  const lastState = useRef(stateKey);
  useEffect(() => {
    if (lastState.current === stateKey) return;
    lastState.current = stateKey;
    setSelected(null);
    qc.invalidateQueries({ queryKey: ['consign-depot-costs', c.id] });
    qc.invalidateQueries({ queryKey: ['consign-cessions', c.id] });
  }, [qc, c.id, stateKey]);

  const basis = depotQ.data?.basis ?? 'cout';
  const vatRate = depotQ.data?.vat_rate ?? 21;
  const validatedTtc = depotQ.data?.amount_ttc ?? 0;
  const cessions = summarizeDepotCessions(cessionsQ.data ?? [], basis, vatRate);
  const facts: DepotFacts = {
    status: c.status, soldReversal: c.sold_reversal, payoutAt: c.payout_at,
    buyerDue: docDue(c.sale_doc), returnDue: docDue(c.return_doc),
    cessionsToValidate: cessions.toValidate.length, cessionsMissed: cessions.missed.length,
  };
  const current = depotCurrentStep(facts);
  const shown = selected ?? current;
  const warnings = depotWarnings(facts);
  const stepLabel = (k: DepotStepKey) => t(`depotFil.step_${k}`);
  const trail = depotSteps(facts).map((s) => ({ ...s, label: stepLabel(s.key) }));
  const uninvoiced = uninvoicedRepairsTotal(repairs.data ?? []);
  const returnFees = returnFeesSummary({
    depositFee: c.deposit_fee, validatedTtc, pendingTtc: cessions.pendingTtc, uninvoicedRepairs: uninvoiced, billed: c.return_fee,
  });
  const estimate = computeSettlement({
    salePrice: c.agreed_price, askedPrice: c.asked_price, mode: c.commission_mode, pct: c.commission_pct, fixed: c.commission_amount,
    fees: c.deposit_fee, repairs: validatedTtc, vatRate,
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
      <Link to="/sales/$documentId" params={{ documentId: d.id }} className="inline-flex min-h-11 items-center gap-1 font-mono text-info underline">
        <FileText className="size-3.5" />{d.number ?? '—'} · <span className="tabular-nums">{eur(d.total_ttc)}</span>
      </Link>
    </div>
  ) : null;
  const info = (label: string, value: string | null | undefined, strong = false) => (
    <div className={`flex justify-between gap-3 text-sm ${strong ? 'border-t border-border pt-1 font-bold' : ''}`}><span className={strong ? '' : 'text-muted-foreground'}>{label}</span><span className="text-right font-medium">{value || '—'}</span></div>
  );
  const remis = CHECKLIST_KEYS.filter((k) => c.checklist?.[k]).map((k) => t(`tradein.chk_${k}`));
  const box = 'space-y-1 rounded-md border border-border p-3';
  const boxTitle = (label: string) => <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>;
  const printSheet = <Button size="sm" variant="outline" onClick={() => printDepositSheet(c, companyName)}><Printer /> {t('consign.printSheet')}</Button>;
  const printSettlement = <Button size="sm" variant="outline" onClick={() => printSettlementSheet(c, companyName)}><Printer /> {t('consign.printSettlement')}</Button>;
  const saleDocs = (
    <div className={box}>
      {boxTitle(t('depotFil.documents'))}
      {docLink(t('consign.saleInvoice'), c.sale_doc)}
      {docLink(t('consign.commissionInvoice'), c.commission_doc)}
      {docLink(t('consign.creditNote'), c.credit_doc)}
      <div className="pt-1">{printSettlement}</div>
    </div>
  );
  const settlementBox = (
    <div className={`${box} font-data tabular-nums`}>
      {boxTitle(t('consign.settlementTitle'))}
      {info(t('consign.salePrice'), eur(c.sold_price))}
      {info(t('consign.commission'), `${eur(c.sold_commission)} (${t('consign.vatIncluded')} ${eur(c.sold_commission_vat)})`)}
      {info(t('consign.fees'), eur(c.sold_fees))}
      {info(t('consign.repairs'), eur(c.sold_repairs))}
      {info(t('consign.net'), eur(c.sold_reversal), true)}
    </div>
  );
  const paidLine = c.payout_at && (
    <p className="text-sm text-success">{t('consign.paidOn').replace('{d}', dateFr(c.payout_at)).replace('{m}', eur(c.payout_amount)).replace('{p}', c.payout_method ?? '')}{c.payout_reference ? ` · ${c.payout_reference}` : ''}</p>
  );
  const feesBox = (withBilled: boolean) => (
    <div className={`${box} font-data tabular-nums`}>
      {boxTitle(t('depotFil.feesEngaged'))}
      {info(t('depotFil.feesDeposit'), eur(returnFees.depositFee))}
      {info(t('depotFil.feesValidated'), eur(returnFees.validatedTtc))}
      {returnFees.pendingTtc > 0 && info(t('depotFil.feesPending'), eur(returnFees.pendingTtc))}
      {info(t('depotFil.feesRepairs'), eur(returnFees.uninvoicedRepairs))}
      {info(t('depotFil.feesEngaged'), eur(returnFees.engaged), true)}
      {withBilled && info(t('depotFil.feesBilled'), eur(returnFees.billed))}
      {withBilled && info(t('depotFil.feesNotBilled'), eur(returnFees.notBilled))}
    </div>
  );
  const cessionBadge = (x: DepotCessionRow) => {
    if (cessions.toValidate.includes(x)) return <StatusBadge tone="warning" label={t('depotFil.cessionStateOpen')} />;
    if (cessions.missed.includes(x)) return <StatusBadge tone="warning" label={t('depotFil.cessionStateMissed')} />;
    if (cessions.emptyOpen.includes(x)) return <StatusBadge tone="info" label={t('depotFil.cessionStateEmpty')} />;
    if (x.status === 'annule') return <StatusBadge tone="neutral" label={t('depotFil.cessionStateCancelled')} />;
    return <StatusBadge tone="success" label={t('depotFil.cessionStateValid')} />;
  };
  const hint = (key: string, vars?: { m: string }) => (
    <p className="text-[13px]">{vars ? t(`depotFil.${key}`).replace('{m}', vars.m) : t(`depotFil.${key}`)}</p>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3"><span className="font-mono">{c.number}</span><ConsignmentStatusBadge status={c.status} /></DialogTitle>
          <DialogDescription>{c.vehicle ? vehiclePickLabel(c.vehicle) : t('consign.noVehicle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <StepTrail items={trail} selected={shown} onSelect={(k) => setSelected(k as DepotStepKey)} ariaLabel={t('depotFil.trailLabel')} />
          {canReturnToOwner(c.status) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">{t('depotFil.branchLabel')}</span>
              <StepTrail numbered={false} items={[{ key: 'retour', label: stepLabel('retour'), state: 'todo' }]} selected={shown} onSelect={() => setSelected('retour')} ariaLabel={stepLabel('retour')} />
            </div>
          )}
        </div>

        {warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(`depotFil.warn_${w}`).replace('{m}', eur(facts.buyerDue))}
          </p>
        ))}

        <section aria-label={stepLabel(shown)} className="space-y-3">
          <h3 className="text-sm font-bold">{stepLabel(shown)}</h3>

          {shown === 'entree' && (
            <>
              {hint('do_entree')}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={box}>
                  {info(t('consign.depositor'), partyName(c.depositor))}
                  {info(t('consign.kind'), t(`consign.kind_${c.depositor_kind}`))}
                  {info(t('consign.entryDate'), dateFr(c.entry_date))}
                  {info(t('consign.policeBook'), c.police_book_number)}
                  {info(t('consign.reference'), c.article?.reference ?? c.vehicle?.reference)}
                  {info(t('consign.checklistTitle'), remis.length ? remis.join(', ') : null)}
                </div>
                <div className={`${box} font-data tabular-nums`}>
                  {info(t('consign.asked'), eur(c.asked_price))}
                  {info(t('consign.salePrice'), eur(c.agreed_price))}
                  {info(t('consign.minPrice'), c.min_price > 0 ? eur(c.min_price) : null)}
                  {info(t('consign.commissionMode'), c.commission_mode === 'pourcentage' ? `${t('consign.mode_pourcentage')} ${c.commission_pct} %`
                    : c.commission_mode === 'forfait' ? `${t('consign.mode_forfait')} ${eur(c.commission_amount)}` : t('consign.mode_ecart'))}
                  {info(t('consign.depositFee'), eur(c.deposit_fee))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {printSheet}
                {canWrite && c.status === 'en_depot' && <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> {t('action.edit')}</Button>}
              </div>
            </>
          )}

          {shown === 'frais' && (
            <>
              {hint(c.status === 'en_depot' ? 'do_frais' : 'do_frais_after')}
              <div className={`${box} font-data tabular-nums`}>
                {boxTitle(t('depotFil.amounts'))}
                {info(t('depotFil.feesDeposit'), eur(c.deposit_fee))}
                {info(t('depotFil.feesValidated'), eur(validatedTtc))}
                {cessions.pendingTtc > 0 && info(t('depotFil.feesPending'), eur(cessions.pendingTtc))}
              </div>
              <div className={box}>
                {boxTitle(t('depotFil.cessions'))}
                {cessionsQ.isLoading ? <Loader2 className="size-4 animate-spin" /> : (cessionsQ.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('depotFil.cessionNone')}</p>
                ) : (cessionsQ.data ?? []).map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to="/stock/cessions" search={{ doc: x.id }} className="inline-flex min-h-11 items-center gap-1 font-mono text-info underline"><ExternalLink className="size-3.5" />{x.number ?? '—'}</Link>
                    {cessionBadge(x)}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild><Link to="/stock/cessions"><ExternalLink /> {t('depotFil.openCessions')}</Link></Button>
                {c.vehicle_id && <Button size="sm" variant="outline" onClick={() => setShowRepairs((v) => !v)}><Wrench /> {t('consign.seeRepairs')}</Button>}
              </div>
            </>
          )}

          {shown === 'vente' && (
            c.status === 'en_depot' ? (
              <>
                {hint('do_vente')}
                <div className={`${box} font-data tabular-nums`}>
                  {boxTitle(t('depotFil.amounts'))}
                  {info(t('consign.salePrice'), eur(c.agreed_price))}
                  {info(t('consign.minPrice'), c.min_price > 0 ? eur(c.min_price) : null)}
                  {info(t('consign.commission'), `${eur(estimate.commissionTtc)} (${t('consign.vatIncluded')} ${eur(estimate.commissionVat)})`)}
                  {info(t('consign.fees'), eur(estimate.feesTtc))}
                  {info(t('consign.repairs'), eur(estimate.repairsTtc))}
                  {info(t('depotFil.netEstimate'), eur(estimate.net), true)}
                  <p className="pt-1 font-ui text-xs text-muted-foreground">{t('depotFil.netEstimateHint')}</p>
                </div>
                {canWrite && <Button onClick={onSell} disabled={!c.vehicle_id}><HandCoins /> {t('consign.sell')}</Button>}
              </>
            ) : (
              <>{hint('do_vente_done')}{settlementBox}</>
            )
          )}

          {shown === 'vendue' && (
            c.status !== 'vendu' ? hint('do_vendue_todo') : (
              <>
                {hint(!c.sale_doc ? 'do_vendue_noInvoice' : (facts.buyerDue ?? 0) > 0.005 ? 'do_vendue' : 'do_vendue_paid')}
                <div className={`${box} font-data tabular-nums`}>
                  {info(t('consign.buyer'), partyName(c.buyer))}
                  {info(t('consign.soldOn'), dateFr(c.sold_at))}
                  {info(t('consign.salePrice'), eur(c.sold_price))}
                  {info(t('consign.deliveryDate'), dateFr(c.expected_delivery_date))}
                </div>
                {saleDocs}
              </>
            )
          )}

          {shown === 'reversement' && (
            c.status !== 'vendu' ? hint('do_reversement_todo') : (
              <>
                {!c.payout_at && hint((c.sold_reversal ?? 0) > 0 ? 'do_reversement' : 'do_reversement_none')}
                {settlementBox}
                {paidLine}
                {!c.payout_at && canWrite && (c.sold_reversal ?? 0) > 0 && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
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
                <div>{printSettlement}</div>
              </>
            )
          )}

          {shown === 'cloture' && (
            current !== 'cloture' ? hint('do_cloture_todo') : (
              <>
                {hint('do_cloture')}
                {c.status === 'vendu' && <>{settlementBox}{paidLine}{saleDocs}</>}
                {c.status === 'restitue' && (
                  <div className={box}>
                    {info(t('consign.returnedOn'), dateFr(c.returned_at))}
                    {info(t('consign.returnReason'), c.return_reason)}
                    {docLink(t('consign.returnInvoice'), c.return_doc)}
                    <div className="pt-1">{printSheet}</div>
                  </div>
                )}
              </>
            )
          )}

          {shown === 'retour' && (
            c.status === 'restitue' ? (
              <>
                {(facts.returnDue ?? 0) > 0.005 ? hint('do_retour_due', { m: eur(facts.returnDue) }) : hint('do_retour_done')}
                <div className={box}>
                  {info(t('consign.returnedOn'), dateFr(c.returned_at))}
                  {info(t('consign.returnReason'), c.return_reason)}
                  {info(t('consign.returnFee'), c.return_fee ? eur(c.return_fee) : null)}
                  {docLink(t('consign.returnInvoice'), c.return_doc)}
                </div>
                {feesBox(true)}
                <div>{printSheet}</div>
              </>
            ) : (
              <>
                {hint('do_retour')}
                {feesBox(false)}
                <p className="text-xs text-muted-foreground">{t('depotFil.returnFeesHint')}</p>
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                    <Field label={t('consign.returnReason')} className="min-w-[16rem] flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9" /></Field>
                    <Field label={t('consign.returnFee')}><div className="w-32"><MoneyInput value={fee} onChange={setFee} /></div></Field>
                    <Button variant="outline" onClick={() => giveBack.mutate()} disabled={giveBack.isPending}>{giveBack.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} {t('consign.returnDo')}</Button>
                  </div>
                )}
              </>
            )
          )}
        </section>

        {showRepairs && shown === 'frais' && (
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
