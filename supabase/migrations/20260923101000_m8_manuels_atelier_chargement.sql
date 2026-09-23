-- =====================================================================
-- Mission 07, carte 3 — chargement et lecture des manuels d'atelier (suite de
-- 20260923100000_m8_manuels_atelier.sql).
--
-- Trois fonctions d'écriture, appelées par tools/wsm-loader (clé de service) :
--   * wsm_ingest_procedures : les procédures dédupliquées et leurs étapes ;
--   * wsm_ingest_manuals    : les modèles-années, leur programme et leurs annexes ;
--   * wsm_ingest_images     : l'inventaire des images et l'état de leur envoi.
-- Chacune écrit UNE ligne events par appel, jamais par ligne.
--
-- Deux fonctions de rattachement au catalogue, comme pour les plans (M-21) :
--   * wsm_propose_catalog_links : identifiant e-catalog identique = lié ; nom + millésime = lié
--     si un seul candidat, à valider sinon ;
--   * wsm_link_set : décision prise à l'écran par un administrateur ou un chef d'atelier.
--
-- Trois fonctions de lecture pour l'écran Atelier → Plans d'entretien, onglet « Manuels
-- d'atelier » : wsm_stats, wsm_manual_list, wsm_manual_overview.
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Procédures dédupliquées
-- ---------------------------------------------------------------------
-- Charge : { run, procedures: [ { id, title, roles[], source_*, intervention, tools, products,
--            warnings, intro_figures, times, steps_count, figures_count, usages_count,
--            content_hash, steps: [ { n, phase, sub_phase, text, sub_steps, figures, tools,
--            products, torques, marks, warnings, symbols, tables, videos, links } ],
--            torques: [ { row_key, step_n, value_nm, min_nm, max_nm, tolerance, marks[], text, sort } ] } ] }
-- Une procédure dont content_hash n'a pas changé n'est pas réécrite (sauf _force).
create or replace function public.wsm_ingest_procedures(_payload jsonb, _force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p jsonb; v_id text; v_hash text; v_exists boolean;
  n_new integer := 0; n_upd integer := 0; n_same integer := 0;
  n_steps integer := 0; n_torques integer := 0; n_del integer := 0; k integer;
begin
  if not public._wsm_can_write() then
    raise exception 'Chargement des manuels d''atelier réservé au chargeur ou à un administrateur' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(_payload -> 'procedures', '[]'::jsonb)) <> 'array' then
    raise exception 'Charge invalide (procedures attendu)' using errcode = '22023';
  end if;

  for v_p in select value from jsonb_array_elements(coalesce(_payload -> 'procedures', '[]'::jsonb)) loop
    v_id := nullif(btrim(v_p ->> 'id'), '');
    if v_id is null or nullif(v_p ->> 'content_hash', '') is null then
      raise exception 'Procédure sans identifiant ou sans empreinte' using errcode = '22023';
    end if;
    select p.content_hash into v_hash from public.wsm_procedures p where p.id = v_id;
    v_exists := found;
    if v_exists and v_hash = v_p ->> 'content_hash' and not coalesce(_force, false) then
      n_same := n_same + 1;
      continue;
    end if;

    insert into public.wsm_procedures as t (id, title, roles, source_manual_root, source_dm_path, source_dm_id,
      source_title, source_code, source_version, source_updated_at, intervention, tools, products, warnings,
      intro_figures, times, steps_count, figures_count, torques_count, usages_count, content_hash, loaded_at, updated_at)
    values (v_id, coalesce(nullif(v_p ->> 'title', ''), v_id),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_p -> 'roles', '[]'::jsonb))), '{}'),
      v_p ->> 'source_manual_root', v_p ->> 'source_dm_path', v_p ->> 'source_dm_id',
      v_p ->> 'source_title', v_p ->> 'source_code', v_p ->> 'source_version',
      nullif(v_p ->> 'source_updated_at', '')::date,
      v_p -> 'intervention',
      coalesce(v_p -> 'tools', '[]'::jsonb), coalesce(v_p -> 'products', '[]'::jsonb),
      coalesce(v_p -> 'warnings', '[]'::jsonb), coalesce(v_p -> 'intro_figures', '[]'::jsonb),
      coalesce(v_p -> 'times', '[]'::jsonb),
      coalesce((v_p ->> 'steps_count')::integer, 0), coalesce((v_p ->> 'figures_count')::integer, 0),
      coalesce((v_p ->> 'torques_count')::integer, 0), coalesce((v_p ->> 'usages_count')::integer, 0),
      v_p ->> 'content_hash', now(), now())
    on conflict (id) do update set title = excluded.title, roles = excluded.roles,
      source_manual_root = excluded.source_manual_root, source_dm_path = excluded.source_dm_path,
      source_dm_id = excluded.source_dm_id, source_title = excluded.source_title,
      source_code = excluded.source_code, source_version = excluded.source_version,
      source_updated_at = excluded.source_updated_at, intervention = excluded.intervention,
      tools = excluded.tools, products = excluded.products, warnings = excluded.warnings,
      intro_figures = excluded.intro_figures, times = excluded.times, steps_count = excluded.steps_count,
      figures_count = excluded.figures_count, torques_count = excluded.torques_count,
      usages_count = excluded.usages_count, content_hash = excluded.content_hash,
      loaded_at = now(), updated_at = now();
    if v_exists then n_upd := n_upd + 1; else n_new := n_new + 1; end if;

    -- Étapes disparues de la source : retirées.
    delete from public.wsm_procedure_steps s
     where s.procedure_id = v_id
       and s.n <> all (array(select (e ->> 'n')::integer from jsonb_array_elements(coalesce(v_p -> 'steps', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;

    insert into public.wsm_procedure_steps as t (procedure_id, n, phase, sub_phase, text, sub_steps, figures,
      tools, products, torques, marks, warnings, symbols, tables, videos, links)
    select v_id, x.n, x.phase, x.sub_phase, x.text,
      coalesce(x.sub_steps, '[]'::jsonb), coalesce(x.figures, '[]'::jsonb), coalesce(x.tools, '[]'::jsonb),
      coalesce(x.products, '[]'::jsonb), coalesce(x.torques, '[]'::jsonb), coalesce(x.marks, '[]'::jsonb),
      coalesce(x.warnings, '[]'::jsonb), coalesce(x.symbols, '[]'::jsonb), coalesce(x.tables, '[]'::jsonb),
      coalesce(x.videos, '[]'::jsonb), coalesce(x.links, '[]'::jsonb)
      from jsonb_to_recordset(coalesce(v_p -> 'steps', '[]'::jsonb))
           as x(n integer, phase text, sub_phase text, text text, sub_steps jsonb, figures jsonb, tools jsonb,
                products jsonb, torques jsonb, marks jsonb, warnings jsonb, symbols jsonb, tables jsonb,
                videos jsonb, links jsonb)
     where x.n is not null
    on conflict (procedure_id, n) do update set phase = excluded.phase, sub_phase = excluded.sub_phase,
      text = excluded.text, sub_steps = excluded.sub_steps, figures = excluded.figures, tools = excluded.tools,
      products = excluded.products, torques = excluded.torques, marks = excluded.marks,
      warnings = excluded.warnings, symbols = excluded.symbols, tables = excluded.tables,
      videos = excluded.videos, links = excluded.links;
    get diagnostics k = row_count; n_steps := n_steps + k;

    delete from public.wsm_procedure_torques r
     where r.procedure_id = v_id
       and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_p -> 'torques', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;

    insert into public.wsm_procedure_torques as t (procedure_id, row_key, step_n, value_nm, min_nm, max_nm,
      tolerance, marks, text, sort)
    select v_id, x.row_key, x.step_n, x.value_nm, x.min_nm, x.max_nm, x.tolerance,
      coalesce(x.marks, '{}'), x.text, coalesce(x.sort, 0)
      from jsonb_to_recordset(coalesce(v_p -> 'torques', '[]'::jsonb))
           as x(row_key text, step_n integer, value_nm numeric, min_nm numeric, max_nm numeric,
                tolerance text, marks text[], text text, sort integer)
     where x.row_key is not null
    on conflict (procedure_id, row_key) do update set step_n = excluded.step_n, value_nm = excluded.value_nm,
      min_nm = excluded.min_nm, max_nm = excluded.max_nm, tolerance = excluded.tolerance,
      marks = excluded.marks, text = excluded.text, sort = excluded.sort;
    get diagnostics k = row_count; n_torques := n_torques + k;
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, auth.uid(), 'wsm_procedures_loaded', 'wsm_procedures', nullif(_payload ->> 'run', ''), 'import', null,
          jsonb_build_object('procedures_new', n_new, 'procedures_updated', n_upd, 'procedures_unchanged', n_same,
                             'steps', n_steps, 'torques', n_torques, 'rows_removed', n_del));

  return jsonb_build_object('procedures_new', n_new, 'procedures_updated', n_upd, 'procedures_unchanged', n_same,
    'steps', n_steps, 'torques', n_torques, 'rows_removed', n_del);
end $$;
revoke all on function public.wsm_ingest_procedures(jsonb, boolean) from public, anon;
grant execute on function public.wsm_ingest_procedures(jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Manuels (modèles-années) : programme, usages, annexes
-- ---------------------------------------------------------------------
-- Charge : { run, manuals: [ { id, family, supermodel, model, model_year, manual_root, section,
--            dm_*_id, nodes_count, gaps, source_file, extracted_at, content_hash,
--            services: [...], operations: [...], usages: [...], service_procedures: [...],
--            torque_tables: [...], tool_sets: [...], fluid_tables: [...], product_tables: [...],
--            times: [...] } ] }
-- Les procédures citées doivent déjà être chargées (wsm_ingest_procedures) : un usage qui pointe
-- vers une procédure absente est ignoré, et compté dans « usages_ignores ».
create or replace function public.wsm_ingest_manuals(_payload jsonb, _force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_m jsonb; v_id text; v_hash text; v_exists boolean;
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
    select m.content_hash into v_hash from public.wsm_manuals m where m.id = v_id;
    v_exists := found;
    if v_exists and v_hash = v_m ->> 'content_hash' and not coalesce(_force, false) then
      n_same := n_same + 1;
      continue;
    end if;

    insert into public.wsm_manuals as t (id, family, supermodel, model, model_year, manual_root, section,
      dm_family_id, dm_supermodel_id, dm_model_id, nodes_count, services_count, operations_count,
      procedures_count, times_count, gaps, source_file, extracted_at, content_hash, loaded_at, updated_at)
    values (v_id, v_m ->> 'family', nullif(v_m ->> 'supermodel', ''), v_m ->> 'model',
      (v_m ->> 'model_year')::integer, nullif(v_m ->> 'manual_root', ''), nullif(v_m ->> 'section', ''),
      nullif(v_m ->> 'dm_family_id', ''), nullif(v_m ->> 'dm_supermodel_id', ''), nullif(v_m ->> 'dm_model_id', ''),
      (v_m ->> 'nodes_count')::integer,
      jsonb_array_length(coalesce(v_m -> 'services', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'operations', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'usages', '[]'::jsonb)),
      jsonb_array_length(coalesce(v_m -> 'times', '[]'::jsonb)),
      coalesce(v_m -> 'gaps', '[]'::jsonb), nullif(v_m ->> 'source_file', ''),
      nullif(v_m ->> 'extracted_at', '')::timestamptz, v_m ->> 'content_hash', now(), now())
    on conflict (id) do update set family = excluded.family, supermodel = excluded.supermodel,
      model = excluded.model, model_year = excluded.model_year, manual_root = excluded.manual_root,
      section = excluded.section, dm_family_id = excluded.dm_family_id,
      dm_supermodel_id = excluded.dm_supermodel_id, dm_model_id = excluded.dm_model_id,
      nodes_count = excluded.nodes_count, services_count = excluded.services_count,
      operations_count = excluded.operations_count, procedures_count = excluded.procedures_count,
      times_count = excluded.times_count, gaps = excluded.gaps, source_file = excluded.source_file,
      extracted_at = excluded.extracted_at, content_hash = excluded.content_hash,
      loaded_at = now(), updated_at = now();
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
-- 3. Images : inventaire et suivi d'envoi
-- ---------------------------------------------------------------------
-- Charge : { run, images: [ { path, kind, used_count, bytes, sha256, storage_path, uploaded_at } ] }
create or replace function public.wsm_ingest_images(_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0;
begin
  if not public._wsm_can_write() then
    raise exception 'Inventaire des images réservé au chargeur ou à un administrateur' using errcode = '42501';
  end if;

  insert into public.wsm_images as t (path, kind, storage_path, bytes, sha256, uploaded_at, used_count, updated_at)
  select x.path, coalesce(x.kind, 'figure'), x.storage_path, x.bytes, x.sha256,
         nullif(x.uploaded_at, '')::timestamptz, coalesce(x.used_count, 0), now()
    from jsonb_to_recordset(coalesce(_payload -> 'images', '[]'::jsonb))
         as x(path text, kind text, storage_path text, bytes bigint, sha256 text, uploaded_at text, used_count integer)
   where x.path is not null
  on conflict (path) do update set kind = excluded.kind,
    storage_path = coalesce(excluded.storage_path, t.storage_path),
    bytes = coalesce(excluded.bytes, t.bytes), sha256 = coalesce(excluded.sha256, t.sha256),
    uploaded_at = coalesce(excluded.uploaded_at, t.uploaded_at), used_count = excluded.used_count, updated_at = now()
    where (t.kind, t.used_count) is distinct from (excluded.kind, excluded.used_count)
       or (excluded.storage_path is not null and t.storage_path is distinct from excluded.storage_path)
       or (excluded.uploaded_at is not null and t.uploaded_at is distinct from excluded.uploaded_at)
       or (excluded.bytes is not null and t.bytes is distinct from excluded.bytes);
  get diagnostics n = row_count;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, auth.uid(), 'wsm_images_indexed', 'wsm_images', nullif(_payload ->> 'run', ''), 'import', null,
          jsonb_build_object('rows', n,
            'total', (select count(*) from public.wsm_images),
            'uploaded', (select count(*) from public.wsm_images where uploaded_at is not null)));

  return jsonb_build_object('rows', n,
    'total', (select count(*) from public.wsm_images),
    'uploaded', (select count(*) from public.wsm_images where uploaded_at is not null),
    'bytes', (select coalesce(sum(bytes), 0) from public.wsm_images));
end $$;
revoke all on function public.wsm_ingest_images(jsonb) from public, anon;
grant execute on function public.wsm_ingest_images(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Rattachement au catalogue Ducati
-- ---------------------------------------------------------------------
-- Nom normalisé pour le rapprochement : majuscules sans accents, sans ponctuation, sans les
-- mentions qui ne distinguent pas un millésime (ABS, 2G/3G…, NEW, EU).
create or replace function public._wsm_norm(_s text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(regexp_replace(
           regexp_replace(
             upper(translate(coalesce(_s, ''),
               'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
               'AAAAAACEEEEIIIINOOOOOUUUUYAAAAAACEEEEIIIINOOOOOUUUUY')),
             '\m(ABS|[0-9]G|NEW|EU|STRIPES)\M', ' ', 'g'),
           '[^A-Z0-9+]', '', 'g'), '');
$$;
revoke all on function public._wsm_norm(text) from public, anon;
grant execute on function public._wsm_norm(text) to authenticated, service_role;

-- Propose les rattachements manuel ↔ modèle-année du catalogue.
--   1) identifiant du DM égal à l'identifiant e-catalog → lié (origine id_ecatalog) ;
--   2) sinon, même famille, même millésime et même nom normalisé :
--      un seul candidat → lié (origine nom_annee) ; plusieurs → à valider.
-- Ne touche jamais un rattachement décidé à la main (origin = 'manuel').
create or replace function public.wsm_propose_catalog_links(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_id integer := 0; n_name integer := 0; n_amb integer := 0; n_my integer;
begin
  if not public._wsm_can_link(_company) then
    raise exception 'Rattachement réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;
  select count(*) into n_my from public.ducati_catalog_model_years;

  -- 1) identifiant identique
  insert into public.wsm_manual_catalog_links as t (manual_id, model_year_id, status, origin, reason, proposed_at)
  select m.id, y.id, 'lie', 'id_ecatalog', 'Identifiant e-catalog identique', now()
    from public.wsm_manuals m
    join public.ducati_catalog_model_years y on y.id = m.id
  on conflict (manual_id, model_year_id) do update set status = 'lie', origin = 'id_ecatalog',
      reason = excluded.reason, proposed_at = now()
    where t.origin <> 'manuel' and (t.status, t.origin) is distinct from ('lie', 'id_ecatalog');
  get diagnostics n_id = row_count;

  -- 2) même famille, même millésime, même nom normalisé
  with deja as (
    select manual_id from public.wsm_manual_catalog_links where status = 'lie'
  ), cand as (
    select m.id as manual_id, y.id as model_year_id,
           count(*) over (partition by m.id) as n
      from public.wsm_manuals m
      join public.ducati_catalog_model_years y on y.year = m.model_year
      join public.ducati_catalog_models mo on mo.id = y.model_id
      join public.ducati_catalog_families f on f.id = mo.family_id
      left join public.ducati_catalog_supermodels sm on sm.id = mo.supermodel_id
     where m.id not in (select manual_id from deja)
       and public._wsm_norm(f.description) = public._wsm_norm(m.family)
       and public._wsm_norm(coalesce(sm.description, '') || mo.description)
           in (public._wsm_norm(coalesce(m.supermodel, '') || m.model), public._wsm_norm(m.model))
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
    'manualsLinked', (select count(distinct manual_id) from public.wsm_manual_catalog_links where status = 'lie'),
    'manualsUnlinked', (select count(*) from public.wsm_manuals m
                         where not exists (select 1 from public.wsm_manual_catalog_links l
                                            where l.manual_id = m.id and l.status = 'lie')));
end $$;
revoke all on function public.wsm_propose_catalog_links(uuid) from public, anon;
grant execute on function public.wsm_propose_catalog_links(uuid) to authenticated, service_role;

-- Décision prise à l'écran : rattacher ou détacher un manuel de modèles-années du catalogue.
create or replace function public.wsm_link_set(_company uuid, _manual text, _model_year_ids text[], _status text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0;
begin
  if not public._wsm_can_link(_company) then
    raise exception 'Rattachement réservé à un administrateur ou au chef d''atelier' using errcode = '42501';
  end if;
  if _status not in ('lie', 'rejete') then
    raise exception 'Statut invalide' using errcode = '22023';
  end if;

  insert into public.wsm_manual_catalog_links as t (manual_id, model_year_id, status, origin, reason, decided_by, decided_at)
  select _manual, y.id, _status, 'manuel', null, auth.uid(), now()
    from public.ducati_catalog_model_years y
   where y.id = any (coalesce(_model_year_ids, '{}'))
  on conflict (manual_id, model_year_id) do update
    set status = excluded.status, origin = 'manuel', decided_by = excluded.decided_by, decided_at = excluded.decided_at
    where t.status is distinct from excluded.status or t.origin is distinct from 'manuel';
  get diagnostics n = row_count;

  if n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), case when _status = 'lie' then 'wsm_manual_linked' else 'wsm_manual_unlinked' end,
            'wsm_manual', _manual, 'screen', null,
            jsonb_build_object('model_year_ids', to_jsonb(_model_year_ids), 'changed', n));
  end if;
  return n;
end $$;
revoke all on function public.wsm_link_set(uuid, text, text[], text) from public, anon;
grant execute on function public.wsm_link_set(uuid, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Lecture pour l'écran
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

-- Liste des modèles-années couverts, avec le nombre de procédures et l'état du rattachement.
create or replace function public.wsm_manual_list(_family text default null, _q text default null, _limit integer default 500)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._wsm_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(r order by r ->> 'family', (r ->> 'model'), (r ->> 'modelYear')::integer)
      from (
        select jsonb_build_object(
                 'id', m.id, 'family', m.family, 'supermodel', m.supermodel, 'model', m.model,
                 'modelYear', m.model_year, 'servicesCount', m.services_count,
                 'operationsCount', m.operations_count, 'proceduresCount', m.procedures_count,
                 'timesCount', m.times_count, 'gaps', m.gaps,
                 'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name,
                                          'km', s.km, 'mi', s.mi, 'months', s.months,
                                          'firstService', s.first_service) order by s.sort)
                                         from public.wsm_services s where s.manual_id = m.id), '[]'::jsonb),
                 'linkStatus', (select l.status from public.wsm_manual_catalog_links l
                                 where l.manual_id = m.id
                                 order by case l.status when 'lie' then 0 when 'a_valider' then 1 else 2 end limit 1),
                 'modelYearIds', coalesce((select jsonb_agg(l.model_year_id order by l.model_year_id)
                                             from public.wsm_manual_catalog_links l
                                            where l.manual_id = m.id and l.status = 'lie'), '[]'::jsonb)
               ) r
          from public.wsm_manuals m
         where (_family is null or m.family = _family)
           and (_q is null or public._wsm_norm(_q) is null
                or public._wsm_norm(m.family || m.model) like '%' || public._wsm_norm(_q) || '%')
         order by m.family, m.model, m.model_year
         limit greatest(1, least(coalesce(_limit, 500), 2000))
      ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.wsm_manual_list(text, text, integer) from public, anon;
grant execute on function public.wsm_manual_list(text, text, integer) to authenticated, service_role;

-- Programme officiel d'un modèle-année : échéances, opérations, temps, procédures par échéance.
create or replace function public.wsm_manual_overview(_manual text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public._wsm_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'manual', to_jsonb(m) - 'content_hash',
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'km', s.km,
                              'mi', s.mi, 'months', s.months, 'firstService', s.first_service,
                              'definition', s.definition,
                              'ut', (select t.ut from public.wsm_times t
                                      where t.manual_id = m.id and t.service_code = s.code order by t.sort limit 1),
                              'timeText', (select t.time_text from public.wsm_times t
                                            where t.manual_id = m.id and t.service_code = s.code order by t.sort limit 1),
                              'operations', (select count(*) from public.wsm_operations o
                                              where o.manual_id = m.id and s.code = any (o.service_codes)),
                              'procedures', (select count(*) from public.wsm_service_procedures sp
                                              where sp.manual_id = m.id and sp.service_code = s.code))
                            order by s.sort)
                           from public.wsm_services s where s.manual_id = m.id), '[]'::jsonb),
    'operations', coalesce((select jsonb_agg(jsonb_build_object('label', o.label, 'scope', o.scope,
                                'groupLabel', o.group_label, 'serviceCodes', o.service_codes,
                                'periodicityKm', o.periodicity_km, 'periodicityMonths', o.periodicity_months)
                              order by o.scope, o.sort)
                             from public.wsm_operations o where o.manual_id = m.id), '[]'::jsonb),
    'times', coalesce((select jsonb_agg(jsonb_build_object('label', t.label, 'serviceCode', t.service_code,
                            'timeText', t.time_text, 'minutes', t.minutes, 'ut', t.ut) order by t.sort)
                         from public.wsm_times t where t.manual_id = m.id), '[]'::jsonb),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'role', u.role,
                                'steps', p.steps_count, 'figures', p.figures_count, 'torques', p.torques_count,
                                'usages', p.usages_count, 'code', p.source_code, 'version', p.source_version,
                                'updatedAt', p.source_updated_at, 'dmPath', u.dm_path, 'operation', u.operation)
                              order by u.role, u.sort, p.title)
                             from public.wsm_procedure_usages u
                             join public.wsm_procedures p on p.id = u.procedure_id
                            where u.manual_id = m.id), '[]'::jsonb),
    'torqueTables', coalesce((select jsonb_agg(jsonb_build_object('title', r.title, 'lines', r.lines_count,
                                  'code', r.source_code) order by r.sort)
                                from public.wsm_torque_tables r where r.manual_id = m.id), '[]'::jsonb),
    'toolSets', coalesce((select jsonb_agg(jsonb_build_object('title', r.title, 'tools', r.tools_count,
                              'code', r.source_code) order by r.sort)
                            from public.wsm_tool_sets r where r.manual_id = m.id), '[]'::jsonb),
    'fluids', coalesce((select jsonb_agg(jsonb_build_object('title', r.title, 'lines', r.lines,
                            'code', r.source_code) order by r.sort)
                          from public.wsm_fluid_tables r where r.manual_id = m.id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('modelYearId', l.model_year_id, 'status', l.status,
                            'origin', l.origin, 'reason', l.reason,
                            'label', coalesce(y.name, mo.description) || ' ' || y.year) order by l.status, y.year)
                         from public.wsm_manual_catalog_links l
                         join public.ducati_catalog_model_years y on y.id = l.model_year_id
                         join public.ducati_catalog_models mo on mo.id = y.model_id
                        where l.manual_id = m.id), '[]'::jsonb)
  ) into v
    from public.wsm_manuals m
   where m.id = _manual;
  if v is null then
    raise exception 'Manuel introuvable' using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.wsm_manual_overview(text) from public, anon;
grant execute on function public.wsm_manual_overview(text) to authenticated, service_role;
