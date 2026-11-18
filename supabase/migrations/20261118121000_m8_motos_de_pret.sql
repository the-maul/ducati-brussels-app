-- =====================================================================
-- M8 — Motos de pret (vehicules de courtoisie), rattrapage G8 (18/11/2026, ATE005, ATE022, bloquant #14)
--
-- G8 (07-atelier.md §6, §14) : flotte de motos de pret (modele, immat., 1re MC, couleur),
-- planning / disponibilite, contrat de pret imprimable (logo, conditions generales).
-- Le DMS n'avait qu'un champ texte `loaner_vehicle` sur le RDV.
--
--   1. workshop_loaner_vehicles : la flotte (lien facultatif a la fiche moto du parc).
--   2. workshop_loans : un pret = une moto, un client, une periode prevue, sortie (date, km,
--      carburant) et retour (date, km, carburant), lien au RDV et a l'OR, numero de contrat
--      (sequence « PRET », reglable dans Parametres → Numerotation des documents).
--      Gardes : pas deux prets actifs qui se chevauchent sur la meme moto ; km retour >= km sortie ;
--      sortie = date + km obligatoires ; retour = date + km obligatoires.
--   3. Le pret suit l'OR cree depuis son RDV (trigger).
-- Conditions generales du contrat : workshop_planning_settings.loan_terms (migration 20261118120000).
-- Additif et idempotente. Essai a blanc : supabase/tests/m8_planning_charge_g8.sql.
-- =====================================================================

create table if not exists public.workshop_loaner_vehicles (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  vehicle_id         uuid references public.vehicles(id) on delete set null,
  label              text not null,                -- modele affiche (ex. Monster 937 +)
  brand              text,
  plate              text,
  vin                text,
  color              text,
  first_registration date,
  current_km         int check (current_km is null or current_km >= 0),
  notes              text,
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_loaner_vehicles_company on public.workshop_loaner_vehicles(company_id, sort_order);
comment on table public.workshop_loaner_vehicles is 'Flotte de motos de pret (G8 « Vehicules de pret »).';

create table if not exists public.workshop_loans (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  loaner_id      uuid not null references public.workshop_loaner_vehicles(id) on delete restrict,
  number         text,
  contact_id     uuid references public.contacts(id) on delete set null,
  appointment_id uuid references public.workshop_appointments(id) on delete set null,
  or_id          uuid references public.repair_orders(id) on delete set null,
  status         text not null default 'reserve' check (status in ('reserve', 'sorti', 'rendu', 'annule')),
  planned_start  timestamptz not null,
  planned_end    timestamptz not null,
  out_at         timestamptz,
  out_km         int check (out_km is null or out_km >= 0),
  out_fuel       text check (out_fuel is null or out_fuel in ('vide', 'quart', 'demi', 'trois_quarts', 'plein')),
  out_notes      text,
  returned_at    timestamptz,
  return_km      int check (return_km is null or return_km >= 0),
  return_fuel    text check (return_fuel is null or return_fuel in ('vide', 'quart', 'demi', 'trois_quarts', 'plein')),
  return_notes   text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint workshop_loans_period check (planned_end > planned_start),
  constraint workshop_loans_km check (return_km is null or out_km is null or return_km >= out_km),
  constraint workshop_loans_out check (status not in ('sorti', 'rendu') or (out_at is not null and out_km is not null)),
  constraint workshop_loans_return check (status <> 'rendu' or (returned_at is not null and return_km is not null)),
  constraint workshop_loans_return_after check (returned_at is null or out_at is null or returned_at >= out_at)
);
create index if not exists idx_workshop_loans_company on public.workshop_loans(company_id, planned_start);
create index if not exists idx_workshop_loans_loaner on public.workshop_loans(loaner_id, planned_start);
create index if not exists idx_workshop_loans_appointment on public.workshop_loans(appointment_id);
comment on table public.workshop_loans is
  'Prets de moto (contrat) : periode prevue, sortie et retour (date, km, carburant), lien RDV / OR.';

create or replace function public.workshop_loans_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.workshop_loaner_vehicles%rowtype;
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
drop trigger if exists trg_workshop_loans_guard on public.workshop_loans;
create trigger trg_workshop_loans_guard before insert or update on public.workshop_loans
  for each row execute function public.workshop_loans_guard();

-- Au retour, le compteur de la moto de pret prend le km de retour.
create or replace function public.workshop_loans_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'rendu' and new.return_km is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'rendu' or old.return_km is distinct from new.return_km) then
    update public.workshop_loaner_vehicles
       set current_km = greatest(coalesce(current_km, 0), new.return_km)
     where id = new.loaner_id;
  end if;
  return new;
end $$;
revoke all on function public.workshop_loans_after() from public, anon, authenticated;
drop trigger if exists trg_workshop_loans_after on public.workshop_loans;
create trigger trg_workshop_loans_after after insert or update on public.workshop_loans
  for each row execute function public.workshop_loans_after();

-- Quand l'OR est cree depuis le RDV, le pret du RDV y est rattache.
create or replace function public.workshop_appointments_loans_follow_or()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.or_id is not null and new.or_id is distinct from old.or_id then
    update public.workshop_loans set or_id = new.or_id
     where appointment_id = new.id and (or_id is null or or_id = old.or_id);
  end if;
  return new;
end $$;
revoke all on function public.workshop_appointments_loans_follow_or() from public, anon, authenticated;
drop trigger if exists trg_appointments_loans_follow_or on public.workshop_appointments;
create trigger trg_appointments_loans_follow_or after update of or_id on public.workshop_appointments
  for each row execute function public.workshop_appointments_loans_follow_or();

-- Numerotation des contrats de pret (reglable : Parametres → Numerotation des documents).
insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, 'PRET', 'PRET', 'Contrat de prêt moto (atelier)'
  from public.companies c
on conflict (company_id, doc_type) do nothing;

-- Conditions generales du pret : projet a relire par la concession (Planning → Reglages).
update public.workshop_planning_settings
   set loan_terms = $cg$1. La moto de prêt est confiée à l'emprunteur pour la durée indiquée, pendant l'immobilisation de son véhicule à l'atelier. Elle reste la propriété de la concession.
2. L'emprunteur doit être titulaire d'un permis de conduire valable pour cette catégorie de moto et le présenter à la sortie.
3. L'emprunteur utilise la moto en bon père de famille, ne la prête pas à un tiers et ne l'utilise ni sur circuit, ni en compétition, ni pour un usage rémunéré.
4. Les amendes, péages et infractions commises pendant le prêt sont à la charge de l'emprunteur.
5. En cas de sinistre, l'emprunteur prévient immédiatement la concession ; la franchise d'assurance éventuelle est à sa charge.
6. La moto est rendue à la date prévue, propre, avec le même niveau de carburant qu'à la sortie. Le kilométrage et l'état sont relevés au départ et au retour.$cg$
 where loan_terms is null;

insert into public.table_write_pages (table_name, page) values
  ('workshop_loaner_vehicles', '/workshop'),
  ('workshop_loans', '/workshop')
on conflict do nothing;

alter table public.workshop_loaner_vehicles enable row level security;
drop policy if exists workshop_loaner_vehicles_select on public.workshop_loaner_vehicles;
create policy workshop_loaner_vehicles_select on public.workshop_loaner_vehicles for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_loaner_vehicles_write on public.workshop_loaner_vehicles;
create policy workshop_loaner_vehicles_write on public.workshop_loaner_vehicles for all to authenticated
  using (public.can_write_table(company_id, 'workshop_loaner_vehicles')) with check (public.can_write_table(company_id, 'workshop_loaner_vehicles'));

alter table public.workshop_loans enable row level security;
drop policy if exists workshop_loans_select on public.workshop_loans;
create policy workshop_loans_select on public.workshop_loans for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_loans_write on public.workshop_loans;
create policy workshop_loans_write on public.workshop_loans for all to authenticated
  using (public.can_write_table(company_id, 'workshop_loans')) with check (public.can_write_table(company_id, 'workshop_loans'));

drop trigger if exists trg_loaner_vehicles_updated on public.workshop_loaner_vehicles;
create trigger trg_loaner_vehicles_updated before update on public.workshop_loaner_vehicles for each row execute function public.set_updated_at();
drop trigger if exists trg_workshop_loans_updated on public.workshop_loans;
create trigger trg_workshop_loans_updated before update on public.workshop_loans for each row execute function public.set_updated_at();
drop trigger if exists trg_loaner_vehicles_audit on public.workshop_loaner_vehicles;
create trigger trg_loaner_vehicles_audit after insert or update or delete on public.workshop_loaner_vehicles for each row execute function public.audit_row();
drop trigger if exists trg_workshop_loans_audit on public.workshop_loans;
create trigger trg_workshop_loans_audit after insert or update or delete on public.workshop_loans for each row execute function public.audit_row();
