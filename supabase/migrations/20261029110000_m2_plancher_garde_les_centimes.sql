-- M2 — Correction : le plancher des petits prix garde les CENTIMES.
--
-- La migration 20261029090000 avait enregistré le mode « add » : on ajoutait le
-- minimum au prix, ce qui donnait 1,74 € → 3,74 €. Ce n'est pas la règle du
-- client, qui l'a précisée le 28/10/2026 : « en dessous de 2 €, on monte à 2 €
-- plus les centimes ». Donc 0,25 € → 2,25 € ET 1,74 € → 2,74 €.
--
-- La difference compte : « on ajoute » fait monter indefiniment, « on garde les
-- centimes » ramene tout le monde entre 2,00 et 2,99 €.
alter table public.companies drop constraint if exists companies_price_floor_mode_ck;

update public.companies set price_floor_mode = 'cents' where price_floor_mode = 'add';

alter table public.companies
  add constraint companies_price_floor_mode_ck
  check (price_floor_mode in ('min', 'cents'));

comment on column public.companies.price_floor_mode is
  'Traitement des prix de vente sous le seuil : min = remonte au minimum (0,25 -> 2,00), cents = on repart du minimum en gardant les centimes (0,25 -> 2,25 et 1,74 -> 2,74). Choix du client : cents.';
