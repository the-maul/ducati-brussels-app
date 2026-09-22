-- =====================================================================
-- Missions 03 + 06 — UN SEUL CATALOGUE (décision M-25, réécrite le 21/09 après le retour de Simon)
--
-- « Je veux un seul catalogue, avec le Shopify lié… si des produits n'existent pas encore on les crée
--  dans la base… comment Shopify peut avoir des produits qui ne sont pas dans la base ? » (Simon, 21/09)
--
-- Le catalogue = les articles du DMS. Cette migration (après 20260921200000) :
--   1. marque les articles repris de G8 (badge « G8 » : article_links, sorte g8) ;
--   2. CRÉE LES ARTICLES MANQUANTS — article_links_create_missing(société, portée, limite, variante) :
--      * référence du catalogue pièces Ducati sans article → article type A en LIBRAIRIE (non stocké tant
--        qu'il n'est pas réceptionné, glossaire « Librairie », B1), désignation FR du catalogue, prix public
--        Ducati (PV TTC = prix TTC Ducati, PV HT = prix HT Ducati ; aussi en PPC), à compléter s'il n'a pas de prix ;
--      * accessoire / vêtement du catalogue Ducati (quand il sera chargé) → idem, une référence par taille/couleur ;
--      * variante Shopify sans article → UN ARTICLE PAR VARIANTE : référence = SKU (doublon de SKU : « -2 », « -3 ») ;
--        pas de SKU → code « SHOP-<n° de variante> », article à compléter et lien « à valider » ; désignation =
--        titre + option ; prix = prix du site TTC (W-7, W-10, W-11) ; stock de départ = stock Shopify par un
--        mouvement « inventaire » append-only (origine import:shopify, B7) ; lien Shopify « relié ». Les pièces
--        d'occasion « …OCC » ont leur propre article. Les MOTOS du site ne deviennent pas des pièces ;
--      * les prix passent par le déclencheur trace_price_change (price_changes, origine import:…), jamais d'UPDATE
--        non tracé (règle 3) ; chaque article créé est tracé dans events (article_create_missing) + une synthèse.
--      Relançable et idempotente : ne recrée jamais un article existant (référence normalisée), ne touche jamais
--      un article existant, puis relance le rapprochement (liens Ducati, occasion).
--   3. motos du site → propositions de lien vers la fiche véhicule (VIN, modèle) « à valider » (shopify_vehicle_links) ;
--   4. alerte « Produit du site sans article » (shopify_unlinked_products) : le DMS est la source.
-- UN SEUL STOCK : le stock est celui de l'article du DMS ; le site l'affiche (synchronisation W-8).
-- Rien n'est écrit sur Shopify.
-- =====================================================================

-- 0. Moto du site (ne devient jamais un article pièce) ---------------------
create or replace function public._shopify_is_moto(_product_type text, _sku text, _price numeric)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(_product_type, '') in ('Moto d''occasion', 'Moto neuve', 'Motorcycles & Scooters', 'Voiture occasion')
      or (public.ducati_catalog_norm_ref(_sku) is null and coalesce(_price, 0) >= 1500);
$$;

-- 1. Badge G8 : articles repris de G8 (import du 15/07/2026, sans auteur) -------
insert into public.article_links (company_id, article_id, target_kind, target_ref, status, method, score, reason, details, is_auto)
select a.company_id, a.id, 'g8', a.reference, 'lie', 'import_g8', 100, 'Article repris de G8 (import du 15/07/2026)',
       '{}'::jsonb, false
  from public.articles a
 where a.created_at >= '2026-07-15' and a.created_at < '2026-07-16' and a.created_by is null
on conflict do nothing;

insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
select c.id, null, 'article_g8_badge', 'article_links', c.id::text, 'system', null,
       jsonb_build_object('articles', (select count(*) from public.article_links l where l.company_id = c.id and l.target_kind = 'g8'))
  from public.companies c;

-- 2. Motos du site ↔ fiches véhicule ------------------------------------
create table if not exists public.shopify_vehicle_links (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  shopify_variant_id text not null,
  vehicle_id         uuid not null references public.vehicles(id) on delete cascade,
  status             text not null check (status in ('lie', 'a_valider', 'rejete')),
  method             text not null,
  score              smallint not null default 0 check (score between 0 and 100),
  reason             text,
  is_auto            boolean not null default true,
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, shopify_variant_id, vehicle_id)
);
comment on table public.shopify_vehicle_links is
  'Moto du site Shopify ↔ fiche véhicule (VIN, modèle) : propositions à valider ; une moto n''est jamais un article pièce.';
create unique index if not exists uq_shopify_vehicle_links_lie
  on public.shopify_vehicle_links (company_id, shopify_variant_id) where status = 'lie';
create index if not exists idx_shopify_vehicle_links_vehicle on public.shopify_vehicle_links (vehicle_id);
alter table public.shopify_vehicle_links enable row level security;
revoke all on public.shopify_vehicle_links from anon;
revoke insert, update, delete on public.shopify_vehicle_links from authenticated;
grant select on public.shopify_vehicle_links to authenticated;
drop policy if exists shopify_vehicle_links_select on public.shopify_vehicle_links;
create policy shopify_vehicle_links_select on public.shopify_vehicle_links for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

create or replace function public.shopify_vehicle_links_refresh(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_new int := 0; n_removed int := 0;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  drop table if exists pg_temp._vl_want;
  create temp table _vl_want on commit drop as
  with m as (
    select p.shopify_variant_id as v,
           upper(concat_ws(' ', p.product_title, p.variant_title, p.sku, p.barcode, replace(coalesce(p.handle, ''), '-', ' '))) as txt,
           lower(regexp_replace(public.unaccent(coalesce(p.product_title, '')), '[^a-zA-Z0-9]', '', 'g')) as title_n
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       and public._shopify_is_moto(p.product_type, p.sku, p.price)
  ), vin as (
    select distinct on (m.v, ve.id) m.v, ve.id as vehicle_id, 'vin'::text as method, 95 as score,
           'VIN ' || ve.vin || ' cité dans le produit du site' as reason
      from m cross join lateral regexp_split_to_table(m.txt, '[^A-Z0-9]+') tok
      join public.vehicles ve on ve.company_id = _company and upper(ve.vin) = tok
     where length(tok) = 17
  ), mdl as (
    select m.v, ve.id as vehicle_id, 'modele'::text as method, 50 as score,
           'Modèle « ' || ve.model || ' » (' || ve.status::text || ') dans le titre du site' as reason,
           row_number() over (partition by m.v order by length(ve.model) desc, ve.created_at desc) as rk
      from m join public.vehicles ve
        on ve.company_id = _company and ve.status::text <> 'vendu' and ve.model is not null
       and length(regexp_replace(public.unaccent(ve.model), '[^a-zA-Z0-9]', '', 'g')) >= 4
       and m.title_n like '%' || lower(regexp_replace(public.unaccent(ve.model), '[^a-zA-Z0-9]', '', 'g')) || '%'
  )
  select v, vehicle_id, method, score, reason from vin
  union all
  select v, vehicle_id, method, score, reason from mdl
   where rk <= 5 and not exists (select 1 from vin where vin.v = mdl.v and vin.vehicle_id = mdl.vehicle_id);

  with d as (
    delete from public.shopify_vehicle_links l
     where l.company_id = _company and l.is_auto and l.status = 'a_valider'
       and not exists (select 1 from _vl_want w where w.v = l.shopify_variant_id and w.vehicle_id = l.vehicle_id)
    returning 1)
  select count(*) into n_removed from d;
  with i as (
    insert into public.shopify_vehicle_links as l (company_id, shopify_variant_id, vehicle_id, status, method, score, reason)
    select _company, w.v, w.vehicle_id, 'a_valider', w.method, w.score, w.reason from _vl_want w
     where not exists (select 1 from public.shopify_vehicle_links x where x.company_id = _company
                         and x.shopify_variant_id = w.v and x.status = 'lie')
    on conflict (company_id, shopify_variant_id, vehicle_id) do update
      set method = excluded.method, score = excluded.score, reason = excluded.reason, updated_at = now()
      where l.is_auto and l.status = 'a_valider'
        and (l.method, l.score, l.reason) is distinct from (excluded.method, excluded.score, excluded.reason)
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted) into n_new from i;
  return jsonb_build_object('new', n_new, 'removed', n_removed,
    'pending', (select count(*) from public.shopify_vehicle_links where company_id = _company and status = 'a_valider'),
    'motos', (select count(*) from public.shopify_products p where p.company_id = _company and p.removed_at is null
                and public._shopify_is_moto(p.product_type, p.sku, p.price)));
end $$;

create or replace function public.shopify_vehicle_links_review(_company uuid, _status text default 'a_valider')
returns table (id uuid, shopify_variant_id text, product_title text, variant_title text, price numeric, shop_status text,
               image_url text, vehicle_id uuid, vin text, model text, model_year integer, color text, vehicle_status text,
               status text, method text, score smallint, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.id, l.shopify_variant_id, p.product_title, p.variant_title, p.price, p.status, p.image_url,
         ve.id, ve.vin, ve.model, ve.model_year::integer, ve.color, ve.status::text,
         l.status, l.method, l.score, l.reason
    from public.shopify_vehicle_links l
    join public.vehicles ve on ve.id = l.vehicle_id
    left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
   where l.company_id = _company and l.status = coalesce(_status, 'a_valider')
   order by p.product_title, l.score desc
   limit 500;
end $$;

create or replace function public.shopify_vehicle_links_decide(_company uuid, _ids uuid[], _decision text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; skipped int := 0;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _decision not in ('lie', 'rejete') then
    raise exception 'Décision inconnue : %', _decision using errcode = '22023';
  end if;
  for r in select * from public.shopify_vehicle_links where company_id = _company and id = any (_ids) for update loop
    if r.status = _decision then continue; end if;
    if _decision = 'lie' and exists (select 1 from public.shopify_vehicle_links x where x.company_id = _company
                                       and x.shopify_variant_id = r.shopify_variant_id and x.status = 'lie' and x.id <> r.id) then
      skipped := skipped + 1; continue;
    end if;
    update public.shopify_vehicle_links set status = _decision, is_auto = false, decided_by = auth.uid(), decided_at = now(),
           updated_at = now() where id = r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), case when _decision = 'lie' then 'shopify_vehicle_link_accept' else 'shopify_vehicle_link_reject' end,
            'shopify_vehicle_links', r.id::text, 'screen',
            jsonb_build_object('status', r.status, 'vehicle_id', r.vehicle_id, 'variant', r.shopify_variant_id, 'method', r.method),
            jsonb_build_object('status', _decision));
    n := n + 1;
  end loop;
  return jsonb_build_object('done', n, 'skipped', skipped);
end $$;

-- 3. Créer les articles manquants -------------------------------------------
-- _scope : 'all' | 'ducati_parts' | 'ducati_products' | 'shopify' ; _limit : nombre maximum par sorte
-- (écran : petits lots) ; _variant : une seule variante Shopify (bouton « Créer l'article »).
create or replace function public.article_links_create_missing(
  _company uuid, _scope text default 'all', _limit integer default null, _variant text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := clock_timestamp();
  lim integer := least(greatest(coalesce(_limit, 1000000), 1), 1000000);
  n_dp int := 0; n_dv int := 0; n_sh int := 0; n_nosku int := 0; n_occ int := 0; n_dup int := 0;
  n_stock int := 0; q_stock numeric := 0; n_price int := 0; n_toc int := 0;
  n_skip_existing int := 0; n_moto int := 0;
  st jsonb; rf jsonb;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if coalesce(_scope, '') not in ('all', 'ducati_parts', 'ducati_products', 'shopify') then
    raise exception 'Portée inconnue : %', _scope using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('article_links_create:' || _company::text));

  drop table if exists pg_temp._cm_new, pg_temp._cm_sv;
  create temp table _cm_new (
    article_id uuid, source text, reference text, price_ttc numeric, price_ht numeric, stock numeric,
    variant text, link_status text, match_via text, family text
  ) on commit drop;

  -- A. Pièces du catalogue Ducati sans article → librairie
  if _variant is null and _scope in ('all', 'ducati_parts') then
    with src as (
      select p.reference_norm, p.reference, p.description, p.catalog_price_ht, p.catalog_price_ttc
        from public.ducati_catalog_parts p
       where not exists (select 1 from public.articles a where a.company_id = _company
                           and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = p.reference_norm)
       order by p.reference_norm
       limit lim
    ), ins as (
      insert into public.articles (company_id, reference, designation, brand, mgmt_type, is_library, is_active,
                                   vat_rate, publishable, ppc_ht, ppc_ttc, to_complete, to_complete_source)
      select _company, s.reference, coalesce(nullif(btrim(s.description), ''), s.reference), 'Ducati', 'A', true, true,
             21, false, nullif(s.catalog_price_ht, 0), nullif(s.catalog_price_ttc, 0),
             coalesce(s.catalog_price_ttc, 0) <= 0,
             case when coalesce(s.catalog_price_ttc, 0) <= 0 then 'catalogue_ducati' end
        from src s
      on conflict (company_id, reference) do nothing
      returning id, reference)
    insert into _cm_new (article_id, source, reference, price_ttc, price_ht, family)
    select i.id, 'catalogue_ducati', i.reference, nullif(s.catalog_price_ttc, 0), nullif(s.catalog_price_ht, 0), 'piece'
      from ins i join src s on s.reference = i.reference;
    get diagnostics n_dp = row_count;
  end if;

  -- B. Accessoires / vêtements du catalogue Ducati sans article → librairie (une référence par taille / couleur)
  if _variant is null and _scope in ('all', 'ducati_products') then
    with src as (
      select distinct on (v.sku_norm) v.sku_norm, v.sku, v.size, v.color,
             btrim(concat_ws(' — ', coalesce(nullif(btrim(v.name), ''), pr.name, v.sku),
                             nullif(concat_ws(' / ', nullif(v.size, ''), nullif(v.color, '')), ''))) as designation,
             coalesce(v.price_ht, pr.price_ht) as price_ht, coalesce(v.price_ttc, pr.price_ttc) as price_ttc, pr.kind
        from public.ducati_catalog_product_variants v
        join public.ducati_catalog_products pr on pr.code = v.product_code
       where not coalesce(v.archived, false)
         and not exists (select 1 from public.articles a where a.company_id = _company
                           and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = v.sku_norm)
       order by v.sku_norm, v.product_code
       limit lim
    ), ins as (
      insert into public.articles (company_id, reference, designation, brand, mgmt_type, is_library, is_active,
                                   vat_rate, publishable, size, color, ppc_ht, ppc_ttc, to_complete, to_complete_source)
      select _company, s.sku, s.designation, 'Ducati', 'A', true, true, 21, false, nullif(s.size, ''), nullif(s.color, ''),
             nullif(s.price_ht, 0), nullif(coalesce(s.price_ttc, round(s.price_ht * 1.21, 2)), 0),
             coalesce(s.price_ttc, s.price_ht, 0) <= 0,
             case when coalesce(s.price_ttc, s.price_ht, 0) <= 0 then 'catalogue_ducati' end
        from src s
      on conflict (company_id, reference) do nothing
      returning id, reference)
    insert into _cm_new (article_id, source, reference, price_ttc, price_ht, family)
    select i.id, 'catalogue_ducati', i.reference,
           nullif(coalesce(s.price_ttc, round(s.price_ht * 1.21, 2)), 0), nullif(s.price_ht, 0), s.kind
      from ins i join src s on s.sku = i.reference;
    get diagnostics n_dv = row_count;
  end if;

  -- C. Variantes Shopify sans article → un article par variante
  if _scope in ('all', 'shopify') then
    create temp table _cm_sv on commit drop as
    select p.shopify_variant_id as v, p.sku, nullif(upper(btrim(coalesce(p.sku, ''))), '') as sku_u,
           public.ducati_catalog_norm_ref(p.sku) as sku_n, p.product_title, p.variant_title, p.price,
           p.inventory_quantity as qty, nullif(btrim(p.vendor), '') as vendor, p.synced_at
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       and (_variant is null or p.shopify_variant_id = _variant)
       and not public._shopify_is_moto(p.product_type, p.sku, p.price)
       and (_variant is not null or not exists (select 1 from public.shopify_links sl where sl.company_id = _company
                                                   and sl.shopify_variant_id = p.shopify_variant_id and sl.status = 'ignore'))
       -- déjà relié, ou déjà proposé à un article existant (sauf demande explicite pour cette variante)
       and not exists (select 1 from public.article_links l where l.company_id = _company and l.target_kind = 'shopify_variant'
                         and l.target_ref = p.shopify_variant_id
                         and (l.status = 'lie' or (l.status = 'a_valider' and (_variant is null or l.method = 'creation_sans_sku'))))
       -- le SKU est déjà la référence d'un article : jamais de doublon (« Rattacher »)
       and (public.ducati_catalog_norm_ref(p.sku) is null
            or not exists (select 1 from public.articles a where a.company_id = _company
                             and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = public.ducati_catalog_norm_ref(p.sku)))
     order by p.shopify_variant_id
     limit lim;

    select count(*) into n_skip_existing
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null and _variant is null
       and not public._shopify_is_moto(p.product_type, p.sku, p.price)
       and public.ducati_catalog_norm_ref(p.sku) is not null
       and not exists (select 1 from public.article_links l where l.company_id = _company and l.target_kind = 'shopify_variant'
                         and l.target_ref = p.shopify_variant_id and l.status in ('lie', 'a_valider'))
       and exists (select 1 from public.articles a where a.company_id = _company
                     and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = public.ducati_catalog_norm_ref(p.sku));

    with sv as (
      select s.*,
             count(*) over (partition by s.sku_u) as dup_n,
             row_number() over (partition by s.sku_u order by s.v) as dup_i,
             (select count(*) from public.shopify_products x where x.company_id = _company and x.removed_at is null
                and upper(btrim(x.sku)) = s.sku_u) as store_n
        from _cm_sv s
    ), refs as (
      select sv.*,
             case when sv.sku_u is null then 'SHOP-' || regexp_replace(sv.v, '\D', '', 'g')
                  when sv.dup_n = 1 or sv.dup_i = 1 then sv.sku_u
                  else sv.sku_u || '-' || sv.dup_i end as ref,
             btrim(concat_ws(' — ',
               nullif(btrim(regexp_replace(coalesce(sv.product_title, ''), '^\s*[0-9][0-9A-Z]{5,}\s*-+\s*', '', 'i')), ''),
               nullif(nullif(btrim(regexp_replace(coalesce(sv.variant_title, ''), '\s*-\s*[0-9][0-9A-Z]{6,}\s*$', '')), ''), 'Default Title')
             )) as designation,
             public.ducati_catalog_norm_ref(sv.sku) ~ 'OCC'
               or coalesce(sv.product_title, '') || ' ' || coalesce(sv.variant_title, '') ~* '(\mocc\M|\mocc\.|occasion)' as is_occ
        from sv
    ), ins as (
      insert into public.articles (company_id, reference, designation, brand, mgmt_type, is_library, is_active, vat_rate,
                                   publishable, web_title, to_complete, to_complete_source)
      select _company, r.ref, coalesce(nullif(r.designation, ''), r.ref), coalesce(r.vendor, 'Ducati'), 'A', false, true, 21,
             true, r.product_title, r.sku_u is null, case when r.sku_u is null then 'shopify' end
        from refs r
      on conflict (company_id, reference) do nothing
      returning id, reference)
    insert into _cm_new (article_id, source, reference, price_ttc, stock, variant, link_status, match_via, family)
    select i.id, 'shopify', i.reference, nullif(r.price, 0), greatest(coalesce(r.qty, 0), 0), r.v,
           case when r.sku_u is null then 'a_valider'
                when r.ref = r.sku_u and r.store_n = 1 then 'auto_exact' else 'valide' end,
           case when r.sku_u is not null and r.ref = r.sku_u and r.store_n = 1 then 'sku' end,
           case when r.sku_u is null then 'sans_sku' when r.is_occ then 'occasion'
                when r.dup_n > 1 or r.store_n > 1 then 'doublon_sku' else 'sku' end
      from ins i join refs r on r.ref = i.reference;
    get diagnostics n_sh = row_count;
  end if;

  -- D. Prix de vente : par le déclencheur trace_price_change (price_changes, origine tracée), jamais en silence
  perform set_config('app.price_change_origin', 'import:catalogue_ducati', true);
  update public.articles a set sale_price_ttc = n.price_ttc, sale_price_ht = coalesce(n.price_ht, round(n.price_ttc / 1.21, 2))
    from _cm_new n where n.article_id = a.id and n.source = 'catalogue_ducati' and n.price_ttc > 0;
  get diagnostics n_price = row_count;
  perform set_config('app.price_change_origin', 'import:shopify', true);
  update public.articles a set sale_price_ttc = n.price_ttc,
         sale_price_ht = round(n.price_ttc / (1 + coalesce(nullif(a.vat_rate, 0), 21) / 100), 2)
    from _cm_new n where n.article_id = a.id and n.source = 'shopify' and n.price_ttc > 0;
  get diagnostics n_toc = row_count;
  n_price := n_price + n_toc;
  perform set_config('app.price_change_origin', '', true);

  -- E. Stock de départ = stock Shopify (un seul stock : celui de l'article), mouvement append-only (B7)
  select count(*), coalesce(sum(n.stock), 0) into n_stock, q_stock
    from _cm_new n where n.source = 'shopify' and n.stock > 0;
  perform public.record_stock_move(n.article_id, 'inventaire', n.stock, null, false, null, 'import:shopify',
                                   'Stock de départ Shopify', 'Stock du site repris à la création de l''article')
     from _cm_new n where n.source = 'shopify' and n.stock > 0;

  -- F. Lien Shopify : relié (shopify_links, recopié dans article_links par le déclencheur) ;
  --    sans SKU : article créé, lien « à valider » (la personne confirme avant toute synchronisation)
  insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
  select _company, n.variant, n.article_id, n.link_status, n.match_via,
         case when n.link_status = 'valide' then auth.uid() end, now()
    from _cm_new n where n.source = 'shopify' and n.link_status in ('auto_exact', 'valide')
  on conflict (company_id, shopify_variant_id) do nothing;
  update public.article_links l
     set method = 'creation', reason = 'Article créé depuis le produit du site', updated_at = now()
    from _cm_new n
   where n.source = 'shopify' and l.company_id = _company and l.article_id = n.article_id
     and l.target_kind = 'shopify_variant' and l.target_ref = n.variant and l.status = 'lie';
  insert into public.article_links (company_id, article_id, target_kind, target_ref, status, method, score, reason, details, is_auto)
  select _company, n.article_id, 'shopify_variant', n.variant, 'a_valider', 'creation_sans_sku', 60,
         'Produit du site sans SKU : article créé avec un code « SHOP- », à confirmer', '{}'::jsonb, false
    from _cm_new n where n.source = 'shopify' and n.link_status = 'a_valider'
  on conflict do nothing;

  select count(*) filter (where family = 'sans_sku'), count(*) filter (where family = 'occasion'),
         count(*) filter (where family = 'doublon_sku')
    into n_nosku, n_occ, n_dup
    from _cm_new where source = 'shopify';

  -- G. Traces : une ligne par article créé + une synthèse
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  select _company, auth.uid(), 'article_create_missing', 'articles', n.article_id::text, 'import', null,
         jsonb_build_object('reference', n.reference, 'source', n.source, 'family', n.family,
                            'shopify_variant', n.variant, 'price_ttc', n.price_ttc, 'stock', n.stock)
    from _cm_new n;

  select count(*) into n_moto from public.shopify_products p
   where p.company_id = _company and p.removed_at is null and public._shopify_is_moto(p.product_type, p.sku, p.price);

  -- H. Liens catalogue (même référence, occasion) : rapprochement relancé ; motos ↔ véhicules
  if exists (select 1 from _cm_new) then rf := public.article_links_refresh(_company); end if;
  if _variant is null then perform public.shopify_vehicle_links_refresh(_company); end if;

  st := jsonb_build_object(
    'ducati_parts', n_dp, 'ducati_products', n_dv, 'shopify', n_sh,
    'shopify_sans_sku', n_nosku, 'shopify_occasion', n_occ, 'shopify_doublon_sku', n_dup,
    'shopify_sku_deja_article', n_skip_existing, 'motos_non_creees', n_moto,
    'prix', n_price, 'mouvements_stock', n_stock, 'pieces_en_stock', q_stock,
    'duration_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    'rapprochement', coalesce(rf, '{}'::jsonb) - 'by_method');
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'article_links_create_missing', 'articles', _company::text,
          case when auth.uid() is null then 'system' else 'screen' end, null,
          st || jsonb_build_object('scope', _scope, 'limit', _limit, 'variant', _variant));
  return st;
end $$;

-- 4. Alerte « Produit du site sans article » (le DMS est la source) --------
create or replace function public.shopify_unlinked_products(_company uuid, _limit integer default 100, _offset integer default 0)
returns table (shopify_variant_id text, product_title text, variant_title text, sku text, price numeric, qty integer,
               shop_status text, image_url text, pending_article_id uuid, pending_article_reference text,
               candidates integer, total_count bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select p.shopify_variant_id, p.product_title, p.variant_title, p.sku, p.price, p.inventory_quantity, p.status, p.image_url,
         c.article_id, a.reference,
         (select count(*)::int from public.article_links l2 where l2.company_id = _company and l2.target_kind = 'shopify_variant'
             and l2.target_ref = p.shopify_variant_id and l2.status = 'a_valider'),
         count(*) over ()
    from public.shopify_products p
    left join lateral (select l.article_id from public.article_links l
                        where l.company_id = _company and l.target_kind = 'shopify_variant'
                          and l.target_ref = p.shopify_variant_id and l.method = 'creation_sans_sku' and l.status = 'a_valider'
                        limit 1) c on true
    left join public.articles a on a.id = c.article_id
   where p.company_id = _company and p.removed_at is null
     and not public._shopify_is_moto(p.product_type, p.sku, p.price)
     and not exists (select 1 from public.shopify_links sl where sl.company_id = _company
                       and sl.shopify_variant_id = p.shopify_variant_id and sl.status = 'ignore')
     and not exists (select 1 from public.article_links l where l.company_id = _company and l.target_kind = 'shopify_variant'
                       and l.target_ref = p.shopify_variant_id and l.status = 'lie')
   order by p.product_title, p.variant_title
   limit least(greatest(coalesce(_limit, 100), 1), 500) offset greatest(coalesce(_offset, 0), 0);
end $$;

-- 5. Droits -----------------------------------------------------------------
revoke all on function public._shopify_is_moto(text, text, numeric) from public, anon;
grant execute on function public._shopify_is_moto(text, text, numeric) to authenticated, service_role;
revoke all on function public.shopify_vehicle_links_refresh(uuid) from public, anon;
grant execute on function public.shopify_vehicle_links_refresh(uuid) to authenticated, service_role;
revoke all on function public.shopify_vehicle_links_review(uuid, text) from public, anon;
grant execute on function public.shopify_vehicle_links_review(uuid, text) to authenticated;
revoke all on function public.shopify_vehicle_links_decide(uuid, uuid[], text) from public, anon;
grant execute on function public.shopify_vehicle_links_decide(uuid, uuid[], text) to authenticated;
revoke all on function public.article_links_create_missing(uuid, text, integer, text) from public, anon;
grant execute on function public.article_links_create_missing(uuid, text, integer, text) to authenticated, service_role;
revoke all on function public.shopify_unlinked_products(uuid, integer, integer) from public, anon;
grant execute on function public.shopify_unlinked_products(uuid, integer, integer) to authenticated;

-- 6. Création des articles manquants (à l'application de la migration) -------
select public.article_links_create_missing(c.id, 'all') from public.companies c;
