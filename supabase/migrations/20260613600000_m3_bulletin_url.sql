-- M3 — Lien du bulletin technique (capté par l'extension My Ducati).
-- Permet d'ouvrir le bulletin (page portail Ducati ou PDF) depuis la fiche moto.
alter table public.vehicle_bulletins
  add column if not exists url text;

comment on column public.vehicle_bulletins.url is
  'Lien vers le bulletin sur le portail Ducati (ou PDF), capté par l''extension.';

notify pgrst, 'reload schema';
