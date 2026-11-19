-- =====================================================================
-- M8 — Parcours mecanicien, lot A (19/11/2026) : UN SEUL CHRONO.
-- Demarrer / Pause / Reprendre / Terminer, sur la pointeuse existante (B11). ATE010 ATE011.
--
-- Demande du client (19/11) : « il faut aussi qu'on puisse fermer la session en cours a l'atelier
-- et la reprendre.. et ca mets en pause le chrono sur la mission. »
--
-- Une seule source de temps : `workshop_time_entries` (presence → temps par fiche → rapprochement
-- passe / facture, B11). Le parcours technicien n'a plus de chrono a lui : ses operations sont des
-- pointages de travail portant `journey_operation`.
--
--  1. Colonnes de pointage : comment il s'est arrete (`stop_kind` : pause, stop = « Terminer »,
--     switch = demarrage d'un autre travail, auto_stop = arret automatique, departure = « Depart »),
--     le motif (`stop_reason`, liste parametrable), qui l'a arrete, le compagnon du planning
--     (`workshop_mechanic_id`), et la correction eventuelle par l'atelier (`corrected_*`).
--     Les lignes restent celles de la pointeuse : une ligne = un pointage horodate ; la cloture
--     pose `ended_at` / `minutes` une seule fois (garde : un pointage clos ne se rouvre pas, une
--     reprise = une NOUVELLE ligne). Chaque geste est trace dans `events`.
--  2. Motifs de pause : Parametres → Tables → « Motifs de pause (pointeuse) »
--     (`reference_values` workshop_pause_reason). Par defaut : Attente piece, Attente accord
--     client, Pause / fin de journee, Autre urgence, Autre. La colonne `extra.or_status` propose de
--     passer l'OR au statut correspondant (attente piece → « Pieces en commande » attente_pieces,
--     attente accord → « Attente devis » attente_devis).
--  3. `workshop_work_start` : « Demarrer » / « Reprendre ». Pointe le mecanicien (compte connecte,
--     ou code mecano de la pointeuse partagee) sur l'OR (et l'operation du parcours), passe l'OR
--     « en cours » (repair_order_start, Q43). Un seul pointage actif par mecanicien : un autre
--     travail en cours est mis en pause (motif « autre OR ») APRES confirmation (reponse
--     needs_confirm tant que _confirm_switch est faux). Reprendre sans operation = l'operation du
--     dernier pointage du mecanicien sur cet OR.
--  4. `workshop_work_pause` (motif obligatoire, statut d'OR propose) et `workshop_work_stop`
--     (« Terminer » : arrete le pointage, ne touche PAS au statut ; le passage en « Pret » et le
--     SMS de fin de travaux restent manuels, comme avant).
--  5. Arret automatique en fin de journee (mode G8 « arret automatique », 09-parametres.md
--     « Pointage ») : reglage `workshop_planning_settings.auto_stop_mode` (off | end_of_schedule,
--     off par defaut). Les pointages encore ouverts sont clos a l'heure de fin de l'horaire du
--     compagnon (workshop_mechanic_hours, sinon fin de journee du planning), stop_kind auto_stop,
--     motif fin_journee. pg_cron toutes les 15 min. `workshop_time_entry_correct` : l'atelier
--     (admin, chef d'atelier) corrige l'heure de fin, trace.
--  6. Vue `workshop_or_work_status` (security_invoker) : par OR, « en cours (par qui, depuis
--     quand) » / « en pause (motif) » / « termine » — OR, planning, pointeuse.
--
-- Additive, rejouable (add column if not exists, create or replace, drop ... if exists).
-- Aucune donnee existante modifiee (hors motifs precharges). NON APPLIQUEE (Simon applique en bloc).
-- Essai a blanc : supabase/tests/m8_pointage_pause_reprise.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes du pointage
-- ---------------------------------------------------------------------
alter table public.workshop_time_entries
  add column if not exists stop_kind            text,
  add column if not exists stop_reason          text,
  add column if not exists stopped_by           uuid references auth.users(id) on delete set null,
  add column if not exists workshop_mechanic_id uuid references public.workshop_mechanics(id) on delete set null,
  add column if not exists corrected_at         timestamptz,
  add column if not exists corrected_by         uuid references auth.users(id) on delete set null;

comment on column public.workshop_time_entries.stop_kind is 'Fin du pointage : pause | stop (Terminer) | switch (autre travail demarre) | auto_stop (arret automatique fin de journee) | departure (Depart). Vide = pointage d''avant le lot A.';
comment on column public.workshop_time_entries.stop_reason is 'Motif de la pause (reference_values workshop_pause_reason) ; autre_or / autre_operation pour un changement de travail ; fin_journee pour l''arret automatique.';
comment on column public.workshop_time_entries.workshop_mechanic_id is 'Compagnon du planning (workshop_mechanics) : horaire de l''arret automatique.';
comment on column public.workshop_time_entries.corrected_at is 'Heure de fin corrigee par l''atelier (arret automatique, oubli).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_time_entries_stop_kind_chk') then
    alter table public.workshop_time_entries add constraint workshop_time_entries_stop_kind_chk
      check (stop_kind is null or stop_kind in ('pause', 'stop', 'switch', 'auto_stop', 'departure'));
  end if;
end $$;

create index if not exists idx_wte_or_kind_ended on public.workshop_time_entries(or_id, ended_at desc) where kind = 'travail';

-- Un seul pointage de travail (OR ou tache improductive) ouvert par mecanicien. Pose seulement si
-- les donnees le permettent deja (sinon la garde par verrou des fonctions ci-dessous suffit).
do $$
begin
  if not exists (
    select 1 from public.workshop_time_entries
     where ended_at is null and kind in ('travail', 'improductif') and mechanic_id is not null and mechanic_code is null
     group by mechanic_id having count(*) > 1
  ) then
    create unique index if not exists uq_wte_one_open_work_user on public.workshop_time_entries(mechanic_id)
      where ended_at is null and kind in ('travail', 'improductif') and mechanic_id is not null and mechanic_code is null;
  else
    raise notice 'Plusieurs travaux ouverts pour un meme compte : index unique non pose.';
  end if;
  if not exists (
    select 1 from public.workshop_time_entries
     where ended_at is null and kind in ('travail', 'improductif') and mechanic_code is not null
     group by company_id, mechanic_code having count(*) > 1
  ) then
    create unique index if not exists uq_wte_one_open_work_code on public.workshop_time_entries(company_id, mechanic_code)
      where ended_at is null and kind in ('travail', 'improductif') and mechanic_code is not null;
  else
    raise notice 'Plusieurs travaux ouverts pour un meme code mecano : index unique non pose.';
  end if;
end $$;

-- Un pointage clos ne se rouvre pas et son debut ne bouge plus (reprise = nouvelle ligne) ; une
-- correction de l'heure de fin passe par workshop_time_entry_correct (corrected_at pose).
create or replace function public.workshop_time_entries_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.ended_at is null then return new; end if;
  if new.ended_at is null then
    raise exception 'Pointage clos : il ne se rouvre pas (Reprendre cree un nouveau pointage).' using errcode = '23514';
  end if;
  if new.started_at is distinct from old.started_at then
    raise exception 'Pointage clos : son heure de debut ne se modifie plus.' using errcode = '23514';
  end if;
  if new.ended_at is distinct from old.ended_at and new.corrected_at is not distinct from old.corrected_at then
    raise exception 'Pointage clos : la fin se corrige par « Corriger l''heure de fin » (tracee).' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.workshop_time_entries_guard() from public, anon, authenticated;
drop trigger if exists trg_wte_guard on public.workshop_time_entries;
create trigger trg_wte_guard before update on public.workshop_time_entries
  for each row execute function public.workshop_time_entries_guard();

-- ---------------------------------------------------------------------
-- 2. Reglage atelier : arret automatique + motifs de pause
-- ---------------------------------------------------------------------
alter table public.workshop_planning_settings
  add column if not exists auto_stop_mode text not null default 'off';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_planning_settings_auto_stop_chk') then
    alter table public.workshop_planning_settings add constraint workshop_planning_settings_auto_stop_chk
      check (auto_stop_mode in ('off', 'end_of_schedule'));
  end if;
end $$;
comment on column public.workshop_planning_settings.auto_stop_mode is 'Arret automatique des pointages (G8 « arret automatique ») : off, ou end_of_schedule = a l''heure de fin de l''horaire du compagnon.';

insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'workshop_pause_reason', x.code, x.label, x.so, x.extra
  from public.companies c
 cross join (values
   ('attente_piece',  'Attente pièce',          1, '{"or_status":"attente_pieces"}'::jsonb),
   ('attente_accord', 'Attente accord client',  2, '{"or_status":"attente_devis"}'::jsonb),
   ('fin_journee',    'Pause / fin de journée', 3, '{}'::jsonb),
   ('autre_urgence',  'Autre urgence',          4, '{}'::jsonb),
   ('autre',          'Autre',                  5, '{}'::jsonb)
 ) as x(code, label, so, extra)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Aides internes
-- ---------------------------------------------------------------------
-- Clot un pointage ouvert et le trace (events). Interne : appelee par les fonctions ci-dessous.
create or replace function public._wte_close(_id uuid, _kind text, _reason text, _at timestamptz default now(), _origin text default 'screen')
returns public.workshop_time_entries
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _end timestamptz;
begin
  select * into e from public.workshop_time_entries where id = _id for update;
  if not found or e.ended_at is not null then return e; end if;
  _end := greatest(coalesce(_at, now()), e.started_at);
  update public.workshop_time_entries
     set ended_at = _end,
         minutes = round(extract(epoch from (_end - e.started_at)) / 60.0, 2),
         stop_kind = _kind, stop_reason = nullif(btrim(coalesce(_reason, '')), ''), stopped_by = auth.uid()
   where id = _id
  returning * into e;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (e.company_id, auth.uid(),
          case _kind when 'stop' then 'workshop_work_finished' when 'auto_stop' then 'workshop_work_auto_stopped' else 'workshop_work_paused' end,
          case when e.or_id is not null then 'repair_orders' else 'workshop_time_entries' end,
          coalesce(e.or_id, e.id)::text, _origin,
          jsonb_build_object('time_entry_id', e.id, 'started_at', e.started_at, 'ended_at', null),
          jsonb_build_object('time_entry_id', e.id, 'kind', e.kind, 'ended_at', e.ended_at, 'minutes', e.minutes,
                             'stop_kind', e.stop_kind, 'stop_reason', e.stop_reason, 'journey_operation', e.journey_operation,
                             'mechanic', coalesce(e.mechanic_name, e.mechanic_code, e.mechanic_id::text)));
  return e;
end $$;
revoke all on function public._wte_close(uuid, text, text, timestamptz, text) from public, anon, authenticated;

-- Pointage de travail ouvert du mecanicien : par code mecano (poste partage) ou compte connecte.
create or replace function public._wte_open_work(_company uuid, _uid uuid, _code text)
returns public.workshop_time_entries
language sql stable security definer set search_path = public, pg_temp as $$
  select e.* from public.workshop_time_entries e
   where e.ended_at is null and e.kind in ('travail', 'improductif')
     and case when _code is not null then e.company_id = _company and e.mechanic_code = _code
              else e.mechanic_id = _uid and e.mechanic_code is null end
   order by e.started_at desc
   limit 1;
$$;
revoke all on function public._wte_open_work(uuid, uuid, text) from public, anon, authenticated;

-- Heure de fin de journee d'un pointage : horaire du compagnon ce jour-la (fin d'apres-midi, sinon
-- de matinee), sinon fin de journee du planning, sinon 18:00 (heure de Bruxelles). Un pointage
-- commence apres cette heure (heures sup) s'arrete a minuit.
create or replace function public.workshop_time_entry_day_end(_entry uuid)
returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _local timestamp; _wm uuid; _end time; _dl timestamptz; _name text;
begin
  select * into e from public.workshop_time_entries where id = _entry;
  if not found then return null; end if;
  _local := e.started_at at time zone 'Europe/Brussels';
  _name := coalesce(nullif(btrim(e.mechanic_name), ''),
                    (select rv.label from public.reference_values rv
                      where rv.company_id = e.company_id and rv.table_key = 'workshop_mechanic' and rv.code = e.mechanic_code limit 1));
  _wm := coalesce(e.workshop_mechanic_id,
    (select m.id from public.workshop_mechanics m
      where m.company_id = e.company_id
        and ((e.mechanic_id is not null and m.user_id = e.mechanic_id) or lower(btrim(m.name)) = lower(btrim(coalesce(_name, ''))))
      order by (m.user_id is not distinct from e.mechanic_id) desc, m.is_active desc, m.sort_order
      limit 1));
  if _wm is not null then
    select coalesce(h.pm_end, h.am_end) into _end
      from public.workshop_mechanic_hours h
     where h.mechanic_id = _wm and h.weekday = extract(isodow from _local)::int;
  end if;
  if _end is null then
    select s.day_end into _end from public.workshop_planning_settings s where s.company_id = e.company_id;
  end if;
  _end := coalesce(_end, time '18:00');
  _dl := (_local::date + _end) at time zone 'Europe/Brussels';
  if _dl <= e.started_at then
    _dl := ((_local::date + 1)::timestamp) at time zone 'Europe/Brussels';
  end if;
  return _dl;
end $$;
revoke all on function public.workshop_time_entry_day_end(uuid) from public, anon;
grant execute on function public.workshop_time_entry_day_end(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Demarrer / Reprendre
-- ---------------------------------------------------------------------
create or replace function public.workshop_work_start(
  _or uuid,
  _operation text default null,
  _confirm_switch boolean default false,
  _mechanic_code text default null,
  _mechanic_name text default null,
  _origin text default 'screen'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  _uid uuid := auth.uid();
  _code text := nullif(btrim(coalesce(_mechanic_code, '')), '');
  _op text := nullif(btrim(coalesce(_operation, '')), '');
  _open public.workshop_time_entries%rowtype;
  _name text; _wm uuid; _id uuid; _resumed boolean; _switched uuid; _at timestamptz;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(r.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if _uid is null and _code is null then
    raise exception 'Pointage : mecanicien inconnu (compte connecte ou code mecano).' using errcode = '22023';
  end if;
  if r.status not in ('a_faire', 'attente_devis', 'attente_pieces', 'en_cours') then
    raise exception 'OR % : il ne se pointe plus (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if coalesce(r.customer_approval, '') = 'en_attente' then
    raise exception 'OR % : accord du client en attente, le travail ne peut pas commencer.', coalesce(r.number, r.id::text) using errcode = '23514';
  end if;

  -- Un seul pointage actif par mecanicien : on serialise ses gestes.
  perform pg_advisory_xact_lock(hashtext('wte:' || coalesce(_code || '@' || r.company_id::text, _uid::text)));

  -- Reprendre sans operation : l'operation du dernier pointage du mecanicien sur cet OR.
  if _op is null then
    select e.journey_operation into _op
      from public.workshop_time_entries e
     where e.or_id = _or and e.kind = 'travail' and e.ended_at is not null
       and case when _code is not null then e.mechanic_code = _code else e.mechanic_id = _uid and e.mechanic_code is null end
     order by e.ended_at desc limit 1;
  end if;

  select * into _open from public._wte_open_work(r.company_id, _uid, _code);
  if _open.id is not null then
    if _open.kind = 'travail' and _open.or_id = _or and (_operation is null or _open.journey_operation is not distinct from _op) then
      return jsonb_build_object('status', 'already', 'entry_id', _open.id, 'started_at', _open.started_at,
                                'operation', _open.journey_operation, 'or_status', r.status);
    end if;
    if not (_open.kind = 'travail' and _open.or_id = _or) and not coalesce(_confirm_switch, false) then
      return jsonb_build_object('status', 'needs_confirm', 'current', jsonb_build_object(
        'entry_id', _open.id, 'kind', _open.kind, 'or_id', _open.or_id,
        'or_number', (select o.number from public.repair_orders o where o.id = _open.or_id),
        'task_code', _open.task_code, 'started_at', _open.started_at, 'operation', _open.journey_operation));
    end if;
    perform public._wte_close(_open.id, 'switch',
      case when _open.kind = 'travail' and _open.or_id = _or then 'autre_operation' else 'autre_or' end, now(), _origin);
    _switched := _open.id;
  end if;

  -- L'OR passe « en cours » (meme regle et meme trace que le bouton « Demarrer » Q43).
  if r.status in ('a_faire', 'attente_devis', 'attente_pieces') then
    perform public.repair_order_start(_or);
  end if;

  if _code is not null then
    _name := coalesce((select rv.label from public.reference_values rv
                        where rv.company_id = r.company_id and rv.table_key = 'workshop_mechanic' and rv.code = _code limit 1),
                      nullif(btrim(coalesce(_mechanic_name, '')), ''), _code);
    select m.id into _wm from public.workshop_mechanics m
     where m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(_name)) order by m.is_active desc, m.sort_order limit 1;
  else
    select m.id, m.name into _wm, _name from public.workshop_mechanics m
     where m.company_id = r.company_id and m.user_id = _uid order by m.is_active desc, m.sort_order limit 1;
    _name := coalesce(nullif(btrim(coalesce(_mechanic_name, '')), ''), _name,
                      (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.profiles p where p.id = _uid));
  end if;

  _resumed := exists (
    select 1 from public.workshop_time_entries e
     where e.or_id = _or and e.kind = 'travail' and e.ended_at is not null
       and case when _code is not null then e.mechanic_code = _code else e.mechanic_id = _uid and e.mechanic_code is null end);

  insert into public.workshop_time_entries
    (company_id, mechanic_id, mechanic_name, mechanic_code, workshop_mechanic_id, or_id, journey_operation, kind, started_at)
  values (r.company_id, case when _code is null then _uid end, _name, _code, _wm, _or, _op, 'travail', now())
  returning id, started_at into _id, _at;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, _uid, case when _resumed then 'workshop_work_resumed' else 'workshop_work_started' end,
          'repair_orders', _or::text, _origin,
          case when _switched is not null then jsonb_build_object('switched_from', _switched) end,
          jsonb_build_object('time_entry_id', _id, 'mechanic', _name, 'mechanic_code', _code, 'journey_operation', _op));

  return jsonb_build_object('status', case when _resumed then 'resumed' else 'started' end,
                            'entry_id', _id, 'started_at', _at, 'operation', _op, 'switched_from', _switched,
                            'or_status', (select o.status from public.repair_orders o where o.id = _or));
end $$;
revoke all on function public.workshop_work_start(uuid, text, boolean, text, text, text) from public, anon;
grant execute on function public.workshop_work_start(uuid, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Pause (motif) / Terminer
-- ---------------------------------------------------------------------
-- Trouve le pointage vise : un pointage donne (le chef d'atelier met en pause depuis le planning),
-- sinon le travail ouvert du mecanicien (optionnellement sur cet OR).
create or replace function public._wte_target(_entry uuid, _or uuid, _mechanic_code text)
returns public.workshop_time_entries
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _code text := nullif(btrim(coalesce(_mechanic_code, '')), ''); _co uuid;
begin
  if _entry is not null then
    select * into e from public.workshop_time_entries where id = _entry;
    return e;
  end if;
  if _or is not null then select company_id into _co from public.repair_orders where id = _or; end if;
  select x.* into e from public.workshop_time_entries x
   where x.ended_at is null and x.kind in ('travail', 'improductif')
     and (_or is null or x.or_id = _or)
     and case when _code is not null then x.mechanic_code = _code and (_co is null or x.company_id = _co)
              else x.mechanic_id = auth.uid() and x.mechanic_code is null end
   order by x.started_at desc limit 1;
  return e;
end $$;
revoke all on function public._wte_target(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.workshop_work_pause(
  _reason text,
  _or uuid default null,
  _entry uuid default null,
  _or_status text default null,
  _mechanic_code text default null,
  _origin text default 'screen'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.workshop_time_entries%rowtype;
  _r text := nullif(btrim(coalesce(_reason, '')), '');
  _st text := nullif(btrim(coalesce(_or_status, '')), '');
  o public.repair_orders%rowtype;
  _changed boolean := false;
begin
  if _r is null then raise exception 'Motif de pause obligatoire.' using errcode = '22023'; end if;
  select * into e from public._wte_target(_entry, _or, _mechanic_code);
  if e.id is null then return jsonb_build_object('status', 'none'); end if;
  if not public.can_write_table(e.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if e.ended_at is not null then return jsonb_build_object('status', 'none', 'entry_id', e.id); end if;
  if _r not in ('autre_or', 'autre_operation', 'fin_journee', 'autre')
     and not exists (select 1 from public.reference_values rv
                      where rv.company_id = e.company_id and rv.table_key = 'workshop_pause_reason' and rv.code = _r and rv.is_active) then
    raise exception 'Motif de pause inconnu : %.', _r using errcode = '22023';
  end if;
  if _st is not null and _st not in ('attente_pieces', 'attente_devis') then
    raise exception 'Statut d''OR propose inconnu : %.', _st using errcode = '22023';
  end if;

  e := public._wte_close(e.id, 'pause', _r, now(), _origin);

  -- Statut propose (attente piece / accord client) : seulement si plus personne ne travaille dessus.
  if _st is not null and e.or_id is not null then
    select * into o from public.repair_orders where id = e.or_id for update;
    if found and o.status in ('a_faire', 'en_cours') and o.status <> _st
       and not exists (select 1 from public.workshop_time_entries x where x.or_id = o.id and x.kind = 'travail' and x.ended_at is null) then
      update public.repair_orders set status = _st where id = o.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (o.company_id, auth.uid(), 'repair_order_status_from_pause', 'repair_orders', o.id::text, _origin,
              jsonb_build_object('status', o.status), jsonb_build_object('status', _st, 'reason', _r, 'time_entry_id', e.id));
      _changed := true;
    end if;
  end if;

  return jsonb_build_object('status', 'paused', 'entry_id', e.id, 'minutes', e.minutes, 'reason', _r,
                            'or_id', e.or_id, 'or_status_changed', _changed);
end $$;
revoke all on function public.workshop_work_pause(text, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.workshop_work_pause(text, uuid, uuid, text, text, text) to authenticated;

create or replace function public.workshop_work_stop(
  _or uuid default null,
  _entry uuid default null,
  _mechanic_code text default null,
  _kind text default 'stop',
  _origin text default 'screen'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype;
begin
  if coalesce(_kind, 'stop') not in ('stop', 'departure') then
    raise exception 'Fin de pointage inconnue : %.', _kind using errcode = '22023';
  end if;
  select * into e from public._wte_target(_entry, _or, _mechanic_code);
  if e.id is null or e.ended_at is not null then return jsonb_build_object('status', 'none'); end if;
  if not public.can_write_table(e.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  e := public._wte_close(e.id, coalesce(_kind, 'stop'), case when _kind = 'departure' then 'fin_journee' end, now(), _origin);
  return jsonb_build_object('status', 'stopped', 'entry_id', e.id, 'minutes', e.minutes, 'or_id', e.or_id);
end $$;
revoke all on function public.workshop_work_stop(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.workshop_work_stop(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Arret automatique en fin de journee + correction par l'atelier
-- ---------------------------------------------------------------------
create or replace function public.workshop_time_auto_stop(_company uuid default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare x record; _dl timestamptz; n integer := 0;
begin
  for x in
    select e.id, e.company_id
      from public.workshop_time_entries e
      join public.workshop_planning_settings s on s.company_id = e.company_id and s.auto_stop_mode = 'end_of_schedule'
     where e.ended_at is null
       and (_company is null or e.company_id = _company)
       -- Appel depuis l'application : seulement les societes de l'utilisateur. pg_cron : toutes.
       and (auth.uid() is null or public.can_write_table(e.company_id, 'workshop_time_entries'))
     order by e.started_at
     for update of e skip locked
  loop
    _dl := public.workshop_time_entry_day_end(x.id);
    if _dl is not null and _dl <= now() then
      perform public._wte_close(x.id, 'auto_stop', 'fin_journee', _dl, 'auto');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.workshop_time_auto_stop(uuid) from public, anon;
grant execute on function public.workshop_time_auto_stop(uuid) to authenticated;

create or replace function public.workshop_time_entry_correct(_entry uuid, _ended_at timestamptz, _note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _old timestamptz; _oldm numeric;
begin
  select * into e from public.workshop_time_entries where id = _entry for update;
  if not found then raise exception 'Pointage introuvable.' using errcode = 'P0002'; end if;
  if not (public.is_admin(e.company_id) or public.has_role(e.company_id, 'chef_atelier'::public.app_role)) then
    raise exception 'Correction reservee a l''administrateur et au chef d''atelier.' using errcode = '42501';
  end if;
  if e.ended_at is null then raise exception 'Pointage en cours : mettez-le en pause ou terminez-le d''abord.' using errcode = '23514'; end if;
  if _ended_at is null or _ended_at <= e.started_at or _ended_at > now() then
    raise exception 'Heure de fin invalide (apres le debut, pas dans le futur).' using errcode = '22023';
  end if;
  _old := e.ended_at; _oldm := e.minutes;
  update public.workshop_time_entries
     set ended_at = _ended_at,
         minutes = round(extract(epoch from (_ended_at - e.started_at)) / 60.0, 2),
         corrected_at = clock_timestamp(), corrected_by = auth.uid(),
         note = coalesce(nullif(btrim(coalesce(_note, '')), ''), note)
   where id = _entry
  returning * into e;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (e.company_id, auth.uid(), 'workshop_time_entry_corrected', 'workshop_time_entries', e.id::text, 'screen',
          jsonb_build_object('ended_at', _old, 'minutes', _oldm),
          jsonb_build_object('ended_at', e.ended_at, 'minutes', e.minutes, 'note', e.note, 'stop_kind', e.stop_kind));
  return jsonb_build_object('status', 'corrected', 'entry_id', e.id, 'minutes', e.minutes);
end $$;
revoke all on function public.workshop_time_entry_correct(uuid, timestamptz, text) from public, anon;
grant execute on function public.workshop_time_entry_correct(uuid, timestamptz, text) to authenticated;

do $$
begin
  perform cron.schedule('workshop-time-auto-stop', '*/15 * * * *', $cron$ select public.workshop_time_auto_stop(); $cron$);
exception when others then
  raise notice 'pg_cron : arret automatique non planifie : %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 7. Etat de travail par OR (OR, planning, pointeuse)
-- ---------------------------------------------------------------------
-- work_state : running (pointage ouvert) | paused (dernier pointage en pause, change de travail ou
-- arrete automatiquement) | stopped (Terminer, ou pointage d'avant le lot A).
create or replace view public.workshop_or_work_status
with (security_invoker = true) as
select o.id as or_id,
       o.company_id,
       case when run.n > 0 then 'running'
            when last.stop_kind in ('pause', 'switch', 'auto_stop', 'departure') then 'paused'
            else 'stopped' end as work_state,
       run.names as running_by,
       run.since as running_since,
       run.operation as running_operation,
       last.stop_kind as last_stop_kind,
       last.stop_reason as last_stop_reason,
       last.ended_at as last_stopped_at,
       last.mechanic_name as last_mechanic,
       last.journey_operation as last_operation,
       tot.minutes as closed_minutes
  from (select distinct e.or_id from public.workshop_time_entries e where e.kind = 'travail' and e.or_id is not null) w
  join public.repair_orders o on o.id = w.or_id
  left join lateral (
    select count(*) as n,
           string_agg(coalesce(e.mechanic_name, e.mechanic_code, '?'), ', ' order by e.started_at) as names,
           min(e.started_at) as since,
           (array_agg(e.journey_operation order by e.started_at desc))[1] as operation
      from public.workshop_time_entries e
     where e.or_id = o.id and e.kind = 'travail' and e.ended_at is null
  ) run on true
  left join lateral (
    select e.stop_kind, e.stop_reason, e.ended_at, coalesce(e.mechanic_name, e.mechanic_code) as mechanic_name, e.journey_operation
      from public.workshop_time_entries e
     where e.or_id = o.id and e.kind = 'travail' and e.ended_at is not null
     order by e.ended_at desc limit 1
  ) last on true
  left join lateral (
    select coalesce(sum(e.minutes), 0) as minutes
      from public.workshop_time_entries e
     where e.or_id = o.id and e.kind = 'travail' and e.minutes is not null
  ) tot on true;
comment on view public.workshop_or_work_status is 'Etat de travail par OR (lot A parcours mecanicien) : en cours (par qui, depuis quand) / en pause (motif) / termine. RLS des tables sous-jacentes (security_invoker).';
grant select on public.workshop_or_work_status to authenticated;
