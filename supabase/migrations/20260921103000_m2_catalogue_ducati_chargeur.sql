-- =====================================================================
-- Mission 06 — chargeur des fichiers d'extraction du catalogue Ducati (21/09).
--
-- Changement de priorité décidé avec Simon le 21/09 : l'extraction initiale est faite depuis son
-- Chrome (script piloté dans l'onglet e-catalog) et produit des fichiers JSON
-- (catalogue-ducati-arbre.json, -groupes-NNN.json, -planches-NNN.json). Le chargeur
-- tools/catalog-loader/load.mjs les pousse en base avec la clé de service (variable
-- d'environnement, jamais écrite ni affichée).
--
-- Ce fichier :
--   * permet aux lots « chargeur » (lancés avec la clé de service, sans utilisateur) d'utiliser
--     les mêmes fonctions d'import ; un lot lancé par un utilisateur reste réservé à celui-ci ;
--   * garde le nom de variante du modèle-année (name) et l'itemId Ducati des lignes ;
--   * ajoute l'import groupé des modèles-années et le recalcul « modèle-année complet »
--     (les planches arrivent dans des fichiers séparés, sans lien direct au modèle-année).
--
-- Additif : 2 colonnes, 3 fonctions nouvelles ; 3 fonctions du jour remplacées (mêmes signatures).
-- =====================================================================

alter table public.ducati_catalog_model_years add column if not exists name text;
alter table public.ducati_catalog_drawing_lines add column if not exists item_id text;

-- Garde des lots : lot d'utilisateur → son auteur, admin de la société ; lot du chargeur
-- (started_by null) → uniquement la clé de service.
create or replace function public._dc_batch_guard(_batch uuid)
returns public.ducati_catalog_import_batches
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b public.ducati_catalog_import_batches;
begin
  select * into b from public.ducati_catalog_import_batches where id = _batch;
  if not found then
    raise exception 'Lot d''import introuvable' using errcode = 'P0002';
  end if;
  if b.started_by is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Accès refusé au lot d''import' using errcode = '42501';
    end if;
  elsif auth.uid() is null or b.started_by is distinct from auth.uid()
        or b.company_id is null or not public.is_admin(b.company_id) then
    raise exception 'Accès refusé au lot d''import' using errcode = '42501';
  end if;
  if b.status in ('done', 'stopped') then
    raise exception 'Lot d''import clos (%)', b.status using errcode = '55000';
  end if;
  return b;
end $$;
revoke all on function public._dc_batch_guard(uuid) from public, anon, authenticated;

-- Lot du chargeur (clé de service uniquement).
create or replace function public.ducati_catalog_batch_start_loader(_scope jsonb, _model_years_total integer)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au chargeur (clé de service)' using errcode = '42501';
  end if;
  insert into public.ducati_catalog_import_batches (company_id, started_by, scope, model_years_total)
  values (null, null, coalesce(_scope, '{}'::jsonb) || jsonb_build_object('source', 'chargeur'), greatest(coalesce(_model_years_total, 0), 0))
  returning id into v_id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (null, null, 'catalog_import_started', 'ducati_catalog_import', v_id::text, 'import', null,
          jsonb_build_object('scope', coalesce(_scope, '{}'::jsonb), 'source', 'chargeur', 'model_years_total', _model_years_total));
  return v_id;
end $$;
revoke all on function public.ducati_catalog_batch_start_loader(jsonb, integer) from public, anon, authenticated;
grant execute on function public.ducati_catalog_batch_start_loader(jsonb, integer) to service_role;

-- Les fonctions d'import sont aussi ouvertes à la clé de service (la garde décide).
grant execute on function public.ducati_catalog_batch_progress(uuid, text, jsonb, jsonb, text) to service_role;
grant execute on function public.ducati_catalog_ingest_tree(uuid, jsonb) to service_role;
grant execute on function public.ducati_catalog_ingest_model_year(uuid, text, jsonb) to service_role;
grant execute on function public.ducati_catalog_ingest_drawings(uuid, text, jsonb, boolean) to service_role;
grant execute on function public.ducati_catalog_ingest_products(uuid, jsonb) to service_role;
grant execute on function public.ducati_catalog_stats() to service_role;

-- Arbre : même charge qu'avant, + nom de variante du modèle-année (modelYears[].name).
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
           coalesce(public._dc_int(m.v -> 'order'), m.o::integer) as sort, m.v as v
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

  insert into public.ducati_catalog_model_years as t (id, model_id, code, year, path, name, sort, updated_at)
  select distinct on (y.id) y.id, y.model_id, y.code, y.year, y.path, y.name, y.sort, now()
    from (
      select public._dc_txt(y.v -> 'id') as id, m.id as model_id, public._dc_txt(y.v -> 'code') as code,
             coalesce(public._dc_int(y.v -> 'year'), (substring(public._dc_txt(y.v -> 'year') from '(\d{4})'))::integer) as year,
             public._dc_txt(y.v -> 'path') as path, public._dc_txt(y.v -> 'name') as name, y.o::integer as sort
        from _dc_m m, jsonb_array_elements(coalesce(m.v -> 'modelYears', '[]'::jsonb)) with ordinality y(v, o)
       where public._dc_txt(y.v -> 'id') is not null
    ) y
   order by y.id, y.sort
  on conflict (id) do update set model_id = excluded.model_id, code = excluded.code, year = excluded.year,
    path = excluded.path, name = coalesce(excluded.name, t.name), sort = excluded.sort, updated_at = now()
    where (t.model_id, t.code, t.year, t.path, t.name, t.sort)
      is distinct from (excluded.model_id, excluded.code, excluded.year, excluded.path, coalesce(excluded.name, t.name), excluded.sort);
  get diagnostics n_y = row_count;

  update public.ducati_catalog_import_batches set updated_at = now() where id = _batch;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (b.company_id, auth.uid(), 'catalog_tree_imported', 'ducati_catalog_import', _batch::text, 'import', null,
          jsonb_build_object('families', (select count(*) from _dc_f), 'supermodels', (select count(*) from _dc_s),
                             'models', (select count(*) from _dc_m), 'changed_model_years', n_y));

  return jsonb_build_object('families', n_f, 'supermodels', n_s, 'models', n_m, 'model_years', n_y);
end $$;

-- Plusieurs modèles-années d'un coup : [ { modelYear, groups: [...] } ] (fichiers « groupes »).
create or replace function public.ducati_catalog_ingest_model_years(_batch uuid, _items jsonb)
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
    r := public.ducati_catalog_ingest_model_year(_batch, v_my, coalesce(it -> 'groups', '[]'::jsonb));
    n := n + 1;
    n_total := n_total + coalesce((r ->> 'total')::integer, 0);
    n_missing := n_missing + jsonb_array_length(coalesce(r -> 'missing', '[]'::jsonb));
  end loop;
  return jsonb_build_object('modelYears', n, 'drawingLinks', n_total, 'drawingsWithoutParts', n_missing,
                            'unknownModelYears', to_jsonb(unknown));
end $$;
revoke all on function public.ducati_catalog_ingest_model_years(uuid, jsonb) from public, anon;
grant execute on function public.ducati_catalog_ingest_model_years(uuid, jsonb) to authenticated, service_role;

-- Planches : même charge qu'avant, + itemId Ducati des lignes. _model_year_id peut être null
-- (fichiers « planches » : le lien au modèle-année vient des fichiers « groupes »).
create or replace function public.ducati_catalog_ingest_drawings(
  _batch uuid, _model_year_id text, _drawings jsonb, _complete boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  n_d integer := 0; n_l integer := 0; n_p integer := 0;
begin
  b := public._dc_batch_guard(_batch);
  if jsonb_typeof(coalesce(_drawings, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Planches invalides (tableau attendu)' using errcode = '22023';
  end if;

  drop table if exists _dc_dd, _dc_l;
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
    replaced = coalesce(excluded.replaced, t.replaced),
    replaced_part = coalesce(excluded.replaced_part, t.replaced_part),
    replacement_tree = coalesce(excluded.replacement_tree, t.replacement_tree),
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
    last_position = jsonb_build_object('modelYearId', _model_year_id,
                                       'lastDrawingId', (select max(id) from _dc_dd), 'complete', _complete),
    updated_at = now()
  where id = _batch;

  return jsonb_build_object('drawings', n_d, 'lines', n_l, 'parts', n_p);
end $$;

-- Recalcule « modèle-année complet » : groupes reçus et toutes ses planches ont leurs pièces.
create or replace function public.ducati_catalog_refresh_completeness(_batch uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_done integer; n_undone integer;
begin
  perform public._dc_batch_guard(_batch);
  update public.ducati_catalog_model_years y set complete_at = now(), updated_at = now()
   where y.complete_at is null and y.groups_loaded_at is not null
     and not exists (select 1 from public.ducati_catalog_model_year_drawings x
                       join public.ducati_catalog_drawings d on d.id = x.drawing_id
                      where x.model_year_id = y.id and d.parts_loaded_at is null);
  get diagnostics n_done = row_count;
  update public.ducati_catalog_model_years y set complete_at = null, updated_at = now()
   where y.complete_at is not null
     and exists (select 1 from public.ducati_catalog_model_year_drawings x
                   join public.ducati_catalog_drawings d on d.id = x.drawing_id
                  where x.model_year_id = y.id and d.parts_loaded_at is null);
  get diagnostics n_undone = row_count;
  update public.ducati_catalog_import_batches set model_years_done = model_years_done + n_done, updated_at = now()
   where id = _batch;
  return jsonb_build_object('nowComplete', n_done, 'nowIncomplete', n_undone,
    'complete', (select count(*) from public.ducati_catalog_model_years where complete_at is not null),
    'incomplete', (select count(*) from public.ducati_catalog_model_years where groups_loaded_at is not null and complete_at is null));
end $$;
revoke all on function public.ducati_catalog_refresh_completeness(uuid) from public, anon;
grant execute on function public.ducati_catalog_refresh_completeness(uuid) to authenticated, service_role;

-- Compteurs : aussi lisibles par le chargeur (clé de service). Même contenu que 20260921102000.
create or replace function public.ducati_catalog_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.ducati_catalog_is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'families', (select count(*) from public.ducati_catalog_families),
    'models', (select count(*) from public.ducati_catalog_models),
    'modelsEurope', (select count(*) from public.ducati_catalog_models where is_europe),
    'modelYears', (select count(*) from public.ducati_catalog_model_years),
    'modelYearsLoaded', (select count(*) from public.ducati_catalog_model_years where groups_loaded_at is not null),
    'modelYearsComplete', (select count(*) from public.ducati_catalog_model_years where complete_at is not null),
    'drawings', (select count(*) from public.ducati_catalog_drawings),
    'drawingsWithParts', (select count(*) from public.ducati_catalog_drawings where parts_loaded_at is not null),
    'lines', (select count(*) from public.ducati_catalog_drawing_lines),
    'parts', (select count(*) from public.ducati_catalog_parts),
    'accessories', (select count(*) from public.ducati_catalog_products where kind = 'accessory'),
    'apparel', (select count(*) from public.ducati_catalog_products where kind = 'apparel'),
    'variants', (select count(*) from public.ducati_catalog_product_variants)
  );
end $$;
