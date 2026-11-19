-- =====================================================================
-- Perf (plainte client du 19/11/2026) : index des listes + tableau de bord.
-- A appliquer APRES 20261119230000_perf_rls_droits_calcules_une_fois.sql.
-- Mesures (EXPLAIN ANALYZE, admin d'ITALBIKE, transaction annulee, RLS deja corrigee) :
--   documents, 50 derniers (liste ventes)         31 ms  -> voir rapport (index company_id, issue_date)
--   vehicles, 50 derniers (liste motos)           7,9 ms -> voir rapport (index company_id, created_at)
--   tableau de bord (dashboard_kpis)             728 ms  -> voir rapport (valeur du stock sans trier 94 000 articles)
-- Index simples (pas CONCURRENTLY : la migration passe dans une transaction). Tailles au 19/11 :
--   documents 17 814 lignes, vehicles 3 364, workshop_appointments < 100 : tous petits (< 2 Mo),
--   verrou d'ecriture de quelques centaines de ms au plus.
-- Aucun droit, aucune regle metier ne change.
-- =====================================================================

-- Listes triees par date (ventes / factures, parc motos) : plus de tri des 17 814 documents.
create index if not exists idx_documents_company_issue_date on public.documents (company_id, issue_date desc);
create index if not exists idx_vehicles_company_created on public.vehicles (company_id, created_at desc);

-- Cles etrangeres du RDV sans index (conseiller Supabase « unindexed_foreign_keys ») :
-- chaque changement de statut d'un OR fait « update workshop_appointments ... where or_id = »
-- (trigger repair_orders_sync_appointment_status) ; fiche client / moto -> RDV.
create index if not exists idx_appt_or on public.workshop_appointments (or_id) where or_id is not null;
create index if not exists idx_appt_contact on public.workshop_appointments (contact_id) where contact_id is not null;
create index if not exists idx_appt_vehicle on public.workshop_appointments (vehicle_id) where vehicle_id is not null;

-- ---------------------------------------------------------------- tableau de bord
-- dashboard_kpis calculait la valeur du stock par « sum(stock_value) from article_stock_list(_company) » :
-- article_stock_list construit, trie par reference et materialise les 94 000 articles (400 ms)
-- pour n'en garder qu'une somme. Meme somme, calculee directement (meme formule
-- round(stock reel x PAMP, 2), memes articles : tous ceux de la societe, stock 'all', sans recherche ;
-- l'acces reste controle par le « where public.is_member(_company) » de dashboard_kpis).
-- Patch du texte de la fonction EN PLACE (pas de create or replace recopie) : si un autre lot a
-- modifie dashboard_kpis entre-temps, ses changements sont gardes ; si l'expression n'est plus la,
-- rien n'est fait (notice).
do $m$
declare
  _def text;
  _old constant text := '(select sum(stock_value) from public.article_stock_list(_company))';
  _new constant text := '(select sum(round(coalesce(s.real_qty, 0) * a.pamp, 2))
        from public.articles a
        left join (select m.article_id, sum(m.qty_delta) as real_qty
                     from public.stock_moves m where not m.is_reservation group by m.article_id) s
          on s.article_id = a.id
       where a.company_id = _company)';
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_kpis'
     and pg_get_function_identity_arguments(p.oid) = '_company uuid';
  if _def is null then
    raise notice 'perf : dashboard_kpis absente, rien a faire';
  elsif position(_old in _def) > 0 then
    execute replace(_def, _old, _new);
    raise notice 'perf : dashboard_kpis, valeur du stock calculee sans article_stock_list';
  elsif position('left join (select m.article_id, sum(m.qty_delta) as real_qty' in _def) > 0 then
    raise notice 'perf : dashboard_kpis deja corrigee';
  else
    raise notice 'perf : dashboard_kpis a change (expression introuvable), non modifiee';
  end if;
end $m$;
