/**
 * M7 — Reprise / Occasion / ORO : lectures.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Oro = Database['public']['Tables']['oro']['Row'];
export type OroLine = Database['public']['Tables']['oro_lines']['Row'];

export async function listOro(companyId: string, status?: string): Promise<Oro[]> {
  let q = supabase.from('oro').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type OroFull = { oro: Oro; lines: OroLine[]; vehicle: { id: string; vin: string | null; brand: string | null; model: string | null; purchase_price: number | null; cost_price: number | null; display_price: number | null } | null };
export async function getOroFull(id: string): Promise<OroFull> {
  const { data: oro, error } = await supabase.from('oro').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: lines, error: le } = await supabase.from('oro_lines').select('*').eq('oro_id', id).order('created_at');
  if (le) throw le;
  let vehicle = null;
  if (oro.vehicle_id) {
    const { data: v } = await supabase.from('vehicles').select('id, vin, brand, model, purchase_price, cost_price, display_price').eq('id', oro.vehicle_id).maybeSingle();
    vehicle = v ?? null;
  }
  return { oro: oro as Oro, lines: lines ?? [], vehicle };
}
