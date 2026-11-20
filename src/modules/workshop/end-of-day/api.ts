/**
 * M8 — Q57 (20/11/2026) : acces base de la question de fin de journee (migration 20261120101000,
 * hors types.ts). Sans la migration : aucune question (liste vide), comportement d'avant.
 */
import { supabase } from '@/integrations/supabase/client';
import type { EndOfDayDue } from './rules';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

/** Pointages ouverts de la societe dont la question est posee (mode « question » seulement). */
export async function listEndOfDayDue(companyId: string): Promise<EndOfDayDue[]> {
  try {
    return (await call<EndOfDayDue[] | null>('workshop_end_of_day_due', { _company: companyId })) ?? [];
  } catch {
    return [];
  }
}

export type EndOfDayAnswer = { status: 'continue' | 'paused' | 'already_closed'; next_ask_at?: string };

/** « Oui, je continue » / « Mettre en pause » ; `session` = identite de la tablette partagee (Q60). */
export function answerEndOfDay(entryId: string, answer: 'continue' | 'pause', session: string | null = null): Promise<EndOfDayAnswer> {
  return call<EndOfDayAnswer>('workshop_end_of_day_answer', { _entry: entryId, _answer: answer, _session: session });
}
