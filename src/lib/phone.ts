/**
 * Téléphones : UN seul format partout (inscription, espace client, fiche contact).
 * Fonctions PURES, sans dépendance — testées dans tests/phone.test.ts.
 *
 *  - Stockage : E.164 compact, « + » puis 8 à 15 chiffres (+32470123456).
 *  - Saisie   : menu de préfixe pays (+32 par défaut, composant PhoneInput) + numéro
 *               national. « 0470 12 34 56 » devient +32470123456 ; « 0032 … » et
 *               « +32 0470 … » aussi (le 0 national est retiré).
 *  - Affichage : lisible, par groupes (+32 470 12 34 56, +32 2 123 45 67).
 *
 * Tout ce qui n'est pas un numéro (lettres, « @ » : une adresse e-mail glissée dans
 * le champ par le remplissage automatique du navigateur) est REFUSÉ, jamais stocké.
 */
import { normalizeMobile } from './contact-normalize';
import { splitPhone } from './dial-codes';

/** Caractères admis dans une saisie de téléphone (chiffres et formatage usuel). */
const PHONE_CHARS = /^[0-9 +()./-]*$/;

/** La saisie ne contient que des caractères de téléphone (vide accepté). */
export function hasOnlyPhoneChars(raw: string | null | undefined): boolean {
  return PHONE_CHARS.test((raw ?? '').trim());
}

/** Aucun numéro saisi : vide, ou préfixe seul (« +32 »). */
export function isEmptyPhone(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim();
  if (!s) return true;
  return hasOnlyPhoneChars(s) && s.startsWith('+') && splitPhone(s).local.replace(/\D/g, '') === '';
}

/**
 * Numéro au format E.164 (+32470123456), ou null si la saisie n'est pas un numéro
 * (lettres, @, trop court / trop long). Vide ou préfixe seul → '' (aucun numéro).
 * Sans indicatif, le numéro est belge (+32) : « 0470… » → « +32470… ».
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (isEmptyPhone(s)) return '';
  if (!hasOnlyPhoneChars(s)) return null;
  let n = normalizeMobile(s);
  if (!n) return '';
  if (!n.startsWith('+')) n = `+32${n}`; // chiffres sans 0 ni indicatif : numéro belge
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

/** La saisie est vide ou un numéro valide. */
export function isValidPhone(raw: string | null | undefined): boolean {
  return toE164(raw) !== null;
}

/** Groupes de chiffres d'un numéro national, selon le pays. */
function groupNational(prefix: string, national: string): string {
  const d = national;
  const pairs = (s: string) => s.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (prefix === '+32') {
    // GSM belge : 470 12 34 56 ; fixe à zone courte (Bruxelles 2, Anvers 3, Liège 4, Gand 9) : 2 123 45 67.
    if (/^4\d{8}$/.test(d)) return `${d.slice(0, 3)} ${pairs(d.slice(3))}`;
    if (d.length === 8 && /^[2349]/.test(d)) return `${d[0]} ${d.slice(1, 4)} ${pairs(d.slice(4))}`;
    if (d.length === 8) return `${d.slice(0, 2)} ${pairs(d.slice(2))}`;
  }
  // France : 6 12 34 56 78.
  if (prefix === '+33' && d.length === 9) return `${d[0]} ${pairs(d.slice(1))}`;
  if (d.length <= 4) return d;
  return d.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/**
 * Affichage lisible d'un numéro stocké : « +32 470 12 34 56 ». Une valeur qui n'est
 * pas un numéro (donnée ancienne) est rendue telle quelle ; vide → ''.
 */
export function formatPhone(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const e164 = toE164(s);
  if (!e164) return s;
  const { prefix, local } = splitPhone(e164);
  return `${prefix} ${groupNational(prefix, local.replace(/\D/g, ''))}`;
}

/**
 * Numéro national lisible pour le champ de saisie (sans le préfixe), après
 * normalisation : « 0470123456 » avec +32 → « 470 12 34 56 ». Saisie invalide :
 * rendue telle quelle (le message d'erreur s'affiche sous le champ).
 */
export function formatLocalPart(prefix: string, local: string): string {
  const e164 = toE164(`${prefix} ${local}`);
  if (e164 === '') return '';
  if (!e164) return local.trim();
  const split = splitPhone(e164);
  if (split.prefix !== prefix) return local.trim();
  return groupNational(prefix, split.local.replace(/\D/g, ''));
}
