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

export type MechanicLite = { id: string; name: string; user_id: string | null; is_active?: boolean | null; visible_in_planning?: boolean | null };
export type MeIdentity = { userId: string | null; displayName: string; names: string[]; mechanicIds: string[] };

/**
 * A qui appartiennent les motos montrees : moi (identite du compte), un compagnon du planning, ou
 * tout l'atelier (`all`). `userIds` = comptes relies (OR a leur nom par `operator_id`, pointages).
 */
export type WorkScope = { all?: boolean; userId?: string | null; userIds?: readonly string[]; names: readonly string[]; mechanicIds: readonly string[] };

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
  reason_code?: string | null; vehicle_id?: string | null;
  contacts?: ContactBits; vehicles?: VehicleBits;
};

export type DayOr = {
  id: string; number: string | null; status: string; created_at: string;
  operator: string | null; operator_id?: string | null;
  work_description: string | null; customer_approval?: string | null; service_code?: string | null;
  /** Motif d'entree (migration 20261031110000) et type de reparation : le motif de la carte. */
  reason_code?: string | null; repair_type?: string | null;
  vehicle_id?: string | null;
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
  /**
   * OR ouvert depuis plus de N jours sans pointage recent (reglage, 14 par defaut) : section repliee
   * « OR anciens a verifier » au lieu de « Mes motos du jour » / « OR a faire non attribues ».
   */
  stale?: boolean;
};

export const isTodayBrussels = (iso: string | null | undefined, today: string) => !!iso && brusselsParts(new Date(iso)).date === today;

const HIDDEN_APPOINTMENT = new Set(['annule', 'demande', 'facture']);
const HIDDEN_OR = new Set(['facture', 'annule']);
const isWorkable = (s: string | null | undefined) => !!s && (OR_WORKABLE_STATUSES as readonly string[]).includes(s);

export function isMyAppointment(a: Pick<DayAppointment, 'mechanic_id' | 'mechanic_name' | 'unassigned'>, me: WorkScope): boolean {
  if (a.unassigned) return false;
  if (me.all) return !!a.mechanic_id || !!String(a.mechanic_name ?? '').trim();
  if (a.mechanic_id && me.mechanicIds.includes(a.mechanic_id)) return true;
  // RDV ancien ou saisi sans compagnon : le nom (repli du lot A).
  return !a.mechanic_id && !!a.mechanic_name && me.names.includes(normName(a.mechanic_name));
}

const scopeUserIds = (w: WorkScope): string[] => [...(w.userIds ?? []), ...(w.userId ? [w.userId] : [])];

export function isMyOr(o: Pick<DayOr, 'operator' | 'operator_id'>, me: WorkScope): boolean {
  if (me.all) return !!o.operator_id || !!String(o.operator ?? '').trim();
  if (o.operator_id && scopeUserIds(me).includes(o.operator_id)) return true;
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
  /** Atelier regarde (selecteur « Atelier de »), absent = le mien. */
  scope?: WorkScope | null;
  /** Pointages des comptes de l'atelier regarde (OR en cours / en pause chez eux). */
  scopeEntries?: readonly WorkEntry[];
}): DayCard[] {
  const meRef: Me = { userId: p.me.userId, code: null };
  const scope: WorkScope = p.scope ?? p.me;
  const scopeEntries = (p.scope ? p.scopeEntries ?? [] : p.myEntries) as WorkEntry[];
  /** Un compte de l'atelier regarde a-t-il un pointage ouvert ou en pause sur cet OR ? */
  const pointedInScope = (orId: string) => {
    const users = scope.all
      ? [...new Set(scopeEntries.filter((e) => e.or_id === orId && !e.mechanic_code && e.mechanic_id).map((e) => e.mechanic_id as string))]
      : scopeUserIds(scope);
    return users.some((u) => { const w = orWorkState(scopeEntries, orId, { userId: u, code: null }); return !!w.mineOpen || !!w.mineLastPaused; });
  };
  const orById = new Map(p.ors.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const cards: DayCard[] = [];
  const workOf = (orId: string) => orWorkState(p.myEntries as WorkEntry[], orId, meRef);

  for (const a of p.appointments) {
    if (HIDDEN_APPOINTMENT.has(a.status) || !isTodayBrussels(a.starts_at, p.today) || !isMyAppointment(a, scope)) continue;
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
    const pointed = p.scope ? pointedInScope(o.id) : !!work.mineOpen || !!work.mineLastPaused;
    if (!(pointed || (isWorkable(o.status) && isMyOr(o, scope)))) continue;
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
  return sortCards(cards, p.today);
}

// ---------------------------------------------------------------------------------------------
// Choix de l'atelier regarde (retour client du 19/11 : « j'ai un RDV aujourd'hui, je ne le vois pas »)
// ---------------------------------------------------------------------------------------------
/** Roles qui choisissent l'atelier regarde (les memes que les reglages du planning). */
export const WORKSHOP_CHOOSER_ROLES = ['admin', 'chef_atelier'] as const;
export const canChooseWorkshop = (roles: readonly string[]) =>
  roles.some((r) => (WORKSHOP_CHOOSER_ROLES as readonly string[]).includes(r));

export type WorkshopView = { kind: 'me' } | { kind: 'mechanic'; mechanicId: string } | { kind: 'all' };
export const VIEW_ALL = 'all' as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valeur de l'adresse (`?mechanic=`) : `all`, l'id d'une fiche compagnon, sinon moi. */
export function parseWorkshopView(raw: unknown): WorkshopView {
  if (raw === VIEW_ALL) return { kind: 'all' };
  if (typeof raw === 'string' && UUID_RE.test(raw)) return { kind: 'mechanic', mechanicId: raw.toLowerCase() };
  return { kind: 'me' };
}
export const workshopViewParam = (v: WorkshopView): string | undefined =>
  v.kind === 'all' ? VIEW_ALL : v.kind === 'mechanic' ? v.mechanicId : undefined;

/**
 * L'atelier effectivement montre : un mecanicien simple voit toujours le sien ; un compagnon
 * inconnu (autre societe, fiche disparue) ou qui est l'une de mes fiches revient a « moi ».
 */
export function effectiveView(v: WorkshopView, canChoose: boolean, me: MeIdentity, mechanics: readonly MechanicLite[]): WorkshopView {
  if (!canChoose || v.kind === 'me') return { kind: 'me' };
  if (v.kind === 'all') return v;
  if (me.mechanicIds.includes(v.mechanicId) || !mechanics.some((m) => m.id === v.mechanicId)) return { kind: 'me' };
  return v;
}

/** Perimetre lu pour l'atelier montre (`null` = le mien, comportement du lot F). */
export function viewScope(v: WorkshopView, mechanics: readonly MechanicLite[]): (WorkScope & { label: string }) | null {
  if (v.kind === 'me') return null;
  if (v.kind === 'all') {
    return { all: true, label: '', names: [], mechanicIds: [], userIds: [...new Set(mechanics.map((m) => m.user_id).filter((x): x is string => !!x))] };
  }
  const m = mechanics.find((x) => x.id === v.mechanicId);
  if (!m) return null;
  return { label: m.name, names: [normName(m.name)].filter(Boolean), mechanicIds: [m.id], userIds: m.user_id ? [m.user_id] : [] };
}

/** Compagnons proposes dans le selecteur : actifs, visibles au planning, hors mes fiches, par nom. */
export function chooserMechanics(mechanics: readonly MechanicLite[], me: MeIdentity): MechanicLite[] {
  return mechanics.filter((m) => m.is_active !== false && m.visible_in_planning !== false && !me.mechanicIds.includes(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * A qui est la moto, et est-ce la mienne ? « foreign » = moto de l'atelier regarde qui n'est ni
 * a mon nom ni pointee par moi : les gestes restent permis mais demandent confirmation, car le
 * pointage est toujours au nom du compte connecte, jamais a celui du mecanicien attribue.
 */
export function cardOwner(card: Pick<DayCard, 'section' | 'or' | 'appointment' | 'work'>, me: MeIdentity, mechanics: readonly MechanicLite[]): { name: string | null; foreign: boolean } {
  const a = card.appointment;
  const o = card.or;
  let name: string | null = null;
  if (a && !a.unassigned && (a.mechanic_id || a.mechanic_name)) {
    name = mechanics.find((m) => m.id === a.mechanic_id)?.name ?? a.mechanic_name ?? null;
  }
  if (!name && o) {
    name = (o.operator_id ? mechanics.find((m) => m.user_id === o.operator_id)?.name : null) ?? (String(o.operator ?? '').trim() || null);
  }
  if (card.section !== 'mine') return { name, foreign: false };
  const mineByMe = (!!a && isMyAppointment(a, me)) || (!!o && isMyOr(o, me)) || !!card.work?.mineOpen || !!card.work?.mineLastPaused;
  return { name, foreign: !mineByMe };
}

/** Un message a la place de la liste vide : compte relie a aucun compagnon et aucune moto. */
export function notLinkedHint(view: WorkshopView, me: MeIdentity, mineCount: number): boolean {
  return view.kind === 'me' && me.mechanicIds.length === 0 && mineCount === 0;
}

/**
 * Ordre de la liste (retour client du 19/11 : l'ancien OR accident d'une moto passait AVANT l'OR
 * du RDV du jour de la meme moto, l'un trie par date de creation, l'autre par heure de RDV).
 * Le meme tri pour tous les types de carte :
 *  0. les RDV et OR du jour, par heure (heure du RDV du jour, sinon heure d'ouverture de l'OR) ;
 *  1. les OR en cours ou en pause (mon pointage, ou l'etat de l'OR tous pointages confondus),
 *     en cours d'abord, puis du plus recent au plus ancien ;
 *  2. les autres OR ouverts, du plus recent au plus ancien ;
 *  3. les OR qui ne se pointent plus (prets), du plus recent au plus ancien.
 * Mes motos avant les OR non attribues (deux sections de l'ecran).
 */
export type OrLiveState = 'running' | 'paused' | 'stopped';

const isTodayAppointment = (a: DayAppointment | null | undefined, today: string) =>
  !!a && !HIDDEN_APPOINTMENT.has(a.status) && isTodayBrussels(a.starts_at, today);

const isTodayCard = (c: Pick<DayCard, 'or' | 'appointment'>, today: string) =>
  isTodayAppointment(c.appointment, today) || (!!c.or && isTodayBrussels(c.or.created_at, today));

const isRunningCard = (c: DayCard, live?: OrLiveState) => !!c.work?.mineOpen || live === 'running';

export function cardGroup(c: DayCard, today: string, live?: OrLiveState): 0 | 1 | 2 | 3 {
  if (isTodayCard(c, today)) return 0;
  if (c.work?.mineOpen || c.work?.mineLastPaused || live === 'running' || live === 'paused' || c.or?.status === 'en_cours') return 1;
  if (c.or && !isWorkable(c.or.status)) return 3;
  return 2;
}

/** Heure d'une carte du jour : celle du RDV du jour, sinon l'ouverture de l'OR. */
const dayTime = (c: DayCard, today: string) =>
  (isTodayAppointment(c.appointment, today) ? c.appointment!.starts_at : c.or?.created_at ?? c.appointment?.starts_at) ?? '';
const openedAt = (c: DayCard) => c.or?.created_at ?? c.appointment?.starts_at ?? '';

export function sortCards(cards: readonly DayCard[], today: string, live?: ReadonlyMap<string, OrLiveState>): DayCard[] {
  const liveOf = (c: DayCard) => (c.or ? live?.get(c.or.id) : undefined);
  return [...cards].sort((a, b) => {
    const s = a.section === b.section ? 0 : a.section === 'mine' ? -1 : 1;
    if (s) return s;
    const ga = cardGroup(a, today, liveOf(a));
    const gb = cardGroup(b, today, liveOf(b));
    if (ga !== gb) return ga - gb;
    if (ga === 0) return dayTime(a, today).localeCompare(dayTime(b, today)) || a.key.localeCompare(b.key);
    if (ga === 1) {
      const ra = isRunningCard(a, liveOf(a)) ? 0 : 1;
      const rb = isRunningCard(b, liveOf(b)) ? 0 : 1;
      if (ra !== rb) return ra - rb;
    }
    return openedAt(b).localeCompare(openedAt(a)) || a.key.localeCompare(b.key);
  });
}

// ---------------------------------------------------------------------------------------------
// Cartes lisibles (retour client du 19/11) : n° d'OR, motif, heure / date de reception, anciennete
// ---------------------------------------------------------------------------------------------
/** Seuil par defaut des « OR anciens a verifier » (reglage du planning `stale_or_days`). */
export const STALE_OR_DAYS_DEFAULT = 14;
export const STALE_OR_DAYS_MAX = 365;
/** Valeur du reglage : un entier de 1 a 365, sinon 14. */
export function staleDaysSetting(v: unknown): number {
  if (v === null || v === undefined || v === '') return STALE_OR_DAYS_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= STALE_OR_DAYS_MAX ? n : STALE_OR_DAYS_DEFAULT;
}

/** Jours de calendrier entre deux dates AAAA-MM-JJ (to - from). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Anciennete en jours de calendrier de Bruxelles (0 = aujourd'hui). */
export function orAgeDays(createdAt: string | null | undefined, today: string): number {
  if (!createdAt) return 0;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, daysBetween(brusselsParts(d).date, today));
}

/** Libelle d'anciennete : cle i18n + nombre (« Ouvert aujourd'hui », « Ouvert depuis 16 jours »). */
export function ageLabel(days: number): { key: 'age_today' | 'age_one' | 'age_many'; n: number } {
  if (days <= 0) return { key: 'age_today', n: 0 };
  return days === 1 ? { key: 'age_one', n: 1 } : { key: 'age_many', n: days };
}

/** Quand : heure du RDV du jour, sinon date de reception de l'OR (son ouverture), sinon le RDV. */
export type CardWhen = { kind: 'appointment'; at: string; today: boolean } | { kind: 'received'; at: string } | { kind: 'none' };
export function cardWhen(c: Pick<DayCard, 'or' | 'appointment'>, today: string): CardWhen {
  if (isTodayAppointment(c.appointment, today)) return { kind: 'appointment', at: c.appointment!.starts_at, today: true };
  if (c.or?.created_at) return { kind: 'received', at: c.or.created_at };
  if (c.appointment) return { kind: 'appointment', at: c.appointment.starts_at, today: false };
  return { kind: 'none' };
}

/** Motif de la carte : libelle (cle i18n `myWorkshop.motive_<label>`) et famille (icone). */
export const MOTIVE_LABELS = [
  'annual', 'oil', 'first_1000', 'desmo', 'maintenance', 'vidange', 'accident', 'warranty',
  'tyres', 'brakes', 'diagnostic', 'repair', 'pdi', 'oro', 'accessories', 'other', 'unknown',
] as const;
export type MotiveLabel = (typeof MOTIVE_LABELS)[number];
export type MotiveKind = 'maintenance' | 'accident' | 'warranty' | 'repair' | 'other' | 'unknown';
export type Motive = { kind: MotiveKind; label: MotiveLabel };

const SERVICE_MOTIVE: Record<string, MotiveLabel> = { annual: 'annual', oil: 'oil', first_1000: 'first_1000', desmo: 'desmo' };
const REASON_MOTIVE: Record<string, MotiveLabel> = {
  entretien_annuel: 'annual', entretien_annuel_huile: 'oil', entretien_1000: 'first_1000', vidange: 'vidange',
  pneus: 'tyres', freins: 'brakes', accident: 'accident', garantie: 'warranty', diagnostic: 'diagnostic', autre: 'other',
};
const REPAIR_TYPE_MOTIVE: Record<string, MotiveLabel> = {
  entretien: 'maintenance', reparation: 'repair', garantie_ducati: 'warranty', garantie_magasin: 'warranty', accident: 'accident',
  pneus: 'tyres', diagnostic: 'diagnostic', pdi: 'pdi', oro: 'oro', accessoires: 'accessories', autre: 'other',
};
const serviceMotive = (code: string | null | undefined): MotiveLabel | null => (code ? SERVICE_MOTIVE[code] ?? null : null);
function reasonMotive(code: string | null | undefined): MotiveLabel | null {
  const c = String(code ?? '').trim().toLowerCase();
  if (!c) return null;
  if (REASON_MOTIVE[c]) return REASON_MOTIVE[c];
  if (c.startsWith('entretien')) return 'maintenance';
  if (c.startsWith('desmo')) return 'desmo';
  if (c.startsWith('garantie')) return 'warranty';
  return 'other';
}
function repairTypeMotive(code: string | null | undefined): MotiveLabel | null {
  const c = String(code ?? '').trim().toLowerCase();
  if (!c) return null;
  return REPAIR_TYPE_MOTIVE[c] ?? (c.startsWith('garantie') ? 'warranty' : 'other');
}

export function motiveKind(l: MotiveLabel): MotiveKind {
  switch (l) {
    case 'annual': case 'oil': case 'first_1000': case 'desmo': case 'maintenance': case 'vidange': return 'maintenance';
    case 'accident': return 'accident';
    case 'warranty': return 'warranty';
    case 'other': return 'other';
    case 'unknown': return 'unknown';
    default: return 'repair';
  }
}

/**
 * Le motif : celui de l'OR (entretien choisi, motif d'entree, type de reparation), sinon celui du
 * RDV. Un accident l'emporte toujours (c'est lui qu'il ne faut pas confondre avec l'entretien) ;
 * « Autre » seulement si rien de plus precis ; rien du tout : « Motif non renseigne ».
 */
export function cardMotive(c: Pick<DayCard, 'or' | 'appointment'>): Motive {
  const o = c.or;
  const a = c.appointment;
  const fromOr = [serviceMotive(o?.service_code), reasonMotive(o?.reason_code), repairTypeMotive(o?.repair_type)].filter((x): x is MotiveLabel => !!x);
  const fromAppt = [serviceMotive(a?.service_code), reasonMotive(a?.reason_code)].filter((x): x is MotiveLabel => !!x);
  const all = [...fromOr, ...fromAppt];
  const pick: MotiveLabel = all.includes('accident') ? 'accident'
    : fromOr.find((x) => x !== 'other') ?? fromAppt.find((x) => x !== 'other') ?? all[0] ?? 'unknown';
  return { kind: motiveKind(pick), label: pick };
}

// ---------------------------------------------------------------------------------------------
// Une moto, plusieurs OR ouverts : l'OR du RDV du jour en avant, les autres « ancien OR »
// ---------------------------------------------------------------------------------------------
export type VehicleGroupInfo = {
  /** OR ouverts (relus, ni factures ni annules) de la moto. */
  openOrs: number;
  /** Cette carte : le dossier a traiter aujourd'hui, ou un ancien OR de la moto. */
  role: 'primary' | 'old';
  /** Les autres OR ouverts de la moto (hors celui de la carte), du plus recent au plus ancien. */
  others: { id: string; number: string | null; created_at: string }[];
  /** Dossier mis en avant : un OR (son numero) ou un RDV du jour sans OR. */
  primary: { kind: 'or'; id: string; number: string | null } | { kind: 'rdv'; id: string } | null;
  /** Le dossier mis en avant est celui d'un RDV du jour (sinon : simplement l'OR le plus recent). */
  primaryToday: boolean;
};

/**
 * Regroupement par moto (`vehicle_id`) : des que la moto a au moins deux dossiers ouverts (OR
 * ouverts relus + RDV du jour sans OR), chaque carte de la moto dit combien et lequel traiter.
 * Mis en avant : l'OR du RDV du jour (le plus tot s'il y en a plusieurs) ; a defaut un RDV du jour
 * sans OR ; a defaut l'OR le plus recent. Tous les autres OR de la moto sont des « anciens OR ».
 */
export function vehicleOrGroups(p: {
  cards: readonly DayCard[]; ors: readonly DayOr[]; appointments: readonly DayAppointment[]; today: string;
}): Map<string, VehicleGroupInfo> {
  const out = new Map<string, VehicleGroupInfo>();
  const vehicleOf = (c: DayCard) => c.or?.vehicle_id ?? c.appointment?.vehicle_id ?? null;
  const todayAppts = p.appointments.filter((a) => isTodayAppointment(a, p.today))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const vehicles = new Set(p.cards.map(vehicleOf).filter((v): v is string => !!v));
  for (const v of vehicles) {
    const open = p.ors.filter((o) => o.vehicle_id === v && !HIDDEN_OR.has(o.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const rdvOnly = p.cards.filter((c) => !c.or && isTodayAppointment(c.appointment, p.today) && c.appointment!.vehicle_id === v)
      .sort((a, b) => a.appointment!.starts_at.localeCompare(b.appointment!.starts_at));
    if (open.length + rdvOnly.length < 2) continue;
    const firstRdv = (orId: string) => todayAppts.find((a) => a.or_id === orId)?.starts_at ?? null;
    const withRdv = open.filter((o) => firstRdv(o.id)).sort((a, b) => firstRdv(a.id)!.localeCompare(firstRdv(b.id)!));
    const primary: VehicleGroupInfo['primary'] = withRdv[0] ? { kind: 'or', id: withRdv[0].id, number: withRdv[0].number }
      : rdvOnly[0] ? { kind: 'rdv', id: rdvOnly[0].appointment!.id }
        : open[0] ? { kind: 'or', id: open[0].id, number: open[0].number } : null;
    for (const c of p.cards) {
      if (vehicleOf(c) !== v) continue;
      const isPrimary = !!primary && (primary.kind === 'or' ? c.or?.id === primary.id : !c.or && c.appointment?.id === primary.id);
      out.set(c.key, {
        openOrs: open.length,
        role: isPrimary ? 'primary' : 'old',
        others: open.filter((o) => o.id !== c.or?.id).map((o) => ({ id: o.id, number: o.number, created_at: o.created_at })),
        primary,
        primaryToday: !!withRdv[0] || !!rdvOnly[0],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// OR anciens a verifier
// ---------------------------------------------------------------------------------------------
type LiveRow = { work_state?: string | null; running_since?: string | null; last_stopped_at?: string | null };

/** Dernier pointage connu d'un OR : vue du lot A (tous comptes confondus) et mes pointages. */
export function lastPointageAt(orId: string, row: LiveRow | null | undefined, entries: readonly WorkEntry[]): string | null {
  const dates: (string | null | undefined)[] = [row?.running_since, row?.last_stopped_at];
  for (const e of entries) if (e.or_id === orId) dates.push(e.ended_at ?? e.started_at);
  return dates.filter((x): x is string => !!x).sort().pop() ?? null;
}

/**
 * OR « ancien a verifier » : ouvert depuis plus de `staleDays` jours (calendrier de Bruxelles),
 * aucun pointage depuis plus de `staleDays` jours, pas de RDV aujourd'hui, pas de pointage en
 * cours. Un RDV sans OR n'est jamais ancien.
 */
export function isStaleCard(c: Pick<DayCard, 'or' | 'appointment' | 'work'>, p: {
  today: string; staleDays: number; lastPointage: string | null; live?: OrLiveState;
}): boolean {
  if (!c.or) return false;
  if (isTodayAppointment(c.appointment, p.today)) return false;
  if (c.work?.mineOpen || p.live === 'running') return false;
  if (orAgeDays(c.or.created_at, p.today) <= p.staleDays) return false;
  if (p.lastPointage && orAgeDays(p.lastPointage, p.today) <= p.staleDays) return false;
  return true;
}

/**
 * Apres la lecture de l'etat des OR (vue du lot A) : marque les OR anciens et trie, l'etat en
 * cours / en pause de l'OR (tous pointages confondus) comptant dans l'ordre.
 */
export function finalizeCards(cards: readonly DayCard[], p: {
  today: string; staleDays: number; myEntries: readonly WorkEntry[]; workStatus: ReadonlyMap<string, LiveRow>;
}): DayCard[] {
  const live = new Map<string, OrLiveState>();
  for (const [id, r] of p.workStatus) {
    if (r.work_state === 'running' || r.work_state === 'paused' || r.work_state === 'stopped') live.set(id, r.work_state);
  }
  const marked = cards.map((c) => {
    const orId = c.or?.id;
    const stale = !!orId && isStaleCard(c, {
      today: p.today, staleDays: p.staleDays, live: live.get(orId),
      lastPointage: lastPointageAt(orId, p.workStatus.get(orId), p.myEntries),
    });
    return { ...c, stale };
  });
  return sortCards(marked, p.today, live);
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
