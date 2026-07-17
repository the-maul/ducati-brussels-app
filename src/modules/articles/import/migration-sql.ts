/**
 * SQL des migrations EN ATTENTE d'application manuelle (Supabase SQL Editor).
 * Affiché avec un bouton « Copier » sur l'écran d'import tant que le schéma
 * n'est pas à jour (les réglages basculent alors en stockage local par poste).
 * Miroir de supabase/migrations/20260629100000 + 20260714090000.
 */
export const PENDING_MIGRATION_SQL = `-- DMS Ducati Bruxelles — migrations en attente (contacts + import tarifs)
-- Collez TOUT ce bloc dans https://supabase.com/dashboard/project/ujmrosbgkvgvwfnuryna/sql/new puis Run.

-- 1. Fiches clients (modèles d'intérêt, scans permis/ID)
alter table public.contacts add column if not exists vehicle_preference     text;
alter table public.contacts add column if not exists model_interests        text[] default '{}';
alter table public.contacts add column if not exists notify_model_stock     boolean default false;
alter table public.contacts add column if not exists license_scan_path      text;
alter table public.contacts add column if not exists national_id_scan_path  text;
alter type contact_type add value if not exists 'employe';

-- 2. Paramétrage d'intégration des tarifs (cases G8, par société)
create table if not exists public.article_import_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  accept_designation boolean not null default true,
  accept_purchase_price boolean not null default true,
  purchase_price_3dec boolean not null default true,
  sale_price_mode text not null default 'increase_only'
    check (sale_price_mode in ('always', 'increase_only', 'never')),
  keep_coefficient boolean not null default true,
  accept_supplier_ref boolean not null default true,
  accept_category boolean not null default true,
  accept_brand boolean not null default true,
  no_recreate_replaced boolean not null default true,
  replaced_to_equivalences boolean not null default true,
  new_refs_in_library boolean not null default true,
  integrate_supplier_barcodes boolean not null default true,
  translate_designations boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.article_import_settings enable row level security;
drop policy if exists "import_settings_select" on public.article_import_settings;
create policy "import_settings_select" on public.article_import_settings
  for select using (public.is_member(company_id));
drop policy if exists "import_settings_insert" on public.article_import_settings;
create policy "import_settings_insert" on public.article_import_settings
  for insert with check (public.is_member(company_id));
drop policy if exists "import_settings_update" on public.article_import_settings;
create policy "import_settings_update" on public.article_import_settings
  for update using (public.is_member(company_id));

-- 3. Règles PV / PPC
create table if not exists public.ppc_price_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_name text,
  category_path text,
  brand text,
  pct numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_ppc_rules_company on public.ppc_price_rules(company_id);
alter table public.ppc_price_rules enable row level security;
drop policy if exists "ppc_rules_select" on public.ppc_price_rules;
create policy "ppc_rules_select" on public.ppc_price_rules
  for select using (public.is_member(company_id));
drop policy if exists "ppc_rules_insert" on public.ppc_price_rules;
create policy "ppc_rules_insert" on public.ppc_price_rules
  for insert with check (public.is_member(company_id));
drop policy if exists "ppc_rules_update" on public.ppc_price_rules;
create policy "ppc_rules_update" on public.ppc_price_rules
  for update using (public.is_member(company_id));
drop policy if exists "ppc_rules_delete" on public.ppc_price_rules;
create policy "ppc_rules_delete" on public.ppc_price_rules
  for delete using (public.is_member(company_id));

-- 4. Plancher de prix (par société)
alter table public.companies add column if not exists price_floor_threshold numeric not null default 1;
alter table public.companies add column if not exists price_floor_min numeric not null default 2;

-- 5. Reprises motos clients : marchands partenaires + offres + mode d'envoi
create table if not exists public.tradein_partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  first_name text,
  company text,
  email text not null,
  phone text,
  extra_contacts jsonb not null default '[]',
  brands text[] not null default '{}',
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
  partner_name text,
  amount numeric(12,2) not null default 0,
  message text,
  seen boolean not null default false,
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

-- 6. Formats d'étiquettes personnalisés (éditeur B12)
create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_label_templates_company on public.label_templates(company_id);
alter table public.label_templates enable row level security;
drop policy if exists "label_templates_select" on public.label_templates;
create policy "label_templates_select" on public.label_templates
  for select using (public.is_member(company_id));
drop policy if exists "label_templates_insert" on public.label_templates;
create policy "label_templates_insert" on public.label_templates
  for insert with check (public.is_member(company_id));
drop policy if exists "label_templates_update" on public.label_templates;
create policy "label_templates_update" on public.label_templates
  for update using (public.is_member(company_id));
drop policy if exists "label_templates_delete" on public.label_templates;
create policy "label_templates_delete" on public.label_templates
  for delete using (public.is_member(company_id));

-- 7. Recharge du cache de schéma PostgREST
notify pgrst, 'reload schema';
`;
