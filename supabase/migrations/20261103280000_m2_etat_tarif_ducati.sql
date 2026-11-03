-- =====================================================================
-- M2 / M4 — Etat au tarif Ducati lu correctement (TAR008, 03/11/2026). NON APPLIQUEE.
--
-- Colonne « Etat » des fichiers ListPrice Ducati (comptage sur PARTS / ACCESSORIES / APPAREL) :
--   vide = reference active, commandable          -> articles.supplier_availability = 'green'
--   E    = reference remplacee                    -> 'yellow' (pastille « Remplacee »)
--   F    = fin de serie sans remplacant           -> 'red'    (pastille « Fin de serie »)
-- Le DMS lisait l'inverse (E = vert, vide = rien). Le code (rules.ts) est corrige ; cette
-- migration :
--   1. recalcule supplier_availability des articles Ducati deja en base. L'etat brut du tarif
--      n'est stocke nulle part : on deduit ce qui est sur (reference remplacee dans le DMS ou
--      dans le catalogue Ducati -> 'yellow') ; un ancien 'green' (venu de E) sans remplacement
--      connu redevient inconnu ; 'red' (F) ne change pas. Le reste se recalcule au prochain
--      import de tarif. Une ligne events par societe (comptes avant / apres).
--   2. garde-fou en base : une piece 'red' (fin de serie) ou 'yellow' (remplacee) ne peut pas
--      entrer dans un panier fournisseur ni dans une commande de pieces (message clair) ;
--   3. le remplissage par les minimums (minimax) ne propose plus ces pieces.
-- La contrainte green / yellow / red est inchangee : aucune nouvelle valeur.
-- Idempotente. Rien n'est ecrit sur Shopify ; aucun mouvement de stock (le stock restant se vend).
-- =====================================================================

-- ------------------------------------------------ 1. Donnees existantes
do $$
declare
  co record;
  before_g int; before_y int; before_r int; before_n int;
  n_yellow int; n_reset int;
begin
  for co in select distinct company_id from public.articles loop
    select count(*) filter (where supplier_availability = 'green'),
           count(*) filter (where supplier_availability = 'yellow'),
           count(*) filter (where supplier_availability = 'red'),
           count(*) filter (where supplier_availability is null)
      into before_g, before_y, before_r, before_n
      from public.articles where company_id = co.company_id;

    -- Articles Ducati : marque Ducati, ou relies au catalogue Ducati (pieces / produits).
    with duc as (
      select a.id, a.superseded_by_id, a.supplier_availability
        from public.articles a
       where a.company_id = co.company_id
         and (upper(coalesce(a.brand, '')) like 'DUCATI%'
              or exists (select 1 from public.article_links l
                          where l.article_id = a.id and l.target_kind in ('ducati_part', 'ducati_product') and l.status = 'lie'))
    ), repl as (
      select d.id from duc d
       where coalesce(d.supplier_availability, '') <> 'red'
         and (d.superseded_by_id is not null
              or exists (select 1 from public.article_links l
                           join public.ducati_catalog_parts p on p.reference_norm = l.target_ref
                          where l.article_id = d.id and l.target_kind = 'ducati_part' and l.status = 'lie' and p.replaced))
    )
    update public.articles a set supplier_availability = 'yellow'
      from repl where a.id = repl.id and a.supplier_availability is distinct from 'yellow';
    get diagnostics n_yellow = row_count;

    -- Ancien 'green' (venu de « E » avec l'ancienne lecture) sans remplacement connu : inconnu.
    update public.articles a set supplier_availability = null
     where a.company_id = co.company_id and a.supplier_availability = 'green' and a.superseded_by_id is null
       and not exists (select 1 from public.article_links l
                         join public.ducati_catalog_parts p on p.reference_norm = l.target_ref
                        where l.article_id = a.id and l.target_kind = 'ducati_part' and l.status = 'lie' and p.replaced);
    get diagnostics n_reset = row_count;

    if n_yellow + n_reset > 0 then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (co.company_id, auth.uid(), 'supplier_availability_recalc', 'articles', 'TAR008', 'system',
              jsonb_build_object('green', before_g, 'yellow', before_y, 'red', before_r, 'null', before_n),
              jsonb_build_object('set_yellow', n_yellow, 'reset_unknown', n_reset,
                                 'rule', 'Ducati remplacee -> yellow ; ancien green sans remplacement -> null ; red inchange'));
    end if;
  end loop;
end $$;

-- ------------------------------------------------ 2. Garde-fou panier fournisseur / commande de pieces
-- Refus avec la raison ; les ecrans filtrent avant (src/modules/articles/supply-guard.ts).
create or replace function public._supply_order_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a   record;
  nxt text;
begin
  if new.article_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.article_id is not distinct from old.article_id then return new; end if;
  select id, reference, supplier_availability, superseded_by_id into a from public.articles where id = new.article_id;
  if not found then return new; end if;
  if a.supplier_availability = 'red' then
    raise exception '% : fin de série chez Ducati, sans remplaçant : plus commandable.', a.reference using errcode = 'P0001';
  end if;
  if a.supplier_availability = 'yellow' then
    select reference into nxt from public.articles where id = a.superseded_by_id;
    if nxt is not null then
      raise exception '% : remplacée par % chez Ducati : commandez la nouvelle référence.', a.reference, nxt using errcode = 'P0001';
    end if;
    raise exception '% : remplacée chez Ducati : commandez la nouvelle référence.', a.reference using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public._supply_order_guard() from public, anon, authenticated;

drop trigger if exists trg_supplier_basket_lines_supply on public.supplier_basket_lines;
create trigger trg_supplier_basket_lines_supply
  before insert or update of article_id on public.supplier_basket_lines
  for each row execute function public._supply_order_guard();

drop trigger if exists trg_part_order_lines_supply on public.part_order_lines;
create trigger trg_part_order_lines_supply
  before insert or update of article_id on public.part_order_lines
  for each row execute function public._supply_order_guard();

-- ------------------------------------------------ 3. Minimax : ni fin de serie, ni remplacee
-- Meme fonction que 20261103100000, avec le filtre supplier_availability.
create or replace function public._basket_fill_minimax(_basket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       public.supplier_baskets%rowtype;
  r       record;
  need    numeric;
  lines   jsonb := '[]'::jsonb;
  n_rm    int := 0;
  res     jsonb;
begin
  select * into b from public.supplier_baskets where id = _basket;
  if not found then
    raise exception 'Panier introuvable.' using errcode = 'P0002';
  end if;
  if b.status <> 'ouvert' then
    raise exception 'Ce panier est déjà commandé (%).', b.label using errcode = 'P0001';
  end if;
  for r in
    select a.id, a.stock_min, a.stock_max, public._basket_real_qty(a.id) as real_qty
      from public.articles a
     where a.company_id = b.company_id and a.mgmt_type = 'A' and coalesce(a.is_active, true)
       and coalesce(a.stock_min, 0) > 0
       -- TAR008 : fin de serie (F) et remplacee (E) ne se recommandent pas sous ce numero
       and coalesce(a.supplier_availability, '') not in ('red', 'yellow')
  loop
    if r.real_qty >= r.stock_min then
      continue;
    end if;
    -- déjà en commande : CMD / commandes de pièces / autres paniers + lignes NON minimax de ce panier
    need := public._basket_minimax_qty(r.stock_min, r.stock_max, r.real_qty,
              public._basket_on_order_qty(b.company_id, r.id, _basket)
              + coalesce((select sum(l.qty) from public.supplier_basket_lines l
                           where l.basket_id = _basket and l.article_id = r.id and l.origin <> 'minimax'), 0));
    if need > 0 then
      lines := lines || jsonb_build_object('article_id', r.id, 'qty', need, 'origin', 'minimax');
    end if;
  end loop;
  -- lignes minimax de ce panier dont le besoin a disparu
  perform set_config('app.basket_rpc', 'on', true);
  with keep as (select (x ->> 'article_id')::uuid as aid from jsonb_array_elements(lines) x)
  delete from public.supplier_basket_lines l
   where l.basket_id = _basket and l.origin = 'minimax'
     and l.article_id not in (select aid from keep);
  get diagnostics n_rm = row_count;
  perform set_config('app.basket_rpc', 'off', true);
  res := public._basket_add_lines(_basket, lines, true);
  return res || jsonb_build_object('removed', n_rm);
end $$;
revoke all on function public._basket_fill_minimax(uuid) from public, anon, authenticated;

comment on column public.articles.supplier_availability is
  'Etat au tarif fournisseur (TAR008) : green = commandable (Etat vide), yellow = remplacee (E), red = fin de serie sans remplacant (F). Null = inconnu (tarif pas encore importe).';
