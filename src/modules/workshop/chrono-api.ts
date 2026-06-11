/**
 * M8 — Chronos atelier (B11) : présence + temps de travail par OR.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type TimeEntry = Database['public']['Tables']['workshop_time_entries']['Row'];

async function uid(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function getOpenEntry(companyId: string, kind: 'presence' | 'travail'): Promise<TimeEntry | null> {
  const u = await uid();
  let q = supabase.from('workshop_time_entries').select('*').eq('company_id', companyId).eq('kind', kind).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
  if (u) q = q.eq('mechanic_id', u);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listTodayEntries(companyId: string): Promise<TimeEntry[]> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { data, error } = await supabase.from('workshop_time_entries').select('*')
    .eq('company_id', companyId).gte('started_at', since.toISOString()).order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function closeEntry(id: string, startedAt: string): Promise<void> {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 600) / 100);
  const { error } = await supabase.from('workshop_time_entries').update({ ended_at: new Date().toISOString(), minutes }).eq('id', id);
  if (error) throw error;
}

/** Pointe l'arrivée (ou clôture la présence en cours = départ). */
export async function togglePresence(companyId: string, mechanicName: string): Promise<void> {
  const open = await getOpenEntry(companyId, 'presence');
  if (open) { await closeEntry(open.id, open.started_at); return; }
  const { error } = await supabase.from('workshop_time_entries').insert({ company_id: companyId, mechanic_id: await uid(), mechanic_name: mechanicName || null, kind: 'presence' });
  if (error) throw error;
}

/** Démarre le travail sur un OR (clôt le pointage de travail précédent s'il y en a un). */
export async function startWork(companyId: string, orId: string, mechanicName: string): Promise<void> {
  const open = await getOpenEntry(companyId, 'travail');
  if (open) await closeEntry(open.id, open.started_at);
  const { error } = await supabase.from('workshop_time_entries').insert({ company_id: companyId, mechanic_id: await uid(), mechanic_name: mechanicName || null, kind: 'travail', or_id: orId });
  if (error) throw error;
}

export async function stopWork(companyId: string): Promise<void> {
  const open = await getOpenEntry(companyId, 'travail');
  if (open) await closeEntry(open.id, open.started_at);
}

export async function orWorkedMinutes(orId: string): Promise<number> {
  const { data, error } = await supabase.rpc('or_worked_minutes', { _or: orId });
  if (error) throw error;
  return Number(data ?? 0);
}
