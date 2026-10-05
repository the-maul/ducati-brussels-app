/**
 * Filtres de l'onglet « Mes factures » du portail client.
 * Logique pure (pas de React) : elle est testée dans tests/portal-invoice-filters.test.ts.
 */
import type { PortalInvoiceSummary } from './api';

/** Valeur « pas de filtre » d'un <Select> (une valeur vide y est interdite). */
export const ALL = '__all__';
/** Factures au nom du client lui-même (ni fiche liée, ni organisme de financement). */
export const MINE = '__mine__';

/** Tranches de montant, de la plus petite à la plus grande. `max` est exclu. */
export const AMOUNTS: { key: string; min: number; max: number }[] = [
  { key: 'lt100', min: 0, max: 100 },
  { key: 'r100', min: 100, max: 500 },
  { key: 'r500', min: 500, max: 2000 },
  { key: 'gt2000', min: 2000, max: Infinity },
];

export type InvoiceFilters = { vehicle: string; profile: string; year: string; amount: string };

export const NO_FILTER: InvoiceFilters = { vehicle: ALL, profile: ALL, year: ALL, amount: ALL };

export const isFiltered = (f: InvoiceFilters) =>
  f.vehicle !== ALL || f.profile !== ALL || f.year !== ALL || f.amount !== ALL;

const year = (d: PortalInvoiceSummary) => (d.issue_date ?? '').slice(0, 4);

export function filterInvoices(list: PortalInvoiceSummary[], f: InvoiceFilters): PortalInvoiceSummary[] {
  return list.filter((d) => {
    if (f.vehicle !== ALL && d.vehicle_label !== f.vehicle) return false;
    if (f.profile === MINE && d.on_behalf) return false;
    if (f.profile !== ALL && f.profile !== MINE && d.on_behalf !== f.profile) return false;
    if (f.year !== ALL && year(d) !== f.year) return false;
    if (f.amount !== ALL) {
      const a = AMOUNTS.find((x) => x.key === f.amount);
      if (!a) return true;
      const n = Number(d.total_ttc);
      if (n < a.min || n >= a.max) return false;
    }
    return true;
  });
}

/**
 * Les choix proposés viennent des factures du client : jamais une option qui ne
 * donnerait aucun résultat, jamais un filtre où il n'y a rien à choisir.
 * `mineLabel` et `amountLabel` sont fournis par l'appelant (traductions).
 */
export function buildInvoiceFilterOptions(
  list: PortalInvoiceSummary[],
  mineLabel: string,
  amountLabel: (key: string) => string,
) {
  const uniq = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    vehicles: uniq(list.map((d) => d.vehicle_label)).map((v) => ({ value: v, label: v })),
    profiles: [
      ...(list.some((d) => !d.on_behalf) ? [{ value: MINE, label: mineLabel }] : []),
      ...uniq(list.map((d) => d.on_behalf)).map((v) => ({ value: v, label: v })),
    ],
    years: uniq(list.map((d) => year(d))).reverse().map((y) => ({ value: y, label: y })),
    amounts: AMOUNTS
      .filter((a) => list.some((d) => Number(d.total_ttc) >= a.min && Number(d.total_ttc) < a.max))
      .map((a) => ({ value: a.key, label: amountLabel(a.key) })),
  };
}
