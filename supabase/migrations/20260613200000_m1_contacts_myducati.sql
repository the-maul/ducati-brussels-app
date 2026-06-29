-- M1 — Section « Infos My Ducati » de la fiche contact.
-- Remplie via l'extension navigateur (lecture de la page My Ducati de la moto liée, par VIN,
-- en réutilisant la session loggée de l'utilisateur — aucun identifiant Ducati stocké côté serveur).
-- `my_ducati_data` garde la charge brute (extensible) ; les champs nommés sont les clés utiles.
alter table public.contacts
  add column if not exists ducati_code          text,           -- code client Ducati (My Ducati)
  add column if not exists my_ducati_email      text,           -- e-mail du compte My Ducati
  add column if not exists my_ducati_first_name text,           -- prénom du compte My Ducati
  add column if not exists my_ducati_last_name  text,           -- nom du compte My Ducati
  add column if not exists my_ducati_synced_at  timestamptz,    -- dernière synchro depuis My Ducati
  add column if not exists my_ducati_data       jsonb;          -- charge brute scrappée (extensible)

notify pgrst, 'reload schema';
