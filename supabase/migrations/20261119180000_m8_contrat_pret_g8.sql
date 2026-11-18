-- =====================================================================
-- M8 — Contrat de pret repris de G8 (19/11/2026, ATE005, ATE022, a-trancher T10)
--
-- Decision client : le contrat de pret du DMS contient AU MINIMUM tout ce que contient le contrat
-- G8 « CONTRAT DE PRET DE VEHICULE DE REMPLACEMENT » (une page A4) ; nos conditions generales sont
-- gardees telles quelles, imprimees au verso, dans la langue du client.
--
--   1. workshop_planning_settings (une ligne par societe) :
--        loan_deductible   franchise en cas d'accident ou de degats, 500 EUR par defaut (G8) ;
--        loan_terms_i18n   conditions generales en NL / EN / IT (le FR reste loan_terms).
--   2. workshop_loaner_vehicles : power (puissance imprimee, ex. « 82 kW / 111 ch ») et
--      current_fuel (carburant au dernier retour, propose a la sortie suivante).
--   3. workshop_loans, donnees du contrat (prefill depuis la fiche client / l'OR, modifiables) :
--        conducteur : nom, ne le / a, adresse, telephone, permis n° / delivre le / par, n° licence ;
--        moto du client en reparation (customer_vehicle_id) et livraison prevue (delivery_planned_at) ;
--        franchise figee a la creation du pret (deductible_amount) ; lieu « Fait a » (contract_place).
--   4. Garde du pret : moto du client de la meme societe ; moto du client reprise de l'OR (sinon du
--      RDV), livraison prevue reprise de l'OR (« promis le ») ; franchise = reglage de la societe.
--   5. Au retour : la moto de pret garde le km ET le carburant du retour ; la fiche moto du parc
--      liee (vehicle_id) prend le km de retour s'il est superieur.
-- Additive et idempotente. Essai a blanc : supabase/tests/m8_contrat_pret_g8.sql.
-- =====================================================================

-- 1. Reglages par societe ---------------------------------------------------------------------
alter table public.workshop_planning_settings add column if not exists loan_deductible numeric(10,2) not null default 500;
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_deductible_chk;
alter table public.workshop_planning_settings add constraint workshop_planning_settings_deductible_chk
  check (loan_deductible >= 0);
alter table public.workshop_planning_settings add column if not exists loan_terms_i18n jsonb not null default '{}'::jsonb;
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_terms_i18n_chk;
alter table public.workshop_planning_settings add constraint workshop_planning_settings_terms_i18n_chk
  check (jsonb_typeof(loan_terms_i18n) = 'object');
comment on column public.workshop_planning_settings.loan_deductible is
  'Franchise du contrat de pret (G8 : 500 EUR), reprise sur chaque nouveau pret.';
comment on column public.workshop_planning_settings.loan_terms_i18n is
  'Conditions generales du pret par langue du client ({"nl": ..., "en": ..., "it": ...}) ; le FR est loan_terms.';

-- Traductions de nos conditions generales (texte FR accepte par le client le 19/11).
update public.workshop_planning_settings
   set loan_terms_i18n = jsonb_build_object(
     'nl', $nl$1. De leenmotor wordt aan de ontlener toevertrouwd voor de aangegeven duur, zolang zijn voertuig in de werkplaats staat. De motor blijft eigendom van de concessie.
2. De ontlener moet houder zijn van een geldig rijbewijs voor deze categorie motor en het bij het vertrek voorleggen.
3. De ontlener gebruikt de motor als een goede huisvader, leent hem niet uit aan derden en gebruikt hem niet op een circuit, in wedstrijden of voor betaalde doeleinden.
4. Boetes, tolgelden en overtredingen begaan tijdens de lening zijn ten laste van de ontlener.
5. Bij schade verwittigt de ontlener onmiddellijk de concessie; de eventuele vrijstelling van de verzekering is te zijnen laste.
6. De motor wordt op de voorziene datum teruggebracht, schoon en met hetzelfde brandstofniveau als bij het vertrek. De kilometerstand en de staat worden bij het vertrek en bij de terugkeer genoteerd.$nl$,
     'en', $en$1. The loan motorcycle is entrusted to the borrower for the stated period, while their vehicle is in the workshop. It remains the property of the dealership.
2. The borrower must hold a driving licence valid for this category of motorcycle and show it at departure.
3. The borrower uses the motorcycle with due care, does not lend it to a third party and does not use it on a track, in competition or for paid use.
4. Fines, tolls and offences committed during the loan are borne by the borrower.
5. In the event of an accident or damage, the borrower informs the dealership immediately; any insurance excess is borne by the borrower.
6. The motorcycle is returned on the agreed date, clean, with the same fuel level as at departure. Mileage and condition are recorded at departure and on return.$en$,
     'it', $it$1. La moto di cortesia è affidata al comodatario per la durata indicata, durante il fermo del suo veicolo in officina. Resta di proprietà della concessionaria.
2. Il comodatario deve essere titolare di una patente di guida valida per questa categoria di moto e presentarla alla partenza.
3. Il comodatario usa la moto con la diligenza del buon padre di famiglia, non la presta a terzi e non la utilizza su circuito, in competizioni o per un uso retribuito.
4. Le multe, i pedaggi e le infrazioni commesse durante il prestito sono a carico del comodatario.
5. In caso di sinistro, il comodatario avvisa immediatamente la concessionaria; l'eventuale franchigia assicurativa è a suo carico.
6. La moto viene restituita alla data prevista, pulita, con lo stesso livello di carburante della partenza. Il chilometraggio e lo stato vengono rilevati alla partenza e al ritorno.$it$
   ) || loan_terms_i18n
 where not (loan_terms_i18n ? 'nl' or loan_terms_i18n ? 'en' or loan_terms_i18n ? 'it');

-- 2. Flotte de pret ---------------------------------------------------------------------------
alter table public.workshop_loaner_vehicles add column if not exists power text;
alter table public.workshop_loaner_vehicles add column if not exists current_fuel text;
alter table public.workshop_loaner_vehicles drop constraint if exists workshop_loaner_vehicles_fuel_chk;
alter table public.workshop_loaner_vehicles add constraint workshop_loaner_vehicles_fuel_chk
  check (current_fuel is null or current_fuel in ('vide', 'quart', 'demi', 'trois_quarts', 'plein'));
comment on column public.workshop_loaner_vehicles.power is 'Puissance imprimee sur le contrat de pret (G8 « Puissance »).';
comment on column public.workshop_loaner_vehicles.current_fuel is 'Carburant releve au dernier retour (propose a la sortie suivante).';

-- 3. Donnees du contrat sur le pret -----------------------------------------------------------
alter table public.workshop_loans add column if not exists driver_name text;
alter table public.workshop_loans add column if not exists driver_birth_date date;
alter table public.workshop_loans add column if not exists driver_birth_place text;
alter table public.workshop_loans add column if not exists driver_address text;
alter table public.workshop_loans add column if not exists driver_phone text;
alter table public.workshop_loans add column if not exists driver_license_number text;
alter table public.workshop_loans add column if not exists driver_license_date date;
alter table public.workshop_loans add column if not exists driver_license_issued_by text;
alter table public.workshop_loans add column if not exists driver_licence_number text;
alter table public.workshop_loans add column if not exists customer_vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.workshop_loans add column if not exists delivery_planned_at timestamptz;
alter table public.workshop_loans add column if not exists deductible_amount numeric(10,2);
alter table public.workshop_loans add column if not exists contract_place text;
alter table public.workshop_loans drop constraint if exists workshop_loans_deductible_chk;
alter table public.workshop_loans add constraint workshop_loans_deductible_chk
  check (deductible_amount is null or deductible_amount >= 0);
create index if not exists idx_workshop_loans_customer_vehicle on public.workshop_loans(customer_vehicle_id);
comment on column public.workshop_loans.driver_name is
  'Conducteur imprime sur le contrat (G8 « Renseignements relatifs au conducteur ») ; vide = fiche client.';
comment on column public.workshop_loans.driver_licence_number is 'G8 « N° Licence » (licence federale / sportive), sans equivalent sur la fiche client.';
comment on column public.workshop_loans.customer_vehicle_id is 'Moto du client en reparation (G8 « Dont le vehicule ») ; reprise de l''OR ou du RDV.';
comment on column public.workshop_loans.delivery_planned_at is 'G8 « La livraison du vehicule est prevue le … a … » ; reprise de l''OR (promis le).';
comment on column public.workshop_loans.deductible_amount is 'Franchise acceptee par l''utilisateur, figee a la creation du pret (reglage de la societe).';

-- 4. Garde du pret (reprend la garde du 18/11 et ajoute le prefill du contrat) ----------------
create or replace function public.workshop_loans_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.workshop_loaner_vehicles%rowtype;
  o record;
begin
  select * into l from public.workshop_loaner_vehicles where id = new.loaner_id;
  if not found or l.company_id <> new.company_id then
    raise exception 'La moto de pret n''appartient pas a la societe.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.number is null then
    new.number := public._next_document_number_unchecked(new.company_id, 'PRET');
  end if;
  -- Le pret suit l'OR deja cree depuis son RDV.
  if new.appointment_id is not null and new.or_id is null then
    select a.or_id into new.or_id from public.workshop_appointments a where a.id = new.appointment_id;
  end if;
  -- Contrat G8 : moto du client et livraison prevue reprises de l'OR, sinon du RDV.
  if new.or_id is not null and (new.customer_vehicle_id is null or new.delivery_planned_at is null) then
    select r.vehicle_id, r.promised_at into o from public.repair_orders r
     where r.id = new.or_id and r.company_id = new.company_id;
    if found then
      new.customer_vehicle_id := coalesce(new.customer_vehicle_id, o.vehicle_id);
      new.delivery_planned_at := coalesce(new.delivery_planned_at, o.promised_at);
    end if;
  end if;
  if new.customer_vehicle_id is null and new.appointment_id is not null then
    select a.vehicle_id into new.customer_vehicle_id from public.workshop_appointments a
     where a.id = new.appointment_id and a.company_id = new.company_id;
  end if;
  if new.customer_vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = new.customer_vehicle_id and v.company_id = new.company_id
  ) then
    raise exception 'La moto du client n''appartient pas a la societe.' using errcode = '23514';
  end if;
  -- Franchise : reglage de la societe au moment du pret (500 EUR par defaut, comme G8).
  if tg_op = 'INSERT' and new.deductible_amount is null then
    select s.loan_deductible into new.deductible_amount
      from public.workshop_planning_settings s where s.company_id = new.company_id;
    new.deductible_amount := coalesce(new.deductible_amount, 500);
  end if;
  if new.status in ('reserve', 'sorti') and exists (
    select 1 from public.workshop_loans x
     where x.loaner_id = new.loaner_id and x.id <> new.id and x.status in ('reserve', 'sorti')
       and x.planned_start < new.planned_end and x.planned_end > new.planned_start
  ) then
    raise exception 'Cette moto de pret est deja reservee ou sortie sur cette periode.' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function public.workshop_loans_guard() from public, anon, authenticated;

-- 5. Retour : km + carburant sur la moto de pret, km sur la fiche moto du parc liee -----------
create or replace function public.workshop_loans_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare vid uuid;
begin
  if new.status = 'rendu' and new.return_km is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'rendu' or old.return_km is distinct from new.return_km
          or old.return_fuel is distinct from new.return_fuel) then
    update public.workshop_loaner_vehicles
       set current_km = greatest(coalesce(current_km, 0), new.return_km),
           current_fuel = coalesce(new.return_fuel, current_fuel)
     where id = new.loaner_id
     returning vehicle_id into vid;
    if vid is not null then
      update public.vehicles
         set mileage = new.return_km
       where id = vid and company_id = new.company_id and coalesce(mileage, 0) < new.return_km;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.workshop_loans_after() from public, anon, authenticated;

-- Prets deja saisis : franchise du reglage de la societe.
update public.workshop_loans w
   set deductible_amount = coalesce((select s.loan_deductible from public.workshop_planning_settings s where s.company_id = w.company_id), 500)
 where w.deductible_amount is null;
