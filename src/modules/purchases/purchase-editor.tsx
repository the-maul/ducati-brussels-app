/**
 * M4 — Éditeur de document d'achat (réception REC / commande CMD).
 * En-tête (fournisseur, n° facture/BL, dates, régime TVA, port) + lignes
 * (article, réf frs, qté, PA HT, casier, étiquettes, PV TTC) + totaux.
 * Réception validée → entrées de stock + PAMP. Libellés via i18n.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, Search, X, Save, CheckCircle2, Bike } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { listSuppliers, supplierName, searchPurchaseArticles, type Supplier, type PurchaseArticle } from './api';
import { createPurchaseOrder, computePurchaseTotals, type PurchaseLineInput, type VatRegime, type ChassisInput } from './write-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

type EditLine = PurchaseLineInput & { _key: string };
let counter = 0;
const blankLine = (): EditLine => ({ _key: `pl${counter++}`, article_id: null, designation: '', supplier_ref: '', quantity: 1, unit_price_ht: 0, discount_pct: 0, vat_rate: 21, sale_price_ttc: null, bin_location: '', labels: 0 });

export function PurchaseEditor({ companyId, initialDocType = 'REC' }: { companyId: string; initialDocType?: 'REC' | 'CMD' }) {
  const navigate = useNavigate();
  const [docType, setDocType] = useState<'REC' | 'CMD'>(initialDocType);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [vatRegime, setVatRegime] = useState<VatRegime>('with_vat');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [blNo, setBlNo] = useState('');
  const [intranetNo, setIntranetNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shippingHt, setShippingHt] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [chassisFor, setChassisFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l._key !== key) : ls));

  const totals = computePurchaseTotals(lines.map(({ _key, ...l }) => l), {
    vatRegime, globalDiscountPct: num(discountPct), shippingHt: num(shippingHt), shippingTaxed: true,
  });

  const save = async (status: 'brouillon' | 'validee') => {
    setBusy(true); setError(null);
    try {
      const payload = lines.filter((l) => l.designation.trim() || l.article_id).map(({ _key, ...l }) => l);
      if (payload.length === 0) { setError(t('purchases.needLine')); setBusy(false); return; }
      const id = await createPurchaseOrder({
        companyId, docType, supplierId: supplier?.id ?? null, status, vatRegime,
        supplierInvoiceNo: invoiceNo || null, supplierBlNo: blNo || null, intranetNo: intranetNo || null,
        invoiceDate: invoiceDate || null, receiptDate: receiptDate || null,
        shippingHt: num(shippingHt), shippingTaxed: true, globalDiscountPct: num(discountPct), lines: payload,
      });
      navigate({ to: '/purchases/$orderId', params: { orderId: id } });
    } catch (e) { setError(e instanceof Error ? e.message : t('purchases.errSave')); setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label={t('purchases.docType')}>
          <Select value={docType} onValueChange={(v) => setDocType(v as 'REC' | 'CMD')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="REC">{t('purchases.type_REC')}</SelectItem><SelectItem value="CMD">{t('purchases.type_CMD')}</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label={t('purchases.supplier')}>
          {supplier ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
              <span className="truncate">{supplierName(supplier)}</span>
              <button type="button" onClick={() => setSupplier(null)} className="ml-auto text-muted-foreground hover:text-danger"><X className="size-4" /></button>
            </div>
          ) : <SupplierPicker companyId={companyId} onPick={setSupplier} />}
        </Field>
        <Field label={t('purchases.vatRegime')}>
          <Select value={vatRegime} onValueChange={(v) => setVatRegime(v as VatRegime)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="with_vat">{t('purchases.regime_with_vat')}</SelectItem>
              <SelectItem value="cee">{t('purchases.regime_cee')}</SelectItem>
              <SelectItem value="outside_cee">{t('purchases.regime_outside_cee')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('purchases.receiptDate')}><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></Field>
        <Field label={t('purchases.invoiceNo')}><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
        <Field label={t('purchases.blNo')}><Input value={blNo} onChange={(e) => setBlNo(e.target.value)} /></Field>
        <Field label={t('purchases.invoiceDate')}><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
        <Field label={t('purchases.intranetNo')}><Input value={intranetNo} onChange={(e) => setIntranetNo(e.target.value)} /></Field>
      </div>

      {/* Lignes */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse font-data text-[13px]">
          <thead className="bg-muted">
            <tr>
              <Th>{t('purchases.colArticle')}</Th>
              <Th className="w-24">{t('purchases.colSupplierRef')}</Th>
              <Th className="w-16 text-right">{t('purchases.colQty')}</Th>
              <Th className="w-24 text-right">{t('purchases.colPuHt')}</Th>
              <Th className="w-16 text-right">{t('purchases.colDiscount')}</Th>
              <Th className="w-14 text-right">{t('purchases.colVat')}</Th>
              <Th className="w-20">{t('purchases.colBin')}</Th>
              <Th className="w-14 text-right">{t('purchases.colLabels')}</Th>
              <Th className="w-24 text-right">{t('purchases.colLineHt')}</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const ht = l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
              return (
                <tr key={l._key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 min-w-[200px]">
                    {l.article_id ? (
                      <Input value={l.designation} onChange={(e) => setLine(l._key, { designation: e.target.value })} className="h-8" />
                    ) : (
                      <ArticlePicker companyId={companyId} value={l.designation}
                        onText={(v) => setLine(l._key, { designation: v })}
                        onPick={(a) => setLine(l._key, { article_id: a.id, designation: a.designation, supplier_ref: a.supplier_ref ?? '', unit_price_ht: a.purchase_price, vat_rate: a.vat_rate, sale_price_ttc: a.sale_price_ttc, bin_location: a.bin_location ?? '' })} />
                    )}
                  </td>
                  <td className="px-2 py-1"><Input value={l.supplier_ref ?? ''} onChange={(e) => setLine(l._key, { supplier_ref: e.target.value })} className="h-8" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.001" value={String(l.quantity)} onChange={(e) => setLine(l._key, { quantity: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.001" value={String(l.unit_price_ht)} onChange={(e) => setLine(l._key, { unit_price_ht: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.discount_pct)} onChange={(e) => setLine(l._key, { discount_pct: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input type="number" step="0.1" value={String(l.vat_rate)} onChange={(e) => setLine(l._key, { vat_rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-2 py-1"><Input value={l.bin_location ?? ''} onChange={(e) => setLine(l._key, { bin_location: e.target.value })} className="h-8" maxLength={12} /></td>
                  <td className="px-2 py-1"><Input type="number" step="1" value={String(l.labels ?? 0)} onChange={(e) => setLine(l._key, { labels: Math.max(0, Math.round(num(e.target.value))) })} className="h-8 text-right tabular-nums" /></td>
                  <td className="px-3 py-1 text-right tabular-nums">{eur(ht)}</td>
                  <td className="px-2 py-1 text-center whitespace-nowrap">
                    {docType === 'REC' && (
                      <Button size="sm" variant="ghost" title={t('purchases.chassis')} onClick={() => setChassisFor(l._key)}>
                        <Bike className={`size-4 ${l.chassis?.vin ? 'text-success' : 'text-muted-foreground'}`} />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l._key)}><Trash2 className="size-4 text-danger" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t('purchases.addLine')}</Button>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('purchases.globalDiscount')}><Input type="number" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} className="w-24 text-right tabular-nums" placeholder="0" /></Field>
          <Field label={t('purchases.shippingHt')}><Input type="number" step="0.01" value={shippingHt} onChange={(e) => setShippingHt(e.target.value)} className="w-28 text-right tabular-nums" placeholder="0,00" /></Field>
          <div className="flex gap-5 rounded-md border border-border bg-card px-4 py-2 font-data text-sm tabular-nums">
            <span>{t('purchases.totalHt')} <b>{eur(totals.total_ht)}</b></span>
            <span className="text-muted-foreground">{t('purchases.totalVat')} {eur(totals.total_vat)}</span>
            <span className="text-base">{t('purchases.totalTtc')} <b>{eur(totals.total_ttc)}</b></span>
          </div>
        </div>
      </div>

      {docType === 'REC' && <p className="rounded-md bg-info-bg px-3 py-2 text-[12px] text-info">{t('purchases.receivedInfo')}</p>}
      {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => save('brouillon')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t('purchases.draft')}</Button>
        <Button onClick={() => save('validee')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t('purchases.validate')}</Button>
      </div>

      {chassisFor && (
        <ChassisDialog
          value={lines.find((l) => l._key === chassisFor)?.chassis ?? null}
          onClose={() => setChassisFor(null)}
          onSave={(ch) => { setLine(chassisFor, { chassis: ch }); setChassisFor(null); }}
        />
      )}
    </div>
  );
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
          <Field label={t('vehicles.vin')}><Input value={c.vin} onChange={(e) => set('vin', e.target.value)} className="font-mono" maxLength={17} /></Field>
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
