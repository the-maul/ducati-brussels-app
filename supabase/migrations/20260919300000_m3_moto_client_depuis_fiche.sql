-- =====================================================================
-- MISSION 04 — CARTE 6 : « Créer la moto du client depuis sa fiche ».
-- Migration STRICTEMENT ADDITIVE : fonctions nouvelles + un index d'expression.
-- Aucune table, aucune colonne, aucune donnée modifiée.
--
--  1. vin_normalize(text) : VIN comparable (majuscules, sans espace ni tiret).
--  2. idx_vehicles_company_vin_norm : recherche rapide d'un VIN par société.
--  3. vehicles_find_by_vin(_company, _vin, _exclude) : motos de la société qui
--     portent déjà ce VIN (doublon), avec leur propriétaire actuel.
--  4. vehicle_create_for_contact(_company, _contact, _vehicle, _from_date) :
--     crée la fiche véhicule ET le lien propriétaire (vehicle_owners, propriétaire
--     courant, date de début) dans UNE transaction, tracé dans events. Refuse un
--     VIN déjà présent dans la société (VIN_EXISTS) : on propose alors de
--     rattacher la moto existante. Une moto de client est un véhicule de
--     réparation : AUCUN article (article_id toujours vide), statut par défaut
--     « vendu » comme les 2 418 motos « RÉPARÉ » reprises de G8.
--  5. vehicle_attach_owner(_vehicle, _contact, _from_date, _reason) : rattache une
--     moto existante à un client (ferme le propriétaire courant précédent, ouvre
--     le nouveau), tracé dans events.
-- Droits : revoke all from public, anon ; grant execute to authenticated.
-- Contrôle société : is_member() dans chaque fonction (SECURITY DEFINER).
-- =====================================================================

-- ------------------------------------------------ 1. VIN normalisé
create or replace function public.vin_normalize(_vin text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select nullif(upper(regexp_replace(coalesce(_vin, ''), '[^A-Za-z0-9]', '', 'g')), '');
$fn$;
comment on function public.vin_normalize(text) is
  'Mission 04 carte 6 : VIN comparable (majuscules, lettres et chiffres seulement), NULL si vide. '
  'Même règle que normalizeVin (src/lib/vin.ts).';
revoke all on function public.vin_normalize(text) from public, anon;
grant execute on function public.vin_normalize(text) to authenticated, service_role;

-- ------------------------------------------------ 2. Index
create index if not exists idx_vehicles_company_vin_norm
  on public.vehicles (company_id, public.vin_normalize(vin))
  where vin is not null;

-- ------------------------------------------------ 3. Doublon de VIN
create or replace function public.vehicles_find_by_vin(_company uuid, _vin text, _exclude uuid default null)
returns table (
  id uuid, brand text, model text, plate text, vin text, status public.vehicle_status,
  owner_id uuid, owner_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare _n text := public.vin_normalize(_vin);
begin
  if not public.is_member(_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _n is null then return; end if;
  return query
  select v.id, v.brand, v.model, v.plate, v.vin, v.status,
         o.contact_id,
         nullif(btrim(coalesce(c.company_name,
           concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))), '')
    from public.vehicles v
    left join lateral (
      select vo.contact_id from public.vehicle_owners vo
       where vo.vehicle_id = v.id and vo.is_current
       order by vo.from_date desc, vo.created_at desc limit 1
    ) o on true
    left join public.contacts c on c.id = o.contact_id
   where v.company_id = _company
     and public.vin_normalize(v.vin) = _n
     and (_exclude is null or v.id <> _exclude)
   order by v.created_at;
end $fn$;
comment on function public.vehicles_find_by_vin(uuid, text, uuid) is
  'Mission 04 carte 6 : motos de la société portant déjà ce VIN (comparaison normalisée), avec le propriétaire actuel.';
revoke all on function public.vehicles_find_by_vin(uuid, text, uuid) from public, anon;
grant execute on function public.vehicles_find_by_vin(uuid, text, uuid) to authenticated;

-- ------------------------------------------------ 4. Créer la moto d'un client
create or replace function public.vehicle_create_for_contact(
  _company uuid, _contact uuid, _vehicle jsonb, _from_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _r public.vehicles%rowtype;
  _dup uuid;
  _from date := coalesce(_from_date, current_date);
begin
  if not public.is_member(_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts c where c.id = _contact and c.company_id = _company) then
    raise exception 'VEHICLE_CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if _vehicle is null or jsonb_typeof(_vehicle) <> 'object' then
    raise exception 'VEHICLE_INVALID_PAYLOAD' using errcode = '22023';
  end if;
  if _from > current_date + 1 then
    raise exception 'VEHICLE_INVALID_FROM_DATE' using errcode = '22023';
  end if;

  -- Les clés inconnues du JSON sont ignorées (colonne pas encore migrée = champ ignoré).
  _r := jsonb_populate_record(null::public.vehicles, _vehicle);
  _r.vin := public.vin_normalize(_r.vin);
  _r.plate := nullif(upper(btrim(coalesce(_r.plate, ''))), '');
  if _r.vin is null and _r.plate is null and nullif(btrim(coalesce(_r.model, '')), '') is null then
    raise exception 'VEHICLE_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  -- Jamais deux fiches pour le même VIN dans une société : on propose de rattacher l'existante.
  if _r.vin is not null then
    perform pg_advisory_xact_lock(hashtext('vehicle_vin:' || _company::text || ':' || _r.vin));
    select v.id into _dup from public.vehicles v
     where v.company_id = _company and public.vin_normalize(v.vin) = _r.vin
     order by v.created_at limit 1;
    if _dup is not null then
      raise exception 'VIN_EXISTS' using errcode = '23505', detail = _dup::text;
    end if;
  end if;

  _r.id := coalesce(_r.id, gen_random_uuid());
  if exists (select 1 from public.vehicles v where v.id = _r.id) then
    raise exception 'VEHICLE_ID_TAKEN' using errcode = '23505';
  end if;
  _r.company_id := _company;
  _r.article_id := null;                        -- moto de client : jamais un article V/O/P/D
  _r.status := coalesce(_r.status, 'vendu');    -- comme les motos « RÉPARÉ » de G8
  _r.is_restricted := coalesce(_r.is_restricted, false);
  _r.mileage_qualif := coalesce(_r.mileage_qualif, 'reel');
  _r.is_active := true;
  _r.imported_from := null;
  _r.created_at := now();
  _r.updated_at := now();
  _r.created_by := auth.uid();

  insert into public.vehicles select _r.*;

  insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
  values (_r.id, _contact, _from, true);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'vehicle_created_for_contact', 'vehicles', _r.id::text, 'screen', null,
          jsonb_build_object('contact_id', _contact, 'from_date', _from, 'vin', _r.vin, 'plate', _r.plate,
                             'brand', _r.brand, 'model', _r.model, 'status', _r.status));
  return _r.id;
end $fn$;
comment on function public.vehicle_create_for_contact(uuid, uuid, jsonb, date) is
  'Mission 04 carte 6 : crée la fiche véhicule d''un client et son lien propriétaire courant (vehicle_owners) '
  'en une transaction, tracé dans events (vehicle_created_for_contact). Refuse un VIN déjà présent (VIN_EXISTS, '
  'detail = id de la moto existante). Aucun article créé.';
revoke all on function public.vehicle_create_for_contact(uuid, uuid, jsonb, date) from public, anon;
grant execute on function public.vehicle_create_for_contact(uuid, uuid, jsonb, date) to authenticated;

-- ------------------------------------------------ 5. Rattacher une moto existante
create or replace function public.vehicle_attach_owner(
  _vehicle uuid, _contact uuid, _from_date date default null, _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _v record;
  _from date := coalesce(_from_date, current_date);
  _prev jsonb;
begin
  select v.id, v.company_id into _v from public.vehicles v where v.id = _vehicle for update;
  if _v.id is null then raise exception 'VEHICLE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_member(_v.company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts c where c.id = _contact and c.company_id = _v.company_id) then
    raise exception 'VEHICLE_CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if _from > current_date + 1 then
    raise exception 'VEHICLE_INVALID_FROM_DATE' using errcode = '22023';
  end if;

  -- Déjà propriétaire courant : rien à faire.
  if exists (select 1 from public.vehicle_owners vo
              where vo.vehicle_id = _vehicle and vo.contact_id = _contact and vo.is_current) then
    return jsonb_build_object('vehicle_id', _vehicle, 'already_owner', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('owner_id', vo.id, 'contact_id', vo.contact_id,
                                               'from_date', vo.from_date)), '[]'::jsonb)
    into _prev
    from public.vehicle_owners vo where vo.vehicle_id = _vehicle and vo.is_current;

  update public.vehicle_owners vo
     set is_current = false, to_date = greatest(vo.from_date, _from)
   where vo.vehicle_id = _vehicle and vo.is_current;

  insert into public.vehicle_owners (vehicle_id, contact_id, from_date, is_current)
  values (_vehicle, _contact, _from, true);

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_v.company_id, auth.uid(), 'vehicle_owner_attached', 'vehicles', _vehicle::text, 'screen',
          jsonb_build_object('current_owners', _prev),
          jsonb_build_object('contact_id', _contact, 'from_date', _from,
                             'reason', left(coalesce(nullif(btrim(_reason), ''), 'fiche_client'), 60)));
  return jsonb_build_object('vehicle_id', _vehicle, 'already_owner', false, 'previous_owners', _prev);
end $fn$;
comment on function public.vehicle_attach_owner(uuid, uuid, date, text) is
  'Mission 04 carte 6 : rattache une moto existante à un client (le propriétaire courant précédent est clôturé '
  'à la date de début), tracé dans events (vehicle_owner_attached).';
revoke all on function public.vehicle_attach_owner(uuid, uuid, date, text) from public, anon;
grant execute on function public.vehicle_attach_owner(uuid, uuid, date, text) to authenticated;
