-- =====================================================================
-- M8 — ATELIER : Ordres de réparation (OR). Cycle B8 (réception → travaux →
-- facture) + garantie B10 (acceptation / refus total / refus partiel ligne par ligne).
-- En-tête (client + VIN + km + opérateur + type réparation + travaux + observations),
-- lignes pièces/MO/texte avec garantie par ligne. Transformation en facture via M6
-- (le stock réel est débité à la facturation, jamais d'UPDATE direct — B7).
-- company_id + RLS + audit. Numérotation OR- (M0).
-- =====================================================================

create table if not exists public.repair_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  number        text,
  contact_id    uuid references public.contacts(id) on delete set null,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  mileage       int,
  operator      text,                                  -- opérateur réceptionnaire / réparateur
  repair_type   text,                                  -- code atelier / type de réparation
  work_description text,                                -- travaux demandés (texte libre)
  reception_notes  text,                                -- observations à la réception (anti-litige)
  status        text not null default 'a_faire',        -- a_faire | en_cours | pret | facture | annule
  warranty_status text not null default 'aucune',       -- aucune | en_attente | accepte | refus_total | refus_partiel
  expert_name   text,                                   -- OR accident (léger)
  expert_date   date,
  price_mode    text not null default 'ttc',
  total_ht      numeric(14,2) not null default 0,
  total_vat     numeric(14,2) not null default 0,
  total_ttc     numeric(14,2) not null default 0,
  invoice_document_id uuid references public.documents(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ro_company on public.repair_orders(company_id, status);
create index if not exists idx_ro_vehicle on public.repair_orders(vehicle_id);
create index if not exists idx_ro_contact on public.repair_orders(contact_id);

create table if not exists public.repair_order_lines (
  id            uuid primary key default gen_random_uuid(),
  or_id         uuid not null references public.repair_orders(id) on delete cascade,
  kind          text not null default 'piece',          -- piece | mo | texte
  article_id    uuid references public.articles(id) on delete set null,
  designation   text not null,
  quantity      numeric(14,3) not null default 1,
  unit_price_ht numeric(14,3) not null default 0,
  vat_rate      numeric(6,2)  not null default 21,
  discount_pct  numeric(6,2)  not null default 0,
  is_warranty   boolean       not null default false,    -- pièce prise en charge garantie (prix 0, lettre G)
  line_ht       numeric(14,2) not null default 0,
  line_ttc      numeric(14,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rolines_or on public.repair_order_lines(or_id);

drop trigger if exists trg_ro_updated on public.repair_orders;
create trigger trg_ro_updated before update on public.repair_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_ro_audit on public.repair_orders;
create trigger trg_ro_audit after insert or update or delete on public.repair_orders for each row execute function public.audit_row();
drop trigger if exists trg_rolines_audit on public.repair_order_lines;
create trigger trg_rolines_audit after insert or update or delete on public.repair_order_lines for each row execute function public.audit_row();

alter table public.repair_orders      enable row level security;
alter table public.repair_order_lines enable row level security;
drop policy if exists ro_all on public.repair_orders;
create policy ro_all on public.repair_orders for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists rolines_all on public.repair_order_lines;
create policy rolines_all on public.repair_order_lines for all to authenticated
  using (exists (select 1 from public.repair_orders o where o.id = or_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.repair_orders o where o.id = or_id and public.is_member(o.company_id)));
