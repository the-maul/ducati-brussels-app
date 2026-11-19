/**
 * M8 — Parcours mecanicien, lot A (19/11/2026) : UN SEUL CHRONO. Regles pures (sans base ni React),
 * testees dans `tests/workshop-pointage.test.ts`.
 *
 * La source de temps unique est la pointeuse (`workshop_time_entries`, B11). Un pointage de
 * travail porte l'OR et, depuis le parcours technicien, l'operation (`journey_operation`). Ces
 * regles en tirent ce que l'ecran affiche : en cours (par qui, depuis quand), en pause (motif),
 * termine ; le temps par operation et le temps total, pointage ouvert compris.
 */

export type StopKind = 'pause' | 'stop' | 'switch' | 'auto_stop' | 'departure';

/** Ce que l'ecran lit d'un pointage (colonnes de la table, celles du lot A facultatives). */
export type WorkEntry = {
  id: string;
  kind: string;
  or_id: string | null;
  mechanic_id: string | null;
  mechanic_code?: string | null;
  mechanic_name: string | null;
  journey_operation?: string | null;
  started_at: string;
  ended_at: string | null;
  minutes: number | string | null;
  stop_kind?: string | null;
  stop_reason?: string | null;
  corrected_at?: string | null;
};

/** Motifs de pause par defaut (Parametres → Tables → « Motifs de pause », precharges par la migration). */
export const DEFAULT_PAUSE_REASONS = ['attente_piece', 'attente_accord', 'fin_journee', 'autre_urgence', 'autre'] as const;
/** Motifs poses par le DMS lui-meme (jamais choisis dans la liste). */
export const SYSTEM_REASONS = ['autre_or', 'autre_operation'] as const;
/** Statut d'OR propose par defaut a la pause (si la ligne de Parametres n'en dit rien). */
const DEFAULT_OR_STATUS: Record<string, string> = { attente_piece: 'attente_pieces', attente_accord: 'attente_devis' };
/** Statuts d'OR qu'une pause peut proposer (ils existent dans la liste G8 des statuts). */
export const PAUSE_OR_STATUSES = ['attente_pieces', 'attente_devis'] as const;

export type PauseReason = { code: string; label: string; orStatus: string | null };

/** Motif de Parametres → Tables : le statut d'OR propose vient de `extra.or_status`. */
export function toPauseReason(r: { code: string; label: string; extra?: Record<string, unknown> | null }): PauseReason {
  const raw = r.extra && typeof r.extra.or_status === 'string' ? r.extra.or_status : undefined;
  const st = raw === undefined ? DEFAULT_OR_STATUS[r.code] ?? null : raw;
  return { code: r.code, label: r.label, orStatus: st && (PAUSE_OR_STATUSES as readonly string[]).includes(st) ? st : null };
}

/**
 * Statut d'OR a proposer a la pause : seulement si le motif en prevoit un et que l'OR est
 * « a faire » ou « en cours » (un OR deja « pret » ne recule pas).
 */
export function proposedOrStatus(reason: PauseReason | null | undefined, orStatus: string | null | undefined): string | null {
  if (!reason?.orStatus || !orStatus) return null;
  if (orStatus !== 'en_cours' && orStatus !== 'a_faire') return null;
  return reason.orStatus === orStatus ? null : reason.orStatus;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Minutes d'un pointage : celles enregistrees a la cloture, sinon jusqu'a maintenant (pointage ouvert). */
export function entryMinutes(e: Pick<WorkEntry, 'started_at' | 'ended_at' | 'minutes'>, now: number | Date = Date.now()): number {
  if (e.ended_at) {
    const m = Number(e.minutes);
    if (Number.isFinite(m)) return m;
    return Math.max(0, Math.round((ms(e.ended_at) - ms(e.started_at)) / 600) / 100);
  }
  const t = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, Math.round((t - ms(e.started_at)) / 600) / 100);
}

/** Temps de travail total d'un OR (pointages de travail), pointages ouverts compris. */
export function totalWorkMinutes(entries: WorkEntry[], orId: string, now: number | Date = Date.now()): number {
  return round2(entries.filter((e) => e.kind === 'travail' && e.or_id === orId).reduce((s, e) => s + entryMinutes(e, now), 0));
}

/** Temps par operation du parcours (cle = `journey_operation`). */
export function minutesByOperation(entries: WorkEntry[], orId: string, now: number | Date = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (e.kind !== 'travail' || e.or_id !== orId || !e.journey_operation) continue;
    out[e.journey_operation] = round2((out[e.journey_operation] ?? 0) + entryMinutes(e, now));
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Le mecanicien : compte connecte (poste personnel) ou code mecano (poste partage). */
export type Me = { userId: string | null; code?: string | null };

export function isMine(e: Pick<WorkEntry, 'mechanic_id' | 'mechanic_code'>, me: Me): boolean {
  const code = me.code?.trim() || null;
  if (code) return (e.mechanic_code ?? null) === code;
  return !!me.userId && e.mechanic_id === me.userId && !e.mechanic_code;
}

export type OrWorkState = {
  /** running : au moins un pointage ouvert ; paused : dernier pointage en pause ; stopped : termine ; none : jamais pointe. */
  state: 'running' | 'paused' | 'stopped' | 'none';
  /** Pointages ouverts sur l'OR (plusieurs mecaniciens possibles). */
  running: { name: string; since: string; operation: string | null; mine: boolean; entryId: string }[];
  /** Dernier pointage clos (motif de la pause). */
  last: { kind: StopKind | null; reason: string | null; at: string; name: string; operation: string | null } | null;
  /** Mon pointage ouvert sur cet OR. */
  mineOpen: WorkEntry | null;
  /** Mon dernier pointage clos sur cet OR en pause (Reprendre possible). */
  mineLastPaused: WorkEntry | null;
};

const PAUSED_KINDS = new Set(['pause', 'switch', 'auto_stop', 'departure']);

/** Etat de travail d'un OR depuis ses pointages. */
export function orWorkState(entries: WorkEntry[], orId: string, me: Me): OrWorkState {
  const work = entries.filter((e) => e.kind === 'travail' && e.or_id === orId);
  const open = work.filter((e) => !e.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const closed = work.filter((e) => !!e.ended_at).sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? ''));
  const last = closed[0] ?? null;
  const mineOpen = open.find((e) => isMine(e, me)) ?? null;
  const myLast = closed.find((e) => isMine(e, me)) ?? null;
  const state: OrWorkState['state'] = open.length ? 'running'
    : !last ? 'none'
    : PAUSED_KINDS.has(last.stop_kind ?? '') ? 'paused' : 'stopped';
  return {
    state,
    running: open.map((e) => ({
      name: e.mechanic_name || e.mechanic_code || '?', since: e.started_at, operation: e.journey_operation ?? null,
      mine: isMine(e, me), entryId: e.id,
    })),
    last: last ? {
      kind: (last.stop_kind as StopKind | null) ?? null, reason: last.stop_reason ?? null, at: last.ended_at!,
      name: last.mechanic_name || last.mechanic_code || '?', operation: last.journey_operation ?? null,
    } : null,
    mineOpen,
    mineLastPaused: !mineOpen && myLast && PAUSED_KINDS.has(myLast.stop_kind ?? '') ? myLast : null,
  };
}

/** Quels boutons montrer pour MOI sur cet OR (gros boutons tablette). */
export function workActions(s: OrWorkState, p: { orStatus: string | null | undefined; workAllowed: boolean }): {
  start: boolean; resume: boolean; pause: boolean; finish: boolean;
} {
  const workable = !!p.orStatus && ['a_faire', 'attente_devis', 'attente_pieces', 'en_cours'].includes(p.orStatus) && p.workAllowed;
  const mine = !!s.mineOpen;
  return {
    pause: mine,
    finish: mine,
    resume: !mine && workable && !!s.mineLastPaused,
    start: !mine && workable && !s.mineLastPaused,
  };
}

/** Tonalite charte de l'etat (toujours avec icone + libelle) : en cours = info, en pause = attention. */
export function workStateTone(state: OrWorkState['state']): 'info' | 'warning' | 'success' | 'neutral' {
  switch (state) {
    case 'running': return 'info';
    case 'paused': return 'warning';
    case 'stopped': return 'success';
    default: return 'neutral';
  }
}

/** Cle i18n du motif (motif de la liste : son libelle ; motif systeme ou absent : libelle du DMS). */
export function reasonLabel(code: string | null | undefined, reasons: PauseReason[], tr: (k: string) => string): string {
  if (!code) return '';
  const r = reasons.find((x) => x.code === code);
  if (r) return r.label;
  const key = `pointage.reason_${code}`;
  const v = tr(key);
  return v === key ? code : v;
}

/** Libelle court d'un pointage clos (« en pause : attente piece », « arret automatique »...). */
export function stopKindKey(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return `pointage.stop_${kind}`;
}

/** Reponse de `workshop_work_start`. */
export type StartResult =
  | { status: 'started' | 'resumed' | 'already'; entry_id: string; started_at: string; operation: string | null; switched_from?: string | null; or_status?: string | null }
  | { status: 'needs_confirm'; current: { entry_id: string; kind: string; or_id: string | null; or_number: string | null; task_code: string | null; started_at: string; operation: string | null } };
