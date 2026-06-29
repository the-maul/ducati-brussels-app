-- =====================================================================
-- M2 — Prix de vente « effectif » (arrondi catalogue) côté serveur.
-- Le réglage société `round_sale_prices_up` arrondit le PRIX CATALOGUE de base à
-- l'euro supérieur (plancher 2 €). L'arrondi n'est JAMAIS écrit dans `articles`
-- (réversible : décocher = prix d'origine) — il est calculé à la lecture, ici dans
-- les RPC qui servent un prix de vente :
--   • resolve_customer_price : on arrondit la BASE catalogue, puis la remise client
--     s'applique dessus (décision client : on n'arrondit que le prix catalogue).
--   • shop_public_catalog / place_web_order : prix public arrondi (anti-tampering :
--     place_web_order re-dérive le prix depuis l'article, ne fait pas confiance au client).
-- =====================================================================

-- Arrondi à l'euro supérieur, plancher 2 € (ex. 9,2 → 10 ; 1,3 → 2 ; 0 → 0).
create or replace function public.round_up_euro(p numeric)
returns numeric language sql immutable as $$
  select case when p > 0 then greatest(2, ceil(p - 1e-6)) else p end;
$$;

-- ---------------------------------------------------------------------
-- Tarif client : base catalogue arrondie (si réglage société) PUIS remise.
-- ---------------------------------------------------------------------
create or replace function public.resolve_customer_price(_company uuid, _contact uuid, _article uuid, _qty numeric default 1)
returns table(unit_price_ht numeric, unit_price_ttc numeric, rule_kind text, discount_pct numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a record; r record; _pct numeric; _ht numeric; _ttc numeric; _cat uuid; _tier jsonb; _best numeric;
  _ru boolean; _vf numeric; _base_ttc numeric; _base_ht numeric;
begin
  select sale_price_ht, sale_price_ttc, purchase_price, vat_rate, category_id
    into a from public.articles where id = _article and company_id = _company;
  if a is null then return; end if;
  _cat := a.category_id;
  _vf := 1 + coalesce(a.vat_rate, 21) / 100.0;

  -- Base catalogue effective : arrondie si le réglage société est actif.
  select round_sale_prices_up into _ru from public.companies where id = _company;
  if coalesce(_ru, true) and coalesce(a.sale_price_ttc, 0) > 0 then
    _base_ttc := public.round_up_euro(a.sale_price_ttc);
    _base_ht  := round(_base_ttc / _vf, 2);
  else
    _base_ttc := coalesce(a.sale_price_ttc, 0);
    _base_ht  := coalesce(a.sale_price_ht, 0);
  end if;

  select * into r from public.customer_price_rules cpr
  where cpr.company_id = _company and cpr.is_active
    and (cpr.contact_id is null or cpr.contact_id = _contact)
    and (cpr.article_id is null or cpr.article_id = _article)
    and (cpr.category_id is null or cpr.category_id = _cat)
  order by ((case when cpr.contact_id is not null then 2 else 0 end)
          + (case when cpr.article_id is not null then 2 else 0 end)
          + (case when cpr.category_id is not null then 1 else 0 end)) desc,
          cpr.created_at desc
  limit 1;

  if r is null then
    return query select _base_ht, _base_ttc, 'base'::text, 0::numeric;
    return;
  end if;

  if r.kind = 'coefficient' then
    -- Prix négocié (PA × coef) : pas un prix catalogue → non arrondi.
    _ht := round(coalesce(a.purchase_price,0) * r.value, 2);
    _ttc := round(_ht * _vf, 2);
    return query select _ht, _ttc, 'coefficient'::text, 0::numeric;
  elsif r.kind = 'quantity_tiers' then
    _pct := 0; _best := -1;
    for _tier in select * from jsonb_array_elements(coalesce(r.tiers, '[]'::jsonb)) loop
      if (_tier->>'min_qty')::numeric <= _qty and (_tier->>'min_qty')::numeric > _best then
        _best := (_tier->>'min_qty')::numeric; _pct := (_tier->>'discount_pct')::numeric;
      end if;
    end loop;
    _ht := round(_base_ht * (1 - _pct/100.0), 2);          -- remise sur base arrondie
    _ttc := round(_ht * _vf, 2);
    return query select _ht, _ttc, 'quantity_tiers'::text, _pct;
  else -- discount_pct
    _pct := r.value;
    _ht := round(_base_ht * (1 - _pct/100.0), 2);           -- remise sur base arrondie
    _ttc := round(_ht * _vf, 2);
    return query select _ht, _ttc, 'discount_pct'::text, _pct;
  end if;
end $$;
grant execute on function public.resolve_customer_price(uuid, uuid, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Catalogue public : prix TTC arrondi selon le réglage société.
-- ---------------------------------------------------------------------
create or replace function public.shop_public_catalog(_slug text)
returns table(article_id uuid, reference text, designation text, price_ttc numeric, available numeric, image_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  with shop as (select company_id from public.shop_settings where published = true and (slug = _slug or custom_domain = _slug))
  select a.id, a.reference, a.designation,
    case when coalesce(co.round_sale_prices_up, true) then public.round_up_euro(a.sale_price_ttc) else a.sale_price_ttc end as price_ttc,
    coalesce(s.real_qty, 0) - coalesce(s.reserved_qty, 0) as available,
    (select storage_path from public.attachments att where att.entity_type = 'article' and att.entity_id = a.id and att.content_type like 'image/%' order by att.created_at limit 1)
  from public.articles a
  cross join shop
  join public.companies co on co.id = shop.company_id
  left join lateral (
    select sum(case when not m.is_reservation then m.qty_delta else 0 end) as real_qty,
           sum(case when m.is_reservation then m.qty_delta else 0 end) as reserved_qty
    from public.stock_moves m where m.article_id = a.id
  ) s on true
  where a.company_id = shop.company_id and a.publishable = true
  order by a.reference;
$$;
grant execute on function public.shop_public_catalog(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Commande web : prix re-dérivé du catalogue (arrondi) côté serveur, sans faire
-- confiance au montant envoyé par le client (anti-tampering).
-- ---------------------------------------------------------------------
create or replace function public.place_web_order(_slug text, _name text, _email text, _phone text, _address text, _lines jsonb)
returns table(order_id uuid, number text) language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _order uuid; _num text; _l jsonb; _total numeric := 0; _art uuid; _qty numeric; _price numeric; _desig text; _ru boolean;
begin
  select company_id into _company from public.shop_settings where published = true and (slug = _slug or custom_domain = _slug);
  if _company is null then raise exception 'Boutique introuvable'; end if;
  select round_sale_prices_up into _ru from public.companies where id = _company;

  insert into public.web_orders (company_id, customer_name, email, phone, address, status, total_ttc)
    values (_company, _name, _email, _phone, _address, 'en_attente_paiement', 0)
    returning id into _order;
  _num := 'WEB-' || to_char(now(), 'YYYY') || '-' || substr(_order::text, 1, 6);
  update public.web_orders set number = _num where id = _order;

  for _l in select * from jsonb_array_elements(_lines) loop
    _art := (_l->>'article_id')::uuid;
    _qty := (_l->>'quantity')::numeric;
    -- prix officiel = prix catalogue (arrondi si réglage société), pas celui du client
    select designation,
           case when coalesce(_ru, true) then public.round_up_euro(sale_price_ttc) else coalesce(sale_price_ttc, 0) end
      into _desig, _price from public.articles where id = _art and company_id = _company;
    if _desig is null or _qty <= 0 then continue; end if;
    insert into public.web_order_lines (order_id, article_id, designation, quantity, unit_price_ttc, line_ttc)
      values (_order, _art, _desig, _qty, _price, round(_qty * _price, 2));
    _total := _total + _qty * _price;
    insert into public.stock_moves (company_id, article_id, move_type, qty_delta, is_reservation, origin, ref, note)
      values (_company, _art, 'reservation', _qty, true, 'eshop', _order::text, 'Commande web');
  end loop;

  update public.web_orders set total_ttc = round(_total, 2) where id = _order;
  return query select _order, _num;
end $$;
grant execute on function public.place_web_order(text, text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
