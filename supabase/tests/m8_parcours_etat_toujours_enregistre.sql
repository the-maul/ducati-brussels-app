-- =====================================================================
-- Constat 1 du test du 20/11/2026 — essai a blanc de 20261120360000_m8_parcours_etat_toujours_enregistre.sql.
-- A executer DANS UNE TRANSACTION ANNULEE, migration comprise (rt.py, PRE_SQL = la migration).
-- L'avancement du parcours de l'OR TESTOR-2026-00001 s'enregistre quel que soit le modele-annee recu :
--   1. '' (chaine vide, l'ecran avant l'arrivee de la moto) -> ligne enregistree, model_year_id NULL ;
--   2. modele-annee d'un manuel absent du catalogue -> enregistre, NULL, identifiant garde dans state ;
--   3. modele-annee du catalogue (1634, la moto) -> garde tel quel ;
--   4. l'upsert on_conflict(or_id) de l'ecran remplace la ligne (une seule ligne par OR).
-- =====================================================================
create temp table _t(n serial, check_name text, result text) on commit drop;

do $s$
declare
  _co uuid := '5593d97e-69ad-43dd-8237-4ab8aa4e5c08';
  _or uuid := '481574f5-a183-46f9-9dfb-300ba70614b5';
  _manual text; _my text; _n int; _st text;
begin
  select p.model_year_id into _manual from public.ducati_manual_programs p
   where not exists (select 1 from public.ducati_catalog_model_years c where c.id = p.model_year_id) limit 1;

  insert into public.workshop_journeys(or_id, company_id, model_year_id, service_label, started_at, state)
  values (_or, _co, '', 'Entretien annuel + huile', now(), jsonb_build_object('version', 1, 'orId', _or, 'modelYearId', ''));
  select model_year_id into _my from public.workshop_journeys where or_id = _or;
  insert into _t(check_name, result) values ('1. modele-annee vide : enregistre, NULL', case when found and _my is null then 'ok' else 'KO ' || coalesce(_my, 'null') end);

  insert into public.workshop_journeys(or_id, company_id, model_year_id, service_label, started_at, state)
  values (_or, _co, _manual, 'Entretien annuel + huile', now(), jsonb_build_object('version', 1, 'orId', _or, 'modelYearId', _manual))
  on conflict (or_id) do update set model_year_id = excluded.model_year_id, state = excluded.state, updated_at = now();
  select model_year_id, state->>'modelYearId' into _my, _st from public.workshop_journeys where or_id = _or;
  insert into _t(check_name, result) values ('2. modele-annee du manuel hors catalogue (' || coalesce(_manual, '?') || ') : NULL, garde dans state',
    case when _manual is not null and _my is null and _st = _manual then 'ok' else 'KO ' || coalesce(_my, 'null') || ' / ' || coalesce(_st, 'null') end);

  insert into public.workshop_journeys(or_id, company_id, model_year_id, service_label, started_at, state)
  values (_or, _co, '1634', 'Entretien annuel + huile', now(), '{"version":1}'::jsonb)
  on conflict (or_id) do update set model_year_id = excluded.model_year_id, updated_at = now();
  select model_year_id into _my from public.workshop_journeys where or_id = _or;
  insert into _t(check_name, result) values ('3. modele-annee du catalogue : garde', case when _my = '1634' then 'ok' else 'KO ' || coalesce(_my, 'null') end);

  select count(*) into _n from public.workshop_journeys where or_id = _or;
  insert into _t(check_name, result) values ('4. une seule ligne par OR', case when _n = 1 then 'ok' else 'KO ' || _n end);
end $s$;
