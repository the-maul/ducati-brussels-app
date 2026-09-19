-- =====================================================================
-- MISSION 04 — CARTE 8 : « Le client déclare sa moto, l'équipe est prévenue et la
-- valide ».
-- Migration ADDITIVE :
--  1. contact_declared_vehicles (qui reçoit déjà les motos déclarées à l'inscription
--     et à la borne) : colonnes nullables vin, plate, status, registration_upload_id,
--     reviewed_at, reviewed_by, review_note ; origine 'portail' AJOUTÉE aux origines
--     admises (web, comptoir, manuel conservées).
--  2. plate_normalize(text) : plaque comparable.
--  3. Cloche (4 étapes de M00 §4) : type 'vehicle_declared' ajouté à la contrainte
--     (types existants relus dans la définition en place), cas ajouté à
--     can_see_team_notification (tous les cas en place recopiés) → admin + vendeur,
--     ligne insérée par un déclencheur sur CHAQUE déclaration (portail, inscription,
--     borne), affichage dans topbar.tsx.
--  4. Portail (étanchéité comme les autres portal_*) : portal_declare_vehicle,
--     portal_prepare_declaration_upload (photo de carte grise facultative, terminée par
--     le portal_complete_upload existant), portal_declared_vehicles.
--  5. Équipe : declared_vehicles_pending (avec la moto existante de même VIN ou même
--     plaque), declared_vehicle_attach, declared_vehicle_create, declared_vehicle_ignore.
--     Tout est tracé dans events. Une moto déclarée n'entre JAMAIS dans le parc sans
--     l'une de ces deux validations par un membre de l'équipe.
-- =====================================================================

-- ------------------------------------------------ 1. Déclarations : colonnes
alter table public.contact_declared_vehicles add column if not exists vin text;
alter table public.contact_declared_vehicles add column if not exists plate text;
alter table public.contact_declared_vehicles add column if not exists status text;
alter table public.contact_declared_vehicles add column if not exists registration_upload_id uuid
  references public.portal_uploads(id) on delete set null;
alter table public.contact_declared_vehicles add column if not exists reviewed_at timestamptz;
alter table public.contact_declared_vehicles add column if not exists reviewed_by uuid
  references auth.users(id) on delete set null;
alter table public.contact_declared_vehicles add column if not exists review_note text;

-- Déclarations déjà reçues (inscription / borne) : à valider, sauf « pas encore de moto ».
update public.contact_declared_vehicles set status = 'a_valider'
 where status is null and kind <> 'none' and vehicle_id is null;
alter table public.contact_declared_vehicles alter column status set default 'a_valider';

do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'contact_declared_vehicles_status_check') then
    alter table public.contact_declared_vehicles add constraint contact_declared_vehicles_status_check
      check (status is null or status in ('a_valider', 'rattachee', 'creee', 'ignoree'));
  end if;
end $do$;

-- Origine 'portail' ajoutée : la contrainte est reconstruite avec les origines en place + la nouvelle.
do $do$
declare _c record; _vals text[];
begin
  for _c in
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = 'public.contact_declared_vehicles'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
  loop
    select array_agg(distinct v order by v) into _vals from (
      select (regexp_matches(_c.def, '''([a-z_]+)''', 'g'))[1] as v
      union select 'web' union select 'comptoir' union select 'manuel' union select 'portail') x;
    execute format('alter table public.contact_declared_vehicles drop constraint %I', _c.conname);
  end loop;
  if _vals is null then _vals := array['comptoir', 'manuel', 'portail', 'web']; end if;
  execute format('alter table public.contact_declared_vehicles add constraint contact_declared_vehicles_source_check '
                 'check (source = any (%L::text[]))', _vals);
end $do$;

create index if not exists idx_contact_declared_vehicles_pending
  on public.contact_declared_vehicles (company_id, created_at desc) where status = 'a_valider';

comment on table public.contact_declared_vehicles is
  'Moto DÉCLARÉE par le client (inscription, borne, espace client) : non vérifiée. '
  'status a_valider → rattachee (moto existante) / creee (nouvelle fiche) / ignoree, par un membre de '
  'l''équipe (Véhicules → Motos déclarées à valider). kind = none : « pas encore de moto » (status null). '
  'vehicle_id : fiche véhicule du parc une fois validée.';

-- ------------------------------------------------ 2. Plaque comparable
create or replace function public.plate_normalize(_plate text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select nullif(upper(regexp_replace(coalesce(_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
$fn$;
comment on function public.plate_normalize(text) is
  'Mission 04 carte 8 : plaque comparable (majuscules, lettres et chiffres seulement), NULL si vide.';
revoke all on function public.plate_normalize(text) from public, anon;
grant execute on function public.plate_normalize(text) to authenticated, service_role;

-- ------------------------------------------------ 3a. Cloche : nouveau type (étape 1)
do $do$
declare _def text; _kinds text[];
begin
  select pg_get_constraintdef(c.oid) into _def from pg_constraint c
   where c.conrelid = 'public.team_notifications'::regclass and c.conname = 'team_notifications_kind_check';
  select array_agg(distinct k order by k) into _kinds from (
    select (regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g'))[1] as k
    union select 'signup' union select 'client_iban_changed' union select 'vehicle_declared') x;
  alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
  execute format('alter table public.team_notifications add constraint team_notifications_kind_check '
                 'check (kind = any (%L::text[]))', _kinds);
end $do$;

-- ------------------------------------------------ 3b. Cloche : visibilité (étape 2)
create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case _kind
    when 'signup' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'comptable')
      or public.has_role(_company, 'vendeur')
    when 'vehicle_declared' then
         public.has_role(_company, 'admin')
      or public.has_role(_company, 'vendeur')
    else public.is_member(_company)
  end;
$fn$;
comment on function public.can_see_team_notification(uuid, text) is
  'Décision N-1 : alerte « inscription » visible des rôles admin, vendeur, marketing. '
  'Mission 04 : « IBAN modifié par le client » → admin, comptable, vendeur ; '
  '« moto déclarée par un client » → admin, vendeur.';
revoke all on function public.can_see_team_notification(uuid, text) from public, anon;
grant execute on function public.can_see_team_notification(uuid, text) to authenticated, service_role;

-- ------------------------------------------------ 3c. Cloche : insertion (étape 3)
create or replace function public.trg_notify_team_vehicle_declared()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _name text; _moto text;
begin
  if new.kind = 'none' then return new; end if;
  begin
    select nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
             concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
      into _name from public.contacts c where c.id = new.contact_id;
    _moto := nullif(btrim(concat_ws(' ', new.brand, new.model,
               case when new.model_year is not null then '(' || new.model_year || ')' end)), '');
    insert into public.team_notifications (company_id, kind, contact_id, title, origin)
    values (new.company_id, 'vehicle_declared', new.contact_id,
            left(coalesce(_name, '—') || coalesce(' — ' || _moto, ''), 200),
            case when new.source in ('web', 'comptoir') then new.source end);
  exception when others then
    -- Jamais une déclaration (ni une inscription) refusée à cause d'une alerte interne.
    raise warning 'trg_notify_team_vehicle_declared: %', sqlerrm;
  end;
  return new;
end $fn$;
revoke all on function public.trg_notify_team_vehicle_declared() from public, anon, authenticated;

drop trigger if exists trg_contact_declared_vehicles_notify on public.contact_declared_vehicles;
create trigger trg_contact_declared_vehicles_notify
  after insert on public.contact_declared_vehicles
  for each row execute function public.trg_notify_team_vehicle_declared();

-- ------------------------------------------------ 4. Portail
-- Le client déclare une moto. Jamais dans le parc : une déclaration « à valider ».
create or replace function public.portal_declare_vehicle(
  p_brand text, p_model text, p_model_year integer, p_vin text, p_plate text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record; _brand text; _model text; _vin text; _plate text; _open int; _id uuid;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  _brand := left(nullif(upper(btrim(coalesce(p_brand, ''))), ''), 60);
  _model := left(nullif(upper(btrim(coalesce(p_model, ''))), ''), 100);
  if _brand is null then raise exception 'portal: brand required' using errcode = '22023'; end if;
  if _model is null then raise exception 'portal: model required' using errcode = '22023'; end if;
  if p_model_year is not null and (p_model_year < 1920 or p_model_year > extract(year from current_date)::int + 1) then
    raise exception 'portal: invalid year' using errcode = '22023';
  end if;
  _vin := public.vin_normalize(p_vin);
  if _vin is not null and length(_vin) > 20 then raise exception 'portal: invalid vin' using errcode = '22023'; end if;
  _plate := nullif(upper(btrim(coalesce(p_plate, ''))), '');
  if _plate is not null and (length(_plate) > 15 or _plate !~ '^[A-Z0-9 .-]+$') then
    raise exception 'portal: invalid plate' using errcode = '22023';
  end if;
  -- Garde-fou contre les abus : au plus 5 déclarations en attente par client.
  select count(*) into _open from public.contact_declared_vehicles
   where contact_id = _ctx.contact_id and company_id = _ctx.company_id and status = 'a_valider';
  if _open >= 5 then raise exception 'portal: too many pending declarations' using errcode = '54000'; end if;

  insert into public.contact_declared_vehicles
    (company_id, contact_id, kind, brand, model, model_year, source, vin, plate, status)
  values (_ctx.company_id, _ctx.contact_id,
          case when _brand ilike 'ducati%' then 'ducati' else 'other_brand' end,
          _brand, _model, p_model_year, 'portail', _vin, _plate, 'a_valider')
  returning id into _id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_ctx.company_id, auth.uid(), 'portal_vehicle_declared', 'contact_declared_vehicles', _id::text, 'portal', null,
          jsonb_build_object('contact_id', _ctx.contact_id, 'brand', _brand, 'model', _model,
                             'model_year', p_model_year, 'vin', _vin, 'plate', _plate));
  return _id;
end $fn$;

-- Photo de la carte grise d'une déclaration : même dépôt en 3 temps que les autres
-- fichiers du portail (portal_complete_upload termine). Rangée sur la fiche du client
-- (la moto n'existe pas encore) ; recopiée sur la moto à la validation.
create or replace function public.portal_prepare_declaration_upload(
  p_declaration_id uuid, p_file_name text, p_content_type text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record; _id uuid := gen_random_uuid(); _ext text; _path text; _recent int;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  -- Même réponse qu'il s'agisse d'une déclaration inexistante ou de celle d'un autre client.
  if p_declaration_id is null or not exists (
       select 1 from public.contact_declared_vehicles d
        where d.id = p_declaration_id and d.contact_id = _ctx.contact_id
          and d.company_id = _ctx.company_id and d.status = 'a_valider') then
    raise exception 'portal: declaration not found' using errcode = 'P0002';
  end if;
  _ext := case lower(coalesce(p_content_type, ''))
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if _ext is null then raise exception 'portal: file type not allowed' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 or p_size > 15 * 1024 * 1024 then
    raise exception 'portal: file too large' using errcode = '22023';
  end if;
  select count(*) into _recent from public.portal_uploads
   where user_id = auth.uid() and created_at > now() - interval '24 hours';
  if _recent >= 40 then raise exception 'portal: too many uploads' using errcode = '54000'; end if;

  _path := _ctx.company_id::text || '/contact/' || _ctx.contact_id::text || '/portail_' || _id::text || '.' || _ext;
  insert into public.portal_uploads (id, company_id, contact_id, user_id, entity_type, entity_id, kind,
    storage_path, file_name, content_type, size_bytes)
  values (_id, _ctx.company_id, _ctx.contact_id, auth.uid(), 'contact', _ctx.contact_id, 'carte_grise', _path,
    left(coalesce(nullif(trim(p_file_name), ''), 'carte_grise.' || _ext), 150), lower(p_content_type), p_size);
  update public.contact_declared_vehicles set registration_upload_id = _id
   where id = p_declaration_id and contact_id = _ctx.contact_id and company_id = _ctx.company_id;
  return jsonb_build_object('upload_id', _id, 'path', _path);
end $fn$;

-- Déclarations du client : en attente de validation, ou non retenues (60 jours).
create or replace function public.portal_declared_vehicles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare _ctx record; _r jsonb;
begin
  select * into _ctx from public._portal_ctx();
  if _ctx.contact_id is null then raise exception 'portal: no client account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'brand', d.brand, 'model', d.model, 'model_year', d.model_year,
      'vin', d.vin, 'plate', d.plate, 'status', d.status, 'created_at', d.created_at,
      'has_registration', exists (select 1 from public.portal_uploads pu
                                   where pu.id = d.registration_upload_id and pu.completed_at is not null))
      order by d.created_at desc), '[]'::jsonb)
    into _r
    from public.contact_declared_vehicles d
   where d.contact_id = _ctx.contact_id and d.company_id = _ctx.company_id and d.kind <> 'none'
     and (d.status = 'a_valider' or (d.status = 'ignoree' and d.reviewed_at > now() - interval '60 days'));
  return _r;
end $fn$;

revoke all on function public.portal_declare_vehicle(text, text, integer, text, text) from public, anon;
revoke all on function public.portal_prepare_declaration_upload(uuid, text, text, bigint) from public, anon;
revoke all on function public.portal_declared_vehicles() from public, anon;
grant execute on function public.portal_declare_vehicle(text, text, integer, text, text) to authenticated;
grant execute on function public.portal_prepare_declaration_upload(uuid, text, text, bigint) to authenticated;
grant execute on function public.portal_declared_vehicles() to authenticated;

-- ------------------------------------------------ 5. Équipe
-- Liste « Motos déclarées à valider », avec la moto existante de même VIN ou même plaque.
create or replace function public.declared_vehicles_pending(_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare _r jsonb;
begin
  if not public.is_member(_company) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into _r
  from (
    select d.created_at, jsonb_build_object(
      'id', d.id, 'contact_id', d.contact_id,
      'contact_name', nullif(btrim(coalesce(nullif(btrim(c.company_name), ''),
                        concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), ''),
      'kind', d.kind, 'brand', d.brand, 'family', d.family, 'model', d.model, 'model_year', d.model_year,
      'vin', d.vin, 'plate', d.plate, 'source', d.source, 'created_at', d.created_at,
      'registration', (select jsonb_build_object('path', pu.storage_path, 'file_name', pu.file_name,
                                                 'content_type', pu.content_type, 'size', pu.size_bytes)
                         from public.portal_uploads pu
                        where pu.id = d.registration_upload_id and pu.completed_at is not null),
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'brand', v.brand, 'model', v.model, 'vin', v.vin, 'plate', v.plate,
                 'model_year', v.model_year,
                 'match', case when public.vin_normalize(d.vin) is not null
                                and public.vin_normalize(v.vin) = public.vin_normalize(d.vin) then 'vin' else 'plate' end,
                 'owner_id', o.contact_id,
                 'owner_name', nullif(btrim(coalesce(nullif(btrim(oc.company_name), ''),
                                 concat_ws(' ', nullif(btrim(oc.first_name), ''), nullif(btrim(oc.last_name), '')))), ''))
               order by v.created_at)
          from public.vehicles v
          left join lateral (select vo.contact_id from public.vehicle_owners vo
                              where vo.vehicle_id = v.id and vo.is_current
                              order by vo.from_date desc limit 1) o on true
          left join public.contacts oc on oc.id = o.contact_id
         where v.company_id = d.company_id
           and ((public.vin_normalize(d.vin) is not null and public.vin_normalize(v.vin) = public.vin_normalize(d.vin))
             or (public.plate_normalize(d.plate) is not null and public.plate_normalize(v.plate) = public.plate_normalize(d.plate)))
      ), '[]'::jsonb)) as j
      from public.contact_declared_vehicles d
      join public.contacts c on c.id = d.contact_id
     where d.company_id = _company and d.status = 'a_valider' and d.kind <> 'none'
  ) x;
  return _r;
end $fn$;

-- Aide interne : verrouille une déclaration à valider et contrôle l'appelant.
create or replace function public._declared_vehicle_lock(_declaration uuid)
returns public.contact_declared_vehicles
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _d public.contact_declared_vehicles%rowtype;
begin
  select * into _d from public.contact_declared_vehicles where id = _declaration for update;
  if _d.id is null then raise exception 'DECLARATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(_d.company_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if _d.status is distinct from 'a_valider' then
    raise exception 'DECLARATION_ALREADY_REVIEWED' using errcode = '23514';
  end if;
  return _d;
end $fn$;

-- Aide interne : la carte grise déposée par le client rejoint les documents de la moto.
create or replace function public._declared_vehicle_copy_scan(_d public.contact_declared_vehicles, _vehicle uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.attachments (company_id, entity_type, entity_id, file_name, storage_path, content_type,
    size_bytes, note, uploaded_by, folder)
  select _d.company_id, 'vehicle', _vehicle, pu.file_name, pu.storage_path, pu.content_type, pu.size_bytes,
         'portail:carte_grise', pu.user_id, 'Portail client'
    from public.portal_uploads pu
   where pu.id = _d.registration_upload_id and pu.completed_at is not null
     and not exists (select 1 from public.attachments a
                      where a.entity_type = 'vehicle' and a.entity_id = _vehicle and a.storage_path = pu.storage_path);
end $fn$;

revoke all on function public._declared_vehicle_lock(uuid) from public, anon, authenticated;
revoke all on function public._declared_vehicle_copy_scan(public.contact_declared_vehicles, uuid) from public, anon, authenticated;

-- « Rattacher à cette moto » : la moto existante passe au nom du client.
create or replace function public.declared_vehicle_attach(_declaration uuid, _vehicle uuid, _from_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _d public.contact_declared_vehicles%rowtype; _res jsonb;
begin
  _d := public._declared_vehicle_lock(_declaration);
  if not exists (select 1 from public.vehicles v where v.id = _vehicle and v.company_id = _d.company_id) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  _res := public.vehicle_attach_owner(_vehicle, _d.contact_id, _from_date, 'declaration');
  perform public._declared_vehicle_copy_scan(_d, _vehicle);
  update public.contact_declared_vehicles
     set status = 'rattachee', vehicle_id = _vehicle, reviewed_at = now(), reviewed_by = auth.uid()
   where id = _d.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_d.company_id, auth.uid(), 'vehicle_declaration_attached', 'contact_declared_vehicles', _d.id::text, 'screen',
          jsonb_build_object('status', 'a_valider'),
          jsonb_build_object('status', 'rattachee', 'vehicle_id', _vehicle, 'contact_id', _d.contact_id));
  return _res;
end $fn$;

-- « Créer la fiche moto » : nouvelle fiche + propriétaire (même règles que la carte 6).
create or replace function public.declared_vehicle_create(_declaration uuid, _vehicle jsonb, _from_date date default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _d public.contact_declared_vehicles%rowtype; _id uuid;
begin
  _d := public._declared_vehicle_lock(_declaration);
  _id := public.vehicle_create_for_contact(_d.company_id, _d.contact_id, _vehicle, _from_date);
  perform public._declared_vehicle_copy_scan(_d, _id);
  update public.contact_declared_vehicles
     set status = 'creee', vehicle_id = _id, reviewed_at = now(), reviewed_by = auth.uid()
   where id = _d.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_d.company_id, auth.uid(), 'vehicle_declaration_created', 'contact_declared_vehicles', _d.id::text, 'screen',
          jsonb_build_object('status', 'a_valider'),
          jsonb_build_object('status', 'creee', 'vehicle_id', _id, 'contact_id', _d.contact_id));
  return _id;
end $fn$;

-- « Ignorer » : la déclaration n'est pas retenue (le client la voit « non retenue »).
create or replace function public.declared_vehicle_ignore(_declaration uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _d public.contact_declared_vehicles%rowtype;
begin
  _d := public._declared_vehicle_lock(_declaration);
  update public.contact_declared_vehicles
     set status = 'ignoree', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = left(nullif(btrim(coalesce(_note, '')), ''), 500)
   where id = _d.id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_d.company_id, auth.uid(), 'vehicle_declaration_ignored', 'contact_declared_vehicles', _d.id::text, 'screen',
          jsonb_build_object('status', 'a_valider'),
          jsonb_build_object('status', 'ignoree', 'note', left(nullif(btrim(coalesce(_note, '')), ''), 500)));
end $fn$;

revoke all on function public.declared_vehicles_pending(uuid) from public, anon;
revoke all on function public.declared_vehicle_attach(uuid, uuid, date) from public, anon;
revoke all on function public.declared_vehicle_create(uuid, jsonb, date) from public, anon;
revoke all on function public.declared_vehicle_ignore(uuid, text) from public, anon;
grant execute on function public.declared_vehicles_pending(uuid) to authenticated;
grant execute on function public.declared_vehicle_attach(uuid, uuid, date) to authenticated;
grant execute on function public.declared_vehicle_create(uuid, jsonb, date) to authenticated;
grant execute on function public.declared_vehicle_ignore(uuid, text) to authenticated;
