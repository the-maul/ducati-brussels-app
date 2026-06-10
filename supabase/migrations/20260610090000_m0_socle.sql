-- =====================================================================
-- M0 — SOCLE  (CLAUDE.md §1 : multi-société + RLS + audit append-only)
-- Tables : companies, profiles, user_roles, events, document_sequences
-- Fonctions : helpers RLS (has_role/is_member/is_admin), numérotation,
--             création de profil à l'inscription, updated_at.
-- Tout est idempotent autant que possible.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enum des rôles (M0). Modifiable ultérieurement (alter type ... add value).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum
      ('admin','vendeur','magasinier','mecanicien','chef_atelier','comptable','marketing');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Sociétés (COM005) — ITALBIKE STORE + NL INVEST
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,             -- 'italbike' | 'nlinvest'
  name        text not null,
  legal_name  text,
  vat_number  text,
  address     text,
  zip         text,
  city        text,
  country     text default 'BE',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Profils (1 par utilisateur auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  phone         text,
  default_company_id uuid references public.companies(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Création automatique du profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Rôles par utilisateur et par société (RBAC multi-société)
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id, role)
);
create index if not exists idx_user_roles_user on public.user_roles(user_id);
create index if not exists idx_user_roles_company on public.user_roles(company_id);

-- ---------------------------------------------------------------------
-- Helpers RLS — SECURITY DEFINER (bypass RLS, évite la récursion de policy)
-- ---------------------------------------------------------------------
create or replace function public.has_role(_company uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.company_id = _company and ur.role = _role
  );
$$;

create or replace function public.is_member(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.company_id = _company
  );
$$;

create or replace function public.is_admin(_company uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role(_company, 'admin');
$$;

-- ---------------------------------------------------------------------
-- Audit universel (B7) — append-only : aucune mise à jour/suppression
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  company_id  uuid references public.companies(id) on delete set null,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,             -- ex. 'create','update','status_change'
  entity_type text not null,             -- ex. 'invoice','stock_move','vehicle'
  entity_id   text,                      -- id de l'entité concernée (texte : uuid/seq/vin)
  origin      text not null default 'screen', -- 'screen' | 'import' | 'api' | 'system'
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists idx_events_company on public.events(company_id);
create index if not exists idx_events_entity on public.events(entity_type, entity_id);
create index if not exists idx_events_occurred on public.events(occurred_at desc);

-- ---------------------------------------------------------------------
-- Séquences documentaires (M0) — configurables par société et par type.
-- Préfixe/format/remise à zéro annuelle pilotables (écran M0 à venir).
-- ---------------------------------------------------------------------
create table if not exists public.document_sequences (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  doc_type     text not null,                 -- 'FAC','OR','ORO',...
  prefix       text not null,
  separator    text not null default '-',
  padding      int  not null default 5,
  next_value   bigint not null default 1,
  reset_yearly boolean not null default true,
  current_year int,
  suffix       text,
  label        text not null,                 -- libellé explicatif (UI)
  updated_at   timestamptz not null default now(),
  unique (company_id, doc_type)
);

drop trigger if exists trg_docseq_updated on public.document_sequences;
create trigger trg_docseq_updated before update on public.document_sequences
  for each row execute function public.set_updated_at();

-- Génère le prochain numéro de document (verrou ligne, reset annuel géré).
create or replace function public.next_document_number(_company uuid, _doc_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seq public.document_sequences%rowtype;
  y   int := extract(year from now())::int;
  n   bigint;
  num text;
begin
  if not public.is_member(_company) then
    raise exception 'Accès refusé à la société %', _company;
  end if;

  select * into seq from public.document_sequences
    where company_id = _company and doc_type = _doc_type
    for update;
  if not found then
    raise exception 'Séquence introuvable : société=% type=%', _company, _doc_type;
  end if;

  if seq.reset_yearly and (seq.current_year is distinct from y) then
    n := 1;
    update public.document_sequences
      set next_value = 2, current_year = y, updated_at = now()
      where id = seq.id;
  else
    n := seq.next_value;
    update public.document_sequences
      set next_value = next_value + 1, current_year = coalesce(current_year, y), updated_at = now()
      where id = seq.id;
  end if;

  num := lpad(n::text, seq.padding, '0');
  if seq.reset_yearly then
    return seq.prefix || seq.separator || y::text || seq.separator || num || coalesce(seq.suffix, '');
  else
    return seq.prefix || seq.separator || num || coalesce(seq.suffix, '');
  end if;
end $$;

-- =====================================================================
-- RLS — activée partout (CLAUDE.md règle 2)
-- =====================================================================
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_roles         enable row level security;
alter table public.events             enable row level security;
alter table public.document_sequences enable row level security;

-- companies : visible aux membres ; administrable par l'admin de la société
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated using (public.is_member(id));
drop policy if exists companies_admin on public.companies;
create policy companies_admin on public.companies
  for all to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- profiles : chacun voit/édite son profil
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles : on voit ses propres rôles ; l'admin gère ceux de sa société
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin(company_id));
drop policy if exists user_roles_admin on public.user_roles;
create policy user_roles_admin on public.user_roles
  for all to authenticated using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- events : append-only — insert + select pour les membres, jamais update/delete
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (company_id is null or public.is_member(company_id));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (company_id is null or public.is_member(company_id));
-- (pas de policy update/delete → refusées par défaut sous RLS) ; ceinture + bretelles :
revoke update, delete on public.events from authenticated;

-- document_sequences : lecture membres, configuration admin
drop policy if exists docseq_select on public.document_sequences;
create policy docseq_select on public.document_sequences
  for select to authenticated using (public.is_member(company_id));
drop policy if exists docseq_admin on public.document_sequences;
create policy docseq_admin on public.document_sequences
  for all to authenticated using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- Droit d'exécution des helpers / numérotation
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.next_document_number(uuid, text) to authenticated;

-- =====================================================================
-- DONNÉES DE CONFIGURATION (pas du seed démo) : 2 sociétés + séquences
-- =====================================================================
insert into public.companies (code, name, legal_name, country)
values
  ('italbike', 'ITALBIKE STORE', 'ITALBIKE STORE', 'BE'),
  ('nlinvest', 'NL INVEST', 'NL INVEST', 'BE')
on conflict (code) do nothing;

insert into public.document_sequences (company_id, doc_type, prefix, label)
select c.id, d.doc_type, d.prefix, d.label
from public.companies c
cross join (values
  ('FAC', 'FAC', 'Facture'),
  ('TIK', 'TIK', 'Ticket de caisse'),
  ('DEV', 'DEV', 'Devis'),
  ('CMD', 'CMD', 'Commande fournisseur'),
  ('REC', 'REC', 'Réception'),
  ('OR',  'OR',  'Ordre de réparation'),
  ('ORO', 'ORO', 'Remise en état occasion'),
  ('OCC', 'OCC', 'Occasion'),
  ('DEP', 'DEP', 'Dépôt-vente'),
  ('REP', 'REP', 'Reprise'),
  ('COC', 'COC', 'Demande de COC')
) as d(doc_type, prefix, label)
on conflict (company_id, doc_type) do nothing;
