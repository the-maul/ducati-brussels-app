/**
 * M13 — Reporting : KPIs du tableau de bord.
 */
import { supabase } from '@/integrations/supabase/client';

export type DashboardKpis = {
  revenue_today: number; revenue_month: number; invoices_month: number;
  or_open: number; stock_value: number; vehicles_in_stock: number; receivables: number;
};

export async function getDashboardKpis(companyId: string): Promise<DashboardKpis> {
  const { data, error } = await supabase.rpc('dashboard_kpis', { _company: companyId });
  if (error) throw error;
  const r = (data ?? {}) as Partial<DashboardKpis>;
  return {
    revenue_today: Number(r.revenue_today ?? 0), revenue_month: Number(r.revenue_month ?? 0),
    invoices_month: Number(r.invoices_month ?? 0), or_open: Number(r.or_open ?? 0),
    stock_value: Number(r.stock_value ?? 0), vehicles_in_stock: Number(r.vehicles_in_stock ?? 0),
    receivables: Number(r.receivables ?? 0),
  };
}
