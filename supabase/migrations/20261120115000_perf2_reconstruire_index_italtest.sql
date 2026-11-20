-- =====================================================================
-- Perf 2 (20/11/2026) -- Table de correspondance de la copie ItalTest : index reconstruits.
--
-- Mesure (prod, 20/11) : test_company_id_map = 127 Mo pour 53 309 lignes (19 Mo de table,
-- 108 Mo d'index). Les copies / rafraichissements successifs d'ItalTest y ont insere 1,6 million
-- de lignes et en ont supprime 959 000 : les deux index sont gonfles de pages vides.
-- Essai (transaction annulee) : apres reconstruction, 108 Mo -> 10 Mo d'index, en 0,7 s.
-- Aucune donnee touchee : REINDEX reconstruit les memes index a l'identique.
-- Le reste (19 Mo de table pour ~5 Mo utiles) ne se recupere qu'avec VACUUM FULL, qui ne peut
-- pas tourner dans une migration : a lancer seul, a un moment calme (voir docs/bible, M00).
-- =====================================================================

set local lock_timeout = '10s';
reindex table public.test_company_id_map;
