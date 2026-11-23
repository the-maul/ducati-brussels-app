-- =====================================================================
-- M8 — Decision de Simon (23/11/2026) : « Reserver / mettre a jour » RESERVE AUSSI LES PIECES
-- TAPEES SUR LES LIGNES DE L'OR. ATE013 ATE015 B7 B8.
--
-- Avant : seuls le kit d'entretien et la vue eclatee reservaient. Une piece saisie sur une ligne
-- d'OR n'etait ni mise de cote ni commandee, et le bouton repondait « 0 mouvement ».
--
-- Regles :
--  - le geste reste explicite : seul le bouton (workshop_reservations_sync, appele par l'ecran)
--    lit les lignes. Les synchronisations automatiques (_workshop_reservations_sync) ne changent pas ;
--  - lignes prises : type « piece », article stocke (A) actif, hors constats du check-up
--    « OK », « a prevoir » et « reporte » ;
--  - sans reservation : une reservation « manuel » de la quantite des lignes ; reservation
--    « manuel » trop basse : relevee. Une piece du kit garde sa regle (jamais deux fois) ;
--  - le stock disponible est reserve, le manque va au panier par le mecanisme existant.
--
-- Additive, rejouable. Essai a blanc : supabase/tests/m8_reserver_lignes_or.sql.
-- =====================================================================

create or replace function public._workshop_reservations_from_lines(_or uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r      public.repair_orders%rowtype;
  d      record;
  s      public.stock_reservations%rowtype;
  _due   timestamptz;
  _n     integer := 0;
begin
  select * into r from public.repair_orders where id = _or;
  if not found or r.status in ('facture', 'annule') then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('workshop_res:or:' || _or::text));
  select min(x.starts_at) into _due from public.workshop_appointments x where x.or_id = _or;

  for d in
    select l.article_id, round(sum(l.quantity), 3) as qty, ar.reference, ar.designation
      from public.repair_order_lines l
      join public.articles ar on ar.id = l.article_id and ar.company_id = r.company_id
                             and ar.mgmt_type::text = 'A' and coalesce(ar.is_active, true)
     where l.or_id = _or and l.kind = 'piece' and l.article_id is not null
       and coalesce(l.checkup_state, 'a_faire') = 'a_faire'
     group by l.article_id, ar.reference, ar.designation
    having sum(l.quantity) > 0
  loop
    s := null;
    select * into s from public.stock_reservations x
     where x.status = 'active' and x.repair_order_id = _or and x.article_id = d.article_id
     for update;
    if s.id is null then
      insert into public.stock_reservations (company_id, article_id, repair_order_id, contact_id, vehicle_id, service_code,
                                             reference, designation, qty_needed, due_at, origin, created_by)
      values (r.company_id, d.article_id, _or, r.contact_id, r.vehicle_id, r.service_code,
              d.reference, coalesce(d.designation, ''), d.qty, _due, 'manuel', auth.uid())
      returning * into s;
    elsif s.origin = 'manuel' and s.qty_needed < d.qty then
      update public.stock_reservations set qty_needed = d.qty where id = s.id;
    else
      continue;
    end if;
    _n := _n + 1;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (r.company_id, auth.uid(), 'workshop_reservation_request', 'stock_reservations', s.id::text, 'screen',
            jsonb_build_object('repair_order_id', _or, 'or_number', r.number, 'article_id', d.article_id,
                               'reference', d.reference, 'qty_needed', d.qty, 'source', 'lignes_or'));
  end loop;
  return _n;
end $$;
revoke all on function public._workshop_reservations_from_lines(uuid) from public, anon, authenticated;

create or replace function public.workshop_reservations_sync(_appointment uuid default null, _or uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid; _lines integer := 0;
begin
  if (_appointment is null) = (_or is null) then
    raise exception 'Indiquez soit un rendez-vous, soit un ordre de réparation.' using errcode = 'P0001';
  end if;
  if _or is not null then
    select company_id into _company from public.repair_orders where id = _or;
  else
    select company_id into _company from public.workshop_appointments where id = _appointment;
  end if;
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _or is not null then
    _lines := public._workshop_reservations_from_lines(_or);
  end if;
  return public._workshop_reservations_sync(_appointment, _or, 'screen') || jsonb_build_object('lines_added', _lines);
end $$;
