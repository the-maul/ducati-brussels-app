-- =====================================================================
-- M8 — Decision client Q58 (20/11/2026) : picking list automatique LA VEILLE OUVREE du RDV.
-- ATE015 ATE013 (lot B du parcours mecanicien, tache workshop-picking-eve).
--
-- La picking list automatique d'un RDV d'entretien se cree la veille OUVREE du RDV, selon les
-- jours d'ouverture de l'atelier : horaires des compagnons (workshop_mechanic_hours des
-- compagnons actifs et visibles au planning), jours feries legaux belges (si le reglage du
-- planning est coche) et feries / fermetures saisis pour tout l'atelier (workshop_calendar_blocks
-- couvrant toute la journee). Exemple : RDV du mardi → la liste se cree le samedi (dimanche et
-- lundi fermes), a l'heure reglee (16 h par defaut) ; rattrapage les jours suivants et le jour
-- meme si la tache a manque son heure (inchange).
--
-- Reglage « veille ouvree / veille calendaire » : workshop_planning_settings.picking_eve_basis
-- (ouvree par defaut). Ecrit par workshop_parts_settings_set (parametre ajoute, trace).
--
-- Jour ouvert (workshop_day_is_open) :
--   - pas un ferie legal belge quand belgian_holidays est coche (10 jours, Paques calcule) ;
--   - pas couvert en entier par un ferie / une fermeture de tout l'atelier ;
--   - au moins un compagnon actif et visible a un horaire ce jour-la et n'est pas absent toute
--     la journee ; aucun horaire saisi dans la societe : lundi → samedi ouverts (repli).
-- Miroir TypeScript : reservations/parts-flow.ts (eveDate, pickingDue), planning/rules.ts.
--
-- Suppose appliquee : 20261119250000 (lot B). Additive, rejouable.
-- Essai a blanc : supabase/tests/m8_picking_veille_ouvree.sql. NON APPLIQUEE.
-- =====================================================================

alter table public.workshop_planning_settings
  add column if not exists picking_eve_basis text not null default 'ouvree';
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_picking_eve_basis_chk;
alter table public.workshop_planning_settings add constraint workshop_planning_settings_picking_eve_basis_chk
  check (picking_eve_basis in ('ouvree', 'calendaire'));
comment on column public.workshop_planning_settings.picking_eve_basis is
  'Q58 : la picking list du RDV se cree la veille OUVREE (ouvree, defaut : dernier jour ouvert de l''atelier avant le RDV) ou la veille calendaire (calendaire : le jour d''avant).';

-- ---------------------------------------------------------------------
-- 1. Jours feries legaux belges (miroir de planning/rules.ts belgianHolidays)
-- ---------------------------------------------------------------------
create or replace function public._easter_sunday(_y int)
returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := _y % 19; b := _y / 100; c := _y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
  g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(_y, mo, dy);
end $$;

create or replace function public.belgian_legal_holiday(_d date)
returns boolean language sql immutable as $$
  select _d in (
    make_date(extract(year from _d)::int, 1, 1),
    public._easter_sunday(extract(year from _d)::int) + 1,
    make_date(extract(year from _d)::int, 5, 1),
    public._easter_sunday(extract(year from _d)::int) + 39,
    public._easter_sunday(extract(year from _d)::int) + 50,
    make_date(extract(year from _d)::int, 7, 21),
    make_date(extract(year from _d)::int, 8, 15),
    make_date(extract(year from _d)::int, 11, 1),
    make_date(extract(year from _d)::int, 11, 11),
    make_date(extract(year from _d)::int, 12, 25));
$$;
grant execute on function public.belgian_legal_holiday(date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Jour ouvert de l'atelier, veille ouvree
-- ---------------------------------------------------------------------
create or replace function public.workshop_day_is_open(_company uuid, _d date)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _hol boolean; _d0 timestamptz; _d1 timestamptz; _any_hours boolean;
begin
  if _d is null then return false; end if;
  select coalesce((select s.belgian_holidays from public.workshop_planning_settings s where s.company_id = _company), true) into _hol;
  if _hol and public.belgian_legal_holiday(_d) then return false; end if;
  _d0 := (_d::timestamp) at time zone 'Europe/Brussels';
  _d1 := ((_d + 1)::timestamp) at time zone 'Europe/Brussels';
  if exists (select 1 from public.workshop_calendar_blocks b
              where b.company_id = _company and b.mechanic_id is null and b.kind in ('ferie', 'fermeture')
                and b.starts_at <= _d0 and b.ends_at >= _d1) then
    return false;
  end if;
  select exists (select 1 from public.workshop_mechanic_hours h
                   join public.workshop_mechanics m on m.id = h.mechanic_id
                  where m.company_id = _company and m.is_active and m.visible_in_planning
                    and ((h.am_start is not null and h.am_end > h.am_start) or (h.pm_start is not null and h.pm_end > h.pm_start)))
    into _any_hours;
  if not _any_hours then
    return extract(isodow from _d)::int <> 7;   -- repli : lundi → samedi
  end if;
  return exists (
    select 1 from public.workshop_mechanic_hours h
      join public.workshop_mechanics m on m.id = h.mechanic_id
     where m.company_id = _company and m.is_active and m.visible_in_planning
       and h.weekday = extract(isodow from _d)::int
       and ((h.am_start is not null and h.am_end > h.am_start) or (h.pm_start is not null and h.pm_end > h.pm_start))
       and not exists (select 1 from public.workshop_calendar_blocks b
                        where b.company_id = _company and b.mechanic_id = m.id and b.kind in ('absence', 'pause')
                          and b.starts_at <= _d0 and b.ends_at >= _d1));
end $$;
revoke all on function public.workshop_day_is_open(uuid, date) from public, anon;
grant execute on function public.workshop_day_is_open(uuid, date) to authenticated;

create or replace function public._workshop_picking_eve_basis(_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.picking_eve_basis from public.workshop_planning_settings s where s.company_id = _company), 'ouvree');
$$;
revoke all on function public._workshop_picking_eve_basis(uuid) from public, anon, authenticated;

-- Jour de creation de la liste d'un RDV du jour _rdv : veille calendaire, ou dernier jour ouvert
-- avant le RDV (31 jours au plus ; aucun jour ouvert trouve : la veille calendaire).
create or replace function public.workshop_picking_eve_date(_company uuid, _rdv date)
returns date language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _d date;
begin
  if _rdv is null then return null; end if;
  if public._workshop_picking_eve_basis(_company) = 'calendaire' then return _rdv - 1; end if;
  for i in 1..31 loop
    _d := _rdv - i;
    if public.workshop_day_is_open(_company, _d) then return _d; end if;
  end loop;
  return _rdv - 1;
end $$;
revoke all on function public.workshop_picking_eve_date(uuid, date) from public, anon;
grant execute on function public.workshop_picking_eve_date(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Liste due ? (20261119250000, redefinie) — miroir parts-flow.ts pickingDue
-- ---------------------------------------------------------------------
create or replace function public._workshop_picking_due(_company uuid, _starts timestamptz, _now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s record; d_rdv date; d_now date; d_eve date;
begin
  if _starts is null then return false; end if;
  select * into s from public._workshop_parts_settings(_company);
  if s.mode <> 'veille' then return false; end if;
  d_rdv := (_starts at time zone 'Europe/Brussels')::date;
  d_now := (_now at time zone 'Europe/Brussels')::date;
  if d_rdv = d_now then return true; end if;             -- rattrapage : RDV du jour
  if d_rdv < d_now then return false; end if;
  d_eve := public.workshop_picking_eve_date(_company, d_rdv);
  return d_now > d_eve
      or (d_now = d_eve and extract(hour from (_now at time zone 'Europe/Brussels')) >= s.eve_hour);
end $$;
revoke all on function public._workshop_picking_due(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Tache de la veille : RDV des 15 prochains jours (une veille ouvree peut tomber plusieurs jours
-- avant : RDV du mardi → samedi), filtres par _workshop_picking_due.
create or replace function public._cron_workshop_picking_eve(_now timestamptz default now(), _company uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare x record; _n int := 0; d_now date := (_now at time zone 'Europe/Brussels')::date;
begin
  for x in
    select ap.id, ap.company_id, ap.starts_at from public.workshop_appointments ap
     where (_company is null or ap.company_id = _company)
       and ap.status not in ('annule', 'termine', 'demande', 'facture')
       and ap.vehicle_id is not null and ap.service_code is not null
       and (ap.starts_at at time zone 'Europe/Brussels')::date between d_now and d_now + 15
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

-- ---------------------------------------------------------------------
-- 4. Reglages (lecture / ecriture tracee) : la base de la veille s'ajoute
-- ---------------------------------------------------------------------
create or replace function public.workshop_parts_settings(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s record;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select * into s from public._workshop_parts_settings(_company);
  return jsonb_build_object('mode', s.mode, 'eve_hour', s.eve_hour, 'urgent_days', s.urgent_days,
                            'eve_basis', public._workshop_picking_eve_basis(_company));
end $$;
revoke all on function public.workshop_parts_settings(uuid) from public, anon;
grant execute on function public.workshop_parts_settings(uuid) to authenticated;

drop function if exists public.workshop_parts_settings_set(uuid, text, integer, numeric);
create or replace function public.workshop_parts_settings_set(_company uuid, _mode text, _eve_hour integer, _urgent_days numeric,
                                                              _eve_basis text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old record; _rv uuid; _old_basis text; _basis text;
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
  _old_basis := public._workshop_picking_eve_basis(_company);
  _basis := coalesce(nullif(btrim(coalesce(_eve_basis, '')), ''), _old_basis);
  if _basis not in ('ouvree', 'calendaire') then
    raise exception 'Veille inconnue : % (ouvrée ou calendaire).', _basis using errcode = 'P0001';
  end if;
  select * into old from public._workshop_parts_settings(_company);
  insert into public.workshop_planning_settings (company_id, picking_auto_mode, picking_eve_hour, picking_eve_basis)
  values (_company, _mode, _eve_hour, _basis)
  on conflict (company_id) do update
     set picking_auto_mode = excluded.picking_auto_mode, picking_eve_hour = excluded.picking_eve_hour,
         picking_eve_basis = excluded.picking_eve_basis, updated_at = now();
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
          jsonb_build_object('mode', old.mode, 'eve_hour', old.eve_hour, 'urgent_days', old.urgent_days, 'eve_basis', _old_basis),
          jsonb_build_object('mode', _mode, 'eve_hour', _eve_hour, 'urgent_days', _urgent_days, 'eve_basis', _basis));
  return jsonb_build_object('mode', _mode, 'eve_hour', _eve_hour, 'urgent_days', _urgent_days, 'eve_basis', _basis);
end $$;
revoke all on function public.workshop_parts_settings_set(uuid, text, integer, numeric, text) from public, anon;
grant execute on function public.workshop_parts_settings_set(uuid, text, integer, numeric, text) to authenticated;
