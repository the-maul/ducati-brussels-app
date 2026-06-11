/**
 * M1 — Formulaire de fiche client (création + édition).
 * Sections : identité, adresse, permis moto, B2B, catégorisation.
 * État contrôlé simple ; mappé vers ContactInsert à la soumission.
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
import type {
  Contact, ContactInsert, ContactType, CustomerSegment, LicenseCategory, ContactStatus, SaleVatType,
} from './api';

const INTEREST_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'route', labelKey: 'contacts.interestRoute' },
  { key: 'sport', labelKey: 'contacts.interestSport' },
  { key: 'offroad', labelKey: 'contacts.interestOffroad' },
];

type FormState = {
  type: ContactType;
  status: ContactStatus;
  code: string;
  civility: string;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  phone: string;
  mobile: string;
  gsm: string;
  address: string;
  address_complement: string;
  address_complement2: string;
  po_box: string;
  zip: string;
  city: string;
  country: string;
  address_mismatch: boolean;
  birth_date: string;
  national_id: string;
  national_register: string;
  license_number: string;
  license_date: string;
  license_place: string;
  license_category: LicenseCategory | '';
  vat_number: string;
  sale_vat_type: SaleVatType;
  payment_terms: string;
  iban: string;
  bic: string;
  domiciliation: string;
  factoring_code: string;
  accounting_account: string;
  credit_limit: string;
  segment: CustomerSegment;
  price_list: string;
  category: string;
  is_vip: boolean;
  is_detaxe: boolean;
  is_watch: boolean;
  is_account: boolean;
  is_blocked: boolean;
  mode_ht: boolean;
  marketing_opt_out: boolean;
  interests: string[];
  notes: string;
  // Fournisseur (M4)
  supplier_customer_no: string;
  supplier_is_internal: boolean;
  supplier_rfa_rate: string;
  supplier_franco_min: string;
  supplier_order_min: string;
};

function fromContact(c: Contact | null): FormState {
  return {
    type: c?.type ?? 'particulier',
    status: c?.status ?? 'prospect',
    code: c?.code ?? '',
    civility: c?.civility ?? '',
    first_name: c?.first_name ?? '',
    last_name: c?.last_name ?? '',
    company_name: c?.company_name ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    mobile: c?.mobile ?? '',
    gsm: c?.gsm ?? '',
    address: c?.address ?? '',
    address_complement: c?.address_complement ?? '',
    address_complement2: c?.address_complement2 ?? '',
    po_box: c?.po_box ?? '',
    zip: c?.zip ?? '',
    city: c?.city ?? '',
    country: c?.country ?? 'BE',
    address_mismatch: c?.address_mismatch ?? false,
    birth_date: c?.birth_date ?? '',
    national_id: c?.national_id ?? '',
    national_register: c?.national_register ?? '',
    license_number: c?.license_number ?? '',
    license_date: c?.license_date ?? '',
    license_place: c?.license_place ?? '',
    license_category: c?.license_category ?? '',
    vat_number: c?.vat_number ?? '',
    sale_vat_type: c?.sale_vat_type ?? 'national',
    payment_terms: c?.payment_terms ?? '',
    iban: c?.iban ?? '',
    bic: c?.bic ?? '',
    domiciliation: c?.domiciliation ?? '',
    factoring_code: c?.factoring_code ?? '',
    accounting_account: c?.accounting_account ?? '',
    credit_limit: c?.credit_limit != null ? String(c.credit_limit) : '',
    segment: c?.segment ?? 'standard',
    price_list: c?.price_list ?? '',
    category: c?.category ?? '',
    is_vip: c?.is_vip ?? false,
    is_detaxe: c?.is_detaxe ?? false,
    is_watch: c?.is_watch ?? false,
    is_account: c?.is_account ?? false,
    is_blocked: c?.is_blocked ?? false,
    mode_ht: c?.mode_ht ?? false,
    marketing_opt_out: c?.marketing_opt_out ?? false,
    interests: c?.interests ?? [],
    notes: c?.notes ?? '',
    supplier_customer_no: c?.supplier_customer_no ?? '',
    supplier_is_internal: c?.supplier_is_internal ?? false,
    supplier_rfa_rate: c?.supplier_rfa_rate != null ? String(c.supplier_rfa_rate) : '',
    supplier_franco_min: c?.supplier_franco_min != null ? String(c.supplier_franco_min) : '',
    supplier_order_min: c?.supplier_order_min != null ? String(c.supplier_order_min) : '',
  };
}

const nn = (s: string) => (s.trim() === '' ? null : s.trim());

export function buildPayload(f: FormState, companyId: string): ContactInsert {
  return {
    company_id: companyId,
    type: f.type,
    status: f.status,
    code: nn(f.code),
    civility: nn(f.civility),
    first_name: nn(f.first_name),
    last_name: nn(f.last_name),
    company_name: nn(f.company_name),
    email: nn(f.email),
    phone: nn(f.phone),
    mobile: nn(f.mobile),
    gsm: nn(f.gsm),
    address: nn(f.address),
    address_complement: nn(f.address_complement),
    address_complement2: nn(f.address_complement2),
    po_box: nn(f.po_box),
    zip: nn(f.zip),
    city: nn(f.city),
    country: nn(f.country) ?? 'BE',
    address_mismatch: f.address_mismatch,
    birth_date: nn(f.birth_date),
    national_id: nn(f.national_id),
    national_register: nn(f.national_register),
    license_number: nn(f.license_number),
    license_date: nn(f.license_date),
    license_place: nn(f.license_place),
    license_category: f.license_category === '' ? null : f.license_category,
    vat_number: nn(f.vat_number),
    sale_vat_type: f.sale_vat_type,
    payment_terms: nn(f.payment_terms),
    iban: nn(f.iban),
    bic: nn(f.bic),
    domiciliation: nn(f.domiciliation),
    factoring_code: nn(f.factoring_code),
    accounting_account: nn(f.accounting_account),
    credit_limit: f.credit_limit.trim() === '' ? 0 : Number(f.credit_limit),
    segment: f.segment,
    price_list: nn(f.price_list),
    category: nn(f.category),
    is_vip: f.is_vip,
    is_detaxe: f.is_detaxe,
    is_watch: f.is_watch,
    is_account: f.is_account,
    is_blocked: f.is_blocked,
    mode_ht: f.mode_ht,
    marketing_opt_out: f.marketing_opt_out,
    interests: f.interests,
    notes: nn(f.notes),
    supplier_customer_no: nn(f.supplier_customer_no),
    supplier_is_internal: f.supplier_is_internal,
    supplier_rfa_rate: f.supplier_rfa_rate.trim() === '' ? null : Number(f.supplier_rfa_rate),
    supplier_franco_min: f.supplier_franco_min.trim() === '' ? null : Number(f.supplier_franco_min),
    supplier_order_min: f.supplier_order_min.trim() === '' ? null : Number(f.supplier_order_min),
  };
}

export function ContactForm({
  initial,
  companyId,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: Contact | null;
  companyId: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (payload: ContactInsert) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => fromContact(initial));
  const [localError, setLocalError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const isPro = f.type === 'professionnel' || f.type === 'fournisseur' || f.type === 'banque_leasing';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.last_name.trim() && !f.company_name.trim()) {
      setLocalError(t('contacts.requiredName'));
      return;
    }
    onSubmit(buildPayload(f, companyId));
  };

  const toggleInterest = (key: string, on: boolean) =>
    set('interests', on ? [...f.interests, key] : f.interests.filter((i) => i !== key));

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Identité */}
      <Section title={t('contacts.secIdentity')}>
        <Field label={t('contacts.type')}>
          <Select value={f.type} onValueChange={(v) => set('type', v as ContactType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="particulier">{t('contacts.type_particulier')}</SelectItem>
              <SelectItem value="professionnel">{t('contacts.type_professionnel')}</SelectItem>
              <SelectItem value="banque_leasing">{t('contacts.type_banque_leasing')}</SelectItem>
              <SelectItem value="fournisseur">{t('contacts.type_fournisseur')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('contacts.status')}>
          <Select value={f.status} onValueChange={(v) => set('status', v as ContactStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">{t('contacts.status_prospect')}</SelectItem>
              <SelectItem value="client">{t('contacts.status_client')}</SelectItem>
              <SelectItem value="client_piece">{t('contacts.status_client_piece')}</SelectItem>
              <SelectItem value="client_atelier">{t('contacts.status_client_atelier')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('contacts.code')}>
          <Input value={f.code} onChange={(e) => set('code', e.target.value)} className="font-mono" />
        </Field>
        {isPro && (
          <Field label={t('contacts.companyName')}>
            <Input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} />
          </Field>
        )}
        <Field label={t('contacts.civility')}>
          <Input value={f.civility} onChange={(e) => set('civility', e.target.value)} placeholder="M / Mme" />
        </Field>
        <Field label={t('contacts.firstName')}>
          <Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} />
        </Field>
        <Field label={t('contacts.lastName')}>
          <Input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} />
        </Field>
        <Field label={t('contacts.email')}>
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={t('contacts.phone')}>
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={t('contacts.mobile')}>
          <Input value={f.mobile} onChange={(e) => set('mobile', e.target.value)} />
        </Field>
        <Field label={t('contacts.gsm')}>
          <Input value={f.gsm} onChange={(e) => set('gsm', e.target.value)} />
        </Field>
      </Section>

      {/* Adresse */}
      <Section title={t('contacts.secAddress')}>
        <Field label={t('contacts.address')} wide>
          <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label={t('contacts.addressComplement')}>
          <Input value={f.address_complement} onChange={(e) => set('address_complement', e.target.value)} />
        </Field>
        <Field label={t('contacts.addressComplement2')}>
          <Input value={f.address_complement2} onChange={(e) => set('address_complement2', e.target.value)} />
        </Field>
        <Field label={t('contacts.zip')}>
          <Input value={f.zip} onChange={(e) => set('zip', e.target.value)} />
        </Field>
        <Field label={t('contacts.city')}>
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label={t('contacts.country')}>
          <Input value={f.country} onChange={(e) => set('country', e.target.value)} />
        </Field>
        <Field label={t('contacts.poBox')}>
          <Input value={f.po_box} onChange={(e) => set('po_box', e.target.value)} />
        </Field>
        <div className="col-span-full">
          <Check label={t('contacts.addressMismatch')} checked={f.address_mismatch} onChange={(v) => set('address_mismatch', v)} />
        </div>
      </Section>

      {/* Permis & moto */}
      <Section title={t('contacts.secMoto')}>
        <Field label={t('contacts.birthDate')}>
          <Input type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} />
        </Field>
        <Field label={t('contacts.nationalId')}>
          <Input value={f.national_id} onChange={(e) => set('national_id', e.target.value)} />
        </Field>
        <Field label={t('contacts.nationalRegister')}>
          <Input value={f.national_register} onChange={(e) => set('national_register', e.target.value)} />
        </Field>
        <Field label={t('contacts.licenseNumber')}>
          <Input value={f.license_number} onChange={(e) => set('license_number', e.target.value)} />
        </Field>
        <Field label={t('contacts.licenseDate')}>
          <Input type="date" value={f.license_date} onChange={(e) => set('license_date', e.target.value)} />
        </Field>
        <Field label={t('contacts.licensePlace')}>
          <Input value={f.license_place} onChange={(e) => set('license_place', e.target.value)} />
        </Field>
        <Field label={t('contacts.licenseCategory')}>
          <Select
            value={f.license_category || undefined}
            onValueChange={(v) => set('license_category', v as LicenseCategory)}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(['AM', 'A1', 'A2', 'A', 'B', 'autre'] as const).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      {/* B2B */}
      <Section title={t('contacts.secB2B')}>
        <Field label={t('contacts.vatNumber')}>
          <Input value={f.vat_number} onChange={(e) => set('vat_number', e.target.value)} className="font-mono" placeholder="BE0..." />
        </Field>
        <Field label={t('contacts.paymentTerms')}>
          <Input value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} placeholder="30 jours" />
        </Field>
        <Field label={t('contacts.iban')}>
          <Input value={f.iban} onChange={(e) => set('iban', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('contacts.bic')}>
          <Input value={f.bic} onChange={(e) => set('bic', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('contacts.saleVatType')}>
          <Select value={f.sale_vat_type} onValueChange={(v) => set('sale_vat_type', v as SaleVatType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="national">{t('contacts.saleVat_national')}</SelectItem>
              <SelectItem value="intracom">{t('contacts.saleVat_intracom')}</SelectItem>
              <SelectItem value="export">{t('contacts.saleVat_export')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('contacts.creditLimit')}>
          <Input type="number" step="0.01" min="0" value={f.credit_limit} onChange={(e) => set('credit_limit', e.target.value)} className="text-right tabular-nums" />
        </Field>
      </Section>

      <Section title={t('contacts.secAccounting')}>
        <Field label={t('contacts.accountingAccount')}>
          <Input value={f.accounting_account} onChange={(e) => set('accounting_account', e.target.value)} className="font-mono" />
        </Field>
        <Field label={t('contacts.domiciliation')}>
          <Input value={f.domiciliation} onChange={(e) => set('domiciliation', e.target.value)} />
        </Field>
        <Field label={t('contacts.factoringCode')}>
          <Input value={f.factoring_code} onChange={(e) => set('factoring_code', e.target.value)} />
        </Field>
      </Section>

      {/* Fournisseur (M4) — visible pour les fiches fournisseur */}
      {f.type === 'fournisseur' && (
        <Section title={t('contacts.secSupplier')}>
          <Field label={t('contacts.supplierCustomerNo')}>
            <Input value={f.supplier_customer_no} onChange={(e) => set('supplier_customer_no', e.target.value)} />
          </Field>
          <Field label={t('contacts.supplierRfa')}>
            <Input type="number" step="0.01" min="0" value={f.supplier_rfa_rate} onChange={(e) => set('supplier_rfa_rate', e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label={t('contacts.supplierFranco')}>
            <Input type="number" step="0.01" min="0" value={f.supplier_franco_min} onChange={(e) => set('supplier_franco_min', e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label={t('contacts.supplierOrderMin')}>
            <Input type="number" step="0.01" min="0" value={f.supplier_order_min} onChange={(e) => set('supplier_order_min', e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Check label={t('contacts.supplierInternal')} checked={f.supplier_is_internal} onChange={(v) => set('supplier_is_internal', v)} />
        </Section>
      )}

      {/* Catégorisation */}
      <Section title={t('contacts.secCategory')}>
        <Field label={t('contacts.segment')}>
          <Select value={f.segment} onValueChange={(v) => set('segment', v as CustomerSegment)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">{t('contacts.segment_standard')}</SelectItem>
              <SelectItem value="vip">{t('contacts.segment_vip')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('contacts.priceList')}>
          <Input value={f.price_list} onChange={(e) => set('price_list', e.target.value)} />
        </Field>
        <Field label={t('contacts.category')}>
          <Input value={f.category} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <div className="col-span-full grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Check label={t('contacts.flagVip')} checked={f.is_vip} onChange={(v) => set('is_vip', v)} />
          <Check label={t('contacts.flagDetaxe')} checked={f.is_detaxe} onChange={(v) => set('is_detaxe', v)} />
          <Check label={t('contacts.flagWatch')} checked={f.is_watch} onChange={(v) => set('is_watch', v)} />
          <Check label={t('contacts.flagAccount')} checked={f.is_account} onChange={(v) => set('is_account', v)} />
          <Check label={t('contacts.blocked')} checked={f.is_blocked} onChange={(v) => set('is_blocked', v)} />
          <Check label={t('contacts.modeHt')} checked={f.mode_ht} onChange={(v) => set('mode_ht', v)} />
          <Check label={t('contacts.marketingOptOut')} checked={f.marketing_opt_out} onChange={(v) => set('marketing_opt_out', v)} />
        </div>
        <Field label={t('contacts.interests')} wide>
          <div className="flex flex-wrap gap-4 pt-1">
            {INTEREST_OPTIONS.map((opt) => (
              <Check
                key={opt.key}
                label={t(opt.labelKey)}
                checked={f.interests.includes(opt.key)}
                onChange={(v) => toggleInterest(opt.key, v)}
              />
            ))}
          </div>
        </Field>
        <Field label={t('contacts.notes')} wide>
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
        </Field>
      </Section>

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Save />}
          {submitting ? t('contacts.saving') : initial ? t('contacts.save') : t('contacts.create')}
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
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</Label>
      {children}
    </div>
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
