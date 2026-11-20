/**
 * M0 — Règles de la numérotation des documents (sans accès base : testées par `tests/numerotation.test.ts`).
 *
 * Deux modes par société (décision de Simon du 18/11/2026, rattrapage G8 « Gestion chronos ») :
 *   - `separate` : facture, ticket et avoir ont chacun leur série (FAC / TIK / AVO) ;
 *   - `single`   : les trois prennent le numéro d'un seul compteur (série `VEN`), comme dans G8.
 * La base fait foi (migration 20261118260000) ; ces fonctions servent l'aperçu et les messages de l'écran.
 */

export type SalesNumberingMode = 'separate' | 'single';

/** Types qui partagent le compteur unique en mode `single` (G8 : facture + ticket + avoir). */
export const SHARED_SALES_TYPES = ['FAC', 'TIK', 'AVO'] as const;
/** Série du compteur unique. */
export const SINGLE_COUNTER_TYPE = 'VEN';

export type SequenceFormat = {
  prefix: string; separator: string; padding: number; reset_yearly: boolean;
  next_value: number; current_year: number | null; suffix: string | null;
};

export function isSharedSalesType(docType: string): boolean {
  return (SHARED_SALES_TYPES as readonly string[]).includes(docType);
}

/** Série qui fournira le numéro d'un type de document selon le mode. */
export function numberingKey(docType: string, mode: SalesNumberingMode): string {
  return mode === 'single' && isSharedSalesType(docType) ? SINGLE_COUNTER_TYPE : docType;
}

/** Une série est « en sommeil » quand le mode en vigueur ne l'utilise pas. */
export function isDormant(docType: string, mode: SalesNumberingMode): boolean {
  if (docType === SINGLE_COUNTER_TYPE) return mode !== 'single';
  return mode === 'single' && isSharedSalesType(docType);
}

/** Valeur du prochain numéro (remise à zéro annuelle comprise), comme `_next_document_number_unchecked`. */
export function effectiveNextValue(s: Pick<SequenceFormat, 'reset_yearly' | 'current_year' | 'next_value'>, year: number): number {
  return s.reset_yearly && s.current_year !== year ? 1 : Number(s.next_value);
}

/** Met en forme un numéro (même règle que la base, sans troncature au-delà de la longueur). */
export function formatNumber(s: Omit<SequenceFormat, 'next_value' | 'current_year'>, year: number, n: number): string {
  const num = String(n).padStart(Math.max(1, Number(s.padding) || 1), '0');
  const base = s.reset_yearly
    ? `${s.prefix}${s.separator}${year}${s.separator}${num}`
    : `${s.prefix}${s.separator}${num}`;
  return base + (s.suffix ?? '');
}

/** Aperçu en direct du prochain numéro (même logique que next_document_number()). */
export function previewNumber(s: SequenceFormat, year: number = new Date().getFullYear()): string {
  return formatNumber(s, year, effectiveNextValue(s, year));
}

export type NextValueError = 'notInteger' | 'notHigher' | 'tooBig' | 'reasonMissing';

/** Réglage du prochain numéro : vers le haut seulement, avec un motif (même contrôle que set_sequence_next_value). */
export function nextValueError(
  s: Pick<SequenceFormat, 'reset_yearly' | 'current_year' | 'next_value'>, requested: number, reason: string, year: number,
): NextValueError | null {
  if (!Number.isInteger(requested) || requested < 1) return 'notInteger';
  if (requested > 999_999_999_999) return 'tooBig';
  if (requested <= effectiveNextValue(s, year)) return 'notHigher';
  if (reason.trim().length < 5) return 'reasonMissing';
  return null;
}

/** Nombre de numéros sautés par un réglage (le « trou » à justifier au comptable). */
export function skippedNumbers(s: Pick<SequenceFormat, 'reset_yearly' | 'current_year' | 'next_value'>, requested: number, year: number): number {
  return Math.max(0, requested - effectiveNextValue(s, year));
}

export type ModeChangeDecision = 'same' | 'now' | 'nextYearOnly';

/**
 * Changement de mode : immédiat seulement si aucune facture / ticket / avoir n'a été numéroté
 * dans l'exercice (société neuve ou début d'année) ; sinon il ne peut être que programmé au 1er janvier.
 */
export function modeChangeDecision(p: { current: SalesNumberingMode; requested: SalesNumberingMode; numberedThisYear: number }): ModeChangeDecision {
  if (p.current === p.requested) return 'same';
  return p.numberedThisYear > 0 ? 'nextYearOnly' : 'now';
}

/** Regroupement de l'écran, calqué sur la « Gestion chronos » de G8. */
export type NumberingGroup = 'sales' | 'workshop' | 'purchases' | 'vehicles' | 'cash' | 'other';
export const NUMBERING_GROUPS: NumberingGroup[] = ['sales', 'workshop', 'purchases', 'vehicles', 'cash', 'other'];

const GROUP_OF: Record<string, NumberingGroup> = {
  VEN: 'sales', FAC: 'sales', TIK: 'sales', AVO: 'sales', FAA: 'sales', DEV: 'sales', RES: 'sales', BC: 'sales', BL: 'sales',
  OR: 'workshop', ORO: 'workshop',
  CMD: 'purchases', CDP: 'purchases', CEX: 'purchases', REC: 'purchases', EAN: 'purchases',
  REP: 'vehicles', OCC: 'vehicles', DEP: 'vehicles', COC: 'vehicles',
  Z: 'cash', RMB: 'cash', REM: 'cash', MVC: 'cash', MFC: 'cash',
};

export function groupOf(docType: string): NumberingGroup {
  return GROUP_OF[docType] ?? 'other';
}

/** Ordre d'affichage dans un groupe (le compteur unique et les factures d'abord). */
const ORDER = ['VEN', 'FAC', 'TIK', 'AVO', 'FAA', 'DEV', 'RES', 'BC', 'BL', 'OR', 'ORO', 'CMD', 'CDP', 'CEX', 'REC', 'EAN', 'REP', 'OCC', 'DEP', 'COC', 'Z'];
export function compareDocTypes(a: string, b: string): number {
  const ia = ORDER.indexOf(a); const ib = ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
}

/** Types dont l'écran connaît l'explication (`numbering.help.<type>`). */
export const KNOWN_HELP_TYPES = ['VEN', 'FAC', 'TIK', 'AVO', 'FAA', 'DEV', 'RES', 'BC', 'BL', 'OR', 'ORO', 'CMD', 'CDP', 'CEX', 'REC', 'EAN', 'REP', 'OCC', 'DEP', 'COC', 'Z'] as const;
export function hasHelp(docType: string): boolean {
  return (KNOWN_HELP_TYPES as readonly string[]).includes(docType);
}
