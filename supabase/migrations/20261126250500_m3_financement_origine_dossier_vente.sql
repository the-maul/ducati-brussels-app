-- M3 (26/11/2026) : un financement repris d'un dossier de vente (archive 2020-2025) porte l'origine
-- « dossier_vente ». Déjà appliqué en base avec la reprise des dossiers (données client gardées hors
-- du dépôt) ; ce fichier garde seulement le changement de structure. Rejouable.
alter table public.vehicle_financings drop constraint if exists vehicle_financings_origin_check;
alter table public.vehicle_financings add constraint vehicle_financings_origin_check
  check (origin = any (array['facture_g8'::text, 'fiche_moto'::text, 'dossier_vente'::text]));
