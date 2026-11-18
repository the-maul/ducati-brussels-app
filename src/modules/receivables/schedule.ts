/**
 * Encaissements (rattrapage G8, 18/11/2026) — échéancier « en N fois » (G8 : « Calculer sur
 * 12 échéances automatique »). Module PUR, testé (tests/encaissements-g8.test.ts).
 *
 * Mêmes règles que la base (`payment_schedule_create`, migration 20261118170000) : l'aperçu de
 * l'écran et ce que la base écrit sont identiques.
 *   - montant de chaque échéance = total / N arrondi au cent INFÉRIEUR ; le reliquat (quelques
 *     cents) va sur la PREMIÈRE échéance ;
 *   - échéance n = première échéance + (n − 1) × intervalle, calculée depuis la première date
 *     (31/01 → 28/02 → 31/03 : pas de glissement de fin de mois) ;
 *   - n° de chèque numérique : incrémenté (zéros de tête gardés) ; sinon sur la 1re seulement.
 */

export const DEFAULT_INSTALLMENTS = 12;
export const MAX_INSTALLMENTS = 60;

const cents = (n: number) => Math.round(n * 100);

/** Montant de l'échéance n (1..count). */
export function installmentAmount(total: number, count: number, n: number): number {
  const totalCents = cents(total);
  const base = Math.floor(totalCents / count);
  const first = totalCents - (count - 1) * base;
  return (n === 1 ? first : base) / 100;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Ajoute des mois à une date ISO (AAAA-MM-JJ) en ramenant au dernier jour du mois si besoin (comme PostgreSQL). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm0 = ((total % 12) + 12) % 12;
  const nd = Math.min(d, daysIn(ny, nm0));
  return `${ny}-${pad2(nm0 + 1)}-${pad2(nd)}`;
}

/** Échéance n : première date + (n − 1) × intervalle (en mois). */
export function installmentDue(firstIso: string, intervalMonths: number, n: number): string {
  return addMonthsClamped(firstIso, (n - 1) * intervalMonths);
}

/** N° de chèque de l'échéance n. */
export function installmentCheque(first: string | null | undefined, n: number): string | null {
  const f = String(first ?? '').trim();
  if (!f) return null;
  if (/^[0-9]{1,18}$/.test(f)) {
    const next = (BigInt(f) + BigInt(n - 1)).toString();
    return next.padStart(f.length, '0');
  }
  return n === 1 ? f : null;
}

export type ScheduleInput = {
  total: number; count: number; firstDue: string; intervalMonths?: number; firstCheque?: string | null;
};
export type ScheduleLine = { n: number; amount: number; dueDate: string; cheque: string | null };

export type ScheduleError = 'count' | 'total' | 'tooSmall' | 'firstDue' | 'interval' | 'exceedsDue';

/** Vérifie la saisie (mêmes refus que la base). `open` = reste à payer du document, échéances déjà prévues déduites. */
export function validateSchedule(input: ScheduleInput, open: number): ScheduleError | null {
  const interval = input.intervalMonths ?? 1;
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_INSTALLMENTS) return 'count';
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) return 'interval';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDue)) return 'firstDue';
  const total = cents(input.total) / 100;
  if (!(total > 0)) return 'total';
  if (cents(total) < input.count) return 'tooSmall';
  if (total > open + 0.005) return 'exceedsDue';
  return null;
}

/** Les N échéances (aperçu). La somme vaut exactement le total. */
export function buildSchedule(input: ScheduleInput): ScheduleLine[] {
  const interval = input.intervalMonths ?? 1;
  const out: ScheduleLine[] = [];
  for (let n = 1; n <= input.count; n++) {
    out.push({
      n,
      amount: installmentAmount(input.total, input.count, n),
      dueDate: installmentDue(input.firstDue, interval, n),
      cheque: installmentCheque(input.firstCheque, n),
    });
  }
  return out;
}

/**
 * Répartition d'un montant sur plusieurs documents (G8 « Gestion des encaissements » : régler
 * plusieurs factures d'un client en une fois) : les plus anciennes échéances d'abord, jamais plus
 * que le reste dû de chaque document. Ce qui ne trouve pas de document est renvoyé en `left`.
 */
export type AllocTarget = { id: string; due: number; dueDate: string | null };
export function allocateAmount(amount: number, targets: AllocTarget[]): { allocations: { id: string; amount: number }[]; left: number } {
  let rest = cents(amount);
  const sorted = [...targets].filter((t) => t.due > 0.005)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id.localeCompare(b.id));
  const allocations: { id: string; amount: number }[] = [];
  for (const t of sorted) {
    if (rest <= 0) break;
    const take = Math.min(rest, cents(t.due));
    if (take > 0) { allocations.push({ id: t.id, amount: take / 100 }); rest -= take; }
  }
  return { allocations, left: Math.max(rest, 0) / 100 };
}

/**
 * Compensation avoirs / trop-perçus ↔ factures d'un même client (G8 « Régulariser », règlement
 * « COMPENSE AVOIR ») : les crédits (dû négatif) soldent les factures les plus anciennes d'abord.
 * Chaque paire donne deux lettrages AVO : + sur la facture, − sur le crédit.
 */
export type CompensationPair = { debitId: string; creditId: string; amount: number };
export function compensationPairs(debits: AllocTarget[], credits: AllocTarget[]): CompensationPair[] {
  const ds = [...debits].filter((d) => d.due > 0.005).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id.localeCompare(b.id))
    .map((d) => ({ id: d.id, left: cents(d.due) }));
  const cs = [...credits].filter((c) => c.due < -0.005).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, left: cents(-c.due) }));
  const out: CompensationPair[] = [];
  let i = 0, j = 0;
  while (i < ds.length && j < cs.length) {
    const take = Math.min(ds[i].left, cs[j].left);
    if (take > 0) out.push({ debitId: ds[i].id, creditId: cs[j].id, amount: take / 100 });
    ds[i].left -= take; cs[j].left -= take;
    if (ds[i].left <= 0) i++;
    if (cs[j].left <= 0) j++;
  }
  return out;
}
