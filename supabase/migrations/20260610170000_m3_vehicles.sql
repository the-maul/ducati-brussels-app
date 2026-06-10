-- =====================================================================
-- M3 — VÉHICULES & PARC (VEH000-010, ATE017 ; invariant B9 n° série)
-- Objet VIN de première classe : identification (carte grise belge),
-- caractéristiques (bridé/A2, TPMS, trackers), suivi commercial (coût de
-- revient, marge, statut parc), historique propriétaires. Jointure cœur :
-- un véhicule est lié à l'ARTICLE de type V/O/P/D (B1) qui le valorise.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'vehicle_status') then
    create type public.vehicle_status as enum
      ('en_commande','stock_vn','stock_vo','depot_vente','reserve','vendu',
       'livre','courtoisie','demo','depot_agent','repris');
  end if;
  if not exists (select 1 from pg_type where typname = 'mileage_qualif') then
    create type public.mileage_qualif as enum ('nc','reel','ng'); -- non communiqué / réel / non garanti
  end if;
end $$;

create table if not exists public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  -- Jointure article (V/O/P/D) ↔ véhicule (B9) : valorisation/stock côté article
  article_id   uuid references public.articles(id) on delete set null,

  -- Identification (repères carte grise belge entre [])
  vin              text,                 -- n° de série / châssis (17 car.) [E]
  reference        text,
  brand            text,                 -- [D.1]
  model            text,
  plate            text,                 -- immatriculation [A]
  engine_number    text,                 -- n° moteur
  type_mine        text,
  type_variant_version text,
  genre            text,
  immat_ww         text,
  marking          text,                 -- marquage antivol (gravage)
  origin           text,
  marking_date     date,
  production_code  text,
  insurance        text,
  formula_number   text,

  -- Caractéristiques
  displacement     numeric(8,1),         -- cylindrée
  power_kw         numeric(8,2),         -- [P.2]
  power_cv         numeric(8,2),
  is_restricted    boolean not null default false,  -- bridé 35KW/FULL (A2, DOC006)
  energy           text,                 -- [P.3]
  fiscal_power     numeric(6,2),
  antipollution    text,                 -- norme [V.9]
  color            text,
  color_code       text,
  segment_type     text,
  category         text,
  cylinders        int,
  autonomy         text,
  battery_number   text,
  gps_tracker_id   text,
  pin_tracker      text,
  tpms_av          text,
  tpms_ar          text,

  -- Informations supplémentaires
  first_registration_date date,          -- mise en circulation [B]
  next_inspection_date    date,          -- prochain contrôle technique
  mileage          int,
  mileage_qualif   public.mileage_qualif default 'reel',
  hours_count      numeric(8,1),
  antitheft_code   text,                 -- code antidémarrage
  model_year       int,                  -- année modèle
  key_number       text,                 -- n° de clé
  key_number2      text,                 -- n° de clé 2
  police_book_number text,               -- n° livre de police
  warranty_type    text,
  warranty_end     date,                 -- fin de garantie
  exposition_code  text,

  -- Suivi commercial (VEH002)
  purchase_price   numeric(12,2),        -- PAHT / prix de reprise
  cost_price       numeric(12,2),        -- coût de revient (PAHT + ORO + frais)
  display_price    numeric(12,2),        -- prix affiché
  status           public.vehicle_status not null default 'stock_vn',
  notes            text,

  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null
);
create index if not exists idx_vehicles_company on public.vehicles(company_id);
create index if not exists idx_vehicles_vin on public.vehicles(vin);
create index if not exists idx_vehicles_plate on public.vehicles(plate);
create index if not exists idx_vehicles_status on public.vehicles(company_id, status);
create index if not exists idx_vehicles_article on public.vehicles(article_id);

drop trigger if exists trg_vehicles_updated on public.vehicles;
create trigger trg_vehicles_updated before update on public.vehicles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_vehicles_audit on public.vehicles;
create trigger trg_vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Historique des propriétaires (VEH003, B9) — daté, cumulé inter-propriétaires
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_owners (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete restrict,
  from_date   date not null default current_date,
  to_date     date,
  is_current  boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_vehowners_vehicle on public.vehicle_owners(vehicle_id);
create index if not exists idx_vehowners_contact on public.vehicle_owners(contact_id);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.vehicles       enable row level security;
alter table public.vehicle_owners enable row level security;

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated using (public.is_member(company_id));
drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated with check (public.is_member(company_id));
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_delete on public.vehicles for delete to authenticated using (public.is_admin(company_id));

drop policy if exists vehowners_all on public.vehicle_owners;
create policy vehowners_all on public.vehicle_owners for all to authenticated
  using (exists (select 1 from public.vehicles v where v.id = vehicle_id and public.is_member(v.company_id)))
  with check (exists (select 1 from public.vehicles v where v.id = vehicle_id and public.is_member(v.company_id)));
