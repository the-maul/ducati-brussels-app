-- =====================================================================
-- M11 — E-shop transactionnel : réglages boutique (avec slug pour l'URL publique)
-- + commandes web (stock unifié). Le storefront public (accès anonyme) et le
-- paiement Stripe seront branchés ensuite. company_id + RLS + audit.
-- =====================================================================

create table if not exists public.shop_settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  name        text,
  slug        text unique,                         -- segment d'URL publique (ex. 'ducati-bruxelles')
  description text,
  hero_text   text,
  theme_color text default '#cc0000',
  phone       text,
  email       text,
  address     text,
  published   boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table if not exists public.web_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  number        text,
  customer_name text,
  email         text,
  phone         text,
  address       text,
  status        text not null default 'panier',     -- panier | en_attente_paiement | payee | preparee | expediee | annulee
  total_ttc     numeric(14,2) not null default 0,
  document_id   uuid references public.documents(id) on delete set null, -- facture liée une fois payée
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_weborders_company on public.web_orders(company_id, status);

create table if not exists public.web_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.web_orders(id) on delete cascade,
  article_id    uuid references public.articles(id) on delete set null,
  designation   text not null,
  quantity      numeric(14,3) not null default 1,
  unit_price_ttc numeric(14,2) not null default 0,
  line_ttc      numeric(14,2) not null default 0
);
create index if not exists idx_weborderlines_order on public.web_order_lines(order_id);

drop trigger if exists trg_shopsettings_updated on public.shop_settings;
create trigger trg_shopsettings_updated before update on public.shop_settings for each row execute function public.set_updated_at();
drop trigger if exists trg_weborders_updated on public.web_orders;
create trigger trg_weborders_updated before update on public.web_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_weborders_audit on public.web_orders;
create trigger trg_weborders_audit after insert or update or delete on public.web_orders for each row execute function public.audit_row();

alter table public.shop_settings    enable row level security;
alter table public.web_orders       enable row level security;
alter table public.web_order_lines  enable row level security;
drop policy if exists shopsettings_all on public.shop_settings;
create policy shopsettings_all on public.shop_settings for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists weborders_all on public.web_orders;
create policy weborders_all on public.web_orders for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
drop policy if exists weborderlines_all on public.web_order_lines;
create policy weborderlines_all on public.web_order_lines for all to authenticated
  using (exists (select 1 from public.web_orders o where o.id = order_id and public.is_member(o.company_id)))
  with check (exists (select 1 from public.web_orders o where o.id = order_id and public.is_member(o.company_id)));

-- Réglages boutique seedés pour les sociétés existantes (slug = code société).
insert into public.shop_settings (company_id, name, slug)
select c.id, c.name, lower(c.code) from public.companies c
on conflict (company_id) do nothing;
