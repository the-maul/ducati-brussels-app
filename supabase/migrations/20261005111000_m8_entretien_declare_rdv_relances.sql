-- =====================================================================
-- Mission 07 — cartes 5, 6 et 7
--
--  carte 5 : demander le kilométrage et les derniers entretiens quand une moto
--            est enregistrée (inscription en ligne, « Ajouter ma moto ») ;
--  carte 6 : rendez-vous d'entretien avec le TEMPS officiel Ducati bloqué au
--            planning et un devis estimé ;
--  carte 7 : relances d'entretien — cloche par rôle, message préparé,
--            **envoi désactivé** (interdit sans accord explicite de Simon).
--
-- Dépend de 20261005110000_m8_prochain_entretien.sql (carte 4).
-- Additive : 4 colonnes sur des tables existantes, 1 trigger, 6 fonctions.
-- Aucun écran existant n'est doublé : on se branche sur
-- `contact_declared_vehicles` (déclarations) et `workshop_appointments`
-- (planning et demandes de RDV) qui existent déjà.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CARTE 5 — ce que le client nous dit de sa moto
--
-- `mileage_km`    : son kilométrage actuel.
-- `last_services` : ce qu'il sait de ses derniers entretiens, sous la forme
--                   [{"label":"Oil Service","km":18500,"date":"2025-06-01"}].
--                   Pas de jargon à l'écran : la liste proposée au client est
--                   celle de son programme (Oil Service, Desmo…), et il peut
--                   ne donner que la date OU que le km.
-- ---------------------------------------------------------------------
alter table public.contact_declared_vehicles
  add column if not exists mileage_km    integer,
  add column if not exists last_services jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.contact_declared_vehicles
    add constraint cdv_mileage_km_sane check (mileage_km is null or (mileage_km >= 0 and mileage_km <= 2000000));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.contact_declared_vehicles
    add constraint cdv_last_services_array check (jsonb_typeof(last_services) = 'array');
exception when duplicate_object then null; end $$;

comment on column public.contact_declared_vehicles.mileage_km is
  'Kilométrage déclaré par le client à l''enregistrement de sa moto (mission 07, carte 5).';
comment on column public.contact_declared_vehicles.last_services is
  'Derniers entretiens déclarés par le client : [{label, km, date}] (mission 07, carte 5).';

-- ---------------------------------------------------------------------
-- Normalisation d'une liste de derniers entretiens déclarés.
-- Jette ce qui n'apprend rien (ni km ni date), borne les valeurs, garde au
-- plus 12 lignes. Rien n'est inventé : un libellé non reconnu est refusé.
-- ---------------------------------------------------------------------
create or replace function public._maintenance_clean_declared_services(_in jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by ord) filter (where x is not null), '[]'::jsonb)
  from (
    select row_number() over () ord,
           case
             when public.maintenance_service_family(e->>'label') = '' then null
             when (e->>'km') is null and (e->>'date') is null then null
             else jsonb_build_object(
                    'label',  btrim(e->>'label'),
                    'family', public.maintenance_service_family(e->>'label'),
                    'km',     case when (e->>'km') ~ '^\d{1,7}$'
                                   and (e->>'km')::integer between 0 and 2000000
                                   then (e->>'km')::integer end,
                    'date',   case when (e->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
                                   and (e->>'date')::date between date '1950-01-01' and current_date
                                   then (e->>'date')::date end)
           end x
    from jsonb_array_elements(case when jsonb_typeof(_in) = 'array' then _in else '[]'::jsonb end) e
    limit 12
  ) s
  where x is not null
    -- après bornage, une ligne sans km ET sans date n'apprend plus rien
    and ((x->>'km') is not null or (x->>'date') is not null);
$$;

-- ---------------------------------------------------------------------
-- Le client déclare son kilométrage et ses derniers entretiens.
--
-- Appelée juste après `portal_declare_vehicle` (portail connecté) ou
-- `signup_register` (inscription publique, avec la clé de service). On ne
-- touche PAS à la signature de ces deux fonctions : elles sont vérifiées
-- nominativement par des tests d'étanchéité.
-- ---------------------------------------------------------------------
create or replace function public.portal_declare_vehicle_maintenance(
  p_declaration uuid,
  p_mileage_km  integer default null,
  p_services    jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d   public.contact_declared_vehicles%rowtype;
  ctx record;
  cl  jsonb;
begin
  select * into d from public.contact_declared_vehicles where id = p_declaration;
  if not found then
    raise exception 'Déclaration introuvable.' using errcode = '42501';
  end if;

  -- Le client ne complète que SES déclarations ; l'équipe celles de sa société.
  if not public.is_member(d.company_id) then
    select * into ctx from public._portal_ctx();
    if ctx.contact_id is null or ctx.contact_id <> d.contact_id then
      raise exception 'Accès refusé.' using errcode = '42501';
    end if;
  end if;

  if p_mileage_km is not null and (p_mileage_km < 0 or p_mileage_km > 2000000) then
    raise exception 'Kilométrage invalide.' using errcode = '22023';
  end if;

  cl := public._maintenance_clean_declared_services(p_services);

  update public.contact_declared_vehicles
     set mileage_km    = coalesce(p_mileage_km, mileage_km),
         last_services = cl
   where id = p_declaration;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (d.company_id, auth.uid(), 'declared_vehicle_maintenance', 'contact_declared_vehicle',
          p_declaration::text, 'portal',
          jsonb_build_object('mileage_km', p_mileage_km, 'services', cl));
end $$;

revoke all on function public.portal_declare_vehicle_maintenance(uuid, integer, jsonb) from public, anon;
grant execute on function public.portal_declare_vehicle_maintenance(uuid, integer, jsonb) to authenticated, service_role;

-- Variante inscription : la déclaration vient d'être créée par `signup_register`,
-- le client n'a pas encore de session. Réservée à la clé de service.
create or replace function public.signup_declare_vehicle_maintenance(
  _company      uuid,
  _contact      uuid,
  _mileage_km   integer default null,
  _services     jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  did uuid;
  cl  jsonb;
begin
  select id into did from public.contact_declared_vehicles
   where company_id = _company and contact_id = _contact
   order by created_at desc limit 1;
  if did is null then return null; end if;

  if _mileage_km is not null and (_mileage_km < 0 or _mileage_km > 2000000) then
    _mileage_km := null;      -- à l'inscription on n'échoue pas sur une faute de frappe
  end if;
  cl := public._maintenance_clean_declared_services(_services);

  update public.contact_declared_vehicles
     set mileage_km = coalesce(_mileage_km, mileage_km), last_services = cl
   where id = did;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, null, 'declared_vehicle_maintenance', 'contact_declared_vehicle', did::text, 'signup',
          jsonb_build_object('mileage_km', _mileage_km, 'services', cl));
  return did;
end $$;

revoke all on function public.signup_declare_vehicle_maintenance(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.signup_declare_vehicle_maintenance(uuid, uuid, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Quand l'équipe valide la déclaration (rattachement à une moto existante ou
-- création d'une fiche), le kilométrage et les entretiens déclarés SUIVENT
-- jusqu'à la moto. C'est ce qui alimente le calcul de la carte 4.
--
-- Un trigger, pour que les deux chemins existants
-- (`declared_vehicle_attach` et `declared_vehicle_create`) en profitent sans
-- être réécrits.
-- ---------------------------------------------------------------------
create or replace function public.trg_declared_vehicle_carry_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare e jsonb; fam text; n int := 0;
begin
  if new.vehicle_id is null or (old.vehicle_id is not null and old.vehicle_id = new.vehicle_id) then
    return new;
  end if;

  -- Kilométrage : on ne remplace jamais un relevé déjà présent.
  if new.mileage_km is not null then
    update public.vehicles
       set mileage = new.mileage_km,
           mileage_qualif = coalesce(mileage_qualif, 'nc'),
           updated_at = now()
     where id = new.vehicle_id and coalesce(mileage, 0) = 0;
  end if;

  -- Derniers entretiens déclarés → historique de la moto, sans doublon.
  for e in select * from jsonb_array_elements(coalesce(new.last_services, '[]'::jsonb)) loop
    fam := coalesce(e->>'family', public.maintenance_service_family(e->>'label'));
    if fam is null or fam = '' then continue; end if;
    insert into public.vehicle_service_history
      (company_id, vehicle_id, service_family, service_label, km, event_date, source, note)
    select new.company_id, new.vehicle_id, fam, coalesce(e->>'label', fam),
           nullif(e->>'km', '')::integer, nullif(e->>'date', '')::date,
           'declare_client', 'Déclaré par le client à l''enregistrement de sa moto'
    where (nullif(e->>'km', '') is not null or nullif(e->>'date', '') is not null)
      and not exists (
        select 1 from public.vehicle_service_history h
         where h.vehicle_id = new.vehicle_id and h.service_family = fam
           and h.source = 'declare_client');
    n := n + 1;
  end loop;

  if new.mileage_km is not null or n > 0 then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (new.company_id, auth.uid(), 'vehicle_maintenance_carried', 'vehicle', new.vehicle_id::text, 'dms',
            jsonb_build_object('declaration', new.id, 'mileage_km', new.mileage_km,
                               'services', coalesce(new.last_services, '[]'::jsonb)));
  end if;
  return new;
end $$;

drop trigger if exists trg_declared_vehicle_carry_maintenance on public.contact_declared_vehicles;
create trigger trg_declared_vehicle_carry_maintenance
  after update of vehicle_id on public.contact_declared_vehicles
  for each row execute function public.trg_declared_vehicle_carry_maintenance();

-- ---------------------------------------------------------------------
-- La liste COURTE d'entretiens à proposer au client pour sa moto.
-- Sans jargon : le libellé du programme, sans code ni UT. Si on ne connaît pas
-- encore son modèle, une liste de repli volontairement minimale.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_declarable_services(_model_year text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with fromdb as (
    select distinct public.maintenance_service_family(w.name) fam, min(w.sort) sort,
           min(w.name) label
    from public.wsm_manual_catalog_links l
    join public.wsm_services w on w.manual_id = l.manual_id
    where _model_year is not null and l.model_year_id = _model_year and l.status = 'lie'
      and public.maintenance_is_real_service(w.name)
      and w.code !~ '^[0-9]+_(km|mi)$'        -- une grille kilométrique ne se déclare pas au client
    group by public.maintenance_service_family(w.name)
  ), fallback as (
    -- Repli : les quatre entretiens que tout propriétaire de Ducati reconnaît.
    select * from (values
      ('premier_1000', 0, 'Révision des 1 000 km'),
      ('oil',          1, 'Oil Service'),
      ('desmo',        2, 'Desmo Service'),
      ('annual',       3, 'Entretien annuel')
    ) v(fam, sort, label)
  )
  select coalesce(
    (select jsonb_agg(jsonb_build_object('family', fam, 'label', label) order by sort)
       from fromdb having count(*) > 0),
    (select jsonb_agg(jsonb_build_object('family', fam, 'label', label) order by sort) from fallback));
$$;

-- Pas de grant à `anon` (alerte 1 du scan du 18/09) : l'inscription publique affiche sa propre
-- liste courte, cette fonction ne sert qu'à l'équipe connectée et au portail client.
revoke all on function public.maintenance_declarable_services(text) from public, anon;
grant execute on function public.maintenance_declarable_services(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Formatage fr-BE pour les textes générés en base (séparateur de milliers =
-- espace, décimale = virgule) — la charte l'exige aussi côté écran.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_fmt_int(_n numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when _n is null then '' else
    btrim(replace(to_char(round(_n), 'FM999G999G999'), ',', ' ')) end;
$$;

create or replace function public.maintenance_fmt_money(_n numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when _n is null then '' else
    replace(replace(btrim(to_char(round(_n, 2), 'FM999G999G990D00')), ',', ' '), '.', ',') end;
$$;

grant execute on function public.maintenance_fmt_int(numeric)   to authenticated, service_role;
grant execute on function public.maintenance_fmt_money(numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- CORRECTIF — le tarif horaire atelier n'était jamais lu.
--
-- Mesuré le 05/10 en production : la ligne de réglage porte le code
-- **'DIAGNOSTIC'** (majuscules), alors que `maintenance_hourly_rate_ht` et
-- `resolveQuoteFeeParams` (TypeScript) la cherchent en **'diagnostic'**. Le
-- tarif horaire était donc toujours introuvable → repli silencieux sur
-- l'article MO, et « Taux horaire HT : À saisir » sur l'écran des plans
-- d'entretien alors qu'une valeur était enregistrée.
--
-- On compare désormais sans tenir compte de la casse, des deux côtés
-- (le correctif TypeScript est dans src/modules/workshop/quote-fees.ts).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_hourly_rate_ht(_company uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  select public._dc_num(rv.extra -> 'hourly_rate_ht') into v
    from public.reference_values rv
   where rv.company_id = _company and rv.table_key = 'workshop_quote_fee'
     and lower(rv.code) = 'diagnostic'          -- la donnée en production est 'DIAGNOSTIC'
     and coalesce(rv.is_active, true)
   limit 1;
  if v is null or v <= 0 then
    select a.sale_price_ht into v from public.articles a
     where a.company_id = _company and a.reference = 'MO' and a.mgmt_type = 'T'
     order by a.created_at limit 1;
  end if;
  return case when v is null or v <= 0 then null else v end;
end $$;

-- Taux horaire atelier : 90 € HTVA (décision M-20, Simon, chat du 21/09 —
-- « à enregistrer dans Paramètres → Tables → Frais de devis atelier →
-- diagnostic → Tarif horaire HTVA »). On applique la décision déjà prise, et
-- SEULEMENT si le tarif horaire est encore vide ou nul : une valeur déjà
-- saisie n'est jamais écrasée, et `amount_ht` n'est pas touché.
-- Sans ce taux, la main-d'œuvre du devis estimé ne peut pas être calculée.
update public.reference_values
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('hourly_rate_ht', 90),
       updated_at = now()
 where table_key = 'workshop_quote_fee' and lower(code) = 'diagnostic'
   and coalesce((extra->>'hourly_rate_ht')::numeric, 0) <= 0;

-- =====================================================================
-- CARTE 6 — rendez-vous d'entretien : temps officiel bloqué + devis estimé
-- =====================================================================

-- Le RDV garde l'entretien qui l'a motivé et l'estimation montrée au client.
-- On réutilise `workshop_appointments` (planning et demandes du portail) :
-- 4 colonnes, pas une seconde table.
alter table public.workshop_appointments
  add column if not exists maintenance_service_code  text,
  add column if not exists maintenance_service_label text,
  add column if not exists maintenance_estimate_ht   numeric(14,2),
  add column if not exists maintenance_estimate      jsonb;

comment on column public.workshop_appointments.maintenance_service_code is
  'Entretien qui a motivé le RDV (mission 07, carte 6).';
comment on column public.workshop_appointments.maintenance_estimate is
  'Photo du devis estimé au moment du RDV : temps UT, main-d''œuvre, pièces du kit (mission 07, carte 6).';

-- ---------------------------------------------------------------------
-- Le devis estimé d'un entretien pour une moto.
--
--  temps     : le TEMPS OFFICIEL Ducati de l'échéance (wsm_times, 1 UT = 6 min),
--              repli sur le temps du plan PDF. Jamais inventé : null si absent.
--  main-d'œuvre = heures × taux horaire HT
--              (réglage « Frais de devis atelier → diagnostic », M-20 : 90 € HT)
--  pièces    : le kit d'entretien de la famille de moteur de la moto
--              (maintenance_kits / maintenance_kit_items, livrés le 23/09),
--              au prix de vente HT de l'article du DMS.
--
-- Une ligne sans prix connu est renvoyée telle quelle, à 0 €, marquée
-- `priced: false` : l'atelier voit ce qui manque au lieu d'un total faux.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_estimate_for_vehicle(
  _vehicle uuid,
  _service text default null        -- code d'échéance ; null = l'entretien dû
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v        public.vehicles%rowtype;
  due      record;
  rate     numeric;
  ut       integer;
  minutes  integer;
  hours    numeric;
  labour   numeric;
  kit      record;
  parts    jsonb := '[]'::jsonb;
  parts_ht numeric := 0;
  missing  integer := 0;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  if _service is null then
    select * into due from public.maintenance_vehicle_next n where n.vehicle_id = _vehicle;
  else
    select * into due from public.maintenance_vehicle_due d
     where d.vehicle_id = _vehicle and d.service_code = _service
     order by d.sort limit 1;
  end if;
  if not found then
    return jsonb_build_object('vehicleId', _vehicle, 'found', false,
                              'reason', 'Aucun entretien calculable pour cette moto.');
  end if;

  rate := public.maintenance_hourly_rate_ht(v.company_id);
  ut   := due.ut;
  minutes := case when ut is not null then ut * 6 end;        -- M-33 : 1 UT = 6 minutes
  hours   := case when minutes is not null then round(minutes / 60.0, 2) end;
  labour  := case when hours is not null and rate is not null and rate > 0
                  then round(hours * rate, 2) end;

  -- Pièces : le kit de la famille de moteur de ce modèle-année, pour cette échéance.
  select k.* into kit
  from public.maintenance_kits k
  join public.maintenance_kit_model_years my on my.kit_id = k.id
  where k.company_id = v.company_id and k.status = 'actif'
    and my.model_year_id = v.ducati_model_year_id
    and public.maintenance_service_family(k.service_label) = due.service_family
  order by k.version desc limit 1;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
             'reference', i.reference, 'designation', i.designation,
             'quantity', i.quantity, 'unit', i.unit, 'kind', i.kind,
             'confidence', i.confidence, 'articleId', i.article_id,
             'unitPriceHt', a.sale_price_ht,
             'lineHt', case when a.sale_price_ht is not null
                            then round(a.sale_price_ht * i.quantity, 2) end,
             'priced', a.sale_price_ht is not null)
             order by i.sort_order), '[]'::jsonb),
           coalesce(sum(case when a.sale_price_ht is not null
                             then round(a.sale_price_ht * i.quantity, 2) end), 0),
           count(*) filter (where a.sale_price_ht is null)
      into parts, parts_ht, missing
    from public.maintenance_kit_items i
    left join public.articles a on a.id = i.article_id
    where i.kit_id = kit.id;
  end if;

  return jsonb_build_object(
    'vehicleId', _vehicle, 'found', true,
    'serviceCode', due.service_code, 'serviceLabel', due.service_label,
    'serviceFamily', due.service_family, 'source', due.source,
    'confidence', due.confidence, 'reached', due.reached,
    'dueKm', due.due_km, 'dueDate', due.due_date, 'firstTrigger', due.first_trigger,
    'ut', ut, 'minutes', minutes, 'hours', hours,
    'hourlyRateHt', rate, 'labourHt', labour,
    'kitId', case when kit.id is not null then kit.id end,
    'kitVersion', kit.version,
    'parts', parts, 'partsHt', parts_ht, 'partsWithoutPrice', missing,
    'totalHt', coalesce(labour, 0) + coalesce(parts_ht, 0),
    -- l'estimation est complète seulement si le temps ET tous les prix sont là
    'complete', (labour is not null and coalesce(missing, 0) = 0 and kit.id is not null));
end $$;

revoke all on function public.maintenance_estimate_for_vehicle(uuid, text) from public, anon;
grant execute on function public.maintenance_estimate_for_vehicle(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Poser le RDV d'entretien au planning, avec le temps officiel bloqué.
-- Réutilise `workshop_appointments` : pas de nouvelle table, pas de nouveau
-- planning. `planned_minutes` vient du temps Ducati (défaut 60 min si le
-- manuel ne donne pas de temps — on ne bloque pas un créneau inventé plus long).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_appointment_create(
  _vehicle   uuid,
  _starts_at timestamptz,
  _service   text default null,
  _mechanic  text default null,
  _notes     text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v    public.vehicles%rowtype;
  est  jsonb;
  cid    uuid;
  mins   integer;
  new_id uuid;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _starts_at is null then
    raise exception 'Donnez la date et l''heure du rendez-vous.' using errcode = '22023';
  end if;

  est := public.maintenance_estimate_for_vehicle(_vehicle, _service);
  if not (est->>'found')::boolean then
    raise exception '%', est->>'reason' using errcode = '22023';
  end if;

  mins := coalesce((est->>'minutes')::integer, 60);
  select o.contact_id into cid from public.vehicle_owners o
   where o.vehicle_id = _vehicle and o.is_current limit 1;

  insert into public.workshop_appointments
    (company_id, contact_id, vehicle_id, mechanic_name, starts_at, planned_minutes,
     work_description, reception_notes, status, source,
     maintenance_service_code, maintenance_service_label,
     maintenance_estimate_ht, maintenance_estimate)
  values (v.company_id, cid, _vehicle, nullif(btrim(coalesce(_mechanic, '')), ''),
          _starts_at, mins,
          est->>'serviceLabel', nullif(btrim(coalesce(_notes, '')), ''),
          'prevu', 'entretien',
          est->>'serviceCode', est->>'serviceLabel',
          (est->>'totalHt')::numeric, est)
  returning id into new_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (v.company_id, auth.uid(), 'maintenance_appointment_created', 'workshop_appointment', new_id::text, 'dms',
          jsonb_build_object('vehicle', _vehicle, 'service', est->>'serviceCode',
                             'minutes', mins, 'estimateHt', est->>'totalHt'));
  return new_id;
end $$;

revoke all on function public.maintenance_appointment_create(uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.maintenance_appointment_create(uuid, timestamptz, text, text, text) to authenticated, service_role;

-- =====================================================================
-- CARTE 7 — relances d'entretien
--
-- CE QUE CETTE MIGRATION FAIT : une cloche par rôle et un message PRÉPARÉ.
-- CE QU'ELLE NE FAIT PAS : envoyer. Aucun insert dans `notifications` (la file
-- d'envoi e-mail / SMS traitée par `dispatch-notifications`), aucun appel de
-- fonction serveur d'envoi. L'envoi réel est interdit sans accord explicite de
-- Simon dans le chat.
-- =====================================================================

-- Le type de notification « entretien dû » est visible par le commercial et
-- par l'atelier (décision « cloche par rôle » de la carte 7).
-- `can_see_team_notification` est recréée en gardant tous les cas existants.
create or replace function public.can_see_team_notification(_company uuid, _kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case _kind
    when 'signup' then
      public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'marketing')
    when 'client_iban_changed' then
      public.has_role(_company, 'admin') or public.has_role(_company, 'comptable')
      or public.has_role(_company, 'vendeur')
    when 'vehicle_declared' then
      public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
    when 'order_after_deposit' then public.has_role(_company, 'admin')
    when 'unpaid_balance'     then public.has_role(_company, 'admin')
    when 'web_order' then
      public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
    -- mission 07, carte 7 : entretien qui arrive ou dépassé
    when 'maintenance_due' then
      public.has_role(_company, 'admin') or public.has_role(_company, 'vendeur')
      or public.has_role(_company, 'mecanicien') or public.has_role(_company, 'chef_atelier')
    else public.is_member(_company)
  end;
$$;

-- `team_notifications.kind` est contraint : on y ajoute le nouveau type.
alter table public.team_notifications
  drop constraint if exists team_notifications_kind_check;

alter table public.team_notifications
  add constraint team_notifications_kind_check
  check (kind in ('client_iban_changed', 'order_after_deposit', 'signup',
                  'unpaid_balance', 'vehicle_declared', 'web_order',
                  'maintenance_due'));

-- ---------------------------------------------------------------------
-- Le message de relance, PRÉPARÉ et jamais envoyé.
-- Texte FR, tutoiement exclu, pas de montant si l'estimation est incomplète.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_reminder_message(_vehicle uuid, _service text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v    public.vehicles%rowtype;
  due  record;
  est  jsonb;
  who  text;
  moto text;
  body text;
  when_txt text;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  if _service is null then
    select * into due from public.maintenance_vehicle_next n where n.vehicle_id = _vehicle;
  else
    select * into due from public.maintenance_vehicle_due d
     where d.vehicle_id = _vehicle and d.service_code = _service order by d.sort limit 1;
  end if;
  if not found then
    return jsonb_build_object('found', false,
                              'reason', 'Aucun entretien calculable pour cette moto.');
  end if;

  select coalesce(public.maintenance_contact_name(o.contact_id), 'Madame, Monsieur') into who
    from public.vehicle_owners o where o.vehicle_id = _vehicle and o.is_current limit 1;
  who  := coalesce(who, 'Madame, Monsieur');
  moto := btrim(coalesce(v.brand, '') || ' ' || coalesce(v.model, ''));
  if moto = '' then moto := 'votre moto'; end if;

  when_txt := case
    when due.reached and due.confidence = 'exact' then 'est dépassé'
    when due.due_date is not null and due.first_trigger = 'mois'
      then 'est prévu pour le ' || to_char(due.due_date, 'DD/MM/YYYY')
    when due.due_km is not null
      then 'est prévu à ' || public.maintenance_fmt_int(due.due_km) || ' km'
    else 'approche'
  end;

  est := public.maintenance_estimate_for_vehicle(_vehicle, due.service_code);

  body := who || ',' || chr(10) || chr(10)
       || 'Le ' || due.service_label || ' de ' || moto || ' ' || when_txt || '.' || chr(10)
       || case when due.confidence = 'estime'
               then 'Cette échéance est une estimation : si vous avez fait cet entretien ailleurs, dites-le nous et nous la corrigeons.' || chr(10)
               else '' end
       || case when (est->>'found')::boolean and (est->>'complete')::boolean
               then chr(10) || 'À titre indicatif, cet entretien représente environ '
                    || replace(to_char((est->>'hours')::numeric, 'FM990D0'), '.', ',') || ' h d''atelier, '
                    || 'pour un montant estimé de '
                    || public.maintenance_fmt_money((est->>'totalHt')::numeric) || ' € HT.' || chr(10)
               else '' end
       || chr(10) || 'Souhaitez-vous que nous vous réservions un créneau à l''atelier ?' || chr(10) || chr(10)
       || 'Ducati Bruxelles — Atelier';

  return jsonb_build_object(
    'found', true,
    'vehicleId', _vehicle,
    'serviceCode', due.service_code, 'serviceLabel', due.service_label,
    'confidence', due.confidence, 'reached', due.reached,
    'subject', 'Entretien de votre ' || moto || ' — ' || due.service_label,
    'body', body,
    'estimate', est,
    -- GARDE-FOU : l'envoi réel est interdit sans accord explicite de Simon.
    'sendingEnabled', false,
    'sendingBlockedReason', 'L''envoi d''e-mails et de SMS de relance est désactivé : il demande l''accord explicite du client.');
end $$;

revoke all on function public.maintenance_reminder_message(uuid, text) from public, anon;
grant execute on function public.maintenance_reminder_message(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Poser les cloches : une notification par moto dont l'entretien arrive ou est
-- dépassé. `dedupe_key` empêche le doublon ; relancer la fonction ne crée rien
-- de nouveau tant que l'échéance n'a pas changé.
-- Rien n'est envoyé.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_reminders_refresh(
  _company uuid,
  _days    integer default 60,
  _limit   integer default 200
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dys     int := least(greatest(coalesce(_days, 60), 0), 1095);
  lim     int := least(greatest(coalesce(_limit, 200), 1), 1000);
  created int := 0;
  seen    int := 0;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if not (public.has_role(_company, 'admin') or public.has_role(_company, 'chef_atelier')
          or public.has_role(_company, 'vendeur')) then
    raise exception 'Réservé à l''administrateur, au chef d''atelier ou au commercial.' using errcode = '42501';
  end if;

  with cand as (
    select n.*, v.brand, v.model, v.vin
    from public.maintenance_vehicle_next n
    join public.vehicles v on v.id = n.vehicle_id
    where n.company_id = _company
      and ((n.reached and n.confidence = 'exact')
           or (n.days_left is not null and n.days_left <= dys))
    order by n.reached desc, n.days_left nulls last
    limit lim
  ), ins as (
    insert into public.team_notifications
      (company_id, kind, contact_id, title, origin, payload, dedupe_key)
    select _company, 'maintenance_due',
           (select o.contact_id from public.vehicle_owners o
             where o.vehicle_id = c.vehicle_id and o.is_current limit 1),
           btrim(coalesce(c.brand, '') || ' ' || coalesce(c.model, '')) || ' — ' || c.service_label,
           'comptoir',       -- origin n'accepte que 'web' ou 'comptoir'
           jsonb_build_object('vehicleId', c.vehicle_id, 'vin', c.vin,
                              'serviceCode', c.service_code, 'serviceLabel', c.service_label,
                              'dueKm', c.due_km, 'dueDate', c.due_date,
                              'reached', c.reached, 'confidence', c.confidence,
                              'daysLeft', c.days_left, 'ut', c.ut),
           'maintenance_due:' || c.vehicle_id || ':' || c.service_code
             || ':' || coalesce(c.due_km::text, '') || ':' || coalesce(c.due_date::text, '')
    from cand c
    -- l'index unique est partiel (uq_team_notifications_dedupe ... where dedupe_key is not null)
    on conflict (company_id, kind, dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select (select count(*) from cand), (select count(*) from ins) into seen, created;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'maintenance_reminders_refreshed', 'company', _company::text, 'dms',
          jsonb_build_object('candidates', seen, 'created', created, 'days', dys, 'sent', false));

  return jsonb_build_object('candidates', seen, 'created', created, 'days', dys,
                            'sent', false,
                            'note', 'Cloche seulement : aucun e-mail ni SMS n''a été envoyé.');
end $$;

revoke all on function public.maintenance_reminders_refresh(uuid, integer, integer) from public, anon;
grant execute on function public.maintenance_reminders_refresh(uuid, integer, integer) to authenticated, service_role;
