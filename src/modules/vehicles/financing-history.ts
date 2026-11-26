/**
 * Historique des financements d'une moto (Simon, 26/11/2026, VEH001) : « on voit celle en cours et
 * on voit les anciennes ». Table vehicle_financings (migration 20261126180000) ; la ligne en cours
 * reflète vehicles.financing_contact_id / financing_contract, les autres sont les anciens financements
 * (factures G8 ou banque remplacée depuis la fiche moto). Règles pures, testées dans
 * tests/vehicle-financing-history.test.ts.
 */

export type FinancingRow = {
  id: string;
  financing_contact_id: string | null;
  contract: string | null;
  client_contact_id: string | null;
  source_invoice: string | null;
  started_on: string | null;
  ended_on: string | null;
  is_current: boolean;
  created_at: string;
};

export type FinancingStatus = 'current' | 'ended';

export const financingStatus = (r: Pick<FinancingRow, 'is_current'>): FinancingStatus => (r.is_current ? 'current' : 'ended');

/** Le plus récent d'abord : date de début, puis date de fin, puis date d'enregistrement ; sans date en dernier. */
export function byMostRecent<T extends Pick<FinancingRow, 'started_on' | 'ended_on' | 'created_at'>>(a: T, b: T): number {
  const ka = a.started_on ?? a.ended_on ?? '';
  const kb = b.started_on ?? b.ended_on ?? '';
  if (ka !== kb) {
    if (!ka) return 1;
    if (!kb) return -1;
    return ka < kb ? 1 : -1;
  }
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/** Sépare la ligne en cours (au plus une) des anciens financements, triés du plus récent au plus ancien. */
export function splitFinancings<T extends FinancingRow>(rows: T[]): { current: T | null; previous: T[] } {
  const currents = rows.filter((r) => r.is_current).sort(byMostRecent);
  const current = currents[0] ?? null;
  const previous = rows.filter((r) => r !== current).sort(byMostRecent);
  return { current, previous };
}

/** Fiche banque : financements en cours d'abord, puis terminés ; chacun du plus récent au plus ancien. */
export function orderBankFinancings<T extends FinancingRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.is_current === b.is_current ? byMostRecent(a, b) : a.is_current ? -1 : 1));
}

export type FinancingPeriod =
  | { kind: 'fromTo'; from: string; to: string }
  | { kind: 'from'; from: string }
  | { kind: 'until'; to: string }
  | { kind: 'none' };

/** Période affichée : un financement terminé sans date de fin connue garde seulement son début. */
export function financingPeriod(r: Pick<FinancingRow, 'started_on' | 'ended_on'>): FinancingPeriod {
  if (r.started_on && r.ended_on) return { kind: 'fromTo', from: r.started_on, to: r.ended_on };
  if (r.started_on) return { kind: 'from', from: r.started_on };
  if (r.ended_on) return { kind: 'until', to: r.ended_on };
  return { kind: 'none' };
}
