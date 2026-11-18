-- =====================================================================
-- M1 — Fiche client : champs et onglets G8 absents (rattrapage G8 du 18/11/2026, lot-g8-clients).
--
--   1. contacts : nom de naissance, CP de naissance (G8 « CP/Ville naissance »), « Delivre par »
--      de la piece d'identite (G8 bloc « Piece d'identite »). Colonnes facultatives.
--   2. Groupes (G8 onglet « Groupes », arbre a cocher) : les groupes sont des lignes de
--      Parametres -> Tables (cle « contact_group », extra.category = interets | origine |
--      situation | autre), l'appartenance d'une fiche est dans contact_group_members.
--      Valeurs G8 posees pour chaque societe : Centres d'interet (Balade, Competition), Origine
--      du contact (Appel entrant, Demande internet, Passage en atelier, Passage en concession,
--      Salon / Evenement), Situation familiale (Celibataire, En couple).
--   3. Vente groupement (G8 onglet « Vente Groupement ») : clients associes et taux de
--      participation (contact_group_sales). Donnee de fiche : elle ne repartit pas encore une
--      facture (voir bible M01, « A trancher »).
--
-- STRICTEMENT ADDITIVE, idempotente. NE PAS APPLIQUER depuis un agent.
-- Essai a blanc : supabase/tests/m1_fiche_cascade_extraction.sql.
-- =====================================================================

-- 1. Colonnes de la fiche ------------------------------------------------
alter table public.contacts add column if not exists birth_name text;
alter table public.contacts add column if not exists birth_zip text;
alter table public.contacts add column if not exists license_issued_by text;
comment on column public.contacts.birth_name is 'Nom de naissance (G8, Informations supplementaires).';
comment on column public.contacts.birth_zip is 'Code postal du lieu de naissance (G8 « CP/Ville naissance » ; la ville est birth_place).';
comment on column public.contacts.license_issued_by is 'Piece d''identite : autorite qui l''a delivree (G8 « Delivre par »).';

-- 2. Groupes -------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, is_active, extra)
select co.id, 'contact_group', v.code, v.label, v.sort, true, jsonb_build_object('category', v.cat)
  from public.companies co
 cross join (values
   ('INT_BALADE',      'Balade',                 10, 'interets'),
   ('INT_COMPETITION', 'Compétition',            20, 'interets'),
   ('ORI_APPEL',       'Appel entrant',         110, 'origine'),
   ('ORI_INTERNET',    'Demande internet',      120, 'origine'),
   ('ORI_ATELIER',     'Passage en atelier',    130, 'origine'),
   ('ORI_CONCESSION',  'Passage en concession', 140, 'origine'),
   ('ORI_SALON',       'Salon / Événement',     150, 'origine'),
   ('SIT_CELIBATAIRE', 'Célibataire',           210, 'situation'),
   ('SIT_COUPLE',      'En couple',             220, 'situation')
 ) v(code, label, sort, cat)
on conflict (company_id, table_key, code) do nothing;

create table if not exists public.contact_group_members (
  company_id  uuid not null references public.companies(id) on delete restrict,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  group_code  text not null,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (contact_id, group_code)
);
create index if not exists idx_contact_group_members_group on public.contact_group_members(company_id, group_code);
comment on table public.contact_group_members is
  'G8 onglet Groupes : une ligne par groupe coche sur une fiche. group_code = reference_values.code (table_key contact_group).';

drop trigger if exists trg_contact_group_members_company on public.contact_group_members;
create trigger trg_contact_group_members_company before insert on public.contact_group_members
  for each row execute function public._contact_child_company();
drop trigger if exists trg_contact_group_members_audit on public.contact_group_members;
create trigger trg_contact_group_members_audit after insert or update or delete on public.contact_group_members
  for each row execute function public.audit_row();

alter table public.contact_group_members enable row level security;
revoke all on public.contact_group_members from anon;
drop policy if exists contact_group_members_select on public.contact_group_members;
create policy contact_group_members_select on public.contact_group_members for select to authenticated
  using (public.is_member(company_id));
drop policy if exists contact_group_members_write on public.contact_group_members;
create policy contact_group_members_write on public.contact_group_members for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- 3. Vente groupement -----------------------------------------------------
create table if not exists public.contact_group_sales (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  contact_id          uuid not null references public.contacts(id) on delete cascade,
  member_id           uuid not null references public.contacts(id) on delete cascade,
  participation_rate  numeric(5,2) not null check (participation_rate > 0 and participation_rate <= 100),
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint contact_group_sales_not_self check (contact_id <> member_id),
  constraint contact_group_sales_unique unique (contact_id, member_id)
);
create index if not exists idx_contact_group_sales_member on public.contact_group_sales(member_id);
comment on table public.contact_group_sales is
  'G8 onglet Vente Groupement : client associe (member_id) et son taux de participation (%) aux ventes de la fiche contact_id.';

-- Le client associe doit etre de la meme societe que la fiche.
create or replace function public._contact_group_sales_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select c.company_id into new.company_id from public.contacts c where c.id = new.contact_id;
  if new.company_id is null then raise exception 'CONTACT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.contacts m where m.id = new.member_id and m.company_id = new.company_id) then
    raise exception 'GROUP_SALE_OTHER_COMPANY' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public._contact_group_sales_check() from public, anon, authenticated;

drop trigger if exists trg_contact_group_sales_check on public.contact_group_sales;
create trigger trg_contact_group_sales_check before insert or update on public.contact_group_sales
  for each row execute function public._contact_group_sales_check();
drop trigger if exists trg_contact_group_sales_updated on public.contact_group_sales;
create trigger trg_contact_group_sales_updated before update on public.contact_group_sales
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contact_group_sales_audit on public.contact_group_sales;
create trigger trg_contact_group_sales_audit after insert or update or delete on public.contact_group_sales
  for each row execute function public.audit_row();

alter table public.contact_group_sales enable row level security;
revoke all on public.contact_group_sales from anon;
drop policy if exists contact_group_sales_select on public.contact_group_sales;
create policy contact_group_sales_select on public.contact_group_sales for select to authenticated
  using (public.is_member(company_id));
drop policy if exists contact_group_sales_write on public.contact_group_sales;
create policy contact_group_sales_write on public.contact_group_sales for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

notify pgrst, 'reload schema';
