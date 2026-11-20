-- =====================================================================
-- M8 — Decision client Q59 (20/11/2026) : « Reserver » AJOUTE AUSSI LA LIGNE A L'OR.
-- ATE015 ATE013 B7 (lot E du parcours mecanicien : vue eclatee, workshop_reservation_add).
--
-- Depuis la vue eclatee (fiche OR, parcours guide, Mon atelier), « Reserver » met la piece de
-- cote ET ajoute la ligne a l'OR, chiffree par priceOrLine (tarif du client ou de l'assureur,
-- calcule par l'ecran et passe a la fonction). Si la piece est deja sur l'OR, la quantite est
-- ajustee, sans doublon. Une seule transaction : reservation + ligne + totaux de l'OR.
--
-- Regles (miroir src/modules/workshop/exploded/rules.ts reserveLinePlan / mergeReservedLine) :
--  - quantite voulue = besoin de la reservation de l'OR pour cet article (cumul des « Reserver »,
--    ou besoin du kit si la piece est deja reservee par le kit) ;
--  - lignes de l'OR pour cet article = lignes « piece » de cet article, hors cartes du check-up
--    « OK » / « reportees » ; si leur quantite totale couvre deja le besoin : rien ne change ;
--    sinon la premiere ligne (hors garantie d'abord) recoit la difference ; sans ligne : une ligne
--    est ajoutee avec le prix calcule par l'ecran ;
--  - totaux de l'OR recalcules (memes regles que le controle du temps atelier).
--
-- Coherence lignes ↔ reservations jusqu'a la facture (B7) : une reservation « manuel » (vue
-- eclatee) ne depasse jamais la quantite des lignes de l'OR. Ligne retiree ou quantite baissee
-- dans l'editeur → la reservation suit (liberation partielle ou totale par le mecanisme existant
-- _workshop_reservations_sync, mouvements stock_moves traces). Controle en fin de transaction
-- (declencheur differe), une fois par OR : la reecriture des lignes en une transaction
-- (repair_order_write_lines : suppression puis insertion) ne libere rien a tort. Les reservations
-- du kit (origine « atelier ») gardent leur regle (kit de l'entretien). Une quantite AUGMENTEE a
-- la main ne reserve rien de plus (la reservation reste un geste explicite).
-- La facture consomme toujours les reservations (inchange).
--
-- Suppose appliquees : 20261119280000 (lot E). Additive, rejouable.
-- Essai a blanc : supabase/tests/m8_reserver_ajoute_ligne_or.sql. NON APPLIQUEE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Totaux de l'OR depuis ses lignes (comme repair_order_time_control)
-- ---------------------------------------------------------------------
create or replace function public._repair_order_totals_refresh(_or uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare _ht numeric; _ttc numeric;
begin
  select coalesce(sum(l.line_ht), 0), coalesce(sum(l.line_ttc), 0) into _ht, _ttc
    from public.repair_order_lines l
   where l.or_id = _or and coalesce(l.checkup_state, '') not in ('ok', 'reporte');
  update public.repair_orders
     set total_ht = round(_ht, 2), total_ttc = round(_ttc, 2), total_vat = round(_ttc - _ht, 2)
   where id = _or;
end $$;
revoke all on function public._repair_order_totals_refresh(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. « Reserver » + ligne de l'OR
-- ---------------------------------------------------------------------
create or replace function public.workshop_reservation_add_line(
  _or uuid, _article uuid, _qty numeric default 1, _line jsonb default null, _source text default 'vue_eclatee'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype; ar public.articles%rowtype; l public.repair_order_lines%rowtype;
  _res jsonb; _target numeric; _total numeric; _add numeric; _old numeric;
  _price numeric; _vat numeric; _disc numeric; _des text; _ht numeric; _status text := 'kept'; _line_id uuid; _line_qty numeric;
begin
  select * into r from public.repair_orders where id = _or for update;
  if not found or not public.can_write_table(r.company_id, 'repair_orders') then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  -- La reservation elle-meme (controles du lot E : OR actif, piece stockee A, kit jamais deux fois).
  _res := public.workshop_reservation_add(_or, _article, _qty, _source);
  _target := round(coalesce((_res->>'qty_needed')::numeric, 0), 3);
  select * into ar from public.articles where id = _article;

  select coalesce(sum(x.quantity), 0) into _total
    from public.repair_order_lines x
   where x.or_id = _or and x.kind = 'piece' and x.article_id = _article
     and coalesce(x.checkup_state, '') not in ('ok', 'reporte');

  if _target > _total then
    _add := _target - _total;
    select x.* into l from public.repair_order_lines x
     where x.or_id = _or and x.kind = 'piece' and x.article_id = _article
       and coalesce(x.checkup_state, '') not in ('ok', 'reporte')
     order by x.is_warranty, x.sort_order, x.created_at
     limit 1
     for update;
    if l.id is not null then
      _old := l.quantity;
      update public.repair_order_lines x
         set quantity = round(x.quantity + _add, 3),
             line_ht  = case when x.is_warranty then 0 else round(round(x.quantity + _add, 3) * x.unit_price_ht * (1 - coalesce(x.discount_pct, 0) / 100), 2) end,
             line_ttc = case when x.is_warranty then 0 else round(round(round(x.quantity + _add, 3) * x.unit_price_ht * (1 - coalesce(x.discount_pct, 0) / 100), 2) * (1 + coalesce(x.vat_rate, 0) / 100), 2) end
       where x.id = l.id
      returning * into l;
      _status := 'adjusted';
    else
      _old := 0;
      _price := round(greatest(coalesce(nullif(_line->>'unit_price_ht', '')::numeric, 0), 0), 2);
      _vat := coalesce(nullif(_line->>'vat_rate', '')::numeric, ar.vat_rate, 21);
      _disc := least(greatest(coalesce(nullif(_line->>'discount_pct', '')::numeric, 0), 0), 100);
      _des := coalesce(nullif(btrim(_line->>'designation'), ''), nullif(btrim(ar.designation), ''), ar.reference, 'Pièce');
      _ht := round(_add * _price * (1 - _disc / 100), 2);
      insert into public.repair_order_lines (or_id, kind, article_id, designation, quantity, unit_price_ht, vat_rate, discount_pct,
                                             is_warranty, line_ht, line_ttc, sort_order)
      values (_or, 'piece', _article, _des, _add, _price, _vat, _disc, false, _ht, round(_ht * (1 + _vat / 100), 2),
              coalesce((select max(x.sort_order) + 1 from public.repair_order_lines x where x.or_id = _or), 0))
      returning * into l;
      _status := 'created';
    end if;
    perform public._repair_order_totals_refresh(_or);
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (r.company_id, auth.uid(), 'repair_order_line_from_reservation', 'repair_orders', _or::text, 'screen',
            jsonb_build_object('line_id', case when _status = 'adjusted' then l.id end, 'quantity', _old),
            jsonb_build_object('line_id', l.id, 'article_id', _article, 'reference', ar.reference, 'quantity', l.quantity,
                               'unit_price_ht', l.unit_price_ht, 'discount_pct', l.discount_pct, 'line', _status,
                               'reservation_id', _res->>'reservation_id', 'qty_needed', _target, 'source', _source));
  else
    select x.* into l from public.repair_order_lines x
     where x.or_id = _or and x.kind = 'piece' and x.article_id = _article
       and coalesce(x.checkup_state, '') not in ('ok', 'reporte')
     order by x.is_warranty, x.sort_order, x.created_at limit 1;
  end if;

  _line_id := l.id;
  select coalesce(sum(x.quantity), 0) into _line_qty
    from public.repair_order_lines x
   where x.or_id = _or and x.kind = 'piece' and x.article_id = _article
     and coalesce(x.checkup_state, '') not in ('ok', 'reporte');
  return _res || jsonb_build_object('line_status', _status, 'line_id', _line_id, 'line_qty', _line_qty,
    'line', case when l.id is not null then jsonb_build_object(
      'kind', 'piece', 'article_id', _article, 'designation', l.designation, 'quantity', l.quantity,
      'unit_price_ht', l.unit_price_ht, 'vat_rate', l.vat_rate, 'discount_pct', l.discount_pct, 'is_warranty', l.is_warranty) end);
end $$;
revoke all on function public.workshop_reservation_add_line(uuid, uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.workshop_reservation_add_line(uuid, uuid, numeric, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Les reservations « manuel » suivent les lignes de l'OR (fin de transaction)
-- ---------------------------------------------------------------------
create or replace function public._workshop_reservations_follow_lines(_or uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype; s record; _lines numeric; n int := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found or r.status in ('facture', 'annule') then return 0; end if;
  for s in select x.* from public.stock_reservations x
            where x.status = 'active' and x.repair_order_id = _or and x.origin = 'manuel' and x.qty_needed > 0
            for update
  loop
    select coalesce(sum(l.quantity), 0) into _lines
      from public.repair_order_lines l
     where l.or_id = _or and l.kind = 'piece' and l.article_id = s.article_id
       and coalesce(l.checkup_state, '') not in ('ok', 'reporte');
    if _lines < s.qty_needed then
      update public.stock_reservations set qty_needed = greatest(_lines, 0) where id = s.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (r.company_id, auth.uid(), 'workshop_reservation_follow_lines', 'stock_reservations', s.id::text, 'system',
              jsonb_build_object('qty_needed', s.qty_needed),
              jsonb_build_object('qty_needed', greatest(_lines, 0), 'repair_order_id', _or, 'or_number', r.number,
                                 'article_id', s.article_id, 'reference', s.reference));
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    perform public._workshop_reservations_sync(null, _or, 'system');
  end if;
  return n;
end $$;
revoke all on function public._workshop_reservations_follow_lines(uuid) from public, anon, authenticated;

create or replace function public._trg_ro_lines_reservations_follow()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _or uuid := coalesce(case when tg_op = 'DELETE' then old.or_id else new.or_id end, old.or_id);
        _key text;
begin
  if _or is null then return null; end if;
  _key := 'ducati.rolf_' || replace(_or::text, '-', '');
  if current_setting(_key, true) = '1' then return null; end if;
  perform set_config(_key, '1', true);
  if exists (select 1 from public.stock_reservations x
              where x.repair_order_id = _or and x.status = 'active' and x.origin = 'manuel') then
    perform public._workshop_reservations_follow_lines(_or);
  end if;
  return null;
end $$;
revoke all on function public._trg_ro_lines_reservations_follow() from public, anon, authenticated;

drop trigger if exists trg_ro_lines_reservations_follow on public.repair_order_lines;
create constraint trigger trg_ro_lines_reservations_follow
  after insert or update or delete on public.repair_order_lines
  deferrable initially deferred
  for each row execute function public._trg_ro_lines_reservations_follow();
