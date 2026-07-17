-- M7 — Reprises motos clients : marchands partenaires + offres reçues + mode d'envoi.
-- 1) tradein_partners : marchands intéressés par les occasions (e-mail + marques suivies).
-- 2) tradein_offers  : offres des marchands rattachées à une reprise (ORO), triables.
-- 3) companies.tradein_dispatch_mode : envoi aux marchands 'auto' | 'semi_auto' (défaut semi).

create table if not exists public.tradein_partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,                    -- nom (personne de contact)
  first_name text,                       -- prénom
  company text,                          -- société du marchand
  email text not null,
  phone text,
  -- contacts supplémentaires flexibles : [{kind:'mail'|'phone'|'autre', label, value}]
  extra_contacts jsonb not null default '[]',
  brands text[] not null default '{}',   -- vide = toutes les marques
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_tradein_partners_company on public.tradein_partners(company_id);

alter table public.tradein_partners enable row level security;
drop policy if exists "tradein_partners_select" on public.tradein_partners;
create policy "tradein_partners_select" on public.tradein_partners
  for select using (public.is_member(company_id));
drop policy if exists "tradein_partners_insert" on public.tradein_partners;
create policy "tradein_partners_insert" on public.tradein_partners
  for insert with check (public.is_member(company_id));
drop policy if exists "tradein_partners_update" on public.tradein_partners;
create policy "tradein_partners_update" on public.tradein_partners
  for update using (public.is_member(company_id));
drop policy if exists "tradein_partners_delete" on public.tradein_partners;
create policy "tradein_partners_delete" on public.tradein_partners
  for delete using (public.is_member(company_id));

create table if not exists public.tradein_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  oro_id uuid not null references public.oro(id) on delete cascade,
  partner_id uuid references public.tradein_partners(id) on delete set null,
  partner_name text,                      -- copie du nom (si partenaire supprimé / hors liste)
  amount numeric(12,2) not null default 0,
  message text,
  seen boolean not null default false,    -- pastille de notification vendeur
  created_at timestamptz not null default now()
);
create index if not exists idx_tradein_offers_oro on public.tradein_offers(oro_id);
create index if not exists idx_tradein_offers_company_seen on public.tradein_offers(company_id, seen);

alter table public.tradein_offers enable row level security;
drop policy if exists "tradein_offers_select" on public.tradein_offers;
create policy "tradein_offers_select" on public.tradein_offers
  for select using (public.is_member(company_id));
drop policy if exists "tradein_offers_insert" on public.tradein_offers;
create policy "tradein_offers_insert" on public.tradein_offers
  for insert with check (public.is_member(company_id));
drop policy if exists "tradein_offers_update" on public.tradein_offers;
create policy "tradein_offers_update" on public.tradein_offers
  for update using (public.is_member(company_id));
drop policy if exists "tradein_offers_delete" on public.tradein_offers;
create policy "tradein_offers_delete" on public.tradein_offers
  for delete using (public.is_member(company_id));

alter table public.companies add column if not exists tradein_dispatch_mode text not null default 'semi_auto';

-- Recharge du cache de schéma PostgREST
notify pgrst, 'reload schema';
