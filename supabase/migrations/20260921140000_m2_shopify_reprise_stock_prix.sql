-- =====================================================================
-- Mission 03 — « Reprendre le stock et vérifier les prix de vente des articles reliés au site »
-- (décision W-10 du 21/09 : stock de départ = stock Shopify ; prix = prix du site ; prix du DMS en HT).
--
-- Constat (simulation du 21/09) : les 300 articles reliés avaient un stock DMS à 0 et un « PV TTC »
-- repris de G8 qui est en réalité un prix HORS TVA (prix du site ≈ 1,245 × prix DMS ; 5 sans prix ;
-- quelques prix G8 divisés par 1 000). Le calcul du TTC envoyé au site (shopifyTtc) était juste : c'est
-- la DONNÉE (PV G8 HT rangé dans sale_price_ttc) qui était fausse.
--
-- shopify_realign(_company, _apply) — réexécutable (idempotente) :
--   * _apply = false : APERÇU seulement (rien n'est écrit) ;
--   * _apply = true  : pour chaque article RELIÉ (liaison auto_exact / valide, variante encore sur le site),
--       - STOCK : si le stock réel du DMS ≠ stock Shopify (instantané shopify_products, « Relire Shopify »
--         avant) → UN mouvement « inventaire » (réajustement annule-et-remplace, B6) par record_stock_move,
--         origine « reprise_shopify », réf. « Reprise Shopify », note « ancien → nouveau » (B7).
--         Aucun prix d'achat inventé : unit_cost NULL → le PAMP ne bouge pas (voir M05 §7).
--       - PRIX : PV HT = prix Shopify TTC ÷ (1 + TVA de l'article, 21 % par défaut), arrondi au centime ;
--         PV TTC = prix Shopify ; par record_price_change (trace price_changes, origine
--         « reprise_prix_shopify ») et SEULEMENT si différent. Prix verrouillé ou TVA marge (O) : non touché.
--       - une trace de synthèse dans events (« shopify_realign »).
--   Une 2e exécution ne change rien (écarts recalculés à partir de l'état courant).
-- Rien n'est écrit sur Shopify. Le mode de synchronisation n'est pas modifié (livré « Arrêtée »).
-- =====================================================================

create or replace function public.shopify_realign(_company uuid, _apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r           record;
  rows_out    jsonb := '[]'::jsonb;
  n_linked    int := 0;
  n_stock     int := 0;
  n_price     int := 0;
  n_notes     int := 0;
  pcs_before  numeric := 0;
  pcs_after   numeric := 0;
  moves       int := 0;
  prices      int := 0;
  snap_at     timestamptz;
  v_mode      text;
begin
  -- Administrateur de la société, ou appel serveur (clé de service / SQL : pas d'utilisateur).
  if auth.uid() is not null and not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = _company) then
    raise exception 'Société introuvable.' using errcode = 'P0002';
  end if;
  if _apply then
    -- une seule reprise à la fois par société
    perform pg_advisory_xact_lock(hashtext('shopify_realign'), hashtext(_company::text));
  end if;

  v_mode := public._shopify_sync_mode(_company);

  for r in
    with lk as (
      select l.article_id, l.shopify_variant_id, p.shopify_product_id, p.product_title, p.variant_title,
             p.status as shop_status, p.price as shop_price, p.inventory_quantity as shop_qty, p.synced_at,
             count(*) over (partition by l.article_id) as links_of_article
        from public.shopify_links l
        join public.shopify_products p
          on p.company_id = l.company_id and p.shopify_variant_id = l.shopify_variant_id and p.removed_at is null
       where l.company_id = _company and l.status in ('auto_exact', 'valide') and l.article_id is not null
    )
    select lk.*, a.reference, a.designation, a.mgmt_type::text as mgmt_type, a.is_library,
           a.price_sale_locked, a.sale_price_ht, a.sale_price_ttc, a.vat_rate, a.pamp, a.purchase_price,
           coalesce(s.real_qty, 0) as real_qty, coalesce(s.reserved_qty, 0) as reserved_qty
      from lk
      join public.articles a on a.id = lk.article_id and a.company_id = _company
      left join lateral (
        select sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
               sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
          from public.stock_moves m where m.article_id = a.id
      ) s on true
     order by a.reference
  loop
    declare
      notes      text[] := '{}';
      managed    boolean := r.mgmt_type in ('A', 'V', 'O', 'P', 'D');
      target     numeric;
      delta      numeric := 0;
      rate       numeric := coalesce(r.vat_rate, 21);
      new_ht     numeric;
      new_ttc    numeric;
      do_price   boolean := false;
      do_stock   boolean := false;
      real_after numeric := r.real_qty;
    begin
      n_linked := n_linked + 1;
      snap_at := greatest(snap_at, r.synced_at);

      if r.links_of_article > 1 then
        notes := array_append(notes, 'article relié à plusieurs produits du site : non traité');
      else
        -- STOCK
        if not managed then
          notes := array_append(notes, 'type de gestion sans stock suivi');
        elsif r.shop_qty is null then
          notes := array_append(notes, 'stock Shopify inconnu : relire Shopify');
        else
          target := greatest(r.shop_qty, 0);
          if r.shop_qty < 0 then notes := array_append(notes, 'stock Shopify négatif : ramené à 0'); end if;
          delta := target - r.real_qty;
          do_stock := delta <> 0;
          if do_stock then real_after := target; end if;
          if r.is_library and target > 0 then notes := array_append(notes, 'article en librairie'); end if;
          if r.reserved_qty <> 0 then notes := array_append(notes, 'réservé dans le DMS : le site recevra réel − réservé'); end if;
        end if;

        -- PRIX (W-7 : prix du site TVA comprise ; W-10 : le prix du site fait foi, PV du DMS en HT)
        if r.shop_price is null or r.shop_price <= 0 then
          notes := array_append(notes, 'pas de prix sur le site : prix du DMS inchangé');
        elsif r.mgmt_type = 'O' then
          notes := array_append(notes, 'occasion TVA marge : prix non repris');
        elsif r.price_sale_locked then
          notes := array_append(notes, 'prix de vente verrouillé : non modifié');
        else
          new_ttc := round(r.shop_price, 2);
          new_ht := round(r.shop_price / (1 + rate / 100), 2);
          do_price := r.sale_price_ht is distinct from new_ht or r.sale_price_ttc is distinct from new_ttc;
        end if;
      end if;

      pcs_before := pcs_before + r.real_qty;
      pcs_after := pcs_after + real_after;
      if do_stock then n_stock := n_stock + 1; end if;
      if do_price then n_price := n_price + 1; end if;
      if cardinality(notes) > 0 then n_notes := n_notes + 1; end if;

      if _apply and do_stock then
        perform public.record_stock_move(
          r.article_id, 'inventaire'::stock_move_type, delta, null, false, null, 'reprise_shopify', 'Reprise Shopify',
          format('Reprise du stock Shopify (annule et remplace) : %s → %s', trim_scale(r.real_qty)::text,
                 trim_scale(target)::text));
        moves := moves + 1;
      end if;
      if _apply and do_price then
        perform public.record_price_change(r.article_id, null, new_ht, new_ttc, null, 'reprise_prix_shopify');
        prices := prices + 1;
      end if;

      if do_stock or do_price or cardinality(notes) > 0 then
        rows_out := rows_out || jsonb_build_object(
          'article_id', r.article_id, 'reference', r.reference, 'designation', r.designation,
          'product_title', r.product_title, 'shop_status', r.shop_status,
          'stock_before', r.real_qty, 'stock_after', case when do_stock then target else r.real_qty end,
          'shop_qty', r.shop_qty, 'reserved', r.reserved_qty, 'stock_change', do_stock,
          'shop_price', r.shop_price, 'vat_rate', rate,
          'ht_before', r.sale_price_ht, 'ttc_before', r.sale_price_ttc,
          'ht_after', case when do_price then new_ht else r.sale_price_ht end,
          'ttc_after', case when do_price then new_ttc else r.sale_price_ttc end,
          'price_change', do_price, 'notes', to_jsonb(notes));
      end if;
    end;
  end loop;

  if _apply then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_realign', 'companies', _company::text, 'reprise_shopify',
            jsonb_build_object('pieces', pcs_before),
            jsonb_build_object('linked', n_linked, 'stock_moves', moves, 'price_changes', prices,
                               'pieces', pcs_after, 'snapshot_at', snap_at, 'sync_mode', v_mode));
  end if;

  return jsonb_build_object(
    'applied', _apply, 'snapshot_at', snap_at, 'sync_mode', v_mode,
    'linked', n_linked, 'stock_to_change', n_stock, 'price_to_change', n_price, 'with_notes', n_notes,
    'pieces_before', pcs_before, 'pieces_after', pcs_after,
    'stock_moves', moves, 'price_changes', prices,
    'rows', rows_out);
end $$;

revoke all on function public.shopify_realign(uuid, boolean) from public, anon;
grant execute on function public.shopify_realign(uuid, boolean) to authenticated, service_role;

comment on function public.shopify_realign(uuid, boolean) is
  'Mission 03 (W-10) : aligne le stock réel (mouvement inventaire, origine reprise_shopify) et le PV HT/TTC '
  '(price_changes, origine reprise_prix_shopify) des articles reliés sur le site Shopify. _apply=false : aperçu. '
  'Idempotente. N''écrit rien sur Shopify.';
