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

-- 7. Localisation 2 + reprises de données articles (marque Ducati, réf. frs = réf.)
alter table public.articles add column if not exists bin_location2 text;
update public.articles set brand = 'Ducati' where coalesce(trim(brand), '') = '';
update public.articles set supplier_ref = reference where coalesce(trim(supplier_ref), '') = '';

-- 8. Vérification TVA (VIES, Commission européenne) — appel serveur anti-CORS
create extension if not exists http with schema extensions;
create or replace function public.vies_check(_country text, _number text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  resp extensions.http_response;
begin
  resp := extensions.http_get(
    'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/'
    || upper(regexp_replace(_country, '[^A-Za-z]', '', 'g'))
    || '/vat/'
    || regexp_replace(_number, '[^A-Za-z0-9]', '', 'g')
  );
  if resp.status <> 200 then
    return jsonb_build_object('error', 'vies_http_' || resp.status::text);
  end if;
  return resp.content::jsonb;
exception when others then
  return jsonb_build_object('error', 'vies_unreachable');
end;
$$;
grant execute on function public.vies_check(text, text) to authenticated, service_role;

-- 10. Fiche véhicule : indicateur « Papiers 100 CH »
alter table public.vehicles add column if not exists papers_100hp boolean not null default false;

-- 9. Validation de reprise (appel d'offres -> entrée en stock après validation)
alter table public.oro
  add column if not exists tradein_status text not null default 'ouvert',
  add column if not exists checklist jsonb,
  add column if not exists seller_vat_status text,
  add column if not exists attestation jsonb,
  add column if not exists vat_rate numeric(5,2),
  add column if not exists buy_price_ttc numeric(14,2),
  add column if not exists buy_price_ht numeric(14,2),
  add column if not exists sale_price numeric(14,2),
  add column if not exists min_sale_price numeric(14,2),
  add column if not exists classification jsonb,
  add column if not exists validated_at timestamptz,
  add column if not exists cancelled_at timestamptz;

-- 10. Workflow de statut de reprise + offre acceptée + synchro CRM
alter table public.oro
  add column if not exists dispatched_at timestamptz,
  add column if not exists accepted_amount numeric(14,2),
  add column if not exists best_offer_amount numeric(14,2),
  add column if not exists invoice_partner_name text,
  add column if not exists accepted_at timestamptz;
alter table public.leads
  add column if not exists oro_id uuid,
  add column if not exists reprise_status text;

-- 11. Recharge du cache de schéma PostgREST
notify pgrst, 'reload schema';
`;
