-- =====================================================================
-- Création des articles manquants PAR LOTS — chaque appel doit tenir sous 8 secondes.
--
-- PostgREST se connecte avec le rôle `authenticator` (statement_timeout = 8 s), même avec la clé de
-- service : un appel de `article_links_create_missing` sans limite (4 775 articles, ~20 s) est coupé
-- (57014). Le chargeur et l'écran appellent donc la fonction en boucle avec `_limit`.
--
-- Changement ici : le RAPPROCHEMENT interne (article_links_refresh, ~4 s) n'est plus relancé à chaque
-- lot, mais seulement au DERNIER (quand le lot rend moins de lignes que la limite demandée, ou quand
-- l'appel est fait sans limite). Un lot de 300 articles retombe ainsi à ~1 s au lieu de ~5 s, et le
-- dernier lot pose quand même tous les liens (catalogue Ducati, occasion) : rien à faire en plus.
--
-- Même signature, même comportement visible. Rien n'est écrit par la migration.
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
                             nullif(concat_ws(' / ', nullif(btrim(regexp_replace(v.size, '\s+', ' ', 'g')), ''), nullif(btrim(regexp_replace(v.color, '\s+', ' ', 'g')), ''),
                                              nullif(btrim(regexp_replace(v.attributes ->> 'version', '\s+', ' ', 'g')), '')), ''))) as designation,
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
  -- Rapprochement (≈ 4 s) : seulement au DERNIER lot — un appel avec _limit qui rend un lot plein
  -- sera suivi d'un autre ; on garde chaque appel sous les 8 s de PostgREST.
  if exists (select 1 from _cm_new) and (_limit is null or (n_dp + n_dv + n_sh) < lim) then
    rf := public.article_links_refresh(_company);
  end if;
  if _variant is null and (_limit is null or (n_dp + n_dv + n_sh) < lim) then
    perform public.shopify_vehicle_links_refresh(_company);
  end if;

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
