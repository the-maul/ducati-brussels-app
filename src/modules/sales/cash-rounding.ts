/**
 * M6 (POS) — Arrondi legal des especes (Belgique, arrete royal du 1er decembre 2019, art. VI.7/2
 * du Code de droit economique) : quand le client paie en especes, le montant a payer est arrondi
 * au multiple de 5 cents le plus proche (1-2 → 0, 3-4 → 5, 6-7 → 5, 8-9 → 10). L arrondi ne
 * change pas le document : il est enregistre comme un reglement a part, mode `ARR`, pour que le
 * journal de caisse montre les especes reellement dans le tiroir et l ecart d arrondi.
 * Logique pure, testee dans tests/caisse-arrondi-especes.test.ts. Audit caisse du 03/11/2026.
 */
export const CASH_METHOD = 'ESP';
/** Mode de reglement technique qui porte l ecart d arrondi (libelle dans Parametres → Tables). */
export const CASH_ROUNDING_METHOD = 'ARR';
/** Note posee sur le reglement d arrondi (donnee en francais, regle 1 de CLAUDE.md). */
export const CASH_ROUNDING_NOTE = 'Arrondi especes (5 cents)';

const cents = (n: number) => Math.round(n * 100);

/** Arrondit un montant au multiple de 5 cents le plus proche (symetrique pour un remboursement). */
export function roundToFiveCents(amount: number): number {
  const c = cents(amount);
  const sign = c < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(c) / 5) * 5) / 100;
}

export type CashRoundingLine = { method: string; amount: number; status?: 'recu' | 'attendu' | string | null };

/** Un reglement en especes effectivement percu (pas un reglement a echeance). */
export const isCashReceived = (l: CashRoundingLine): boolean => l.method === CASH_METHOD && (l.status ?? 'recu') === 'recu';

/**
 * Especes saisies, especes arrondies et ecart (arrondi − saisi). `delta` vaut 0 quand il n y a
 * pas d especes ou que le montant tombe deja sur 5 cents.
 */
export function cashRounding(lines: CashRoundingLine[]): { cash: number; roundedCash: number; delta: number } {
  const cash = cents(lines.filter(isCashReceived).reduce((s, l) => s + l.amount, 0)) / 100;
  const roundedCash = roundToFiveCents(cash);
  return { cash, roundedCash, delta: cents(roundedCash - cash) / 100 };
}

/**
 * Applique l arrondi aux lignes de reglement avant enregistrement : la derniere ligne especes
 * percue est ajustee au montant arrondi et une ligne `ARR` porte l ecart inverse, de sorte que
 * la somme des reglements reste egale a ce que le client devait. Sans especes : lignes inchangees.
 */
export function applyCashRounding<T extends CashRoundingLine>(lines: T[]): (T | { method: string; amount: number; status: 'recu'; note: string })[] {
  const { delta } = cashRounding(lines);
  if (delta === 0) return lines;
  let last = -1;
  lines.forEach((l, i) => { if (isCashReceived(l)) last = i; });
  if (last < 0) return lines;
  const out: (T | { method: string; amount: number; status: 'recu'; note: string })[] = lines.map((l, i) =>
    i === last ? { ...l, amount: cents(l.amount + delta) / 100 } : l,
  );
  out.push({ method: CASH_ROUNDING_METHOD, amount: cents(-delta) / 100, status: 'recu', note: CASH_ROUNDING_NOTE });
  return out;
}

/** Monnaie a rendre : especes remises par le client moins les especes arrondies a encaisser. */
export function changeDue(given: number, roundedCash: number): number {
  const c = cents(given) - cents(roundedCash);
  return c > 0 ? c / 100 : 0;
}
