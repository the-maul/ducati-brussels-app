-- =====================================================================
-- ATE005 / ATE022 / a-trancher T10 (19/11/2026) -- essai a blanc de la migration
-- 20261119180000_m8_contrat_pret_g8.sql (contrat de pret repris de G8).
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261119180000_m8_contrat_pret_g8.sql \
--      supabase/tests/m8_contrat_pret_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Pre-requis : migrations 20261118120000 et 20261118121000 (motos de pret) deja en base.
-- Scenario, administrateur simule d'ITALBIKE STORE (meme compte que l'essai m8_planning_charge_g8) :
--   franchise 500 par defaut pour chaque societe ; CG traduites NL / EN / IT ; franchise reglee a 750
--   puis reprise sur le nouveau pret ; franchise negative refusee ; moto du client et livraison prevue
--   reprises de l'OR ; donnees du conducteur gardees ; moto du client inconnue refusee ; retour : km et
--   carburant sur la moto de pret, km sur la fiche moto du parc liee ; audit dans events.
--   Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
 order by c.created_at limit 1;
-- Un OR ouvert avec une moto : sa moto et son « promis le » doivent passer sur le pret.
insert into _ctx select 'or', r.id::text from public.repair_orders r
 where r.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and r.vehicle_id is not null
   and r.status not in ('facture', 'annule')
 order by r.created_at desc limit 1;
insert into _ctx select 'or_vehicle', r.vehicle_id::text from public.repair_orders r where r.id = (select v::uuid from _ctx where k = 'or');
update public.repair_orders set promised_at = date_trunc('minute', now()) + interval '3 days'
 where id = (select v::uuid from _ctx where k = 'or');
insert into _ctx select 'promised', r.promised_at::text from public.repair_orders r where r.id = (select v::uuid from _ctx where k = 'or');
-- Une autre moto du parc, liee a la moto de pret (son km doit suivre le retour).
insert into _ctx select 'fleet_vehicle', v.id::text from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and v.id <> (select v::uuid from _ctx where k = 'or_vehicle')
   and coalesce(v.mileage, 0) < 900000
 order by v.created_at limit 1;
insert into _ctx select 'fleet_km', coalesce(v.mileage, 0)::text from public.vehicles v where v.id = (select v::uuid from _ctx where k = 'fleet_vehicle');

insert into _t(check_name, result)
select 'preparation : un OR ouvert avec moto et une autre moto du parc',
       case when (select count(*) from _ctx where k in ('or', 'or_vehicle', 'fleet_vehicle', 'contact')) = 4 then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'franchise 500 EUR par defaut pour chaque societe (G8)',
       case when (select count(*) from public.workshop_planning_settings where loan_deductible = 500)
                 = (select count(*) from public.workshop_planning_settings) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'conditions generales traduites NL / EN / IT (le FR reste loan_terms)',
       case when (select loan_terms_i18n ? 'nl' and loan_terms_i18n ? 'en' and loan_terms_i18n ? 'it'
                    and loan_terms_i18n->>'nl' like '1. De leenmotor%' and loan_terms_i18n->>'it' like '1. La moto di cortesia%'
                    and loan_terms like '1. La moto de prêt%'
                    from public.workshop_planning_settings where company_id = (select v::uuid from _ctx where k = 'company'))
            then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  update public.workshop_planning_settings set loan_deductible = -1 where company_id = (select v::uuid from _ctx where k = 'company');
  insert into _t(check_name, result) values ('franchise negative refusee (reglage)', 'KO : acceptee');
exception when check_violation then
  insert into _t(check_name, result) values ('franchise negative refusee (reglage)', 'ok');
end $$;
update public.workshop_planning_settings set loan_deductible = 750 where company_id = (select v::uuid from _ctx where k = 'company');

with l as (
  insert into public.workshop_loaner_vehicles (company_id, vehicle_id, label, brand, plate, power, current_km)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'fleet_vehicle'),
          'Essai contrat G8', 'Ducati', '1-ESS-000', '82 kW / 111 ch', 100) returning id)
insert into _ctx select 'loaner', id::text from l;

with p as (
  insert into public.workshop_loans (company_id, loaner_id, contact_id, or_id, planned_start, planned_end)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'loaner'), (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'or'), now() + interval '400 days', now() + interval '403 days') returning id)
insert into _ctx select 'loan', id::text from p;

insert into _t(check_name, result)
select 'nouveau pret : numero PRET et franchise du reglage (750)', case when (select number like 'PRET%' and deductible_amount = 750
  from public.workshop_loans where id = (select v::uuid from _ctx where k = 'loan')) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'moto du client et livraison prevue reprises de l''OR', case when (select customer_vehicle_id = (select v::uuid from _ctx where k = 'or_vehicle')
  and delivery_planned_at = (select v::timestamptz from _ctx where k = 'promised')
  from public.workshop_loans where id = (select v::uuid from _ctx where k = 'loan')) then 'ok' else 'KO' end;

update public.workshop_loans set
  driver_name = 'Essai Conducteur', driver_birth_date = '1980-01-02', driver_birth_place = 'Bari',
  driver_address = 'Rue Essai 1, 1000 Bruxelles', driver_phone = '0470000000', driver_license_number = 'B-555',
  driver_license_date = '2001-02-03', driver_license_issued_by = 'Ville de Bruxelles', driver_licence_number = 'LIC-9',
  contract_place = 'Bruxelles'
 where id = (select v::uuid from _ctx where k = 'loan');
insert into _t(check_name, result)
select 'donnees du conducteur gardees sur le pret (ne le / a, permis, licence)', case when (select driver_name = 'Essai Conducteur'
  and driver_birth_place = 'Bari' and driver_license_issued_by = 'Ville de Bruxelles' and driver_licence_number = 'LIC-9'
  and deductible_amount = 750 from public.workshop_loans where id = (select v::uuid from _ctx where k = 'loan')) then 'ok' else 'KO' end;

do $$ begin
  update public.workshop_loans set customer_vehicle_id = gen_random_uuid() where id = (select v::uuid from _ctx where k = 'loan');
  insert into _t(check_name, result) values ('moto du client hors societe refusee', 'KO : acceptee');
exception when others then
  insert into _t(check_name, result) values ('moto du client hors societe refusee', case when sqlstate = '23514' then 'ok' else 'KO ' || sqlerrm end);
end $$;
do $$ begin
  update public.workshop_loans set deductible_amount = -10 where id = (select v::uuid from _ctx where k = 'loan');
  insert into _t(check_name, result) values ('franchise negative refusee (pret)', 'KO : acceptee');
exception when check_violation then
  insert into _t(check_name, result) values ('franchise negative refusee (pret)', 'ok');
end $$;

-- Sortie puis retour : le retour alimente la moto de pret (km + carburant) et la fiche du parc liee (km).
update public.workshop_loans set status = 'sorti', out_at = now() + interval '400 days', out_km = (select v::int from _ctx where k = 'fleet_km') + 10, out_fuel = 'plein'
 where id = (select v::uuid from _ctx where k = 'loan');
update public.workshop_loans set status = 'rendu', returned_at = now() + interval '401 days', return_km = (select v::int from _ctx where k = 'fleet_km') + 510, return_fuel = 'quart'
 where id = (select v::uuid from _ctx where k = 'loan');
insert into _t(check_name, result)
select 'retour : km et carburant sur la moto de pret', case when (select current_km = (select v::int from _ctx where k = 'fleet_km') + 510
  and current_fuel = 'quart' from public.workshop_loaner_vehicles where id = (select v::uuid from _ctx where k = 'loaner')) then 'ok' else 'KO' end;

reset role;
insert into _t(check_name, result)
select 'retour : km de la fiche moto du parc liee mis a jour', case when (select mileage = (select v::int from _ctx where k = 'fleet_km') + 510
  from public.vehicles where id = (select v::uuid from _ctx where k = 'fleet_vehicle')) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'RLS toujours active sur les prets et la flotte', case when (select bool_and(relrowsecurity) from pg_class
  where oid in ('public.workshop_loans'::regclass, 'public.workshop_loaner_vehicles'::regclass, 'public.workshop_planning_settings'::regclass))
  then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'audit : saisie du contrat tracee dans events', case when
  (select count(*) from public.events where entity_type = 'workshop_loans' and entity_id = (select v from _ctx where k = 'loan')) >= 4
  then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
