-- =====================================================================
-- M8 — Lot « OR lisible » (19/11/2026) : repli d'entretien pour les motos sans kit ni plan.
-- NON APPLIQUEE. Essai à blanc : supabase/tests/m8_or_lisible_repli_entretien.sql.
--
-- Constat sur l'essai du client (OR-2026-00004, Monster 1100 S 2009, « Entretien annuel ») :
--  1. Kit : le kit « Entretien annuel » du modèle-année 1468 ne contient que des lignes de service
--     G8 (DDS, contrôles, CONTRI) ; les pièces (filtre, joint, huile 3,1 l) sont dans le kit
--     « Entretien annuel + huile ». Or le plan Ducati de ce moteur (2 soupapes à air) fait la
--     vidange et le filtre À L'ENTRETIEN ANNUEL (opération « Vidange de l'huile moteur et
--     remplacement du filtre »), comme le forfait G8 « OIL SERVICE M1100 12000 ».
--     → Repli : pour un entretien annuel dont le kit n'a AUCUNE pièce, sur un moteur au profil
--       « 2 soupapes » (maintenance_engine_profiles, code deux_soupapes, forfait G8 « OIL SERVICE
--       2 SOUPAPES »), on prend aussi le kit huile du même modèle-année. Les autres profils ne
--       changent pas (V4, Testastretta : l'annuel ne vide pas toujours l'huile).
--       Profite à la réservation au RDV, à la picking list, aux pièces à venir, aux lignes du kit
--       sur l'OR (Q49) et aux pièces des opérations (mêmes fonctions).
--  2. Plan : le plan Ducati « Monster 696 - 796 - 1100 - 1100 EVO » (2008-2014) existe, mais n'est
--     relié à aucun modèle-année : le catalogue nomme le modèle « 1100 S » dans la famille
--     MONSTER, le plan dit « Monster 1100 » ; la proposition automatique comparait « 1100 S » à
--     « MONSTER 1100 » et ne trouvait rien (256 modèles-années, environ 1 400 motos sans plan).
--     → La proposition compare aussi « famille + modèle » ; rattrapage unique ci-dessous :
--       « lié » quand le nom est exact ou n'ajoute qu'une finition (S, ABS, SP, R, EVO, DARK...),
--       millésime dans la plage du plan et un seul plan possible pour cet usage ; sinon « à
--       valider » (écran Plans d'entretien → catalogue). Détacher : maintenance_link_set(..., 'rejete').
-- Additif : aucune table, aucune politique nouvelle ; fonctions redéfinies à l'identique sauf le
-- choix des kits et la comparaison des noms.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kits : annuel sans pièce sur un 2 soupapes → + kit huile
-- ---------------------------------------------------------------------
create or replace function public._workshop_kit_has_parts(_kit uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select _kit is not null and exists (select 1 from public.maintenance_kit_items i where i.kit_id = _kit and i.kind <> 'forfait');
$$;
revoke all on function public._workshop_kit_has_parts(uuid) from public, anon, authenticated;

-- Codes d'entretien des kits à réunir pour CE modèle-année (workshop_service_kit_codes + repli).
create or replace function public._workshop_service_kit_codes_for(_company uuid, _model_year text, _service text)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _codes text[] := public.workshop_service_kit_codes(_service); _annual uuid; _oil uuid; _prof text;
begin
  if _company is null or _model_year is null or not ('annual' = any(_codes)) or 'oil' = any(_codes) then
    return _codes;
  end if;
  _annual := public._workshop_kit_for(_company, _model_year, 'annual');
  if _annual is null or public._workshop_kit_has_parts(_annual) then return _codes; end if;
  _oil := public._workshop_kit_for(_company, _model_year, 'oil');
  if not public._workshop_kit_has_parts(_oil) then return _codes; end if;
  select p.code into _prof from public.maintenance_engine_profiles p where p.id = public._maintenance_engine_profile_for(_annual);
  if _prof is distinct from 'deux_soupapes' then return _codes; end if;
  return _codes || 'oil'::text;
end $$;
revoke all on function public._workshop_service_kit_codes_for(uuid, text, text) from public, anon;
grant execute on function public._workshop_service_kit_codes_for(uuid, text, text) to authenticated, service_role;
comment on function public._workshop_service_kit_codes_for(uuid, text, text) is
  'Kits à réunir pour un entretien et un modèle-année : workshop_service_kit_codes, plus le kit huile quand le kit annuel n''a aucune pièce sur un moteur 2 soupapes (plan Ducati : vidange à l''annuel ; forfait G8 OIL SERVICE 2 SOUPAPES). Lot OR lisible, 19/11/2026.';

-- Les deux lectures de kit (pièces seules / toutes les lignes) passent par le repli.

CREATE OR REPLACE FUNCTION public._workshop_service_kit_items(_company uuid, _model_year text, _service text)
 RETURNS TABLE(kit_item_id uuid, kit_id uuid, service_kind text, family_code text, article_id uuid, reference text, designation text, quantity numeric, unit text, kind text, confidence text, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(_company, _model_year, c.code) as kid
      from unnest(public._workshop_service_kit_codes_for(_company, _model_year, _service)) with ordinality as c(code, ord)
     where _company is not null and _model_year is not null
  ), items as (
    select i.id as iid, k.kid, k.code, k.ord, i.family_code,
           coalesce(i.article_id, fa.article_id) as aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as ref,
           i.designation, i.quantity, i.unit, i.kind, i.confidence, i.sort_order,
           coalesce(coalesce(i.article_id, fa.article_id)::text,
                    nullif(upper(btrim(coalesce(i.reference, ''))), ''),
                    'fam:' || i.family_code,
                    'des:' || lower(btrim(i.designation))) as dkey
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = _company and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
       and i.kind <> 'forfait'           -- ligne de service G8 (F / T) : pas une piece
  )
  select distinct on (items.dkey)
         items.iid, items.kid, items.code, items.family_code, items.aid, items.ref, items.designation,
         items.quantity, items.unit, items.kind, items.confidence, items.sort_order
    from items
   order by items.dkey, items.quantity desc, items.ord;
$function$;

CREATE OR REPLACE FUNCTION public.workshop_service_kit_lines(_vehicle uuid, _service text)
 RETURNS TABLE(kit_item_id uuid, kit_id uuid, article_id uuid, reference text, designation text, quantity numeric, unit text, kind text, sort_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if v.ducati_model_year_id is null or _service is null then return; end if;
  return query
  with kits as (
    select c.code, c.ord, public._workshop_kit_for(v.company_id, v.ducati_model_year_id, c.code) as kid
      from unnest(public._workshop_service_kit_codes_for(v.company_id, v.ducati_model_year_id, _service)) with ordinality as c(code, ord)
  ), items as (
    select i.id as iid, k.kid, k.ord,
           coalesce(i.article_id, fa.article_id) as aid,
           coalesce(nullif(btrim(i.reference), ''), a.reference) as ref,
           i.designation, i.quantity, i.unit, i.kind, i.sort_order,
           coalesce(coalesce(i.article_id, fa.article_id)::text,
                    nullif(upper(btrim(coalesce(i.reference, ''))), ''),
                    'fam:' || i.family_code,
                    'des:' || lower(btrim(i.designation))) as dkey
      from kits k
      join public.maintenance_kit_items i on i.kit_id = k.kid
      left join public.maintenance_fluid_articles fa
             on i.article_id is null and fa.company_id = v.company_id and fa.family_code = i.family_code
      left join public.articles a on a.id = coalesce(i.article_id, fa.article_id)
     where k.kid is not null
  ), merged as (
    select distinct on (items.dkey) items.*
      from items
     order by items.dkey, items.quantity desc nulls last, items.ord
  )
  select m.iid, m.kid, m.aid, m.ref, m.designation, m.quantity, m.unit, m.kind, m.sort_order
    from merged m
   order by m.ord, case m.kind when 'piece' then 1 when 'consommable' then 2 else 3 end, m.sort_order, m.designation;
end $function$;

-- ---------------------------------------------------------------------
-- 2. Plans : la proposition compare aussi « famille + modèle » du catalogue
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maintenance_propose_catalog_links(_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n_lie integer := 0; n_av integer := 0; n_seen integer := 0; n_my integer := 0;
begin
  if not public._mp_can_link(_company) then
    raise exception 'Rattachement des plans réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;

  select count(*) into n_my from public.ducati_catalog_model_years;

  drop table if exists _mp_hits;
  create temp table _mp_hits on commit drop as
  with cand as (
    select p.id as plan_id, p.usage, p.year_from, p.year_to, public._mp_norm(p.family) as fam,
           public._mp_norm(n.name) as name
      from public.maintenance_plans p
      cross join lateral unnest(p.match_names) as n(name)
     where public._mp_norm(n.name) is not null
  ), my as (
    select y.id as my_id, y.year, public._mp_norm(m.description) as mname, public._mp_norm(f.description) as fam,
           public._mp_norm(f.description || ' ' || m.description) as fullname
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
      join public.ducati_catalog_families f on f.id = m.family_id
     where m.is_europe
  )
  select c.plan_id, c.usage, my.my_id,
         bool_or(my.mname = c.name or replace(my.mname, ' ', '') = replace(c.name, ' ', '')
                 or my.fullname = c.name or replace(my.fullname, ' ', '') = replace(c.name, ' ', '')) as exact_name,
         (min(c.year_from) is not null and my.year is not null) as range_known,
         min(my.mname) as mname, min(my.year) as year
    from cand c
    join my on my.fam = c.fam
           and (my.mname = c.name or my.mname like c.name || ' %'
                or replace(my.mname, ' ', '') = replace(c.name, ' ', '')
                -- 19/11 (lot OR lisible) : le catalogue nomme le modele sans la famille (« 1100 S »
                -- dans la famille MONSTER), le plan avec (« Monster 1100 ») : on compare aussi les deux.
                or my.fullname = c.name or my.fullname like c.name || ' %'
                or replace(my.fullname, ' ', '') = replace(c.name, ' ', ''))
           and (my.year is null or ((c.year_from is null or my.year >= c.year_from)
                                and (c.year_to is null or my.year <= c.year_to)))
   group by c.plan_id, c.usage, my.my_id, my.year;

  -- Un modèle-année « exact » pour plusieurs plans du même usage : aucun n'est lié d'office.
  with graded as (
    select h.*, (select count(*) from _mp_hits h2
                  where h2.my_id = h.my_id and h2.usage = h.usage and h2.exact_name and h2.range_known) as n_exact
      from _mp_hits h
  ), ins as (
    insert into public.maintenance_plan_catalog_links (plan_id, model_year_id, status, origin, reason)
    select g.plan_id, g.my_id,
           case when g.exact_name and g.range_known and g.n_exact = 1 then 'lie' else 'a_valider' end,
           'auto',
           case when not g.exact_name then 'Variante du modèle (nom proche)'
                when not g.range_known then 'Années du plan non précisées'
                when g.n_exact > 1 then 'Plusieurs plans possibles'
                else 'Nom exact, millésime dans la plage' end
      from graded g
    on conflict (plan_id, model_year_id) do nothing
    returning status
  )
  select count(*) filter (where status = 'lie'), count(*) filter (where status = 'a_valider')
    into n_lie, n_av from ins;
  select count(*) into n_seen from _mp_hits;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'maintenance_links_proposed', 'maintenance_plans', null, 'screen', null,
          jsonb_build_object('model_years', n_my, 'candidates', n_seen, 'linked', n_lie, 'to_validate', n_av));

  return jsonb_build_object('modelYears', n_my, 'candidates', n_seen, 'linked', n_lie, 'toValidate', n_av,
                            'alreadyKnown', n_seen - n_lie - n_av);
end $function$;

-- Rattrapage unique (le lien plan ↔ catalogue est commun aux sociétés). Ne touche jamais un lien
-- existant (lié, à valider ou rejeté).
do $$
declare n_lie int; n_av int;
begin
  create temp table _orl_hits on commit drop as
  with cand as (
    select p.id as plan_id, p.usage, p.year_from, p.year_to, public._mp_norm(n.name) as name
      from public.maintenance_plans p
      cross join lateral unnest(p.match_names) as n(name)
     where public._mp_norm(n.name) is not null
  ), my as (
    select y.id as my_id, y.year, public._mp_norm(f.description || ' ' || m.description) as fullname
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
      join public.ducati_catalog_families f on f.id = m.family_id
     where m.is_europe
  )
  select c.plan_id, c.usage, my.my_id, min(my.fullname) as fullname, my.year,
         bool_or(my.fullname = c.name
                 -- seulement des mots de finition après le nom du plan
                 or btrim(substr(my.fullname, length(c.name) + 1)) ~
                    '^((S|ABS|SP|R|RS|EVO|PLUS|DARK|CARBON|STRIPE|TRICOLORE|CORSE|SPECIAL|ANNIVERSARY|ANNIVERSARIO|25|20TH)( |$))+$') as trim_only,
         (min(c.year_from) is not null and my.year is not null) as range_known
    from cand c
    join my on (my.fullname = c.name or my.fullname like c.name || ' %')
           and (my.year is null or ((c.year_from is null or my.year >= c.year_from)
                                and (c.year_to is null or my.year <= c.year_to)))
   where not exists (select 1 from public.maintenance_plan_catalog_links l where l.model_year_id = my.my_id and l.plan_id = c.plan_id)
   group by c.plan_id, c.usage, my.my_id, my.year;

  with graded as (
    select h.*, count(*) over (partition by h.my_id, h.usage) as n_plans,
           exists (select 1 from public.maintenance_plan_catalog_links l join public.maintenance_plans p on p.id = l.plan_id
                    where l.model_year_id = h.my_id and l.status = 'lie' and p.usage = h.usage) as covered
      from _orl_hits h
  ), ins as (
    insert into public.maintenance_plan_catalog_links (plan_id, model_year_id, status, origin, reason)
    select g.plan_id, g.my_id,
           case when g.trim_only and g.range_known and g.n_plans = 1 and not g.covered then 'lie' else 'a_valider' end,
           'auto',
           case when g.covered then 'Famille + modèle du catalogue ; un autre plan est déjà lié'
                when g.n_plans > 1 then 'Famille + modèle du catalogue ; plusieurs plans possibles'
                when not g.range_known then 'Famille + modèle du catalogue ; années du plan non précisées'
                when not g.trim_only then 'Famille + modèle du catalogue ; variante du nom'
                else 'Famille + modèle du catalogue (finition), millésime dans la plage, plan unique' end
      from graded g
    on conflict (plan_id, model_year_id) do nothing
    returning status
  )
  select count(*) filter (where status = 'lie'), count(*) filter (where status = 'a_valider') into n_lie, n_av from ins;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, null, 'maintenance_links_proposed', 'maintenance_plans', null, 'import', null,
          jsonb_build_object('linked', n_lie, 'to_validate', n_av, 'rule', 'famille + modèle (lot OR lisible, 20261119310000)'));
end $$;
