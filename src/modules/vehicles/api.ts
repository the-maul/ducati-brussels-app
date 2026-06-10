/**
 * M3 — Accès données Véhicules (RLS : filtré par société).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Vehicle = Database['public']['Tables']['vehicles']['Row'];
export type VehicleInsert = Database['public']['Tables']['vehicles']['Insert'];
export type VehicleUpdate = Database['public']['Tables']['vehicles']['Update'];
export type VehicleStatus = Database['public']['Enums']['vehicle_status'];
export type MileageQualif = Database['public']['Enums']['mileage_qualif'];
export type VehicleOwner = Database['public']['Tables']['vehicle_owners']['Row'];

/** Statuts du parc (VEH007) → libellé + tonalité de badge. */
export const VEHICLE_STATUSES: { value: VehicleStatus; tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger' }[] = [
  { value: 'en_commande', tone: 'info' },
  { value: 'stock_vn', tone: 'success' },
  { value: 'stock_vo', tone: 'success' },
  { value: 'depot_vente', tone: 'info' },
  { value: 'reserve', tone: 'warning' },
  { value: 'vendu', tone: 'neutral' },
  { value: 'livre', tone: 'neutral' },
  { value: 'courtoisie', tone: 'info' },
  { value: 'demo', tone: 'info' },
  { value: 'depot_agent', tone: 'info' },
  { value: 'repris', tone: 'warning' },
];

export function vehicleLabel(v: Pick<Vehicle, 'brand' | 'model' | 'vin'>): string {
  return [v.brand, v.model].filter(Boolean).join(' ') || v.vin || '—';
}

function sanitize(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim();
}

export async function listVehicles(companyId: string, search?: string, status?: VehicleStatus | 'all'): Promise<Vehicle[]> {
  let q = supabase.from('vehicles').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500);
  if (status && status !== 'all') q = q.eq('status', status);
  const s = search ? sanitize(search) : '';
  if (s) {
    q = q.or([`vin.ilike.%${s}%`, `plate.ilike.%${s}%`, `model.ilike.%${s}%`, `brand.ilike.%${s}%`, `engine_number.ilike.%${s}%`].join(','));
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createVehicle(input: VehicleInsert): Promise<Vehicle> {
  const { data, error } = await supabase.from('vehicles').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id: string, input: VehicleUpdate): Promise<Vehicle> {
  const { data, error } = await supabase.from('vehicles').update(input).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Historique des propriétaires d'un véhicule (le plus récent en premier). */
export async function listOwners(vehicleId: string): Promise<VehicleOwner[]> {
  const { data, error } = await supabase
    .from('vehicle_owners').select('*').eq('vehicle_id', vehicleId).order('from_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
