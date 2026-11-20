-- =====================================================================
-- Correctif lot-verif-parcours (20/11/2026) — parcours G8 n° 1 « Créer un client particulier ».
--
-- QUOI : ajoute le nom NEERLANDAIS des localites de la Region de Bruxelles-Capitale a la table
--        des codes postaux (be_postal_codes) : 1000 Brussel, 1050 Elsene, 1180 Ukkel…
-- POURQUOI : dans G8, le CP 1000 ouvre la fenetre « Recherche ville » avec 2 villes
--        (BRUSSEL / BRUXELLES) ; la table du DMS (bpost 2020) n'a que le nom francais pour les
--        19 communes bruxelloises (les communes flamandes / wallonnes ont deja leur nom officiel).
--        Un client neerlandophone de la concession (Bruxelles) ne pouvait donc pas avoir
--        « Brussel » propose a la saisie du CP. L'ecran (zip-city-suggest.tsx) liste deja toutes
--        les villes d'un CP : aucune modification de code.
-- Donnee de reference seule (pas de company_id : table commune, lecture pour tous, ecriture
-- revoquee — migration 20260919264000). Idempotente (on conflict do nothing), aucune ligne
-- existante modifiee. Essai : supabase/tests/parcours_g8_01_client_particulier.sql.
-- =====================================================================
insert into public.be_postal_codes (code, city, province) values
  ('1000', 'Brussel', 'Bruxelles-Capitale'),
  ('1020', 'Laken', 'Bruxelles-Capitale'),
  ('1030', 'Schaarbeek', 'Bruxelles-Capitale'),
  ('1050', 'Elsene', 'Bruxelles-Capitale'),
  ('1060', 'Sint-Gillis', 'Bruxelles-Capitale'),
  ('1080', 'Sint-Jans-Molenbeek', 'Bruxelles-Capitale'),
  ('1082', 'Sint-Agatha-Berchem', 'Bruxelles-Capitale'),
  ('1150', 'Sint-Pieters-Woluwe', 'Bruxelles-Capitale'),
  ('1160', 'Oudergem', 'Bruxelles-Capitale'),
  ('1170', 'Watermaal-Bosvoorde', 'Bruxelles-Capitale'),
  ('1180', 'Ukkel', 'Bruxelles-Capitale'),
  ('1190', 'Vorst', 'Bruxelles-Capitale'),
  ('1200', 'Sint-Lambrechts-Woluwe', 'Bruxelles-Capitale'),
  ('1210', 'Sint-Joost-ten-Node', 'Bruxelles-Capitale')
on conflict (code, city) do nothing;
