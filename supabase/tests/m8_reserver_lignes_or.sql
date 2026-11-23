-- =====================================================================
-- Essai a blanc de 20261123113000_m8_reserver_lignes_or.sql, DANS UNE TRANSACTION ANNULEE.
-- OR sans entretien : piece A (3 en stock) saisie x2, piece B (1 en stock) saisie x3, constats
-- « OK », « a prevoir », « reporte », article non stocke. Chaque ligne du resultat doit valoir « ok ».
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
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'DUCATI', 'ESSAI LIGNES', 'vendu',
          (select v::uuid from _ctx where k = 'contact'), 'ESSAI A BLANC (transaction annulee)')
  returning id)
insert into _ctx select 'vehicle', id::text from v;
with a as (
  insert into public.articles (company_id, reference, designation, mgmt_type, purchase_price, pamp, sale_price_ht, sale_price_ttc,
                               vat_rate, supplier_availability, stock_min)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-A', 'Piece A', 'A', 10, 10, 20, 24.2, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-B', 'Piece B', 'A', 5, 5, 12, 14.52, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-C', 'Constat OK', 'A', 5, 5, 12, 14.52, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-D', 'A prevoir', 'A', 5, 5, 12, 14.52, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-E', 'Reportee', 'A', 5, 5, 12, 14.52, 21, 'green', 0),
         ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'ESSAI-LIG-M', 'Non stockee', 'M', 5, 5, 12, 14.52, 21, 'green', 0)
  returning id, reference)
insert into _ctx select lower(right(reference, 1)), id::text from a;
with r as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values ('3d9f0f13-a691-4d07-ad58-34590df86e33', 'OR-ESSAI-LIG', (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'vehicle'), 12000, 'a_faire')
  returning id)
insert into _ctx select 'or', id::text from r;
insert into public.repair_order_lines (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, checkup_state)
select (select v::uuid from _ctx where k = 'or'), 'piece', (select v::uuid from _ctx where k = x.k), x.k, x.q, 10, 21, x.st
  from (values ('a', 2::numeric, null::text), ('b', 3, null), ('c', 1, 'ok'), ('d', 1, 'a_prevoir'), ('e', 1, 'reporte'), ('m', 1, null)) x(k, q, st);

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;
select public.record_stock_move((select v::uuid from _ctx where k = 'a'), 'entree', 3, 10, false, null, 'reception', 'REC-ESSAI-LIG', 'essai');
select public.record_stock_move((select v::uuid from _ctx where k = 'b'), 'entree', 1, 5, false, null, 'reception', 'REC-ESSAI-LIG', 'essai');

insert into _ctx select 's1', public.workshop_reservations_sync(null, (select v::uuid from _ctx where k = 'or'))::text;
insert into _t(check_name, result) select 'le bouton prend 2 pieces de l''OR',
  case when ((select v::jsonb from _ctx where k = 's1') ->> 'lines_added')::int = 2 then 'ok' else 'KO ' || (select v from _ctx where k = 's1') end;
insert into _t(check_name, result) select 'piece en stock : 2 reservees',
  case when exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
    and article_id = (select v::uuid from _ctx where k = 'a') and status = 'active' and origin = 'manuel' and qty_needed = 2 and qty_reserved = 2 and qty_to_order = 0)
    then 'ok' else 'KO' end;
insert into _t(check_name, result) select 'piece manquante : 1 reservee, 2 au panier',
  case when exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
    and article_id = (select v::uuid from _ctx where k = 'b') and status = 'active' and qty_needed = 3 and qty_reserved = 1 and qty_to_order = 2)
    then 'ok' else 'KO' end;
insert into _t(check_name, result) select 'constats OK, a prevoir, reportes et article non stocke : rien',
  case when not exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
    and article_id in (select v::uuid from _ctx where k in ('c', 'd', 'e', 'm'))) then 'ok' else 'KO' end;

insert into _ctx select 's2', public.workshop_reservations_sync(null, (select v::uuid from _ctx where k = 'or'))::text;
insert into _t(check_name, result) select 'deuxieme clic : rien ne change, rien de plus au panier',
  case when ((select v::jsonb from _ctx where k = 's2') ->> 'lines_added')::int = 0
        and ((select v::jsonb from _ctx where k = 's2') ->> 'moves')::int = 0
        and ((select v::jsonb from _ctx where k = 's2') ->> 'basket_lines')::int = 0
        and (select sum(qty_to_order) from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or') and status = 'active') = 2
       then 'ok' else 'KO ' || (select v from _ctx where k = 's2') end;
reset role;

update public.repair_order_lines set quantity = 3 where or_id = (select v::uuid from _ctx where k = 'or') and article_id = (select v::uuid from _ctx where k = 'a');
set local role authenticated;
select public.workshop_reservations_sync(null, (select v::uuid from _ctx where k = 'or'));
insert into _t(check_name, result) select 'quantite de la ligne augmentee puis bouton : reservation relevee a 3',
  case when exists (select 1 from public.stock_reservations where repair_order_id = (select v::uuid from _ctx where k = 'or')
    and article_id = (select v::uuid from _ctx where k = 'a') and status = 'active' and qty_needed = 3 and qty_reserved = 3) then 'ok' else 'KO' end;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e0e0","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.workshop_reservations_sync(null, (select v::uuid from _ctx where k = 'or'));
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', 'KO (accepte)');
exception when others then
  insert into _t(check_name, result) values ('non-membre de la societe : refuse', case when sqlstate = '42501' then 'ok' else 'KO ' || sqlerrm end);
end $$;
reset role;
