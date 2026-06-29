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

/** 1ère moto liée au contact (la plus récente / courante) — pour la synchro My Ducati par VIN. */
export async function firstContactVehicle(contactId: string): Promise<{ id: string; vin: string | null } | null> {
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('vehicle:vehicles(id, vin)')
    .eq('contact_id', contactId)
    .order('is_current', { ascending: false })
    .order('from_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const v = (data as { vehicle?: { id: string; vin: string | null } } | null)?.vehicle;
  return v ? { id: v.id, vin: v.vin ?? null } : null;
}

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

export type OwnedVehicle = { ownerId: string; is_current: boolean; from_date: string; to_date: string | null; owner_kind: string | null; vehicle: Vehicle };

/** Parc du client : véhicules dont il est (ou a été) propriétaire (B9). */
export async function listOwnedVehicles(contactId: string): Promise<OwnedVehicle[]> {
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('id, is_current, from_date, to_date, owner_kind, vehicles(*)')
    .eq('contact_id', contactId)
    .order('from_date', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.vehicles)
    .map((r) => ({ ownerId: r.id, is_current: r.is_current, from_date: r.from_date, to_date: r.to_date, owner_kind: (r as { owner_kind: string | null }).owner_kind, vehicle: r.vehicles as unknown as Vehicle }));
}

/** Rattache une moto liée au compte « pro » ou « privé » du client (recoupement Ducati). */
export async function setOwnerKind(ownerId: string, kind: 'pro' | 'prive'): Promise<void> {
  const { error } = await supabase.from('vehicle_owners').update({ owner_kind: kind }).eq('id', ownerId);
  if (error) throw error;
}

export type Subcontact = Database['public']['Tables']['contact_subcontacts']['Row'];
export type SubcontactInsert = Database['public']['Tables']['contact_subcontacts']['Insert'];

export async function listSubcontacts(contactId: string): Promise<Subcontact[]> {
  const { data, error } = await supabase.from('contact_subcontacts').select('*').eq('contact_id', contactId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function upsertSubcontact(row: SubcontactInsert): Promise<void> {
  const { error } = await supabase.from('contact_subcontacts').upsert(row);
  if (error) throw error;
}
export async function deleteSubcontact(id: string): Promise<void> {
  const { error } = await supabase.from('contact_subcontacts').delete().eq('id', id);
  if (error) throw error;
}
