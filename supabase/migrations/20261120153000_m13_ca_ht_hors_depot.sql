-- =====================================================================
-- M13 — Tableau de bord : CA HT hors dépôt-vente et y compris dépôt-vente
-- (décision du client Q66, 20/11/2026). VEN012
--
-- Le tableau de bord affichait le CA du jour et du mois en TTC. Le client veut le CA **HT**
-- sous deux formes :
--   - « CA HT » : hors ventes faites pour le compte des déposants (la moto en dépôt-vente
--     n'appartient pas au magasin, B / type D) ;
--   - « CA HT y compris dépôt-vente ».
-- Nouvelles clés de dashboard_kpis (les anciennes restent, rien ne casse) :
--   revenue_ht_today, revenue_ht_month                          (hors dépôt-vente)
--   revenue_ht_today_incl_consignment, revenue_ht_month_incl_consignment
--   consignment_ht_today, consignment_ht_month                  (la part dépôt-vente, l'écart)
--
-- Règles (les mêmes que les statistiques, migration 20261118180000) :
--   - documents comptés par _stats_is_sale : factures, tickets et avoirs validés, avoir déduit
--     (montants négatifs), brouillons / annulés / FAA exclus ;
--   - CA HT = documents.total_ht (port compris, comme le total HT du document) ;
--   - part dépôt-vente = HT des lignes dont l'article est de type de gestion D, ramené au HT du
--     document (remise globale répartie au prorata, comme _stats_facts) ; l'avoir d'une vente en
--     dépôt-vente la déduit de la même façon ;
--   - la facture de commission / frais au déposant (consignment_sell) n'a pas de ligne D : elle
--     reste du CA du magasin, dans les deux chiffres.
-- Vitesse : un seul passage sur les documents du mois (index company_id, issue_date) ; les lignes
-- ne sont lues que pour les documents du mois, l'article par sa clé.
-- Le texte reprend la version en production (valeur du stock calculée sans article_stock_list,
-- migration 20261119231000). Même signature, mêmes droits (ouvert à tout membre de la société).
-- Additive, rejouable. Essai à blanc : supabase/tests/m13_ca_ht_hors_depot.sql. NON APPLIQUÉE.
-- =====================================================================
set local lock_timeout = '5s';

create or replace function public.dashboard_kpis(_company uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with sale as (
    select d.id, d.doc_type, d.issue_date, d.total_ttc, d.total_ht, coalesce(d.shipping_ht, 0) as shipping_ht
      from public.documents d
     where d.company_id = _company
       and d.issue_date >= date_trunc('month', current_date)::date
       and public._stats_is_sale(d.id, d.doc_type, d.status)
  ),
  -- Part dépôt-vente de chaque document du mois (lignes d'articles D), remise globale répartie.
  dep as (
    select l.document_id,
           sum(l.line_ht) filter (where a.mgmt_type::text = 'D') as d_ht,
           sum(l.line_ht) as lines_ht
      from public.document_lines l
      left join public.articles a on a.id = l.article_id
     where l.document_id in (select s.id from sale s)
     group by l.document_id
    having bool_or(a.mgmt_type::text = 'D')
  ),
  s2 as (
    select s.*,
           coalesce(round(dep.d_ht * case when dep.lines_ht <> 0 then (s.total_ht - s.shipping_ht) / dep.lines_ht else 1 end, 2), 0) as consign_ht
      from sale s left join dep on dep.document_id = s.id
  )
  select jsonb_build_object(
    'revenue_today', coalesce((select sum(total_ttc) from s2 where issue_date = current_date), 0),
    'revenue_month', coalesce((select sum(total_ttc) from s2), 0),
    'revenue_ht_today', coalesce((select sum(total_ht - consign_ht) from s2 where issue_date = current_date), 0),
    'revenue_ht_month', coalesce((select sum(total_ht - consign_ht) from s2), 0),
    'revenue_ht_today_incl_consignment', coalesce((select sum(total_ht) from s2 where issue_date = current_date), 0),
    'revenue_ht_month_incl_consignment', coalesce((select sum(total_ht) from s2), 0),
    'consignment_ht_today', coalesce((select sum(consign_ht) from s2 where issue_date = current_date), 0),
    'consignment_ht_month', coalesce((select sum(consign_ht) from s2), 0),
    'invoices_month', coalesce((select count(*) from s2 where doc_type in ('FAC', 'TIK')), 0),
    'credit_notes_month', coalesce((select count(*) from s2 where doc_type = 'AVO'), 0),
    'or_open', coalesce((select count(*) from public.repair_orders
      where company_id = _company and status not in ('facture', 'annule')), 0),
    'stock_value', coalesce((select sum(round(coalesce(s.real_qty, 0) * a.pamp, 2))
        from public.articles a
        left join (select m.article_id, sum(m.qty_delta) as real_qty
                     from public.stock_moves m where not m.is_reservation group by m.article_id) s
          on s.article_id = a.id
       where a.company_id = _company), 0),
    'vehicles_in_stock', coalesce((select count(*) from public.vehicles
      where company_id = _company and status in ('stock_vn', 'stock_vo', 'depot_vente', 'demo', 'courtoisie')), 0),
    'receivables', coalesce((select sum(total_ttc - paid_amount) from public.documents
      where company_id = _company and doc_type in ('FAC', 'TIK') and status not in ('brouillon', 'annulee')
        and total_ttc - paid_amount > 0.005), 0)
  )
  where public.is_member(_company);
$function$;

revoke all on function public.dashboard_kpis(uuid) from public, anon;
grant execute on function public.dashboard_kpis(uuid) to authenticated;

comment on function public.dashboard_kpis(uuid) is
  'Tableau de bord (M13) : CA du jour / du mois TTC (revenue_*), CA HT hors dépôt-vente (revenue_ht_*) et y compris dépôt-vente (revenue_ht_*_incl_consignment, Q66), compteurs, valeur du stock, encours.';
