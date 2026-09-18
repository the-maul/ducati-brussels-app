-- =====================================================================
-- MISSION 01 — LOT 4 : inscription client en ligne (/inscription) et sur la
-- borne du comptoir (/borne). Migration STRICTEMENT ADDITIVE.
--
--   1. signup_settings        : la société qui reçoit les inscriptions publiques
--                               (réglage explicite, une seule ligne).
--   2. contacts.marketing_consent_at / _source : preuve RGPD du consentement.
--   3. contact_declared_vehicles : la moto DÉCLARÉE par le client (sans VIN,
--                               non vérifiée) — distincte du parc `vehicles`.
--   4. signup_precheck        : que dit l'e-mail ? (décision D3)
--   5. signup_register        : fiche + compte client + consentement + moto +
--                               carte CRM et tâche si « être recontacté » (K-2),
--                               en UNE transaction.
--
-- Décisions : P-4, K-1 à K-4, D3, C-1, C-2, U-2, S-1 (docs/bible/decisions.md).
-- Les deux fonctions ne sont appelables qu'avec la clé de service (server
-- function src/modules/signup/signup.functions.ts). Aucun accès public direct.
-- =====================================================================

-- ------------------------------------------------ 1. Société cible (réglage)
-- Une seule ligne (id = true). Aujourd'hui : ITALBIKE STORE. NL INVEST n'est
-- jamais utilisée (décision S-1). Changer de société = modifier cette ligne,
-- aucune société n'est « devinée » par le code.
create table if not exists public.signup_settings (
  id          boolean primary key default true check (id),
  company_id  uuid not null references public.companies(id) on delete restrict,
  is_open     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
comment on table public.signup_settings is
  'Réglage unique : société qui reçoit les inscriptions publiques (page /inscription, borne /borne). '
  'is_open = false ferme l''inscription sans toucher au code.';
alter table public.signup_settings enable row level security;
drop policy if exists signup_settings_member_read on public.signup_settings;
create policy signup_settings_member_read on public.signup_settings
  for select using (public.is_member(company_id));
drop policy if exists signup_settings_admin_write on public.signup_settings;
create policy signup_settings_admin_write on public.signup_settings
  for all using (public.is_admin(company_id)) with check (public.is_admin(company_id));

insert into public.signup_settings (id, company_id)
select true, c.id from public.companies c where c.code = 'italbike'
on conflict (id) do nothing;

-- ------------------------------------------------ 2. Consentement marketing
alter table public.contacts
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_source text;
comment on column public.contacts.marketing_consent_at is
  'Moment où le client a répondu lui-même à la case de consentement marketing (inscription). '
  'La réponse est dans marketing_opt_out.';
comment on column public.contacts.marketing_consent_source is
  'Où le client a répondu : web (page d''inscription) ou comptoir (borne).';

-- ------------------------------------------------ 3. Moto déclarée
-- Le parc `vehicles` est l'objet pivot VIN (B9) et porte un statut de stock :
-- on n'y met PAS une moto dont on ne connaît ni le châssis ni l'état. La
-- déclaration vit ici, et pourra être rattachée à une vraie fiche véhicule
-- (vehicle_id) quand l'atelier ou le vendeur la verra.
create table if not exists public.contact_declared_vehicles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  kind        text not null check (kind in ('ducati', 'other_brand', 'none')),
  brand       text,
  family      text,
  model       text,
  model_year  integer check (model_year is null or model_year between 1920 and 2100),
  source      text not null check (source in ('web', 'comptoir', 'manuel')),
  vehicle_id  uuid references public.vehicles(id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table public.contact_declared_vehicles is
  'Moto actuelle DÉCLARÉE par le client à l''inscription (non vérifiée, sans VIN). '
  'kind = none : « pas encore de moto ». vehicle_id : fiche véhicule réelle une fois identifiée.';
create index if not exists idx_contact_declared_vehicles_contact
  on public.contact_declared_vehicles(contact_id, created_at desc);
alter table public.contact_declared_vehicles enable row level security;
drop policy if exists contact_declared_vehicles_member on public.contact_declared_vehicles;
create policy contact_declared_vehicles_member on public.contact_declared_vehicles
  for all using (public.is_member(company_id)) with check (public.is_member(company_id));
-- Le client (portail, lot 3) lit ses propres déclarations.
drop policy if exists contact_declared_vehicles_own_read on public.contact_declared_vehicles;
create policy contact_declared_vehicles_own_read on public.contact_declared_vehicles
  for select using (contact_id in (select ca.contact_id from public.contact_accounts ca where ca.user_id = auth.uid()));

-- ------------------------------------------------ 4. Pré-contrôle (D3)
-- 'account_exists'  : un compte de connexion existe déjà pour cet e-mail
--                     (client rattaché à une fiche, ou membre de l'équipe) ;
-- 'existing_contact': une seule fiche active porte cet e-mail, sans compte ;
-- 'shared_email'    : plusieurs fiches portent cet e-mail (adresse partagée) ;
-- 'new'             : inconnu.
create or replace function public.signup_precheck(_company uuid, _email text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  _e text := lower(btrim(coalesce(_email, '')));
  _n integer;
begin
  if _e = '' then raise exception 'signup_precheck: e-mail manquant'; end if;

  if exists (select 1 from public.profiles p where lower(p.email) = _e)
     or exists (select 1 from auth.users u where lower(u.email) = _e) then
    return 'account_exists';
  end if;

  if exists (
    select 1 from public.contacts c
      join public.contact_accounts ca on ca.contact_id = c.id
     where c.company_id = _company
       and (lower(c.email) = _e or lower(c.email_pro) = _e)
  ) then
    return 'account_exists';
  end if;

  select count(*) into _n from public.contacts c
   where c.company_id = _company and c.is_active
     and (lower(c.email) = _e or lower(c.email_pro) = _e);

  return case when _n = 0 then 'new' when _n = 1 then 'existing_contact' else 'shared_email' end;
end $fn$;
revoke all on function public.signup_precheck(uuid, text) from public, anon, authenticated;
grant execute on function public.signup_precheck(uuid, text) to service_role;

-- ------------------------------------------------ 5. Enregistrement
-- _user : compte de connexion DÉJÀ créé par la server function (API admin).
-- _p    : { first_name, last_name, phone, interests[], marketing_consent,
--           recontact, message, moto: { kind, brand, family, model, year } }
-- Règles :
--   - fiche existante sans compte : rattachée ; on ne complète QUE les champs vides ;
--   - adresse partagée par plusieurs fiches : on n'en choisit AUCUNE au hasard ;
--     nouvelle fiche + rapprochements proposés (fusion validée à la main, D3/F-9) ;
--   - « être recontacté » : carte du CRM commercial déjà ouverte réutilisée, sinon
--     créée ; une tâche « Recontacter le client » à J+2 au responsable par défaut
--     seulement si la carte n'a pas déjà une tâche ouverte (C-1, C-2).
create or replace function public.signup_register(
  _company uuid,
  _user    uuid,
  _email   text,
  _origin  text,
  _p       jsonb
)
returns table(contact_id uuid, lead_id uuid, contact_created boolean, lead_created boolean, task_created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  _e        text := lower(btrim(coalesce(_email, '')));
  _first    text := nullif(btrim(coalesce(_p->>'first_name', '')), '');
  _last     text := nullif(btrim(coalesce(_p->>'last_name', '')), '');
  _phone    text := nullif(btrim(coalesce(_p->>'phone', '')), '');
  _message  text := nullif(btrim(coalesce(_p->>'message', '')), '');
  _consent  boolean := coalesce((_p->>'marketing_consent')::boolean, false);
  _recall   boolean := coalesce((_p->>'recontact')::boolean, false);
  _interests text[] := coalesce(array(select jsonb_array_elements_text(coalesce(_p->'interests', '[]'::jsonb))), '{}');
  _mkind    text := nullif(btrim(coalesce(_p#>>'{moto,kind}', '')), '');
  _mbrand   text := nullif(btrim(coalesce(_p#>>'{moto,brand}', '')), '');
  _mfamily  text := nullif(btrim(coalesce(_p#>>'{moto,family}', '')), '');
  _mmodel   text := nullif(btrim(coalesce(_p#>>'{moto,model}', '')), '');
  _myear    integer := nullif(btrim(coalesce(_p#>>'{moto,year}', '')), '')::integer;
  _moto_txt text;
  _cid      uuid;
  _lid      uuid;
  _owner    uuid;
  _n        integer;
  _c_new    boolean := false;
  _l_new    boolean := false;
  _t_new    boolean := false;
  _label    text;
  _para     text;
begin
  if _e = '' or _first is null or _last is null then
    raise exception 'signup_register: prénom, nom et e-mail obligatoires';
  end if;
  if _origin not in ('web', 'comptoir') then
    raise exception 'signup_register: origine inconnue %', _origin;
  end if;
  if _user is null or not exists (select 1 from auth.users u where u.id = _user) then
    raise exception 'signup_register: compte de connexion introuvable';
  end if;
  if exists (select 1 from public.contact_accounts ca where ca.user_id = _user) then
    raise exception 'account_exists';
  end if;

  -- Deux envois simultanés du même e-mail ne créent pas deux fiches.
  perform pg_advisory_xact_lock(hashtext('signup:' || _e));

  if exists (
    select 1 from public.contacts c
      join public.contact_accounts ca on ca.contact_id = c.id
     where c.company_id = _company
       and (lower(c.email) = _e or lower(c.email_pro) = _e)
  ) then
    raise exception 'account_exists';
  end if;

  select count(*) into _n from public.contacts c
   where c.company_id = _company and c.is_active
     and (lower(c.email) = _e or lower(c.email_pro) = _e);

  if _n = 1 then
    select c.id into _cid from public.contacts c
     where c.company_id = _company and c.is_active
       and (lower(c.email) = _e or lower(c.email_pro) = _e);
    -- On complète, on n'écrase jamais.
    update public.contacts c set
      first_name = coalesce(nullif(btrim(c.first_name), ''), _first),
      last_name  = coalesce(nullif(btrim(c.last_name), ''), _last),
      mobile     = case when coalesce(btrim(c.mobile), '') = '' and coalesce(btrim(c.phone), '') = ''
                        then _phone else c.mobile end,
      interests  = case when coalesce(cardinality(c.interests), 0) = 0 then _interests else c.interests end,
      marketing_opt_out        = not _consent,
      marketing_consent_at     = now(),
      marketing_consent_source = _origin
     where c.id = _cid;
  else
    insert into public.contacts (
      company_id, type, status, origin, is_active,
      first_name, last_name, email, mobile, interests,
      marketing_opt_out, marketing_consent_at, marketing_consent_source
    ) values (
      _company, 'particulier'::contact_type, 'prospect'::contact_status, _origin, true,
      _first, _last, _e, _phone, _interests,
      not _consent, now(), _origin
    )
    returning id into _cid;
    _c_new := true;

    if _n > 1 then
      insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
      select _company, _cid, c.id, 'Même adresse e-mail (inscription ' || _origin || ')'
        from public.contacts c
       where c.company_id = _company and c.is_active and c.id <> _cid
         and (lower(c.email) = _e or lower(c.email_pro) = _e)
      on conflict (contact_id, candidate_id) do nothing;
    end if;
  end if;

  insert into public.contact_accounts (user_id, contact_id, company_id, created_by)
  values (_user, _cid, _company, null);

  -- Moto déclarée.
  if _mkind in ('ducati', 'other_brand', 'none') then
    insert into public.contact_declared_vehicles (company_id, contact_id, kind, brand, family, model, model_year, source)
    values (
      _company, _cid, _mkind,
      case when _mkind = 'ducati' then 'Ducati' when _mkind = 'other_brand' then _mbrand end,
      case when _mkind = 'ducati' then _mfamily end,
      case when _mkind <> 'none' then _mmodel end,
      case when _mkind <> 'none' then _myear end,
      _origin
    );
  end if;
  _moto_txt := case _mkind
    when 'ducati' then concat_ws(' ', 'Ducati', _mmodel, case when _myear is not null then '(' || _myear || ')' end)
    when 'other_brand' then concat_ws(' ', _mbrand, _mmodel, case when _myear is not null then '(' || _myear || ')' end)
    when 'none' then 'pas encore de moto'
  end;

  -- Carte CRM : UNIQUEMENT si le client a demandé à être recontacté (K-2).
  if _recall then
    _label := concat_ws(' ', _first, _last);
    _para := concat_ws(E'\n',
      'Inscription ' || case when _origin = 'comptoir' then 'à la borne du comptoir' else 'sur la page en ligne' end
        || ' le ' || to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY à HH24:MI')
        || ' : le client demande à être recontacté.',
      case when _moto_txt is not null then 'Moto actuelle : ' || _moto_txt end,
      case when cardinality(_interests) > 0 then 'Intérêts : ' || array_to_string(_interests, ', ') end,
      case when _message is not null then 'Message : ' || _message end);

    select l.id into _lid
      from public.leads l
     where l.company_id = _company and l.contact_id = _cid
       and l.pipeline = 'commercial'
       and l.archived_at is null
       and l.stage not in ('gagne', 'perdu')
     order by l.created_at
     limit 1;

    if _lid is null then
      insert into public.leads (company_id, contact_id, name, email, phone, vehicle_interest, source, stage, pipeline, notes)
      values (_company, _cid, _label, _e, _phone, _moto_txt, upper(_origin), 'nouveau', 'commercial', _para)
      returning id into _lid;
      _l_new := true;
    else
      update public.leads
         set notes = coalesce(nullif(notes, '') || E'\n\n', '') || _para,
             last_activity_at = now()
       where id = _lid;
    end if;

    if not exists (select 1 from public.lead_tasks t where t.lead_id = _lid and t.done_at is null) then
      _owner := public.default_assignee(_company);
      if _owner is not null then
        insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to)
        values (_company, _lid, 'Recontacter le client', now() + interval '2 days', _owner);
        _t_new := true;
      end if;
    end if;
  end if;

  return query select _cid, _lid, _c_new, _l_new, _t_new;
end $fn$;
revoke all on function public.signup_register(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.signup_register(uuid, uuid, text, text, jsonb) to service_role;
