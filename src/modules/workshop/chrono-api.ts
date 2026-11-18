/**
 * M8 — Chronos atelier (B11) : présence + temps de travail par OR + tâches improductives.
 *
 * Rattrapage G8 du 18/11/2026 (lot « temps MO ») : UNE seule pointeuse, la même table
 * `workshop_time_entries`. Le mécanicien est identifié par son **code mécano** (scanné ou tapé,
 * Paramètres → Tables → Codes mécano) : un poste partagé pointe chacun sous son nom. Sans code
 * (ou migration 20261118110000 pas encore posée), le pointage reste au nom du compte connecté
 * comme avant. Tâche improductive = `kind = 'improductif'` + `task_code` (Paramètres → Tables →
 * Tâches improductives). Démarrer un travail ou une tâche clôt le travail / la tâche en cours.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { labourTimeSchemaReady } from './labour-time/api';

export type TimeEntry = Database['public']['Tables']['workshop_time_entries']['Row'] & {
  /** Colonnes de la migration 20261118110000 (hors types.ts tant qu'elle n'est pas posée). */
  mechanic_code?: string | null;
  task_code?: string | null;
};

/** Qui pointe : un code mécano (poste partagé) ou, sans code, le compte connecté. */
export type MechanicRef = { code: string | null; name: string };

async function uid(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Le code n'est utilisé que si la base connaît la colonne. */
async function codeOf(who: MechanicRef | null | undefined): Promise<string | null> {
  const code = who?.code?.trim() || null;
  if (!code) return null;
  return (await labourTimeSchemaReady()) ? code : null;
}

type Kind = 'presence' | 'travail' | 'improductif';

export async function getOpenEntry(companyId: string, kind: Kind | Kind[], who?: MechanicRef | null): Promise<TimeEntry | null> {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const code = await codeOf(who);
  let q = supabase.from('workshop_time_entries').select('*').eq('company_id', companyId).in('kind', kinds).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
  if (code) q = q.eq('mechanic_code' as never, code as never);
  else { const u = await uid(); if (u) q = q.eq('mechanic_id', u); }
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as TimeEntry | null) ?? null;
}

export async function listTodayEntries(companyId: string): Promise<TimeEntry[]> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { data, error } = await supabase.from('workshop_time_entries').select('*')
    .eq('company_id', companyId).gte('started_at', since.toISOString()).order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

async function closeEntry(id: string, startedAt: string): Promise<void> {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 600) / 100);
  const { error } = await supabase.from('workshop_time_entries').update({ ended_at: new Date().toISOString(), minutes }).eq('id', id);
  if (error) throw error;
}

/** Ligne de pointage : avec code mécano, le compte connecté n'est pas le mécanicien (poste partagé). */
async function entryRow(companyId: string, who: MechanicRef, kind: Kind, extra: Record<string, unknown> = {}) {
  const code = await codeOf(who);
  return {
    company_id: companyId, mechanic_id: code ? null : await uid(), mechanic_name: who.name || null, kind,
    ...(code ? { mechanic_code: code } : {}), ...extra,
  };
}

/** Pointe l'arrivée (ou clôture la présence en cours = départ ; le travail en cours est clos aussi). */
export async function togglePresence(companyId: string, who: MechanicRef): Promise<void> {
  const open = await getOpenEntry(companyId, 'presence', who);
  if (open) {
    const work = await getOpenEntry(companyId, ['travail', 'improductif'], who);
    if (work) await closeEntry(work.id, work.started_at);
    await closeEntry(open.id, open.started_at);
    return;
  }
  const { error } = await supabase.from('workshop_time_entries').insert(await entryRow(companyId, who, 'presence') as never);
  if (error) throw error;
}

/** Démarre le travail sur un OR (clôt le travail ou la tâche en cours). */
export async function startWork(companyId: string, orId: string, who: MechanicRef): Promise<void> {
  const open = await getOpenEntry(companyId, ['travail', 'improductif'], who);
  if (open) await closeEntry(open.id, open.started_at);
  const { error } = await supabase.from('workshop_time_entries').insert(await entryRow(companyId, who, 'travail', { or_id: orId }) as never);
  if (error) throw error;
}

/** Démarre une tâche improductive (nettoyage atelier, motos expo…) ; clôt le travail en cours. */
export async function startTask(companyId: string, taskCode: string, who: MechanicRef): Promise<void> {
  if (!(await labourTimeSchemaReady())) throw new Error('migration 20261118110000');
  const open = await getOpenEntry(companyId, ['travail', 'improductif'], who);
  if (open) await closeEntry(open.id, open.started_at);
  const { error } = await supabase.from('workshop_time_entries').insert(await entryRow(companyId, who, 'improductif', { task_code: taskCode }) as never);
  if (error) throw error;
}

/** Arrête le travail ou la tâche en cours. */
export async function stopWork(companyId: string, who?: MechanicRef | null): Promise<void> {
  const open = await getOpenEntry(companyId, ['travail', 'improductif'], who);
  if (open) await closeEntry(open.id, open.started_at);
}

export async function orWorkedMinutes(orId: string): Promise<number> {
  const { data, error } = await supabase.rpc('or_worked_minutes', { _or: orId });
  if (error) throw error;
  return Number(data ?? 0);
}
