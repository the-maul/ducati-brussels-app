/**
 * M1 — Sous-objets de la fiche client : adresses de livraison, tarifs à paliers, parc (VIN liés).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { Vehicle } from '@/modules/vehicles/api';
import type { Contact, ContactInsert } from './api';

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

export type OwnedVehicle = { ownerId: string; is_current: boolean; from_date: string; to_date: string | null; ownerContactId: string; vehicle: Vehicle };

/** Parc d'un (ou plusieurs) contact(s) : véhicules dont ils sont/ont été propriétaires (B9). */
export async function listOwnedVehicles(contactIds: string | string[]): Promise<OwnedVehicle[]> {
  const ids = Array.isArray(contactIds) ? contactIds : [contactIds];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('id, contact_id, is_current, from_date, to_date, vehicles(*)')
    .in('contact_id', ids)
    .order('from_date', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.vehicles)
    .map((r) => ({ ownerId: r.id, is_current: r.is_current, from_date: r.from_date, to_date: r.to_date, ownerContactId: r.contact_id as string, vehicle: r.vehicles as unknown as Vehicle }));
}

/* ---------------- Liaison entre fiches (pro ↔ privé, M:N) ---------------- */
export type ContactLink = { linkId: string; contact: Contact };

/** Fiches liées à ce contact (l'autre extrémité du lien). */
export async function listLinkedContacts(contactId: string): Promise<ContactLink[]> {
  const { data: links, error } = await supabase
    .from('contact_links').select('id, contact_a, contact_b')
    .or(`contact_a.eq.${contactId},contact_b.eq.${contactId}`);
  if (error) throw error;
  const rows = links ?? [];
  const otherIds = rows.map((r) => (r.contact_a === contactId ? r.contact_b : r.contact_a));
  if (otherIds.length === 0) return [];
  const { data: contacts, error: e2 } = await supabase.from('contacts').select('*').in('id', otherIds);
  if (e2) throw e2;
  const byId = new Map((contacts ?? []).map((c) => [c.id, c as Contact]));
  return rows.map((r) => ({ linkId: r.id, contact: byId.get(r.contact_a === contactId ? r.contact_b : r.contact_a)! }))
    .filter((x) => x.contact);
}

/** Lie deux fiches (paire non ordonnée ; ignore le doublon). */
export async function linkContact(companyId: string, a: string, b: string): Promise<void> {
  const { error } = await supabase.from('contact_links').insert({ company_id: companyId, contact_a: a, contact_b: b });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

export async function unlinkContact(linkId: string): Promise<void> {
  const { error } = await supabase.from('contact_links').delete().eq('id', linkId);
  if (error) throw error;
}

/** Crée une nouvelle fiche (pré-remplie depuis `source` : nom + adresse + contacts) et la lie. */
export async function createLinkedContact(
  companyId: string,
  source: Contact,
  targetType: 'particulier' | 'professionnel',
  opts?: { inheritContact: boolean; inheritAddress: boolean },
): Promise<string> {
  const inheritContact = opts?.inheritContact ?? true;
  const inheritAddress = opts?.inheritAddress ?? true;
  const ins = {
    company_id: companyId,
    type: targetType,
    last_name: targetType === 'particulier' ? (source.last_name ?? source.company_name ?? null) : null,
    company_name: targetType === 'professionnel' ? (source.company_name ?? source.last_name ?? null) : null,
    first_name: source.first_name ?? null,
    civility: source.civility ?? null,
    email: inheritContact ? (source.email ?? null) : null,
    phone: inheritContact ? (source.phone ?? null) : null,
    mobile: inheritContact ? (source.mobile ?? null) : null,
    address: inheritAddress ? (source.address ?? null) : null,
    zip: inheritAddress ? (source.zip ?? null) : null,
    city: inheritAddress ? (source.city ?? null) : null,
    address_complement: inheritAddress ? (source.address_complement ?? null) : null,
    country: inheritAddress ? (source.country ?? 'BE') : 'BE',
  } as ContactInsert;
  const { data, error } = await supabase.from('contacts').insert(ins).select('id').single();
  if (error) throw error;
  await linkContact(companyId, source.id, data.id as string);
  return data.id as string;
}

/** Recherche de fiches à lier (par nom / société / code), excluant le contact courant. */
export async function searchContactsToLink(companyId: string, q: string, excludeId: string): Promise<Contact[]> {
  if (!q.trim()) return [];
  const { data, error } = await supabase.from('contacts').select('*')
    .eq('company_id', companyId)
    .or(`last_name.ilike.%${q}%,company_name.ilike.%${q}%,code.ilike.%${q}%`)
    .neq('id', excludeId).limit(10);
  if (error) throw error;
  return (data ?? []) as Contact[];
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
