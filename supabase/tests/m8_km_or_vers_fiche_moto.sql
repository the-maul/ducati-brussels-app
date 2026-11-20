-- =====================================================================
-- Essai à blanc — Q64 (20/11/2026) : le km relevé sur l'OR met à jour la fiche moto, comme G8
-- (migration 20261120151000, rejouée par PRE_SQL). Société de test ItalTest, administrateur
-- simon@themaul.be, transaction annulée (rt.py). Chaque ligne du résultat doit valoir « ok ».
--   1. OR à 12 000 km sur une moto à 10 000 → fiche à 12 000, event vehicle_mileage_from_or ;
--   2. nouvel OR à 11 000 sans « Forcer » → refusé (hint mileage_lower, relevé 12 000) ;
--   3. le même avec « Forcer » (mileage_ack_previous) → accepté, la fiche reste à 12 000 ;
--   4. km de l'OR 1 porté à 13 000 → fiche à 13 000 ;
--   5. faute de frappe corrigée (OR 1 : 130 000 puis 12 500) → la fiche revient à 12 500 ;
--   6. km égal au dernier relevé → accepté sans « Forcer » ;
--   7. import / fonction serveur (sans utilisateur) : km inférieur non contrôlé.
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
grant all on _t to authenticated; grant usage on sequence _t_n_seq to authenticated;

do $s$
declare _c uuid; _v uuid; _or uuid;
begin
  insert into public.contacts (company_id, type, civility, first_name, last_name, country)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'particulier', 'Monsieur', 'TEST', 'KM Q64', 'BE') returning id into _c;
  insert into public.vehicles (company_id, brand, model, status, notes, mileage)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'DUCATI', 'ESSAI KM Q64', 'vendu', 'ESSAI A BLANC', 10000) returning id into _v;
  perform set_config('test.c', _c::text, true);
  perform set_config('test.v', _v::text, true);
end $s$;

select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _c uuid := current_setting('test.c')::uuid;
  _v uuid := current_setting('test.v')::uuid;
  _or1 uuid; _or2 uuid; _or3 uuid; _hint text; _det text; km int;
begin
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q64-1', _c, _v, 12000, 'a_faire') returning id into _or1;
  select mileage into km from public.vehicles where id = _v;
  insert into _t(check_name, result) values ('1 OR 12 000 > fiche 10 000 : fiche mise a jour + event',
    case when km = 12000 and exists (select 1 from public.events e where e.action = 'vehicle_mileage_from_or' and e.entity_id = _v::text
                                      and (e.old_data->>'mileage')::int = 10000 and (e.new_data->>'mileage')::int = 12000)
         then 'ok' else 'FAIL ' || coalesce(km::text, 'null') end);

  begin
    insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
    values (_co, 'ESSAI-Q64-2', _c, _v, 11000, 'a_faire');
    insert into _t(check_name, result) values ('2 km inferieur sans Forcer : refuse', 'FAIL accepte');
  exception when others then
    get stacked diagnostics _hint = pg_exception_hint, _det = pg_exception_detail;
    insert into _t(check_name, result) values ('2 km inferieur sans Forcer : refuse',
      case when _hint = 'mileage_lower' and _det = '12000' then 'ok' else 'FAIL ' || sqlerrm end);
  end;

  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, mileage_ack_previous, status)
  values (_co, 'ESSAI-Q64-2', _c, _v, 11000, 12000, 'a_faire') returning id into _or2;
  select mileage into km from public.vehicles where id = _v;
  insert into _t(check_name, result) values ('3 km inferieur avec Forcer : accepte, fiche inchangee',
    case when _or2 is not null and km = 12000 then 'ok' else 'FAIL ' || coalesce(km::text, 'null') end);

  update public.repair_orders set mileage = 13000 where id = _or1;
  select mileage into km from public.vehicles where id = _v;
  insert into _t(check_name, result) values ('4 km de l''OR porte a 13 000 : fiche a 13 000', case when km = 13000 then 'ok' else 'FAIL ' || km end);

  update public.repair_orders set mileage = 130000 where id = _or1;
  update public.repair_orders set mileage = 12500 where id = _or1;
  select mileage into km from public.vehicles where id = _v;
  insert into _t(check_name, result) values ('5 faute de frappe corrigee : fiche revient a 12 500', case when km = 12500 then 'ok' else 'FAIL ' || km end);

  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values (_co, 'ESSAI-Q64-3', _c, _v, 12500, 'a_faire') returning id into _or3;
  insert into _t(check_name, result) values ('6 km egal au dernier releve : accepte', case when _or3 is not null then 'ok' else 'FAIL' end);
end $s$;

reset role;
select set_config('request.jwt.claims', '', true);
do $s$
declare _or uuid;
begin
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status)
  values ('5593d97e-69ad-43dd-8237-4ab8aa4e5c08', 'ESSAI-Q64-4', current_setting('test.c')::uuid, current_setting('test.v')::uuid, 500, 'a_faire') returning id into _or;
  insert into _t(check_name, result) values ('7 sans utilisateur (import) : km inferieur non controle', case when _or is not null then 'ok' else 'FAIL' end);
end $s$;
