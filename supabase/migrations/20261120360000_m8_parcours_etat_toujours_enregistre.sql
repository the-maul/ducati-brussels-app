-- =====================================================================
-- M8 — Parcours d'entretien : l'avancement est TOUJOURS enregistré (lot parcours-fix, 20/11/2026).
--
-- Constat du test à l'écran du 20/11 (OR TESTOR-2026-00001, Monster 696) : l'enregistrement de
-- l'avancement (`workshop_journeys`, upsert on_conflict=or_id) répondait 409 / 23503
-- « workshop_journeys_model_year_id_fkey » : 0 ligne en base, tout restait dans la tablette.
-- Deux sources d'identifiant inconnues du catalogue :
--   * l'écran envoyait '' (chaîne vide) quand la liste des opérations de l'OR arrivait avant la moto ;
--   * les programmes des manuels d'atelier (`ducati_manual_programs`) portent 59 modèles-années
--     absents de `ducati_catalog_model_years` (le programme vient du manuel, pas du catalogue).
-- Correctif (l'intégrité est gardée) : avant écriture, un modèle-année vide ou inconnu du catalogue
-- est enregistré à NULL ; l'identifiant reste lisible dans `state` (jsonb). La clé étrangère reste.
-- Les cases cochées des opérations sont, elles, dans `repair_order_plan_operations` (done_at,
-- done_by, done_by_name, time_entry_id) : elles ne dépendaient pas de cette table.
-- Additif, rejouable.
-- =====================================================================

create or replace function public._workshop_journey_model_year_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.model_year_id := nullif(btrim(coalesce(new.model_year_id, '')), '');
  if new.model_year_id is not null
     and not exists (select 1 from public.ducati_catalog_model_years c where c.id = new.model_year_id) then
    new.model_year_id := null;
  end if;
  return new;
end $$;
revoke all on function public._workshop_journey_model_year_guard() from public, anon, authenticated;

drop trigger if exists trg_journeys_model_year_guard on public.workshop_journeys;
create trigger trg_journeys_model_year_guard
  before insert or update of model_year_id on public.workshop_journeys
  for each row execute function public._workshop_journey_model_year_guard();

comment on column public.workshop_journeys.model_year_id is
  'Modèle-année du catalogue Ducati, ou NULL si celui du parcours (manuel d''atelier) n''est pas au catalogue : l''identifiant du manuel reste dans state.modelYearId (trigger trg_journeys_model_year_guard, 20/11/2026).';
