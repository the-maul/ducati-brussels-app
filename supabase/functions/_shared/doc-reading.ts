/**
 * M9 (Simon, 26/11/2026) — lecture automatique de TOUT fichier ajouté à une fiche client ou moto
 * (read-id-doc, mode « document »). Partie pure, sans Deno ni réseau, testée par
 * tests/lecture-fichiers.test.ts :
 *   - le schéma demandé à Claude (structured outputs) et la consigne ;
 *   - le type de pièce → dossier de rangement (mêmes noms que l'archive importée) ;
 *   - le nettoyage de la réponse : dates, VIN, montants, et REFUS des données interdites
 *     (numéro national, revenus, employeur, numéro de compte), même si le modèle en renvoyait.
 * Rien ici n'écrit dans une fiche : l'écran propose, l'utilisateur clique.
 */

export const DOC_KINDS = [
  'ticket_caisse', 'facture', 'avoir', 'bon_commande', 'coc', 'immatriculation', 'carte_grise',
  'leasing_credit', 'offre_banque', 'garantie', 'pv_livraison', 'assurance', 'controle_technique',
  'identite', 'fiche_paie', 'extrait_compte', 'extrait_role', 'reprise', 'photo_moto', 'autre',
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const isDocKind = (v: unknown): v is DocKind => typeof v === 'string' && (DOC_KINDS as readonly string[]).includes(v);

/** Dossiers de rangement : noms de l'archive (« Vente - … ») et « Tickets ». null = on ne range pas. */
export const KIND_FOLDER: Record<DocKind, string | null> = {
  ticket_caisse: 'Tickets',
  facture: 'Vente - Factures',
  avoir: 'Vente - Factures',
  bon_commande: 'Vente - Bons de commande',
  coc: 'Vente - Immatriculation / COC',
  immatriculation: 'Vente - Immatriculation / COC',
  carte_grise: 'Vente - Immatriculation / COC',
  leasing_credit: 'Vente - Financement',
  offre_banque: 'Vente - Financement',
  garantie: 'Vente - Garantie',
  pv_livraison: 'Vente - Livraison',
  assurance: 'Vente - Assurance',
  controle_technique: 'Vente - Contrôle technique',
  identite: 'Vente - Pièces personnelles',
  fiche_paie: 'Vente - Pièces personnelles',
  extrait_compte: 'Vente - Pièces personnelles',
  extrait_role: 'Vente - Pièces personnelles',
  reprise: 'Vente - Reprise',
  photo_moto: 'Vente - Photos',
  autre: null,
};

/**
 * Dossier final du fichier : celui choisi par l'utilisateur est toujours gardé ; sinon le dossier
 * du type reconnu ; un type « autre » laisse le fichier où il est.
 */
export function folderFor(kind: DocKind, currentFolder: string | null, userChoseFolder: boolean): string | null {
  if (userChoseFolder) return currentFolder;
  return KIND_FOLDER[kind] ?? currentFolder;
}

/** Données que la lecture ne garde JAMAIS (ni sur le fichier, ni dans une fiche). */
export const FORBIDDEN_KEYS = [
  'national_register', 'national_id', 'national_id_number', 'national_number', 'registre_national',
  'iban', 'bic', 'account_number', 'bank_account', 'income', 'salary', 'net_salary', 'gross_salary',
  'revenue', 'employer', 'employer_name',
] as const;

const NULLABLE_STRING = { type: ['string', 'null'] } as const;
const NULLABLE_NUMBER = { type: ['number', 'null'] } as const;
const obj = (props: Record<string, unknown>) => ({
  type: 'object', properties: props, required: Object.keys(props), additionalProperties: false,
});

const VEHICLE_PROPS = {
  vin: { type: ['string', 'null'], description: 'N° de chassis (VIN), 17 caracteres' },
  plate: { type: ['string', 'null'], description: 'Plaque d\'immatriculation telle qu\'imprimee' },
  engine_number: NULLABLE_STRING,
  approval_number: { type: ['string', 'null'], description: 'N° de reception / homologation (type)' },
  brand: NULLABLE_STRING,
  model: NULLABLE_STRING,
  first_registration_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  warranty_type: { type: ['string', 'null'], description: 'Garantie : texte imprime (ex. Ever Red +24, CarGarantie, 4Ever, garantie conventionnelle 24 mois)' },
  warranty_plan: { type: ['string', 'null'], description: 'Formule CarGarantie si indiquee' },
  warranty_start: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  warranty_end: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  delivery_date: { type: ['string', 'null'], description: 'Date de livraison de la moto, YYYY-MM-DD' },
  bank_name: { type: ['string', 'null'], description: 'Banque ou societe de leasing / credit' },
  financing_contract: { type: ['string', 'null'], description: 'N° du contrat de leasing / credit (pas un n° de compte)' },
  insurer: NULLABLE_STRING,
  inspection_date: { type: ['string', 'null'], description: 'Date du controle technique, YYYY-MM-DD' },
  next_inspection_date: { type: ['string', 'null'], description: 'Prochain controle technique, YYYY-MM-DD' },
  mileage: NULLABLE_NUMBER,
};

const CUSTOMER_PROPS = {
  first_name: NULLABLE_STRING,
  last_name: NULLABLE_STRING,
  company_name: NULLABLE_STRING,
  street: { type: ['string', 'null'], description: 'Rue sans le numero' },
  street_number: NULLABLE_STRING,
  zip: NULLABLE_STRING,
  city: NULLABLE_STRING,
  email: NULLABLE_STRING,
  phone: NULLABLE_STRING,
  birth_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  vat_number: { type: ['string', 'null'], description: 'N° de TVA d\'entreprise du client (ex. BE0123456789)' },
  license_number: { type: ['string', 'null'], description: 'N° du permis de conduire' },
  license_date: { type: ['string', 'null'], description: 'Date de delivrance du permis, YYYY-MM-DD' },
};

const LINE_PROPS = { label: NULLABLE_STRING, quantity: NULLABLE_NUMBER, unit_price: NULLABLE_NUMBER, total: NULLABLE_NUMBER };

const RECEIPT_PROPS = {
  supplier: { type: ['string', 'null'], description: 'Emetteur du ticket / de la facture' },
  supplier_vat: NULLABLE_STRING,
  number: { type: ['string', 'null'], description: 'N° du ticket / de la facture' },
  date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  total_ttc: NULLABLE_NUMBER,
  total_ht: NULLABLE_NUMBER,
  total_vat: NULLABLE_NUMBER,
  currency: NULLABLE_STRING,
  lines: { type: 'array', items: obj(LINE_PROPS) },
};

export const DOCUMENT_SCHEMA = obj({
  doc_kind: { type: 'string', enum: [...DOC_KINDS] },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  summary: { type: ['string', 'null'], description: 'Une phrase en francais : ce qu\'est la piece' },
  vehicle: obj(VEHICLE_PROPS),
  customer: obj(CUSTOMER_PROPS),
  receipt: obj(RECEIPT_PROPS),
});

export const DOCUMENT_PROMPT =
  'Ce fichier a ete ajoute a la fiche d\'un client ou d\'une moto dans le logiciel d\'une concession Ducati a Bruxelles. ' +
  'Reconnais le type de piece (doc_kind) : ticket_caisse, facture, avoir, bon_commande, coc (certificat de conformite), ' +
  'immatriculation (demande d\'immatriculation 705, certificat), carte_grise, leasing_credit (contrat), offre_banque, garantie ' +
  '(certificat ou activation de garantie Ducati, CarGarantie...), pv_livraison, assurance, controle_technique, identite ' +
  '(carte d\'identite, permis), fiche_paie, extrait_compte, extrait_role, reprise (fiche ou estimation de reprise), ' +
  'photo_moto (photo d\'une moto sans document), autre. ' +
  'Puis extrais seulement ce que le schema demande. Regles : ' +
  'vehicle = la moto concernee (VIN, plaque, n° moteur, n° de reception, dates, garantie, financement, assurance, controle technique). ' +
  'customer = le client motard (acheteur, titulaire, preneur), JAMAIS l\'emetteur du document, la concession, la banque ou l\'assureur. ' +
  'receipt = seulement pour un ticket de caisse, une facture ou un avoir : emetteur, n°, date, montants TTC/HT/TVA en nombres, lignes lisibles. ' +
  'Dates au format YYYY-MM-DD. null (ou liste vide) pour tout ce qui est absent ou illisible. N\'invente jamais une valeur. ' +
  'Ne recopie JAMAIS un numero de registre national, un numero de compte bancaire (IBAN), un salaire ou revenu, ni le nom d\'un employeur : ' +
  'ces informations ne doivent figurer nulle part dans la reponse.';

export type Confidence = 'high' | 'medium' | 'low';
export type ReceiptLine = { label: string | null; quantity: number | null; unit_price: number | null; total: number | null };
export type DocVehicle = { [K in keyof typeof VEHICLE_PROPS]: K extends 'mileage' ? number | null : string | null };
export type DocCustomer = { [K in keyof typeof CUSTOMER_PROPS]: string | null };
export type DocReceipt = {
  supplier: string | null; supplier_vat: string | null; number: string | null; date: string | null;
  total_ttc: number | null; total_ht: number | null; total_vat: number | null; currency: string | null;
  lines: ReceiptLine[];
};
export type DocReading = {
  doc_kind: DocKind; confidence: Confidence; summary: string | null;
  vehicle: DocVehicle; customer: DocCustomer; receipt: DocReceipt | null;
};

const VEHICLE_KEYS = Object.keys(VEHICLE_PROPS) as (keyof DocVehicle)[];
const CUSTOMER_KEYS = Object.keys(CUSTOMER_PROPS) as (keyof DocCustomer)[];
const DATE_KEYS = new Set<string>([
  'first_registration_date', 'warranty_start', 'warranty_end', 'delivery_date', 'inspection_date',
  'next_inspection_date', 'birth_date', 'license_date', 'date',
]);

/** Numéro de registre national belge écrit « AA.MM.JJ-XXX.XX » (séparateurs obligatoires). */
const NATIONAL_NUMBER_PUNCT_RE = /\b\d{2}\.\d{2}\.\d{2}[-\s]?\d{3}[.\s]?\d{2}\b/;
/** Le même en 11 chiffres collés : retenu seulement si sa clé (modulo 97) est juste. */
const ELEVEN_DIGITS_RE = /(?<![\d+])\d{11}(?!\d)/g;
/** IBAN candidat (BE68 5390 0754 7034 et autres pays) : retenu seulement si sa clé est juste. */
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g;

const mod97 = (digits: string): number => {
  let r = 0;
  for (const c of digits) r = (r * 10 + Number(c)) % 97;
  return r;
};

/** Clé du registre national : 97 − (9 premiers chiffres mod 97), avec « 2 » devant pour les naissances depuis 2000. */
export function isNationalNumber(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false;
  const key = Number(d.slice(9));
  return 97 - mod97(d.slice(0, 9)) === key || 97 - mod97('2' + d.slice(0, 9)) === key;
}

export function isIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(digits) === 1;
}

/** Vrai si un texte contient un numéro national ou un numéro de compte : la valeur est alors jetée. */
export function looksForbidden(v: string): boolean {
  const s = v.toUpperCase();
  if (NATIONAL_NUMBER_PUNCT_RE.test(s)) return true;
  if ((s.match(ELEVEN_DIGITS_RE) ?? []).some(isNationalNumber)) return true;
  return (s.replace(/-/g, ' ').match(IBAN_RE) ?? []).some(isIban);
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
  return looksForbidden(s) ? null : s;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** Date « 2024-03-05 », « 05/03/2024 », « 5.3.2024 » → « 2024-03-05 » ; autre chose → null. */
export function isoDate(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** VIN : 17 caractères sans I, O, Q, espaces retirés ; sinon null (jamais un VIN approximatif). */
export function cleanVin(raw: unknown): string | null {
  const s = (typeof raw === 'string' ? raw : '').toUpperCase().replace(/[\s.-]/g, '');
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? s : null;
}

const field = (key: string, v: unknown): string | null => {
  if (DATE_KEYS.has(key)) return isoDate(v);
  if (key === 'vin') return cleanVin(v);
  if (key === 'phone') { const p = typeof v === 'string' ? v.replace(/[^\d+]/g, '') : ''; return /^\+?\d{8,15}$/.test(p) ? p : null; }
  if (key === 'email') { const e = text(v); return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.toLowerCase() : null; }
  if (key === 'vat_number' || key === 'supplier_vat') { const t = text(v); return t ? t.toUpperCase().replace(/[\s.]/g, '') : null; }
  return text(v);
};

/**
 * Réponse brute du modèle → lecture propre. Les clés inconnues ou interdites sont ignorées (on ne lit
 * que la liste blanche du schéma) ; une valeur qui contient un numéro national ou un IBAN est jetée.
 */
export function sanitizeReading(raw: unknown): DocReading {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rv = (r.vehicle && typeof r.vehicle === 'object' ? r.vehicle : {}) as Record<string, unknown>;
  const rc = (r.customer && typeof r.customer === 'object' ? r.customer : {}) as Record<string, unknown>;
  const rr = (r.receipt && typeof r.receipt === 'object' ? r.receipt : null) as Record<string, unknown> | null;
  const vehicle = Object.fromEntries(VEHICLE_KEYS.map((k) => [k, k === 'mileage' ? num(rv[k]) : field(k, rv[k])])) as DocVehicle;
  const customer = Object.fromEntries(CUSTOMER_KEYS.map((k) => [k, field(k, rc[k])])) as DocCustomer;
  const kind: DocKind = isDocKind(r.doc_kind) ? r.doc_kind : 'autre';
  const isReceipt = kind === 'ticket_caisse' || kind === 'facture' || kind === 'avoir';
  let receipt: DocReceipt | null = null;
  if (rr && isReceipt) {
    const lines = Array.isArray(rr.lines) ? rr.lines : [];
    receipt = {
      supplier: text(rr.supplier), supplier_vat: field('supplier_vat', rr.supplier_vat), number: text(rr.number),
      date: isoDate(rr.date), total_ttc: num(rr.total_ttc), total_ht: num(rr.total_ht), total_vat: num(rr.total_vat),
      currency: text(rr.currency),
      lines: lines.slice(0, 100).map((l) => {
        const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
        return { label: text(o.label), quantity: num(o.quantity), unit_price: num(o.unit_price), total: num(o.total) };
      }).filter((l) => l.label || l.total != null),
    };
  }
  const confidence: Confidence = r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low';
  return { doc_kind: kind, confidence, summary: text(r.summary), vehicle, customer, receipt };
}

/** Formats que Claude sait lire (le reste est marqué « format non lisible »). */
export const READABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
/** Limite d'une image envoyée en base64 (5 Mo encodés) et d'un PDF (le reste de la requête). */
export const MAX_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4) - 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type ReadStatus = 'pending' | 'done' | 'failed' | 'unsupported' | 'too_large' | 'no_credit' | 'refused';

/** Le fichier peut-il partir à la lecture ? null = oui, sinon le statut à enregistrer. */
export function readableStatus(contentType: string | null, size: number): ReadStatus | null {
  const ct = (contentType ?? '').toLowerCase();
  if (ct === 'application/pdf') return size > MAX_PDF_BYTES ? 'too_large' : null;
  if ((READABLE_IMAGE_TYPES as readonly string[]).includes(ct)) return size > MAX_IMAGE_BYTES ? 'too_large' : null;
  return 'unsupported';
}
