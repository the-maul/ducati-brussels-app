/**
 * M8 — Planning de charge (rattrapage G8 du 18/11/2026, ATE002, bloquant #7).
 * Regles pures, sans acces base : statuts du RDV alignes sur l'OR, jours feries belges,
 * capacite par jour et par compagnon (horaires - feries - fermetures - absences - pauses),
 * taux d'occupation, creneaux de la vue « Activite », RDV en attente, garde « temps prevu ».
 * Tests : tests/atelier-planning-g8.test.ts.
 */

// ---------------------------------------------------------------------------------------------
// Statuts du RDV (G8 « Categories et couleurs des RDV », alignes sur les statuts d'OR)
// ---------------------------------------------------------------------------------------------
export const APPOINTMENT_STATUSES = [
  'demande', 'prevu', 'arrive', 'en_cours', 'attente', 'termine', 'client_informe', 'facture', 'annule',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuts choisis a la main (« demande » n'existe que pour les demandes de l'espace client). */
export const SELECTABLE_STATUSES: AppointmentStatus[] = ['prevu', 'arrive', 'en_cours', 'attente', 'termine', 'client_informe', 'facture', 'annule'];

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
/**
 * Decision Q43 (18/11) : le planning distingue « deposee » (receptionne, moto la, en attente d'un
 * mecanicien : warning) et « en travail » (travaux commences : info) ; un RDV fixe a venir est
 * neutre. Toujours couleur + icone + libelle (status-icon.ts, libelles planningG8.status_*).
 */
export const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  demande: 'warning', prevu: 'neutral', arrive: 'warning', en_cours: 'info', attente: 'warning',
  termine: 'success', client_informe: 'success', facture: 'neutral', annule: 'neutral',
};

/** Phase visible au planning (decision Q43) : moto deposee / en travail / autre. */
export type WorkshopPhase = 'deposee' | 'en_travail' | null;
export function appointmentPhase(status: string): WorkshopPhase {
  if (status === 'arrive' || status === 'attente') return 'deposee';
  if (status === 'en_cours') return 'en_travail';
  return null;
}

/** Decision Q43 (18/11, comme G8) : l'OR cree depuis le RDV nait « a faire », le RDV passe « receptionne ». */
export const OR_STATUS_FROM_APPOINTMENT = 'a_faire';
export const APPOINTMENT_STATUS_WITH_OR: AppointmentStatus = 'arrive';

/**
 * Decision Q42 (18/11) : avant d'ouvrir l'OR depuis le RDV. Moto connue sans km → 'mileage' (le km
 * est exige, au plus tard a la creation de l'OR) ; pas de moto (moto a creer) → 'vehicle' (on
 * propose de la choisir, l'OR peut s'ouvrir sans) ; sinon 'none'.
 */
export function orIntakeNeeds(a: { vehicle_id: string | null; mileage: number | null | undefined }): 'none' | 'vehicle' | 'mileage' {
  if (!a.vehicle_id) return 'vehicle';
  return a.mileage == null ? 'mileage' : 'none';
}
export const statusTone = (s: string): StatusTone => STATUS_TONE[s as AppointmentStatus] ?? 'neutral';

/** Un RDV compte dans la charge tant qu'il n'est ni annule ni une simple demande ni en attente. */
export const countsInLoad = (a: { status: string; unassigned?: boolean | null }) =>
  a.status !== 'annule' && a.status !== 'demande' && !a.unassigned;

/**
 * Statut du RDV quand l'OR change de statut. Doublon exact de la fonction SQL
 * `workshop_appointment_status_for_or` (migration 20261118120000) : null = on ne touche pas.
 */
export function appointmentStatusForOr(orStatus: string | null | undefined): AppointmentStatus | null {
  const s = orStatus ?? '';
  if (s === 'a_faire') return 'arrive';
  if (s === 'en_cours') return 'en_cours';
  if (s.startsWith('attente')) return 'attente';
  if (s === 'pret') return 'termine';
  if (s === 'client_informe') return 'client_informe';
  if (s === 'facture') return 'facture';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Types de RDV : couleur metier (tokens --job-*, charte §2.4)
// ---------------------------------------------------------------------------------------------
export const JOB_COLORS = ['entretien', 'reparation', 'garantie', 'pneus', 'prepa', 'carrosserie'] as const;
export type JobColor = (typeof JOB_COLORS)[number];
export const isJobColor = (v: unknown): v is JobColor => typeof v === 'string' && (JOB_COLORS as readonly string[]).includes(v);

/**
 * Classes Tailwind (tokens) d'un bloc de RDV (decision Q47 du 18/11, comme les categories G8) : la
 * couleur du TYPE de RDV colore le FOND de la case (teinte a 20 % du token, lisible en clair et en
 * sombre : le texte reste la couleur de texte du theme) + bordure gauche pleine couleur (charte §5.6).
 * Palette FERMEE de tokens `--job-*` (tokens.css), jamais de hex libre ; le rouge Ducati en est exclu
 * (reserve a l'identite). Le statut reste un petit badge sur la case (couleur de statut + icone + libelle).
 */
export const JOB_BLOCK_CLASS: Record<JobColor, string> = {
  entretien: 'border-l-job-entretien bg-job-entretien/20',
  reparation: 'border-l-job-reparation bg-job-reparation/20',
  garantie: 'border-l-job-garantie bg-job-garantie/20',
  pneus: 'border-l-job-pneus bg-job-pneus/20',
  prepa: 'border-l-job-prepa bg-job-prepa/20',
  carrosserie: 'border-l-job-carrosserie bg-job-carrosserie/20',
};
/** Couleur par defaut (neutre) quand le type n'a pas de couleur ou n'est pas choisi. */
export const DEFAULT_BLOCK_CLASS = 'border-l-neutral-tag bg-neutral-bg';
/** Classe du bloc pour une couleur de type (valeur de Parametres → Tables) ; inconnue / vide = neutre. */
export const appointmentBlockClass = (color: unknown): string => (isJobColor(color) ? JOB_BLOCK_CLASS[color] : DEFAULT_BLOCK_CLASS);

export type AppointmentType = { code: string; label: string; color: JobColor | null; defaultMinutes: number | null };

/** Types par defaut quand la table de parametres est vide ou la migration absente. */
export const DEFAULT_APPOINTMENT_TYPES: AppointmentType[] = [
  { code: 'entretien', label: 'Entretien', color: 'entretien', defaultMinutes: 120 },
  { code: 'reparation', label: 'Réparation / diagnostic', color: 'reparation', defaultMinutes: 60 },
  { code: 'garantie', label: 'Garantie / rappel constructeur', color: 'garantie', defaultMinutes: 60 },
  { code: 'pneus', label: 'Pneus', color: 'pneus', defaultMinutes: 60 },
  { code: 'preparation', label: 'Préparation / livraison moto', color: 'prepa', defaultMinutes: 90 },
  { code: 'carrosserie', label: 'Carrosserie / accessoires', color: 'carrosserie', defaultMinutes: 60 },
];

// ---------------------------------------------------------------------------------------------
// Dates locales (le planning raisonne en jours calendaires de Bruxelles, heure du poste)
// ---------------------------------------------------------------------------------------------
export const pad2 = (n: number) => String(n).padStart(2, '0');
/** AAAA-MM-JJ en heure locale (et non UTC, qui decale d'un jour apres 23 h / avant 1 h). */
export const localYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** Jour ISO : 1 = lundi ... 7 = dimanche. */
export const isoWeekday = (d: Date) => ((d.getDay() + 6) % 7) + 1;
/** « HH:MM[:SS] » → minutes depuis minuit ; null si vide ou invalide. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}
export const minutesToTime = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
/** Minutes depuis minuit (locales) d'un instant. */
export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
/** Date locale + minutes depuis minuit → instant. */
export function atMinutes(day: Date, minutes: number): Date {
  const x = startOfDay(day); x.setMinutes(minutes); return x;
}

/** Premier jour de la semaine affichee (reglage « 1er jour », 2 = mardi chez G8) contenant `ref`. */
export function weekStartFor(ref: Date, firstWeekday: number): Date {
  const d = startOfDay(ref);
  const diff = (isoWeekday(d) - firstWeekday + 7) % 7;
  return addDays(d, -diff);
}
export function weekDays(start: Date, daysShown: number): Date[] {
  return Array.from({ length: Math.min(Math.max(daysShown, 1), 7) }, (_, i) => addDays(start, i));
}

// ---------------------------------------------------------------------------------------------
// Jours feries legaux belges (10 jours) — G8 « jours feries belges activables »
// ---------------------------------------------------------------------------------------------
/** Dimanche de Paques (calendrier gregorien, algorithme anonyme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export type HolidayKey =
  | 'new_year' | 'easter_monday' | 'labour_day' | 'ascension' | 'whit_monday'
  | 'national_day' | 'assumption' | 'all_saints' | 'armistice' | 'christmas';

export function belgianHolidays(year: number): { date: string; key: HolidayKey }[] {
  const easter = easterSunday(year);
  const fixed = (m: number, d: number) => localYmd(new Date(year, m - 1, d));
  return [
    { date: fixed(1, 1), key: 'new_year' as const },
    { date: localYmd(addDays(easter, 1)), key: 'easter_monday' as const },
    { date: fixed(5, 1), key: 'labour_day' as const },
    { date: localYmd(addDays(easter, 39)), key: 'ascension' as const },
    { date: localYmd(addDays(easter, 50)), key: 'whit_monday' as const },
    { date: fixed(7, 21), key: 'national_day' as const },
    { date: fixed(8, 15), key: 'assumption' as const },
    { date: fixed(11, 1), key: 'all_saints' as const },
    { date: fixed(11, 11), key: 'armistice' as const },
    { date: fixed(12, 25), key: 'christmas' as const },
  ].sort((x, y) => x.date.localeCompare(y.date));
}
export function belgianHolidayOn(d: Date): HolidayKey | null {
  const key = localYmd(d);
  return belgianHolidays(d.getFullYear()).find((h) => h.date === key)?.key ?? null;
}

// ---------------------------------------------------------------------------------------------
// Capacite (G8 « charge disponible geree par les compagnons »)
// ---------------------------------------------------------------------------------------------
export type MechanicHours = { mechanic_id: string; weekday: number; am_start: string | null; am_end: string | null; pm_start: string | null; pm_end: string | null };
export type CalendarBlock = { id?: string; kind: 'ferie' | 'fermeture' | 'absence' | 'pause'; mechanic_id: string | null; starts_at: string; ends_at: string; label?: string | null };
export type PlanningMechanic = { id: string; name: string; visible_in_planning: boolean; is_active: boolean; sort_order: number; user_id: string | null; workshop?: string | null;
  /** VP9 (comme G8) : compte dans la charge atelier ; absent tant que la migration 20261120346000 n'est pas en base (= compte). */
  counts_in_load?: boolean | null };
export type Interval = [number, number]; // minutes depuis minuit [debut, fin)

/** Plages de travail d'un compagnon un jour donne (matin + apres-midi). */
export function workIntervals(hours: MechanicHours[], mechanicId: string, weekday: number): Interval[] {
  const h = hours.find((x) => x.mechanic_id === mechanicId && x.weekday === weekday);
  if (!h) return [];
  const out: Interval[] = [];
  const am: Interval = [timeToMinutes(h.am_start) ?? -1, timeToMinutes(h.am_end) ?? -1];
  const pm: Interval = [timeToMinutes(h.pm_start) ?? -1, timeToMinutes(h.pm_end) ?? -1];
  if (am[0] >= 0 && am[1] > am[0]) out.push(am);
  if (pm[0] >= 0 && pm[1] > pm[0]) out.push(pm);
  return out;
}
export const intervalsMinutes = (iv: Interval[]) => iv.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);

/** Total quotidien et hebdomadaire d'un compagnon (G8 « Table des compagnons »). */
export function weeklyMinutes(hours: MechanicHours[], mechanicId: string): { perDay: Record<number, number>; total: number } {
  const perDay: Record<number, number> = {};
  let total = 0;
  for (let wd = 1; wd <= 7; wd++) { const m = intervalsMinutes(workIntervals(hours, mechanicId, wd)); perDay[wd] = m; total += m; }
  return { perDay, total };
}

/** Retire de `iv` la partie [a, b). */
export function subtractInterval(iv: Interval[], [a, b]: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [s, e] of iv) {
    if (b <= s || a >= e) { out.push([s, e]); continue; }
    if (a > s) out.push([s, a]);
    if (b < e) out.push([b, e]);
  }
  return out;
}

/** Partie d'un blocage qui tombe sur le jour `day`, en minutes locales ; null s'il ne le touche pas. */
export function blockOnDay(b: CalendarBlock, day: Date): Interval | null {
  const d0 = startOfDay(day).getTime(); const d1 = addDays(startOfDay(day), 1).getTime();
  const s = new Date(b.starts_at).getTime(); const e = new Date(b.ends_at).getTime();
  if (e <= d0 || s >= d1) return null;
  const a = s <= d0 ? 0 : Math.round((s - d0) / 60000);
  const z = e >= d1 ? 24 * 60 : Math.round((e - d0) / 60000);
  return z > a ? [a, z] : null;
}

export type DayContext = { hours: MechanicHours[]; blocks: CalendarBlock[]; belgianHolidays: boolean };

/** Raison d'une journee fermee pour tout l'atelier (ferie legal, ferie ou fermeture saisis toute la journee). */
export function closedDayReason(day: Date, ctx: DayContext): { kind: 'ferie' | 'fermeture'; label: string | null; holiday: HolidayKey | null } | null {
  if (ctx.belgianHolidays) {
    const h = belgianHolidayOn(day);
    if (h) return { kind: 'ferie', label: null, holiday: h };
  }
  for (const b of ctx.blocks) {
    if (b.mechanic_id || (b.kind !== 'ferie' && b.kind !== 'fermeture')) continue;
    const iv = blockOnDay(b, day);
    if (iv && iv[0] === 0 && iv[1] === 24 * 60) return { kind: b.kind, label: b.label ?? null, holiday: null };
  }
  return null;
}

/** Plages disponibles d'un compagnon un jour : horaires - ferie - fermetures/pauses atelier - ses absences/pauses. */
export function availableIntervals(mechanicId: string, day: Date, ctx: DayContext): Interval[] {
  if (closedDayReason(day, ctx)) return [];
  let iv = workIntervals(ctx.hours, mechanicId, isoWeekday(day));
  for (const b of ctx.blocks) {
    if (b.mechanic_id && b.mechanic_id !== mechanicId) continue;
    const cut = blockOnDay(b, day);
    if (cut) iv = subtractInterval(iv, cut);
  }
  return iv;
}

export const mechanicDayCapacity = (mechanicId: string, day: Date, ctx: DayContext) => intervalsMinutes(availableIntervals(mechanicId, day, ctx));

/** Compagnons qui portent la charge du planning : actifs et visibles. */
export const planningMechanics = (ms: PlanningMechanic[]) =>
  ms.filter((m) => m.is_active && m.visible_in_planning).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

export type LoadAppointment = { id: string; starts_at: string; planned_minutes: number | null; status: string; unassigned?: boolean | null; mechanic_id?: string | null };

/** Temps prevu d'un RDV pour la charge (sans temps saisi : une case de la granularite). */
export const plannedOrSlot = (a: { planned_minutes: number | null }, slotMinutes: number) =>
  a.planned_minutes && a.planned_minutes > 0 ? a.planned_minutes : slotMinutes;

export type DayLoad = { capacity: number; planned: number; pct: number | null; closed: ReturnType<typeof closedDayReason> };

/** VP9 (comme G8) : seuls les compagnons comptent dans la charge atelier (case par personne). */
export const countsInWorkshopLoad = (m: Pick<PlanningMechanic, 'counts_in_load'>) => m.counts_in_load !== false;

/**
 * Charge d'un jour : capacite des compagnons, temps prevu des RDV, taux d'occupation (G8 « 2h/24h, 8,33 % »).
 * Toute l'equipe : seuls les compagnons qui comptent dans la charge (VP9), et les RDV qui leur sont
 * confies ou sans compagnon. Filtre sur une personne : sa charge propre, qu'elle compte ou non.
 */
export function dayLoad(day: Date, mechanics: PlanningMechanic[], appts: LoadAppointment[], ctx: DayContext, slotMinutes: number, mechanicId?: string | null): DayLoad {
  const key = localYmd(day);
  const ms = planningMechanics(mechanics).filter((m) => (mechanicId ? m.id === mechanicId : countsInWorkshopLoad(m)));
  const excluded = new Set(mechanics.filter((m) => !countsInWorkshopLoad(m)).map((m) => m.id));
  const capacity = ms.reduce((s, m) => s + mechanicDayCapacity(m.id, day, ctx), 0);
  const planned = appts
    .filter((a) => countsInLoad(a) && localYmd(new Date(a.starts_at)) === key
      && (mechanicId ? a.mechanic_id === mechanicId : !(a.mechanic_id && excluded.has(a.mechanic_id))))
    .reduce((s, a) => s + plannedOrSlot(a, slotMinutes), 0);
  return { capacity, planned, pct: occupancyPct(planned, capacity), closed: closedDayReason(day, ctx) };
}

/** Taux d'occupation arrondi a 2 decimales ; null sans capacite. */
export function occupancyPct(planned: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.round((planned / capacity) * 10000) / 100;
}
export type LoadTone = 'success' | 'warning' | 'danger' | 'neutral';
export const occupancyTone = (pct: number | null): LoadTone => (pct === null ? 'neutral' : pct > 100 ? 'danger' : pct >= 85 ? 'warning' : 'success');

/** « 2h », « 1h30 », « 45 min ». */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60); const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h}h${pad2(r)}` : `${h}h`;
}

// ---------------------------------------------------------------------------------------------
// Vue « Activite » : creneaux, disponibilite d'une case, chevauchement
// ---------------------------------------------------------------------------------------------
export function slotsOfDay(dayStart: string, dayEnd: string, slotMinutes: number): number[] {
  const a = timeToMinutes(dayStart) ?? 9 * 60; const b = timeToMinutes(dayEnd) ?? 18 * 60;
  const step = Math.max(5, slotMinutes);
  const out: number[] = [];
  for (let m = a; m < b; m += step) out.push(m);
  return out;
}
/** Arrondit a la granularite (glisser-deposer). */
export const snapMinutes = (m: number, slot: number) => Math.round(m / Math.max(1, slot)) * Math.max(1, slot);

export const isFree = (iv: Interval[], start: number, end: number) => iv.some(([a, b]) => start >= a && end <= b);

export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

/** RDV du meme compagnon qui chevauche le creneau (reglage « bloquer les RDV simultanes »). */
export function findOverlap(
  appts: LoadAppointment[], mechanicId: string, startsAt: Date, minutes: number, slotMinutes: number, ignoreId?: string,
): LoadAppointment | null {
  const s = startsAt.getTime(); const e = s + Math.max(1, minutes) * 60000;
  return appts.find((x) => x.id !== ignoreId && x.mechanic_id === mechanicId && countsInLoad(x)
    && overlaps({ start: s, end: e }, { start: new Date(x.starts_at).getTime(), end: new Date(x.starts_at).getTime() + plannedOrSlot(x, slotMinutes) * 60000 })) ?? null;
}

export type DropCheck = { ok: true } | { ok: false; reason: 'unavailable' | 'overlap' | 'no_time' };

/**
 * Glisser un RDV sur un compagnon / un creneau : refuse sur un ferie, une fermeture, une absence,
 * une pause ou hors horaires ; refuse un chevauchement si le reglage le bloque (charte §5.6 :
 * conflit = contour danger + refus).
 */
export function checkDrop(p: {
  mechanicId: string; day: Date; startMinutes: number; minutes: number | null; ctx: DayContext;
  appts: LoadAppointment[]; slotMinutes: number; blockOverlaps: boolean; appointmentId?: string;
}): DropCheck {
  const len = p.minutes && p.minutes > 0 ? p.minutes : p.slotMinutes;
  const iv = availableIntervals(p.mechanicId, p.day, p.ctx);
  if (!isFree(iv, p.startMinutes, p.startMinutes + len)) return { ok: false, reason: 'unavailable' };
  if (p.blockOverlaps && findOverlap(p.appts, p.mechanicId, atMinutes(p.day, p.startMinutes), len, p.slotMinutes, p.appointmentId)) {
    return { ok: false, reason: 'overlap' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// RDV en attente, tri de la vue reception, garde « temps prevu » avant l'OR
// ---------------------------------------------------------------------------------------------
export type WaitingCandidate = { status: string; unassigned?: boolean | null; source?: string | null; or_id?: string | null };
/** Liste d'attente : RDV « sans affectation » + demandes de l'espace client a placer. */
export const isWaiting = (a: WaitingCandidate) =>
  a.status !== 'annule' && a.status !== 'facture' && !a.or_id && (!!a.unassigned || a.status === 'demande');

/** Semainier G8 : 1er tri heure de RDV, 2e tri avancement. */
export function receptionSort<T extends { starts_at: string; status: string }>(rows: T[]): T[] {
  const rank = (s: string) => { const i = (APPOINTMENT_STATUSES as readonly string[]).indexOf(s); return i < 0 ? 99 : i; };
  return [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || rank(a.status) - rank(b.status));
}

/** G8 : « Veuillez saisir le temps prevu » avant « Valider RDV et saisie OR ». */
export const canCreateOr = (a: { planned_minutes: number | null; or_id?: string | null; status: string }) =>
  !a.or_id && a.status !== 'annule' && !!a.planned_minutes && a.planned_minutes > 0;

/** Temps prevu saisi en heures + minutes (G8 j / h / mn) → minutes ; null si vide ou nul. */
export function plannedMinutesFrom(hours: string, minutes: string): number | null {
  const n = (s: string) => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : 0; };
  const total = Math.round(n(hours) * 60 + n(minutes));
  return total > 0 ? total : null;
}

/** Kilometrage saisi : entier >= 0 ; null si vide ; NaN si invalide. */
export function parseMileage(s: string): number | null {
  const t = String(s ?? '').replace(/[\s.]/g, '').trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isInteger(v) && v >= 0 ? v : Number.NaN;
}
