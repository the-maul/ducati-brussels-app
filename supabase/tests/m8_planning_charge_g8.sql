-- =====================================================================
-- ATE002 / ATE005 (18/11/2026) -- essai a blanc des migrations 20261118120000_m8_planning_charge_g8.sql
-- et 20261118121000_m8_motos_de_pret.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migrations comprises (rien ne reste en base) :
--   (echo "begin;"; cat supabase/migrations/20261118120000_m8_planning_charge_g8.sql \
--      supabase/migrations/20261118121000_m8_motos_de_pret.sql \
--      supabase/tests/m8_planning_charge_g8.sql; echo "rollback;") > t.sql
--   npx supabase@2.117.0 db query --linked --project-ref <ref> -f t.sql
-- Scenario, administrateur simule d'ITALBIKE STORE (meme compte que l'essai m8_entretien_reservation) :
--   reglages et types de RDV poses ; compagnon lie a un non-membre refuse ; RDV en attente sans
--   compagnon ; glisse sur un compagnon (nom recopie) ; RDV simultane refuse quand le reglage le
--   bloque ; OR refuse sans temps prevu puis accepte ; statut du RDV qui suit l'OR ; recherche par
--   nom / immatriculation ; absence sans compagnon refusee ; pret : numero PRET, OR repris du RDV,
--   chevauchement refuse, sortie sans km refusee, retour km inferieur refuse, compteur mis a jour ;
--   audit dans events. Chaque ligne du resultat doit valoir « ok ».
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;
create temp table _ctx(k text primary key, v text) on commit drop;
grant all on _t, _ctx to authenticated;
grant usage on sequence _t_n_seq to authenticated;

-- ------------------------------------------------------------ 0. preparation (proprietaire de la base)
insert into _ctx values ('company', '3d9f0f13-a691-4d07-ad58-34590df86e33');
insert into _ctx select 'contact', c.id::text from public.contacts c
 where c.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and c.type <> 'fournisseur' and c.is_active
   and coalesce(btrim(c.last_name), '') <> ''
 order by c.created_at limit 1;
insert into _ctx select 'contact_name', lower(c.last_name) from public.contacts c where c.id = (select v::uuid from _ctx where k = 'contact');
insert into _ctx select 'vehicle', v.id::text from public.vehicles v
 where v.company_id = '3d9f0f13-a691-4d07-ad58-34590df86e33' and coalesce(v.plate, '') <> '' limit 1;
insert into _ctx select 'plate', v.plate from public.vehicles v where v.id = (select v::uuid from _ctx where k = 'vehicle');

insert into _t(check_name, result)
select 'reglages du planning poses pour chaque societe (granularite 10 min, mardi, feries belges)',
       case when (select count(*) from public.workshop_planning_settings s where s.slot_minutes = 10 and s.first_weekday = 2 and s.belgian_holidays)
                 = (select count(*) from public.companies) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'types de RDV parametrables precharges (6, couleur + duree)',
       case when (select count(*) from public.reference_values where company_id = (select v::uuid from _ctx where k = 'company')
                   and table_key = 'workshop_appointment_type' and extra ? 'color' and extra ? 'default_minutes') = 6 then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'sequence PRET des contrats de pret', case when exists (select 1 from public.document_sequences
  where company_id = (select v::uuid from _ctx where k = 'company') and doc_type = 'PRET') then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'conditions generales du pret pre-remplies (projet)', case when exists (select 1 from public.workshop_planning_settings
  where company_id = (select v::uuid from _ctx where k = 'company') and loan_terms like '1. La moto de prêt%') then 'ok' else 'KO' end;

-- ------------------------------------------------------------ 1. administrateur simule
select set_config('request.jwt.claims', '{"sub":"d9409378-a554-4cb2-97d6-e0b84aba204e","role":"authenticated"}', true);
set local role authenticated;

update public.workshop_planning_settings set block_overlaps = true where company_id = (select v::uuid from _ctx where k = 'company');

with m as (
  insert into public.workshop_mechanics (company_id, name, sort_order)
  values ((select v::uuid from _ctx where k = 'company'), '  Essai Jeremy ', 1) returning id)
insert into _ctx select 'mech', id::text from m;
insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
select (select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'mech'), d, '09:00', '12:30', '13:30', '18:00'
  from generate_series(2, 6) d;

insert into _t(check_name, result)
select 'compagnon cree, nom nettoye, horaires du mardi au samedi',
       case when (select name from public.workshop_mechanics where id = (select v::uuid from _ctx where k = 'mech')) = 'Essai Jeremy'
             and (select count(*) from public.workshop_mechanic_hours where mechanic_id = (select v::uuid from _ctx where k = 'mech')) = 5
            then 'ok' else 'KO' end;

do $$
begin
  insert into public.workshop_mechanics (company_id, user_id, name)
  values ((select v::uuid from _ctx where k = 'company'), gen_random_uuid(), 'Intrus');
  insert into _t(check_name, result) values ('compagnon lie a un non-membre refuse', 'KO : accepte');
exception when others then
  insert into _t(check_name, result) values ('compagnon lie a un non-membre refuse', case when sqlerrm like '%membre lie%' or sqlstate = '23503' then 'ok' else 'KO ' || sqlerrm end);
end $$;

-- RDV en attente : on essaie de lui donner un compagnon, la base le retire.
with a as (
  insert into public.workshop_appointments (company_id, contact_id, vehicle_id, starts_at, planned_minutes, status, unassigned, mechanic_id, mileage, work_description)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'),
          date_trunc('week', now()) + interval '9 days 10 hours', null, 'prevu', true, (select v::uuid from _ctx where k = 'mech'), 60000, 'Essai planning G8')
  returning id)
insert into _ctx select 'appt', id::text from a;

insert into _t(check_name, result)
select 'RDV en attente : sans compagnon, sans temps prevu', case when (select mechanic_id is null and planned_minutes is null and unassigned
  from public.workshop_appointments where id = (select v::uuid from _ctx where k = 'appt')) then 'ok' else 'KO' end;

-- Glisser sur le compagnon mercredi 10:00 (semaine suivante), 2 h.
update public.workshop_appointments
   set unassigned = false, mechanic_id = (select v::uuid from _ctx where k = 'mech'),
       starts_at = date_trunc('week', now()) + interval '9 days 10 hours', planned_minutes = null
 where id = (select v::uuid from _ctx where k = 'appt');
insert into _t(check_name, result)
select 'RDV place : compagnon et nom recopie', case when (select mechanic_name from public.workshop_appointments
  where id = (select v::uuid from _ctx where k = 'appt')) = 'Essai Jeremy' then 'ok' else 'KO' end;

do $$
begin
  update public.workshop_appointments set or_id = (select id from public.repair_orders where company_id = (select v::uuid from _ctx where k = 'company') limit 1)
   where id = (select v::uuid from _ctx where k = 'appt');
  insert into _t(check_name, result) values ('OR refuse sans temps prevu', 'KO : accepte');
exception when others then
  insert into _t(check_name, result) values ('OR refuse sans temps prevu', case when sqlerrm like 'Temps prevu obligatoire%' then 'ok' else 'KO ' || sqlerrm end);
end $$;

update public.workshop_appointments set planned_minutes = 120 where id = (select v::uuid from _ctx where k = 'appt');

do $$
begin
  insert into public.workshop_appointments (company_id, starts_at, planned_minutes, status, mechanic_id)
  values ((select v::uuid from _ctx where k = 'company'), date_trunc('week', now()) + interval '9 days 10 hours 30 minutes', 60, 'prevu',
          (select v::uuid from _ctx where k = 'mech'));
  insert into _t(check_name, result) values ('RDV simultane du meme compagnon refuse (reglage actif)', 'KO : accepte');
exception when others then
  insert into _t(check_name, result) values ('RDV simultane du meme compagnon refuse (reglage actif)', case when sqlstate = '23P01' then 'ok' else 'KO ' || sqlerrm end);
end $$;

-- Valider RDV et saisie OR.
with o as (
  insert into public.repair_orders (company_id, number, contact_id, vehicle_id, mileage, status, warranty_status)
  values ((select v::uuid from _ctx where k = 'company'), public.next_document_number((select v::uuid from _ctx where k = 'company'), 'OR'),
          (select v::uuid from _ctx where k = 'contact'), (select v::uuid from _ctx where k = 'vehicle'), 60000, 'en_cours', 'aucune')
  returning id)
insert into _ctx select 'or', id::text from o;
update public.workshop_appointments set or_id = (select v::uuid from _ctx where k = 'or'), status = 'en_cours'
 where id = (select v::uuid from _ctx where k = 'appt');

update public.repair_orders set status = 'pret' where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'OR « pret » → RDV « travaux termines »', case when (select status from public.workshop_appointments
  where id = (select v::uuid from _ctx where k = 'appt')) = 'termine' then 'ok' else 'KO' end;
update public.repair_orders set status = 'a_faire' where id = (select v::uuid from _ctx where k = 'or');
insert into _t(check_name, result)
select 'OR « a faire » → RDV « vehicule arrive »', case when (select status from public.workshop_appointments
  where id = (select v::uuid from _ctx where k = 'appt')) = 'arrive' then 'ok' else 'KO' end;

insert into _t(check_name, result)
select 'recherche RDV par nom du client', case when exists (select 1 from public.workshop_appointment_search(
  (select v::uuid from _ctx where k = 'company'), (select v from _ctx where k = 'contact_name'), 200) s
  where s.id = (select v::uuid from _ctx where k = 'appt')) then 'ok' else 'KO' end;
insert into _t(check_name, result)
select 'recherche RDV par immatriculation (sans tirets)', case when exists (select 1 from public.workshop_appointment_search(
  (select v::uuid from _ctx where k = 'company'), regexp_replace((select v from _ctx where k = 'plate'), '[^A-Za-z0-9]', '', 'g'), 200) s
  where s.id = (select v::uuid from _ctx where k = 'appt')) then 'ok' else 'KO' end;

do $$
begin
  insert into public.workshop_calendar_blocks (company_id, kind, starts_at, ends_at)
  values ((select v::uuid from _ctx where k = 'company'), 'absence', now(), now() + interval '1 day');
  insert into _t(check_name, result) values ('absence sans compagnon refusee', 'KO : acceptee');
exception when check_violation then
  insert into _t(check_name, result) values ('absence sans compagnon refusee', 'ok');
end $$;
insert into public.workshop_calendar_blocks (company_id, kind, mechanic_id, starts_at, ends_at, label)
values ((select v::uuid from _ctx where k = 'company'), 'absence', (select v::uuid from _ctx where k = 'mech'), now(), now() + interval '1 day', 'Essai');
insert into _t(check_name, result) values ('absence d''un compagnon enregistree', 'ok');

-- ------------------------------------------------------------ 2. motos de pret
with l as (
  insert into public.workshop_loaner_vehicles (company_id, label, brand, plate, current_km)
  values ((select v::uuid from _ctx where k = 'company'), 'Monster 937 essai', 'Ducati', '1-ESS-937', 1000) returning id)
insert into _ctx select 'loaner', id::text from l;
with p as (
  insert into public.workshop_loans (company_id, loaner_id, contact_id, appointment_id, planned_start, planned_end)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'loaner'), (select v::uuid from _ctx where k = 'contact'),
          (select v::uuid from _ctx where k = 'appt'), date_trunc('week', now()) + interval '9 days 10 hours', date_trunc('week', now()) + interval '10 days 18 hours')
  returning id)
insert into _ctx select 'loan', id::text from p;
insert into _t(check_name, result)
select 'pret : numero PRET et OR repris du RDV', case when (select number like 'PRET%' and or_id = (select v::uuid from _ctx where k = 'or')
  from public.workshop_loans where id = (select v::uuid from _ctx where k = 'loan')) then 'ok' else 'KO' end;

do $$
begin
  insert into public.workshop_loans (company_id, loaner_id, planned_start, planned_end)
  values ((select v::uuid from _ctx where k = 'company'), (select v::uuid from _ctx where k = 'loaner'),
          date_trunc('week', now()) + interval '10 days 9 hours', date_trunc('week', now()) + interval '10 days 12 hours');
  insert into _t(check_name, result) values ('pret qui chevauche refuse', 'KO : accepte');
exception when others then
  insert into _t(check_name, result) values ('pret qui chevauche refuse', case when sqlstate = '23P01' then 'ok' else 'KO ' || sqlerrm end);
end $$;

do $$
begin
  update public.workshop_loans set status = 'sorti', out_at = now() where id = (select v::uuid from _ctx where k = 'loan');
  insert into _t(check_name, result) values ('sortie sans km refusee', 'KO : acceptee');
exception when check_violation then
  insert into _t(check_name, result) values ('sortie sans km refusee', 'ok');
end $$;
update public.workshop_loans set status = 'sorti', out_at = now(), out_km = 1000, out_fuel = 'plein' where id = (select v::uuid from _ctx where k = 'loan');

do $$
begin
  update public.workshop_loans set status = 'rendu', returned_at = now() + interval '1 hour', return_km = 900 where id = (select v::uuid from _ctx where k = 'loan');
  insert into _t(check_name, result) values ('retour avec km inferieur refuse', 'KO : accepte');
exception when check_violation then
  insert into _t(check_name, result) values ('retour avec km inferieur refuse', 'ok');
end $$;
update public.workshop_loans set status = 'rendu', returned_at = now() + interval '1 hour', return_km = 1140, return_fuel = 'trois_quarts'
 where id = (select v::uuid from _ctx where k = 'loan');
insert into _t(check_name, result)
select 'retour : compteur de la moto de pret mis a jour', case when (select current_km from public.workshop_loaner_vehicles
  where id = (select v::uuid from _ctx where k = 'loaner')) = 1140 then 'ok' else 'KO' end;

reset role;
insert into _t(check_name, result)
select 'audit : compagnon, RDV et pret traces dans events', case when
  exists (select 1 from public.events where entity_type = 'workshop_mechanics' and entity_id = (select v from _ctx where k = 'mech'))
  and exists (select 1 from public.events where entity_type = 'workshop_loans' and entity_id = (select v from _ctx where k = 'loan'))
  and (select count(*) from public.events where entity_type = 'workshop_appointments' and entity_id = (select v from _ctx where k = 'appt')) >= 4
  then 'ok' else 'KO' end;

select n, check_name, result from _t order by n;
