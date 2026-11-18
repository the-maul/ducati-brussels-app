-- =====================================================================
-- M8 — Planning de charge atelier, rattrapage G8 (18/11/2026, ATE002, bloquant #7)
--
-- Ce que G8 fait et que le planning du DMS ne faisait pas (07-atelier.md §5, §13, §14) :
--   1. Mecaniciens (« compagnons ») relies a l'equipe : table workshop_mechanics
--      (membre lie, visible au planning, ordre d'affichage, atelier) + horaires
--      matin / apres-midi par jour de la semaine (workshop_mechanic_hours).
--   2. Reglages du planning par societe (workshop_planning_settings) : plage horaire,
--      1er jour, nombre de jours, granularite (10 min par defaut), jours feries belges,
--      taux d'occupation, blocage des RDV simultanes, conditions generales du pret.
--   3. Calendrier : jours feries ajoutes a la main, fermetures, absences, pauses
--      (workshop_calendar_blocks) — ils retirent de la capacite.
--   4. RDV : compagnon (mechanic_id), « RDV en attente » (unassigned), type de RDV,
--      kilometrage ; temps prevu OBLIGATOIRE avant de creer l'OR (garde en base) ;
--      statut du RDV aligne sur le statut de l'OR (trigger) ; recherche par client,
--      immatriculation, chassis (workshop_appointment_search).
--   5. Types de RDV parametrables : Parametres → Tables (reference_values,
--      table_key = workshop_appointment_type), couleur metier + duree par defaut.
--
-- Les motos de pret sont dans la migration suivante (20261118121000).
-- Additif : aucune donnee existante modifiee, sauf planned_minutes qui devient
-- facultatif (un RDV en attente peut ne pas encore avoir de temps prevu).
-- Idempotente (if not exists / on conflict do nothing / create or replace).
-- Essai a blanc : supabase/tests/m8_planning_charge_g8.sql (transaction annulee).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Compagnons (mecaniciens du planning)
-- ---------------------------------------------------------------------
create table if not exists public.workshop_mechanics (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete set null,   -- membre de l'equipe (lien operateur G8)
  name                text not null,
  workshop            text,
  visible_in_planning boolean not null default true,
  sort_order          int not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists uq_workshop_mechanics_user
  on public.workshop_mechanics(company_id, user_id) where user_id is not null;
create index if not exists idx_workshop_mechanics_company on public.workshop_mechanics(company_id, sort_order);
comment on table public.workshop_mechanics is
  'Compagnons du planning atelier (G8 « Table des compagnons ») : membre de l''equipe lie, visible ou non au planning, ordre d''affichage.';

-- Le membre lie doit appartenir a la societe.
create or replace function public.workshop_mechanics_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null
     and not exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.company_id = new.company_id) then
    raise exception 'Le membre lie au compagnon n''appartient pas a la societe.' using errcode = '23514';
  end if;
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Le nom du compagnon est obligatoire.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.workshop_mechanics_guard() from public, anon, authenticated;
drop trigger if exists trg_workshop_mechanics_guard on public.workshop_mechanics;
create trigger trg_workshop_mechanics_guard before insert or update on public.workshop_mechanics
  for each row execute function public.workshop_mechanics_guard();

-- Horaires matin / apres-midi par jour (1 = lundi ... 7 = dimanche, ISO). Un jour sans ligne = repos.
create table if not exists public.workshop_mechanic_hours (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  mechanic_id uuid not null references public.workshop_mechanics(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),
  am_start    time,
  am_end      time,
  pm_start    time,
  pm_end      time,
  unique (mechanic_id, weekday),
  constraint workshop_mechanic_hours_am check (am_start is null or am_end is null or am_end > am_start),
  constraint workshop_mechanic_hours_pm check (pm_start is null or pm_end is null or pm_end > pm_start),
  constraint workshop_mechanic_hours_order check (am_end is null or pm_start is null or pm_start >= am_end)
);
comment on table public.workshop_mechanic_hours is
  'Horaires de travail d''un compagnon par jour de la semaine (matin / apres-midi), base de la capacite du planning.';

-- ---------------------------------------------------------------------
-- 2. Reglages du planning (une ligne par societe)
-- ---------------------------------------------------------------------
create table if not exists public.workshop_planning_settings (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  day_start         time not null default '09:00',
  day_end           time not null default '18:00',
  first_weekday     smallint not null default 2 check (first_weekday between 1 and 7),
  days_shown        smallint not null default 5 check (days_shown between 1 and 7),
  slot_minutes      smallint not null default 10 check (slot_minutes in (5, 10, 15, 20, 30, 60)),
  belgian_holidays  boolean not null default true,
  show_occupancy    boolean not null default true,
  block_overlaps    boolean not null default false,
  loan_terms        text,
  updated_at        timestamptz not null default now(),
  constraint workshop_planning_settings_range check (day_end > day_start)
);
comment on table public.workshop_planning_settings is
  'Reglages du planning atelier (G8 roue dentee) : plage, 1er jour, granularite, feries belges, taux d''occupation, RDV simultanes, conditions generales du pret.';

-- ---------------------------------------------------------------------
-- 3. Calendrier : feries, fermetures, absences, pauses
-- ---------------------------------------------------------------------
create table if not exists public.workshop_calendar_blocks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('ferie', 'fermeture', 'absence', 'pause')),
  mechanic_id uuid references public.workshop_mechanics(id) on delete cascade,  -- null = tout l'atelier
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  label       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint workshop_calendar_blocks_period check (ends_at > starts_at),
  constraint workshop_calendar_blocks_absence check (kind <> 'absence' or mechanic_id is not null)
);
create index if not exists idx_workshop_calendar_blocks on public.workshop_calendar_blocks(company_id, starts_at);
comment on table public.workshop_calendar_blocks is
  'Periodes indisponibles du planning (G8 « Jours feries / fermetures / absences ») : retirees de la capacite.';

-- ---------------------------------------------------------------------
-- 4. RDV : compagnon, en attente, type, km ; temps prevu obligatoire pour l'OR
-- ---------------------------------------------------------------------
alter table public.workshop_appointments
  add column if not exists mechanic_id uuid references public.workshop_mechanics(id) on delete set null;
alter table public.workshop_appointments
  add column if not exists unassigned boolean not null default false;
alter table public.workshop_appointments
  add column if not exists appointment_type text;
alter table public.workshop_appointments
  add column if not exists mileage int check (mileage is null or mileage >= 0);
alter table public.workshop_appointments
  alter column planned_minutes drop not null;

create index if not exists idx_appt_mechanic on public.workshop_appointments(mechanic_id, starts_at);
create index if not exists idx_appt_waiting on public.workshop_appointments(company_id) where unassigned;

comment on column public.workshop_appointments.mechanic_id is 'Compagnon affecte (workshop_mechanics) ; mechanic_name garde son nom (impression, ancien RDV).';
comment on column public.workshop_appointments.unassigned is 'RDV en attente (G8 « sans affectation ») : pas de compagnon ni de creneau, dans la liste d''attente.';
comment on column public.workshop_appointments.appointment_type is 'Type de RDV : code reference_values (table_key = workshop_appointment_type).';
comment on column public.workshop_appointments.mileage is 'Kilometrage annonce a la prise du RDV, repris sur l''OR.';

create or replace function public.workshop_appointments_planning_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m   public.workshop_mechanics%rowtype;
  s   public.workshop_planning_settings%rowtype;
  _end timestamptz;
begin
  -- RDV en attente : aucun compagnon tant qu'il n'est pas planifie.
  if new.unassigned then
    new.mechanic_id := null;
  end if;

  if new.mechanic_id is not null and (tg_op = 'INSERT' or new.mechanic_id is distinct from old.mechanic_id) then
    select * into m from public.workshop_mechanics where id = new.mechanic_id;
    if not found or m.company_id <> new.company_id then
      raise exception 'Le compagnon choisi n''appartient pas a la societe du RDV.' using errcode = '23514';
    end if;
    new.mechanic_name := m.name;
  end if;

  -- G8 : « Veuillez saisir le temps prevu » avant « Valider RDV et saisie OR ».
  if new.or_id is not null and (tg_op = 'INSERT' or old.or_id is null)
     and coalesce(new.planned_minutes, 0) <= 0 then
    raise exception 'Temps prevu obligatoire avant de creer l''OR depuis le RDV.' using errcode = '23514';
  end if;

  -- Reglage « bloquer les RDV simultanes » : un compagnon ne peut pas avoir deux RDV qui se chevauchent.
  if new.mechanic_id is not null and not new.unassigned and new.status not in ('annule', 'demande')
     and (tg_op = 'INSERT' or new.mechanic_id is distinct from old.mechanic_id
          or new.starts_at is distinct from old.starts_at or new.planned_minutes is distinct from old.planned_minutes
          or new.unassigned is distinct from old.unassigned
          -- un simple changement d'avancement (ex. suivi de l'OR) ne doit jamais bloquer : seul le
          -- retour d'un RDV annule / d'une demande dans le planning est controle.
          or (new.status is distinct from old.status and old.status in ('annule', 'demande'))) then
    select * into s from public.workshop_planning_settings where company_id = new.company_id;
    if found and s.block_overlaps then
      _end := new.starts_at + make_interval(mins => greatest(coalesce(new.planned_minutes, s.slot_minutes), 1));
      if exists (
        select 1 from public.workshop_appointments x
         where x.mechanic_id = new.mechanic_id and x.id <> new.id and not x.unassigned
           and x.status not in ('annule', 'demande')
           and x.starts_at < _end
           and x.starts_at + make_interval(mins => greatest(coalesce(x.planned_minutes, s.slot_minutes), 1)) > new.starts_at
      ) then
        raise exception 'Ce compagnon a deja un rendez-vous sur ce creneau.' using errcode = '23P01';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.workshop_appointments_planning_guard() from public, anon, authenticated;
drop trigger if exists trg_appointments_planning_guard on public.workshop_appointments;
create trigger trg_appointments_planning_guard before insert or update on public.workshop_appointments
  for each row execute function public.workshop_appointments_planning_guard();

-- Statut du RDV aligne sur l'OR (G8 : la legende du planning suit l'avancement de l'OR).
-- Correspondance (doublee cote code : src/modules/workshop/planning/rules.ts, appointmentStatusForOr) :
--   a_faire → arrive · en_cours → en_cours · attente* → attente · pret → termine ·
--   client_informe → client_informe · facture → facture · annule → (inchange).
create or replace function public.workshop_appointment_status_for_or(_or_status text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when _or_status = 'a_faire' then 'arrive'
    when _or_status = 'en_cours' then 'en_cours'
    when _or_status like 'attente%' then 'attente'
    when _or_status = 'pret' then 'termine'
    when _or_status = 'client_informe' then 'client_informe'
    when _or_status = 'facture' then 'facture'
    else null end;
$$;

create or replace function public.repair_orders_sync_appointment_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare _s text;
begin
  if new.status is not distinct from old.status then return new; end if;
  _s := public.workshop_appointment_status_for_or(new.status);
  if _s is null then return new; end if;
  update public.workshop_appointments
     set status = _s
   where or_id = new.id and status <> 'annule' and status is distinct from _s;
  return new;
end $$;
revoke all on function public.repair_orders_sync_appointment_status() from public, anon, authenticated;
drop trigger if exists trg_repair_orders_sync_appointment on public.repair_orders;
create trigger trg_repair_orders_sync_appointment after update of status on public.repair_orders
  for each row execute function public.repair_orders_sync_appointment_status();

-- Recherche d'un RDV (G8 « Rechercher RDV ») : nom du client, immatriculation, n° de chassis.
create or replace function public.workshop_appointment_search(_company uuid, _term text, _limit int default 50)
returns table (
  id uuid, starts_at timestamptz, planned_minutes int, status text, unassigned boolean,
  work_description text, mechanic_name text, client_name text, brand text, model text,
  plate text, vin text, or_id uuid
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s   text := btrim(coalesce(_term, ''));
  k   text := regexp_replace(upper(coalesce(_term, '')), '[^A-Z0-9]', '', 'g');
  esc text;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company using errcode = '42501';
  end if;
  if char_length(s) < 2 then return; end if;
  esc := '%' || replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select a.id, a.starts_at, a.planned_minutes, a.status, a.unassigned, a.work_description,
         coalesce(m.name, a.mechanic_name),
         coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company_name),
         v.brand, v.model, v.plate, v.vin, a.or_id
    from public.workshop_appointments a
    left join public.contacts c on c.id = a.contact_id
    left join public.vehicles v on v.id = a.vehicle_id
    left join public.workshop_mechanics m on m.id = a.mechanic_id
   where a.company_id = _company
     and (
          lower(concat_ws(' ', c.first_name, c.last_name)) like esc
       or lower(concat_ws(' ', c.last_name, c.first_name)) like esc
       or lower(coalesce(c.company_name, '')) like esc
       or (char_length(k) >= 2 and regexp_replace(upper(coalesce(v.plate, '')), '[^A-Z0-9]', '', 'g') like '%' || k || '%')
       or (char_length(k) >= 4 and upper(coalesce(v.vin, '')) like '%' || k || '%')
     )
   order by a.starts_at desc
   limit least(greatest(coalesce(_limit, 50), 1), 200);
end $$;
revoke execute on function public.workshop_appointment_search(uuid, text, int) from public, anon;
grant execute on function public.workshop_appointment_search(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Types de RDV (Parametres → Tables → Types de rendez-vous atelier)
--    extra.color = couleur metier (--job-*) ; extra.default_minutes = temps prevu propose.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, 'workshop_appointment_type', v.code, v.label, v.sort, jsonb_build_object('color', v.color, 'default_minutes', v.minutes)
  from public.companies c
 cross join (values
   ('entretien',   'Entretien',                      10, 'entretien',   120),
   ('reparation',  'Réparation / diagnostic',        20, 'reparation',   60),
   ('garantie',    'Garantie / rappel constructeur', 30, 'garantie',     60),
   ('pneus',       'Pneus',                          40, 'pneus',        60),
   ('preparation', 'Préparation / livraison moto',   50, 'prepa',        90),
   ('carrosserie', 'Carrosserie / accessoires',      60, 'carrosserie',  60)
 ) as v(code, label, sort, color, minutes)
on conflict (company_id, table_key, code) do nothing;

-- ---------------------------------------------------------------------
-- 6. RLS, audit, droits d'ecriture (lecture : membre ; ecriture : page Atelier)
-- ---------------------------------------------------------------------
insert into public.table_write_pages (table_name, page) values
  ('workshop_mechanics', '/workshop'),
  ('workshop_mechanic_hours', '/workshop'),
  ('workshop_planning_settings', '/workshop'),
  ('workshop_calendar_blocks', '/workshop')
on conflict do nothing;

alter table public.workshop_mechanics enable row level security;
drop policy if exists workshop_mechanics_select on public.workshop_mechanics;
create policy workshop_mechanics_select on public.workshop_mechanics for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_mechanics_write on public.workshop_mechanics;
create policy workshop_mechanics_write on public.workshop_mechanics for all to authenticated
  using (public.can_write_table(company_id, 'workshop_mechanics')) with check (public.can_write_table(company_id, 'workshop_mechanics'));

alter table public.workshop_mechanic_hours enable row level security;
drop policy if exists workshop_mechanic_hours_select on public.workshop_mechanic_hours;
create policy workshop_mechanic_hours_select on public.workshop_mechanic_hours for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_mechanic_hours_write on public.workshop_mechanic_hours;
create policy workshop_mechanic_hours_write on public.workshop_mechanic_hours for all to authenticated
  using (public.can_write_table(company_id, 'workshop_mechanic_hours')) with check (public.can_write_table(company_id, 'workshop_mechanic_hours'));

alter table public.workshop_planning_settings enable row level security;
drop policy if exists workshop_planning_settings_select on public.workshop_planning_settings;
create policy workshop_planning_settings_select on public.workshop_planning_settings for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_planning_settings_write on public.workshop_planning_settings;
create policy workshop_planning_settings_write on public.workshop_planning_settings for all to authenticated
  using (public.can_write_table(company_id, 'workshop_planning_settings')) with check (public.can_write_table(company_id, 'workshop_planning_settings'));

alter table public.workshop_calendar_blocks enable row level security;
drop policy if exists workshop_calendar_blocks_select on public.workshop_calendar_blocks;
create policy workshop_calendar_blocks_select on public.workshop_calendar_blocks for select to authenticated
  using (public.is_member(company_id));
drop policy if exists workshop_calendar_blocks_write on public.workshop_calendar_blocks;
create policy workshop_calendar_blocks_write on public.workshop_calendar_blocks for all to authenticated
  using (public.can_write_table(company_id, 'workshop_calendar_blocks')) with check (public.can_write_table(company_id, 'workshop_calendar_blocks'));

drop trigger if exists trg_workshop_mechanics_updated on public.workshop_mechanics;
create trigger trg_workshop_mechanics_updated before update on public.workshop_mechanics for each row execute function public.set_updated_at();
drop trigger if exists trg_workshop_planning_settings_updated on public.workshop_planning_settings;
create trigger trg_workshop_planning_settings_updated before update on public.workshop_planning_settings for each row execute function public.set_updated_at();

drop trigger if exists trg_workshop_mechanics_audit on public.workshop_mechanics;
create trigger trg_workshop_mechanics_audit after insert or update or delete on public.workshop_mechanics for each row execute function public.audit_row();
drop trigger if exists trg_workshop_mechanic_hours_audit on public.workshop_mechanic_hours;
create trigger trg_workshop_mechanic_hours_audit after insert or update or delete on public.workshop_mechanic_hours for each row execute function public.audit_row();
drop trigger if exists trg_workshop_planning_settings_audit on public.workshop_planning_settings;
create trigger trg_workshop_planning_settings_audit after insert or update or delete on public.workshop_planning_settings for each row execute function public.audit_row();
drop trigger if exists trg_workshop_calendar_blocks_audit on public.workshop_calendar_blocks;
create trigger trg_workshop_calendar_blocks_audit after insert or update or delete on public.workshop_calendar_blocks for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 7. Donnees de depart (une fois, sans ecraser) : reglages G8, compagnons = membres
--    mecaniciens / chefs d'atelier de chaque societe, horaires G8 observes
--    (mardi → samedi, 09:00-12:30 / 13:30-18:00) — a ajuster dans Planning → Reglages.
-- ---------------------------------------------------------------------
insert into public.workshop_planning_settings (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;

insert into public.workshop_mechanics (company_id, user_id, name, visible_in_planning, sort_order)
select x.company_id, x.user_id, x.name, x.is_mechanic, x.rn * 10
  from (
    select ur.company_id, ur.user_id,
           coalesce(nullif(btrim(p.full_name), ''), p.email, 'Compagnon') as name,
           bool_or(ur.role::text = 'mecanicien') as is_mechanic,
           row_number() over (partition by ur.company_id order by coalesce(nullif(btrim(p.full_name), ''), p.email)) as rn
      from public.user_roles ur
      left join public.profiles p on p.id = ur.user_id
     where ur.role::text in ('mecanicien', 'chef_atelier')
       and coalesce(p.is_active, true)
     group by ur.company_id, ur.user_id, p.full_name, p.email
  ) x
 where not exists (select 1 from public.workshop_mechanics m where m.company_id = x.company_id)
on conflict do nothing;

insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
select m.company_id, m.id, d.wd, '09:00', '12:30', '13:30', '18:00'
  from public.workshop_mechanics m
 cross join (values (2), (3), (4), (5), (6)) as d(wd)
 where not exists (select 1 from public.workshop_mechanic_hours h where h.mechanic_id = m.id)
on conflict (mechanic_id, weekday) do nothing;
