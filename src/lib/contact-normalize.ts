/**
 * Normalisation des coordonnées d'une fiche client (mission 04, cartes 3, 4 et 5).
 * Fonctions PURES, sans dépendance — testées dans tests/contact-normalize.test.ts.
 *
 *  - normalizeEmail : e-mail sans espaces autour, en minuscules (demande de Domenico :
 *    « on met le mail en minuscule »). La base fait la même chose par déclencheur.
 *  - normalizeMobile : format international compact (+32471123456). Un numéro belge
 *    saisi « 0471 12 34 56 » devient +32471123456 ; un numéro qui commence par + est
 *    gardé (seuls les espaces, points, barres et tirets sont retirés).
 *  - belgianGsmFromPhone : GSM belge (04xx / +324xx / 00324xx) trouvé dans un
 *    « téléphone » repris de G8, au format international — sinon null.
 *  - isValidIban / normalizeIban / formatIban : contrôle modulo 97 (ISO 13616).
 */

/** E-mail : espaces retirés autour, minuscules. Chaîne vide si rien. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * Pays où l'on compose un 0 « national » devant le numéro, à retirer après
 * l'indicatif (+32 0471… → +32471…). Erreur fréquente avec le menu de préfixe.
 */
const TRUNK_ZERO_PREFIXES = ['+32', '+33', '+31', '+49', '+41', '+43', '+44', '+352'];

/**
 * Mobile au format international compact.
 *  - vide, ou indicatif seul (« +32 ») → '' ;
 *  - « 00 » en tête → « + » ;
 *  - commence par + → gardé (formatage retiré ; 0 national après +32, +33… retiré) ;
 *  - commence par un seul 0 → numéro belge : +32 + le reste sans le 0 ;
 *  - sinon (numéro sans indicatif ni 0) → gardé tel quel, sans formatage.
 */
export function normalizeMobile(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (plus) {
    if (digits.length < 4) return ''; // indicatif seul (« +32 ») : aucun numéro saisi
    const intl = `+${digits}`;
    for (const p of TRUNK_ZERO_PREFIXES) {
      if (intl.startsWith(`${p}0`)) return p + intl.slice(p.length + 1);
    }
    return intl;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return normalizeMobile(`+${digits}`);
  }
  if (digits.startsWith('0')) return `+32${digits.slice(1)}`;
  return digits;
}

/**
 * GSM belge contenu dans un champ « téléphone » : 04xx xx xx xx, +32 4xx…, 0032 4xx…
 * (formatage libre : espaces, /, ., -). Renvoie +324xxxxxxxx, sinon null.
 */
export function belgianGsmFromPhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  let national: string | null = null;
  if (s.startsWith('+') && digits.startsWith('32')) national = digits.slice(2);
  else if (digits.startsWith('0032')) national = digits.slice(4);
  else if (digits.startsWith('0')) national = digits.slice(1);
  if (national === null) return null;
  if (national.startsWith('0')) national = national.slice(1); // +32 0471…
  return /^4\d{8}$/.test(national) ? `+32${national}` : null;
}

/** IBAN sans espaces, en majuscules. */
export function normalizeIban(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\s.-]/g, '').toUpperCase();
}

/** IBAN affiché par groupes de 4 (BE68 5390 0754 7034). */
export function formatIban(raw: string | null | undefined): string {
  return normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Contrôle d'un IBAN (ISO 13616) : 2 lettres pays, 2 chiffres de contrôle,
 * 11 à 30 caractères alphanumériques, et reste 1 dans la division par 97 du nombre
 * obtenu en plaçant les 4 premiers caractères à la fin (A=10 … Z=35).
 * Belgique : 16 caractères exactement.
 */
export function isValidIban(raw: string | null | undefined): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('BE') && iban.length !== 16) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}
