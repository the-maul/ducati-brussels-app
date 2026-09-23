-- =====================================================================
-- Mission 07, carte 3 — les trois vues que l'écran « parcours technicien » attend.
--
-- L'écran technicien (branche lot-parcours, fusionnée sur main) lit ses données par
-- `src/modules/workshop/journey/source.ts`, constante `MANUAL_TABLES` :
--     ducati_manual_programs · ducati_manual_procedures · ducati_manual_procedure_steps
-- avec les formes décrites dans `journey/types.ts` (MaintenanceProgram, Procedure, ProcedureStep).
--
-- Plutôt que de renommer nos tables ou de réécrire l'écran, on publie ces trois noms sous forme de
-- VUES au-dessus des tables `wsm_*`. L'écran bascule tout seul de ses données de démonstration à la
-- base (`probeManualTables`) dès que ces vues existent.
--
-- `security_invoker = true` : les vues n'ouvrent aucune porte, la RLS des tables `wsm_*`
-- (lecture réservée aux comptes de l'équipe) s'applique telle quelle.
--
-- UNE LIGNE PAR MODÈLE-ANNÉE (469), pas par manuel (461) : l'écran interroge par
-- `model_year_id`, et huit modèles-années partagent le manuel d'une autre version (voir la
-- migration 20260923102000).
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Figures : du chemin de l'extraction au chemin servi à l'écran
-- ---------------------------------------------------------------------
-- L'écran attend { src (vignette), zoom (pleine taille) } et les préfixe par VITE_MANUELS_BASE.
-- On enlève donc le « images/ » de tête, exactement comme le fait l'envoi vers Supabase Storage
-- (tools/wsm-loader/images.mjs, fonction objectPath).
create or replace function public._wsm_figure(_e jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select case
    when coalesce(_e ->> 'local', _e ->> 'localMiniature') is null then null
    else jsonb_build_object(
      'src',  regexp_replace(coalesce(_e ->> 'localMiniature', _e ->> 'local'), '^images/', ''),
      'zoom', regexp_replace(coalesce(_e ->> 'local', _e ->> 'localMiniature'), '^images/', ''))
  end;
$$;
revoke all on function public._wsm_figure(jsonb) from public, anon;
grant execute on function public._wsm_figure(jsonb) to authenticated, service_role;

create or replace function public._wsm_figures(_a jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce((select jsonb_agg(public._wsm_figure(e))
                     from jsonb_array_elements(coalesce(_a, '[]'::jsonb)) e
                    where public._wsm_figure(e) is not null), '[]'::jsonb);
$$;
revoke all on function public._wsm_figures(jsonb) from public, anon;
grant execute on function public._wsm_figures(jsonb) to authenticated, service_role;

-- Outils spéciaux : { reference, description, image } — l'image suit la même règle.
create or replace function public._wsm_tools(_a jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
                     'reference', e ->> 'reference',
                     'description', e ->> 'description',
                     'image', public._wsm_figure(e -> 'image')))
                     from jsonb_array_elements(coalesce(_a, '[]'::jsonb)) e), '[]'::jsonb);
$$;
revoke all on function public._wsm_tools(jsonb) from public, anon;
grant execute on function public._wsm_tools(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Programme d'entretien d'un modèle-année (MaintenanceProgram)
-- ---------------------------------------------------------------------
create or replace view public.ducati_manual_programs
with (security_invoker = true) as
select
  c.my_id                                              as model_year_id,
  c.my_id                                              as "modelYearId",
  m.id                                                 as manual_id,
  m.family                                             as famille,
  m.model                                              as modele,
  m.model_year::text                                   as annee,
  m.supermodel                                         as "superModele",
  m.manual_root                                        as "manualRoot",
  coalesce((select jsonb_agg(jsonb_build_object(
              'service', s.name, 'km', s.km, 'mois', s.months,
              'texte', s.text, 'premiereEcheance', s.first_service) order by s.sort)
              from public.wsm_services s where s.manual_id = m.id), '[]'::jsonb)   as services,
  coalesce((select jsonb_agg(jsonb_build_object(
              'echeance', s.name, 'km', s.km, 'mois', s.months, 'definition', s.definition,
              'operations', coalesce((select jsonb_agg(o.label order by o.scope, o.sort)
                                        from public.wsm_operations o
                                       where o.manual_id = m.id and s.code = any (o.service_codes)), '[]'::jsonb),
              'source', jsonb_build_object('manualRoot', m.manual_root)) order by s.sort)
              from public.wsm_services s where s.manual_id = m.id), '[]'::jsonb)   as echeances,
  coalesce((select jsonb_object_agg(x.name, x.procs)
              from (select s.name,
                           jsonb_agg(jsonb_build_object('parcoursId', sp.procedure_id, 'titre', p.title,
                                     'operation', coalesce(sp.operation, p.title)) order by sp.sort) as procs
                      from public.wsm_services s
                      join public.wsm_service_procedures sp
                        on sp.manual_id = m.id and sp.service_code = s.code
                      join public.wsm_procedures p on p.id = sp.procedure_id
                     where s.manual_id = m.id
                     group by s.name) x), '{}'::jsonb)                             as "proceduresParService",
  coalesce((select jsonb_agg(jsonb_build_object('intitule', t.label, 'minutes', t.minutes, 'ut', t.ut)
              order by t.sort)
              from public.wsm_times t where t.manual_id = m.id), '[]'::jsonb)      as temps
from public.wsm_manuals m
cross join lateral unnest(
  case when coalesce(array_length(m.covers_model_year_ids, 1), 0) = 0
       then array[m.id] else m.covers_model_year_ids end) as c(my_id);

comment on view public.ducati_manual_programs is 'Programme d''entretien d''un modèle-année, dans la forme attendue par l''écran parcours technicien (journey/types.ts, MaintenanceProgram). Une ligne par modèle-année couvert.';

-- ---------------------------------------------------------------------
-- 2. Procédure (Procedure)
-- ---------------------------------------------------------------------
-- `etapes` est déjà dans la vue : l'écran n'a pas besoin de ressource imbriquée PostgREST.
create or replace view public.ducati_manual_procedures
with (security_invoker = true) as
select
  p.id,
  p.title                                              as titre,
  jsonb_strip_nulls(jsonb_build_object(
    'manualRoot', p.source_manual_root, 'code', p.source_code, 'version', p.source_version,
    'updateDate', to_char(p.source_updated_at, 'YYYY-MM-DD'), 'titre', p.source_title))  as source,
  coalesce(p.intervention, '{}'::jsonb)                as intervention,
  public._wsm_tools(p.tools)                           as outils,
  coalesce(p.products, '[]'::jsonb)                    as produits,
  coalesce((select jsonb_agg(jsonb_build_object(
              'etape', c.step_n, 'valeurNm', c.value_nm, 'min', c.min_nm, 'max', c.max_nm,
              'tolerance', c.tolerance, 'reperes', to_jsonb(c.marks), 'texte', c.text) order by c.sort)
              from public.wsm_procedure_torques c where c.procedure_id = p.id), '[]'::jsonb) as couples,
  coalesce(p.warnings, '[]'::jsonb)                    as avertissements,
  public._wsm_figures(p.intro_figures)                 as "figuresIntro",
  p.steps_count                                        as "nbEtapes",
  p.usages_count                                       as "nbModelesAnnees",
  coalesce((select jsonb_agg(jsonb_build_object(
              'n', s.n, 'phase', s.phase, 'sousPhase', s.sub_phase, 'texte', s.text,
              'sousEtapes', s.sub_steps, 'figures', public._wsm_figures(s.figures),
              'outils', s.tools, 'produits', s.products, 'couples', s.torques,
              'reperes', s.marks, 'avertissements', s.warnings, 'liens', s.links) order by s.n)
              from public.wsm_procedure_steps s where s.procedure_id = p.id), '[]'::jsonb) as etapes
from public.wsm_procedures p;

comment on view public.ducati_manual_procedures is 'Procédure d''atelier pas à pas, dans la forme attendue par l''écran parcours technicien (journey/types.ts, Procedure). La colonne etapes contient déjà les étapes : pas de ressource imbriquée à demander.';

-- ---------------------------------------------------------------------
-- 3. Étapes d'une procédure (ProcedureStep)
-- ---------------------------------------------------------------------
create or replace view public.ducati_manual_procedure_steps
with (security_invoker = true) as
select
  s.procedure_id,
  s.n,
  s.phase,
  s.sub_phase                          as "sousPhase",
  s.text                               as texte,
  s.sub_steps                          as "sousEtapes",
  public._wsm_figures(s.figures)       as figures,
  s.tools                              as outils,
  s.products                           as produits,
  s.torques                            as couples,
  s.marks                              as reperes,
  s.warnings                           as avertissements,
  s.links                              as liens
from public.wsm_procedure_steps s;

comment on view public.ducati_manual_procedure_steps is 'Étapes d''une procédure d''atelier, forme journey/types.ts (ProcedureStep). Utilisable seule ; ducati_manual_procedures les porte déjà.';

-- ---------------------------------------------------------------------
-- Droits : équipe seulement (la RLS des tables wsm_* fait le reste)
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  foreach v in array array['ducati_manual_programs', 'ducati_manual_procedures', 'ducati_manual_procedure_steps']
  loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated, service_role', v);
  end loop;
end $$;
