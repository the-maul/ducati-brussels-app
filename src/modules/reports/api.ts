/**
 * M13 — Reporting : KPIs du tableau de bord.
 */
import { supabase } from '@/integrations/supabase/client';

export type DashboardKpis = {
  revenue_today: number; revenue_month: number; invoices_month: number;
  or_open: number; stock_value: number; vehicles_in_stock: number; receivables: number;
};

export type MonthRevenue = { month: string; revenue_ttc: number; invoices: number };
export async function getMonthlyRevenue(companyId: string): Promise<MonthRevenue[]> {
  const { data, error } = await supabase.rpc('monthly_revenue', { _company: companyId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ month: r.month, revenue_ttc: Number(r.revenue_ttc), invoices: Number(r.invoices) }));
}

export type TopArticle = { article_id: string; reference: string | null; designation: string | null; qty: number; revenue_ht: number };
export async function getTopArticles(companyId: string, from: string, to: string): Promise<TopArticle[]> {
  const { data, error } = await supabase.rpc('top_articles', { _company: companyId, _from: from, _to: to, _limit: 15 });
  if (error) throw error;
  return (data ?? []).map((r) => ({ article_id: r.article_id, reference: r.reference, designation: r.designation, qty: Number(r.qty), revenue_ht: Number(r.revenue_ht) }));
}

export type Productivity = { mechanic: string; presence_min: number; work_min: number };
export async function getWorkshopProductivity(companyId: string, fromISO: string, toISO: string): Promise<Productivity[]> {
  const { data, error } = await supabase.rpc('workshop_productivity', { _company: companyId, _from: fromISO, _to: toISO });
  if (error) throw error;
  return (data ?? []).map((r) => ({ mechanic: r.mechanic, presence_min: Number(r.presence_min), work_min: Number(r.work_min) }));
}

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
