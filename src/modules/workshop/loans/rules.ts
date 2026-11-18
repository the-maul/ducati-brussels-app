/**
 * M8 — Motos de pret (rattrapage G8 du 18/11/2026, ATE005, ATE022, bloquant #14).
 * Regles pures : statuts du pret, disponibilite d'une moto, controles de sortie et de retour.
 * Les memes gardes existent en base (migration 20261118121000) ; ici elles donnent le message
 * avant l'envoi. Tests : tests/atelier-planning-g8.test.ts.
 */

export const LOAN_STATUSES = ['reserve', 'sorti', 'rendu', 'annule'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_TONE: Record<LoanStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  reserve: 'info', sorti: 'warning', rendu: 'success', annule: 'neutral',
};

export const FUEL_LEVELS = ['vide', 'quart', 'demi', 'trois_quarts', 'plein'] as const;
export type FuelLevel = (typeof FUEL_LEVELS)[number];

export type LoanPeriod = { id?: string; loaner_id: string; status: string; planned_start: string; planned_end: string };

export const isActiveLoan = (l: { status: string }) => l.status === 'reserve' || l.status === 'sorti';

/** Un pret actif de la meme moto chevauche-t-il la periode ? (meme garde qu'en base) */
export function conflictingLoan<T extends LoanPeriod>(loans: T[], p: LoanPeriod): T | null {
  const s = new Date(p.planned_start).getTime(); const e = new Date(p.planned_end).getTime();
  return loans.find((x) => x.id !== p.id && x.loaner_id === p.loaner_id && isActiveLoan(x)
    && new Date(x.planned_start).getTime() < e && new Date(x.planned_end).getTime() > s) ?? null;
}

export type LoanError = 'period' | 'conflict' | 'out_km' | 'out_date' | 'return_km' | 'return_date' | 'km_lower' | 'return_before_out';

export function checkPeriod<T extends LoanPeriod>(loans: T[], p: LoanPeriod): LoanError | null {
  if (!(new Date(p.planned_end).getTime() > new Date(p.planned_start).getTime())) return 'period';
  return conflictingLoan(loans, p) ? 'conflict' : null;
}

/** Sortie : date et km obligatoires (G8 / bloquant #14 : km au depart). */
export function checkOut(p: { outAt: string | null; outKm: number | null }): LoanError | null {
  if (!p.outAt) return 'out_date';
  if (p.outKm === null || !Number.isInteger(p.outKm) || p.outKm < 0) return 'out_km';
  return null;
}

/** Retour : date et km obligatoires, km retour >= km sortie, retour apres la sortie. */
export function checkReturn(p: { outAt: string | null; outKm: number | null; returnedAt: string | null; returnKm: number | null }): LoanError | null {
  if (!p.returnedAt) return 'return_date';
  if (p.returnKm === null || !Number.isInteger(p.returnKm) || p.returnKm < 0) return 'return_km';
  if (p.outKm !== null && p.returnKm < p.outKm) return 'km_lower';
  if (p.outAt && new Date(p.returnedAt).getTime() < new Date(p.outAt).getTime()) return 'return_before_out';
  return null;
}

/** Km parcourus pendant le pret. */
export const loanDistance = (l: { out_km: number | null; return_km: number | null }) =>
  l.out_km !== null && l.return_km !== null ? Math.max(0, l.return_km - l.out_km) : null;

/** Retour en retard : sorti et date de retour prevue depassee. */
export const isOverdue = (l: { status: string; planned_end: string }, now = new Date()) =>
  l.status === 'sorti' && new Date(l.planned_end).getTime() < now.getTime();

/** Etat d'une moto de pret sur une journee : libre, reservee, sortie (vue « Disponibilite »). */
export function loanerDayState<T extends LoanPeriod>(loans: T[], loanerId: string, dayStart: Date): { state: 'libre' | 'reserve' | 'sorti'; loan: T | null } {
  const s = dayStart.getTime(); const e = s + 24 * 3600 * 1000;
  const hit = loans.filter((l) => l.loaner_id === loanerId && isActiveLoan(l)
    && new Date(l.planned_start).getTime() < e && new Date(l.planned_end).getTime() > s);
  const out = hit.find((l) => l.status === 'sorti');
  if (out) return { state: 'sorti', loan: out };
  if (hit[0]) return { state: 'reserve', loan: hit[0] };
  return { state: 'libre', loan: null };
}
