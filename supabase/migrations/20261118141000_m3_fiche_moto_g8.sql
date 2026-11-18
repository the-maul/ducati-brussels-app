-- =====================================================================
-- Rattrapage G8 (18/11/2026, lot parc) — fiche moto : ce que la fiche produit fini de G8 a en plus.
-- (docs/g8-inventaire/03-vehicules.md, comparaison-atelier-parc.md §11, bloquant #16)
--   1. Proprietaire / DETENTEUR / UTILISATEUR : trois tiers distincts (onglet Proprietaire de G8).
--      Le proprietaire reste l'historique date `vehicle_owners` ; detenteur et utilisateur sont deux
--      liens directs vers un contact (tracage par audit_row, B7).
--   2. Bilan economique : COTE (argus) de la moto ; la marge previsionnelle se calcule a l'ecran.
--   3. Garantie : DUREE en mois (G8 « Duree (liste) »), a cote du type et de la fin de garantie.
--   4. PRIMES ET AIDES (« Saisie de prime » de G8) : date, montant, commentaire ; liste par periode.
-- Idempotente, non destructive. Aucune ecriture de stock ni de prix (B7) : une prime n'est ni un
-- mouvement de stock ni un prix de vente, elle s'ajoute a la marge previsionnelle a l'ecran.
-- =====================================================================

alter table public.vehicles
  add column if not exists holder_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists user_contact_id   uuid references public.contacts(id) on delete set null,
  add column if not exists market_value      numeric(12,2),
  add column if not exists warranty_months   integer check (warranty_months is null or warranty_months between 0 and 240);

comment on column public.vehicles.holder_contact_id is 'Detenteur de la moto (G8 : onglet Proprietaire, 2e tiers). Le proprietaire est dans vehicle_owners.';
comment on column public.vehicles.user_contact_id is 'Utilisateur habituel de la moto (G8 : onglet Proprietaire, 3e tiers).';
comment on column public.vehicles.market_value is 'Cote (argus) de la moto, saisie (G8 : Cote vente argus du bilan economique).';
comment on column public.vehicles.warranty_months is 'Duree de garantie en mois (G8 : Garantie > Duree).';

create index if not exists idx_vehicles_holder on public.vehicles (holder_contact_id) where holder_contact_id is not null;
create index if not exists idx_vehicles_user on public.vehicles (user_contact_id) where user_contact_id is not null;

-- ---------------------------------------------------------------------
-- Primes et aides par moto
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_bonuses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  bonus_date  date not null default current_date,
  amount      numeric(12,2) not null check (amount <> 0),
  comment     text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_vehicle_bonuses_vehicle on public.vehicle_bonuses (vehicle_id, bonus_date);
create index if not exists idx_vehicle_bonuses_period on public.vehicle_bonuses (company_id, bonus_date);

-- La societe de la prime est celle de la moto (multi-societe).
create or replace function public._vehicle_bonus_company()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select v.company_id into new.company_id from public.vehicles v where v.id = new.vehicle_id;
  if new.company_id is null then raise exception 'Moto introuvable' using errcode = 'P0002'; end if;
  return new;
end $$;
drop trigger if exists trg_vehicle_bonuses_company on public.vehicle_bonuses;
create trigger trg_vehicle_bonuses_company before insert or update of vehicle_id on public.vehicle_bonuses
  for each row execute function public._vehicle_bonus_company();

drop trigger if exists trg_vehicle_bonuses_audit on public.vehicle_bonuses;
create trigger trg_vehicle_bonuses_audit after insert or update or delete on public.vehicle_bonuses
  for each row execute function public.audit_row();

alter table public.vehicle_bonuses enable row level security;
drop policy if exists vehicle_bonuses_select on public.vehicle_bonuses;
create policy vehicle_bonuses_select on public.vehicle_bonuses for select to authenticated
  using (public.is_member(company_id));
drop policy if exists vehicle_bonuses_insert on public.vehicle_bonuses;
create policy vehicle_bonuses_insert on public.vehicle_bonuses for insert to authenticated
  with check (public.is_admin(company_id) or public.has_role(company_id, 'vendeur') or public.has_role(company_id, 'comptable'));
drop policy if exists vehicle_bonuses_update on public.vehicle_bonuses;
create policy vehicle_bonuses_update on public.vehicle_bonuses for update to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'comptable'))
  with check (public.is_admin(company_id) or public.has_role(company_id, 'comptable'));
drop policy if exists vehicle_bonuses_delete on public.vehicle_bonuses;
create policy vehicle_bonuses_delete on public.vehicle_bonuses for delete to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'comptable'));

comment on table public.vehicle_bonuses is
  'Primes et aides par moto (G8 « Saisie de prime » + « Liste des primes » du parc). Tracees par audit_row.';
