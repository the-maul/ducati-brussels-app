/**
 * M1 — Rattrapage G8 « clients » (18/11/2026) : règles PURES, testées dans
 * tests/clients-g8.test.ts. Aucune dépendance à Supabase ni à React.
 *   - province / région belges depuis le code postal (critères G8 « Département » / « Région ») ;
 *   - statut d'une déclaration RGPD (active / expirée / révoquée) ;
 *   - critères d'extraction -> objet envoyé à la base (`contacts_extract`) ;
 *   - rendu d'un message de campagne ({civilite} {prenom} {nom} {societe} {code}) ;
 *   - mise en page des étiquettes d'adresse ;
 *   - mise à plat de l'export RGPD (portabilité) en feuilles de tableur.
 */
import { titleCaseName } from '@/lib/person-name';

/* ------------------------------------------------------------------ Belgique */

export const BE_PROVINCES = ['BRU', 'BWA', 'VBR', 'ANT', 'LIM', 'LIE', 'NAM', 'HAI', 'LUX', 'WVL', 'OVL'] as const;
export type BeProvince = (typeof BE_PROVINCES)[number];
export const BE_REGIONS = ['bruxelles', 'wallonie', 'flandre'] as const;
export type BeRegion = (typeof BE_REGIONS)[number];

/** Province belge d'un code postal (même découpage que la fonction SQL be_province). */
export function beProvince(zip: string | null | undefined): BeProvince | null {
  const v = (zip ?? '').trim();
  if (!/^[0-9]{4}$/.test(v)) return null;
  const z = Number(v);
  if (z >= 1000 && z <= 1299) return 'BRU';
  if (z >= 1300 && z <= 1499) return 'BWA';
  if (z >= 1500 && z <= 1999) return 'VBR';
  if (z >= 2000 && z <= 2999) return 'ANT';
  if (z >= 3000 && z <= 3499) return 'VBR';
  if (z >= 3500 && z <= 3999) return 'LIM';
  if (z >= 4000 && z <= 4999) return 'LIE';
  if (z >= 5000 && z <= 5999) return 'NAM';
  if (z >= 6000 && z <= 6599) return 'HAI';
  if (z >= 6600 && z <= 6999) return 'LUX';
  if (z >= 7000 && z <= 7999) return 'HAI';
  if (z >= 8000 && z <= 8999) return 'WVL';
  if (z >= 9000 && z <= 9999) return 'OVL';
  return null;
}

export function beRegion(zip: string | null | undefined): BeRegion | null {
  const p = beProvince(zip);
  if (!p) return null;
  if (p === 'BRU') return 'bruxelles';
  if (p === 'BWA' || p === 'LIE' || p === 'NAM' || p === 'HAI' || p === 'LUX') return 'wallonie';
  return 'flandre';
}

/* ------------------------------------------------------------------ RGPD */

export const CONSENT_CHANNELS = ['email', 'sms', 'courrier', 'telephone'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_FORMS = ['comptoir', 'inscription_en_ligne', 'borne', 'papier_signe', 'telephone', 'autre'] as const;

export type ConsentRow = {
  id: string;
  declared_at: string;
  accepted: string[];
  refused: string[];
  form: string | null;
  form_ref: string | null;
  expires_at: string | null;
  note: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
};

export type ConsentStatus = 'active' | 'expiree' | 'revoquee' | 'future';

/** Statut d'une déclaration à une date (AAAA-MM-JJ). */
export function consentStatus(c: Pick<ConsentRow, 'declared_at' | 'expires_at' | 'revoked_at'>, today: string): ConsentStatus {
  if (c.revoked_at) return 'revoquee';
  if (c.declared_at > today) return 'future';
  if (c.expires_at && c.expires_at < today) return 'expiree';
  return 'active';
}

/**
 * État d'un canal d'après les déclarations (même règle que la fonction SQL
 * contact_consent_channel) : la dernière déclaration active qui cite le canal fait foi.
 * `signupConsent` = date de consentement de l'inscription en ligne (vaut e-mail + SMS).
 */
export function channelState(
  rows: ConsentRow[], channel: ConsentChannel, today: string, signupConsent?: string | null,
): 'accepte' | 'refuse' | null {
  const valid = rows
    .filter((r) => consentStatus(r, today) === 'active')
    .filter((r) => r.accepted.includes(channel) || r.refused.includes(channel))
    .sort((a, b) => (b.declared_at === a.declared_at ? b.created_at.localeCompare(a.created_at) : b.declared_at.localeCompare(a.declared_at)));
  if (valid.length > 0) return valid[0].accepted.includes(channel) ? 'accepte' : 'refuse';
  if (signupConsent && (channel === 'email' || channel === 'sms')) return 'accepte';
  return null;
}

/** Une déclaration doit citer au moins un canal, jamais le même canal accepté ET refusé. */
export function consentDraftError(d: { accepted: string[]; refused: string[]; declared_at: string; expires_at: string }): string | null {
  if (d.accepted.length + d.refused.length === 0) return 'noChannel';
  if (d.accepted.some((c) => d.refused.includes(c))) return 'bothWays';
  if (!d.declared_at) return 'noDate';
  if (d.expires_at && d.expires_at < d.declared_at) return 'expiryBefore';
  return null;
}

/* ------------------------------------------------------------------ Extraction */

export type ExtractionCriteria = {
  code_from: string; code_to: string; name: string;
  civilities: string[]; types: string[]; statuses: string[]; categories: string[]; price_lists: string[]; groups: string[];
  created_from: string; created_to: string; birth_from: string; birth_to: string;
  birthday_from: string; birthday_to: string;   // JJ/MM saisis, envoyés en MM-DD
  exclude_with_email: boolean; exclude_with_mobile: boolean; exclude_opt_out: boolean;
  consent: '' | 'email' | 'sms' | 'any' | 'none_refused';
  has_vehicle: boolean; vehicle_current_only: boolean; vehicle_brand: string; vehicle_model: string;
  ct_from: string; ct_to: string;
  place: string; provinces: string[]; regions: string[]; countries: string[]; exclude_npai: boolean;
  sales_mode: '' | 'with_invoice' | 'without_invoice' | 'workshop';
  sales_from: string; sales_to: string; supplier_id: string; rayon: string; article: string; brand: string;
  include_archived: boolean;
};

/** Valeurs par défaut G8 : opposés au marketing et NPAI exclus, clients et prospects. */
export function emptyCriteria(): ExtractionCriteria {
  return {
    code_from: '', code_to: '', name: '',
    civilities: [], types: [], statuses: [], categories: [], price_lists: [], groups: [],
    created_from: '', created_to: '', birth_from: '', birth_to: '', birthday_from: '', birthday_to: '',
    exclude_with_email: false, exclude_with_mobile: false, exclude_opt_out: true,
    consent: '',
    has_vehicle: false, vehicle_current_only: true, vehicle_brand: '', vehicle_model: '', ct_from: '', ct_to: '',
    place: '', provinces: [], regions: [], countries: [], exclude_npai: true,
    sales_mode: '', sales_from: '', sales_to: '', supplier_id: '', rayon: '', article: '', brand: '',
    include_archived: false,
  };
}

/** « 25/12 » ou « 25-12 » -> « 12-25 » (MM-DD) ; null si invalide. */
export function dayMonthToMmDd(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (!m) return null;
  const d = Number(m[1]); const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Objet envoyé à `contacts_extract` : on n'envoie que ce qui est renseigné. */
export function criteriaPayload(c: ExtractionCriteria): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const str = (k: keyof ExtractionCriteria) => { const v = String(c[k] ?? '').trim(); if (v) out[k] = v; };
  const arr = (k: keyof ExtractionCriteria) => { const v = c[k] as string[]; if (v.length) out[k] = v; };
  (['code_from', 'code_to', 'name', 'created_from', 'created_to', 'birth_from', 'birth_to', 'consent',
    'vehicle_brand', 'vehicle_model', 'ct_from', 'ct_to', 'place', 'sales_mode', 'sales_from', 'sales_to',
    'supplier_id', 'rayon', 'article', 'brand'] as const).forEach(str);
  (['civilities', 'types', 'statuses', 'categories', 'price_lists', 'groups', 'provinces', 'regions', 'countries'] as const).forEach(arr);
  const bf = dayMonthToMmDd(c.birthday_from); const bt = dayMonthToMmDd(c.birthday_to);
  if (bf && bt) { out.birthday_from = bf; out.birthday_to = bt; }
  out.exclude_opt_out = c.exclude_opt_out;
  out.exclude_npai = c.exclude_npai;
  if (c.exclude_with_email) out.exclude_with_email = true;
  if (c.exclude_with_mobile) out.exclude_with_mobile = true;
  if (c.has_vehicle) out.has_vehicle = true;
  out.vehicle_current_only = c.vehicle_current_only;
  if (c.include_archived) out.include_archived = true;
  return out;
}

/* ------------------------------------------------------------------ Campagnes (essai) */

export type RenderContact = {
  civility?: string | null; first_name?: string | null; last_name?: string | null;
  company_name?: string | null; code?: string | null;
};

const initcap = titleCaseName;

/** Même rendu que la fonction SQL _campaign_render (aperçu à l'écran). */
export function renderCampaignText(text: string, c: RenderContact): string {
  const civ = c.civility === 'Monsieur' ? 'M.' : c.civility === 'Madame' ? 'Mme' : c.civility === 'Mx' ? 'Mx' : '';
  return (text ?? '')
    .split('{civilite}').join(civ)
    .split('{prenom}').join(c.first_name ? initcap(c.first_name) : '')
    .split('{nom}').join(c.last_name ? initcap(c.last_name) : '')
    .split('{societe}').join(c.company_name ?? '')
    .split('{code}').join(c.code ?? '');
}

/** Nombre de SMS (160 caractères, 153 par segment au-delà). */
export function smsSegments(text: string): number {
  const n = [...(text ?? '')].length;
  if (n === 0) return 0;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

/* ------------------------------------------------------------------ Étiquettes */

export type LabelSheet = { cols: number; rows: number; width: number; height: number; marginTop: number; marginLeft: number };
/** Planche A4 3 x 8, 70 x 37 mm (type Avery 3474), sans marge. */
export const LABEL_SHEET_3x8: LabelSheet = { cols: 3, rows: 8, width: 70, height: 37, marginTop: 0.5, marginLeft: 0 };

/** Position (mm) de la n-ième étiquette (0 = première) et sa page. */
export function labelSlot(i: number, sheet: LabelSheet = LABEL_SHEET_3x8): { page: number; x: number; y: number } {
  const per = sheet.cols * sheet.rows;
  const page = Math.floor(i / per);
  const k = i % per;
  return {
    page,
    x: sheet.marginLeft + (k % sheet.cols) * sheet.width,
    y: sheet.marginTop + Math.floor(k / sheet.cols) * sheet.height,
  };
}

export type AddressContact = RenderContact & {
  type?: string | null; legal_form?: string | null; address?: string | null; street_number?: string | null;
  address_complement?: string | null; zip?: string | null; city?: string | null; country?: string | null;
};

/** Lignes d'adresse postale d'un client (étiquette, liste). */
export function addressLines(c: AddressContact): string[] {
  const civ = c.civility === 'Monsieur' ? 'M.' : c.civility === 'Madame' ? 'Mme' : c.civility === 'Mx' ? 'Mx' : '';
  const person = [civ, c.first_name, c.last_name].filter((x) => x && String(x).trim()).join(' ');
  const lines: string[] = [];
  if (c.type !== 'particulier' && c.company_name) lines.push([c.company_name, c.legal_form].filter(Boolean).join(' '));
  if (person) lines.push(person);
  const street = [c.address, c.street_number].filter((x) => x && String(x).trim()).join(' ');
  if (street) lines.push(street);
  if (c.address_complement && c.address_complement.trim()) lines.push(c.address_complement.trim());
  const city = [c.zip, c.city].filter((x) => x && String(x).trim()).join(' ');
  if (city) lines.push(city);
  const country = (c.country ?? '').trim().toUpperCase();
  if (country && !['BE', 'BEL', 'BELGIQUE', 'BELGIE', 'BELGIË', 'BELGIUM'].includes(country)) lines.push(country);
  return lines;
}

/* ------------------------------------------------------------------ Portabilité */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Une valeur JSON en texte de cellule (objets imbriqués en JSON compact). */
export function cellValue(v: Json | undefined): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/**
 * Export RGPD (JSON de contact_gdpr_export) -> feuilles de tableur : une feuille « Fiche »
 * (champ / valeur) puis une feuille par liste (documents, motos, échanges...), une ligne par
 * élément. Les lignes de document restent en JSON dans leur colonne.
 */
export function exportToSheets(data: Record<string, Json>): { name: string; rows: (string | number | boolean)[][] }[] {
  const sheets: { name: string; rows: (string | number | boolean)[][] }[] = [];
  const contact = (data.contact ?? {}) as Record<string, Json>;
  sheets.push({
    name: 'Fiche',
    rows: [['Champ', 'Valeur'], ...Object.entries(contact).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, cellValue(v)])],
  });
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const objs = value.filter((x): x is { [k: string]: Json } => !!x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length === 0) continue;
    const cols = Array.from(new Set(objs.flatMap((o) => Object.keys(o))));
    sheets.push({ name: key.slice(0, 31), rows: [cols, ...objs.map((o) => cols.map((c) => cellValue(o[c])))] });
  }
  return sheets;
}
