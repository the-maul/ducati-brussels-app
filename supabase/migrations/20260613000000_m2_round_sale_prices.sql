-- M2 — Politique d'arrondi des prix de vente (par société).
-- Quand activé (défaut), les prix de vente calculés sont arrondis à l'euro SUPÉRIEUR,
-- avec un plancher à 2 € (tout PV < 2 € → 2 €, ex. 9,2 → 10). Décochable pour un
-- montant précis. Appliqué au PV TTC dans le moteur de tarification (article-form).
alter table public.companies
  add column if not exists round_sale_prices_up boolean not null default true;

comment on column public.companies.round_sale_prices_up is
  'Arrondir les prix de vente calculés à l''euro supérieur (plancher 2 €). Décocher pour des prix précis.';

notify pgrst, 'reload schema';
