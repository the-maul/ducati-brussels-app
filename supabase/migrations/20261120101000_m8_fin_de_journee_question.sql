-- =====================================================================
-- M8 — Decision client Q57 (20/11/2026) : FIN DE JOURNEE, « Vous etes toujours la ? ». ATE011 B11.
--
-- A l'heure de fin de l'horaire du mecanicien (workshop_mechanic_hours), si son pointage est
-- encore en cours, une fenetre s'affiche sur son ecran (Mon atelier, OR, parcours, pointeuse) :
-- « Vous etes toujours la ? » [Oui, je continue] / [Mettre en pause].
--  - Sans reponse dans les 5 minutes : le pointage passe en pause, motif « Fin de journee
--    (automatique) », A L'HEURE DE FIN + 5 MIN (pas a l'heure ou la tache passe), trace.
--  - « Oui, je continue » repousse la question de 1 h (reglable) ; la reponse est gardee
--    (table append-only) et vaut pour tous ses pointages du jour (changer d'OR ne la perd pas).
--  - Le serveur est le filet de securite : la tache planifiee de l'arret automatique (lot A,
--    workshop-time-auto-stop) met en pause, a l'heure de la question + 5 min, les pointages dont
--    la question n'a pas recu de reponse. Ca marche meme si la tablette est eteinte. La tache
--    passe maintenant toutes les 5 minutes (au lieu de 15) ; l'heure de fin posee reste exacte.
--  - Le chef d'atelier corrige l'heure de fin (workshop_time_entry_correct, inchange).
--
-- Reglage : workshop_planning_settings.auto_stop_mode gagne la valeur « ask » (Planning →
-- Reglages, « Arret automatique ») ; delai de reponse end_of_day_prompt_minutes (5) et report
-- end_of_day_snooze_minutes (60). Mode « ask » pose pour ITALBIKE STORE (decision du client) et
-- pour la societe de test ItalTest (essais). Les autres modes sont inchanges.
--
-- Heure de la question d'un pointage (workshop_time_entry_ask_at) :
--   fin de l'horaire du compagnon le jour du pointage (fin d'apres-midi, sinon de matinee ;
--   sinon fin de journee du planning ; sinon 18:00, heure de Bruxelles) ;
--   repoussee a la derniere reponse « je continue » du mecanicien ce jour-la ;
--   pointage commence APRES cette heure (heures sup) : sa question vient 1 h (le report) apres
--   son debut, ou a la derniere reponse si elle est plus tard.
-- Mise en pause automatique = question + delai de reponse.
--
-- Suppose appliquees : 20261119241000 (lot A), 20261120100000 (Q60, tablette partagee : la
-- reponse se fait aussi sous l'identite choisie sur la tablette).
-- Additive, rejouable. Essai a blanc : supabase/tests/m8_fin_de_journee_question.sql.
-- NON APPLIQUEE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reglages
-- ---------------------------------------------------------------------
alter table public.workshop_planning_settings drop constraint if exists workshop_planning_settings_auto_stop_chk;
alter table public.workshop_planning_settings add constraint workshop_planning_settings_auto_stop_chk
  check (auto_stop_mode in ('off', 'end_of_schedule', 'ask'));
comment on column public.workshop_planning_settings.auto_stop_mode is
  'Arret automatique des pointages : off ; end_of_schedule = arret a l''heure de fin de l''horaire du compagnon (G8) ; ask = question « Vous etes toujours la ? » a l''heure de fin, pause automatique sans reponse apres end_of_day_prompt_minutes (Q57, 20/11/2026).';

alter table public.workshop_planning_settings
  add column if not exists end_of_day_prompt_minutes smallint not null default 5,
  add column if not exists end_of_day_snooze_minutes smallint not null default 60;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_planning_settings_eod_prompt_chk') then
    alter table public.workshop_planning_settings add constraint workshop_planning_settings_eod_prompt_chk
      check (end_of_day_prompt_minutes between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_planning_settings_eod_snooze_chk') then
    alter table public.workshop_planning_settings add constraint workshop_planning_settings_eod_snooze_chk
      check (end_of_day_snooze_minutes between 5 and 240);
  end if;
end $$;
comment on column public.workshop_planning_settings.end_of_day_prompt_minutes is 'Q57 : minutes laissees pour repondre a « Vous etes toujours la ? » avant la pause automatique (5).';
comment on column public.workshop_planning_settings.end_of_day_snooze_minutes is 'Q57 : « Oui, je continue » repousse la question de ce nombre de minutes (60).';

-- Decision du client : mode « question » pour ITALBIKE STORE (+ societe de test ItalTest).
do $$
declare c record; _old text;
begin
  for c in select id from public.companies
            where id in ('3d9f0f13-a691-4d07-ad58-34590df86e33', '5593d97e-69ad-43dd-8237-4ab8aa4e5c08')
  loop
    select s.auto_stop_mode into _old from public.workshop_planning_settings s where s.company_id = c.id;
    if _old is distinct from 'ask' then
      insert into public.workshop_planning_settings (company_id, auto_stop_mode) values (c.id, 'ask')
      on conflict (company_id) do update set auto_stop_mode = 'ask', updated_at = now();
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (c.id, null, 'workshop_auto_stop_mode', 'workshop_planning_settings', c.id::text, 'migration',
              jsonb_build_object('auto_stop_mode', coalesce(_old, 'off')),
              jsonb_build_object('auto_stop_mode', 'ask', 'decision', 'Q57 du 20/11/2026'));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Reponses a la question (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.workshop_end_of_day_answers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  time_entry_id        uuid references public.workshop_time_entries(id) on delete set null,
  mechanic_id          uuid references auth.users(id) on delete set null,     -- compte du pointage (vide = code mecano)
  mechanic_code        text,
  workshop_mechanic_id uuid references public.workshop_mechanics(id) on delete set null,
  work_date            date not null,                                          -- jour de Bruxelles du pointage
  asked_at             timestamptz not null,
  answer               text not null check (answer in ('continue', 'pause')),
  next_ask_at          timestamptz,
  answered_by          uuid references auth.users(id) on delete set null,     -- compte qui a repondu (tablette)
  answered_as          text,                                                   -- compagnon identifie (tablette partagee)
  created_at           timestamptz not null default now()
);
create index if not exists idx_eod_answers_lookup on public.workshop_end_of_day_answers(company_id, work_date, mechanic_id, mechanic_code);
comment on table public.workshop_end_of_day_answers is
  'Q57 : reponses a « Vous etes toujours la ? » (fin de journee). continue = question repoussee a next_ask_at pour tous les pointages du mecanicien ce jour-la ; pause = pointage mis en pause par le mecanicien. Append-only, ecrite par workshop_end_of_day_answer.';
alter table public.workshop_end_of_day_answers enable row level security;
drop policy if exists workshop_end_of_day_answers_select on public.workshop_end_of_day_answers;
create policy workshop_end_of_day_answers_select on public.workshop_end_of_day_answers for select
  using (coalesce((company_id in (select public.rls_member_companies())), false));
revoke insert, update, delete on public.workshop_end_of_day_answers from anon, authenticated;
grant select on public.workshop_end_of_day_answers to authenticated;

-- ---------------------------------------------------------------------
-- 3. Heure de la question
-- ---------------------------------------------------------------------
-- Fin de l'horaire le jour du pointage (sans le repli « minuit » de workshop_time_entry_day_end).
create or replace function public._wte_schedule_end(_entry uuid)
returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _local timestamp; _wm uuid; _end time; _name text;
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
  return (_local::date + _end) at time zone 'Europe/Brussels';
end $$;
revoke all on function public._wte_schedule_end(uuid) from public, anon, authenticated;

create or replace function public.workshop_time_entry_ask_at(_entry uuid)
returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _base timestamptz; _snooze timestamptz; _snooze_min int; _q timestamptz;
begin
  select * into e from public.workshop_time_entries where id = _entry;
  if not found then return null; end if;
  _base := public._wte_schedule_end(_entry);
  select coalesce((select s.end_of_day_snooze_minutes::int from public.workshop_planning_settings s where s.company_id = e.company_id), 60)
    into _snooze_min;
  select max(a.next_ask_at) into _snooze
    from public.workshop_end_of_day_answers a
   where a.company_id = e.company_id and a.answer = 'continue'
     and a.work_date = (e.started_at at time zone 'Europe/Brussels')::date
     and case when e.mechanic_code is not null then a.mechanic_code = e.mechanic_code
              else a.mechanic_id = e.mechanic_id and a.mechanic_code is null end;
  if e.started_at >= _base then
    -- Commence apres la fin de l'horaire : question un « report » apres le debut (ou plus tard).
    _q := greatest(e.started_at + make_interval(mins => _snooze_min), coalesce(_snooze, '-infinity'::timestamptz));
  else
    _q := greatest(_base, coalesce(_snooze, '-infinity'::timestamptz));
  end if;
  return _q;
end $$;
revoke all on function public.workshop_time_entry_ask_at(uuid) from public, anon;
grant execute on function public.workshop_time_entry_ask_at(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Arret automatique (lot A) : mode « ask » ajoute
-- ---------------------------------------------------------------------
create or replace function public.workshop_time_auto_stop(_company uuid default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare x record; _dl timestamptz; n integer := 0;
begin
  for x in
    select e.id, e.company_id, e.kind, s.auto_stop_mode as mode, s.end_of_day_prompt_minutes as prompt_min
      from public.workshop_time_entries e
      join public.workshop_planning_settings s on s.company_id = e.company_id and s.auto_stop_mode in ('end_of_schedule', 'ask')
     where e.ended_at is null
       and (_company is null or e.company_id = _company)
       -- Appel depuis l'application : seulement les societes de l'utilisateur. pg_cron : toutes.
       and (auth.uid() is null or public.can_write_table(e.company_id, 'workshop_time_entries'))
     order by e.started_at
     for update of e skip locked
  loop
    if x.mode = 'ask' and x.kind in ('travail', 'improductif') then
      _dl := public.workshop_time_entry_ask_at(x.id) + make_interval(mins => coalesce(x.prompt_min, 5));
      if _dl is not null and _dl <= now() then
        perform public._wte_close(x.id, 'auto_stop', 'fin_journee_auto', _dl, 'auto');
        n := n + 1;
      end if;
    else
      _dl := public.workshop_time_entry_day_end(x.id);
      if _dl is not null and _dl <= now() then
        perform public._wte_close(x.id, 'auto_stop', 'fin_journee', _dl, 'auto');
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.workshop_time_auto_stop(uuid) from public, anon;
grant execute on function public.workshop_time_auto_stop(uuid) to authenticated;

do $$
begin
  perform cron.unschedule('workshop-time-auto-stop');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('workshop-time-auto-stop', '*/5 * * * *', $cron$ select public.workshop_time_auto_stop(); $cron$);
exception when others then
  raise notice 'pg_cron : arret automatique non planifie : %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 5. Questions dues (lues par les ecrans) et reponse
-- ---------------------------------------------------------------------
-- Pointages ouverts de la societe dont la question est posee (mode « ask »). L'ecran garde les
-- siens : compte personnel = ses pointages ; tablette partagee = tous ceux de l'atelier.
create or replace function public.workshop_end_of_day_due(_company uuid)
returns table(entry_id uuid, kind text, or_id uuid, or_number text, task_code text, mechanic_id uuid, mechanic_code text,
              workshop_mechanic_id uuid, mechanic_name text, started_at timestamptz, ask_at timestamptz, pause_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare _prompt int;
begin
  if not public.is_member(_company) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workshop_planning_settings s where s.company_id = _company and s.auto_stop_mode = 'ask') then
    return;
  end if;
  select coalesce(s.end_of_day_prompt_minutes::int, 5) into _prompt from public.workshop_planning_settings s where s.company_id = _company;
  return query
  select q.id, q.kind, q.or_id, o.number, q.task_code, q.mechanic_id, q.mechanic_code, q.workshop_mechanic_id,
         coalesce(q.mechanic_name, q.mechanic_code), q.started_at, q.ask, q.ask + make_interval(mins => _prompt)
    from (select e.*, public.workshop_time_entry_ask_at(e.id) as ask
            from public.workshop_time_entries e
           where e.company_id = _company and e.ended_at is null and e.kind in ('travail', 'improductif')) q
    left join public.repair_orders o on o.id = q.or_id
   where q.ask <= now()
   order by q.ask, q.started_at;
end $$;
revoke all on function public.workshop_end_of_day_due(uuid) from public, anon;
grant execute on function public.workshop_end_of_day_due(uuid) to authenticated;

-- Reponse : par le mecanicien du pointage (son compte), par le compagnon identifie sur une
-- tablette partagee (_session), ou par l'administrateur / le chef d'atelier.
create or replace function public.workshop_end_of_day_answer(_entry uuid, _answer text, _session uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.workshop_time_entries%rowtype; s public.workshop_shared_sessions%rowtype;
  _ask timestamptz; _snooze int; _next timestamptz; _as text;
begin
  if _answer not in ('continue', 'pause') then raise exception 'Reponse inconnue : %.', _answer using errcode = '22023'; end if;
  select * into e from public.workshop_time_entries where id = _entry for update;
  if not found then raise exception 'Pointage introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(e.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if _session is not null then
    s := public._workshop_shared_session_use(_session);
    if not public._wte_is_of(e, s) then
      raise exception 'Ce pointage est celui de % : c''est a lui de repondre.', coalesce(e.mechanic_name, e.mechanic_code, '?') using errcode = '42501';
    end if;
    _as := s.mechanic_name;
  elsif not ((e.mechanic_id = auth.uid() and e.mechanic_code is null)
             or public.is_admin(e.company_id) or public.has_role(e.company_id, 'chef_atelier'::public.app_role)) then
    raise exception 'Ce pointage est celui de % : c''est a lui de repondre.', coalesce(e.mechanic_name, e.mechanic_code, '?') using errcode = '42501';
  end if;
  if e.ended_at is not null then
    return jsonb_build_object('status', 'already_closed', 'entry_id', e.id, 'stop_kind', e.stop_kind, 'ended_at', e.ended_at);
  end if;

  _ask := public.workshop_time_entry_ask_at(e.id);
  if _answer = 'continue' then
    select coalesce((select st.end_of_day_snooze_minutes::int from public.workshop_planning_settings st where st.company_id = e.company_id), 60)
      into _snooze;
    _next := now() + make_interval(mins => _snooze);
    insert into public.workshop_end_of_day_answers (company_id, time_entry_id, mechanic_id, mechanic_code, workshop_mechanic_id,
                                                    work_date, asked_at, answer, next_ask_at, answered_by, answered_as)
    values (e.company_id, e.id, case when e.mechanic_code is null then e.mechanic_id end, e.mechanic_code, e.workshop_mechanic_id,
            (e.started_at at time zone 'Europe/Brussels')::date, _ask, 'continue', _next, auth.uid(), _as);
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (e.company_id, auth.uid(), 'workshop_end_of_day_continue',
            case when e.or_id is not null then 'repair_orders' else 'workshop_time_entries' end, coalesce(e.or_id, e.id)::text,
            case when _session is not null then 'tablet' else 'screen' end,
            jsonb_build_object('asked_at', _ask),
            jsonb_build_object('time_entry_id', e.id, 'next_ask_at', _next, 'mechanic', coalesce(e.mechanic_name, e.mechanic_code),
                               'answered_as', _as, 'from_account', auth.uid()));
    return jsonb_build_object('status', 'continue', 'entry_id', e.id, 'next_ask_at', _next);
  end if;

  insert into public.workshop_end_of_day_answers (company_id, time_entry_id, mechanic_id, mechanic_code, workshop_mechanic_id,
                                                  work_date, asked_at, answer, answered_by, answered_as)
  values (e.company_id, e.id, case when e.mechanic_code is null then e.mechanic_id end, e.mechanic_code, e.workshop_mechanic_id,
          (e.started_at at time zone 'Europe/Brussels')::date, _ask, 'pause', auth.uid(), _as);
  e := public._wte_close(e.id, 'pause', 'fin_journee', now(), case when _session is not null then 'tablet' else 'screen' end);
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (e.company_id, auth.uid(), 'workshop_end_of_day_pause',
          case when e.or_id is not null then 'repair_orders' else 'workshop_time_entries' end, coalesce(e.or_id, e.id)::text,
          case when _session is not null then 'tablet' else 'screen' end,
          jsonb_build_object('asked_at', _ask),
          jsonb_build_object('time_entry_id', e.id, 'minutes', e.minutes, 'mechanic', coalesce(e.mechanic_name, e.mechanic_code),
                             'answered_as', _as, 'from_account', auth.uid()));
  return jsonb_build_object('status', 'paused', 'entry_id', e.id, 'minutes', e.minutes);
end $$;
revoke all on function public.workshop_end_of_day_answer(uuid, text, uuid) from public, anon;
grant execute on function public.workshop_end_of_day_answer(uuid, text, uuid) to authenticated;
