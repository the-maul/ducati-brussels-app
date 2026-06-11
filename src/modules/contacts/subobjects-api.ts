/**
 * M1 — Sous-objets de la fiche client : adresses de livraison, tarifs à paliers, parc (VIN liés).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { Vehicle } from '@/modules/vehicles/api';

export type DeliveryAddress = Database['public']['Tables']['delivery_addresses']['Row'];
export type DeliveryAddressInsert = Database['public']['Tables']['delivery_addresses']['Insert'];
export type ClientPriceRule = Database['public']['Tables']['client_price_rules']['Row'];
export type ClientPriceRuleInsert = Database['public']['Tables']['client_price_rules']['Insert'];

export async function listDeliveryAddresses(contactId: string): Promise<DeliveryAddress[]> {
  const { data, error } = await supabase.from('delivery_addresses').select('*').eq('contact_id', contactId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function upsertDeliveryAddress(row: DeliveryAddressInsert): Promise<void> {
  const { error } = await supabase.from('delivery_addresses').upsert(row);
  if (error) throw error;
}
export async function deleteDeliveryAddress(id: string): Promise<void> {
  const { error } = await supabase.from('delivery_addresses').delete().eq('id', id);
  if (error) throw error;
}

export async function listClientPriceRules(contactId: string): Promise<ClientPriceRule[]> {
  const { data, error } = await supabase.from('client_price_rules').select('*').eq('contact_id', contactId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function upsertClientPriceRule(row: ClientPriceRuleInsert): Promise<void> {
  const { error } = await supabase.from('client_price_rules').upsert(row);
  if (error) throw error;
}
export async function deleteClientPriceRule(id: string): Promise<void> {
  const { error } = await supabase.from('client_price_rules').delete().eq('id', id);
  if (error) throw error;
}

export type OwnedVehicle = { ownerId: string; is_current: boolean; from_date: string; to_date: string | null; vehicle: Vehicle };

/** Parc du client : véhicules dont il est (ou a été) propriétaire (B9). */
export async function listOwnedVehicles(contactId: string): Promise<OwnedVehicle[]> {
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('id, is_current, from_date, to_date, vehicles(*)')
    .eq('contact_id', contactId)
    .order('from_date', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.vehicles)
    .map((r) => ({ ownerId: r.id, is_current: r.is_current, from_date: r.from_date, to_date: r.to_date, vehicle: r.vehicles as unknown as Vehicle }));
}
