-- M1/M14 — Lien profond vers la fiche client du portail concessionnaire Ducati.
-- Renseigné manuellement (copier l'URL de la fiche) ou en masse via l'API Ducati.
-- Aucune donnée sensible : c'est juste l'URL publique-portail de la fiche (route par ID Salesforce).
alter table public.contacts add column if not exists ducati_url text;
comment on column public.contacts.ducati_url is
  'URL de la fiche client sur le portail Ducati (deep-link, ex. https://ducati.my.site.com/dealer/s/account/<id>/<slug>).';
