/**
 * M8 — Parcours mecanicien, lot F (19/11/2026) : ecran tablette « Mon atelier ». Regles PURES
 * (sans base ni React), testees dans `tests/atelier-mon-atelier.test.ts`.
 *
 * L'ecran ne refait rien : il assemble les briques des lots A (pointage unique), B (pieces),
 * C (photos de reception), D (operations du plan, avancement x / y) et E (vues eclatees).
 * Ces regles disent :
 *  - qui est le mecanicien connecte (compte lie a un compagnon du planning, sinon son nom) ;
 *  - quelles motos il a aujourd'hui (RDV du jour qui lui sont attribues, OR ouverts a son nom ou
 *    sur lesquels il a un pointage ouvert / en pause) et les OR « a faire » non attribues ;
 *  - le geste unique par moto (Demarrer, Reprendre, Continuer, Creer l'OR) et ou il mene ;
 *  - l'etat de ses pieces (lot B) et de ses photos (lot C) en un mot, couleur + icone + libelle ;
 *  - son pointage du moment (en cours / en pause / rien) pour le bandeau du haut ;
 *  - la page d'accueil apres connexion (reglage du compte, sinon d'apres le role).
 */
import { brusselsParts } from '../reservations/parts-flow';
import { orWorkState, workActions, type Me, type OrWorkState, type WorkEntry } from '../pointage/rules';
import { shouldPromptReception, type ReceptionStatus } from '../reception/rules';
import { canStartWork } from '../checkup/rules';
import { OR_WORKABLE_STATUSES } from '../or-base/rules';

export const MY_WORKSHOP_PATH = '/workshop/my-workshop' as const;
/** Relecture legere de l'ecran (entre 30 et 60 s, demande du lot). */
export const MY_WORKSHOP_REFRESH_MS = 45_000;
/** Pointages relus pour « Reprendre » : une pause « fin de journee » se reprend le lendemain matin. */
export const MY_ENTRIES_DAYS = 14;

// ---------------------------------------------------------------------------------------------
// Page d'accueil apres connexion
// ---------------------------------------------------------------------------------------------
export const HOME_PREFS = ['auto', 'dashboard', 'my_workshop'] as const;
export type HomePref = (typeof HOME_PREFS)[number];
export const isHomePref = (v: unknown): v is HomePref => typeof v === 'string' && (HOME_PREFS as readonly string[]).includes(v);

/** Roles de l'atelier qui arrivent sur « Mon atelier » quand le compte n'a rien choisi. */
export const WORKSHOP_HOME_ROLES = ['mecanicien', 'chef_atelier'] as const;

/**
 * Ou arrive le personnel apres connexion : le reglage du compte s'il en a un ; sinon
 * « Mon atelier » pour un mecanicien ou un chef d'atelier (pas pour un administrateur, qui garde
 * le tableau de bord), le tableau de bord pour tous les autres.
 */
export function homeTarget(roles: readonly string[], pref: string | null | undefined): 'dashboard' | 'my_workshop' {
  if (pref === 'dashboard' || pref === 'my_workshop') return pref;
  if (roles.includes('admin')) return 'dashboard';
  return roles.some((r) => (WORKSHOP_HOME_ROLES as readonly string[]).includes(r)) ? 'my_workshop' : 'dashboard';
}

// ---------------------------------------------------------------------------------------------
// Qui suis-je ?
// ---------------------------------------------------------------------------------------------
/** Nom compare sans accents, casse ni espaces doubles (« Marco  Rossi » = « marco rossi »). */
export function normName(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type MechanicLite = { id: string; name: string; user_id: string | null; is_active?: boolean | null };
export type MeIdentity = { userId: string | null; displayName: string; names: string[]; mechanicIds: string[] };

/**
 * Le mecanicien connecte : les compagnons du planning lies a son compte (`user_id`) ; a defaut,
 * le compagnon qui porte son nom (meme repli que le pointage du lot A). Les noms servent a
 * reconnaitre les OR dont l'operateur est saisi en texte.
 */
export function myIdentity(userId: string | null | undefined, profileName: string | null | undefined, mechanics: readonly MechanicLite[]): MeIdentity {
  const active = mechanics.filter((m) => m.is_active !== false);
  const linked = userId ? active.filter((m) => m.user_id === userId) : [];
  const pn = normName(profileName);
  const byName = linked.length ? [] : active.filter((m) => !m.user_id && pn && normName(m.name) === pn);
  const mine = linked.length ? linked : byName;
  const names = [...new Set([...mine.map((m) => normName(m.name)), pn].filter(Boolean))];
  return {
    userId: userId ?? null,
    displayName: mine[0]?.name || profileName?.trim() || '',
    names,
    mechanicIds: mine.map((m) => m.id),
  };
}

// ---------------------------------------------------------------------------------------------
// Mes motos du jour
// ---------------------------------------------------------------------------------------------
type ContactBits = { first_name: string | null; last_name: string | null; company_name: string | null; type?: string | null } | null;
type VehicleBits = { brand: string | null; model: string | null; plate: string | null; vin?: string | null; ducati_model_year_id?: string | null } | null;

export type DayAppointment = {
  id: string; starts_at: string; status: string; or_id: string | null;
  mechanic_id: string | null; mechanic_name: string | null; unassigned: boolean | null;
  planned_minutes: number | null; work_description: string | null; service_code?: string | null;
  contacts?: ContactBits; vehicles?: VehicleBits;
};

export type DayOr = {
  id: string; number: string | null; status: string; created_at: string;
  operator: string | null; operator_id?: string | null;
  work_description: string | null; customer_approval?: string | null; service_code?: string | null;
  contacts?: ContactBits; vehicles?: VehicleBits;
};

export type CardSection = 'mine' | 'unassigned';

export type DayCard = {
  key: string;
  section: CardSection;
  or: DayOr | null;
  appointment: DayAppointment | null;
  /** Mon etat de travail sur l'OR (lot A), depuis MES pointages. */
  work: OrWorkState | null;
};

export const isTodayBrussels = (iso: string | null | undefined, today: string) => !!iso && brusselsParts(new Date(iso)).date === today;

const HIDDEN_APPOINTMENT = new Set(['annule', 'demande', 'facture']);
const HIDDEN_OR = new Set(['facture', 'annule']);
const isWorkable = (s: string | null | undefined) => !!s && (OR_WORKABLE_STATUSES as readonly string[]).includes(s);

export function isMyAppointment(a: Pick<DayAppointment, 'mechanic_id' | 'mechanic_name' | 'unassigned'>, me: MeIdentity): boolean {
  if (a.unassigned) return false;
  if (a.mechanic_id && me.mechanicIds.includes(a.mechanic_id)) return true;
  // RDV ancien ou saisi sans compagnon : le nom (repli du lot A).
  return !a.mechanic_id && !!a.mechanic_name && me.names.includes(normName(a.mechanic_name));
}

export function isMyOr(o: Pick<DayOr, 'operator' | 'operator_id'>, me: MeIdentity): boolean {
  if (me.userId && o.operator_id === me.userId) return true;
  return !o.operator_id && !!o.operator && me.names.includes(normName(o.operator));
}

/** OR « a faire » que personne n'a pris (ni operateur, ni compagnon du RDV). */
export function isUnassignedOr(o: Pick<DayOr, 'status' | 'operator' | 'operator_id'>): boolean {
  return o.status === 'a_faire' && !o.operator_id && !String(o.operator ?? '').trim();
}

/**
 * Les cartes de l'ecran, dans l'ordre du travail :
 *  1. mes motos : RDV du jour a mon nom (avec ou sans OR), OR ouverts a mon nom, OR sur lesquels
 *     j'ai un pointage ouvert ou en pause (meme d'un autre jour : Reprendre) ;
 *  2. les OR « a faire » non attribues (n'importe quel mecanicien peut les prendre).
 * Un OR n'apparait qu'une fois ; un OR facture ou annule n'apparait jamais.
 */
export function buildDayCards(p: {
  me: MeIdentity; today: string; appointments: readonly DayAppointment[]; ors: readonly DayOr[]; myEntries: readonly WorkEntry[];
}): DayCard[] {
  const meRef: Me = { userId: p.me.userId, code: null };
  const orById = new Map(p.ors.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const cards: DayCard[] = [];
  const workOf = (orId: string) => orWorkState(p.myEntries as WorkEntry[], orId, meRef);

  for (const a of p.appointments) {
    if (HIDDEN_APPOINTMENT.has(a.status) || !isTodayBrussels(a.starts_at, p.today) || !isMyAppointment(a, p.me)) continue;
    const or = a.or_id ? orById.get(a.or_id) ?? null : null;
    if (a.or_id && !or) continue; // OR facture / annule (non relu) ou d'une autre societe
    if (or && HIDDEN_OR.has(or.status)) continue;
    if (or) { if (seen.has(or.id)) continue; seen.add(or.id); }
    cards.push({ key: or ? `or:${or.id}` : `rdv:${a.id}`, section: 'mine', or, appointment: a, work: or ? workOf(or.id) : null });
  }

  const apptByOr = new Map(p.appointments.filter((a) => a.or_id).map((a) => [a.or_id as string, a]));
  for (const o of p.ors) {
    if (seen.has(o.id) || HIDDEN_OR.has(o.status)) continue;
    const work = workOf(o.id);
    const pointed = !!work.mineOpen || !!work.mineLastPaused;
    if (!(pointed || (isWorkable(o.status) && isMyOr(o, p.me)))) continue;
    seen.add(o.id);
    cards.push({ key: `or:${o.id}`, section: 'mine', or: o, appointment: apptByOr.get(o.id) ?? null, work });
  }

  for (const o of p.ors) {
    if (seen.has(o.id) || !isUnassignedOr(o)) continue;
    const a = apptByOr.get(o.id) ?? null;
    if (a && !a.unassigned && (a.mechanic_id || a.mechanic_name)) continue; // RDV deja attribue a un autre
    seen.add(o.id);
    cards.push({ key: `or:${o.id}`, section: 'unassigned', or: o, appointment: a, work: workOf(o.id) });
  }
  return sortCards(cards);
}

/** Rang d'une carte : en cours, en pause, a faire / a l'heure du RDV, puis terminees (pret). */
export function cardRank(c: DayCard): number {
  if (c.work?.mineOpen) return 0;
  if (c.work?.mineLastPaused) return 1;
  if (c.or && !isWorkable(c.or.status)) return 3;
  return 2;
}

export function sortCards(cards: DayCard[]): DayCard[] {
  const when = (c: DayCard) => c.appointment?.starts_at ?? c.or?.created_at ?? '';
  return [...cards].sort((a, b) => (a.section === b.section ? 0 : a.section === 'mine' ? -1 : 1)
    || cardRank(a) - cardRank(b) || when(a).localeCompare(when(b)));
}

// ---------------------------------------------------------------------------------------------
// Un geste par moto
// ---------------------------------------------------------------------------------------------
/**
 *  - create_or : RDV du jour sans OR → ouvrir l'OR (meme fonction que le planning) puis Demarrer ;
 *  - start / resume : Demarrer ou Reprendre (photos si besoin → pointage → parcours) ;
 *  - continue : mon pointage tourne deja sur cet OR → retourner au parcours ;
 *  - blocked : accord du client en attente / refuse (meme garde-fou que l'OR) ;
 *  - none : moto terminee (pret, client informe) ou ecran en consultation.
 */
export type Gesture = 'create_or' | 'start' | 'resume' | 'continue' | 'blocked' | 'none';

export function cardGesture(c: Pick<DayCard, 'or' | 'appointment' | 'work'>, canWrite = true): Gesture {
  if (!canWrite) return 'none';
  if (!c.or) return c.appointment && !HIDDEN_APPOINTMENT.has(c.appointment.status) ? 'create_or' : 'none';
  if (c.work?.mineOpen) return 'continue';
  if (!isWorkable(c.or.status)) return 'none';
  if (!canStartWork(c.or)) return 'blocked';
  const a = workActions(c.work ?? orWorkState([], c.or.id, { userId: null }), { orStatus: c.or.status, workAllowed: true });
  if (a.resume) return 'resume';
  return a.start ? 'start' : 'none';
}

/** Les photos de reception (lot C) passent-elles avant le pointage ? Jamais pour Reprendre. */
export function needsReceptionFirst(g: Gesture, receptionStatus: ReceptionStatus | null | undefined, orStatus: string | null | undefined, receptionReady: boolean): boolean {
  if (!receptionReady || (g !== 'start' && g !== 'create_or')) return false;
  return shouldPromptReception(receptionStatus ?? 'none', orStatus ?? 'a_faire');
}

/**
 * Apres le pointage : le parcours guide de l'OR (lot D) quand l'OR a une liste d'operations ou un
 * entretien choisi, sinon la fiche OR. `op` = operation a rouvrir (Reprendre, Continuer).
 */
export function afterStartTarget(p: { planTotal: number; serviceCode: string | null | undefined; operation?: string | null }):
  { to: 'journey'; op: string | null } | { to: 'or' } {
  if (p.planTotal > 0 || !!p.serviceCode) return { to: 'journey', op: p.operation ?? null };
  return { to: 'or' };
}

// ---------------------------------------------------------------------------------------------
// Pieces (lot B) et photos (lot C) en un mot
// ---------------------------------------------------------------------------------------------
export type ReservationLite = { qty_needed: number | string | null; qty_reserved: number | string | null; qty_consumed?: number | string | null; status: string };
export type PartsState = 'none' | 'missing' | 'reserved' | 'prepared';
export type PartsSummary = { state: PartsState; total: number; missing: number };

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Pieces de la moto : manquantes des qu'une reservation active n'est pas couverte (le magasin
 * les commande, lot B) ; sinon reservees en stock ; « preparees » quand la picking list est
 * prete ou livree. Sans reservation ni picking list : rien a montrer.
 */
export function partsSummary(reservations: readonly ReservationLite[], pickingStatus: string | null | undefined): PartsSummary {
  const active = reservations.filter((r) => r.status === 'active');
  const missing = active.filter((r) => num(r.qty_needed) - num(r.qty_consumed) - num(r.qty_reserved) > 0.0005).length;
  const prepared = pickingStatus === 'pret' || pickingStatus === 'livre';
  if (missing) return { state: 'missing', total: active.length, missing };
  if (prepared) return { state: 'prepared', total: active.length, missing: 0 };
  return { state: active.length ? 'reserved' : 'none', total: active.length, missing: 0 };
}

export const partsTone = (s: PartsState): 'success' | 'warning' | 'info' | 'neutral' =>
  s === 'missing' ? 'warning' : s === 'prepared' ? 'success' : s === 'reserved' ? 'info' : 'neutral';

/** Etat des photos de reception : faites (succes), a faire / commencees / remises (a traiter). */
export type PhotosState = 'done' | 'incomplete' | 'later' | 'started' | 'todo';
export function photosState(status: ReceptionStatus | null | undefined, missing: number): PhotosState {
  if (status === 'complete') return missing > 0 ? 'incomplete' : 'done';
  if (status === 'plus_tard') return 'later';
  if (status === 'en_cours') return 'started';
  return 'todo';
}
export const photosTone = (s: PhotosState): 'success' | 'warning' | 'info' | 'neutral' =>
  s === 'done' ? 'success' : s === 'started' ? 'info' : s === 'todo' ? 'neutral' : 'warning';

// ---------------------------------------------------------------------------------------------
// Bandeau du haut : mon pointage du moment
// ---------------------------------------------------------------------------------------------
export type MyEntry = WorkEntry & { task_code?: string | null };
export type MyNow =
  | { kind: 'running'; entry: MyEntry }
  | { kind: 'paused'; entry: MyEntry }
  | { kind: 'idle' };

/**
 * Mon pointage du moment : un travail (OR) ou une tache improductive ouverts → en cours ; sinon
 * mon dernier travail clos en pause (Reprendre possible) → en pause ; sinon rien. `closedOrs` :
 * OR qui ne se pointent plus (prets, factures) : leur pause ne se reprend pas.
 */
export function myCurrentWork(entries: readonly MyEntry[], userId: string | null, closedOrs: ReadonlySet<string> = new Set()): MyNow {
  const me: Me = { userId, code: null };
  const mine = entries.filter((e) => !e.mechanic_code && !!userId && e.mechanic_id === userId);
  const open = mine.filter((e) => !e.ended_at && (e.kind === 'travail' || e.kind === 'improductif'))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  if (open[0]) return { kind: 'running', entry: open[0] };
  const last = mine.filter((e) => e.kind === 'travail' && e.ended_at && e.or_id)
    .sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? ''))[0];
  if (!last?.or_id || closedOrs.has(last.or_id)) return { kind: 'idle' };
  const s = orWorkState(mine as WorkEntry[], last.or_id, me);
  return s.mineLastPaused ? { kind: 'paused', entry: s.mineLastPaused as MyEntry } : { kind: 'idle' };
}
