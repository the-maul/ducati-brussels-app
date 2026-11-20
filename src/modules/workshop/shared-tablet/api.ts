/**
 * M8 — Q60 (20/11/2026) : acces base de la tablette partagee (migration 20261120100000, hors
 * types.ts : appels non types). Sans la migration, `getTabletMode` repond « personnel » : les
 * ecrans gardent leur comportement d'avant.
 */
import { supabase } from '@/integrations/supabase/client';
import type { IdentifyResponse, SharedMechanic, TabletMode } from './rules';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args);

/** Erreur de la base avec son SQLSTATE (28000 = identite a redemander). */
export async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

export async function getTabletMode(companyId: string): Promise<{ mode: TabletMode; ttlSeconds: number; ready: boolean }> {
  try {
    const r = await call<{ mode: TabletMode; ttl_seconds: number }>('workshop_tablet_mode', { _company: companyId });
    return { mode: r?.mode === 'shared' ? 'shared' : 'personal', ttlSeconds: Number(r?.ttl_seconds) || 120, ready: true };
  } catch {
    return { mode: 'personal', ttlSeconds: 120, ready: false };
  }
}

export async function listSharedMechanics(companyId: string): Promise<SharedMechanic[]> {
  return (await call<SharedMechanic[] | null>('workshop_shared_mechanics', { _company: companyId })) ?? [];
}

export function identify(companyId: string, mechanicId: string, pin: string): Promise<IdentifyResponse> {
  return call<IdentifyResponse>('workshop_shared_identify', { _company: companyId, _mechanic: mechanicId, _pin: pin });
}

export async function endSharedSession(session: string): Promise<void> {
  await call('workshop_shared_end', { _session: session }).catch(() => undefined);
}

export function sharedTrace(session: string, action: string, entityType: string | null, entityId: string | null, data: Record<string, unknown> | null = null): Promise<unknown> {
  return call('workshop_shared_trace', { _session: session, _action: action, _entity_type: entityType, _entity_id: entityId, _data: data });
}

export type SharedCurrent = {
  mechanic_name: string; expires_at: string;
  open: SharedEntry | null; last: SharedEntry | null;
};
export type SharedEntry = {
  id: string; kind: string; or_id: string | null; started_at: string; ended_at: string | null;
  stop_kind: string | null; stop_reason: string | null; journey_operation: string | null; mechanic_name: string | null;
};
export function sharedCurrent(session: string): Promise<SharedCurrent> {
  return call<SharedCurrent>('workshop_shared_current', { _session: session });
}

// ------------------------------------------------------------------ reglages (admin, chef d'atelier)
export type TabletAccount = { user_id: string; name: string; email: string | null; roles: string[]; mode: TabletMode };
export async function listTabletAccounts(companyId: string): Promise<TabletAccount[]> {
  return (await call<TabletAccount[] | null>('workshop_tablet_accounts_list', { _company: companyId })) ?? [];
}
export function setTabletMode(companyId: string, userId: string, mode: TabletMode): Promise<{ mode: TabletMode; mechanic_card_hidden: boolean }> {
  return call('workshop_tablet_mode_set', { _company: companyId, _user: userId, _mode: mode });
}
/** Code a 4 chiffres d'un compagnon ; vide = retire. Le code n'est jamais relu. */
export function setMechanicPin(mechanicId: string, pin: string | null): Promise<{ status: 'set' | 'cleared' }> {
  return call('workshop_mechanic_pin_set', { _mechanic: mechanicId, _pin: pin });
}

/** Duree de l'identite collee (secondes, 30 a 900) : Planning → Reglages → Tablettes. */
export async function saveSharedIdentitySeconds(companyId: string, seconds: number): Promise<void> {
  const sb = supabase as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }> } } };
  const n = Math.round(Number(seconds));
  if (!Number.isInteger(n) || n < 30 || n > 900) throw new Error('30-900');
  const { error } = await sb.from('workshop_planning_settings').update({ shared_identity_seconds: n }).eq('company_id', companyId);
  if (error) throw new Error(error.message);
}
