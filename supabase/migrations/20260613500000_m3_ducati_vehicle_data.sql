-- M3/M1 — Données récupérées du portail My Ducati (par l'extension navigateur, via VIN).
-- Complète la moto (B/C), le compte client Ducati (A) et crée 2 tables liées à la moto :
-- maintenance (D) et bulletins techniques (E). company_id + RLS partout.

-- A. Compte client Ducati → contacts (en plus de ducati_code / my_ducati_email/_first/_last existants)
alter table public.contacts
  add column if not exists my_ducati_phone            text,
  add column if not exists my_ducati_city             text,
  add column if not exists my_ducati_country          text,
  add column if not exists my_ducati_marketing         boolean,
  add column if not exists my_ducati_profiling         boolean,
  add column if not exists my_ducati_score             integer,   -- « Monetary » 0..7
  add column if not exists my_ducati_is_current_owner  boolean;

-- B/C. Moto + garantie → vehicles (model/plate/engine_number/mileage/warranty_type/warranty_end existent déjà)
alter table public.vehicles
  add column if not exists ducati_state            text,        -- « État » (En Service…)
  add column if not exists ducati_usage            text,        -- « Utilisation » (Client…)
  add column if not exists production_date          date,
  add column if not exists ship_date                date,        -- expédition depuis Ducati
  add column if not exists invoiced_to              text,        -- « Moto facturée à » (concessionnaire)
  add column if not exists warranty_start           date,
  add column if not exists warranty_state           text,        -- En cours / Expiré
  add column if not exists warranty_activated_by     text,
  add column if not exists my_ducati_synced_at       timestamptz,
  add column if not exists my_ducati_data            jsonb;       -- charge brute (extensible)

-- D. Maintenance (événements) liée à la moto
create table if not exists public.vehicle_maintenance (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  kind            text,                       -- upcoming | current | past
  service_type    text,                       -- Desmo Service, Annual Service…
  state           text,                       -- Prévu / Fait / Ignoré
  km              integer,
  event_date      date,
  due_date        date,
  dealer          text,                       -- concessionnaire
  ducati_event_id text,                       -- id Ducati (idempotence)
  created_at      timestamptz not null default now()
);
create index if not exists idx_veh_maint_vehicle on public.vehicle_maintenance(vehicle_id);
create unique index if not exists uq_veh_maint_event on public.vehicle_maintenance(vehicle_id, ducati_event_id) where ducati_event_id is not null;
alter table public.vehicle_maintenance enable row level security;
drop policy if exists veh_maint_all on public.vehicle_maintenance;
create policy veh_maint_all on public.vehicle_maintenance for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- E. Bulletins techniques liés à la moto (modèle/année, affichés sur la fiche)
create table if not exists public.vehicle_bulletins (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  bulletin_id   text,                          -- id Ducati (idempotence)
  title         text,
  number        text,                          -- ex. SRV-TTB-26-010
  published_at  date,
  created_at    timestamptz not null default now()
);
create index if not exists idx_veh_bull_vehicle on public.vehicle_bulletins(vehicle_id);
create unique index if not exists uq_veh_bull on public.vehicle_bulletins(vehicle_id, bulletin_id) where bulletin_id is not null;
alter table public.vehicle_bulletins enable row level security;
drop policy if exists veh_bull_all on public.vehicle_bulletins;
create policy veh_bull_all on public.vehicle_bulletins for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

notify pgrst, 'reload schema';
