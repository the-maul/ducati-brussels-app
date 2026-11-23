-- M8 (23/11/2026) : des manuels d'atelier étaient rattachés à la mauvaise moto. Les numéros des
-- manuels et ceux du catalogue sont deux séries différentes : un même numéro ne prouve rien
-- (manuel Scrambler 1100 2021 relié à la Multistrada 1000 2003). On écarte ces 138 liens, on retire
-- la règle, puis on relie par famille, modèle et millésime. Un cas ambigu reste « à valider ».
update public.wsm_manual_catalog_links
   set status = 'rejete', decided_at = now(),
       reason = 'Faux rattachement : même numéro interne, autre moto (correction du 23/11/2026)'
 where status = 'lie' and origin = 'id_ecatalog';

CREATE OR REPLACE FUNCTION public.wsm_propose_catalog_links(_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n_id integer := 0; n_name integer := 0; n_amb integer := 0; n_my integer;
begin
  if not public._wsm_can_link(_company) then
    raise exception 'Rattachement réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;
  select count(*) into n_my from public.ducati_catalog_model_years;

  -- 1) Retiré le 23/11/2026 : les numéros des manuels et du catalogue sont deux séries différentes.
  --    Un même numéro ne prouve rien (manuel Scrambler 1100 2021 = catalogue Multistrada 1000 2003).

  -- 2) même famille, même millésime, même écriture de modèle — pour les manuels encore sans lien.
  --    Les clés du catalogue sont calculées une seule fois (857 lignes) plutôt qu'à chaque
  --    comparaison : sans cela la fonction dépasse les 8 s de PostgREST.
  with deja as (
    select manual_id from public.wsm_manual_catalog_links where status = 'lie'
  ), cat as (
    select y.id as model_year_id, y.year,
           public._wsm_fam(f.description) as fam,
           public._wsm_keys(f.description, sm.description, mo.description) as keys
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models mo on mo.id = y.model_id
      join public.ducati_catalog_families f on f.id = mo.family_id
      left join public.ducati_catalog_supermodels sm on sm.id = mo.supermodel_id
  ), man as (
    select m.id as manual_id, m.model_year,
           public._wsm_fam(m.family) as fam,
           public._wsm_keys(m.family, m.supermodel, m.model) as keys
      from public.wsm_manuals m
     where m.id not in (select manual_id from deja)
  ), cand as (
    select man.manual_id, cat.model_year_id,
           count(*) over (partition by man.manual_id) as n
      from man
      join cat on cat.year = man.model_year and cat.fam = man.fam and cat.keys && man.keys
  )
  insert into public.wsm_manual_catalog_links as t (manual_id, model_year_id, status, origin, reason, proposed_at)
  select c.manual_id, c.model_year_id, case when c.n = 1 then 'lie' else 'a_valider' end, 'nom_annee',
         case when c.n = 1 then 'Nom et millésime identiques'
              else 'Nom et millésime identiques, ' || c.n || ' versions possibles' end, now()
    from cand c
  on conflict (manual_id, model_year_id) do update set status = excluded.status, origin = 'nom_annee',
      reason = excluded.reason, proposed_at = now()
    where t.origin <> 'manuel' and (t.status, t.reason) is distinct from (excluded.status, excluded.reason);
  get diagnostics n_name = row_count;

  select count(*) into n_amb from public.wsm_manual_catalog_links where status = 'a_valider';

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'wsm_links_proposed', 'wsm_manuals', null, 'screen', null,
          jsonb_build_object('model_years', n_my, 'by_id', n_id, 'by_name', n_name, 'to_validate', n_amb));

  return jsonb_build_object('modelYears', n_my, 'byId', n_id, 'byName', n_name, 'toValidate', n_amb,
    'linked', (select count(*) from public.wsm_manual_catalog_links where status = 'lie'),
    'modelYearsCovered', (select count(distinct model_year_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'manualsLinked', (select count(distinct manual_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'manualsUnlinked', (select count(*) from public.wsm_manuals m
                         where not exists (select 1 from public.wsm_manual_catalog_links l
                                            where l.manual_id = m.id and l.status = 'lie')));
end $function$;

CREATE OR REPLACE FUNCTION pg_temp.wsm_relink(_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
declare n_id integer := 0; n_name integer := 0; n_amb integer := 0; n_my integer;
begin
    select count(*) into n_my from public.ducati_catalog_model_years;

  -- 1) Retiré le 23/11/2026 : les numéros des manuels et du catalogue sont deux séries différentes.
  --    Un même numéro ne prouve rien (manuel Scrambler 1100 2021 = catalogue Multistrada 1000 2003).

  -- 2) même famille, même millésime, même écriture de modèle — pour les manuels encore sans lien.
  --    Les clés du catalogue sont calculées une seule fois (857 lignes) plutôt qu'à chaque
  --    comparaison : sans cela la fonction dépasse les 8 s de PostgREST.
  with deja as (
    select manual_id from public.wsm_manual_catalog_links where status = 'lie'
  ), cat as (
    select y.id as model_year_id, y.year,
           public._wsm_fam(f.description) as fam,
           public._wsm_keys(f.description, sm.description, mo.description) as keys
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models mo on mo.id = y.model_id
      join public.ducati_catalog_families f on f.id = mo.family_id
      left join public.ducati_catalog_supermodels sm on sm.id = mo.supermodel_id
  ), man as (
    select m.id as manual_id, m.model_year,
           public._wsm_fam(m.family) as fam,
           public._wsm_keys(m.family, m.supermodel, m.model) as keys
      from public.wsm_manuals m
     where m.id not in (select manual_id from deja)
  ), cand as (
    select man.manual_id, cat.model_year_id,
           count(*) over (partition by man.manual_id) as n
      from man
      join cat on cat.year = man.model_year and cat.fam = man.fam and cat.keys && man.keys
  )
  insert into public.wsm_manual_catalog_links as t (manual_id, model_year_id, status, origin, reason, proposed_at)
  select c.manual_id, c.model_year_id, case when c.n = 1 then 'lie' else 'a_valider' end, 'nom_annee',
         case when c.n = 1 then 'Nom et millésime identiques'
              else 'Nom et millésime identiques, ' || c.n || ' versions possibles' end, now()
    from cand c
  on conflict (manual_id, model_year_id) do update set status = excluded.status, origin = 'nom_annee',
      reason = excluded.reason, proposed_at = now()
    where t.origin <> 'manuel' and (t.status, t.reason) is distinct from (excluded.status, excluded.reason);
  get diagnostics n_name = row_count;

  select count(*) into n_amb from public.wsm_manual_catalog_links where status = 'a_valider';

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'wsm_links_proposed', 'wsm_manuals', null, 'screen', null,
          jsonb_build_object('model_years', n_my, 'by_id', n_id, 'by_name', n_name, 'to_validate', n_amb));

  return jsonb_build_object('modelYears', n_my, 'byId', n_id, 'byName', n_name, 'toValidate', n_amb,
    'linked', (select count(*) from public.wsm_manual_catalog_links where status = 'lie'),
    'modelYearsCovered', (select count(distinct model_year_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'manualsLinked', (select count(distinct manual_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'manualsUnlinked', (select count(*) from public.wsm_manuals m
                         where not exists (select 1 from public.wsm_manual_catalog_links l
                                            where l.manual_id = m.id and l.status = 'lie')));
end $function$;

select pg_temp.wsm_relink(c.id) from (select id from public.companies order by id limit 1) c;
drop function pg_temp.wsm_relink(uuid);
