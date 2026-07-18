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

/**
 * IDs des véhicules dont un propriétaire (actuel ou passé) correspond au nom recherché.
 * Réutilise le RPC `contacts_search` (accent-insensible, par mots) pour rester cohérent
 * avec la recherche de l'écran Contacts, puis remonte aux véhicules via `vehicle_owners`.
 * Plafonné pour garder l'URL de la requête raisonnable.
 */
async function vehicleIdsByOwnerName(companyId: string, search: string): Promise<string[]> {
  const { data: contacts, error } = await supabase.rpc('contacts_search', {
    _company: companyId, _q: search, _type: null, _limit: 200, _offset: 0,
  });
  if (error) throw error;
  const contactIds = ((contacts as { id: string }[] | null) ?? []).map((c) => c.id);
  if (contactIds.length === 0) return [];
  const { data: owners, error: oe } = await supabase
    .from('vehicle_owners').select('vehicle_id').in('contact_id', contactIds).limit(1000);
  if (oe) throw oe;
  const ids = [...new Set(((owners ?? []) as { vehicle_id: string }[]).map((o) => o.vehicle_id))];
  return ids.slice(0, 300);
}

export async function listVehicles(companyId: string, search?: string, status?: VehicleStatus | 'all'): Promise<Vehicle[]> {
  let q = supabase.from('vehicles').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500);
  if (status && status !== 'all') q = q.eq('status', status);
  const s = search ? sanitize(search) : '';
  if (s) {
    const ors = [`vin.ilike.%${s}%`, `plate.ilike.%${s}%`, `model.ilike.%${s}%`, `brand.ilike.%${s}%`, `engine_number.ilike.%${s}%`];
    // Recherche aussi par nom de client : véhicules rattachés à un contact correspondant.
    const ownerVehicleIds = await vehicleIdsByOwnerName(companyId, search!);
    if (ownerVehicleIds.length) ors.push(`id.in.(${ownerVehicleIds.join(',')})`);
    q = q.or(ors.join(','));
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

/**
 * Retire du payload la colonne signalée « inconnue » par PostgREST (migration pas
 * encore appliquée) pour pouvoir réessayer sans elle. Retourne null si l'erreur
 * n'est pas une colonne manquante → l'appelant relance l'erreur d'origine.
 * Rend l'ajout de champs (ex. papers_100hp) tolérant au décalage de migration.
 */
function stripUnknownColumn(
  payload: Record<string, unknown>,
  error: { code?: string; message?: string } | null,
): Record<string, unknown> | null {
  if (!error) return null;
  // PGRST204 : "Could not find the 'X' column of 'vehicles' in the schema cache"
  // 42703   : "column vehicles.X does not exist"
  if (error.code !== 'PGRST204' && error.code !== '42703') return null;
  const m = error.message?.match(/'([^']+)' column/) ?? error.message?.match(/column [\w.]*?\.?(\w+) does not exist/i);
  const col = m?.[1];
  if (!col || !(col in payload)) return null;
  const rest = { ...payload };
  delete rest[col];
  return rest;
}

export async function createVehicle(input: VehicleInsert): Promise<Vehicle> {
  let payload: Record<string, unknown> = { ...input };
  for (let i = 0; i < 8; i++) {
    const { data, error } = await supabase.from('vehicles').insert(payload as VehicleInsert).select().single();
    if (!error) return data;
    const stripped = stripUnknownColumn(payload, error);
    if (!stripped) throw error;
    payload = stripped;
  }
  const { data, error } = await supabase.from('vehicles').insert(payload as VehicleInsert).select().single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id: string, input: VehicleUpdate): Promise<Vehicle> {
  let payload: Record<string, unknown> = { ...input };
  for (let i = 0; i < 8; i++) {
    const { data, error } = await supabase.from('vehicles').update(payload as VehicleUpdate).eq('id', id).select().single();
    if (!error) return data;
    const stripped = stripUnknownColumn(payload, error);
    if (!stripped) throw error;
    payload = stripped;
  }
  const { data, error } = await supabase.from('vehicles').update(payload as VehicleUpdate).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Historique des propriétaires d'un véhicule (le plus récent en premier). */
export type VehicleOwnerWithContact = VehicleOwner & {
  contact: { id: string; first_name: string | null; last_name: string | null; company_name: string | null } | null;
};

export async function listOwners(vehicleId: string): Promise<VehicleOwnerWithContact[]> {
  const { data, error } = await supabase
    .from('vehicle_owners')
    .select('*, contact:contacts(id, first_name, last_name, company_name)')
    .eq('vehicle_id', vehicleId).order('from_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as VehicleOwnerWithContact[];
}

/** Factures / OR / devis rattachés à un véhicule (historique de la moto). */
export type VehicleDocument = { id: string; number: string | null; doc_type: string; issue_date: string; total_ttc: number; status: string };
export async function listVehicleDocuments(vehicleId: string): Promise<VehicleDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, number, doc_type, issue_date, total_ttc, status')
    .eq('vehicle_id', vehicleId).order('issue_date', { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, total_ttc: Number(d.total_ttc) }));
}
