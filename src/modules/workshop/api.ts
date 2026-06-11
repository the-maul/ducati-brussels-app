/**
 * M8 — Atelier : lectures des ordres de réparation (OR).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type RepairOrder = Database['public']['Tables']['repair_orders']['Row'];
export type RepairOrderLine = Database['public']['Tables']['repair_order_lines']['Row'];

export async function listRepairOrders(companyId: string, status?: string): Promise<RepairOrder[]> {
  let q = supabase.from('repair_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type VehicleLite = { id: string; vin: string | null; plate: string | null; brand: string | null; model: string | null };
/** Recherche véhicule (VIN, plaque, modèle) pour l'en-tête d'OR. */
export async function searchVehicles(companyId: string, term: string): Promise<VehicleLite[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = supabase.from('vehicles').select('id, vin, plate, brand, model').eq('company_id', companyId).limit(8);
  if (s) q = q.or(`vin.ilike.%${s}%,plate.ilike.%${s}%,model.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type RepairOrderFull = { or: RepairOrder; lines: RepairOrderLine[] };
export async function getRepairOrderFull(id: string): Promise<RepairOrderFull> {
  const [{ data: or, error: oe }, { data: lines, error: le }] = await Promise.all([
    supabase.from('repair_orders').select('*').eq('id', id).single(),
    supabase.from('repair_order_lines').select('*').eq('or_id', id).order('sort_order'),
  ]);
  if (oe) throw oe; if (le) throw le;
  return { or: or as RepairOrder, lines: lines ?? [] };
}
