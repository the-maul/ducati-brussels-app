/**
 * M3 — Accès données Véhicules (RLS : filtré par société).
 */
import { motoName } from '@/lib/moto-name';
import { vinHitsFirst } from './vehicle-pick';
import { parseVinQuery, vinLikePattern, vinMatchesQuery } from '@/lib/vin-search';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

/**
 * Mission 03, M-40 : `to_complete` / `to_complete_reason` sont ajoutés par la migration
 * 20260923180000 ; `types.ts` n'a pas encore été régénéré, d'où l'extension locale.
 */
export type Vehicle = Database['public']['Tables']['vehicles']['Row'] & {
  to_complete?: boolean | null;
  to_complete_reason?: string | null;
};
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
  return motoName(v) || v.vin || '—';
}

/** Marque et modèle : pour ce qui part chez le client (e-mail, message). */
export function vehicleFullLabel(v: Pick<Vehicle, 'brand' | 'model' | 'vin'>): string {
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

/** Véhicule + son éventuel dossier de reprise (référence REP cliquable en liste). */
export type VehicleWithRep = Vehicle & { oro?: { id: string; number: string | null }[] };

/**
 * Mission 03, M-40 : `toComplete` ne garde que les motos « à compléter » (fiche créée depuis une
 * annonce du site sans VIN, ou prix d'achat manquant) — elles ne peuvent pas être facturées.
 */
export async function listVehicles(companyId: string, search?: string, status?: VehicleStatus | 'all', toComplete?: boolean): Promise<VehicleWithRep[]> {
  return (await fetchVehicleList(companyId, search, status, toComplete, 0, 499, false)).rows;
}

export const VEHICLES_PAGE_SIZE = 50;

/** Une page de la liste des motos, avec le nombre total pour la navigation. */
export async function listVehiclesPage(
  companyId: string, search: string | undefined, status: VehicleStatus | 'all' | undefined, toComplete: boolean | undefined, page: number,
  trackBike = false,
): Promise<{ rows: VehicleWithRep[]; total: number }> {
  const from = Math.max(0, Math.floor(page)) * VEHICLES_PAGE_SIZE;
  try {
    return await fetchVehicleList(companyId, search, status, toComplete, from, from + VEHICLES_PAGE_SIZE - 1, true, trackBike);
  } catch (e) {
    // Page devenue trop loin (filtre, moto retirée) : on repart de la première.
    if (from > 0 && (e as { code?: string }).code === 'PGRST103') return listVehiclesPage(companyId, search, status, toComplete, 0, trackBike);
    throw e;
  }
}

async function fetchVehicleList(
  companyId: string, search: string | undefined, status: VehicleStatus | 'all' | undefined, toComplete: boolean | undefined,
  from: number, to: number, withCount: boolean, trackBike = false,
): Promise<{ rows: VehicleWithRep[]; total: number }> {
  // Jointure oro(id, number) : affiche la référence REP des demandes de reprise.
  // Repli sans jointure si elle échoue (la liste ne doit jamais casser).
  const build = (select: string) => {
    // Une fiche réunie dans une autre (même VIN) est désactivée : elle ne s'affiche plus dans le parc.
    let q = supabase.from('vehicles').select(select as '*', withCount ? { count: 'exact' } : undefined).eq('company_id', companyId).eq('is_active', true)
      .order('created_at', { ascending: false }).order('id').range(from, to);
    if (status && status !== 'all') q = q.eq('status', status);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (toComplete) q = (q as any).eq('to_complete', true);
    // Motos piste (Simon, 26/11/2026) : sans plaque, retrouvées par ce filtre.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (trackBike) q = (q as any).eq('is_track_bike', true);
    return q;
  };
  const s = search ? sanitize(search) : '';
  let ownerOr = '';
  if (s) {
    const ors = [`vin.ilike.%${s}%`, `plate.ilike.%${s}%`, `model.ilike.%${s}%`, `brand.ilike.%${s}%`, `engine_number.ilike.%${s}%`];
    // Recherche aussi par nom de client : véhicules rattachés à un contact correspondant.
    const ownerVehicleIds = await vehicleIdsByOwnerName(companyId, search!);
    if (ownerVehicleIds.length) ors.push(`id.in.(${ownerVehicleIds.join(',')})`);
    ownerOr = ors.join(',');
  }
  let q = build('*, oro(id, number)');
  if (ownerOr) q = q.or(ownerOr);
  let { data, error, count } = await q;
  if (error) {
    let q2 = build('*');
    if (ownerOr) q2 = q2.or(ownerOr);
    ({ data, error, count } = await q2);
    if (error) throw error;
  }
  const rows = (data ?? []) as unknown as VehicleWithRep[];
  return { rows, total: count ?? rows.length };
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

/* ------------------------------------------------------------------------
 * Mission 04, carte 6 — moto d'un client créée depuis sa fiche.
 * Migration : supabase/migrations/20260919300000_m3_moto_client_depuis_fiche.sql.
 * ---------------------------------------------------------------------- */

/** Moto de la société qui porte déjà un VIN (doublon), avec son propriétaire actuel. */
export type VinMatch = {
  id: string; brand: string | null; model: string | null; plate: string | null; vin: string | null;
  status: VehicleStatus; owner_id: string | null; owner_name: string | null;
};

export async function findVehiclesByVin(companyId: string, vin: string, excludeId?: string | null): Promise<VinMatch[]> {
  const { data, error } = await supabase.rpc('vehicles_find_by_vin', {
    _company: companyId, _vin: vin, ...(excludeId ? { _exclude: excludeId } : {}),
  });
  if (error) throw error;
  return (data ?? []) as VinMatch[];
}

/** Erreur « ce VIN existe déjà » renvoyée par la base (la moto existante est dans `vehicleId`). */
export class VinExistsError extends Error {
  constructor(public vehicleId: string | null) { super('VIN_EXISTS'); }
}

/**
 * Crée la moto d'un client ET son lien propriétaire (vehicle_owners, propriétaire
 * courant) en une transaction, tracée dans events. Jamais d'article V/O/P/D : une
 * moto de client est un véhicule de réparation. Refuse un VIN déjà présent.
 */
export async function createVehicleForContact(
  companyId: string, contactId: string, input: VehicleInsert, fromDate?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('vehicle_create_for_contact', {
    _company: companyId, _contact: contactId, _vehicle: input as unknown as Json,
    ...(fromDate ? { _from_date: fromDate } : {}),
  });
  if (error) {
    if (error.message?.includes('VIN_EXISTS')) throw new VinExistsError(error.details ?? null);
    throw error;
  }
  return data as string;
}

/** Rattache une moto existante à un client (le propriétaire courant précédent est clôturé). */
export async function attachVehicleOwner(vehicleId: string, contactId: string, fromDate?: string | null): Promise<void> {
  const { error } = await supabase.rpc('vehicle_attach_owner', {
    _vehicle: vehicleId, _contact: contactId, ...(fromDate ? { _from_date: fromDate } : {}),
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------------
 * Mission 08, carte 2 — moto choisie sur un document de vente.
 * ---------------------------------------------------------------------- */

/** Motos dont un contact est le propriétaire actuel (`vehicle_owners.is_current`), la plus récente d'abord. */
export async function listContactCurrentVehicles(contactId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicle_owners').select('from_date, vehicles(*)')
    .eq('contact_id', contactId).eq('is_current', true)
    .order('from_date', { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => r.vehicles as unknown as Vehicle | null).filter((v): v is Vehicle => !!v);
}

/** Recherche d'une moto du parc par VIN, plaque, modèle ou marque (moto à vendre ou de passage). */
/** Motos du parc par n° de châssis : `1234` commence par, `*1234` 6 derniers, `*1234*` contient. */
export async function searchVehiclesByVinPattern(companyId: string, raw: string, limit = 8): Promise<VinMatch[]> {
  const q = parseVinQuery(raw);
  if (!q) return [];
  const { data, error } = await supabase.from('vehicles')
    .select('id, brand, model, plate, vin, status, vehicle_owners(contact_id, is_current, from_date, contacts(first_name, last_name, company_name))')
    .eq('company_id', companyId).ilike('vin', vinLikePattern(q)).order('vin').limit(300);
  if (error) throw error;
  type OwnerRow = { contact_id: string | null; is_current: boolean; from_date: string | null;
    contacts: { first_name: string | null; last_name: string | null; company_name: string | null } | null };
  type Row = Omit<VinMatch, 'owner_id' | 'owner_name'> & { vehicle_owners: OwnerRow[] | null };
  return ((data ?? []) as unknown as Row[])
    .filter((v) => vinMatchesQuery(v.vin, q))
    .slice(0, limit)
    .map(({ vehicle_owners, ...v }) => {
      const o = (vehicle_owners ?? []).filter((x) => x.is_current)
        .sort((a, b) => String(b.from_date ?? '').localeCompare(String(a.from_date ?? '')))[0];
      return { ...v, owner_id: o?.contact_id ?? null, owner_name: ownerDisplayName(o?.contacts) };
    });
}

type OwnerContact = { first_name: string | null; last_name: string | null; company_name: string | null };
function ownerDisplayName(c: OwnerContact | null | undefined): string | null {
  if (!c) return null;
  return c.company_name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null;
}

/** Moto proposée dans un sélecteur, avec son propriétaire actuel quand on le connaît. */
export type VehiclePickResult = Vehicle & { owner_id?: string | null; owner_name?: string | null };

/**
 * Recherche du sélecteur de moto : tout le parc (stock et motos des clients). Un VIN qui commence
 * par ce qui est tapé passe devant ; chaque moto arrive avec son propriétaire actuel.
 */
export async function searchVehiclesForPick(companyId: string, term: string, limit = 20): Promise<VehiclePickResult[]> {
  const q = term.includes('*') ? null : parseVinQuery(term);
  const [vinHits, others] = await Promise.all([
    q
      ? supabase.from('vehicles').select('*').eq('company_id', companyId).ilike('vin', vinLikePattern(q)).order('vin').limit(limit)
        .then(({ data, error }) => { if (error) throw error; return (data ?? []) as Vehicle[]; })
      : Promise.resolve([] as Vehicle[]),
    searchVehiclesForSale(companyId, term, limit),
  ]);
  const found = vinHitsFirst(vinHits, others, limit);
  if (found.length === 0) return [];
  const { data, error } = await supabase.from('vehicle_owners')
    .select('vehicle_id, contact_id, from_date, contacts(first_name, last_name, company_name)')
    .in('vehicle_id', found.map((v) => v.id)).eq('is_current', true);
  if (error) throw error;
  type Row = { vehicle_id: string; contact_id: string | null; from_date: string | null; contacts: OwnerContact | null };
  const owners = new Map<string, Row>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const cur = owners.get(r.vehicle_id);
    if (!cur || String(r.from_date ?? '') > String(cur.from_date ?? '')) owners.set(r.vehicle_id, r);
  }
  return found.map((v) => {
    const o = owners.get(v.id);
    return { ...v, owner_id: o?.contact_id ?? null, owner_name: ownerDisplayName(o?.contacts) };
  });
}

export async function searchVehiclesForSale(companyId: string, term: string, limit = 8): Promise<Vehicle[]> {
  // Avec une étoile : mêmes règles de n° de châssis que la fiche moto.
  if (term.includes('*')) {
    const q = parseVinQuery(term);
    if (!q) return [];
    const { data, error } = await supabase.from('vehicles').select('*').eq('company_id', companyId)
      .ilike('vin', vinLikePattern(q)).order('vin').limit(300);
    if (error) throw error;
    return ((data ?? []) as Vehicle[]).filter((v) => vinMatchesQuery(v.vin, q)).slice(0, limit);
  }
  const s = sanitize(term);
  if (s.length < 2) return [];
  const { data, error } = await supabase
    .from('vehicles').select('*').eq('company_id', companyId)
    .or([`vin.ilike.%${s}%`, `plate.ilike.%${s}%`, `model.ilike.%${s}%`, `brand.ilike.%${s}%`].join(','))
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Vehicle[];
}

/** Libellé court d'une moto dans un sélecteur : « Ducati Monster 2024 · 1-ABC-123 · ZDM… ». */
export function vehiclePickLabel(v: Pick<Vehicle, 'brand' | 'model' | 'vin' | 'plate'> & { model_year?: number | null }): string {
  const name = [vehicleLabel(v), v.model_year ?? ''].filter(Boolean).join(' ');
  return [name, v.plate, v.vin].filter(Boolean).join(' · ');
}
