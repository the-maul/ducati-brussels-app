-- =====================================================================
-- M8 / M5 — Lot E du parcours mecanicien (19/11/2026) : « vues eclatees depuis l'OR ». ATE015 ATE013
--
-- Demande du client : « on peut voir les plans des pieces ... pour chaque piece ».
-- L'ecran des vues eclatees existe deja (catalogue Ducati, /parts/catalog, 59 145 planches avec
-- zones cliquables). Le lot E le relie a l'OR et a la picking list ; l'ajout d'une piece a l'OR
-- passe par la fonction de prix des lignes d'OR (cote ecran, or-line-pricing.ts). Il ne faut en
-- base qu'UNE chose : « Reserver » une piece choisie sur la vue eclatee pour l'OR, par LE
-- mecanisme de reservation existant (stock_reservations + stock_moves, 20261103270000).
--
-- Ce que fait cette migration (additive, rejouable, aucune table creee) :
--  1. stock_reservations.origin (colonne existante, defaut 'atelier' = piece du kit) prend la
--     valeur 'manuel' pour une piece reservee a la demande. Aucune contrainte ajoutee.
--  2. _workshop_reservations_sync redefinie (meme signature, copie de 20261119250000 + un bloc) :
--     pour un OR actif, les reservations 'manuel' font partie du besoin (elles ne sont plus
--     liberees comme « entretien change ») ; meme calcul que le kit : reserve = min(besoin,
--     disponible + deja reserve), manque -> panier (urgente / standard, meme regle), piece fin de
--     serie / remplacee jamais au panier, minimax, trace dans events. OR facture : la facture les
--     consomme (_workshop_reservations_invoice, inchange) ; OR annule : liberees (inchange).
--     Une arrivee en stock les re-reserve (_trg_stock_entry_reservations, inchange).
--  3. workshop_reservation_add(_or, _article, _qty, _source) : « Reserver » depuis la vue eclatee.
--     Membre de la societe de l'OR, OR ni facture ni annule, piece stockee (type A) de la meme
--     societe. Cree la reservation 'manuel' de l'OR (ou ajoute la quantite a celle qui existe),
--     trace la demande (events), puis appelle la synchronisation ci-dessus. Une piece deja
--     reservee par le kit de l'entretien n'est pas reservee deux fois (reponse « already »).
--
-- Aucune table ni politique RLS nouvelle : stock_reservations garde sa politique (lecture des
-- membres, aucune ecriture directe) ; l'ecriture passe par les fonctions SECURITY DEFINER.
-- Suppose appliquees : 20261103270000 (reservation atelier), 20261119250000 (lot B : derniere
-- version de _workshop_reservations_sync et picking du RDV).
-- La picking list de l'OR reprend deja les pieces reservees de l'OR (_picking_open_core, lot B) :
-- une piece reservee depuis la vue eclatee y apparait sans autre changement.
-- Regles pures miroir : src/modules/workshop/exploded/rules.ts (tests/atelier-vues-eclatees.test.ts).
-- Essai a blanc : supabase/tests/m8_vues_eclatees_or.sql.
-- NON APPLIQUEE.
-- =====================================================================

do $$ begin
  if to_regclass('public.stock_reservations') is null
     or to_regprocedure('public._workshop_reservations_sync(uuid, uuid, text)') is null
     or to_regprocedure('public._picking_open_core(uuid, uuid, text)') is null then
    raise exception 'Appliquer d''abord 20261103270000 (reservation atelier) et 20261119250000 (lot B, pieces sans clic).';
  end if;
end $$;

comment on column public.stock_reservations.origin is
  'atelier = piece du kit de l''entretien (RDV / OR) ; manuel = piece reservee a la demande pour l''OR (vue eclatee, lot E 19/11/2026).';

-- ---------------------------------------------------------------------
-- 1. Synchronisation : les reservations « manuel » de l'OR font partie du besoin
-- ---------------------------------------------------------------------
-- Copie de 20261119250000 ; seules differences : la variable _avail et le bloc « lot E ».
create or replace function public._workshop_reservations_sync(_appointment uuid, _or uuid, _via text default 'system')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a        public.workshop_appointments%rowtype;
  r        public.repair_orders%rowtype;
  s        public.stock_reservations%rowtype;
  d        record;
  st       record;
  _company uuid; _vehicle uuid; _contact uuid; _service text; _due timestamptz; _active boolean;
  _ref     text; _my text; _days numeric; _kind text; _bid uuid;
  _target  numeric; _delta numeric; _missing numeric; _add numeric;
  _wanted  uuid[] := '{}';
  _moves   int := 0; _basket int := 0; _minimax int := 0; _released int := 0;
  _blocked int := 0; _is_blocked boolean;                                        -- lot B
  _avail  text;                                                                  -- lot E
begin
  if _or is not null then
    select * into r from public.repair_orders where id = _or;
    if not found then return jsonb_build_object('moves', 0); end if;
    perform pg_advisory_xact_lock(hashtext('workshop_res:or:' || _or::text));
    _company := r.company_id; _vehicle := r.vehicle_id; _contact := r.contact_id; _service := r.service_code;
    _active := r.status not in ('facture', 'annule');
    select min(x.starts_at) into _due from public.workshop_appointments x where x.or_id = _or;
  else
    select * into a from public.workshop_appointments where id = _appointment;
    if not found then return jsonb_build_object('moves', 0); end if;
    if a.or_id is not null then
      -- La reservation suit l'OR : c'est lui qui la porte desormais.
      return jsonb_build_object('moves', 0, 'skipped', 'follows_or');
    end if;
    perform pg_advisory_xact_lock(hashtext('workshop_res:rdv:' || _appointment::text));
    _company := a.company_id; _vehicle := a.vehicle_id; _contact := a.contact_id; _service := a.service_code;
    _due := a.starts_at;
    _active := a.status not in ('annule', 'termine');
  end if;
  _ref := public._workshop_reservation_ref(_appointment, _or);

  if _active and _vehicle is not null and _service is not null then
    select v.ducati_model_year_id into _my from public.vehicles v where v.id = _vehicle;
  end if;

  -- Type de panier pour le manque : meme regle que le popup (suggestedKind).
  select public._jnum(rv.extra, 'urgent_within_days') into _days
    from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = 'urgente' limit 1;
  _days := coalesce(_days, 5);
  _kind := case when _due is null then 'urgente'
                when ((_due at time zone 'Europe/Brussels')::date - (now() at time zone 'Europe/Brussels')::date) < _days then 'urgente'
                else 'standard' end;

  if _my is not null then
    for d in
      select k.article_id, max(k.quantity) as qty, min(k.reference) as ref, min(k.designation) as des,
             (array_agg(k.kit_item_id order by k.sort_order))[1] as kit_item,
             max(ar.supplier_availability) as avail                              -- lot B
        from public._workshop_service_kit_items(_company, _my, _service) k
        join public.articles ar on ar.id = k.article_id and ar.company_id = _company
                               and ar.mgmt_type::text = 'A' and coalesce(ar.is_active, true)
       where k.article_id is not null and k.confidence <> 'absent' and k.quantity > 0
       group by k.article_id
    loop
      _wanted := _wanted || d.article_id;
      s := null;
      select * into s from public.stock_reservations x
       where x.status = 'active' and x.article_id = d.article_id
         and (case when _or is not null then x.repair_order_id = _or
                   else x.appointment_id = _appointment and x.repair_order_id is null end)
       for update;
      if s.id is null then
        insert into public.stock_reservations (company_id, article_id, appointment_id, repair_order_id, contact_id, vehicle_id,
                                               service_code, kit_item_id, reference, designation, qty_needed, due_at, created_by)
        values (_company, d.article_id, case when _or is null then _appointment end, _or, _contact, _vehicle,
                _service, d.kit_item, d.ref, coalesce(d.des, ''), d.qty, _due, auth.uid())
        returning * into s;
      end if;
      select * into st from public.article_stock(d.article_id);
      _target := least(d.qty, greatest(coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0) + s.qty_reserved, 0));
      _delta := _target - s.qty_reserved;
      if _delta <> 0 then
        perform public._stock_reservation_move(_company, d.article_id, _delta, _ref,
          case when _delta > 0 then 'Réservation atelier ' || _ref || coalesce(' — ' || public.workshop_service_label(_service), '')
               else 'Libération partielle ' || _ref || ' (besoin réduit)' end);
        _moves := _moves + 1;
      end if;
      _missing := greatest(d.qty - _target, 0);
      _add := _missing - s.qty_to_order;
      -- lot B : fin de serie (red) / remplacee (yellow) : jamais au panier (le garde-fou du panier
      -- refuserait et ferait echouer le RDV) ; la piece reste manquante, visible au magasin.
      _is_blocked := _add > 0 and coalesce(d.avail, '') in ('red', 'yellow');
      if _is_blocked then
        _blocked := _blocked + 1;
        _add := 0;
      end if;
      if _add > 0 then
        _bid := public._basket_current(_company, _kind, true);
        perform public._basket_add_lines(_bid, jsonb_build_array(jsonb_build_object(
          'article_id', d.article_id, 'qty', _add, 'origin', 'atelier', 'origin_ref', _ref,
          'origin_line_id', s.id, 'contact_id', _contact)), false);
        _basket := _basket + 1;
      end if;
      update public.stock_reservations
         set qty_needed = d.qty, qty_reserved = _target,
             qty_to_order = qty_to_order + greatest(_add, 0),
             basket_kind = case when _add > 0 then _kind else basket_kind end,
             due_at = _due, contact_id = _contact, vehicle_id = _vehicle, service_code = _service,
             kit_item_id = coalesce(d.kit_item, kit_item_id), reference = coalesce(d.ref, reference),
             designation = coalesce(d.des, designation)
       where id = s.id;
      if _delta <> 0 or _add > 0 or _is_blocked then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'workshop_reservation', 'stock_reservations', s.id::text,
                case when _via = 'screen' then 'screen' else 'system' end,
                jsonb_build_object('qty_reserved', s.qty_reserved, 'qty_to_order', s.qty_to_order),
                jsonb_build_object('article_id', d.article_id, 'ref', _ref, 'service_code', _service, 'qty_needed', d.qty,
                                   'qty_reserved', _target, 'move', _delta, 'to_basket', greatest(_add, 0),
                                   'basket_kind', case when _add > 0 then _kind end, 'contact_id', _contact, 'via', _via,
                                   'order_blocked', case when _is_blocked then d.avail end));
        if _delta <> 0 or _add > 0 then
          _minimax := _minimax + public._workshop_minimax_after(_company, d.article_id, _ref);
        end if;
      end if;
    end loop;
  end if;

  -- lot E : pieces reservees a la demande pour l'OR (vue eclatee, origin 'manuel'). Gardees tant
  -- que l'OR est actif, meme calcul que le kit. Une piece aussi dans le kit est traitee au-dessus.
  if _or is not null and _active then
    for s in select x.* from public.stock_reservations x
              where x.status = 'active' and x.repair_order_id = _or and x.origin = 'manuel'
                and x.qty_needed > 0 and not (x.article_id = any (_wanted))
              order by x.created_at
              for update
    loop
      _wanted := _wanted || s.article_id;
      select ar.supplier_availability into _avail from public.articles ar where ar.id = s.article_id;
      select * into st from public.article_stock(s.article_id);
      _target := least(s.qty_needed, greatest(coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0) + s.qty_reserved, 0));
      _delta := _target - s.qty_reserved;
      if _delta <> 0 then
        perform public._stock_reservation_move(_company, s.article_id, _delta, _ref,
          case when _delta > 0 then 'Réservation atelier ' || _ref || ' — demande (vue éclatée)'
               else 'Libération partielle ' || _ref || ' (besoin réduit)' end);
        _moves := _moves + 1;
      end if;
      _missing := greatest(s.qty_needed - _target, 0);
      _add := _missing - s.qty_to_order;
      _is_blocked := _add > 0 and coalesce(_avail, '') in ('red', 'yellow');
      if _is_blocked then
        _blocked := _blocked + 1;
        _add := 0;
      end if;
      if _add > 0 then
        _bid := public._basket_current(_company, _kind, true);
        perform public._basket_add_lines(_bid, jsonb_build_array(jsonb_build_object(
          'article_id', s.article_id, 'qty', _add, 'origin', 'atelier', 'origin_ref', _ref,
          'origin_line_id', s.id, 'contact_id', _contact)), false);
        _basket := _basket + 1;
      end if;
      update public.stock_reservations
         set qty_reserved = _target,
             qty_to_order = qty_to_order + greatest(_add, 0),
             basket_kind = case when _add > 0 then _kind else basket_kind end,
             due_at = _due, contact_id = _contact, vehicle_id = _vehicle
       where id = s.id;
      if _delta <> 0 or _add > 0 or _is_blocked then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, auth.uid(), 'workshop_reservation', 'stock_reservations', s.id::text,
                case when _via = 'screen' then 'screen' else 'system' end,
                jsonb_build_object('qty_reserved', s.qty_reserved, 'qty_to_order', s.qty_to_order),
                jsonb_build_object('article_id', s.article_id, 'ref', _ref, 'origin', 'manuel', 'qty_needed', s.qty_needed,
                                   'qty_reserved', _target, 'move', _delta, 'to_basket', greatest(_add, 0),
                                   'basket_kind', case when _add > 0 then _kind end, 'contact_id', _contact, 'via', _via,
                                   'order_blocked', case when _is_blocked then _avail end));
        if _delta <> 0 or _add > 0 then
          _minimax := _minimax + public._workshop_minimax_after(_company, s.article_id, _ref);
        end if;
      end if;
    end loop;
  end if;

  -- Ce qui n'est plus voulu (entretien change, moto changee, RDV annule...) est libere.
  for s in select * from public.stock_reservations x
            where x.status = 'active' and not (x.article_id = any (_wanted))
              and (case when _or is not null then x.repair_order_id = _or
                        else x.appointment_id = _appointment and x.repair_order_id is null end)
  loop
    _released := _released + public._workshop_reservation_release(s.id,
      case when not _active then case when _or is not null then 'or_annule' else 'annulation' end else 'entretien_change' end,
      'liberee', 0, _via);
  end loop;

  return jsonb_build_object('moves', _moves, 'basket_lines', _basket, 'minimax', _minimax, 'released', _released,
                            'service_code', _service, 'basket_kind', _kind, 'ref', _ref, 'order_blocked', _blocked);
end $$;
revoke all on function public._workshop_reservations_sync(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. « Reserver » une piece pour l'OR (vue eclatee)
-- ---------------------------------------------------------------------
create or replace function public.workshop_reservation_add(_or uuid, _article uuid, _qty numeric default 1,
                                                           _source text default 'vue_eclatee')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        public.repair_orders%rowtype;
  ar       public.articles%rowtype;
  s        public.stock_reservations%rowtype;
  _q       numeric := round(coalesce(_qty, 0), 3);
  _due     timestamptz;
  _old     numeric := 0;
  _created boolean := false;
  _sync    jsonb;
  _src     text := left(coalesce(nullif(btrim(_source), ''), 'vue_eclatee'), 40);
begin
  select * into r from public.repair_orders where id = _or;
  if not found or not public.is_member(r.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if r.status in ('facture', 'annule') then
    raise exception 'OR % facturé ou annulé : plus de réservation possible.', coalesce(r.number, '') using errcode = 'P0001';
  end if;
  if not (_q > 0) then
    raise exception 'Quantité à réserver invalide.' using errcode = 'P0001';
  end if;
  select * into ar from public.articles where id = _article and company_id = r.company_id;
  if not found then
    raise exception 'Pièce inconnue dans cette société.' using errcode = 'P0001';
  end if;
  if ar.mgmt_type::text <> 'A' or not coalesce(ar.is_active, true) then
    raise exception 'Pièce % non stockée (type %) : rien à réserver.', ar.reference, ar.mgmt_type using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('workshop_res:or:' || _or::text));
  select min(x.starts_at) into _due from public.workshop_appointments x where x.or_id = _or;
  select * into s from public.stock_reservations x
   where x.status = 'active' and x.repair_order_id = _or and x.article_id = _article
   for update;

  if s.id is not null and s.origin <> 'manuel' then
    -- Piece du kit de l'entretien : deja reservee par l'OR, jamais deux fois.
    return jsonb_build_object('reservation_id', s.id, 'already', true, 'origin', s.origin,
                              'qty_needed', s.qty_needed, 'qty_reserved', s.qty_reserved, 'qty_to_order', s.qty_to_order,
                              'basket_kind', s.basket_kind);
  end if;

  if s.id is null then
    insert into public.stock_reservations (company_id, article_id, repair_order_id, contact_id, vehicle_id, service_code,
                                           reference, designation, qty_needed, due_at, origin, created_by)
    values (r.company_id, _article, _or, r.contact_id, r.vehicle_id, r.service_code,
            ar.reference, coalesce(ar.designation, ''), _q, _due, 'manuel', auth.uid())
    returning * into s;
    _created := true;
  else
    _old := s.qty_needed;
    update public.stock_reservations set qty_needed = s.qty_needed + _q where id = s.id returning * into s;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), 'workshop_reservation_request', 'stock_reservations', s.id::text, 'screen',
          case when _created then null else jsonb_build_object('qty_needed', _old) end,
          jsonb_build_object('repair_order_id', _or, 'or_number', r.number, 'article_id', _article,
                             'reference', ar.reference, 'qty_added', _q, 'qty_needed', s.qty_needed,
                             'source', _src, 'created', _created));

  _sync := public._workshop_reservations_sync(null, _or, 'screen');
  select * into s from public.stock_reservations where id = s.id;

  return jsonb_build_object('reservation_id', s.id, 'already', false, 'created', _created, 'origin', s.origin,
                            'qty_needed', s.qty_needed, 'qty_reserved', s.qty_reserved, 'qty_to_order', s.qty_to_order,
                            'basket_kind', s.basket_kind,
                            'order_blocked', s.qty_reserved < s.qty_needed and coalesce(ar.supplier_availability, '') in ('red', 'yellow'),
                            'supplier_availability', ar.supplier_availability,
                            'sync', _sync);
end $$;
revoke all on function public.workshop_reservation_add(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.workshop_reservation_add(uuid, uuid, numeric, text) to authenticated;
