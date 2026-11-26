-- =====================================================================
-- M1 — Plusieurs e-mails par fiche client, et un mail d'une nouvelle adresse au nom d'un client
-- connu demande à qui le rattacher (CON002, demande de Simon du 26/11/2026).
--
-- Cas réel : un client G8 écrit depuis son adresse professionnelle, inconnue du DMS. La relève
-- Outlook ne trouve aucune fiche avec cette adresse et en crée une seconde (même prénom, même
-- nom) : deux fiches pour la même personne.
--
-- Ce que fait cette migration :
--   1. Table `contact_emails` : toutes les adresses d'une fiche. L'e-mail principal (colonne
--      contacts.email) y est recopié automatiquement (is_primary) ; l'e-mail pro G8
--      (contacts.email_pro, non affiché sur la fiche) aussi, comme e-mail secondaire « pro » ;
--      les autres sont ajoutés depuis la fiche (« Autres e-mails »), par une fusion ou par le
--      rattachement d'un mail. Écriture uniquement par les fonctions ci-dessous (RLS : lecture
--      pour les membres). Trace : audit_row (events).
--   2. Partout où le DMS cherche une fiche par e-mail, les e-mails secondaires comptent :
--      relève Outlook (ingest_email, ingest_inbound_email, create_prospect_from_email), recherche
--      (contacts_search, contacts_search_count → recherche globale), correspondances DCS
--      (dcs_client_matches), inscription publique (signup_precheck, signup_register), doublons
--      (contacts_find_by_email_or_mobile, contacts_find_duplicates, contacts_match_candidates),
--      échanges partagés (contacts_sharing_email), CRM (crm_create_manual_lead,
--      crm_link_lead_contact), commandes Shopify (_shopify_order_apply), RGPD (export, purge).
--   3. Mail entrant d'une adresse inconnue au nom d'un client existant (même prénom + nom, ou
--      même société) : plus de fiche créée d'office. Le mail va dans la file « à rattacher »
--      (`email_attach_requests`, affichée dans la cloche) avec la question « Ajouter cette
--      adresse à <client> » / « Créer un nouveau client ». Aucun homonyme : comme avant.
--   4. Fusion de fiches : les e-mails de la fiche absorbée deviennent e-mails secondaires de la
--      fiche gardée, son mobile son « Mobile 2 » s'il est libre.
--   5. Reprise : chaque fiche reçoit son e-mail principal (et son e-mail pro) dans la table,
--      par insert … select (aucune valeur en clair).
--
-- Grandes fonctions retouchées EN PLACE (pg_temp._patch_fn) : on part de la définition réelle
-- en base (le dépôt et la base ont divergé par endroits) et on remplace un fragment précis ;
-- fragment introuvable = la migration échoue en entier (rien n'est modifié).
-- =====================================================================

create or replace function pg_temp._patch_fn(_fn regprocedure, _old text, _new text)
returns void
language plpgsql
as $$
declare _d text;
begin
  _d := pg_get_functiondef(_fn);
  if position(_new in _d) > 0 then
    return;                                   -- déjà retouchée : migration rejouable
  end if;
  if position(_old in _d) = 0 then
    raise exception 'PATCH_ANCHOR_NOT_FOUND: % — %', _fn::text, left(_old, 120);
  end if;
  execute replace(_d, _old, _new);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Les e-mails d'une fiche
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.contact_emails (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  email       text not null,
  -- Libellé affiché : « pro » ou « privé » (facultatif).
  kind        text check (kind in ('pro', 'prive')),
  -- Recopie de contacts.email (une seule par fiche).
  is_primary  boolean not null default false,
  -- fiche = contacts.email ; fiche_pro = contacts.email_pro ; ajout = saisi sur la fiche ;
  -- mail = adresse d'un mail rattaché à la fiche ; fusion = venu d'une fiche fusionnée.
  source      text not null default 'ajout' check (source in ('fiche', 'fiche_pro', 'ajout', 'mail', 'fusion')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint contact_emails_format check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint contact_emails_unique unique (company_id, contact_id, email)
);

create unique index if not exists contact_emails_one_primary on public.contact_emails (contact_id) where is_primary;
create index if not exists contact_emails_by_email on public.contact_emails (company_id, email);
create index if not exists contact_emails_by_contact on public.contact_emails (contact_id);

comment on table public.contact_emails is
  'M1 CON002 (26/11/2026) — Toutes les adresses e-mail d''une fiche (principale recopiée de contacts.email, pro G8, ajoutées, rattachées, fusionnées). Sert à retrouver une fiche par e-mail partout dans le DMS.';

alter table public.contact_emails enable row level security;
drop policy if exists contact_emails_select on public.contact_emails;
create policy contact_emails_select on public.contact_emails
  for select using (coalesce(company_id in (select public.rls_member_companies()), false));
-- Pas de policy d'écriture : ajout et retrait passent par contact_email_add / contact_email_remove.

grant select on public.contact_emails to authenticated;
grant all on public.contact_emails to service_role;

-- Reprise : l'e-mail principal et l'e-mail pro de chaque fiche (avant l'audit : pas 15 000 traces).
insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source, created_by)
select c.company_id, c.id, lower(btrim(c.email)), null, true, 'fiche', null
  from public.contacts c
 where lower(btrim(coalesce(c.email, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
on conflict (company_id, contact_id, email) do nothing;

insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source, created_by)
select c.company_id, c.id, lower(btrim(c.email_pro)), 'pro', false, 'fiche_pro', null
  from public.contacts c
 where lower(btrim(coalesce(c.email_pro, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+$'
on conflict (company_id, contact_id, email) do nothing;

-- Garde : société de la fiche, adresse en minuscules, l'e-mail principal ne se retire que par
-- la fiche (champ E-mail).
create or replace function public.trg_contact_emails_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_primary and exists (
         select 1 from public.contacts c
          where c.id = old.contact_id and lower(btrim(coalesce(c.email, ''))) = old.email) then
      raise exception 'CONTACT_EMAIL_PRIMARY' using errcode = '23514',
        hint = 'L''e-mail principal se change dans le champ E-mail de la fiche.';
    end if;
    return old;
  end if;
  new.email := lower(btrim(new.email));
  select c.company_id into new.company_id from public.contacts c where c.id = new.contact_id;
  if new.company_id is null then
    raise exception 'CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contact_emails_guard on public.contact_emails;
create trigger trg_contact_emails_guard
  before insert or update or delete on public.contact_emails
  for each row execute function public.trg_contact_emails_guard();

drop trigger if exists trg_contact_emails_audit on public.contact_emails;
create trigger trg_contact_emails_audit
  after insert or update or delete on public.contact_emails
  for each row execute function public.audit_row();

-- La fiche reste la source de l'e-mail principal et de l'e-mail pro : la table suit.
-- Un e-mail principal remplacé par une adresse déjà présente en secondaire la promeut ;
-- l'ancien principal saisi sur la fiche disparaît (comme dans le champ), un ancien principal
-- venu d'un ajout ou d'un mail redevient secondaire.
create or replace function public.trg_contacts_sync_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _e text := nullif(lower(btrim(coalesce(new.email, ''))), '');
  _p text := nullif(lower(btrim(coalesce(new.email_pro, ''))), '');
  _re constant text := '^[^@[:space:]]+@[^@[:space:]]+$';
begin
  if _e is not null and _e !~ _re then _e := null; end if;
  if _p is not null and (_p !~ _re or _p = _e) then _p := null; end if;

  if tg_op = 'INSERT' or new.email is distinct from old.email then
    update public.contact_emails set is_primary = false
     where contact_id = new.id and is_primary and email is distinct from _e;
    delete from public.contact_emails
     where contact_id = new.id and source = 'fiche' and not is_primary;
    if _e is not null then
      insert into public.contact_emails (company_id, contact_id, email, is_primary, source)
      values (new.company_id, new.id, _e, true, 'fiche')
      on conflict (company_id, contact_id, email) do update set is_primary = true;
    end if;
  end if;

  if tg_op = 'INSERT' or new.email_pro is distinct from old.email_pro or new.email is distinct from old.email then
    delete from public.contact_emails
     where contact_id = new.id and source = 'fiche_pro' and not is_primary and email is distinct from _p;
    if _p is not null then
      insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source)
      values (new.company_id, new.id, _p, 'pro', false, 'fiche_pro')
      on conflict (company_id, contact_id, email) do nothing;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_contacts_sync_emails on public.contacts;
create trigger trg_contacts_sync_emails
  after insert or update of email, email_pro on public.contacts
  for each row execute function public.trg_contacts_sync_emails();

-- Ajouter une adresse à une fiche (bouton « Ajouter » des « Autres e-mails »).
create or replace function public.contact_email_add(_contact uuid, _email text, _kind text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _co uuid;
  _e  text := nullif(lower(btrim(coalesce(_email, ''))), '');
  _id uuid;
begin
  select c.company_id into _co from public.contacts c where c.id = _contact;
  if _co is null then
    raise exception 'CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(_co in (select public.rls_writable_companies('contacts')), false) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _e is null or _e !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'CONTACT_EMAIL_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.contact_emails x where x.contact_id = _contact and x.email = _e) then
    raise exception 'CONTACT_EMAIL_EXISTS' using errcode = '23505';
  end if;
  insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source)
  values (_co, _contact, _e, case when _kind in ('pro', 'prive') then _kind end, false, 'ajout')
  returning id into _id;
  return _id;
end;
$$;

-- Retirer une adresse secondaire. L'e-mail pro G8 (contacts.email_pro) est vidé sur la fiche.
create or replace function public.contact_email_remove(_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _r public.contact_emails%rowtype;
begin
  select * into _r from public.contact_emails where id = _id;
  if _r.id is null then
    raise exception 'CONTACT_EMAIL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(_r.company_id in (select public.rls_writable_companies('contacts')), false) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _r.is_primary then
    raise exception 'CONTACT_EMAIL_PRIMARY' using errcode = '23514',
      hint = 'L''e-mail principal se change dans le champ E-mail de la fiche.';
  end if;
  if _r.source = 'fiche_pro' then
    update public.contacts set email_pro = null
     where id = _r.contact_id and lower(btrim(coalesce(email_pro, ''))) = _r.email;
  end if;
  delete from public.contact_emails where id = _id;
end;
$$;

revoke all on function public.contact_email_add(uuid, text, text) from public, anon;
revoke all on function public.contact_email_remove(uuid) from public, anon;
grant execute on function public.contact_email_add(uuid, text, text) to authenticated;
grant execute on function public.contact_email_remove(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Homonymes : même prénom + nom (dans un sens ou dans l'autre), ou même société.
--    Mêmes règles que src/modules/contacts/contact-emails-rules.ts (tests/).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_name_key(_v text)
returns text
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select nullif(btrim(regexp_replace(public.contact_norm_txt(_v), '[[:space:]-]+', ' ', 'g')), '');
$$;

create or replace function public.contacts_homonyms(
  _company uuid, _first text, _last text, _company_name text, _exclude uuid default null)
returns table (contact_id uuid, code text, display text, city text, reason text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with p as (
    select public.contact_name_key(_first) as f,
           public.contact_name_key(_last) as l,
           public.contact_name_key(_company_name) as co
  )
  select c.id, c.code,
         coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.code),
         c.city,
         case when p.f is not null and p.l is not null
                   and public.contact_name_key(concat_ws(' ', c.first_name, c.last_name))
                       in (p.f || ' ' || p.l, p.l || ' ' || p.f)
              then 'nom' else 'societe' end
    from public.contacts c, p
   where c.company_id = _company
     and (auth.uid() is null or public.is_member(_company))
     and c.is_active
     and c.type <> 'employe'
     and (_exclude is null or c.id <> _exclude)
     and (
          (p.f is not null and p.l is not null
           and public.contact_name_key(concat_ws(' ', c.first_name, c.last_name))
               in (p.f || ' ' || p.l, p.l || ' ' || p.f))
       or (p.co is not null and public.contact_name_key(c.company_name) = p.co)
     )
   order by c.created_at
   limit 10;
$$;

revoke all on function public.contacts_homonyms(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.contacts_homonyms(uuid, text, text, text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. File « à rattacher » : mails d'une adresse inconnue au nom d'un client existant.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.email_attach_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  communication_id uuid not null references public.communications(id) on delete cascade,
  -- Adresse de la personne (celle trouvée dans le corps si le mail est relayé par le site).
  email            text,
  -- Expéditeur technique du mail.
  sender           text,
  -- Ce que l'analyse du mail a extrait (nom, société, téléphone…) : sert à créer la fiche.
  extract          jsonb not null default '{}'::jsonb,
  -- Homonymes trouvés à l'arrivée du mail (la liste est recalculée à l'affichage).
  candidate_ids    uuid[] not null default '{}',
  status           text not null default 'a_traiter' check (status in ('a_traiter', 'rattache', 'nouveau_client')),
  contact_id       uuid references public.contacts(id) on delete set null,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid,
  constraint email_attach_requests_communication unique (communication_id)
);

create index if not exists email_attach_requests_pending
  on public.email_attach_requests (company_id, created_at) where status = 'a_traiter';

comment on table public.email_attach_requests is
  'M1 CON002 (26/11/2026) — Mail d''une adresse inconnue au nom d''un client existant : en attente du choix « ajouter l''adresse à ce client » ou « créer un nouveau client » (cloche).';

alter table public.email_attach_requests enable row level security;
drop policy if exists email_attach_requests_select on public.email_attach_requests;
create policy email_attach_requests_select on public.email_attach_requests
  for select using (coalesce(company_id in (select public.rls_member_companies()), false));
grant select on public.email_attach_requests to authenticated;
grant all on public.email_attach_requests to service_role;

drop trigger if exists trg_email_attach_requests_audit on public.email_attach_requests;
create trigger trg_email_attach_requests_audit
  after insert or update or delete on public.email_attach_requests
  for each row execute function public.audit_row();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Relève Outlook
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ingest_email(_company uuid, _direction text, _match_email text, _display_from text, _subject text, _body text, _received timestamp with time zone, _external_id text)
returns table(contact_id uuid, communication_id uuid, matched boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare _cid uuid; _existing uuid; _commid uuid;
  _m text := nullif(lower(btrim(coalesce(_match_email, ''))), '');
begin
  select id, c.contact_id into _existing, _cid from public.communications c
    where c.company_id = _company and c.external_id = _external_id limit 1;
  if _existing is not null then
    return query select _cid, _existing, (_cid is not null); return;
  end if;

  -- E-mail principal, pro ou secondaire (CON002) ; une fiche active d'abord.
  select c.id into _cid from public.contacts c
   where c.company_id = _company and _m is not null
     and (lower(c.email) = _m or lower(c.email_pro) = _m
          or c.id in (select ce.contact_id from public.contact_emails ce
                       where ce.company_id = _company and ce.email = _m))
   order by c.is_active desc, c.created_at limit 1;
  if _cid is null then
    return query select null::uuid, null::uuid, false; return;
  end if;

  insert into public.communications (company_id, contact_id, channel, direction, subject, body, occurred_at, external_id, from_address)
    values (_company, _cid, 'email', coalesce(_direction,'in'), _subject, _body, coalesce(_received, now()), _external_id, _display_from)
    returning id into _commid;
  return query select _cid, _commid, true;
end $function$;

select pg_temp._patch_fn('public.ingest_inbound_email(uuid,text,text,text,timestamptz,text)'::regprocedure,
  'and (lower(email) = lower(_from) or lower(email_pro) = lower(_from))',
  'and (lower(email) = lower(_from) or lower(email_pro) = lower(_from) or id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = lower(btrim(_from))))');

-- Création de la fiche d'un prospect à partir de l'analyse d'un mail (interne).
create or replace function public._prospect_contact_create(_company uuid, _fiche_email text, _extract jsonb, _propose boolean)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  _cid    uuid;
  _is_pro boolean := coalesce((_extract->>'is_professional')::boolean, false);
  _relay  boolean := coalesce((_extract->>'sender_is_relay')::boolean, false);
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _vat    text := nullif(btrim(coalesce(_extract->>'vat_number', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _city   text := nullif(btrim(coalesce(_extract->>'city', '')), '');
  _zip    text := nullif(btrim(coalesce(_extract->>'zip', '')), '');
  _country text := coalesce(nullif(btrim(coalesce(_extract->>'country', '')), ''), 'BE');
  _summary text := nullif(btrim(coalesce(_extract->>'request_summary', '')), '');
begin
  insert into public.contacts (
    company_id, type, status, origin, is_active,
    first_name, last_name, company_name, vat_number,
    email, email_pro, mobile, city, zip, country, notes
  ) values (
    _company,
    case when _is_pro then 'professionnel'::contact_type else 'particulier'::contact_type end,
    'prospect'::contact_status,
    case when _relay then 'web' else 'mail' end,
    true,
    _first, _last, _co, _vat,
    case when _is_pro then null else _fiche_email end,
    case when _is_pro then _fiche_email else null end,
    _phone, _city, _zip, _country,
    _summary
  )
  returning id into _cid;

  if _propose then
    insert into public.contact_merge_candidates (company_id, contact_id, candidate_id, reason)
    select _company, _cid, m.contact_id, m.reason
      from public.contacts_match_candidates(
             _company, _fiche_email,
             nullif(btrim(coalesce(_first,'') || ' ' || coalesce(_last,'')), ''),
             _co, _phone, _cid) m
     where not exists (
             select 1 from public.contact_merge_candidates x
              where x.contact_id = _cid and x.candidate_id = m.contact_id);
  end if;
  return _cid;
end;
$$;

-- Carte CRM « nouveau » + tâche « Recontacter le client » si la fiche n'en a pas d'ouverte (interne).
create or replace function public._prospect_lead_open(_company uuid, _cid uuid, _email text, _fiche_email text, _extract jsonb, _received timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  _lid    uuid;
  _owner  uuid;
  _relay  boolean := coalesce((_extract->>'sender_is_relay')::boolean, false);
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _vat    text := nullif(btrim(coalesce(_extract->>'vat_number', '')), '');
  _phone  text := nullif(btrim(coalesce(_extract->>'phone', '')), '');
  _city   text := nullif(btrim(coalesce(_extract->>'city', '')), '');
  _zip    text := nullif(btrim(coalesce(_extract->>'zip', '')), '');
  _vref   text := nullif(btrim(coalesce(_extract->>'vehicle_ref', '')), '');
  _interest text := nullif(btrim(coalesce(_extract->>'interest', '')), '');
  _summary  text := nullif(btrim(coalesce(_extract->>'request_summary', '')), '');
  _channel text := case when _relay then 'web' else 'mail' end;
  _label  text;
  _notes  text;
begin
  select l.id into _lid
    from public.leads l
   where l.company_id = _company and l.contact_id = _cid
     and l.stage not in ('gagne', 'perdu')
   order by l.created_at
   limit 1;
  if _lid is not null then
    return _lid;
  end if;

  _label := coalesce(
    nullif(btrim(coalesce(_co, '')), ''),
    nullif(btrim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
    _fiche_email, _email);

  _notes := concat_ws(E'\n',
    _summary,
    case when _vref is not null then 'Moto / chassis cite : ' || _vref end,
    case when _vat is not null then 'TVA : ' || _vat end,
    case when _city is not null or _zip is not null then 'Localite : ' || concat_ws(' ', _zip, _city) end,
    'Recu le ' || to_char(coalesce(_received, now()), 'DD/MM/YYYY a HH24:MI')
      || ' par ' || case when _relay then 'le formulaire du site' else 'e-mail direct' end
      || ' (' || _email || ')');

  insert into public.leads (
    company_id, contact_id, name, email, phone,
    vehicle_interest, source, stage, notes
  ) values (
    _company, _cid, _label, _fiche_email, _phone,
    coalesce(_interest, _vref),
    upper(_channel),
    'nouveau',
    _notes
  )
  returning id into _lid;

  _owner := public.default_assignee(_company);
  if _owner is not null then
    insert into public.lead_tasks (company_id, lead_id, title, due_at, assigned_to)
    values (_company, _lid, 'Recontacter le client', now() + interval '2 days', _owner);
  end if;
  return _lid;
end;
$$;

revoke all on function public._prospect_contact_create(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._prospect_lead_open(uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;

create or replace function public.create_prospect_from_email(_company uuid, _email text, _subject text, _body text, _received timestamp with time zone, _external_id text, _extract jsonb)
returns table(contact_id uuid, lead_id uuid, communication_id uuid, created boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  _cid    uuid;
  _lid    uuid;
  _commid uuid;
  _existing_comm uuid;
  _relay  boolean := coalesce((_extract->>'sender_is_relay')::boolean, false);
  _cmail  text := nullif(lower(btrim(coalesce(_extract->>'contact_email', ''))), '');
  _first  text := nullif(btrim(coalesce(_extract->>'first_name', '')), '');
  _last   text := nullif(btrim(coalesce(_extract->>'last_name', '')), '');
  _co     text := nullif(btrim(coalesce(_extract->>'company_name', '')), '');
  _fiche_email text;
  _homs   uuid[];
  _new    boolean := false;
begin
  if _email is null or btrim(_email) = '' then
    raise exception 'create_prospect_from_email: adresse e-mail de l''expediteur manquante';
  end if;

  _fiche_email := coalesce(_cmail, case when _relay then null else lower(btrim(_email)) end);

  select c.id, c.contact_id into _existing_comm, _cid
    from public.communications c
   where c.company_id = _company and c.external_id = _external_id
   limit 1;
  if _existing_comm is not null then
    select l.id into _lid from public.leads l where l.contact_id = _cid order by l.created_at limit 1;
    return query select _cid, _lid, _existing_comm, false;
    return;
  end if;

  -- Fiche qui porte déjà cette adresse (principale, pro ou secondaire) : une active d'abord.
  if _fiche_email is not null then
    select c.id into _cid from public.contacts c
     where c.company_id = _company
       and (lower(c.email) = _fiche_email or lower(c.email_pro) = _fiche_email
            or c.id in (select ce.contact_id from public.contact_emails ce
                         where ce.company_id = _company and ce.email = _fiche_email))
     order by c.is_active desc, c.created_at limit 1;
  end if;

  if _cid is null then
    -- CON002 : adresse inconnue mais nom d'un client existant → on ne crée rien, on demande.
    select coalesce(array_agg(h.contact_id), '{}') into _homs
      from public.contacts_homonyms(_company, _first, _last, _co) h;
    if cardinality(_homs) > 0 then
      insert into public.communications (
        company_id, contact_id, channel, direction, subject, body,
        occurred_at, external_id, from_address
      ) values (
        _company, null, 'email', 'in', _subject, _body,
        coalesce(_received, now()), _external_id, _email
      )
      returning id into _commid;
      insert into public.email_attach_requests (company_id, communication_id, email, sender, extract, candidate_ids, received_at)
      values (_company, _commid, _fiche_email, lower(btrim(_email)), coalesce(_extract, '{}'::jsonb), _homs, coalesce(_received, now()));
      return query select null::uuid, null::uuid, _commid, false;
      return;
    end if;

    _cid := public._prospect_contact_create(_company, _fiche_email, _extract, true);
    _new := true;
  end if;

  insert into public.communications (
    company_id, contact_id, channel, direction, subject, body,
    occurred_at, external_id, from_address
  ) values (
    _company, _cid, 'email', 'in', _subject, _body,
    coalesce(_received, now()), _external_id, _email
  )
  returning id into _commid;

  _lid := public._prospect_lead_open(_company, _cid, _email, _fiche_email, _extract, _received);

  return query select _cid, _lid, _commid, true;
end $function$;

-- La file « à rattacher » (cloche) : mails en attente, avec les clients possibles.
create or replace function public.email_attach_pending(_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'email', r.email,
           'sender', r.sender,
           'received_at', r.received_at,
           'subject', m.subject,
           'preview', left(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'), 400),
           'first_name', r.extract->>'first_name',
           'last_name', r.extract->>'last_name',
           'company_name', r.extract->>'company_name',
           'is_professional', coalesce((r.extract->>'is_professional')::boolean, false),
           'attachments', coalesce((select jsonb_agg(a.file_name order by a.created_at)
                                      from public.attachments a
                                     where a.entity_type = 'email_request' and a.entity_id = r.id), '[]'::jsonb),
           'candidates', coalesce((
             select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'city', x.city,
                                                 'first_name', x.first_name, 'last_name', x.last_name,
                                                 'company_name', x.company_name)
                              order by x.code)
               from (select distinct c.id, c.code, c.city, c.first_name, c.last_name, c.company_name,
                            coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.code) as name
                       from public.contacts c
                      where c.company_id = r.company_id and c.is_active
                        and (c.id = any(r.candidate_ids)
                             or c.id in (select h.contact_id from public.contacts_homonyms(
                                           r.company_id, r.extract->>'first_name', r.extract->>'last_name',
                                           r.extract->>'company_name') h))) x), '[]'::jsonb)
         ) order by r.received_at desc nulls last, r.created_at desc), '[]'::jsonb)
    from public.email_attach_requests r
    join public.communications m on m.id = r.communication_id
   where r.company_id = _company
     and r.status = 'a_traiter'
     and public.is_member(_company);
$$;

-- Le choix : _contact = client existant (l'adresse lui est ajoutée), null = nouveau client.
-- Le mail et ses pièces jointes passent sur la fiche ; carte CRM comme pour tout prospect.
create or replace function public.email_attach_resolve(_request uuid, _contact uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  _r    public.email_attach_requests%rowtype;
  _cid  uuid;
  _status text;
  _n    bigint;
begin
  select * into _r from public.email_attach_requests where id = _request for update;
  if _r.id is null then
    raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not coalesce(_r.company_id in (select public.rls_writable_companies('contacts')), false) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if _r.status <> 'a_traiter' then
    raise exception 'EMAIL_REQUEST_DONE' using errcode = '22023',
      hint = 'Ce mail a déjà été rattaché.';
  end if;

  if _contact is not null then
    select c.id into _cid from public.contacts c where c.id = _contact and c.company_id = _r.company_id;
    if _cid is null then
      raise exception 'CONTACT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if _r.email ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source)
      values (_r.company_id, _cid, _r.email,
              case when coalesce((_r.extract->>'is_professional')::boolean, false) then 'pro' end,
              false, 'mail')
      on conflict (company_id, contact_id, email) do nothing;
    end if;
    _status := 'rattache';
  else
    _cid := public._prospect_contact_create(_r.company_id, _r.email, _r.extract, false);
    _status := 'nouveau_client';
  end if;

  update public.communications set contact_id = _cid where id = _r.communication_id;
  update public.attachments set entity_type = 'contact', entity_id = _cid
   where entity_type = 'email_request' and entity_id = _r.id;
  get diagnostics _n = row_count;

  perform public._prospect_lead_open(_r.company_id, _cid, coalesce(_r.sender, _r.email), _r.email, _r.extract, _r.received_at);

  update public.email_attach_requests
     set status = _status, contact_id = _cid, resolved_at = now(), resolved_by = auth.uid()
   where id = _r.id;

  return jsonb_build_object('contact_id', _cid, 'status', _status, 'attachments', _n);
end;
$$;

revoke all on function public.email_attach_pending(uuid) from public, anon;
revoke all on function public.email_attach_resolve(uuid, uuid) from public, anon;
grant execute on function public.email_attach_pending(uuid) to authenticated;
grant execute on function public.email_attach_resolve(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Doublons et échanges partagés
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contacts_find_by_email_or_mobile(_company uuid, _email text, _mobile text, _exclude uuid default null::uuid)
returns setof contacts
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with probe as (
    select nullif(lower(btrim(coalesce(_email, ''))), '') as e,
           public.contact_phone_key(_mobile) as k
  )
  select c.*
    from public.contacts c, probe p
   where c.company_id = _company
     and (_exclude is null or c.id <> _exclude)
     and (
          (p.e is not null and (lower(btrim(c.email)) = p.e
             or c.id in (select ce.contact_id from public.contact_emails ce
                          where ce.company_id = _company and ce.email = p.e)))
       or (p.k is not null and p.k in (
             public.contact_phone_key(c.mobile),
             public.contact_phone_key(c.gsm),
             public.contact_phone_key(c.phone)))
     )
   order by c.is_active desc, c.updated_at desc nulls last
   limit 10;
$function$;

select pg_temp._patch_fn('public.contacts_find_duplicates(uuid,text,text,text,text,uuid)'::regprocedure,
  'and public.contact_norm_txt(c.email) = public.contact_norm_txt(_email)',
  'and (public.contact_norm_txt(c.email) = public.contact_norm_txt(_email) or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = public.contact_norm_txt(_email)))');

create or replace function public.contacts_match_candidates(_company uuid, _email text, _name text default null::text, _company_name text default null::text, _phone text default null::text, _exclude uuid default null::uuid)
returns table(contact_id uuid, reason text, display text)
language sql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with mails as (
    select ce.contact_id from public.contact_emails ce
     where ce.company_id = _company and _email is not null and _email <> ''
       and ce.email = public.contact_norm_txt(_email)
  )
  select c.id,
         case
           when public.contact_norm_txt(c.email) = public.contact_norm_txt(_email)
             or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_email)
             or c.id in (select m.contact_id from mails m) then 'email'
           when _company_name is not null and _company_name <> ''
            and public.contact_norm_txt(c.company_name) = public.contact_norm_txt(_company_name) then 'societe'
           when _phone is not null and _phone <> ''
            and public.contact_norm_phone(_phone) in (
                  public.contact_norm_phone(c.mobile),
                  public.contact_norm_phone(c.phone),
                  public.contact_norm_phone(c.gsm)) then 'telephone'
           else 'nom'
         end as reason,
         btrim(coalesce(nullif(c.company_name, ''),
                        btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')))) as display
    from public.contacts c
   where c.company_id = _company
     and c.is_active
     and (_exclude is null or c.id <> _exclude)
     and (
          (_email is not null and _email <> '' and (
              public.contact_norm_txt(c.email)     = public.contact_norm_txt(_email)
           or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_email)
           or c.id in (select m.contact_id from mails m)))
       or (_name is not null and _name <> ''
           and public.contact_norm_txt(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')))
               = public.contact_norm_txt(_name))
       or (_company_name is not null and _company_name <> ''
           and public.contact_norm_txt(c.company_name) = public.contact_norm_txt(_company_name))
       or (_phone is not null and _phone <> ''
           and public.contact_norm_phone(_phone) in (
                 public.contact_norm_phone(c.mobile),
                 public.contact_norm_phone(c.phone),
                 public.contact_norm_phone(c.gsm)))
     )
   order by c.created_at
   limit 20;
$function$;

-- Échanges réunis sur toutes les fiches qui partagent une adresse (Q14) : les e-mails
-- secondaires comptent aussi. Mêmes garde-fous (adresses du garage, plus de 4 fiches).
create or replace function public.contacts_sharing_email(_contact uuid)
returns table (id uuid)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select c.id, c.company_id from public.contacts c where c.id = _contact
  ),
  own as (
    select distinct lower(split_part(m.address, '@', 2)) as d
      from public.company_mailboxes m, me
     where m.company_id = me.company_id and m.address like '%@%'
  ),
  mails as (
    select distinct x.e
      from (
        select lower(nullif(btrim(c.email), '')) as e from public.contacts c, me where c.id = me.id
        union select lower(nullif(btrim(c.email_pro), '')) from public.contacts c, me where c.id = me.id
        union select ce.email from public.contact_emails ce, me where ce.contact_id = me.id
      ) x
     where x.e is not null and x.e like '%@%'
       and lower(split_part(x.e, '@', 2)) not in (select d from own)
  ),
  shared as (
    select c.id, m.e
      from public.contacts c
      join me on c.company_id = me.company_id
      join mails m on lower(btrim(c.email)) = m.e or lower(btrim(c.email_pro)) = m.e
    union
    select ce.contact_id, ce.email
      from public.contact_emails ce
      join me on ce.company_id = me.company_id
      join mails m on m.e = ce.email
  ),
  keep as (
    select s.e from shared s group by s.e having count(distinct s.id) <= 4
  )
  select distinct s.id from shared s join keep k on k.e = s.e;
$$;

grant execute on function public.contacts_sharing_email(uuid) to authenticated, service_role;

-- Une fiche dont la seule « dépendance » est la liste de ses e-mails reste une fiche vierge.
select pg_temp._patch_fn('public.contact_dependencies(uuid)'::regprocedure,
  'and con.conrelid <> ''public.contact_links''::regclass',
  'and con.conrelid not in (''public.contact_links''::regclass, ''public.contact_emails''::regclass)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Recherche (liste clients, recherche globale) : un mot peut se trouver dans un e-mail
--    secondaire, comme il peut se trouver sur une fiche liée.
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp._patch_fn('public.contacts_search(uuid,text,text,integer,integer,text)'::regprocedure,
  'select l.contact_b, public._contact_link_haystack_part(a)',
  'select ce.contact_id, ce.email from public.contact_emails ce where ce.company_id = _company and not ce.is_primary
        union all
        select l.contact_b, public._contact_link_haystack_part(a)');

select pg_temp._patch_fn('public.contacts_search_count(uuid,text,text)'::regprocedure,
  'select l.contact_b, public._contact_link_haystack_part(a)',
  'select ce.contact_id, ce.email from public.contact_emails ce where ce.company_id = _company and not ce.is_primary
        union all
        select l.contact_b, public._contact_link_haystack_part(a)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Correspondances DCS, inscription publique, CRM, Shopify, RGPD
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp._patch_fn('public.dcs_client_matches(uuid,uuid)'::regprocedure,
  'v_mail in (lower(btrim(c.email)), lower(btrim(c.my_ducati_email)))',
  '(v_mail in (lower(btrim(c.email)), lower(btrim(c.my_ducati_email)), lower(btrim(c.email_pro))) or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = v_mail))');

select pg_temp._patch_fn('public.signup_precheck(uuid,text)'::regprocedure,
  'and (lower(c.email) = _e or lower(c.email_pro) = _e)',
  'and (lower(c.email) = _e or lower(c.email_pro) = _e or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = _e))');

select pg_temp._patch_fn('public.signup_register(uuid,uuid,text,text,jsonb)'::regprocedure,
  'and (lower(c.email) = _e or lower(c.email_pro) = _e)',
  'and (lower(c.email) = _e or lower(c.email_pro) = _e or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = _e))');

select pg_temp._patch_fn('public.crm_create_manual_lead(uuid,text,text,text,text,text,text,numeric)'::regprocedure,
  'or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail))',
  'or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail) or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = public.contact_norm_txt(_mail)))');

select pg_temp._patch_fn('public.crm_link_lead_contact(uuid,uuid)'::regprocedure,
  'or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail))',
  'or public.contact_norm_txt(c.email_pro) = public.contact_norm_txt(_mail) or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _l.company_id and ce.email = public.contact_norm_txt(_mail)))');

select pg_temp._patch_fn('public._shopify_order_apply(uuid,jsonb)'::regprocedure,
  'lower(c.email) = _email and c.type <> ''fournisseur''',
  '(lower(c.email) = _email or c.id in (select ce.contact_id from public.contact_emails ce where ce.company_id = _company and ce.email = _email)) and c.type <> ''fournisseur''');

select pg_temp._patch_fn('public._gdpr_anonymise_contact(uuid,text)'::regprocedure,
  'delete from public.delivery_addresses where contact_id = _id;',
  'delete from public.contact_emails where contact_id = _id;
  delete from public.delivery_addresses where contact_id = _id;');

select pg_temp._patch_fn('public.contact_gdpr_export(uuid,text)'::regprocedure,
  '''contact'', to_jsonb(_c) - _tech - array[''my_ducati_data''],',
  '''contact'', to_jsonb(_c) - _tech - array[''my_ducati_data''],
    ''emails'', coalesce((select jsonb_agg(jsonb_build_object(''email'', e.email, ''kind'', e.kind, ''is_primary'', e.is_primary,
                                                            ''source'', e.source, ''created_at'', e.created_at) order by e.is_primary desc, e.created_at)
                           from public.contact_emails e where e.contact_id = _contact), ''[]''::jsonb),');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Fusion de fiches (reprise de 20261118229000, complétée pour les e-mails et le Mobile 2)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.contact_merge(_keep uuid, _absorb uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _k       public.contacts%rowtype;
  _a       public.contacts%rowtype;
  _after   public.contacts%rowtype;
  _uid     uuid := auth.uid();
  _moved   jsonb := '{}'::jsonb;
  _removed jsonb := '[]'::jsonb;   -- lignes en double supprimées, contenu complet conservé ici
  _archived_leads jsonb := '[]'::jsonb;
  _before  jsonb;
  _n       bigint;
  _r       record;
  _sets    text;
  _left    text;
  _extra   text;
  _stamp   text := to_char(now() at time zone 'Europe/Brussels', 'DD/MM/YYYY');
  _kl      uuid;
  _claims  text;
  _extra_docs jsonb;
  _sub     text;
begin
  -- 1. Gardes ------------------------------------------------------------------
  if _keep is null or _absorb is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if _keep = _absorb then
    raise exception 'MERGE_SAME_CONTACT' using errcode = '22023';
  end if;

  -- Verrou des deux fiches, dans un ordre stable (pas d'interblocage entre deux fusions).
  perform 1 from public.contacts where id in (_keep, _absorb) order by id for update;
  select * into _k from public.contacts where id = _keep;
  select * into _a from public.contacts where id = _absorb;
  if _k.id is null or _a.id is null then
    raise exception 'MERGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_admin(_k.company_id) then
    raise exception 'MERGE_FORBIDDEN' using errcode = '42501',
      hint = 'La fusion de fiches est réservée aux administrateurs (décision F-9).';
  end if;
  if _a.company_id <> _k.company_id then
    raise exception 'MERGE_OTHER_COMPANY' using errcode = '42501',
      hint = 'Les deux fiches doivent appartenir à la même société.';
  end if;

  -- Conflits qu'on ne tranche pas à la place de l'utilisateur.
  if exists (select 1 from public.contact_accounts where contact_id = _keep)
     and exists (select 1 from public.contact_accounts where contact_id = _absorb) then
    raise exception 'MERGE_BOTH_ACCOUNTS' using errcode = '23505',
      hint = 'Les deux fiches ont chacune un compte client (application) : un seul compte par fiche.';
  end if;
  if _k.opening_balance <> 0 and _a.opening_balance <> 0 then
    raise exception 'MERGE_BOTH_OPENING_BALANCE' using errcode = '23514',
      hint = 'Les deux fiches ont un solde d''ouverture G8 : à régler par la comptabilité avant de fusionner.';
  end if;

  -- 2a. Documents de vente. Depuis le gel des documents validés (20261103150000, B7), changer le
  --     client d'un document validé est refusé pour un utilisateur ; la fusion de deux fiches de la
  --     MÊME personne doit pourtant les réunir. Le gel laisse passer les fonctions serveur
  --     (auth.uid() vide) : l'identité est donc mise de côté le temps de ce seul déplacement, puis
  --     rétablie. Numéros, dates et montants ne changent pas ; la trace de la fusion (events) garde
  --     l'auteur et la liste des documents déplacés.
  _claims := current_setting('request.jwt.claims', true);
  _sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  with m as (
    update public.documents set contact_id = _keep where contact_id = _absorb
    returning id, number
  )
  select count(*), jsonb_agg(jsonb_build_object('id', id, 'number', number)) into _n, _extra_docs from m;
  perform set_config('request.jwt.claims', coalesce(_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(_sub, ''), true);
  if _n > 0 then
    _moved := _moved || jsonb_build_object('documents.contact_id', _n, 'documents_list', _extra_docs);
  end if;

  -- 2. Déplacements simples (aucune contrainte d'unicité en jeu) ------------------
  for _r in
    select * from (values
      ('repair_orders', 'contact_id'),
      ('workshop_appointments', 'contact_id'),
      ('communications', 'contact_id'),
      ('sepa_mandates', 'contact_id'),
      ('delivery_addresses', 'contact_id'),
      ('contact_subcontacts', 'contact_id'),
      ('client_price_rules', 'contact_id'),
      ('customer_price_rules', 'contact_id'),
      ('consignments', 'depositor_id'),
      ('purchase_orders', 'supplier_id'),
      ('articles', 'main_supplier_id'),
      ('articles', 'reprise_supplier_id'),
      ('part_orders', 'contact_id'),
      ('part_order_lines', 'supplier_id'),
      ('excel_order_lines', 'contact_id'),
      ('contact_invitations', 'contact_id'),
      ('contact_declared_vehicles', 'contact_id'),
      ('contact_accounts', 'contact_id'),   -- au plus un compte des deux côtés (vérifié plus haut)
      ('portal_uploads', 'contact_id')
    ) v(t, c)
  loop
    execute format('update public.%I set %I = $1 where %I = $2', _r.t, _r.c, _r.c)
      using _keep, _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then
      _moved := _moved || jsonb_build_object(_r.t || '.' || _r.c, _n);
    end if;
  end loop;

  -- Références polymorphes (sans clé étrangère) : pièces jointes GED, dépôts du portail,
  -- notifications.
  update public.attachments set entity_id = _keep
   where entity_type = 'contact' and entity_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('attachments', _n); end if;

  update public.portal_uploads set entity_id = _keep
   where entity_type = 'contact' and entity_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('portal_uploads.entity_id', _n); end if;

  update public.notifications set entity_id = _keep::text
   where entity_type in ('contact', 'contacts') and entity_id = _absorb::text;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('notifications', _n); end if;

  -- 3. Déplacements avec gestion des doublons -------------------------------------

  -- 3a. Fournisseurs d'articles : unique (article_id, supplier_id).
  with d as (
    delete from public.article_suppliers s
     where s.supplier_id = _absorb
       and exists (select 1 from public.article_suppliers k
                    where k.supplier_id = _keep and k.article_id = s.article_id)
    returning jsonb_build_object('table', 'article_suppliers', 'row', to_jsonb(s)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.article_suppliers set supplier_id = _keep where supplier_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('article_suppliers', _n); end if;

  -- 3b. Propriétaires de motos : si les deux fiches possèdent la même moto sur la même
  --     période (ou toutes deux actuellement), on garde la ligne de la fiche gardée en
  --     reprenant la date de début la plus ancienne ; la ligne en double est supprimée
  --     (contenu conservé dans la trace).
  for _r in
    select a.id as aid, k.id as kid, a.from_date as afd
      from public.vehicle_owners a
      join public.vehicle_owners k
        on k.vehicle_id = a.vehicle_id and k.contact_id = _keep
       and ((a.is_current and k.is_current)
            or (a.from_date = k.from_date and a.to_date is not distinct from k.to_date))
     where a.contact_id = _absorb
  loop
    if exists (select 1 from public.vehicle_owners where id = _r.aid) then
      update public.vehicle_owners set from_date = least(from_date, _r.afd) where id = _r.kid;
      with d as (
        delete from public.vehicle_owners v where v.id = _r.aid
        returning jsonb_build_object('table', 'vehicle_owners', 'row', to_jsonb(v)) j
      )
      select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    end if;
  end loop;
  update public.vehicle_owners set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('vehicle_owners', _n); end if;

  -- 3c. Fiches liées (pro ↔ privé) : paire unique non ordonnée. Le lien entre les deux
  --     fiches fusionnées disparaît (il deviendrait un lien d'une fiche avec elle-même),
  --     comme un lien que la fiche gardée a déjà.
  with d as (
    delete from public.contact_links l
     where (l.contact_a = _absorb or l.contact_b = _absorb)
       and (
         l.contact_a = _keep or l.contact_b = _keep
         or exists (
           select 1 from public.contact_links k
            where (k.contact_a = _keep or k.contact_b = _keep)
              and (case when k.contact_a = _keep then k.contact_b else k.contact_a end)
                = (case when l.contact_a = _absorb then l.contact_b else l.contact_a end)
         )
       )
    returning jsonb_build_object('table', 'contact_links', 'row', to_jsonb(l)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.contact_links set contact_a = _keep where contact_a = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_links.contact_a', _n); end if;
  update public.contact_links set contact_b = _keep where contact_b = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_links.contact_b', _n); end if;

  -- 3d. Rapprochements proposés : la proposition entre les deux fiches est résolue par
  --     la fusion elle-même ; les autres suivent la fiche gardée sans créer de doublon
  --     (unique contact_id, candidate_id).
  with d as (
    delete from public.contact_merge_candidates m
     where (m.contact_id = _absorb or m.candidate_id = _absorb)
       and (
         m.contact_id = _keep or m.candidate_id = _keep
         or (m.contact_id = _absorb and exists (
               select 1 from public.contact_merge_candidates x
                where x.contact_id = _keep and x.candidate_id = m.candidate_id))
         or (m.candidate_id = _absorb and exists (
               select 1 from public.contact_merge_candidates x
                where x.candidate_id = _keep and x.contact_id = m.contact_id))
       )
    returning jsonb_build_object('table', 'contact_merge_candidates', 'row', to_jsonb(m)) j
  )
  select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
  update public.contact_merge_candidates set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_merge_candidates.contact_id', _n); end if;
  update public.contact_merge_candidates set candidate_id = _keep where candidate_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('contact_merge_candidates.candidate_id', _n); end if;

  -- 3e. Cartes CRM : une seule carte ouverte par fiche et par pipeline. Si la fiche gardée
  --     a déjà une carte ouverte, la carte ouverte de l'absorbée est ARCHIVÉE (comme le
  --     bouton Archiver de l'écran CRM) ; sa tâche en cours passe sur la carte gardée si
  --     celle-ci n'en a pas. Toutes les cartes (et leur historique) suivent la fiche gardée.
  for _r in
    select l.id, l.pipeline
      from public.leads l
     where l.contact_id = _absorb
       and l.archived_at is null
       and l.stage not in ('gagne', 'perdu')
  loop
    select k.id into _kl
      from public.leads k
     where k.contact_id = _keep
       and k.pipeline = _r.pipeline
       and k.archived_at is null
       and k.stage not in ('gagne', 'perdu')
     order by k.created_at
     limit 1;
    if _kl is not null then
      update public.lead_tasks t set lead_id = _kl
       where t.lead_id = _r.id and t.done_at is null
         and not exists (select 1 from public.lead_tasks o where o.lead_id = _kl and o.done_at is null);
      update public.leads
         set archived_at = now(),
             archived_by = _uid,
             archived_reason = 'Fusion de fiches : doublon de la carte ouverte de la fiche '
                               || coalesce(_k.code, _keep::text)
       where id = _r.id;
      _archived_leads := _archived_leads || to_jsonb(_r.id);
    end if;
  end loop;
  update public.leads set contact_id = _keep where contact_id = _absorb;
  get diagnostics _n = row_count;
  if _n > 0 then _moved := _moved || jsonb_build_object('leads', _n); end if;

  -- 3f. Tables à contrainte d'unicité ajoutées après le 19/09 (dédoublonnées, contenu gardé
  --     dans la trace), puis déplacées.
  if to_regclass('public.portal_doc_no_back') is not null then
    with d as (
      delete from public.portal_doc_no_back p
       where p.contact_id = _absorb
         and exists (select 1 from public.portal_doc_no_back k
                      where k.contact_id = _keep and k.kind = p.kind and k.entity_type = p.entity_type
                        and k.entity_id = case when p.entity_type = 'contact' and p.entity_id = _absorb then _keep else p.entity_id end)
      returning jsonb_build_object('table', 'portal_doc_no_back', 'row', to_jsonb(p)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.portal_doc_no_back
       set contact_id = _keep,
           entity_id = case when entity_type = 'contact' and entity_id = _absorb then _keep else entity_id end
     where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('portal_doc_no_back', _n); end if;
  end if;

  if to_regclass('public.contact_group_members') is not null then
    with d as (
      delete from public.contact_group_members g
       where g.contact_id = _absorb
         and exists (select 1 from public.contact_group_members k where k.contact_id = _keep and k.group_code = g.group_code)
      returning jsonb_build_object('table', 'contact_group_members', 'row', to_jsonb(g)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.contact_group_members set contact_id = _keep where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_members', _n); end if;
  end if;

  if to_regclass('public.contact_group_sales') is not null then
    -- Le lien entre les deux fiches fusionnées disparaît (il deviendrait un lien d'une fiche
    -- avec elle-même), comme un associé que la fiche gardée a déjà.
    with d as (
      delete from public.contact_group_sales g
       where (g.contact_id = _absorb and (g.member_id = _keep
               or exists (select 1 from public.contact_group_sales k where k.contact_id = _keep and k.member_id = g.member_id)))
          or (g.member_id = _absorb and (g.contact_id = _keep
               or exists (select 1 from public.contact_group_sales k where k.member_id = _keep and k.contact_id = g.contact_id)))
      returning jsonb_build_object('table', 'contact_group_sales', 'row', to_jsonb(g)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.contact_group_sales set contact_id = _keep where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_sales.contact_id', _n); end if;
    update public.contact_group_sales set member_id = _keep where member_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_group_sales.member_id', _n); end if;
  end if;

  -- 3f bis. E-mails de la fiche (CON002, 26/11/2026) : unique par fiche. Une adresse que la
  --     fiche gardée a déjà est retirée de l'absorbée (contenu gardé dans la trace) ; les autres
  --     passent sur la fiche gardée comme e-mails SECONDAIRES (l'e-mail principal de la fiche
  --     gardée ne change pas), origine « fusion ».
  if to_regclass('public.contact_emails') is not null then
    update public.contact_emails set is_primary = false where contact_id = _absorb and is_primary;
    with d as (
      delete from public.contact_emails e
       where e.contact_id = _absorb
         and exists (select 1 from public.contact_emails k where k.contact_id = _keep and k.email = e.email)
      returning jsonb_build_object('table', 'contact_emails', 'row', to_jsonb(e)) j
    )
    select _removed || coalesce(jsonb_agg(j), '[]'::jsonb) into _removed from d;
    update public.contact_emails
       set contact_id = _keep,
           is_primary = false,
           source = case when source in ('fiche', 'fiche_pro') then 'fusion' else source end
     where contact_id = _absorb;
    get diagnostics _n = row_count;
    if _n > 0 then _moved := _moved || jsonb_build_object('contact_emails', _n); end if;
  end if;

  -- 3g. Toute autre clé étrangère vers contacts (tables ajoutées après le 19/09, et celles de
  --     demain) : déplacement générique. Le registre des véhicules à moteur reste en place
  --     (append-only, inscription légale ; la fiche absorbée est archivée, pas supprimée).
  for _r in
    select con.conrelid::regclass::text as t, att.attname::text as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
       and con.conrelid::regclass::text not in ('vehicle_register', 'public.vehicle_register')
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', _r.t, _r.c, _r.c) using _keep, _absorb;
      get diagnostics _n = row_count;
    exception when unique_violation then
      raise exception 'MERGE_UNIQUE_CONFLICT: %', _r.t || '.' || _r.c using errcode = '23505',
        hint = 'Les deux fiches ont une ligne identique dans cette table : la fusion est annulée en entier.';
    end;
    if _n > 0 then
      _moved := _moved || jsonb_build_object(replace(_r.t, 'public.', '') || '.' || _r.c,
                                             coalesce((_moved ->> (replace(_r.t, 'public.', '') || '.' || _r.c))::bigint, 0) + _n);
    end if;
  end loop;

  -- 4. Filet de sécurité : plus AUCUNE référence vers la fiche absorbée. Parcourt les vraies
  --    clés étrangères (une table ajoutée demain sera vue ici) + les références polymorphes.
  for _r in
    select con.conrelid::regclass::text as t, att.attname as c
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.contacts'::regclass
       and con.conrelid::regclass::text not in ('vehicle_register', 'public.vehicle_register')
  loop
    execute format('select count(*) from %s where %I = $1', _r.t, _r.c) into _n using _absorb;
    if _n > 0 then _left := concat_ws(', ', _left, _r.t || '.' || _r.c || ' (' || _n || ')'); end if;
  end loop;
  if exists (select 1 from public.attachments where entity_type = 'contact' and entity_id = _absorb) then
    _left := concat_ws(', ', _left, 'attachments');
  end if;
  if exists (select 1 from public.portal_uploads where entity_type = 'contact' and entity_id = _absorb) then
    _left := concat_ws(', ', _left, 'portal_uploads.entity_id');
  end if;
  if _left is not null then
    raise exception 'MERGE_UNHANDLED_REFERENCE: %', _left using errcode = 'P0001',
      hint = 'Une table référence encore la fiche absorbée : la fusion est annulée en entier.';
  end if;

  -- 5. Compléter la fiche gardée (jamais d'écrasement) ------------------------------
  -- Colonnes facultatives : prises à l'absorbée seulement si vides côté gardée. Liste
  -- lue dans le schéma, pour qu'une colonne ajoutée plus tard soit complétée aussi.
  select string_agg(
           case when c.data_type = 'text'
                then format('%1$I = case when nullif(btrim(k.%1$I), %2$L) is null then a.%1$I else k.%1$I end', c.column_name, '')
                else format('%1$I = coalesce(k.%1$I, a.%1$I)', c.column_name)
           end, ', ' order by c.ordinal_position)
    into _sets
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'contacts'
     and c.is_nullable = 'YES'
     and c.data_type <> 'ARRAY'
     and c.column_name not in ('id', 'company_id', 'code', 'created_at', 'updated_at', 'created_by', 'notes');
  if _sets is not null then
    execute format('update public.contacts k set %s from public.contacts a where k.id = $1 and a.id = $2', _sets)
      using _keep, _absorb;
  end if;

  -- CON002 (26/11/2026) : les e-mails de l'absorbée restent JOIGNABLES sur la fiche gardée
  -- (e-mails secondaires, retrouvés par la relève mail, la recherche et l'inscription), et son
  -- mobile devient le « Mobile 2 » de la fiche gardée quand celui-ci est libre.
  if to_regclass('public.contact_emails') is not null then
    insert into public.contact_emails (company_id, contact_id, email, kind, is_primary, source)
    select _k.company_id, _keep, v.e, v.kd, false, 'fusion'
      from (values (lower(btrim(coalesce(_a.email, ''))), null::text),
                   (lower(btrim(coalesce(_a.email_pro, ''))), 'pro')) v(e, kd)
     where v.e ~ '^[^@[:space:]]+@[^@[:space:]]+$'
    on conflict (company_id, contact_id, email) do nothing;
  end if;
  update public.contacts k
     set gsm = _a.mobile
   where k.id = _keep
     and nullif(btrim(k.gsm), '') is null
     and public.contact_phone_key(_a.mobile) is not null
     and public.contact_phone_key(_a.mobile) is distinct from public.contact_phone_key(k.mobile)
     and public.contact_phone_key(_a.mobile) is distinct from public.contact_phone_key(k.phone);

  -- Coordonnées différentes des deux côtés : celles de l'absorbée sont recopiées dans les
  -- notes de la fiche gardée, pour ne rien perdre de joignable. Un e-mail devenu e-mail
  -- secondaire, ou un mobile devenu « Mobile 2 », n'y est plus recopié (il est sur la fiche).
  select string_agg(label || ' : ' || av, E'\n')
    into _extra
    from (values
      ('E-mail', _k.email, _a.email),
      ('E-mail pro', _k.email_pro, _a.email_pro),
      ('Téléphone', _k.phone, _a.phone),
      ('Mobile', _k.mobile, _a.mobile),
      ('GSM', _k.gsm, _a.gsm),
      ('Téléphone pro', _k.phone_pro, _a.phone_pro),
      ('Mobile pro', _k.mobile_pro, _a.mobile_pro),
      ('Adresse',
        nullif(btrim(concat_ws(' ', _k.address, _k.street_number, _k.zip, _k.city)), ''),
        nullif(btrim(concat_ws(' ', _a.address, _a.street_number, _a.zip, _a.city)), ''))
    ) v(label, kv, av)
   where nullif(btrim(kv), '') is not null
     and nullif(btrim(av), '') is not null
     and lower(btrim(kv)) <> lower(btrim(av))
     and not (label in ('E-mail', 'E-mail pro') and to_regclass('public.contact_emails') is not null
              and exists (select 1 from public.contact_emails ce
                           where ce.contact_id = _keep and ce.email = lower(btrim(av))))
     and not (label = 'Mobile' and exists (select 1 from public.contacts x
                                            where x.id = _keep
                                              and public.contact_phone_key(x.gsm) = public.contact_phone_key(av)));

  update public.contacts set
    interests = (select coalesce(array_agg(distinct x), '{}') from unnest(_k.interests || _a.interests) x),
    model_interests = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(coalesce(_k.model_interests, '{}') || coalesce(_a.model_interests, '{}')) x),
    -- Drapeaux de vigilance et opt-out : un drapeau posé d'un côté n'est jamais perdu.
    is_vip            = _k.is_vip or _a.is_vip,
    is_blocked        = _k.is_blocked or _a.is_blocked,
    is_watch          = _k.is_watch or _a.is_watch,
    marketing_opt_out = _k.marketing_opt_out or _a.marketing_opt_out,
    -- Valeurs par défaut considérées comme « vides ».
    status          = case when _k.status = 'prospect' then _a.status else _k.status end,
    segment         = case when _k.segment = 'standard' then _a.segment else _k.segment end,
    credit_limit    = case when _k.credit_limit = 0 then _a.credit_limit else _k.credit_limit end,
    opening_balance = case when _k.opening_balance = 0 then _a.opening_balance else _k.opening_balance end,
    -- La personne est active si l'une des deux fiches l'était.
    is_active       = _k.is_active or _a.is_active,
    notes = nullif(concat_ws(E'\n\n',
              nullif(btrim(_k.notes), ''),
              case when nullif(btrim(_a.notes), '') is not null or _extra is not null then
                'Fusion avec la fiche ' || coalesce(_a.code, _absorb::text) || ' le ' || _stamp || E' :\n'
                || concat_ws(E'\n', nullif(btrim(_a.notes), ''), _extra)
              end), '')
  where id = _keep;

  -- 6. Archiver la fiche absorbée ----------------------------------------------------
  -- Ses e-mails sont retirés (ils vivent sur la fiche gardée et dans la trace) : sinon la
  -- relève mail et l'inscription, qui cherchent une fiche par e-mail sans regarder
  -- is_active, pourraient rattacher un nouveau message à la fiche archivée.
  update public.contacts set
    is_active = false,
    email = null,
    email_pro = null,
    notes = concat_ws(E'\n\n', nullif(btrim(notes), ''),
              'Fiche fusionnée le ' || _stamp || ' dans la fiche ' || coalesce(_k.code, _keep::text)
              || '. Toutes ses données y ont été déplacées.')
  where id = _absorb;

  -- 7. Trace (events, append-only) ------------------------------------------------
  select * into _after from public.contacts where id = _keep;
  _before := jsonb_build_object('kept', to_jsonb(_k), 'absorbed', to_jsonb(_a));

  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (
    _k.company_id, _uid, 'merge', 'contacts', _keep::text, 'screen',
    _before,
    jsonb_build_object(
      'kept_id', _keep, 'kept_code', _k.code,
      'absorbed_id', _absorb, 'absorbed_code', _a.code,
      'moved', _moved,
      'removed_duplicates', _removed,
      'archived_leads', _archived_leads,
      'kept_after', to_jsonb(_after)
    )
  );
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, origin, old_data, new_data)
  values (
    _k.company_id, _uid, 'merged_into', 'contacts', _absorb::text, 'screen',
    to_jsonb(_a),
    jsonb_build_object('kept_id', _keep, 'kept_code', _k.code, 'moved', _moved)
  );

  return jsonb_build_object(
    'kept_id', _keep,
    'absorbed_id', _absorb,
    'moved', _moved,
    'removed_duplicates', jsonb_array_length(_removed),
    'archived_leads', jsonb_array_length(_archived_leads)
  );
end;
$$;

revoke all on function public.contact_merge(uuid, uuid) from public, anon;
grant execute on function public.contact_merge(uuid, uuid) to authenticated;

comment on function public.contact_merge(uuid, uuid) is
  'M1 (18/11/2026, e-mails multiples 26/11/2026) — Fusionne la fiche _absorb dans _keep (admin, même société). Toutes les cles etrangeres suivent (registre des vehicules excepte) ; les e-mails de l''absorbee deviennent e-mails secondaires de la gardee, son mobile son Mobile 2 si libre. Tout ou rien ; trace dans events ; fiche absorbée archivée.';

notify pgrst, 'reload schema';
