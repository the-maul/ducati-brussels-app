-- =====================================================================
-- Mission 06 — « Importer les catalogues accessoires et vêtements Ducati » (ajout validé par
-- Simon le 21/09).
--
-- Même principe que les pièces : l'extension Chrome lit l'e-catalog avec la session Ducati de
-- l'utilisateur (listes par famille / liste vêtements, puis fiche de chaque produit, en série,
-- ~1 requête/s), le DMS enregistre par les fonctions ci-dessous (security definer, admin).
--
-- Modèle :
--   * ducati_catalog_products : un produit Ducati (code ACC… / APP…), accessoire ou vêtement ;
--   * ducati_catalog_product_variants : une ligne par RÉFÉRENCE vendable (SKU) : pour les
--     vêtements, une référence par taille / couleur (APP_TAGLIA, APP_COLOR) ;
--   * ducati_catalog_product_applicabilities : compatibilité d'une référence avec un
--     modèle / millésime (arbre propre aux accessoires : ses ids diffèrent de ceux des pièces,
--     on garde donc aussi les libellés famille / cylindrée / modèle / année). is_europe = même
--     règle que les modèles (décision M-15) ; on garde tout, l'écran filtre.
--
-- Prix : prix Ducati HT / TTC + date, À TITRE D'INFORMATION ; jamais recopiés dans les articles.
-- Aucun article DMS n'est créé ici (étape ultérieure, décidée par Simon). La fonction
-- ducati_catalog_product_for_reference renvoie l'entrée du catalogue pour une référence
-- (ex. SKU Shopify « 98… ») : base du futur rapprochement (règle W-6).
--
-- Additif uniquement (tables, colonnes de compteurs, fonctions). Aucune donnée écrite.
-- =====================================================================

-- Montant Ducati (« 474,59 € », « 1.234,50 », 12.5, « - ») → numérique ; null si illisible.
-- Remplace la version de 20260921100000 (même signature, plus tolérante : devise et espaces).
create or replace function public._dc_num(_v jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := regexp_replace(coalesce(public._dc_txt(_v), ''), '[^0-9,.\-]', '', 'g');
begin
  if s = '' or s = '-' then return null; end if;
  if s ~ ',' and s ~ '\.' then s := replace(s, '.', ''); end if;  -- 1.234,50
  s := replace(s, ',', '.');
  if s !~ '^-?\d+(\.\d+)?$' then return null; end if;
  return s::numeric;
end $$;
revoke all on function public._dc_num(jsonb) from public, anon, authenticated;

-- Compteurs de lot pour les produits
alter table public.ducati_catalog_import_batches
  add column if not exists products_imported integer not null default 0,
  add column if not exists variants_imported integer not null default 0,
  add column if not exists products_skipped  integer not null default 0;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.ducati_catalog_products (
  code             text primary key,          -- code produit Ducati (ACC000014, APP000189)
  kind             text not null check (kind in ('accessory', 'apparel')),
  ducati_id        text,                      -- id interne Ducati
  name             text,
  description      text,
  category_path    text,                      -- ex. « 0/402/403 » (vêtements), « 530 » (accessoires)
  category_label   text,
  family_codes     text[] not null default '{}',  -- familles où le produit est listé
  gender           text,                      -- vêtements : Uomo / Donna / Unisex / Bambino
  image_url        text,                      -- miniature
  images           jsonb not null default '[]'::jsonb,  -- [{url, zoom, thumb}]
  price_ht         numeric(12, 2),            -- prix Ducati (information)
  price_ttc        numeric(12, 2),
  price_seen_at    timestamptz,
  discount_group   text,
  last_chance      boolean,
  archived         boolean,
  attributes       jsonb not null default '{}'::jsonb,  -- {code: valeur} (compact)
  detail_loaded_at timestamptz,               -- null = fiche pas encore lue
  updated_at       timestamptz not null default now()
);
create index if not exists idx_dc_products_kind on public.ducati_catalog_products(kind);

create table if not exists public.ducati_catalog_product_variants (
  product_code    text not null references public.ducati_catalog_products(code) on delete cascade,
  sku_norm        text not null,              -- ducati_catalog_norm_ref(sku)
  sku             text not null,              -- référence vendable (ex. 981085439)
  variant_code    text,
  name            text,
  description     text,
  size            text,                       -- APP_TAGLIA
  color           text,                       -- APP_COLOR
  mother_code     text,                       -- APP_CODICE_MADRE
  collection_year integer,                    -- APP_COLLECTIONYEAR
  price_ht        numeric(12, 2),             -- information
  price_ttc       numeric(12, 2),
  price_seen_at   timestamptz,
  is_kit          boolean,
  replaced        boolean,
  archived        boolean,
  attributes      jsonb not null default '{}'::jsonb,
  images          jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  primary key (product_code, sku_norm)
);
create index if not exists idx_dc_variants_sku on public.ducati_catalog_product_variants(sku_norm);

create table if not exists public.ducati_catalog_product_applicabilities (
  product_code   text not null references public.ducati_catalog_products(code) on delete cascade,
  sku_norm       text not null,
  hierarchy_path text not null,               -- ex. « 1/20198/20278/20279/20280 »
  family         text,
  supermodel     text,
  model          text,
  model_year     integer,
  is_europe      boolean not null default true,
  primary key (product_code, sku_norm, hierarchy_path)
);
create index if not exists idx_dc_applic_model on public.ducati_catalog_product_applicabilities(model, model_year);

comment on table public.ducati_catalog_products is 'Catalogue Ducati : accessoires et vêtements (e-catalog). Prix = information ; aucun article DMS créé.';
comment on table public.ducati_catalog_product_variants is 'Catalogue Ducati : références vendables d''un produit (vêtements : une référence par taille / couleur).';
comment on table public.ducati_catalog_product_applicabilities is 'Catalogue Ducati : compatibilité d''un accessoire avec un modèle / millésime.';

alter table public.ducati_catalog_products enable row level security;
alter table public.ducati_catalog_product_variants enable row level security;
alter table public.ducati_catalog_product_applicabilities enable row level security;

drop policy if exists dc_products_read on public.ducati_catalog_products;
create policy dc_products_read on public.ducati_catalog_products
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_variants_read on public.ducati_catalog_product_variants;
create policy dc_variants_read on public.ducati_catalog_product_variants
  for select to authenticated using ((select public.ducati_catalog_is_staff()));
drop policy if exists dc_applic_read on public.ducati_catalog_product_applicabilities;
create policy dc_applic_read on public.ducati_catalog_product_applicabilities
  for select to authenticated using ((select public.ducati_catalog_is_staff()));

revoke all on public.ducati_catalog_products from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_products from authenticated;
revoke all on public.ducati_catalog_product_variants from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_product_variants from authenticated;
revoke all on public.ducati_catalog_product_applicabilities from anon;
revoke insert, update, delete, truncate on public.ducati_catalog_product_applicabilities from authenticated;

-- ---------------------------------------------------------------------
-- 2. Ingestion (charge normalisée par l'extension, voir catalog-core.js normalizeProduct)
--   [ { code, kind, ducatiId, name, description, categoryPath, categoryLabel, familyCodes: [],
--       gender, imageUrl, images: [], priceHt, priceTtc, discountGroup, lastChance, archived,
--       attributes: {}, variants: [ { sku, code, name, description, size, color, motherCode,
--       collectionYear, priceHt, priceTtc, isKit, replaced, archived, attributes: {}, images: [],
--       applicabilities: [ { path, family, superModel, model, modelYear, isEurope } ] } ] } ]
-- Variantes et compatibilités d'un produit remplacées en bloc (idempotent).
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_ingest_products(_batch uuid, _products jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.ducati_catalog_import_batches;
  n_p integer := 0; n_v integer := 0; n_a integer := 0;
begin
  b := public._dc_batch_guard(_batch);
  if jsonb_typeof(coalesce(_products, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Produits invalides (tableau attendu)' using errcode = '22023';
  end if;

  drop table if exists _dc_p, _dc_v;
  create temp table _dc_p on commit drop as
    select distinct on (public._dc_txt(p.v -> 'code')) public._dc_txt(p.v -> 'code') as code, p.v as v
      from jsonb_array_elements(coalesce(_products, '[]'::jsonb)) with ordinality p(v, o)
     where public._dc_txt(p.v -> 'code') is not null
       and public._dc_txt(p.v -> 'kind') in ('accessory', 'apparel')
     order by public._dc_txt(p.v -> 'code'), p.o desc;

  create temp table _dc_v on commit drop as
    select distinct on (p.code, public.ducati_catalog_norm_ref(public._dc_txt(v.v -> 'sku')))
           p.code as product_code, public.ducati_catalog_norm_ref(public._dc_txt(v.v -> 'sku')) as sku_norm,
           public._dc_txt(v.v -> 'sku') as sku, v.v as v
      from _dc_p p, jsonb_array_elements(case when jsonb_typeof(p.v -> 'variants') = 'array' then p.v -> 'variants' else '[]'::jsonb end)
           with ordinality v(v, o)
     where public.ducati_catalog_norm_ref(public._dc_txt(v.v -> 'sku')) is not null
     order by p.code, public.ducati_catalog_norm_ref(public._dc_txt(v.v -> 'sku')), v.o;

  insert into public.ducati_catalog_products as t
    (code, kind, ducati_id, name, description, category_path, category_label, family_codes, gender,
     image_url, images, price_ht, price_ttc, price_seen_at, discount_group, last_chance, archived,
     attributes, detail_loaded_at, updated_at)
  select p.code, public._dc_txt(p.v -> 'kind'), public._dc_txt(p.v -> 'ducatiId'),
         public._dc_txt(p.v -> 'name'), public._dc_txt(p.v -> 'description'),
         public._dc_txt(p.v -> 'categoryPath'), public._dc_txt(p.v -> 'categoryLabel'),
         coalesce((select array_agg(distinct x) from jsonb_array_elements_text(
                     case when jsonb_typeof(p.v -> 'familyCodes') = 'array' then p.v -> 'familyCodes' else '[]'::jsonb end) x), '{}'),
         public._dc_txt(p.v -> 'gender'), public._dc_txt(p.v -> 'imageUrl'),
         case when jsonb_typeof(p.v -> 'images') = 'array' then p.v -> 'images' else '[]'::jsonb end,
         public._dc_num(p.v -> 'priceHt'), public._dc_num(p.v -> 'priceTtc'),
         case when public._dc_num(p.v -> 'priceHt') is not null or public._dc_num(p.v -> 'priceTtc') is not null then now() end,
         public._dc_txt(p.v -> 'discountGroup'), public._dc_bool(p.v -> 'lastChance'), public._dc_bool(p.v -> 'archived'),
         case when jsonb_typeof(p.v -> 'attributes') = 'object' then p.v -> 'attributes' else '{}'::jsonb end,
         now(), now()
    from _dc_p p
  on conflict (code) do update set
    kind = excluded.kind, ducati_id = coalesce(excluded.ducati_id, t.ducati_id),
    name = coalesce(excluded.name, t.name), description = coalesce(excluded.description, t.description),
    category_path = coalesce(excluded.category_path, t.category_path),
    category_label = coalesce(excluded.category_label, t.category_label),
    family_codes = (select coalesce(array_agg(distinct x), '{}') from unnest(t.family_codes || excluded.family_codes) x),
    gender = coalesce(excluded.gender, t.gender), image_url = coalesce(excluded.image_url, t.image_url),
    images = case when jsonb_array_length(excluded.images) > 0 then excluded.images else t.images end,
    price_ht = coalesce(excluded.price_ht, t.price_ht), price_ttc = coalesce(excluded.price_ttc, t.price_ttc),
    price_seen_at = coalesce(excluded.price_seen_at, t.price_seen_at),
    discount_group = coalesce(excluded.discount_group, t.discount_group),
    last_chance = coalesce(excluded.last_chance, t.last_chance), archived = coalesce(excluded.archived, t.archived),
    attributes = excluded.attributes, detail_loaded_at = now(), updated_at = now();
  get diagnostics n_p = row_count;

  delete from public.ducati_catalog_product_applicabilities where product_code in (select code from _dc_p);
  delete from public.ducati_catalog_product_variants where product_code in (select code from _dc_p);

  insert into public.ducati_catalog_product_variants
    (product_code, sku_norm, sku, variant_code, name, description, size, color, mother_code, collection_year,
     price_ht, price_ttc, price_seen_at, is_kit, replaced, archived, attributes, images, updated_at)
  select v.product_code, v.sku_norm, v.sku, public._dc_txt(v.v -> 'code'), public._dc_txt(v.v -> 'name'),
         public._dc_txt(v.v -> 'description'), public._dc_txt(v.v -> 'size'), public._dc_txt(v.v -> 'color'),
         public._dc_txt(v.v -> 'motherCode'), public._dc_int(v.v -> 'collectionYear'),
         public._dc_num(v.v -> 'priceHt'), public._dc_num(v.v -> 'priceTtc'),
         case when public._dc_num(v.v -> 'priceHt') is not null or public._dc_num(v.v -> 'priceTtc') is not null then now() end,
         public._dc_bool(v.v -> 'isKit'), public._dc_bool(v.v -> 'replaced'), public._dc_bool(v.v -> 'archived'),
         case when jsonb_typeof(v.v -> 'attributes') = 'object' then v.v -> 'attributes' else '{}'::jsonb end,
         case when jsonb_typeof(v.v -> 'images') = 'array' then v.v -> 'images' else '[]'::jsonb end,
         now()
    from _dc_v v;
  get diagnostics n_v = row_count;

  insert into public.ducati_catalog_product_applicabilities
    (product_code, sku_norm, hierarchy_path, family, supermodel, model, model_year, is_europe)
  select distinct on (v.product_code, v.sku_norm, public._dc_txt(a.v -> 'path'))
         v.product_code, v.sku_norm, public._dc_txt(a.v -> 'path'),
         public._dc_txt(a.v -> 'family'), public._dc_txt(a.v -> 'superModel'), public._dc_txt(a.v -> 'model'),
         public._dc_int(a.v -> 'modelYear'), coalesce(public._dc_bool(a.v -> 'isEurope'), true)
    from _dc_v v, jsonb_array_elements(case when jsonb_typeof(v.v -> 'applicabilities') = 'array' then v.v -> 'applicabilities' else '[]'::jsonb end) a(v)
   where public._dc_txt(a.v -> 'path') is not null
   order by v.product_code, v.sku_norm, public._dc_txt(a.v -> 'path');
  get diagnostics n_a = row_count;

  update public.ducati_catalog_import_batches set
    products_imported = products_imported + n_p,
    variants_imported = variants_imported + n_v,
    last_position = jsonb_build_object('productCode', (select max(code) from _dc_p)),
    updated_at = now()
  where id = _batch;

  return jsonb_build_object('products', n_p, 'variants', n_v, 'applicabilities', n_a);
end $$;
revoke all on function public.ducati_catalog_ingest_products(uuid, jsonb) from public, anon;
grant execute on function public.ducati_catalog_ingest_products(uuid, jsonb) to authenticated;

-- Produits déjà lus (fiche complète) : l'extension ne relit pas leur fiche.
create or replace function public.ducati_catalog_known_products(_batch uuid, _kind text, _codes text[])
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.ducati_catalog_import_batches; v text[]; n integer;
begin
  b := public._dc_batch_guard(_batch);
  select coalesce(array_agg(code), '{}') into v
    from public.ducati_catalog_products
   where kind = _kind and detail_loaded_at is not null and code = any(coalesce(_codes, '{}'));
  n := coalesce(array_length(v, 1), 0);
  update public.ducati_catalog_import_batches set products_skipped = products_skipped + n, updated_at = now()
   where id = _batch;
  return v;
end $$;
revoke all on function public.ducati_catalog_known_products(uuid, text, text[]) from public, anon;
grant execute on function public.ducati_catalog_known_products(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Entrée du catalogue pour une référence (SKU Shopify « 98… », référence collée…)
-- Recherche exacte sur la forme compacte ; lecture seule.
-- ---------------------------------------------------------------------
create or replace function public.ducati_catalog_product_for_reference(_reference text)
returns table (
  kind text, product_code text, product_name text, description text, category_label text, gender text,
  sku text, size text, color text, collection_year integer,
  price_ht numeric, price_ttc numeric, price_seen_at timestamptz,
  image_url text, images jsonb, models text[]
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := public.ducati_catalog_norm_ref(_reference);
begin
  if not public.ducati_catalog_is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if k is null then return; end if;
  return query
  select p.kind, p.code, p.name, p.description, p.category_label, p.gender,
         v.sku, v.size, v.color, v.collection_year,
         coalesce(v.price_ht, p.price_ht), coalesce(v.price_ttc, p.price_ttc), coalesce(v.price_seen_at, p.price_seen_at),
         p.image_url,
         case when jsonb_array_length(v.images) > 0 then v.images else p.images end,
         (select array_agg(distinct concat_ws(' ', a.model, a.model_year::text) order by concat_ws(' ', a.model, a.model_year::text))
            from public.ducati_catalog_product_applicabilities a
           where a.product_code = v.product_code and a.sku_norm = v.sku_norm and a.is_europe)
    from public.ducati_catalog_product_variants v
    join public.ducati_catalog_products p on p.code = v.product_code
   where v.sku_norm = k
   order by p.kind, p.code
   limit 5;
end $$;
revoke all on function public.ducati_catalog_product_for_reference(text) from public, anon;
grant execute on function public.ducati_catalog_product_for_reference(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. État connu et compteurs, étendus aux produits (mêmes signatures)
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
    'drawingsWithParts', (select count(*) from public.ducati_catalog_drawings where parts_loaded_at is not null),
    'products', (select count(*) from public.ducati_catalog_products where detail_loaded_at is not null)
  );
end $$;

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
    'parts', (select count(*) from public.ducati_catalog_parts),
    'accessories', (select count(*) from public.ducati_catalog_products where kind = 'accessory'),
    'apparel', (select count(*) from public.ducati_catalog_products where kind = 'apparel'),
    'variants', (select count(*) from public.ducati_catalog_product_variants)
  );
end $$;
