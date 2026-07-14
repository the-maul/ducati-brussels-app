-- M2 — Paramétrage de l'import tarifs (ACH003/INV013) + règles PV/PPC + arrondi plancher.
-- 1) article_import_settings : les « cases à cocher » G8 d'intégration, par société.
-- 2) ppc_price_rules : calcul du PV selon le Prix Public Conseillé (% par fournisseur/rayon/marque).
-- 3) companies : plancher de prix paramétrable (PV TTC sous seuil → minimum).

-- ── 1. Réglages d'intégration des tarifs (par société) ────────────────────────
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
  updated_at timestamptz not null default now()
);

alter table public.article_import_settings enable row level security;

create policy "import_settings_select" on public.article_import_settings
  for select using (public.is_member(company_id));
create policy "import_settings_insert" on public.article_import_settings
  for insert with check (public.is_member(company_id));
create policy "import_settings_update" on public.article_import_settings
  for update using (public.is_member(company_id));

-- ── 2. Règles PV / PPC (Prix Public Conseillé) ───────────────────────────────
-- PV TTC = PPC TTC × (1 + pct/100). Critères optionnels : fournisseur (nom),
-- rayon/catégorie (préfixe du category_path), marque. La règle la plus
-- spécifique (le plus de critères remplis) gagne.
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

create policy "ppc_rules_select" on public.ppc_price_rules
  for select using (public.is_member(company_id));
create policy "ppc_rules_insert" on public.ppc_price_rules
  for insert with check (public.is_member(company_id));
create policy "ppc_rules_update" on public.ppc_price_rules
  for update using (public.is_member(company_id));
create policy "ppc_rules_delete" on public.ppc_price_rules
  for delete using (public.is_member(company_id));

-- ── 3. Plancher de prix paramétrable (par société) ───────────────────────────
-- Un PV TTC importé/calculé strictement sous le seuil est remonté au minimum
-- (ex. seuil 1 € / minimum 2 € : 0,80 € → 2,00 €). Appliqué à l'import.
alter table public.companies add column if not exists price_floor_threshold numeric not null default 1;
alter table public.companies add column if not exists price_floor_min numeric not null default 2;
