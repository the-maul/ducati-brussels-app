-- =====================================================================
-- Decision Q59 (20/11/2026) -- essai a blanc de 20261120103000_m8_reserver_ajoute_ligne_or.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   PRE_SQL = supabase/migrations/20261120103000_m8_reserver_ajoute_ligne_or.sql
-- Scenario, administrateur simule d'ITALBIKE STORE, OR sans entretien :
--   « Reserver » 2 pieces en stock -> reservation 2 ET ligne d'OR 2, au prix passe par l'ecran ;
--   deuxieme clic (1) -> reservation 3, la MEME ligne passe a 3 (pas de doublon), totaux de l'OR ;
--   piece deja sur l'OR (ligne de 5 saisie a la main) -> reservation 1, la ligne garde 5 ;
--   ligne retiree par l'editeur (reecriture des lignes) -> la reservation est liberee en fin de
--   transaction, mouvements de reservation a 0 (B7) ; quantite baissee -> liberation partielle ;
--   la reecriture complete des lignes (suppression + insertion) ne libere rien a tort.
-- Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
with v as (
  insert into public.vehicles (company_id, brand, model, status, holder_contact_id, notes)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI Q59', 'vendu',
          (select v::uuid from _ctx where k = 'contact'), 'ESSAI A BLANC (transaction annulee)')
  returning id)
insert into _ctx select 'vehicle', id::text from v;
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc,
                               vat_rate, supplier_availability, stock_min)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-Q59-A', 'Levier essai Q59', 'A', 10, 10, 20, 24.2, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-Q59-B', 'Filtre essai Q59', 'A', 5, 5, 12, 14.52, 21, 'green', 0)
  returning id, reference)
insert into _ctx select case reference when 'ESSAI-Q59-A' then 'a' else 'b' end, id::text from a;
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-Q59', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 12000, 'a_faire')
  returning id)
insert into _ctx select 'or', id::text from r;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'a'), 'entree', 10, 10, false, null, 'reception', 'REC-ESSAI-Q59', 'essai Q59');
select public.record_stock_move((select v::uuid from _ctx where k = 'b'), 'entree', 10, 5, false, null, 'reception', 'REC-ESSAI-Q59', 'essai Q59');

-- ------------------------------------------------------------ 1. Reserver = reservation + ligne
insert into _ctx select 'r1', public.workshop_reservation_add_line((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'a'), 2,
  '{"designation":"Levier essai Q59","unit_price_ht":18,"vat_rate":21,"discount_pct":10}'::jsonb)::text;
insert into _t(check_name, result)
select 'Reserver 2 : reservation de 2 ET ligne d''OR de 2 au prix de l''ecran (18 HT, remise 10 %)',
       case when ((select v::jsonb from _ctx where k = 'r1') ->> 'qty_reserved')::numeric = 2
             and ((select v::jsonb from _ctx where k = 'r1') ->> 'line_status') = 'created'
             and (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')) = 1
             and exists (select 1 from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')
                          and article_id = (select v::uuid from _ctx where k = 'a') and kind = 'piece'
                          and quantity = 2 and unit_price_ht = 18 and discount_pct = 10 and line_ht = 32.4 and line_ttc = 39.2)
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r1') end;
insert into _t(check_name, result)
select 'totaux de l''OR recalcules (32,40 HT / 39,20 TTC)',
       case when (select total_ht = 32.4 and total_ttc = 39.2 from public.repair_orders where id = (select v::uuid from _ctx where k = 'or'))
            then 'ok' else 'KO ' || (select total_ht || '/' || total_ttc from public.repair_orders where id = (select v::uuid from _ctx where k = 'or')) end;

insert into _ctx select 'r2', public.workshop_reservation_add_line((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'a'), 1,
  '{"designation":"Levier essai Q59","unit_price_ht":99,"vat_rate":21}'::jsonb)::text;
insert into _t(check_name, result)
select 'deuxieme clic : reservation 3, la MEME ligne passe a 3 (pas de doublon, prix de la ligne garde)',
       case when ((select v::jsonb from _ctx where k = 'r2') ->> 'qty_needed')::numeric = 3
             and ((select v::jsonb from _ctx where k = 'r2') ->> 'line_status') = 'adjusted'
             and (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')) = 1
             and (select quantity = 3 and unit_price_ht = 18 from public.repair_order_lines
                   where or_id = (select v::uuid from _ctx where k = 'or') and article_id = (select v::uuid from _ctx where k = 'a'))
             and (select count(*) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'a') and status = 'active') = 1
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r2') end;
insert into _t(check_name, result)
select 'trace : ligne creee puis ajustee depuis la reservation (events)',
       case when (select count(*) from public.events where action = 'repair_order_line_from_reservation'
                   and entity_id = (select v from _ctx where k = 'or')) = 2
            then 'ok' else 'KO' end;

-- Piece deja saisie a la main (5) : la ligne couvre deja la reservation, rien ne bouge.
reset role;
insert into public.repair_order_lines (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
values ((select v::uuid from _ctx where k = 'or'), 'piece', (select v::uuid from _ctx where k = 'b'), 'Filtre essai Q59', 5, 12, 21, 0, 60, 72.6, 5);
set constraints all immediate;
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
insert into _ctx select 'r3', public.workshop_reservation_add_line((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'b'), 1,
  '{"unit_price_ht":12,"vat_rate":21}'::jsonb)::text;
insert into _t(check_name, result)
select 'piece deja sur l''OR (5) : reservation de 1, la ligne garde 5, toujours 2 lignes',
       case when ((select v::jsonb from _ctx where k = 'r3') ->> 'line_status') = 'kept'
             and ((select v::jsonb from _ctx where k = 'r3') ->> 'qty_reserved')::numeric = 1
             and ((select v::jsonb from _ctx where k = 'r3') ->> 'line_qty')::numeric = 5
             and (select count(*) from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')) = 2
            then 'ok' else 'KO ' || (select v from _ctx where k = 'r3') end;

-- ------------------------------------------------------------ 2. l'editeur reecrit les lignes
-- Reecriture complete a l'identique (suppression + insertion) : rien n'est libere.
select set_config('ducati.rolf_' || replace((select v from _ctx where k = 'or'), '-', ''), '', true);
select public.repair_order_write_lines((select v::uuid from _ctx where k = 'or'), (
  select jsonb_agg(jsonb_build_object('kind', kind, 'article_id', article_id, 'designation', designation, 'quantity', quantity,
                                      'unit_price_ht', unit_price_ht, 'vat_rate', vat_rate, 'discount_pct', discount_pct,
                                      'line_ht', line_ht, 'line_ttc', line_ttc) order by sort_order)
    from public.repair_order_lines where or_id = (select v::uuid from _ctx where k = 'or')));
set constraints all immediate;
insert into _t(check_name, result)
select 'reecriture des lignes a l''identique : reservations intactes (3 + 1)',
       case when (select qty_needed from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'a') and status = 'active') = 3
             and (select qty_needed from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                   and article_id = (select v::uuid from _ctx where k = 'b') and status = 'active') = 1
            then 'ok' else 'KO' end;

-- Ligne du levier baissee a 1, ligne du filtre retiree.
select set_config('ducati.rolf_' || replace((select v from _ctx where k = 'or'), '-', ''), '', true);
select public.repair_order_write_lines((select v::uuid from _ctx where k = 'or'), jsonb_build_array(
  jsonb_build_object('kind', 'piece', 'article_id', (select v from _ctx where k = 'a'), 'designation', 'Levier essai Q59',
                     'quantity', 1, 'unit_price_ht', 18, 'vat_rate', 21, 'discount_pct', 10, 'line_ht', 16.2, 'line_ttc', 19.6)));
set constraints all immediate;
insert into _t(check_name, result)
select 'quantite baissee a 1 : la reservation suit (besoin 1, reserve 1, liberation partielle tracee)',
       case when (select qty_needed = 1 and qty_reserved = 1 from public.stock_reservations
                   where repair_order_id = (select v::uuid from _ctx where k = 'or') and article_id = (select v::uuid from _ctx where k = 'a') and status = 'active')
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'a'))) = 1
             and exists (select 1 from public.events where action = 'workshop_reservation_follow_lines'
                          and new_data->>'article_id' = (select v from _ctx where k = 'a'))
            then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'ligne retiree : la reservation du filtre est liberee, mouvements de reservation a 0 (B7)',
       case when not exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
                              and article_id = (select v::uuid from _ctx where k = 'b') and status = 'active')
             and (select coalesce(sum(qty_delta), 0) from public.stock_moves
                   where article_id = (select v::uuid from _ctx where k = 'b') and is_reservation) = 0
             and (select reserved_qty from public.article_stock((select v::uuid from _ctx where k = 'b'))) = 0
            then 'ok' else 'KO' end;
reset role;

-- ------------------------------------------------------------ 3. non-membre
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e0e0","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.workshop_reservation_add_line((select v::uuid from _ctx where k = 'or'), (select v::uuid from _ctx where k = 'a'), 1, null);
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', 'KO (accepte)');
exception when others then
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', case when sqlstate = '42501' then 'ok' else 'KO ' || sqlerrm end);
end $$;
reset role;
