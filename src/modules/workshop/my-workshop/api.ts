/**
 * M8 — Parcours mecanicien, lot F (19/11/2026) : acces base de l'ecran « Mon atelier ».
 *
 * Lecture seule, en deux vagues de requetes paralleles (lot perf : colonnes nommees, jamais de
 * `select('*')` sur une liste, cache de React Query) :
 *  1. compagnons, RDV du jour (fenetre de 36 h filtree au jour de Bruxelles), OR ouverts et mes
 *     pointages des 14 derniers jours ;
 *  2. pour les OR retenus : etat de travail (vue du lot A), avancement (vue du lot D), photos de
 *     reception (lot C), reservations et picking list (lot B).
 * Atelier regarde (selecteur « Atelier de », administrateur et chef d'atelier) : `view` ; pour un
 * autre compagnon ou tout l'atelier, une requete de plus relit les pointages de leurs comptes.
 * Ecritures : aucune ici. Les gestes passent par les fonctions existantes (pointage du lot A,
 * ouverture de l'OR depuis le RDV du planning, serie de photos du lot C).
 * Page d'accueil : colonne `profiles.home_page` (migration 20261119290000, non appliquee) ;
 * absente, le role decide (voir `homeTarget`).
 */
import { supabase } from '@/integrations/supabase/client';
import { getOrWorkStatuses, pointageSchemaReady, type OrWorkStatusRow } from '../pointage/api';
import { getPlanProgress, type PlanProgressRow } from '../plan-ops/api';
import { receptionSchemaReady } from '../reception/api';
import { reservationSchemaReady } from '../reservations/api';
import type { ReceptionStatus } from '../reception/rules';
import type { PlanningAppointment } from '../planning/api';
import { OR_WORKABLE_STATUSES } from '../or-base/rules';
import {
  MY_ENTRIES_DAYS, buildDayCards, effectiveView, isHomePref, myIdentity, partsSummary, viewScope,
  type DayAppointment, type DayCard, type DayOr, type HomePref, type MechanicLite, type MeIdentity, type MyEntry,
  type PartsSummary, type ReservationLite, type WorkshopView,
} from './rules';

type LooseResult = { data: unknown; error: { message: string; code?: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  in: (col: string, values: readonly unknown[]) => LooseQuery;
  or: (filter: string) => LooseQuery;
  gte: (col: string, value: unknown) => LooseQuery;
  lt: (col: string, value: unknown) => LooseQuery;
  neq: (col: string, value: unknown) => LooseQuery;
  is: (col: string, value: null) => LooseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
  maybeSingle: () => PromiseLike<LooseResult>;
  update: (row: Record<string, unknown>) => LooseQuery;
};
const loose = supabase as unknown as { from: (table: string) => LooseQuery };

function rows<T>(r: LooseResult): T[] {
  if (r.error) throw new Error(r.error.message);
  return (r.data as T[] | null) ?? [];
}

const CONTACT_COLS = 'contacts(first_name, last_name, company_name, type)';
const VEHICLE_COLS = 'vehicles(brand, model, plate, vin, ducati_model_year_id)';
/** Toutes les colonnes utiles au RDV (l'ouverture de l'OR reprend celles du planning). */
const APPT_COLS = [
  'id', 'company_id', 'contact_id', 'vehicle_id', 'or_id', 'mechanic_name', 'mechanic_id', 'unassigned', 'appointment_type',
  'mileage', 'workshop', 'starts_at', 'planned_minutes', 'work_description', 'reception_notes', 'loaner_vehicle', 'status',
  'notify_sms', 'source', 'requested_slot', 'reason_code', 'service_code', CONTACT_COLS, VEHICLE_COLS,
].join(', ');
const OR_BASE_COLS = ['id', 'number', 'status', 'created_at', 'operator', 'contact_id', 'vehicle_id', 'work_description', 'customer_approval', CONTACT_COLS, VEHICLE_COLS];
/** Colonnes des migrations 20261103230000 (operator_id) et 20261103270000 (service_code). */
const OR_EXTRA_COLS = ['operator_id', 'service_code'];
const ENTRY_COLS = 'id, kind, or_id, mechanic_id, mechanic_code, mechanic_name, journey_operation, started_at, ended_at, minutes, stop_kind, stop_reason, task_code';

export type MyDayAppointment = DayAppointment & PlanningAppointment;

export type MyDay = {
  me: MeIdentity;
  /** Atelier effectivement montre (moi si le compte ne peut pas choisir ou si le choix est inconnu). */
  view: WorkshopView;
  /** Nom du compagnon regarde (vide pour moi et pour tout l'atelier). */
  viewLabel: string;
  mechanics: MechanicLite[];
  cards: DayCard[];
  myEntries: MyEntry[];
  /** OR relus mais qui ne se pointent plus (le bandeau ne propose pas d'y reprendre). */
  closedOrs: Set<string>;
  orNumbers: Map<string, string | null>;
  workStatus: Map<string, OrWorkStatusRow>;
  progress: Map<string, PlanProgressRow>;
  reception: Map<string, { status: ReceptionStatus; missing: number }>;
  parts: Map<string, PartsSummary>;
  pointageReady: boolean;
  receptionReady: boolean;
};

async function listOrs(companyId: string, extraIds: string[]): Promise<DayOr[]> {
  const open = `status.in.(${OR_WORKABLE_STATUSES.join(',')})`;
  const filter = extraIds.length ? `${open},id.in.(${extraIds.join(',')})` : open;
  const run = (cols: string[]) => loose.from('repair_orders').select(cols.join(', ')).eq('company_id', companyId)
    .or(filter).order('created_at', { ascending: true }).limit(300);
  let r = await run([...OR_BASE_COLS, ...OR_EXTRA_COLS]);
  // Colonnes plus recentes absentes : on relit sans elles (meme principe que les sondes de schema).
  if (r.error) r = await run(OR_BASE_COLS);
  return rows<DayOr>(r);
}

/** Tout ce que l'ecran affiche, pour le mecanicien connecte et le jour `today` (AAAA-MM-JJ, Bruxelles). */
export async function loadMyDay(p: {
  companyId: string; userId: string; profileName: string | null; today: string; now?: Date;
  view?: WorkshopView; canChoose?: boolean;
}): Promise<MyDay> {
  const now = p.now ?? new Date();
  const from = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  const to = new Date(now.getTime() + 36 * 3_600_000).toISOString();
  const since = new Date(now.getTime() - MY_ENTRIES_DAYS * 86_400_000).toISOString();
  const [mechR, apptR, entryR, openR, pointageReady, receptionReady, reservationReady] = await Promise.all([
    loose.from('workshop_mechanics').select('id, name, user_id, is_active, visible_in_planning').eq('company_id', p.companyId).limit(200),
    loose.from('workshop_appointments').select(APPT_COLS).eq('company_id', p.companyId)
      .gte('starts_at', from).lt('starts_at', to).neq('status', 'annule').order('starts_at').limit(300),
    loose.from('workshop_time_entries').select(ENTRY_COLS).eq('company_id', p.companyId).eq('mechanic_id', p.userId)
      .gte('started_at', since).order('started_at', { ascending: false }).limit(300),
    // Pointages restes ouverts plus anciens que la fenetre (oublies) : toujours relus.
    loose.from('workshop_time_entries').select(ENTRY_COLS).eq('company_id', p.companyId).eq('mechanic_id', p.userId)
      .is('ended_at', null).lt('started_at', since).limit(20),
    pointageSchemaReady(),
    receptionSchemaReady(),
    reservationSchemaReady(),
  ]);
  const mechanics = rows<MechanicLite>(mechR);
  const appointments = rows<MyDayAppointment>(apptR);
  const entries = [...rows<MyEntry>(entryR), ...rows<MyEntry>(openR)];
  const me = myIdentity(p.userId, p.profileName, mechanics);
  const view = effectiveView(p.view ?? { kind: 'me' }, !!p.canChoose, me, mechanics);
  const scope = viewScope(view, mechanics);
  // Atelier d'un autre : les pointages de ses comptes (OR en cours / en pause chez lui).
  const otherUsers = (scope?.userIds ?? []).filter((u) => u !== p.userId);
  const scopeEntries: MyEntry[] = scope ? [...entries] : [];
  if (scope && otherUsers.length) {
    const r = await loose.from('workshop_time_entries').select(ENTRY_COLS).eq('company_id', p.companyId).in('mechanic_id', otherUsers)
      .or(`started_at.gte.${since},ended_at.is.null`).order('started_at', { ascending: false }).limit(600);
    scopeEntries.push(...rows<MyEntry>(r));
  }
  const linkedOrIds = [...new Set([
    ...appointments.map((a) => a.or_id),
    ...entries.map((e) => e.or_id),
    ...scopeEntries.map((e) => e.or_id),
  ].filter((x): x is string => !!x))].slice(0, 150);
  const ors = await listOrs(p.companyId, linkedOrIds);
  const cards = buildDayCards({ me, today: p.today, appointments, ors, myEntries: entries, scope, scopeEntries });

  const orIds = cards.map((c) => c.or?.id).filter((x): x is string => !!x);
  const apptIds = cards.filter((c) => !c.or && c.appointment).map((c) => c.appointment!.id);
  const [workStatus, progress, recR, resR, pickR] = await Promise.all([
    getOrWorkStatuses(orIds),
    getPlanProgress(orIds),
    receptionReady && orIds.length
      ? loose.from('repair_order_receptions').select('or_id, status, missing_required').in('or_id', orIds)
      : Promise.resolve({ data: [], error: null } as LooseResult),
    reservationReady && (orIds.length || apptIds.length)
      ? loose.from('stock_reservations').select('repair_order_id, appointment_id, qty_needed, qty_reserved, qty_consumed, status')
        .eq('company_id', p.companyId).eq('status', 'active')
        .or([orIds.length ? `repair_order_id.in.(${orIds.join(',')})` : '', apptIds.length ? `appointment_id.in.(${apptIds.join(',')})` : ''].filter(Boolean).join(','))
        .limit(1000)
      : Promise.resolve({ data: [], error: null } as LooseResult),
    orIds.length || apptIds.length
      ? loose.from('picking_lists').select('repair_order_id, appointment_id, status, created_at').eq('company_id', p.companyId)
        .neq('status', 'annulee')
        .or([orIds.length ? `repair_order_id.in.(${orIds.join(',')})` : '', apptIds.length ? `appointment_id.in.(${apptIds.join(',')})` : ''].filter(Boolean).join(','))
        .order('created_at', { ascending: false }).limit(300)
      : Promise.resolve({ data: [], error: null } as LooseResult),
  ]);

  const reception = new Map<string, { status: ReceptionStatus; missing: number }>();
  if (!recR.error) {
    for (const r of (recR.data as { or_id: string; status: ReceptionStatus; missing_required: string[] | null }[] | null) ?? []) {
      reception.set(r.or_id, { status: r.status, missing: r.missing_required?.length ?? 0 });
    }
  }
  // Pieces : par OR, sinon par RDV (une reservation du RDV suit l'OR quand il nait, lot B).
  type ResRow = ReservationLite & { repair_order_id: string | null; appointment_id: string | null };
  type PickRow = { repair_order_id: string | null; appointment_id: string | null; status: string };
  const resRows = resR.error ? [] : ((resR.data as ResRow[] | null) ?? []);
  const pickRows = pickR.error ? [] : ((pickR.data as PickRow[] | null) ?? []);
  const parts = new Map<string, PartsSummary>();
  for (const c of cards) {
    const orId = c.or?.id ?? null;
    const apptId = c.appointment?.id ?? null;
    const match = (r: { repair_order_id: string | null; appointment_id: string | null }) =>
      (!!orId && r.repair_order_id === orId) || (!orId && !!apptId && r.appointment_id === apptId);
    const picking = pickRows.find(match) ?? (apptId ? pickRows.find((r) => r.appointment_id === apptId) : undefined);
    parts.set(c.key, partsSummary(resRows.filter(match), picking?.status ?? null));
  }

  const closedOrs = new Set(ors.filter((o) => !(OR_WORKABLE_STATUSES as readonly string[]).includes(o.status)).map((o) => o.id));
  // Un pointage sur un OR non relu (facture, annule) ne se reprend pas non plus.
  for (const e of entries) if (e.or_id && !ors.some((o) => o.id === e.or_id)) closedOrs.add(e.or_id);
  return {
    me, view, viewLabel: scope?.label ?? '', mechanics, cards, myEntries: entries, closedOrs,
    orNumbers: new Map(ors.map((o) => [o.id, o.number])),
    workStatus, progress, reception, parts, pointageReady, receptionReady,
  };
}

// ---------------------------------------------------------------------------------------------
// Page d'accueil (reglage du compte)
// ---------------------------------------------------------------------------------------------
/** Reglage du compte connecte ; `null` = colonne absente (migration non appliquee). */
export async function getHomePref(userId: string): Promise<HomePref | null> {
  const r = await loose.from('profiles').select('home_page').eq('id', userId).maybeSingle();
  if (r.error) return null;
  const v = (r.data as { home_page?: unknown } | null)?.home_page;
  return isHomePref(v) ? v : 'auto';
}

/** Enregistre la page d'accueil du compte (politique « profiles_update_own »). */
export async function saveHomePref(userId: string, pref: HomePref): Promise<void> {
  const r = await loose.from('profiles').update({ home_page: pref === 'auto' ? null : pref }).eq('id', userId);
  if (r.error) throw new Error(r.error.message);
}
