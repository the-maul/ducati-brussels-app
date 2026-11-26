/**
 * VEH001 — « la plaque suit le motard » : historique des plaques d'une moto et motos qui portent déjà
 * une plaque (migration 20261126220000 : table vehicle_plate_history, RPC vehicle_plate_conflicts).
 * Pas encore dans types.ts : accès non typé, table ou fonction absente = liste vide.
 */
import { supabase } from '@/integrations/supabase/client';
import { isMissingSchemaError } from './fiche-g8-api';
import type { PlateHistoryRow } from './plate-history';

type PgErr = { code?: string; message: string };
type Res<T> = { data: T | null; error: PgErr | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export async function listPlateHistory(vehicleId: string): Promise<PlateHistoryRow[]> {
  const { data, error }: Res<PlateHistoryRow[]> = await db.from('vehicle_plate_history')
    .select('id, plate, from_date, to_date, is_current, reason, created_at')
    .eq('vehicle_id', vehicleId);
  if (error) { if (isMissingSchemaError(error)) return []; throw new Error(error.message); }
  return data ?? [];
}

export type PlateConflict = {
  vehicle_id: string;
  vin: string | null;
  brand: string | null;
  model: string | null;
  model_year: number | null;
  owner_name: string | null;
  /** true : même motard, la plaque sera enlevée de cette moto à l'enregistrement. */
  same_rider: boolean;
};

/** Autres motos de la société qui portent déjà cette plaque. */
export async function listPlateConflicts(p: {
  companyId: string; plate: string; vehicleId?: string | null; contactId?: string | null;
}): Promise<PlateConflict[]> {
  const { data, error }: Res<PlateConflict[]> = await db.rpc('vehicle_plate_conflicts', {
    _company: p.companyId, _plate: p.plate, _vehicle: p.vehicleId ?? null, _contact: p.contactId ?? null,
  });
  if (error) { if (isMissingSchemaError(error) || error.code === 'PGRST202') return []; throw new Error(error.message); }
  return data ?? [];
}
