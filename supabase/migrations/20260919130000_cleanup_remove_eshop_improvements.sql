-- =====================================================================
-- Nettoyage — suppression de l'e-shop / constructeur de site (M11) et de la
-- page « Améliorations » (M0). Décisions client du 18/09/2026 : W-1 (le site
-- public est Shopify) et W-3 (la planification se fait ailleurs).
--
-- MIGRATION NON APPLIQUÉE : à appliquer à la main par l'intégrateur, avec backup.
--
-- Volumes comptés en lecture seule sur la production (ujmrosbgkvgvwfnuryna)
-- le 18/09/2026 :
--   shop_settings ........................ 1 ligne (0 boutique publiée)
--   web_orders ........................... 0 ligne
--   web_order_lines ...................... 0 ligne
--   improvements ......................... 3 lignes
--   improvement_points ................... 1 ligne
--   attachments (entity_type='improvement') 3 lignes (fichiers dans le bucket `ged`)
--   stock_moves origin 'eshop' ........... 0 ligne (rien à défaire)
--   notifications 'order_confirm' ........ 0 ligne
--   articles publiables .................. 17 (colonne CONSERVÉE, voir plus bas)
--   events web_orders / improvements ..... 12 / 29 lignes (CONSERVÉES : journal d'audit append-only, B7)
--   bucket shop-assets ................... 6 objets (bucket CONSERVÉ : il héberge le logo
--                                          société `branding/ducati-bxl-logo.png` utilisé par
--                                          companies.logo_url sur les factures)
--
-- Vérifié en base avant écriture : aucun autre objet (fonction, vue, déclencheur,
-- clé étrangère, tâche cron) ne dépend des tables supprimées, en dehors des objets
-- de l'e-shop / des améliorations eux-mêmes listés ci-dessous.
--
-- CONSERVÉ volontairement :
--   - articles.publishable : donnée métier « article à mettre en ligne », utile à la
--     future synchronisation Shopify (décision W-2) ; case toujours sur la fiche article.
--   - _next_document_number_unchecked : utilisé par next_document_number (M0).
--   - bucket shop-assets et sa lecture publique (logo société).
--
-- Après application : supprimer du bucket `ged` les 3 fichiers sous
-- <company_id>/improvement/ (le SQL ne supprime pas les fichiers de Storage),
-- et éventuellement les 5 images du site sous shop-assets/<company_id>/.
-- =====================================================================

-- 1. Fonctions SQL propres à l'e-shop (vitrine publique, commande, paiement, confirmation)
drop function if exists public.finalize_web_order(uuid, text);
drop function if exists public.place_web_order(text, text, text, text, text, jsonb);
drop function if exists public.web_order_public_status(uuid);
drop function if exists public.shop_public_catalog(text);
drop function if exists public.shop_public_site(text);
drop function if exists public.shop_public_info(text);

-- Déclencheur de confirmation de commande web (M10, file notifications)
drop trigger if exists trg_weborders_confirm on public.web_orders;
drop function if exists public.trg_enqueue_order_confirm();

-- 2. Tables de l'e-shop (leurs déclencheurs et politiques RLS partent avec elles)
drop table if exists public.web_order_lines;
drop table if exists public.web_orders;
drop table if exists public.shop_settings;

-- 3. Politiques Storage propres à l'e-shop
--    Lecture anonyme des photos des articles publiables (vitrine publique)
drop policy if exists ged_public_products on storage.objects;
--    Écriture des images du constructeur de site (le bucket reste, en lecture publique)
drop policy if exists shopassets_write on storage.objects;
drop policy if exists shopassets_update on storage.objects;
drop policy if exists shopassets_delete on storage.objects;

-- 4. Améliorations : pièces jointes GED (lignes seulement), puis tables
delete from public.attachments where entity_type = 'improvement';

drop table if exists public.improvement_points;
drop table if exists public.improvements;

notify pgrst, 'reload schema';
