/**
 * M8 — Parcours mecanicien, lot D (19/11/2026) : acces base des operations du plan d'entretien de
 * l'OR. Fonctions et tables de la migration 20261119271000 (non appliquee, hors types.ts) : appels
 * non types et sonde de schema. Regles pures : `./rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import { listRef } from '@/modules/settings/reference-api';
import { toNotDoneReason, type NotDoneReason, type PlanOp, type PlanOpLine, type PlanOpStatus } from './rules';

export const NOT_DONE_REASON_TABLE_KEY = 'workshop_op_not_done_reason';

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

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

let probe: Promise<boolean> | null = null;
/** true quand la migration 20261119271000 est appliquee (table repair_order_plan_operations). */
export function planOpsSchemaReady(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const { error } = await loose.from('repair_order_plan_operations').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Pour les tests : forcer la presence (ou non) du schema. */
export function __setPlanOpsProbe(value: boolean | null): void {
  probe = value == null ? null : Promise.resolve(value);
}

export async function listPlanOps(orId: string): Promise<PlanOp[]> {
  const { data, error } = await loose.from('repair_order_plan_operations').select('*').eq('or_id', orId).order('sort_order');
  if (error) throw new Error(error.message);
  return ((data as PlanOp[] | null) ?? []).map((o) => ({ ...o, family_codes: o.family_codes ?? [] }));
}

export type InitResult = { status: 'created' | 'exists' | 'rebuilt' | 'no_service' | 'no_vehicle' | 'no_catalog' | 'no_program'; count: number; source?: string | null };

/** Construit (une seule fois) la liste de l'OR depuis le programme d'entretien de la moto. */
export function initPlanOps(orId: string, rebuild = false): Promise<InitResult> {
  return call<InitResult>('repair_order_operations_init', { _or: orId, _rebuild: rebuild });
}

export async function listPlanOpLines(orId: string): Promise<PlanOpLine[]> {
  const { data, error } = await rpc('repair_order_operations_lines', { _or: orId });
  if (error) return [];
  return (data as PlanOpLine[] | null) ?? [];
}

export type SetResult = { status: PlanOpStatus | 'unchanged'; operation_id: string; mandatory_open?: number };

/** Cocher « fait », marquer « non faite » (motif), revenir « a faire » : trace (qui, quand, pointage). */
export function setPlanOp(opId: string, status: PlanOpStatus, opts: { reason?: string | null; note?: string | null; mechanicCode?: string | null } = {}): Promise<SetResult> {
  return call<SetResult>('repair_order_operation_set', {
    _op: opId, _status: status, _reason: opts.reason ?? null, _note: opts.note ?? null, _mechanic_code: opts.mechanicCode ?? null,
  });
}

export type FinishResult = { status: 'pret'; previous_status: string; time_entries_stopped: number; minutes_stopped: number; sms: { status?: string; reason?: string } | null };

/** « Terminer » : arret des pointages de l'OR puis OR « Pret » (SMS de fin de travaux existant). */
export function finishPlanOps(orId: string): Promise<FinishResult> {
  return call<FinishResult>('repair_order_operations_finish', { _or: orId });
}

/** Texte « operations non realisees » repris dans les notes de la facture (null si aucune / sans migration). */
export async function notDoneTextForInvoice(orId: string): Promise<string | null> {
  if (!(await planOpsSchemaReady())) return null;
  const { data, error } = await rpc('repair_order_operations_not_done_text', { _or: orId });
  if (error) return null;
  return (data as string | null) ?? null;
}

export async function listNotDoneReasons(companyId: string): Promise<NotDoneReason[]> {
  const rows = await listRef(companyId, NOT_DONE_REASON_TABLE_KEY).catch(() => []);
  const out = rows.filter((r) => r.is_active).map((r) => toNotDoneReason({ code: r.code, label: r.label, extra: (r.extra as Record<string, unknown> | null) ?? null }));
  return out;
}

export type PlanProgressRow = { or_id: string; total: number; done: number; not_done: number; mandatory_total: number; mandatory_open: number };

/** Avancement de plusieurs OR (planning) : vue repair_order_plan_progress. */
export async function getPlanProgress(orIds: string[]): Promise<Map<string, PlanProgressRow>> {
  const ids = [...new Set(orIds.filter(Boolean))];
  const out = new Map<string, PlanProgressRow>();
  if (!ids.length || !(await planOpsSchemaReady())) return out;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await loose.from('repair_order_plan_progress').select('*').in('or_id', ids.slice(i, i + 100));
    if (error) return out;
    for (const r of (data as PlanProgressRow[] | null) ?? []) {
      out.set(r.or_id, { ...r, total: Number(r.total), done: Number(r.done), not_done: Number(r.not_done), mandatory_total: Number(r.mandatory_total), mandatory_open: Number(r.mandatory_open) });
    }
  }
  return out;
}
