-- =====================================================================
-- Mission 07, carte 1 — « Plans d'entretien par modèle et par année » (ATE014).
--
-- Plans d'entretien Ducati extraits des documents déposés par Simon le 21/09 (posters
-- « Entretien Transparent », listes des contrôles, bulletins) : plans → échéances →
-- intervalles (km / mois), opérations et temps, chacun avec sa source (fichier, page, édition).
--
-- Décisions M-16 (Simon, 21/09) :
--   * taux horaire atelier HT : prix main-d'œuvre = heures × taux (null tant que le taux est vide) ;
--     le taux est le réglage existant « Frais de devis atelier → diagnostic → hourly_rate_ht »
--     (repli : prix de vente de l'article MO), voir maintenance_hourly_rate_ht ;
--   * le document le plus récent fait foi : l'ancienne valeur reste, status = 'historique' +
--     replaced_by ; la valeur à utiliser a status = 'en_vigueur' ;
--   * échéance au premier atteint (km ou mois), partout (first_reached) ;
--   * plans piste / racing à part, avec un usage (route / piste_amateur / racing).
--
-- Tables GLOBALES (sans company_id), comme le catalogue Ducati (décision M-19) : donnée de
-- référence commune aux deux sociétés. Lecture : comptes de l'équipe (ducati_catalog_is_staff).
-- Écriture : uniquement par maintenance_ingest (chargeur tools/maintenance-loader, clé de
-- service ; ou administrateur). Une ligne events par appel du chargeur, jamais par ligne.
--
-- Idempotent : chaque plan porte l'empreinte de son contenu (content_hash) ; un plan inchangé
-- n'est pas réécrit. Les lignes filles (intervalles, opérations, temps) ont une clé de contenu
-- (row_key) calculée par le chargeur : relancer ne crée aucun doublon.
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_sources (
  id          text primary key,                 -- id de la source dans l'extraction (S00…)
  file_name   text not null,                    -- nom du PDF déposé
  title       text,
  edition     text,                             -- édition imprimée (Éd. 2022, Éd.12/2019…)
  pages       integer,
  sort_key    text,                             -- ordre chronologique des documents (date_tri)
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_maintenance_sources_file on public.maintenance_sources(file_name);

create table if not exists public.maintenance_checklists (
  id              text primary key,             -- id de la liste des contrôles (LC-…)
  title           text not null,
  source_file     text,
  source_page     integer,
  source_edition  text,
  columns         jsonb not null default '[]'::jsonb,   -- colonnes du document → code d'échéance
  footnotes       jsonb not null default '[]'::jsonb,
  note            text,
  updated_at      timestamptz not null default now()
);

create table if not exists public.maintenance_plans (
  id                     text primary key,      -- id stable de l'extraction (mts950_17_21…)
  family                 text not null,         -- famille Ducati (Multistrada, Superbike…)
  model_text             text not null,         -- modèles concernés, texte du document
  year_from              integer,               -- plage d'années (millésimes) ; null = non précisé
  year_to                integer,
  usage                  text not null default 'route'
                         check (usage in ('route', 'piste_amateur', 'racing')),
  checklist_id           text references public.maintenance_checklists(id) on delete set null,
  checklist_history      jsonb not null default '[]'::jsonb,  -- listes remplacées (plus récent fait foi)
  variants               text[] not null default '{}',         -- variantes citées par le document
  match_names            text[] not null default '{}',         -- noms de modèles pour le rattachement au catalogue
  notes                  jsonb not null default '[]'::jsonb,
  own_interval_operations jsonb not null default '[]'::jsonb,  -- opérations à intervalle propre
  source_files           text[] not null default '{}',
  content_hash           text not null,
  loaded_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (year_from is null or year_to is null or year_from <= year_to)
);
create index if not exists idx_maintenance_plans_family on public.maintenance_plans(family);

-- Échéance d'un plan (1 000 km, Oil, Desmo / Valve Check, Annual, opérations supplémentaires…).
create table if not exists public.maintenance_plan_services (
  id               uuid primary key default gen_random_uuid(),
  plan_id          text not null references public.maintenance_plans(id) on delete cascade,
  code             text not null,               -- first_1000, oil, desmo, annual, racing_2500…
  name             text not null,
  doc_names        text[] not null default '{}', -- noms employés dans les documents
  sort             integer not null default 0,
  operations_note  text,
  updated_at       timestamptz not null default now(),
  unique (plan_id, code)
);

-- Intervalle d'une échéance (km au premier entretien, puis tous les N km, ou tous les N mois).
create table if not exists public.maintenance_service_intervals (
  id                    uuid primary key default gen_random_uuid(),
  service_id            uuid not null references public.maintenance_plan_services(id) on delete cascade,
  row_key               text not null,
  km_first              integer,
  km_interval           integer,
  months                integer,
  first_reached         boolean not null default true,   -- décision M-16 : le premier atteint (km ou mois)
  first_reached_origin  text,
  text                  text,                            -- texte du document
  years_doc             text,                            -- années citées par le document (« 17-21 »)
  km_column             integer,                         -- colonne kilométrique (listes piste / racing)
  deduced               text,                            -- ce qui a été interprété
  source_file           text,
  source_page           integer,
  source_edition        text,
  source_sort           text,
  status                text not null check (status in ('en_vigueur', 'historique')),
  replaced_by           text,
  same_value            boolean,
  sort                  integer not null default 0,
  unique (service_id, row_key)
);

-- Opération d'une échéance (texte FR du document).
create table if not exists public.maintenance_service_operations (
  id                   uuid primary key default gen_random_uuid(),
  service_id           uuid not null references public.maintenance_plan_services(id) on delete cascade,
  row_key              text not null,
  n                    integer,                 -- numéro de ligne dans la liste
  text                 text not null,
  periodicity_months   integer,
  periodicity_deduced  text,
  parts_cited          jsonb not null default '[]'::jsonb,  -- désignations seulement (aucune référence)
  remark               text,
  reference_mark       text,                    -- renvoi imprimé (« 12** »)
  source_file          text,
  source_page          integer,
  source_edition       text,
  sort                 integer not null default 0,
  unique (service_id, row_key)
);

-- Temps d'une échéance (barème Ducati), toutes éditions conservées.
create table if not exists public.maintenance_service_times (
  id              uuid primary key default gen_random_uuid(),
  service_id      uuid not null references public.maintenance_plan_services(id) on delete cascade,
  row_key         text not null,
  model_doc       text,                          -- modèle tel qu'imprimé
  years_doc       text,
  service_doc     text,                          -- échéance telle qu'imprimée
  time_text       text,                          -- « 1h:06min (11UT) », « 2,5 »
  hours           numeric(6,2),
  ut              integer,                       -- unités de travail (1 UT = 6 min)
  interval_doc    text,
  note            text,
  deduced         text,
  source_file     text,
  source_page     integer,
  source_edition  text,
  source_sort     text,
  status          text not null check (status in ('en_vigueur', 'historique')),
  replaced_by     text,
  same_value      boolean,
  sort            integer not null default 0,
  unique (service_id, row_key)
);

create index if not exists idx_mp_services_plan on public.maintenance_plan_services(plan_id);
create index if not exists idx_mp_intervals_service on public.maintenance_service_intervals(service_id);
create index if not exists idx_mp_operations_service on public.maintenance_service_operations(service_id);
create index if not exists idx_mp_times_service on public.maintenance_service_times(service_id);

comment on table public.maintenance_plans is 'Plans d''entretien Ducati (mission 07, ATE014) : un plan par modèle, plage d''années et usage. Donnée de référence commune, écrite par maintenance_ingest.';
comment on table public.maintenance_plan_services is 'Échéances d''un plan d''entretien (1 000 km, Oil, Desmo, Annual, opérations supplémentaires, paliers piste/racing).';
comment on table public.maintenance_service_intervals is 'Intervalles km / mois d''une échéance, au premier atteint (M-16). status : en_vigueur (document le plus récent) / historique.';
comment on table public.maintenance_service_operations is 'Opérations d''une échéance (texte du document Ducati, avec sa source).';
comment on table public.maintenance_service_times is 'Temps Ducati d''une échéance (heures, UT), toutes éditions ; status en_vigueur / historique. Prix = heures × taux horaire HT.';

-- ---------------------------------------------------------------------
-- 2. RLS : lecture équipe, aucune écriture directe
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['maintenance_sources', 'maintenance_checklists', 'maintenance_plans',
    'maintenance_plan_services', 'maintenance_service_intervals', 'maintenance_service_operations',
    'maintenance_service_times']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ducati_catalog_is_staff()))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Écriture : chargeur (clé de service) ou administrateur
-- ---------------------------------------------------------------------
create or replace function public._mp_can_write()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is not null and exists (
            select 1 from public.user_roles ur
             where ur.user_id = auth.uid() and ur.role = 'admin' and public.is_admin(ur.company_id)));
$$;
revoke all on function public._mp_can_write() from public, anon, authenticated;

-- Charge un lot de plans (format préparé par tools/maintenance-loader/transform.mjs) :
--   { sources: [...], checklists: [...], plans: [ { id, family, model_text, year_from, year_to, usage,
--       checklist_id, checklist_history, variants, match_names, notes, own_interval_operations,
--       source_files, content_hash,
--       services: [ { code, name, doc_names, sort, operations_note,
--                     intervals: [...], operations: [...], times: [...] } ] } ] }
-- Un plan dont content_hash n'a pas changé n'est pas réécrit (sauf _force).
create or replace function public.maintenance_ingest(_payload jsonb, _force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan jsonb; v_svc jsonb; v_plan_id text; v_svc_id uuid; v_hash text; v_exists boolean;
  n_src integer := 0; n_cl integer := 0; n_new integer := 0; n_upd integer := 0; n_same integer := 0;
  n_svc integer := 0; n_int integer := 0; n_op integer := 0; n_tm integer := 0; n_del integer := 0; k integer;
begin
  if not public._mp_can_write() then
    raise exception 'Chargement des plans d''entretien réservé au chargeur ou à un administrateur' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(_payload -> 'plans', '[]'::jsonb)) <> 'array' then
    raise exception 'Charge invalide (plans attendu)' using errcode = '22023';
  end if;

  insert into public.maintenance_sources as t (id, file_name, title, edition, pages, sort_key, updated_at)
  select x.id, x.file_name, x.title, x.edition, x.pages, x.sort_key, now()
    from jsonb_to_recordset(coalesce(_payload -> 'sources', '[]'::jsonb))
         as x(id text, file_name text, title text, edition text, pages integer, sort_key text)
   where x.id is not null and x.file_name is not null
  on conflict (id) do update set file_name = excluded.file_name, title = excluded.title, edition = excluded.edition,
    pages = excluded.pages, sort_key = excluded.sort_key, updated_at = now()
    where (t.file_name, t.title, t.edition, t.pages, t.sort_key)
      is distinct from (excluded.file_name, excluded.title, excluded.edition, excluded.pages, excluded.sort_key);
  get diagnostics n_src = row_count;

  insert into public.maintenance_checklists as t (id, title, source_file, source_page, source_edition, columns, footnotes, note, updated_at)
  select x.id, coalesce(x.title, x.id), x.source_file, x.source_page, x.source_edition,
         coalesce(x.columns, '[]'::jsonb), coalesce(x.footnotes, '[]'::jsonb), x.note, now()
    from jsonb_to_recordset(coalesce(_payload -> 'checklists', '[]'::jsonb))
         as x(id text, title text, source_file text, source_page integer, source_edition text, columns jsonb, footnotes jsonb, note text)
   where x.id is not null
  on conflict (id) do update set title = excluded.title, source_file = excluded.source_file,
    source_page = excluded.source_page, source_edition = excluded.source_edition, columns = excluded.columns,
    footnotes = excluded.footnotes, note = excluded.note, updated_at = now()
    where (t.title, t.source_file, t.source_page, t.source_edition, t.columns, t.footnotes, t.note)
      is distinct from (excluded.title, excluded.source_file, excluded.source_page, excluded.source_edition, excluded.columns, excluded.footnotes, excluded.note);
  get diagnostics n_cl = row_count;

  for v_plan in select value from jsonb_array_elements(coalesce(_payload -> 'plans', '[]'::jsonb)) loop
    v_plan_id := nullif(btrim(v_plan ->> 'id'), '');
    if v_plan_id is null or nullif(v_plan ->> 'content_hash', '') is null then
      raise exception 'Plan sans id ou sans empreinte' using errcode = '22023';
    end if;
    select p.content_hash into v_hash from public.maintenance_plans p where p.id = v_plan_id;
    v_exists := found;
    if v_exists and v_hash = v_plan ->> 'content_hash' and not coalesce(_force, false) then
      n_same := n_same + 1;
      continue;
    end if;

    insert into public.maintenance_plans as t (id, family, model_text, year_from, year_to, usage, checklist_id,
      checklist_history, variants, match_names, notes, own_interval_operations, source_files, content_hash, loaded_at, updated_at)
    values (v_plan_id, v_plan ->> 'family', v_plan ->> 'model_text',
      (v_plan ->> 'year_from')::integer, (v_plan ->> 'year_to')::integer, coalesce(v_plan ->> 'usage', 'route'),
      nullif(v_plan ->> 'checklist_id', ''),
      coalesce(v_plan -> 'checklist_history', '[]'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_plan -> 'variants', '[]'::jsonb))), '{}'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_plan -> 'match_names', '[]'::jsonb))), '{}'),
      coalesce(v_plan -> 'notes', '[]'::jsonb), coalesce(v_plan -> 'own_interval_operations', '[]'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_plan -> 'source_files', '[]'::jsonb))), '{}'),
      v_plan ->> 'content_hash', now(), now())
    on conflict (id) do update set family = excluded.family, model_text = excluded.model_text,
      year_from = excluded.year_from, year_to = excluded.year_to, usage = excluded.usage,
      checklist_id = excluded.checklist_id, checklist_history = excluded.checklist_history,
      variants = excluded.variants, match_names = excluded.match_names, notes = excluded.notes,
      own_interval_operations = excluded.own_interval_operations, source_files = excluded.source_files,
      content_hash = excluded.content_hash, loaded_at = now(), updated_at = now();
    if v_exists then n_upd := n_upd + 1; else n_new := n_new + 1; end if;

    -- Échéances disparues de la source : retirées (leurs lignes filles suivent).
    delete from public.maintenance_plan_services s
     where s.plan_id = v_plan_id
       and s.code <> all (array(select e ->> 'code' from jsonb_array_elements(coalesce(v_plan -> 'services', '[]'::jsonb)) e));
    get diagnostics k = row_count; n_del := n_del + k;

    for v_svc in select value from jsonb_array_elements(coalesce(v_plan -> 'services', '[]'::jsonb)) loop
      insert into public.maintenance_plan_services as t (plan_id, code, name, doc_names, sort, operations_note, updated_at)
      values (v_plan_id, v_svc ->> 'code', coalesce(v_svc ->> 'name', v_svc ->> 'code'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_svc -> 'doc_names', '[]'::jsonb))), '{}'),
        coalesce((v_svc ->> 'sort')::integer, 0), v_svc ->> 'operations_note', now())
      on conflict (plan_id, code) do update set name = excluded.name, doc_names = excluded.doc_names,
        sort = excluded.sort, operations_note = excluded.operations_note, updated_at = now()
      returning id into v_svc_id;
      n_svc := n_svc + 1;

      -- Intervalles
      delete from public.maintenance_service_intervals r where r.service_id = v_svc_id
         and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_svc -> 'intervals', '[]'::jsonb)) e));
      get diagnostics k = row_count; n_del := n_del + k;
      insert into public.maintenance_service_intervals as t (service_id, row_key, km_first, km_interval, months,
        first_reached, first_reached_origin, text, years_doc, km_column, deduced, source_file, source_page,
        source_edition, source_sort, status, replaced_by, same_value, sort)
      select v_svc_id, x.row_key, x.km_first, x.km_interval, x.months, coalesce(x.first_reached, true),
             x.first_reached_origin, x.text, x.years_doc, x.km_column, x.deduced, x.source_file, x.source_page,
             x.source_edition, x.source_sort, x.status, x.replaced_by, x.same_value, coalesce(x.sort, 0)
        from jsonb_to_recordset(coalesce(v_svc -> 'intervals', '[]'::jsonb)) as x(row_key text, km_first integer,
             km_interval integer, months integer, first_reached boolean, first_reached_origin text, text text,
             years_doc text, km_column integer, deduced text, source_file text, source_page integer,
             source_edition text, source_sort text, status text, replaced_by text, same_value boolean, sort integer)
      on conflict (service_id, row_key) do update set sort = excluded.sort, source_sort = excluded.source_sort
        where (t.sort, t.source_sort) is distinct from (excluded.sort, excluded.source_sort);
      n_int := n_int + jsonb_array_length(coalesce(v_svc -> 'intervals', '[]'::jsonb));

      -- Opérations
      delete from public.maintenance_service_operations r where r.service_id = v_svc_id
         and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_svc -> 'operations', '[]'::jsonb)) e));
      get diagnostics k = row_count; n_del := n_del + k;
      insert into public.maintenance_service_operations as t (service_id, row_key, n, text, periodicity_months,
        periodicity_deduced, parts_cited, remark, reference_mark, source_file, source_page, source_edition, sort)
      select v_svc_id, x.row_key, x.n, x.text, x.periodicity_months, x.periodicity_deduced,
             coalesce(x.parts_cited, '[]'::jsonb), x.remark, x.reference_mark, x.source_file, x.source_page,
             x.source_edition, coalesce(x.sort, 0)
        from jsonb_to_recordset(coalesce(v_svc -> 'operations', '[]'::jsonb)) as x(row_key text, n integer, text text,
             periodicity_months integer, periodicity_deduced text, parts_cited jsonb, remark text, reference_mark text,
             source_file text, source_page integer, source_edition text, sort integer)
      on conflict (service_id, row_key) do update set sort = excluded.sort
        where t.sort is distinct from excluded.sort;
      n_op := n_op + jsonb_array_length(coalesce(v_svc -> 'operations', '[]'::jsonb));

      -- Temps
      delete from public.maintenance_service_times r where r.service_id = v_svc_id
         and r.row_key <> all (array(select e ->> 'row_key' from jsonb_array_elements(coalesce(v_svc -> 'times', '[]'::jsonb)) e));
      get diagnostics k = row_count; n_del := n_del + k;
      insert into public.maintenance_service_times as t (service_id, row_key, model_doc, years_doc, service_doc,
        time_text, hours, ut, interval_doc, note, deduced, source_file, source_page, source_edition, source_sort,
        status, replaced_by, same_value, sort)
      select v_svc_id, x.row_key, x.model_doc, x.years_doc, x.service_doc, x.time_text, x.hours, x.ut,
             x.interval_doc, x.note, x.deduced, x.source_file, x.source_page, x.source_edition, x.source_sort,
             x.status, x.replaced_by, x.same_value, coalesce(x.sort, 0)
        from jsonb_to_recordset(coalesce(v_svc -> 'times', '[]'::jsonb)) as x(row_key text, model_doc text,
             years_doc text, service_doc text, time_text text, hours numeric, ut integer, interval_doc text,
             note text, deduced text, source_file text, source_page integer, source_edition text, source_sort text,
             status text, replaced_by text, same_value boolean, sort integer)
      on conflict (service_id, row_key) do update set sort = excluded.sort, source_sort = excluded.source_sort
        where (t.sort, t.source_sort) is distinct from (excluded.sort, excluded.source_sort);
      n_tm := n_tm + jsonb_array_length(coalesce(v_svc -> 'times', '[]'::jsonb));
    end loop;
  end loop;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, auth.uid(), 'maintenance_plans_loaded', 'maintenance_plans', nullif(_payload ->> 'run', ''), 'import', null,
          jsonb_build_object('files', _payload -> 'files', 'plans_new', n_new, 'plans_updated', n_upd,
                             'plans_unchanged', n_same, 'services', n_svc, 'intervals', n_int,
                             'operations', n_op, 'times', n_tm, 'rows_removed', n_del));

  return jsonb_build_object('sources', n_src, 'checklists', n_cl, 'plans_new', n_new, 'plans_updated', n_upd,
    'plans_unchanged', n_same, 'services', n_svc, 'intervals', n_int, 'operations', n_op, 'times', n_tm,
    'rows_removed', n_del);
end $$;
revoke all on function public.maintenance_ingest(jsonb, boolean) from public, anon;
grant execute on function public.maintenance_ingest(jsonb, boolean) to authenticated, service_role;

-- Compteurs (écran et chargeur).
create or replace function public.maintenance_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.ducati_catalog_is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'plans', (select count(*) from public.maintenance_plans),
    'plansByUsage', (select coalesce(jsonb_object_agg(usage, n), '{}'::jsonb) from (select usage, count(*) n from public.maintenance_plans group by usage) u),
    'services', (select count(*) from public.maintenance_plan_services),
    'intervals', (select count(*) from public.maintenance_service_intervals),
    'intervalsCurrent', (select count(*) from public.maintenance_service_intervals where status = 'en_vigueur'),
    'operations', (select count(*) from public.maintenance_service_operations),
    'times', (select count(*) from public.maintenance_service_times),
    'timesCurrent', (select count(*) from public.maintenance_service_times where status = 'en_vigueur'),
    'checklists', (select count(*) from public.maintenance_checklists),
    'sources', (select count(*) from public.maintenance_sources),
    'lastLoadedAt', (select max(loaded_at) from public.maintenance_plans)
  );
end $$;
revoke all on function public.maintenance_stats() from public, anon;
grant execute on function public.maintenance_stats() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Taux horaire atelier HT (réglage existant, M-16)
-- « Paramètres → Tables → Frais de devis atelier », code diagnostic, hourly_rate_ht ;
-- 0 ou vide → prix de vente HT de l'article MO (type T) ; toujours 0 → null (taux à saisir).
-- Même règle que src/modules/workshop/quote-fees.ts (resolveQuoteFeeParams).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_hourly_rate_ht(_company uuid)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  select public._dc_num(rv.extra -> 'hourly_rate_ht') into v
    from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'workshop_quote_fee' and rv.code = 'diagnostic'
     and coalesce(rv.is_active, true)
   limit 1;
  if v is null or v <= 0 then
    select a.sale_price_ht into v from public.articles a
     where a.company_id = _company and a.reference = 'MO' and a.mgmt_type = 'T'
     order by a.created_at limit 1;
  end if;
  return case when v is null or v <= 0 then null else v end;
end $$;
revoke all on function public.maintenance_hourly_rate_ht(uuid) from public, anon;
grant execute on function public.maintenance_hourly_rate_ht(uuid) to authenticated;
