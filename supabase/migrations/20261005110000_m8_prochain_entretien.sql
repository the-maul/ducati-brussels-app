-- =====================================================================
-- Mission 07 — carte 4 : « Prochain entretien de chaque moto »
--
-- Objectif : pour chaque moto, dire quel entretien est dû, quand (date ou km
-- prévisionnel) et avec quel temps officiel Ducati — pour l'afficher sur la
-- fiche moto, la fiche client et une liste « Entretiens à venir ».
--
-- Décisions reprises :
--  - M-16 (Simon, 21/09) : **échéance au PREMIER ATTEINT (km ou mois)**, partout.
--  - M-16 : le document le plus récent fait foi → on ne lit que les valeurs
--    « en vigueur » des plans ; les valeurs historiques ne sont jamais choisies.
--  - M-20 : l'entretien dépend de l'**usage** choisi par le client
--    (route / piste amateur / racing) ; route par défaut.
--  - M-33 : 1 UT = 6 minutes (barème Ducati).
--
-- DEUX SOURCES de programme d'entretien, dans cet ordre :
--  1. le **manuel d'atelier** (wsm_*) du modèle-année, rattaché au catalogue
--     (wsm_manual_catalog_links.status = 'lie') : c'est la source la plus
--     détaillée et la seule qui donne un temps UT réel. Elle ne connaît pas
--     l'usage.
--  2. le **plan d'entretien** issu des fiches PDF (maintenance_*), rattaché au
--     catalogue (maintenance_plan_catalog_links.status = 'lie') : c'est la
--     seule source qui connaît l'usage (piste amateur, racing).
--  → usage ≠ route : le plan de cet usage d'abord, le manuel en repli.
--  → usage = route : le manuel d'abord, le plan de route en repli.
--
-- DEUX FORMES d'échéance dans les manuels (mesuré le 05/10 : 229 manuels
-- « nommés » / 232 en « grille kilométrique », décision M-30) :
--  a. **échéance nommée** (Oil Service, Desmo Service, Valve Check, Annual
--     Service…) : `km` est un INTERVALLE qui se répète (toutes les 15 000 km),
--     `months` un intervalle en mois (tous les 12 mois).
--  b. **grille kilométrique** (codes « 1000_km », « 15000_km », « 30000_km »…) :
--     `km` est un JALON ABSOLU au compteur, qui ne se répète pas.
--  Les deux formes sont traitées ici ; rien n'est inventé pour l'autre.
--
-- Le **premier entretien** (1 000 km, `first_service`) ne se répète pas :
-- une fois fait, il n'est plus dû.
--
-- Cette migration est ADDITIVE : 1 table, 1 vue, 7 fonctions. Elle ne modifie
-- aucune table existante et ne déplace aucune donnée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Historique d'entretien connu d'une moto
--
--    Trois origines, une seule table :
--     - 'declare_client'  : le client l'a dit à l'inscription ou dans
--                           « Ajouter ma moto » (carte 5) ;
--     - 'declare_comptoir': saisi par l'équipe sur la fiche moto ;
--     - 'import'          : historique repris de G8 ou d'un autre système ;
--     - 'my_ducati'       : entretien remonté du portail Ducati.
--    Les entretiens FAITS CHEZ NOUS ne sont pas recopiés ici : ils sont lus
--    directement dans workshop_journeys (parcours terminé) — une seule vérité.
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_service_history (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  vehicle_id     uuid not null references public.vehicles(id) on delete cascade,
  service_family text not null,                 -- clé de rapprochement (oil, desmo, valve, annual, premier_1000…)
  service_label  text not null,                 -- libellé montré au client
  km             integer check (km is null or (km >= 0 and km <= 2000000)),
  event_date     date check (event_date is null or event_date >= date '1950-01-01'),
  source         text not null check (source in ('declare_client', 'declare_comptoir', 'import', 'my_ducati')),
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  -- Au moins un repère, sinon la ligne n'apprend rien.
  constraint vsh_has_mark check (km is not null or event_date is not null)
);

create index if not exists vehicle_service_history_vehicle_idx
  on public.vehicle_service_history (vehicle_id, service_family, event_date desc nulls last, km desc nulls last);
create index if not exists vehicle_service_history_company_idx
  on public.vehicle_service_history (company_id);

alter table public.vehicle_service_history enable row level security;

do $$ begin
  create policy vsh_read on public.vehicle_service_history
    for select using (public.is_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy vsh_write on public.vehicle_service_history
    for all using (public.is_member(company_id)) with check (public.is_member(company_id));
exception when duplicate_object then null; end $$;

comment on table public.vehicle_service_history is
  'Entretiens connus d''une moto hors DMS : déclarés par le client, saisis au comptoir, importés ou remontés de My Ducati (mission 07, carte 4).';

-- ---------------------------------------------------------------------
-- 2. Famille d'entretien
--
--    Le manuel, les plans PDF et le client n'écrivent pas le même entretien de
--    la même façon : « First Service 1000 », « Oil Service 1000 » et
--    « Service 1000 » désignent le premier entretien ; « Temporel » et
--    « Annual Service » l'entretien annuel. Cette fonction est le MIROIR EXACT
--    de `serviceFamily()` de src/modules/workshop/journey/rules.ts — les deux
--    sont vérifiées sur les mêmes cas (tests/maintenance-due.test.ts).
-- ---------------------------------------------------------------------
create or replace function public.maintenance_service_family(_s text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with n as (
    select btrim(regexp_replace(
             lower(public.unaccent(coalesce(_s, ''))),
             '[^a-z0-9]+', ' ', 'g')) v
  ), c as (
    select btrim(regexp_replace(regexp_replace(v, '\yinterventions?\y', '', 'g'), '\s+', ' ', 'g')) v from n
  )
  select case
    when v = '' then ''
    -- premier entretien des 1 000 km
    when v ~ '\y(first|1000|premier)\y' and v ~ '\y(service|1000)\y' and v ~ '\y1000\y' then 'premier_1000'
    when v ~ '\ydesmo\y'                     then 'desmo'
    when v ~ '\y(valve|soupape)\y'           then 'valve'
    when v ~ '\y(annual|annuel|temporel|temps mois|temps)\y' then 'annual'
    when v ~ '\yoil\y'                       then 'oil'
    else coalesce(nullif(btrim(regexp_replace(v, '\s*\d+\s*$', '')), ''), v)
  end from c;
$$;

grant execute on function public.maintenance_service_family(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. En-têtes de colonnes à ne pas prendre pour des entretiens
--    (« km x 1000 », « mi x 1000 », « Temps (mois) ») — miroir de
--    `isRealService()` des règles TypeScript.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_is_real_service(_s text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with n as (
    select btrim(regexp_replace(lower(public.unaccent(coalesce(_s, ''))), '[^a-z0-9]+', ' ', 'g')) v
  )
  select case
    when v = '' then false
    when v ~ '^(km|mi|miles) ?(x)? ?\d*$' then false
    when v ~ '^temps ?(mois|heures)?$'    then false
    when v = 'mois'                        then false
    else true
  end from n;
$$;

grant execute on function public.maintenance_is_real_service(text) to authenticated, service_role;

-- Nom affichable d'un client (société, sinon prénom + nom, sinon code).
create or replace function public.maintenance_contact_name(_contact uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
           nullif(btrim(coalesce(c.company_name, '')), ''),
           nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
           c.code)
  from public.contacts c where c.id = _contact;
$$;

grant execute on function public.maintenance_contact_name(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Le programme d'entretien d'une moto, échéance par échéance
--
--    Une ligne par échéance du programme retenu pour la moto, avec son
--    intervalle, son temps officiel et le dernier entretien connu de cette
--    famille. Le calcul « premier atteint » est fait au point 5.
--
--    `_scope` restreint le balayage : 'vehicle' (une moto), 'company' (toutes
--    les motos actives de la société). Le travail est fait en SQL ensembliste
--    pour tenir très en dessous du statement_timeout de 8 s de PostgREST.
-- ---------------------------------------------------------------------
create or replace view public.maintenance_vehicle_program as
with veh as (
  select v.id            as vehicle_id,
         v.company_id,
         v.ducati_model_year_id as model_year_id,
         v.mileage,
         v.first_registration_date,
         coalesce(nullif(v.maintenance_usage, ''), 'route') as usage
  from public.vehicles v
  where v.is_active and v.ducati_model_year_id is not null
),
-- Manuel d'atelier retenu pour le modèle-année : le plus récent, puis le plus petit id (déterministe).
man as (
  select distinct on (w.model_year_id) w.model_year_id, w.manual_id
  from public.wsm_manual_catalog_links w
  join public.wsm_manuals m on m.id = w.manual_id
  where w.status = 'lie'
  order by w.model_year_id, m.model_year desc nulls last, m.id
),
-- Plan PDF retenu par modèle-année ET par usage.
pln as (
  select distinct on (l.model_year_id, p.usage) l.model_year_id, p.usage, p.id as plan_id
  from public.maintenance_plan_catalog_links l
  join public.maintenance_plans p on p.id = l.plan_id
  where l.status = 'lie'
  order by l.model_year_id, p.usage, p.year_from desc nulls last, p.id
),
-- Source retenue : usage ≠ route → le plan de cet usage d'abord ; sinon le manuel d'abord.
src as (
  select v.*,
         case
           when v.usage <> 'route' and pu.plan_id is not null then 'plan'
           when man.manual_id is not null                      then 'manuel'
           when pr.plan_id is not null                          then 'plan'
           when pu.plan_id is not null                          then 'plan'
         end as source,
         case
           when v.usage <> 'route' and pu.plan_id is not null then pu.plan_id
           when man.manual_id is not null                      then null
           when pr.plan_id is not null                          then pr.plan_id
           else pu.plan_id
         end as plan_id,
         case when (v.usage = 'route' or pu.plan_id is null) then man.manual_id end as manual_id
  from veh v
  left join man             on man.model_year_id = v.model_year_id
  left join pln pu          on pu.model_year_id = v.model_year_id and pu.usage = v.usage
  left join pln pr          on pr.model_year_id = v.model_year_id and pr.usage = 'route'
),
-- Échéances venant du manuel d'atelier.
svc_man as (
  select s.vehicle_id, s.company_id, s.model_year_id, s.usage, s.mileage, s.first_registration_date,
         'manuel'::text as source,
         w.code  as service_code,
         w.name  as service_label,
         public.maintenance_service_family(w.name) as service_family,
         -- forme b : code « 15000_km » → jalon absolu au compteur
         (w.code ~ '^[0-9]+_(km|mi)$')             as is_grid,
         w.km                                      as km_value,
         w.months                                  as months,
         coalesce(w.first_service, false)          as is_first,
         w.sort                                    as sort,
         (select max(coalesce(t.ut, ceil(t.minutes / 6.0)::integer))
            from public.wsm_times t
           where t.manual_id = w.manual_id and t.service_code = w.code) as ut
  from src s
  join public.wsm_services w on w.manual_id = s.manual_id
  where s.source = 'manuel' and public.maintenance_is_real_service(w.name)
),
-- Échéances venant du plan PDF : seules les valeurs « en vigueur » (M-16).
svc_pln as (
  select s.vehicle_id, s.company_id, s.model_year_id, s.usage, s.mileage, s.first_registration_date,
         'plan'::text as source,
         ps.code  as service_code,
         ps.name  as service_label,
         public.maintenance_service_family(ps.name) as service_family,
         false    as is_grid,
         coalesce(iv.km_interval, iv.km_first)      as km_value,
         iv.months                                  as months,
         (iv.km_first is not null and iv.km_interval is null) as is_first,
         ps.sort                                    as sort,
         tm.ut                                      as ut
  from src s
  join public.maintenance_plan_services ps on ps.plan_id = s.plan_id
  left join lateral (
    select i.km_first, i.km_interval, i.months
    from public.maintenance_service_intervals i
    where i.service_id = ps.id and i.status = 'en_vigueur'
    order by i.source_sort desc nulls last, i.sort
    limit 1
  ) iv on true
  left join lateral (
    select t.ut
    from public.maintenance_service_times t
    where t.service_id = ps.id and t.status = 'en_vigueur' and t.ut is not null
    order by t.source_sort desc nulls last, t.sort
    limit 1
  ) tm on true
  where s.source = 'plan' and public.maintenance_is_real_service(ps.name)
    and (iv.km_first is not null or iv.km_interval is not null or iv.months is not null)
)
select * from svc_man
union all
select * from svc_pln;

comment on view public.maintenance_vehicle_program is
  'Une ligne par (moto × échéance de son programme d''entretien), manuel d''atelier d''abord, plan PDF en repli (mission 07, carte 4).';

-- ---------------------------------------------------------------------
-- 5. Dernier entretien connu, par moto et par famille d'entretien
--
--    Trois sources réunies : le parcours d'entretien terminé chez nous
--    (workshop_journeys + km de l'OR), les entretiens My Ducati
--    (vehicle_maintenance) et l'historique déclaré ou importé
--    (vehicle_service_history). Le plus récent gagne — par date, puis par km.
-- ---------------------------------------------------------------------
create or replace view public.maintenance_vehicle_last_service as
with all_src as (
  -- a. fait chez nous : un parcours d'entretien terminé
  select o.vehicle_id,
         public.maintenance_service_family(j.service_label) as service_family,
         o.mileage                        as km,
         (j.finished_at at time zone 'UTC')::date as event_date,
         'parcours'::text                 as origin
  from public.workshop_journeys j
  join public.repair_orders o on o.id = j.or_id
  where j.finished_at is not null and o.vehicle_id is not null

  union all
  -- b. remonté du portail Ducati
  select m.vehicle_id,
         public.maintenance_service_family(coalesce(m.service_type, m.kind)) as service_family,
         m.km, m.event_date, 'my_ducati'::text
  from public.vehicle_maintenance m
  where m.event_date is not null or m.km is not null

  union all
  -- c. déclaré par le client, saisi au comptoir ou importé
  select h.vehicle_id, h.service_family, h.km, h.event_date, h.source
  from public.vehicle_service_history h
)
select distinct on (vehicle_id, service_family)
       vehicle_id, service_family, km, event_date, origin
from all_src
where service_family <> ''
order by vehicle_id, service_family, event_date desc nulls last, km desc nulls last;

comment on view public.maintenance_vehicle_last_service is
  'Dernier entretien connu d''une moto par famille : parcours terminé, My Ducati, déclaré/importé — le plus récent gagne (mission 07, carte 4).';

-- ---------------------------------------------------------------------
-- 6. Le calcul : prochaine échéance AU PREMIER ATTEINT
--
--    Miroir exact de `dueForService()` de src/modules/workshop/maintenance-due.ts
--    (tests/maintenance-due.test.ts tient les cas de référence).
--
--    DEUX NIVEAUX DE CERTITUDE — et c'est tout l'intérêt de la carte 5 :
--
--    * `confidence = 'exact'` : on CONNAÎT le dernier entretien de cette
--      famille (parcours terminé chez nous, My Ducati, déclaré ou importé).
--        km dû    = dernier km + intervalle
--        date due = date du dernier entretien + mois
--      Une échéance dépassée est alors un VRAI retard.
--
--    * `confidence = 'estime'` : on ne connaît PAS le dernier entretien. On ne
--      prétend pas qu'une moto de 2007 à 24 538 km doit encore son Oil Service
--      des 15 000 km : on donne la PROCHAINE occurrence après le compteur et
--      après aujourd'hui.
--        km dû    = premier multiple de l'intervalle strictement au-dessus du compteur
--        date due = mise en service + n × mois, le premier n qui dépasse aujourd'hui
--      Une estimation n'est donc JAMAIS « en retard » : on ne peut pas le savoir.
--      C'est précisément ce que la carte 5 vient corriger en demandant au client
--      son kilométrage et ses derniers entretiens.
--
--    Autres règles :
--    - grille kilométrique (jalons absolus) : le jalon déjà fait sort ; sans
--      historique, les jalons déjà passés au compteur sont réputés faits et
--      sortent aussi — seul le prochain jalon est annoncé.
--    - premier entretien (1 000 km) : une fois fait il n'est plus dû ; sans
--      historique, au-delà du jalon il est réputé fait.
--    - atteinte dès que l'une des deux bornes l'est ; `reached_by` dit laquelle.
--    - `km_reached_on` : date d'atteinte du km au rythme de roulage constaté
--      depuis la mise en service ou le dernier entretien ; null si rythme inconnu.
--    - `first_trigger` : ce qui arrivera en premier, km ou mois (M-16).
-- ---------------------------------------------------------------------
create or replace view public.maintenance_vehicle_due as
with p as (
  select g.*,
         l.km         as last_km,
         l.event_date as last_date,
         l.origin     as last_origin
  from public.maintenance_vehicle_program g
  left join public.maintenance_vehicle_last_service l
         on l.vehicle_id = g.vehicle_id and l.service_family = g.service_family
),
b as (
  select p.*,
         (p.last_km is not null or p.last_date is not null) as has_last,
         -- point de départ du compte de kilométrage et du rythme de roulage
         case when (p.last_km is not null or p.last_date is not null) then p.last_km else 0 end as base_km,
         case when (p.last_km is not null or p.last_date is not null) then p.last_date
              else p.first_registration_date end as base_date
  from p
),
d as (
  select b.*,
         -- km dû
         case
           when b.is_grid then b.km_value                       -- jalon absolu au compteur
           when b.km_value is null or b.km_value <= 0 then null
           -- dernier entretien connu : compte exact
           when b.has_last then coalesce(b.base_km, 0) + b.km_value
           -- le premier entretien n'arrive qu'une fois : son jalon ne se reporte pas
           when b.is_first then b.km_value
           -- inconnu, compteur inconnu : la première occurrence depuis 0 km
           when coalesce(b.mileage, 0) <= 0 then b.km_value
           -- inconnu, compteur connu : la première occurrence au-dessus du compteur
           else ((floor(b.mileage::numeric / b.km_value) + 1) * b.km_value)::integer
         end as due_km,
         -- date due (jamais pour un jalon kilométrique : le manuel ne donne pas de mois)
         case
           when b.is_grid then null
           when b.months is null or b.months <= 0 or b.base_date is null then null
           -- dernier entretien connu, ou premier entretien (une seule fois) :
           -- la date ne se reporte pas
           when b.has_last or b.is_first then (b.base_date + make_interval(months => b.months))::date
           -- inconnu : la première occurrence depuis la mise en service qui dépasse aujourd'hui
           else (b.base_date + make_interval(months => b.months * (
                   floor(
                     (extract(year from age(current_date, b.base_date)) * 12
                      + extract(month from age(current_date, b.base_date)))::numeric / b.months
                   )::integer + 1)))::date
         end as due_date,
         case when b.has_last then 'exact' else 'estime' end as confidence
  from b
),
r as (
  select d.*,
         (d.due_km is not null and d.mileage is not null and d.mileage >= d.due_km) as km_reached,
         (d.due_date is not null and current_date >= d.due_date)                     as date_reached,
         -- rythme de roulage en km/jour, depuis le point de départ
         case
           when d.base_date is null or d.mileage is null or d.base_km is null then null
           when (current_date - d.base_date) <= 0 then null
           when (d.mileage - d.base_km) <= 0 then null
           else (d.mileage - d.base_km)::numeric / (current_date - d.base_date)
         end as km_per_day
  from d
),
k as (
  select r.*,
         case
           when r.km_reached or r.due_km is null or r.mileage is null or r.km_per_day is null then null
           else (current_date + ceil((r.due_km - r.mileage) / r.km_per_day)::integer)
         end as km_reached_on
  from r
)
select
  vehicle_id, company_id, model_year_id, usage, source,
  service_code, service_label, service_family,
  is_grid, is_first, km_value as interval_km, months as interval_months, ut, sort,
  mileage, first_registration_date,
  last_km, last_date, last_origin, has_last, confidence,
  due_km, due_date,
  (km_reached or date_reached) as reached,
  case when km_reached then 'km' when date_reached then 'mois' end as reached_by,
  case
    when due_km is not null and due_date is null then 'km'
    when due_date is not null and due_km is null then 'mois'
    when due_km is null and due_date is null      then null
    when km_reached and not date_reached          then 'km'
    when date_reached and not km_reached          then 'mois'
    when km_reached_on is not null                then (case when km_reached_on < due_date then 'km' else 'mois' end)
    else 'mois'
  end as first_trigger,
  km_reached_on,
  round(km_per_day, 2) as km_per_day,
  -- jours restants : négatif = en retard
  case
    when (km_reached or date_reached) then 0
    when due_date is not null and km_reached_on is not null then least(due_date, km_reached_on) - current_date
    when due_date is not null then due_date - current_date
    when km_reached_on is not null then km_reached_on - current_date
  end as days_left
from k
where
  -- un jalon kilométrique déjà fait n'est plus dû ; sans historique, un jalon
  -- déjà passé au compteur est réputé fait (on n'annonce pas la révision des
  -- 15 000 km à une moto qui en affiche 60 000).
  not (is_grid and has_last)
  and not (is_grid and not has_last and mileage is not null and mileage >= km_value)
  -- premier entretien : une fois fait, ou le jalon dépassé, il n'est plus dû
  and not (is_first and has_last)
  and not (is_first and not has_last and mileage is not null and km_value is not null and mileage > km_value)
  -- une échéance sans aucune borne calculable n'apprend rien
  and (due_km is not null or due_date is not null);

comment on view public.maintenance_vehicle_due is
  'Échéances d''entretien de chaque moto avec leur km / date prévisionnels, au PREMIER ATTEINT (M-16, mission 07 carte 4).';

-- ---------------------------------------------------------------------
-- 7. L'entretien dû d'une moto : la plus urgente de ses échéances
--    (atteintes d'abord, puis la plus proche).
-- ---------------------------------------------------------------------
create or replace view public.maintenance_vehicle_next as
select distinct on (vehicle_id) *
from public.maintenance_vehicle_due
order by vehicle_id,
         reached desc,
         days_left nulls last,
         due_km nulls last,
         due_date nulls last,
         sort;

comment on view public.maintenance_vehicle_next is
  'Une ligne par moto : son entretien dû, le plus urgent d''abord (mission 07, carte 4).';

-- Les vues héritent de la RLS des tables qu'elles lisent (vehicles est filtré
-- par société) ; on verrouille malgré tout l'accès anonyme.
revoke all on public.maintenance_vehicle_program     from anon;
revoke all on public.maintenance_vehicle_last_service from anon;
revoke all on public.maintenance_vehicle_due          from anon;
revoke all on public.maintenance_vehicle_next         from anon;
grant select on public.maintenance_vehicle_program     to authenticated, service_role;
grant select on public.maintenance_vehicle_last_service to authenticated, service_role;
grant select on public.maintenance_vehicle_due          to authenticated, service_role;
grant select on public.maintenance_vehicle_next         to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Lecture pour l'écran : une moto
-- ---------------------------------------------------------------------
create or replace function public.maintenance_due_for_vehicle(_vehicle uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v   public.vehicles%rowtype;
  out jsonb;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'vehicleId',   v.id,
    'mileage',     v.mileage,
    'mileageQualif', v.mileage_qualif,
    'firstRegistration', v.first_registration_date,
    'modelYearId', v.ducati_model_year_id,
    'usage',       coalesce(nullif(v.maintenance_usage, ''), 'route'),
    'hourlyRateHt', public.maintenance_hourly_rate_ht(v.company_id),
    'services',    coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code', d.service_code, 'label', d.service_label, 'family', d.service_family,
                 'source', d.source, 'isGrid', d.is_grid, 'isFirst', d.is_first, 'confidence', d.confidence,
                 'intervalKm', d.interval_km, 'intervalMonths', d.interval_months, 'ut', d.ut,
                 'lastKm', d.last_km, 'lastDate', d.last_date, 'lastOrigin', d.last_origin,
                 'dueKm', d.due_km, 'dueDate', d.due_date,
                 'reached', d.reached, 'reachedBy', d.reached_by,
                 'firstTrigger', d.first_trigger, 'kmReachedOn', d.km_reached_on,
                 'kmPerDay', d.km_per_day, 'daysLeft', d.days_left)
               order by d.reached desc, d.days_left nulls last, d.due_km nulls last, d.sort)
        from public.maintenance_vehicle_due d where d.vehicle_id = v.id), '[]'::jsonb),
    'history',     coalesce((
        select jsonb_agg(jsonb_build_object(
                 'family', l.service_family, 'km', l.km, 'date', l.event_date, 'origin', l.origin)
               order by l.event_date desc nulls last)
        from public.maintenance_vehicle_last_service l where l.vehicle_id = v.id), '[]'::jsonb)
  ) into out;
  return out;
end $$;

revoke all on function public.maintenance_due_for_vehicle(uuid) from public, anon;
grant execute on function public.maintenance_due_for_vehicle(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Liste « Entretiens à venir »
--
--    `_scope` : 'retard' (échéance dépassée), 'bientot' (dans _days jours),
--    'tous' (les deux), 'sans_km' (programme connu mais kilométrage manquant).
--    Toujours paginée : la liste ne renvoie jamais plus de 200 lignes.
-- ---------------------------------------------------------------------
create or replace function public.maintenance_due_list(
  _company uuid,
  _scope   text default 'tous',
  _days    integer default 60,
  _q       text default null,
  _limit   integer default 50,
  _offset  integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim  int := least(greatest(coalesce(_limit, 50), 1), 200);
  off  int := greatest(coalesce(_offset, 0), 0);
  dys  int := least(greatest(coalesce(_days, 60), 0), 1095);
  key  text := nullif(btrim(coalesce(_q, '')), '');
  tot  bigint;
  rows jsonb;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  if _scope = 'sans_km' then
    -- Motos dont le programme est connu mais dont le kilométrage manque :
    -- elles ne peuvent pas être calculées, et c'est l'information utile.
    select count(*) into tot
    from public.vehicles v
    where v.company_id = _company and v.is_active and coalesce(v.mileage, 0) = 0
      and exists (select 1 from public.maintenance_vehicle_program g where g.vehicle_id = v.id)
      and (key is null or v.vin ilike '%' || key || '%' or v.model ilike '%' || key || '%'
           or v.plate ilike '%' || key || '%' or v.reference ilike '%' || key || '%');

    select coalesce(jsonb_agg(x order by x->>'model', x->>'vin'), '[]'::jsonb) into rows from (
      select jsonb_build_object(
               'vehicleId', v.id, 'vin', v.vin, 'reference', v.reference, 'plate', v.plate,
               'brand', v.brand, 'model', v.model, 'modelYear', v.model_year,
               'mileage', v.mileage, 'firstRegistration', v.first_registration_date,
               'usage', coalesce(nullif(v.maintenance_usage, ''), 'route'),
               'owner', (select jsonb_build_object('id', c.id, 'name', public.maintenance_contact_name(c.id))
                           from public.vehicle_owners o join public.contacts c on c.id = o.contact_id
                          where o.vehicle_id = v.id and o.is_current limit 1),
               'missingKm', true) x
      from public.vehicles v
      where v.company_id = _company and v.is_active and coalesce(v.mileage, 0) = 0
        and exists (select 1 from public.maintenance_vehicle_program g where g.vehicle_id = v.id)
        and (key is null or v.vin ilike '%' || key || '%' or v.model ilike '%' || key || '%'
             or v.plate ilike '%' || key || '%' or v.reference ilike '%' || key || '%')
      order by v.model, v.vin
      limit lim offset off
    ) s;

    return jsonb_build_object('scope', _scope, 'total', tot, 'rows', rows,
                              'limit', lim, 'offset', off);
  end if;

  with sel as (
    select n.*, v.vin, v.reference, v.plate, v.brand, v.model, v.model_year
    from public.maintenance_vehicle_next n
    join public.vehicles v on v.id = n.vehicle_id
    where n.company_id = _company
      and (
        case _scope
          -- vrai retard : dernier entretien connu et échéance dépassée
          when 'retard'  then n.reached and n.confidence = 'exact'
          when 'bientot' then (not n.reached) and n.days_left is not null and n.days_left <= dys
          -- échéance estimée faute d'historique connu (à faire préciser au client)
          when 'estime'  then n.confidence = 'estime' and n.days_left is not null and n.days_left <= dys
          else (n.reached and n.confidence = 'exact') or (n.days_left is not null and n.days_left <= dys)
        end
      )
      and (key is null or v.vin ilike '%' || key || '%' or v.model ilike '%' || key || '%'
           or v.plate ilike '%' || key || '%' or v.reference ilike '%' || key || '%')
  )
  select count(*) into tot from sel;

  with sel as (
    select n.*, v.vin, v.reference, v.plate, v.brand, v.model, v.model_year
    from public.maintenance_vehicle_next n
    join public.vehicles v on v.id = n.vehicle_id
    where n.company_id = _company
      and (
        case _scope
          -- vrai retard : dernier entretien connu et échéance dépassée
          when 'retard'  then n.reached and n.confidence = 'exact'
          when 'bientot' then (not n.reached) and n.days_left is not null and n.days_left <= dys
          -- échéance estimée faute d'historique connu (à faire préciser au client)
          when 'estime'  then n.confidence = 'estime' and n.days_left is not null and n.days_left <= dys
          else (n.reached and n.confidence = 'exact') or (n.days_left is not null and n.days_left <= dys)
        end
      )
      and (key is null or v.vin ilike '%' || key || '%' or v.model ilike '%' || key || '%'
           or v.plate ilike '%' || key || '%' or v.reference ilike '%' || key || '%')
    order by n.reached desc, n.days_left nulls last, v.model
    limit lim offset off
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vehicleId', s.vehicle_id, 'vin', s.vin, 'reference', s.reference, 'plate', s.plate,
           'brand', s.brand, 'model', s.model, 'modelYear', s.model_year,
           'mileage', s.mileage, 'usage', s.usage, 'source', s.source,
           'serviceCode', s.service_code, 'serviceLabel', s.service_label, 'serviceFamily', s.service_family,
           'ut', s.ut, 'dueKm', s.due_km, 'dueDate', s.due_date, 'confidence', s.confidence,
           'reached', s.reached, 'reachedBy', s.reached_by, 'firstTrigger', s.first_trigger,
           'kmReachedOn', s.km_reached_on, 'kmPerDay', s.km_per_day, 'daysLeft', s.days_left,
           'lastKm', s.last_km, 'lastDate', s.last_date, 'lastOrigin', s.last_origin,
           'owner', (select jsonb_build_object('id', c.id, 'name', public.maintenance_contact_name(c.id))
                       from public.vehicle_owners o join public.contacts c on c.id = o.contact_id
                      where o.vehicle_id = s.vehicle_id and o.is_current limit 1),
           'openOrId', (select o.id from public.repair_orders o
                         where o.vehicle_id = s.vehicle_id and o.status not in ('facture', 'annule')
                         order by o.created_at desc limit 1),
           'appointmentAt', (select a.starts_at from public.workshop_appointments a
                              where a.vehicle_id = s.vehicle_id and a.starts_at >= now()
                                and a.status <> 'annule'
                              order by a.starts_at limit 1)
         )), '[]'::jsonb) into rows
  from sel s;

  return jsonb_build_object('scope', _scope, 'total', tot, 'rows', rows,
                            'limit', lim, 'offset', off, 'days', dys);
end $$;

revoke all on function public.maintenance_due_list(uuid, text, integer, text, integer, integer) from public, anon;
grant execute on function public.maintenance_due_list(uuid, text, integer, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Compteurs : combien de motos calculables, en retard, sans kilométrage
-- ---------------------------------------------------------------------
create or replace function public.maintenance_due_stats(_company uuid, _days integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dys int := least(greatest(coalesce(_days, 60), 0), 1095);
  out jsonb;
begin
  if _company is null or not public.is_member(_company) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'vehicles',    (select count(*) from public.vehicles v where v.company_id = _company and v.is_active),
    'withModelYear', (select count(*) from public.vehicles v
                       where v.company_id = _company and v.is_active and v.ducati_model_year_id is not null),
    'withProgram', (select count(distinct g.vehicle_id) from public.maintenance_vehicle_program g
                     where g.company_id = _company),
    'computable',  (select count(*) from public.maintenance_vehicle_next n where n.company_id = _company),
    -- vrai retard : le dernier entretien est connu ET l'échéance est dépassée
    'late',        (select count(*) from public.maintenance_vehicle_next n
                     where n.company_id = _company and n.reached and n.confidence = 'exact'),
    -- échéance estimée faute d'historique : c'est ce que la carte 5 vient corriger
    'estimated',   (select count(*) from public.maintenance_vehicle_next n
                     where n.company_id = _company and n.confidence = 'estime'),
    'exact',       (select count(*) from public.maintenance_vehicle_next n
                     where n.company_id = _company and n.confidence = 'exact'),
    'soon',        (select count(*) from public.maintenance_vehicle_next n
                     where n.company_id = _company and not n.reached
                       and n.days_left is not null and n.days_left <= dys),
    'missingKm',   (select count(*) from public.vehicles v
                     where v.company_id = _company and v.is_active and coalesce(v.mileage, 0) = 0
                       and exists (select 1 from public.maintenance_vehicle_program g where g.vehicle_id = v.id)),
    'noProgram',   (select count(*) from public.vehicles v
                     where v.company_id = _company and v.is_active and v.ducati_model_year_id is not null
                       and not exists (select 1 from public.maintenance_vehicle_program g where g.vehicle_id = v.id)),
    'noModelYear', (select count(*) from public.vehicles v
                     where v.company_id = _company and v.is_active and v.ducati_model_year_id is null),
    'withHistory', (select count(distinct l.vehicle_id) from public.maintenance_vehicle_last_service l
                     join public.vehicles v on v.id = l.vehicle_id
                    where v.company_id = _company),
    'hourlyRateHt', public.maintenance_hourly_rate_ht(_company),
    'days', dys
  ) into out;
  return out;
end $$;

revoke all on function public.maintenance_due_stats(uuid, integer) from public, anon;
grant execute on function public.maintenance_due_stats(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. Enregistrer un entretien connu (comptoir, import, My Ducati)
--     Le portail client passe par sa propre fonction (carte 5).
-- ---------------------------------------------------------------------
create or replace function public.vehicle_service_history_add(
  _vehicle uuid,
  _label   text,
  _km      integer default null,
  _date    date default null,
  _source  text default 'declare_comptoir',
  _note    text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v      public.vehicles%rowtype;
  fam    text;
  new_id uuid;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _km is null and _date is null then
    raise exception 'Donnez au moins le kilométrage ou la date du dernier entretien.' using errcode = '22023';
  end if;
  if _source not in ('declare_client', 'declare_comptoir', 'import', 'my_ducati') then
    raise exception 'Origine inconnue : %', _source using errcode = '22023';
  end if;

  fam := public.maintenance_service_family(_label);
  if fam = '' then
    raise exception 'Entretien non reconnu : %', _label using errcode = '22023';
  end if;

  insert into public.vehicle_service_history
    (company_id, vehicle_id, service_family, service_label, km, event_date, source, note, created_by)
  values (v.company_id, v.id, fam, btrim(_label), _km, _date, _source, nullif(btrim(coalesce(_note, '')), ''), auth.uid())
  returning id into new_id;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (v.company_id, auth.uid(), 'vehicle_service_history_added', 'vehicle', v.id, 'dms',
          jsonb_build_object('family', fam, 'label', btrim(_label), 'km', _km, 'date', _date, 'source', _source));

  return new_id;
end $$;

revoke all on function public.vehicle_service_history_add(uuid, text, integer, date, text, text) from public, anon;
grant execute on function public.vehicle_service_history_add(uuid, text, integer, date, text, text) to authenticated, service_role;

create or replace function public.vehicle_service_history_delete(_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare h public.vehicle_service_history%rowtype;
begin
  select * into h from public.vehicle_service_history where id = _id;
  if not found or not public.is_member(h.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  delete from public.vehicle_service_history where id = _id;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data)
  values (h.company_id, auth.uid(), 'vehicle_service_history_deleted', 'vehicle', h.vehicle_id, 'dms',
          jsonb_build_object('family', h.service_family, 'km', h.km, 'date', h.event_date, 'source', h.source));
end $$;

revoke all on function public.vehicle_service_history_delete(uuid) from public, anon;
grant execute on function public.vehicle_service_history_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Mettre à jour le kilométrage d'une moto (comptoir et portail client)
--     Le kilométrage est la donnée qui manque le plus : un geste simple.
-- ---------------------------------------------------------------------
create or replace function public.vehicle_mileage_set(_vehicle uuid, _km integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where id = _vehicle;
  if not found or not public.is_member(v.company_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if _km is null or _km < 0 or _km > 2000000 then
    raise exception 'Kilométrage invalide.' using errcode = '22023';
  end if;

  update public.vehicles set mileage = _km, mileage_qualif = 'reel', updated_at = now() where id = _vehicle;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (v.company_id, auth.uid(), 'vehicle_mileage_set', 'vehicle', v.id, 'dms',
          jsonb_build_object('mileage', v.mileage), jsonb_build_object('mileage', _km));
end $$;

revoke all on function public.vehicle_mileage_set(uuid, integer) from public, anon;
grant execute on function public.vehicle_mileage_set(uuid, integer) to authenticated, service_role;
