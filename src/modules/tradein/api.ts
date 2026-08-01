/**
 * M7 — Reprise / Occasion / ORO : lectures.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Oro = Database['public']['Tables']['oro']['Row'];
export type OroLine = Database['public']['Tables']['oro_lines']['Row'];

// ---- Dépôt-vente (type D) ----
export type Consignment = Database['public']['Tables']['consignments']['Row'];
export async function listConsignments(companyId: string): Promise<Consignment[]> {
  const { data, error } = await supabase.from('consignments').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
export async function createConsignment(companyId: string, p: { depositor_id?: string | null; number?: string; agreed_price: number; commission_pct: number; notes?: string }): Promise<void> {
  const { error } = await supabase.from('consignments').insert({ company_id: companyId, depositor_id: p.depositor_id ?? null, number: p.number ?? null, agreed_price: p.agreed_price, commission_pct: p.commission_pct, notes: p.notes ?? null });
  if (error) throw error;
}
export async function settleConsignment(consignmentId: string, salePriceTtc: number): Promise<{ commission: number; reversal: number }> {
  const { data, error } = await supabase.rpc('settle_consignment', { _consignment: consignmentId, _sale_price_ttc: salePriceTtc, _sale_document: null });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as { commission: number; reversal: number };
  return { commission: Number(r.commission), reversal: Number(r.reversal) };
}

/** Client lié à une reprise (via l'historique propriétaires du véhicule). */
export type RepriseClient = { first_name: string | null; last_name: string | null; company_name: string | null; code: string | null };

export function repriseClientLabel(c: RepriseClient | null): string {
  if (!c) return '—';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
  if (c.company_name) return person ? `${c.company_name} (${person})` : c.company_name;
  return person || '—';
}

export type OroListItem = Oro & {
  vehicle_info: { brand: string | null; model: string | null; model_year: number | null; status: string | null; article_id: string | null } | null;
  client: RepriseClient | null;
};

export async function listOro(companyId: string, status?: string): Promise<OroListItem[]> {
  let q = supabase
    .from('oro')
    .select('*, vehicle:vehicle_id(brand, model, model_year, status, article_id, vehicle_owners(created_at, contact:contact_id(first_name, last_name, company_name, code)))')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  type Row = Oro & { vehicle?: { brand: string | null; model: string | null; model_year: number | null; status: string | null; article_id: string | null; vehicle_owners?: { created_at: string; contact: RepriseClient | null }[] } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const owners = r.vehicle?.vehicle_owners ?? [];
    const latest = [...owners].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
    const { vehicle: _v, ...oro } = r;
    return {
      ...(oro as Oro),
      vehicle_info: r.vehicle
        ? { brand: r.vehicle.brand, model: r.vehicle.model, model_year: r.vehicle.model_year, status: r.vehicle.status, article_id: r.vehicle.article_id }
        : null,
      client: latest?.contact ?? null,
    };
  });
}

export type OroVehicle = {
  id: string; vin: string | null; engine_number: string | null; brand: string | null; model: string | null;
  model_year: number | null; mileage: number | null; energy: string | null;
  displacement: number | null; power_cv: number | null; power_kw: number | null; notes: string | null;
  purchase_price: number | null; cost_price: number | null; display_price: number | null;
  first_registration_date?: string | null; status?: string | null; article_id?: string | null;
};
export type OroFull = { oro: Oro; lines: OroLine[]; vehicle: OroVehicle | null; client: RepriseClient | null };
export async function getOroFull(id: string): Promise<OroFull> {
  const { data: oro, error } = await supabase.from('oro').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: lines, error: le } = await supabase.from('oro_lines').select('*').eq('oro_id', id).order('created_at');
  if (le) throw le;
  let vehicle: OroVehicle | null = null;
  let client: RepriseClient | null = null;
  if (oro.vehicle_id) {
    const { data: v } = await supabase
      .from('vehicles')
      .select('id, vin, engine_number, brand, model, model_year, mileage, energy, displacement, power_cv, power_kw, notes, purchase_price, cost_price, display_price, first_registration_date, status, article_id')
      .eq('id', oro.vehicle_id).maybeSingle();
    vehicle = (v as OroVehicle | null) ?? null;
    if (vehicle) {
      const { data: own } = await supabase
        .from('vehicle_owners')
        .select('created_at, contact:contact_id(first_name, last_name, company_name, code)')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: false })
        .limit(1);
      client = ((own?.[0] as { contact?: RepriseClient } | undefined)?.contact) ?? null;
    }
  }
  return { oro: oro as Oro, lines: lines ?? [], vehicle, client };
}
