-- =====================================================================
-- Mission 07, carte « Parcours d'entretien pas à pas » (M8, ATE011 + ATE014 + B11 étage 3).
--
-- Le technicien ouvre un OR, démarre l'entretien dû (Oil Service, Desmo Service…) et suit les
-- procédures du manuel d'atelier étape par étape sur une tablette. Cette migration enregistre
-- UNIQUEMENT SON AVANCEMENT — les manuels eux-mêmes (procédures, étapes, figures, couples, temps UT)
-- viennent du lot `lot-manuels` et ne sont pas créés ici.
--
--   * workshop_journeys : un parcours par OR (état complet en jsonb : opérations, étapes cochées,
--     chronos, observations, pièces à remplacer, photos). Écrit au fil de l'eau depuis la tablette,
--     qui garde aussi une copie locale pour résister à une coupure.
--   * workshop_time_entries.journey_operation : rattache un pointage (B11 étage 2) à l'opération du
--     parcours, pour rapprocher temps passé / temps officiel Ducati / temps facturé (B11 étage 3).
--   * or_journey_minutes(or) : temps passé cumulé du parcours d'un OR.
--
-- Non destructive : que des `create ... if not exists` et un `add column if not exists`.
-- RIEN N'EST FACTURÉ AUTOMATIQUEMENT : le récapitulatif propose des lignes, l'OR reste maître.
-- =====================================================================

create table if not exists public.workshop_journeys (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  or_id          uuid not null unique references public.repair_orders(id) on delete cascade,
  -- Modèle-année du catalogue Ducati (vehicles.ducati_model_year_id) : donne le programme d'entretien.
  model_year_id  text references public.ducati_catalog_model_years(id) on delete set null,
  -- Nom de l'entretien tel qu'il figure au manuel (« Desmo Service », « Oil Service »…).
  service_label  text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- Le récapitulatif a été reporté sur l'OR (lignes proposées, jamais facturées d'office).
  reported_to_or boolean not null default false,
  -- État complet du parcours (voir src/modules/workshop/journey/types.ts, JourneyState).
  state          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.workshop_journeys is
  'Mission 07 — avancement d''un parcours d''entretien pas à pas sur un OR (étapes cochées, chronos, observations, pièces). Les manuels viennent du lot lot-manuels.';
comment on column public.workshop_journeys.state is
  'JourneyState (src/modules/workshop/journey/types.ts) : operations[], findings[], chronos. Un seul document pour que la tablette écrive d''un bloc.';

create index if not exists idx_journeys_company on public.workshop_journeys(company_id, updated_at desc);
create index if not exists idx_journeys_model_year on public.workshop_journeys(model_year_id) where model_year_id is not null;
create index if not exists idx_journeys_open on public.workshop_journeys(company_id) where finished_at is null;

drop trigger if exists trg_journeys_audit on public.workshop_journeys;
create trigger trg_journeys_audit after insert or update or delete on public.workshop_journeys
  for each row execute function public.audit_row();

alter table public.workshop_journeys enable row level security;
drop policy if exists journeys_all on public.workshop_journeys;
create policy journeys_all on public.workshop_journeys for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- ---------------------------------------------------------------------
-- B11 étage 3 : relier un pointage à l'opération du parcours
-- ---------------------------------------------------------------------
alter table public.workshop_time_entries
  add column if not exists journey_operation text;
comment on column public.workshop_time_entries.journey_operation is
  'Identifiant d''opération du parcours d''entretien (JourneyState.operations[].id) : rapprochement temps passé / temps officiel (UT) / temps facturé.';

-- Temps passé cumulé sur le parcours d'un OR (minutes), lu depuis l'état du parcours.
create or replace function public.or_journey_minutes(_or uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(
    greatest(0, floor(extract(epoch from (
      coalesce((seg->>'endedAt')::timestamptz, now()) - (seg->>'startedAt')::timestamptz
    )) / 60))
  ), 0)
  from public.workshop_journeys j
  cross join lateral jsonb_array_elements(coalesce(j.state->'operations', '[]'::jsonb)) op
  cross join lateral jsonb_array_elements(coalesce(op->'chrono', '[]'::jsonb)) seg
  where j.or_id = _or
    and seg ? 'startedAt';
$$;
grant execute on function public.or_journey_minutes(uuid) to authenticated;
