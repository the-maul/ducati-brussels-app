-- =====================================================================
-- M8 — Parcours mecanicien, lot 0 (19/11/2026) : les figures du mode operatoire s'affichent.
--
-- Les 13 196 figures des manuels d'atelier sont dans le bucket prive « wsm-images »
-- (tools/wsm-loader/images.mjs, mission 07 carte 3), mais AUCUNE regle de lecture n'existe sur
-- storage.objects pour ce bucket : un compte de l'equipe ne peut donc pas demander d'adresse
-- signee (createSignedUrl(s) exige le droit SELECT sur l'objet). Le parcours technicien lisait en
-- plus les figures sur « /manuels/ » (copie locale de developpement), absente en production.
--
-- Cette migration pose la lecture, comme pour les tables wsm_* (decision M-26) : tout compte de
-- l'equipe (au moins un role dans une societe, `ducati_catalog_is_staff`). Les comptes clients
-- (espace client) n'y ont pas acces. Aucune ecriture : l'envoi reste reserve au chargeur
-- (cle service). Donnees globales (manuels Ducati), pas de company_id : meme regle que wsm_*.
--
-- Additive, rejouable. Ne modifie aucune donnee. Essai a blanc : supabase/tests/m8_pointage_pause_reprise.sql
-- (controle « lot 0 »).
-- =====================================================================

drop policy if exists wsm_images_read on storage.objects;
create policy wsm_images_read on storage.objects for select to authenticated
  using (bucket_id = 'wsm-images' and (select public.ducati_catalog_is_staff()));
