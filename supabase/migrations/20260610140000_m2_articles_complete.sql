-- =====================================================================
-- M2 — Complément ARTICLES (parité fiche article G8)
-- Champs issus de docs/g8-reference-extract.md : descriptif, note, taille/couleur,
-- poids/unité, DEEE, PVHT, comptes compta, dates métier, référence d'origine,
-- mode de facturation kit, config reprise. + table multi-casier article_bins.
-- (Les champs calculés stock/marges ne sont PAS stockés — dérivés en M5.)
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'kit_billing_mode') then
    create type public.kit_billing_mode as enum ('forfait','nomenclature');
  end if;
end $$;

alter table public.articles
  add column if not exists descriptif                  text,
  add column if not exists show_descriptif_on_documents boolean not null default false,
  add column if not exists note                        text,
  add column if not exists size                        text,        -- Taille
  add column if not exists color                       text,        -- Couleur
  add column if not exists weight_volume_length        numeric(12,3),
  add column if not exists measure_unit                text,        -- unité (kg, L, cm…)
  add column if not exists eco_tax_ttc                 numeric(12,2) not null default 0,  -- DEEE / éco-participation
  add column if not exists deee                        boolean not null default false,
  add column if not exists sale_price_ht               numeric(12,2),  -- PVHT (en plus du TTC)
  add column if not exists sales_account               text,        -- compte vente
  add column if not exists purchase_account            text,        -- compte achat
  add column if not exists origin_reference_id         uuid references public.articles(id) on delete set null,
  add column if not exists last_sold_at                timestamptz,
  add column if not exists last_purchased_at           timestamptz,
  add column if not exists last_tariff_at              timestamptz,
  add column if not exists kit_billing_mode            public.kit_billing_mode,
  -- Config reprise (types R/P) : préfixe + rattachement des occasions générées (flux B3)
  add column if not exists reprise_prefix              text,
  add column if not exists reprise_category_id         uuid references public.article_categories(id) on delete set null,
  add column if not exists reprise_supplier_id         uuid references public.contacts(id) on delete set null;

-- Comptes comptables portés par la famille (rayon/sous-rayon/catégorie) + code numérique G8
alter table public.article_categories
  add column if not exists code           int,
  add column if not exists sales_account  text;

-- ---------------------------------------------------------------------
-- Multi-casier (B6) : un article peut occuper plusieurs emplacements.
-- La quantité par casier sera dérivée des mouvements (M5) ; ici on liste les emplacements.
-- `articles.bin_location` reste le casier principal (affichage POS).
-- ---------------------------------------------------------------------
create table if not exists public.article_bins (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid not null references public.articles(id) on delete cascade,
  bin_location text not null,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (article_id, bin_location)
);
create index if not exists idx_article_bins_article on public.article_bins(article_id);
create index if not exists idx_article_bins_loc on public.article_bins(bin_location);

alter table public.article_bins enable row level security;
drop policy if exists article_bins_all on public.article_bins;
create policy article_bins_all on public.article_bins for all to authenticated
  using (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)))
  with check (exists (select 1 from public.articles a where a.id = article_id and public.is_member(a.company_id)));
