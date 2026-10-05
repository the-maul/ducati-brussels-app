-- Mission 06, carte 6 — « Tenir le catalogue à jour ».
--
-- Ce que cette migration apporte :
--   1. Un JOURNAL DES CHANGEMENTS (`ducati_catalog_changes`) : à chaque passage, ce qui est
--      nouveau ou modifié est écrit ligne par ligne — nouvelle référence, référence remplacée,
--      prix changé, planche nouvelle ou modifiée, nouveau modèle-année. C'est ce journal qui
--      alimente l'écran « Mise à jour » (« ce qui a changé au dernier passage »).
--   2. Une RELECTURE CIBLÉE : `ducati_catalog_ingest_model_year` reçoit `_refresh_before`.
--      Jusqu'ici une planche dont les pièces étaient déjà connues n'était JAMAIS relue : aucun
--      remplacement ni changement de prix ne pouvait donc être détecté. Avec `_refresh_before`,
--      les planches lues avant cette date sont redemandées, les autres restent sautées —
--      « sans tout recharger ».
--   3. Une DEMANDE DE MISE À JOUR (`ducati_catalog_update_requests`) : le bouton
--      « Mettre à jour » du DMS *arme* un plan (quels modèles-années relire, à partir de quelle
--      date). Le DMS n'appelle JAMAIS Ducati : c'est l'extension, avec la session Chrome de
--      l'utilisateur, qui lit l'e-catalog et dépose les données. Le plan lui est simplement
--      remis quand elle se présente (`ducati_catalog_import_state`).
--   4. Correction : `replaced`, `replaced_part` et `replacement_tree` ne pouvaient plus jamais
--      revenir en arrière (`coalesce(excluded.x, t.x)`). Une pièce qui cessait d'être remplacée
--      restait marquée remplacée à vie. Ces trois colonnes suivent désormais le catalogue.
--
-- Additive. Aucune donnée de catalogue n'est supprimée ni réécrite par la migration elle-même.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Journal des changements
-- ---------------------------------------------------------------------------------------------

create table if not exists public.ducati_catalog_changes (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.ducati_catalog_import_batches(id) on delete cascade,
  -- model_year_new | drawing_new | drawing_changed | part_new | part_replaced | part_unreplaced | part_price
  kind        text not null,
  -- identifiant Ducati (modèle-année, planche) ou référence normalisée (pièce)
  key         text not null,
  label       text,
  detail      jsonb,
  seen_at     timestamptz not null default now()
);

comment on table public.ducati_catalog_changes is
  'Mission 06 carte 6 : ce qui a changé à chaque passage d''import du catalogue Ducati. Lecture équipe, écriture par les fonctions d''import seulement.';

create index if not exists idx_dc_changes_batch on public.ducati_catalog_changes (batch_id, kind);
create index if not exists idx_dc_changes_seen  on public.ducati_catalog_changes (seen_at desc);
create index if not exists idx_dc_changes_kind  on public.ducati_catalog_changes (kind, seen_at desc);

alter table public.ducati_catalog_changes enable row level security;

drop policy if exists dc_changes_read on public.ducati_catalog_changes;
create policy dc_changes_read on public.ducati_catalog_changes
  for select to authenticated using (public.ducati_catalog_is_staff());

revoke insert, update, delete, truncate on public.ducati_catalog_changes from authenticated;

-- Compteurs de changements sur le lot, pour l'écran sans parcourir le journal.
alter table public.ducati_catalog_import_batches
  add column if not exists model_years_new      integer not null default 0,
  add column if not exists drawings_new         integer not null default 0,
  add column if not exists drawings_changed     integer not null default 0,
  add column if not exists parts_new            integer not null default 0,
  add column if not exists parts_replaced       integer not null default 0,
  add column if not exists parts_price_changed  integer not null default 0;

-- Les références remplacées se comptent souvent : index partiel.
create index if not exists idx_dc_parts_replaced on public.ducati_catalog_parts (updated_at desc) where replaced;

-- ---------------------------------------------------------------------------------------------
-- 2. Demandes de mise à jour (le plan armé par le bouton du DMS)
-- ---------------------------------------------------------------------------------------------

create table if not exists public.ducati_catalog_update_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  requested_by  uuid references auth.users(id) on delete set null,
  requested_at  timestamptz not null default now(),
  -- { mode:'update', staleDays:n, refreshBefore:'...', modelYears:[...], counts:{...} }
  plan          jsonb not null,
  consumed_at   timestamptz,
  batch_id      uuid references public.ducati_catalog_import_batches(id) on delete set null,
  cancelled_at  timestamptz
);

comment on table public.ducati_catalog_update_requests is
  'Mission 06 carte 6 : mise à jour demandée depuis le DMS. Le DMS n''appelle pas Ducati ; l''extension vient chercher ce plan.';

create index if not exists idx_dc_update_req_open on public.ducati_catalog_update_requests (requested_at desc)
  where consumed_at is null and cancelled_at is null;

alter table public.ducati_catalog_update_requests enable row level security;

drop policy if exists dc_update_req_read on public.ducati_catalog_update_requests;
create policy dc_update_req_read on public.ducati_catalog_update_requests
  for select to authenticated using (public.ducati_catalog_is_staff());

revoke insert, update, delete, truncate on public.ducati_catalog_update_requests from authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Le plan : que faut-il relire ?
-- ---------------------------------------------------------------------------------------------

-- Modèles-années à relire en priorité : jamais lus, incomplets, ou lus avant `_refresh_before`.
-- Un modèle-année porté par une moto du parc passe devant (c'est celui dont l'atelier a besoin).
create or replace function public.ducati_catalog_update_plan(_stale_days integer default 30, _limit integer default 400)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_before timestamptz;
  v_rows jsonb;
  v_never integer; v_incomplete integer; v_stale integer; v_owned integer;
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v_before := now() - make_interval(days => greatest(coalesce(_stale_days, 30), 0));

  with my as (
    select y.id, y.year, y.groups_loaded_at, y.complete_at, m.description as model_description,
           f.description as family_description,
           exists (select 1 from public.vehicles v where v.ducati_model_year_id = y.id) as owned,
           (select min(d.parts_loaded_at)
              from public.ducati_catalog_model_year_drawings x
              join public.ducati_catalog_drawings d on d.id = x.drawing_id
             where x.model_year_id = y.id) as oldest_parts_at
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
      left join public.ducati_catalog_families f on f.id = m.family_id
     where m.is_europe
  ), scored as (
    select my.*,
           case
             when groups_loaded_at is null then 'never'
             when complete_at is null then 'incomplete'
             when oldest_parts_at is null or oldest_parts_at < v_before then 'stale'
           end as reason
      from my
  ), kept as (
    select * from scored where reason is not null
     order by (reason = 'never') desc, owned desc, year desc nulls last
     limit greatest(coalesce(_limit, 400), 1)
  )
  -- Les lignes à relire ET les totaux sur l'ensemble, en une seule requête (une CTE ne
  -- survit pas à l'instruction qui la déclare).
  select (select coalesce(jsonb_agg(jsonb_build_object(
                   'modelYearId', k.id, 'year', k.year, 'model', k.model_description,
                   'family', k.family_description, 'reason', k.reason, 'owned', k.owned)), '[]'::jsonb)
            from kept k),
         count(*) filter (where scored.reason = 'never'),
         count(*) filter (where scored.reason = 'incomplete'),
         count(*) filter (where scored.reason = 'stale'),
         count(*) filter (where scored.reason is not null and scored.owned)
    into v_rows, v_never, v_incomplete, v_stale, v_owned
    from scored;

  return jsonb_build_object(
    'mode', 'update',
    'staleDays', greatest(coalesce(_stale_days, 30), 0),
    'refreshBefore', v_before,
    'modelYears', v_rows,
    'counts', jsonb_build_object(
      'never', coalesce(v_never, 0), 'incomplete', coalesce(v_incomplete, 0),
      'stale', coalesce(v_stale, 0), 'owned', coalesce(v_owned, 0),
      'listed', jsonb_array_length(v_rows),
      'total', coalesce(v_never, 0) + coalesce(v_incomplete, 0) + coalesce(v_stale, 0)));
end $$;

revoke all on function public.ducati_catalog_update_plan(integer, integer) from public, anon;
grant execute on function public.ducati_catalog_update_plan(integer, integer) to authenticated;

-- Armer une mise à jour (bouton « Mettre à jour »). Administrateur de la société seulement.
create or replace function public.ducati_catalog_update_request(_company uuid, _stale_days integer default 30)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan jsonb; v_id uuid;
begin
  if auth.uid() is null or not public.is_admin(_company) then
    raise exception 'Mise à jour réservée aux administrateurs du DMS' using errcode = '42501';
  end if;
  v_plan := public.ducati_catalog_update_plan(_stale_days, 400);

  -- Une seule demande ouverte à la fois : la précédente est remplacée.
  update public.ducati_catalog_update_requests
     set cancelled_at = now()
   where consumed_at is null and cancelled_at is null;

  insert into public.ducati_catalog_update_requests (company_id, requested_by, plan)
  values (_company, auth.uid(), v_plan)
  returning id into v_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'catalog_update_requested', 'ducati_catalog_update', v_id::text, 'import', null,
          jsonb_build_object('staleDays', v_plan -> 'staleDays', 'counts', v_plan -> 'counts'));

  return jsonb_build_object('id', v_id, 'plan', v_plan);
end $$;

revoke all on function public.ducati_catalog_update_request(uuid, integer) from public, anon;
grant execute on function public.ducati_catalog_update_request(uuid, integer) to authenticated;

-- Annuler la demande ouverte (bouton « Annuler la mise à jour »).
create or replace function public.ducati_catalog_update_cancel(_company uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if auth.uid() is null or not public.is_admin(_company) then
    raise exception 'Mise à jour réservée aux administrateurs du DMS' using errcode = '42501';
  end if;
  update public.ducati_catalog_update_requests set cancelled_at = now()
   where consumed_at is null and cancelled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ducati_catalog_update_cancel(uuid) from public, anon;
grant execute on function public.ducati_catalog_update_cancel(uuid) to authenticated;

-- La demande ouverte, telle que l'extension (ou le chargeur) la reçoit.
create or replace function public.ducati_catalog_update_pending()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.ducati_catalog_update_requests;
begin
  if not (public.ducati_catalog_is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  -- Le plan reste vivant tant que le lot qui l'a pris en charge tourne : c'est lui qui donne
  -- sa date de relecture à chaque modèle-année du passage.
  select * into r from public.ducati_catalog_update_requests rq
   where rq.cancelled_at is null
     and (rq.consumed_at is null
          or exists (select 1 from public.ducati_catalog_import_batches b
                      where b.id = rq.batch_id and b.status in ('running', 'paused')))
   order by rq.requested_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'requestedAt', r.requested_at, 'plan', r.plan,
                            'batchId', r.batch_id, 'consumedAt', r.consumed_at);
end $$;

revoke all on function public.ducati_catalog_update_pending() from public, anon;
grant execute on function public.ducati_catalog_update_pending() to authenticated, service_role;

-- Marquer la demande comme prise en charge par un lot d'import.
create or replace function public.ducati_catalog_update_consume(_request uuid, _batch uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._dc_batch_guard(_batch);
  update public.ducati_catalog_update_requests
     set consumed_at = coalesce(consumed_at, now()), batch_id = coalesce(batch_id, _batch)
   where id = _request and cancelled_at is null;
end $$;

revoke all on function public.ducati_catalog_update_consume(uuid, uuid) from public, anon;
grant execute on function public.ducati_catalog_update_consume(uuid, uuid) to authenticated, service_role;

-- `ducati_catalog_import_state` remet aussi le plan armé : c'est ainsi que l'extension
-- apprend quoi relire, sans que le DMS appelle Ducati.
create or replace function public.ducati_catalog_import_state()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'completeModelYears', coalesce((select jsonb_agg(id) from public.ducati_catalog_model_years where complete_at is not null), '[]'::jsonb),
    'drawingsWithParts', (select count(*) from public.ducati_catalog_drawings where parts_loaded_at is not null),
    'products', (select count(*) from public.ducati_catalog_products where detail_loaded_at is not null),
    'update', public.ducati_catalog_update_pending()
  );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Relecture ciblée : `_refresh_before` sur l'ingestion d'un modèle-année
-- ---------------------------------------------------------------------------------------------
-- Les anciennes signatures à 3 arguments sont supprimées : garder les deux créerait une
-- ambiguïté d'appel. Les appelants existants (chargeur, extension, api.ts) passent toujours
-- trois arguments nommés et tombent sur la nouvelle fonction, `_refresh_before` à null.

drop function if exists public.ducati_catalog_ingest_model_year(uuid, text, jsonb);
drop function if exists public.ducati_catalog_ingest_model_years(uuid, jsonb);

create or replace function public.ducati_catalog_ingest_model_year(
  _batch uuid, _model_year_id text, _groups jsonb, _refresh_before timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  v_total integer; v_known integer; v_missing jsonb; v_was_complete boolean;
  v_was_loaded boolean; v_new_drawings integer := 0; v_chg_drawings integer := 0;
begin
  b := public._dc_batch_guard(_batch);
  if not exists (select 1 from public.ducati_catalog_model_years where id = _model_year_id) then
    raise exception 'Modèle-année % inconnu : importer l''arbre d''abord', _model_year_id using errcode = 'P0002';
  end if;
  if jsonb_typeof(_groups) is distinct from 'array' then
    raise exception 'Groupes invalides (tableau attendu)' using errcode = '22023';
  end if;

  select groups_loaded_at is not null, complete_at is not null
    into v_was_loaded, v_was_complete
    from public.ducati_catalog_model_years where id = _model_year_id;

  drop table if exists _dc_g, _dc_d;
  create temp table _dc_g on commit drop as
    select public._dc_txt(g.v -> 'id') as id, public._dc_txt(g.v -> 'code') as code,
           public._dc_txt(g.v -> 'description') as description, g.o::integer as sort, g.v as v
      from jsonb_array_elements(_groups) with ordinality g(v, o)
     where public._dc_txt(g.v -> 'id') is not null;

  create temp table _dc_d on commit drop as
    select public._dc_txt(d.v -> 'id') as id, g.id as group_id, g.sort as group_sort, d.o::integer as sort,
           public._dc_txt(d.v -> 'code') as code, public._dc_txt(d.v -> 'description') as description,
           public._dc_txt(d.v -> 'imageUrl') as thumbnail_url, public._dc_txt(d.v -> 'originalImageUrl') as original_image_url
      from _dc_g g, jsonb_array_elements(coalesce(g.v -> 'drawings', '[]'::jsonb)) with ordinality d(v, o)
     where public._dc_txt(d.v -> 'id') is not null;

  -- Journal : modèle-année jamais lu jusqu'ici.
  if not coalesce(v_was_loaded, false) then
    insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
    select _batch, 'model_year_new', _model_year_id,
           concat_ws(' ', m.description, y.year::text), jsonb_build_object('drawings', (select count(distinct id) from _dc_d))
      from public.ducati_catalog_model_years y
      join public.ducati_catalog_models m on m.id = y.model_id
     where y.id = _model_year_id;
  end if;

  -- Journal : planches inconnues du DMS, et planches dont l'en-tête change.
  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'drawing_new', x.id, concat_ws(' — ', x.code, x.description),
         jsonb_build_object('modelYearId', _model_year_id)
    from (select distinct on (id) id, code, description from _dc_d order by id, group_sort, sort) x
   where not exists (select 1 from public.ducati_catalog_drawings d where d.id = x.id);
  get diagnostics v_new_drawings = row_count;

  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'drawing_changed', x.id, concat_ws(' — ', x.code, x.description),
         jsonb_build_object('before', jsonb_build_object('code', d.code, 'description', d.description),
                            'after', jsonb_build_object('code', x.code, 'description', x.description))
    from (select distinct on (id) id, code, description from _dc_d order by id, group_sort, sort) x
    join public.ducati_catalog_drawings d on d.id = x.id
   where (d.code, d.description) is distinct from (coalesce(x.code, d.code), coalesce(x.description, d.description));
  get diagnostics v_chg_drawings = row_count;

  insert into public.ducati_catalog_groups as t (id, code, description, updated_at)
  select distinct on (id) id, code, description, now() from _dc_g order by id, sort
  on conflict (id) do update set code = coalesce(excluded.code, t.code),
    description = coalesce(excluded.description, t.description), updated_at = now()
    where (t.code, t.description) is distinct from (coalesce(excluded.code, t.code), coalesce(excluded.description, t.description));

  insert into public.ducati_catalog_drawings as t (id, code, description, thumbnail_url, original_image_url, updated_at)
  select distinct on (id) id, code, description, thumbnail_url, original_image_url, now() from _dc_d order by id, group_sort, sort
  on conflict (id) do update set
    code = coalesce(excluded.code, t.code), description = coalesce(excluded.description, t.description),
    thumbnail_url = coalesce(excluded.thumbnail_url, t.thumbnail_url),
    original_image_url = coalesce(excluded.original_image_url, t.original_image_url), updated_at = now()
    where (t.code, t.description, t.thumbnail_url, t.original_image_url) is distinct from
          (coalesce(excluded.code, t.code), coalesce(excluded.description, t.description),
           coalesce(excluded.thumbnail_url, t.thumbnail_url), coalesce(excluded.original_image_url, t.original_image_url));

  -- Liaison : remplacée en bloc pour ce modèle-année (idempotent).
  delete from public.ducati_catalog_model_year_drawings where model_year_id = _model_year_id;
  insert into public.ducati_catalog_model_year_drawings (model_year_id, group_id, drawing_id, group_sort, sort)
  select distinct on (group_id, id) _model_year_id, group_id, id, group_sort, sort from _dc_d order by group_id, id, sort;

  select count(distinct id) into v_total from _dc_d;

  -- Planches à (re)demander : pièces jamais lues, ou lues avant `_refresh_before`.
  -- C'est le seul endroit qui décide « tout recharger » ou « relecture ciblée ».
  select coalesce(jsonb_agg(jsonb_build_object('drawingId', x.id, 'groupId', x.group_id) order by x.group_sort, x.sort), '[]'::jsonb)
    into v_missing
    from (select distinct on (d.id) d.id, d.group_id, d.group_sort, d.sort
            from _dc_d d join public.ducati_catalog_drawings dr on dr.id = d.id
           where dr.parts_loaded_at is null
              or (_refresh_before is not null and dr.parts_loaded_at < _refresh_before)
           order by d.id, d.group_sort, d.sort) x;
  v_known := v_total - jsonb_array_length(v_missing);

  update public.ducati_catalog_model_years set
    groups_loaded_at = now(), drawings_count = v_total,
    complete_at = case when jsonb_array_length(v_missing) = 0 then coalesce(complete_at, now()) else null end,
    updated_at = now()
  where id = _model_year_id;

  update public.ducati_catalog_import_batches set
    drawings_skipped = drawings_skipped + v_known,
    drawings_new = drawings_new + v_new_drawings,
    drawings_changed = drawings_changed + v_chg_drawings,
    model_years_new = model_years_new + case when coalesce(v_was_loaded, false) then 0 else 1 end,
    model_years_done = model_years_done
      + case when jsonb_array_length(v_missing) = 0 and not coalesce(v_was_complete, false) then 1 else 0 end,
    last_position = jsonb_build_object('modelYearId', _model_year_id),
    updated_at = now()
  where id = _batch;

  return jsonb_build_object('total', v_total, 'known', v_known, 'missing', v_missing,
                            'newDrawings', v_new_drawings, 'changedDrawings', v_chg_drawings);
end $$;

revoke all on function public.ducati_catalog_ingest_model_year(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.ducati_catalog_ingest_model_year(uuid, text, jsonb, timestamptz) to authenticated, service_role;

create or replace function public.ducati_catalog_ingest_model_years(
  _batch uuid, _items jsonb, _refresh_before timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; r jsonb; n integer := 0; n_total integer := 0; n_missing integer := 0; unknown text[] := '{}';
  v_my text;
begin
  perform public._dc_batch_guard(_batch);
  if jsonb_typeof(coalesce(_items, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Modèles-années invalides (tableau attendu)' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) loop
    v_my := public._dc_txt(coalesce(it -> 'modelYear', it -> 'modelYearId'));
    if v_my is null then continue; end if;
    if not exists (select 1 from public.ducati_catalog_model_years where id = v_my) then
      unknown := unknown || v_my;       -- hors arbre (hors Europe / avant 2000) : ignoré, signalé
      continue;
    end if;
    r := public.ducati_catalog_ingest_model_year(_batch, v_my, coalesce(it -> 'groups', '[]'::jsonb), _refresh_before);
    n := n + 1;
    n_total := n_total + coalesce((r ->> 'total')::integer, 0);
    n_missing := n_missing + jsonb_array_length(coalesce(r -> 'missing', '[]'::jsonb));
  end loop;
  return jsonb_build_object('modelYears', n, 'drawingLinks', n_total, 'drawingsWithoutParts', n_missing,
                            'unknownModelYears', to_jsonb(unknown));
end $$;

revoke all on function public.ducati_catalog_ingest_model_years(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.ducati_catalog_ingest_model_years(uuid, jsonb, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Ingestion des planches : détection des nouveautés, des remplacements et des prix
-- ---------------------------------------------------------------------------------------------

create or replace function public.ducati_catalog_ingest_drawings(
  _batch uuid, _model_year_id text, _drawings jsonb, _complete boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  n_d integer := 0; n_l integer := 0; n_p integer := 0;
  n_new integer := 0; n_repl integer := 0; n_unrepl integer := 0; n_price integer := 0;
begin
  b := public._dc_batch_guard(_batch);
  if jsonb_typeof(coalesce(_drawings, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Planches invalides (tableau attendu)' using errcode = '22023';
  end if;

  drop table if exists _dc_dd, _dc_l, _dc_pin;
  create temp table _dc_dd on commit drop as
    select distinct on (public._dc_txt(d.v -> 'id'))
           public._dc_txt(d.v -> 'id') as id, d.v as v
      from jsonb_array_elements(coalesce(_drawings, '[]'::jsonb)) with ordinality d(v, o)
     where public._dc_txt(d.v -> 'id') is not null
     order by public._dc_txt(d.v -> 'id'), d.o desc;

  create temp table _dc_l on commit drop as
    select dd.id as drawing_id, p.o::integer as line_no, p.v as v,
           public._dc_txt(p.v -> 'code') as reference,
           public.ducati_catalog_norm_ref(public._dc_txt(p.v -> 'code')) as reference_norm
      from _dc_dd dd, jsonb_array_elements(case when jsonb_typeof(dd.v -> 'parts') = 'array' then dd.v -> 'parts' else '[]'::jsonb end)
           with ordinality p(v, o);

  insert into public.ducati_catalog_drawings as t
    (id, code, description, image_url, original_image_url, hotspots, validities, parts_count,
     parts_loaded_at, source_model_year_id, updated_at)
  select dd.id, public._dc_txt(dd.v -> 'code'), public._dc_txt(dd.v -> 'description'),
         public._dc_txt(dd.v -> 'imageUrl'), public._dc_txt(dd.v -> 'originalImageUrl'),
         case when jsonb_typeof(dd.v -> 'hotspots') = 'array' then dd.v -> 'hotspots' else '[]'::jsonb end,
         nullif(nullif(dd.v -> 'validities', 'null'::jsonb), '[]'::jsonb),
         (select count(*) from _dc_l l where l.drawing_id = dd.id),
         now(), _model_year_id, now()
    from _dc_dd dd
  on conflict (id) do update set
    code = coalesce(excluded.code, t.code), description = coalesce(excluded.description, t.description),
    image_url = coalesce(excluded.image_url, t.image_url),
    original_image_url = coalesce(excluded.original_image_url, t.original_image_url),
    hotspots = excluded.hotspots, validities = excluded.validities, parts_count = excluded.parts_count,
    parts_loaded_at = now(), source_model_year_id = coalesce(excluded.source_model_year_id, t.source_model_year_id),
    updated_at = now();
  get diagnostics n_d = row_count;

  -- Photo de l'état d'avant, pour les seules références de ce lot : c'est elle qui permet de
  -- dire « nouvelle référence », « remplacée par… » et « prix changé ».
  create temp table _dc_pin on commit drop as
    select l.reference_norm,
           (select distinct on (x.reference_norm) public._dc_bool(x.v -> 'replaced') from _dc_l x
             where x.reference_norm = l.reference_norm order by x.reference_norm, x.drawing_id, x.line_no) as new_replaced,
           (select distinct on (x.reference_norm) public._dc_txt(x.v -> 'replacedPart') from _dc_l x
             where x.reference_norm = l.reference_norm order by x.reference_norm, x.drawing_id, x.line_no) as new_replaced_part,
           (select distinct on (x.reference_norm) public._dc_num(x.v -> 'price') from _dc_l x
             where x.reference_norm = l.reference_norm
             order by x.reference_norm, (public._dc_num(x.v -> 'price') is null), x.drawing_id, x.line_no) as new_price,
           (select distinct on (x.reference_norm) public._dc_txt(x.v -> 'description') from _dc_l x
             where x.reference_norm = l.reference_norm order by x.reference_norm, x.drawing_id, x.line_no) as new_description,
           p.reference_norm is not null as existed,
           p.replaced as old_replaced, p.replaced_part as old_replaced_part, p.catalog_price_ht as old_price
      from (select distinct reference_norm, reference from _dc_l where reference_norm is not null) l
      left join public.ducati_catalog_parts p on p.reference_norm = l.reference_norm;

  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'part_new', reference_norm, new_description, jsonb_build_object('price', new_price)
    from _dc_pin where not existed;
  get diagnostics n_new = row_count;

  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'part_replaced', reference_norm, new_description,
         jsonb_build_object('replacedBy', new_replaced_part, 'wasReplaced', coalesce(old_replaced, false))
    from _dc_pin
   where existed and coalesce(new_replaced, false)
     and (not coalesce(old_replaced, false) or old_replaced_part is distinct from new_replaced_part);
  get diagnostics n_repl = row_count;

  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'part_unreplaced', reference_norm, new_description,
         jsonb_build_object('wasReplacedBy', old_replaced_part)
    from _dc_pin where existed and coalesce(old_replaced, false) and not coalesce(new_replaced, false);
  get diagnostics n_unrepl = row_count;

  insert into public.ducati_catalog_changes (batch_id, kind, key, label, detail)
  select _batch, 'part_price', reference_norm, new_description,
         jsonb_build_object('before', old_price, 'after', new_price)
    from _dc_pin
   where existed and new_price is not null and old_price is not null and new_price <> old_price;
  get diagnostics n_price = row_count;

  delete from public.ducati_catalog_drawing_lines where drawing_id in (select id from _dc_dd);
  insert into public.ducati_catalog_drawing_lines
    (drawing_id, line_no, position, reference, reference_norm, description, quantity, notes, part_notes,
     replaced, replaced_part, start_date, end_date, validities, has_tempario, item_id)
  select l.drawing_id, l.line_no, public._dc_txt(l.v -> 'position'), l.reference, l.reference_norm,
         public._dc_txt(l.v -> 'description'), public._dc_num(l.v -> 'quantity'),
         public._dc_txt(nullif(nullif(l.v -> 'notes', '[]'::jsonb), '""'::jsonb)),
         public._dc_txt(nullif(nullif(l.v -> 'partNotes', '[]'::jsonb), '""'::jsonb)),
         public._dc_bool(l.v -> 'replaced'), public._dc_txt(l.v -> 'replacedPart'),
         public._dc_date(l.v -> 'startDate'), public._dc_date(l.v -> 'endDate'),
         nullif(nullif(l.v -> 'validities', 'null'::jsonb), '[]'::jsonb),
         public._dc_bool(l.v -> 'hasTempario'), public._dc_txt(l.v -> 'itemId')
    from _dc_l l;
  get diagnostics n_l = row_count;

  insert into public.ducati_catalog_parts as t
    (reference_norm, reference, description, catalog_price_ht, catalog_price_ttc, price_seen_at,
     discount_group, ean_code, min_quantity, has_tempario, replaced, replaced_part, replacement_tree, updated_at)
  select distinct on (l.reference_norm)
         l.reference_norm, l.reference, public._dc_txt(l.v -> 'description'),
         public._dc_num(l.v -> 'price'), public._dc_num(l.v -> 'vatPrice'),
         case when public._dc_num(l.v -> 'price') is not null or public._dc_num(l.v -> 'vatPrice') is not null then now() end,
         public._dc_txt(l.v -> 'discountGroup'), public._dc_txt(l.v -> 'eanCode'), public._dc_num(l.v -> 'minQuantity'),
         public._dc_bool(l.v -> 'hasTempario'), public._dc_bool(l.v -> 'replaced'), public._dc_txt(l.v -> 'replacedPart'),
         nullif(nullif(l.v -> 'partReplacementTree', 'null'::jsonb), '[]'::jsonb), now()
    from _dc_l l
   where l.reference_norm is not null
   order by l.reference_norm, (public._dc_num(l.v -> 'price') is null), l.drawing_id, l.line_no
  on conflict (reference_norm) do update set
    reference = excluded.reference,
    description = coalesce(excluded.description, t.description),
    catalog_price_ht = coalesce(excluded.catalog_price_ht, t.catalog_price_ht),
    catalog_price_ttc = coalesce(excluded.catalog_price_ttc, t.catalog_price_ttc),
    price_seen_at = coalesce(excluded.price_seen_at, t.price_seen_at),
    discount_group = coalesce(excluded.discount_group, t.discount_group),
    ean_code = coalesce(excluded.ean_code, t.ean_code),
    min_quantity = coalesce(excluded.min_quantity, t.min_quantity),
    has_tempario = coalesce(excluded.has_tempario, t.has_tempario),
    -- Le remplacement suit le catalogue dans les DEUX sens : une pièce qui cesse d'être
    -- remplacée doit cesser d'être marquée (correctif du 05/10).
    replaced = coalesce(excluded.replaced, false),
    replaced_part = excluded.replaced_part,
    replacement_tree = excluded.replacement_tree,
    updated_at = now();
  get diagnostics n_p = row_count;

  if _complete and _model_year_id is not null then
    update public.ducati_catalog_model_years set complete_at = now(), updated_at = now()
     where id = _model_year_id and complete_at is null
       and not exists (select 1 from public.ducati_catalog_model_year_drawings x
                         join public.ducati_catalog_drawings d on d.id = x.drawing_id
                        where x.model_year_id = _model_year_id and d.parts_loaded_at is null);
    if found then
      update public.ducati_catalog_import_batches set model_years_done = model_years_done + 1 where id = _batch;
    end if;
  end if;

  update public.ducati_catalog_import_batches set
    drawings_imported = drawings_imported + n_d,
    lines_imported = lines_imported + n_l,
    parts_new = parts_new + n_new,
    parts_replaced = parts_replaced + n_repl,
    parts_price_changed = parts_price_changed + n_price,
    last_position = jsonb_build_object('modelYearId', _model_year_id,
                                       'lastDrawingId', (select max(id) from _dc_dd), 'complete', _complete),
    updated_at = now()
  where id = _batch;

  return jsonb_build_object('drawings', n_d, 'lines', n_l, 'parts', n_p,
                            'newParts', n_new, 'replacedParts', n_repl,
                            'unreplacedParts', n_unrepl, 'priceChanges', n_price);
end $$;

revoke all on function public.ducati_catalog_ingest_drawings(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.ducati_catalog_ingest_drawings(uuid, text, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Résumé pour l'écran « Mise à jour »
-- ---------------------------------------------------------------------------------------------

create or replace function public.ducati_catalog_update_summary(_changes_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_batch public.ducati_catalog_import_batches; v_lim integer;
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v_lim := least(greatest(coalesce(_changes_limit, 50), 1), 200);

  -- Le dernier lot qui a réellement lu quelque chose du catalogue pièces.
  select * into v_batch from public.ducati_catalog_import_batches
   where drawings_imported > 0 or lines_imported > 0 or model_years_done > 0
   order by started_at desc limit 1;

  return jsonb_build_object(
    'lastImportAt', (select max(coalesce(finished_at, updated_at)) from public.ducati_catalog_import_batches
                      where drawings_imported > 0 or lines_imported > 0),
    'lastBatch', case when v_batch.id is null then null else jsonb_build_object(
      'id', v_batch.id, 'status', v_batch.status, 'startedAt', v_batch.started_at,
      'finishedAt', v_batch.finished_at, 'scope', v_batch.scope,
      'modelYearsDone', v_batch.model_years_done, 'modelYearsNew', v_batch.model_years_new,
      'drawingsImported', v_batch.drawings_imported, 'drawingsSkipped', v_batch.drawings_skipped,
      'drawingsNew', v_batch.drawings_new, 'drawingsChanged', v_batch.drawings_changed,
      'linesImported', v_batch.lines_imported, 'partsNew', v_batch.parts_new,
      'partsReplaced', v_batch.parts_replaced, 'partsPriceChanged', v_batch.parts_price_changed,
      'lastError', v_batch.last_error) end,
    'lastChanges', case when v_batch.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'key', c.key, 'label', c.label, 'detail', c.detail)
                       order by c.id desc)
        from (select * from public.ducati_catalog_changes where batch_id = v_batch.id
               order by id desc limit v_lim) c), '[]'::jsonb) end,
    'lastChangeCounts', case when v_batch.id is null then '{}'::jsonb else coalesce((
      select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from public.ducati_catalog_changes
         where batch_id = v_batch.id group by kind) s), '{}'::jsonb) end,
    'replacedTotal', (select count(*) from public.ducati_catalog_parts where replaced),
    'replacedToday', (select count(*) from public.ducati_catalog_parts
                       where replaced and updated_at >= date_trunc('day', now())),
    'totals', jsonb_build_object(
      'modelYears', (select count(*) from public.ducati_catalog_model_years),
      'modelYearsComplete', (select count(*) from public.ducati_catalog_model_years where complete_at is not null),
      'drawings', (select count(*) from public.ducati_catalog_drawings),
      'parts', (select count(*) from public.ducati_catalog_parts),
      'lines', (select count(*) from public.ducati_catalog_drawing_lines)),
    'pending', public.ducati_catalog_update_pending());
end $$;

revoke all on function public.ducati_catalog_update_summary(integer) from public, anon;
grant execute on function public.ducati_catalog_update_summary(integer) to authenticated;

commit;
