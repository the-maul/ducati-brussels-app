-- =====================================================================
-- M03 — Marques et modèles de motos TOUTES MARQUES (retour client du 21/09,
-- carte « Inscription en ligne : créer mon compte et choisir ma moto »).
--
-- Besoin : à l'inscription (en ligne, borne) et dans « Ajouter ma moto », le champ
-- « Autre marque » était une saisie libre. Le client demande de pouvoir retrouver
-- plus de marques et de modèles, en citant https://www.motoplanete.com/.
--
-- SOURCE DES DONNÉES (décision M-49, voir docs/bible/decisions.md) :
--   * motoplanete.com n'est PAS recopié. Son robots.txt laisse passer les robots
--     (« Allow: / », Crawl-delay: 10), mais ses Conditions Générales d'Utilisation
--     réservent son contenu, et reprendre une partie substantielle d'une base de
--     données reste interdit sans l'accord du producteur (droit sui generis des
--     bases de données, art. XI.306 du Code de droit économique belge).
--   * Source retenue : vPIC — « Vehicle Product Information Catalog » de la NHTSA
--     (ministère des transports des États-Unis), API publique sans clé, données du
--     domaine public (travail d'une administration fédérale américaine), librement
--     réutilisables. Marques de type « motorcycle » et leurs modèles.
--   * Complétée par les marques et modèles déjà présents dans nos propres fiches
--     moto (`vehicles.brand`, `vehicles.model`) : ce sont nos données.
--   * Chaque ligne porte sa provenance (`source`, `source_ref`) pour pouvoir la
--     recharger ou la retirer.
--
-- SAISIE LIBRE : elle reste possible en dernier recours (« je ne trouve pas ma
-- moto »). Elle n'écrit JAMAIS dans la liste officielle : elle alimente la file
-- `vehicle_brand_submissions` (« marques à valider »), que l'équipe relit.
--
-- Tables vehicle_brands / vehicle_models : GLOBALES (sans company_id), exception
-- assumée comme `ducati_vds` et le catalogue Ducati — une liste de marques est une
-- donnée de référence commune. RLS : lecture par tout compte connecté (équipe ET
-- client du portail, qui en a besoin dans « Ajouter ma moto ») ; aucune écriture par
-- politique (seules les fonctions ci-dessous, ou la clé de service, écrivent).
-- `anon` ne lit rien : l'inscription publique passe par une server function
-- exécutée avec la clé de service (comme signup.functions.ts).
--
-- Additif uniquement. Les seules données écrites ici viennent de nos propres fiches.
-- =====================================================================

create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- 1. Forme normalisée d'un nom de marque ou de modèle
-- ---------------------------------------------------------------------
-- « Moto Guzzi » → « moto guzzi », « CF-Moto » → « cf moto », « R 1250 GS » → « r 1250 gs ».
-- Sert aux clés uniques ET à la recherche (« cfmoto » et « cf moto » se rejoignent
-- en comparant aussi la version sans espaces, voir vehicle_brand_search).
create or replace function public.vehicle_slug(_v text)
returns text language sql immutable set search_path = public, pg_temp as $fn$
  select nullif(btrim(regexp_replace(lower(unaccent(coalesce(_v, ''))), '[^a-z0-9]+', ' ', 'g')), '');
$fn$;
comment on function public.vehicle_slug(text) is
  'Forme normalisee (minuscules, sans accent ni ponctuation) d''un nom de marque ou de modele de moto.';

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  -- Provenance : 'nhtsa_vpic' (domaine public), 'dms' (nos fiches), 'manuel' (l'équipe).
  source        text not null default 'manuel',
  source_ref    text,
  -- Marques mises en avant avant toute recherche (les plus vues au comptoir).
  is_popular    boolean not null default false,
  is_active     boolean not null default true,
  model_count   integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vehicle_brands_source_chk check (source in ('nhtsa_vpic', 'dms', 'manuel'))
);
comment on table public.vehicle_brands is
  'Marques de motos toutes marques (source vPIC/NHTSA, domaine public, + nos propres fiches). Donnee de reference globale.';

create table if not exists public.vehicle_models (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.vehicle_brands(id) on delete cascade,
  slug            text not null,
  name            text not null,
  -- Années de commercialisation si connues (sinon l'écran propose la liste des millésimes).
  year_from       smallint,
  year_to         smallint,
  displacement_cc integer,
  source          text not null default 'manuel',
  source_ref      text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vehicle_models_source_chk check (source in ('nhtsa_vpic', 'dms', 'manuel')),
  constraint vehicle_models_brand_slug_uk unique (brand_id, slug),
  constraint vehicle_models_years_chk check (year_from is null or year_to is null or year_to >= year_from)
);
comment on table public.vehicle_models is
  'Modeles de motos par marque (memes sources que vehicle_brands). Donnee de reference globale.';

create index if not exists vehicle_models_brand_idx on public.vehicle_models (brand_id);
create index if not exists vehicle_models_slug_idx on public.vehicle_models (slug);
create index if not exists vehicle_brands_name_idx on public.vehicle_brands (name);

-- File « marques à valider » : ce qu'un client a tapé à la main. Par société.
create table if not exists public.vehicle_brand_submissions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  brand        text not null,
  brand_slug   text not null,
  model        text,
  model_slug   text,
  model_year   smallint,
  -- D'où vient la saisie : 'inscription' (web), 'borne' (comptoir), 'portail' (espace client).
  origin       text not null,
  contact_id   uuid,
  status       text not null default 'a_valider',
  reviewed_at  timestamptz,
  reviewed_by  uuid,
  created_at   timestamptz not null default now(),
  constraint vehicle_brand_submissions_origin_chk check (origin in ('inscription', 'borne', 'portail')),
  constraint vehicle_brand_submissions_status_chk check (status in ('a_valider', 'integre', 'refuse'))
);
comment on table public.vehicle_brand_submissions is
  'File « marques a valider » : marque ou modele tape librement par un client. N''entre dans vehicle_brands qu''apres relecture de l''equipe.';

create index if not exists vehicle_brand_submissions_queue_idx
  on public.vehicle_brand_submissions (company_id, status, created_at desc);
create index if not exists vehicle_brand_submissions_slug_idx
  on public.vehicle_brand_submissions (company_id, brand_slug);

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.vehicle_brands enable row level security;
alter table public.vehicle_models enable row level security;
alter table public.vehicle_brand_submissions enable row level security;

-- Référence : tout compte connecté lit (l'équipe au comptoir, le client dans « Ajouter ma moto »).
drop policy if exists vehicle_brands_read on public.vehicle_brands;
create policy vehicle_brands_read on public.vehicle_brands
  for select to authenticated using (true);
drop policy if exists vehicle_models_read on public.vehicle_models;
create policy vehicle_models_read on public.vehicle_models
  for select to authenticated using (true);

-- File à valider : l'équipe de la société la lit et la traite.
drop policy if exists vehicle_brand_submissions_read on public.vehicle_brand_submissions;
create policy vehicle_brand_submissions_read on public.vehicle_brand_submissions
  for select to authenticated using (public.is_member(company_id));
drop policy if exists vehicle_brand_submissions_update on public.vehicle_brand_submissions;
create policy vehicle_brand_submissions_update on public.vehicle_brand_submissions
  for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

revoke all on public.vehicle_brands from anon;
revoke all on public.vehicle_models from anon;
revoke all on public.vehicle_brand_submissions from anon;
revoke insert, update, delete, truncate on public.vehicle_brands from authenticated;
revoke insert, update, delete, truncate on public.vehicle_models from authenticated;
revoke insert, delete, truncate on public.vehicle_brand_submissions from authenticated;

-- ---------------------------------------------------------------------
-- 4. Chargement d'un lot de marques et de modèles (clé de service seulement)
-- ---------------------------------------------------------------------
-- Entrée : [{ "brand": "CFMOTO", "source": "nhtsa_vpic", "source_ref": "485",
--             "popular": true, "models": [{ "name": "450SS", "year_from": 2023 }] }, …]
-- Idempotent : relancer le même lot ne crée pas de doublon et met à jour les noms.
create or replace function public.vehicle_catalog_load(_rows jsonb)
returns table (brands integer, models integer)
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r        jsonb;
  m        jsonb;
  v_brand  uuid;
  v_slug   text;
  n_brands integer := 0;
  n_models integer := 0;
begin
  if jsonb_typeof(_rows) <> 'array' then
    raise exception 'vehicle_catalog_load : un tableau est attendu';
  end if;

  for r in select value from jsonb_array_elements(_rows) loop
    v_slug := public.vehicle_slug(r->>'brand');
    continue when v_slug is null;

    insert into public.vehicle_brands (slug, name, source, source_ref, is_popular)
    values (
      v_slug,
      btrim(r->>'brand'),
      coalesce(nullif(r->>'source', ''), 'manuel'),
      nullif(r->>'source_ref', ''),
      coalesce((r->>'popular')::boolean, false)
    )
    on conflict (slug) do update
      set name       = excluded.name,
          source     = excluded.source,
          source_ref = coalesce(excluded.source_ref, vehicle_brands.source_ref),
          is_popular = vehicle_brands.is_popular or excluded.is_popular,
          updated_at = now()
    returning id into v_brand;
    n_brands := n_brands + 1;

    for m in select value from jsonb_array_elements(coalesce(r->'models', '[]'::jsonb)) loop
      continue when public.vehicle_slug(m->>'name') is null;
      insert into public.vehicle_models (brand_id, slug, name, year_from, year_to, displacement_cc, source, source_ref)
      values (
        v_brand,
        public.vehicle_slug(m->>'name'),
        btrim(m->>'name'),
        nullif(m->>'year_from', '')::smallint,
        nullif(m->>'year_to', '')::smallint,
        nullif(m->>'displacement_cc', '')::integer,
        coalesce(nullif(r->>'source', ''), 'manuel'),
        nullif(m->>'source_ref', '')
      )
      on conflict (brand_id, slug) do update
        set name            = excluded.name,
            year_from       = coalesce(excluded.year_from, vehicle_models.year_from),
            year_to         = coalesce(excluded.year_to, vehicle_models.year_to),
            displacement_cc = coalesce(excluded.displacement_cc, vehicle_models.displacement_cc),
            updated_at      = now();
      n_models := n_models + 1;
    end loop;
  end loop;

  update public.vehicle_brands b
     set model_count = c.n, updated_at = now()
    from (select b2.id, (select count(*) from public.vehicle_models vm where vm.brand_id = b2.id) as n
            from public.vehicle_brands b2) c
   where c.id = b.id and b.model_count <> c.n;

  return query select n_brands, n_models;
end;
$fn$;
revoke all on function public.vehicle_catalog_load(jsonb) from public, anon, authenticated;
grant execute on function public.vehicle_catalog_load(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 5. Recherche de marques et de modèles (lecture seule, tout connecté)
-- ---------------------------------------------------------------------
-- `_q` vide → les marques mises en avant, puis les plus fournies en modèles.
create or replace function public.vehicle_brand_search(_q text default null, _limit integer default 40)
returns table (id uuid, name text, model_count integer)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with q as (select public.vehicle_slug(_q) as s)
  select b.id, b.name, b.model_count
    from public.vehicle_brands b, q
   where b.is_active
     and (
       q.s is null
       or b.slug like '%' || q.s || '%'
       or replace(b.slug, ' ', '') like '%' || replace(q.s, ' ', '') || '%'
     )
   order by
     (q.s is not null and b.slug = q.s) desc,
     (q.s is not null and b.slug like q.s || '%') desc,
     b.is_popular desc,
     b.model_count desc,
     b.name
   limit greatest(1, least(coalesce(_limit, 40), 200));
$fn$;
revoke all on function public.vehicle_brand_search(text, integer) from public, anon;
grant execute on function public.vehicle_brand_search(text, integer) to authenticated, service_role;

create or replace function public.vehicle_model_search(_brand uuid, _q text default null, _limit integer default 60)
returns table (id uuid, name text, year_from smallint, year_to smallint, displacement_cc integer)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with q as (select public.vehicle_slug(_q) as s)
  select m.id, m.name, m.year_from, m.year_to, m.displacement_cc
    from public.vehicle_models m, q
   where m.brand_id = _brand
     and m.is_active
     and (
       q.s is null
       or m.slug like '%' || q.s || '%'
       or replace(m.slug, ' ', '') like '%' || replace(q.s, ' ', '') || '%'
     )
   order by
     (q.s is not null and m.slug = q.s) desc,
     (q.s is not null and m.slug like q.s || '%') desc,
     m.name
   limit greatest(1, least(coalesce(_limit, 60), 300));
$fn$;
revoke all on function public.vehicle_model_search(uuid, text, integer) from public, anon;
grant execute on function public.vehicle_model_search(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Enregistrer une saisie libre dans la file « marques à valider »
-- ---------------------------------------------------------------------
-- Appelée avec la clé de service par l'inscription publique et par le portail.
-- Ne touche jamais vehicle_brands. Rien à valider si la marque ET le modèle sont
-- déjà dans la liste officielle, ou si le même client a déjà soumis la même chose.
create or replace function public.vehicle_brand_submit(
  _company uuid, _brand text, _model text default null, _year integer default null,
  _origin text default 'inscription', _contact uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_slug  text := public.vehicle_slug(_brand);
  v_mslug text := public.vehicle_slug(_model);
  v_known uuid;
  v_id    uuid;
begin
  if v_slug is null or _company is null then
    return null;
  end if;
  select b.id into v_known from public.vehicle_brands b where b.slug = v_slug and b.is_active;
  -- Marque connue ET modèle connu (ou pas de modèle tapé) : rien à valider.
  if v_known is not null and (
       v_mslug is null
       or exists (select 1 from public.vehicle_models m
                   where m.brand_id = v_known and m.slug = v_mslug and m.is_active)
     ) then
    return null;
  end if;
  select s.id into v_id
    from public.vehicle_brand_submissions s
   where s.company_id = _company and s.brand_slug = v_slug and s.status = 'a_valider'
     and (_contact is null or s.contact_id is null or s.contact_id = _contact)
     and coalesce(s.model_slug, '') = coalesce(public.vehicle_slug(_model), '')
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.vehicle_brand_submissions
    (company_id, brand, brand_slug, model, model_slug, model_year, origin, contact_id)
  values (
    _company, btrim(_brand), v_slug,
    nullif(btrim(coalesce(_model, '')), ''), public.vehicle_slug(_model),
    case when _year between 1900 and 2100 then _year::smallint end,
    case when _origin in ('inscription', 'borne', 'portail') then _origin else 'inscription' end,
    _contact
  )
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.vehicle_brand_submit(uuid, text, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.vehicle_brand_submit(uuid, text, text, integer, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6 bis. La file se remplit toute seule depuis les motos déclarées
-- ---------------------------------------------------------------------
-- Toute moto « autre marque » déclarée par un client (inscription en ligne, borne du
-- comptoir, « Ajouter ma moto » du portail) passe par `contact_declared_vehicles`.
-- Un déclencheur suffit donc : aucun appel à ajouter dans le code applicatif, et une
-- marque tapée à la main n'entre jamais dans la liste officielle.
create or replace function public.vehicle_declared_to_queue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.kind = 'other_brand' and coalesce(btrim(new.brand), '') <> '' then
    perform public.vehicle_brand_submit(
      new.company_id, new.brand, new.model, new.model_year,
      case new.source when 'comptoir' then 'borne' when 'portail' then 'portail' else 'inscription' end,
      new.contact_id
    );
  end if;
  return null;
end;
$fn$;
revoke all on function public.vehicle_declared_to_queue() from public, anon, authenticated;

drop trigger if exists trg_vehicle_declared_to_queue on public.contact_declared_vehicles;
create trigger trg_vehicle_declared_to_queue
  after insert on public.contact_declared_vehicles
  for each row execute function public.vehicle_declared_to_queue();

-- ---------------------------------------------------------------------
-- 7. Amorçage : les marques et modèles déjà présents dans nos fiches moto
-- ---------------------------------------------------------------------
-- Nos propres données. « AUTRE » et les marques d'automobile ne sont pas filtrées
-- ici : elles existent dans les fiches, l'équipe peut les désactiver (is_active).
insert into public.vehicle_brands (slug, name, source, is_popular)
select public.vehicle_slug(v.brand), min(btrim(v.brand)), 'dms', false
  from public.vehicles v
 where public.vehicle_slug(v.brand) is not null
 group by public.vehicle_slug(v.brand)
on conflict (slug) do nothing;

insert into public.vehicle_models (brand_id, slug, name, source)
select b.id, public.vehicle_slug(v.model), min(btrim(v.model)), 'dms'
  from public.vehicles v
  join public.vehicle_brands b on b.slug = public.vehicle_slug(v.brand)
 where public.vehicle_slug(v.model) is not null
 group by b.id, public.vehicle_slug(v.model)
on conflict (brand_id, slug) do nothing;

update public.vehicle_brands b
   set model_count = (select count(*) from public.vehicle_models vm where vm.brand_id = b.id);
