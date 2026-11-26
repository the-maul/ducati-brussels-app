/**
 * M8 — Parcours mecanicien, lot D (19/11/2026) : reparation guidee par le plan d'entretien, reliee
 * a l'OR. Regles pures (sans base ni React), testees dans `tests/atelier-reparation-guidee.test.ts`.
 * Miroir des fonctions SQL de la migration 20261119271000 (repair_order_plan_operations,
 * repair_order_operation_set, repair_order_operations_finish).
 *
 * - Une operation est « a faire », « faite » (qui, quand, pointage en cours) ou « non faite »
 *   (motif obligatoire : refus du client, pas necessaire...).
 * - Avancement x / y : faites / total ; une « non faite » est REGLEE (elle ne bloque pas « Terminer »).
 * - « Terminer » n'est propose que quand toutes les operations OBLIGATOIRES sont reglees et que
 *   l'OR peut encore passer « Pret ». L'ecran demande confirmation (jamais de passage silencieux).
 */

export type PlanOpStatus = 'a_faire' | 'fait' | 'non_fait';

export type PlanOp = {
  id: string;
  or_id: string;
  op_key: string;
  sort_order: number;
  label: string;
  source: 'manuel' | 'plan';
  service_code: string | null;
  service_label: string | null;
  procedure_id: string | null;
  family_codes: string[];
  mandatory: boolean;
  status: PlanOpStatus;
  done_at: string | null;
  done_by_name: string | null;
  time_entry_id: string | null;
  time_entry_operation: string | null;
  not_done_reason: string | null;
  not_done_note: string | null;
  deferred_intervention_id: string | null;
  /** ATE014 (26/11) : « Faire quand meme » une operation pas a echeance (migration 20261126270000). */
  due_forced?: boolean;
};

export type PlanOpLine = { operation_id: string; line_id: string; family_code: string; article_id: string | null; designation: string; quantity: number | string };

export type NotDoneReason = { code: string; label: string; defer: boolean };

/**
 * Emplacement par operation (fiche OR et parcours technicien) pour un autre lot, ex. le lot E
 * « Voir sur la vue eclatee » : ce que l'ecran sait de l'operation, et les lignes de l'OR qu'elle
 * consomme (articles du kit).
 */
export type PlanOpSlotInfo = {
  orId: string;
  opKey: string;
  label: string;
  procedureId: string | null;
  familyCodes: string[];
  lines: PlanOpLine[];
};

/** Motifs par defaut (Parametres → Tables → « Motifs d'opération non faite », precharges par la migration). */
export const DEFAULT_NOT_DONE_REASONS: NotDoneReason[] = [
  { code: 'refus_client', label: 'Refus du client', defer: true },
  { code: 'pas_necessaire', label: 'Pas nécessaire (état correct)', defer: false },
  { code: 'deja_fait', label: 'Déjà fait récemment', defer: false },
  { code: 'piece_indisponible', label: 'Pièce indisponible', defer: true },
  { code: 'autre', label: 'Autre', defer: false },
];

/** Motif de Parametres → Tables : `extra.defer` = cree une intervention reportee. */
export function toNotDoneReason(r: { code: string; label: string; extra?: Record<string, unknown> | null }): NotDoneReason {
  const d = r.extra?.defer;
  return { code: r.code, label: r.label, defer: d === true || d === 'true' };
}

export function reasonText(code: string | null | undefined, reasons: NotDoneReason[], tr: (k: string) => string): string {
  if (!code) return '';
  const r = reasons.find((x) => x.code === code);
  if (r) return r.label;
  const key = `planOps.reason_${code}`;
  const v = tr(key);
  return v === key ? code : v;
}

export type PlanProgress = {
  total: number; done: number; notDone: number; resolved: number;
  mandatoryTotal: number; mandatoryOpen: number; percent: number;
};

export function planProgress(ops: Pick<PlanOp, 'status' | 'mandatory'>[]): PlanProgress {
  const total = ops.length;
  const done = ops.filter((o) => o.status === 'fait').length;
  const notDone = ops.filter((o) => o.status === 'non_fait').length;
  const mandatory = ops.filter((o) => o.mandatory);
  const mandatoryOpen = mandatory.filter((o) => o.status === 'a_faire').length;
  return {
    total, done, notDone, resolved: done + notDone,
    mandatoryTotal: mandatory.length, mandatoryOpen,
    percent: total ? Math.round(((done + notDone) / total) * 100) : 0,
  };
}

/** Statuts d'OR depuis lesquels « Terminer » peut passer l'OR « Pret » (miroir du SQL). */
export const FINISHABLE_OR_STATUSES = ['a_faire', 'attente_devis', 'attente_pieces', 'en_cours'] as const;

/** Proposer « Terminer » : liste non vide, toutes les obligatoires reglees, OR encore ouvert. */
export function canFinish(ops: Pick<PlanOp, 'status' | 'mandatory'>[], orStatus: string | null | undefined): boolean {
  if (!ops.length || !orStatus) return false;
  if (!(FINISHABLE_OR_STATUSES as readonly string[]).includes(orStatus)) return false;
  return planProgress(ops).mandatoryOpen === 0;
}

/** On ne coche plus sur un OR facture ou annule (miroir du SQL). */
export function canEditOps(orStatus: string | null | undefined): boolean {
  return !!orStatus && orStatus !== 'facture' && orStatus !== 'annule';
}

/** Couleur d'une operation : faite = succes, non faite = avertissement, a faire = neutre (+ icone + libelle). */
export function opTone(s: PlanOpStatus): 'success' | 'warning' | 'neutral' {
  return s === 'fait' ? 'success' : s === 'non_fait' ? 'warning' : 'neutral';
}

/** Couleur de l'avancement (planning, OR) : tout regle = succes, commence = info, rien = neutre. */
export function progressTone(p: Pick<PlanProgress, 'total' | 'resolved'>): 'success' | 'info' | 'neutral' {
  if (!p.total) return 'neutral';
  if (p.resolved >= p.total) return 'success';
  return p.resolved > 0 ? 'info' : 'neutral';
}

/** Lignes de l'OR consommees par chaque operation (pieces / liquides du kit). */
export function linesByOperation(lines: PlanOpLine[]): Map<string, PlanOpLine[]> {
  const out = new Map<string, PlanOpLine[]>();
  for (const l of lines) {
    const list = out.get(l.operation_id) ?? [];
    if (!list.some((x) => x.line_id === l.line_id)) list.push(l);
    out.set(l.operation_id, list);
  }
  return out;
}

/** Texte « operations non realisees » (impression de l'OR ; miroir de repair_order_operations_not_done_text). */
export function notDoneText(ops: PlanOp[], reasons: NotDoneReason[], tr: (k: string) => string, title: string): string | null {
  const list = ops.filter((o) => o.status === 'non_fait').sort((a, b) => a.sort_order - b.sort_order);
  if (!list.length) return null;
  return `${title} : ${list.map((o) => `${o.label} (${reasonText(o.not_done_reason, reasons, tr)}${o.not_done_note ? ` : ${o.not_done_note}` : ''})`).join(' ; ')}`;
}

/** Statut d'une operation, vu par le parcours technicien (case cochee = faite ou non faite). */
export function isResolved(s: PlanOpStatus | null | undefined): boolean {
  return s === 'fait' || s === 'non_fait';
}
