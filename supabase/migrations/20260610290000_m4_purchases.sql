-- =====================================================================
-- M4 — ACHATS & RÉCEPTIONS (schéma) : commandes fournisseur (CMD), réceptions (REC),
-- lignes, échéancier fournisseur, + champs fournisseur sur contacts (n° client chez
-- le fournisseur, code interne magasin, RFA, franco/mini). G8 Réception p.R1-R6,
-- Fournisseurs M115-121. company_id + RLS + audit (B7). Numérotation CMD-/REC- (M0).
-- =====================================================================

-- En-tête document d'achat (commande ou réception).
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  doc_type      text not null default 'REC',            -- 'CMD' (commande) | 'REC' (réception)
  number        text,
  supplier_id   uuid references public.contacts(id) on delete set null,
  status        text not null default 'brouillon',       -- brouillon | validee | recue | annulee
  -- références facture/BL fournisseur
  supplier_invoice_no text,
  supplier_bl_no      text,
  intranet_no         text,                              -- N° intranet Ducati (DCS)
  invoice_date  date,
  bl_date       date,
  receipt_date  date default current_date,
  order_date    date,
  expected_date date,                                    -- date de livraison prévue (commande)
  -- régime TVA d'achat (G8 R6)
  vat_regime    text not null default 'with_vat',        -- with_vat | cee | outside_cee
  -- port & remise globale
  shipping_ht       numeric(14,2) not null default 0,
  shipping_taxed    boolean       not null default true,
  shipping_vat_rate numeric(6,2)  not null default 21,
  global_discount_pct numeric(6,2) not null default 0,
  -- totaux (HT calculé sur 3 décimales puis arrondi)
  total_ht      numeric(14,2) not null default 0,
  total_vat     numeric(14,2) not null default 0,
  total_ttc     numeric(14,2) not null default 0,
  source_order_id uuid references public.purchase_orders(id) on delete set null, -- réception ↔ commande (rapprochement)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_porders_company on public.purchase_orders(company_id, doc_type);
create index if not exists idx_porders_supplier on public.purchase_orders(supplier_id);
create index if not exists idx_porders_source on public.purchase_orders(source_order_id);

-- Lignes du document d'achat.
create table if not exists public.purchase_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.purchase_orders(id) on delete cascade,
  article_id    uuid references public.articles(id) on delete set null,
  designation   text not null,
  supplier_ref  text,
  quantity      numeric(14,3) not null default 1,
  unit_price_ht numeric(14,3) not null default 0,         -- PAHT de la réception (alimente le PAMP)
  discount_pct  numeric(6,2)  not null default 0,
  vat_rate      numeric(6,2)  not null default 21,
  sale_price_ttc numeric(14,2),                           -- PVTTC suggéré (mise à jour tarif possible)
  bin_location  text,                                     -- casier de rangement
  labels        int not null default 0,                   -- nombre d'étiquettes à éditer (B12)
  line_ht       numeric(14,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_plines_order on public.purchase_lines(order_id);
create index if not exists idx_plines_article on public.purchase_lines(article_id);

-- Échéancier de paiement fournisseur (G8 R6).
create table if not exists public.purchase_schedules (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete restrict,
  seq_no      int not null default 1,
  due_date    date,
  amount      numeric(14,2) not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pschedules_order on public.purchase_schedules(order_id);

-- Champs fournisseur sur les contacts (type fournisseur).
alter table public.contacts
  add column if not exists supplier_customer_no text,            -- n° de client chez le fournisseur (imprimé sur BC)
  add column if not exists supplier_is_internal boolean not null default false, -- code interne = magasin (MO, reprise)
  add column if not exists supplier_rfa_rate    numeric(6,2),    -- remise fin d'année %
  add column if not exists supplier_franco_min  numeric(14,2),   -- franco de port
  add column if not exists supplier_order_min   numeric(14,2);   -- minimum de commande

-- updated_at + audit
drop trigger if exists trg_porders_updated on public.purchase_orders;
create trigger trg_porders_updated before update on public.purchase_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_porders_audit on public.purchase_orders;
create trigger trg_porders_audit after insert or update or delete on public.purchase_orders for each row execute function public.audit_row();
drop trigger if exists trg_plines_audit on public.purchase_lines;
create trigger trg_plines_audit after insert or update or delete on public.purchase_lines for each row execute function public.audit_row();

-- RLS
alter table public.purchase_orders    enable row level security;
alter table public.purchase_lines     enable row level security;
alter table public.purchase_schedules enable row level security;

drop policy if exists porders_all on public.purchase_orders;
create policy porders_all on public.purchase_orders for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

drop policy if exists plines_all on public.purchase_lines;
create policy plines_all on public.purchase_lines for all to authenticated
  using (exists (select 1 from public.purchase_orders o where o.id = order_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.purchase_orders o where o.id = order_id and public.is_member(o.company_id)));

drop policy if exists pschedules_all on public.purchase_schedules;
create policy pschedules_all on public.purchase_schedules for all to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
