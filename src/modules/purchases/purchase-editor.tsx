/**
 * M4 — Éditeur de document d'achat (G8 « Réception / Commande / Proposition / Rétrocession », même écran).
 * En-tête (fournisseur, opérateur, type de commande, n° facture / BL + dates, régime TVA, port) + lignes
 * (article, réf frs, qté, PA HT, remise, casier, étiquettes) + totaux + échéances.
 * Rattrapage G8 (18/11/2026) : « Rappel cde » (une ou plusieurs commandes, quantités reçues, réception
 * partielle : le reliquat reste en commande), brouillon repris et validé plus tard, écriture ATOMIQUE par
 * le serveur (purchase_doc_save : stock, PAMP, prix d'achat, statut des commandes en une transaction),
 * conditions du fournisseur (régime TVA, port fixe, remise dépannage), conditionnement d'achat.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Search, X, Save, CheckCircle2, Bike, Undo2, Tags, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { listSuppliers, supplierName, searchPurchaseArticles, getPurchaseFull, type Supplier, type PurchaseArticle, type PurchaseFull } from './api';
import { computePurchaseTotals, type ChassisInput } from './write-api';
import {
  savePurchaseDoc, deletePurchaseDraft, getSupplierConditions, listOpenLines, type DocLinePayload, type OpenLine, type SupplierConditions,
} from './g8-api';
import {
  landedUnitCosts, roundToPack, defaultLineDiscount, NON_STOCKED_MGMT, PURCHASE_ORDER_TYPES,
  type PurchaseDocType, type PurchaseOrderType, type VatRegimeCode,
} from './g8-rules';
import { RecallDialog } from './recall-dialog';
import { receptionChassisErrors } from '@/modules/vehicles/chassis-rules';
import { t, fillVars } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const qtyFmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const todayIso = () => new Date().toISOString().slice(0, 10);

type EditLine = DocLinePayload & {
  _key: string; mgmt_type?: string | null; pack_qty?: number | null; reference?: string | null;
  ordered?: number | null; received?: number | null; remaining?: number | null; source_number?: string | null;
};
let counter = 0;
const blankLine = (discount = 0): EditLine => ({
  _key: `pl${counter++}`, article_id: null, designation: '', supplier_ref: '', quantity: 1, unit_price_ht: 0, discount_pct: discount,
  vat_rate: 21, sale_price_ttc: null, bin_location: '', labels: 0,
});

type LineRow = PurchaseFull['lines'][number] & {
  source_line_id?: string | null; contact_id?: string | null; origin_kind?: string | null; origin_id?: string | null;
  origin_ref?: string | null; chassis?: ChassisInput | null;
};
type OrderRow = PurchaseFull['order'] & {
  order_type?: string | null; spread_costs?: boolean | null;
};

export function PurchaseEditor({ companyId, initialDocType = 'REC', initial, recallOrderId }: {
  companyId: string; initialDocType?: PurchaseDocType; initial?: PurchaseFull | null; recallOrderId?: string | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const draft = initial?.order as OrderRow | undefined;
  const [docType, setDocType] = useState<PurchaseDocType>((draft?.doc_type as PurchaseDocType) ?? initialDocType);
  const [orderType, setOrderType] = useState<PurchaseOrderType | ''>((draft?.order_type as PurchaseOrderType) ?? (initialDocType === 'REC' || initialDocType === 'RTF' ? '' : 'stock'));
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [cond, setCond] = useState<SupplierConditions | null>(null);
  const [vatRegime, setVatRegime] = useState<VatRegimeCode>((draft?.vat_regime as VatRegimeCode) ?? 'with_vat');
  const [invoiceNo, setInvoiceNo] = useState(draft?.supplier_invoice_no ?? '');
  const [blNo, setBlNo] = useState(draft?.supplier_bl_no ?? '');
  const [intranetNo, setIntranetNo] = useState(draft?.intranet_no ?? '');
  const [invoiceDate, setInvoiceDate] = useState(draft?.invoice_date ?? '');
  const [blDate, setBlDate] = useState(draft?.bl_date ?? '');
  const [receiptDate, setReceiptDate] = useState(draft?.receipt_date ?? todayIso());
  const [orderDate, setOrderDate] = useState(draft?.order_date ?? todayIso());
  const [expectedDate, setExpectedDate] = useState(draft?.expected_date ?? '');
  const [shippingHt, setShippingHt] = useState(draft && Number(draft.shipping_ht) ? String(draft.shipping_ht) : '');
  const [shippingTaxed, setShippingTaxed] = useState(draft?.shipping_taxed ?? true);
  const [discountPct, setDiscountPct] = useState(draft && Number(draft.global_discount_pct) ? String(draft.global_discount_pct) : '');
  const [spreadCosts, setSpreadCosts] = useState(draft?.spread_costs ?? true);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [lines, setLines] = useState<EditLine[]>(() => (initial?.lines?.length ? (initial.lines as LineRow[]).map(fromRow) : [blankLine()]));
  const [chassisFor, setChassisFor] = useState<string | null>(null);
  const [recallOpen, setRecallOpen] = useState(false);
  const [schedules, setSchedules] = useState<{ _key: string; due_date: string; amount: string }[]>(
    () => (initial?.schedules ?? []).map((s) => ({ _key: `s${counter++}`, due_date: s.due_date ?? '', amount: String(s.amount ?? '') })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Brouillon : recharger la fiche du fournisseur
  const { data: draftSupplier } = useQuery({
    queryKey: ['contact-supplier', draft?.supplier_id], enabled: !!draft?.supplier_id && !supplier,
    queryFn: async () => (await listSuppliers(companyId, '', 500)).find((s) => s.id === draft?.supplier_id) ?? null,
  });
  useEffect(() => { if (draftSupplier && !supplier) setSupplier(draftSupplier); }, [draftSupplier, supplier]);

  // Conditions d'achat du fournisseur (régime TVA, port fixe, remise dépannage) : défauts d'un NOUVEAU document
  useEffect(() => {
    let cancel = false;
    if (!supplier) { setCond(null); return; }
    getSupplierConditions(supplier.id).then((c) => {
      if (cancel) return;
      setCond(c);
      if (!draft) {
        if (c.supplier_vat_regime) setVatRegime(c.supplier_vat_regime);
        if (c.supplier_shipping_fixed && !shippingHt && (docType === 'REC' || docType === 'CMD')) setShippingHt(String(c.supplier_shipping_fixed));
      }
    }).catch(() => setCond(null));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id]);

  const rushDiscount = cond?.supplier_rush_discount_pct ?? 0;
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== key) : [blankLine(defaultLineDiscount(orderType || null, rushDiscount))]));

  const plain = lines.map(({ _key, mgmt_type, pack_qty, reference, ordered, received, remaining, source_number, ...l }) => l);
  const totals = computePurchaseTotals(plain.map((l) => ({ ...l, chassis: null })), {
    vatRegime, globalDiscountPct: num(discountPct), shippingHt: num(shippingHt), shippingTaxed,
    shippingVatRate: cond?.supplier_shipping_vat_rate ?? 21,
  });
  const landed = useMemo(() => landedUnitCosts(
    lines.map((l) => ({ quantity: l.quantity, unit_price_ht: l.unit_price_ht, discount_pct: l.discount_pct,
      stocked: !!l.article_id && !NON_STOCKED_MGMT.includes(String(l.mgmt_type ?? 'A')) })),
    { globalDiscountPct: num(discountPct), shippingHt: num(shippingHt), spread: spreadCosts },
  ), [lines, discountPct, shippingHt, spreadCosts]);

  const recalled = lines.some((l) => l.source_line_id);
  const partialCount = lines.filter((l) => l.source_line_id && l.remaining != null && l.quantity < (l.remaining ?? 0)).length;
  const missingCount = lines.filter((l) => l.source_line_id && l.quantity === 0).length;
  const qtyTotal = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  const applyRecall = (picked: OpenLine[]) => {
    const added: EditLine[] = picked.map((o) => ({
      _key: `pl${counter++}`, article_id: o.article_id, designation: o.designation, supplier_ref: o.supplier_ref ?? '',
      quantity: o.remaining, unit_price_ht: o.unit_price_ht, discount_pct: o.discount_pct, vat_rate: o.vat_rate,
      sale_price_ttc: o.sale_price_ttc, bin_location: o.bin_location ?? '', labels: 0, source_line_id: o.line_id,
      contact_id: o.contact_id, mgmt_type: o.mgmt_type, pack_qty: o.pack_qty, reference: o.reference,
      ordered: o.quantity, received: o.received, remaining: o.remaining, source_number: o.order_number,
    }));
    setLines((ls) => [...ls.filter((l) => l.article_id || l.designation.trim()), ...added]);
    if (picked[0]?.order_type && !orderType) setOrderType(picked[0].order_type as PurchaseOrderType);
    setRecallOpen(false);
  };

  // Rappel direct d'une commande (bouton « Réceptionner » de la commande) : fournisseur + lignes restant à recevoir
  const { data: recallData } = useQuery({
    queryKey: ['recall-order', companyId, recallOrderId], enabled: !!recallOrderId && !initial,
    queryFn: async () => {
      const full = await getPurchaseFull(recallOrderId!);
      const sups = await listSuppliers(companyId, '', 500);
      const open = await listOpenLines(companyId, full.order.supplier_id, 'CMD', recallOrderId!);
      return { supplier: sups.find((x) => x.id === full.order.supplier_id) ?? null, open };
    },
  });
  useEffect(() => {
    if (!recallData || recalled) return;
    if (recallData.supplier) setSupplier(recallData.supplier);
    const open = recallData.open.filter((o) => o.remaining > 0);
    if (open.length) applyRecall(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recallData]);

  const labelsAll = () => setLines((ls) => ls.map((l) => (l.article_id ? { ...l, labels: Math.max(0, Math.round(l.quantity)) } : l)));

  const save = async (validate: boolean) => {
    setBusy(true); setError(null);
    try {
      let payload = lines.filter((l) => l.designation.trim() || l.article_id);
      if (validate && docType === 'REC') payload = payload.filter((l) => !(l.source_line_id && l.quantity <= 0));
      if (payload.length === 0) { setError(t('purchases.needLine')); setBusy(false); return; }
      if (validate && !supplier) { setError(t('purchasesG8.needSupplier')); setBusy(false); return; }
      if (validate && docType === 'REC') {
        // Châssis (lot parc) : une moto par ligne, sur un article, VIN présent et non répété — avant tout appel.
        const ce = receptionChassisErrors(payload);
        if (ce.length) { setError(fillVars(t(`parcG8.${ce[0].error}`), { line: String(ce[0].index + 1), vin: ce[0].vin ?? '' })); setBusy(false); return; }
      }
      const res = await savePurchaseDoc({
        companyId, id: draft?.id ?? null, validate,
        header: {
          doc_type: docType, supplier_id: supplier?.id ?? null, vat_regime: vatRegime, order_type: orderType || null,
          supplier_invoice_no: invoiceNo || null, supplier_bl_no: blNo || null, intranet_no: intranetNo || null,
          invoice_date: invoiceDate || null, bl_date: blDate || null, receipt_date: docType === 'REC' ? receiptDate || null : null,
          order_date: docType === 'CMD' || docType === 'PCF' ? orderDate || null : null, expected_date: expectedDate || null,
          shipping_ht: num(shippingHt), shipping_taxed: shippingTaxed, shipping_vat_rate: cond?.supplier_shipping_vat_rate ?? 21,
          global_discount_pct: num(discountPct), spread_costs: spreadCosts, notes: notes || null,
        },
        lines: payload.map(({ _key, mgmt_type, pack_qty, reference, ordered, received, remaining, source_number, ...l }) => ({
          ...l, chassis: l.chassis?.vin?.trim() ? l.chassis : null,
        })),
        schedules: schedules.filter((s) => num(s.amount) > 0 || s.due_date).map((s, i) => ({ seq_no: i + 1, due_date: s.due_date || null, amount: num(s.amount) })),
      });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['purchase-docs'] });
      qc.invalidateQueries({ queryKey: ['purchase-full', res.id] });
      if (validate) {
        toast.success(fillVars(t('purchasesG8.validated'), { number: res.number ?? '' }));
        for (const w of res.warnings ?? []) toast.warning(fillVars(t(`purchasesG8.warn_${w.kind}`), { designation: w.designation ?? '' }));
        for (const o of res.orders ?? []) toast.info(fillVars(t('purchasesG8.orderNowStatus'), { number: o.number ?? '', status: t(`purchases.status_${o.status}`) }));
      } else {
        toast.success(t('purchasesG8.draftSaved'));
      }
      navigate({ to: '/purchases/$orderId', params: { orderId: res.id }, search: validate && docType === 'REC' ? { infos: 1 } : {} });
      setBusy(false);
    } catch (e) { setError(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };

  const removeDraft = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try { await deletePurchaseDraft(draft.id); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); navigate({ to: '/purchases' }); }
    catch (e) { setError(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };

  const isRec = docType === 'REC';
  const isOrderLike = docType === 'CMD' || docType === 'PCF';

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label={t('purchases.docType')}>
          <Select value={docType} onValueChange={(v) => setDocType(v as PurchaseDocType)} disabled={recalled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['REC', 'CMD', 'PCF', 'RTF'] as PurchaseDocType[]).map((d) => <SelectItem key={d} value={d}>{t(`purchases.type_${d}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('purchases.supplier')}>
          {supplier ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{supplierName(supplier)}</span>
              {!recalled && <button type="button" onClick={() => setSupplier(null)} className="ml-auto text-muted-foreground hover:text-danger" aria-label={t('action.cancel')}><X className="size-4" /></button>}
            </div>
          ) : <SupplierPicker companyId={companyId} onPick={setSupplier} />}
        </Field>
        <Field label={t('purchasesG8.operator')}>
          <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">{profile?.full_name ?? profile?.email ?? '—'}</div>
        </Field>
        {docType !== 'RTF' && (
          <Field label={t('purchasesG8.orderType')}>
            <Select value={orderType || 'none'} onValueChange={(v) => {
              const ot = v === 'none' ? '' : (v as PurchaseOrderType);
              setOrderType(ot);
              const d = defaultLineDiscount(ot || null, rushDiscount);
              setLines((ls) => ls.map((l) => (l.source_line_id ? l : { ...l, discount_pct: d })));
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('purchasesG8.orderType_none')}</SelectItem>
                {PURCHASE_ORDER_TYPES.map((o) => <SelectItem key={o} value={o}>{t(`purchasesG8.orderType_${o}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t('purchases.vatRegime')}>
          <Select value={vatRegime} onValueChange={(v) => setVatRegime(v as VatRegimeCode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="with_vat">{t('purchases.regime_with_vat')}</SelectItem>
              <SelectItem value="cee">{t('purchases.regime_cee')}</SelectItem>
              <SelectItem value="outside_cee">{t('purchases.regime_outside_cee')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {isRec && <Field label={t('purchases.receiptDate')}><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></Field>}
        {isOrderLike && <Field label={t('purchases.orderDate')}><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>}
        {isOrderLike && <Field label={t('purchases.expectedDate')}><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>}
        {(isRec || docType === 'RTF') && <Field label={t('purchases.invoiceNo')}><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>}
        {(isRec || docType === 'RTF') && <Field label={t('purchases.invoiceDate')}><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>}
        {isRec && <Field label={t('purchases.blNo')}><Input value={blNo} onChange={(e) => setBlNo(e.target.value)} /></Field>}
        {isRec && <Field label={t('purchases.blDate')}><Input type="date" value={blDate} onChange={(e) => setBlDate(e.target.value)} /></Field>}
        <Field label={t('purchases.intranetNo')}><Input value={intranetNo} onChange={(e) => setIntranetNo(e.target.value)} /></Field>
      </div>

      {cond && (cond.supplier_franco_min || cond.supplier_order_min || cond.supplier_order_min_qty || cond.supplier_customer_no) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">
          <Info className="size-4" />
          {cond.supplier_customer_no && <span>{t('purchasesG8.customerNo')} : <b className="font-mono">{cond.supplier_customer_no}</b></span>}
          {cond.supplier_franco_min ? <span>{t('proposal.franco')} : <b className="tabular-nums">{eur(cond.supplier_franco_min)}</b>{totals.lines_ht >= cond.supplier_franco_min ? ` (${t('purchasesG8.reached')})` : ''}</span> : null}
          {cond.supplier_order_min ? <span>{t('proposal.orderMin')} : <b className="tabular-nums">{eur(cond.supplier_order_min)}</b></span> : null}
          {cond.supplier_order_min_qty ? <span>{t('purchasesG8.minQty')} : <b className="tabular-nums">{qtyFmt(cond.supplier_order_min_qty)}</b> ({qtyFmt(qtyTotal)})</span> : null}
          {orderType === 'depannage' && rushDiscount > 0 && <span>{fillVars(t('purchasesG8.rushApplied'), { pct: qtyFmt(rushDiscount) })}</span>}
        </div>
      )}

      {/* Rappel */}
      {(isRec || docType === 'CMD') && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!supplier} onClick={() => setRecallOpen(true)} title={!supplier ? t('purchasesG8.needSupplier') : undefined}>
            <Undo2 /> {isRec ? t('purchasesG8.recallOrder') : t('purchasesG8.recallProposal')}
          </Button>
          {isRec && <Button variant="outline" onClick={labelsAll}><Tags /> {t('purchasesG8.labelsAll')}</Button>}
          {recalled && isRec && (partialCount > 0 || missingCount > 0) && (
            <span className="rounded-md bg-warning-bg px-2 py-1 text-[12px] text-warning">
              {fillVars(t('purchasesG8.partialHint'), { n: partialCount + missingCount })}
            </span>
          )}
        </div>
      )}

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th className="min-w-[200px]">{t('purchases.colArticle')}</Th>
              <Th className="w-28">{t('purchases.colSupplierRef')}</Th>
              {recalled && <Th className="w-28 text-right">{t('purchasesG8.colOrdered')}</Th>}
              <Th className="w-20 text-right">{isRec && recalled ? t('purchasesG8.colReceived') : t('purchases.colQty')}</Th>
              <Th className="w-28 text-right">{t('purchases.colPuHt')}</Th>
              <Th className="w-20 text-right">{t('purchases.colDiscount')}</Th>
              <Th className="w-20 text-right">{t('purchases.colVat')}</Th>
              <Th className="w-24">{t('purchases.colBin')}</Th>
              {isRec && <Th className="w-16 text-right">{t('purchases.colLabels')}</Th>}
              <Th className="w-28 text-right">{t('purchases.colLineHt')}</Th>
              {isRec && <Th className="w-24 text-right">{t('purchasesG8.colLanded')}</Th>}
              <Th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const ht = l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="min-w-[200px] px-2 py-1">
                    {l.article_id ? (
                      <div className="space-y-0.5">
                        <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                        {(l.source_number || l.pack_qty) && (
                          <p className="text-[11px] text-muted-foreground">
                            {l.source_number && <>{fillVars(t('purchasesG8.fromOrder'), { number: l.source_number })} </>}
                            {l.pack_qty && l.pack_qty > 1 ? fillVars(t('purchasesG8.pack'), { n: qtyFmt(l.pack_qty) }) : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      <ArticlePicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => setLine(l._key, {
                          article_id: a.id, designation: a.designation, supplier_ref: a.supplier_ref ?? '', unit_price_ht: a.purchase_price,
                          vat_rate: a.vat_rate, sale_price_ttc: a.sale_price_ttc, bin_location: a.bin_location ?? '',
                          mgmt_type: a.mgmt_type, pack_qty: a.pack_qty, reference: a.reference,
                          quantity: roundToPack(Math.max(l.quantity, 1), a.pack_qty),
                          discount_pct: defaultLineDiscount(orderType || null, rushDiscount),
                        })} />
                    )}
                  </td>
                  <td className="px-2 py-1"><Input value={l.supplier_ref ?? ''} onChange={(e) => setLine(l._key, { supplier_ref: e.target.value })} className="h-8" /></td>
                  {recalled && (
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {l.source_line_id ? <>{qtyFmt(l.ordered ?? 0)}<span className="block text-[11px]">{fillVars(t('purchasesG8.remainingShort'), { n: qtyFmt(l.remaining ?? 0) })}</span></> : '—'}
                    </td>
                  )}
                  <td className="px-2 py-1"><Input type="number" step="0.001" min="0" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: Math.max(0, num(e.target.value)) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.001" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input value={l.bin_location ?? ''} onChange={(e) => setLine(l._key, { bin_location: e.target.value })} className="h-8" maxLength={12} /></td>
                  {isRec && <td className="px-2 py-1"><Input type="number" step="1" min="0" value={String(l.labels ?? 0)} onChange={(e) => setLine(l._key, { labels: Math.max(0, Math.round(num(e.target.value))) })} className="h-8 text-right tabular-nums" /></td>}
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  {isRec && <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{landed[i] == null ? '—' : eur(landed[i]!)}</td>}
                  <td className="whitespace-nowrap px-2 py-1 text-center">
                    {isRec && (
                      <Button size="sm" variant="ghost" title={t('purchases.chassis')} onClick={() => setChassisFor(l._key)}>
                        <Bike className={`size-4 ${l.chassis?.vin ? 'text-success' : 'text-muted-foreground'}`} />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l._key)} aria-label={t('action.delete')}><Trash2 className="size-4 text-danger" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine(defaultLineDiscount(orderType || null, rushDiscount))])}><Plus /> {t('purchases.addLine')}</Button>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('purchases.globalDiscount')}><Input type="number" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} className="w-24 text-right tabular-nums" placeholder="0" /></Field>
          <Field label={t('purchases.shippingHt')}><Input type="number" step="0.01" value={shippingHt} onChange={(e) => setShippingHt(e.target.value)} className="w-28 text-right tabular-nums" placeholder="0,00" /></Field>
          <label className="flex h-9 items-center gap-2 text-[13px]">
            <input type="checkbox" checked={shippingTaxed} onChange={(e) => setShippingTaxed(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('purchases.shippingTaxed')}
          </label>
          {isRec && (
            <label className="flex h-9 items-center gap-2 text-[13px]" title={t('purchasesG8.spreadHint')}>
              <input type="checkbox" checked={spreadCosts} onChange={(e) => setSpreadCosts(e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
              {t('purchasesG8.spread')}
            </label>
          )}
          <div className="flex gap-5 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
            <span>{t('purchases.totalHt')} <b>{eur(totals.total_ht)}</b></span>
            <span className="text-muted-foreground">{t('purchases.totalVat')} {eur(totals.total_vat)}</span>
            <span className="text-base">{t('purchases.totalTtc')} <b>{eur(totals.total_ttc)}</b></span>
          </div>
        </div>
      </div>

      <Field label={t('purchasesG8.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>

      {/* Échéancier de paiement fournisseur */}
      {(isRec || docType === 'CMD') && (
        <div className="space-y-2 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchases.schedules')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setSchedules((ss) => [...ss, { _key: `s${counter++}`, due_date: '', amount: '' }])}><Plus /> {t('purchases.addSchedule')}</Button>
          </div>
          {schedules.map((s) => (
            <div key={s._key} className="flex items-end gap-2">
              <Field label={t('purchases.schedDue')}><Input type="date" value={s.due_date} onChange={(e) => setSchedules((ss) => ss.map((x) => (x._key === s._key ? { ...x, due_date: e.target.value } : x)))} className="w-44" /></Field>
              <Field label={t('purchases.schedAmount')}><Input type="number" step="0.01" value={s.amount} onChange={(e) => setSchedules((ss) => ss.map((x) => (x._key === s._key ? { ...x, amount: e.target.value } : x)))} className="w-32 text-right tabular-nums" placeholder="0,00" /></Field>
              <Button size="sm" variant="ghost" onClick={() => setSchedules((ss) => ss.filter((x) => x._key !== s._key))} aria-label={t('action.delete')}><Trash2 className="size-4 text-danger" /></Button>
            </div>
          ))}
        </div>
      )}

      <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t(`purchasesG8.effect_${docType}`)}</p>
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {draft?.id && <Button variant="outline" onClick={removeDraft} disabled={busy}><Trash2 /> {t('purchasesG8.deleteDraft')}</Button>}
        <Button variant="outline" onClick={() => save(false)} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('purchases.draft')}</Button>
        <Button onClick={() => save(true)} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {fillVars(t('purchasesG8.validateAs'), { type: t(`purchases.type_${docType}`) })}</Button>
      </div>

      {chassisFor && (
        <ChassisDialog
          value={(lines.find((l) => l._key === chassisFor)?.chassis ?? null) as ChassisInput | null}
          onClose={() => setChassisFor(null)}
          onSave={(ch) => { setLine(chassisFor, { chassis: ch as DocLinePayload['chassis'] }); setChassisFor(null); }}
        />
      )}
      {recallOpen && supplier && (
        <RecallDialog
          companyId={companyId}
          supplierId={supplier.id}
          docType={isRec ? 'CMD' : 'PCF'}
          alreadyIds={lines.map((l) => l.source_line_id).filter(Boolean) as string[]}
          onClose={() => setRecallOpen(false)}
          onPick={applyRecall}
        />
      )}
    </div>
  );
}

function fromRow(r: LineRow): EditLine {
  return {
    _key: `pl${counter++}`, article_id: r.article_id, designation: r.designation, supplier_ref: r.supplier_ref ?? '',
    quantity: Number(r.quantity), unit_price_ht: Number(r.unit_price_ht), discount_pct: Number(r.discount_pct), vat_rate: Number(r.vat_rate),
    sale_price_ttc: r.sale_price_ttc == null ? null : Number(r.sale_price_ttc), bin_location: r.bin_location ?? '', labels: r.labels ?? 0,
    source_line_id: r.source_line_id ?? null, contact_id: r.contact_id ?? null, origin_kind: r.origin_kind ?? null,
    origin_id: r.origin_id ?? null, origin_ref: r.origin_ref ?? null,
    chassis: (r.chassis as DocLinePayload['chassis']) ?? null,
  };
}

/* ---------------- Saisie châssis (réception véhicule neuf) ---------------- */
const blankChassis = (): ChassisInput => ({ vin: '', brand: '', model: '', engine_number: '', power_cv: null, is_restricted: false, energy: '', antipollution: '', color: '', first_registration_date: '', mileage: null, model_year: null, gps_tracker_id: '', pin_tracker: '', tpms_av: '', tpms_ar: '', warranty_end: '' });

function ChassisDialog({ value, onClose, onSave }: { value: ChassisInput | null; onClose: () => void; onSave: (c: ChassisInput) => void }) {
  const [c, setC] = useState<ChassisInput>(() => value ?? blankChassis());
  const set = <K extends keyof ChassisInput>(k: K, v: ChassisInput[K]) => setC((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('purchases.chassisTitle')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t('vehicles.vin')}><Input value={c.vin} onChange={(e) => set('vin', e.target.value.toUpperCase())} className="font-mono" maxLength={17} /></Field>
          <Field label={t('vehicles.brand')}><Input value={c.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label={t('vehicles.model')}><Input value={c.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
          <Field label={t('vehicles.engineNumber')}><Input value={c.engine_number ?? ''} onChange={(e) => set('engine_number', e.target.value)} /></Field>
          <Field label={t('vehicles.powerCv')}><Input type="number" step="0.1" value={c.power_cv ?? ''} onChange={(e) => set('power_cv', e.target.value ? num(e.target.value) : null)} className="text-right tabular-nums" /></Field>
          <Field label={t('vehicles.energy')}><Input value={c.energy ?? ''} onChange={(e) => set('energy', e.target.value)} /></Field>
          <Field label={t('vehicles.antipollution')}><Input value={c.antipollution ?? ''} onChange={(e) => set('antipollution', e.target.value)} /></Field>
          <Field label={t('vehicles.color')}><Input value={c.color ?? ''} onChange={(e) => set('color', e.target.value)} /></Field>
          <Field label={t('vehicles.firstRegistration')}><Input type="date" value={c.first_registration_date ?? ''} onChange={(e) => set('first_registration_date', e.target.value)} /></Field>
          <Field label={t('vehicles.mileage')}><Input type="number" value={c.mileage ?? ''} onChange={(e) => set('mileage', e.target.value ? Math.round(num(e.target.value)) : null)} className="text-right tabular-nums" /></Field>
          <Field label={t('vehicles.modelYear')}><Input type="number" value={c.model_year ?? ''} onChange={(e) => set('model_year', e.target.value ? Math.round(num(e.target.value)) : null)} className="text-right tabular-nums" /></Field>
          <Field label={t('vehicles.warrantyEnd')}><Input type="date" value={c.warranty_end ?? ''} onChange={(e) => set('warranty_end', e.target.value)} /></Field>
          <Field label={t('vehicles.gpsTracker')}><Input value={c.gps_tracker_id ?? ''} onChange={(e) => set('gps_tracker_id', e.target.value)} /></Field>
          <Field label={t('vehicles.pinTracker')}><Input value={c.pin_tracker ?? ''} onChange={(e) => set('pin_tracker', e.target.value)} /></Field>
          <Field label={t('vehicles.tpmsAv')}><Input value={c.tpms_av ?? ''} onChange={(e) => set('tpms_av', e.target.value)} /></Field>
          <Field label={t('vehicles.tpmsAr')}><Input value={c.tpms_ar ?? ''} onChange={(e) => set('tpms_ar', e.target.value)} /></Field>
          <label className="col-span-2 flex h-9 items-center gap-2 self-end text-sm sm:col-span-1">
            <input type="checkbox" checked={!!c.is_restricted} onChange={(e) => set('is_restricted', e.target.checked)} className="size-4 accent-[var(--ducati-red)]" />
            {t('vehicles.restricted')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => onSave(c)} disabled={!c.vin.trim()}>{t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Pickers ---------------- */
function SupplierPicker({ companyId, onPick }: { companyId: string; onPick: (s: Supplier) => void }) {
  const [term, setTerm] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const { data } = useQuery({ queryKey: ['supplier-pick', companyId, deb], queryFn: () => listSuppliers(companyId, deb), enabled: deb.length >= 1 });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('purchases.supplierPlaceholder')} className="h-9 pl-9" />
      {data && data.length > 0 && deb.length >= 1 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.slice(0, 8).map((s) => (
            <button key={s.id} type="button" onClick={() => onPick(s)} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">{supplierName(s)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticlePicker({ companyId, value, onText, onPick }: { companyId: string; value: string; onText: (v: string) => void; onPick: (a: PurchaseArticle) => void }) {
  const [deb, setDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setDeb(value.trim()), 250); return () => clearTimeout(id); }, [value]);
  const { data } = useQuery({ queryKey: ['purch-art', companyId, deb], queryFn: () => searchPurchaseArticles(companyId, deb), enabled: deb.length >= 2 });
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={t('purchases.lineArticleOrText')} className="h-8" />
      {data && data.length > 0 && deb.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-[var(--shadow-modal)]">
          {data.map((a) => (
            <button key={a.id} type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-mono text-[12px]">{a.reference}</span><span className="truncate">{a.designation}</span><span className="ml-auto tabular-nums text-muted-foreground">{eur(a.purchase_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</label>{children}</div>;
}
function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${className}`}>{children}</th>;
}
