/**
 * M8 — Operations a echeance (ATE014, 26/11/2026) : acces base. Fonctions de la migration
 * 20261126270000 (hors types.ts : appels non types). Regles pures : `./due-rules.ts`.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DueContext } from './due-rules';

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>).call(supabase, fn, args);

const asContext = (d: unknown): DueContext | null => {
  const c = d as DueContext | null;
  if (!c || !c.now_date) return null;
  return { ...c, periodic: c.periodic ?? [], evidence: c.evidence ?? [] };
};

/** Contexte de l'OR (date et km de l'OR, son entretien, l'historique de sa moto). null sans migration. */
export async function getOrDueContext(orId: string): Promise<DueContext | null> {
  const { data, error } = await rpc('workshop_periodic_due_context', { _vehicle: null, _service: null, _or: orId });
  if (error) return null;
  return asContext(data);
}

/** Contexte d'une moto pour un entretien, aujourd'hui (kit du RDV, fiche moto). */
export async function getVehicleDueContext(vehicleId: string, serviceCode: string): Promise<DueContext | null> {
  const { data, error } = await rpc('workshop_periodic_due_context', { _vehicle: vehicleId, _service: serviceCode, _or: null });
  if (error) return null;
  return asContext(data);
}

/** « Faire quand meme » (true) une operation pas a echeance, ou la laisser de nouveau a la regle (false). */
export async function forceDueOperation(opId: string, force: boolean): Promise<void> {
  const { error } = await rpc('repair_order_operation_due_force', { _op: opId, _force: force });
  if (error) throw new Error(error.message);
}
