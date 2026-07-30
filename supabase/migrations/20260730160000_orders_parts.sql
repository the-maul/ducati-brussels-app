-- =====================================================================
-- COMMANDES DE PIÈCES (nouveau module) — process Miro 2026-07-30.
-- Réservation de pièces validée selon 4 TYPES métier (order_kind) :
--   urgente | standard | excel | accident   (enum extensible ; ADR : on REMPLACE
--   le classement G8 Stock/Dépannage/Garantie par cet axe métier).
-- Cycle de vie du dispatch : brouillon → en_attente_paiement → payee → a_envoyer → envoyee (+ annulee).
-- Seuils paramétrables (reference_values / order_threshold) : standard 250€, accident 1500€,
--   urgente surcharge +10 %, excel 2000€/onglet.
-- Sous-flux « Commande Excel » : catalogue Ducati (Demo/Courtoisie/Showroom) + commandes Excel
--   avec archivage .xlsx et n° interne.
-- company_id + RLS (is_member) partout, audit (audit_row → events), updated_at.
-- Réf. docs/process-commandes-pieces.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enums (chacun créé de façon idempotente ; extensible via ALTER TYPE ... ADD VALUE)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.order_kind as enum ('urgente', 'standard', 'excel', 'accident');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_dispatch_status as enum
    ('brouillon', 'en_attente_paiement', 'payee', 'a_envoyer', 'envoyee', 'annulee');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. En-tête commande de pièces
-- ---------------------------------------------------------------------
create table if not exists public.part_orders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  number         text,                                   -- n° interne DMS (attribué à la validation)
  order_kind     public.order_kind not null default 'standard',
  dispatch_status public.order_dispatch_status not null default 'brouillon',
  contact_id     uuid references public.contacts(id) on delete set null,   -- client (précommande)
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null, -- devis/proforma d'origine
  channel        text not null default 'comptoir',       -- 'comptoir' | 'mail'
  -- montants (HTVA de référence pour les seuils ; TTC pour l'encaissement)
  total_ht       numeric(14,2) not null default 0,
  total_ttc      numeric(14,2) not null default 0,
  surcharge_pct  numeric(6,2)  not null default 0,        -- +10 % urgente, +5 % Stripe, etc.
  -- paiement
  paid           boolean not null default false,
  paid_at        timestamptz,
  payment_method text,                                    -- 'cash' | 'bancontact' | 'qr_stripe' | 'qr_sepa' | ...
  -- accident
  is_accident    boolean not null default false,
  claim_ref      text,                                    -- réf sinistre / expert
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_part_orders_company on public.part_orders(company_id, order_kind, dispatch_status);
create index if not exists idx_part_orders_contact on public.part_orders(contact_id);
create index if not exists idx_part_orders_source  on public.part_orders(source_document_id);

-- ---------------------------------------------------------------------
-- 3. Lignes de commande de pièces
-- ---------------------------------------------------------------------
create table if not exists public.part_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.part_orders(id) on delete cascade,
  article_id    uuid references public.articles(id) on delete set null,
  reference     text,                                    -- réf saisie (peut venir du catalogue Excel)
  designation   text not null,
  supplier_id   uuid references public.contacts(id) on delete set null,
  qty_client    numeric(14,3) not null default 0,        -- quantité pour le client
  qty_shop      numeric(14,3) not null default 0,        -- quantité réappro magasin
  unit_price_ht numeric(14,3) not null default 0,
  vat_rate      numeric(6,2)  not null default 21,
  line_ht       numeric(14,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_part_order_lines_order   on public.part_order_lines(order_id);
create index if not exists idx_part_order_lines_article on public.part_order_lines(article_id);

-- ---------------------------------------------------------------------
-- 4. Catalogue Ducati (source du sous-flux « Commande Excel »)
--    Importé depuis le classeur Demo/Courtoisie/Showroom (~1793 réf.).
-- ---------------------------------------------------------------------
create table if not exists public.excel_catalog (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  family        text,                                    -- FAMILLE
  category      text,                                    -- CATEGORIES FR
  reference     text not null,                           -- REFERENCE
  description   text,                                    -- DESCRIPTION FR
  models        text,                                    -- MODELS (<=MY24 / MY25-26)
  discount_class text,                                   -- CLASSE DE REMISE
  price_public_ht numeric(14,2),                         -- PRIX AU PUBLIC HT 2026
  price_dealer  numeric(14,2),                           -- Dealer/Importer PRICE 2026
  availability  text,                                    -- Disponibilité
  created_at    timestamptz not null default now(),
  unique (company_id, reference)
);
create index if not exists idx_excel_catalog_company on public.excel_catalog(company_id);
create index if not exists idx_excel_catalog_ref     on public.excel_catalog(company_id, reference);

-- ---------------------------------------------------------------------
-- 5. Commande Excel (en-tête) — un classeur = 3 onglets (demo/courtoisie/showroom)
--    liée à une part_order de type 'excel'. Archivage .xlsx + n° interne.
-- ---------------------------------------------------------------------
create table if not exists public.excel_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  part_order_id uuid references public.part_orders(id) on delete set null,
  number        text,                                    -- n° interne DMS (créé au 1er téléchargement)
  status        text not null default 'en_cours',        -- en_cours | telecharge | cloture | archive
  dealer_code   text,                                    -- code concession (ex. 100645)
  dealer_name   text,
  downloaded_at timestamptz,                             -- 1er téléchargement (déclenche le n°)
  archived_at   timestamptz,
  archive_path  text,                                    -- .xlsx archivé en Storage
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_excel_orders_company on public.excel_orders(company_id, status);
create index if not exists idx_excel_orders_partord on public.excel_orders(part_order_id);

-- ---------------------------------------------------------------------
-- 6. Lignes de commande Excel — une ligne = une réf sur un onglet, avec qté + moto/VIN
-- ---------------------------------------------------------------------
create table if not exists public.excel_order_lines (
  id            uuid primary key default gen_random_uuid(),
  excel_order_id uuid not null references public.excel_orders(id) on delete cascade,
  tab           text not null default 'demo',            -- 'demo' | 'courtoisie' | 'showroom'
  reference     text not null,                           -- réf catalogue Ducati
  description   text,
  qty           numeric(14,3) not null default 0,        -- Q COMMANDE (col L)
  price_dealer  numeric(14,2) not null default 0,        -- prix dealer figé à l'ajout
  extra_discount numeric(6,4) not null default 0,        -- extra-remise (col N, ex. 0.18)
  moto_label    text,                                    -- modèle moto (bloc Moto 1..4)
  moto_vin      text,                                    -- n° de série / VIN
  contact_id    uuid references public.contacts(id) on delete set null, -- client à relier (traçabilité BL)
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_excel_order_lines_order on public.excel_order_lines(excel_order_id, tab);

-- ---------------------------------------------------------------------
-- 7. Triggers updated_at + audit (B7)
-- ---------------------------------------------------------------------
drop trigger if exists trg_part_orders_updated on public.part_orders;
create trigger trg_part_orders_updated before update on public.part_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_part_orders_audit on public.part_orders;
create trigger trg_part_orders_audit after insert or update or delete on public.part_orders for each row execute function public.audit_row();

drop trigger if exists trg_part_order_lines_audit on public.part_order_lines;
create trigger trg_part_order_lines_audit after insert or update or delete on public.part_order_lines for each row execute function public.audit_row();

drop trigger if exists trg_excel_orders_updated on public.excel_orders;
create trigger trg_excel_orders_updated before update on public.excel_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_excel_orders_audit on public.excel_orders;
create trigger trg_excel_orders_audit after insert or update or delete on public.excel_orders for each row execute function public.audit_row();

drop trigger if exists trg_excel_order_lines_audit on public.excel_order_lines;
create trigger trg_excel_order_lines_audit after insert or update or delete on public.excel_order_lines for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 8. RLS (is_member sur company_id ; lignes via leur en-tête)
-- ---------------------------------------------------------------------
alter table public.part_orders       enable row level security;
alter table public.part_order_lines  enable row level security;
alter table public.excel_catalog     enable row level security;
alter table public.excel_orders      enable row level security;
alter table public.excel_order_lines enable row level security;

drop policy if exists part_orders_all on public.part_orders;
create policy part_orders_all on public.part_orders for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists part_order_lines_all on public.part_order_lines;
create policy part_order_lines_all on public.part_order_lines for all to authenticated
  using (exists (select 1 from public.part_orders o where o.id = order_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.part_orders o where o.id = order_id and public.is_member(o.company_id)));

drop policy if exists excel_catalog_all on public.excel_catalog;
create policy excel_catalog_all on public.excel_catalog for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists excel_orders_all on public.excel_orders;
create policy excel_orders_all on public.excel_orders for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists excel_order_lines_all on public.excel_order_lines;
create policy excel_order_lines_all on public.excel_order_lines for all to authenticated
  using (exists (select 1 from public.excel_orders o where o.id = excel_order_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.excel_orders o where o.id = excel_order_id and public.is_member(o.company_id)));

-- ---------------------------------------------------------------------
-- 9. Seuils paramétrables (reference_values / table_key = 'order_threshold')
--    Seedés pour les 2 sociétés. Modifiables via Paramètres → Tables.
-- ---------------------------------------------------------------------
insert into public.reference_values (company_id, table_key, code, label, sort_order, extra)
select c.id, d.table_key, d.code, d.label, d.sort_order, d.extra::jsonb
from public.companies c
cross join (values
  ('order_threshold','standard','Commande standard (journalière)',1,'{"min_ht":250,"surcharge_pct":0,"auto":false}'),
  ('order_threshold','urgente','Commande urgente',2,'{"min_ht":0,"surcharge_pct":10,"max_per_day":1}'),
  ('order_threshold','accident','Commande accident',3,'{"min_ht":1500,"fallback":"standard"}'),
  ('order_threshold','excel','Commande Excel',4,'{"min_ht_per_tab":2000,"tabs":["demo","courtoisie","showroom"]}')
) as d(table_key, code, label, sort_order, extra)
on conflict (company_id, table_key, code) do nothing;
