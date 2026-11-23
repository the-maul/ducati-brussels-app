-- M3 VEH001: nightly DCS certification of the fleet, driven by the browser extension.
-- The queue and the run state live here so that the safety rules (ITALBIKE only, 22:00-08:00
-- Brussels time, 10-bike pilot, stop after 3 failures) hold even if the extension misbehaves.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.dcs_certification_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  vin text not null check (vin ~ '^ZDM[A-HJ-NPR-Z0-9]{14}$'),
  priority smallint not null check (priority in (1, 2, 3)),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  last_error text,
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, vehicle_id)
);
comment on table public.dcs_certification_queue is 'Motos a certifier la nuit par l''extension DCS. Ecriture uniquement par les fonctions dcs_night_*.';

create index if not exists idx_dcs_certification_queue_next
  on public.dcs_certification_queue (company_id, priority, attempts, vin) where status = 'pending';
create index if not exists idx_dcs_certification_queue_processed
  on public.dcs_certification_queue (company_id, processed_at desc) where processed_at is not null;
-- A single bike in progress per company, enforced by the database.
create unique index if not exists uq_dcs_certification_queue_processing
  on public.dcs_certification_queue (company_id) where status = 'processing';

create table if not exists public.dcs_certification_runs (
  company_id uuid primary key references public.companies(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'pilot_wait', 'paused', 'finished')),
  pause_reason text,
  pilot_limit smallint not null default 10 check (pilot_limit > 0),
  pilot_approved_at timestamptz,
  pilot_approved_by uuid,
  consecutive_failures smallint not null default 0,
  started_at timestamptz not null default now(),
  started_by uuid,
  updated_at timestamptz not null default now()
);
comment on table public.dcs_certification_runs is 'Etat de la tournee de nuit DCS, une ligne par societe.';

alter table public.dcs_certification_queue enable row level security;
alter table public.dcs_certification_runs enable row level security;

drop policy if exists dcs_certification_queue_select on public.dcs_certification_queue;
create policy dcs_certification_queue_select on public.dcs_certification_queue for select
  using (public.is_admin(company_id));
drop policy if exists dcs_certification_runs_select on public.dcs_certification_runs;
create policy dcs_certification_runs_select on public.dcs_certification_runs for select
  using (public.is_admin(company_id));

revoke all on public.dcs_certification_queue from public, anon, authenticated;
revoke all on public.dcs_certification_runs from public, anon, authenticated;
grant select on public.dcs_certification_queue to authenticated;
grant select on public.dcs_certification_runs to authenticated;

-- Audit trail: run creation and every state change (not each per-bike counter update).
drop trigger if exists trg_dcs_certification_runs_audit_insert on public.dcs_certification_runs;
create trigger trg_dcs_certification_runs_audit_insert after insert on public.dcs_certification_runs
  for each row execute function public.audit_row();
drop trigger if exists trg_dcs_certification_runs_audit_update on public.dcs_certification_runs;
create trigger trg_dcs_certification_runs_audit_update after update on public.dcs_certification_runs
  for each row when (old.status is distinct from new.status or old.pilot_approved_at is distinct from new.pilot_approved_at)
  execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 2. Rules
-- ---------------------------------------------------------------------
-- 3 319 VINs also exist in the ItalTest company: the run is limited to the real ITALBIKE company.
create or replace function public.dcs_night_allowed(_company uuid)
returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $$
  select _company = '3d9f0f13-a691-4d07-ad58-34590df86e33'::uuid;
$$;

-- Wall-clock test, so it stays right across daylight saving changes and midnight.
create or replace function public.dcs_night_in_window(_at timestamptz)
returns boolean language sql stable set search_path to 'public', 'pg_temp' as $$
  select extract(hour from (_at at time zone 'Europe/Brussels'))::int >= 22
      or extract(hour from (_at at time zone 'Europe/Brussels'))::int < 8;
$$;

create or replace function public._dcs_night_guard(_company uuid)
returns void language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.is_admin(_company) then
    raise exception 'dcs_night: admin only' using errcode = '42501';
  end if;
  if not public.dcs_night_allowed(_company) then
    raise exception 'dcs_night: company not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public._dcs_night_error_code(_error text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case when _error in (
    'timeout', 'vin_mismatch', 'no_data', 'not_found', 'refused', 'apply_error', 'dms_error',
    'tab_closed', 'tab_error', 'invalid_vin', 'stale', 'session_expired', 'company_mismatch', 'window_closed'
  ) then _error else 'error' end;
$$;

-- Records the outcome of the bike in progress. The caller holds the run row lock.
create or replace function public._dcs_night_record(_company uuid, _queue uuid, _ok boolean, _error text, _at timestamptz)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  q public.dcs_certification_queue%rowtype;
  code text;
begin
  select * into q from public.dcs_certification_queue
   where id = _queue and company_id = _company and status = 'processing' for update;
  if not found then return; end if;

  if _ok then
    update public.dcs_certification_queue
       set status = 'done', processed_at = _at, last_error = null, claimed_at = null, updated_at = now()
     where id = q.id;
    update public.dcs_certification_runs set consecutive_failures = 0, updated_at = now() where company_id = _company;
    return;
  end if;

  code := public._dcs_night_error_code(_error);

  -- Not the bike's fault: the attempt is given back.
  if code in ('session_expired', 'company_mismatch', 'window_closed') then
    update public.dcs_certification_queue
       set status = 'pending', attempts = greatest(attempts - 1, 0), last_error = code, claimed_at = null, updated_at = now()
     where id = q.id;
    if code <> 'window_closed' then
      update public.dcs_certification_runs
         set status = 'paused', pause_reason = code, updated_at = now()
       where company_id = _company and status = 'running';
    end if;
    return;
  end if;

  -- One try plus two retries, then the bike is marked as failed.
  update public.dcs_certification_queue
     set status = case when q.attempts >= 3 then 'failed' else 'pending' end,
         processed_at = case when q.attempts >= 3 then _at else null end,
         last_error = code, claimed_at = null, updated_at = now()
   where id = q.id;
  update public.dcs_certification_runs
     set consecutive_failures = consecutive_failures + 1,
         status = case when status = 'running' and consecutive_failures + 1 >= 3 then 'paused' else status end,
         pause_reason = case when status = 'running' and consecutive_failures + 1 >= 3 then 'failures' else pause_reason end,
         updated_at = now()
   where company_id = _company;
end $$;

-- ---------------------------------------------------------------------
-- 3. Filling the queue
-- ---------------------------------------------------------------------
create or replace function public._dcs_night_fill(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  since timestamptz := now() - interval '24 months';
  added int;
  total int;
begin
  with unique_vins as (
    -- A VIN held by two records cannot be imported safely: both are left out.
    select v.vin from public.vehicles v where v.company_id = _company and v.vin is not null
    group by v.vin having count(*) = 1
  ), candidates as (
    select v.id, v.vin, v.sold_date from public.vehicles v
      join unique_vins u on u.vin = v.vin
     where v.company_id = _company and v.is_active and v.vin ~ '^ZDM[A-HJ-NPR-Z0-9]{14}$'
  ), open_visits as (
    select a.vehicle_id from public.workshop_appointments a
     where a.company_id = _company and a.vehicle_id is not null
       and a.status in ('demande', 'prevu', 'arrive', 'en_cours', 'attente')
    union
    select o.vehicle_id from public.repair_orders o
     where o.company_id = _company and o.vehicle_id is not null and o.status not in ('facture', 'annule')
  ), recent_visits as (
    select o.vehicle_id from public.repair_orders o
     where o.company_id = _company and o.vehicle_id is not null and o.status <> 'annule' and o.created_at >= since
    union
    select a.vehicle_id from public.workshop_appointments a
     where a.company_id = _company and a.vehicle_id is not null and a.status <> 'annule'
       and a.starts_at >= since and a.starts_at <= now()
    union
    select h.vehicle_id from public.vehicle_service_history h
     where h.company_id = _company and h.event_date >= since::date
    union
    -- Invoices imported from G8 carry no repair order: any invoice on the bike counts,
    -- except the sale of the bike itself.
    select d.vehicle_id from public.documents d
      join candidates c on c.id = d.vehicle_id
     where d.company_id = _company and d.doc_type = 'FAC' and d.issue_date >= since::date
       and d.issue_date is distinct from c.sold_date
       and not exists (
         select 1 from public.document_lines l join public.articles art on art.id = l.article_id
          where l.document_id = d.id and art.mgmt_type::text in ('V', 'O', 'P', 'D', 'R')
       )
  ), upserted as (
    insert into public.dcs_certification_queue as q (company_id, vehicle_id, vin, priority)
    select _company, c.id, c.vin,
           case when c.id in (select vehicle_id from open_visits) then 1
                when c.id in (select vehicle_id from recent_visits) then 2
                else 3 end
      from candidates c
    on conflict (company_id, vehicle_id) do update
      set priority = excluded.priority, vin = excluded.vin, updated_at = now()
      where q.status = 'pending' and (q.priority <> excluded.priority or q.vin <> excluded.vin)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into added from upserted;

  select count(*) into total from public.dcs_certification_queue where company_id = _company;
  return jsonb_build_object('added', added, 'total', total);
end $$;

-- ---------------------------------------------------------------------
-- 4. Status (settings page)
-- ---------------------------------------------------------------------
create or replace function public.dcs_night_status(_company uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  r public.dcs_certification_runs%rowtype;
  counts jsonb;
  last_row jsonb;
begin
  if not public.is_admin(_company) then
    raise exception 'dcs_night: admin only' using errcode = '42501';
  end if;
  if not public.dcs_night_allowed(_company) then
    return jsonb_build_object('eligible', false);
  end if;

  select * into r from public.dcs_certification_runs where company_id = _company;

  select jsonb_build_object(
           'total', count(*),
           'done', count(*) filter (where status = 'done'),
           'failed', count(*) filter (where status = 'failed'),
           'remaining', count(*) filter (where status in ('pending', 'processing')),
           'touched', count(*) filter (where attempts > 0)
         ) into counts
    from public.dcs_certification_queue where company_id = _company;

  select jsonb_build_object('vin', q.vin, 'status', q.status, 'last_error', q.last_error, 'processed_at', q.processed_at)
    into last_row
    from public.dcs_certification_queue q
   where q.company_id = _company and q.processed_at is not null
   order by q.processed_at desc limit 1;

  return jsonb_build_object(
    'eligible', true,
    'in_window', public.dcs_night_in_window(now()),
    'run', case when r.company_id is null then null else jsonb_build_object(
      'status', r.status, 'pause_reason', r.pause_reason, 'pilot_limit', r.pilot_limit,
      'pilot_approved', r.pilot_approved_at is not null, 'consecutive_failures', r.consecutive_failures
    ) end,
    'counts', counts,
    'last', last_row
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. Commands (admin buttons)
-- ---------------------------------------------------------------------
create or replace function public.dcs_night_start(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._dcs_night_guard(_company);
  insert into public.dcs_certification_runs (company_id, started_by)
  values (_company, auth.uid()) on conflict (company_id) do nothing;
  perform 1 from public.dcs_certification_runs where company_id = _company for update;
  perform public._dcs_night_fill(_company);
  -- A finished run can be started again for bikes added since. The pilot is not asked twice.
  update public.dcs_certification_runs
     set status = 'running', pause_reason = null, consecutive_failures = 0, updated_at = now()
   where company_id = _company and status = 'finished'
     and exists (select 1 from public.dcs_certification_queue q where q.company_id = _company and q.status = 'pending');
  return public.dcs_night_status(_company);
end $$;

create or replace function public.dcs_night_pause(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._dcs_night_guard(_company);
  perform 1 from public.dcs_certification_runs where company_id = _company for update;
  update public.dcs_certification_queue
     set status = 'pending', attempts = greatest(attempts - 1, 0), claimed_at = null, updated_at = now()
   where company_id = _company and status = 'processing';
  update public.dcs_certification_runs
     set status = 'paused', pause_reason = 'manual', updated_at = now()
   where company_id = _company and status = 'running';
  return public.dcs_night_status(_company);
end $$;

create or replace function public.dcs_night_resume(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._dcs_night_guard(_company);
  update public.dcs_certification_runs
     set status = 'running', pause_reason = null, consecutive_failures = 0, updated_at = now()
   where company_id = _company and status = 'paused';
  return public.dcs_night_status(_company);
end $$;

-- The only way past the pilot: an administrator's explicit click.
create or replace function public.dcs_night_approve_pilot(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._dcs_night_guard(_company);
  update public.dcs_certification_runs
     set status = 'running', pause_reason = null, consecutive_failures = 0,
         pilot_approved_at = now(), pilot_approved_by = auth.uid(), updated_at = now()
   where company_id = _company and status = 'pilot_wait';
  return public.dcs_night_status(_company);
end $$;

-- ---------------------------------------------------------------------
-- 6. Extension calls: next bike, result
-- ---------------------------------------------------------------------
-- _at is a parameter so the window can be tested; only dcs_night_next is exposed.
create or replace function public._dcs_night_next_at(_company uuid, _at timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  r public.dcs_certification_runs%rowtype;
  q public.dcs_certification_queue%rowtype;
  gated boolean;
begin
  select * into r from public.dcs_certification_runs where company_id = _company for update;
  if not found then return jsonb_build_object('state', 'wait', 'reason', 'not_started'); end if;
  if r.status <> 'running' then
    return jsonb_build_object('state', 'wait', 'reason', r.status, 'pause_reason', r.pause_reason);
  end if;
  if not public.dcs_night_in_window(_at) then
    return jsonb_build_object('state', 'wait', 'reason', 'outside_window');
  end if;

  -- One bike at a time. A claim left behind (Chrome closed mid-read) counts as a failed attempt.
  select * into q from public.dcs_certification_queue
   where company_id = _company and status = 'processing' for update;
  if found then
    if q.claimed_at > _at - interval '10 minutes' then
      return jsonb_build_object('state', 'wait', 'reason', 'busy');
    end if;
    perform public._dcs_night_record(_company, q.id, false, 'stale', _at);
    select * into r from public.dcs_certification_runs where company_id = _company;
    if r.status <> 'running' then
      return jsonb_build_object('state', 'wait', 'reason', r.status, 'pause_reason', r.pause_reason);
    end if;
  end if;

  loop
    -- Pilot: once 10 different bikes were tried, only their retries may still go out.
    gated := r.pilot_approved_at is null and (
      select count(*) >= r.pilot_limit from public.dcs_certification_queue
       where company_id = _company and attempts > 0
    );

    select * into q from public.dcs_certification_queue
     where company_id = _company and status = 'pending' and (not gated or attempts > 0)
     order by priority, attempts, vin
     limit 1 for update;

    if not found then
      if gated then
        update public.dcs_certification_runs set status = 'pilot_wait', updated_at = now() where company_id = _company;
        return jsonb_build_object('state', 'wait', 'reason', 'pilot_wait');
      end if;
      update public.dcs_certification_runs set status = 'finished', updated_at = now() where company_id = _company;
      return jsonb_build_object('state', 'wait', 'reason', 'finished');
    end if;

    -- The record may have changed since the queue was filled.
    if exists (
      select 1 from public.vehicles v
       where v.id = q.vehicle_id and v.company_id = _company and v.vin = q.vin and v.is_active
         and (select count(*) from public.vehicles d where d.company_id = _company and d.vin = q.vin) = 1
    ) then
      exit;
    end if;
    update public.dcs_certification_queue
       set status = 'failed', last_error = 'invalid_vin', processed_at = _at, updated_at = now()
     where id = q.id;
  end loop;

  update public.dcs_certification_queue
     set status = 'processing', attempts = attempts + 1, claimed_at = _at, updated_at = now()
   where id = q.id;
  return jsonb_build_object('state', 'go', 'item', jsonb_build_object(
    'id', q.id, 'vehicle_id', q.vehicle_id, 'vin', q.vin, 'attempt', q.attempts + 1
  ));
end $$;

create or replace function public.dcs_night_next(_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public._dcs_night_guard(_company);
  return public._dcs_night_next_at(_company, now());
end $$;

create or replace function public.dcs_night_mark(_company uuid, _queue uuid, _ok boolean, _error text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  r public.dcs_certification_runs%rowtype;
begin
  perform public._dcs_night_guard(_company);
  perform 1 from public.dcs_certification_runs where company_id = _company for update;
  perform public._dcs_night_record(_company, _queue, _ok, _error, now());
  select * into r from public.dcs_certification_runs where company_id = _company;
  return jsonb_build_object('run_status', r.status, 'pause_reason', r.pause_reason);
end $$;

-- ---------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------
revoke all on function public._dcs_night_guard(uuid) from public, anon, authenticated;
revoke all on function public._dcs_night_error_code(text) from public, anon, authenticated;
revoke all on function public._dcs_night_record(uuid, uuid, boolean, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dcs_night_fill(uuid) from public, anon, authenticated;
revoke all on function public._dcs_night_next_at(uuid, timestamptz) from public, anon, authenticated;

revoke all on function public.dcs_night_allowed(uuid) from public, anon;
revoke all on function public.dcs_night_in_window(timestamptz) from public, anon;
revoke all on function public.dcs_night_status(uuid) from public, anon;
revoke all on function public.dcs_night_start(uuid) from public, anon;
revoke all on function public.dcs_night_pause(uuid) from public, anon;
revoke all on function public.dcs_night_resume(uuid) from public, anon;
revoke all on function public.dcs_night_approve_pilot(uuid) from public, anon;
revoke all on function public.dcs_night_next(uuid) from public, anon;
revoke all on function public.dcs_night_mark(uuid, uuid, boolean, text) from public, anon;

grant execute on function public.dcs_night_allowed(uuid) to authenticated;
grant execute on function public.dcs_night_in_window(timestamptz) to authenticated;
grant execute on function public.dcs_night_status(uuid) to authenticated;
grant execute on function public.dcs_night_start(uuid) to authenticated;
grant execute on function public.dcs_night_pause(uuid) to authenticated;
grant execute on function public.dcs_night_resume(uuid) to authenticated;
grant execute on function public.dcs_night_approve_pilot(uuid) to authenticated;
grant execute on function public.dcs_night_next(uuid) to authenticated;
grant execute on function public.dcs_night_mark(uuid, uuid, boolean, text) to authenticated;
