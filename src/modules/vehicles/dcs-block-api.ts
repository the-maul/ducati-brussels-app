/**
 * Data of the « Données DCS » block (VEH001). Tables and functions of migration 20261123140000,
 * outside the generated types until they are regenerated.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DcsClientRow, DcsFieldRow, DcsIdentityCandidate } from './dcs-block-rules';

type RpcResult = { data: unknown; error: { message: string; code?: string; hint?: string; details?: string } | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
const loose = supabase as unknown as {
  from: (t: string) => {
    select: (c: string, o?: { count: 'exact'; head: boolean }) => {
      eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown; count?: number | null }> & {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export type DcsBlockData = { statuses: DcsFieldRow[]; client: DcsClientRow | null; events: number; bulletins: number };
export type DcsMatch = {
  id: string; name: string | null; code: string | null; city: string | null;
  is_active: boolean; is_owner: boolean; reasons: Array<'code' | 'email' | 'phone' | 'name'>;
};

const CLIENT_COLUMNS = 'full_name, first_name, last_name, email, mobile, address, postal_code, city, region, country, country_code, birth_date, ducati_code, read_at';

export async function loadDcsBlock(vehicleId: string): Promise<DcsBlockData> {
  const [statuses, client, events, bulletins] = await Promise.all([
    loose.from('vehicle_field_status').select('field, status, dcs_value, previous_value, source, updated_at').eq('vehicle_id', vehicleId),
    // Table absent until the migration is applied: the block simply shows no customer.
    loose.from('vehicle_dcs_client').select(CLIENT_COLUMNS).eq('vehicle_id', vehicleId).maybeSingle(),
    loose.from('vehicle_maintenance').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
    loose.from('vehicle_bulletins').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
  ]);
  if (statuses.error) throw statuses.error;
  return {
    statuses: (statuses.data ?? []) as DcsFieldRow[],
    client: client.error ? null : (client.data as DcsClientRow | null),
    events: events.count ?? 0,
    bulletins: bulletins.count ?? 0,
  };
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const loadDcsMatches = (companyId: string, vehicleId: string) =>
  call<DcsMatch[]>('dcs_client_matches', { _company: companyId, _vehicle: vehicleId });

export async function loadDcsModelCandidates(vin: string): Promise<DcsIdentityCandidate[]> {
  const r = await call<{ candidates?: DcsIdentityCandidate[] } | null>('vin_identify', { _vin: vin });
  return r?.candidates ?? [];
}

export type DcsResolveInput = {
  companyId: string; vehicleId: string; field: string; choice: 'keep' | 'dcs';
  seen?: string | null; candidate?: string | null; modelLabel?: string | null; forceLower?: boolean;
};

export const resolveDcsField = (i: DcsResolveInput) => call<{ filled?: string[] }>('dcs_resolve_field', {
  _company: i.companyId, _vehicle: i.vehicleId, _field: i.field, _choice: i.choice, _seen: i.seen ?? null,
  _candidate: i.candidate ?? null, _model_label: i.modelLabel ?? null, _force_lower: i.forceLower ?? false,
});

export const attachDcsClient = (companyId: string, vehicleId: string, contactId: string) =>
  call<unknown>('dcs_client_attach', { _company: companyId, _vehicle: vehicleId, _contact: contactId });

export const createDcsClient = (companyId: string, vehicleId: string, confirmDuplicate: boolean) =>
  call<{ contact_id: string }>('dcs_client_create_attach', {
    _company: companyId, _vehicle: vehicleId, _confirm_duplicate: confirmDuplicate,
  });
