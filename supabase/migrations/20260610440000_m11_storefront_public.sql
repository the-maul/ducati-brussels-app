-- =====================================================================
-- M11 — Storefront PUBLIC (accès anonyme) : vitrine /shop/{slug} consultable sans
-- authentification, commande en ligne, images produits publiques. Sécurité : on
-- n'expose JAMAIS la table articles à anon (prix d'achat/PAMP sensibles) — seules
-- des RPC SECURITY DEFINER renvoient des champs publics. Domaine personnalisé (OVH/DNS).
-- =====================================================================

alter table public.shop_settings add column if not exists custom_domain text;

-- Réglages publics d'une boutique publiée (par slug ou domaine).
create or replace function public.shop_public_info(_slug text)
returns table(company_id uuid, name text, description text, hero_text text, theme_color text, phone text, email text, address text)
language sql stable security definer set search_path = public, pg_temp as $$
  select company_id, name, description, hero_text, theme_color, phone, email, address
  from public.shop_settings where published = true and (slug = _slug or custom_domain = _slug);
$$;
grant execute on function public.shop_public_info(text) to anon, authenticated;

-- Catalogue public : uniquement les articles publiables, champs publics seulement.
create or replace function public.shop_public_catalog(_slug text)
returns table(article_id uuid, reference text, designation text, price_ttc numeric, available numeric, image_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  with shop as (select company_id from public.shop_settings where published = true and (slug = _slug or custom_domain = _slug))
  select a.id, a.reference, a.designation, a.sale_price_ttc,
    coalesce(s.real_qty, 0) - coalesce(s.reserved_qty, 0) as available,
    (select storage_path from public.attachments att where att.entity_type = 'article' and att.entity_id = a.id and att.content_type like 'image/%' order by att.created_at limit 1)
  from public.articles a
  cross join shop
  left join lateral (
    select sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
           sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
    from public.stock_moves m where m.article_id = a.id
  ) s on true
  where a.company_id = shop.company_id and a.publishable = true
  order by a.reference;
$$;
grant execute on function public.shop_public_catalog(text) to anon, authenticated;

-- Passe une commande web depuis le storefront public (anon). Insère commande + lignes
-- + réservations de stock (append-only B4/B7) en tant que propriétaire (bypass is_member).
create or replace function public.place_web_order(_slug text, _name text, _email text, _phone text, _address text, _lines jsonb)
returns table(order_id uuid, number text) language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _order uuid; _num text; _l jsonb; _total numeric := 0; _art uuid; _qty numeric; _price numeric; _desig text;
begin
  select company_id into _company from public.shop_settings where published = true and (slug = _slug or custom_domain = _slug);
  if _company is null then raise exception 'Boutique introuvable'; end if;

  insert into public.web_orders (company_id, customer_name, email, phone, address, status, total_ttc)
    values (_company, _name, _email, _phone, _address, 'en_attente_paiement', 0)
    returning id into _order;
  _num := 'WEB-' || to_char(now(), 'YYYY') || '-' || substr(_order::text, 1, 6);
  update public.web_orders set number = _num where id = _order;

  for _l in select * from jsonb_array_elements(_lines) loop
    _art := (_l->>'article_id')::uuid;
    _qty := (_l->>'quantity')::numeric;
    _price := (_l->>'unit_price_ttc')::numeric;
    select designation into _desig from public.articles where id = _art and company_id = _company;
    if _desig is null or _qty <= 0 then continue; end if;
    insert into public.web_order_lines (order_id, article_id, designation, quantity, unit_price_ttc, line_ttc)
      values (_order, _art, _desig, _qty, _price, round(_qty * _price, 2));
    _total := _total + _qty * _price;
    -- réservation de stock (disponible)
    insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, origin, ref, note)
      values (_company, _art, 'reservation', _qty, true, 'eshop', _order::text, 'Commande web');
  end loop;

  update public.web_orders set total_ttc = round(_total, 2) where id = _order;
  return query select _order, _num;
end $$;
grant execute on function public.place_web_order(text, text, text, text, text, jsonb) to anon, authenticated;

-- Accès anonyme aux IMAGES des articles publiables (bucket ged) pour le storefront.
drop policy if exists ged_public_products on storage.objects;
create policy ged_public_products on storage.objects for select to anon
  using (
    bucket_id = 'ged'
    and (storage.foldername(name))[2] = 'article'
    and exists (select 1 from public.articles ar where ar.id = ((storage.foldername(name))[3])::uuid and ar.publishable = true)
  );
