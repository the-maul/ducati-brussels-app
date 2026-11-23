-- M3 VEH001 (Simon, 23/11/2026) : les données lues au DCS deviennent exploitables sur la fiche moto.
--  1. vehicle_dcs_client : le client lu au DCS pour cette moto (interne, jamais exposé au portail).
--  2. dcs_import_complete : après l'import, conserve ce client et complète les champs vides depuis
--     le catalogue, uniquement si le modèle-année est certain (jamais d'année voisine).
--  3. dcs_resolve_field : trancher un écart en un clic (liste fermée, tracé dans events).
--  4. dcs_client_matches / dcs_client_attach / dcs_client_create_attach : retrouver, attribuer ou
--     créer le client, toujours sur clic, sans toucher aux coordonnées d'une fiche existante.
-- Additive et rejouable. dcs_import_commit n'est pas modifiée : un front publié avant cette
-- migration continue d'importer normalement.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1. Client lu au DCS
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_dcs_client (
  vehicle_id   uuid primary key references public.vehicles(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete restrict,
  full_name    text,
  first_name   text,
  last_name    text,
  email        text,
  mobile       text,
  address      text,
  postal_code  text,
  city         text,
  region       text,
  country      text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  birth_date   date,
  ducati_code  text,
  read_at      timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.vehicle_dcs_client is
  'Client lu au DCS pour une moto. Donnée interne : aucune fonction du portail client ne la lit. Écriture uniquement par dcs_import_complete. Aucun consentement marketing n''y est conservé.';
create index if not exists idx_vehicle_dcs_client_company on public.vehicle_dcs_client(company_id);

alter table public.vehicle_dcs_client enable row level security;
drop policy if exists vehicle_dcs_client_select on public.vehicle_dcs_client;
create policy vehicle_dcs_client_select on public.vehicle_dcs_client for select to authenticated
  using (coalesce(company_id in (select public.rls_member_companies()), false));
revoke all on public.vehicle_dcs_client from public, anon, authenticated;
grant select on public.vehicle_dcs_client to authenticated;

-- ---------------------------------------------------------------------
-- 2. Outils internes
-- ---------------------------------------------------------------------
create or replace function public._dcs_is_blank(_v text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select _v is null or btrim(_v) in ('', '-', '?', '/');
$$;
revoke all on function public._dcs_is_blank(text) from public, anon, authenticated;

create or replace function public._dcs_clean(_v text, _max integer default 200)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when public._dcs_is_blank(_v) then null
              else left(regexp_replace(btrim(_v), '\s+', ' ', 'g'), _max) end;
$$;
revoke all on function public._dcs_clean(text, integer) from public, anon, authenticated;

create or replace function public._dcs_safe_date(_v text)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if _v is null or _v !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return _v::date;
exception when others then
  return null;
end $$;
revoke all on function public._dcs_safe_date(text) from public, anon, authenticated;

-- Même exigence que l'écriture directe sur vehicles : membre actif avec droit d'écriture.
create or replace function public._dcs_write_guard(_company uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_member(_company) or not public.can_write_table(_company, 'vehicles') then
    raise exception 'dcs_forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function public._dcs_write_guard(uuid) from public, anon, authenticated;

-- Champs vides connus du catalogue pour CE modèle-année, si le modèle est certain.
create or replace function public._dcs_catalog_fill(_company uuid, _vehicle uuid)
returns text[] language plpgsql security definer set search_path = public, pg_temp as $$
declare
  types constant jsonb := '{"displacement":"numeric","power_cv":"numeric","power_kw":"numeric","cylinders":"integer",
                            "antipollution":"text","energy":"text","category":"text","model_year":"integer"}'::jsonb;
  cur jsonb;
  my text;
  sp record;
  known jsonb := '{}'::jsonb;
  vals jsonb := '{}'::jsonb;
  k text;
  clauses text;
  done text[] := '{}';
begin
  select to_jsonb(v) into cur from public.vehicles v
   where v.id = _vehicle and v.company_id = _company for update;
  if cur is null then return done; end if;
  my := cur->>'ducati_model_year_id';
  if my is null then return done; end if;

  -- Certain = certifié par le DCS, ou choisi explicitement par un utilisateur.
  if not exists (
    select 1 from public.vehicle_field_status s
     where s.vehicle_id = _vehicle and s.field = 'ducati_model_year_id' and s.dcs_value = my
       and (s.status = 'certifie' or (s.status = 'saisi' and s.source = 'decision'))
  ) then
    return done;
  end if;

  select y.year, f.description as family, sp2.displacement_cc, sp2.power_cv, sp2.power_kw, sp2.cylinders, sp2.euro
    into sp
    from public.ducati_catalog_model_years y
    left join public.ducati_catalog_models m on m.id = y.model_id
    left join public.ducati_catalog_families f on f.id = m.family_id
    left join public.ducati_vin_model_specs sp2 on sp2.model_year_id = y.id
   where y.id = my
   limit 1;
  if not found then return done; end if;

  if sp.displacement_cc > 0 then
    known := known || jsonb_build_object('displacement', sp.displacement_cc, 'energy', 'Essence');
  end if;
  -- Une moto bridée garde sa puissance à saisir.
  if coalesce((cur->>'is_restricted')::boolean, false) is false then
    if sp.power_cv > 0 then known := known || jsonb_build_object('power_cv', sp.power_cv); end if;
    if sp.power_kw > 0 then known := known || jsonb_build_object('power_kw', sp.power_kw); end if;
  end if;
  if sp.cylinders > 0 then known := known || jsonb_build_object('cylinders', sp.cylinders); end if;
  if not public._dcs_is_blank(sp.euro) then known := known || jsonb_build_object('antipollution', sp.euro); end if;
  if not public._dcs_is_blank(sp.family) then known := known || jsonb_build_object('category', sp.family); end if;
  if sp.year is not null then known := known || jsonb_build_object('model_year', sp.year); end if;

  for k in select jsonb_object_keys(known) loop
    if public._dcs_is_blank(cur->>k) then
      vals := vals || jsonb_build_object(k, known->k);
      done := done || k;
    end if;
  end loop;
  if cardinality(done) = 0 then return done; end if;

  select string_agg(format('%I = ($1->>%L)::%s', x, x, types->>x), ', ') into clauses from unnest(done) x;
  execute format('update public.vehicles set %s where id = $2', clauses) using vals, _vehicle;

  foreach k in array done loop
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
    values (_company, auth.uid(), 'dcs_catalog_filled', 'vehicles', _vehicle::text, 'dcs',
            jsonb_build_object(k, cur->k), jsonb_build_object(k, vals->k, 'model_year_id', my));
    insert into public.vehicle_field_status (company_id, vehicle_id, field, status, dcs_value, previous_value, source)
    values (_company, _vehicle, k, 'catalogue', vals->>k, cur->>k, 'catalogue')
    on conflict (vehicle_id, field) do update
      set status = excluded.status, dcs_value = excluded.dcs_value,
          previous_value = excluded.previous_value, source = excluded.source, updated_at = now();
  end loop;
  return done;
end $$;
revoke all on function public._dcs_catalog_fill(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Après l'import : client conservé + catalogue
-- ---------------------------------------------------------------------
create or replace function public.dcs_import_complete(_company uuid, _vehicle uuid, _vin text, _client jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur_vin text;
  old_row jsonb;
  new_row jsonb;
  saved boolean := false;
  filled text[];
  mail text;
begin
  perform public._dcs_write_guard(_company);
  select v.vin into cur_vin from public.vehicles v where v.id = _vehicle and v.company_id = _company for update;
  if not found then raise exception 'dcs_vehicle_not_found'; end if;
  if upper(coalesce(cur_vin, '')) <> upper(coalesce(_vin, '')) then raise exception 'dcs_vin_mismatch'; end if;

  -- Une lecture sans bloc client ne remet pas à zéro le client déjà connu.
  if jsonb_typeof(_client) = 'object'
     and (public._dcs_clean(_client->>'full_name') is not null or public._dcs_clean(_client->>'ducati_code') is not null) then
    select to_jsonb(c) - 'read_at' - 'updated_at' into old_row from public.vehicle_dcs_client c where c.vehicle_id = _vehicle;
    mail := public._dcs_clean(_client->>'email', 254);
    if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then mail := null; end if;

    insert into public.vehicle_dcs_client as t
      (vehicle_id, company_id, full_name, first_name, last_name, email, mobile, address, postal_code, city, region,
       country, country_code, birth_date, ducati_code, read_at, updated_at)
    values (_vehicle, _company, public._dcs_clean(_client->>'full_name'), public._dcs_clean(_client->>'first_name'),
            public._dcs_clean(_client->>'last_name'), mail, public._dcs_clean(_client->>'mobile', 40),
            public._dcs_clean(_client->>'address'), public._dcs_clean(_client->>'postal_code', 20),
            public._dcs_clean(_client->>'city'), public._dcs_clean(_client->>'region'), public._dcs_clean(_client->>'country', 80),
            case when coalesce(_client->>'country_code', '') ~ '^[A-Z]{2}$' then _client->>'country_code' end,
            public._dcs_safe_date(_client->>'birth_date'), public._dcs_clean(_client->>'ducati_code', 60), now(), now())
    on conflict (vehicle_id) do update
      set full_name = excluded.full_name, first_name = excluded.first_name, last_name = excluded.last_name,
          email = excluded.email, mobile = excluded.mobile, address = excluded.address, postal_code = excluded.postal_code,
          city = excluded.city, region = excluded.region, country = excluded.country, country_code = excluded.country_code,
          birth_date = excluded.birth_date, ducati_code = excluded.ducati_code, read_at = now(), updated_at = now();
    saved := true;

    select to_jsonb(c) - 'read_at' - 'updated_at' into new_row from public.vehicle_dcs_client c where c.vehicle_id = _vehicle;
    if old_row is distinct from new_row then
      -- La trace dit quels champs ont changé, sans recopier les coordonnées.
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (_company, auth.uid(), 'dcs_client_read', 'vehicles', _vehicle::text, 'dcs', null,
              jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(new_row) k
                                             where old_row is null or old_row->k is distinct from new_row->k)));
    end if;
  end if;

  filled := public._dcs_catalog_fill(_company, _vehicle);
  return jsonb_build_object('client', saved, 'filled', to_jsonb(filled));
end $$;
revoke all on function public.dcs_import_complete(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.dcs_import_complete(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Trancher un écart
-- ---------------------------------------------------------------------
create or replace function public.dcs_resolve_field(
  _company uuid,
  _vehicle uuid,
  _field text,
  _choice text,                     -- 'keep' = garder la fiche, 'dcs' = prendre le DCS
  _seen text default null,          -- valeur de la fiche vue à l'écran
  _candidate text default null,     -- modèle-année choisi parmi les candidats
  _model_label text default null,   -- nom commercial du candidat choisi
  _force_lower boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur jsonb;
  st public.vehicle_field_status%rowtype;
  old_value text;
  new_value text;
  ids text[];
  km integer;
  last_km integer;
  label text;
  filled text[] := '{}';
begin
  perform public._dcs_write_guard(_company);
  if _field not in ('plate', 'mileage', 'color', 'model', 'owner') then
    raise exception 'dcs_field_not_allowed: %', _field using errcode = '22023';
  end if;
  if _choice not in ('keep', 'dcs') then raise exception 'dcs_bad_choice' using errcode = '22023'; end if;
  if _field = 'owner' and _choice = 'dcs' then raise exception 'dcs_owner_use_attach' using errcode = '22023'; end if;

  select to_jsonb(v) into cur from public.vehicles v where v.id = _vehicle and v.company_id = _company for update;
  if cur is null then raise exception 'dcs_vehicle_not_found'; end if;
  select * into st from public.vehicle_field_status s where s.vehicle_id = _vehicle and s.field = _field for update;
  if not found or st.status <> 'conflit' then raise exception 'dcs_not_in_conflict' using errcode = '22023'; end if;

  if _field <> 'owner' then
    old_value := cur->>_field;
    if _seen is not null and nullif(_seen, '') is distinct from nullif(old_value, '') then
      raise exception 'dcs_stale: %', _field using errcode = '40001';
    end if;
  else
    old_value := st.previous_value;
  end if;

  if _choice = 'keep' then
    update public.vehicle_field_status
       set status = 'saisi', source = 'decision', previous_value = old_value, updated_at = now()
     where vehicle_id = _vehicle and field = _field;
    if _field = 'model' then
      update public.vehicle_field_status
         set status = 'saisi', source = 'decision', dcs_value = cur->>'ducati_model_year_id',
             previous_value = cur->>'ducati_model_year_id', updated_at = now()
       where vehicle_id = _vehicle and field = 'ducati_model_year_id';
      filled := public._dcs_catalog_fill(_company, _vehicle);
    end if;
    new_value := old_value;
  elsif _field = 'mileage' then
    if coalesce(st.dcs_value, '') !~ '^\d{1,6}$' then raise exception 'dcs_bad_value' using errcode = '22023'; end if;
    km := st.dcs_value::integer;
    -- Règle G8 : un km inférieur au dernier relevé est bloqué, sauf « Forcer ».
    last_km := public._vehicle_last_mileage(_vehicle, null, null, true);
    if last_km is not null and km < last_km and not coalesce(_force_lower, false) then
      raise exception 'Kilométrage inférieur : % km au DCS, dernier relevé % km.', km, last_km
        using errcode = '23514', hint = 'mileage_lower', detail = last_km::text;
    end if;
    update public.vehicles set mileage = km where id = _vehicle;
    new_value := km::text;
  elsif _field = 'plate' then
    new_value := upper(regexp_replace(coalesce(st.dcs_value, ''), '[^A-Za-z0-9]', '', 'g'));
    if new_value = '' or (coalesce((cur->>'plate_custom')::boolean, false) is false and length(new_value) <> 7) then
      raise exception 'dcs_plate_length' using errcode = '22023', hint = 'dcs_plate_length';
    end if;
    update public.vehicles set plate = new_value where id = _vehicle;
  elsif _field = 'color' then
    new_value := public._dcs_clean(st.dcs_value);
    if new_value is null then raise exception 'dcs_bad_value' using errcode = '22023'; end if;
    update public.vehicles set color = new_value where id = _vehicle;
  else
    -- Modèle : un candidat explicite, ou le texte du DCS s'il n'existe aucun candidat.
    select string_to_array(nullif(s.dcs_value, ''), ',') into ids
      from public.vehicle_field_status s where s.vehicle_id = _vehicle and s.field = 'ducati_model_year_id';
    if coalesce(cardinality(ids), 0) > 0 then
      if _candidate is null or not (_candidate = any(ids)) then
        raise exception 'dcs_candidate_required' using errcode = '22023';
      end if;
      label := public._dcs_clean(_model_label);
      if label is null then raise exception 'dcs_candidate_required' using errcode = '22023'; end if;
      update public.vehicles set model = label, ducati_model_year_id = _candidate where id = _vehicle;
      update public.vehicle_field_status
         set status = 'saisi', source = 'decision', dcs_value = _candidate,
             previous_value = cur->>'ducati_model_year_id', updated_at = now()
       where vehicle_id = _vehicle and field = 'ducati_model_year_id';
      new_value := label;
    else
      new_value := public._dcs_clean(st.dcs_value);
      if new_value is null then raise exception 'dcs_bad_value' using errcode = '22023'; end if;
      update public.vehicles set model = new_value where id = _vehicle;
      -- Texte repris sans candidat : le modèle-année n'est pas certain, rien n'est complété.
      update public.vehicle_field_status
         set status = 'saisi', source = 'decision', dcs_value = null,
             previous_value = cur->>'ducati_model_year_id', updated_at = now()
       where vehicle_id = _vehicle and field = 'ducati_model_year_id';
    end if;
  end if;

  if _choice = 'dcs' then
    update public.vehicle_field_status
       set status = case when _field = 'model' then 'saisi' else 'certifie' end,
           source = case when _field = 'model' then 'decision' else 'dcs' end,
           previous_value = old_value, updated_at = now()
     where vehicle_id = _vehicle and field = _field;
    if _field = 'model' then filled := public._dcs_catalog_fill(_company, _vehicle); end if;
  end if;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'dcs_field_resolved', 'vehicles', _vehicle::text, 'dcs',
          jsonb_build_object('field', _field, 'value', case when _field = 'owner' then null else old_value end),
          jsonb_build_object('field', _field, 'choice', _choice,
                             'value', case when _field = 'owner' then null else new_value end,
                             'dcs_value', case when _field = 'owner' then null else st.dcs_value end,
                             'candidate', _candidate,
                             'forced', coalesce(_force_lower and km < last_km, false)));
  return jsonb_build_object('field', _field, 'choice', _choice, 'filled', to_jsonb(filled));
end $$;
revoke all on function public.dcs_resolve_field(uuid, uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.dcs_resolve_field(uuid, uuid, text, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Client : retrouver, attribuer, créer
-- ---------------------------------------------------------------------
create or replace function public.dcs_client_matches(_company uuid, _vehicle uuid)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  s public.vehicle_dcs_client%rowtype;
  v_phone text;
  v_name text;
  v_mail text;
  v_code text;
  out_rows jsonb;
begin
  if not public.is_member(_company) then raise exception 'dcs_forbidden' using errcode = '42501'; end if;
  select * into s from public.vehicle_dcs_client c where c.vehicle_id = _vehicle and c.company_id = _company;
  if not found then return '[]'::jsonb; end if;
  v_phone := public.contact_phone_key(s.mobile);
  v_name := nullif(public.contact_norm_txt(s.full_name), '');
  v_mail := nullif(lower(btrim(coalesce(s.email, ''))), '');
  v_code := nullif(upper(btrim(coalesce(s.ducati_code, ''))), '');

  with hits as (
    select c.id, c.first_name, c.last_name, c.company_name, c.code, c.city, c.is_active,
           array_remove(array[
             case when v_code is not null and upper(btrim(c.ducati_code)) = v_code then 'code' end,
             case when v_mail is not null and v_mail in (lower(btrim(c.email)), lower(btrim(c.my_ducati_email))) then 'email' end,
             case when v_phone is not null and v_phone in (
                    public.contact_phone_key(c.mobile), public.contact_phone_key(c.gsm),
                    public.contact_phone_key(c.phone), public.contact_phone_key(c.my_ducati_phone)) then 'phone' end,
             case when v_name is not null and v_name in (
                    public.contact_norm_txt(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
                    public.contact_norm_txt(btrim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))),
                    public.contact_norm_txt(c.company_name)) then 'name' end
           ], null) as reasons
      from public.contacts c
     where c.company_id = _company
  ), ranked as (
    select h.*, exists (select 1 from public.vehicle_owners o
                         where o.vehicle_id = _vehicle and o.contact_id = h.id and o.is_current) as is_owner,
           case when 'code' = any(h.reasons) then 0 when 'email' = any(h.reasons) then 1
                when 'phone' = any(h.reasons) then 2 else 3 end as prio
      from hits h where cardinality(h.reasons) > 0
     order by prio, h.is_active desc, h.id
     limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'name', coalesce(nullif(r.company_name, ''), nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), r.code),
           'code', r.code, 'city', r.city, 'is_active', r.is_active, 'is_owner', r.is_owner, 'reasons', to_jsonb(r.reasons)
         ) order by r.prio, r.is_active desc, r.id), '[]'::jsonb)
    into out_rows from ranked r;
  return out_rows;
end $$;
revoke all on function public.dcs_client_matches(uuid, uuid) from public, anon;
grant execute on function public.dcs_client_matches(uuid, uuid) to authenticated;

-- Statut « propriétaire » après un choix explicite (le prochain import le respecte).
create or replace function public._dcs_owner_decided(_company uuid, _vehicle uuid, _contact uuid, _dcs_name text, _how text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  shown text;
begin
  select coalesce(nullif(c.company_name, ''), nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.code)
    into shown from public.contacts c where c.id = _contact;
  insert into public.vehicle_field_status (company_id, vehicle_id, field, status, dcs_value, previous_value, source)
  values (_company, _vehicle, 'owner', 'saisi', _dcs_name, shown, 'decision')
  on conflict (vehicle_id, field) do update
    set status = 'saisi', dcs_value = excluded.dcs_value, previous_value = excluded.previous_value,
        source = 'decision', updated_at = now();
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'dcs_field_resolved', 'vehicles', _vehicle::text, 'dcs',
          jsonb_build_object('field', 'owner'),
          jsonb_build_object('field', 'owner', 'choice', _how, 'contact_id', _contact));
end $$;
revoke all on function public._dcs_owner_decided(uuid, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.dcs_client_attach(_company uuid, _vehicle uuid, _contact uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.vehicle_dcs_client%rowtype;
  res jsonb;
begin
  perform public._dcs_write_guard(_company);
  perform 1 from public.vehicles v where v.id = _vehicle and v.company_id = _company for update;
  if not found then raise exception 'dcs_vehicle_not_found'; end if;
  select * into s from public.vehicle_dcs_client c where c.vehicle_id = _vehicle and c.company_id = _company;
  if not found then raise exception 'dcs_no_client' using errcode = '22023'; end if;
  -- Seule une fiche réellement proposée peut être attribuée.
  if not exists (select 1 from jsonb_array_elements(public.dcs_client_matches(_company, _vehicle)) x
                  where x->>'id' = _contact::text) then
    raise exception 'dcs_contact_not_matched' using errcode = '22023';
  end if;
  res := public.vehicle_attach_owner(_vehicle, _contact, null, 'dcs');
  perform public._dcs_owner_decided(_company, _vehicle, _contact, coalesce(s.full_name, s.ducati_code), 'attach');
  return res;
end $$;
revoke all on function public.dcs_client_attach(uuid, uuid, uuid) from public, anon;
grant execute on function public.dcs_client_attach(uuid, uuid, uuid) to authenticated;

create or replace function public.dcs_client_create_attach(_company uuid, _vehicle uuid, _confirm_duplicate boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.vehicle_dcs_client%rowtype;
  matches jsonb;
  new_id uuid;
begin
  perform public._dcs_write_guard(_company);
  if not public.can_write_table(_company, 'contacts') then raise exception 'dcs_forbidden' using errcode = '42501'; end if;
  perform 1 from public.vehicles v where v.id = _vehicle and v.company_id = _company for update;
  if not found then raise exception 'dcs_vehicle_not_found'; end if;
  select * into s from public.vehicle_dcs_client c where c.vehicle_id = _vehicle and c.company_id = _company;
  if not found or (s.first_name is null and s.last_name is null) then
    raise exception 'dcs_no_client' using errcode = '22023';
  end if;

  matches := public.dcs_client_matches(_company, _vehicle);
  if jsonb_array_length(matches) > 0 and not coalesce(_confirm_duplicate, false) then
    raise exception 'dcs_possible_duplicate' using errcode = '23505', hint = 'dcs_possible_duplicate';
  end if;

  -- Fiche nouvelle : aucun consentement marketing n'est repris du DCS, la personne reste hors
  -- campagnes tant que la concession n'a pas recueilli son accord.
  insert into public.contacts (company_id, type, first_name, last_name, email, mobile, address, zip, city, country,
                               birth_date, ducati_code, imported_from, origin, marketing_opt_out, created_by)
  values (_company, 'particulier', s.first_name, s.last_name, s.email, s.mobile, s.address, s.postal_code, s.city,
          s.country_code, s.birth_date, s.ducati_code, 'DCS', 'manuel', true, auth.uid())
  returning id into new_id;

  perform public.vehicle_attach_owner(_vehicle, new_id, null, 'dcs');
  perform public._dcs_owner_decided(_company, _vehicle, new_id, coalesce(s.full_name, s.ducati_code), 'create');
  return jsonb_build_object('contact_id', new_id);
end $$;
revoke all on function public.dcs_client_create_attach(uuid, uuid, boolean) from public, anon;
grant execute on function public.dcs_client_create_attach(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
