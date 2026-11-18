/**
 * Rattrapage G8 (18/11/2026, lot parc) — chassis d'un modele de moto neuve (article V).
 * Lecture : fiches moto rattachees a l'article. Ecriture : `vehicle_chassis_receive`
 * (migration 20261118140000, pas encore dans types.ts : appel non type).
 */
import { supabase } from '@/integrations/supabase/client';
import type { VehicleStatus } from './api';

export type ModelChassis = {
  id: string; vin: string | null; engine_number: string | null; color: string | null; model_year: number | null;
  status: VehicleStatus; entry_date: string | null; sold_date: string | null; purchase_price: number | null;
  display_price: number | null; plate: string | null; key_number: string | null; police_book_number: string | null;
  exposition_code: string | null; created_at: string;
};

export async function listModelChassis(articleId: string): Promise<ModelChassis[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, vin, engine_number, color, model_year, status, entry_date, sold_date, purchase_price, display_price, plate, key_number, police_book_number, exposition_code, created_at')
    .eq('article_id', articleId)
    .order('entry_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as ModelChassis[];
}

export type NewChassisInput = {
  vin: string; engine_number?: string | null; color?: string | null; model_year?: number | null;
  key_number?: string | null; police_book_number?: string | null; exposition_code?: string | null;
  unit_cost?: number | null; display_price?: number | null;
};

/** « Nouv. chassis » de G8 : fiche moto + entree de stock de 1 sur le modele, en une transaction. */
export async function addModelChassis(articleId: string, c: NewChassisInput): Promise<string> {
  const loose = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data, error } = await loose('vehicle_chassis_receive', {
    _article: articleId,
    _chassis: {
      vin: c.vin.trim(), engine_number: c.engine_number || null, color: c.color || null, model_year: c.model_year ?? null,
      key_number: c.key_number || null, police_book_number: c.police_book_number || null,
      exposition_code: c.exposition_code || null, display_price: c.display_price ?? null,
    },
    _unit_cost: c.unit_cost ?? null, _origin: 'chassis_manuel', _ref: null, _bin: null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
