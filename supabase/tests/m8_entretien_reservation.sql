-- =====================================================================
-- ATE015 (03/11/2026) -- essai a blanc de la migration 20261103270000_m8_entretien_reservation.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261103270000_m8_entretien_reservation.sql \
--      supabase/tests/m8_entretien_reservation.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- (si 20261103200000_m8_kits_generation.sql n'est pas encore en base : la mettre en tete.)
-- Scenario, administrateur simule d'ITALBIKE STORE :
--   RDV « Entretien annuel » sur une moto avec kit -> pieces reservees ; une piece sous son minimum
--   -> ligne minimax au panier standard ; ce qui manque -> panier (origine atelier) ; RDV deplace ->
--   date suivie sans mouvement ; RDV annule -> tout est libere ; RDV « Entretien annuel + huile » ->
--   kits reunis sans double filtre ; OR depuis le RDV -> la reservation suit l'OR ; facture de l'OR ->
--   une seule sortie du stock reel, reservation consommee. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
-- Societe ITALBIKE, une moto du catalogue (Streetfighter V4, modele-annee 21110), un client,
-- le filtre a huile 44440312B (40 en stock) et une piece a 1 en stock (minimum 2, maximum 4).
insert into _ctx values
  ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33'),
  ('my', '21110');
insert into _ctx select 'vehicle', v.id::text from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and v.ducati_model_year_id = '21110' limit 1;
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
insert into _ctx select 'filter', a.id::text from public.articles a
 where a.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference = '44440312B' limit 1;
insert into _ctx
select 'low', m.article_id::text
  from public.stock_moves m join public.articles a on a.id = m.article_id and a.mgmt_type = 'A'
 where m.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and a.reference <> '44440312B'
 group by m.article_id
having coalesce(sum(m.qty_delta) filter (where not m.is_reservation), 0) = 1
   and coalesce(sum(m.qty_delta) filter (where m.is_reservation), 0) = 0
 limit 1;
update public.articles set stock_min = 2, stock_max = 4 where id = (select v::uuid from _ctx where k = 'low');
update public.articles set stock_min = 0 where id = (select v::uuid from _ctx where k = 'filter');
-- Aucun panier ouvert au depart (celui du 03/11 est deja commande) : on part propre.
insert into _ctx select 'baskets_before', count(*)::text from public.supplier_baskets
 where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and status = 'ouvert';

-- Deux kits pour le modele-annee : Annual Service (filtre 1 + piece basse 2) et Oil Service (filtre 1).
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_v4', 'Essai V4', 'annual_service', 'Annual Service', 'essai-a', 'annual', 'manuel')
  returning id)
insert into _ctx select 'kit_annual', id::text from k;
with k as (
  insert into public.maintenance_kits (company_id, engine_family_key, engine_family_label, service_code, service_label,
                                       content_hash, service_kind, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'essai_v4', 'Essai V4', 'oil_service', 'Oil Service', 'essai-o', 'oil', 'manuel')
  returning id)
insert into _ctx select 'kit_oil', id::text from k;
insert into public.maintenance_kit_model_years (kit_id, model_year_id)
select v::uuid, '21110' from _ctx where k in ('kit_annual', 'kit_oil');
insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, sort_order)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_annual'), a.id, a.reference, a.designation,
       case when a.id = (select v::uuid from _ctx where k = 'low') then 2 else 1 end, 'piece', 'sur', 1
  from public.articles a where a.id in (select v::uuid from _ctx where k in ('filter', 'low'));
insert into public.maintenance_kit_items (company_id, kit_id, article_id, reference, designation, quantity, kind, confidence, sort_order)
select '3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'kit_oil'), a.id, a.reference, a.designation, 1, 'piece', 'sur', 1
  from public.articles a where a.id = (select v::uuid from _ctx where k = 'filter');

insert into _t(check_name, result)
select 'preparation : moto, client, filtre, piece basse, 2 kits',
       case when (select count(*) from _ctx where k in ('vehicle', 'contact', 'filter', 'low', 'kit_annual', 'kit_oil')) = 6 then 'ok'
            else 'KO ' || (select string_agg(k, ',') from _ctx) end;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

insert into _t(check_name, result)
select 'motifs : « Entretien annuel + huile » actif (Oil Service), 15 000 / 30 000 km retires',
       case when exists (select 1 from public.reference_values where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
                          and table_key = 'workshop_reason' and code = 'entretien_annuel_huile' and is_active
                          and extra ->> 'service_code' = 'oil')
             and not exists (select 1 from public.reference_values where company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33'
                          and table_key = 'workshop_reason' and code in ('entretien_15000', 'entretien_30000') and is_active)
            then 'ok' else 'KO' end;

-- RDV « Entretien annuel » dans 10 jours (le panier du manque est donc le standard).
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status, reason_code, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'),
          date_trunc('day', now()) + interval '10 days 9 hours', 90, 'prevu', 'entretien_annuel', 'dms')
  returning id, service_code)
insert into _ctx select 'rdv1', id::text from a;

insert into _t(check_name, result)
select 'RDV : le motif pose l''entretien (annual)',
       case when (select service_code from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'rdv1')) = 'annual'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'RDV annuel : filtre reserve (1), disponible 40 -> 39',
       case when s.qty_reserved = 1 and s.qty_needed = 1 and st.reserved_qty = 1 and st.available_qty = st.real_qty - 1
            then 'ok' else 'KO ' || coalesce(s.qty_reserved::text, 'aucune') || ' / ' || coalesce(st.reserved_qty::text, '?') end
  from public.stock_reservations s, public.article_stock(s.article_id) st
 where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and s.article_id = (select v::uuid from _ctx where k = 'filter');

insert into _t(check_name, result)
select 'RDV annuel : piece basse besoin 2, reel 1 -> 1 reservee, 1 au panier (atelier, client)',
       case when s.qty_needed = 2 and s.qty_reserved = 1 and s.qty_to_order = 1 and s.basket_kind = 'standard'
             and exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                          where l.origin_line_id = s.id and l.origin = 'atelier' and l.qty = 1 and b.kind = 'standard'
                            and l.contact_id = s.contact_id and l.origin_ref like 'RDV %')
            then 'ok' else 'KO ' || s.qty_reserved || '/' || s.qty_to_order end
  from public.stock_reservations s
 where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and s.article_id = (select v::uuid from _ctx where k = 'low');

-- (controles internes : proprietaire de la base)
reset role;
-- Minimax : stock du minimax = 1 - 1 - 1 = -1 < 2 -> 4 - (-1) - 1 (au panier) - autres commandes.
insert into _t(check_name, result)
select 'minimax : la piece basse entre au panier standard, origine minimax',
       case when l.qty = public._basket_minimax_qty(2, 4, -1,
                   public._basket_on_order_qty('3d9f0f13-a691-4d07-ad58-34590df86e33', l.article_id, l.basket_id)
                   + coalesce((select sum(x.qty) from public.supplier_basket_lines x where x.basket_id = l.basket_id
                                and x.article_id = l.article_id and x.origin <> 'minimax'), 0))
             and l.qty > 0 and b.kind = 'standard' and b.status = 'ouvert'
            then 'ok (' || l.qty || ')' else 'KO ' || coalesce(l.qty::text, 'aucune') end
  from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
 where l.article_id = (select v::uuid from _ctx where k = 'low') and l.origin = 'minimax';

insert into _t(check_name, result)
select 'minimax de nuit : meme quantite, la ligne n''est pas retiree',
       case when (public._basket_fill_minimax(b.id) ->> 'removed')::int = 0
             and exists (select 1 from public.supplier_basket_lines l where l.basket_id = b.id and l.origin = 'minimax'
                          and l.article_id = (select v::uuid from _ctx where k = 'low'))
            then 'ok' else 'KO' end
  from public.supplier_baskets b
 where b.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and b.kind = 'standard' and b.status = 'ouvert'
 order by b.created_at desc limit 1;

set local role authenticated;

insert into _t(check_name, result)
select 'bloc Pieces reservees : filtre « reservee », piece basse « a_commander »',
       case when (select display_status from public.workshop_reservations_list((select v::uuid from _ctx where k = 'rdv1'), null) x
                   where x.article_id = (select v::uuid from _ctx where k = 'filter')) = 'reservee'
             and (select display_status from public.workshop_reservations_list((select v::uuid from _ctx where k = 'rdv1'), null) x
                   where x.article_id = (select v::uuid from _ctx where k = 'low')) = 'a_commander'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'fiche article / comptoir : reservation du filtre visible (RDV, client, date)',
       case when exists (select 1 from public.article_reservations((select v::uuid from _ctx where k = 'filter')) x
                          where x.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and x.holder like 'RDV %'
                            and x.due_at is not null and x.qty_reserved = 1)
            then 'ok' else 'KO' end;

do $$ begin
  insert into public.stock_reservations (company_id, article_id, qty_needed)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'filter'), 1);
  insert into _t(check_name, result) values ('droits : aucune ecriture directe dans stock_reservations', 'KO');
exception when insufficient_privilege then
  insert into _t(check_name, result) values ('droits : aucune ecriture directe dans stock_reservations', 'ok');
end $$;

-- RDV deplace : date suivie, aucun mouvement.
insert into _ctx select 'moves_before_move', count(*)::text from public.stock_moves where origin = 'atelier';
update public.workshop_appointments set starts_at = starts_at + interval '1 day' where id = (select v::uuid from _ctx where k = 'rdv1');
insert into _t(check_name, result)
select 'RDV deplace : la reservation suit la date, aucun mouvement',
       case when (select count(*) from public.stock_moves where origin = 'atelier') = (select v::int from _ctx where k = 'moves_before_move')
             and (select bool_and(s.due_at = a.starts_at) from public.stock_reservations s
                    join public.workshop_appointments a on a.id = s.appointment_id
                   where s.appointment_id = (select v::uuid from _ctx where k = 'rdv1') and s.status = 'active')
            then 'ok' else 'KO' end;

-- RDV annule : tout est libere.
update public.workshop_appointments set status = 'annule' where id = (select v::uuid from _ctx where k = 'rdv1');
insert into _t(check_name, result)
select 'RDV annule : reservations liberees, filtre reserve 0',
       case when not exists (select 1 from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv1') and status = 'active')
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'filter'))) = 0
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'low'))) = 0
            then 'ok' else 'KO' end;

-- RDV « Entretien annuel + huile » : Annual + Oil, filtre une seule fois.
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status, reason_code, source)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'),
          date_trunc('day', now()) + interval '2 days 9 hours', 90, 'prevu', 'entretien_annuel_huile', 'dms')
  returning id)
insert into _ctx select 'rdv2', id::text from a;
insert into _t(check_name, result)
select 'RDV annuel + huile : entretien oil, filtre 1 (pas de double huile), piece basse 2',
       case when (select service_code from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'rdv2')) = 'oil'
             and (select qty_needed from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv2')
                   and article_id = (select v::uuid from _ctx where k = 'filter') and status = 'active') = 1
             and (select qty_needed from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv2')
                   and article_id = (select v::uuid from _ctx where k = 'low') and status = 'active') = 2
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'RDV dans 2 jours : le manque part au panier urgente',
       case when (select basket_kind from public.stock_reservations where appointment_id = (select v::uuid from _ctx where k = 'rdv2')
                   and article_id = (select v::uuid from _ctx where k = 'low') and status = 'active') = 'urgente'
            then 'ok' else 'KO' end;

-- OR ouvert depuis le RDV : la reservation suit l'OR (aucun mouvement).
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, status, reason_code)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-ATE015', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 'en_cours', 'entretien_annuel_huile')
  returning id)
insert into _ctx select 'or', id::text from r;
insert into _t(check_name, result)
select 'OR sans RDV lie : aucune reservation creee seule (pas de doublon)',
       case when not exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or'))
            then 'ok' else 'KO' end;
insert into _ctx select 'moves_before_or', count(*)::text from public.stock_moves where origin = 'atelier';
update public.workshop_appointments set or_id = (select v::uuid from _ctx where k = 'or'), status = 'en_cours'
 where id = (select v::uuid from _ctx where k = 'rdv2');
insert into _t(check_name, result)
select 'OR ouvert : la reservation suit l''OR, aucun mouvement, entretien oil sur l''OR',
       case when (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active') = 2
             and (select count(*) from public.stock_moves where origin = 'atelier') = (select v::int from _ctx where k = 'moves_before_or')
             and (select service_code from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) = 'oil'
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'commande depuis l''OR : le filtre reserve n''est pas « manquant »',
       case when coalesce((select missing_qty from public.repair_order_order_needs((select v::uuid from _ctx where k = 'or')) x
                            where x.article_id = (select v::uuid from _ctx where k = 'filter')), 0) = 0
             and coalesce((select missing_qty from public.repair_order_order_needs((select v::uuid from _ctx where k = 'or')) x
                            where x.article_id = (select v::uuid from _ctx where k = 'low')), 0) = 0
            then 'ok' else 'KO' end;

insert into _ctx select 'picking', public.picking_open_for_repair_order((select v::uuid from _ctx where k = 'or'))::text;
insert into _t(check_name, result)
select 'picking list depuis l''OR (sans parcours) : les pieces de l''entretien',
       case when (select count(*) from public.picking_list_items i
                   where i.picking_id = (select v::uuid from _ctx where k = 'picking') and i.origin = 'kit') = 2
            then 'ok' else 'KO ' || (select count(*) from public.picking_list_items i
                   where i.picking_id = (select v::uuid from _ctx where k = 'picking'))::text end;

-- Facture de l'OR : la facture sort le filtre (une fois), la reservation est consommee.
insert into _ctx select 'real_before', real_qty::text from public.article_stock((select v::uuid from _ctx where k = 'filter'));
with d as (
  insert into public.documents (company_id, doc_type, status, contact_id, vehicle_id, number)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'FAC', 'brouillon', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 'FAC-ESSAI-ATE015')
  returning id)
insert into _ctx select 'fac', id::text from d;
insert into public.document_lines (document_id, article_id, designation, quantity, unit_price_ht, vat_rate, sort_order)
select (select v::uuid from _ctx where k = 'fac'), a.id, a.designation, 1, 10, 21, 0
  from public.articles a where a.id = (select v::uuid from _ctx where k = 'filter');
-- La sortie que fait createDocument (M6) pour chaque ligne article de la facture.
select public.record_stock_move((select v::uuid from _ctx where k = 'filter'), 'sortie', -1, null, false, null, 'sale', 'FAC-ESSAI-ATE015', 'essai');
update public.repair_orders set status = 'facture', invoice_document_id = (select v::uuid from _ctx where k = 'fac')
 where id = (select v::uuid from _ctx where k = 'or');

insert into _t(check_name, result)
select 'facture : reel du filtre -1 une seule fois, reserve 0, reservation consommee',
       case when st.real_qty = (select v::numeric from _ctx where k = 'real_before') - 1 and st.reserved_qty = 0
             and (select count(*) from public.stock_moves m where m.article_id = (select v::uuid from _ctx where k = 'filter')
                   and not m.is_reservation and m.qty_delta < 0 and m.occurred_at >= now() - interval '1 minute') = 1
             and (select status || ':' || qty_consumed from public.stock_reservations
                   where repair_order_id = (select v::uuid from _ctx where k = 'or') and article_id = (select v::uuid from _ctx where k = 'filter')) = 'consommee:1.000'
            then 'ok' else 'KO ' || st.real_qty || '/' || st.reserved_qty end
  from public.article_stock((select v::uuid from _ctx where k = 'filter')) st;
insert into _t(check_name, result)
select 'facture : la piece reservee absente de la facture est liberee',
       case when (select status || ':' || release_reason from public.stock_reservations
                   where repair_order_id = (select v::uuid from _ctx where k = 'or') and article_id = (select v::uuid from _ctx where k = 'low')) = 'liberee:non_facturee'
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'low'))) = 0
            then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'B7 : chaque reservation / liberation est un mouvement, la somme revient a 0',
       case when (select coalesce(sum(qty_delta), 0) from public.stock_moves where origin = 'atelier' and is_reservation
                   and article_id in (select v::uuid from _ctx where k in ('filter', 'low'))) = 0
             and (select count(*) from public.stock_moves where origin = 'atelier') >= 6
            then 'ok' else 'KO' end;

reset role;
insert into _t(check_name, result)
select 'prochain entretien : l''OR facture avec un entretien choisi compte (source OR du DMS)',
       case when public._vehicle_maintenance_recompute_core((select v::uuid from _ctx where k = 'vehicle')) ->> 'source' = 'or_dms'
            then 'ok' else 'KO ' || coalesce(public._vehicle_maintenance_recompute_core((select v::uuid from _ctx where k = 'vehicle'))::text, '') end;

select n, check_name, result from _t order by n;
