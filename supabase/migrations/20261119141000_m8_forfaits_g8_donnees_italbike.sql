-- =====================================================================
-- Rattrapage G8 (19/11/2026) — lot « forfaits G8 » : DONNEES pour ITALBIKE STORE.
-- Suppose appliquee : 20261119140000_m8_forfaits_g8_structure.sql.
--
-- 1. Articles forfait G8 manquants (crees a 0 € ; ceux qui existent deja — CHAIN CLEANER,
--    COOLELF CLASSIC -26°, MOTO 4 ROAD 15W50, MO — sont reutilises, jamais modifies).
-- 2. Les 37 forfaits G8 (article N « nomenclature » + composants pointant vers les articles de la
--    societe ; reference absente = listee dans events, action g8_forfaits_install, cle missing).
-- 3. Reglages des kits : liquide -> article (unite de vente), profils moteur (quantite d'huile,
--    filtre et joint des forfaits G8), lignes ajoutees par defaut a chaque kit.
-- 4. Rattrapage des 1 103 kits existants : kits vides de vidange remplis (huile + filtre + joint),
--    liquides rattaches (quantite convertie, ou reprise du forfait G8), filtre introuvable pris du
--    forfait G8, lignes standard ajoutees. Chaque kit change prend une nouvelle version
--    (maintenance_kit_versions, motif « rattrapage G8 ») ; une trace events par lot de 200 kits.
-- Rejouable : rien n'est recree ni double (lignes deja presentes ignorees).
-- Prix : 20261119142000 (bloc separe). Rien d'autre que ITALBIKE STORE.
-- =====================================================================
do $$
declare
  co constant uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
  r jsonb; off int := 0; total_changed int := 0;
begin
  if not exists (select 1 from public.companies where id = co) then
    raise notice 'Societe ITALBIKE STORE absente : rien a faire.';
    return;
  end if;
  raise notice 'articles : %', public._g8_service_articles_install(co);
  raise notice 'forfaits : %', public._g8_forfaits_install(co);
  raise notice 'reglages : %', public._g8_kit_settings_install(co);
  loop
    r := public.maintenance_kits_complete(co, true, 200, off);
    total_changed := total_changed + (r ->> 'kits_changed')::int;
    off := (r ->> 'next_offset')::int;
    exit when (r ->> 'done')::boolean;
  end loop;
  raise notice 'kits completes : % sur %', total_changed, off;
end $$;
