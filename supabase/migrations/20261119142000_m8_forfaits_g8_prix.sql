-- =====================================================================
-- Rattrapage G8 (19/11/2026) — lot « forfaits G8 » : PRIX des articles de forfait (BLOC SEPARE).
-- Suppose appliquees : 20261119140000 (structure) et 20261119141000 (articles ITALBIKE STORE).
--
-- Source : vraie base G8 « DUCATI BRUXELLES » relue le 18/11 (17h35), liquides identiques a la base
-- de formation. Les pieces Ducati deja presentes (44440035A, 85250261A...) ne sont PAS ici : leur
-- prix vient du tarif Ducati. Chaque changement passe par trace_price_change -> price_changes
-- (origine import:g8_vraie_base) : jamais d'UPDATE silencieux. Rejouable (prix identique = rien).
-- Pour corriger un prix : nouvelle migration avec le meme appel et la ligne corrigee.
-- Copie de G8_PRICES (src/modules/workshop/forfaits/g8-catalog.ts), verifiee par test.
-- =====================================================================
do $$
declare co constant uuid := '3d9f0f13-a691-4d07-ad58-34590df86e33';
begin
  if not exists (select 1 from public.companies where id = co) then return; end if;
  raise notice 'prix G8 : %', public._g8_prices_apply(co, '[
    {"reference": "CONTRI", "ht": 3.22, "ttc": 3.90},
    {"reference": "PETITES FOURNITURES", "ht": 10.56, "ttc": 12.78},
    {"reference": "APPAREIL DE DIAGNOTI", "ht": 26.86, "ttc": 32.50},
    {"reference": "PRISE EN CHARGE", "ht": 7.26, "ttc": 8.78},
    {"reference": "PRODUITS NETTOYAGE MOT", "ht": 12.07, "ttc": 14.60},
    {"reference": "CHAIN CLEANER", "ht": 22.48, "ttc": 27.20},
    {"reference": "MOTO 4XT TECH EN FUT", "ht": 13.06, "ttc": 15.80},
    {"reference": "MOTO 4 ROAD 15W50", "ht": 15.04, "ttc": 18.20},
    {"reference": "HUILE DE FREIN DOT 5", "ht": 8.43, "ttc": 10.20},
    {"reference": "HUILE DE FOURCHE ELF", "ht": 8.51, "ttc": 10.30},
    {"reference": "COOLELF CLASSIC -26°", "ht": 4.88, "ttc": 5.90},
    {"reference": "FILTRE A HUILE 1199", "ht": 22.34, "ttc": 27.03}
  ]'::jsonb, 'import:g8_vraie_base', false);
end $$;
