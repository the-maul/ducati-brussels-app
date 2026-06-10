/**
 * M2 — Formulaire article (création + édition).
 * Sections : identification (type B1), fournisseur/logistique, prix/TVA, options.
 */
import { useState, type ReactNode } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { MGMT_TYPES, type Article, type ArticleInsert, type ArticleMgmtType, type KitBillingMode } from './api';

type FormState = {
  reference: string;
  designation: string;
  brand: string;
  mgmt_type: ArticleMgmtType;
  category_path: string;
  descriptif: string;
  show_descriptif_on_documents: boolean;
  note: string;
  size: string;
  color: string;
  weight_volume_length: string;
  measure_unit: string;
  supplier_ref: string;
  bin_location: string;
  pack_qty: string;
  stock_min: string;
  stock_max: string;
  purchase_price: string;
  pamp: string;
  sale_price_ht: string;
  sale_price_ttc: string;
  coefficient: string;
  vat_rate: string;
  eco_tax_ttc: string;
  deee: boolean;
  sales_account: string;
  purchase_account: string;
  kit_billing_mode: KitBillingMode | '';
  reprise_prefix: string;
  publishable: boolean;
  is_library: boolean;
};

function fromArticle(a: Article | null): FormState {
  const s = (n: number | null | undefined) => (n != null ? String(n) : '');
  return {
    reference: a?.reference ?? '',
    designation: a?.designation ?? '',
    brand: a?.brand ?? '',
    mgmt_type: a?.mgmt_type ?? 'A',
    category_path: a?.category_path ?? '',
    descriptif: a?.descriptif ?? '',
    show_descriptif_on_documents: a?.show_descriptif_on_documents ?? false,
    note: a?.note ?? '',
    size: a?.size ?? '',
    color: a?.color ?? '',
    weight_volume_length: s(a?.weight_volume_length),
    measure_unit: a?.measure_unit ?? '',
    supplier_ref: a?.supplier_ref ?? '',
    bin_location: a?.bin_location ?? '',
    pack_qty: a ? s(a.pack_qty) : '1',
    stock_min: a ? s(a.stock_min) : '0',
    stock_max: a ? s(a.stock_max) : '0',
    purchase_price: a ? s(a.purchase_price) : '0',
    pamp: a ? s(a.pamp) : '0',
    sale_price_ht: s(a?.sale_price_ht),
    sale_price_ttc: a ? s(a.sale_price_ttc) : '0',
    coefficient: s(a?.coefficient),
    vat_rate: a ? s(a.vat_rate) : '21',
    eco_tax_ttc: a ? s(a.eco_tax_ttc) : '0',
    deee: a?.deee ?? false,
    sales_account: a?.sales_account ?? '',
    purchase_account: a?.purchase_account ?? '',
    kit_billing_mode: a?.kit_billing_mode ?? '',
    reprise_prefix: a?.reprise_prefix ?? '',
    publishable: a?.publishable ?? false,
    is_library: a?.is_library ?? false,
  };
}

const num = (s: string, def = 0) => (s.trim() === '' ? def : Number(s));
const nnum = (s: string) => (s.trim() === '' ? null : Number(s));
const nn = (s: string) => (s.trim() === '' ? null : s.trim());

export function buildPayload(f: FormState, companyId: string): ArticleInsert {
  return {
    company_id: companyId,
    reference: f.reference.trim(),
    designation: f.designation.trim(),
    brand: nn(f.brand),
    mgmt_type: f.mgmt_type,
    category_path: nn(f.category_path),
    descriptif: nn(f.descriptif),
    show_descriptif_on_documents: f.show_descriptif_on_documents,
    note: nn(f.note),
    size: nn(f.size),
    color: nn(f.color),
    weight_volume_length: nnum(f.weight_volume_length),
    measure_unit: nn(f.measure_unit),
    supplier_ref: nn(f.supplier_ref),
    bin_location: nn(f.bin_location),
    pack_qty: num(f.pack_qty, 1),
    stock_min: num(f.stock_min),
    stock_max: num(f.stock_max),
    purchase_price: num(f.purchase_price),
    pamp: num(f.pamp),
    sale_price_ht: nnum(f.sale_price_ht),
    sale_price_ttc: num(f.sale_price_ttc),
    coefficient: nnum(f.coefficient),
    vat_rate: num(f.vat_rate, 21),
    eco_tax_ttc: num(f.eco_tax_ttc),
    deee: f.deee,
    sales_account: nn(f.sales_account),
    purchase_account: nn(f.purchase_account),
    kit_billing_mode: f.kit_billing_mode === '' ? null : f.kit_billing_mode,
    reprise_prefix: nn(f.reprise_prefix),
    publishable: f.publishable,
    is_library: f.is_library,
  };
}

export function ArticleForm({
  initial, companyId, submitting, error, onSubmit, onCancel,
}: {
  initial: Article | null;
  companyId: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (payload: ArticleInsert) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => fromArticle(initial));
  const [localError, setLocalError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.reference.trim() || !f.designation.trim()) { setLocalError(t('articles.requiredRef')); return; }
    onSubmit(buildPayload(f, companyId));
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title={t('articles.secMain')}>
        <Field label={t('articles.reference')}>
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('articles.designation')} wide>
          <Input value={f.designation} onChange={(e) => set('designation', e.target.value)} />
        </Field>
        <Field label={t('articles.brand')}>
          <Input value={f.brand} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label={t('articles.mgmtType')}>
          <Select value={f.mgmt_type} onValueChange={(v) => set('mgmt_type', v as ArticleMgmtType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MGMT_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('articles.categoryPath')}>
          <Input value={f.category_path} onChange={(e) => set('category_path', e.target.value)} placeholder="Rayon / sous-rayon" />
        </Field>
        <Field label={t('articles.size')}>
          <Input value={f.size} onChange={(e) => set('size', e.target.value)} />
        </Field>
        <Field label={t('articles.color')}>
          <Input value={f.color} onChange={(e) => set('color', e.target.value)} />
        </Field>
      </Section>

      <Section title={t('articles.secDescription')}>
        <Field label={t('articles.descriptif')} wide>
          <Textarea value={f.descriptif} onChange={(e) => set('descriptif', e.target.value)} rows={2} />
        </Field>
        <Field label={t('articles.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        <div className="col-span-full">
          <Check label={t('articles.showDescriptifDoc')} checked={f.show_descriptif_on_documents} onChange={(v) => set('show_descriptif_on_documents', v)} />
        </div>
      </Section>

      <Section title={t('articles.secSupplier')}>
        <Field label={t('articles.supplierRef')}>
          <Input value={f.supplier_ref} onChange={(e) => set('supplier_ref', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('articles.binLocation')}>
          <Input value={f.bin_location} onChange={(e) => set('bin_location', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('articles.packQty')}>
          <NumInput value={f.pack_qty} onChange={(v) => set('pack_qty', v)} />
        </Field>
        <Field label={t('articles.stockMin')}>
          <NumInput value={f.stock_min} onChange={(v) => set('stock_min', v)} />
        </Field>
        <Field label={t('articles.stockMax')}>
          <NumInput value={f.stock_max} onChange={(v) => set('stock_max', v)} />
        </Field>
        <Field label={t('articles.weightVolumeLength')}>
          <NumInput value={f.weight_volume_length} onChange={(v) => set('weight_volume_length', v)} step="0.001" />
        </Field>
        <Field label={t('articles.measureUnit')}>
          <Input value={f.measure_unit} onChange={(e) => set('measure_unit', e.target.value)} placeholder="kg, L, cm…" />
        </Field>
      </Section>

      <Section title={t('articles.secPricing')}>
        <Field label={t('articles.purchasePrice')}>
          <NumInput value={f.purchase_price} onChange={(v) => set('purchase_price', v)} step="0.001" />
        </Field>
        <Field label={t('articles.pamp')}>
          <NumInput value={f.pamp} onChange={(v) => set('pamp', v)} step="0.001" />
        </Field>
        <Field label={t('articles.salePriceTtc')}>
          <NumInput value={f.sale_price_ttc} onChange={(v) => set('sale_price_ttc', v)} step="0.01" />
        </Field>
        <Field label={t('articles.coefficient')}>
          <NumInput value={f.coefficient} onChange={(v) => set('coefficient', v)} step="0.0001" />
        </Field>
        <Field label={t('articles.salePriceHt')}>
          <NumInput value={f.sale_price_ht} onChange={(v) => set('sale_price_ht', v)} step="0.01" />
        </Field>
        <Field label={t('articles.vatRate')}>
          <NumInput value={f.vat_rate} onChange={(v) => set('vat_rate', v)} step="0.1" />
        </Field>
        <Field label={t('articles.ecoTaxTtc')}>
          <NumInput value={f.eco_tax_ttc} onChange={(v) => set('eco_tax_ttc', v)} step="0.01" />
        </Field>
        <div className="col-span-full">
          <Check label={t('articles.deee')} checked={f.deee} onChange={(v) => set('deee', v)} />
        </div>
      </Section>

      <Section title={t('articles.secAccounting')}>
        <Field label={t('articles.salesAccount')}>
          <Input value={f.sales_account} onChange={(e) => set('sales_account', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('articles.purchaseAccount')}>
          <Input value={f.purchase_account} onChange={(e) => set('purchase_account', e.target.value)} className="font-mono" />
        </Field>
      </Section>

      <Section title={t('articles.secEquiv')}>
        <Field label={t('articles.kitBillingMode')}>
          <Select
            value={f.kit_billing_mode || undefined}
            onValueChange={(v) => set('kit_billing_mode', v as KitBillingMode)}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="forfait">{t('articles.kit_forfait')}</SelectItem>
              <SelectItem value="nomenclature">{t('articles.kit_nomenclature')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {(f.mgmt_type === 'R' || f.mgmt_type === 'P') && (
          <Field label={t('articles.reprisePrefix')}>
            <Input value={f.reprise_prefix} onChange={(e) => set('reprise_prefix', e.target.value)} className="font-mono" placeholder="REP-" />
          </Field>
        )}
        <div className="col-span-full flex flex-wrap gap-4">
          <Check label={t('articles.publishable')} checked={f.publishable} onChange={(v) => set('publishable', v)} />
          <Check label={t('articles.isLibrary')} checked={f.is_library} onChange={(v) => set('is_library', v)} />
        </div>
      </Section>

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          {submitting ? t('articles.saving') : initial ? t('articles.save') : t('articles.create')}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 font-ui text-[15px] font-bold text-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 lg:col-span-2' : ''}`}>
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, step = '1' }: { value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="text-right tabular-nums" />
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}
