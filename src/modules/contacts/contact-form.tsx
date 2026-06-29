/**
 * M1 — Formulaire de fiche client (création + édition).
 * Sections : identité, adresse, permis moto, B2B, catégorisation.
 * État contrôlé simple ; mappé vers ContactInsert à la soumission.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Save, RefreshCw, Bike } from 'lucide-react';
import { firstContactVehicle } from './subobjects-api';
import { ContactLinksPanel } from './contact-links-panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { t } from '@/lib/i18n';
import type {
  Contact, ContactInsert, ContactType, CustomerSegment, LicenseCategory, ContactStatus, SaleVatType,
} from './api';

const INTEREST_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'route', labelKey: 'contacts.interestRoute' },
  { key: 'sport', labelKey: 'contacts.interestSport' },
  { key: 'offroad', labelKey: 'contacts.interestOffroad' },
];

// Types d'entreprise (B2B) — formes juridiques belges proposées en suggestions
// (datalist) sur le champ `civility`. Valeur = abréviation réelle (alignée sur les
// données G8 : SRL, SPRL, SA, BV…) ; libellé descriptif FR/NL. Saisie libre conservée
// pour ne perdre aucune valeur existante (formes étrangères, variantes).
const COMPANY_TYPES: { value: string; label: string }[] = [
  { value: 'SRL', label: 'Société à resp. limitée' },
  { value: 'BV', label: 'Besloten vennootschap' },
  { value: 'SA', label: 'Société anonyme' },
  { value: 'NV', label: 'Naamloze vennootschap' },
  { value: 'SC', label: 'Société coopérative' },
  { value: 'CV', label: 'Coöperatieve vennootschap' },
  { value: 'SCRL', label: 'Société coop. à resp. limitée' },
  { value: 'SNC', label: 'Société en nom collectif' },
  { value: 'VOF', label: 'Vennootschap onder firma' },
  { value: 'SComm', label: 'Société en commandite' },
  { value: 'SCS', label: 'Société en commandite simple' },
  { value: 'ASBL', label: 'Association sans but lucratif' },
  { value: 'VZW', label: 'Vereniging zonder winstoogmerk' },
  { value: 'SPRL', label: 'SPRL (ancienne forme)' },
  { value: 'BVBA', label: 'BVBA (oude vorm)' },
  { value: 'Indépendant', label: 'Personne physique / Eenmanszaak' },
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
  ducati_url: string;
  ducati_code: string;
  my_ducati_email: string;
  my_ducati_first_name: string;
  my_ducati_last_name: string;
  my_ducati_synced_at: string;
  my_ducati_data: unknown;
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
    ducati_url: c?.ducati_url ?? '',
    ducati_code: c?.ducati_code ?? '',
    my_ducati_email: c?.my_ducati_email ?? '',
    my_ducati_first_name: c?.my_ducati_first_name ?? '',
    my_ducati_last_name: c?.my_ducati_last_name ?? '',
    my_ducati_synced_at: c?.my_ducati_synced_at ?? '',
    my_ducati_data: c?.my_ducati_data ?? null,
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
    ducati_url: nn(f.ducati_url),
    ducati_code: nn(f.ducati_code),
    my_ducati_email: nn(f.my_ducati_email),
    my_ducati_first_name: nn(f.my_ducati_first_name),
    my_ducati_last_name: nn(f.my_ducati_last_name),
    my_ducati_synced_at: f.my_ducati_synced_at.trim() === '' ? null : f.my_ducati_synced_at,
    my_ducati_data: (f.my_ducati_data ?? null) as ContactInsert['my_ducati_data'],
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
  lockType,
}: {
  initial: Contact | null;
  companyId: string;
  submitting: boolean;
  error?: string | null;
  onSubmit: (payload: ContactInsert) => void;
  onCancel: () => void;
  /** Force et verrouille le type (ex. 'fournisseur' depuis le module Achats). */
  lockType?: ContactType;
}) {
  const [f, setF] = useState<FormState>(() => {
    const s = fromContact(initial);
    return lockType ? { ...s, type: lockType } : s;
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const isPro = f.type === 'professionnel' || f.type === 'fournisseur' || f.type === 'banque_leasing';
  // Un fournisseur / une banque n'est pas un « client » : on masque les sections client
  // (statut prospect/client, permis moto, catégorisation/flags client, centres d'intérêt).
  const isClient = f.type === 'particulier' || f.type === 'professionnel';

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
      <Tabs defaultValue="self" className="w-full">
        <TabsList>
          <TabsTrigger value="self">{isPro ? t('contacts.tabPro') : t('contacts.tabPrivate')}</TabsTrigger>
          {isClient && <TabsTrigger value="linked">{isPro ? t('contacts.tabPrivate') : t('contacts.tabPro')}</TabsTrigger>}
          {isClient && <TabsTrigger value="ducati">{t('contacts.tabDucati')}</TabsTrigger>}
        </TabsList>

        {/* Onglet « comptes liés » (l'autre type) — lier / créer une fiche pro ↔ privé */}
        {isClient && (
        <TabsContent value="linked" className="mt-4 space-y-6">
          {initial
            ? <ContactLinksPanel companyId={companyId} contact={initial} />
            : <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('contacts.linksSaveFirst')}</p>}
        </TabsContent>
        )}

        {/* Onglet principal (« Info pro » ou « Info privée » selon le type) — infos propres de la fiche */}
        <TabsContent value="self" className="mt-4 space-y-6">
          <Section title={t('contacts.secIdentity')}>
            {!lockType && (
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
            )}
            {isClient && (
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
            )}
            <Field label={isClient ? t('contacts.code') : t('contacts.codeGeneric')}>
              <Input value={f.code} onChange={(e) => set('code', e.target.value)} className="font-mono" />
            </Field>
            {isPro && (
              <Field label={t('contacts.companyName')}>
                <Input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} />
              </Field>
            )}
            {isPro ? (
              <Field label={t('contacts.companyType')}>
                <Input list="company-types" value={f.civility} onChange={(e) => set('civility', e.target.value)} placeholder={t('contacts.companyTypePlaceholder')} />
                <datalist id="company-types">
                  {COMPANY_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </datalist>
              </Field>
            ) : (
              <Field label={t('contacts.civility')}>
                <Input value={f.civility} onChange={(e) => set('civility', e.target.value)} placeholder="M / Mme" />
              </Field>
            )}
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

          {isClient && (
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
              <Select value={f.license_category || undefined} onValueChange={(v) => set('license_category', v as LicenseCategory)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(['AM', 'A1', 'A2', 'A', 'B', 'autre'] as const).map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>
          )}

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

          {/* Catégorisation (clients) / Notes */}
          <Section title={isClient ? t('contacts.secCategory') : t('contacts.notes')}>
            {isClient && (<>
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
            </>)}
            <Field label={t('contacts.notes')} wide>
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
            </Field>
          </Section>
        </TabsContent>

        {/* Onglet « Info chez Ducati » — compte My Ducati (rempli par l'extension navigateur) */}
        {isClient && (
        <TabsContent value="ducati" className="mt-4 space-y-6">
          <MyDucatiSection contactId={initial?.id ?? null} f={f} set={set} />
        </TabsContent>
        )}
      </Tabs>

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

/**
 * Section « Infos My Ducati ». Le bouton « Mettre à jour » demande à l'extension
 * navigateur de lire la page My Ducati de la moto liée (par VIN) et de remplir les champs.
 * Contrat avec l'extension : on poste { source:'dms-ducati', action:'fetch-myducati', vin } ;
 * l'extension répond { source:'dms-ducati-ext', action:'myducati-result', vin, payload }.
 */
function MyDucatiSection({ contactId, f, set }: {
  contactId: string | null;
  f: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  const vehQ = useQuery({ queryKey: ['contact-first-vehicle', contactId], queryFn: () => firstContactVehicle(contactId!), enabled: !!contactId });
  const vin = vehQ.data?.vin ?? null;
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchFromMyDucati = () => {
    if (!vin) return;
    setBusy(true); setStatus(t('contacts.myDucatiFetching'));
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { source?: string; action?: string; payload?: Record<string, unknown> } | null;
      if (!d || d.source !== 'dms-ducati-ext' || d.action !== 'myducati-result') return;
      window.removeEventListener('message', onMsg); clearTimeout(timer); setBusy(false);
      const p = d.payload ?? {};
      if (p.ducati_code) set('ducati_code', String(p.ducati_code));
      if (p.email) set('my_ducati_email', String(p.email));
      if (p.first_name) set('my_ducati_first_name', String(p.first_name));
      if (p.last_name) set('my_ducati_last_name', String(p.last_name));
      if (p.url) set('ducati_url', String(p.url));
      set('my_ducati_data', p);
      set('my_ducati_synced_at', new Date().toISOString());
      setStatus(t('contacts.myDucatiDone'));
    };
    window.addEventListener('message', onMsg);
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); setBusy(false); setStatus(t('contacts.myDucatiNoExt')); }, 2500);
    window.postMessage({ source: 'dms-ducati', action: 'fetch-myducati', vin }, '*');
  };

  return (
    <Section title={t('contacts.secMyDucati')}>
      <div className="col-span-full flex flex-wrap items-center gap-3">
        {!contactId ? (
          <p className="text-[13px] text-muted-foreground"><Bike className="mr-1 inline size-4" />{t('contacts.myDucatiSaveFirst')}</p>
        ) : !vin ? (
          <p className="text-[13px] text-muted-foreground"><Bike className="mr-1 inline size-4" />{t('contacts.myDucatiNoBike')}</p>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={fetchFromMyDucati} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />} {t('contacts.myDucatiUpdate')}
            </Button>
            <span className="font-mono text-[12px] text-muted-foreground">VIN {vin}</span>
          </>
        )}
        {status && <span className="text-[12px] text-info">{status}</span>}
        {f.my_ducati_synced_at && <span className="text-[11px] text-muted-foreground">{t('contacts.myDucatiSyncedAt')} {new Date(f.my_ducati_synced_at).toLocaleString('fr-BE')}</span>}
      </div>
      <Field label={t('contacts.ducatiCode')}>
        <Input value={f.ducati_code} onChange={(e) => set('ducati_code', e.target.value)} className="font-mono" />
      </Field>
      <Field label={t('contacts.myDucatiEmail')}>
        <Input value={f.my_ducati_email} onChange={(e) => set('my_ducati_email', e.target.value)} />
      </Field>
      <Field label={t('contacts.myDucatiFirstName')}>
        <Input value={f.my_ducati_first_name} onChange={(e) => set('my_ducati_first_name', e.target.value)} />
      </Field>
      <Field label={t('contacts.myDucatiLastName')}>
        <Input value={f.my_ducati_last_name} onChange={(e) => set('my_ducati_last_name', e.target.value)} />
      </Field>
      <Field label={t('contacts.ducatiUrl')} wide>
        <Input value={f.ducati_url} onChange={(e) => set('ducati_url', e.target.value)} placeholder="https://ducati.my.site.com/dealer/s/account/…" />
        <p className="text-[11px] text-muted-foreground">{t('contacts.ducatiUrlHint')}</p>
      </Field>
    </Section>
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
