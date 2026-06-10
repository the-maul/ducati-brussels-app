-- =====================================================================
-- M2 — ARTICLES & TARIFS (INV012-013, ACH003 ; invariants B1 types, B5 PAMP)
-- Référentiel pièces/accessoires avec toute la profondeur G8 :
-- types de gestion A/M/F/N/V/O/P/D/R, fournisseurs, codes-barres, casiers,
-- PA / PAMP / PV / coefficient, équivalences & remplacements, forfaits/kits.
-- PAMP recalculé sur les entrées (M4/M5) ; ici on pose le référentiel.
-- =====================================================================

-- Type de gestion d'article (B1)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'article_mgmt_type') then
    -- A pièce stockée · M non stockée · F texte · N composant forfait · V véhicule neuf
    -- O occasion particulier (TVA marge) · P occasion pro · D dépôt-vente · R référence reprise
    create type public.article_mgmt_type as enum ('A','M','F','N','V','O','P','D','R');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Rayons (rayon / sous-rayon / catégorie) — hiérarchie simple
-- ---------------------------------------------------------------------
create table if not exists public.article_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  parent_id   uuid references public.article_categories(id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_artcat_company on public.article_categories(company_id);

-- ---------------------------------------------------------------------
-- Articles
-- ---------------------------------------------------------------------
create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  reference     text not null,                 -- référence article
  designation   text not null,
  brand         text,                          -- marque (Ducati, Rizoma, …)
  mgmt_type     public.article_mgmt_type not null default 'A',  -- B1
  category_id   uuid references public.article_categories(id) on delete set null,
  category_path text,                          -- rayon/sous-rayon/catégorie (libellé dénormalisé)

  -- Fournisseur principal (les secondaires en table dédiée)
  main_supplier_id uuid references public.contacts(id) on delete set null,
  supplier_ref     text,                       -- réf. fournisseur

  -- Emplacement & logistique
  bin_location  text,                          -- code casier (multi-emplacements possible plus tard)
  pack_qty      numeric(12,3) not null default 1,   -- conditionnement achat
  stock_min     numeric(12,3) not null default 0,
  stock_max     numeric(12,3) not null default 0,

  -- Prix (B5) — PA saisi, PAMP recalculé aux entrées, PV TTC, coefficient
  purchase_price numeric(12,3) not null default 0,   -- PA (3 décimales)
  pamp           numeric(12,3) not null default 0,   -- prix d'achat moyen pondéré
  sale_price_ttc numeric(12,2) not null default 0,   -- PV TTC
  coefficient    numeric(8,4),                       -- coefficient PV/PA (conservé aux imports, INV013)
  vat_rate       numeric(5,2) not null default 21,   -- taux TVA %

  -- Équivalences / remplacements (INV012)
  superseded_by_id uuid references public.articles(id) on delete set null, -- remplacée par
  equivalence_group uuid,                       -- groupe d'équivalences

  -- Publication e-shop (INV010) — flag, branché en M11
  publishable boolean not null default false,
  is_library  boolean not null default false,  -- "librairie" : catalogue non stocké
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,

  unique (company_id, reference)
);
create index if not exists idx_articles_company on public.articles(company_id);
create index if not exists idx_articles_ref on public.articles(company_id, reference);
create index if not exists idx_articles_designation on public.articles(company_id, designation);
create index if not exists idx_articles_type on public.articles(company_id, mgmt_type);
create index if not exists idx_articles_brand on public.articles(brand);
create index if not exists idx_articles_equiv on public.articles(equivalence_group);

drop trigger if exists trg_articles_updated on public.articles;
create trigger trg_articles_updated before update on public.articles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_articles_audit on public.articles;
create trigger trg_articles_audit after insert or update or delete on public.articles
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Codes-barres multiples par article
-- ---------------------------------------------------------------------
create table if not exists public.article_barcodes (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  barcode    text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (article_id, barcode)
);
create index if not exists idx_barcodes_code on public.article_barcodes(barcode);

-- ---------------------------------------------------------------------
-- Fournisseurs secondaires (avec réf. fournisseur)
-- ---------------------------------------------------------------------
create table if not exists public.article_suppliers (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid not null references public.articles(id) on delete cascade,
  supplier_id  uuid not null references public.contacts(id) on delete restrict,
  supplier_ref text,
  purchase_price numeric(12,3),
  created_at   timestamptz not null default now(),
  unique (article_id, supplier_id)
);

-- ---------------------------------------------------------------------
-- Forfaits / kits (ATE013, B1 type N) : nomenclature de composants
-- ---------------------------------------------------------------------
create table if not exists public.article_kit_items (
  id          uuid primary key default gen_random_uuid(),
  kit_id      uuid not null references public.articles(id) on delete cascade,    -- l'article forfait
  component_id uuid not null references public.articles(id) on delete restrict,  -- composant
  quantity    numeric(12,3) not null default 1,
  created_at  timestamptz not null default now(),
  unique (kit_id, component_id)
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.article_categories enable row level security;
alter table public.articles           enable row level security;
alter table public.article_barcodes   enable row level security;
alter table public.article_suppliers  enable row level security;
alter table public.article_kit_items  enable row level security;

-- Catégories & articles : lecture/écriture membres, suppression admin
drop policy if exists artcat_select on public.article_categories;
create policy artcat_select on public.article_categories for select to authenticated using (public.is_member(company_id));
drop policy if exists artcat_write on public.article_categories;
create policy artcat_write on public.article_categories for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists articles_select on public.articles;
create policy articles_select on public.articles for select to authenticated using (public.is_member(company_id));
drop policy if exists articles_insert on public.articles;
create policy articles_insert on public.articles for insert to authenticated with check (public.is_member(company_id));
drop policy if exists articles_update on public.articles;
create policy articles_update on public.articles for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists articles_delete on public.articles;
create policy articles_delete on public.articles for delete to authenticated using (public.is_admin(company_id));

-- Tables filles : accès si l'article parent appartient à une société dont on est membre
drop policy if exists barcodes_all on public.article_barcodes;
create policy barcodes_all on public.article_barcodes for all to authenticated
  using (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)))
  with check (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)));

drop policy if exists artsup_all on public.article_suppliers;
create policy artsup_all on public.article_suppliers for all to authenticated
  using (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)))
  with check (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)));

drop policy if exists kititems_all on public.article_kit_items;
create policy kititems_all on public.article_kit_items for all to authenticated
  using (exists (select 1 from public.articles a where a.id = kit_id and public.is_member(a.company_id)))
  with check (exists (select 1 from public.articles a where a.id = kit_id and public.is_member(a.company_id)));
