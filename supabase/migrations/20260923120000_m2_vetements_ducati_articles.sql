-- =====================================================================
-- Mission 06, carte 7 — VÊTEMENTS Ducati : un article par référence (taille / couleur), décision M-25.
--
-- Le fichier catalogue-ducati-vetements.json (23/09 : 2 563 produits, 13 726 variantes) est chargé par
-- tools/accessories-loader (mêmes fonctions d'import que les accessoires). Cette migration ne fait
-- qu'améliorer ce que la création d'articles écrit pour un vêtement ou un accessoire :
--   * désignation = nom du produit + taille / couleur / version (« Ducati Corse C7 — 46 / perforé ») ;
--   * note = repères Ducati : catégorie (« PERFORMANCE WEAR / Cuir »), genre, année de collection,
--     familles de motos, « hors production » (partStatus F) ;
--   * la fiche article montre en plus la catégorie, le genre, les familles, la version et la collection.
-- Le reste est inchangé : article de type A en LIBRAIRIE (non stocké tant qu'il n'est pas reçu, B1),
-- prix public Ducati (PV TTC = prix TTC Ducati, PV HT = prix HT) posé par price_changes (origine
-- import:catalogue_ducati), jamais d'article existant modifié, relançable sans doublon, traces events.
-- Les références retirées du catalogue Ducati (archivées) restent consultables mais ne créent pas d'article.
--
-- Additif : deux fonctions redéfinies (create or replace). Aucune donnée écrite par la migration.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.article_links_create_missing(_company uuid, _scope text DEFAULT 'all'::text, _limit integer DEFAULT NULL::integer, _variant text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
             -- vêtements : nom du produit + taille / couleur / version (« Ducati Corse C7 — 46 / perforé »)
             btrim(concat_ws(' — ', coalesce(nullif(btrim(v.name), ''), pr.name, v.sku),
                             nullif(concat_ws(' / ', nullif(v.size, ''), nullif(v.color, ''),
                                              nullif(v.attributes ->> 'version', '')), ''))) as designation,
             -- repères Ducati gardés en note (catégorie, genre, collection, familles, hors production)
             nullif(concat_ws(' · ', nullif(pr.category_label, ''), nullif(pr.gender, ''),
                              case when v.collection_year is not null then 'collection ' || v.collection_year end,
                              case when coalesce(array_length(pr.family_codes, 1), 0) > 0
                                   then array_to_string(pr.family_codes, ', ') end,
                              case when v.attributes ->> 'partStatus' = 'F' then 'hors production (Ducati)' end), '') as note,
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
                                   vat_rate, publishable, size, color, note, ppc_ht, ppc_ttc, to_complete, to_complete_source)
      select _company, s.sku, s.designation, 'Ducati', 'A', true, true, 21, false, nullif(s.size, ''), nullif(s.color, ''), s.note,
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
end $function$;

CREATE OR REPLACE FUNCTION public.article_links_for_article(_company uuid, _article uuid)
 RETURNS TABLE(id uuid, target_kind text, target_ref text, status text, method text, score smallint, reason text, is_auto boolean, decided_at timestamp with time zone, decision_note text, info jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  shop_ok boolean := public.is_admin(_company) or public.has_role(_company, 'vendeur');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.id, l.target_kind, l.target_ref, l.status, l.method, l.score, l.reason, l.is_auto, l.decided_at, l.decision_note,
         case l.target_kind
           when 'ducati_part' then (
             select jsonb_build_object(
                      'reference', p.reference, 'description', p.description,
                      'price_ht', p.catalog_price_ht, 'price_ttc', p.catalog_price_ttc, 'price_seen_at', p.price_seen_at,
                      'replaced', p.replaced, 'has_tempario', p.has_tempario,
                      'drawing', (select jsonb_build_object('id', d.id, 'code', d.code, 'description', d.description,
                                                            'thumbnail_url', d.thumbnail_url, 'image_url', coalesce(d.image_url, d.original_image_url))
                                    from public.ducati_catalog_drawing_lines dl
                                    join public.ducati_catalog_drawings d on d.id = dl.drawing_id
                                   where dl.reference_norm = p.reference_norm
                                   order by (d.image_url is null and d.thumbnail_url is null), dl.drawing_id
                                   limit 1))
               from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
           when 'ducati_product' then (
             select jsonb_build_object('reference', v.sku, 'description', coalesce(v.name, pr.name), 'kind', pr.kind,
                                       'size', v.size, 'color', v.color, 'price_ht', coalesce(v.price_ht, pr.price_ht),
                                       'price_ttc', coalesce(v.price_ttc, pr.price_ttc), 'image_url', pr.image_url,
                                       'category', pr.category_label, 'gender', pr.gender,
                                       'families', to_jsonb(pr.family_codes), 'version', v.attributes ->> 'version',
                                       'collection_year', v.collection_year,
                                       'models', (select jsonb_agg(m order by m.family, m.model, m.model_year desc) from (
                                                    select distinct pa.family, pa.model, pa.model_year
                                                      from public.ducati_catalog_product_applicabilities pa
                                                     where pa.sku_norm = l.target_ref and pa.is_europe
                                                     limit 120) m))
               from public.ducati_catalog_product_variants v join public.ducati_catalog_products pr on pr.code = v.product_code
              where v.sku_norm = l.target_ref limit 1)
           else (
             select jsonb_build_object('product_id', sp.shopify_product_id, 'title', sp.product_title,
                                       'variant_title', sp.variant_title, 'handle', sp.handle, 'status', sp.status,
                                       'sku', sp.sku, 'barcode', sp.barcode, 'price', sp.price,
                                       'qty', sp.inventory_quantity, 'image_url', sp.image_url, 'synced_at', sp.synced_at,
                                       'removed', sp.removed_at is not null)
               from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
         end
    from public.article_links l
   where l.company_id = _company and l.article_id = _article
     and (l.target_kind <> 'shopify_variant' or shop_ok)
   order by case l.status when 'lie' then 0 when 'a_valider' then 1 else 2 end, l.target_kind, l.score desc;
end $function$;

-- Aperçu (lecture seule) : ce que le chargeur créera pour les accessoires et vêtements Ducati.
-- Sert au --dry-run du chargeur et à l'écran Rapprochements.
create or replace function public.ducati_products_creation_preview(_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_member(_company) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return (
    with v as (
      select v.sku_norm, pr.kind, coalesce(v.archived, false) as archived,
             exists (select 1 from public.articles a where a.company_id = _company
                       and regexp_replace(upper(a.reference), '[^A-Z0-9]', '', 'g') = v.sku_norm) as has_article
        from public.ducati_catalog_product_variants v
        join public.ducati_catalog_products pr on pr.code = v.product_code
    ), d as (select distinct on (sku_norm) * from v order by sku_norm, archived)
    select jsonb_build_object(
      'references', (select count(*) from d),
      'au_catalogue', (select count(*) from d where not archived),
      'articles_existants', (select count(*) from d where not archived and has_article),
      'articles_a_creer', (select count(*) from d where not archived and not has_article),
      'archivees', (select count(*) from d where archived),
      'par_sorte', coalesce((select jsonb_object_agg(kind, n) from (
          select kind, count(*) filter (where not archived and not has_article) as n from d group by kind) x), '{}'::jsonb),
      'shopify_concernes', (select count(*) from public.shopify_products p
                             where p.company_id = _company and p.removed_at is null
                               and exists (select 1 from d where d.sku_norm = public.ducati_catalog_norm_ref(p.sku))),
      'shopify_sans_lien_ducati', (select count(*) from public.shopify_products p
                             where p.company_id = _company and p.removed_at is null
                               and exists (select 1 from d where d.sku_norm = public.ducati_catalog_norm_ref(p.sku))
                               and not exists (select 1 from public.article_links l
                                                 join public.article_links s on s.article_id = l.article_id
                                                where l.company_id = _company and l.target_kind in ('ducati_part', 'ducati_product')
                                                  and l.status = 'lie' and s.target_kind = 'shopify_variant'
                                                  and s.target_ref = p.shopify_variant_id and s.status = 'lie')))
  );
end $$;
revoke all on function public.ducati_products_creation_preview(uuid) from public, anon;
grant execute on function public.ducati_products_creation_preview(uuid) to authenticated, service_role;

-- Rattrapage des articles déjà créés depuis le catalogue accessoires / vêtements (4 775 le 23/09) :
-- ils ont été créés avant que le chargeur ne lise la taille, la couleur, la version, la catégorie et le
-- genre. Cette fonction complète leur désignation (« Company C4 — 46 / perforé »), leur taille, leur
-- couleur et leur note — UNIQUEMENT pour un article de librairie créé par le catalogue, jamais touché
-- depuis (taille, couleur et note encore vides, désignation encore celle du catalogue). Prix et stock
-- ne sont jamais modifiés. Relançable : un article déjà complété n'est plus repris.
create or replace function public.ducati_products_repair_designations(_company uuid, _limit integer default 5000)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  with cand as (
    select a.id, a.designation,
           btrim(concat_ws(' — ', coalesce(nullif(btrim(v.name), ''), pr.name, v.sku),
                           nullif(concat_ws(' / ', nullif(v.size, ''), nullif(v.color, ''),
                                            nullif(v.attributes ->> 'version', '')), ''))) as designation_new,
           nullif(v.size, '') as size_new, nullif(v.color, '') as color_new,
           nullif(concat_ws(' · ', nullif(pr.category_label, ''), nullif(pr.gender, ''),
                            case when v.collection_year is not null then 'collection ' || v.collection_year end,
                            case when coalesce(array_length(pr.family_codes, 1), 0) > 0
                                 then array_to_string(pr.family_codes, ', ') end,
                            case when v.attributes ->> 'partStatus' = 'F' then 'hors production (Ducati)' end), '') as note_new
      from public.articles a
      join public.article_links l on l.company_id = a.company_id and l.article_id = a.id
       and l.target_kind = 'ducati_product' and l.status = 'lie'
      join public.ducati_catalog_product_variants v on v.sku_norm = l.target_ref
      join public.ducati_catalog_products pr on pr.code = v.product_code
     where a.company_id = _company and a.is_library and a.brand = 'Ducati'
       and a.size is null and a.color is null and a.note is null
       -- désignation encore celle du catalogue (jamais retouchée à l'écran)
       and a.designation = coalesce(nullif(btrim(v.name), ''), pr.name, v.sku)
     limit greatest(coalesce(_limit, 5000), 1)
  ), up as (
    update public.articles a
       set designation = c.designation_new, size = c.size_new, color = c.color_new, note = c.note_new
      from cand c
     where a.id = c.id
       and (c.designation_new, c.size_new, c.color_new, c.note_new) is distinct from (a.designation, a.size, a.color, a.note)
    returning a.id)
  select count(*) into n from up;

  if n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'article_catalog_details', 'articles', _company::text,
            case when auth.uid() is null then 'system' else 'import' end, null,
            jsonb_build_object('completes', n));
  end if;
  return jsonb_build_object('completes', n);
end $$;
revoke all on function public.ducati_products_repair_designations(uuid, integer) from public, anon;
grant execute on function public.ducati_products_repair_designations(uuid, integer) to authenticated, service_role;
