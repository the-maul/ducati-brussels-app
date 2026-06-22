-- M2 — Lien vers le catalogue de pièces Ducati (e-catalog EPC) par article.
-- Le chemin d'arborescence Ducati (/parts/106/125/298/.../45968) est interne et non
-- dérivable de la référence : on stocke donc l'URL exacte sur la pièce. Le bouton de la
-- fiche article l'ouvre ; à défaut, il ouvre le catalogue pour une recherche manuelle.
alter table public.articles add column if not exists catalog_url text;

comment on column public.articles.catalog_url is 'URL e-catalog Ducati (EPC) de la pièce, ex. https://e-catalog.ducati.com/EPC/parts/.../...?lang=fr-FR';

notify pgrst, 'reload schema';
