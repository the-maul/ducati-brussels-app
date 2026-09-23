-- =====================================================================
-- Mission 07, carte 3 — un manuel peut couvrir plusieurs modèles-années.
--
-- Constat du chargement du 23/09 : l'extraction liste **469 modèles-années** mais seulement
-- **461 manuels**. Huit modèles-années partagent le manuel d'une autre version :
--   MONSTER 797  2017/2018/2019  partage le manuel de MONSTER 797 +  (598↔606, 600↔608, 602↔610)
--   MONSTER 937  2021→2025       partage le manuel de MONSTER 937 +  (654↔672 … 662↔680)
-- Ducati ne publie qu'un manuel pour les deux versions.
--
-- Sans cette migration, ces 8 modèles-années disparaissaient : le chargeur les voyait comme des
-- doublons du même manuel et n'en gardait qu'un, donc ils n'étaient jamais rattachés au catalogue.
--
-- Correctif : le manuel porte la LISTE des modèles-années du DM qu'il couvre
-- (`covers_model_year_ids`), et `wsm_propose_catalog_links` propose un rattachement pour chacun.
-- Un manuel couvre au minimum son propre identifiant.
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

alter table public.wsm_manuals
  add column if not exists covers_model_year_ids text[] not null default '{}';

comment on column public.wsm_manuals.covers_model_year_ids is
  'Identifiants de modèle-année du DM Ducati couverts par ce manuel (au moins le sien). Ducati publie parfois un seul manuel pour deux versions (Monster 797 et 797 +, Monster 937 et 937 +).';

create index if not exists idx_wsm_manuals_covers on public.wsm_manuals using gin (covers_model_year_ids);

-- ---------------------------------------------------------------------
-- Le chargeur écrit la liste couverte
-- ---------------------------------------------------------------------
-- Même charge qu'avant, avec une clé facultative `covers_model_year_ids` par manuel.
-- Ancienne charge (sans la clé) : le manuel ne couvre que lui-même.
create or replace function public.wsm_ingest_manuals(_payload jsonb, _force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_m jsonb; v_id text; v_hash text; v_exists boolean; v_covers text[];
  n_new integer := 0; n_upd integer := 0; n_same integer := 0; n_svc integer := 0; n_op integer := 0;
  n_use integer := 0; n_use_skip integer := 0; n_sp integer := 0; n_tq integer := 0; n_tool integer := 0;
  n_fluid integer := 0; n_prod integer := 0; n_time integer := 0; n_del integer := 0; k integer;
begin
  if not public._wsm_can_write() then
    raise exception 'Chargement des manuels d''atelier réservé au chargeur ou à un administrateur' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(_payload -> 'manuals', '[]'::jsonb)) <> 'array' then
    raise exception 'Charge invalide (manuals attendu)' using errcode = '22023';
  end if;

  for v_m in select value from jsonb_array_elements(coalesce(_payload -> 'manuals', '[]'::jsonb)) loop
    v_id := nullif(btrim(v_m ->> 'id'), '');
    if v_id is null or nullif(v_m ->> 'content_hash', '') is null then
      raise exception 'Manuel sans identifiant ou sans empreinte' using errcode = '22023';
    end if;
    -- Le manuel couvre au minimum son propre identifiant.
    v_covers := (select array_agg(distinct x) from unnest(
        coalesce(array(select jsonb_array_elements_text(coalesce(v_m -> 'covers_model_year_ids', '[]'::jsonb))), '{}')
        || array[v_id]) x where x is not null and x <> '');

    select m.content_hash into v_hash from public.wsm_manuals m where m.id = v_id;
    v_exists := found;
    if v_exists and v_hash = v_m ->> 'content_hash' and not coalesce(_force, false) then
      n_same := n_same + 1;
      continue;
    end if;

    insert into public.wsm_manuals as t (id, family, supermodel, model, model_year, manual_root, section,
      dm_family_id, dm_supermodel_id, dm_model_id, nodes_count, services_count, operations_count,
      procedures_count, times_count, gaps, source_file, extracted_at, covers_model_year_ids,
      content_hash, loaded_at, updated_at)
    values (v_id, v_m ->> 'family', nullif(v_m ->> 'supermodel', ''), v_m ->> 'model',
      (v_m ->> 'model_year')::integer, nullif(v_m ->> 'manual_root', ''), nullif(v_m ->> 'section', ''),
      nullif(v_m ->> 'dm_family_id', ''), nullif(v_m ->> 'dm_supermodel_id', ''), nullif(v_m ->> 'dm_model_id', ''),
      (v_m ->> 'nodes_count')::integer,
      jsonb_array_length(coalesce(v_m -> 'services', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'operations', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'usages', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'times', '[]'::jsonb)),
      coalesce(v_m -> 'gaps', '[]'::jsonb), nullif(v_m ->> 'source_file', ''),
      nullif(v_m ->> 'extracted_at', '')::timestamptz, v_covers, v_m ->> 'content_hash', now(), now())
    on conflict (id) do update set family = excluded.family, supermodel = excluded.supermodel,
      model = excluded.model, model_year = excluded.model_year, manual_root = excluded.manual_root,
      section = excluded.section, dm_family_id = excluded.dm_family_id,
      dm_supermodel_id = excluded.dm_supermodel_id, dm_model_id = excluded.dm_model_id,
      nodes_count = excluded.nodes_count, services_count = excluded.services_count,
      operations_count = excluded.operations_count, procedures_count = excluded.procedures_count,
      times_count = excluded.times_count, gaps = excluded.gaps, source_file = excluded.source_file,
      extracted_at = excluded.extracted_at, covers_model_year_ids = excluded.covers_model_year_ids,
      content_hash = excluded.content_hash, loaded_at = now(), updated_at = now();
    if v_exists then n_upd := n_upd + 1; else n_new := n_new + 1; end if;

    -- Échéances
    delete from public.wsm_services s where s.manual_id = v_id
       and s.code <> all (array(select e ->> 'code' from jsonb_array_elements(coalesce(v_m -> 'services', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_services as t (manual_id, code, name, km, mi, months, first_service, definition, text, first_reached, sort)
    select v_id, x.code, coalesce(x.name, x.code), x.km, x.mi, x.months, coalesce(x.first_service, false),
           x.definition, x.text, coalesce(x.first_reached, true), coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'services', '[]'::jsonb))
           as x(code text, name text, km integer, mi integer, months integer, first_service boolean,
                definition text, text text, first_reached boolean, sort integer)
     where x.code is not null
    on conflict (manual_id, code) do update set name = excluded.name, km = excluded.km, mi = excluded.mi,
      months = excluded.months, first_service = excluded.first_service, definition = excluded.definition,
      text = excluded.text, first_reached = excluded.first_reached, sort = excluded.sort;
    get diagnostics k = row_count; n_svc := n_svc + k;

    -- Opérations du programme
    delete from public.wsm_operations o where o.manual_id = v_id
       and o.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'operations', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_operations as t (manual_id, row_key, scope, n, label, group_label, service_codes,
      periodicity_km, periodicity_months, sort)
    select v_id, x.row_key, coalesce(x.scope, 'concessionnaire'), x.n, x.label, x.group_label,
           coalesce(x.service_codes, '{}'), x.periodicity_km, x.periodicity_months, coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'operations', '[]'::jsonb))
           as x(row_key text, scope text, n integer, label text, group_label text, service_codes text[],
                periodicity_km integer, periodicity_months integer, sort integer)
     where x.row_key is not null and x.label is not null
    on conflict (manual_id, row_key) do update set scope = excluded.scope, n = excluded.n,
      label = excluded.label, group_label = excluded.group_label, service_codes = excluded.service_codes,
      periodicity_km = excluded.periodicity_km, periodicity_months = excluded.periodicity_months, sort = excluded.sort;
    get diagnostics k = row_count; n_op := n_op + k;

    -- Usages des procédures par ce modèle-année
    delete from public.wsm_procedure_usages u where u.manual_id = v_id
       and (u.procedure_id, u.role) <> all (array(select (e ->> 'procedure_id', coalesce(e ->> 'role', 'procedure'))
              from jsonb_array_elements(coalesce(v_m -> 'usages', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_procedure_usages as t (procedure_id, manual_id, role, operation, dm_path, dm_id,
      version, source_updated_at, sort)
    select x.procedure_id, v_id, coalesce(x.role, 'procedure'), x.operation, x.dm_path, x.dm_id, x.version,
           nullif(x.source_updated_at, '')::date, coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'usages', '[]'::jsonb))
           as x(procedure_id text, role text, operation text, dm_path text, dm_id text, version text,
                source_updated_at text, sort integer)
      join public.wsm_procedures p on p.id = x.procedure_id
    on conflict (procedure_id, manual_id, role) do update set operation = excluded.operation,
      dm_path = excluded.dm_path, dm_id = excluded.dm_id, version = excluded.version,
      source_updated_at = excluded.source_updated_at, sort = excluded.sort;
    get diagnostics k = row_count; n_use := n_use + k;
    n_use_skip := n_use_skip + greatest(jsonb_array_length(coalesce(v_m -> 'usages', '[]'::jsonb)) - k, 0);

    -- Procédures d'une échéance
    delete from public.wsm_service_procedures sp where sp.manual_id = v_id;
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_service_procedures (manual_id, service_code, procedure_id, operation, sort)
    select v_id, x.service_code, x.procedure_id, x.operation, coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'service_procedures', '[]'::jsonb))
           as x(service_code text, procedure_id text, operation text, sort integer)
      join public.wsm_procedures p on p.id = x.procedure_id
     where x.service_code is not null
    on conflict (manual_id, service_code, procedure_id) do nothing;
    get diagnostics k = row_count; n_sp := n_sp + k;

    -- Annexes : couples généraux, outils, ravitaillements, produits
    delete from public.wsm_torque_tables r where r.manual_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'torque_tables', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_torque_tables as t (manual_id, row_key, title, source_manual_root, source_dm_path,
      source_dm_id, source_code, source_version, source_updated_at, lines_count, lines, sort)
    select v_id, x.row_key, coalesce(x.title, 'Couples de serrage'), x.source_manual_root, x.source_dm_path,
           x.source_dm_id, x.source_code, x.source_version, nullif(x.source_updated_at, '')::date,
           jsonb_array_length(coalesce(x.lines, '[]'::jsonb)), coalesce(x.lines, '[]'::jsonb), coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'torque_tables', '[]'::jsonb))
           as x(row_key text, title text, source_manual_root text, source_dm_path text, source_dm_id text,
                source_code text, source_version text, source_updated_at text, lines jsonb, sort integer)
     where x.row_key is not null
    on conflict (manual_id, row_key) do update set title = excluded.title,
      source_manual_root = excluded.source_manual_root, source_dm_path = excluded.source_dm_path,
      source_dm_id = excluded.source_dm_id, source_code = excluded.source_code,
      source_version = excluded.source_version, source_updated_at = excluded.source_updated_at,
      lines_count = excluded.lines_count, lines = excluded.lines, sort = excluded.sort;
    get diagnostics k = row_count; n_tq := n_tq + k;

    delete from public.wsm_tool_sets r where r.manual_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'tool_sets', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_tool_sets as t (manual_id, row_key, title, source_manual_root, source_dm_path,
      source_dm_id, source_code, source_version, source_updated_at, tools_count, tools, sort)
    select v_id, x.row_key, coalesce(x.title, 'Outils'), x.source_manual_root, x.source_dm_path, x.source_dm_id,
           x.source_code, x.source_version, nullif(x.source_updated_at, '')::date,
           jsonb_array_length(coalesce(x.tools, '[]'::jsonb)), coalesce(x.tools, '[]'::jsonb), coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'tool_sets', '[]'::jsonb))
           as x(row_key text, title text, source_manual_root text, source_dm_path text, source_dm_id text,
                source_code text, source_version text, source_updated_at text, tools jsonb, sort integer)
     where x.row_key is not null
    on conflict (manual_id, row_key) do update set title = excluded.title,
      source_manual_root = excluded.source_manual_root, source_dm_path = excluded.source_dm_path,
      source_dm_id = excluded.source_dm_id, source_code = excluded.source_code,
      source_version = excluded.source_version, source_updated_at = excluded.source_updated_at,
      tools_count = excluded.tools_count, tools = excluded.tools, sort = excluded.sort;
    get diagnostics k = row_count; n_tool := n_tool + k;

    delete from public.wsm_fluid_tables r where r.manual_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'fluid_tables', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_fluid_tables as t (manual_id, row_key, title, source_manual_root, source_dm_path,
      source_dm_id, source_code, source_version, source_updated_at, lines_count, lines, warnings, notes, sort)
    select v_id, x.row_key, x.title, x.source_manual_root, x.source_dm_path, x.source_dm_id, x.source_code,
           x.source_version, nullif(x.source_updated_at, '')::date,
           jsonb_array_length(coalesce(x.lines, '[]'::jsonb)), coalesce(x.lines, '[]'::jsonb),
           coalesce(x.warnings, '[]'::jsonb), coalesce(x.notes, '[]'::jsonb), coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'fluid_tables', '[]'::jsonb))
           as x(row_key text, title text, source_manual_root text, source_dm_path text, source_dm_id text,
                source_code text, source_version text, source_updated_at text, lines jsonb, warnings jsonb,
                notes jsonb, sort integer)
     where x.row_key is not null
    on conflict (manual_id, row_key) do update set title = excluded.title,
      source_manual_root = excluded.source_manual_root, source_dm_path = excluded.source_dm_path,
      source_dm_id = excluded.source_dm_id, source_code = excluded.source_code,
      source_version = excluded.source_version, source_updated_at = excluded.source_updated_at,
      lines_count = excluded.lines_count, lines = excluded.lines, warnings = excluded.warnings,
      notes = excluded.notes, sort = excluded.sort;
    get diagnostics k = row_count; n_fluid := n_fluid + k;

    delete from public.wsm_product_tables r where r.manual_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'product_tables', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_product_tables as t (manual_id, row_key, title, source_manual_root, source_dm_path,
      source_dm_id, source_code, source_version, source_updated_at, products_count, products, sort)
    select v_id, x.row_key, x.title, x.source_manual_root, x.source_dm_path, x.source_dm_id, x.source_code,
           x.source_version, nullif(x.source_updated_at, '')::date,
           jsonb_array_length(coalesce(x.products, '[]'::jsonb)), coalesce(x.products, '[]'::jsonb), coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'product_tables', '[]'::jsonb))
           as x(row_key text, title text, source_manual_root text, source_dm_path text, source_dm_id text,
                source_code text, source_version text, source_updated_at text, products jsonb, sort integer)
     where x.row_key is not null
    on conflict (manual_id, row_key) do update set title = excluded.title,
      source_manual_root = excluded.source_manual_root, source_dm_path = excluded.source_dm_path,
      source_dm_id = excluded.source_dm_id, source_code = excluded.source_code,
      source_version = excluded.source_version, source_updated_at = excluded.source_updated_at,
      products_count = excluded.products_count, products = excluded.products, sort = excluded.sort;
    get diagnostics k = row_count; n_prod := n_prod + k;

    -- Temps réels (UT)
    delete from public.wsm_times r where r.manual_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_m -> 'times', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;
    insert into public.wsm_times as t (manual_id, row_key, label, service_code, time_text, minutes, ut,
      values_doc, source_manual_root, source_dm_path, source_dm_id, source_code, source_version, source_updated_at, sort)
    select v_id, x.row_key, x.label, x.service_code, x.time_text, x.minutes, x.ut, coalesce(x.values_doc, '{}'),
           x.source_manual_root, x.source_dm_path, x.source_dm_id, x.source_code, x.source_version,
           nullif(x.source_updated_at, '')::date, coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_m -> 'times', '[]'::jsonb))
           as x(row_key text, label text, service_code text, time_text text, minutes integer, ut integer,
                values_doc text[], source_manual_root text, source_dm_path text, source_dm_id text,
                source_code text, source_version text, source_updated_at text, sort integer)
     where x.row_key is not null and x.label is not null
    on conflict (manual_id, row_key) do update set label = excluded.label, service_code = excluded.service_code,
      time_text = excluded.time_text, minutes = excluded.minutes, ut = excluded.ut,
      values_doc = excluded.values_doc, source_manual_root = excluded.source_manual_root,
      source_dm_path = excluded.source_dm_path, source_dm_id = excluded.source_dm_id,
      source_code = excluded.source_code, source_version = excluded.source_version,
      source_updated_at = excluded.source_updated_at, sort = excluded.sort;
    get diagnostics k = row_count; n_time := n_time + k;
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, auth.uid(), 'wsm_manuals_loaded', 'wsm_manuals', nullif(_payload ->> 'run', ''), 'import', null,
          jsonb_build_object('manuals_new', n_new, 'manuals_updated', n_upd, 'manuals_unchanged', n_same,
                             'services', n_svc, 'operations', n_op, 'usages', n_use, 'usages_skipped', n_use_skip,
                             'service_procedures', n_sp, 'torque_tables', n_tq, 'tool_sets', n_tool,
                             'fluid_tables', n_fluid, 'product_tables', n_prod, 'times', n_time,
                             'rows_removed', n_del));

  return jsonb_build_object('manuals_new', n_new, 'manuals_updated', n_upd, 'manuals_unchanged', n_same,
    'services', n_svc, 'operations', n_op, 'usages', n_use, 'usages_skipped', n_use_skip,
    'service_procedures', n_sp, 'torque_tables', n_tq, 'tool_sets', n_tool, 'fluid_tables', n_fluid,
    'product_tables', n_prod, 'times', n_time, 'rows_removed', n_del);
end $$;
revoke all on function public.wsm_ingest_manuals(jsonb, boolean) from public, anon;
grant execute on function public.wsm_ingest_manuals(jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Rapprochement des noms : la règle exacte, la même des deux côtés
-- ---------------------------------------------------------------------
-- Le premier jet ne comparait que deux formes de nom et ne rattachait que 253 manuels sur 461.
-- La règle ci-dessous est celle qui a été validée hors base sur les vraies données (418 rattachés
-- fermement, 9 à valider, 34 sans correspondance) : on la transcrit ici mot pour mot, pour que le
-- bouton « Proposer les rattachements » de l'écran donne exactement le même résultat que le
-- chargeur.

-- Forme normalisée d'un libellé : majuscules sans accents, sans ponctuation, et sans les mentions
-- qui ne distinguent pas un millésime (ABS, 2G/3G…, NEW, EU). « PLUS » s'écrit « + », « STRIPES »
-- devient « STRIPE » (le manuel et le catalogue n'orthographient pas pareil).
create or replace function public._wsm_up(_s text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 upper(translate(coalesce(_s, ''),
                   'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
                   'AAAAAACEEEEIIIINOOOOOUUUUYAAAAAACEEEEIIIINOOOOOUUUUY')),
                 '\mSTRIPES\M', 'STRIPE', 'g'),
               '\mPLUS\M', '+', 'g'),
             '\m([0-9]+G|ABS|NEW|EU)\M', ' ', 'g'),
           '[^A-Z0-9+]', '', 'g');
$$;
revoke all on function public._wsm_up(text) from public, anon;
grant execute on function public._wsm_up(text) to authenticated, service_role;

-- Famille, avec l'unique synonyme utile : le manuel dit XDIAVEL là où le catalogue dit DIAVEL.
create or replace function public._wsm_fam(_f text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case public._wsm_up(_f) when 'XDIAVEL' then 'DIAVEL' else public._wsm_up(_f) end;
$$;
revoke all on function public._wsm_fam(text) from public, anon;
grant execute on function public._wsm_fam(text) to authenticated, service_role;

-- Toutes les écritures possibles d'un modèle : le manuel écrit « MONSTER 1200 S », le catalogue
-- écrit supermodèle « 1200 » + modèle « 1200 S ». On engendre les combinaisons des deux côtés et
-- on rattache dès qu'une seule est commune. Les formes de moins de 4 caractères obtenues en
-- retirant le préfixe (« S », « V4 ») sont écartées : elles rattacheraient n'importe quoi.
create or replace function public._wsm_keys(_fam text, _sm text, _mod text)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare f text; s text; m text; b text; x text; out text[] := '{}';
begin
  f := public._wsm_up(_fam); s := public._wsm_up(_sm); m := public._wsm_up(_mod);
  foreach b in array array[m, s || m, f || m, f || s || m] loop
    if b <> '' then out := out || b; end if;
    x := b;
    if f <> '' and left(x, length(f)) = f and length(x) > length(f) then x := substr(x, length(f) + 1); end if;
    if s <> '' and left(x, length(s)) = s and length(x) > length(s) then x := substr(x, length(s) + 1); end if;
    if length(x) >= 4 then out := out || x; end if;
  end loop;
  return array(select distinct e from unnest(out) e where e <> '');
end $$;
revoke all on function public._wsm_keys(text, text, text) from public, anon;
grant execute on function public._wsm_keys(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Le rattachement au catalogue parcourt tous les modèles-années couverts
-- ---------------------------------------------------------------------
create or replace function public.wsm_propose_catalog_links(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_id integer := 0; n_name integer := 0; n_amb integer := 0; n_my integer;
begin
  if not public._wsm_can_link(_company) then
    raise exception 'Rattachement réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;
  select count(*) into n_my from public.ducati_catalog_model_years;

  -- 1) identifiant identique (le manuel peut en couvrir plusieurs)
  insert into public.wsm_manual_catalog_links as t (manual_id, model_year_id, status, origin, reason, proposed_at)
  select m.id, y.id, 'lie', 'id_ecatalog', 'Identifiant e-catalog identique', now()
    from public.wsm_manuals m
    cross join lateral unnest(
      case when coalesce(array_length(m.covers_model_year_ids, 1), 0) = 0
           then array[m.id] else m.covers_model_year_ids end) as c(my_id)
    join public.ducati_catalog_model_years y on y.id = c.my_id
  on conflict (manual_id, model_year_id) do update set status = 'lie', origin = 'id_ecatalog',
      reason = excluded.reason, proposed_at = now()
    where t.origin <> 'manuel' and (t.status, t.origin) is distinct from ('lie', 'id_ecatalog');
  get diagnostics n_id = row_count;

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
end $$;
revoke all on function public.wsm_propose_catalog_links(uuid) from public, anon;
grant execute on function public.wsm_propose_catalog_links(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Les compteurs distinguent « manuels » et « modèles-années couverts »
-- ---------------------------------------------------------------------
create or replace function public.wsm_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._wsm_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'manuals', (select count(*) from public.wsm_manuals),
    'modelYearsCovered', (select count(distinct c) from public.wsm_manuals m,
                            lateral unnest(case when coalesce(array_length(m.covers_model_year_ids, 1), 0) = 0
                                                then array[m.id] else m.covers_model_year_ids end) c),
    'manualsByFamily', (select coalesce(jsonb_object_agg(family, n), '{}'::jsonb)
                          from (select family, count(*) n from public.wsm_manuals group by family) f),
    'yearFrom', (select min(model_year) from public.wsm_manuals),
    'yearTo', (select max(model_year) from public.wsm_manuals),
    'procedures', (select count(*) from public.wsm_procedures),
    'steps', (select count(*) from public.wsm_procedure_steps),
    'usages', (select count(*) from public.wsm_procedure_usages),
    'services', (select count(*) from public.wsm_services),
    'operations', (select count(*) from public.wsm_operations),
    'times', (select count(*) from public.wsm_times),
    'torqueLines', (select coalesce(sum(lines_count), 0) from public.wsm_torque_tables),
    'linked', (select count(distinct manual_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'linkedModelYears', (select count(distinct model_year_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'toValidate', (select count(distinct manual_id) from public.wsm_manual_catalog_links where status = 'a_valider'),
    'unlinked', (select count(*) from public.wsm_manuals m
                  where not exists (select 1 from public.wsm_manual_catalog_links l
                                     where l.manual_id = m.id and l.status = 'lie')),
    'images', (select count(*) from public.wsm_images),
    'imagesUploaded', (select count(*) from public.wsm_images where uploaded_at is not null),
    'lastLoadedAt', (select max(loaded_at) from public.wsm_manuals)
  );
end $$;
revoke all on function public.wsm_stats() from public, anon;
grant execute on function public.wsm_stats() to authenticated, service_role;
