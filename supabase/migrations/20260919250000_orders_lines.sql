-- =====================================================================
-- Mission 02 — carte « Ajouter et modifier les pièces d'une commande »
--
-- Aujourd'hui l'écran Commandes de pièces crée une commande vide. Ce lot ajoute :
--   - la recherche d'article (référence, désignation, réf. fournisseur, code-barres)
--     avec stock disponible (triple stock B4) et casier : part_order_article_search ;
--   - l'ajout, la modification et la suppression d'une ligne tant que la commande
--     est en brouillon : part_order_line_save / part_order_line_delete, chaque
--     écriture tracée dans events (qui, quoi, ancien → nouveau, règle 4) ;
--   - les lignes avec casier et stock : part_order_lines_detail ;
--   - une garde sur la table (trigger) : lignes figées dès que la commande quitte
--     le brouillon, quantités et prix contrôlés, total de ligne recalculé par le
--     serveur (même formule que part_order_check_rules).
-- Le stock n'est JAMAIS modifié ici (aucun stock_moves) : une commande de pièces
-- n'est pas une réservation de stock à ce stade.
--
-- Disponible (B4) = réel − réservé + en commande.
--   réel / réservé : fonction existante article_stock (réutilisée) ;
--   en commande    : quantités des commandes fournisseur (CMD) validées sans
--                    réception reçue liée (purchase_orders.source_order_id).
--   Les commandes de pièces ne sont pas comptées en commande : elles le seront
--   quand elles deviendront des commandes fournisseur (carte « Regrouper par
--   fournisseur et envoyer »), sinon elles seraient comptées deux fois.
--
-- Additif uniquement : 5 fonctions, 1 trigger. Aucune table, aucune colonne.
-- =====================================================================

-- 1. Quantité en commande d'un article (usage interne des fonctions ci-dessous)
create or replace function public._article_on_order_qty(_article uuid)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.quantity), 0)
    from public.purchase_lines l
    join public.purchase_orders o on o.id = l.order_id
   where l.article_id = _article
     and o.doc_type = 'CMD'
     and o.status = 'validee'
     and not exists (
       select 1 from public.purchase_orders r
        where r.source_order_id = o.id and r.doc_type = 'REC' and r.status = 'recue'
     );
$$;

revoke all on function public._article_on_order_qty(uuid) from public, anon, authenticated;

-- 2. Garde sur les lignes : brouillon seulement, contrôles, total de ligne serveur
create or replace function public.part_order_lines_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  st public.order_dispatch_status;
begin
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    raise exception 'Une pièce ne change pas de commande.' using errcode = '42501';
  end if;

  select dispatch_status into st
    from public.part_orders
   where id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  if tg_op = 'DELETE' then
    -- st null : l'en-tête est en cours de suppression (cascade)
    if st is not null and st <> 'brouillon' then
      raise exception 'Commande déjà validée : les pièces ne se modifient plus.' using errcode = '42501';
    end if;
    return old;
  end if;

  if st is null then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;

  if st <> 'brouillon' then
    -- Seule la maintenance des liens reste possible (article supprimé, fusion de fournisseurs)
    if tg_op = 'INSERT'
       or (new.reference, new.designation, new.qty_client, new.qty_shop, new.unit_price_ht,
           new.vat_rate, new.line_ht, new.sort_order)
          is distinct from
          (old.reference, old.designation, old.qty_client, old.qty_shop, old.unit_price_ht,
           old.vat_rate, old.line_ht, old.sort_order) then
      raise exception 'Commande déjà validée : les pièces ne se modifient plus.' using errcode = '42501';
    end if;
    return new;
  end if;

  if nullif(btrim(coalesce(new.designation, '')), '') is null then
    raise exception 'Indiquez la désignation de la pièce.' using errcode = 'P0001';
  end if;
  if coalesce(new.qty_client, 0) < 0 or coalesce(new.qty_shop, 0) < 0 then
    raise exception 'Les quantités ne peuvent pas être négatives.' using errcode = 'P0001';
  end if;
  if coalesce(new.qty_client, 0) + coalesce(new.qty_shop, 0) <= 0 then
    raise exception 'Indiquez une quantité client ou une quantité magasin.' using errcode = 'P0001';
  end if;
  if coalesce(new.unit_price_ht, 0) < 0 then
    raise exception 'Le prix HTVA ne peut pas être négatif.' using errcode = 'P0001';
  end if;
  if coalesce(new.vat_rate, 0) < 0 or coalesce(new.vat_rate, 0) > 100 then
    raise exception 'Taux de TVA invalide.' using errcode = 'P0001';
  end if;

  new.qty_client := coalesce(new.qty_client, 0);
  new.qty_shop := coalesce(new.qty_shop, 0);
  new.unit_price_ht := coalesce(new.unit_price_ht, 0);
  new.line_ht := round((new.qty_client + new.qty_shop) * new.unit_price_ht, 2);
  return new;
end $$;

revoke all on function public.part_order_lines_guard() from public, anon, authenticated;

drop trigger if exists trg_part_order_lines_guard on public.part_order_lines;
create trigger trg_part_order_lines_guard before insert or update or delete on public.part_order_lines
  for each row execute function public.part_order_lines_guard();

-- 3. Totaux du brouillon (Σ lignes), recalculés après chaque écriture de ligne.
--    Le supplément du type et le total définitif sont fixés à la validation
--    (part_order_transition), comme avant.
create or replace function public._part_order_refresh_totals(_order_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.part_orders o set
    total_ht  = t.ht,
    total_ttc = t.ttc
  from (
    select coalesce(sum(l.line_ht), 0) as ht,
           round(coalesce(sum(l.line_ht * (1 + l.vat_rate / 100)), 0), 2) as ttc
      from public.part_order_lines l where l.order_id = _order_id
  ) t
  where o.id = _order_id and o.dispatch_status = 'brouillon'
    and (o.total_ht, o.total_ttc) is distinct from (t.ht, t.ttc);
$$;

revoke all on function public._part_order_refresh_totals(uuid) from public, anon, authenticated;

-- 4. Recherche d'article pour une commande : réf., désignation, réf. fournisseur, code-barres
create or replace function public.part_order_article_search(_company uuid, _term text, _limit int default 12)
returns table (
  article_id uuid, reference text, designation text, supplier_ref text,
  supplier_id uuid, supplier_name text, bin_location text, bin_location2 text,
  sale_price_ht numeric, vat_rate numeric, mgmt_type text, is_library boolean,
  matched_barcode text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, available_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s   text := btrim(coalesce(_term, ''));
  lim int  := least(greatest(coalesce(_limit, 12), 1), 50);
  esc text;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if char_length(s) < 2 then
    return;
  end if;
  esc := replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  with bc as (
    select distinct on (b.article_id) b.article_id, b.barcode
      from public.article_barcodes b
      join public.articles a on a.id = b.article_id
     where a.company_id = _company and b.barcode = s
  ), hits as (
    select a.id,
           case when bc.article_id is not null or upper(a.reference) = upper(s) then 0
                when a.reference ilike esc || '%' then 1
                else 2 end as rk,
           bc.barcode
      from public.articles a
      left join bc on bc.article_id = a.id
     where a.company_id = _company
       and a.is_active
       and (bc.article_id is not null
            or a.reference ilike '%' || esc || '%'
            or a.designation ilike '%' || esc || '%'
            or a.supplier_ref ilike '%' || esc || '%')
     order by rk, a.reference
     limit lim
  )
  select a.id, a.reference, a.designation, a.supplier_ref,
         a.main_supplier_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         a.bin_location, a.bin_location2,
         coalesce(a.sale_price_ht, 0), coalesce(a.vat_rate, 21), a.mgmt_type::text, a.is_library,
         h.barcode,
         st.real_qty, st.reserved_qty, oo.q,
         st.real_qty - st.reserved_qty + oo.q
    from hits h
    join public.articles a on a.id = h.id
    left join public.contacts c on c.id = a.main_supplier_id
    cross join lateral public.article_stock(a.id) st
    cross join lateral (select public._article_on_order_qty(a.id) as q) oo
   order by h.rk, a.reference;
end $$;

revoke all on function public.part_order_article_search(uuid, text, int) from public, anon;
grant execute on function public.part_order_article_search(uuid, text, int) to authenticated;

-- 5. Lignes d'une commande avec fournisseur, casier et stock
create or replace function public.part_order_lines_detail(_order_id uuid)
returns table (
  id uuid, order_id uuid, article_id uuid, reference text, designation text,
  supplier_id uuid, supplier_name text, qty_client numeric, qty_shop numeric,
  unit_price_ht numeric, vat_rate numeric, line_ht numeric, sort_order int,
  bin_location text, bin_location2 text,
  real_qty numeric, reserved_qty numeric, on_order_qty numeric, available_qty numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select o.company_id into cid from public.part_orders o where o.id = _order_id;
  if cid is null or not public.is_member(cid) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select l.id, l.order_id, l.article_id, l.reference, l.designation,
         l.supplier_id,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
         l.qty_client, l.qty_shop, l.unit_price_ht, l.vat_rate, l.line_ht, l.sort_order,
         a.bin_location, a.bin_location2,
         st.real_qty, st.reserved_qty, oo.q,
         case when a.id is null then null else st.real_qty - st.reserved_qty + oo.q end
    from public.part_order_lines l
    left join public.articles a on a.id = l.article_id
    left join public.contacts c on c.id = l.supplier_id
    left join lateral public.article_stock(l.article_id) st on a.id is not null
    left join lateral (select public._article_on_order_qty(l.article_id) as q) oo on a.id is not null
   where l.order_id = _order_id
   order by l.sort_order, l.created_at;
end $$;

revoke all on function public.part_order_lines_detail(uuid) from public, anon;
grant execute on function public.part_order_lines_detail(uuid) to authenticated;

-- 6. Ajouter (_line_id null) ou modifier une ligne — brouillon seulement, tracé dans events
create or replace function public.part_order_line_save(
  _order_id uuid,
  _line_id uuid default null,
  _article_id uuid default null,
  _designation text default null,
  _supplier_id uuid default null,
  _qty_client numeric default 0,
  _qty_shop numeric default 0,
  _unit_price_ht numeric default null,
  _vat_rate numeric default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o     public.part_orders%rowtype;
  a     public.articles%rowtype;
  old_l public.part_order_lines%rowtype;
  new_l public.part_order_lines%rowtype;
  ref   text;
  des   text;
  pu    numeric;
  vat   numeric;
begin
  select * into o from public.part_orders where id = _order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;
  if o.dispatch_status <> 'brouillon' then
    raise exception 'Commande déjà validée : les pièces ne se modifient plus.' using errcode = '42501';
  end if;

  if _line_id is not null then
    select * into old_l from public.part_order_lines where id = _line_id and order_id = _order_id for update;
    if not found then
      raise exception 'Ligne introuvable.' using errcode = 'P0002';
    end if;
  end if;

  if _article_id is not null then
    select * into a from public.articles where id = _article_id and company_id = o.company_id;
    if not found then
      raise exception 'Article introuvable dans cette société.' using errcode = 'P0002';
    end if;
  end if;

  if _supplier_id is not null and not exists (
       select 1 from public.contacts where id = _supplier_id and company_id = o.company_id) then
    raise exception 'Fournisseur introuvable dans cette société.' using errcode = 'P0002';
  end if;

  ref := case when _article_id is not null then a.reference else old_l.reference end;
  des := coalesce(nullif(btrim(_designation), ''),
                  case when _article_id is not null then a.designation end,
                  old_l.designation);
  pu  := coalesce(_unit_price_ht,
                  case when _article_id is not null then a.sale_price_ht end,
                  old_l.unit_price_ht, 0);
  vat := coalesce(_vat_rate,
                  case when _article_id is not null then a.vat_rate end,
                  old_l.vat_rate, 21);

  if _line_id is null then
    insert into public.part_order_lines
      (order_id, article_id, reference, designation, supplier_id, qty_client, qty_shop, unit_price_ht, vat_rate, sort_order)
    values
      (o.id, _article_id, ref, des, _supplier_id, coalesce(_qty_client, 0), coalesce(_qty_shop, 0), pu, vat,
       coalesce((select max(sort_order) + 1 from public.part_order_lines where order_id = o.id), 0))
    returning * into new_l;
  else
    update public.part_order_lines set
      article_id    = coalesce(_article_id, old_l.article_id),
      reference     = ref,
      designation   = des,
      supplier_id   = _supplier_id,
      qty_client    = coalesce(_qty_client, 0),
      qty_shop      = coalesce(_qty_shop, 0),
      unit_price_ht = pu,
      vat_rate      = vat
    where id = _line_id
    returning * into new_l;
  end if;

  perform public._part_order_refresh_totals(o.id);

  if _line_id is null or to_jsonb(old_l) is distinct from to_jsonb(new_l) then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (o.company_id, auth.uid(),
            case when _line_id is null then 'part_order_line_add' else 'part_order_line_update' end,
            'part_orders', o.id::text, 'screen',
            case when _line_id is null then null else to_jsonb(old_l) end,
            to_jsonb(new_l));
  end if;

  return to_jsonb(new_l);
end $$;

revoke all on function public.part_order_line_save(uuid, uuid, uuid, text, uuid, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.part_order_line_save(uuid, uuid, uuid, text, uuid, numeric, numeric, numeric, numeric) to authenticated;

-- 7. Supprimer une ligne — brouillon seulement, tracé dans events
create or replace function public.part_order_line_delete(_line_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.part_order_lines%rowtype;
  o public.part_orders%rowtype;
begin
  select * into l from public.part_order_lines where id = _line_id;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  select * into o from public.part_orders where id = l.order_id for update;
  if not public.is_member(o.company_id) then
    raise exception 'Accès refusé à la société %', o.company_id using errcode = '42501';
  end if;
  if o.dispatch_status <> 'brouillon' then
    raise exception 'Commande déjà validée : les pièces ne se modifient plus.' using errcode = '42501';
  end if;

  delete from public.part_order_lines where id = _line_id;
  perform public._part_order_refresh_totals(o.id);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (o.company_id, auth.uid(), 'part_order_line_delete', 'part_orders', o.id::text, 'screen', to_jsonb(l), null);
end $$;

revoke all on function public.part_order_line_delete(uuid) from public, anon;
grant execute on function public.part_order_line_delete(uuid) to authenticated;
