-- M3 (Simon, 23/11/2026) : certification des fiches moto par le DCS.
--  1. vehicle_maintenance garde les trois tableaux du DCS, historique de garantie compris.
--  2. vehicle_field_status : statut de chaque champ (certifié, à trancher...).
--  3. Le portail client ne montre pas l'historique de garantie (lignes jusqu'ici jamais enregistrées).
--  4. dcs_import_commit : écrit tout l'import en UNE transaction ; une erreur annule tout et rien
--     de l'existant n'est supprimé avant que les insertions aient réussi.

-- 1. Événements DCS : colonnes qui n'étaient conservées que dans le JSON brut.
alter table public.vehicle_maintenance
  add column if not exists event_category text,  -- colonne « Événement » : Maintenance, Garantie, Checklist
  add column if not exists reference      text,
  add column if not exists symptom        text,
  add column if not exists cause          text;

-- 2. Statut par champ.
create table if not exists public.vehicle_field_status (
  company_id     uuid not null references public.companies(id) on delete restrict,
  vehicle_id     uuid not null references public.vehicles(id) on delete cascade,
  field          text not null,
  status         text not null check (status in ('certifie', 'carte_grise', 'catalogue', 'saisi', 'conflit')),
  dcs_value      text,
  previous_value text,
  source         text,
  updated_at     timestamptz not null default now(),
  primary key (vehicle_id, field)
);
create index if not exists idx_vehicle_field_status_company on public.vehicle_field_status(company_id, status);

alter table public.vehicle_field_status enable row level security;
drop policy if exists vehicle_field_status_all on public.vehicle_field_status;
create policy vehicle_field_status_all on public.vehicle_field_status for all to authenticated
  using (coalesce(company_id in (select public.rls_member_companies()), false))
  with check (coalesce(company_id in (select public.rls_member_companies()), false));
revoke all on public.vehicle_field_status from public, anon;
grant select, insert, update, delete on public.vehicle_field_status to authenticated;

-- Un statut porte toujours la société de sa moto.
create or replace function public._vehicle_field_status_company()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'Statut de champ : société différente de celle de la moto' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public._vehicle_field_status_company() from public, anon;
drop trigger if exists trg_vehicle_field_status_company on public.vehicle_field_status;
create trigger trg_vehicle_field_status_company before insert or update on public.vehicle_field_status
  for each row execute function public._vehicle_field_status_company();

-- 3. Portail client : l'historique de garantie (remboursements, défauts) reste interne.
do $$
declare
  def text;
  clause constant text := 'where m.vehicle_id = v.id and m.company_id = _ctx.company_id';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'portal_vehicle';
  if def is null or position(clause in def) = 0 then
    raise exception 'portal_vehicle : clause des entretiens introuvable, migration à revoir';
  end if;
  if position('event_category' in def) = 0 then
    execute replace(def, clause, clause || ' and coalesce(lower(m.event_category), '''') <> ''garantie''');
  end if;
end $$;

-- 4. Écriture de l'import.
create or replace function public.dcs_import_commit(
  _company uuid,
  _vehicle uuid,
  _vin text,
  _changes jsonb,
  _statuses jsonb,
  _raw jsonb,
  _maintenance jsonb default '[]'::jsonb,
  _maintenance_tables text[] default '{}',
  _bulletins jsonb default '[]'::jsonb,
  _contact uuid default null,
  _contact_patch jsonb default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  allowed constant jsonb := '{
    "model":"text","ducati_model_year_id":"text","engine_number":"text","plate":"text","color":"text",
    "origin":"text","mileage":"integer","production_date":"date","ship_date":"date","warranty_start":"date",
    "warranty_end":"date","warranty_type":"text","warranty_state":"text","warranty_activated_by":"text",
    "invoiced_to":"text","ducati_state":"text","ducati_usage":"text"
  }'::jsonb;
  contact_allowed constant jsonb := '{
    "my_ducati_first_name":"text","my_ducati_last_name":"text","my_ducati_email":"text","my_ducati_phone":"text",
    "my_ducati_city":"text","my_ducati_country":"text","my_ducati_marketing":"boolean","my_ducati_profiling":"boolean",
    "my_ducati_is_current_owner":"boolean","my_ducati_score":"integer"
  }'::jsonb;
  cur jsonb;
  c jsonb;
  f text;
  patch jsonb := '{}'::jsonb;
  clauses text;
  ids text[];
  n_events integer := 0;
  n_bulletins integer := 0;
begin
  if auth.uid() is not null and not public.is_member(_company) then
    raise exception 'dcs_forbidden' using errcode = '42501';
  end if;

  select to_jsonb(v) into cur from public.vehicles v
   where v.id = _vehicle and v.company_id = _company for update;
  if cur is null then raise exception 'dcs_vehicle_not_found'; end if;
  if upper(coalesce(cur->>'vin', '')) <> upper(coalesce(_vin, '')) then raise exception 'dcs_vin_mismatch'; end if;

  -- Champs : la valeur lue avant l'import doit être encore en place, sinon tout est annulé.
  for c in select * from jsonb_array_elements(coalesce(_changes, '[]'::jsonb)) loop
    f := c->>'field';
    if not allowed ? f then raise exception 'dcs_field_not_allowed: %', f; end if;
    if c->>'action' not in ('filled', 'replaced') then raise exception 'dcs_bad_action'; end if;
    if nullif(cur->>f, '') is distinct from nullif(c->>'old', '') then raise exception 'dcs_stale: %', f; end if;
    patch := patch || jsonb_build_object(f, c->>'new');
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'dcs_field_' || (c->>'action'), 'vehicles', _vehicle::text, 'dcs',
            jsonb_build_object(f, c->'old'), jsonb_build_object(f, c->'new'));
  end loop;

  -- Seules les colonnes réellement modifiées sont écrites (les déclencheurs par colonne restent muets).
  select string_agg(format('%I = ($1->>%L)::%s', k, k, allowed->>k), ', ') into clauses
    from jsonb_object_keys(patch) k;
  execute format('update public.vehicles set %s my_ducati_data = $2, my_ducati_synced_at = now() where id = $3',
                 case when clauses is null then '' else clauses || ', ' end)
    using patch, _raw, _vehicle;

  insert into public.vehicle_field_status (company_id, vehicle_id, field, status, dcs_value, previous_value, source)
  select _company, _vehicle, s.field, s.status, s.dcs_value, s.previous_value, coalesce(s.source, 'dcs')
    from jsonb_to_recordset(coalesce(_statuses, '[]'::jsonb))
      as s(field text, status text, dcs_value text, previous_value text, source text)
   where s.field is not null
  on conflict (vehicle_id, field) do update
    set status = excluded.status, dcs_value = excluded.dcs_value,
        previous_value = excluded.previous_value, source = excluded.source, updated_at = now();

  -- Événements : insertion ou mise à jour d'abord, sans doublon (index uq_veh_maint_event).
  insert into public.vehicle_maintenance
    (company_id, vehicle_id, kind, event_category, service_type, reference, state, symptom, cause, km, event_date, due_date, dealer, ducati_event_id)
  select distinct on (r.ducati_event_id)
         _company, _vehicle, r.kind, r.event_category, r.service_type, r.reference, r.state, r.symptom, r.cause,
         r.km, r.event_date, r.due_date, r.dealer, r.ducati_event_id
    from jsonb_to_recordset(coalesce(_maintenance, '[]'::jsonb))
      as r(kind text, event_category text, service_type text, reference text, state text, symptom text, cause text,
           km integer, event_date date, due_date date, dealer text, ducati_event_id text)
   where r.ducati_event_id is not null and r.kind in ('upcoming', 'current', 'past')
   order by r.ducati_event_id, case r.kind when 'past' then 0 when 'current' then 1 else 2 end
  on conflict (vehicle_id, ducati_event_id) where ducati_event_id is not null do update
    set kind = excluded.kind, event_category = excluded.event_category, service_type = excluded.service_type,
        reference = excluded.reference, state = excluded.state, symptom = excluded.symptom, cause = excluded.cause,
        km = excluded.km, event_date = excluded.event_date, due_date = excluded.due_date, dealer = excluded.dealer;
  get diagnostics n_events = row_count;

  -- Puis seulement : retire les « à venir / en cours » disparus d'un tableau bien lu. Le passé reste.
  select coalesce(array_agg(x->>'ducati_event_id'), '{}') into ids
    from jsonb_array_elements(coalesce(_maintenance, '[]'::jsonb)) x;
  delete from public.vehicle_maintenance m
   where m.vehicle_id = _vehicle and m.ducati_event_id is not null
     and m.kind in ('upcoming', 'current') and m.kind = any(coalesce(_maintenance_tables, '{}'))
     and not (m.ducati_event_id = any(ids));

  -- Bulletins : jamais de suppression, le PDF déjà rapatrié (storage_path) est conservé.
  insert into public.vehicle_bulletins as b (company_id, vehicle_id, bulletin_id, title, number, published_at, url)
  select distinct on (r.bulletin_id) _company, _vehicle, r.bulletin_id, r.title, r.number, r.published_at, r.url
    from jsonb_to_recordset(coalesce(_bulletins, '[]'::jsonb))
      as r(bulletin_id text, title text, number text, published_at date, url text)
   where r.bulletin_id is not null
   order by r.bulletin_id
  on conflict (vehicle_id, bulletin_id) where bulletin_id is not null do update
    set title = coalesce(excluded.title, b.title), number = coalesce(excluded.number, b.number),
        published_at = coalesce(excluded.published_at, b.published_at), url = coalesce(excluded.url, b.url);
  get diagnostics n_bulletins = row_count;

  -- Client : uniquement les champs my_ducati_*, et seulement sur le propriétaire actuel de cette moto.
  if _contact is not null and _contact_patch is not null then
    if not exists (select 1 from public.vehicle_owners o join public.contacts ct on ct.id = o.contact_id
                    where o.vehicle_id = _vehicle and o.contact_id = _contact and o.is_current and ct.company_id = _company) then
      raise exception 'dcs_owner_changed';
    end if;
    select string_agg(format('%I = ($1->>%L)::%s', k, k, contact_allowed->>k), ', ') into clauses
      from jsonb_object_keys(_contact_patch) k where contact_allowed ? k;
    execute format('update public.contacts set %s my_ducati_data = case when $1 ? ''my_ducati_data'' then coalesce(my_ducati_data, ''{}''::jsonb) || ($1->''my_ducati_data'') else my_ducati_data end, my_ducati_synced_at = now() where id = $2',
                   case when clauses is null then '' else clauses || ', ' end)
      using _contact_patch, _contact;
  end if;

  return jsonb_build_object('events', n_events, 'bulletins', n_bulletins, 'changes', jsonb_array_length(coalesce(_changes, '[]'::jsonb)));
end $$;

revoke all on function public.dcs_import_commit(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text[], jsonb, uuid, jsonb) from public, anon;
grant execute on function public.dcs_import_commit(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text[], jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
