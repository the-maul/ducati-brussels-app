-- =====================================================================
-- Mission 03 / M03 / M07 — « Motos à vendre : du stock du DMS au site » (carte 1 et 2)
--
-- Décision prise avec Simon le 23/09 (M-36) : PAS de faux client « Italbike Store ».
-- Une moto est À LA FOIS une fiche véhicule (VIN, propriétaires, entretiens) et un article
-- (V neuf, O occasion particulier → TVA marge, P occasion professionnel, D dépôt-vente).
-- Ce qui la rend vendable est son STATUT DE PARC, déjà porté par vehicles.status
-- (énum vehicle_status, 11 valeurs — RÉUTILISÉ, aucun nouveau statut créé) :
--   « En stock »    → stock_vn, stock_vo, reserve, demo   : à nous, aucun propriétaire, visible sur le site
--   « Dépôt-vente » → depot_vente, depot_agent            : propriétaire = client déposant, visible sur le site
--   « Vendue »      → vendu, livre                        : propriétaire = acheteur, retirée du site
--   « Moto client » → vendu SANS article (décision M-12)  : jamais sur le site
--   (hors vente : en_commande, repris, courtoisie)
--
-- Cette migration est NON DESTRUCTIVE (aucun DROP de colonne, aucune suppression de ligne) :
--   1. lien véhicule ↔ article DANS LES DEUX SENS (articles.vehicle_id + vehicles.article_id,
--      tenus synchronisés par déclencheur, 1 article ↔ 1 véhicule au plus) ;
--   2. règles de statut de parc en base (fonctions immuables, miroir de src/modules/vehicles/parc.ts) ;
--   3. vehicle_ensure_article() : crée l'article de la moto à l'entrée en stock (type V/O/P/D,
--      régime TVA B2, coût de revient B3), réutilisable par la réception châssis (M04), la
--      validation de reprise (M07) et le dépôt-vente ;
--   4. à la FACTURATION, la moto sort du stock : déclencheur sur stock_moves (append-only B7)
--      → véhicule « vendu », date de sortie, prix affiché retiré, nouveau propriétaire tracé,
--      article dépublié et remis en file Shopify (le site ne l'affiche plus) ;
--   5. vehicles_parc_check() : contrôle de cohérence (moto en stock sans article, moto vendue
--      encore publiée, stock ≠ 1, stock négatif) — lecture seule, rien n'est corrigé tout seul.
-- Rien n'est écrit sur Shopify par cette migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lien véhicule ↔ article dans les deux sens
-- ---------------------------------------------------------------------
alter table public.articles
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

comment on column public.articles.vehicle_id is
  'Moto (fiche véhicule) que cet article représente — miroir de vehicles.article_id (B1, B9). '
  'Un article V/O/P/D de moto porte le stock et le PAMP ; la fiche véhicule porte le VIN et les propriétaires.';

-- Un article ne représente jamais deux motos, une moto n'a jamais deux articles.
create unique index if not exists uq_articles_vehicle on public.articles (vehicle_id) where vehicle_id is not null;
create unique index if not exists uq_vehicles_article on public.vehicles (article_id) where article_id is not null;
create index if not exists idx_vehicles_status_article on public.vehicles (company_id, status) where article_id is null;

-- Reprise de l'existant : les liens déjà posés par la reprise (M07) et la réception châssis (M04).
update public.articles a
   set vehicle_id = v.id
  from public.vehicles v
 where v.article_id = a.id and a.vehicle_id is distinct from v.id
   and not exists (select 1 from public.articles x where x.vehicle_id = v.id and x.id <> a.id);

-- Synchronisation des deux sens (jamais de boucle : on n'écrit que si la valeur diffère).
create or replace function public._sync_vehicle_article_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'vehicles' then
    if tg_op = 'UPDATE' and old.article_id is not null and old.article_id is distinct from new.article_id then
      update public.articles set vehicle_id = null where id = old.article_id and vehicle_id = new.id;
    end if;
    if new.article_id is not null then
      update public.articles set vehicle_id = new.id
       where id = new.article_id and vehicle_id is distinct from new.id;
    end if;
  else
    if tg_op = 'UPDATE' and old.vehicle_id is not null and old.vehicle_id is distinct from new.vehicle_id then
      update public.vehicles set article_id = null where id = old.vehicle_id and article_id = new.id;
    end if;
    if new.vehicle_id is not null then
      update public.vehicles set article_id = new.id
       where id = new.vehicle_id and article_id is distinct from new.id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicles_article_link on public.vehicles;
create trigger trg_vehicles_article_link
  after insert or update of article_id on public.vehicles
  for each row execute function public._sync_vehicle_article_link();

drop trigger if exists trg_articles_vehicle_link on public.articles;
create trigger trg_articles_vehicle_link
  after insert or update of vehicle_id on public.articles
  for each row execute function public._sync_vehicle_article_link();

-- ---------------------------------------------------------------------
-- 2. Règles de statut de parc (miroir exact de src/modules/vehicles/parc.ts)
-- ---------------------------------------------------------------------
create or replace function public.vehicle_parc_kind(_status public.vehicle_status)
returns text language sql immutable set search_path = pg_catalog as $$
  select case _status::text
           when 'stock_vn'    then 'en_stock'
           when 'stock_vo'    then 'en_stock'
           when 'reserve'     then 'en_stock'
           when 'demo'        then 'en_stock'
           when 'depot_vente' then 'depot_vente'
           when 'depot_agent' then 'depot_vente'
           when 'vendu'       then 'vendue'
           when 'livre'       then 'vendue'
           when 'en_commande' then 'en_commande'
           when 'repris'      then 'reprise'
           when 'courtoisie'  then 'interne'
           else 'autre'
         end;
$$;
comment on function public.vehicle_parc_kind(public.vehicle_status) is
  'Statut de parc « métier » (décision M-36) déduit du statut de la fiche véhicule.';

-- Une moto « en stock » ou « en dépôt-vente » DOIT avoir un article (elle est vendable).
create or replace function public.vehicle_needs_article(_status public.vehicle_status)
returns boolean language sql immutable set search_path = pg_catalog, public as $$
  select public.vehicle_parc_kind(_status) in ('en_stock', 'depot_vente');
$$;

-- Le bouton « Publier sur le site » n'est proposé que pour En stock et Dépôt-vente.
-- « reserve » et « demo » restent en stock mais ne sont pas proposés à la publication.
create or replace function public.vehicle_parc_publishable(_status public.vehicle_status)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select _status::text in ('stock_vn', 'stock_vo', 'depot_vente');
$$;

-- Type de gestion de l'article d'après le statut de parc et la référence G8 (B1).
-- Les références reprises de G8 sont parlantes : DEP… = dépôt-vente, OCC… = occasion,
-- nom de modèle (MULTISTRADAV4S…) = moto neuve. Le statut « reserve » ne dit pas, à lui seul,
-- si la moto réservée est neuve ou d'occasion : c'est la référence qui tranche.
create or replace function public.vehicle_article_mgmt_type(_status public.vehicle_status, _reference text default null)
returns public.article_mgmt_type language sql immutable set search_path = pg_catalog, public as $$
  select case
           when _status::text in ('depot_vente', 'depot_agent')
             or upper(coalesce(_reference, '')) like 'DEP%'                       then 'D'
           when _status::text in ('stock_vo', 'repris')
             or upper(coalesce(_reference, '')) like 'OCC%'                       then 'O'
           when _status::text in ('stock_vn', 'demo', 'en_commande', 'reserve')   then 'V'
           else 'O'   -- occasion : O par défaut (TVA marge, particulier) ; P se précise à l'appel
         end::public.article_mgmt_type;
$$;

-- ---------------------------------------------------------------------
-- 3. Création de l'article à l'entrée en stock
-- ---------------------------------------------------------------------
-- Référence de l'article d'une moto : la référence de la fiche si elle est libre, sinon le VIN (B9),
-- sinon MOTO-<8 premiers caractères de l'id>. Un suffixe -2, -3… évite tout doublon.
create or replace function public._vehicle_article_reference(_company uuid, _vehicle public.vehicles)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare base text; cand text; i int := 1;
begin
  base := nullif(btrim(coalesce(_vehicle.reference, '')), '');
  if base is null then base := nullif(btrim(coalesce(_vehicle.vin, '')), ''); end if;
  if base is null then base := 'MOTO-' || left(replace(_vehicle.id::text, '-', ''), 8); end if;
  base := upper(left(base, 40));
  cand := base;
  while exists (select 1 from public.articles a where a.company_id = _company and a.reference = cand) loop
    i := i + 1;
    cand := left(base, 40 - length('-' || i::text)) || '-' || i::text;
  end loop;
  return cand;
end $$;

/**
 * Crée (ou retrouve) l'article V/O/P/D d'une moto et le relie à sa fiche.
 *  _mgmt      : force le type de gestion ('V','O','P','D') ; sinon déduit du statut de parc.
 *  _unit_cost : coût de revient / prix d'achat à l'entrée (B3) ; null = pas d'entrée valorisée.
 *  _with_stock: true → une entrée de stock de 1 si l'article n'a pas encore de stock réel (B5, B7).
 * Idempotente : si la moto a déjà un article, il est simplement renvoyé (rien n'est écrasé).
 */
create or replace function public.vehicle_ensure_article(
  _vehicle uuid, _mgmt text default null, _unit_cost numeric default null, _with_stock boolean default true)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.vehicles;
  mgmt public.article_mgmt_type;
  art uuid;
  ref text;
  desig text;
  vat numeric;
  cost numeric;
  real_qty numeric;
begin
  select * into v from public.vehicles where id = _vehicle;
  if v.id is null then raise exception 'Moto introuvable' using errcode = 'P0002'; end if;
  -- auth.uid() null = exécution système (tâche, migration) ; même règle que record_stock_move.
  if auth.uid() is not null and not (public.is_admin(v.company_id) or public.has_role(v.company_id, 'vendeur')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if v.article_id is not null then return v.article_id; end if;

  mgmt := coalesce(nullif(upper(btrim(coalesce(_mgmt, ''))), ''),
                   public.vehicle_article_mgmt_type(v.status, v.reference)::text)::public.article_mgmt_type;
  if mgmt::text not in ('V', 'O', 'P', 'D') then
    raise exception 'Type de gestion % interdit pour une moto (V, O, P ou D attendu)', mgmt using errcode = '22023';
  end if;

  -- B2 — régime de TVA : O = TVA sur marge (taux 0 sur la ligne, marge taxée au registre VO) ;
  -- V et P = 21 % ; D = dépôt-vente, la moto n'est pas à nous (0, à confirmer avec le comptable).
  vat := case mgmt::text when 'O' then 0 when 'D' then 0 else 21 end;
  cost := coalesce(_unit_cost, v.cost_price, v.purchase_price);
  ref := public._vehicle_article_reference(v.company_id, v);
  desig := nullif(btrim(concat_ws(' ', v.brand, v.model)), '');
  if desig is null then desig := 'Moto ' || coalesce(v.vin, ref); end if;
  if v.vin is not null then desig := left(desig || ' — ' || v.vin, 200); end if;

  insert into public.articles (company_id, reference, designation, brand, mgmt_type, vehicle_id,
                               purchase_price, sale_price_ttc, vat_rate, publishable, is_library, created_by,
                               category_path, note)
  values (v.company_id, ref, desig, v.brand, mgmt, v.id,
          case when mgmt::text = 'D' then 0 else coalesce(cost, 0) end,
          coalesce(v.display_price, 0), vat,
          public.vehicle_parc_publishable(v.status), false, auth.uid(),
          case mgmt::text when 'V' then '07-01-01' when 'O' then '08-01-01'
                          when 'P' then '08-02-01' else '08-03-01' end,
          'Article de la moto ' || coalesce(v.vin, ref) || ' (créé automatiquement, décision M-36)')
  returning id into art;

  update public.vehicles set article_id = art, updated_at = now() where id = v.id;

  -- Entrée en stock de la moto : 1 exemplaire, valorisé au coût de revient (B3, B5, B7).
  -- Le dépôt-vente (D) entre aussi en stock mais sans valeur : il n'est pas à nous (stock_value_owned exclut D).
  if _with_stock then
    select coalesce(s.real_qty, 0) into real_qty from public.article_stock(art) s;
    if coalesce(real_qty, 0) <= 0 then
      perform public.record_stock_move(
        art, 'entree'::public.stock_move_type, 1,
        case when mgmt::text = 'D' then null else cost end,
        false, null, 'moto_parc', ref, 'Entrée en stock de la moto (statut « ' || v.status::text || ' »)');
    end if;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (v.company_id, auth.uid(), 'moto_article_create', 'vehicles', v.id::text, 'system', null,
          jsonb_build_object('article_id', art, 'reference', ref, 'mgmt_type', mgmt::text,
                             'vat_rate', vat, 'unit_cost', cost, 'status', v.status::text));
  return art;
end $$;
revoke all on function public.vehicle_ensure_article(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.vehicle_ensure_article(uuid, text, numeric, boolean) to authenticated, service_role;

/**
 * Met le parc en règle : chaque moto « En stock » ou « Dépôt-vente » reçoit son article.
 * _apply = false : aperçu, rien n'est écrit. _apply = true : création. Idempotente.
 * Les motos reprises de G8 n'ont pas de prix d'achat : leur article entre en stock SANS valeur
 * (PAMP 0), comme les 305 pièces de la reprise Shopify du 21/09 — à compléter moto par moto.
 */
create or replace function public.motos_parc_creer_articles(_company uuid, _apply boolean default false, _limit integer default 500)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; n_v int := 0; n_o int := 0; n_p int := 0; n_d int := 0; n_sans_cout int := 0; mgmt text;
begin
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  for r in
    select v.id, v.status, v.reference, v.cost_price, v.purchase_price
      from public.vehicles v
     where v.company_id = _company and v.article_id is null and public.vehicle_needs_article(v.status)
     order by v.status, v.reference
     limit greatest(coalesce(_limit, 500), 1)
  loop
    mgmt := public.vehicle_article_mgmt_type(r.status, r.reference)::text;
    n := n + 1;
    if mgmt = 'V' then n_v := n_v + 1; elsif mgmt = 'O' then n_o := n_o + 1;
    elsif mgmt = 'P' then n_p := n_p + 1; else n_d := n_d + 1; end if;
    if coalesce(r.cost_price, r.purchase_price, 0) <= 0 and mgmt <> 'D' then n_sans_cout := n_sans_cout + 1; end if;
    if _apply then perform public.vehicle_ensure_article(r.id); end if;
  end loop;

  if _apply and n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'motos_parc_creer_articles', 'vehicles', _company::text, 'system', null,
            jsonb_build_object('articles', n, 'V', n_v, 'O', n_o, 'P', n_p, 'D', n_d, 'sans_cout', n_sans_cout));
  end if;

  return jsonb_build_object('applique', _apply, 'articles', n, 'type_V', n_v, 'type_O', n_o, 'type_P', n_p,
    'type_D', n_d, 'sans_cout_de_revient', n_sans_cout,
    'reste_sans_article', (select count(*) from public.vehicles v
                            where v.company_id = _company and v.article_id is null
                              and public.vehicle_needs_article(v.status)) - case when _apply then 0 else n end);
end $$;
revoke all on function public.motos_parc_creer_articles(uuid, boolean, integer) from public, anon;
grant execute on function public.motos_parc_creer_articles(uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. À la facturation : la moto sort du stock et est retirée du site
-- ---------------------------------------------------------------------
-- Déclencheur sur stock_moves (append-only B7) : couvre TOUS les chemins de vente
-- (comptoir, caisse, commandes du site) sans toucher au code des écrans.
create or replace function public._moto_sortie_de_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.vehicles;
  doc record;
begin
  if new.is_reservation or new.move_type::text <> 'sortie' or new.qty_delta >= 0 then return new; end if;
  if coalesce(new.origin, '') not in ('sale', 'shopify', 'pos') then return new; end if;

  select * into v from public.vehicles where article_id = new.article_id and company_id = new.company_id;
  if v.id is null then return new; end if;
  if public.vehicle_parc_kind(v.status) = 'vendue' then return new; end if;

  -- Facture à l'origine du mouvement (ref = n° de document) → acheteur et date.
  select d.id, d.contact_id, d.issue_date, d.number into doc
    from public.documents d
   where d.company_id = new.company_id and d.number = new.ref
   order by d.created_at desc limit 1;

  update public.vehicles
     set status = 'vendu'::public.vehicle_status,
         sold_date = coalesce(doc.issue_date, current_date),
         display_price = null,
         updated_at = now()
   where id = v.id;

  -- Nouveau propriétaire = acheteur (VEH003, B9). L'ancien propriétaire est clôturé.
  if doc.contact_id is not null then
    update public.vehicle_owners
       set is_current = false, to_date = coalesce(doc.issue_date, current_date)
     where vehicle_id = v.id and is_current and contact_id is distinct from doc.contact_id;
    insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
    select v.id, doc.contact_id, coalesce(doc.issue_date, current_date), true
     where not exists (select 1 from public.vehicle_owners o
                        where o.vehicle_id = v.id and o.contact_id = doc.contact_id and o.is_current);
  end if;

  -- Retirée du site : l'article n'est plus publiable et repasse en file (le site voit le stock à 0).
  update public.articles set publishable = false, updated_at = now()
   where id = new.article_id and publishable;
  begin
    perform public._shopify_enqueue(new.company_id, new.article_id, 'moto_vendue');
  exception when undefined_function then null;
  end;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (new.company_id, new.operator_id, 'moto_vendue', 'vehicles', v.id::text, coalesce(new.origin, 'system'),
          jsonb_build_object('status', v.status::text, 'display_price', v.display_price),
          jsonb_build_object('status', 'vendu', 'document', doc.number, 'contact_id', doc.contact_id,
                             'article_id', new.article_id));
  return new;
end $$;

drop trigger if exists trg_moto_sortie_de_stock on public.stock_moves;
create trigger trg_moto_sortie_de_stock
  after insert on public.stock_moves
  for each row execute function public._moto_sortie_de_stock();

-- ---------------------------------------------------------------------
-- 5. Contrôle de cohérence (lecture seule)
-- ---------------------------------------------------------------------
create or replace function public.vehicles_parc_check(_company uuid)
returns table (anomalie text, vehicle_id uuid, vin text, model text, statut text, detail text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  return query
  -- a) moto vendable sans article
  select 'moto_vendable_sans_article', v.id, v.vin, v.model, v.status::text,
         'Moto « ' || public.vehicle_parc_kind(v.status) || ' » sans article : elle ne peut pas être vendue ni publiée.'
    from public.vehicles v
   where v.company_id = _company and v.article_id is null and public.vehicle_needs_article(v.status)
  union all
  -- b) moto vendue encore publiée
  select 'moto_vendue_encore_publiee', v.id, v.vin, v.model, v.status::text,
         'Moto vendue dont l''article est encore « publiable » (référence ' || a.reference || ').'
    from public.vehicles v join public.articles a on a.id = v.article_id
   where v.company_id = _company and public.vehicle_parc_kind(v.status) = 'vendue' and a.publishable
  union all
  -- c) stock incohérent (une moto = 1 en stock, jamais négatif — B4, B7)
  select case when s.real_qty < 0 then 'stock_negatif' else 'stock_different_de_1' end,
         v.id, v.vin, v.model, v.status::text,
         'Stock réel de l''article ' || a.reference || ' = ' || s.real_qty::text || ' (attendu 1).'
    from public.vehicles v
    join public.articles a on a.id = v.article_id
   cross join lateral public.article_stock(a.id) s
   where v.company_id = _company and public.vehicle_needs_article(v.status) and coalesce(s.real_qty, 0) <> 1
  union all
  -- d) moto vendue avec du stock restant
  select 'moto_vendue_avec_stock', v.id, v.vin, v.model, v.status::text,
         'Moto vendue dont l''article ' || a.reference || ' a encore ' || s.real_qty::text || ' en stock.'
    from public.vehicles v
    join public.articles a on a.id = v.article_id
   cross join lateral public.article_stock(a.id) s
   where v.company_id = _company and public.vehicle_parc_kind(v.status) = 'vendue' and coalesce(s.real_qty, 0) > 0
  union all
  -- e) article de moto dont le type de gestion ne correspond plus au statut de parc
  select 'type_de_gestion_incoherent', v.id, v.vin, v.model, v.status::text,
         'Article ' || a.reference || ' de type ' || a.mgmt_type::text || ' pour une moto « ' ||
         public.vehicle_parc_kind(v.status) || ' ».'
    from public.vehicles v join public.articles a on a.id = v.article_id
   where v.company_id = _company
     and ((public.vehicle_parc_kind(v.status) = 'depot_vente' and a.mgmt_type::text <> 'D')
       or (public.vehicle_parc_kind(v.status) <> 'depot_vente' and a.mgmt_type::text = 'D'))
  limit 2000;
end $$;
revoke all on function public.vehicles_parc_check(uuid) from public, anon;
grant execute on function public.vehicles_parc_check(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Encart « Moto à vendre » de la fiche moto
-- ---------------------------------------------------------------------
create or replace function public.vehicle_site_status(_company uuid, _vehicle uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.vehicles; a public.articles; r jsonb;
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'vendeur')) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  select * into v from public.vehicles where id = _vehicle and company_id = _company;
  if v.id is null then return null; end if;
  select * into a from public.articles where id = v.article_id;

  select jsonb_build_object(
    'parc_kind', public.vehicle_parc_kind(v.status),
    'status', v.status::text,
    'publishable_status', public.vehicle_parc_publishable(v.status),
    'needs_article', public.vehicle_needs_article(v.status),
    'article', case when a.id is null then null else jsonb_build_object(
        'id', a.id, 'reference', a.reference, 'designation', a.designation,
        'mgmt_type', a.mgmt_type::text, 'publishable', a.publishable,
        'sale_price_ttc', a.sale_price_ttc, 'vat_rate', a.vat_rate,
        'real_qty', (select s.real_qty from public.article_stock(a.id) s)) end,
    'site', case when a.id is null then null else public.shopify_article_site_status(_company, a.id) end
  ) into r;
  return r;
end $$;
revoke all on function public.vehicle_site_status(uuid, uuid) from public, anon;
grant execute on function public.vehicle_site_status(uuid, uuid) to authenticated;
