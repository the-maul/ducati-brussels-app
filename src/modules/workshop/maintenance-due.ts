/**
 * M8 — « Prochain entretien de chaque moto » (mission 07, cartes 4, 6 et 7).
 * RÈGLES PURES : aucun accès base, aucun React. Testées dans tests/maintenance-due.test.ts.
 *
 * Ce module est le MIROIR des vues SQL `maintenance_vehicle_due` /
 * `maintenance_vehicle_next` (migration 20261005110000). Les écrans lisent la
 * base (une seule vérité) ; ces fonctions tiennent la règle, servent aux tests
 * et au calcul à la volée quand on simule un kilométrage saisi à l'écran.
 *
 * Décisions :
 *  - **M-16** : échéance au PREMIER ATTEINT (km ou mois), partout.
 *  - **M-20** : l'entretien dépend de l'usage (route / piste amateur / racing).
 *  - **M-33** : 1 UT = 6 minutes (barème Ducati).
 *  - Main-d'œuvre = heures × taux horaire atelier HT (90 € HT, M-20).
 *
 * DEUX NIVEAUX DE CERTITUDE, et c'est tout l'enjeu de la carte 5 :
 *  - `exact`  : le dernier entretien de cette famille est connu → compte exact,
 *               une échéance dépassée est un VRAI retard ;
 *  - `estime` : il est inconnu → on annonce la PROCHAINE occurrence après le
 *               compteur et après aujourd'hui, et on ne crie jamais au retard.
 *               On ne prétend pas qu'une moto de 2007 à 24 538 km doit encore
 *               son Oil Service des 15 000 km.
 */
import { MINUTES_PER_UT } from './journey/rules';

export type DueConfidence = 'exact' | 'estime';

/** Une échéance du programme d'entretien d'une moto. */
export type ProgramService = {
  code: string;
  label: string;
  family: string;
  /** Jalon kilométrique absolu au compteur (grille reconstruite, M-30) et non intervalle. */
  isGrid: boolean;
  /** Premier entretien (1 000 km) : il ne se répète pas. */
  isFirst: boolean;
  /** Intervalle en km (ou, pour un jalon, le kilométrage du jalon). */
  intervalKm: number | null;
  /** Intervalle en mois. */
  intervalMonths: number | null;
  /** Temps officiel Ducati en unités de temps (1 UT = 6 min). */
  ut: number | null;
  sort?: number;
};

/** Dernier entretien connu de cette famille. */
export type LastService = { km: number | null; date: string | null };

export type DueNow = { km: number | null; date: string | Date };

export type DueResult = {
  service: ProgramService;
  confidence: DueConfidence;
  dueKm: number | null;
  dueDate: string | null;
  /** L'échéance est atteinte (km OU mois) — jamais vrai sur une estimation. */
  reached: boolean;
  reachedBy: 'km' | 'mois' | null;
  /** Ce qui arrivera en premier : km ou mois (M-16). */
  firstTrigger: 'km' | 'mois' | null;
  /** Date d'atteinte du km au rythme de roulage constaté ; null si rythme inconnu. */
  kmReachedOn: string | null;
  /** Rythme de roulage en km/jour, arrondi au centième ; null si inconnu. */
  kmPerDay: number | null;
  /** Jours restants ; 0 si l'échéance est atteinte ; null si rien n'est datable. */
  daysLeft: number | null;
  /** L'échéance n'est plus due (premier entretien fait, jalon dépassé). */
  settled: boolean;
};

const DAY = 86_400_000;

const toDate = (s: string | Date): Date =>
  s instanceof Date ? new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    : new Date(`${String(s).slice(0, 10)}T00:00:00Z`);

const iso = (d: Date) => d.toISOString().slice(0, 10);

function addMonths(d: Date, m: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), last));
  return r;
}

/** Mois entiers écoulés entre deux dates (comme `age()` de PostgreSQL). */
function monthsBetween(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(m, 0);
}

const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);

/**
 * Prochaine échéance d'UNE ligne du programme, au premier atteint.
 *
 * @param service  l'échéance du programme (intervalle ou jalon)
 * @param now      kilométrage et date du jour
 * @param last     dernier entretien connu de cette famille, s'il y en a un
 * @param start    mise en service (sert aux échéances en mois sans historique)
 */
export function dueForService(
  service: ProgramService,
  now: DueNow,
  last?: LastService | null,
  start?: { date: string | null } | null,
): DueResult {
  const today = toDate(now.date);
  const km = now.km != null && Number.isFinite(now.km) ? now.km : null;
  const hasLast = !!(last && (last.km != null || last.date));
  const confidence: DueConfidence = hasLast ? 'exact' : 'estime';

  const baseKm = hasLast ? (last!.km ?? null) : 0;
  const baseDate = hasLast ? (last!.date ?? null) : (start?.date ?? null);
  const step = service.intervalKm != null && service.intervalKm > 0 ? service.intervalKm : null;

  // --- l'échéance est-elle encore due ? -------------------------------------
  // Un jalon kilométrique déjà fait, ou dépassé au compteur sans historique,
  // est réputé fait. Idem pour le premier entretien.
  const settled =
    (service.isGrid && hasLast)
    || (service.isGrid && !hasLast && km != null && step != null && km >= step)
    || (service.isFirst && hasLast)
    || (service.isFirst && !hasLast && km != null && step != null && km > step);

  // --- km dû ----------------------------------------------------------------
  let dueKm: number | null = null;
  if (service.isGrid) {
    dueKm = step;                                   // jalon absolu au compteur
  } else if (step != null) {
    if (hasLast) dueKm = (baseKm ?? 0) + step;          // compte exact
    else if (service.isFirst) dueKm = step;             // une seule fois, à son jalon
    else if (km == null || km <= 0) dueKm = step;       // depuis 0 km
    else dueKm = (Math.floor(km / step) + 1) * step;    // première occurrence au-dessus du compteur
  }

  // --- date due -------------------------------------------------------------
  let dueDate: string | null = null;
  const months = service.intervalMonths != null && service.intervalMonths > 0 ? service.intervalMonths : null;
  if (!service.isGrid && months != null && baseDate) {
    const base = toDate(baseDate);
    if (hasLast || service.isFirst) {
      // compte exact ; le premier entretien (1 000 km / 6 mois) n'arrive qu'une fois,
      // sa date ne se reporte donc jamais.
      dueDate = iso(addMonths(base, months));
    } else {
      // première occurrence depuis la mise en service qui dépasse aujourd'hui
      const n = Math.floor(monthsBetween(base, today) / months) + 1;
      dueDate = iso(addMonths(base, months * n));
    }
  }

  // --- atteinte -------------------------------------------------------------
  const kmReached = dueKm != null && km != null && km >= dueKm;
  const dateReached = dueDate != null && today.getTime() >= toDate(dueDate).getTime();

  // --- rythme de roulage ----------------------------------------------------
  let kmPerDay: number | null = null;
  if (baseDate && km != null && baseKm != null) {
    const d = days(today, toDate(baseDate));
    if (d > 0 && km - baseKm > 0) kmPerDay = Math.round(((km - baseKm) / d) * 100) / 100;
  }
  let kmReachedOn: string | null = null;
  if (!kmReached && dueKm != null && km != null && kmPerDay != null && kmPerDay > 0) {
    kmReachedOn = iso(new Date(today.getTime() + Math.ceil((dueKm - km) / kmPerDay) * DAY));
  }

  // --- ce qui arrive en premier (M-16) --------------------------------------
  let firstTrigger: DueResult['firstTrigger'] = null;
  if (dueKm != null && dueDate == null) firstTrigger = 'km';
  else if (dueDate != null && dueKm == null) firstTrigger = 'mois';
  else if (dueKm != null && dueDate != null) {
    if (kmReached && !dateReached) firstTrigger = 'km';
    else if (dateReached && !kmReached) firstTrigger = 'mois';
    else if (kmReachedOn) firstTrigger = kmReachedOn < dueDate ? 'km' : 'mois';
    else firstTrigger = 'mois';
  }

  const reached = kmReached || dateReached;
  let daysLeft: number | null = null;
  if (reached) daysLeft = 0;
  else if (dueDate && kmReachedOn) daysLeft = Math.min(days(toDate(dueDate), today), days(toDate(kmReachedOn), today));
  else if (dueDate) daysLeft = days(toDate(dueDate), today);
  else if (kmReachedOn) daysLeft = days(toDate(kmReachedOn), today);

  return {
    service, confidence, dueKm, dueDate,
    reached, reachedBy: kmReached ? 'km' : dateReached ? 'mois' : null,
    firstTrigger, kmReachedOn, kmPerDay, daysLeft, settled,
  };
}

/**
 * Toutes les échéances dues d'une moto, la plus urgente d'abord :
 * atteintes en tête, puis par jours restants. Les échéances réputées faites
 * et celles qu'on ne sait ni chiffrer ni dater sortent.
 */
export function dueServices(
  program: ProgramService[],
  now: DueNow,
  last?: Record<string, LastService> | null,
  start?: { date: string | null } | null,
): DueResult[] {
  return program
    .map((s) => dueForService(s, now, last?.[s.family] ?? null, start))
    .filter((d) => !d.settled && (d.dueKm != null || d.dueDate != null))
    .sort((a, b) =>
      Number(b.reached) - Number(a.reached)
      || (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER)
      || (a.dueKm ?? Number.MAX_SAFE_INTEGER) - (b.dueKm ?? Number.MAX_SAFE_INTEGER)
      || (a.service.sort ?? 0) - (b.service.sort ?? 0));
}

/** L'entretien dû d'une moto : le plus urgent, ou null si rien n'est calculable. */
export function nextDueService(
  program: ProgramService[],
  now: DueNow,
  last?: Record<string, LastService> | null,
  start?: { date: string | null } | null,
): DueResult | null {
  return dueServices(program, now, last, start)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Devis estimé (carte 6)
// ---------------------------------------------------------------------------

/** Minutes d'atelier d'un temps officiel Ducati — M-33 : 1 UT = 6 minutes. */
export function utToMinutes(ut: number | null | undefined): number | null {
  return ut != null && Number.isFinite(Number(ut)) && Number(ut) > 0 ? Number(ut) * MINUTES_PER_UT : null;
}

/** Heures d'atelier, au centième. */
export function utToHours(ut: number | null | undefined): number | null {
  const m = utToMinutes(ut);
  return m == null ? null : Math.round((m / 60) * 100) / 100;
}

export type EstimatePart = {
  designation: string;
  quantity: number;
  unitPriceHt: number | null;
};

export type Estimate = {
  ut: number | null;
  minutes: number | null;
  hours: number | null;
  hourlyRateHt: number | null;
  labourHt: number | null;
  partsHt: number;
  partsWithoutPrice: number;
  totalHt: number;
  /** Vrai seulement si le temps ET tous les prix sont connus : sinon le total est partiel. */
  complete: boolean;
};

/**
 * Devis estimé d'un entretien : main-d'œuvre (temps officiel × taux horaire HT)
 * + pièces du kit. Une pièce sans prix compte pour 0 € et est signalée —
 * l'atelier voit ce qui manque au lieu d'un total faux.
 */
export function estimateService(
  ut: number | null | undefined,
  hourlyRateHt: number | null | undefined,
  parts: EstimatePart[] = [],
): Estimate {
  const minutes = utToMinutes(ut);
  const hours = utToHours(ut);
  const rate = hourlyRateHt != null && Number.isFinite(Number(hourlyRateHt)) && Number(hourlyRateHt) > 0
    ? Number(hourlyRateHt) : null;
  const labourHt = hours != null && rate != null ? Math.round(hours * rate * 100) / 100 : null;

  let partsHt = 0;
  let without = 0;
  for (const p of parts) {
    if (p.unitPriceHt == null || !Number.isFinite(Number(p.unitPriceHt))) { without++; continue; }
    partsHt += Math.round(Number(p.unitPriceHt) * Number(p.quantity) * 100) / 100;
  }
  partsHt = Math.round(partsHt * 100) / 100;

  return {
    ut: ut != null && Number(ut) > 0 ? Number(ut) : null,
    minutes, hours, hourlyRateHt: rate, labourHt,
    partsHt, partsWithoutPrice: without,
    totalHt: Math.round(((labourHt ?? 0) + partsHt) * 100) / 100,
    complete: labourHt != null && without === 0 && parts.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Libellés (i18n : les textes viennent du dictionnaire, ici seulement la forme)
// ---------------------------------------------------------------------------

/** « 15 000 km » en fr-BE. */
export function fmtKm(n: number | null | undefined): string {
  return n == null ? '' : `${new Intl.NumberFormat('fr-BE').format(n)} km`;
}

/** « 1 234,50 € » en fr-BE. */
export function fmtEur(n: number | null | undefined): string {
  return n == null ? '' : new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' }).format(n);
}

/** « 05/10/2026 ». */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : '';
}

/** « 1 h 42 » à partir d'un nombre de minutes. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return '';
  const m = Math.max(0, Math.round(Number(min)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${r} min`;
}

/** Degré d'urgence d'une échéance, pour la couleur du statut (charte §9). */
export type DueSeverity = 'retard' | 'imminent' | 'bientot' | 'calme';

export function dueSeverity(d: Pick<DueResult, 'reached' | 'confidence' | 'daysLeft'>): DueSeverity {
  if (d.reached && d.confidence === 'exact') return 'retard';
  if (d.daysLeft == null) return 'calme';
  if (d.daysLeft <= 30) return 'imminent';
  if (d.daysLeft <= 90) return 'bientot';
  return 'calme';
}
