-- M2 — Localisation 2 (second emplacement de rangement) + reprises de données :
-- marque « Ducati » pour les articles sans marque, réf. fournisseur = référence
-- principale quand elle est vide (défaut demandé par le magasin).

alter table public.articles add column if not exists bin_location2 text;

update public.articles set brand = 'Ducati'
  where coalesce(trim(brand), '') = '';

update public.articles set supplier_ref = reference
  where coalesce(trim(supplier_ref), '') = '';

notify pgrst, 'reload schema';
