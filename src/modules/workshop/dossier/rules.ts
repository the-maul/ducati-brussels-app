/**
 * M8 — Chantier C1 (23/11/2026) : le dossier moto en 4 étapes. Règles PURES (sans base ni React),
 * testées dans `tests/atelier-dossier.test.ts`.
 *
 * « Une moto, elle se réserve. Elle rentre. Elle se paie et elle sort. » L'étape se CALCULE à partir
 * des statuts réels (RDV, OR, photos, pointage, opérations, facture, paiement, remise) : aucun
 * nouveau statut en base. L'OR continue de naître « À faire » à l'entrée de la moto (comme G8).
 *
 * Variantes : client, garantie, accident aujourd'hui. Moto neuve, occasion et moto interne sont
 * déjà décrites dans `VARIANT_STEPS` (étapes sans objet) : le chantier C4 n'aura qu'à les détecter
 * dans `dossierVariant`.
 */
import { approvalState, canStartWork } from '../checkup/rules';
import { isAccidentOr, showWarrantyField } from '../or-page-rules';
import { orProgress, receptionSettled, type ReceptionStatusLite, type WorkStateLite } from '../or-base/progress-rules';

export const DOSSIER_STEPS = ['reserver', 'rentrer', 'travailler', 'payer'] as const;
export type DossierStepKey = (typeof DOSSIER_STEPS)[number];
export type DossierStepState = 'done' | 'current' | 'todo' | 'na';
export type DossierVariant = 'client' | 'garantie' | 'accident' | 'neuve' | 'occasion' | 'interne';

export const isDossierStep = (v: unknown): v is DossierStepKey =>
  typeof v === 'string' && (DOSSIER_STEPS as readonly string[]).includes(v);

/** Étapes qui ont un sens pour chaque type de dossier (false = grisée « sans objet »). */
export const VARIANT_STEPS: Record<DossierVariant, Record<DossierStepKey, boolean>> = {
  client: { reserver: true, rentrer: true, travailler: true, payer: true },
  garantie: { reserver: true, rentrer: true, travailler: true, payer: true },
  accident: { reserver: true, rentrer: true, travailler: true, payer: true },
  // Branchés par le chantier C4 (cessions) : pas de client à facturer.
  neuve: { reserver: false, rentrer: true, travailler: true, payer: false },
  occasion: { reserver: false, rentrer: true, travailler: true, payer: false },
  interne: { reserver: false, rentrer: true, travailler: true, payer: false },
};

export type DossierFacts = {
  /** Jour de Bruxelles (AAAA-MM-JJ). */
  today: string;
  appointment: {
    status: string;
    unassigned: boolean;
    hasMechanic: boolean;
    /** Jour du RDV (AAAA-MM-JJ, Bruxelles). */
    day: string | null;
    hasWork: boolean;
    reasonCode?: string | null;
  } | null;
  or: {
    status: string;
    customerApproval: string | null;
    warrantyStatus: string | null;
    reasonCode: string | null;
    repairType: string | null;
    serviceCode: string | null;
    hasVehicle: boolean;
    hasContact: boolean;
    mileage: number | null;
  } | null;
  receptionReady: boolean;
  receptionStatus: ReceptionStatusLite;
  photosMissing: number;
  pointageReady: boolean;
  workState: WorkStateLite;
  mineRunning: boolean;
  minePaused: boolean;
  planTotal: number;
  planResolved: number;
  planMandatoryOpen: number;
  partsTotal: number;
  partsMissing: number;
  invoice: { status: string; totalTtc: number; paidAmount: number } | null;
  handedOver: boolean;
};

export type DossierTaskKey =
  | 'date' | 'work' | 'parts'
  | 'or' | 'km' | 'photos' | 'approval'
  | 'pointage' | 'operations' | 'ready'
  | 'notify' | 'invoice' | 'payment' | 'handover';
export type DossierTaskState = 'done' | 'todo' | 'doing' | 'paused' | 'warning' | 'blocked' | 'skipped' | 'na';
export type DossierTask = { key: DossierTaskKey; state: DossierTaskState };

export type DossierFlow = {
  variant: DossierVariant;
  cancelled: boolean;
  /** Tout est fini : facture réglée (ou sans objet) et moto remise. */
  closed: boolean;
  current: DossierStepKey | null;
  steps: { key: DossierStepKey; state: DossierStepState }[];
  tasks: Record<DossierStepKey, DossierTask[]>;
  /** Ce qui empêche d'avancer, à dire à l'écran. */
  blocked: 'approval' | 'warranty' | null;
};

/** Le geste du bouton principal de l'étape affichée. */
export type DossierAction =
  | 'schedule' | 'next_step' | 'create_or' | 'photos' | 'approval'
  | 'start' | 'resume' | 'journey' | 'ready'
  | 'notify' | 'invoice' | 'pay' | 'handover'
  | 'go_current' | 'none';
/** « Passer » : seulement ce qui n'est pas bloquant. */
export type DossierSkip = 'view_next' | 'photos_later' | 'invoice' | 'handover';
export type DossierPrimary = { action: DossierAction; skip: DossierSkip | null };

const FINISHED = new Set(['pret', 'client_informe', 'facture']);

export function dossierVariant(f: Pick<DossierFacts, 'or' | 'appointment'>): DossierVariant {
  const reasonCode = f.or?.reasonCode ?? f.appointment?.reasonCode ?? null;
  const repairType = f.or?.repairType ?? null;
  if (isAccidentOr({ reasonCode, repairType })) return 'accident';
  if (showWarrantyField({ reasonCode, repairType, warrantyStatus: f.or?.warrantyStatus ?? null })) return 'garantie';
  return 'client';
}

/** Facture soldée, ou rien à encaisser (garantie à 0 €, facture annulée par avoir). */
export function paymentNotNeeded(inv: DossierFacts['invoice']): boolean {
  return !!inv && (inv.totalTtc <= 0.005 || inv.status === 'avoir_emis');
}
export function invoicePaid(inv: DossierFacts['invoice']): boolean {
  return !!inv && (inv.status === 'payee' || (inv.totalTtc > 0.005 && inv.paidAmount >= inv.totalTtc - 0.005));
}
const paymentSettled = (inv: DossierFacts['invoice']) => paymentNotNeeded(inv) || invoicePaid(inv);

const isScheduled = (a: NonNullable<DossierFacts['appointment']>) =>
  a.status !== 'demande' && !a.unassigned && a.hasMechanic;

/** Réservation finie : RDV placé, et pièces couvertes (le jour J, un manque n'empêche plus d'entrer). */
function reservationDone(f: DossierFacts): boolean {
  const a = f.appointment;
  if (!a) return true;
  if (!isScheduled(a)) return false;
  const due = !!a.day && a.day <= f.today;
  return due || f.partsMissing === 0;
}

const workStarted = (f: DossierFacts) => (f.pointageReady ? f.workState !== 'none' : f.or?.status === 'en_cours');
const approvalBlocks = (f: DossierFacts) => !!f.or && !canStartWork({ customer_approval: f.or.customerApproval });
const photosSettled = (f: DossierFacts) => !f.receptionReady || receptionSettled(f.receptionStatus);

function computeCurrent(f: DossierFacts, on: Record<DossierStepKey, boolean>): DossierStepKey | null {
  if (!f.or) return on.reserver && !reservationDone(f) ? 'reserver' : 'rentrer';
  const st = f.or.status;
  if (FINISHED.has(st)) {
    if (!on.payer) return null;
    return st === 'facture' && f.handedOver && paymentSettled(f.invoice) ? null : 'payer';
  }
  if (!workStarted(f) && (!photosSettled(f) || approvalBlocks(f))) return 'rentrer';
  return 'travailler';
}

function photosTask(f: DossierFacts): DossierTaskState {
  if (!f.receptionReady) return 'na';
  if (f.receptionStatus === 'complete') return f.photosMissing > 0 ? 'warning' : 'done';
  if (f.receptionStatus === 'plus_tard') return 'skipped';
  return f.receptionStatus === 'en_cours' ? 'doing' : 'todo';
}

function approvalTask(f: DossierFacts): DossierTaskState {
  const s = approvalState({ customer_approval: f.or?.customerApproval ?? null });
  if (s === 'none') return 'na';
  return s === 'signe' || s === 'accord_verbal' ? 'done' : 'blocked';
}

function buildTasks(f: DossierFacts): Record<DossierStepKey, DossierTask[]> {
  const a = f.appointment;
  const st = f.or?.status ?? null;
  const finished = !!st && FINISHED.has(st);
  const invoiced = st === 'facture' || !!f.invoice;
  const pointage: DossierTaskState = finished ? 'done'
    : f.workState === 'running' ? 'doing'
    : f.workState === 'paused' ? 'paused'
    : f.workState === 'stopped' ? 'done' : 'todo';
  const payment: DossierTaskState = !f.invoice ? 'todo'
    : paymentNotNeeded(f.invoice) ? 'na'
    : invoicePaid(f.invoice) ? 'done' : 'todo';
  return {
    reserver: [
      { key: 'date', state: !a ? 'na' : isScheduled(a) ? 'done' : 'todo' },
      { key: 'work', state: !a ? 'na' : a.hasWork ? 'done' : 'todo' },
      { key: 'parts', state: f.partsTotal === 0 ? 'na' : f.partsMissing > 0 ? 'warning' : 'done' },
    ],
    rentrer: [
      { key: 'or', state: f.or ? 'done' : 'todo' },
      { key: 'km', state: !f.or ? 'todo' : !f.or.hasVehicle ? 'na' : f.or.mileage != null ? 'done' : 'todo' },
      { key: 'photos', state: f.or ? photosTask(f) : 'todo' },
      { key: 'approval', state: approvalTask(f) },
    ],
    travailler: [
      { key: 'pointage', state: pointage },
      { key: 'operations', state: f.planTotal === 0 ? 'na' : f.planMandatoryOpen === 0 ? 'done' : 'todo' },
      { key: 'ready', state: finished ? 'done' : 'todo' },
    ],
    payer: [
      { key: 'notify', state: st === 'client_informe' ? 'done' : st === 'facture' ? 'na' : 'todo' },
      { key: 'invoice', state: invoiced ? 'done' : f.or?.warrantyStatus === 'en_attente' ? 'blocked' : 'todo' },
      { key: 'payment', state: payment },
      { key: 'handover', state: f.handedOver ? 'done' : 'todo' },
    ],
  };
}

export function dossierFlow(f: DossierFacts): DossierFlow {
  const variant = dossierVariant(f);
  const on = { ...VARIANT_STEPS[variant] };
  // Passage sans RDV : rien à réserver.
  if (!f.appointment) on.reserver = false;
  const cancelled = f.or ? f.or.status === 'annule' : f.appointment?.status === 'annule';
  const current = cancelled ? null : computeCurrent(f, on);
  const closed = !cancelled && current === null;
  const idx = current ? DOSSIER_STEPS.indexOf(current) : -1;
  const steps = DOSSIER_STEPS.map((key, i) => {
    const state: DossierStepState = !on[key] || cancelled ? 'na'
      : closed || i < idx ? 'done'
      : i === idx ? 'current' : 'todo';
    return { key, state };
  });
  let blocked: DossierFlow['blocked'] = null;
  if (!cancelled && !closed) {
    if ((current === 'rentrer' || current === 'travailler') && approvalBlocks(f)) blocked = 'approval';
    else if (current === 'payer' && f.or?.status !== 'facture' && f.or?.warrantyStatus === 'en_attente') blocked = 'warranty';
  }
  return { variant, cancelled, closed, current, steps, tasks: buildTasks(f), blocked };
}

/** L'étape à ouvrir : celle demandée si elle a un sens, sinon l'étape en cours, sinon la dernière utile. */
export function viewedStep(flow: DossierFlow, wanted: DossierStepKey | null | undefined): DossierStepKey {
  if (wanted && flow.steps.find((s) => s.key === wanted)?.state !== 'na') return wanted;
  if (flow.current) return flow.current;
  const usable = flow.steps.filter((s) => s.state !== 'na');
  return usable[usable.length - 1]?.key ?? 'rentrer';
}

function workAction(f: DossierFacts): DossierAction {
  const or = f.or!;
  const next = orProgress({
    orStatus: or.status,
    receptionOn: false, receptionStatus: f.receptionStatus, photosTaken: 0, photosTotal: 0, photosMissing: f.photosMissing,
    pointageOn: f.pointageReady, workState: f.workState, mineRunning: f.mineRunning, minePaused: f.minePaused,
    planTotal: f.planTotal, planResolved: f.planResolved, planMandatoryOpen: f.planMandatoryOpen,
    hasService: !!or.serviceCode, workAllowed: canStartWork({ customer_approval: or.customerApproval }),
    warrantyPending: or.warrantyStatus === 'en_attente',
  }).next;
  if (next === 'start' || next === 'resume' || next === 'journey') return next;
  if (next === 'finish' || next === 'ready') return 'ready';
  return approvalBlocks(f) ? 'approval' : 'none';
}

/** Le seul bouton principal de l'étape affichée, et ce que « Passer » ferait. */
export function dossierPrimary(f: DossierFacts, flow: DossierFlow, viewed: DossierStepKey): DossierPrimary {
  if (flow.cancelled || flow.closed || !flow.current) return { action: 'none', skip: null };
  if (viewed !== flow.current) return { action: 'go_current', skip: null };
  switch (flow.current) {
    case 'reserver': {
      const scheduled = !!f.appointment && isScheduled(f.appointment);
      return { action: scheduled ? 'next_step' : 'schedule', skip: scheduled ? null : 'view_next' };
    }
    case 'rentrer': {
      if (!f.or) return { action: 'create_or', skip: null };
      if (approvalBlocks(f)) return { action: 'approval', skip: photosSettled(f) ? null : 'photos_later' };
      if (!photosSettled(f)) return { action: 'photos', skip: 'photos_later' };
      return { action: 'next_step', skip: null };
    }
    case 'travailler':
      return { action: workAction(f), skip: null };
    case 'payer': {
      const or = f.or!;
      if (or.status !== 'facture') {
        if (or.warrantyStatus === 'en_attente') return { action: 'none', skip: null };
        if (or.status === 'pret' && or.hasContact) return { action: 'notify', skip: 'invoice' };
        return { action: 'invoice', skip: null };
      }
      if (!paymentSettled(f.invoice)) return { action: 'pay', skip: f.handedOver ? null : 'handover' };
      return { action: f.handedOver ? 'none' : 'handover', skip: null };
    }
  }
}
