-- =====================================================================
-- Mission 06, carte 3 — « Importer les vues éclatées et les pièces de chaque modèle ».
--
-- Groupes (Cadre, Moteur, Électrique…), planches (vues éclatées : image Ducati, repères
-- cliquables), lignes de planche (position, référence, désignation, quantité…), et la liaison
-- planche ↔ modèle-année : une planche partagée par plusieurs modèles n'est stockée qu'UNE fois
-- (dédoublonnage par id Ducati de planche).
--
-- Références : ducati_catalog_norm_ref() = même forme compacte que l'index
-- idx_articles_ref_compact (majuscules, uniquement A-Z0-9). Le lien vers l'article du DMS se fait
-- par cette forme, à la lecture (ducati_catalog_article_for, ducati_catalog_drawing_lines) :
-- AUCUN article n'est créé ni modifié ici.
--
-- Prix : le prix catalogue Ducati (HT / TTC + date de lecture) est gardé À TITRE D'INFORMATION
-- dans ducati_catalog_parts. Il ne modifie JAMAIS le prix des articles (price_changes intacts ;
-- le tarif importé fait foi, décision de la mission 06).
--
-- Images : on garde l'URL Ducati (pas de copie massive). Voir mission 06 §5 pour l'option
-- « copier seulement les planches utilisées ».
--
-- Mêmes règles que 20260921100000 : tables globales, lecture équipe, écriture par fonctions
-- d'import uniquement, events par lot. Additif uniquement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Référence normalisée (identique à l'index idx_articles_ref_compact)
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_norm_ref(_ref text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(regexp_replace(upper(coalesce(_ref, '')), '[^A-Z0-9]', '', 'g'), '');
$$;
revoke all on function public.ducati_catalog_norm_ref(text) from public, anon;
grant execute on function public.ducati_catalog_norm_ref(text) to authenticated, service_role;

-- Date Ducati (ISO « 2019-01-01… » ou « 01/01/2019 ») → date ; null si illisible.
create or replace function public._dc_date(_v jsonb)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := public._dc_txt(_v); m text[];
begin
  if s is null then return null; end if;
  m := regexp_match(s, '^(\d{4})-(\d{2})-(\d{2})');
  if m is not null then
    begin return make_date(m[1]::int, m[2]::int, m[3]::int); exception when others then return null; end;
  end if;
  m := regexp_match(s, '^(\d{1,2})[/.](\d{1,2})[/.](\d{4})');
  if m is not null then
    begin return make_date(m[3]::int, m[2]::int, m[1]::int); exception when others then return null; end;
  end if;
  return null;
end $$;
revoke all on function public._dc_date(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. État d'import par modèle-année
-- ---------------------------------------------------------------------
alter table public.ducati_catalog_model_years
  add column if not exists groups_loaded_at timestamptz,   -- liste des groupes/planches reçue
  add column if not exists drawings_count   integer,       -- nombre de planches du modèle-année
  add column if not exists complete_at      timestamptz;   -- toutes les planches ont leurs pièces

-- ---------------------------------------------------------------------
-- 2. Groupes, planches, liaison, pièces, lignes
-- ---------------------------------------------------------------------
create table if not exists public.ducati_catalog_groups (
  id          text primary key,              -- id Ducati du groupe
  code        text,                          -- T, M, E, O, P, L…
  description text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ducati_catalog_drawings (
  id                   text primary key,     -- id Ducati de la planche (partagée entre modèles)
  code                 text,
  description          text,
  thumbnail_url        text,                 -- miniature (imageUrl de la liste des groupes)
  image_url            text,                 -- image de la vue éclatée (détail)
  original_image_url   text,
  hotspots             jsonb not null default '[]'::jsonb,  -- [{pos, x1, y1, x2, y2}]
  validities           jsonb,
  parts_count          integer,
  parts_loaded_at      timestamptz,          -- null = pièces pas encore lues
  source_model_year_id text,                 -- modèle-année par lequel le détail a été lu
  updated_at           timestamptz not null default now()
);
create index if not exists idx_dc_drawings_missing on public.ducati_catalog_drawings(id) where parts_loaded_at is null;

create table if not exists public.ducati_catalog_model_year_drawings (
  model_year_id text not null references public.ducati_catalog_model_years(id),
  group_id      text not null references public.ducati_catalog_groups(id),
  drawing_id    text not null references public.ducati_catalog_drawings(id),
  group_sort    integer,
  sort          integer,
  primary key (model_year_id, group_id, drawing_id)
);
create index if not exists idx_dc_myd_drawing on public.ducati_catalog_model_year_drawings(drawing_id);

-- Une ligne par référence Ducati : infos communes et prix catalogue (INFORMATION seulement).
create table if not exists public.ducati_catalog_parts (
  reference_norm    text primary key,        -- ducati_catalog_norm_ref(reference)
  reference         text not null,
  description       text,
  catalog_price_ht  numeric(12, 2),          -- « price » Ducati
  catalog_price_ttc numeric(12, 2),          -- « vatPrice » Ducati
  price_seen_at     timestamptz,             -- date de lecture du prix
  discount_group    text,
  ean_code          text,
  min_quantity      numeric,
  has_tempario      boolean,
  replaced          boolean,
  replaced_part     text,
  replacement_tree  jsonb,
  updated_at        timestamptz not null default now()
);
comment on column public.ducati_catalog_parts.catalog_price_ht is 'Prix catalogue Ducati lu dans l''e-catalog, à titre d''information. Ne modifie jamais le prix des articles (price_changes).';

create table if not exists public.ducati_catalog_drawing_lines (
  id             bigint generated always as identity primary key,
  drawing_id     text not null references public.ducati_catalog_drawings(id) on delete cascade,
  line_no        integer not null,           -- ordre dans la planche
  position       text,                       -- repère sur l'image
  reference      text,
  reference_norm text,                       -- ducati_catalog_norm_ref(reference)
  description    text,
  quantity       numeric,
  notes          text,
  part_notes     text,
  replaced       boolean,
  replaced_part  text,
  start_date     date,
  end_date       date,
  validities     jsonb,
  has_tempario   boolean,
  unique (drawing_id, line_no)
);
create index if not exists idx_dc_lines_ref on public.ducati_catalog_drawing_lines(reference_norm);

comment on table public.ducati_catalog_drawings is 'Catalogue Ducati : planches (vues éclatées). Une planche partagée par plusieurs modèles-années n''est stockée qu''une fois.';
comment on table public.ducati_catalog_drawing_lines is 'Catalogue Ducati : lignes de planche (repère, référence, quantité…). Remplacées en bloc à chaque relecture de la planche.';

-- ---------------------------------------------------------------------
-- 3. RLS : lecture équipe, aucune écriture directe
-- ---------------------------------------------------------------------
alter table public.ducati_catalog_groups enable row level security;
alter table public.ducati_catalog_drawings enable row level security;
alter table public.ducati_catalog_model_year_drawings enable row level security;
alter table public.ducati_catalog_parts enable row level security;
alter table public.ducati_catalog_drawing_lines enable row level security;

drop policy if exists dc_groups_read on public.ducati_catalog_groups;
create policy dc_groups_read on public.ducati_catalog_groups
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_drawings_read on public.ducati_catalog_drawings;
create policy dc_drawings_read on public.ducati_catalog_drawings
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_myd_read on public.ducati_catalog_model_year_drawings;
create policy dc_myd_read on public.ducati_catalog_model_year_drawings
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_parts_read on public.ducati_catalog_parts;
create policy dc_parts_read on public.ducati_catalog_parts
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_lines_read on public.ducati_catalog_drawing_lines;
create policy dc_lines_read on public.ducati_catalog_drawing_lines
  for select to authenticated using ((select public.ducati_catalog_is_staff()));

revoke all on public.ducati_catalog_groups from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_groups from authenticated;
revoke all on public.ducati_catalog_drawings from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_drawings from authenticated;
revoke all on public.ducati_catalog_model_year_drawings from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_model_year_drawings from authenticated;
revoke all on public.ducati_catalog_parts from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_parts from authenticated;
revoke all on public.ducati_catalog_drawing_lines from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_drawing_lines from authenticated;

-- ---------------------------------------------------------------------
-- 4. Ingestion d'un modèle-année : groupes + en-têtes de planches + liaison
-- Charge = tableau des groupes tel que renvoyé par l'e-catalog :
--   [ { id, code, description, drawings: [ { id, code, description, imageUrl, originalImageUrl } ] } ]
-- Renvoie les planches dont les pièces manquent encore (les autres sont déjà connues :
-- elles ne seront pas relues) : { total, known, missing: [ { drawingId, groupId } ] }.
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_ingest_model_year(_batch uuid, _model_year_id text, _groups jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  v_total integer; v_known integer; v_missing jsonb; v_was_complete boolean;
begin
  b := public._dc_batch_guard(_batch);
  if not exists (select 1 from public.ducati_catalog_model_years where id = _model_year_id) then
    raise exception 'Modèle-année % inconnu : importer l''arbre d''abord', _model_year_id using errcode = 'P0002';
  end if;
  if jsonb_typeof(_groups) is distinct from 'array' then
    raise exception 'Groupes invalides (tableau attendu)' using errcode = '22023';
  end if;

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
  select coalesce(jsonb_agg(jsonb_build_object('drawingId', x.id, 'groupId', x.group_id) order by x.group_sort, x.sort), '[]'::jsonb)
    into v_missing
    from (select distinct on (d.id) d.id, d.group_id, d.group_sort, d.sort
            from _dc_d d join public.ducati_catalog_drawings dr on dr.id = d.id
           where dr.parts_loaded_at is null
           order by d.id, d.group_sort, d.sort) x;
  v_known := v_total - jsonb_array_length(v_missing);
  select complete_at is not null into v_was_complete from public.ducati_catalog_model_years where id = _model_year_id;

  update public.ducati_catalog_model_years set
    groups_loaded_at = now(), drawings_count = v_total,
    complete_at = case when jsonb_array_length(v_missing) = 0 then coalesce(complete_at, now()) else null end,
    updated_at = now()
  where id = _model_year_id;

  update public.ducati_catalog_import_batches set
    drawings_skipped = drawings_skipped + v_known,
    model_years_done = model_years_done
      + case when jsonb_array_length(v_missing) = 0 and not coalesce(v_was_complete, false) then 1 else 0 end,
    last_position = jsonb_build_object('modelYearId', _model_year_id),
    updated_at = now()
  where id = _batch;

  return jsonb_build_object('total', v_total, 'known', v_known, 'missing', v_missing);
end $$;
revoke all on function public.ducati_catalog_ingest_model_year(uuid, text, jsonb) from public, anon;
grant execute on function public.ducati_catalog_ingest_model_year(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Ingestion du détail de planches (par petits paquets)
-- Charge = tableau des détails renvoyés par l'e-catalog :
--   [ { id, code, description, imageUrl, originalImageUrl?, hotspots: [...], validities,
--       parts: [ { code, description, position, quantity, price, vatPrice, discountGroup, replaced,
--                  replacedPart, partReplacementTree, notes, partNotes, minQuantity, eanCode,
--                  hasTempario, startDate, endDate, validities } ] } ]
-- _complete = true quand c'est le dernier paquet du modèle-année.
-- Les lignes d'une planche sont remplacées en bloc (idempotent).
-- ---------------------------------------------------------------------
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
    parts_loaded_at = now(), source_model_year_id = excluded.source_model_year_id, updated_at = now();
  get diagnostics n_d = row_count;

  delete from public.ducati_catalog_drawing_lines where drawing_id in (select id from _dc_dd);
  insert into public.ducati_catalog_drawing_lines
    (drawing_id, line_no, position, reference, reference_norm, description, quantity, notes, part_notes,
     replaced, replaced_part, start_date, end_date, validities, has_tempario)
  select l.drawing_id, l.line_no, public._dc_txt(l.v -> 'position'), l.reference, l.reference_norm,
         public._dc_txt(l.v -> 'description'), public._dc_num(l.v -> 'quantity'),
         public._dc_txt(nullif(nullif(l.v -> 'notes', '[]'::jsonb), '""'::jsonb)),
         public._dc_txt(nullif(nullif(l.v -> 'partNotes', '[]'::jsonb), '""'::jsonb)),
         public._dc_bool(l.v -> 'replaced'), public._dc_txt(l.v -> 'replacedPart'),
         public._dc_date(l.v -> 'startDate'), public._dc_date(l.v -> 'endDate'),
         nullif(nullif(l.v -> 'validities', 'null'::jsonb), '[]'::jsonb),
         public._dc_bool(l.v -> 'hasTempario')
    from _dc_l l;
  get diagnostics n_l = row_count;

  -- Fiche commune par référence (prix catalogue = information, jamais le prix de l'article).
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
revoke all on function public.ducati_catalog_ingest_drawings(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.ducati_catalog_ingest_drawings(uuid, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. État connu, pour la reprise et le dédoublonnage côté extension
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_import_state()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'completeModelYears', coalesce((select jsonb_agg(id) from public.ducati_catalog_model_years where complete_at is not null), '[]'::jsonb),
    'drawingsWithParts', (select count(*) from public.ducati_catalog_drawings where parts_loaded_at is not null)
  );
end $$;
revoke all on function public.ducati_catalog_import_state() from public, anon;
grant execute on function public.ducati_catalog_import_state() to authenticated;

-- Compteurs pour l'écran « Catalogue Ducati ».
create or replace function public.ducati_catalog_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ducati_catalog_is_staff() then
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
    'parts', (select count(*) from public.ducati_catalog_parts)
  );
end $$;
revoke all on function public.ducati_catalog_stats() from public, anon;
grant execute on function public.ducati_catalog_stats() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Article du DMS correspondant (lecture seule, aucune création)
-- ---------------------------------------------------------------------

-- Article actif de la société dont la référence compacte = celle de la pièce Ducati.
-- Priorité à l'article géré en stock (hors librairie), puis au plus ancien.
create or replace function public.ducati_catalog_article_for(_company uuid, _reference text)
returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := public.ducati_catalog_norm_ref(_reference); v uuid;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if k is null then return null; end if;
  select a.id into v
    from public.articles a
   where a.company_id = _company and a.is_active
     and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = k
   order by a.is_library, a.created_at
   limit 1;
  return v;
end $$;
revoke all on function public.ducati_catalog_article_for(uuid, text) from public, anon;
grant execute on function public.ducati_catalog_article_for(uuid, text) to authenticated;

-- Lignes d'une planche + prix catalogue (info) + article du DMS correspondant et son stock
-- (même calcul que la recherche d'article des ventes : article_stock, _article_on_order_qty).
create or replace function public.ducati_catalog_drawing_lines(_company uuid, _drawing_id text)
returns table (
  line_no integer, "position" text, reference text, reference_norm text, description text,
  quantity numeric, notes text, part_notes text, replaced boolean, replaced_part text,
  start_date date, end_date date, has_tempario boolean,
  catalog_price_ht numeric, catalog_price_ttc numeric, price_seen_at timestamptz,
  article_id uuid, article_reference text, article_designation text, article_sale_price_ht numeric,
  article_mgmt_type text, article_is_library boolean,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.line_no, l.position, l.reference, l.reference_norm, l.description,
         l.quantity, l.notes, l.part_notes, l.replaced, l.replaced_part,
         l.start_date, l.end_date, l.has_tempario,
         p.catalog_price_ht, p.catalog_price_ttc, p.price_seen_at,
         a.id, a.reference, a.designation, a.sale_price_ht, a.mgmt_type::text, a.is_library,
         st.real_qty, st.reserved_qty, oo.q
    from public.ducati_catalog_drawing_lines l
    left join public.ducati_catalog_parts p on p.reference_norm = l.reference_norm
    left join lateral (
      select a2.* from public.articles a2
       where l.reference_norm is not null and a2.company_id = _company and a2.is_active
         and regexp_replace(upper(a2.reference), '[^A-Z0-9]', '', 'g') = l.reference_norm
       order by a2.is_library, a2.created_at
       limit 1
    ) a on true
    left join lateral (select s.real_qty, s.reserved_qty from public.article_stock(a.id) s where a.id is not null) st on true
    left join lateral (select public._article_on_order_qty(a.id) as q where a.id is not null) oo on true
   where l.drawing_id = _drawing_id
   order by l.line_no;
end $$;
revoke all on function public.ducati_catalog_drawing_lines(uuid, text) from public, anon;
grant execute on function public.ducati_catalog_drawing_lines(uuid, text) to authenticated;
