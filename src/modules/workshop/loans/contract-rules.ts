/**
 * M8 — Contrat de pret repris de G8 (19/11/2026, ATE005, ATE022, a-trancher T10) : REGLES PURES.
 *
 * Le contrat imprime contient au minimum tout le contrat G8 « CONTRAT DE PRET DE VEHICULE DE
 * REMPLACEMENT » : conducteur (ne le / a, adresse, tel., permis n° / delivre le / par, n° licence),
 * moto du client (marque, modele, MEC, immatriculation, chassis, OR n° / du, livraison prevue),
 * moto de pret (marque, modele, MEC, chassis, puissance ; depart et retour : date, heure, km,
 * carburant), franchise (reglage de la societe, 500 EUR par defaut), mentions police et
 * « lu et approuve », double exemplaire ; nos conditions generales au verso, langue du client.
 *
 * Ici : choix des valeurs (saisie sur le pret > fiche client / OR / moto), formats, langue des CG.
 * Tests : tests/contrat-pret-g8.test.ts.
 */
import { isLocale, type Locale } from '@/lib/i18n';

/** Franchise G8 quand la societe n'a rien regle. */
export const DEFAULT_LOAN_DEDUCTIBLE = 500;

/** Valeur texte : vide / espaces = absente. */
const clean = (v: unknown): string => (v == null ? '' : String(v).trim());
/** Premiere valeur non vide. */
export const firstFilled = (...values: unknown[]): string => {
  for (const v of values) {
    const s = clean(v);
    if (s) return s;
  }
  return '';
};

/** Franchise du contrat : celle figee sur le pret, sinon le reglage de la societe, sinon 500. */
export function resolveDeductible(loanValue: number | string | null | undefined, settingValue: number | string | null | undefined): number {
  for (const v of [loanValue, settingValue]) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_LOAN_DEDUCTIBLE;
}

/** Saisie d'une franchise (« 500 », « 750,50 ») : nombre >= 0 a 2 decimales, ou null si invalide. */
export function parseDeductible(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

/** Montant imprime : « 500,00 € » (separateur de milliers : espace insecable fine). */
export function formatEuro(n: number): string {
  const [int, dec] = (Math.round(n * 100) / 100).toFixed(2).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')},${dec} €`;
}

/** Puissance d'une fiche moto du parc : « 82 kW / 111 ch » (unite des chevaux selon la langue). */
export function formatPower(kw: number | null | undefined, cv: number | null | undefined, cvUnit: string): string {
  const parts: string[] = [];
  if (kw != null && Number(kw) > 0) parts.push(`${Number(kw)} kW`);
  if (cv != null && Number(cv) > 0) parts.push(`${Number(cv)} ${cvUnit}`);
  return parts.join(' / ');
}
/** Unite des chevaux imprimee dans la langue du contrat. */
export const CV_UNIT: Record<Locale, string> = { fr: 'ch', nl: 'pk', en: 'hp', it: 'CV' };

const pad = (n: number) => String(n).padStart(2, '0');
/** Date du contrat (jj/mm/aaaa, usage belge dans les quatre langues), depuis un ISO ou une date AAAA-MM-JJ. */
export function contractDate(value: string | null | undefined): string {
  if (!value) return '';
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
/** Heure du contrat (hh:mm, heure locale), depuis un ISO. */
export function contractTime(value: string | null | undefined): string {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Langue du contrat : celle de la fiche client (FR par defaut). */
export function contractLocale(contactLocale: unknown): Locale {
  return isLocale(contactLocale) ? contactLocale : 'fr';
}

/**
 * Conditions generales dans la langue du contrat : `loan_terms_i18n[langue]` si rempli,
 * sinon le texte FR (`loan_terms`). Le FR fait foi (texte accepte par le client).
 */
export function loanTermsFor(locale: Locale, s: { loan_terms: string | null; loan_terms_i18n?: Record<string, unknown> | null }): string {
  if (locale !== 'fr') {
    const v = s.loan_terms_i18n?.[locale];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return s.loan_terms ?? '';
}

/** Adresse d'une fiche client sur une ligne : « Rue 1, 1000 Bruxelles ». */
export function oneLineAddress(c: { address?: string | null; street_number?: string | null; zip?: string | null; city?: string | null } | null | undefined): string {
  if (!c) return '';
  const street = [clean(c.address), clean(c.street_number)].filter(Boolean).join(' ');
  const town = [clean(c.zip), clean(c.city)].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

/** Donnees du conducteur gardees sur le pret (colonnes driver_*). */
export type DriverFields = {
  driver_name: string | null; driver_birth_date: string | null; driver_birth_place: string | null;
  driver_address: string | null; driver_phone: string | null; driver_license_number: string | null;
  driver_license_date: string | null; driver_license_issued_by: string | null; driver_licence_number: string | null;
};
export const DRIVER_KEYS: (keyof DriverFields)[] = [
  'driver_name', 'driver_birth_date', 'driver_birth_place', 'driver_address', 'driver_phone',
  'driver_license_number', 'driver_license_date', 'driver_license_issued_by', 'driver_licence_number',
];

/** Fiche client, champs lus pour le conducteur. */
export type DriverSource = {
  name: string;
  birth_date?: string | null; birth_place?: string | null;
  address?: string | null; street_number?: string | null; zip?: string | null; city?: string | null;
  mobile?: string | null; gsm?: string | null; phone?: string | null;
  license_number?: string | null; license_date?: string | null; license_issued_by?: string | null; license_place?: string | null;
};

/**
 * Conducteur du contrat : ce qui a ete saisi sur le pret, sinon la fiche client.
 * Delivre « par » = autorite (`license_issued_by`), a defaut le lieu de delivrance (`license_place`).
 * Le n° de licence n'existe pas sur la fiche client : il vient du pret seulement.
 */
export function driverPrefill(loan: Partial<DriverFields> | null | undefined, c: DriverSource | null | undefined): DriverFields {
  const l = loan ?? {};
  const v = (s: string) => s || null;
  return {
    driver_name: v(firstFilled(l.driver_name, c?.name)),
    driver_birth_date: v(firstFilled(l.driver_birth_date, c?.birth_date)),
    driver_birth_place: v(firstFilled(l.driver_birth_place, c?.birth_place)),
    driver_address: v(firstFilled(l.driver_address, oneLineAddress(c))),
    driver_phone: v(firstFilled(l.driver_phone, c?.mobile, c?.gsm, c?.phone)),
    driver_license_number: v(firstFilled(l.driver_license_number, c?.license_number)),
    driver_license_date: v(firstFilled(l.driver_license_date, c?.license_date)),
    driver_license_issued_by: v(firstFilled(l.driver_license_issued_by, c?.license_issued_by, c?.license_place)),
    driver_licence_number: v(firstFilled(l.driver_licence_number)),
  };
}

/** Moto (fiche du parc ou moto de pret) telle qu'imprimee. */
export type ContractMoto = { brand: string; model: string; firstRegistration: string; plate: string; vin: string; power: string };

/** Moto de pret : la flotte d'abord, la fiche moto du parc liee en complement. */
export function loanerMoto(
  l: { label?: string | null; brand?: string | null; plate?: string | null; vin?: string | null; first_registration?: string | null; power?: string | null } | null | undefined,
  linked: { brand?: string | null; model?: string | null; plate?: string | null; vin?: string | null; first_registration_date?: string | null; power_kw?: number | null; power_cv?: number | null } | null | undefined,
  cvUnit: string,
): ContractMoto {
  return {
    brand: firstFilled(l?.brand, linked?.brand),
    model: firstFilled(l?.label, linked?.model),
    firstRegistration: contractDate(firstFilled(l?.first_registration, linked?.first_registration_date)),
    plate: firstFilled(l?.plate, linked?.plate),
    vin: firstFilled(l?.vin, linked?.vin),
    power: firstFilled(l?.power, formatPower(linked?.power_kw, linked?.power_cv, cvUnit)),
  };
}

/** Moto du client (fiche du parc). */
export function customerMoto(
  v: { brand?: string | null; model?: string | null; plate?: string | null; vin?: string | null; first_registration_date?: string | null; power_kw?: number | null; power_cv?: number | null } | null | undefined,
  cvUnit: string,
): ContractMoto {
  return {
    brand: firstFilled(v?.brand), model: firstFilled(v?.model),
    firstRegistration: contractDate(v?.first_registration_date ?? null),
    plate: firstFilled(v?.plate), vin: firstFilled(v?.vin),
    power: formatPower(v?.power_kw, v?.power_cv, cvUnit),
  };
}

/** Releve de depart ou de retour imprime (vide = a remplir a la main). */
export type ContractLeg = { date: string; time: string; km: string; fuel: string };
export function contractLeg(at: string | null | undefined, km: number | null | undefined, fuelLabel: string): ContractLeg {
  return { date: contractDate(at ?? null), time: contractTime(at ?? null), km: km == null ? '' : String(km), fuel: fuelLabel };
}

/** Champs du contrat G8 encore vides (rappel a l'ecran : ils seront a remplir a la main). */
export function missingDriverFields(d: DriverFields): (keyof DriverFields)[] {
  return DRIVER_KEYS.filter((k) => !clean(d[k]));
}
