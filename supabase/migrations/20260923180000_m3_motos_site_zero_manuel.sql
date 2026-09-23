-- =====================================================================
-- Mission 03 / M03 — « Motos à vendre », suite du 23/09 : ZÉRO TRAVAIL MANUEL
--
-- Retour de Simon (23/09) : « soit on a des motos à vendre, soit pas… si tu as des motos dans G8 et
-- pas sur Shopify, pas grave, tu permets de les publier ; si elles viennent de Shopify et ne sont pas
-- dans la base de G8, tu les crées » et « je ne veux rien avoir à faire à la main ».
--
-- Ce que cette migration met en place (non destructive) :
--   1. MOTOS DU SITE SANS FICHE → la fiche moto ET son article sont CRÉÉS automatiquement depuis
--      l'annonce (titre, prix, stock, image). Le VIN manque : la fiche est créée avec un VIN VIDE et
--      un marqueur « à compléter » (décision M-40, dérogation assumée à B9), et elle est BLOQUÉE À LA
--      FACTURATION tant que le VIN n'est pas saisi.
--   2. ANNONCES OBSOLÈTES (motos déjà vendues, brouillons du site) → marquées « annonce obsolète »
--      avec leur raison, plus un bouton unique « Retirer ces annonces du site ». RIEN n'est écrit sur
--      Shopify : le retrait réel attend l'accord explicite de Simon.
--   3. MOTOS DU PARC SANS ANNONCE → « Publier sur le site » actif dès qu'elles sont En stock ou
--      Dépôt-vente : `vehicle_parc_publishable` couvre désormais TOUT le parc vendable
--      (stock_vn, stock_vo, reserve, demo, depot_vente, depot_agent), plus rien n'est grisé à tort.
--   4. PROPOSITIONS À VALIDER → purifiées automatiquement : accepté ce qui est sûr, REJETÉ le reste
--      AVEC SA RAISON. Objectif zéro proposition en attente.
--   5. PRIX D'ACHAT MANQUANT → 0 assumé + marqueur « prix d'achat à compléter » : la marge est
--      visiblement fausse au lieu d'être silencieusement fausse.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Marqueur « à compléter » sur la fiche moto
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column if not exists to_complete boolean not null default false,
  add column if not exists to_complete_reason text;

comment on column public.vehicles.to_complete is
  'Fiche moto incomplète (décision M-40) : créée automatiquement depuis une annonce du site, sans VIN. '
  'Elle ne peut pas être facturée tant que le VIN n''est pas saisi.';

create index if not exists idx_vehicles_to_complete on public.vehicles (company_id) where to_complete;

-- ---------------------------------------------------------------------
-- 2. Blocage à la facturation tant que le VIN manque (M-40)
-- ---------------------------------------------------------------------
create or replace function public._moto_sans_vin_bloque_la_vente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v record; d record;
begin
  if new.article_id is null then return new; end if;
  select d2.doc_type, d2.number into d from public.documents d2 where d2.id = new.document_id;
  -- Seuls les documents qui sortent le stock réel vendent vraiment la moto (M06 §4).
  if d.doc_type is null or d.doc_type not in ('FAC', 'TIK') then return new; end if;

  select ve.id, ve.vin, ve.model, a.reference into v
    from public.articles a join public.vehicles ve on ve.id = a.vehicle_id
   where a.id = new.article_id;
  if v.id is null then return new; end if;

  if nullif(btrim(coalesce(v.vin, '')), '') is null then
    raise exception
      'Numéro de châssis (VIN) manquant sur la moto « % » (article %) : complétez-le sur la fiche moto avant de la facturer.',
      coalesce(v.model, '?'), v.reference
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_moto_sans_vin_bloque_la_vente on public.document_lines;
create trigger trg_moto_sans_vin_bloque_la_vente
  before insert on public.document_lines
  for each row execute function public._moto_sans_vin_bloque_la_vente();

-- ---------------------------------------------------------------------
-- 3. « Publier sur le site » pour TOUT le parc vendable (retour Simon)
-- ---------------------------------------------------------------------
-- Avant : seulement stock_vn / stock_vo / depot_vente ; les motos « Réservée » et « Démo »
-- étaient grisées à tort alors qu'elles sont bien à nous et au parc.
create or replace function public.vehicle_parc_publishable(_status public.vehicle_status)
returns boolean language sql immutable set search_path = pg_catalog, public as $$
  select public.vehicle_parc_kind(_status) in ('en_stock', 'depot_vente');
$$;

-- Rattrapage des articles créés le 23/09 avec l'ancienne règle.
update public.articles a
   set publishable = true, updated_at = now()
  from public.vehicles v
 where v.id = a.vehicle_id and not a.publishable and public.vehicle_parc_publishable(v.status);

-- ---------------------------------------------------------------------
-- 4. Prix d'achat manquant : 0 assumé + marqueur
-- ---------------------------------------------------------------------
update public.articles a
   set to_complete = true,
       to_complete_source = coalesce(nullif(a.to_complete_source, ''), 'prix_achat_moto'),
       purchase_price = coalesce(a.purchase_price, 0),
       updated_at = now()
  from public.vehicles v
 where v.id = a.vehicle_id
   and a.mgmt_type::text <> 'D'                      -- le dépôt-vente n'est pas à nous : 0 est normal
   and coalesce(a.purchase_price, 0) = 0;

update public.vehicles v
   set to_complete = true,
       to_complete_reason = trim(both ' · ' from concat_ws(' · ', nullif(v.to_complete_reason, ''), 'Prix d''achat à compléter')),
       updated_at = now()
  from public.articles a
 where a.vehicle_id = v.id and a.to_complete and a.to_complete_source = 'prix_achat_moto'
   and (v.to_complete_reason is null or v.to_complete_reason not like '%Prix d''achat à compléter%');

-- ---------------------------------------------------------------------
-- 5. Annonces obsolètes du site (motos déjà vendues)
-- ---------------------------------------------------------------------
create table if not exists public.shopify_moto_annonces (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  shopify_variant_id text not null,
  state              text not null check (state in ('obsolete', 'a_retirer', 'retiree', 'gardee')),
  reason             text,
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, shopify_variant_id)
);
comment on table public.shopify_moto_annonces is
  'Annonces de motos du site sans fiche au parc : « obsolete » (moto déjà vendue, brouillon), '
  '« a_retirer » (Simon a demandé le retrait — AUCUNE écriture Shopify n''est faite ici), '
  '« retiree », « gardee ». Évite de laisser ces annonces en « à valider ».';
alter table public.shopify_moto_annonces enable row level security;
revoke all on public.shopify_moto_annonces from anon;
revoke insert, update, delete on public.shopify_moto_annonces from authenticated;
grant select on public.shopify_moto_annonces to authenticated;
drop policy if exists shopify_moto_annonces_select on public.shopify_moto_annonces;
create policy shopify_moto_annonces_select on public.shopify_moto_annonces for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- ---------------------------------------------------------------------
-- 6. Lecture du titre d'une annonce : modèle, année, marque, statut de parc
-- ---------------------------------------------------------------------
-- Titre commercial « Multistrada V4 S Radars - "TVA 21% et Garantie 4 ans" » → modèle
-- « Multistrada V4 S Radars ». Le slogan après « - », « | » ou « — » est retiré, ainsi que les
-- guillemets et les astérisques.
create or replace function public._annonce_modele(_title text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(
             split_part(split_part(split_part(coalesce(_title, ''), ' - ', 1), ' | ', 1), ' — ', 1),
             '[«»"“”*]', '', 'g'),
           '\s+', ' ', 'g')), '');
$$;

create or replace function public._annonce_annee(_title text)
returns integer language sql immutable set search_path = pg_catalog as $$
  select (regexp_match(coalesce(_title, ''), '(?:^|[^0-9])((?:19|20)[0-9]{2})(?:[^0-9]|$)'))[1]::integer;
$$;

create or replace function public._annonce_marque(_title text)
returns text language sql immutable set search_path = pg_catalog as $$
  select coalesce((
    select b from unnest(array['Alfa Romeo','BMW','Honda','Yamaha','Kawasaki','Suzuki','KTM','Triumph',
                               'Aprilia','Harley-Davidson','MV Agusta','Royal Enfield','Moto Guzzi',
                               'Piaggio','Vespa','Indian','Husqvarna','Benelli']) b
     where upper(coalesce(_title, '')) like upper(b) || '%'
     order by length(b) desc limit 1), 'Ducati');
$$;

-- Statut de parc déduit de l'annonce : dépôt-vente si le titre le dit, sinon neuve ou occasion.
create or replace function public._annonce_statut(_title text, _product_type text)
returns public.vehicle_status language sql immutable set search_path = pg_catalog, public as $$
  select case
           when lower(public.unaccent(coalesce(_title, '') || ' ' || coalesce(_product_type, ''))) like '%depot%vente%'
             then 'depot_vente'
           when coalesce(_product_type, '') = 'Moto neuve' then 'stock_vn'
           else 'stock_vo'
         end::public.vehicle_status;
$$;

-- ---------------------------------------------------------------------
-- 7. Créer les fiches moto manquantes depuis les annonces en ligne (M-40)
-- ---------------------------------------------------------------------
/**
 * _apply = false : aperçu, rien n'est écrit. _apply = true : création. Idempotente (une annonce déjà
 * rattachée n'est jamais recréée). Crée, pour chaque moto EN LIGNE sur le site sans fiche au parc :
 *   - la fiche moto : marque, modèle et année lus dans le titre, prix affiché = prix du site,
 *     statut de parc déduit de l'annonce, VIN VIDE + marqueur « à compléter » (M-40),
 *     rattachement au catalogue Ducati si le modèle est reconnu sans ambiguïté ;
 *   - son article V/O/P/D + l'entrée de stock (vehicle_ensure_article) ;
 *   - le lien annonce ↔ moto (« lie ») et le lien produit ↔ article (shopify_links).
 * Les photos et les textes de l'annonce sont ensuite rapatriés par la fonction serveur
 * shopify-import-content (mécanisme existant du 19/09), qui travaille sur les produits reliés.
 */
create or replace function public.motos_site_creer_fiches(
  _company uuid, _apply boolean default false, _limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record; vid uuid; aid uuid; n int := 0; n_my int := 0; n_annee int := 0; n_depot int := 0; n_neuf int := 0;
  st public.vehicle_status; modele text; annee integer; marque text; ref text; my text;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;

  for p in
    select sp.shopify_variant_id, sp.product_title, sp.variant_title, sp.sku, sp.price,
           sp.product_type, sp.inventory_quantity, sp.image_url
      from public.shopify_products sp
     where sp.company_id = _company and sp.removed_at is null and sp.status = 'ACTIVE'
       and public._shopify_is_moto(sp.product_type, sp.sku, sp.price)
       and not exists (select 1 from public.shopify_vehicle_links l
                        where l.company_id = _company and l.shopify_variant_id = sp.shopify_variant_id
                          and l.status = 'lie')
     order by sp.product_title
     limit greatest(coalesce(_limit, 200), 1)
  loop
    n := n + 1;
    modele := public._annonce_modele(p.product_title);
    annee  := public._annonce_annee(p.product_title);
    marque := public._annonce_marque(p.product_title);
    st     := public._annonce_statut(p.product_title, p.product_type);
    if annee is not null then n_annee := n_annee + 1; end if;
    if st::text = 'depot_vente' then n_depot := n_depot + 1; end if;
    if st::text = 'stock_vn' then n_neuf := n_neuf + 1; end if;

    -- Rattachement au catalogue Ducati si le modèle-année est reconnu sans ambiguïté.
    select my2.id into my from public.ducati_catalog_model_years my2
     where marque = 'Ducati' and modele is not null
       and upper(regexp_replace(public.unaccent(coalesce(my2.name, '')), '[^a-zA-Z0-9]', '', 'g'))
           = upper(regexp_replace(public.unaccent(modele), '[^a-zA-Z0-9]', '', 'g'))
       and (annee is null or my2.year = annee)
     limit 2;
    if (select count(*) from public.ducati_catalog_model_years my3
         where marque = 'Ducati' and modele is not null
           and upper(regexp_replace(public.unaccent(coalesce(my3.name, '')), '[^a-zA-Z0-9]', '', 'g'))
               = upper(regexp_replace(public.unaccent(modele), '[^a-zA-Z0-9]', '', 'g'))
           and (annee is null or my3.year = annee)) <> 1 then
      my := null;
    end if;
    if my is not null then n_my := n_my + 1; end if;

    if not _apply then continue; end if;

    -- Référence WEB-… : lisible, sans collision avec les références G8 reprises.
    ref := 'WEB-' || right(regexp_replace(p.shopify_variant_id, '\D', '', 'g'), 8);
    while exists (select 1 from public.vehicles w where w.company_id = _company and w.reference = ref) loop
      ref := ref || 'B';
    end loop;

    insert into public.vehicles (company_id, reference, brand, model, model_year, status,
                                 display_price, purchase_price, cost_price, imported_from,
                                 ducati_model_year_id, to_complete, to_complete_reason, notes, created_by)
    values (_company, ref, marque, coalesce(modele, p.product_title), annee, st,
            p.price, 0, 0, 'shopify', my, true,
            'VIN à compléter — fiche créée automatiquement depuis l''annonce du site (décision M-40). '
            || 'Cette moto ne peut pas être facturée tant que son numéro de châssis n''est pas saisi.',
            'Créée depuis l''annonce « ' || coalesce(p.product_title, '') || ' » du site.', auth.uid())
    returning id into vid;

    aid := public.vehicle_ensure_article(vid);

    -- Prix de vente du site sur l'article, marqué à compléter (pas de prix d'achat connu).
    update public.articles
       set sale_price_ttc = p.price, to_complete = true,
           to_complete_source = coalesce(nullif(to_complete_source, ''), 'moto_du_site'),
           web_title = coalesce(nullif(web_title, ''), p.product_title),
           updated_at = now()
     where id = aid;

    insert into public.shopify_vehicle_links (company_id, shopify_variant_id, vehicle_id, status, method, score, reason,
                                              is_auto, decided_by, decided_at)
    values (_company, p.shopify_variant_id, vid, 'lie', 'creation', 100,
            'Fiche moto créée depuis cette annonce du site (M-40)', false, auth.uid(), now())
    on conflict (company_id, shopify_variant_id, vehicle_id) do update
      set status = 'lie', method = 'creation', score = 100, is_auto = false, updated_at = now();

    insert into public.shopify_links (company_id, shopify_variant_id, article_id, status, match_via, decided_by, decided_at)
    values (_company, p.shopify_variant_id, aid, 'valide', 'moto_parc', auth.uid(), now())
    on conflict do nothing;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'moto_creee_depuis_le_site', 'vehicles', vid::text, 'system', null,
            jsonb_build_object('variant', p.shopify_variant_id, 'titre', p.product_title, 'reference', ref,
                               'marque', marque, 'modele', modele, 'annee', annee, 'statut', st::text,
                               'prix', p.price, 'article_id', aid, 'ducati_model_year_id', my));
  end loop;

  return jsonb_build_object('applique', _apply, 'motos_creees', n, 'avec_annee', n_annee,
    'rattachees_au_catalogue', n_my, 'en_depot_vente', n_depot, 'neuves', n_neuf,
    'reste_en_ligne_sans_fiche', (select count(*) from public.shopify_products sp
       where sp.company_id = _company and sp.removed_at is null and sp.status = 'ACTIVE'
         and public._shopify_is_moto(sp.product_type, sp.sku, sp.price)
         and not exists (select 1 from public.shopify_vehicle_links l
                          where l.company_id = _company and l.shopify_variant_id = sp.shopify_variant_id
                            and l.status = 'lie')) - case when _apply then 0 else n end);
end $$;
revoke all on function public.motos_site_creer_fiches(uuid, boolean, integer) from public, anon;
grant execute on function public.motos_site_creer_fiches(uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Purifier les propositions : zéro « à valider » qui traîne
-- ---------------------------------------------------------------------
/**
 * Même logique que la purification des articles :
 *   - proposition dont le produit est DÉJÀ rattaché à une autre moto → rejetée (doublon) ;
 *   - proposition sûre restante (modèle + année + prix uniques des deux côtés) → acceptée ;
 *   - annonce obsolète (brouillon ou archivée = moto déjà vendue) → rejetée + annonce marquée
 *     « annonce obsolète » dans shopify_moto_annonces ;
 *   - le reste → rejeté avec sa raison (ambiguïté réelle : plusieurs motos identiques au parc).
 * Chaque décision est tracée. Rien n'est écrit sur Shopify.
 */
create or replace function public.motos_site_purifier(_company uuid, _apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_doublon int := 0; n_sure int := 0; n_obsolete int := 0; n_ambigu int := 0; n_annonces int := 0;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;

  drop table if exists pg_temp._pur;
  create temp table _pur on commit drop as
  with att as (
    select l.id, l.shopify_variant_id, l.vehicle_id, p.status as shop_status,
           p.product_title, p.price,
           exists (select 1 from public.shopify_vehicle_links x
                    where x.company_id = _company and x.shopify_variant_id = l.shopify_variant_id
                      and x.status = 'lie') as variante_deja_liee,
           exists (select 1 from public.shopify_vehicle_links y
                    where y.company_id = _company and y.vehicle_id = l.vehicle_id and y.status = 'lie') as moto_deja_liee
      from public.shopify_vehicle_links l
      left join public.shopify_products p on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id
     where l.company_id = _company and l.status = 'a_valider'
  ), sure as (
    -- Modèle + année + prix, uniques des deux côtés : la seule correspondance automatique restante.
    select a.id, a.shopify_variant_id, a.vehicle_id
      from att a join public.vehicles v on v.id = a.vehicle_id
     where not a.variante_deja_liee and not a.moto_deja_liee
       and a.shop_status = 'ACTIVE'
       and v.model_year is not null and public._annonce_annee(a.product_title) = v.model_year
       and v.display_price is not null and a.price is not null and abs(v.display_price - a.price) < 0.01
       and (select count(*) from att b where b.shopify_variant_id = a.shopify_variant_id) = 1
       and (select count(*) from att c where c.vehicle_id = a.vehicle_id) = 1
  )
  select a.id, a.shopify_variant_id, a.vehicle_id,
         case
           when a.variante_deja_liee or a.moto_deja_liee then 'doublon'
           when exists (select 1 from sure s where s.id = a.id)  then 'sure'
           when coalesce(a.shop_status, 'DRAFT') <> 'ACTIVE'     then 'obsolete'
           else 'ambigu'
         end as verdict,
         a.shop_status, a.product_title
    from att a;

  select count(*) filter (where verdict = 'doublon'), count(*) filter (where verdict = 'sure'),
         count(*) filter (where verdict = 'obsolete'), count(*) filter (where verdict = 'ambigu')
    into n_doublon, n_sure, n_obsolete, n_ambigu from _pur;

  if _apply then
    update public.shopify_vehicle_links l
       set status = case when x.verdict = 'sure' then 'lie' else 'rejete' end,
           is_auto = false, decided_by = auth.uid(), decided_at = now(), updated_at = now(),
           reason = case x.verdict
                      when 'sure'     then coalesce(l.reason, '') || ' — accepté : modèle, année et prix uniques des deux côtés'
                      when 'doublon'  then 'Rejeté : ce produit du site (ou cette moto) est déjà rattaché ailleurs'
                      when 'obsolete' then 'Rejeté : annonce obsolète du site (moto déjà vendue, annonce en brouillon)'
                      else 'Rejeté : plusieurs motos identiques au parc, impossible de trancher sans VIN sur l''annonce'
                    end
      from _pur x
     where l.id = x.id;

    -- Les annonces obsolètes sont listées à part, plus jamais en « à valider ».
    insert into public.shopify_moto_annonces (company_id, shopify_variant_id, state, reason)
    select distinct _company, sp.shopify_variant_id, 'obsolete',
           'Annonce « ' || coalesce(sp.product_title, '') || ' » (' || coalesce(sp.status, '?') ||
           ') : aucune moto du parc ne lui correspond — moto déjà vendue.'
      from public.shopify_products sp
     where sp.company_id = _company and sp.removed_at is null and sp.status <> 'ACTIVE'
       and public._shopify_is_moto(sp.product_type, sp.sku, sp.price)
       and not exists (select 1 from public.shopify_vehicle_links l
                        where l.company_id = _company and l.shopify_variant_id = sp.shopify_variant_id
                          and l.status = 'lie')
    on conflict (company_id, shopify_variant_id) do nothing;

    select count(*) into n_annonces from public.shopify_moto_annonces
     where company_id = _company and state = 'obsolete';

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'motos_site_purifier', 'shopify_vehicle_links', _company::text, 'screen', null,
            jsonb_build_object('acceptees', n_sure, 'doublons', n_doublon, 'obsoletes', n_obsolete,
                               'ambigues', n_ambigu, 'annonces_obsoletes', n_annonces));
  else
    select count(*) into n_annonces from public.shopify_products sp
     where sp.company_id = _company and sp.removed_at is null and sp.status <> 'ACTIVE'
       and public._shopify_is_moto(sp.product_type, sp.sku, sp.price)
       and not exists (select 1 from public.shopify_vehicle_links l
                        where l.company_id = _company and l.shopify_variant_id = sp.shopify_variant_id
                          and l.status = 'lie');
  end if;

  return jsonb_build_object('applique', _apply, 'acceptees', n_sure, 'rejetees_doublon', n_doublon,
    'rejetees_annonce_obsolete', n_obsolete, 'rejetees_ambigues', n_ambigu,
    'annonces_obsoletes_a_retirer', n_annonces,
    'restant_a_valider', (select count(*) from public.shopify_vehicle_links
                           where company_id = _company and status = 'a_valider')
                         - case when _apply then 0 else n_doublon + n_sure + n_obsolete + n_ambigu end);
end $$;
revoke all on function public.motos_site_purifier(uuid, boolean) from public, anon;
grant execute on function public.motos_site_purifier(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 9. « Retirer ces annonces du site » — demande seulement, jamais d'écriture Shopify
-- ---------------------------------------------------------------------
create or replace function public.motos_site_annonces_obsoletes(_company uuid)
returns table (shopify_variant_id text, product_title text, price numeric, shop_status text,
               image_url text, state text, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  select a.shopify_variant_id, p.product_title, p.price, p.status, p.image_url, a.state, a.reason
    from public.shopify_moto_annonces a
    left join public.shopify_products p on p.company_id = a.company_id and p.shopify_variant_id = a.shopify_variant_id
   where a.company_id = _company and a.state in ('obsolete', 'a_retirer')
   order by a.state, p.product_title
   limit 500;
end $$;
revoke all on function public.motos_site_annonces_obsoletes(uuid) from public, anon;
grant execute on function public.motos_site_annonces_obsoletes(uuid) to authenticated;

/** Marque les annonces obsolètes « à retirer ». N'ÉCRIT RIEN sur Shopify (accord de Simon requis). */
create or replace function public.motos_site_demander_retrait(_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  with u as (
    update public.shopify_moto_annonces
       set state = 'a_retirer', decided_by = auth.uid(), decided_at = now(), updated_at = now()
     where company_id = _company and state = 'obsolete'
    returning 1)
  select count(*) into n from u;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'motos_site_demande_retrait', 'shopify_moto_annonces', _company::text, 'screen', null,
          jsonb_build_object('annonces', n, 'shopify_ecrit', false));
  return jsonb_build_object('annonces_a_retirer', n, 'shopify_ecrit', false);
end $$;
revoke all on function public.motos_site_demander_retrait(uuid) from public, anon;
grant execute on function public.motos_site_demander_retrait(uuid) to authenticated;
