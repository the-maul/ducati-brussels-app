-- =====================================================================
-- M1 — Sous-objets de la fiche client (parité G8)
-- Adresses de livraison multiples + tarifs client à paliers.
-- (Onglet Parc = jointure vehicle_owners↔vehicles, pas de table dédiée.)
-- =====================================================================

-- Adresses de livraison
create table if not exists public.delivery_addresses (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  label       text,                     -- ex. "Dépôt", "Domicile"
  recipient   text,
  address     text,
  address_complement text,
  zip         text,
  city        text,
  country     text not null default 'BE',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_deliv_contact on public.delivery_addresses(contact_id);

-- Tarifs client à paliers (CRM009) : remise/prix net/coefficient ciblant fournisseur/
-- rayon/sous-rayon/catégorie/référence, 3 paliers de quantité, dates, promotion.
create table if not exists public.client_price_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  -- cible
  target_type  text not null default 'all',  -- 'all'|'brand'|'category'|'reference'|'supplier'
  target_value text,
  -- mode de prix : remise % | prix net | coefficient
  mode         text not null default 'discount',  -- 'discount'|'net'|'coef'
  value1       numeric(12,4),            -- palier 1 (qté min 1)
  qty2         numeric(12,3),            -- seuil palier 2
  value2       numeric(12,4),
  qty3         numeric(12,3),            -- seuil palier 3
  value3       numeric(12,4),
  is_promo     boolean not null default false,
  date_from    date,
  date_to      date,
  created_at   timestamptz not null default now()
);
create index if not exists idx_cpr_contact on public.client_price_rules(contact_id);
create index if not exists idx_cpr_company on public.client_price_rules(company_id);

-- RLS
alter table public.delivery_addresses enable row level security;
alter table public.client_price_rules enable row level security;

drop policy if exists deliv_all on public.delivery_addresses;
create policy deliv_all on public.delivery_addresses for all to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id and public.is_member(c.company_id)))
  with check (exists (select 1 from public.contacts c where c.id = contact_id and public.is_member(c.company_id)));

drop policy if exists cpr_select on public.client_price_rules;
create policy cpr_select on public.client_price_rules for select to authenticated using (public.is_member(company_id));
drop policy if exists cpr_write on public.client_price_rules;
create policy cpr_write on public.client_price_rules for all to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
