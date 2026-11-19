-- =====================================================================
-- Decisions atelier Q48 (taux horaire) et Q49 (kit du RDV d'entretien sur l'OR), 18/11/2026 —
-- essai a blanc de 20261119192000_m8_taux_horaire_atelier_vip.sql et
-- 20261119193000_m8_kit_rdv_vers_or.sql (avec 20261119190000 pour le km / les statuts).
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119190000_m8_km_et_statuts_or_g8.sql \
--      supabase/migrations/20261119192000_m8_taux_horaire_atelier_vip.sql \
--      supabase/migrations/20261119193000_m8_kit_rdv_vers_or.sql \
--      supabase/tests/m8_taux_et_kit_rdv.sql; echo "rollback;") > t.sql
-- Scenario (ITALBIKE STORE, administrateur simule) :
--   Q48 : taux standard 109,74 HT lu (code « DIAGNOSTIC » en majuscules), forfait DIAGNOSTIC
--         aligne, trace events ; tarif client « VIP » = MO nette 90,00 HT (moteur de tarifs).
--   Q49 : modele-annee et kit d'essai (filtre a huile + petites fournitures + CONTRI) ; RDV
--         « Entretien annuel » avec km → reservation du filtre ; lignes completes du kit lues pour
--         l'OR (pieces ET lignes de service), la reservation ne lit que la piece ; OR « a faire »
--         ecrit avec ces lignes ; RDV relie → « receptionne », la reservation SUIT l'OR, aucun
--         nouveau mouvement ; facture de l'OR → reservation consommee, B7 : somme des mouvements
--         de reservation = 0.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated; grant usage on sequence _t_n_seq to authenticated;

insert into _ctx values
  ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33'),
  ('my', 'essai-q49-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
insert into public.ducati_catalog_model_years (id, model_id, code, year, name)
select (select v from _ctx where k = 'my'), my.model_id, 'ES', my.year, 'ESSAI Q49 (transaction annulee)'
  from public.ducati_catalog_model_years my where my.id = '21110';
with c as (
  insert into public.contacts (company_id, type, first_name, last_name, country)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'particulier', 'TEST', 'KIT RDV Q49', 'BE') returning id)
insert into _ctx select 'contact', id::text from c;
with v as (
  insert into public.vehicles (company_id, brand, model, status, ducati_model_year_id, holder_contact_id, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI Q49', 'vendu', (select v from _ctx where k = 'my'),
          (select v::uuid from _ctx where k = 'contact'), 'ESSAI A BLANC (transaction annulee)')
  returning id)
insert into _ctx select 'vehicle', id::text from v;
insert into _ctx select 'filter', id::text from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and reference = '44440312B' limit 1;
insert into _ctx select 'pf', id::text from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and reference = 'PETITES FOURNITURES' limit 1;
insert into _ctx select 'contri', id::text from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and reference = 'CONTRI' limit 1;
insert into _ctx select 'mo', id::text from public.articles where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and reference = 'MO' and mgmt_type = 'T' limit 1;
-- Stock du filtre garanti pour l'essai (entree d'essai, annulee avec la transaction).
select public.record_stock_move((select v::uuid from _ctx where k = 'filter'), 'entree', 5, 10, false, null, 'essai', 'ESSAI-Q49', 'essai');
update public.articles set stock_min = 0 where id = (select v::uuid from _ctx where k = 'filter');

with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_q49', 'Essai Q49', 'annual_service', 'Annual Service', 'essai-q49', 'annual', 'manuel')
  returning id)
insert into _ctx select 'kit', id::text from k;
insert into public.maintenance_kit_model_years (kit_id, model_year_id)
select (select v::uuid from _ctx where k = 'kit'), (select v from _ctx where k = 'my');
insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, sort_order)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit'), a.id, a.reference, a.designation, 1,
       case when a.mgmt_type = 'A' then 'piece' else 'forfait' end, 'sur',
       case a.reference when '44440312B' then 1 when 'PETITES FOURNITURES' then 2 else 3 end
  from public.articles a where a.id in (select v::uuid from _ctx where k in ('filter', 'pf', 'contri'));

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

-- ------------------------------------------------------------ Q48 taux horaire
insert into _t(check_name, result)
select 'Q48 taux standard lu = 109,74 HT (code DIAGNOSTIC en majuscules)',
       case when public.maintenance_hourly_rate_ht((select v::uuid from _ctx where k = 'company')) = 109.74 then 'ok'
            else 'FAIL ' || coalesce(public.maintenance_hourly_rate_ht((select v::uuid from _ctx where k = 'company'))::text, 'null') end;
insert into _t(check_name, result)
select 'Q48 forfait DIAGNOSTIC aligne sur le taux (montant 109,74) + trace events',
       case when (select (extra ->> 'amount_ht')::numeric from public.reference_values
                   where company_id = (select v::uuid from _ctx where k = 'company') and table_key = 'workshop_quote_fee' and lower(code) = 'diagnostic') = 109.74
             and exists (select 1 from public.events where action = 'workshop_hourly_rate_g8') then 'ok' else 'FAIL' end;
insert into _t(check_name, result)
select 'Q48 tarif client VIP : MO nette 90,00 HT (moteur de tarifs existant)',
       case when exists (select 1 from public.price_lists l join public.price_list_rules r on r.price_list_id = l.id
                          where l.company_id = (select v::uuid from _ctx where k = 'company') and l.code = 'VIP'
                            and r.scope = 'reference' and r.article_id = (select v::uuid from _ctx where k = 'mo')
                            and r.kind = 'net' and (r.tiers -> 0 ->> 'value')::numeric = 90) then 'ok' else 'FAIL' end;

-- ------------------------------------------------------------ Q49 RDV d'entretien → OR avec tout le kit
insert into _ctx select 'reserved_before', reserved_qty::text from public.article_stock((select v::uuid from _ctx where k = 'filter'));
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, mileage, starts_at, planned_minutes, status, reason_code, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'), 21000,
          date_trunc('day', now()) + interval '10 days 9 hours', 90, 'prevu', 'entretien_annuel', 'dms')
  returning id)
insert into _ctx select 'rdv', id::text from a;
insert into _t(check_name, result)
select 'Q49 RDV d''entretien : le filtre est reserve (seule la piece)',
       case when (select count(*) from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv') and status = 'active') = 1
             and exists (select 1 from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv')
                          and article_id = (select v::uuid from _ctx where k = 'filter') and qty_reserved = 1) then 'ok' else 'FAIL' end;

insert into _t(check_name, result)
select 'Q49 lignes du kit pour l''OR : piece + petites fournitures + CONTRI (toutes)',
       case when (select count(*) from public.workshop_service_kit_lines((select v::uuid from _ctx where k = 'vehicle'), 'annual')) = 3
             and (select count(*) from public.workshop_service_kit((select v::uuid from _ctx where k = 'vehicle'), 'annual')) = 1
            then 'ok' else 'FAIL ' || (select count(*) from public.workshop_service_kit_lines((select v::uuid from _ctx where k = 'vehicle'), 'annual'))::text end;

-- L'ecran (« Valider RDV et saisie OR ») : OR « a faire » + lignes du kit, puis lien du RDV.
insert into _ctx select 'moves_before', count(*)::text from public.stock_moves where origin = 'atelier'
   and article_id = (select v::uuid from _ctx where k = 'filter') and is_reservation;
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, reason_code)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-Q49', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 21000, 'a_faire', 'entretien_annuel')
  returning id)
insert into _ctx select 'or', id::text from r;
select public.repair_order_write_lines((select v::uuid from _ctx where k = 'or'), (
  select jsonb_agg(jsonb_build_object(
           'kind', case when a.mgmt_type = 'T' then 'mo' else 'piece' end, 'article_id', k.article_id, 'designation', k.designation,
           'quantity', k.quantity, 'unit_price_ht', coalesce(a.sale_price_ht, 0), 'vat_rate', 21, 'discount_pct', 0, 'is_warranty', false,
           'line_ht', round(k.quantity * coalesce(a.sale_price_ht, 0), 2), 'line_ttc', round(k.quantity * coalesce(a.sale_price_ht, 0) * 1.21, 2))
         order by k.sort_order)
    from public.workshop_service_kit_lines((select v::uuid from _ctx where k = 'vehicle'), 'annual') k
    left join public.articles a on a.id = k.article_id));
update public.workshop_appointments set or_id = (select v::uuid from _ctx where k = 'or'), status = 'arrive'
 where id = (select v::uuid from _ctx where k = 'rdv');

insert into _t(check_name, result)
select 'Q49 OR : les 3 lignes du kit, le filtre une seule fois',
       case when (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')) = 3
             and (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'filter')) = 1 then 'ok' else 'FAIL' end;
insert into _t(check_name, result)
select 'Q49 la reservation suit l''OR, aucun nouveau mouvement (pas de double reservation)',
       case when (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active') = 1
             and (select count(*) from public.stock_moves where origin = 'atelier' and is_reservation
                   and article_id = (select v::uuid from _ctx where k = 'filter')) = (select v::int from _ctx where k = 'moves_before')
            then 'ok' else 'FAIL' end;
insert into _t(check_name, result)
select 'Q43 RDV relie a l''OR « a faire » → « receptionne »',
       case when (select status from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'rdv')) = 'arrive' then 'ok' else 'FAIL' end;

-- Facture de l'OR : la facture sort le filtre, la reservation est consommee.
with d as (
  insert into public.documents (company_id, doc_type, status, contact_id, vehicle_id, number)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'brouillon', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 'FAC-ESSAI-Q49')
  returning id)
insert into _ctx select 'fac', id::text from d;
insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, sort_order)
select (select v::uuid from _ctx where k = 'fac'), a.id, a.designation, 1, 21.70, 21, 0
  from public.articles a where a.id = (select v::uuid from _ctx where k = 'filter');
select public.record_stock_move((select v::uuid from _ctx where k = 'filter'), 'sortie', -1, null, false, null, 'sale', 'FAC-ESSAI-Q49', 'essai');
update public.repair_orders set status = 'facture', invoice_document_id = (select v::uuid from _ctx where k = 'fac')
 where id = (select v::uuid from _ctx where k = 'or');

insert into _t(check_name, result)
select 'Q49 facture : reservation consommee',
       case when (select status from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'filter')) = 'consommee' then 'ok' else 'FAIL' end;
insert into _t(check_name, result)
select 'B7 : somme des mouvements de reservation du filtre (RDV → OR → facture) = 0',
       case when (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'filter')))
                 = (select v::numeric from _ctx where k = 'reserved_before')
             and (select qty_reserved from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'filter')) = 0 then 'ok' else 'FAIL' end;

reset role;
select n, check_name, result from _t order by n;
