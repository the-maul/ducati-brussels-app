/**
 * Mission 04, carte 8 — « Motos déclarées à valider » (équipe).
 *
 * Un client déclare sa moto (espace client, inscription en ligne, borne) : la ligne
 * arrive dans `contact_declared_vehicles` (statut « a_valider ») et une alerte part dans
 * la cloche (admin + vendeur). Un membre de l'équipe la rattache à une moto existante
 * (même VIN ou même plaque), crée la fiche moto, ou l'ignore. La moto n'entre JAMAIS
 * dans le parc sans cette validation. Tout est tracé dans events.
 * Migration : supabase/migrations/20260919302000_m3_motos_declarees.sql.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { VinExistsError, type VehicleInsert } from './api';

/** Rôles qui voient l'alerte de la cloche (filtré aussi en base : can_see_team_notification). */
export const VEHICLE_DECL_NOTIF_ROLES = ['admin', 'vendeur'] as const;

export type DeclarationSource = 'web' | 'comptoir' | 'manuel' | 'portail';

export type DeclarationCandidate = {
  id: string; brand: string | null; model: string | null; vin: string | null; plate: string | null;
  model_year: number | null; match: 'vin' | 'plate'; owner_id: string | null; owner_name: string | null;
};

export type PendingDeclaration = {
  id: string;
  contact_id: string;
  contact_name: string | null;
  kind: 'ducati' | 'other_brand';
  brand: string | null;
  family: string | null;
  model: string | null;
  model_year: number | null;
  vin: string | null;
  plate: string | null;
  source: DeclarationSource;
  created_at: string;
  registration: { path: string; file_name: string; content_type: string; size: number | null } | null;
  candidates: DeclarationCandidate[];
};

export async function listPendingDeclarations(companyId: string): Promise<PendingDeclaration[]> {
  const { data, error } = await supabase.rpc('declared_vehicles_pending', { _company: companyId });
  if (error) throw error;
  return (data ?? []) as unknown as PendingDeclaration[];
}

export async function attachDeclaration(declarationId: string, vehicleId: string, fromDate?: string | null): Promise<void> {
  const { error } = await supabase.rpc('declared_vehicle_attach', {
    _declaration: declarationId, _vehicle: vehicleId, ...(fromDate ? { _from_date: fromDate } : {}),
  });
  if (error) throw error;
}

/** Crée la fiche moto depuis la déclaration (mêmes règles que « Ajouter une moto »). */
export async function createFromDeclaration(declarationId: string, input: VehicleInsert, fromDate?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('declared_vehicle_create', {
    _declaration: declarationId, _vehicle: input as unknown as Json, ...(fromDate ? { _from_date: fromDate } : {}),
  });
  if (error) {
    if (error.message?.includes('VIN_EXISTS')) throw new VinExistsError(error.details ?? null);
    throw error;
  }
  return data as string;
}

export async function ignoreDeclaration(declarationId: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('declared_vehicle_ignore', {
    _declaration: declarationId, ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}

/** Valeurs de départ du formulaire véhicule à partir d'une déclaration. */
export function declarationPrefill(d: Pick<PendingDeclaration, 'brand' | 'model' | 'model_year' | 'vin' | 'plate' | 'family'>,
  families: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (d.brand) out.brand = d.brand.toUpperCase();
  if (d.model) out.model = d.model.toUpperCase();
  if (d.model_year) out.model_year = String(d.model_year);
  if (d.vin) out.vin = d.vin;
  if (d.plate) out.plate = d.plate.toUpperCase();
  const fam = d.family?.toUpperCase();
  if (fam && families.includes(fam)) out.category = fam;
  return out;
}
