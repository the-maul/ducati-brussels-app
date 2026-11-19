/**
 * M8 — Parcours mecanicien, lot A (19/11/2026) : acces base du pointage unique.
 *
 * Fonctions SQL de la migration 20261119241000 (non appliquee, hors types.ts) : appelees sans
 * typage, avec une sonde de schema (`pointageSchemaReady`). Tant que la migration manque, les
 * ecrans gardent leur comportement d'avant (bouton « Demarrer » Q43, pointeuse cote navigateur).
 * Regles pures : `./rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import { toPauseReason, type PauseReason, type StartResult, type WorkEntry } from './rules';

export const PAUSE_REASON_TABLE_KEY = 'workshop_pause_reason';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

type LooseResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<LooseResult> & {
  select: (cols: string) => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  in: (col: string, values: unknown[]) => LooseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => LooseQuery;
  limit: (n: number) => LooseQuery;
};
const loose = supabase as unknown as { from: (table: string) => LooseQuery };

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261119241000 est appliquee (colonne workshop_time_entries.stop_kind). */
export function pointageSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await loose.from('workshop_time_entries').select('stop_kind').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Pour les tests : forcer la presence (ou non) du schema. */
export function __setPointageProbe(value: boolean | null): void {
  probe = value == null ? null : Promise.resolve(value);
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type Who = { code?: string | null; name?: string | null };

/** « Demarrer » / « Reprendre » : pointage du mecanicien sur l'OR (et l'operation du parcours). */
export function startWorkOnOr(orId: string, opts: { operation?: string | null; confirmSwitch?: boolean; who?: Who | null; origin?: string } = {}): Promise<StartResult> {
  return call<StartResult>('workshop_work_start', {
    _or: orId,
    _operation: opts.operation ?? null,
    _confirm_switch: !!opts.confirmSwitch,
    _mechanic_code: opts.who?.code ?? null,
    _mechanic_name: opts.who?.name ?? null,
    _origin: opts.origin ?? 'screen',
  });
}

export type PauseResult = { status: 'paused' | 'none'; entry_id?: string; minutes?: number; or_status_changed?: boolean };

/** « Pause » avec motif ; `orStatus` = statut d'OR propose et accepte (attente pieces / accord). */
export function pauseWork(p: { reason: string; orId?: string | null; entryId?: string | null; orStatus?: string | null; who?: Who | null; origin?: string }): Promise<PauseResult> {
  return call<PauseResult>('workshop_work_pause', {
    _reason: p.reason, _or: p.orId ?? null, _entry: p.entryId ?? null, _or_status: p.orStatus ?? null,
    _mechanic_code: p.who?.code ?? null, _origin: p.origin ?? 'screen',
  });
}

/** « Terminer » (ou « Depart » : `kind = 'departure'`, compte comme une pause de fin de journee). */
export function stopWorkPointage(p: { orId?: string | null; entryId?: string | null; who?: Who | null; kind?: 'stop' | 'departure'; origin?: string } = {}): Promise<{ status: string }> {
  return call('workshop_work_stop', {
    _or: p.orId ?? null, _entry: p.entryId ?? null, _mechanic_code: p.who?.code ?? null,
    _kind: p.kind ?? 'stop', _origin: p.origin ?? 'screen',
  });
}

/** Correction de l'heure de fin par l'atelier (admin, chef d'atelier), tracee. */
export function correctEntryEnd(entryId: string, endedAt: string, note?: string | null): Promise<unknown> {
  return call('workshop_time_entry_correct', { _entry: entryId, _ended_at: endedAt, _note: note ?? null });
}

/** Rattrapage de l'arret automatique (le planificateur passe toutes les 15 min). */
export async function runAutoStop(companyId: string): Promise<number> {
  try {
    return Number(await call<number>('workshop_time_auto_stop', { _company: companyId })) || 0;
  } catch {
    return 0;
  }
}

/** Pointages de travail d'un OR (les plus recents d'abord). */
export async function listOrWorkEntries(orId: string): Promise<WorkEntry[]> {
  const { data, error } = await loose.from('workshop_time_entries').select('*')
    .eq('or_id', orId).eq('kind', 'travail').order('started_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data as WorkEntry[] | null) ?? [];
}

/** Motifs de pause (Parametres → Tables), actifs, dans l'ordre. */
export async function listPauseReasons(companyId: string): Promise<PauseReason[]> {
  const rows = await listRef(companyId, PAUSE_REASON_TABLE_KEY).catch(() => []);
  return rows.filter((r) => r.is_active).map((r) => toPauseReason({ code: r.code, label: r.label, extra: (r.extra as Record<string, unknown> | null) ?? null }));
}

/** Etat de travail par OR (vue workshop_or_work_status) : planning, pointeuse. */
export type OrWorkStatusRow = {
  or_id: string;
  work_state: 'running' | 'paused' | 'stopped';
  running_by: string | null;
  running_since: string | null;
  running_operation: string | null;
  last_stop_kind: string | null;
  last_stop_reason: string | null;
  last_stopped_at: string | null;
  last_mechanic: string | null;
  closed_minutes: number | string | null;
};

export async function getOrWorkStatuses(orIds: string[]): Promise<Map<string, OrWorkStatusRow>> {
  const ids = [...new Set(orIds.filter(Boolean))];
  const out = new Map<string, OrWorkStatusRow>();
  if (!ids.length || !(await pointageSchemaReady())) return out;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await loose.from('workshop_or_work_status').select('*').in('or_id', ids.slice(i, i + 100));
    if (error) return out;
    for (const r of (data as OrWorkStatusRow[] | null) ?? []) out.set(r.or_id, r);
  }
  return out;
}

/** Reglage atelier de l'arret automatique (Parametres atelier → Reglages du planning). */
export type AutoStopMode = 'off' | 'end_of_schedule';
