-- =====================================================================
-- Mission 03 / M03 — « Motos à vendre » carte 4 : LES MOTOS DU SITE
--
-- 240 motos sont sur le site (shopify_products) ; aucune n'a d'article ni de fiche véhicule reliée.
-- Le rapprochement livré le 22/09 (shopify_vehicle_links_refresh) ne sait faire que deux choses :
--   * VIN cité dans le titre / le SKU / le handle du produit → score 95 ;
--   * nom de modèle contenu dans le titre → score 50 (jusqu'à 5 motos proposées par produit).
-- Mesuré en base le 23/09 : 0 correspondance par VIN (l'instantané Shopify ne reprend pas la
-- description des produits, seul endroit où un VIN pourrait figurer) et 406 propositions « modèle »
-- toutes à 50 — beaucoup trop faibles pour être appliquées seules.
--
-- Ce que cette migration ajoute :
--   1. une méthode SÛRE « reference » : le SKU du produit du site est exactement la référence G8 de
--      la fiche véhicule (ex. OCC1260018) ET une seule moto du parc porte cette référence → score 90 ;
--   2. le rattachement AUTOMATIQUE des correspondances sûres (score ≥ 90, une seule pour ce produit,
--      la moto n'est pas déjà rattachée à un autre produit) ; tout le reste reste « à valider » ;
--   3. motos_site_rattacher(société, appliquer) : aperçu (rien n'est écrit) ou application —
--      rattache le sûr, crée l'article V/O/P/D manquant de chaque moto rattachée encore vendable
--      (vehicle_ensure_article, migration 20260923150000) et pose le lien produit ↔ article
--      (shopify_links) pour que le stock, le prix et la publication du site passent par l'article ;
--   4. motos_site_a_creer(société) : les motos EN LIGNE sur le site qu'aucune fiche du parc ne
--      reconnaît — à créer à la main (une fiche moto inventée sans VIN serait contraire à B9).
--
-- Rien n'est écrit sur Shopify (la synchronisation reste « Arrêtée »). Migration non destructive.
-- =====================================================================

-- Le lien produit du site ↔ article accepte une nouvelle origine : « moto_parc »
-- (le produit du site a été reconnu comme une moto du parc, pas par son SKU de pièce).
alter table public.shopify_links drop constraint if exists shopify_links_match_via_check;
alter table public.shopify_links add constraint shopify_links_match_via_check
  check (match_via is null or match_via in ('sku', 'barcode', 'moto_parc'));

-- ---------------------------------------------------------------------
-- 1. Les correspondances possibles, en lecture seule
-- ---------------------------------------------------------------------
create or replace function public._motos_site_candidats(_company uuid)
returns table (variant_id text, vehicle_id uuid, method text, score smallint, reason text, sure boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with m as (
    select p.shopify_variant_id as v,
           upper(concat_ws(' ', p.product_title, p.variant_title, p.sku, p.barcode, replace(coalesce(p.handle, ''), '-', ' '))) as txt,
           upper(regexp_replace(coalesce(p.sku, ''), '[^A-Za-z0-9]', '', 'g')) as nsku,
           lower(regexp_replace(public.unaccent(coalesce(p.product_title, '')), '[^a-zA-Z0-9]', '', 'g')) as title_n,
           upper(regexp_replace(public.unaccent(
             split_part(split_part(coalesce(p.product_title, ''), ' - ', 1), ' | ', 1)
           ), '[^a-zA-Z0-9]', '', 'g')) as title_court
      from public.shopify_products p
     where p.company_id = _company and p.removed_at is null
       and public._shopify_is_moto(p.product_type, p.sku, p.price)
  ), vin as (
    -- VIN cité quelque part dans le produit : correspondance certaine (B9).
    select distinct on (m.v, ve.id) m.v, ve.id as vehicle_id, 'vin'::text as method, 95::smallint as score,
           'VIN ' || ve.vin || ' cité dans le produit du site' as reason
      from m cross join lateral regexp_split_to_table(m.txt, '[^A-Z0-9]+') tok
      join public.vehicles ve on ve.company_id = _company and upper(ve.vin) = tok
     where length(tok) = 17
  ), ref as (
    -- SKU du site = référence de la fiche moto, et UNE SEULE moto du parc porte cette référence.
    select m.v, ve.id as vehicle_id, 'reference'::text as method, 90::smallint as score,
           'Référence « ' || ve.reference || ' » du site = référence de la moto' as reason
      from m
      join public.vehicles ve
        on ve.company_id = _company
       and upper(regexp_replace(coalesce(ve.reference, ''), '[^A-Za-z0-9]', '', 'g')) = m.nsku
     where m.nsku <> ''
       and (select count(*) from public.vehicles w
             where w.company_id = _company
               and upper(regexp_replace(coalesce(w.reference, ''), '[^A-Za-z0-9]', '', 'g')) = m.nsku) = 1
  ), titre as (
    -- Titre de l'annonce (sans le slogan après « - » ou « | ») = début de la référence G8 de la moto,
    -- ou l'inverse, sur au moins 10 caractères, et seulement pour une moto ENCORE AU PARC.
    -- Proposition forte (70) mais JAMAIS automatique : le site garde des annonces d'anciennes motos
    -- vendues qui portent le même nom de modèle que celle qui est en stock aujourd'hui.
    select m.v, ve.id as vehicle_id, 'titre'::text as method, 70::smallint as score,
           'Titre du site ≈ référence « ' || ve.reference || ' » d''une moto au parc (' || ve.status::text || ')' as reason,
           row_number() over (partition by m.v order by length(ve.reference) desc, ve.created_at desc) as rk
      from m join public.vehicles ve
        on ve.company_id = _company
       and ve.status::text in ('stock_vn', 'stock_vo', 'depot_vente', 'depot_agent', 'reserve', 'demo')
       and coalesce(ve.reference, '') <> ''
     where length(m.title_court) >= 10
       and length(upper(regexp_replace(public.unaccent(ve.reference), '[^a-zA-Z0-9]', '', 'g'))) >= 10
       and (upper(regexp_replace(public.unaccent(ve.reference), '[^a-zA-Z0-9]', '', 'g')) like m.title_court || '%'
         or m.title_court like upper(regexp_replace(public.unaccent(ve.reference), '[^a-zA-Z0-9]', '', 'g')) || '%')
  ), mdl as (
    select m.v, ve.id as vehicle_id, 'modele'::text as method, 50::smallint as score,
           'Modèle « ' || ve.model || ' » (' || ve.status::text || ') dans le titre du site' as reason,
           row_number() over (partition by m.v order by length(ve.model) desc, ve.created_at desc) as rk
      from m join public.vehicles ve
        on ve.company_id = _company and ve.status::text <> 'vendu' and ve.model is not null
       and length(regexp_replace(public.unaccent(ve.model), '[^a-zA-Z0-9]', '', 'g')) >= 4
       and m.title_n like '%' || lower(regexp_replace(public.unaccent(ve.model), '[^a-zA-Z0-9]', '', 'g')) || '%'
  ), tous as (
    select v, vehicle_id, method, score, reason from vin
    union all
    select v, vehicle_id, method, score, reason from ref
     where not exists (select 1 from vin where vin.v = ref.v)
    union all
    select v, vehicle_id, method, score, reason from titre
     where rk <= 5
       and not exists (select 1 from vin where vin.v = titre.v and vin.vehicle_id = titre.vehicle_id)
       and not exists (select 1 from ref where ref.v = titre.v and ref.vehicle_id = titre.vehicle_id)
    union all
    select v, vehicle_id, method, score, reason from mdl
     where rk <= 5
       and not exists (select 1 from vin where vin.v = mdl.v and vin.vehicle_id = mdl.vehicle_id)
       and not exists (select 1 from ref where ref.v = mdl.v)
       and not exists (select 1 from titre where titre.v = mdl.v and titre.vehicle_id = mdl.vehicle_id)
  )
  -- Une proposition est SÛRE si son score ≥ 90, qu'elle est la seule à ce niveau pour ce produit du
  -- site ET la seule à ce niveau pour cette moto (une moto = une annonce, jamais deux).
  select t.v, t.vehicle_id, t.method, t.score, t.reason,
         (t.score >= 90
          and (select count(*) from tous x where x.v = t.v and x.score >= 90) = 1
          and (select count(*) from tous y where y.vehicle_id = t.vehicle_id and y.score >= 90) = 1)
    from tous t;
$$;
revoke all on function public._motos_site_candidats(uuid) from public, anon, authenticated;
grant execute on function public._motos_site_candidats(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2. Rapprochement : réécrit pour utiliser les candidats et rattacher le sûr
-- ---------------------------------------------------------------------
create or replace function public.shopify_vehicle_links_refresh(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_new int := 0; n_removed int := 0; n_auto int := 0;
begin
  if not public._article_links_can_write(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  drop table if exists pg_temp._vl_want;
  create temp table _vl_want on commit drop as
    select * from public._motos_site_candidats(_company);

  with d as (
    delete from public.shopify_vehicle_links l
     where l.company_id = _company and l.is_auto and l.status = 'a_valider'
       and not exists (select 1 from _vl_want w where w.variant_id = l.shopify_variant_id and w.vehicle_id = l.vehicle_id)
    returning 1)
  select count(*) into n_removed from d;

  with i as (
    insert into public.shopify_vehicle_links as l (company_id, shopify_variant_id, vehicle_id, status, method, score, reason)
    select _company, w.variant_id, w.vehicle_id,
           -- Rattachement automatique du sûr, à condition que la moto ne soit pas déjà prise
           -- par un autre produit du site (jamais deux annonces pour la même moto).
           case when w.sure
                 and not exists (select 1 from public.shopify_vehicle_links y
                                  where y.company_id = _company and y.vehicle_id = w.vehicle_id
                                    and y.status = 'lie' and y.shopify_variant_id <> w.variant_id)
                then 'lie' else 'a_valider' end,
           w.method, w.score, w.reason
      from _vl_want w
     where not exists (select 1 from public.shopify_vehicle_links x where x.company_id = _company
                         and x.shopify_variant_id = w.variant_id and x.status = 'lie')
    on conflict (company_id, shopify_variant_id, vehicle_id) do update
      set method = excluded.method, score = excluded.score, reason = excluded.reason, updated_at = now()
      where l.is_auto and l.status = 'a_valider'
        and (l.method, l.score, l.reason) is distinct from (excluded.method, excluded.score, excluded.reason)
    returning (xmax = 0) as inserted, status)
  select count(*) filter (where inserted), count(*) filter (where inserted and status = 'lie')
    into n_new, n_auto from i;

  return jsonb_build_object('new', n_new, 'removed', n_removed, 'auto_linked', n_auto,
    'pending', (select count(*) from public.shopify_vehicle_links where company_id = _company and status = 'a_valider'),
    'linked', (select count(*) from public.shopify_vehicle_links where company_id = _company and status = 'lie'),
    'motos', (select count(*) from public.shopify_products p where p.company_id = _company and p.removed_at is null
                and public._shopify_is_moto(p.product_type, p.sku, p.price)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Motos du site que le parc ne reconnaît pas (à créer à la main)
-- ---------------------------------------------------------------------
create or replace function public.motos_site_a_creer(_company uuid, _en_ligne_seulement boolean default true)
returns table (shopify_variant_id text, product_title text, variant_title text, sku text, price numeric,
               shop_status text, image_url text, propositions integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select p.shopify_variant_id, p.product_title, p.variant_title, p.sku, p.price, p.status, p.image_url,
         (select count(*)::integer from public.shopify_vehicle_links l
           where l.company_id = _company and l.shopify_variant_id = p.shopify_variant_id and l.status = 'a_valider')
    from public.shopify_products p
   where p.company_id = _company and p.removed_at is null
     and public._shopify_is_moto(p.product_type, p.sku, p.price)
     and (not _en_ligne_seulement or p.status = 'ACTIVE')
     and not exists (select 1 from public.shopify_vehicle_links l
                      where l.company_id = _company and l.shopify_variant_id = p.shopify_variant_id and l.status = 'lie')
   order by p.status, p.product_title
   limit 500;
end $$;
revoke all on function public.motos_site_a_creer(uuid, boolean) from public, anon;
grant execute on function public.motos_site_a_creer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Rattachement complet : moto du site → fiche véhicule → article → lien Shopify
-- ---------------------------------------------------------------------
/**
 * _apply = false : APERÇU, rien n'est écrit (aucun lien, aucun article, aucun mouvement de stock).
 * _apply = true  : rattache le sûr, crée l'article manquant de chaque moto rattachée encore vendable
 *                  et pose le lien produit du site ↔ article.
 * Idempotente : une deuxième exécution ne crée rien.
 */
create or replace function public.motos_site_rattacher(_company uuid, _apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  refresh_report jsonb := null;
  n_articles int := 0; n_links int := 0; n_deja int := 0; n_non_vendable int := 0; n_rattache int := 0;
  aid uuid;
  motos_total int; lies int; a_valider int; en_ligne_sans_moto int;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;

  if _apply then
    refresh_report := public.shopify_vehicle_links_refresh(_company);
  end if;

  -- Ce qui est (ou serait) rattaché : les liens « lié » existants + les candidats sûrs en aperçu.
  drop table if exists pg_temp._ml;
  create temp table _ml on commit drop as
    select l.shopify_variant_id as variant_id, l.vehicle_id
      from public.shopify_vehicle_links l
     where l.company_id = _company and l.status = 'lie'
    union
    select c.variant_id, c.vehicle_id
      from public._motos_site_candidats(_company) c
     where not _apply and c.sure
       and not exists (select 1 from public.shopify_vehicle_links x
                        where x.company_id = _company and x.shopify_variant_id = c.variant_id and x.status = 'lie');

  for r in
    select ml.variant_id, ml.vehicle_id, v.status, v.article_id
      from _ml ml join public.vehicles v on v.id = ml.vehicle_id
  loop
    n_rattache := n_rattache + 1;
    if not public.vehicle_needs_article(r.status) then
      -- Moto vendue ou hors parc : on garde le lien (historique) mais on ne crée pas d'article.
      n_non_vendable := n_non_vendable + 1;
      continue;
    end if;
    if r.article_id is not null then
      aid := r.article_id;
      n_deja := n_deja + 1;
    elsif _apply then
      aid := public.vehicle_ensure_article(r.vehicle_id);
      n_articles := n_articles + 1;
    else
      aid := null;
      n_articles := n_articles + 1;
    end if;

    -- Lien produit du site ↔ article : c'est lui que shopify-push et shopify-publish utilisent.
    if not exists (select 1 from public.shopify_links x
                    where x.company_id = _company and x.shopify_variant_id = r.variant_id
                      and x.status in ('auto_exact', 'valide')) then
      if _apply and aid is not null then
        insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
        values (_company, r.variant_id, aid, 'valide', 'moto_parc', auth.uid(), now())
        on conflict do nothing;
      end if;
      n_links := n_links + 1;
    end if;
  end loop;

  select count(*) into motos_total from public.shopify_products p
   where p.company_id = _company and p.removed_at is null
     and public._shopify_is_moto(p.product_type, p.sku, p.price);
  select count(*) into lies from public.shopify_vehicle_links where company_id = _company and status = 'lie';
  select count(*) into a_valider from public.shopify_vehicle_links where company_id = _company and status = 'a_valider';
  select count(*) into en_ligne_sans_moto from public.shopify_products p
   where p.company_id = _company and p.removed_at is null and p.status = 'ACTIVE'
     and public._shopify_is_moto(p.product_type, p.sku, p.price)
     and not exists (select 1 from _ml ml where ml.variant_id = p.shopify_variant_id);

  if _apply then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'motos_site_rattacher', 'shopify_vehicle_links', _company::text, 'screen', null,
            jsonb_build_object('refresh', refresh_report, 'articles_crees', n_articles, 'liens_shopify', n_links,
                               'motos_liees', lies, 'a_valider', a_valider));
  end if;

  return jsonb_build_object(
    'applique', _apply,
    'motos_du_site', motos_total,
    'rapprochement', refresh_report,
    'motos_rattachees', n_rattache,
    'articles_crees', n_articles,
    'articles_deja_presents', n_deja,
    'liens_produit_article', n_links,
    'motos_rattachees_non_vendables', n_non_vendable,
    'restant_a_valider', a_valider,
    'liens_lie_en_base', lies,
    'en_ligne_sans_moto_du_parc', en_ligne_sans_moto);
end $$;
revoke all on function public.motos_site_rattacher(uuid, boolean) from public, anon;
grant execute on function public.motos_site_rattacher(uuid, boolean) to authenticated;
