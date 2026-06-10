/**
 * M2 — Formulaire article (création + édition).
 * Sections : identification (type B1), fournisseur/logistique, prix/TVA, options.
 */
import { useState, type ReactNode } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { MGMT_TYPES, type Article, type ArticleInsert, type ArticleMgmtType } from './api';

type FormState = {
  reference: string;
  designation: string;
  brand: string;
  mgmt_type: ArticleMgmtType;
  category_path: string;
  supplier_ref: string;
  bin_location: string;
  pack_qty: string;
  stock_min: string;
  stock_max: string;
  purchase_price: string;
  pamp: string;
  sale_price_ttc: string;
  coefficient: string;
  vat_rate: string;
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
    supplier_ref: a?.supplier_ref ?? '',
    bin_location: a?.bin_location ?? '',
    pack_qty: a ? s(a.pack_qty) : '1',
    stock_min: a ? s(a.stock_min) : '0',
    stock_max: a ? s(a.stock_max) : '0',
    purchase_price: a ? s(a.purchase_price) : '0',
    pamp: a ? s(a.pamp) : '0',
    sale_price_ttc: a ? s(a.sale_price_ttc) : '0',
    coefficient: s(a?.coefficient),
    vat_rate: a ? s(a.vat_rate) : '21',
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
    supplier_ref: nn(f.supplier_ref),
    bin_location: nn(f.bin_location),
    pack_qty: num(f.pack_qty, 1),
    stock_min: num(f.stock_min),
    stock_max: num(f.stock_max),
    purchase_price: num(f.purchase_price),
    pamp: num(f.pamp),
    sale_price_ttc: num(f.sale_price_ttc),
    coefficient: nnum(f.coefficient),
    vat_rate: num(f.vat_rate, 21),
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
        <Field label={t('articles.vatRate')}>
          <NumInput value={f.vat_rate} onChange={(v) => set('vat_rate', v)} step="0.1" />
        </Field>
      </Section>

      <Section title={t('articles.secEquiv')}>
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
