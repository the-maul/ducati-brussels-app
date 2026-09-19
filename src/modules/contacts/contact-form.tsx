/**
 * M1 — Formulaire de fiche client (création + édition).
 * Sections : identité, adresse, permis & ID, B2B, catégorisation.
 * État contrôlé simple ; mappé vers ContactInsert à la soumission.
 */
import { useState, useRef, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, RefreshCw, Bike, ExternalLink, ShieldCheck, ShieldX, ChevronDown } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { listOwnedVehicles, listLinkedContacts } from './subobjects-api';
import { ContactLinksPanel } from './contact-links-panel';
import { ModelInterestBadges } from './model-interest-badges';
import { checkVat, parseViesAddress, kboUrl, companywebUrl } from './vies-api';
import { IdDocsSection } from './id-docs';
import { requestMyDucati } from '@/lib/myducati';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SaveButton, type SaveStatus } from '@/components/ui/save-button';
import { useIsDirty } from '@/lib/use-dirty';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PhoneInput } from '@/components/phone-input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t } from '@/lib/i18n';
import { personCivility, PERSON_CIVILITIES, legalFormOptions } from './civility';
import { normalizeEmail, normalizeMobile, normalizeIban, isValidIban } from '@/lib/contact-normalize';
import { ZipCitySuggest } from '@/components/zip-city-suggest';
import { listRef } from '@/modules/settings/reference-api';
import { findDuplicateContacts, findContactsByEmailOrMobile, contactDisplayName } from './api';
import type {
  Contact, ContactInsert, ContactType, CustomerSegment, LicenseCategory, ContactStatus, SaleVatType,
} from './api';

// ─── Modèles Ducati neufs disponibles à la commande (par famille) ─────────────
// Source : gamme commerciale 2025/2026. Suffixe « 100 » = édition centenaire.
const DUCATI_NEW_MODEL_GROUPS: { family: string; models: string[] }[] = [
  { family: 'DesertX', models: ['DesertX', 'DesertX 100'] },
  { family: 'Diavel', models: ['Diavel V4', 'Diavel V4 RS', 'Diavel V4 RS 100'] },
  { family: 'Heritage', models: ['Formula 73'] },
  { family: 'Hypermotard', models: [
    'Hypermotard 698 Mono', 'Hypermotard 698 Mono RVE', 'Hypermotard 698 Mono Nera',
    'Hypermotard V2', 'Hypermotard V2 SP', 'Hypermotard V2 SP 100',
  ] },
  { family: 'Monster', models: ['Monster', 'Monster +', 'Monster 100'] },
  { family: 'Multistrada', models: [
    'Multistrada V2', 'Multistrada V2 S', 'Multistrada V4', 'Multistrada V4 S',
    'Multistrada V4 Rally', 'Multistrada V4 Pikes Peak', 'Multistrada V4 RS', 'Multistrada V4 RS 100',
  ] },
  { family: 'Off-Road', models: ['Desmo250 MX', 'Desmo450 MX', 'Desmo450 MX Factory', 'Desmo450 EDS'] },
  { family: 'Panigale', models: [
    'Panigale V2', 'Panigale V2 S', 'Panigale V2 S 100',
    'Panigale V2 MM93 (Marc Marquez)', 'Panigale V2 FB63 (Bagnaia)',
    'Panigale V4', 'Panigale V4 S', 'Panigale V4 S 100', 'Panigale V4 R', 'Panigale V4 Tricolore',
    'Panigale V4 Marquez 2025 World Champion Replica',
  ] },
  { family: 'Streetfighter', models: [
    'Streetfighter V2', 'Streetfighter V2 S', 'Streetfighter V4', 'Streetfighter V4 S', 'Streetfighter V4 S 100',
  ] },
  { family: 'Superleggera', models: ['Superleggera V4 Centenario'] },
  { family: 'XDiavel', models: ['XDiavel V4', 'XDiavel V4 100'] },
  { family: 'Scrambler', models: [
    'Scrambler Icon', 'Scrambler Icon Dark', 'Scrambler Full Throttle', 'Scrambler Nightshift',
    'Scrambler 10th Anniversary Rizoma Edition', 'Scrambler 100',
  ] },
  { family: 'E-Bike (THOK)', models: [
    'Powerstage RR Limited Edition', 'TK-01RR', 'MIG-S', 'FUTA', 'FUTA AXS', 'FUTA All-Road',
  ] },
];

// Liste aplatie — utilisée pour les tests d'appartenance (.includes)
const DUCATI_NEW_MODELS: string[] = DUCATI_NEW_MODEL_GROUPS.flatMap((g) => g.models);

// ─── Modèles Ducati anciens (jusqu'à 1990) ────────────────────────────────────
const DUCATI_VINTAGE_MODELS: string[] = [
  // 1990–1994
  '851', '888', '907 IE', '900 SS', '750 SS', '600 SS',
  // 1994–1999
  '916', '916 S', '916 SP', '916 SPS', '916 R',
  '748', '748 S', '748 SP', '748 SPS', '748 R',
  '996', '996 S', '996 R',
  'ST2', 'ST4',
  'Monster 600', 'Monster 750', 'Monster 900', 'Monster M900',
  // 2000–2005
  '998', '998 S', '998 R',
  '999', '999 R', '999 S',
  '749', '749 R', '749 S',
  'ST3', 'ST3 S', 'ST4 S',
  'Monster 620', 'Monster 1000', 'Monster S4', 'Monster S4R',
  'Multistrada 620', 'Multistrada 1000', 'Multistrada 1000 S DS',
  'MH900e',
  // 2006–2009
  '848', '1098', '1098 S', '1098 R',
  'Monster 695', 'Monster 1100', 'Monster S4RS',
  'Multistrada 1100', 'Multistrada 1100 S',
  'Hypermotard 1100', 'Hypermotard 1100 S',
  // 2010–2014
  '848 EVO', '1198', '1198 S', '1198 R',
  '1199 Panigale', '1199 Panigale S', '1199 Panigale R',
  'Monster 696', 'Monster 796', 'Monster 1100 EVO', 'Monster 821',
  'Multistrada 1200', 'Multistrada 1200 S',
  'Hypermotard 796', 'Hypermotard 821', 'Hyperstrada 821',
  'Streetfighter 848', 'Streetfighter 1098', 'Streetfighter S',
  'Diavel', 'Diavel Carbon', 'Diavel Cromo', 'Diavel Titanium', 'Diavel AMG',
  'Scrambler 400 Sixty2', 'Scrambler 800 Café Racer', 'Scrambler 800 Desert Sled',
  'Scrambler 800 Full Throttle', 'Scrambler 800 Icon', 'Scrambler 800 Urban Enduro',
  // 2015–2019
  '959 Panigale',
  'SuperSport 937', 'SuperSport 937 S',
  'Monster 821 S', 'Monster 1200', 'Monster 1200 R', 'Monster 1200 S',
  'Monster 1200 25° Anniversario',
  'Multistrada 950', 'Multistrada 950 S',
  'Multistrada 1260', 'Multistrada 1260 S',
  'Multistrada 1260 Enduro', 'Multistrada 1260 Pikes Peak',
  'Hypermotard 939', 'Hypermotard 939 SP',
  'XDiavel', 'XDiavel S',
  // 2020–2024
  'Monster (2021)', 'Monster SP (2023)',
  'Multistrada V4 (2021)', 'Multistrada V4 S (2021)', 'Multistrada V4 Rally (2021)',
  'Panigale V2 (2020)', 'Panigale V4 R (2023)', 'Panigale V4 SP2 (2022)',
  'Streetfighter V4 (2020)', 'Streetfighter V4 S (2020)',
  'Streetfighter V4 SP (2021)', 'Streetfighter V2 (2022)',
  'DesertX (2022)', 'Diavel V4 (2023)', 'XDiavel V4 (2023)',
  'Hypermotard 698 Mono (2024)',
  'Scrambler Desert Sled (2023)', 'Scrambler Full Throttle (2023)',
  'Scrambler Icon (2023)', 'Scrambler Nightshift (2023)',
];

const PAYMENT_TERMS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'immediat', labelKey: 'contacts.payTermImmediate' },
  { value: '7j', labelKey: 'contacts.payTerm7' },
  { value: '15j', labelKey: 'contacts.payTerm15' },
  { value: '30j', labelKey: 'contacts.payTerm30' },
];

const INTEREST_OPTIONS: { key: string; labelKey: string }[] = [
  { key: 'route', labelKey: 'contacts.interestRoute' },
  { key: 'sport', labelKey: 'contacts.interestSport' },
  { key: 'offroad', labelKey: 'contacts.interestOffroad' },
  { key: 'piste', labelKey: 'contacts.interestPiste' },
  // Intérêts déclarés par le client à l'inscription (mission 01, lot 4).
  { key: 'neuf', labelKey: 'signup.interest.neuf' },
  { key: 'occasion', labelKey: 'signup.interest.occasion' },
  { key: 'atelier', labelKey: 'signup.interest.atelier' },
  { key: 'accessoires', labelKey: 'signup.interest.accessoires' },
  { key: 'evenements', labelKey: 'signup.interest.evenements' },
];

/** Valeur sentinelle : Radix Select interdit un SelectItem de valeur vide. */
const CIVILITY_NONE = '__none__';

type FormState = {
  type: ContactType;
  status: ContactStatus;
  code: string;
  civility: string;
  /** Mission 04, carte 2 : forme juridique d'un pro (colonne legal_form). */
  legal_form: string;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  mobile: string;
  gsm: string;         // affiché comme "Mobile 2"
  address: string;     // rue
  street_number: string;
  address_complement: string;
  address_complement2: string;
  po_box: string;
  zip: string;
  city: string;
  country: string;
  address_mismatch: boolean;
  birth_date: string;
  /** Mission 04, carte 5 : lieu de naissance. */
  birth_place: string;
  national_id: string;
  national_register: string;
  license_number: string;
  license_date: string;
  license_place: string;
  license_category: LicenseCategory | '';
  vat_number: string;
  vies_valid: boolean | null;
  vies_checked_at: string | null;
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
  watch_note: string;
  is_account: boolean;
  is_blocked: boolean;
  mode_ht: boolean;
  marketing_opt_out: boolean;
  interests: string[];
  vehicle_preference: string;
  model_interests: string[];
  notify_model_stock: boolean;
  notes: string;
  // Fournisseur (M4)
  supplier_customer_no: string;
  supplier_is_internal: boolean;
  supplier_rfa_rate: string;
  supplier_franco_min: string;
  supplier_order_min: string;
  supplier_is_dcs: boolean;
};

function fromContact(c: Contact | null): FormState {
  const ext = c as any; // accès aux colonnes ajoutées par migration (types.ts non régénéré)
  return {
    type: c?.type ?? 'particulier',
    status: c?.status ?? 'prospect',
    code: c?.code ?? '',
    // Écritures G8 (MR, MME…) ramenées à Monsieur / Madame ; une forme juridique
    // restée dans `civility` est conservée telle quelle (non affichée, jamais effacée).
    civility: personCivility(c?.civility) ?? c?.civility ?? '',
    legal_form: c?.legal_form ?? '',
    first_name: c?.first_name ?? '',
    last_name: c?.last_name ?? '',
    company_name: c?.company_name ?? '',
    email: c?.email ?? '',
    mobile: c?.mobile ?? '',
    gsm: c?.gsm ?? '',
    address: c?.address ?? '',
    street_number: ext?.street_number ?? '',
    address_complement: c?.address_complement ?? '',
    address_complement2: c?.address_complement2 ?? '',
    po_box: c?.po_box ?? '',
    zip: c?.zip ?? '',
    city: c?.city ?? '',
    country: c?.country ?? 'BE',
    address_mismatch: c?.address_mismatch ?? false,
    birth_date: c?.birth_date ?? '',
    birth_place: c?.birth_place ?? '',
    national_id: c?.national_id ?? '',
    national_register: c?.national_register ?? '',
    license_number: c?.license_number ?? '',
    license_date: c?.license_date ?? '',
    license_place: c?.license_place ?? '',
    license_category: c?.license_category ?? '',
    vat_number: c?.vat_number ?? '',
    vies_valid: c?.vies_valid ?? null,
    vies_checked_at: c?.vies_checked_at ?? null,
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
    watch_note: ext?.watch_note ?? '',
    is_account: c?.is_account ?? false,
    is_blocked: c?.is_blocked ?? false,
    mode_ht: c?.mode_ht ?? false,
    marketing_opt_out: c?.marketing_opt_out ?? false,
    interests: c?.interests ?? [],
    vehicle_preference: ext?.vehicle_preference ?? '',
    model_interests: ext?.model_interests ?? [],
    notify_model_stock: ext?.notify_model_stock ?? false,
    notes: c?.notes ?? '',
    supplier_customer_no: c?.supplier_customer_no ?? '',
    supplier_is_internal: c?.supplier_is_internal ?? false,
    supplier_rfa_rate: c?.supplier_rfa_rate != null ? String(c.supplier_rfa_rate) : '',
    supplier_franco_min: c?.supplier_franco_min != null ? String(c.supplier_franco_min) : '',
    supplier_order_min: c?.supplier_order_min != null ? String(c.supplier_order_min) : '',
    supplier_is_dcs: c?.supplier_is_dcs ?? false,
  };
}

const nn = (s: string) => (s.trim() === '' ? null : s.trim());

export function buildPayload(f: FormState, companyId: string): ContactInsert {
  const base: ContactInsert = {
    company_id: companyId,
    type: f.type,
    status: f.status,
    code: nn(f.code),
    civility: nn(f.civility),
    first_name: nn(f.first_name),
    last_name: nn(f.last_name),
    company_name: nn(f.company_name),
    // Mission 04, carte 4 : e-mail sans espaces, en minuscules (aussi garanti en base).
    email: nn(normalizeEmail(f.email)),
    // `phone` (téléphone repris de G8) n'est plus dans l'écran : on ne l'envoie plus du
    // tout (avant : `phone: null` l'effaçait à chaque enregistrement de la fiche).
    // Mission 04, carte 3 : mobiles au format international (+32…), utilisés pour les SMS.
    mobile: nn(normalizeMobile(f.mobile)),
    gsm: nn(normalizeMobile(f.gsm)),
    address: nn(f.address),
    address_complement: nn(f.address_complement),
    address_complement2: nn(f.address_complement2),
    po_box: nn(f.po_box),
    zip: nn(f.zip),
    city: nn(f.city),
    country: nn(f.country) ?? 'BE',
    address_mismatch: f.address_mismatch,
    birth_date: nn(f.birth_date),
    birth_place: nn(f.birth_place),
    national_id: nn(f.national_id),
    national_register: nn(f.national_register),
    license_number: nn(f.license_number),
    license_date: nn(f.license_date),
    license_place: nn(f.license_place),
    license_category: f.license_category === '' ? null : f.license_category,
    vat_number: nn(f.vat_number),
    vies_valid: f.vies_valid,
    vies_checked_at: f.vies_checked_at,
    sale_vat_type: f.sale_vat_type,
    payment_terms: nn(f.payment_terms),
    // Mission 04, carte 5 : IBAN enregistré sans espaces, en majuscules.
    iban: nn(normalizeIban(f.iban)),
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
    // Mission 04, carte 2 (migration 20260919261000)
    legal_form: nn(f.legal_form),
    interests: f.interests,
    notes: nn(f.notes),
    supplier_customer_no: nn(f.supplier_customer_no),
    supplier_is_internal: f.supplier_is_internal,
    supplier_rfa_rate: f.supplier_rfa_rate.trim() === '' ? null : Number(f.supplier_rfa_rate),
    supplier_franco_min: f.supplier_franco_min.trim() === '' ? null : Number(f.supplier_franco_min),
    supplier_order_min: f.supplier_order_min.trim() === '' ? null : Number(f.supplier_order_min),
    supplier_is_dcs: f.supplier_is_dcs,
  };
  // Colonnes ajoutées par migration 20260629 — pas encore dans types.ts auto-généré
  return Object.assign(base, {
    street_number: nn(f.street_number),
    vehicle_preference: nn(f.vehicle_preference),
    model_interests: f.model_interests,
    notify_model_stock: f.notify_model_stock,
    // Colonne ajoutée par migration 20260726 — pas encore dans types.ts auto-généré
    watch_note: nn(f.watch_note),
  });
}

export function ContactForm({
  initial,
  companyId,
  status,
  error,
  onSubmit,
  onCancel,
  lockType,
}: {
  initial: Contact | null;
  companyId: string;
  status: SaveStatus;
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
  // Mission 04, carte 1 : à la création, seul l'essentiel est ouvert ; le reste est replié.
  const [moreOpen, setMoreOpen] = useState<boolean>(initial !== null || !!lockType);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  // Rien de modifié = rien à enregistrer : le bouton reste grisé.
  const dirty = useIsDirty(f);

  const isPro = f.type === 'professionnel' || f.type === 'fournisseur' || f.type === 'banque_leasing';
  const isClient = f.type === 'particulier' || f.type === 'professionnel' || f.type === 'employe';
  const showB2B = isPro; // B2B uniquement pour les types pro/fournisseur/banque

  // Formes juridiques : table de référence `civility` de Paramètres (lignes « Professionnel »).
  const civilityRefQ = useQuery({
    queryKey: ['ref', companyId, 'civility'],
    queryFn: () => listRef(companyId, 'civility'),
    enabled: isPro,
    staleTime: 300_000,
  });
  const legalForms = legalFormOptions(civilityRefQ.data ?? []);

  const addressTitle = isPro ? t('contacts.secAddressPro') : t('contacts.secAddressPrivate');

  // ── Doublons a la creation ──────────────────────────────────────────
  // Alerte non bloquante : on montre les fiches identiques et on laisse
  // l'utilisateur trancher. Jamais de refus sec (demande client, image 1).
  const [dupes, setDupes] = useState<Contact[] | null>(null);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const pendingPayload = useRef<ContactInsert | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!f.last_name.trim() && !f.company_name.trim()) {
      setLocalError(t('contacts.requiredName'));
      return;
    }
    // Mission 04, carte 5 : IBAN contrôlé (modulo 97) s'il a été saisi ou modifié ;
    // un IBAN repris de G8 non modifié ne bloque pas l'enregistrement du reste.
    if (f.iban.trim() && normalizeIban(f.iban) !== normalizeIban(initial?.iban) && !isValidIban(f.iban)) {
      setMoreOpen(true);
      setLocalError(t('contacts.ibanInvalid'));
      return;
    }
    const payload = buildPayload(f, companyId);

    // Uniquement a la creation : en edition, la fiche serait son propre doublon.
    // Mission 04, carte 1 : même e-mail OU même numéro → on propose d'ouvrir la fiche
    // existante (règle D3 : jamais de fusion automatique), en plus du doublon strict.
    if (!initial) {
      setCheckingDupes(true);
      try {
        const [strict, sameContact] = await Promise.all([
          findDuplicateContacts(companyId, {
            name: f.company_name.trim() || [f.first_name, f.last_name].filter(Boolean).join(' ').trim(),
            city: f.city,
            phone: f.mobile || f.gsm,
            email: f.email,
          }).catch(() => [] as Contact[]),
          findContactsByEmailOrMobile(companyId, { email: f.email, mobile: f.mobile }).catch(() => [] as Contact[]),
        ]);
        const found = [...sameContact, ...strict.filter((c) => !sameContact.some((s) => s.id === c.id))];
        if (found.length > 0) {
          pendingPayload.current = payload;
          setDupes(found);
          return;
        }
      } finally {
        // Un controle indisponible ne doit jamais empecher de creer une fiche.
        setCheckingDupes(false);
      }
    }
    onSubmit(payload);
  };

  const closeDupes = () => { setDupes(null); pendingPayload.current = null; };

  /** L'utilisateur a vu les fiches existantes et choisit de creer quand meme. */
  const confirmDuplicate = () => {
    const payload = pendingPayload.current;
    closeDupes();
    if (payload) onSubmit(payload);
  };

  const toggleInterest = (key: string, on: boolean) =>
    set('interests', on ? [...f.interests, key] : f.interests.filter((i) => i !== key));

  const toggleModelInterest = (model: string, on: boolean) =>
    set('model_interests', on ? [...f.model_interests, model] : f.model_interests.filter((m) => m !== model));

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Fiche deja existante (même e-mail ou même numéro) : on propose de l'ouvrir. */}
      <Dialog open={dupes !== null} onOpenChange={(o) => { if (!o) closeDupes(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('contacts.dupFoundTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">{t('contacts.dupFoundMessage')}</p>
          <div className="max-h-64 space-y-1.5 overflow-auto">
            {(dupes ?? []).map((c) => {
              const sameEmail = !!f.email.trim() && (c.email ?? '').trim().toLowerCase() === f.email.trim().toLowerCase();
              return (
                <div key={c.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {contactDisplayName(c)}
                      {!c.is_active && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">({t('contacts.dupArchived')})</span>}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {[sameEmail ? t('contacts.dupMatchEmail') : t('contacts.dupMatchPhone'), c.city, c.code].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button asChild type="button" size="sm" variant="outline">
                    <Link to="/clients/$contactId" params={{ contactId: c.id }}>{t('contacts.dupOpen')}</Link>
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDupes}>{t('contacts.dupCancel')}</Button>
            <Button type="button" variant="ghost" onClick={confirmDuplicate}>{t('contacts.dupCreateAnyway')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Tabs defaultValue="self" className="w-full">
        <TabsList>
          <TabsTrigger value="self">{isPro ? t('contacts.tabPro') : t('contacts.tabPrivate')}</TabsTrigger>
          {isClient && <TabsTrigger value="linked">{isPro ? t('contacts.tabPrivate') : t('contacts.tabPro')}</TabsTrigger>}
          {isClient && <TabsTrigger value="ducati">{t('contacts.tabDucati')}</TabsTrigger>}
        </TabsList>

        {/* Onglet « comptes liés » */}
        {isClient && (
        <TabsContent value="linked" className="mt-4 space-y-6">
          {initial
            ? <ContactLinksPanel companyId={companyId} contact={initial} />
            : <p className="rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{t('contacts.linksSaveFirst')}</p>}
        </TabsContent>
        )}

        {/* Onglet principal */}
        <TabsContent value="self" className="mt-4 space-y-6">

          {/* ── Identité ───────────────────────────────────────────────────── */}
          <Section title={t('contacts.secEssentials')}>
            {!lockType && (
              <Field label={t('contacts.type')}>
                <Select value={f.type} onValueChange={(v) => set('type', v as ContactType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="particulier">{t('contacts.type_particulier')}</SelectItem>
                    <SelectItem value="professionnel">{t('contacts.type_professionnel')}</SelectItem>
                    <SelectItem value="employe">{t('contacts.type_employe')}</SelectItem>
                    <SelectItem value="banque_leasing">{t('contacts.type_banque_leasing')}</SelectItem>
                    <SelectItem value="fournisseur">{t('contacts.type_fournisseur')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {isPro && (
              <Field label={t('contacts.companyName')}>
                <Input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} />
              </Field>
            )}
            {isPro && (
              <Field label={t('contacts.legalForm')}>
                {/* Mission 04, carte 2 : liste lue dans Paramètres → Tables → Civilités
                    (lignes « Professionnel »), plus de liste codée en dur. */}
                <Select
                  value={f.legal_form || CIVILITY_NONE}
                  onValueChange={(v) => set('legal_form', v === CIVILITY_NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CIVILITY_NONE}>{t('contacts.civilityNone')}</SelectItem>
                    {legalForms.map((o) => (
                      <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                    ))}
                    {f.legal_form && !legalForms.some((o) => o.code === f.legal_form) && (
                      <SelectItem value={f.legal_form}>{f.legal_form}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={isPro ? t('contacts.civilityContact') : t('contacts.civility')}>
              {/* Civilité de la PERSONNE : M. / Mme / Mx. Une forme juridique héritée de G8
                  dans ce champ n'est pas proposée ici (voir « Forme juridique »). */}
              <Select
                value={personCivility(f.civility) ?? CIVILITY_NONE}
                onValueChange={(v) => set('civility', v === CIVILITY_NONE ? '' : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={CIVILITY_NONE}>{t('contacts.civilityNone')}</SelectItem>
                  {PERSON_CIVILITIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{t(c.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('contacts.firstName')}>
              <Input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </Field>
            <Field label={t('contacts.lastName')}>
              <Input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </Field>
            {/* Mobile avec préfixe +32 par défaut */}
            <Field label={t('contacts.mobile')}>
              <PhoneInput value={f.mobile} onChange={(v) => set('mobile', v)} />
              <p className="text-[11px] text-muted-foreground">{t('contacts.mobileSmsHint')}</p>
            </Field>
            <Field label={t('contacts.email')}>
              <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </Section>

          {/* ── Adresse (pro ou privée selon le type) ─────────────────────── */}
          <Section title={addressTitle}>
            <div className="col-span-full grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Rue + Numéro sur la même ligne */}
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('contacts.street')}</Label>
                <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted-foreground">{t('contacts.streetNumber')}</Label>
                <Input value={f.street_number} onChange={(e) => set('street_number', e.target.value)} placeholder="12 A" />
              </div>
            </div>
            <Field label={t('contacts.addressComplement')}>
              <Input value={f.address_complement} onChange={(e) => set('address_complement', e.target.value)} />
            </Field>
            <Field label={t('contacts.poBox')}>
              <Input value={f.po_box} onChange={(e) => set('po_box', e.target.value)} />
            </Field>
            <Field label={t('contacts.zip')}>
              <Input value={f.zip} inputMode="numeric" onChange={(e) => set('zip', e.target.value)} />
            </Field>
            <Field label={t('contacts.city')}>
              <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
              {/* Mission 04, carte 4 : le code postal propose la localité. */}
              <ZipCitySuggest zip={f.zip} country={f.country} city={f.city} onPick={(c) => set('city', c)} />
            </Field>
            <Field label={t('contacts.country')}>
              <Input value={f.country} onChange={(e) => set('country', e.target.value)} />
            </Field>
            <div className="col-span-full">
              <Check label={t('contacts.addressMismatch')} checked={f.address_mismatch} onChange={(v) => set('address_mismatch', v)} />
            </div>
          </Section>

          {/* ── Mission 04, carte 1 : le reste de la fiche, replié à la création ── */}
          <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="space-y-6">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] hover:bg-accent"
              >
                <span>
                  <span className="block font-ui text-[15px] font-bold text-foreground">{t('contacts.secComplete')}</span>
                  <span className="block text-[12px] text-muted-foreground">{t('contacts.secCompleteHint')}</span>
                </span>
                <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6">
          {/* ── Suivi de la fiche (statut, code, second mobile) ─────────────── */}
          <Section title={t('contacts.secFollowUp')}>
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
            {/* Mobile 2 (ex-GSM) avec préfixe */}
            <Field label={t('contacts.mobile2')}>
              <PhoneInput value={f.gsm} onChange={(v) => set('gsm', v)} />
            </Field>
          </Section>

          {/* ── Professionnel (B2B) — juste après l'adresse, uniquement pour pro ── */}
          {showB2B && (
            <Section title={t('contacts.secB2B')}>
              <Field label={t('contacts.vatNumber')} wide>
                <VatField f={f} set={set} />
              </Field>
              <Field label={t('contacts.paymentTerms')}>
                <Select
                  value={PAYMENT_TERMS_OPTIONS.some((o) => o.value === f.payment_terms) ? f.payment_terms : undefined}
                  onValueChange={(v) => set('payment_terms', v)}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('contacts.iban')}>
                <IbanInput value={f.iban} onChange={(v) => set('iban', v)} />
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
          )}

          {/* ── Banque et TVA des particuliers (mission 04, carte 5) ──────── */}
          {isClient && !showB2B && (
            <Section title={t('contacts.secBankVat')}>
              <Field label={t('contacts.vatNumber')} wide>
                <VatField f={f} set={set} />
              </Field>
              <Field label={t('contacts.iban')}>
                <IbanInput value={f.iban} onChange={(v) => set('iban', v)} />
              </Field>
              <Field label={t('contacts.bic')}>
                <Input value={f.bic} onChange={(e) => set('bic', e.target.value)} className="font-mono" />
              </Field>
            </Section>
          )}

          {/* ── Permis & ID (clients uniquement) ──────────────────────────── */}
          {isClient && (
          <Section title={t('contacts.secMoto')}>
            <Field label={t('contacts.birthDate')}>
              <Input type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} />
            </Field>
            <Field label={t('contacts.birthPlace')}>
              <Input value={f.birth_place} onChange={(e) => set('birth_place', e.target.value)} />
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
            {/* Photos recto/verso permis + carte d'identité (GED) + lecture auto */}
            <IdDocsSection
              companyId={companyId}
              contactId={initial?.id ?? null}
              current={{
                first_name: f.first_name, last_name: f.last_name, birth_date: f.birth_date,
                national_id: f.national_id, national_register: f.national_register,
                license_number: f.license_number, license_date: f.license_date,
                license_place: f.license_place, license_category: f.license_category,
              }}
              onApply={(patch) => {
                for (const [k, v] of Object.entries(patch)) {
                  set(k as keyof FormState, v as FormState[keyof FormState]);
                }
              }}
            />
          </Section>
          )}

          {/* ── Comptabilité (pro/fournisseur) ────────────────────────────── */}
          {showB2B && (
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
          )}

          {/* ── Fournisseur (M4) ──────────────────────────────────────────── */}
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
              <Check label={t('contacts.supplierIsDcs')} checked={f.supplier_is_dcs} onChange={(v) => set('supplier_is_dcs', v)} />
            </Section>
          )}

          {/* ── Catégorisation (clients) ──────────────────────────────────── */}
          {isClient && (
          <Section title={t('contacts.secCategory')}>
            <div className="col-span-full grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Check label={t('contacts.flagVip')} checked={f.is_vip} onChange={(v) => set('is_vip', v)} />
              <Check label={t('contacts.flagDetaxe')} checked={f.is_detaxe} onChange={(v) => set('is_detaxe', v)} />
              <Check label={t('contacts.flagWatch')} checked={f.is_watch} onChange={(v) => set('is_watch', v)} />
              <Check label={t('contacts.flagAccount')} checked={f.is_account} onChange={(v) => set('is_account', v)} />
              <Check label={t('contacts.blocked')} checked={f.is_blocked} onChange={(v) => set('is_blocked', v)} />
              <Check label={t('contacts.modeHt')} checked={f.mode_ht} onChange={(v) => set('mode_ht', v)} />
              <Check label={t('contacts.marketingOptOut')} checked={f.marketing_opt_out} onChange={(v) => set('marketing_opt_out', v)} />
            </div>
            {f.is_watch && (
              <Field label={t('contacts.watchNote')} wide>
                <Textarea value={f.watch_note} onChange={(e) => set('watch_note', e.target.value)} rows={2} />
              </Field>
            )}
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

            {/* Préférence VN / VO */}
            <Field label={t('contacts.vehiclePreference')}>
              <Select value={f.vehicle_preference || undefined} onValueChange={(v) => set('vehicle_preference', v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vn">{t('contacts.vp_vn')}</SelectItem>
                  <SelectItem value="vo">{t('contacts.vp_vo')}</SelectItem>
                  <SelectItem value="both">{t('contacts.vp_both')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {/* Balises des modèles sélectionnés — supprimables à tout moment */}
            <Field label={t('contacts.modelInterestsTitle')} wide>
              {f.model_interests.length === 0
                ? <p className="text-[12px] text-muted-foreground">{t('contacts.noModelInterests')}</p>
                : <ModelInterestBadges
                    models={f.model_interests}
                    onRemove={(m) => set('model_interests', f.model_interests.filter((x) => x !== m))}
                  />}
            </Field>

            {/* Modèles neufs d'intérêt */}
            {(!f.vehicle_preference || f.vehicle_preference === 'vn' || f.vehicle_preference === 'both') && (
              <Field label={t('contacts.modelInterestsNew')} wide>
                <p className="mb-1.5 text-[11px] text-muted-foreground">{t('contacts.modelSelectHint')}</p>
                <ModelMultiSelect
                  groups={DUCATI_NEW_MODEL_GROUPS}
                  selected={f.model_interests.filter(m => DUCATI_NEW_MODELS.includes(m))}
                  onChange={(selected) => {
                    const vintage = f.model_interests.filter(m => !DUCATI_NEW_MODELS.includes(m));
                    set('model_interests', [...vintage, ...selected]);
                  }}
                />
              </Field>
            )}

            {/* Modèles anciens d'intérêt */}
            {(!f.vehicle_preference || f.vehicle_preference === 'vo' || f.vehicle_preference === 'both') && (
              <Field label={t('contacts.modelInterestsVintage')} wide>
                <p className="mb-1.5 text-[11px] text-muted-foreground">{t('contacts.modelSelectHint')}</p>
                <ModelMultiSelect
                  models={DUCATI_VINTAGE_MODELS}
                  selected={f.model_interests.filter(m => DUCATI_VINTAGE_MODELS.includes(m))}
                  onChange={(selected) => {
                    const newModels = f.model_interests.filter(m => !DUCATI_VINTAGE_MODELS.includes(m));
                    set('model_interests', [...newModels, ...selected]);
                  }}
                />
              </Field>
            )}

            {/* Notification stock */}
            {f.model_interests.length > 0 && (
              <div className="col-span-full">
                <Check
                  label={t('contacts.notifyModelStock')}
                  checked={f.notify_model_stock}
                  onChange={(v) => set('notify_model_stock', v)}
                />
                {f.notify_model_stock && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {f.model_interests.length} modèle(s) surveill{f.model_interests.length > 1 ? 'és' : 'é'} : {f.model_interests.slice(0, 3).join(', ')}{f.model_interests.length > 3 ? `… +${f.model_interests.length - 3}` : ''}
                  </p>
                )}
              </div>
            )}
          </Section>
          )}

          {/* Notes */}
          <Section title={t('contacts.notes')}>
            <Field label={t('contacts.notes')} wide>
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
            </Field>
          </Section>
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        {/* Onglet « Info chez Ducati » */}
        {isClient && (
        <TabsContent value="ducati" className="mt-4 space-y-6">
          <MyDucatiSection contactId={initial?.id ?? null} f={f} set={set} />
        </TabsContent>
        )}
      </Tabs>

      {(localError || error) && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-[13px] text-danger">{localError || error}</p>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
        <Button type="button" variant="outline" onClick={onCancel}>{t('action.cancel')}</Button>
        <SaveButton
          type="submit"
          // La recherche de doublons précède l'enregistrement : même rendu « en cours ».
          status={checkingDupes ? 'saving' : status}
          savingLabel={checkingDupes ? t('contacts.dupChecking') : undefined}
          disabled={!dirty}
        >
          {initial ? t('contacts.save') : t('contacts.create')}
        </SaveButton>
      </div>
    </form>
  );
}

// ─── Composant : IBAN avec contrôle modulo 97 (mission 04, carte 5) ──────────
function IbanInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const filled = value.trim() !== '';
  const ok = filled && isValidIban(value);
  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        placeholder="BE68 5390 0754 7034"
        aria-invalid={filled && !ok}
      />
      {filled && !ok && (
        <p className="flex items-center gap-1 text-[11px] text-danger"><ShieldX className="size-3" /> {t('contacts.ibanInvalid')}</p>
      )}
      {ok && (
        <p className="flex items-center gap-1 text-[11px] text-success"><ShieldCheck className="size-3" /> {t('contacts.ibanValid')}</p>
      )}
    </div>
  );
}

// ─── Composant : n° TVA avec vérification VIES + préremplissage ──────────────
function VatField({ f, set }: {
  f: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  const verify = useMutation({
    // Toast sur mesure émis ici : on coupe le toast global (mutation-feedback).
    meta: { success: false, error: false },
    mutationFn: () => checkVat(f.vat_number),
    onSuccess: (r) => {
      if (!r) return;
      if (r.status === 'not_configured') { toast.error(t('contacts.viesNotConfigured')); return; }
      if (r.status === 'unavailable') { toast.error(t('contacts.viesUnavailable')); return; }
      // Normalise le numéro affiché + trace le résultat (colonnes vies_*)
      set('vat_number', `${r.country}${r.number}`);
      set('vies_valid', r.status === 'valid');
      set('vies_checked_at', new Date().toISOString());
      if (r.status === 'invalid') { toast.error(t('contacts.viesInvalid')); return; }
      // Préremplissage depuis VIES (uniquement les champs vides)
      const filled: string[] = [];
      if (r.name && !f.company_name.trim()) { set('company_name', r.name); filled.push(t('contacts.companyName')); }
      const addr = parseViesAddress(r.address);
      if (addr.street && !f.address.trim()) { set('address', addr.street); filled.push(t('contacts.street')); }
      if (addr.number && !f.street_number.trim()) set('street_number', addr.number);
      if (addr.zip && !f.zip.trim()) { set('zip', addr.zip); filled.push(t('contacts.zip')); }
      if (addr.city && !f.city.trim()) { set('city', addr.city); filled.push(t('contacts.city')); }
      if (r.country !== 'BE') set('country', r.country === 'EL' ? 'GR' : r.country === 'XI' ? 'GB' : r.country);
      toast.success(filled.length
        ? t('contacts.viesPrefilled').replace('{fields}', filled.join(', '))
        : t('contacts.viesValid'));
    },
    onError: () => toast.error(t('contacts.viesUnavailable')),
  });

  const digits = f.vat_number.replace(/\D/g, '');
  const isBe = /^BE/i.test(f.vat_number.trim()) || !/^[A-Za-z]{2}/.test(f.vat_number.trim());

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={f.vat_number}
          onChange={(e) => { set('vat_number', e.target.value.toUpperCase()); set('vies_valid', null); set('vies_checked_at', null); }}
          className="w-56 font-mono uppercase" placeholder="BE0123456789"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => verify.mutate()} disabled={verify.isPending || !f.vat_number.trim()}>
          {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {verify.isPending ? t('contacts.viesChecking') : t('contacts.viesCheck')}
        </Button>
        {f.vies_valid === true && (
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-success-bg px-2 py-0.5 text-[12px] font-bold uppercase text-success">
            <ShieldCheck className="size-3.5" /> {t('contacts.viesValid')}
          </span>
        )}
        {f.vies_valid === false && (
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-danger-bg px-2 py-0.5 text-[12px] font-bold uppercase text-danger">
            <ShieldX className="size-3.5" /> {t('contacts.viesInvalid')}
          </span>
        )}
        {f.vies_checked_at && (
          <span className="text-[11px] text-muted-foreground">
            {t('contacts.viesCheckedAt')} {new Date(f.vies_checked_at).toLocaleDateString('fr-BE')}
          </span>
        )}
      </div>
      {isBe && digits.length >= 9 && (
        <div className="flex flex-wrap gap-3 text-[12px]">
          <a href={kboUrl(digits)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
            <ExternalLink className="size-3" /> {t('contacts.viesOpenKbo')}
          </a>
          <a href={companywebUrl(digits)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
            <ExternalLink className="size-3" /> {t('contacts.viesOpenCompanyweb')}
          </a>
        </div>
      )}
    </div>
  );
}

// (Saisie téléphone à préfixe pays : composant partagé PhoneInput, voir
// src/components/phone-input.tsx — réutilisé fiches clients / marchands / CRM.)

// (Upload permis / carte d'identité : voir IdDocsSection dans ./id-docs.tsx —
// photos recto/verso en GED + lecture automatique.)

// ─── Composant : liste multi-sélection de modèles Ducati ─────────────────────
// Accepte soit une liste plate (`models`), soit des groupes par famille (`groups`).
function ModelMultiSelect({ models, groups, selected, onChange }: {
  models?: string[];
  groups?: { family: string; models: string[] }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (m: string) =>
    onChange(selected.includes(m) ? selected.filter((s) => s !== m) : [...selected, m]);

  const renderItem = (m: string) => (
    <label key={m} className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-muted/60">
      <Checkbox checked={selected.includes(m)} onCheckedChange={() => toggle(m)} />
      {m}
    </label>
  );

  return (
    <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-background p-2 space-y-0.5">
      {groups
        ? groups.map((g) => (
            <div key={g.family} className="mb-1.5">
              <div className="px-1 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{g.family}</div>
              {g.models.map(renderItem)}
            </div>
          ))
        : (models ?? []).map(renderItem)}
    </div>
  );
}

// ─── Section « Infos My Ducati » ─────────────────────────────────────────────
function MyDucatiSection({ contactId, f, set }: {
  contactId: string | null;
  f: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  const isProType = f.type === 'professionnel' || f.type === 'fournisseur' || f.type === 'banque_leasing';

  // Motos du client (les plus récentes d'abord) → choix du châssis pour la MAJ DCS
  const vehQ = useQuery({
    queryKey: ['contact-vehicles-vins', contactId],
    queryFn: () => listOwnedVehicles(contactId!),
    enabled: !!contactId,
  });
  const vinOptions = (vehQ.data ?? [])
    .filter((v) => v.vehicle.vin)
    .map((v) => ({ vin: v.vehicle.vin as string, label: [v.vehicle.brand, v.vehicle.model].filter(Boolean).join(' ') || '—' }));
  // Défaut = châssis le plus récent ; choix manuel possible
  const [pickedVin, setPickedVin] = useState<string | null>(null);
  const vin = pickedVin ?? vinOptions[0]?.vin ?? null;

  const doUpdate = async () => {
    if (!vin) return;
    const ok = await requestMyDucati(vin);
    toast[ok ? 'info' : 'error'](ok ? t('contacts.myDucatiFetching') : t('contacts.myDucatiNoExt'));
  };

  // Fiches liées (pro ↔ privé) pour la copie des coordonnées
  const linkedQ = useQuery({
    queryKey: ['contact-links-copy', contactId],
    queryFn: () => listLinkedContacts(contactId!),
    enabled: !!contactId,
  });

  /** Copie prénom / nom / e-mail depuis la fiche demandée (propre ou liée). */
  const copyFrom = (wantPro: boolean) => {
    const ownMatches = wantPro === isProType;
    let src: { first_name: string | null; last_name: string | null; email: string | null } | null = null;
    if (ownMatches) {
      src = { first_name: f.first_name || null, last_name: f.last_name || null, email: f.email || null };
    } else {
      const linked = (linkedQ.data ?? []).find((l) =>
        wantPro
          ? (l.contact.type === 'professionnel' || l.contact.type === 'fournisseur' || l.contact.type === 'banque_leasing')
          : l.contact.type === 'particulier');
      if (linked) src = { first_name: linked.contact.first_name, last_name: linked.contact.last_name, email: linked.contact.email };
    }
    if (!src || (!src.first_name && !src.last_name && !src.email)) {
      toast.error(t('contacts.myDucatiCopyNone'));
      return;
    }
    if (src.first_name) set('my_ducati_first_name', src.first_name);
    if (src.last_name) set('my_ducati_last_name', src.last_name);
    if (src.email) set('my_ducati_email', src.email);
    toast.success(t('contacts.myDucatiCopyDone'));
  };

  return (
    <Section title={t('contacts.secMyDucati')}>
      {/* Copie des coordonnées depuis la fiche privée / pro (modifiable ensuite) */}
      <div className="col-span-full flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => copyFrom(false)}>{t('contacts.myDucatiCopyPrivate')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => copyFrom(true)}>{t('contacts.myDucatiCopyPro')}</Button>
      </div>

      <div className="col-span-full flex flex-wrap items-center gap-3">
        {!contactId ? (
          <p className="text-[13px] text-muted-foreground"><Bike className="mr-1 inline size-4" />{t('contacts.myDucatiSaveFirst')}</p>
        ) : vinOptions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground"><Bike className="mr-1 inline size-4" />{t('contacts.myDucatiNoBike')}</p>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={doUpdate}><RefreshCw className="size-4" /> {t('contacts.myDucatiUpdate')}</Button>
            {vinOptions.length > 1 ? (
              <Select value={vin ?? undefined} onValueChange={setPickedVin}>
                <SelectTrigger className="h-9 w-[320px]" title={t('contacts.myDucatiVinPick')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {vinOptions.map((o, i) => (
                    <SelectItem key={o.vin} value={o.vin}>
                      {o.label} · {o.vin}{i === 0 ? ` — ${t('contacts.myDucatiVinLatest')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-mono text-[12px] text-muted-foreground">VIN {vin}</span>
            )}
          </>
        )}
        {f.my_ducati_synced_at && <span className="text-[11px] text-muted-foreground">{t('contacts.myDucatiSyncedAt')} {new Date(f.my_ducati_synced_at).toLocaleString('fr-BE')}</span>}
      </div>
      <Field label={t('contacts.ducatiCode')}>
        <Input value={f.ducati_code} onChange={(e) => set('ducati_code', e.target.value)} className="font-mono" />
      </Field>
      <Field label={t('contacts.myDucatiEmail')}>
        <Input type="email" value={f.my_ducati_email} onChange={(e) => set('my_ducati_email', e.target.value)} />
      </Field>
      <Field label={t('contacts.myDucatiFirstName')}>
        <Input value={f.my_ducati_first_name} onChange={(e) => set('my_ducati_first_name', e.target.value)} />
      </Field>
      <Field label={t('contacts.myDucatiLastName')}>
        <Input value={f.my_ducati_last_name} onChange={(e) => set('my_ducati_last_name', e.target.value)} />
      </Field>
      <Field label={t('contacts.ducatiUrl')} wide>
        <Input type="url" data-case="preserve" value={f.ducati_url} onChange={(e) => set('ducati_url', e.target.value)} placeholder="https://ducati.my.site.com/dealer/s/account/…" />
        <p className="text-[11px] text-muted-foreground">{t('contacts.ducatiUrlHint')}</p>
      </Field>
    </Section>
  );
}

// ─── Primitives UI ────────────────────────────────────────────────────────────
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
