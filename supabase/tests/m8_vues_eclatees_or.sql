-- =====================================================================
-- Lot E du parcours mecanicien (19/11/2026) -- essai a blanc de 20261119280000_m8_vues_eclatees_or.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119280000_m8_vues_eclatees_or.sql \
--      supabase/tests/m8_vues_eclatees_or.sql; echo "rollback;") > t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE, OR de reparation SANS entretien (aucun kit) :
--   « Reserver » depuis la vue eclatee une piece en stock -> reservee (mouvement de reservation) ;
--   une piece sans stock -> manque au panier ; une piece remplacee sans stock -> jamais au panier ;
--   une piece non stockee (type M) -> refusee ; deuxieme clic -> la quantite s'ajoute (une seule
--   reservation) ; la synchronisation de l'OR ne libere pas ces reservations ; la picking list de
--   l'OR les reprend ; une entree en stock re-reserve pour l'OR ; non-membre -> refuse ; OR annule ->
--   tout est libere et la somme des mouvements de reservation revient a 0 (B7) ; OR annule -> refuse.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
with v as (
  insert into public.vehicles (company_id, brand, model, status, holder_contact_id, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI LOT E', 'vendu',
          (select v::uuid from _ctx where k = 'contact'), 'ESSAI A BLANC (transaction annulee)')
  returning id)
insert into _ctx select 'vehicle', id::text from v;
-- Quatre pieces d'essai : en stock (3), sans stock, remplacee sans stock, non stockee (M).
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc,
                               vat_rate, supplier_availability, stock_min)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LOTE-STOCK', 'Levier essai lot E', 'A', 10, 10, 20, 24.2, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LOTE-MANQUE', 'Joint essai lot E', 'A', 2, 2, 5, 6.05, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LOTE-REMPL', 'Vis essai lot E', 'A', 1, 1, 2, 2.42, 21, 'yellow', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LOTE-NS', 'Article non stocke essai', 'M', 1, 1, 2, 2.42, 21, 'green', 0)
  returning id, reference)
insert into _ctx select case reference when 'ESSAI-LOTE-STOCK' then 'stock' when 'ESSAI-LOTE-MANQUE' then 'manque'
                                       when 'ESSAI-LOTE-REMPL' then 'rempl' else 'ns' end, id::text from a;
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-LOTE', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 12000, 'a_faire')
  returning id)
insert into _ctx select 'or', id::text from r;

insert into _t(check_name, result)
select 'preparation : client, moto, 4 pieces, OR sans entretien',
       case when (select count(*) from _ctx where k in ('contact', 'vehicle', 'stock', 'manque', 'rempl', 'ns', 'or')) = 7
             and (select service_code from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) is null
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'stock'), 'entree', 3, 10, false, null, 'reception', 'REC-ESSAI-LOTE', 'essai lot E');

insert into _ctx select 'r1', public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'stock'), 2)::text;
insert into _t(check_name, result)
select 'piece en stock : reservee pour l''OR (2 sur 2), origine manuel, mouvement de reservation +2',
       case when ((select v::jsonb from _ctx where k = 'r1') ->> 'qty_reserved')::numeric = 2
             and ((select v::jsonb from _ctx where k = 'r1') ->> 'origin') = 'manuel'
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'stock'))) = 2
             and (select count(*) from public.stock_moves where article_id = (select v::uuid from _ctx where k = 'stock')
                   and is_reservation and qty_delta = 2 and ref = 'OR-ESSAI-LOTE') = 1
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r1') end;

insert into _ctx select 'r2', public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'manque'), 1)::text;
insert into _t(check_name, result)
select 'piece sans stock : rien de reserve, le manque part au panier (OR sans RDV = urgente)',
       case when ((select v::jsonb from _ctx where k = 'r2') ->> 'qty_reserved')::numeric = 0
             and ((select v::jsonb from _ctx where k = 'r2') ->> 'qty_to_order')::numeric = 1
             and ((select v::jsonb from _ctx where k = 'r2') ->> 'basket_kind') = 'urgente'
             and exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                          where l.origin_line_id = ((select v::jsonb from _ctx where k = 'r2') ->> 'reservation_id')::uuid
                            and b.status = 'ouvert' and b.kind = 'urgente' and l.qty = 1)
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r2') end;

insert into _ctx select 'r3', public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'rempl'), 1)::text;
insert into _t(check_name, result)
select 'piece remplacee sans stock : jamais au panier, signalee (order_blocked)',
       case when ((select v::jsonb from _ctx where k = 'r3') ->> 'order_blocked')::boolean
             and ((select v::jsonb from _ctx where k = 'r3') ->> 'qty_to_order')::numeric = 0
             and not exists (select 1 from public.supplier_basket_lines l
                              where l.origin_line_id = ((select v::jsonb from _ctx where k = 'r3') ->> 'reservation_id')::uuid)
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r3') end;

do $$ begin
  perform public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'ns'), 1);
  insert into _t(check_name, result) values ('piece non stockee (type M) : refusee', 'KO (acceptee)');
exception when others then
  insert into _t(check_name, result) values ('piece non stockee (type M) : refusee', case when sqlerrm like '%non stockée%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

insert into _ctx select 'r4', public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'stock'), 1)::text;
insert into _t(check_name, result)
select 'deuxieme clic : la quantite s''ajoute (besoin 3, reserve 3), toujours UNE reservation active',
       case when ((select v::jsonb from _ctx where k = 'r4') ->> 'qty_needed')::numeric = 3
             and ((select v::jsonb from _ctx where k = 'r4') ->> 'qty_reserved')::numeric = 3
             and (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'stock') and status = 'active') = 1
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r4') end;

insert into _ctx select 'sync', public.workshop_reservations_sync(null, (select v::uuid from _ctx where k = 'or'))::text;
insert into _t(check_name, result)
select 'synchronisation de l''OR (bouton « Reserver / mettre a jour ») : rien n''est libere, rien en double',
       case when ((select v::jsonb from _ctx where k = 'sync') ->> 'released')::int = 0
             and ((select v::jsonb from _ctx where k = 'sync') ->> 'moves')::int = 0
             and ((select v::jsonb from _ctx where k = 'sync') ->> 'basket_lines')::int = 0
             and (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active') = 3
            then 'ok' else 'KO ' || (select v from _ctx where k = 'sync') end;

insert into _t(check_name, result)
select 'liste des pieces reservees de l''OR : les 3 pieces, avec leur etat',
       case when (select string_agg(l.reference || ':' || l.display_status, ',' order by l.reference)
                    from public.workshop_reservations_list(null, (select v::uuid from _ctx where k = 'or')) l)
                 = 'ESSAI-LOTE-MANQUE:a_commander,ESSAI-LOTE-REMPL:a_commander,ESSAI-LOTE-STOCK:reservee'
            then 'ok' else 'KO ' || coalesce((select string_agg(l.reference || ':' || l.display_status, ',' order by l.reference)
                    from public.workshop_reservations_list(null, (select v::uuid from _ctx where k = 'or')) l), '-') end;

insert into _ctx select 'pick', public.picking_open_for_repair_order((select v::uuid from _ctx where k = 'or'))::text;
insert into _t(check_name, result)
select 'picking list de l''OR : reprend les 3 pieces reservees, sans mouvement de stock',
       case when (select count(*) from public.picking_list_items i where i.picking_id = (select v::uuid from _ctx where k = 'pick')
                   and i.article_id in (select v::uuid from _ctx where k in ('stock', 'manque', 'rempl'))) = 3
             and (select count(*) from public.stock_moves where article_id in (select v::uuid from _ctx where k in ('stock', 'manque', 'rempl'))
                   and ref = 'OR-ESSAI-LOTE' and is_reservation) = 2
            then 'ok' else 'KO' end;

-- Reception de la piece qui manquait : meme chemin que la reception (record_stock_move).
select public.record_stock_move((select v::uuid from _ctx where k = 'manque'), 'entree', 1, 2, false, null, 'reception', 'REC-ESSAI-LOTE', 'essai lot E');
insert into _t(check_name, result)
select 'entree en stock : la piece se reserve seule pour l''OR qui l''attend',
       case when (select qty_reserved from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'manque') and status = 'active') = 1
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'manque'))) = 1
            then 'ok' else 'KO' end;
reset role;

-- ------------------------------------------------------------ 2. non-membre
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e0e0","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'stock'), 1);
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', 'KO (accepte)');
exception when others then
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', case when sqlstate = '42501' then 'ok' else 'KO ' || sqlerrm end);
end $$;
insert into _t(check_name, result)
select 'non-membre : ne lit aucune reservation (RLS)',
       case when (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')) = 0
            then 'ok' else 'KO' end;
reset role;

-- ------------------------------------------------------------ 3. OR annule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
update public.repair_orders set status = 'annule' where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'OR annule : tout est libere, la somme des mouvements de reservation revient a 0 (B7)',
       case when not exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active')
             and (select coalesce(sum(qty_delta), 0) from public.stock_moves
                   where is_reservation and article_id in (select v::uuid from _ctx where k in ('stock', 'manque', 'rempl'))) = 0
             and (select real_qty from public.article_stock((select v::uuid from _ctx where k = 'stock'))) = 3
            then 'ok' else 'KO' end;
do $$ begin
  perform public.workshop_reservation_add((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'stock'), 1);
  insert into _t(check_name, result) values ('OR annule : plus de reservation possible', 'KO (acceptee)');
exception when others then
  insert into _t(check_name, result) values ('OR annule : plus de reservation possible', case when sqlerrm like '%annulé%' then 'ok' else 'KO ' || sqlerrm end);
end $$;
reset role;
insert into _t(check_name, result)
select 'trace : chaque demande est dans events (workshop_reservation_request)',
       case when (select count(*) from public.events where action = 'workshop_reservation_request'
                   and new_data ->> 'repair_order_id' = (select v from _ctx where k = 'or')) = 4
            then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
