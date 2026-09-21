/**
 * M8 — Plans d'entretien (mission 07, carte 1, ATE014) : règles pures, testées dans
 * tests/maintenance-plans.test.ts.
 *
 * Décisions M-16 (Simon, 21/09) :
 *  - échéance au PREMIER ATTEINT (km ou mois) ;
 *  - le document le plus récent fait foi : la valeur à utiliser est « en vigueur »,
 *    les anciennes restent en « historique » ;
 *  - prix main-d'œuvre = heures × taux horaire atelier HT (null tant que le taux n'est pas saisi).
 */

export type MaintenanceUsage = 'route' | 'piste_amateur' | 'racing';
export const MAINTENANCE_USAGES: MaintenanceUsage[] = ['route', 'piste_amateur', 'racing'];
export const DEFAULT_USAGE: MaintenanceUsage = 'route';

export type ValueStatus = 'en_vigueur' | 'historique';

/** Ligne versionnée (intervalle ou temps) : statut, ordre chronologique de la source, années citées. */
export type Versioned = {
  status: string;
  source_sort?: string | null;
  years_doc?: string | null;
  sort?: number | null;
};

/**
 * Années citées par un document (« 17-21 », « MY 17 », « MY10-14 », « 2019→2021 ») →
 * millésimes sur 4 chiffres. null si illisible.
 */
export function parseYearsDoc(s: string | null | undefined): { from: number; to: number } | null {
  if (!s) return null;
  const nums = String(s).match(/\d{2,4}/g);
  if (!nums || !nums.length) return null;
  const y = (n: string) => (n.length === 4 ? Number(n) : 2000 + Number(n));
  const from = y(nums[0]);
  const to = nums.length > 1 ? y(nums[1]) : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Valeur à utiliser parmi plusieurs versions : seulement les lignes « en vigueur » ;
 * si un millésime est donné, celles dont les années citées le couvrent passent devant ;
 * puis la source la plus récente (source_sort), puis l'ordre du document.
 * Renvoie null s'il n'y a aucune valeur en vigueur (les valeurs historiques ne sont jamais choisies).
 */
export function pickCurrent<T extends Versioned>(rows: T[] | null | undefined, year?: number | null): T | null {
  const current = (rows ?? []).filter((r) => r.status === 'en_vigueur');
  if (!current.length) return null;
  const covers = (r: T) => {
    if (year == null) return 0;
    const p = parseYearsDoc(r.years_doc);
    return p && year >= p.from && year <= p.to ? 1 : 0;
  };
  return [...current].sort((a, b) =>
    covers(b) - covers(a)
    || String(b.source_sort ?? '').localeCompare(String(a.source_sort ?? ''))
    || (a.sort ?? 0) - (b.sort ?? 0),
  )[0];
}

/** Prix main-d'œuvre HT = heures × taux horaire HT ; null si le taux (ou le temps) manque. */
export function labourPriceHt(hours: number | null | undefined, hourlyRateHt: number | null | undefined): number | null {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  if (hourlyRateHt == null || !Number.isFinite(Number(hourlyRateHt)) || Number(hourlyRateHt) <= 0) return null;
  return Math.round(Number(hours) * Number(hourlyRateHt) * 100) / 100;
}

/** Taux horaire des frais de devis (0 = non renseigné) → taux utilisable ou null. */
export function effectiveHourlyRate(rate: number | null | undefined): number | null {
  return rate != null && Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null;
}

export type ServiceInterval = { km_first?: number | null; km_interval?: number | null; months?: number | null };

export type NextDue = {
  dueKm: number | null;        // kilométrage de l'échéance
  dueDate: string | null;      // date limite (AAAA-MM-JJ)
  reached: boolean;            // l'échéance est atteinte (km OU date)
  reachedBy: 'km' | 'mois' | null;
  /** Ce qui arrivera en premier : 'km' si le rythme de roulage fait atteindre le km avant la date. */
  firstTrigger: 'km' | 'mois' | null;
  /** Date estimée d'atteinte du km au rythme actuel (null si rythme inconnu). */
  kmReachedOn: string | null;
};

const DAY = 86_400_000;
const toDate = (s: string | Date) => (s instanceof Date ? new Date(s.getTime()) : new Date(`${String(s).slice(0, 10)}T00:00:00Z`));
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(d: Date, m: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return r;
}

/**
 * Prochaine échéance d'un intervalle, au PREMIER ATTEINT (km ou mois).
 *  - `last` : dernier entretien de ce type (km, date) ; sans lui, on part de la mise en service
 *    (`start` : date, 0 km) et du km du premier entretien (km_first) s'il existe ;
 *  - `now`  : km et date du jour.
 * Échéance kilométrique = dernier km + intervalle (ou km_first au premier entretien) ;
 * échéance calendaire = date de départ + mois. Atteinte dès que l'une des deux l'est.
 */
export function nextDue(
  interval: ServiceInterval,
  now: { km: number | null; date: string | Date },
  last?: { km: number | null; date: string | null } | null,
  start?: { date: string | null } | null,
): NextDue {
  const hasLast = !!(last && (last.km != null || last.date));
  const baseKm = hasLast ? (last!.km ?? null) : 0;
  const stepKm = hasLast ? (interval.km_interval ?? null) : (interval.km_first ?? interval.km_interval ?? null);
  const dueKm = stepKm != null && baseKm != null ? baseKm + stepKm : null;
  const baseDate = hasLast ? last!.date : start?.date ?? null;
  const dueDate = interval.months && baseDate ? iso(addMonths(toDate(baseDate), interval.months)) : null;

  const today = toDate(now.date);
  const kmReached = dueKm != null && now.km != null && now.km >= dueKm;
  const dateReached = dueDate != null && today.getTime() >= toDate(dueDate).getTime();

  // Rythme de roulage (km/jour) depuis le point de départ, pour savoir ce qui arrivera d'abord.
  let kmReachedOn: string | null = null;
  if (dueKm != null && now.km != null && baseKm != null && baseDate && !kmReached) {
    const days = (today.getTime() - toDate(baseDate).getTime()) / DAY;
    const perDay = days > 0 ? (now.km - baseKm) / days : 0;
    if (perDay > 0) kmReachedOn = iso(new Date(today.getTime() + Math.ceil((dueKm - now.km) / perDay) * DAY));
  }
  let firstTrigger: NextDue['firstTrigger'] = null;
  if (dueKm != null && dueDate == null) firstTrigger = 'km';
  else if (dueDate != null && dueKm == null) firstTrigger = 'mois';
  else if (dueKm != null && dueDate != null) {
    if (kmReached && !dateReached) firstTrigger = 'km';
    else if (dateReached && !kmReached) firstTrigger = 'mois';
    else if (kmReachedOn) firstTrigger = kmReachedOn < dueDate ? 'km' : 'mois';
    else firstTrigger = 'mois';
  }

  return {
    dueKm, dueDate,
    reached: kmReached || dateReached,
    reachedBy: kmReached ? 'km' : dateReached ? 'mois' : null,
    firstTrigger, kmReachedOn,
  };
}

/** Plan à afficher pour une moto : celui de l'usage choisi (route par défaut). */
export function planForUsage<T extends { usage: string }>(plans: T[], usage: string | null | undefined): T | null {
  const u = usage && (MAINTENANCE_USAGES as string[]).includes(usage) ? usage : DEFAULT_USAGE;
  return plans.find((p) => p.usage === u) ?? null;
}

/** « 15 000 km », « 24 mois », « 1 000 km » (fr-BE, espaces insécables). */
export function fmtKm(n: number | null | undefined): string {
  return n == null ? '' : `${new Intl.NumberFormat('fr-BE').format(n)} km`;
}
