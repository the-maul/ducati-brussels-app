-- M2 — Pastille "disponibilité fournisseur" sur le catalogue Pièces & Accessoires.
-- (bin_location2 est ajouté par la migration 20260718090000, appliquée séparément.)
alter table public.articles
  add column if not exists supplier_availability text
  check (supplier_availability in ('green', 'yellow', 'red'));
