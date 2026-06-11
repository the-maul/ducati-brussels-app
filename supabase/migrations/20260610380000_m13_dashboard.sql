-- =====================================================================
-- M13 — Reporting : KPIs du tableau de bord (agrégés en une requête).
-- CA jour/mois, factures du mois, OR ouverts, valeur de stock, véhicules en stock,
-- encours clients. Lecture seule, RLS via security definer.
-- =====================================================================

create or replace function public.dashboard_kpis(_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'revenue_today', coalesce((select sum(total_ttc) from public.documents
      where company_id = _company and doc_type = 'FAC' and status <> 'annulee' and issue_date = current_date), 0),
    'revenue_month', coalesce((select sum(total_ttc) from public.documents
      where company_id = _company and doc_type = 'FAC' and status <> 'annulee' and issue_date >= date_trunc('month', current_date)), 0),
    'invoices_month', coalesce((select count(*) from public.documents
      where company_id = _company and doc_type = 'FAC' and status <> 'annulee' and issue_date >= date_trunc('month', current_date)), 0),
    'or_open', coalesce((select count(*) from public.repair_orders
      where company_id = _company and status not in ('facture', 'annule')), 0),
    'stock_value', coalesce((select sum(stock_value) from public.article_stock_list(_company)), 0),
    'vehicles_in_stock', coalesce((select count(*) from public.vehicles
      where company_id = _company and status in ('stock_vn', 'stock_vo', 'depot_vente', 'demo', 'courtoisie')), 0),
    'receivables', coalesce((select sum(total_ttc - paid_amount) from public.documents
      where company_id = _company and doc_type = 'FAC' and status <> 'annulee' and total_ttc - paid_amount > 0), 0)
  )
  where public.is_member(_company);
$$;
grant execute on function public.dashboard_kpis(uuid) to authenticated;
