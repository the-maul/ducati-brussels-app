/**
 * M9 (Simon, 26/11/2026) — « Tout fichier ajouté est lu et exploité ». Règles pures (testées par
 * tests/lecture-fichiers.test.ts) qui transforment ce que la lecture a trouvé dans un fichier
 * (read-id-doc, mode « document », schéma dans supabase/functions/_shared/doc-reading.ts) en
 * PROPOSITIONS pour la fiche client et la fiche moto :
 *   - case vide sur la fiche        → « à remplir » (bouton « Tout appliquer ») ;
 *   - valeur différente sur la fiche → « contradiction » (orange), choix en un clic ;
 *   - valeur certifiée DCS           → « certifiée », jamais écrasée ;
 *   - rien n'est écrit sans clic, et jamais : numéro national, revenus, employeur, n° de compte.
 * Règles reprises : plaques (sans tirets), garanties (4Ever seulement Multistrada >= 2020 et DesertX),
 * financement (la banque n'est jamais propriétaire : elle va dans financing_contact_id), propriétaire
 * = le motard (les coordonnées vont sur le propriétaire actuel, jamais sur la banque).
 */
import { normalizePlate, plateFromSource, samePlate } from '@/lib/plate';
import { CARGARANTIE_PLANS, FOUR_EVER_WARRANTY, isFourEverEligible } from '@/modules/vehicles/warranty-types';

/** Types reconnus (même liste que supabase/functions/_shared/doc-reading.ts). */
export const DOC_KINDS = [
  'ticket_caisse', 'facture', 'avoir', 'bon_commande', 'coc', 'immatriculation', 'carte_grise',
  'leasing_credit', 'offre_banque', 'garantie', 'pv_livraison', 'assurance', 'controle_technique',
  'identite', 'fiche_paie', 'extrait_compte', 'extrait_role', 'reprise', 'photo_moto', 'autre',
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type ReceiptLine = { label: string | null; quantity: number | null; unit_price: number | null; total: number | null };
export type DocReading = {
  doc_kind: DocKind;
  confidence: 'high' | 'medium' | 'low';
  summary: string | null;
  vehicle: Partial<Record<
    'vin' | 'plate' | 'engine_number' | 'approval_number' | 'brand' | 'model' | 'first_registration_date'
    | 'warranty_type' | 'warranty_plan' | 'warranty_start' | 'warranty_end' | 'delivery_date' | 'bank_name'
    | 'financing_contract' | 'insurer' | 'inspection_date' | 'next_inspection_date', string | null>> & { mileage?: number | null };
  customer: Partial<Record<
    'first_name' | 'last_name' | 'company_name' | 'street' | 'street_number' | 'zip' | 'city' | 'email'
    | 'phone' | 'birth_date' | 'vat_number' | 'license_number' | 'license_date', string | null>>;
  receipt: {
    supplier: string | null; supplier_vat: string | null; number: string | null; date: string | null;
    total_ttc: number | null; total_ht: number | null; total_vat: number | null; currency: string | null;
    lines: ReceiptLine[];
  } | null;
};

export const CONTACT_FIELDS = [
  'address', 'street_number', 'zip', 'city', 'email', 'mobile', 'phone', 'birth_date', 'vat_number',
  'license_number', 'license_date',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const VEHICLE_FIELDS = [
  'vin', 'plate', 'engine_number', 'type_mine', 'brand', 'model', 'first_registration_date', 'warranty_type',
  'warranty_plan', 'warranty_start', 'warranty_end', 'financing_contact_id', 'financing_contract', 'insurance',
  'next_inspection_date',
] as const;
export type VehicleField = (typeof VEHICLE_FIELDS)[number];

/** Jamais écrits dans une fiche depuis un document, quoi qu'on demande. */
export const FORBIDDEN_FIELDS = [
  'national_register', 'national_id', 'national_id_number', 'national_id_scan_path', 'iban', 'bic',
  'account_number', 'bank_account', 'income', 'salary', 'employer', 'employer_name',
] as const;

export type Target = 'contact' | 'vehicle';
export type ProposalState = 'fill' | 'same' | 'conflict' | 'locked';
export type Proposal = {
  key: string;              // « contact.city », « vehicle.plate »
  target: Target;
  field: ContactField | VehicleField;
  read: string;             // valeur à écrire si l'on choisit le document
  readLabel: string;        // valeur affichée (nom de la banque pour financing_contact_id)
  current: string | null;
  currentLabel: string | null;
  state: ProposalState;
};

export type Note =
  | { code: 'other_vehicle'; vin: string }
  | { code: 'vehicle_not_found'; vin: string | null; plate: string | null }
  | { code: 'name_mismatch'; read: string; current: string }
  | { code: 'no_customer_name' }
  | { code: 'no_owner' }
  | { code: 'bank_not_found'; name: string }
  | { code: 'four_ever_not_eligible' }
  | { code: 'warranty_unknown'; raw: string }
  | { code: 'delivery_date'; date: string }
  | { code: 'inspection_date'; date: string };

export type ContactSnapshot = { id: string; first_name?: string | null; last_name?: string | null; company_name?: string | null; contact_name?: string | null } & Partial<Record<ContactField, string | null>>;
export type VehicleSnapshot = {
  id: string; category?: string | null; model_year?: number | null; plate_custom?: boolean | null;
} & Partial<Record<VehicleField, string | null>>;
export type Bank = { id: string; name: string };

export type ReadingContext = {
  entityType: 'contact' | 'vehicle';
  /** Fiche client (onglet client) ou propriétaire actuel de la moto (onglet moto). */
  contact: ContactSnapshot | null;
  /** Fiche moto (onglet moto) ou moto du client trouvée par VIN / plaque (onglet client). */
  vehicle: VehicleSnapshot | null;
  /** Champs de la moto certifiés DCS (vehicle_field_status.status = 'certifie'). */
  certified: string[];
  /** Banques et sociétés de leasing (contacts type banque_leasing). */
  banks: Bank[];
};

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const words = (s: unknown) => fold(s).split(/[^A-Z0-9]+/).filter((w) => w.length >= 2);
const blank = (v: unknown) => v == null || String(v).trim() === '';

/** Le document parle-t-il bien de ce client ? Le nom de famille (ou la société) lu doit se retrouver sur la fiche. */
export function nameMatches(customer: DocReading['customer'], contact: ContactSnapshot): boolean {
  const onFile = new Set([
    ...words(contact.first_name), ...words(contact.last_name), ...words(contact.company_name), ...words(contact.contact_name),
  ]);
  const read = [...words(customer.last_name), ...words(customer.company_name)];
  if (read.length === 0) return false;
  const lastName = words(customer.last_name);
  if (lastName.length > 0 && lastName.every((w) => onFile.has(w))) return true;
  const company = words(customer.company_name).filter((w) => !['SA', 'SRL', 'SPRL', 'BV', 'NV', 'BVBA', 'ASBL', 'SCS', 'SNC'].includes(w));
  return company.length > 0 && company.every((w) => onFile.has(w));
}

/** Téléphone lu → « +32475123456 » ; un numéro belge 04… est un mobile, le reste un fixe. */
export function phoneTarget(raw: string): { field: 'mobile' | 'phone'; value: string } | null {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('0') && d.length >= 9 && d.length <= 10) d = '+32' + d.slice(1);
  else if (!d.startsWith('+') && d.startsWith('32')) d = '+' + d;
  if (!/^\+\d{8,15}$/.test(d)) return null;
  return { field: /^\+324\d{8}$/.test(d) ? 'mobile' : 'phone', value: d };
}
const samePhone = (a: unknown, b: unknown) => {
  const x = String(a ?? '').replace(/\D/g, ''); const y = String(b ?? '').replace(/\D/g, '');
  return x.length >= 8 && y.length >= 8 && x.slice(-9) === y.slice(-9);
};

/** Garantie lue → libellé du DMS (warranty-types.ts). 4Ever seulement si la moto y a droit. */
export function mapWarranty(raw: string | null | undefined, v: { category?: unknown; model?: unknown; model_year?: unknown } | null):
  { value: string | null; note?: Note } {
  const s = fold(raw).replace(/[^A-Z0-9+]/g, '');
  if (!s) return { value: null };
  if (s.includes('4EVER') || s.includes('FOREVER')) {
    return v && isFourEverEligible(v) ? { value: FOUR_EVER_WARRANTY } : { value: null, note: { code: 'four_ever_not_eligible' } };
  }
  if (s.includes('CARGARANTIE')) return { value: 'CarGarantie' };
  if (s.includes('EVERRED')) {
    if (s.includes('24')) return { value: 'Factory Ever Red +24' };
    if (s.includes('12')) return { value: 'Factory Ever Red +12' };
  }
  if (s.includes('CONVENTION') || s.includes('STANDARD') || s.includes('CONSTRUCTEUR') || s.includes('FACTORY')
    || s.includes('LEGAL') || /24MOIS|24MONTHS|24MAANDEN/.test(s)) return { value: 'Conventionnelle (24 mois)' };
  return { value: null, note: { code: 'warranty_unknown', raw: String(raw).trim() } };
}

/** Formule CarGarantie lue → l'une des formules connues (sinon rien). */
export function mapCarGarantiePlan(raw: string | null | undefined): string | null {
  const s = fold(raw).replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  const months = s.match(/(12|24|36)/)?.[1];
  const plus = s.includes('PLUS');
  return CARGARANTIE_PLANS.find((p) => {
    const f = fold(p).replace(/[^A-Z0-9]/g, '');
    return f.includes('PLUS') === plus && (!months || f.includes(months));
  }) ?? null;
}

/** Banque lue → fiche banque_leasing du DMS (nom contenu dans l'autre, accents et formes juridiques ignorés). */
export function findBank(name: string | null | undefined, banks: Bank[]): Bank | null {
  const w = words(name).filter((x) => !['SA', 'NV', 'BANK', 'BANQUE', 'LEASING', 'BELGIUM', 'BELGIQUE'].includes(x));
  if (w.length === 0) return null;
  const hits = banks.filter((b) => { const bw = new Set(words(b.name)); return w.every((x) => bw.has(x)); });
  return hits.length === 1 ? hits[0] : null;
}

/** Moto du client concernée par le document : même VIN, sinon même plaque. Jamais au hasard. */
export function pickVehicle<T extends VehicleSnapshot>(reading: DocReading, vehicles: T[]): T | null {
  const vin = reading.vehicle.vin?.toUpperCase();
  if (vin) return vehicles.find((v) => String(v.vin ?? '').toUpperCase() === vin) ?? null;
  const plate = reading.vehicle.plate;
  if (plate) {
    const hits = vehicles.filter((v) => samePlate(v.plate, plate));
    return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

const ONLY_IF_EMPTY = new Set<string>(['brand', 'model']);

function compare(target: Target, field: string, read: string, current: unknown): boolean {
  if (blank(current)) return false;
  if (field === 'plate') return samePlate(current, read);
  if (field === 'mobile' || field === 'phone') return samePhone(current, read);
  if (field === 'vat_number') return fold(current).replace(/[^A-Z0-9]/g, '') === fold(read).replace(/[^A-Z0-9]/g, '');
  return fold(current).trim() === fold(read).trim();
}

/**
 * Propositions et remarques pour un fichier lu. La moto n'est complétée que si le document parle de
 * CETTE moto (même VIN) ; le client que si le nom lu se retrouve sur la fiche.
 */
export function buildProposals(reading: DocReading, ctx: ReadingContext): { proposals: Proposal[]; notes: Note[] } {
  const proposals: Proposal[] = [];
  const notes: Note[] = [];
  const push = (target: Target, field: ContactField | VehicleField, read: string | null | undefined, current: unknown,
    labels?: { read?: string; current?: string | null }) => {
    if (read == null || String(read).trim() === '') return;
    const r = String(read).trim();
    const isSame = compare(target, field, r, current);
    if (!blank(current) && !isSame && ONLY_IF_EMPTY.has(field)) return;
    const locked = target === 'vehicle' && ctx.certified.includes(field);
    const state: ProposalState = isSame ? 'same' : locked ? 'locked' : blank(current) ? 'fill' : 'conflict';
    const cur = blank(current) ? null : String(current);
    proposals.push({
      key: `${target}.${field}`, target, field, read: r, readLabel: labels?.read ?? r,
      current: cur, currentLabel: labels?.current !== undefined ? labels.current : cur, state,
    });
  };

  // ---- Moto
  const rv = reading.vehicle;
  const hasVehicleData = Object.entries(rv).some(([k, v]) => k !== 'mileage' && !blank(v));
  const vehicle = ctx.vehicle;
  if (vehicle && rv.vin && !blank(vehicle.vin) && String(vehicle.vin).toUpperCase() !== rv.vin.toUpperCase()) {
    notes.push({ code: 'other_vehicle', vin: rv.vin });
  } else if (vehicle) {
    push('vehicle', 'vin', rv.vin, vehicle.vin);
    const plate = rv.plate ? (vehicle.plate_custom ? rv.plate.toUpperCase() : plateFromSource(rv.plate) ?? rv.plate) : null;
    push('vehicle', 'plate', plate, vehicle.plate);
    push('vehicle', 'engine_number', rv.engine_number, vehicle.engine_number);
    push('vehicle', 'type_mine', rv.approval_number, vehicle.type_mine);
    push('vehicle', 'brand', rv.brand, vehicle.brand);
    push('vehicle', 'model', rv.model, vehicle.model);
    push('vehicle', 'first_registration_date', rv.first_registration_date, vehicle.first_registration_date);
    const w = mapWarranty(rv.warranty_type, { category: vehicle.category, model: vehicle.model ?? rv.model, model_year: vehicle.model_year });
    if (w.note) notes.push(w.note);
    push('vehicle', 'warranty_type', w.value, vehicle.warranty_type);
    if (w.value === 'CarGarantie') push('vehicle', 'warranty_plan', mapCarGarantiePlan(rv.warranty_plan), vehicle.warranty_plan);
    push('vehicle', 'warranty_start', rv.warranty_start, vehicle.warranty_start);
    push('vehicle', 'warranty_end', rv.warranty_end, vehicle.warranty_end);
    if (rv.bank_name) {
      const bank = findBank(rv.bank_name, ctx.banks);
      const currentBank = ctx.banks.find((b) => b.id === vehicle.financing_contact_id)?.name ?? vehicle.financing_contact_id ?? null;
      if (bank) push('vehicle', 'financing_contact_id', bank.id, vehicle.financing_contact_id, { read: bank.name, current: currentBank });
      else notes.push({ code: 'bank_not_found', name: rv.bank_name });
    }
    push('vehicle', 'financing_contract', rv.financing_contract, vehicle.financing_contract);
    push('vehicle', 'insurance', rv.insurer, vehicle.insurance);
    push('vehicle', 'next_inspection_date', rv.next_inspection_date, vehicle.next_inspection_date);
  } else if (hasVehicleData && (rv.vin || rv.plate)) {
    notes.push({ code: 'vehicle_not_found', vin: rv.vin ?? null, plate: rv.plate ? normalizePlate(rv.plate) : null });
  }
  if (rv.delivery_date) notes.push({ code: 'delivery_date', date: rv.delivery_date });
  if (rv.inspection_date) notes.push({ code: 'inspection_date', date: rv.inspection_date });

  // ---- Client (le motard ; jamais l'émetteur, la banque ou l'assureur)
  const rc = reading.customer;
  const hasCustomerData = ['street', 'zip', 'city', 'email', 'phone', 'birth_date', 'vat_number', 'license_number', 'license_date']
    .some((k) => !blank(rc[k as keyof typeof rc]));
  const contact = ctx.contact;
  if (hasCustomerData) {
    if (!contact) {
      if (ctx.entityType === 'vehicle') notes.push({ code: 'no_owner' });
    } else if (blank(rc.last_name) && blank(rc.company_name)) {
      notes.push({ code: 'no_customer_name' });
    } else if (!nameMatches(rc, contact)) {
      const readName = [rc.first_name, rc.last_name].filter(Boolean).join(' ') || rc.company_name || '';
      const onFile = contact.company_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      notes.push({ code: 'name_mismatch', read: readName, current: onFile });
    } else {
      push('contact', 'address', rc.street, contact.address);
      push('contact', 'street_number', rc.street_number, contact.street_number);
      push('contact', 'zip', rc.zip, contact.zip);
      push('contact', 'city', rc.city, contact.city);
      push('contact', 'email', rc.email, contact.email);
      const ph = rc.phone ? phoneTarget(rc.phone) : null;
      if (ph) {
        // Déjà sur la fiche dans l'autre case (mobile / fixe / mobile 2) : rien à proposer.
        const known = [contact.mobile, contact.phone, (contact as Record<string, unknown>).gsm].some((x) => samePhone(x, ph.value));
        if (!known) push('contact', ph.field, ph.value, contact[ph.field]);
      }
      push('contact', 'birth_date', rc.birth_date, contact.birth_date);
      push('contact', 'vat_number', rc.vat_number, contact.vat_number);
      push('contact', 'license_number', rc.license_number, contact.license_number);
      push('contact', 'license_date', rc.license_date, contact.license_date);
    }
  }
  return { proposals, notes };
}

export type WritePlan = {
  contact: Partial<Record<ContactField, string>>;
  vehicle: Partial<Record<Exclude<VehicleField, 'financing_contact_id' | 'financing_contract'>, string>>;
  /** Banque + contrat, écrits ensemble (setVehicleFinancing tient l'historique vehicle_financings). */
  financing: { contactId: string | null; contract: string } | null;
  old: { contact: Record<string, string | null>; vehicle: Record<string, string | null> };
  refused: string[];
};

const ALLOWED: Record<Target, readonly string[]> = { contact: CONTACT_FIELDS, vehicle: VEHICLE_FIELDS };

/**
 * Ce qui sera écrit pour les propositions choisies. Refusés : champ interdit ou hors liste, valeur
 * certifiée DCS, valeur déjà identique. Une banque choisie part avec le contrat (lu ou actuel).
 */
export function planWrites(proposals: Proposal[], chosen: Iterable<string>,
  currentFinancing: { contactId: string | null; contract: string | null } = { contactId: null, contract: null }): WritePlan {
  const keys = new Set(chosen);
  const plan: WritePlan = { contact: {}, vehicle: {}, financing: null, old: { contact: {}, vehicle: {} }, refused: [] };
  let bank: Proposal | undefined; let contract: Proposal | undefined;
  for (const p of proposals) {
    if (!keys.has(p.key)) continue;
    const field = String(p.field);
    if ((FORBIDDEN_FIELDS as readonly string[]).includes(field) || !ALLOWED[p.target]?.includes(field)
      || p.state === 'locked' || p.state === 'same') { plan.refused.push(p.key); continue; }
    if (p.target === 'vehicle' && field === 'financing_contact_id') { bank = p; continue; }
    if (p.target === 'vehicle' && field === 'financing_contract') { contract = p; continue; }
    if (p.target === 'contact') (plan.contact as Record<string, string>)[field] = p.read;
    else (plan.vehicle as Record<string, string>)[field] = field === 'vin' ? p.read.toUpperCase() : p.read;
    plan.old[p.target][field] = p.current;
  }
  if (bank || contract) {
    // La partie non choisie garde la valeur actuelle de la fiche (jamais effacée par le choix de l'autre).
    const curBank = currentFinancing.contactId ?? null;
    const curContract = currentFinancing.contract ?? '';
    plan.financing = { contactId: bank ? bank.read : curBank, contract: contract ? contract.read : curContract };
    plan.old.vehicle.financing_contact_id = curBank;
    plan.old.vehicle.financing_contract = curContract || null;
  }
  return plan;
}

/** Clés « à remplir » (le bouton « Tout appliquer »). */
export const fillKeys = (proposals: Proposal[]) => proposals.filter((p) => p.state === 'fill').map((p) => p.key);
