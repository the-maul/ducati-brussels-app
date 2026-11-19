-- =====================================================================
-- M8 / M5 — Lot B du parcours mecanicien (19/11/2026) : « les pieces sans clic ». ATE015 ATE013 INV006
--
-- Demande du client : « rdv planifie, creation d'une picking list, proposition de reservation
-- et/ou commandes des pieces pour le client (dans le stock ou ca passe en commande urgente) ».
-- Deja en place (20261103270000) : reservation des pieces du kit au RDV, manque au panier
-- (urgente si le RDV est a moins de N jours), la reservation suit l'OR, la facture la consomme,
-- une arrivee en stock re-reserve ce qui manquait (RDV le plus proche d'abord).
--
-- Ce que fait cette migration (additive, rejouable) :
--  1. Reglages atelier (workshop_planning_settings) : moment de creation de la picking list
--     `picking_auto_mode` = veille (defaut) / reception / manuel, heure de la tache de la veille
--     `picking_eve_hour` (16 h par defaut). Le seuil « urgente si RDV a moins de N jours » reste
--     LE reglage existant (reference_values order_threshold / urgente, extra.urgent_within_days,
--     5 par defaut) : lu et ecrit par workshop_parts_settings(_set), aucun second reglage.
--  2. Picking list du RDV : picking_lists.appointment_id. UN seul mecanisme : le coeur
--     `_picking_open_core` (ex-corps de picking_open_for_repair_order, meme regles : pieces du kit
--     de l'entretien + lignes pieces de l'OR, jamais deux fois la meme piece) sert le bouton de
--     l'OR, le RDV (veille) et la naissance de l'OR. La liste du RDV SUIT l'OR quand il nait :
--     elle est completee, jamais dupliquee. Elle reprend aussi les pieces reservees du RDV.
--     Aucun mouvement de stock (B7) : la reservation reste celle du RDV, pas de double reservation.
--  3. Tache planifiee (pg_cron, toutes les heures a :05) : a partir de l'heure reglee, la picking
--     list de chaque RDV d'entretien du lendemain (et du jour, en rattrapage) est creee.
--     Mode « reception » : creee quand l'OR nait du RDV. Mode « manuel » : bouton seulement.
--  4. Magasin « Pieces des RDV a venir » : workshop_upcoming_parts (par jour, par RDV, par piece :
--     reservee / au panier / commandee / manquante / hors stock, n° de panier ou de commande DCS)
--     et deux actions : reserver (workshop_reservations_sync, existant) et « commander en
--     urgente » (workshop_reservation_order_urgent : bascule les lignes du panier standard ouvert
--     vers le panier urgente, et commande en urgente ce qui n'est commande nulle part).
--     RDV avance sous le seuil : les lignes du panier standard ouvert passent seules en urgente.
--  5. _workshop_reservations_sync redefinie (meme signature, seule difference) : une piece « fin
--     de serie » (red) ou « remplacee » (yellow) ne part plus au panier. Avant, le garde-fou
--     _supply_order_guard (20261103280000) levait une erreur DANS le declencheur du RDV : le RDV
--     entier etait refuse. La piece reste « manquante » sur l'ecran du magasin, avec la raison.
--  6. RDV annule : sa picking list (pas encore livree) est annulee, trace dans events.
--
-- Reception d'une commande (point 3 de la demande) : DEJA fait par _trg_stock_entry_reservations
-- (20261103270000) : toute entree en stock re-reserve pour le RDV / l'OR qui manque, le plus
-- proche d'abord. Rien a coder ; l'essai a blanc le verifie.
--
-- Suppose appliquees : 20261103270000 (reservation atelier), 20261103280000 (etat tarif),
-- 20261118120000 (reglages planning), 20261119140000 (forfaits G8 : derniere version du picking).
-- Fonctions redefinies (meme signature) : picking_open_for_repair_order, _workshop_reservations_sync.
-- Regles pures miroir : src/modules/workshop/reservations/parts-flow.ts
-- (tests/atelier-pieces-sans-clic.test.ts). Essai a blanc : supabase/tests/m8_pieces_sans_clic.sql.
-- NON APPLIQUEE.
-- =====================================================================

do $$ begin
  if to_regclass('public.stock_reservations') is null
     or to_regprocedure('public._workshop_service_kit_items(uuid, text, text)') is null
     or to_regclass('public.workshop_planning_settings') is null then
    raise exception 'Appliquer d''abord 20261103270000 (reservation atelier) et 20261118120000 (reglages du planning).';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Reglages
-- ---------------------------------------------------------------------
alter table public.workshop_planning_settings
  add column if not exists picking_auto_mode text not null default 'veille';
alter table public.workshop_planning_settings
  add column if not exists picking_eve_hour smallint not null default 16;
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_picking_mode_chk;
alter table public.workshop_planning_settings
  add constraint workshop_planning_settings_picking_mode_chk check (picking_auto_mode in ('veille', 'reception', 'manuel'));
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_picking_hour_chk;
alter table public.workshop_planning_settings
  add constraint workshop_planning_settings_picking_hour_chk check (picking_eve_hour between 0 and 23);
comment on column public.workshop_planning_settings.picking_auto_mode is
  'Picking list des RDV d''entretien : veille (creee la veille du RDV a picking_eve_hour, et au plus tard a la naissance de l''OR) | reception (creee quand l''OR nait du RDV) | manuel (bouton seulement).';
comment on column public.workshop_planning_settings.picking_eve_hour is
  'Heure (Europe/Brussels) a partir de laquelle la picking list des RDV du lendemain est creee (mode veille).';

-- Les trois reglages du lot (mode, heure, seuil urgente). Defauts quand la ligne manque.
create or replace function public._workshop_parts_settings(_company uuid)
returns table(mode text, eve_hour integer, urgent_days numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.picking_auto_mode from public.workshop_planning_settings s where s.company_id = _company), 'veille'),
         coalesce((select s.picking_eve_hour::int from public.workshop_planning_settings s where s.company_id = _company), 16),
         coalesce((select public._jnum(rv.extra, 'urgent_within_days') from public.reference_values rv
                    where rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = 'urgente' limit 1), 5);
$$;
revoke all on function public._workshop_parts_settings(uuid) from public, anon, authenticated;

create or replace function public.workshop_parts_settings(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s record;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select * into s from public._workshop_parts_settings(_company);
  return jsonb_build_object('mode', s.mode, 'eve_hour', s.eve_hour, 'urgent_days', s.urgent_days);
end $$;
revoke all on function public.workshop_parts_settings(uuid) from public, anon;
grant execute on function public.workshop_parts_settings(uuid) to authenticated;

-- Ecriture : meme droit que les reglages du planning. Le seuil est ecrit dans SON reglage
-- (order_threshold / urgente), pas copie ailleurs. Trace dans events (ancien / nouveau).
create or replace function public.workshop_parts_settings_set(_company uuid, _mode text, _eve_hour integer, _urgent_days numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old record; _rv uuid;
begin
  if not public.can_write_table(_company, 'workshop_planning_settings') then
    raise exception 'Accès refusé : réglages de l''atelier.' using errcode = '42501';
  end if;
  if _mode not in ('veille', 'reception', 'manuel') then
    raise exception 'Moment de création inconnu : %', _mode using errcode = 'P0001';
  end if;
  if _eve_hour is null or _eve_hour < 0 or _eve_hour > 23 then
    raise exception 'Heure de la tâche : entre 0 et 23.' using errcode = 'P0001';
  end if;
  if _urgent_days is null or _urgent_days < 0 or _urgent_days > 60 or _urgent_days <> trunc(_urgent_days) then
    raise exception 'Seuil urgente : un nombre de jours entre 0 et 60.' using errcode = 'P0001';
  end if;
  select * into old from public._workshop_parts_settings(_company);
  insert into public.workshop_planning_settings (company_id, picking_auto_mode, picking_eve_hour)
  values (_company, _mode, _eve_hour)
  on conflict (company_id) do update
     set picking_auto_mode = excluded.picking_auto_mode, picking_eve_hour = excluded.picking_eve_hour, updated_at = now();
  select rv.id into _rv from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'order_threshold' and rv.code = 'urgente' limit 1;
  if _rv is not null then
    update public.reference_values
       set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('urgent_within_days', _urgent_days)
     where id = _rv;
  elsif _urgent_days <> 5 then
    raise exception 'Le réglage des commandes « urgente » manque (Paramètres → Tables → Seuils de commande).' using errcode = 'P0001';
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_parts_settings', 'workshop_planning_settings', _company::text, 'screen',
          jsonb_build_object('mode', old.mode, 'eve_hour', old.eve_hour, 'urgent_days', old.urgent_days),
          jsonb_build_object('mode', _mode, 'eve_hour', _eve_hour, 'urgent_days', _urgent_days));
  return jsonb_build_object('mode', _mode, 'eve_hour', _eve_hour, 'urgent_days', _urgent_days);
end $$;
revoke all on function public.workshop_parts_settings_set(uuid, text, integer, numeric) from public, anon;
grant execute on function public.workshop_parts_settings_set(uuid, text, integer, numeric) to authenticated;

-- La picking list d'un RDV est-elle due a cet instant ? (mode veille : RDV du jour, ou du
-- lendemain a partir de l'heure reglee). Miroir : parts-flow.ts pickingDue.
create or replace function public._workshop_picking_due(_company uuid, _starts timestamptz, _now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s record; d_rdv date; d_now date;
begin
  if _starts is null then return false; end if;
  select * into s from public._workshop_parts_settings(_company);
  if s.mode <> 'veille' then return false; end if;
  d_rdv := (_starts at time zone 'Europe/Brussels')::date;
  d_now := (_now at time zone 'Europe/Brussels')::date;
  return d_rdv = d_now
      or (d_rdv = d_now + 1 and extract(hour from (_now at time zone 'Europe/Brussels')) >= s.eve_hour);
end $$;
revoke all on function public._workshop_picking_due(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Picking list du RDV, un seul mecanisme
-- ---------------------------------------------------------------------
alter table public.picking_lists
  add column if not exists appointment_id uuid references public.workshop_appointments(id) on delete set null;
comment on column public.picking_lists.appointment_id is
  'RDV d''entretien pour lequel la liste a ete preparee (avant l''OR). Quand l''OR nait du RDV, la meme liste recoit repair_order_id.';
create unique index if not exists picking_lists_appointment_uniq
  on public.picking_lists (appointment_id) where appointment_id is not null and status <> 'annulee';

-- Coeur : cree OU complete la picking list d'un OR (_or) ou d'un RDV sans OR (_appointment).
-- Pas de controle de membre (appele par le bouton apres controle, par les declencheurs et par la
-- tache planifiee). Retourne null quand il n'y a rien a preparer (RDV annule, sans moto ni
-- entretien, OR annule).
create or replace function public._picking_open_core(_or uuid, _appointment uuid, _via text default 'system')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        public.repair_orders%rowtype;
  a        public.workshop_appointments%rowtype;
  _company uuid; _my text; _svc text; _label text; _kind text;
  pid      uuid; pst text; _appt uuid;
  _created boolean := false; _attached boolean := false;
  n_kit    int := 0; n_or int := 0; n_res int := 0;
  _kits    uuid[];
begin
  if _or is null then
    select * into a from public.workshop_appointments where id = _appointment;
    if not found then return null; end if;
    if a.or_id is not null then
      _or := a.or_id;      -- l'OR porte desormais la preparation
    end if;
  end if;

  if _or is not null then
    select * into r from public.repair_orders where id = _or;
    if not found or r.status = 'annule' then return null; end if;
    _company := r.company_id;
    perform pg_advisory_xact_lock(hashtext('picking_or:' || _or::text));
    select x.model_year_id, x.service_code, x.service_label into _my, _svc, _label
      from public._repair_order_service(_or) x;
    select p.id, p.status into pid, pst from public.picking_lists p where p.repair_order_id = _or;
    if pid is null then
      -- La liste preparee pour le RDV de cet OR le suit : completee, jamais dupliquee.
      select p.id, p.status into pid, pst
        from public.picking_lists p join public.workshop_appointments x on x.id = p.appointment_id
       where x.or_id = _or and p.repair_order_id is null and p.status <> 'annulee'
       order by p.created_at limit 1;
      if pid is not null then
        update public.picking_lists set repair_order_id = _or, service_label = coalesce(service_label, _label) where id = pid;
        _attached := true;
      end if;
    end if;
    select x.id into _appt from public.workshop_appointments x where x.or_id = _or order by x.starts_at limit 1;
  else
    if a.status in ('annule', 'termine', 'demande', 'facture') or a.vehicle_id is null or a.service_code is null then
      return null;
    end if;
    _company := a.company_id;
    _appt := a.id;
    perform pg_advisory_xact_lock(hashtext('picking_rdv:' || a.id::text));
    select v.ducati_model_year_id into _my from public.vehicles v where v.id = a.vehicle_id;
    _svc := a.service_code;
    _label := public.workshop_service_label(a.service_code);
    select p.id, p.status into pid, pst from public.picking_lists p
     where p.appointment_id = a.id and p.status <> 'annulee' order by p.created_at desc limit 1;
  end if;

  if pid is null then
    insert into public.picking_lists (company_id, repair_order_id, appointment_id, service_label, created_by)
    values (_company, _or,
            case when not exists (select 1 from public.picking_lists p where p.appointment_id = _appt and p.status <> 'annulee')
                 then _appt end,
            _label, auth.uid())
    returning id into pid;
    pst := 'en_cours';
    _created := true;
  end if;
  if pst in ('annulee', 'livre') then
    return pid;
  end if;

  -- a) les pieces de l'entretien (kits reunis, M-109) : meme lecture que la reservation
  _kind := public._workshop_kind_of(_svc);
  if _my is not null and _kind is not null then
    insert into public.picking_list_items
      (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
       origin, kit_item_id, unit, sort_order)
    select _company, pid, k.article_id,
           k.designation || case when k.kind = 'consommable' and k.unit is not null
                                 then ' (' || trim(to_char(k.quantity, 'FM9999990.999')) || ' ' || k.unit || ')'
                                 else '' end,
           k.reference, k.quantity, 0, 'a_preparer',
           'kit', k.kit_item_id, k.unit, k.sort_order
      from public._workshop_service_kit_items(_company, _my, _kind) k
     where not exists (select 1 from public.picking_list_items x
                        where x.picking_id = pid
                          and (x.kit_item_id = k.kit_item_id
                               or (k.article_id is not null and x.article_id = k.article_id and x.removed_at is null)));
    get diagnostics n_kit = row_count;
    select array_agg(distinct k.kit_id) into _kits
      from public._workshop_service_kit_items(_company, _my, _kind) k;
  end if;

  -- b) les pieces reservees pour ce RDV / cet OR qui ne seraient pas encore dans la liste
  insert into public.picking_list_items
    (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
     origin, kit_item_id, sort_order)
  select _company, pid, s.article_id, coalesce(nullif(s.designation, ''), ar.designation), coalesce(s.reference, ar.reference),
         s.qty_needed, 0, 'a_preparer', 'kit', s.kit_item_id, 900
    from public.stock_reservations s
    join public.articles ar on ar.id = s.article_id
   where s.status = 'active' and s.qty_needed > 0
     and (case when _or is not null then s.repair_order_id = _or
               else s.appointment_id = _appt and s.repair_order_id is null end)
     and not exists (select 1 from public.picking_list_items x
                      where x.picking_id = pid and x.article_id = s.article_id and x.removed_at is null);
  get diagnostics n_res = row_count;

  -- c) les pieces ajoutees par le technicien : lignes « piece » de l'OR (sans ligne de service F / T)
  if _or is not null then
    insert into public.picking_list_items
      (company_id, picking_id, article_id, designation, reference, qty_ordered, qty_picked, status,
       origin, sort_order)
    select _company, pid, l.article_id, l.designation, ar.reference, l.quantity, 0, 'a_preparer',
           'atelier', 1000 + l.sort_order
      from public.repair_order_lines l
      left join public.articles ar on ar.id = l.article_id
     where l.or_id = _or
       and l.kind = 'piece'
       and l.quantity > 0
       and coalesce(ar.mgmt_type::text, '') not in ('F', 'T')
       and not exists (
         select 1 from public.picking_list_items x
          where x.picking_id = pid
            and ((l.article_id is not null and x.article_id is not distinct from l.article_id)
                 or (l.article_id is null and x.designation is not distinct from l.designation)));
    get diagnostics n_or = row_count;
  end if;

  perform public._picking_refresh_status(pid);

  if _created or _attached or n_kit + n_res + n_or > 0 or _via = 'screen' then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(),
            case when _or is not null then 'picking_open_for_repair_order' else 'picking_open_for_appointment' end,
            'picking_lists', pid::text, case when _via = 'screen' then 'screen' else 'system' end, null,
            jsonb_build_object('or_id', _or, 'or_number', r.number, 'appointment_id', _appt, 'kit_ids', _kits,
                               'service_code', _svc, 'service_label', _label, 'created', _created,
                               'attached_to_or', _attached, 'lines_kit', n_kit, 'lines_reserved', n_res,
                               'lines_workshop', n_or, 'via', _via));
  end if;
  return pid;
end $$;
revoke all on function public._picking_open_core(uuid, uuid, text) from public, anon, authenticated;

-- Version « automatique » : une erreur de preparation n'empeche jamais d'enregistrer le RDV ou
-- l'OR ; elle est tracee dans events (picking_auto_failed) pour le magasin.
create or replace function public._picking_open_auto(_or uuid, _appointment uuid, _via text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid; _company uuid;
begin
  begin
    pid := public._picking_open_core(_or, _appointment, _via);
  exception when others then
    select coalesce((select company_id from public.repair_orders where id = _or),
                    (select company_id from public.workshop_appointments where id = _appointment)) into _company;
    if _company is not null then
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'picking_auto_failed', 'picking_lists', coalesce(_or, _appointment)::text, 'system', null,
              jsonb_build_object('or_id', _or, 'appointment_id', _appointment, 'via', _via, 'error', sqlerrm));
    end if;
    pid := null;
  end;
  return pid;
end $$;
revoke all on function public._picking_open_auto(uuid, uuid, text) from public, anon, authenticated;

-- Bouton « Creer la picking list » de l'OR et parcours technicien : meme signature, meme
-- messages ; le corps est le coeur ci-dessus (une liste preparee la veille pour le RDV est reprise).
create or replace function public.picking_open_for_repair_order(_or uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.repair_orders%rowtype;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then
    raise exception 'Ordre de réparation introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(r.company_id) then
    raise exception 'Accès refusé à la société %', r.company_id using errcode = '42501';
  end if;
  if r.status = 'annule' then
    raise exception 'OR annulé : rien à préparer.' using errcode = 'P0001';
  end if;
  return public._picking_open_core(_or, null, 'screen');
end $$;
revoke all on function public.picking_open_for_repair_order(uuid) from public, anon;
grant execute on function public.picking_open_for_repair_order(uuid) to authenticated;

-- « Preparer maintenant » depuis l'ecran du magasin (RDV sans OR, avant la veille).
create or replace function public.picking_open_for_appointment(_appointment uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.workshop_appointments%rowtype; pid uuid;
begin
  select * into a from public.workshop_appointments where id = _appointment;
  if not found then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0002';
  end if;
  if not public.is_member(a.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  pid := public._picking_open_core(null, _appointment, 'screen');
  if pid is null then
    raise exception 'Rien à préparer : RDV annulé, sans moto ou sans entretien.' using errcode = 'P0001';
  end if;
  return pid;
end $$;
revoke all on function public.picking_open_for_appointment(uuid) from public, anon;
grant execute on function public.picking_open_for_appointment(uuid) to authenticated;

-- RDV annule : sa liste (pas encore livree, pas encore reprise par un OR) est annulee.
create or replace function public._picking_cancel_for_appointment(_appointment uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; _n int := 0;
begin
  for p in select * from public.picking_lists
            where appointment_id = _appointment and repair_order_id is null and status in ('en_cours', 'pret') loop
    update public.picking_lists
       set status = 'annulee', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'RDV annulé'
     where id = p.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (p.company_id, auth.uid(), 'picking_cancel', 'picking_lists', p.id::text, 'system',
            jsonb_build_object('status', p.status), jsonb_build_object('status', 'annulee', 'reason', 'RDV annulé',
                                                                       'appointment_id', _appointment));
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public._picking_cancel_for_appointment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Reservation : une piece fin de serie / remplacee ne part pas au panier (au lieu de faire
--    echouer le RDV). Corps de 20261103270000, seules les lignes marquees « lot B » changent.
-- ---------------------------------------------------------------------
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
-- 4. Commander en urgente / passer de standard a urgente
-- ---------------------------------------------------------------------
-- Une reservation : ses lignes du panier STANDARD ouvert passent au panier URGENTE ouvert ; puis
-- (si _add_missing) ce qui manque et n'est commande nulle part (panier ouvert ou commande) part
-- en urgente. Un panier deja commande ne se modifie pas (son fichier DCS est parti).
create or replace function public._workshop_reservation_make_urgent(_id uuid, _add_missing boolean, _via text default 'system')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.stock_reservations%rowtype;
  l        record;
  _bid     uuid; _ref text; _avail text;
  _moved   numeric := 0; _covered numeric; _missing numeric; _add numeric := 0;
begin
  select * into s from public.stock_reservations where id = _id for update;
  if not found or s.status <> 'active' then
    return jsonb_build_object('moved', 0, 'added', 0, 'reason', 'inactive');
  end if;
  select supplier_availability into _avail from public.articles where id = s.article_id;
  _ref := public._workshop_reservation_ref(s.appointment_id, s.repair_order_id);
  if coalesce(_avail, '') not in ('red', 'yellow') then
    for l in select x.* from public.supplier_basket_lines x join public.supplier_baskets b on b.id = x.basket_id
              where x.origin_line_id = s.id and b.status = 'ouvert' and b.kind = 'standard' loop
      _bid := coalesce(_bid, public._basket_current(s.company_id, 'urgente', true));
      perform set_config('app.basket_rpc', 'on', true);
      delete from public.supplier_basket_lines where id = l.id;
      perform set_config('app.basket_rpc', 'off', true);
      perform public._basket_refresh_total(l.basket_id);
      perform public._basket_add_lines(_bid, jsonb_build_array(jsonb_build_object(
        'article_id', l.article_id, 'qty', l.qty, 'origin', l.origin, 'origin_ref', l.origin_ref,
        'origin_line_id', s.id, 'contact_id', l.contact_id)), false);
      _moved := _moved + l.qty;
    end loop;
  end if;
  _missing := greatest(s.qty_needed - s.qty_reserved, 0);
  select coalesce(sum(x.qty), 0) into _covered
    from public.supplier_basket_lines x join public.supplier_baskets b on b.id = x.basket_id
   where x.origin_line_id = s.id and b.status in ('ouvert', 'commande');
  if _add_missing and _missing > _covered then
    -- Fin de serie / remplacee : le garde-fou du panier refuse avec la raison (message clair).
    _add := _missing - _covered;
    _bid := coalesce(_bid, public._basket_current(s.company_id, 'urgente', true));
    perform public._basket_add_lines(_bid, jsonb_build_array(jsonb_build_object(
      'article_id', s.article_id, 'qty', _add, 'origin', 'atelier', 'origin_ref', _ref,
      'origin_line_id', s.id, 'contact_id', s.contact_id)), false);
  end if;
  if _moved > 0 or _add > 0 then
    update public.stock_reservations set qty_to_order = _covered + _add, basket_kind = 'urgente' where id = s.id;
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (s.company_id, auth.uid(), 'workshop_reservation_urgent', 'stock_reservations', s.id::text,
            case when _via = 'screen' then 'screen' else 'system' end,
            jsonb_build_object('basket_kind', s.basket_kind, 'qty_to_order', s.qty_to_order),
            jsonb_build_object('basket_kind', 'urgente', 'qty_to_order', _covered + _add, 'moved_from_standard', _moved,
                               'added', _add, 'basket_id', _bid, 'article_id', s.article_id, 'ref', _ref, 'via', _via));
  end if;
  return jsonb_build_object('moved', _moved, 'added', _add, 'basket_id', _bid,
                            'reason', case when _moved > 0 or _add > 0 then null
                                           when _missing <= 0 then 'reserved'
                                           when coalesce(_avail, '') in ('red', 'yellow') then 'not_orderable'
                                           else 'already_ordered' end);
end $$;
revoke all on function public._workshop_reservation_make_urgent(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.workshop_reservation_order_urgent(_reservation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _company uuid;
begin
  select company_id into _company from public.stock_reservations where id = _reservation;
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return public._workshop_reservation_make_urgent(_reservation, true, 'screen');
end $$;
revoke all on function public.workshop_reservation_order_urgent(uuid) from public, anon;
grant execute on function public.workshop_reservation_order_urgent(uuid) to authenticated;

-- RDV avance sous le seuil : les lignes encore au panier standard ouvert passent en urgente.
create or replace function public._workshop_reservations_recheck_kind(_appointment uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.workshop_appointments%rowtype; s record; _due timestamptz; _days numeric; _n int := 0; res jsonb;
begin
  select * into a from public.workshop_appointments where id = _appointment;
  if not found or a.status in ('annule', 'termine') then return 0; end if;
  _due := case when a.or_id is not null
               then (select min(x.starts_at) from public.workshop_appointments x where x.or_id = a.or_id)
               else a.starts_at end;
  select urgent_days into _days from public._workshop_parts_settings(a.company_id);
  if ((_due at time zone 'Europe/Brussels')::date - (now() at time zone 'Europe/Brussels')::date) >= _days then
    return 0;
  end if;
  for s in select x.id from public.stock_reservations x
            where x.status = 'active'
              and (case when a.or_id is not null then x.repair_order_id = a.or_id
                        else x.appointment_id = a.id and x.repair_order_id is null end)
              and exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                           where l.origin_line_id = x.id and b.status = 'ouvert' and b.kind = 'standard') loop
    res := public._workshop_reservation_make_urgent(s.id, false, 'rdv_avance');
    if (res ->> 'moved')::numeric > 0 then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;
revoke all on function public._workshop_reservations_recheck_kind(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Declencheur du RDV : picking list (veille / reception), annulation, RDV avance.
--    Nom « trg_appointments_spare_parts » : passe APRES trg_appointments_reservations (ordre
--    alphabetique des declencheurs) ; la reservation est donc deja faite / deja passee a l'OR.
-- ---------------------------------------------------------------------
create or replace function public._trg_appointment_spare_parts()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _mode text; _changed boolean := true;
begin
  if new.service_code is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.or_id is not null and old.or_id is distinct from new.or_id then
      -- L'OR nait du RDV : la liste de la veille le suit, completee ; sinon elle est creee
      -- (mode veille : au plus tard maintenant ; mode reception : maintenant).
      select mode into _mode from public._workshop_parts_settings(new.company_id);
      if _mode <> 'manuel' then
        perform public._picking_open_auto(new.or_id, null, 'or');
      end if;
      return new;
    end if;
    if new.status = 'annule' and old.status is distinct from 'annule' then
      if new.or_id is null then
        perform public._picking_cancel_for_appointment(new.id);
      end if;
      return new;
    end if;
    if new.starts_at < old.starts_at then
      perform public._workshop_reservations_recheck_kind(new.id);
    end if;
    _changed := new.starts_at is distinct from old.starts_at or new.status is distinct from old.status
             or new.vehicle_id is distinct from old.vehicle_id or new.service_code is distinct from old.service_code;
  end if;
  if _changed and new.or_id is null and new.vehicle_id is not null
     and public._workshop_picking_due(new.company_id, new.starts_at, now()) then
    perform public._picking_open_auto(null, new.id, 'rdv');
  end if;
  return new;
end $$;
revoke all on function public._trg_appointment_spare_parts() from public, anon, authenticated;

drop trigger if exists trg_appointments_spare_parts on public.workshop_appointments;
create trigger trg_appointments_spare_parts after insert or update on public.workshop_appointments
  for each row execute function public._trg_appointment_spare_parts();

-- ---------------------------------------------------------------------
-- 6. Tache de la veille (toutes les heures a :05, Europe/Brussels lue dans la fonction)
-- ---------------------------------------------------------------------
create or replace function public._cron_workshop_picking_eve(_now timestamptz default now(), _company uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare x record; _n int := 0; d_now date := (_now at time zone 'Europe/Brussels')::date;
begin
  for x in
    select ap.id, ap.company_id, ap.starts_at from public.workshop_appointments ap
     where (_company is null or ap.company_id = _company)
       and ap.status not in ('annule', 'termine', 'demande', 'facture')
       and ap.vehicle_id is not null and ap.service_code is not null
       and (ap.starts_at at time zone 'Europe/Brussels')::date between d_now and d_now + 1
       and not exists (select 1 from public.picking_lists p
                        where p.status <> 'annulee'
                          and (p.appointment_id = ap.id or (ap.or_id is not null and p.repair_order_id = ap.or_id)))
     order by ap.starts_at
  loop
    if public._workshop_picking_due(x.company_id, x.starts_at, _now) then
      if public._picking_open_auto(null, x.id, 'veille') is not null then
        _n := _n + 1;
      end if;
    end if;
  end loop;
  return _n;
end $$;
revoke all on function public._cron_workshop_picking_eve(timestamptz, uuid) from public, anon, authenticated;

do $$
begin
  perform cron.schedule('workshop-picking-eve', '5 * * * *', $cron$ select public._cron_workshop_picking_eve(); $cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 7. Ecran du magasin « Pieces des RDV a venir »
-- ---------------------------------------------------------------------
-- Une ligne par piece de chaque RDV d'entretien du [_from, _to] (dates de Bruxelles). Etat :
--   reservee   : tout est reserve en stock ;
--   au_panier  : le manque est dans un panier ouvert (urgente / standard), pas encore envoye ;
--   commandee  : le manque est dans un panier commande (n° DCS quand il est saisi) ;
--   manquante  : le manque n'est commande nulle part (fin de serie, remplacee, panier annule...) ;
--   hors_stock : piece du kit qui ne se reserve pas (article non stocke, sans article, inactif).
create or replace function public.workshop_upcoming_parts(_company uuid, _from date, _to date)
returns table(
  appointment_id uuid, starts_at timestamptz, appointment_status text, repair_order_id uuid, or_number text,
  contact_id uuid, contact_name text, vehicle_id uuid, vehicle_label text, plate text, service_code text,
  mechanic_name text, picking_id uuid, picking_status text,
  reservation_id uuid, article_id uuid, reference text, designation text, bin_location text,
  qty_needed numeric, qty_reserved numeric, qty_missing numeric, qty_on_order numeric,
  part_state text, basket_id uuid, basket_label text, basket_kind text, basket_status text, dcs_order_number text,
  supplier_availability text, replacement_reference text, real_qty numeric, free_qty numeric,
  can_reserve boolean, can_order_urgent boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _from is null or _to is null or _to < _from or _to - _from > 62 then
    raise exception 'Période : du … au … (62 jours au plus).' using errcode = 'P0001';
  end if;
  return query
  with appts as (
    select ap.id, ap.starts_at, ap.status, ap.or_id, ap.contact_id, ap.vehicle_id,
           coalesce(ro.service_code, ap.service_code) as svc, ro.number as or_number,
           coalesce(m.name, ap.mechanic_name) as mech,
           coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company_name) as cname,
           nullif(btrim(concat_ws(' ', v.brand, v.model)), '') as vlabel, v.plate, v.ducati_model_year_id as my
      from public.workshop_appointments ap
      left join public.repair_orders ro on ro.id = ap.or_id
      left join public.workshop_mechanics m on m.id = ap.mechanic_id
      left join public.contacts c on c.id = ap.contact_id
      left join public.vehicles v on v.id = ap.vehicle_id
     where ap.company_id = _company
       and ap.status not in ('annule', 'demande')
       and coalesce(ro.status, '') not in ('facture', 'annule')
       and ap.vehicle_id is not null
       and coalesce(ro.service_code, ap.service_code) is not null
       and (ap.starts_at at time zone 'Europe/Brussels')::date between _from and _to
  ), res as (
    select ap.id as appt, s.id as rid, s.article_id as aid, coalesce(s.reference, ar.reference) as ref,
           coalesce(nullif(s.designation, ''), ar.designation) as des,
           nullif(btrim(coalesce(ar.bin_location, '')), '') as bin,
           s.qty_needed as need, s.qty_reserved as resv, greatest(s.qty_needed - s.qty_reserved, 0) as miss,
           ar.supplier_availability as avail,
           (select n.reference from public.articles n where n.id = ar.superseded_by_id) as repl
      from appts ap
      join public.stock_reservations s
        on s.status = 'active'
       and (case when ap.or_id is not null then s.repair_order_id = ap.or_id
                 else s.appointment_id = ap.id and s.repair_order_id is null end)
      join public.articles ar on ar.id = s.article_id
  ), lines as (
    select r.*, bk.bid, bk.blabel, bk.bkind, bk.bstatus, bk.dcs,
           coalesce((select sum(l.qty) from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                      where l.origin_line_id = r.rid and b.status = 'ouvert'), 0) as q_open,
           coalesce((select sum(l.qty) from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                      where l.origin_line_id = r.rid and b.status = 'commande'), 0) as q_sent,
           (select exists (select 1 from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
                            where l.origin_line_id = r.rid and b.status = 'ouvert' and b.kind = 'standard')) as has_std
      from res r
      left join lateral (
        select b.id as bid, b.label as blabel, b.kind as bkind, b.status as bstatus, b.dcs_order_number as dcs
          from public.supplier_basket_lines l join public.supplier_baskets b on b.id = l.basket_id
         where l.origin_line_id = r.rid and b.status in ('ouvert', 'commande', 'recu')
         order by (b.status = 'ouvert') desc, (b.kind = 'urgente') desc, l.created_at desc limit 1) bk on true
  ), outside as (
    -- pieces du kit sans reservation possible (article non stocke, sans article, inactif)
    select ap.id as appt, k.article_id as aid, coalesce(k.reference, ar.reference) as ref,
           coalesce(k.designation, ar.designation) as des, k.quantity as need,
           nullif(btrim(coalesce(ar.bin_location, '')), '') as bin
      from appts ap
      cross join lateral public._workshop_service_kit_items(_company, ap.my, public._workshop_kind_of(ap.svc)) k
      left join public.articles ar on ar.id = k.article_id
     where ap.my is not null and k.quantity > 0
       and (k.article_id is null or k.confidence = 'absent' or ar.mgmt_type::text <> 'A' or not coalesce(ar.is_active, true))
  )
  select ap.id, ap.starts_at, ap.status, ap.or_id, ap.or_number, ap.contact_id, ap.cname, ap.vehicle_id, ap.vlabel, ap.plate,
         ap.svc, ap.mech, pk.id, pk.status,
         x.rid, x.aid, x.ref, x.des, x.bin, x.need, x.resv, x.miss, x.q_open + x.q_sent,
         case when x.miss <= 0 then 'reservee'
              when x.q_open + x.q_sent >= x.miss and x.q_open > 0 then 'au_panier'
              when x.q_open + x.q_sent >= x.miss then 'commandee'
              else 'manquante' end,
         x.bid, x.blabel, x.bkind, x.bstatus, x.dcs, x.avail, x.repl,
         coalesce(st.real_qty, 0), greatest(coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0), 0),
         x.miss > 0 and coalesce(st.real_qty, 0) - coalesce(st.reserved_qty, 0) > 0,
         x.miss > 0 and coalesce(x.avail, '') not in ('red', 'yellow') and (x.q_open + x.q_sent < x.miss or x.has_std)
    from appts ap
    join lines x on x.appt = ap.id
    left join lateral public.article_stock(x.aid) st on true
    left join lateral (select p.id, p.status from public.picking_lists p
                        where p.status <> 'annulee' and (p.appointment_id = ap.id or (ap.or_id is not null and p.repair_order_id = ap.or_id))
                        order by p.created_at desc limit 1) pk on true
  union all
  select ap.id, ap.starts_at, ap.status, ap.or_id, ap.or_number, ap.contact_id, ap.cname, ap.vehicle_id, ap.vlabel, ap.plate,
         ap.svc, ap.mech, pk.id, pk.status,
         null::uuid, o.aid, o.ref, o.des, o.bin, o.need, 0::numeric, o.need, 0::numeric,
         'hors_stock', null::uuid, null::text, null::text, null::text, null::text, null::text, null::text,
         0::numeric, 0::numeric, false, false
    from appts ap
    join outside o on o.appt = ap.id
    left join lateral (select p.id, p.status from public.picking_lists p
                        where p.status <> 'annulee' and (p.appointment_id = ap.id or (ap.or_id is not null and p.repair_order_id = ap.or_id))
                        order by p.created_at desc limit 1) pk on true
   order by 2, 1, 17;
end $$;
revoke all on function public.workshop_upcoming_parts(uuid, date, date) from public, anon;
grant execute on function public.workshop_upcoming_parts(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
