-- =====================================================================
-- Mission 06, carte 2 — « Importer les modèles Ducati par année ».
--
-- Catalogue Ducati (e-catalog, EPC) : familles → cylindrées → modèles → modèle-années,
-- plus le suivi des lots d'import. Les données sont lues par l'extension Chrome avec la
-- session Ducati de l'utilisateur, transmises à l'onglet du DMS, puis écrites par les
-- fonctions ci-dessous sous la session DMS de l'utilisateur (même principe que My Ducati).
--
-- Tables GLOBALES (sans company_id), exception assumée comme ducati_vds : le catalogue Ducati
-- est une donnée de référence commune à toutes les sociétés (le stocker par société le
-- dupliquerait sans rien apporter). RLS :
--   * lecture : comptes de l'équipe (au moins un rôle dans user_roles) ; les comptes clients
--     (portail, sans rôle) et anon ne lisent rien ;
--   * écriture : AUCUNE politique ; uniquement par les fonctions d'import (security definer),
--     réservées à un administrateur de la société qui lance le lot.
--
-- Décisions M-15 (21/09) : Europe seulement, millésimes depuis 2000. Le filtre est appliqué par
-- l'extension (liste modifiable montrée avant de lancer) ; la base garde l'indicateur is_europe
-- et le marché déduit du nom pour pouvoir élargir plus tard.
--
-- Traçabilité : une ligne events par étape de LOT (démarrage, arbre reçu, pause, reprise,
-- arrêt, erreur, fin), jamais par ligne importée.
--
-- Additif uniquement. Aucune donnée écrite par la migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Aides
-- ---------------------------------------------------------------------

-- Compte de l'équipe : au moins un rôle dans une société (les comptes clients n'en ont pas).
create or replace function public.ducati_catalog_is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid());
$$;
revoke all on function public.ducati_catalog_is_staff() from public, anon;
grant execute on function public.ducati_catalog_is_staff() to authenticated, service_role;

-- Valeur JSON → texte (chaîne telle quelle, nombre/booléen en texte, objet/tableau en JSON).
create or replace function public._dc_txt(_v jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when _v is null or jsonb_typeof(_v) = 'null' then null
    when jsonb_typeof(_v) = 'string' then nullif(btrim(_v #>> '{}'), '')
    else _v::text
  end;
$$;

-- Valeur JSON → entier (null si illisible).
create or replace function public._dc_int(_v jsonb)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case
    when public._dc_txt(_v) ~ '^-?\d{1,9}$' then public._dc_txt(_v)::integer
    else null
  end;
$$;

-- Valeur JSON → numérique (accepte « 12,50 » et « 1.234,50 » ; null si illisible).
create or replace function public._dc_num(_v jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := replace(coalesce(public._dc_txt(_v), ''), ' ', '');
begin
  if s = '' then return null; end if;
  if s ~ ',' and s ~ '\.' then s := replace(s, '.', ''); end if;  -- 1.234,50
  s := replace(s, ',', '.');
  if s !~ '^-?\d+(\.\d+)?$' then return null; end if;
  return s::numeric;
end $$;

-- Valeur JSON → booléen (true/false, « true », 1/0 ; null si illisible).
create or replace function public._dc_bool(_v jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case lower(coalesce(public._dc_txt(_v), ''))
    when 'true' then true when '1' then true when 'false' then false when '0' then false
    else null end;
$$;

revoke all on function public._dc_txt(jsonb) from public, anon, authenticated;
revoke all on function public._dc_int(jsonb) from public, anon, authenticated;
revoke all on function public._dc_num(jsonb) from public, anon, authenticated;
revoke all on function public._dc_bool(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Arbre des modèles (identifiants Ducati en texte)
-- ---------------------------------------------------------------------
create table if not exists public.ducati_catalog_families (
  id          text primary key,              -- id Ducati de la famille
  description text not null,
  sort        integer,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ducati_catalog_supermodels (
  id          text primary key,              -- id Ducati de la cylindrée (« superModel »)
  family_id   text not null references public.ducati_catalog_families(id),
  description text not null,
  sort        integer,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_dc_supermodels_family on public.ducati_catalog_supermodels(family_id);

create table if not exists public.ducati_catalog_models (
  id            text primary key,            -- id Ducati du modèle (variante de marché)
  family_id     text not null references public.ducati_catalog_families(id),
  supermodel_id text not null references public.ducati_catalog_supermodels(id),
  description   text not null,               -- ex. « ICON 2G », « ICON 2G USA »
  market        text not null default 'EU',  -- marché déduit du nom (EU, USA, THAILAND…)
  is_europe     boolean not null default true,
  sort          integer,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_dc_models_supermodel on public.ducati_catalog_models(supermodel_id);
create index if not exists idx_dc_models_family on public.ducati_catalog_models(family_id);

create table if not exists public.ducati_catalog_model_years (
  id          text primary key,              -- id Ducati du modèle-année (modelYear)
  model_id    text not null references public.ducati_catalog_models(id),
  code        text,                          -- code Ducati de la variante
  year        integer,                       -- millésime
  path        text,                          -- chemin Ducati (tel que fourni)
  sort        integer,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_dc_model_years_model on public.ducati_catalog_model_years(model_id);
create index if not exists idx_dc_model_years_year on public.ducati_catalog_model_years(year);

comment on table public.ducati_catalog_families is 'Catalogue Ducati (e-catalog) : familles. Donnée de référence commune, écrite par ducati_catalog_ingest_tree.';
comment on table public.ducati_catalog_models is 'Catalogue Ducati : modèles (une ligne par variante de marché). is_europe/market déduits du nom par l''extension (décision M-15).';
comment on table public.ducati_catalog_model_years is 'Catalogue Ducati : modèle-années (variante + millésime).';

-- ---------------------------------------------------------------------
-- 2. Lots d'import
-- ---------------------------------------------------------------------
create table if not exists public.ducati_catalog_import_batches (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references public.companies(id) on delete set null, -- société active de celui qui lance (pour events)
  started_by         uuid references auth.users(id) on delete set null,
  started_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),   -- dernière activité
  finished_at        timestamptz,
  status             text not null default 'running'
                     check (status in ('running', 'paused', 'stopped', 'error', 'done')),
  scope              jsonb not null default '{}'::jsonb,   -- résumé du périmètre choisi (familles, filtres, délai)
  model_years_total  integer not null default 0,
  model_years_done   integer not null default 0,
  drawings_imported  integer not null default 0,
  drawings_skipped   integer not null default 0,           -- déjà connues : non relues
  lines_imported     integer not null default 0,
  requests_count     integer not null default 0,           -- appels à l'e-catalog (déclaré par l'extension)
  last_position      jsonb,                                -- dernière position (reprise)
  last_error         text
);
create index if not exists idx_dc_batches_started on public.ducati_catalog_import_batches(started_at desc);

comment on table public.ducati_catalog_import_batches is 'Lots d''import du catalogue Ducati par l''extension : qui, quand, état, compteurs, dernière position.';

-- ---------------------------------------------------------------------
-- 3. RLS : lecture équipe, aucune écriture directe
-- ---------------------------------------------------------------------
alter table public.ducati_catalog_families enable row level security;
alter table public.ducati_catalog_supermodels enable row level security;
alter table public.ducati_catalog_models enable row level security;
alter table public.ducati_catalog_model_years enable row level security;
alter table public.ducati_catalog_import_batches enable row level security;

drop policy if exists dc_families_read on public.ducati_catalog_families;
create policy dc_families_read on public.ducati_catalog_families
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_supermodels_read on public.ducati_catalog_supermodels;
create policy dc_supermodels_read on public.ducati_catalog_supermodels
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_models_read on public.ducati_catalog_models;
create policy dc_models_read on public.ducati_catalog_models
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_model_years_read on public.ducati_catalog_model_years;
create policy dc_model_years_read on public.ducati_catalog_model_years
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_batches_read on public.ducati_catalog_import_batches;
create policy dc_batches_read on public.ducati_catalog_import_batches
  for select to authenticated using ((select public.ducati_catalog_is_staff()));

revoke all on public.ducati_catalog_families from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_families from authenticated;
revoke all on public.ducati_catalog_supermodels from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_supermodels from authenticated;
revoke all on public.ducati_catalog_models from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_models from authenticated;
revoke all on public.ducati_catalog_model_years from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_model_years from authenticated;
revoke all on public.ducati_catalog_import_batches from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_import_batches from authenticated;

-- ---------------------------------------------------------------------
-- 4. Lots : démarrer, contrôler, faire avancer
-- ---------------------------------------------------------------------

-- Contrôle commun : le lot existe, appartient à l'appelant, qui est admin de sa société,
-- et n'est pas clos. Renvoie la ligne du lot.
create or replace function public._dc_batch_guard(_batch uuid)
returns public.ducati_catalog_import_batches
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.ducati_catalog_import_batches;
begin
  select * into b from public.ducati_catalog_import_batches where id = _batch;
  if not found then
    raise exception 'Lot d''import introuvable' using errcode = 'P0002';
  end if;
  if auth.uid() is null or b.started_by is distinct from auth.uid()
     or b.company_id is null or not public.is_admin(b.company_id) then
    raise exception 'Accès refusé au lot d''import' using errcode = '42501';
  end if;
  if b.status in ('done', 'stopped') then
    raise exception 'Lot d''import clos (%)', b.status using errcode = '55000';
  end if;
  return b;
end $$;
revoke all on function public._dc_batch_guard(uuid) from public, anon, authenticated;

-- Démarre un lot. Réservé à un administrateur de la société active.
create or replace function public.ducati_catalog_batch_start(_company uuid, _scope jsonb, _model_years_total integer)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or _company is null or not public.is_admin(_company) then
    raise exception 'Import du catalogue réservé aux administrateurs' using errcode = '42501';
  end if;
  insert into public.ducati_catalog_import_batches (company_id, started_by, scope, model_years_total)
  values (_company, auth.uid(), coalesce(_scope, '{}'::jsonb), greatest(coalesce(_model_years_total, 0), 0))
  returning id into v_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'catalog_import_started', 'ducati_catalog_import', v_id::text, 'import', null,
          jsonb_build_object('scope', coalesce(_scope, '{}'::jsonb), 'model_years_total', _model_years_total));
  return v_id;
end $$;
revoke all on function public.ducati_catalog_batch_start(uuid, jsonb, integer) from public, anon;
grant execute on function public.ducati_catalog_batch_start(uuid, jsonb, integer) to authenticated;

-- Avancement déclaré par l'extension : état, position de reprise, compteurs côté extension.
-- Une ligne events à chaque CHANGEMENT d'état (pause, reprise, arrêt, erreur, fin).
create or replace function public.ducati_catalog_batch_progress(
  _batch uuid, _status text, _position jsonb default null, _counters jsonb default null, _error text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  v_status text := coalesce(nullif(btrim(_status), ''), 'running');
begin
  b := public._dc_batch_guard(_batch);
  if v_status not in ('running', 'paused', 'stopped', 'error', 'done') then
    raise exception 'État de lot inconnu : %', v_status using errcode = '22023';
  end if;

  update public.ducati_catalog_import_batches set
    status = v_status,
    updated_at = now(),
    finished_at = case when v_status in ('done', 'stopped') then now() else null end,
    last_position = coalesce(_position, last_position),
    last_error = case when v_status = 'error' then left(coalesce(_error, last_error), 2000)
                      when v_status = 'running' then null else coalesce(_error, last_error) end,
    requests_count = greatest(requests_count, coalesce(public._dc_int(_counters -> 'requests'), requests_count)),
    model_years_total = greatest(model_years_total, coalesce(public._dc_int(_counters -> 'model_years_total'), 0))
  where id = _batch;

  if b.status is distinct from v_status then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (b.company_id, auth.uid(),
            case v_status when 'running' then 'catalog_import_resumed' when 'paused' then 'catalog_import_paused'
                          when 'stopped' then 'catalog_import_stopped' when 'error' then 'catalog_import_error'
                          else 'catalog_import_done' end,
            'ducati_catalog_import', _batch::text, 'import',
            jsonb_build_object('status', b.status),
            jsonb_build_object('status', v_status, 'error', _error, 'position', _position,
                               'drawings_imported', b.drawings_imported, 'lines_imported', b.lines_imported,
                               'model_years_done', b.model_years_done));
  end if;
end $$;
revoke all on function public.ducati_catalog_batch_progress(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.ducati_catalog_batch_progress(uuid, text, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Arbre des modèles : upsert idempotent par id Ducati
-- Charge (normalisée par l'extension) :
--   { families: [ { id, description, superModels: [ { id, description,
--       models: [ { id, description, market, isEurope, modelYears: [ { id, code, year, path } ] } ] } ] } ] }
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_ingest_tree(_batch uuid, _tree jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  n_f integer; n_s integer; n_m integer; n_y integer;
begin
  b := public._dc_batch_guard(_batch);
  if jsonb_typeof(_tree -> 'families') is distinct from 'array' then
    raise exception 'Arbre du catalogue invalide (families attendu)' using errcode = '22023';
  end if;

  drop table if exists _dc_f, _dc_s, _dc_m;
  create temp table _dc_f on commit drop as
    select public._dc_txt(f.v -> 'id') as id, public._dc_txt(f.v -> 'description') as description,
           f.o::integer as sort, f.v as v
      from jsonb_array_elements(_tree -> 'families') with ordinality f(v, o)
     where public._dc_txt(f.v -> 'id') is not null;

  create temp table _dc_s on commit drop as
    select public._dc_txt(s.v -> 'id') as id, f.id as family_id,
           coalesce(public._dc_txt(s.v -> 'description'), public._dc_txt(s.v -> 'id')) as description,
           s.o::integer as sort, s.v as v
      from _dc_f f, jsonb_array_elements(coalesce(f.v -> 'superModels', '[]'::jsonb)) with ordinality s(v, o)
     where public._dc_txt(s.v -> 'id') is not null;

  create temp table _dc_m on commit drop as
    select public._dc_txt(m.v -> 'id') as id, s.family_id, s.id as supermodel_id,
           coalesce(public._dc_txt(m.v -> 'description'), public._dc_txt(m.v -> 'id')) as description,
           coalesce(upper(public._dc_txt(m.v -> 'market')), 'EU') as market,
           coalesce(public._dc_bool(m.v -> 'isEurope'), true) as is_europe,
           m.o::integer as sort, m.v as v
      from _dc_s s, jsonb_array_elements(coalesce(s.v -> 'models', '[]'::jsonb)) with ordinality m(v, o)
     where public._dc_txt(m.v -> 'id') is not null;

  insert into public.ducati_catalog_families as t (id, description, sort, updated_at)
  select distinct on (id) id, coalesce(description, id), sort, now() from _dc_f order by id, sort
  on conflict (id) do update set description = excluded.description, sort = excluded.sort, updated_at = now()
    where (t.description, t.sort) is distinct from (excluded.description, excluded.sort);
  get diagnostics n_f = row_count;

  insert into public.ducati_catalog_supermodels as t (id, family_id, description, sort, updated_at)
  select distinct on (id) id, family_id, description, sort, now() from _dc_s order by id, sort
  on conflict (id) do update set family_id = excluded.family_id, description = excluded.description,
    sort = excluded.sort, updated_at = now()
    where (t.family_id, t.description, t.sort) is distinct from (excluded.family_id, excluded.description, excluded.sort);
  get diagnostics n_s = row_count;

  insert into public.ducati_catalog_models as t (id, family_id, supermodel_id, description, market, is_europe, sort, updated_at)
  select distinct on (id) id, family_id, supermodel_id, description, market, is_europe, sort, now() from _dc_m order by id, sort
  on conflict (id) do update set family_id = excluded.family_id, supermodel_id = excluded.supermodel_id,
    description = excluded.description, market = excluded.market, is_europe = excluded.is_europe,
    sort = excluded.sort, updated_at = now()
    where (t.family_id, t.supermodel_id, t.description, t.market, t.is_europe, t.sort)
      is distinct from (excluded.family_id, excluded.supermodel_id, excluded.description, excluded.market, excluded.is_europe, excluded.sort);
  get diagnostics n_m = row_count;

  insert into public.ducati_catalog_model_years as t (id, model_id, code, year, path, sort, updated_at)
  select distinct on (y.id) y.id, y.model_id, y.code, y.year, y.path, y.sort, now()
    from (
      select public._dc_txt(y.v -> 'id') as id, m.id as model_id, public._dc_txt(y.v -> 'code') as code,
             coalesce(public._dc_int(y.v -> 'year'), (substring(public._dc_txt(y.v -> 'year') from '(\d{4})'))::integer) as year,
             public._dc_txt(y.v -> 'path') as path, y.o::integer as sort
        from _dc_m m, jsonb_array_elements(coalesce(m.v -> 'modelYears', '[]'::jsonb)) with ordinality y(v, o)
       where public._dc_txt(y.v -> 'id') is not null
    ) y
   order by y.id, y.sort
  on conflict (id) do update set model_id = excluded.model_id, code = excluded.code, year = excluded.year,
    path = excluded.path, sort = excluded.sort, updated_at = now()
    where (t.model_id, t.code, t.year, t.path, t.sort)
      is distinct from (excluded.model_id, excluded.code, excluded.year, excluded.path, excluded.sort);
  get diagnostics n_y = row_count;

  update public.ducati_catalog_import_batches set updated_at = now() where id = _batch;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'catalog_tree_imported', 'ducati_catalog_import', _batch::text, 'import', null,
          jsonb_build_object('families', (select count(*) from _dc_f), 'supermodels', (select count(*) from _dc_s),
                             'models', (select count(*) from _dc_m), 'changed_model_years', n_y));

  return jsonb_build_object('families', n_f, 'supermodels', n_s, 'models', n_m, 'model_years', n_y);
end $$;
revoke all on function public.ducati_catalog_ingest_tree(uuid, jsonb) from public, anon;
grant execute on function public.ducati_catalog_ingest_tree(uuid, jsonb) to authenticated;
