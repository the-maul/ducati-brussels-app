/**
 * M6 — Paiement par QR de virement SEPA (mission 02, carte 9 ; décision P-2 étape 1).
 * Fonctions PURES, testées par tests/sales-epc-qr.test.ts.
 *
 * 1. Charge utile « EPC069-12 » (European Payments Council, « Quick Response Code :
 *    guidelines to enable data capture for the initiation of a SEPA credit transfer »),
 *    version 002, encodage 1 = UTF-8, identification SCT. Lignes séparées par LF :
 *      1 BCD · 2 002 · 3 1 · 4 SCT · 5 BIC (facultatif en v002 dans l'EEE) · 6 nom du bénéficiaire (≤ 70)
 *      7 IBAN · 8 montant « EUR123.45 » · 9 code motif (vide) · 10 référence structurée (≤ 35)
 *      11 communication libre (≤ 140, exclusive de la ligne 10) · 12 info bénéficiaire → payeur (vide)
 *    Les lignes vides de fin sont omises (autorisé). Charge utile ≤ 331 octets.
 *    Le QR doit être généré en correction d'erreur « M » (voir customer-display.tsx).
 * 2. Communication structurée belge (OGM/VCS) « +++XXX/XXXX/XXXXX+++ » : 10 chiffres de base
 *    + 2 chiffres de contrôle = base modulo 97 (97 si le reste vaut 0).
 */

export const EPC_MAX_BYTES = 331;
export const EPC_NAME_MAX = 70;
export const EPC_STRUCTURED_MAX = 35;
export const EPC_TEXT_MAX = 140;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;
/** Pas de retour à la ligne dans un champ (il décalerait les lignes de la charge utile). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// IBAN
// ---------------------------------------------------------------------------

/** IBAN compacté : sans espaces, en majuscules. */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** Contrôle ISO 13616 (modulo 97 = 1). */
export function isValidIban(iban: string): boolean {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** IBAN masqué pour l'écran et les journaux : « BE71 •••• •••• 6769 ». Jamais l'IBAN complet dans un log. */
export function maskIban(iban: string): string {
  const s = normalizeIban(iban);
  if (s.length < 8) return '••••';
  return `${s.slice(0, 4)} •••• •••• ${s.slice(-4)}`;
}

/** IBAN lisible par groupes de 4 (affiché au client pour un virement manuel). */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

// ---------------------------------------------------------------------------
// Communication structurée belge
// ---------------------------------------------------------------------------

/** Chiffres de contrôle : base (10 chiffres) modulo 97, 97 si le reste est 0. */
export function structuredCheckDigits(base10: string): string {
  if (!/^\d{10}$/.test(base10)) throw new Error('La base d’une communication structurée compte 10 chiffres.');
  const rest = Number(BigInt(base10) % 97n);
  return String(rest === 0 ? 97 : rest).padStart(2, '0');
}

/** « +++XXX/XXXX/XXXXX+++ » à partir d'une base de 10 chiffres. */
export function belgianStructuredReference(base10: string): string {
  const d = base10 + structuredCheckDigits(base10);
  return `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7, 12)}+++`;
}

/** Vérifie une communication structurée (avec ou sans +++ et barres). */
export function isValidStructuredReference(ref: string): boolean {
  const d = ref.replace(/[+/\s*]/g, '');
  if (!/^\d{12}$/.test(d)) return false;
  return structuredCheckDigits(d.slice(0, 10)) === d.slice(10);
}

/**
 * Premier chiffre de la base selon le type de document : deux documents de types différents
 * portant le même compteur (DEV-2026-00012 / FAC-2026-00012) n'ont pas la même communication.
 */
export const STRUCTURED_DOC_TYPE_DIGIT: Record<string, string> = {
  DEV: '1', BC: '2', RES: '3', BL: '4', FAC: '5', TIK: '6', AVO: '7',
};

/**
 * Communication structurée d'un document de vente : chiffre du type + les 9 derniers chiffres
 * de son numéro (complétés à gauche par des 0). « DEV-2026-00012 » → base 1202600012.
 * Renvoie null si le numéro ne contient aucun chiffre (brouillon).
 */
export function structuredReferenceForDocument(docType: string, docNumber: string | null | undefined): string | null {
  const digits = (docNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const typeDigit = STRUCTURED_DOC_TYPE_DIGIT[docType] ?? '9';
  return belgianStructuredReference(typeDigit + digits.slice(-9).padStart(9, '0'));
}

/** Communication libre « DEV-2026-00012 Nom du client », limitée à 140 caractères. */
export function freeTextReference(docNumber: string | null | undefined, customerName: string | null | undefined): string {
  return oneLine([docNumber ?? '', customerName ?? ''].filter(Boolean).join(' ')).slice(0, EPC_TEXT_MAX);
}

// ---------------------------------------------------------------------------
// Charge utile EPC
// ---------------------------------------------------------------------------

/** Montant EPC : « EUR » + montant à 2 décimales, point décimal, sans séparateur de milliers. */
export function epcAmount(amount: number): string {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(cents) || cents < 1 || cents > 99_999_999_999) {
    throw new Error('Montant hors limites (0,01 € à 999 999 999,99 €).');
  }
  return `EUR${(cents / 100).toFixed(2)}`;
}

export type EpcInput = {
  name: string;
  iban: string;
  bic?: string | null;
  amount: number;
  /** Communication structurée (ligne 10). Exclusive de `text`. */
  structuredReference?: string | null;
  /** Communication libre (ligne 11). Exclusive de `structuredReference`. */
  text?: string | null;
};

/** Construit la charge utile EPC069-12 v002 ; lève une erreur lisible si une règle n'est pas respectée. */
export function buildEpcPayload(input: EpcInput): string {
  const name = oneLine(input.name);
  if (!name) throw new Error('Nom du bénéficiaire manquant.');
  if (name.length > EPC_NAME_MAX) throw new Error(`Nom du bénéficiaire trop long (${EPC_NAME_MAX} caractères au plus).`);
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) throw new Error('IBAN du bénéficiaire invalide.');
  const bic = input.bic ? input.bic.replace(/\s+/g, '').toUpperCase() : '';
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new Error('BIC invalide.');
  const structured = input.structuredReference ? oneLine(input.structuredReference) : '';
  const text = input.text ? oneLine(input.text) : '';
  if (structured && text) throw new Error('Communication structurée ou libre, pas les deux.');
  if (structured.length > EPC_STRUCTURED_MAX) throw new Error(`Référence structurée trop longue (${EPC_STRUCTURED_MAX} au plus).`);
  if (text.length > EPC_TEXT_MAX) throw new Error(`Communication trop longue (${EPC_TEXT_MAX} caractères au plus).`);

  const lines = ['BCD', '002', '1', 'SCT', bic, name, iban, epcAmount(input.amount), '', structured, text];
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const payload = lines.join('\n');
  if (utf8Length(payload) > EPC_MAX_BYTES) throw new Error(`Données du QR trop longues (${EPC_MAX_BYTES} octets au plus).`);
  return payload;
}

// ---------------------------------------------------------------------------
// Montants proposés au vendeur
// ---------------------------------------------------------------------------

export type QrAmountChoice = 'solde' | 'acompte10' | 'libre';

/** Montant proposé : reste à payer, acompte de 10 % du TTC (plafonné au reste), ou saisi. */
export function qrProposedAmount(choice: QrAmountChoice, clientDue: number, totalTtc: number, free: number): number {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (choice === 'solde') return r2(Math.max(clientDue, 0));
  if (choice === 'acompte10') return r2(Math.min(totalTtc * 0.1, Math.max(clientDue, 0)));
  return r2(Number.isFinite(free) ? free : 0);
}
