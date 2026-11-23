/**
 * M8 — « Mon atelier » selon la maquette de la revue UX (lot UX atelier, 20/11/2026).
 * Règles PURES de présentation (testées dans `tests/atelier-ux-atelier.test.ts`), aucune règle
 * métier nouvelle : on relit les mêmes données que l'écran (`MyDay`) et les mêmes fonctions
 * (`orProgress` de la fiche OR, `cardGesture`, `canStartWork`).
 *  - la frise de chaque carte = la frise de la fiche OR (même calcul) ;
 *  - les alertes seules en badges (pièces manquantes, ancien OR, accord client en attente) ;
 *  - LA moto « à faire maintenant » (un seul bouton rouge sur l'écran) ;
 *  - une seule confirmation avant de travailler (moto d'un autre + ancien OR + autre travail).
 */
import { orProgress, type OrProgressInput, type Step } from '../or-base/progress-rules';
import { approvalState, canStartWork } from '../checkup/rules';
import type { ReceptionStatus } from '../reception/rules';
import { brusselsParts } from '../reservations/parts-flow';
import { dossierFlow, type DossierFacts, type DossierStepKey } from '../dossier/rules';
import type { DayCard, Gesture, PartsSummary } from './rules';

type ProgressLite = { total: number; done: number; not_done: number; mandatory_open: number };
type WorkStatusLite = { work_state: 'running' | 'paused' | 'stopped' };

/** Entrées de la frise pour une carte (RDV sans OR : tout reste « à faire »). */
export function cardProgressInput(card: Pick<DayCard, 'or' | 'appointment' | 'work'>, p: {
  receptionReady: boolean;
  reception?: { status: ReceptionStatus; missing: number } | null;
  pointageReady: boolean;
  workStatus?: WorkStatusLite | null;
  progress?: ProgressLite | null;
}): OrProgressInput {
  const or = card.or;
  const service = or?.service_code ?? card.appointment?.service_code ?? null;
  const pr = or ? p.progress ?? null : null;
  return {
    orStatus: or?.status ?? 'a_faire',
    receptionOn: p.receptionReady,
    receptionStatus: (or ? p.reception?.status : null) ?? 'none',
    photosTaken: 0,
    photosTotal: 0,
    photosMissing: or ? p.reception?.missing ?? 0 : 0,
    pointageOn: p.pointageReady,
    workState: (or ? p.workStatus?.work_state : null) ?? 'none',
    mineRunning: !!card.work?.mineOpen,
    minePaused: !card.work?.mineOpen && !!card.work?.mineLastPaused,
    planTotal: pr?.total ?? 0,
    planResolved: (pr?.done ?? 0) + (pr?.not_done ?? 0),
    planMandatoryOpen: pr?.mandatory_open ?? 0,
    hasService: !!service,
    workAllowed: canStartWork(or),
    warrantyPending: false,
    planExpected: !!service,
  };
}

export function cardSteps(card: Pick<DayCard, 'or' | 'appointment' | 'work'>, p: Parameters<typeof cardProgressInput>[1]): Step[] {
  return orProgress(cardProgressInput(card, p)).steps;
}

/** Chantier C1 : l'étape du dossier de cette carte (même règle que le dossier). */
export function cardDossierStep(card: Pick<DayCard, 'or' | 'appointment' | 'work'>, p: Parameters<typeof cardProgressInput>[1] & {
  today: string; parts?: PartsSummary | null;
}): DossierStepKey | null {
  const i = cardProgressInput(card, p);
  const a = card.appointment;
  const or = card.or;
  const facts: DossierFacts = {
    today: p.today,
    appointment: a ? {
      status: a.status, unassigned: !!a.unassigned, hasMechanic: !!(a.mechanic_id || a.mechanic_name),
      day: brusselsParts(new Date(a.starts_at)).date, hasWork: !!(a.work_description?.trim() || a.reason_code || a.service_code), reasonCode: a.reason_code ?? null,
    } : null,
    or: or ? {
      status: or.status, customerApproval: or.customer_approval ?? null, warrantyStatus: null, reasonCode: or.reason_code ?? null,
      repairType: or.repair_type ?? null, serviceCode: or.service_code ?? null, hasVehicle: !!or.vehicle_id, hasContact: true, mileage: null,
    } : null,
    receptionReady: i.receptionOn, receptionStatus: i.receptionStatus, photosMissing: i.photosMissing,
    pointageReady: i.pointageOn, workState: i.workState, mineRunning: i.mineRunning, minePaused: i.minePaused,
    planTotal: i.planTotal, planResolved: i.planResolved, planMandatoryOpen: i.planMandatoryOpen,
    partsTotal: p.parts?.total ?? 0, partsMissing: p.parts?.missing ?? 0, invoice: null, handedOver: false,
  };
  return dossierFlow(facts).current;
}

/** Les seules alertes en badge (le reste est dans la frise). */
export type CardAlert = 'parts_missing' | 'old_or' | 'approval_pending';
export function cardAlerts(card: Pick<DayCard, 'or'>, p: { parts?: PartsSummary | null; old: boolean }): CardAlert[] {
  const out: CardAlert[] = [];
  if (p.parts?.state === 'missing') out.push('parts_missing');
  if (p.old) out.push('old_or');
  if (card.or && approvalState(card.or) === 'en_attente') out.push('approval_pending');
  return out;
}

/**
 * La moto « à faire maintenant » : la première carte du jour (ordre de l'écran) qui a un geste de
 * départ (Démarrer, Reprendre, Démarrer sur un RDV sans OR) et n'est pas un ancien OR. Aucune quand
 * un pointage tourne (le rouge est alors « Continuer le parcours » du bandeau) ou sur une tablette
 * partagée (le rouge est celui du bandeau « Qui êtes-vous ? / Reprendre »).
 */
export function doNowKey(cards: readonly { key: string; gesture: Gesture; old: boolean }[], p: { running: boolean; shared: boolean }): string | null {
  if (p.running || p.shared) return null;
  const c = cards.find((x) => !x.old && (x.gesture === 'start' || x.gesture === 'resume' || x.gesture === 'create_or'));
  return c?.key ?? null;
}

/**
 * Une seule confirmation au plus avant de travailler. Les raisons possibles, dans l'ordre où le
 * message les dit : ancien OR (la moto a l'OR d'un RDV aujourd'hui), moto d'un autre compagnon,
 * autre travail en cours (qui sera mis en pause). Aucune raison : on démarre sans rien demander.
 */
export type StartReason =
  | { kind: 'old_or' }
  | { kind: 'foreign'; name: string; notLinked: boolean }
  | { kind: 'switch'; entryId: string; orId: string | null; task: boolean };

export function startReasons(p: {
  gesture: Gesture;
  shared: boolean;
  oldWithTodayRdv: boolean;
  owner: { foreign: boolean; name: string | null };
  meLinked: boolean;
  /** Mon pointage qui tourne (compte connecté), s'il y en a un. */
  running: { entryId: string; orId: string | null; kind: string } | null;
  cardOrId: string | null;
}): StartReason[] {
  if (p.gesture === 'continue' || p.gesture === 'none' || p.gesture === 'blocked') return [];
  const out: StartReason[] = [];
  if (p.oldWithTodayRdv && p.cardOrId) out.push({ kind: 'old_or' });
  // Tablette partagée : le pointage est au nom de la personne identifiée, rien à confirmer.
  if (!p.shared && p.owner.foreign) out.push({ kind: 'foreign', name: p.owner.name ?? '', notLinked: !p.meLinked });
  if (!p.shared && p.running && (p.running.kind !== 'travail' || p.running.orId !== p.cardOrId)) {
    out.push({ kind: 'switch', entryId: p.running.entryId, orId: p.running.orId, task: p.running.kind !== 'travail' });
  }
  return out;
}

/** Durée lisible d'un pointage en cours : « 42 min », « 1 h 05 ». */
export function durationParts(fromIso: string, nowMs: number): { h: number; min: number } {
  const total = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 60_000));
  return { h: Math.floor(total / 60), min: total % 60 };
}
