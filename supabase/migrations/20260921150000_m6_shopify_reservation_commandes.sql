-- =====================================================================
-- Mission 03 — carte « Réserver le stock dès qu'une commande du site est passée, même non payée ».
-- Pourquoi : une commande payée par virement n'entre dans le DMS qu'une fois payée ; entre-temps la
-- pièce pouvait être vendue au comptoir (et le DMS renvoyait au site un disponible trop haut).
--
-- Ce qui change (additif ; même réglage « Import des commandes du site » : rien ne se passe à l'Arrêt) :
--   - commande du site pas encore payée (PENDING / AUTHORIZED / PARTIALLY_PAID) → RÉSERVATION du stock
--     des lignes reliées, par le mécanisme EXISTANT des bons de réservation RES (M05, M06) : mouvements
--     append-only `reservation` (+qté, is_reservation) par record_stock_move, origine `shopify`,
--     réf. = n° de commande du site. Disponible = réel − réservé (B4) : le DMS et le site (shopify-push,
--     déclenché par tout mouvement de stock) voient tout de suite la pièce comme prise ;
--   - commande modifiée avant paiement → réservation ajustée (réservation / libération de l'écart) ;
--   - PAIEMENT → dans la MÊME transaction que l'import de la facture FAC : libération de la réservation
--     (`liberation`, réf. = n° de facture) puis sortie du stock réel par la facture (inchangée) : aucun
--     double comptage, le disponible ne bouge pas au paiement ;
--   - commande annulée, paiement annulé / expiré sur Shopify → libération ;
--   - EXPIRATION : commande toujours pas payée N jours après sa création (réglage société, 7 jours par
--     défaut) → libération par la tâche planifiée existante shopify-orders-catchup (toutes les 15 min) ;
--   - import passé à « Arrêté » → les réservations en cours sont libérées (ces commandes ne seront jamais
--     importées : une réactivation ne reprend que les commandes postérieures).
-- Liaison commande Shopify ↔ ligne ↔ article ↔ client : table shopify_order_reservations (état courant) ;
-- chaque mouvement est tracé dans events (`shopify_order_reservation`). Rien n'est écrit sur Shopify.
-- Idempotent : une ligne par ligne de commande Shopify ; rejouer un webhook ne crée aucun mouvement ;
-- une réservation expirée ou vendue n'est jamais reprise.
-- Règles pures miroir testées : supabase/functions/_shared/shopify-reservation.ts
-- (tests/shopify-reservations.test.ts).
-- =====================================================================

-- ------------------------------------------------ 1. Réglage : durée de réservation (jours)
alter table public.shopify_order_settings
  add column if not exists reservation_days integer not null default 7;
do $$ begin
  alter table public.shopify_order_settings
    add constraint shopify_order_settings_reservation_days_chk check (reservation_days between 1 and 60);
exception when duplicate_object then null; end $$;
comment on column public.shopify_order_settings.reservation_days is
  'Mission 03 : une commande du site non payée garde sa réservation de stock ce nombre de jours après sa création (7 par défaut).';

-- ------------------------------------------------ 2. Réservations des commandes du site
create table if not exists public.shopify_order_reservations (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  shopify_order_id  text not null,
  shopify_line_id   text not null,
  order_name        text,
  article_id        uuid not null references public.articles(id) on delete restrict,
  contact_id        uuid references public.contacts(id) on delete set null,
  reserved_qty      numeric(14,3) not null default 0,   -- quantité encore réservée (= somme de ses mouvements)
  status            text not null default 'active' check (status in ('active', 'vendue', 'annulee', 'expiree')),
  release_reason    text,                                -- paiement, annulation, expiration, modifiee, import_arrete
  document_id       uuid references public.documents(id) on delete set null,  -- facture FAC au paiement
  reserved_at       timestamptz not null default now(),
  released_at       timestamptz,
  updated_at        timestamptz not null default now(),
  unique (company_id, shopify_line_id)
);
create index if not exists idx_shopify_order_reservations_order on public.shopify_order_reservations (company_id, shopify_order_id);
create index if not exists idx_shopify_order_reservations_active on public.shopify_order_reservations (company_id) where status = 'active';
do $$ begin
  alter table public.shopify_order_reservations
    add constraint shopify_order_reservations_order_fk foreign key (company_id, shopify_order_id)
    references public.shopify_orders (company_id, shopify_order_id) on delete cascade;
exception when duplicate_object then null; end $$;
comment on table public.shopify_order_reservations is
  'Mission 03 : stock réservé par une commande du site pas encore payée (une ligne par ligne de commande). '
  'Le stock lui-même est dans stock_moves (reservation / liberation, origine shopify). '
  'active / vendue (libérée au paiement, facture FAC) / annulee / expiree. Écrite uniquement par les fonctions _shopify_*.';

alter table public.shopify_order_reservations enable row level security;
revoke all on public.shopify_order_reservations from anon;
revoke insert, update, delete on public.shopify_order_reservations from authenticated;
grant select on public.shopify_order_reservations to authenticated;
drop policy if exists shopify_order_reservations_select on public.shopify_order_reservations;
create policy shopify_order_reservations_select on public.shopify_order_reservations for select to authenticated
  using (public.is_admin(company_id) or public.has_role(company_id, 'vendeur'));

-- ------------------------------------------------ 3. Réserver / ajuster / libérer (une commande)
-- _action : 'reserve' (commande non payée), 'release' (annulée, paiement abandonné), 'sold' (payée :
-- appelée par l'import juste avant la sortie de stock de la facture), 'expire', 'stop' (import arrêté),
-- 'none'. Même règle que planReservationMoves (shopify-reservation.ts).
create or replace function public._shopify_order_reservations_sync(
  _company uuid, _oid text, _action text, _items jsonb, _order jsonb, _via text,
  _doc uuid default null, _ref text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  so         public.shopify_orders%rowtype;
  _act       text := coalesce(_action, 'none');
  _days      integer;
  _created   timestamptz;
  _email     text;
  _contact   uuid;
  _it        jsonb;
  _art       uuid;
  _want      numeric;
  _r         public.shopify_order_reservations%rowtype;
  _delta     numeric;
  _status    text;
  _reason    text;
  _name      text;
  _moves     int := 0;
  _wanted    text[] := '{}';
begin
  if _act = 'none' then
    return jsonb_build_object('moves', 0);
  end if;
  -- Même verrou que l'import : jamais deux traitements simultanés d'une commande.
  select * into so from public.shopify_orders where company_id = _company and shopify_order_id = _oid for update;
  if not found then return jsonb_build_object('moves', 0); end if;
  _name := coalesce(_order->>'name', so.order_name);
  select coalesce(max(s.reservation_days), 7) into _days from public.shopify_order_settings s where s.company_id = _company;
  _created := coalesce((_order->>'created_at')::timestamptz, so.shopify_created_at);

  -- Commande trop ancienne : on ne réserve plus, on libère (expiration).
  if _act = 'reserve' and _created is not null and _created <= now() - make_interval(days => _days) then
    _act := 'expire';
  end if;

  if _act = 'reserve' then
    -- Une réservation expirée ou vendue n'est jamais reprise.
    if exists (select 1 from public.shopify_order_reservations r
                where r.company_id = _company and r.shopify_order_id = _oid and r.status in ('expiree', 'vendue')) then
      return jsonb_build_object('moves', 0, 'skipped', 'already_released');
    end if;
    -- Client : retrouvé par e-mail (même règle que l'import, D3), jamais créé avant le paiement.
    _email := lower(nullif(btrim(coalesce(_order->>'email', so.email)), ''));
    if _email is not null then
      select c.id into _contact from public.contacts c
       where c.company_id = _company and lower(c.email) = _email and c.type <> 'fournisseur' and c.is_active
       order by (c.status <> 'prospect') desc, c.created_at asc limit 1;
      if _contact is not null and so.contact_id is null then
        update public.shopify_orders set contact_id = _contact where id = so.id;
      end if;
    end if;

    for _it in select * from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) loop
      continue when nullif(_it->>'line_id', '') is null;
      _art := nullif(_it->>'article_id', '')::uuid;
      _want := greatest(coalesce((_it->>'quantity')::numeric, 0), 0);
      select * into _r from public.shopify_order_reservations r
       where r.company_id = _company and r.shopify_line_id = _it->>'line_id';
      if _r.id is null then
        -- Nouvelle ligne : seulement un article relié, de la société, suivi en stock.
        continue when _art is null or _want <= 0 or not exists (
          select 1 from public.articles a where a.id = _art and a.company_id = _company
             and a.mgmt_type::text in ('A', 'V', 'O', 'P', 'D'));
        insert into public.shopify_order_reservations (company_id, shopify_order_id, shopify_line_id, order_name,
                                                       article_id, contact_id, reserved_qty, status)
        values (_company, _oid, _it->>'line_id', _name, _art, _contact, 0, 'active')
        returning * into _r;
      end if;
      continue when _r.status <> 'active';
      _wanted := _wanted || (_it->>'line_id');
      _delta := _want - _r.reserved_qty;
      continue when _delta = 0;
      perform public.record_stock_move(_r.article_id,
                                       (case when _delta > 0 then 'reservation' else 'liberation' end)::public.stock_move_type,
                                       _delta, null, true, null, 'shopify', _name,
                                       case when _delta > 0 then 'Réservation commande site ' || coalesce(_name, '') || ' (en attente de paiement)'
                                            else 'Libération partielle commande site ' || coalesce(_name, '') || ' (commande modifiée)' end);
      update public.shopify_order_reservations
         set reserved_qty = reserved_qty + _delta, contact_id = coalesce(contact_id, _contact), order_name = _name,
             status = case when reserved_qty + _delta <= 0 then 'annulee' else 'active' end,
             release_reason = case when reserved_qty + _delta <= 0 then 'modifiee' else release_reason end,
             released_at = case when reserved_qty + _delta <= 0 then now() else released_at end,
             updated_at = now()
       where id = _r.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_order_reservation', 'shopify_orders', so.id::text, 'api',
              jsonb_build_object('reserved_qty', _r.reserved_qty, 'status', _r.status),
              jsonb_build_object('order', _name, 'shopify_line_id', _r.shopify_line_id, 'article_id', _r.article_id,
                                 'contact_id', coalesce(_r.contact_id, _contact), 'reserved_qty', _r.reserved_qty + _delta,
                                 'move', case when _delta > 0 then 'reservation' else 'liberation' end, 'qty', _delta,
                                 'reason', case when _delta > 0 then 'commande_non_payee' else 'modifiee' end, 'via', _via));
      _moves := _moves + 1;
    end loop;
    -- Lignes réservées qui ont disparu de la commande : libérées.
    for _r in select * from public.shopify_order_reservations r
               where r.company_id = _company and r.shopify_order_id = _oid and r.status = 'active'
                 and not (r.shopify_line_id = any (_wanted)) loop
      if _r.reserved_qty > 0 then
        perform public.record_stock_move(_r.article_id, 'liberation', -_r.reserved_qty, null, true, null, 'shopify', _name,
                                         'Libération commande site ' || coalesce(_name, '') || ' (ligne retirée)');
        _moves := _moves + 1;
      end if;
      update public.shopify_order_reservations
         set reserved_qty = 0, status = 'annulee', release_reason = 'modifiee', released_at = now(), updated_at = now()
       where id = _r.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_order_reservation', 'shopify_orders', so.id::text, 'api',
              jsonb_build_object('reserved_qty', _r.reserved_qty, 'status', 'active'),
              jsonb_build_object('order', _name, 'shopify_line_id', _r.shopify_line_id, 'article_id', _r.article_id,
                                 'contact_id', _r.contact_id, 'reserved_qty', 0, 'status', 'annulee', 'move', 'liberation',
                                 'qty', -_r.reserved_qty, 'reason', 'modifiee', 'via', _via));
    end loop;
    return jsonb_build_object('moves', _moves);
  end if;

  -- Libération de tout ce qui est encore réservé (payée, annulée, expirée, import arrêté).
  _status := case _act when 'sold' then 'vendue' when 'expire' then 'expiree' else 'annulee' end;
  _reason := case _act when 'sold' then 'paiement' when 'expire' then 'expiration'
                       when 'stop' then 'import_arrete' else 'annulation' end;
  for _r in select * from public.shopify_order_reservations r
             where r.company_id = _company and r.shopify_order_id = _oid and r.status = 'active' loop
    if _r.reserved_qty > 0 then
      perform public.record_stock_move(_r.article_id, 'liberation', -_r.reserved_qty, null, true, null, 'shopify',
                                       coalesce(_ref, _name),
                                       'Libération réservation commande site ' || coalesce(_name, '') || case _act
                                         when 'sold' then ' (payée : sortie par la facture)'
                                         when 'expire' then ' (non payée après ' || _days || ' jours)'
                                         when 'stop' then ' (import des commandes arrêté)'
                                         else ' (annulée)' end);
      _moves := _moves + 1;
    end if;
    update public.shopify_order_reservations
       set reserved_qty = 0, status = _status, release_reason = _reason, released_at = now(),
           document_id = coalesce(_doc, document_id), updated_at = now()
     where id = _r.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_order_reservation', 'shopify_orders', so.id::text,
            case _act when 'expire' then 'system' when 'stop' then 'screen' else 'api' end,
            jsonb_build_object('reserved_qty', _r.reserved_qty, 'status', 'active'),
            jsonb_build_object('order', _name, 'shopify_line_id', _r.shopify_line_id, 'article_id', _r.article_id,
                               'contact_id', _r.contact_id, 'reserved_qty', 0, 'status', _status, 'move', 'liberation',
                               'qty', -_r.reserved_qty, 'reason', _reason, 'document_id', _doc, 'ref', _ref, 'via', _via));
  end loop;
  return jsonb_build_object('moves', _moves, 'status', _status);
end $$;
revoke all on function public._shopify_order_reservations_sync(uuid, text, text, jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public._shopify_order_reservations_sync(uuid, text, text, jsonb, jsonb, text, uuid, text) to service_role;

-- ------------------------------------------------ 4. Expiration (tâche planifiée)
create or replace function public._shopify_reservations_expire()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare _o record; _n int := 0;
begin
  for _o in
    select distinct r.company_id, r.shopify_order_id
      from public.shopify_order_reservations r
      join public.shopify_orders so on so.company_id = r.company_id and so.shopify_order_id = r.shopify_order_id
      left join public.shopify_order_settings s on s.company_id = r.company_id
     where r.status = 'active' and so.document_id is null
       and coalesce(so.shopify_created_at, r.reserved_at) <= now() - make_interval(days => coalesce(s.reservation_days, 7))
  loop
    perform public._shopify_order_reservations_sync(_o.company_id, _o.shopify_order_id, 'expire', null, null, 'expiration');
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._shopify_reservations_expire() from public, anon, authenticated;
grant execute on function public._shopify_reservations_expire() to service_role;

-- ------------------------------------------------ 5. Réglage de la durée (administrateurs)
create or replace function public.shopify_orders_set_reservation_days(_company uuid, _days integer)
returns public.shopify_order_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare old_d integer; new_s public.shopify_order_settings%rowtype;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if _days is null or _days < 1 or _days > 60 then
    raise exception 'Durée de réservation : entre 1 et 60 jours.' using errcode = '22023';
  end if;
  select reservation_days into old_d from public.shopify_order_settings where company_id = _company;
  insert into public.shopify_order_settings (company_id, import_enabled, reservation_days, updated_at, updated_by)
  values (_company, false, _days, now(), auth.uid())
  on conflict (company_id) do update set reservation_days = excluded.reservation_days, updated_at = now(), updated_by = auth.uid()
  returning * into new_s;
  if coalesce(old_d, 7) is distinct from _days then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_orders_reservation_days', 'shopify_order_settings', _company::text, 'screen',
            jsonb_build_object('reservation_days', coalesce(old_d, 7)), jsonb_build_object('reservation_days', _days));
  end if;
  return new_s;
end $$;
revoke all on function public.shopify_orders_set_reservation_days(uuid, integer) from public, anon;
grant execute on function public.shopify_orders_set_reservation_days(uuid, integer) to authenticated;

-- ------------------------------------------------ 6. Arrêt de l'import : réservations en cours libérées
create or replace function public.shopify_orders_set_import(_company uuid, _enabled boolean)
returns public.shopify_order_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_s public.shopify_order_settings%rowtype;
  new_s public.shopify_order_settings%rowtype;
  _o    record;
begin
  if not public.is_admin(_company) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  select * into old_s from public.shopify_order_settings where company_id = _company;
  insert into public.shopify_order_settings (company_id, import_enabled, enabled_at, updated_at, updated_by)
  values (_company, _enabled, case when _enabled then now() end, now(), auth.uid())
  on conflict (company_id) do update
    set import_enabled = excluded.import_enabled,
        -- nouvelle activation : on repart de maintenant (rien d'antérieur n'est importé)
        enabled_at = case when excluded.import_enabled and not shopify_order_settings.import_enabled then now()
                          else shopify_order_settings.enabled_at end,
        last_catchup_at = case when excluded.import_enabled and not shopify_order_settings.import_enabled then null
                               else shopify_order_settings.last_catchup_at end,
        updated_at = now(), updated_by = auth.uid()
  returning * into new_s;
  if coalesce(old_s.import_enabled, false) is distinct from _enabled then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'shopify_orders_import_setting', 'shopify_order_settings', _company::text, 'screen',
            jsonb_build_object('import_enabled', coalesce(old_s.import_enabled, false)),
            jsonb_build_object('import_enabled', _enabled, 'enabled_at', new_s.enabled_at));
  end if;
  -- Arrêt : les commandes non payées ne seront jamais importées (une réactivation ne reprend que les
  -- commandes postérieures) → leurs réservations de stock sont libérées (tracé dans events).
  if not _enabled then
    for _o in select distinct r.shopify_order_id from public.shopify_order_reservations r
               where r.company_id = _company and r.status = 'active' loop
      perform public._shopify_order_reservations_sync(_company, _o.shopify_order_id, 'stop', null, null, 'arret_import');
    end loop;
  end if;
  return new_s;
end $$;
revoke all on function public.shopify_orders_set_import(uuid, boolean) from public, anon;
grant execute on function public.shopify_orders_set_import(uuid, boolean) to authenticated;

-- ------------------------------------------------ 7. Import d'une commande : réservation avant paiement, libération au paiement
create or replace function public._shopify_order_apply(_company uuid, _payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o          jsonb := _payload->'order';
  _oid       text := _payload->'order'->>'id';
  _via       text := coalesce(_payload->>'via', 'api');
  _decision  text := coalesce(_payload->>'decision', 'wait_payment');
  so         public.shopify_orders%rowtype;
  cust       jsonb := coalesce(_payload->'customer', '{}'::jsonb);
  sale       jsonb := coalesce(_payload->'sale', '{}'::jsonb);
  _email     text;
  _contact   uuid;
  _cstatus   public.contact_status;
  _same      int := 0;
  _created   boolean := false;
  _doc       uuid;
  _num       text;
  _odate     date;
  _l         jsonb;
  _i         int;
  _line_id   uuid;
  _item      jsonb;
  _paid      numeric := 0;
  _ttc       numeric;
  _unlinked  int;
  _cname     text;
  _c         jsonb;
  _avo       uuid;
  _avo_num   text;
  _rdate     date;
  _r         record;
  _art       uuid;
  _refunded  numeric;
  _new_status text;
  _relinked  int := 0;
  _credits   int := 0;
  _res       jsonb;
begin
  if _oid is null or _oid = '' then
    raise exception 'Commande Shopify sans identifiant.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shopify_order_settings s where s.company_id = _company and s.import_enabled) then
    raise exception 'Import des commandes du site arrêté pour cette société.' using errcode = '55000';
  end if;

  insert into public.shopify_orders (company_id, shopify_order_id, order_name, shopify_created_at, email, total_ttc,
                                     currency, financial_status, cancelled_at, first_via, last_via)
  values (_company, _oid, o->>'name', (o->>'created_at')::timestamptz, lower(nullif(btrim(o->>'email'), '')),
          (o->>'total')::numeric, o->>'currency', o->>'financial_status', (o->>'cancelled_at')::timestamptz, _via, _via)
  on conflict (company_id, shopify_order_id) do nothing;

  -- Verrou : deux webhooks (ou webhook + rattrapage) simultanés ne créent jamais deux factures.
  select * into so from public.shopify_orders where company_id = _company and shopify_order_id = _oid for update;

  update public.shopify_orders
     set order_name = coalesce(o->>'name', order_name), email = coalesce(lower(nullif(btrim(o->>'email'), '')), email),
         total_ttc = coalesce((o->>'total')::numeric, total_ttc), currency = coalesce(o->>'currency', currency),
         financial_status = o->>'financial_status', cancelled_at = (o->>'cancelled_at')::timestamptz,
         last_via = _via, last_attempt_at = now(), attempts = attempts + 1, updated_at = now()
   where id = so.id;

  -- ============ A. Première importation
  if so.document_id is null then
    if _decision <> 'import' then
      _new_status := case _decision when 'cancelled_before_import' then 'annulee'
                                    when 'test_order' then 'ignoree' else 'en_attente' end;
      update public.shopify_orders set import_status = _new_status, error_message = null where id = so.id;
      if so.import_status is distinct from _new_status then
        insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
        values (_company, null, 'shopify_order_status', 'shopify_orders', so.id::text, 'api',
                jsonb_build_object('import_status', so.import_status),
                jsonb_build_object('import_status', _new_status, 'order', o->>'name', 'financial_status', o->>'financial_status', 'via', _via));
      end if;
      -- Pas encore payée : réservation du stock des lignes reliées (ajustée si la commande change) ;
      -- annulée / paiement abandonné : libération. Calculé par reservationDecision (shopify-reservation.ts).
      _res := public._shopify_order_reservations_sync(
        _company, _oid,
        case when _decision = 'test_order' then 'none' else coalesce(_payload->>'reservation', 'none') end,
        _payload->'items', o, _via);
      return jsonb_build_object('status', _new_status, 'reservation', _res);
    end if;

    -- A1. Client : retrouvé par e-mail (minuscules), sinon créé. Jamais de fusion (D3).
    _email := lower(nullif(btrim(cust->>'email'), ''));
    if _email is not null then
      select count(*) into _same from public.contacts c
       where c.company_id = _company and lower(c.email) = _email and c.type <> 'fournisseur' and c.is_active;
      select c.id, c.status into _contact, _cstatus from public.contacts c
       where c.company_id = _company and lower(c.email) = _email and c.type <> 'fournisseur' and c.is_active
       order by (c.status <> 'prospect') desc, c.created_at asc
       limit 1;
      if _contact is null then
        insert into public.contacts (company_id, type, first_name, last_name, company_name, email, phone, address, zip,
                                     city, country, status, origin, imported_from, external_ref, notes)
        values (_company, 'particulier', nullif(cust->>'firstName', ''), nullif(cust->>'lastName', ''),
                nullif(cust->>'companyName', ''), _email, nullif(cust->>'phone', ''), nullif(cust->>'address', ''),
                nullif(cust->>'zip', ''), nullif(cust->>'city', ''), coalesce(nullif(cust->>'country', ''), 'BE'),
                'client', 'web', 'shopify', nullif(cust->>'shopifyCustomerId', ''),
                'Fiche créée par une commande du site Shopify ' || coalesce(o->>'name', ''))
        returning id into _contact;
        _created := true;
      elsif _cstatus = 'prospect' then
        -- D2 : une fiche avec une facture est « client » (tracé par l'audit de contacts).
        update public.contacts set status = 'client' where id = _contact;
      end if;
    end if;
    select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
             concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
      into _cname from public.contacts c where c.id = _contact;
    _cname := coalesce(_cname, nullif(btrim(concat_ws(' ', cust->>'firstName', cust->>'lastName')), ''), _email);

    -- A2. Facture validée (département E-shop : imported_from = 'shopify')
    _odate := coalesce(((o->>'created_at')::timestamptz at time zone 'Europe/Brussels')::date, current_date);
    _ttc := coalesce((sale->>'totalTtc')::numeric, 0);
    _num := public._next_document_number_unchecked(_company, 'FAC');
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, due_date, notes,
                                  total_ht, total_vat, total_ttc, paid_amount, price_mode, tax_exempt,
                                  shipping_ht, forced_ttc, imported_from, operator)
    values (_company, 'FAC', _num, _contact, 'validee', _odate, _odate,
            'Commande du site Shopify ' || coalesce(o->>'name', ''),
            coalesce((sale->>'totalHt')::numeric, 0), coalesce((sale->>'totalVat')::numeric, 0), _ttc, 0, 'ttc', false,
            0, nullif(sale->>'forcedTtc', '')::numeric, 'shopify', 'Site Shopify')
    returning id into _doc;

    -- A2 bis. Commande réservée avant paiement : la réservation est libérée ici, dans la même
    -- transaction que la sortie de stock réel de la facture (A3) → aucun double comptage.
    _res := public._shopify_order_reservations_sync(_company, _oid, 'sold', null, o, _via, _doc, _num);

    -- A3. Lignes + sortie de stock réel (B4, B7)
    _i := 0;
    for _l in select * from jsonb_array_elements(coalesce(sale->'lines', '[]'::jsonb)) loop
      insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                         unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
      values (_doc, nullif(_l->>'articleId', '')::uuid, coalesce(_l->>'designation', '—'), nullif(_l->>'reference', ''),
              'article', (_l->>'quantity')::numeric, (_l->>'unitPriceHt')::numeric, (_l->>'vatRate')::numeric,
              coalesce((_l->>'discountPct')::numeric, 0), (_l->>'lineHt')::numeric, (_l->>'lineTtc')::numeric, _i)
      returning id into _line_id;
      _i := _i + 1;
      if _l->>'kind' = 'item' and nullif(_l->>'shopifyLineId', '') is not null then
        select x into _item from jsonb_array_elements(coalesce(_payload->'items', '[]'::jsonb)) x
         where x->>'line_id' = _l->>'shopifyLineId' limit 1;
        insert into public.shopify_order_lines (company_id, shopify_order_id, shopify_line_id, variant_id, sku, title,
                                                quantity, document_line_id, article_id, linked_at, stock_moved)
        values (_company, _oid, _l->>'shopifyLineId', coalesce(_item->>'variant_id', _l->>'variantId'), _item->>'sku',
                coalesce(_item->>'title', _l->>'designation'), (_l->>'quantity')::numeric, _line_id,
                nullif(_l->>'articleId', '')::uuid,
                case when nullif(_l->>'articleId', '') is not null then now() end,
                nullif(_l->>'articleId', '') is not null and (_l->>'quantity')::numeric > 0)
        on conflict (company_id, shopify_line_id) do nothing;
        if nullif(_l->>'articleId', '') is not null and (_l->>'quantity')::numeric > 0 then
          perform public.record_stock_move((_l->>'articleId')::uuid, 'sortie', -abs((_l->>'quantity')::numeric),
                                           null, false, null, 'shopify', _num, 'Commande site ' || coalesce(o->>'name', ''));
        end if;
      end if;
    end loop;

    -- A4. Règlement reçu
    for _l in select * from jsonb_array_elements(coalesce(sale->'payments', '[]'::jsonb)) loop
      if abs(coalesce((_l->>'amount')::numeric, 0)) > 0.004 then
        insert into public.document_payments (document_id, method, amount, status, note, paid_at, received_at)
        values (_doc, coalesce(nullif(_l->>'method', ''), 'SHOP'), (_l->>'amount')::numeric, 'recu', _l->>'note',
                coalesce((o->>'created_at')::timestamptz, now()), now());
        _paid := _paid + (_l->>'amount')::numeric;
      end if;
    end loop;
    update public.documents
       set paid_amount = _paid,
           status = case when _paid + 0.005 >= total_ttc and total_ttc > 0 then 'payee' else status end
     where id = _doc;

    select count(*) into _unlinked from jsonb_array_elements(coalesce(sale->'lines', '[]'::jsonb)) x
     where x->>'kind' = 'item' and nullif(x->>'articleId', '') is null;

    update public.shopify_orders
       set document_id = _doc, contact_id = _contact, contact_created = _created, imported_at = now(),
           warnings = case when jsonb_array_length(coalesce(sale->'warnings', '[]'::jsonb)) > 0 or _same > 1
                           then coalesce(sale->'warnings', '[]'::jsonb)
                                || case when _same > 1 then jsonb_build_array('same_email_contacts:' || _same) else '[]'::jsonb end end
     where id = so.id;
    so.document_id := _doc;

    -- A5. Cloche « Nouvelle commande web » (une seule par commande)
    insert into public.team_notifications (company_id, kind, contact_id, document_id, title, origin, payload, dedupe_key)
    values (_company, 'web_order', _contact, _doc,
            left(coalesce(o->>'name', '') || coalesce(' — ' || _cname, ''), 200), 'web',
            jsonb_build_object('order_name', o->>'name', 'number', _num, 'total_ttc', _ttc, 'unlinked', _unlinked),
            _oid)
    on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing;

    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, null, 'shopify_order_import', 'shopify_orders', so.id::text, 'api', null,
            jsonb_build_object('order', o->>'name', 'shopify_order_id', _oid, 'document_id', _doc, 'number', _num,
                               'contact_id', _contact, 'contact_created', _created, 'contacts_same_email', _same,
                               'total_ttc', _ttc, 'lines', jsonb_array_length(coalesce(sale->'lines', '[]'::jsonb)),
                               'unlinked', _unlinked, 'warnings', sale->'warnings', 'via', _via,
                               'reservation_released', coalesce((_res->>'moves')::int, 0)));

  -- ============ B. Déjà importée : relier après coup les lignes « à relier »
  else
    for _r in
      select l.id, l.shopify_line_id, l.document_line_id, l.quantity
        from public.shopify_order_lines l
       where l.company_id = _company and l.shopify_order_id = _oid and l.article_id is null and l.document_line_id is not null
    loop
      select nullif(x->>'article_id', '')::uuid into _art
        from jsonb_array_elements(coalesce(_payload->'items', '[]'::jsonb)) x
       where x->>'line_id' = _r.shopify_line_id limit 1;
      if _art is null or not exists (select 1 from public.articles a where a.id = _art and a.company_id = _company) then
        continue;
      end if;
      update public.document_lines d
         set article_id = _art, reference = coalesce((select a.reference from public.articles a where a.id = _art), d.reference)
       where d.id = _r.document_line_id;
      if _r.quantity > 0 then
        perform public.record_stock_move(_art, 'sortie', -abs(_r.quantity), null, false, null, 'shopify',
                                         (select number from public.documents where id = so.document_id),
                                         'Commande site ' || coalesce(o->>'name', '') || ' (produit relié après coup)');
      end if;
      update public.shopify_order_lines set article_id = _art, linked_at = now(), stock_moved = _r.quantity > 0 where id = _r.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_order_relink', 'shopify_orders', so.id::text, 'api', null,
              jsonb_build_object('order', o->>'name', 'shopify_line_id', _r.shopify_line_id, 'article_id', _art,
                                 'document_id', so.document_id, 'quantity', _r.quantity, 'via', _via));
      _relinked := _relinked + 1;
    end loop;
  end if;

  -- ============ C. Remboursements Shopify → avoirs (un par remboursement)
  for _c in select * from jsonb_array_elements(coalesce(_payload->'credits', '[]'::jsonb)) loop
    if exists (select 1 from public.shopify_order_refunds r where r.company_id = _company and r.shopify_refund_id = _c->>'refund_id') then
      continue;
    end if;
    _rdate := coalesce(((_c->>'created_at')::timestamptz at time zone 'Europe/Brussels')::date, current_date);
    _avo_num := public._next_document_number_unchecked(_company, 'AVO');
    insert into public.documents (company_id, doc_type, number, contact_id, status, issue_date, notes,
                                  total_ht, total_vat, total_ttc, paid_amount, price_mode, source_document_id,
                                  imported_from, operator)
    select _company, 'AVO', _avo_num, d.contact_id, 'validee', _rdate,
           'Remboursement de la commande du site Shopify ' || coalesce(o->>'name', ''),
           (_c->>'totalHt')::numeric, (_c->>'totalVat')::numeric, (_c->>'totalTtc')::numeric, 0, 'ttc', d.id,
           'shopify', 'Site Shopify'
      from public.documents d where d.id = so.document_id
    returning id into _avo;
    _i := 0;
    for _l in select * from jsonb_array_elements(coalesce(_c->'lines', '[]'::jsonb)) loop
      insert into public.document_lines (document_id, article_id, designation, reference, line_type, quantity,
                                         unit_price_ht, vat_rate, discount_pct, line_ht, line_ttc, sort_order)
      values (_avo, nullif(_l->>'articleId', '')::uuid, coalesce(_l->>'designation', '—'), nullif(_l->>'reference', ''),
              'article', (_l->>'quantity')::numeric, (_l->>'unitPriceHt')::numeric, (_l->>'vatRate')::numeric,
              coalesce((_l->>'discountPct')::numeric, 0), (_l->>'lineHt')::numeric, (_l->>'lineTtc')::numeric, _i);
      _i := _i + 1;
      -- Réintégration seulement si Shopify a remis l'article en stock.
      if (_l->>'restock')::boolean and nullif(_l->>'articleId', '') is not null then
        perform public.record_stock_move((_l->>'articleId')::uuid, 'entree', abs((_l->>'quantity')::numeric),
                                         null, false, null, 'shopify', _avo_num,
                                         'Remboursement site ' || coalesce(o->>'name', '') || ' / réintégration');
      end if;
    end loop;
    if coalesce((_c->>'refundAmount')::numeric, 0) > 0.004 then
      insert into public.document_payments (document_id, method, amount, status, note, paid_at, received_at)
      values (_avo, coalesce(nullif(_c->>'method', ''), 'SHOP'), -abs((_c->>'refundAmount')::numeric), 'recu',
              'Remboursement ' || coalesce(o->>'name', ''), coalesce((_c->>'created_at')::timestamptz, now()), now());
      update public.documents set paid_amount = -abs((_c->>'refundAmount')::numeric) where id = _avo;
    end if;
    insert into public.shopify_order_refunds (company_id, shopify_order_id, shopify_refund_id, credit_note_id, amount)
    values (_company, _oid, _c->>'refund_id', _avo, coalesce((_c->>'refundAmount')::numeric, 0));
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, null, 'shopify_refund_credit', 'shopify_orders', so.id::text, 'api', null,
            jsonb_build_object('order', o->>'name', 'shopify_refund_id', _c->>'refund_id', 'credit_note_id', _avo,
                               'number', _avo_num, 'amount', _c->>'refundAmount', 'via', _via));
    _credits := _credits + 1;
  end loop;

  -- Remboursements à 0 € (retour ou modification sans argent rendu) : pas d'avoir, à vérifier.
  for _l in select * from jsonb_array_elements(coalesce(_payload->'zero_refunds', '[]'::jsonb)) loop
    insert into public.shopify_order_refunds (company_id, shopify_order_id, shopify_refund_id, credit_note_id, amount)
    values (_company, _oid, _l #>> '{}', null, 0)
    on conflict (company_id, shopify_refund_id) do nothing;
    if found then
      update public.shopify_orders set needs_check = true,
             check_reason = 'Remboursement à 0 € sur le site : vérifier le stock et la facture.' where id = so.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, null, 'shopify_refund_zero', 'shopify_orders', so.id::text, 'api', null,
              jsonb_build_object('order', o->>'name', 'shopify_refund_id', _l #>> '{}', 'via', _via));
    end if;
  end loop;

  -- Tout remboursé : la facture est annulée par ses avoirs (comme « Générer un avoir »).
  select coalesce(sum(r.amount), 0) into _refunded from public.shopify_order_refunds r
   where r.company_id = _company and r.shopify_order_id = _oid;
  if _credits > 0 and _refunded > 0 then
    update public.documents set status = 'annulee'
     where id = so.document_id and status <> 'annulee' and _refunded + 0.005 >= total_ttc;
  end if;

  -- Annulée sur le site après import sans remboursement : à vérifier.
  if (o->>'cancelled_at') is not null and _refunded <= 0.004 then
    update public.shopify_orders set needs_check = true,
           check_reason = 'Commande annulée sur le site sans remboursement : vérifier la facture.'
     where id = so.id and not needs_check;
  end if;

  -- Statut final
  _new_status := case when exists (select 1 from public.shopify_order_lines l
                                     where l.company_id = _company and l.shopify_order_id = _oid and l.article_id is null)
                      then 'a_relier' else 'importee' end;
  update public.shopify_orders set import_status = _new_status, error_message = null where id = so.id;
  return jsonb_build_object('status', _new_status, 'document_id', so.document_id, 'relinked', _relinked, 'credits', _credits);
end $$;
revoke all on function public._shopify_order_apply(uuid, jsonb) from public, anon, authenticated;
grant execute on function public._shopify_order_apply(uuid, jsonb) to service_role;

-- ------------------------------------------------ 8. Tâche planifiée existante : expiration + rattrapage
-- L'expiration tourne dans la base (aucun appel à Shopify) ; l'appel à la fonction serveur reste
-- conditionné à une société dont l'import est Actif (comme avant). Même nom de tâche.
create or replace function public._cron_shopify_orders_tick()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._shopify_reservations_expire();
  if exists (select 1 from public.shopify_order_settings where import_enabled) then
    perform net.http_post(
      'https://ujmrosbgkvgvwfnuryna.supabase.co/functions/v1/shopify-orders',
      '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ), 120000);
  end if;
end $$;
revoke all on function public._cron_shopify_orders_tick() from public, anon, authenticated;
grant execute on function public._cron_shopify_orders_tick() to service_role;

select cron.schedule('shopify-orders-catchup', '*/15 * * * *', $cron$ select public._cron_shopify_orders_tick(); $cron$);
