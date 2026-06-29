-- M3/M14 — Faits par VIN reconstitués depuis les factures/OR (bloc véhicule).
-- Sert à pré-remplir au maximum une NOUVELLE fiche véhicule à partir du seul châssis.
-- Donnée dérivée des factures du concessionnaire, indexée par VIN ; lecture authentifiée.
create table if not exists public.ducati_vin_facts (
  vin text primary key,
  model text, reference text, engine_number text, color text, category text, origin text,
  plate text, antipollution text,
  displacement integer, power_cv integer, cylinders integer, model_year integer,
  first_registration_date date, warranty_end date, mileage integer,
  source text not null default 'invoice',
  updated_at timestamptz not null default now()
);
alter table public.ducati_vin_facts enable row level security;
drop policy if exists ducati_vin_facts_read on public.ducati_vin_facts;
create policy ducati_vin_facts_read on public.ducati_vin_facts for select to authenticated using (true);
