-- ============================================================================
-- M2 / M5 — Liste « Pièces & Accessoires » : filtre stock CÔTÉ BASE + vignettes
--
-- POURQUOI (deux bugs signalés le 23/09/2026) :
--
-- 1) « Un filtre "stock positif" dans les pièces montre 0 ligne. »
--    L'écran chargeait TOUS les articles de la société (93 104) par
--    `article_stock_list`, puis croisait le stock dans le navigateur.
--    Or PostgREST est configuré avec `max_rows = 1000` : la réponse était
--    silencieusement coupée aux 1 000 premières RÉFÉRENCES dans l'ordre
--    alphabétique — dont AUCUNE n'a de mouvement de stock. Le croisement
--    côté client ne trouvait donc jamais rien : liste vide, sans erreur.
--    Correctif : le filtre stock (tous / positif / négatif / nul) est appliqué
--    en base, avec pagination et comptage exact (`article_list_page`).
--
-- 2) « Je ne vois pas les images de chaque pièce. »
--    Les photos existent en base mais n'étaient lues nulle part dans la liste.
--    `article_list_page` renvoie, pour les seules lignes de la page,
--    la meilleure image disponible et sa provenance. Ordre de préférence
--    (décision M-27, voir docs/bible/decisions.md) :
--      1. photo Ducati du produit  (ducati_catalog_products.image_url)
--      2. photo du site            (shopify_products.image_url)
--      3. vue éclatée Ducati       (ducati_catalog_drawings.thumbnail_url…)
--      4. rien                     (emplacement vide sobre côté écran)
--    Les photos du DMS (Storage, GED) ne sont PAS candidates ici : elles
--    exigent une URL signée par photo, impossible sur une liste de 200 lignes.
--    Elles restent la galerie de la fiche article (onglet Photos).
--
-- NON DESTRUCTIF : aucune donnée touchée, uniquement des index et des fonctions
-- de lecture. `article_stock_list` est recréée avec des paramètres FACULTATIFS
-- (les appels existants à un seul argument continuent de fonctionner).
-- ============================================================================

-- 1. Index -------------------------------------------------------------------

-- Somme du stock par article : index couvrant (plus de retour à la table).
create index if not exists idx_stockmoves_article_cover
  on public.stock_moves (article_id) include (is_reservation, qty_delta);

-- Variantes du catalogue accessoires/vêtements : jointure par sku_norm
-- (target_ref des liens `ducati_product`). Aucun index ne la servait.
create index if not exists idx_dc_product_variants_sku
  on public.ducati_catalog_product_variants (sku_norm);

-- `idx_articles_designation (company_id, designation)` existe déjà : c'est lui
-- qui sert le tri + la pagination de la liste.

-- 2. Stock d'une société, filtrable et paginé --------------------------------
-- Recréée (au lieu d'être surchargée) pour qu'il n'y ait QU'UNE signature :
-- PostgREST refuse de choisir entre deux surcharges de même nom.
drop function if exists public.article_stock_list(uuid);

create or replace function public.article_stock_list(
  _company uuid,
  -- all   : tous les articles de la société (93 000 — à paginer impérativement)
  -- actif : les articles qui INTÉRESSENT le magasin, c'est-à-dire ceux qui ont
  --         au moins un mouvement de stock OU un stock mini renseigné (réappro).
  --         Les autres ont réel = réservé = disponible = 0 et valeur 0 : ils ne
  --         changent aucun total. C'est le défaut des écrans Stock (~1 200 lignes).
  -- pos / neg / zero : filtre du stock réel.
  _stock   text default 'all',
  _search  text default null,
  _limit   integer default null,   -- null = tout (appel SQL) ; via PostgREST, plafonné à 1000
  _offset  integer default 0
)
returns table(
  article_id uuid, reference text, designation text, mgmt_type text,
  category_path text, bin_location text, supplier_id uuid,
  real_qty numeric, reserved_qty numeric, available_qty numeric,
  pamp numeric, stock_value numeric, stock_min numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select m.article_id,
           sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
           sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
      from public.stock_moves m
     group by m.article_id
  )
  select
    a.id, a.reference, a.designation, a.mgmt_type::text,
    a.category_path, a.bin_location, a.main_supplier_id,
    coalesce(s.real_qty, 0), coalesce(s.reserved_qty, 0),
    coalesce(s.real_qty, 0) - coalesce(s.reserved_qty, 0),
    a.pamp, round(coalesce(s.real_qty, 0) * a.pamp, 2), a.stock_min
  from public.articles a
  left join s on s.article_id = a.id
  where a.company_id = _company
    and public.is_member(_company)
    and case coalesce(_stock, 'all')
          when 'pos'   then coalesce(s.real_qty, 0) > 0
          when 'neg'   then coalesce(s.real_qty, 0) < 0
          when 'zero'  then coalesce(s.real_qty, 0) = 0
          when 'actif' then s.article_id is not null or coalesce(a.stock_min, 0) > 0
          else true
        end
    and (
      _search is null or btrim(_search) = ''
      or a.reference ilike '%' || btrim(_search) || '%'
      or a.designation ilike '%' || btrim(_search) || '%'
    )
  order by a.reference
  limit nullif(greatest(coalesce(_limit, 0), 0), 0)
  offset greatest(coalesce(_offset, 0), 0);
$$;
revoke all on function public.article_stock_list(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.article_stock_list(uuid, text, text, integer, integer) to authenticated;

comment on function public.article_stock_list(uuid, text, text, integer, integer) is
  'M5 — stock valorisé d''une société. Filtre stock et pagination CÔTÉ BASE : '
  'PostgREST plafonne toute réponse à 1000 lignes, un appel sans _limit sur 93 000 '
  'articles était silencieusement tronqué. Boucler par pages de 1000.';

-- 3. Vignette d'un article ---------------------------------------------------
-- Appelée uniquement sur les lignes RÉELLEMENT affichées (jointure latérale),
-- jamais sur les 93 000 articles. Renvoie zéro ou une ligne.
create or replace function public._article_thumbnail(_company uuid, _article uuid)
returns table(url text, src text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u, s from (
    -- 1. Photo Ducati du produit (accessoires et vêtements)
    select 1 as pri,
           (select pr.image_url
              from public.article_links l
              join public.ducati_catalog_product_variants v on v.sku_norm = l.target_ref
              join public.ducati_catalog_products pr on pr.code = v.product_code
             where l.company_id = _company and l.article_id = _article
               and l.target_kind = 'ducati_product' and l.status = 'lie'
               and pr.image_url is not null
             limit 1) as u,
           'ducati_product' as s
    union all
    -- 2. Photo du site (Shopify)
    select 2,
           (select sp.image_url
              from public.article_links l
              join public.shopify_products sp
                on sp.company_id = l.company_id and sp.shopify_variant_id = l.target_ref
             where l.company_id = _company and l.article_id = _article
               and l.target_kind = 'shopify_variant' and l.status = 'lie'
               and sp.image_url is not null
             limit 1),
           'shopify'
    union all
    -- 3. Vue éclatée du catalogue Ducati (pièces)
    select 3,
           (select coalesce(d.thumbnail_url, d.image_url, d.original_image_url)
              from public.article_links l
              join public.ducati_catalog_drawing_lines dl on dl.reference_norm = l.target_ref
              join public.ducati_catalog_drawings d on d.id = dl.drawing_id
             where l.company_id = _company and l.article_id = _article
               and l.target_kind = 'ducati_part' and l.status = 'lie'
               and coalesce(d.thumbnail_url, d.image_url, d.original_image_url) is not null
             limit 1),
           'ducati_drawing'
  ) x
  where x.u is not null
  order by x.pri
  limit 1;
$$;
revoke all on function public._article_thumbnail(uuid, uuid) from public, anon;
grant execute on function public._article_thumbnail(uuid, uuid) to authenticated;

comment on function public._article_thumbnail(uuid, uuid) is
  'M2 — meilleure image d''un article : photo Ducati du produit > photo du site > '
  'vue éclatée > rien (décision M-27). URL externes (e-catalog.ducati.com, cdn.shopify.com), '
  'rien n''est téléchargé.';

-- 4. Liste des articles de l'écran Pièces & Accessoires ----------------------
-- Tout en une requête : critères de la recherche multicritères + filtre stock
-- + triple stock + provenance (G8 / Shopify / Ducati) + vignette + total exact.
--
-- Le filtre « Année » lit articles.year_from / year_to PAR `to_jsonb` : ces deux
-- colonnes n'existent pas encore en production (migration 20260720130000 jamais
-- appliquée, voir bible M02 §5) et la fonction doit pouvoir se créer sans elles.
-- Si le filtre est demandé alors qu'elles manquent, on lève un message explicite
-- plutôt que de renvoyer une liste vide.
drop function if exists public.article_list_page(uuid, text, uuid, text, text, text, text, text, text, boolean, boolean, boolean, text, text, integer, integer);

create or replace function public.article_list_page(
  _company     uuid,
  _search      text default null,
  _supplier    uuid default null,
  _year        integer default null,
  _rayon       text default null,
  _sous_rayon  text default null,
  _categorie   text default null,
  _brand       text default null,
  _size        text default null,
  _color       text default null,
  _pa_locked   boolean default null,
  _pv_locked   boolean default null,
  _to_complete boolean default null,
  _links       text default null,   -- shopify | not_shopify | ducati | g8 | none
  _stock       text default 'all',  -- all | pos | neg | zero
  _limit       integer default 200,
  _offset      integer default 0
)
returns table(
  id uuid, reference text, designation text, mgmt_type text,
  bin_location text, bin_location2 text,
  sale_price_ttc numeric, supplier_availability text,
  to_complete boolean, superseded_by_id uuid, replacement_reference text,
  real_qty numeric, reserved_qty numeric, available_qty numeric,
  link_g8 boolean, link_shopify boolean, link_ducati boolean,
  image_url text, image_source text,
  total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n integer := least(greatest(coalesce(_limit, 200), 1), 500);  -- < max_rows PostgREST (1000)
  o integer := greatest(coalesce(_offset, 0), 0);
  q text := nullif(btrim(coalesce(_search, '')), '');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if _year is not null and not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'articles' and column_name = 'year_from') then
    raise exception 'Filtre « Année » indisponible : la mise à jour de la base (années Du/Au) n''est pas appliquée.'
      using errcode = '42703';
  end if;

  return query
  with st as (
    select m.article_id,
           sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
           sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
      from public.stock_moves m
     group by m.article_id
  ),
  lk as (
    select l.article_id,
           bool_or(l.target_kind = 'g8') as g8,
           bool_or(l.target_kind = 'shopify_variant') as shopify,
           bool_or(l.target_kind in ('ducati_part', 'ducati_product')) as ducati
      from public.article_links l
     where l.company_id = _company and l.status = 'lie'
     group by l.article_id
  ),
  filtered as (
    select a.id, a.reference, a.designation, a.mgmt_type::text as mgmt_type,
           a.bin_location, a.bin_location2, a.sale_price_ttc,
           a.supplier_availability::text as supplier_availability,
           a.to_complete, a.superseded_by_id,
           coalesce(st.real_qty, 0) as real_qty,
           coalesce(st.reserved_qty, 0) as reserved_qty,
           coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0) as available_qty,
           coalesce(lk.g8, false) as link_g8,
           coalesce(lk.shopify, false) as link_shopify,
           coalesce(lk.ducati, false) as link_ducati
      from public.articles a
      left join st on st.article_id = a.id
      left join lk on lk.article_id = a.id
     where a.company_id = _company
       and (q is null
            or a.reference ilike '%' || q || '%'
            or a.designation ilike '%' || q || '%'
            or a.brand ilike '%' || q || '%'
            or a.supplier_ref ilike '%' || q || '%')
       and (_supplier is null or a.main_supplier_id = _supplier)
       -- Année du modèle : la plage [Du, Au] de l'article couvre l'année demandée
       -- (bornes nulles = ouvertes, mais au moins une borne renseignée).
       and (_year is null or (
              coalesce((to_jsonb(a) ->> 'year_from')::int <= _year, true)
              and coalesce((to_jsonb(a) ->> 'year_to')::int >= _year, true)
              and (to_jsonb(a) ->> 'year_from' is not null or to_jsonb(a) ->> 'year_to' is not null)))
       -- Familles : catégorie exacte > préfixe sous-rayon > préfixe rayon (UID RR-SS-CC)
       and (_rayon is null or (
             case
               when _sous_rayon is not null and _categorie is not null
                 then a.category_path = _rayon || '-' || _sous_rayon || '-' || _categorie
               when _sous_rayon is not null
                 then a.category_path like _rayon || '-' || _sous_rayon || '-%'
               else a.category_path like _rayon || '-%'
             end))
       -- Valeurs libres : égalité insensible à la casse (« Ducati » / « DUCATI »)
       and (_brand is null or upper(btrim(a.brand)) = upper(btrim(_brand)))
       and (_size is null or upper(btrim(a.size)) = upper(btrim(_size)))
       and (_color is null or upper(btrim(a.color)) = upper(btrim(_color)))
       and (_pa_locked is not true or a.price_purchase_locked)
       and (_pv_locked is not true or a.price_sale_locked)
       and (_to_complete is not true or a.to_complete)
       and case coalesce(_stock, 'all')
             when 'pos'  then coalesce(st.real_qty, 0) > 0
             when 'neg'  then coalesce(st.real_qty, 0) < 0
             when 'zero' then coalesce(st.real_qty, 0) = 0
             else true
           end
       and case _links
             when 'shopify'     then coalesce(lk.shopify, false)
             when 'not_shopify' then not coalesce(lk.shopify, false)
             when 'ducati'      then coalesce(lk.ducati, false)
             when 'g8'          then coalesce(lk.g8, false)
             when 'none'        then not (coalesce(lk.shopify, false) or coalesce(lk.ducati, false))
             else true
           end
  ),
  counted as (select count(*) as n from filtered),
  page as (
    select f.* from filtered f order by f.designation, f.reference limit n offset o
  )
  select
    p.id, p.reference, p.designation, p.mgmt_type,
    p.bin_location, p.bin_location2, p.sale_price_ttc, p.supplier_availability,
    p.to_complete, p.superseded_by_id,
    (select r.reference from public.articles r where r.id = p.superseded_by_id),
    p.real_qty, p.reserved_qty, p.available_qty,
    p.link_g8, p.link_shopify, p.link_ducati,
    img.url, img.src,
    counted.n
  from page p
  cross join counted
  left join lateral public._article_thumbnail(_company, p.id) as img(url, src) on true;
end $$;

revoke all on function public.article_list_page(uuid, text, uuid, integer, text, text, text, text, text, text, boolean, boolean, boolean, text, text, integer, integer) from public, anon;
grant execute on function public.article_list_page(uuid, text, uuid, integer, text, text, text, text, text, text, boolean, boolean, boolean, text, text, integer, integer) to authenticated;


-- 5. Écran Rapprochements : image aussi pour les cibles Ducati ---------------
-- Même signature et même type de retour qu'en 20260921200000 : seul le contenu
-- de `target_extra` change (ajout de `image_url` pour les pièces et les
-- produits Ducati, qui n'en avaient pas — seul Shopify en montrait une).
create or replace function public.article_links_review(
  _company uuid, _kind text default null, _method text default null, _q text default null,
  _status text default 'a_valider', _limit integer default 50, _offset integer default 0)
returns table (
  id uuid, article_id uuid, article_reference text, article_designation text, article_sale_price_ttc numeric,
  target_kind text, target_ref text, target_label text, target_extra jsonb,
  status text, method text, score smallint, reason text, decided_at timestamptz, decision_note text,
  total_count bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n integer := least(greatest(coalesce(_limit, 50), 1), 200);
  o integer := greatest(coalesce(_offset, 0), 0);
  k text := nullif(btrim(coalesce(_q, '')), '');
  shop_ok boolean := public.is_admin(_company) or public.has_role(_company, 'vendeur');
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select l.id, a.id, a.reference, a.designation, a.sale_price_ttc,
         l.target_kind, l.target_ref,
         coalesce(case l.target_kind
                    when 'ducati_part' then (select p.reference || ' — ' || coalesce(p.description, '') from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
                    when 'ducati_product' then (select v.sku || ' — ' || coalesce(v.name, pr.name, '') from public.ducati_catalog_product_variants v
                                                  join public.ducati_catalog_products pr on pr.code = v.product_code
                                                 where v.sku_norm = l.target_ref limit 1)
                    else (select coalesce(sp.product_title, '') || coalesce(' / ' || nullif(sp.variant_title, 'Default Title'), '')
                            from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
                  end, l.target_ref),
         case l.target_kind
           when 'ducati_part' then (
             select jsonb_build_object(
                      'price_ht', p.catalog_price_ht, 'replaced', p.replaced,
                      -- vue éclatée : la première qui porte une image
                      'image_url', (select coalesce(d.thumbnail_url, d.image_url, d.original_image_url)
                                      from public.ducati_catalog_drawing_lines dl
                                      join public.ducati_catalog_drawings d on d.id = dl.drawing_id
                                     where dl.reference_norm = p.reference_norm
                                       and coalesce(d.thumbnail_url, d.image_url, d.original_image_url) is not null
                                     limit 1))
               from public.ducati_catalog_parts p where p.reference_norm = l.target_ref)
           when 'ducati_product' then (
             select jsonb_build_object('price_ht', coalesce(v.price_ht, pr.price_ht), 'image_url', pr.image_url)
               from public.ducati_catalog_product_variants v
               join public.ducati_catalog_products pr on pr.code = v.product_code
              where v.sku_norm = l.target_ref limit 1)
           when 'shopify_variant' then (select jsonb_build_object('sku', sp.sku, 'price', sp.price, 'qty', sp.inventory_quantity,
                                                                  'status', sp.status, 'image_url', sp.image_url)
                                          from public.shopify_products sp where sp.company_id = _company and sp.shopify_variant_id = l.target_ref)
           else '{}'::jsonb end,
         l.status, l.method, l.score, l.reason, l.decided_at, l.decision_note,
         count(*) over ()
    from public.article_links l
    join public.articles a on a.id = l.article_id
   where l.company_id = _company
     and l.status = coalesce(_status, 'a_valider')
     and l.target_kind <> 'g8'
     and (_kind is null or (_kind = 'ducati' and l.target_kind in ('ducati_part', 'ducati_product')) or l.target_kind = _kind)
     and (_method is null or l.method = _method)
     and (l.target_kind <> 'shopify_variant' or shop_ok)
     and (k is null or a.reference ilike '%' || k || '%' or a.designation ilike '%' || k || '%' or l.target_ref ilike '%' || k || '%')
   order by l.score desc, l.method, a.reference
   limit n offset o;
end $$;
revoke all on function public.article_links_review(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.article_links_review(uuid, text, text, text, text, integer, integer) to authenticated;
