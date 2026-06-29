-- M3 — PDF du bulletin technique rapatrié dans le DMS (bucket ged).
-- Téléchargé par l'extension (session Ducati authentifiée) puis uploadé par l'app.
alter table public.vehicle_bulletins
  add column if not exists storage_path text;

comment on column public.vehicle_bulletins.storage_path is
  'Chemin du PDF du bulletin dans le bucket ged (rapatrié par l''extension). Ouvert via URL signée.';

notify pgrst, 'reload schema';
