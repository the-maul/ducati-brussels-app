/**
 * M4 — Fiche fournisseur, rattrapage G8 (18/11/2026) : onglets « Conditions d'achat » (encours de commande,
 * franco, minimum en montant / quantité, port fixe + taux TVA du port, remise dépannage, régime TVA d'achat,
 * n° client chez le fournisseur, sites internet / B2B, texte de bas de commande), « Documents »,
 * « Chiffre d'affaires » (N, N-1, N-2) et « Remises fin d'année ». La fiche contact (coordonnées) reste
 * l'onglet « Fiche ».
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Plus, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { useConfirm } from '@/components/confirm-provider';
import { RAYONS_SORTED, sousRayonsFor, categoriesFor } from '@/modules/articles/product-families';
import {
  getSupplierConditions, updateSupplierConditions, getSupplierOpenOrders, getSupplierTurnover, listPurchaseDocuments,
  listYearEndRebates, saveYearEndRebate, deleteYearEndRebate, type SupplierConditions, type YearEndRebate,
} from './g8-api';
import { listSuppliers, supplierName } from './api';
import { purchaseStatusTone, PURCHASE_DOC_TYPES, type PurchaseDocType, type VatRegimeCode } from './g8-rules';
import { t, fillVars } from '@/lib/i18n';

const eur = (n: number | null | undefined) => `${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const toStr = (v: number | null) => (v == null ? '' : String(v));
const toNum = (s: string) => { const x = s.trim() === '' ? null : Number(s.replace(',', '.')); return x == null || !Number.isFinite(x) ? null : x; };

/* ------------------------------------------------------------------ Conditions d'achat + encours */
export function SupplierConditionsPanel({ supplierId, readOnly }: { supplierId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['supplier-conditions', supplierId], queryFn: () => getSupplierConditions(supplierId) });
  const open = useQuery({ queryKey: ['supplier-open-orders', supplierId], queryFn: () => getSupplierOpenOrders(supplierId) });
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const c = q.data;
    setF({
      supplier_customer_no: c.supplier_customer_no ?? '', supplier_franco_min: toStr(c.supplier_franco_min),
      supplier_order_min: toStr(c.supplier_order_min), supplier_order_min_qty: toStr(c.supplier_order_min_qty),
      supplier_shipping_fixed: toStr(c.supplier_shipping_fixed), supplier_shipping_vat_rate: toStr(c.supplier_shipping_vat_rate),
      supplier_rush_discount_pct: toStr(c.supplier_rush_discount_pct), supplier_vat_regime: c.supplier_vat_regime ?? 'with_vat',
      supplier_website: c.supplier_website ?? '', supplier_b2b_url: c.supplier_b2b_url ?? '', supplier_order_footer: c.supplier_order_footer ?? '',
      supplier_rfa_rate: toStr(c.supplier_rfa_rate),
    });
  }, [q.data]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const c: SupplierConditions = {
        supplier_customer_no: f.supplier_customer_no?.trim() || null, supplier_franco_min: toNum(f.supplier_franco_min ?? ''),
        supplier_order_min: toNum(f.supplier_order_min ?? ''), supplier_order_min_qty: toNum(f.supplier_order_min_qty ?? ''),
        supplier_shipping_fixed: toNum(f.supplier_shipping_fixed ?? ''), supplier_shipping_vat_rate: toNum(f.supplier_shipping_vat_rate ?? ''),
        supplier_rush_discount_pct: toNum(f.supplier_rush_discount_pct ?? ''), supplier_vat_regime: (f.supplier_vat_regime || 'with_vat') as VatRegimeCode,
        supplier_website: f.supplier_website?.trim() || null, supplier_b2b_url: f.supplier_b2b_url?.trim() || null,
        supplier_order_footer: f.supplier_order_footer?.trim() || null, supplier_rfa_rate: toNum(f.supplier_rfa_rate ?? ''),
      };
      await updateSupplierConditions(supplierId, c);
      toast.success(t('feedback.saved'));
      qc.invalidateQueries({ queryKey: ['supplier-conditions', supplierId] });
      qc.invalidateQueries({ queryKey: ['contact', supplierId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); }
    setBusy(false);
  };

  if (q.isLoading) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />;
  if (q.error) return <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{(q.error as Error).message}</p>;
  const numField = (k: string, label: string, step = '0.01') => (
    <Field label={label}><Input type="number" step={step} min="0" value={f[k] ?? ''} disabled={readOnly} onChange={(e) => set(k, e.target.value)} className="text-right tabular-nums" /></Field>
  );
  const link = (url: string | undefined) => (url ? <a href={/^https?:/i.test(url) ? url : `https://${url}`} target="_blank" rel="noopener noreferrer" className="text-info"><ExternalLink className="size-4" /></a> : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('purchasesG8.openOrders')}</p>
          <p className="font-data text-lg font-bold tabular-nums">{open.data ? eur(open.data.amount_ht) : '…'}</p>
          {open.data && <p className="text-[12px] text-muted-foreground">{fillVars(t('purchasesG8.openOrdersDetail'), { orders: open.data.orders, lines: open.data.lines })}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('purchasesG8.customerNo')}><Input value={f.supplier_customer_no ?? ''} disabled={readOnly} onChange={(e) => set('supplier_customer_no', e.target.value)} /></Field>
        <Field label={t('purchases.vatRegime')}>
          <Select value={f.supplier_vat_regime || 'with_vat'} onValueChange={(v) => set('supplier_vat_regime', v)} disabled={readOnly}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="with_vat">{t('purchases.regime_with_vat')}</SelectItem>
              <SelectItem value="cee">{t('purchases.regime_cee')}</SelectItem>
              <SelectItem value="outside_cee">{t('purchases.regime_outside_cee')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {numField('supplier_franco_min', t('proposal.franco'))}
        {numField('supplier_order_min', t('proposal.orderMin'))}
        {numField('supplier_order_min_qty', t('purchasesG8.minQty'), '1')}
        {numField('supplier_shipping_fixed', t('purchasesG8.shippingFixed'))}
        {numField('supplier_shipping_vat_rate', t('purchasesG8.shippingVatRate'), '0.1')}
        {numField('supplier_rush_discount_pct', t('purchasesG8.rushDiscount'), '0.1')}
        {numField('supplier_rfa_rate', t('purchasesG8.rfaRate'), '0.1')}
        <Field label={t('purchasesG8.website')}><div className="flex items-center gap-2"><Input value={f.supplier_website ?? ''} disabled={readOnly} onChange={(e) => set('supplier_website', e.target.value)} />{link(f.supplier_website)}</div></Field>
        <Field label={t('purchasesG8.b2b')}><div className="flex items-center gap-2"><Input value={f.supplier_b2b_url ?? ''} disabled={readOnly} onChange={(e) => set('supplier_b2b_url', e.target.value)} />{link(f.supplier_b2b_url)}</div></Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label={t('purchasesG8.orderFooter')}><Textarea rows={2} value={f.supplier_order_footer ?? ''} disabled={readOnly} onChange={(e) => set('supplier_order_footer', e.target.value)} /></Field>
        </div>
      </div>
      {!readOnly && <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}</Button></div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Documents du fournisseur */
export function SupplierDocumentsPanel({ companyId, supplierId }: { companyId: string; supplierId: string }) {
  const navigate = useNavigate();
  const [type, setType] = useState<PurchaseDocType | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery({
    queryKey: ['purchase-docs', companyId, supplierId, type, from, to],
    queryFn: () => listPurchaseDocuments(companyId, type === 'all' ? null : type, { from: from || null, to: to || null, supplierId }),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('purchases.colType')}>
          <Select value={type} onValueChange={(v) => setType(v as PurchaseDocType | 'all')}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('purchasesG8.allTypes')}</SelectItem>
              {PURCHASE_DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{t(`purchases.type_${d}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('purchasesG8.from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field label={t('purchasesG8.to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>{[t('purchases.colNumber'), t('purchases.colType'), t('purchases.colDate'), t('purchases.colStatus'), t('purchases.blNo'), t('purchases.blDate'),
              t('purchases.invoiceNo'), t('purchases.invoiceDate'), t('purchases.totalHt'), t('purchases.colTtc')].map((h, i) => <Th key={i} className={i >= 8 ? 'text-right' : ''}>{h}</Th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={10} className="py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.data?.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">{t('purchases.empty')}</td></tr>}
            {q.data?.map((d) => (
              <tr key={d.id} onClick={() => navigate({ to: '/purchases/$orderId', params: { orderId: d.id }, search: {} })} className="cursor-pointer border-t border-border hover:bg-accent">
                <td className="px-3 py-2 font-mono text-[12px]">{d.number ?? '—'}</td>
                <td className="px-3 py-2">{t(`purchases.type_${d.doc_type}`)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.doc_date ?? '—'}</td>
                <td className="px-3 py-2"><StatusBadge tone={purchaseStatusTone(d.status)} label={t(`purchases.status_${d.status}`)} /></td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.supplier_bl_no ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.bl_date ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.supplier_invoice_no ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{d.invoice_date ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(d.total_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(d.total_ttc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Chiffre d'affaires N, N-1, N-2 */
export function SupplierTurnoverPanel({ supplierId }: { supplierId: string }) {
  const q = useQuery({ queryKey: ['supplier-turnover', supplierId], queryFn: () => getSupplierTurnover(supplierId) });
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">{t('purchasesG8.turnoverHint')}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>{[t('purchasesG8.year'), t('purchasesG8.purchases'), t('purchasesG8.returns'), t('purchasesG8.receiptsCount'), t('purchasesG8.sales'), t('purchasesG8.margin')].map((h, i) => <Th key={i} className={i > 0 ? 'text-right' : ''}>{h}</Th>)}</tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.error && <tr><td colSpan={6} className="px-3 py-3 text-danger">{(q.error as Error).message}</td></tr>}
            {q.data?.map((r, i) => (
              <tr key={r.fiscal_year} className="border-t border-border">
                <td className="px-3 py-2 font-bold">{r.fiscal_year} <span className="font-normal text-muted-foreground">{i === 0 ? 'N' : `N-${i}`}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.purchases_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.returns_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.receipts}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.sales_ht)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.margin_ht)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Remises de fin d'année */
type RfaForm = { id?: string | null; supplier_id: string; rayon: string; sous: string; cat: string; label: string; rebate_pct: string; amount: string; rebate_date: string; note: string };
const familyCode = (f: RfaForm) => [f.rayon, f.sous, f.cat].filter(Boolean).join('-') || null;

export function YearEndRebatesPanel({ companyId, supplierId }: { companyId: string; supplierId?: string | null }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['rfa', companyId, supplierId ?? 'all'], queryFn: () => listYearEndRebates(companyId, supplierId) });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers-all', companyId], queryFn: () => listSuppliers(companyId, '', 500), enabled: !supplierId });
  const [edit, setEdit] = useState<RfaForm | null>(null);
  const [busy, setBusy] = useState(false);
  const total = (q.data ?? []).reduce((s, r) => s + r.amount, 0);
  const supName = (id: string) => supplierName(suppliers?.find((s) => s.id === id) ?? { company_name: null, first_name: null, last_name: null });
  const famLabel = (code: string | null) => {
    if (!code) return t('purchasesG8.allFamilies');
    const [r, s, c] = code.split('-');
    const rl = RAYONS_SORTED.find((x) => x.code === r)?.label ?? r;
    const sl = s ? sousRayonsFor(r).find((x) => x.code === s)?.label ?? s : null;
    const cl = c && s ? categoriesFor(r, s).find((x) => x.code === c)?.label ?? c : null;
    return [rl, sl, cl].filter(Boolean).join(' › ');
  };
  const openNew = () => setEdit({ supplier_id: supplierId ?? '', rayon: '', sous: '', cat: '', label: '', rebate_pct: '', amount: '', rebate_date: new Date().toISOString().slice(0, 10), note: '' });
  const openEdit = (r: YearEndRebate) => {
    const [rayon = '', sous = '', cat = ''] = (r.family_code ?? '').split('-');
    setEdit({ id: r.id, supplier_id: r.supplier_id, rayon, sous, cat, label: r.label, rebate_pct: toStr(r.rebate_pct), amount: String(r.amount), rebate_date: r.rebate_date, note: r.note ?? '' });
  };
  const save = async () => {
    if (!edit) return;
    if (!edit.supplier_id || !edit.label.trim()) { toast.error(t('purchasesG8.rfaNeed')); return; }
    setBusy(true);
    try {
      await saveYearEndRebate({
        id: edit.id ?? null, company_id: companyId, supplier_id: edit.supplier_id, family_code: familyCode(edit), label: edit.label.trim(),
        rebate_pct: toNum(edit.rebate_pct), amount: toNum(edit.amount) ?? 0, rebate_date: edit.rebate_date, note: edit.note.trim() || null,
      });
      toast.success(t('feedback.saved'));
      qc.invalidateQueries({ queryKey: ['rfa', companyId] });
      setEdit(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); }
    setBusy(false);
  };
  const remove = async (r: YearEndRebate) => {
    if (!(await confirm({ variant: 'delete' }))) return;
    try { await deleteYearEndRebate(r.id); qc.invalidateQueries({ queryKey: ['rfa', companyId] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('purchases.errSave')); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">{t('purchasesG8.rfaHint')}</p>
        <Button variant="outline" onClick={openNew}><Plus /> {t('purchasesG8.rfaNew')}</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted"><tr>{[t('purchasesG8.rfaLabel'), ...(supplierId ? [] : [t('purchases.colSupplier')]), t('purchasesG8.family'), t('purchases.colDate'), t('purchasesG8.rfaPct'), t('purchasesG8.rfaAmount'), ''].map((h, i) => <Th key={i}>{h}</Th>)}</tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={7} className="py-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>}
            {q.data?.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{t('purchasesG8.rfaEmpty')}</td></tr>}
            {q.data?.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{r.label}</td>
                {!supplierId && <td className="px-3 py-2">{supName(r.supplier_id)}</td>}
                <td className="px-3 py-2 text-[12px]">{famLabel(r.family_code)}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{r.rebate_date}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.rebate_pct == null ? '—' : `${r.rebate_pct} %`}</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur(r.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)} aria-label={t('action.edit')}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label={t('action.delete')}><Trash2 className="size-4 text-danger" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
          {(q.data?.length ?? 0) > 0 && (
            <tfoot><tr className="border-t border-border bg-muted"><td colSpan={supplierId ? 4 : 5} className="px-3 py-2 text-right font-bold">{t('purchasesG8.total')}</td><td className="px-3 py-2 text-right font-bold tabular-nums">{eur(total)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
      {edit && (
        <Dialog open onOpenChange={(o) => { if (!o) setEdit(null); }}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{t('purchasesG8.rfaTitle')}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {!supplierId && (
                <div className="sm:col-span-2"><Field label={t('purchases.colSupplier')}>
                  <Select value={edit.supplier_id || 'none'} onValueChange={(v) => setEdit({ ...edit, supplier_id: v === 'none' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{t('proposal.chooseSupplier')}</SelectItem>{(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{supplierName(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </Field></div>
              )}
              <Field label={t('purchasesG8.rayon')}>
                <Select value={edit.rayon || 'none'} onValueChange={(v) => setEdit({ ...edit, rayon: v === 'none' ? '' : v, sous: '', cat: '' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">{t('purchasesG8.allFamilies')}</SelectItem>{RAYONS_SORTED.map((r) => <SelectItem key={r.code} value={r.code}>{r.code} {r.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('purchasesG8.sousRayon')}>
                <Select value={edit.sous || 'none'} onValueChange={(v) => setEdit({ ...edit, sous: v === 'none' ? '' : v, cat: '' })} disabled={!edit.rayon}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{(edit.rayon ? sousRayonsFor(edit.rayon) : []).map((s) => <SelectItem key={s.code} value={s.code}>{s.code} {s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('purchasesG8.categorie')}>
                <Select value={edit.cat || 'none'} onValueChange={(v) => setEdit({ ...edit, cat: v === 'none' ? '' : v })} disabled={!edit.sous}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{(edit.rayon && edit.sous ? categoriesFor(edit.rayon, edit.sous) : []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code} {c.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('purchases.colDate')}><Input type="date" value={edit.rebate_date} onChange={(e) => setEdit({ ...edit, rebate_date: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label={t('purchasesG8.rfaLabel')}><Input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field></div>
              <Field label={t('purchasesG8.rfaPct')}><Input type="number" step="0.01" value={edit.rebate_pct} onChange={(e) => setEdit({ ...edit, rebate_pct: e.target.value })} className="text-right tabular-nums" /></Field>
              <Field label={t('purchasesG8.rfaAmount')}><Input type="number" step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} className="text-right tabular-nums" /></Field>
              <div className="sm:col-span-2"><Field label={t('purchasesG8.notes')}><Textarea rows={2} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>{t('action.cancel')}</Button>
              <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('action.save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
