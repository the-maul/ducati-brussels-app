/**
 * M13 — CA du tableau de bord (décision du client Q66, 20/11/2026, VEN012).
 * Chiffre principal : « CA HT » hors ventes pour le compte des déposants (dépôt-vente, type D) ;
 * en dessous : « CA HT y compris dépôt-vente ». Calculé en base par `dashboard_kpis`
 * (migration 20261120153000). Base sans la migration : les clés HT manquent, on retombe sur
 * l'ancien chiffre (CA TTC) avec son ancien libellé, sans ligne de détail.
 */

export type RevenuePeriod = 'today' | 'month';

/** Réponse brute de `dashboard_kpis` (clés facultatives : la migration peut manquer). */
export type RawRevenueKpis = Partial<Record<
  | 'revenue_today' | 'revenue_month'
  | 'revenue_ht_today' | 'revenue_ht_month'
  | 'revenue_ht_today_incl_consignment' | 'revenue_ht_month_incl_consignment',
  number | string | null
>>;

export type DashboardRevenue = {
  /** true : chiffres HT de Q66 ; false : ancien CA TTC (migration pas encore posée). */
  ht: boolean;
  /** Chiffre principal : CA HT hors dépôt-vente (ou ancien CA TTC). */
  main: number;
  /** CA HT y compris dépôt-vente ; null si la base ne le donne pas. */
  withConsignment: number | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function dashboardRevenue(raw: RawRevenueKpis | null | undefined, period: RevenuePeriod): DashboardRevenue {
  const r = raw ?? {};
  const ht = num(r[`revenue_ht_${period}`]);
  const incl = num(r[`revenue_ht_${period}_incl_consignment`]);
  if (ht === null) return { ht: false, main: num(r[`revenue_${period}`]) ?? 0, withConsignment: null };
  return { ht: true, main: ht, withConsignment: incl };
}
