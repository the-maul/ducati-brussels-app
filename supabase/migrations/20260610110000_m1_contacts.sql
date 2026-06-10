-- =====================================================================
-- M1 — CONTACTS (CON000-007, CRM009)
-- Fiche client moto : identité, champs métier (permis A2 → bridage),
-- B2B (TVA intracom, encours), catégorisation (VIP/détaxé/à surveiller/en compte),
-- centres d'intérêt. Multi-société + RLS + audit (events).
-- =====================================================================

-- Type de contact (CON001-007)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'contact_type') then
    create type public.contact_type as enum ('particulier','professionnel','banque_leasing','fournisseur');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_segment') then
    create type public.customer_segment as enum ('standard','vip');
  end if;
  if not exists (select 1 from pg_type where typname = 'license_category') then
    -- A2 conditionne le bridage (lien DOC006) ; AM/A1/A/B pour complétude moto
    create type public.license_category as enum ('AM','A1','A2','A','B','autre');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fonction d'audit réutilisable (B7) : journalise INSERT/UPDATE/DELETE → events
-- ---------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  cid := coalesce(
    (case when tg_op = 'DELETE' then (to_jsonb(old)->>'company_id') else (to_jsonb(new)->>'company_id') end)::uuid,
    null
  );
  insert into public.events (company_id, actor_id, action, entity_type, entity_id, old_data, new_data, origin)
  values (
    cid, auth.uid(), lower(tg_op), tg_table_name,
    coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    'screen'
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Table contacts
-- ---------------------------------------------------------------------
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  type        public.contact_type not null default 'particulier',

  -- Identité
  civility     text,                 -- M / Mme
  first_name   text,
  last_name    text,
  company_name text,                 -- raison sociale (pro)
  email        text,
  phone        text,
  mobile       text,

  -- Adresse
  address  text,
  zip      text,
  city     text,
  country  text not null default 'BE',

  -- Champs métier moto (CON002)
  birth_date         date,
  national_id        text,           -- n° carte d'identité
  national_register  text,           -- registre national
  license_number     text,           -- permis moto
  license_date       date,
  license_place      text,
  license_category   public.license_category,

  -- B2B (CON003)
  vat_number       text,
  vies_valid       boolean,
  vies_checked_at  timestamptz,
  payment_terms    text,             -- ex. '30 jours'
  iban             text,
  credit_limit     numeric(12,2) not null default 0,   -- encours autorisé (encours actuel calculé en M6)

  -- Catégorisation (CON004) + listes de prix (CRM009)
  segment      public.customer_segment not null default 'standard',
  is_vip       boolean not null default false,
  is_detaxe    boolean not null default false,   -- détaxé → TVA 0% export (PDV005)
  is_watch     boolean not null default false,   -- à surveiller / douteux
  is_account   boolean not null default false,   -- en compte
  interests    text[] not null default '{}',     -- route / sport / off-road
  notes        text,

  -- Méta
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create index if not exists idx_contacts_company on public.contacts(company_id);
create index if not exists idx_contacts_lastname on public.contacts(company_id, last_name);
create index if not exists idx_contacts_email on public.contacts(email);
create index if not exists idx_contacts_vat on public.contacts(vat_number);
create index if not exists idx_contacts_type on public.contacts(company_id, type);

drop trigger if exists trg_contacts_updated on public.contacts;
create trigger trg_contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contacts_audit on public.contacts;
create trigger trg_contacts_audit after insert or update or delete on public.contacts
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.contacts enable row level security;

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated using (public.is_member(company_id));

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert to authenticated with check (public.is_member(company_id));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete to authenticated using (public.is_admin(company_id));
