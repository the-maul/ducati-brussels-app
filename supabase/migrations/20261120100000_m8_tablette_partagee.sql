-- =====================================================================
-- M8 — Decision client Q60 (20/11/2026) : tablettes d'atelier, LES DEUX MODES. ATE010 ATE011 B11.
--
--  - Une tablette par mecanicien : deja en place (chacun connecte avec son compte).
--  - Tablette partagee : un compte « tablette atelier » (cree par Simon, pas par la migration)
--    ouvre « Mon atelier » en mode partage. Chaque geste (Demarrer / Pause / Reprendre /
--    Terminer, cocher une operation, photos) demande d'abord « Qui etes-vous ? » : le compagnon
--    touche son nom puis tape son code. Le pointage est enregistre AU NOM DU MECANICIEN choisi,
--    pas du compte tablette. L'identite reste « collee » 2 min (reglable), puis elle est redemandee.
--  - Reglage par compte (Planning → Reglages → Tablettes) : personnel ou partage. Chaque geste
--    partage est trace dans events : qui a agi (le compagnon), depuis quel compte (la tablette).
--  - Aucune creation de compte, aucun droit change : le compte tablette garde ses roles (ceux d'un
--    mecanicien) ; seules ses gestes de pointage exigent une identite.
--
-- Codes : la pointeuse n'a AUCUN code mecano en production (reference_values workshop_mechanic
-- vide le 20/11). Le chef d'atelier donne donc un code a 4 chiffres a chaque compagnon
-- (Planning → Reglages → Tablettes) ; stocke chiffre (bcrypt) dans une table sans lecture.
-- Si un code mecano de la pointeuse existe pour le compagnon (meme nom), il est accepte tant
-- qu'aucun code a 4 chiffres n'est pose.
--
-- Identite enregistree sur le pointage : compagnon relie a un compte (personnel) → mechanic_id =
-- ce compte (exactement comme sur sa propre tablette : un seul pointage actif, « Mon atelier »
-- personnel le retrouve) ; compagnon sans compte (John, Livio, Luis) → mechanic_code = son code
-- mecano s'il existe, sinon son nom en majuscules (G8 : codes JOHN, LIVIO, LUIS), mechanic_id
-- vide, comme la pointeuse partagee du 18/11. workshop_mechanic_id = le compagnon, toujours.
--
-- Contenu :
--  1. Tables : workshop_tablet_accounts (mode par compte), workshop_mechanic_pins (codes,
--     illisibles), workshop_shared_sessions (identite collee), reglage shared_identity_seconds.
--  2. Code a 4 chiffres : workshop_mechanic_pin_set (admin / chef d'atelier), liste des
--     compagnons pour « Qui etes-vous ? » (workshop_shared_mechanics), identification
--     (workshop_shared_identify : 5 essais faux en 10 min = blocage 10 min), fin d'identite.
--  3. Pointage : le corps de workshop_work_start / _pause / _stop passe dans des fonctions
--     internes qui recoivent l'identite ; les fonctions publiques gardent leur signature et
--     refusent un compte en mode partage sans identite ; workshop_shared_work_start / _pause /
--     _stop pointent au nom du compagnon identifie.
--  4. workshop_shared_trace : trace des autres gestes (operation cochee, photo).
--  5. UN SEUL POINTAGE ACTIF PAR MECANICIEN ET PAR SOCIETE (decision du 20/11, bug de la revue UX :
--     dans ItalTest, « Demarrer » proposait de mettre en pause un pointage d'ITALBIKE STORE). Une
--     societe de test n'agit jamais sur la vraie, ni l'inverse : _wte_open_work, _wte_target_for,
--     le verrou, l'index unique par compte (company_id, mechanic_id) et l'identite partagee filtrent
--     sur company_id ; workshop_work_pause / workshop_work_stop recoivent la societe de l'ecran.
--  6. Mode par compte : workshop_tablet_mode_set (admin / chef d'atelier), la fiche compagnon
--     creee automatiquement pour le compte tablette (role mecanicien) est rendue inactive et
--     cachee du planning ; workshop_mechanic_sync la laisse inactive.
--
-- Additive, rejouable. Essai a blanc : supabase/tests/m8_tablette_partagee.sql.
-- NON APPLIQUEE (l'orchestrateur applique ; sauvegarde a demander au client, CLAUDE.md §5.0).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables et reglage
-- ---------------------------------------------------------------------
create table if not exists public.workshop_tablet_accounts (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  mode       text not null default 'personal' check (mode in ('personal', 'shared')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (company_id, user_id)
);
comment on table public.workshop_tablet_accounts is
  'Q60 (20/11/2026) : mode de la tablette d''atelier par compte. personal = le compte pointe a son nom ; shared = tablette partagee, chaque geste demande « Qui etes-vous ? » (compagnon + code).';
alter table public.workshop_tablet_accounts enable row level security;
drop policy if exists workshop_tablet_accounts_select on public.workshop_tablet_accounts;
create policy workshop_tablet_accounts_select on public.workshop_tablet_accounts for select
  using (coalesce((company_id in (select public.rls_member_companies())), false));
revoke insert, update, delete on public.workshop_tablet_accounts from anon, authenticated;
grant select on public.workshop_tablet_accounts to authenticated;

create table if not exists public.workshop_mechanic_pins (
  mechanic_id uuid primary key references public.workshop_mechanics(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  pin_hash    text not null,
  set_at      timestamptz not null default now(),
  set_by      uuid references auth.users(id) on delete set null
);
comment on table public.workshop_mechanic_pins is
  'Q60 : code a 4 chiffres d''un compagnon pour la tablette partagee, chiffre (bcrypt). Aucune lecture depuis l''application : seules les fonctions SECURITY DEFINER le comparent.';
alter table public.workshop_mechanic_pins enable row level security;
revoke all on public.workshop_mechanic_pins from public, anon, authenticated;

create table if not exists public.workshop_shared_sessions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  account_id           uuid not null references auth.users(id) on delete cascade,
  workshop_mechanic_id uuid not null references public.workshop_mechanics(id) on delete cascade,
  mechanic_user_id     uuid references auth.users(id) on delete set null,
  mechanic_code        text,
  mechanic_name        text not null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  ended_at             timestamptz
);
create index if not exists idx_wss_account on public.workshop_shared_sessions(account_id, expires_at desc);
comment on table public.workshop_shared_sessions is
  'Q60 : identite « collee » sur une tablette partagee (compagnon identifie par son code), valable shared_identity_seconds apres le dernier geste. Jeton = id, rendu au seul compte tablette.';
alter table public.workshop_shared_sessions enable row level security;
revoke all on public.workshop_shared_sessions from public, anon, authenticated;

alter table public.workshop_planning_settings
  add column if not exists shared_identity_seconds smallint not null default 120;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_planning_settings_shared_identity_chk') then
    alter table public.workshop_planning_settings add constraint workshop_planning_settings_shared_identity_chk
      check (shared_identity_seconds between 30 and 900);
  end if;
end $$;
comment on column public.workshop_planning_settings.shared_identity_seconds is
  'Q60 : duree (secondes) pendant laquelle l''identite choisie sur une tablette partagee reste valable apres le dernier geste (120 = 2 min).';

-- ---------------------------------------------------------------------
-- 2. Aides
-- ---------------------------------------------------------------------
create or replace function public._workshop_is_shared_account(_company uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.workshop_tablet_accounts t
                  where t.company_id = _company and t.user_id = _user and t.mode = 'shared');
$$;
revoke all on function public._workshop_is_shared_account(uuid, uuid) from public, anon, authenticated;

-- Code mecano de la pointeuse (Parametres → Tables → Codes mecano) du compagnon, par son nom.
create or replace function public._workshop_mechanic_pointeuse_code(_mechanic uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select rv.code from public.workshop_mechanics m
    join public.reference_values rv on rv.company_id = m.company_id and rv.table_key = 'workshop_mechanic'
                                    and coalesce(rv.is_active, true)
                                    and public.workshop_mechanic_norm_name(rv.label) = public.workshop_mechanic_norm_name(m.name)
   where m.id = _mechanic
   order by rv.sort_order nulls last, rv.code
   limit 1;
$$;
revoke all on function public._workshop_mechanic_pointeuse_code(uuid) from public, anon, authenticated;

-- Identite du pointage d'un compagnon (voir l'en-tete) : compte personnel relie, sinon code.
create or replace function public._workshop_mechanic_identity(_mechanic uuid)
returns table(user_id uuid, code text, name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m public.workshop_mechanics%rowtype;
begin
  select * into m from public.workshop_mechanics where id = _mechanic;
  if not found then return; end if;
  if m.user_id is not null and not public._workshop_is_shared_account(m.company_id, m.user_id) then
    return query select m.user_id, null::text, m.name;
    return;
  end if;
  return query select null::uuid,
    coalesce(public._workshop_mechanic_pointeuse_code(m.id),
             left(upper(regexp_replace(public.workshop_mechanic_norm_name(m.name), '[^a-z0-9]+', '', 'g')), 24),
             'C-' || left(m.id::text, 8)),
    m.name;
end $$;
revoke all on function public._workshop_mechanic_identity(uuid) from public, anon, authenticated;

create or replace function public._workshop_shared_ttl(_company uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.shared_identity_seconds::int from public.workshop_planning_settings s where s.company_id = _company), 120);
$$;
revoke all on function public._workshop_shared_ttl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Codes a 4 chiffres, liste « Qui etes-vous ? », identification
-- ---------------------------------------------------------------------
create or replace function public.workshop_mechanic_pin_set(_mechanic uuid, _pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare m public.workshop_mechanics%rowtype; _p text := nullif(btrim(coalesce(_pin, '')), ''); _had boolean;
begin
  select * into m from public.workshop_mechanics where id = _mechanic;
  if not found then raise exception 'Compagnon introuvable.' using errcode = 'P0002'; end if;
  if not (public.is_admin(m.company_id) or public.has_role(m.company_id, 'chef_atelier'::public.app_role)) then
    raise exception 'Code des compagnons : reserve a l''administrateur et au chef d''atelier.' using errcode = '42501';
  end if;
  if _p is not null and _p !~ '^[0-9]{4}$' then
    raise exception 'Le code est fait de 4 chiffres.' using errcode = '22023';
  end if;
  _had := exists (select 1 from public.workshop_mechanic_pins where mechanic_id = m.id);
  if _p is null then
    delete from public.workshop_mechanic_pins where mechanic_id = m.id;
  else
    insert into public.workshop_mechanic_pins (mechanic_id, company_id, pin_hash, set_at, set_by)
    values (m.id, m.company_id, extensions.crypt(_p, extensions.gen_salt('bf', 8)), now(), auth.uid())
    on conflict (mechanic_id) do update set pin_hash = excluded.pin_hash, set_at = now(), set_by = auth.uid();
  end if;
  -- Le code lui-meme n'est jamais trace.
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (m.company_id, auth.uid(), 'workshop_mechanic_pin_set', 'workshop_mechanics', m.id::text, 'screen',
          jsonb_build_object('had_pin', _had), jsonb_build_object('has_pin', _p is not null, 'mechanic', m.name));
  return jsonb_build_object('status', case when _p is null then 'cleared' else 'set' end, 'mechanic_id', m.id);
end $$;
revoke all on function public.workshop_mechanic_pin_set(uuid, text) from public, anon;
grant execute on function public.workshop_mechanic_pin_set(uuid, text) to authenticated;

-- Compagnons proposes sur la tablette partagee : actifs, visibles au planning, hors fiches des
-- comptes tablette. has_code = un code a 4 chiffres ou un code mecano existe.
create or replace function public.workshop_shared_mechanics(_company uuid)
returns table(id uuid, name text, sort_order int, has_pin boolean, has_pointeuse_code boolean, linked boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  return query
  select m.id, m.name, m.sort_order,
         exists (select 1 from public.workshop_mechanic_pins p where p.mechanic_id = m.id),
         public._workshop_mechanic_pointeuse_code(m.id) is not null,
         m.user_id is not null
    from public.workshop_mechanics m
   where m.company_id = _company and m.is_active and m.visible_in_planning
     and not (m.user_id is not null and public._workshop_is_shared_account(_company, m.user_id))
   order by m.sort_order, m.name;
end $$;
revoke all on function public.workshop_shared_mechanics(uuid) from public, anon;
grant execute on function public.workshop_shared_mechanics(uuid) to authenticated;

create or replace function public.workshop_shared_identify(_company uuid, _mechanic uuid, _pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  m public.workshop_mechanics%rowtype; _p text := btrim(coalesce(_pin, '')); _hash text; _code text;
  _ok boolean := false; _fails int; _ttl int; _id uuid; _exp timestamptz; idn record;
begin
  if auth.uid() is null or not public.can_write_table(_company, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  select * into m from public.workshop_mechanics where id = _mechanic and company_id = _company and is_active;
  if not found then raise exception 'Compagnon introuvable.' using errcode = 'P0002'; end if;

  select count(*) into _fails from public.events e
   where e.company_id = _company and e.action = 'workshop_shared_pin_failed' and e.entity_id = m.id::text
     and e.occurred_at > now() - interval '10 minutes';
  if _fails >= 5 then
    return jsonb_build_object('status', 'locked', 'mechanic_name', m.name);
  end if;

  select p.pin_hash into _hash from public.workshop_mechanic_pins p where p.mechanic_id = m.id;
  if _hash is not null then
    _ok := _p <> '' and extensions.crypt(_p, _hash) = _hash;
  else
    _code := public._workshop_mechanic_pointeuse_code(m.id);
    if _code is null then
      return jsonb_build_object('status', 'no_code', 'mechanic_name', m.name);
    end if;
    _ok := _p <> '' and upper(_p) = upper(btrim(_code));
  end if;

  if not _ok then
    insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
    values (_company, auth.uid(), 'workshop_shared_pin_failed', 'workshop_mechanics', m.id::text, 'tablet',
            jsonb_build_object('mechanic', m.name, 'from_account', auth.uid()));
    return jsonb_build_object('status', 'wrong_code', 'mechanic_name', m.name, 'attempts_left', greatest(0, 4 - _fails));
  end if;

  select * into idn from public._workshop_mechanic_identity(m.id);
  _ttl := public._workshop_shared_ttl(_company);
  -- Une seule identite a la fois sur un compte tablette.
  update public.workshop_shared_sessions set ended_at = now()
   where account_id = auth.uid() and ended_at is null;
  insert into public.workshop_shared_sessions (company_id, account_id, workshop_mechanic_id, mechanic_user_id, mechanic_code, mechanic_name, expires_at)
  values (_company, auth.uid(), m.id, idn.user_id, idn.code, m.name, now() + make_interval(secs => _ttl))
  returning id, expires_at into _id, _exp;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (_company, auth.uid(), 'workshop_shared_identified', 'workshop_mechanics', m.id::text, 'tablet',
          jsonb_build_object('mechanic', m.name, 'from_account', auth.uid(), 'session', _id));
  return jsonb_build_object('status', 'ok', 'session', _id, 'expires_at', _exp, 'ttl_seconds', _ttl,
                            'mechanic_id', m.id, 'mechanic_name', m.name, 'mechanic_code', idn.code, 'mechanic_user_id', idn.user_id);
end $$;
revoke all on function public.workshop_shared_identify(uuid, uuid, text) from public, anon;
grant execute on function public.workshop_shared_identify(uuid, uuid, text) to authenticated;

-- Identite valide du compte connecte (et prolongee : l'identite tient tant qu'on travaille).
-- Expiree ou inconnue : erreur 28000, l'ecran redemande « Qui etes-vous ? ».
create or replace function public._workshop_shared_session_use(_session uuid)
returns public.workshop_shared_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype;
begin
  select * into s from public.workshop_shared_sessions
   where id = _session and account_id = auth.uid() and ended_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'Identification expiree : touchez votre nom et tapez votre code.' using errcode = '28000';
  end if;
  update public.workshop_shared_sessions
     set expires_at = now() + make_interval(secs => public._workshop_shared_ttl(s.company_id))
   where id = s.id returning * into s;
  return s;
end $$;
revoke all on function public._workshop_shared_session_use(uuid) from public, anon, authenticated;

create or replace function public.workshop_shared_end(_session uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.workshop_shared_sessions set ended_at = now()
   where id = _session and account_id = auth.uid() and ended_at is null;
$$;
revoke all on function public.workshop_shared_end(uuid) from public, anon;
grant execute on function public.workshop_shared_end(uuid) to authenticated;

-- Trace d'un geste fait sous une identite partagee (qui a agi, depuis quel compte).
create or replace function public._workshop_shared_event(s public.workshop_shared_sessions, _action text, _entity_type text, _entity_id text, _data jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, new_data)
  values (s.company_id, auth.uid(), 'workshop_shared_action', coalesce(_entity_type, 'workshop_mechanics'),
          coalesce(_entity_id, s.workshop_mechanic_id::text), 'tablet',
          coalesce(_data, '{}'::jsonb) || jsonb_build_object(
            'gesture', _action, 'acting_mechanic', s.mechanic_name, 'workshop_mechanic_id', s.workshop_mechanic_id,
            'mechanic_user_id', s.mechanic_user_id, 'mechanic_code', s.mechanic_code, 'from_account', auth.uid(),
            'from_account_name', (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.profiles p where p.id = auth.uid())));
$$;
revoke all on function public._workshop_shared_event(public.workshop_shared_sessions, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.workshop_shared_trace(_session uuid, _action text, _entity_type text default null, _entity_id text default null, _data jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype; _a text := left(coalesce(nullif(btrim(_action), ''), 'autre'), 40);
begin
  s := public._workshop_shared_session_use(_session);
  perform public._workshop_shared_event(s, _a, left(_entity_type, 60), left(_entity_id, 80), _data);
  return jsonb_build_object('status', 'traced', 'mechanic_name', s.mechanic_name, 'mechanic_code', s.mechanic_code,
                            'mechanic_user_id', s.mechanic_user_id, 'workshop_mechanic_id', s.workshop_mechanic_id);
end $$;
revoke all on function public.workshop_shared_trace(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.workshop_shared_trace(uuid, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Pointage : corps communs (identite en parametre), UN POINTAGE ACTIF PAR SOCIETE
-- ---------------------------------------------------------------------
-- Pointage de travail ouvert du mecanicien DANS LA SOCIETE (20261119241000 cherchait le compte
-- dans toutes les societes : ItalTest interrompait ITALBIKE STORE).
create or replace function public._wte_open_work(_company uuid, _uid uuid, _code text)
returns public.workshop_time_entries
language sql stable security definer set search_path = public, pg_temp as $$
  select e.* from public.workshop_time_entries e
   where e.ended_at is null and e.kind in ('travail', 'improductif')
     and e.company_id = _company
     and case when _code is not null then e.mechanic_code = _code
              else e.mechanic_id = _uid and e.mechanic_code is null end
   order by e.started_at desc
   limit 1;
$$;
revoke all on function public._wte_open_work(uuid, uuid, text) from public, anon, authenticated;

-- Index unique « un seul travail ouvert par compte » : par societe (pose si les donnees le permettent).
do $$
begin
  if not exists (
    select 1 from public.workshop_time_entries
     where ended_at is null and kind in ('travail', 'improductif') and mechanic_id is not null and mechanic_code is null
     group by company_id, mechanic_id having count(*) > 1
  ) then
    drop index if exists public.uq_wte_one_open_work_user;
    create unique index if not exists uq_wte_one_open_work_user_company on public.workshop_time_entries(company_id, mechanic_id)
      where ended_at is null and kind in ('travail', 'improductif') and mechanic_id is not null and mechanic_code is null;
  else
    raise notice 'Plusieurs travaux ouverts pour un meme compte dans une societe : index non change.';
  end if;
end $$;

-- Pointage vise, pour une identite donnee (compte _uid ou code _code), dans la societe _company
-- (sinon celle de l'OR) : jamais un pointage d'une autre societe.
drop function if exists public._wte_target_for(uuid, uuid, text, uuid);
create or replace function public._wte_target_for(_entry uuid, _or uuid, _code text, _uid uuid, _company uuid default null)
returns public.workshop_time_entries
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype; _c text := nullif(btrim(coalesce(_code, '')), ''); _co uuid := _company;
begin
  if _entry is not null then
    select * into e from public.workshop_time_entries where id = _entry and (_company is null or company_id = _company);
    return e;
  end if;
  if _or is not null then select company_id into _co from public.repair_orders where id = _or; end if;
  select x.* into e from public.workshop_time_entries x
   where x.ended_at is null and x.kind in ('travail', 'improductif')
     and (_or is null or x.or_id = _or)
     and (_co is null or x.company_id = _co)
     and case when _c is not null then x.mechanic_code = _c
              else x.mechanic_id = _uid and x.mechanic_code is null end
   order by x.started_at desc limit 1;
  return e;
end $$;
revoke all on function public._wte_target_for(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public._wte_target(_entry uuid, _or uuid, _mechanic_code text)
returns public.workshop_time_entries
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public._wte_target_for(_entry, _or, _mechanic_code, auth.uid(), null);
$$;
revoke all on function public._wte_target(uuid, uuid, text) from public, anon, authenticated;

-- Corps de « Demarrer / Reprendre » (20261119241000), l'identite en parametre (_uid ou _code) ;
-- _wm_hint = compagnon connu (tablette partagee).
create or replace function public._workshop_work_start_core(
  _or uuid, _operation text, _confirm_switch boolean, _uid uuid, _mechanic_code text, _mechanic_name text,
  _origin text, _wm_hint uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.repair_orders%rowtype;
  _code text := nullif(btrim(coalesce(_mechanic_code, '')), '');
  _op text := nullif(btrim(coalesce(_operation, '')), '');
  _open public.workshop_time_entries%rowtype;
  _name text; _wm uuid; _id uuid; _resumed boolean; _switched uuid; _at timestamptz;
begin
  select * into r from public.repair_orders where id = _or;
  if not found then raise exception 'Ordre de reparation introuvable.' using errcode = 'P0002'; end if;
  if not public.can_write_table(r.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if _uid is null and _code is null then
    raise exception 'Pointage : mecanicien inconnu (compte connecte ou code mecano).' using errcode = '22023';
  end if;
  if r.status not in ('a_faire', 'attente_devis', 'attente_pieces', 'en_cours') then
    raise exception 'OR % : il ne se pointe plus (statut %).', coalesce(r.number, r.id::text), r.status using errcode = '23514';
  end if;
  if coalesce(r.customer_approval, '') = 'en_attente' then
    raise exception 'OR % : accord du client en attente, le travail ne peut pas commencer.', coalesce(r.number, r.id::text) using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('wte:' || coalesce(_code, _uid::text) || '@' || r.company_id::text));

  if _op is null then
    select e.journey_operation into _op
      from public.workshop_time_entries e
     where e.or_id = _or and e.kind = 'travail' and e.ended_at is not null
       and case when _code is not null then e.mechanic_code = _code else e.mechanic_id = _uid and e.mechanic_code is null end
     order by e.ended_at desc limit 1;
  end if;

  select * into _open from public._wte_open_work(r.company_id, _uid, _code);
  if _open.id is not null then
    if _open.kind = 'travail' and _open.or_id = _or and (_operation is null or _open.journey_operation is not distinct from _op) then
      return jsonb_build_object('status', 'already', 'entry_id', _open.id, 'started_at', _open.started_at,
                                'operation', _open.journey_operation, 'or_status', r.status);
    end if;
    if not (_open.kind = 'travail' and _open.or_id = _or) and not coalesce(_confirm_switch, false) then
      return jsonb_build_object('status', 'needs_confirm', 'current', jsonb_build_object(
        'entry_id', _open.id, 'kind', _open.kind, 'or_id', _open.or_id,
        'or_number', (select o.number from public.repair_orders o where o.id = _open.or_id),
        'task_code', _open.task_code, 'started_at', _open.started_at, 'operation', _open.journey_operation));
    end if;
    perform public._wte_close(_open.id, 'switch',
      case when _open.kind = 'travail' and _open.or_id = _or then 'autre_operation' else 'autre_or' end, now(), _origin);
    _switched := _open.id;
  end if;

  if r.status in ('a_faire', 'attente_devis', 'attente_pieces') then
    perform public.repair_order_start(_or);
  end if;

  if _wm_hint is not null then
    select m.id, m.name into _wm, _name from public.workshop_mechanics m where m.id = _wm_hint and m.company_id = r.company_id;
  end if;
  if _wm is null and _code is not null then
    _name := coalesce((select rv.label from public.reference_values rv
                        where rv.company_id = r.company_id and rv.table_key = 'workshop_mechanic' and rv.code = _code limit 1),
                      nullif(btrim(coalesce(_mechanic_name, '')), ''), _code);
    select m.id into _wm from public.workshop_mechanics m
     where m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(_name)) order by m.is_active desc, m.sort_order limit 1;
  elsif _wm is null then
    select m.id, m.name into _wm, _name from public.workshop_mechanics m
     where m.company_id = r.company_id and m.user_id = _uid order by m.is_active desc, m.sort_order limit 1;
    _name := coalesce(nullif(btrim(coalesce(_mechanic_name, '')), ''), _name,
                      (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.profiles p where p.id = _uid));
  end if;

  _resumed := exists (
    select 1 from public.workshop_time_entries e
     where e.or_id = _or and e.kind = 'travail' and e.ended_at is not null
       and case when _code is not null then e.mechanic_code = _code else e.mechanic_id = _uid and e.mechanic_code is null end);

  insert into public.workshop_time_entries
    (company_id, mechanic_id, mechanic_name, mechanic_code, workshop_mechanic_id, or_id, journey_operation, kind, started_at)
  values (r.company_id, case when _code is null then _uid end, _name, _code, _wm, _or, _op, 'travail', now())
  returning id, started_at into _id, _at;

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (r.company_id, auth.uid(), case when _resumed then 'workshop_work_resumed' else 'workshop_work_started' end,
          'repair_orders', _or::text, _origin,
          case when _switched is not null then jsonb_build_object('switched_from', _switched) end,
          jsonb_build_object('time_entry_id', _id, 'mechanic', _name, 'mechanic_code', _code, 'journey_operation', _op));

  return jsonb_build_object('status', case when _resumed then 'resumed' else 'started' end,
                            'entry_id', _id, 'started_at', _at, 'operation', _op, 'switched_from', _switched,
                            'or_status', (select o.status from public.repair_orders o where o.id = _or));
end $$;
revoke all on function public._workshop_work_start_core(uuid, text, boolean, uuid, text, text, text, uuid) from public, anon, authenticated;

drop function if exists public._workshop_work_pause_core(text, uuid, uuid, text, uuid, text, text);
create or replace function public._workshop_work_pause_core(
  _reason text, _or uuid, _entry uuid, _or_status text, _uid uuid, _mechanic_code text, _origin text, _company uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.workshop_time_entries%rowtype;
  _r text := nullif(btrim(coalesce(_reason, '')), '');
  _st text := nullif(btrim(coalesce(_or_status, '')), '');
  o public.repair_orders%rowtype;
  _changed boolean := false;
begin
  if _r is null then raise exception 'Motif de pause obligatoire.' using errcode = '22023'; end if;
  select * into e from public._wte_target_for(_entry, _or, _mechanic_code, _uid, _company);
  if e.id is null then return jsonb_build_object('status', 'none'); end if;
  if not public.can_write_table(e.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  if e.ended_at is not null then return jsonb_build_object('status', 'none', 'entry_id', e.id); end if;
  if _r not in ('autre_or', 'autre_operation', 'fin_journee', 'autre')
     and not exists (select 1 from public.reference_values rv
                      where rv.company_id = e.company_id and rv.table_key = 'workshop_pause_reason' and rv.code = _r and rv.is_active) then
    raise exception 'Motif de pause inconnu : %.', _r using errcode = '22023';
  end if;
  if _st is not null and _st not in ('attente_pieces', 'attente_devis') then
    raise exception 'Statut d''OR propose inconnu : %.', _st using errcode = '22023';
  end if;

  e := public._wte_close(e.id, 'pause', _r, now(), _origin);

  if _st is not null and e.or_id is not null then
    select * into o from public.repair_orders where id = e.or_id for update;
    if found and o.status in ('a_faire', 'en_cours') and o.status <> _st
       and not exists (select 1 from public.workshop_time_entries x where x.or_id = o.id and x.kind = 'travail' and x.ended_at is null) then
      update public.repair_orders set status = _st where id = o.id;
      insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
      values (o.company_id, auth.uid(), 'repair_order_status_from_pause', 'repair_orders', o.id::text, _origin,
              jsonb_build_object('status', o.status), jsonb_build_object('status', _st, 'reason', _r, 'time_entry_id', e.id));
      _changed := true;
    end if;
  end if;

  return jsonb_build_object('status', 'paused', 'entry_id', e.id, 'minutes', e.minutes, 'reason', _r,
                            'or_id', e.or_id, 'or_status_changed', _changed);
end $$;
revoke all on function public._workshop_work_pause_core(text, uuid, uuid, text, uuid, text, text, uuid) from public, anon, authenticated;

drop function if exists public._workshop_work_stop_core(uuid, uuid, uuid, text, text, text);
create or replace function public._workshop_work_stop_core(_or uuid, _entry uuid, _uid uuid, _mechanic_code text, _kind text, _origin text, _company uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.workshop_time_entries%rowtype;
begin
  if coalesce(_kind, 'stop') not in ('stop', 'departure') then
    raise exception 'Fin de pointage inconnue : %.', _kind using errcode = '22023';
  end if;
  select * into e from public._wte_target_for(_entry, _or, _mechanic_code, _uid, _company);
  if e.id is null or e.ended_at is not null then return jsonb_build_object('status', 'none'); end if;
  if not public.can_write_table(e.company_id, 'workshop_time_entries') then
    raise exception 'Acces refuse.' using errcode = '42501';
  end if;
  e := public._wte_close(e.id, coalesce(_kind, 'stop'), case when _kind = 'departure' then 'fin_journee' end, now(), _origin);
  return jsonb_build_object('status', 'stopped', 'entry_id', e.id, 'minutes', e.minutes, 'or_id', e.or_id);
end $$;
revoke all on function public._workshop_work_stop_core(uuid, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

-- Compte en mode partage sans identite : refus (le pointage doit porter le nom du mecanicien).
create or replace function public._workshop_shared_guard(_company uuid, _code text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if nullif(btrim(coalesce(_code, '')), '') is null and auth.uid() is not null
     and public._workshop_is_shared_account(_company, auth.uid()) then
    raise exception 'Tablette partagee : touchez d''abord « Qui etes-vous ? » (votre nom et votre code).' using errcode = '28000';
  end if;
end $$;
revoke all on function public._workshop_shared_guard(uuid, text) from public, anon, authenticated;

-- Fonctions publiques : memes signatures et memes reponses qu'au lot A.
create or replace function public.workshop_work_start(
  _or uuid, _operation text default null, _confirm_switch boolean default false,
  _mechanic_code text default null, _mechanic_name text default null, _origin text default 'screen'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._workshop_shared_guard((select r.company_id from public.repair_orders r where r.id = _or), _mechanic_code);
  return public._workshop_work_start_core(_or, _operation, _confirm_switch, auth.uid(), _mechanic_code, _mechanic_name, _origin, null);
end $$;
revoke all on function public.workshop_work_start(uuid, text, boolean, text, text, text) from public, anon;
grant execute on function public.workshop_work_start(uuid, text, boolean, text, text, text) to authenticated;

-- Pause / Terminer : la societe de l'ecran (_company) borne la recherche du pointage (decision du
-- 20/11 : une societe de test n'agit jamais sur la vraie). Sans _company (anciens appels) : la
-- societe du pointage donne, sinon de l'OR.
drop function if exists public.workshop_work_pause(text, uuid, uuid, text, text, text);
create or replace function public.workshop_work_pause(
  _reason text, _or uuid default null, _entry uuid default null, _or_status text default null,
  _mechanic_code text default null, _origin text default 'screen', _company uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _co uuid;
begin
  _co := coalesce(_company,
                  (select e.company_id from public.workshop_time_entries e where e.id = _entry),
                  (select r.company_id from public.repair_orders r where r.id = _or),
                  (select t.company_id from public.workshop_tablet_accounts t where t.user_id = auth.uid() and t.mode = 'shared' limit 1));
  perform public._workshop_shared_guard(_co, _mechanic_code);
  return public._workshop_work_pause_core(_reason, _or, _entry, _or_status, auth.uid(), _mechanic_code, _origin, _company);
end $$;
revoke all on function public.workshop_work_pause(text, uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.workshop_work_pause(text, uuid, uuid, text, text, text, uuid) to authenticated;

drop function if exists public.workshop_work_stop(uuid, uuid, text, text, text);
create or replace function public.workshop_work_stop(
  _or uuid default null, _entry uuid default null, _mechanic_code text default null,
  _kind text default 'stop', _origin text default 'screen', _company uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _co uuid;
begin
  _co := coalesce(_company,
                  (select e.company_id from public.workshop_time_entries e where e.id = _entry),
                  (select r.company_id from public.repair_orders r where r.id = _or),
                  (select t.company_id from public.workshop_tablet_accounts t where t.user_id = auth.uid() and t.mode = 'shared' limit 1));
  perform public._workshop_shared_guard(_co, _mechanic_code);
  return public._workshop_work_stop_core(_or, _entry, auth.uid(), _mechanic_code, _kind, _origin, _company);
end $$;
revoke all on function public.workshop_work_stop(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.workshop_work_stop(uuid, uuid, text, text, text, uuid) to authenticated;

-- Le pointage donne appartient-il au compagnon identifie ?
create or replace function public._wte_is_of(e public.workshop_time_entries, s public.workshop_shared_sessions)
returns boolean language sql immutable as $$
  select e.company_id = s.company_id
     and (e.workshop_mechanic_id = s.workshop_mechanic_id
          or (s.mechanic_code is not null and e.mechanic_code = s.mechanic_code)
          or (s.mechanic_user_id is not null and e.mechanic_id = s.mechanic_user_id and e.mechanic_code is null));
$$;
revoke all on function public._wte_is_of(public.workshop_time_entries, public.workshop_shared_sessions) from public, anon, authenticated;

create or replace function public.workshop_shared_work_start(
  _session uuid, _or uuid, _operation text default null, _confirm_switch boolean default false, _origin text default 'tablet'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype; _res jsonb;
begin
  s := public._workshop_shared_session_use(_session);
  if (select r.company_id from public.repair_orders r where r.id = _or) is distinct from s.company_id then
    raise exception 'OR d''une autre societe.' using errcode = '42501';
  end if;
  _res := public._workshop_work_start_core(_or, _operation, _confirm_switch, s.mechanic_user_id, s.mechanic_code,
                                          s.mechanic_name, _origin, s.workshop_mechanic_id);
  if _res->>'status' in ('started', 'resumed') then
    perform public._workshop_shared_event(s, case when _res->>'status' = 'resumed' then 'resume' else 'start' end,
      'repair_orders', _or::text, jsonb_build_object('time_entry_id', _res->>'entry_id', 'journey_operation', _res->>'operation'));
  end if;
  return _res || jsonb_build_object('mechanic_name', s.mechanic_name);
end $$;
revoke all on function public.workshop_shared_work_start(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.workshop_shared_work_start(uuid, uuid, text, boolean, text) to authenticated;

create or replace function public.workshop_shared_work_pause(
  _session uuid, _reason text, _or uuid default null, _entry uuid default null, _or_status text default null, _origin text default 'tablet'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype; e public.workshop_time_entries%rowtype; _res jsonb;
begin
  s := public._workshop_shared_session_use(_session);
  if _entry is not null then
    select * into e from public.workshop_time_entries where id = _entry;
    if found and not public._wte_is_of(e, s) then
      raise exception 'Ce pointage est celui de % : il le met en pause lui-meme.', coalesce(e.mechanic_name, e.mechanic_code, '?') using errcode = '42501';
    end if;
  end if;
  _res := public._workshop_work_pause_core(_reason, _or, _entry, _or_status, s.mechanic_user_id, s.mechanic_code, _origin, s.company_id);
  if _res->>'status' = 'paused' then
    perform public._workshop_shared_event(s, 'pause', 'workshop_time_entries', _res->>'entry_id',
      jsonb_build_object('reason', _reason, 'or_id', _res->>'or_id'));
  end if;
  return _res || jsonb_build_object('mechanic_name', s.mechanic_name);
end $$;
revoke all on function public.workshop_shared_work_pause(uuid, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.workshop_shared_work_pause(uuid, text, uuid, uuid, text, text) to authenticated;

create or replace function public.workshop_shared_work_stop(
  _session uuid, _or uuid default null, _entry uuid default null, _origin text default 'tablet'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype; e public.workshop_time_entries%rowtype; _res jsonb;
begin
  s := public._workshop_shared_session_use(_session);
  if _entry is not null then
    select * into e from public.workshop_time_entries where id = _entry;
    if found and not public._wte_is_of(e, s) then
      raise exception 'Ce pointage est celui de % : il le termine lui-meme.', coalesce(e.mechanic_name, e.mechanic_code, '?') using errcode = '42501';
    end if;
  end if;
  _res := public._workshop_work_stop_core(_or, _entry, s.mechanic_user_id, s.mechanic_code, 'stop', _origin, s.company_id);
  if _res->>'status' = 'stopped' then
    perform public._workshop_shared_event(s, 'finish', 'workshop_time_entries', _res->>'entry_id',
      jsonb_build_object('or_id', _res->>'or_id'));
  end if;
  return _res || jsonb_build_object('mechanic_name', s.mechanic_name);
end $$;
revoke all on function public.workshop_shared_work_stop(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.workshop_shared_work_stop(uuid, uuid, uuid, text) to authenticated;

-- Pointage en cours / en pause du compagnon identifie (bandeau de la tablette partagee).
create or replace function public.workshop_shared_current(_session uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.workshop_shared_sessions%rowtype; e public.workshop_time_entries%rowtype; l public.workshop_time_entries%rowtype;
begin
  s := public._workshop_shared_session_use(_session);
  select x.* into e from public.workshop_time_entries x
   where x.ended_at is null and x.kind in ('travail', 'improductif') and x.company_id = s.company_id and public._wte_is_of(x, s)
   order by x.started_at desc limit 1;
  if e.id is null then
    select x.* into l from public.workshop_time_entries x
     where x.ended_at is not null and x.kind = 'travail' and x.company_id = s.company_id and public._wte_is_of(x, s)
       and x.ended_at > now() - interval '7 days'
     order by x.ended_at desc limit 1;
  end if;
  return jsonb_build_object('mechanic_name', s.mechanic_name, 'expires_at', s.expires_at,
    'open', case when e.id is not null then to_jsonb(e) end,
    'last', case when l.id is not null then to_jsonb(l) end);
end $$;
revoke all on function public.workshop_shared_current(uuid) from public, anon;
grant execute on function public.workshop_shared_current(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Mode par compte (Planning → Reglages → Tablettes)
-- ---------------------------------------------------------------------
create or replace function public.workshop_tablet_accounts_list(_company uuid)
returns table(user_id uuid, name text, email text, roles text[], mode text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier'::public.app_role)) then
    raise exception 'Reserve a l''administrateur et au chef d''atelier.' using errcode = '42501';
  end if;
  return query
  select ur.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email, ur.user_id::text), p.email,
         array_agg(distinct ur.role::text order by ur.role::text),
         coalesce((select t.mode from public.workshop_tablet_accounts t where t.company_id = _company and t.user_id = ur.user_id), 'personal')
    from public.user_roles ur
    left join public.profiles p on p.id = ur.user_id
   where ur.company_id = _company
   group by ur.user_id, p.full_name, p.email
  having bool_or(ur.role in ('mecanicien', 'chef_atelier'))
   order by 2;
end $$;
revoke all on function public.workshop_tablet_accounts_list(uuid) from public, anon;
grant execute on function public.workshop_tablet_accounts_list(uuid) to authenticated;

create or replace function public.workshop_tablet_mode(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(_company) then raise exception 'Acces refuse.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'mode', case when public._workshop_is_shared_account(_company, auth.uid()) then 'shared' else 'personal' end,
    'ttl_seconds', public._workshop_shared_ttl(_company));
end $$;
revoke all on function public.workshop_tablet_mode(uuid) from public, anon;
grant execute on function public.workshop_tablet_mode(uuid) to authenticated;

create or replace function public.workshop_tablet_mode_set(_company uuid, _user uuid, _mode text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _old text; _hidden int := 0;
begin
  if not (public.is_admin(_company) or public.has_role(_company, 'chef_atelier'::public.app_role)) then
    raise exception 'Mode des tablettes : reserve a l''administrateur et au chef d''atelier.' using errcode = '42501';
  end if;
  if _mode not in ('personal', 'shared') then raise exception 'Mode inconnu : %.', _mode using errcode = '22023'; end if;
  if not exists (select 1 from public.user_roles ur where ur.user_id = _user and ur.company_id = _company) then
    raise exception 'Ce compte n''est pas membre de la societe.' using errcode = '22023';
  end if;
  if _mode = 'shared' and _user = auth.uid() and not exists (
       select 1 from public.workshop_tablet_accounts t where t.company_id = _company and t.user_id = _user and t.mode = 'shared') then
    -- Garde-fou : on ne passe pas son propre compte en tablette partagee par megarde.
    if public.is_admin(_company) then
      raise exception 'Votre propre compte administrateur ne devient pas une tablette partagee.' using errcode = '22023';
    end if;
  end if;
  select t.mode into _old from public.workshop_tablet_accounts t where t.company_id = _company and t.user_id = _user;
  insert into public.workshop_tablet_accounts (company_id, user_id, mode, updated_at, updated_by)
  values (_company, _user, _mode, now(), auth.uid())
  on conflict (company_id, user_id) do update set mode = excluded.mode, updated_at = now(), updated_by = auth.uid();
  if _mode = 'shared' then
    -- La fiche compagnon creee automatiquement pour ce compte (role mecanicien) n'est pas un mecanicien.
    update public.workshop_mechanics set is_active = false, visible_in_planning = false
     where company_id = _company and user_id = _user and (is_active or visible_in_planning);
    get diagnostics _hidden = row_count;
    update public.workshop_shared_sessions set ended_at = now() where account_id = _user and ended_at is null and company_id = _company;
  else
    perform public.workshop_mechanic_sync(_user, _company);
  end if;
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (_company, auth.uid(), 'workshop_tablet_mode_set', 'workshop_tablet_accounts', _user::text, 'screen',
          jsonb_build_object('mode', coalesce(_old, 'personal')),
          jsonb_build_object('mode', _mode, 'mechanic_card_hidden', _hidden > 0));
  return jsonb_build_object('mode', _mode, 'mechanic_card_hidden', _hidden > 0);
end $$;
revoke all on function public.workshop_tablet_mode_set(uuid, uuid, text) from public, anon;
grant execute on function public.workshop_tablet_mode_set(uuid, uuid, text) to authenticated;

-- workshop_mechanic_sync (20261119300000) : un compte tablette partagee garde sa fiche inactive.
create or replace function public.workshop_mechanic_sync(_user uuid, _company uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  _has boolean;
  _id uuid;
  _name text;
begin
  if _user is null or _company is null then return null; end if;

  _has := exists (select 1 from public.user_roles ur
                  where ur.user_id = _user and ur.company_id = _company and ur.role in ('mecanicien', 'chef_atelier'));

  select m.id into _id from public.workshop_mechanics m where m.company_id = _company and m.user_id = _user;

  -- Q60 : compte « tablette atelier » partage : pas un compagnon du planning.
  if public._workshop_is_shared_account(_company, _user) then
    if _id is not null then
      update public.workshop_mechanics set is_active = false, visible_in_planning = false
       where id = _id and (is_active or visible_in_planning);
    end if;
    return _id;
  end if;

  if not _has then
    if _id is not null then
      update public.workshop_mechanics set is_active = false where id = _id and is_active;
    end if;
    return _id;
  end if;

  if _id is not null then
    update public.workshop_mechanics set is_active = true where id = _id and not is_active;
    return _id;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), u.email, 'Mecanicien')
    into _name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = _user;
  _name := coalesce(_name, 'Mecanicien');

  select m.id into _id
  from public.workshop_mechanics m
  where m.company_id = _company and m.user_id is null
    and public.workshop_mechanic_norm_name(m.name) = public.workshop_mechanic_norm_name(_name)
  order by m.is_active desc, m.created_at, m.id
  limit 1;

  if _id is not null then
    update public.workshop_mechanics set user_id = _user, is_active = true where id = _id;
    return _id;
  end if;

  insert into public.workshop_mechanics (company_id, user_id, name, visible_in_planning, is_active, sort_order)
  values (_company, _user, _name, true, true,
          coalesce((select max(m.sort_order) from public.workshop_mechanics m where m.company_id = _company), 0) + 10)
  on conflict (company_id, user_id) where user_id is not null do nothing
  returning id into _id;

  if _id is null then
    select m.id into _id from public.workshop_mechanics m where m.company_id = _company and m.user_id = _user;
    return _id;
  end if;

  insert into public.workshop_mechanic_hours (company_id, mechanic_id, weekday, am_start, am_end, pm_start, pm_end)
  select _company, _id, d.weekday, d.am_start, d.am_end, d.pm_start, d.pm_end
  from public.workshop_mechanic_default_hours(_company, _id) d
  on conflict (mechanic_id, weekday) do nothing;

  return _id;
end $function$;
revoke all on function public.workshop_mechanic_sync(uuid, uuid) from public, anon, authenticated;
