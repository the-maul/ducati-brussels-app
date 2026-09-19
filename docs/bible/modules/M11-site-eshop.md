---
chapitre: M11
titre: Site & e-shop
etat: supprimé
verifie_le: 2026-09-18
missions: []
mots_cles: [site, vitrine, e-shop, boutique, constructeur de site, commande web, Stripe, publiable, Shopify, synchronisation, supprimé]
---

# M11 — Site & e-shop

> **En une phrase** : **module supprimé le 18/09/2026** — le site public de la concession est Shopify ; il ne reste dans le DMS que l'indicateur « publiable » des articles, gardé pour la future synchronisation avec Shopify.

## 1. À quoi ça sert

Plus à rien dans le DMS. Sur décision du client du 18/09 ([W-1](../decisions.md)), le site public et
la boutique en ligne sont sur **Shopify**. Le constructeur de site, la vitrine `/shop/{slug}`, les
commandes web et le paiement Stripe de ces commandes ont été retirés du code (branche
`lot-nettoyage`) et une migration de suppression des objets en base est écrite, **pas encore appliquée**.

La suite prévue est une autre mission : **synchroniser Shopify avec le stock du DMS** par API
([W-2](../decisions.md)) — voir les produits en ligne, les lier au stock en direct, en ajouter ou en
retirer ; un produit publié est toujours lié à un article du stock.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Fiche article → case **« Publiable e-shop »** (M2) | Marquer un article comme destiné à la vente en ligne. N'a plus d'effet dans le DMS ; donnée conservée pour la synchronisation Shopify. |
| Ventes → filtre **Département** (Magasin / E-shop) (M6) | Inchangé. Repose sur `documents.imported_from` ; aucune vente ne correspond à « E-shop » aujourd'hui. Pourra servir aux ventes venues de Shopify. |

Retiré le 18/09 : l'entrée de menu **E-shop** (`/eshop` : onglets Site, Produits, Commandes) et la
vitrine publique **`/shop/{slug}`** (panier, commande, redirection Stripe).

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Ce qui reste | `articles.publishable` (colonne, M2), case dans `src/modules/articles/article-form.tsx`, libellé `articles.publishable` de `src/lib/i18n/fr.ts` ; filtre Département de `src/routes/_app.sales.index.tsx` (`isEshopDoc`) |
| Migration de suppression (non appliquée) | `supabase/migrations/20260919130000_cleanup_remove_eshop_improvements.sql` |
| Code supprimé (pour mémoire, dans l'historique git) | `src/routes/_app.eshop.tsx`, `src/routes/shop.$slug.tsx`, `src/modules/web/` (`eshop-api.ts`, `site-builder.tsx`, `site-renderer.tsx`, `site-types.ts`, `checkout.ts`), `supabase/functions/stripe-checkout`, `supabase/functions/stripe-webhook`, bloc `eshop` et clé `nav.eshop` de `fr.ts`, entrées `stripe-*` de `supabase/config.toml` |
| Objets en base supprimés par la migration | tables `shop_settings`, `web_orders`, `web_order_lines` ; fonctions `shop_public_info`, `shop_public_site`, `shop_public_catalog`, `place_web_order`, `web_order_public_status`, `finalize_web_order`, `trg_enqueue_order_confirm` (et le déclencheur `trg_weborders_confirm`) ; politiques Storage `ged_public_products`, `shopassets_write`, `shopassets_update`, `shopassets_delete` |
| Objets gardés | bucket public `shop-assets` : il héberge le **logo société** (`branding/ducati-bxl-logo.png`, lu par `companies.logo_url` sur les factures) ; `_next_document_number_unchecked` (utilisé par `next_document_number`, M0) |

## 4. Règles métier et décisions

- **W-1 (18/09)** : le site public est Shopify ; constructeur de site et e-shop du DMS supprimés.
- **W-2 (18/09)** : piste validée, synchroniser Shopify avec le stock du DMS (future mission).
- `articles.publishable` est gardé comme **donnée métier** (« cet article doit être en ligne »), point de départ naturel de la synchronisation. Tout le reste (réglages de boutique, contenu du site, commandes web) n'avait pas de valeur pour Shopify : supprimé.
- Paiement Stripe : les deux fonctions serveur ne servaient qu'aux commandes web, elles sont retirées. Le **QR Stripe au comptoir** (décision P-2 du 30/07) reste prévu et se fera avec une fonction neuve, propre à la caisse.

## 5. État en production

Vérifié le 18/09/2026 dans la base (lecture seule).

- 🟡 **Migration de suppression écrite, pas appliquée** : tant qu'elle ne l'est pas, les tables, les 6 RPC (dont `place_web_order` et `finalize_web_order`, exécutables par `anon`) et les fonctions Edge `stripe-checkout` / `stripe-webhook` existent toujours en production. Les failles décrites au scan du 18/09 (commande « payée » sans paiement, commande de n'importe quel article) **restent ouvertes jusqu'à l'application**.
- Volumes supprimés par la migration : 1 réglage de boutique (0 publiée), 0 commande web, 0 ligne de commande, 0 mouvement de stock d'origine `eshop`, 0 notification de confirmation.
- Conservé : 17 articles marqués publiables ; 12 lignes du journal `events` sur `web_orders` (audit append-only).
- Bucket `shop-assets` : 6 objets, dont le logo société (à garder) et 5 images du constructeur de site (supprimables à la main).

## 6. Prévu / en cours

- **Intégrateur** : appliquer la migration `20260919130000` (avec backup), puis supprimer du projet Supabase les fonctions Edge `stripe-checkout` et `stripe-webhook`, le webhook correspondant côté tableau de bord Stripe, et régénérer `src/integrations/supabase/types.ts`.
- Mission 03 en cours : synchronisation Shopify ↔ stock DMS (W-2). Premier lot fait le 19/09 : **Produits Shopify** (lecture de la boutique et rapprochement avec les articles), documenté dans [M02](M02-articles.md). Deuxième lot le 19/09 : **reprise unique des photos et textes** des produits reliés dans les fiches articles (W-4 : le DMS fait foi ensuite) — champs `articles.web_title` / `web_description` et photos en GED, base de la future publication vers Shopify.

## 7. Limites connues, dettes, pièges

- `src/integrations/supabase/types.ts` décrit encore les tables et RPC supprimées tant qu'il n'est pas régénéré après application.
- Le logo société vit dans un bucket nommé `shop-assets` : ne pas supprimer ce bucket.
- La case s'appelle toujours « Publiable e-shop » ; à renommer quand la synchronisation Shopify sera cadrée.
- Le filtre Département des ventes repose sur une heuristique (`imported_from` contient eshop/web/shopify) ; une colonne `channel` explicite sera plus fiable pour les ventes Shopify.

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| SIW000–SIW008 | Site web et e-commerce | hors DMS | assurés par Shopify (décision W-1 du 18/09) |
| INV010 | Stock e-shop = stock magasin | ⬜ à refaire | future synchronisation Shopify (W-2) ; base : `articles.publishable` |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | E-shop : catalogue sur stock unifié, photos, publication par article | `837b2f9` |
| 2026-06-11 | Réglages boutique, panier, commande web qui réserve le stock | `659879d`, migration `20260610430000` |
| 2026-06-11 | Vitrine publique `/shop/{slug}`, domaine personnalisé, Stripe Checkout | `0ee7390`, migration `20260610440000` |
| 2026-06-11 | Constructeur de site multi-pages, 14 blocs, images | `c2e04c1`, `3ff41ec`, `410f6f4`, migrations `20260610450000`, `20260610460000` |
| 2026-06-12 | Webhook Stripe signé + finalisation (facture, stock, règlement) ; confirmation au retour | `e636dbf`, `8f120db`, migrations `20260612100000`, `20260612110000` |
| 2026-06-12 | Bloc Atouts : sélecteur d'icônes | `673be91` |
| 2026-09-11 | Correctifs de typage des appels RPC | `7d31b6d` |
| 2026-09-18 | **Module supprimé** (décision W-1) : écrans, code, fonctions Stripe, libellés ; migration de suppression écrite, non appliquée ; `articles.publishable` conservé | branche `lot-nettoyage`, migration `20260919130000` (non appliquée) |
