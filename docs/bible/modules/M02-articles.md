---
chapitre: M02
titre: Articles & tarifs
etat: 🟦
verifie_le: 2026-09-18
missions: [03]
mots_cles: [Shopify, rapprochement, SKU, article, pièce, accessoire, référence, type de gestion, PAMP, PA, PV, coefficient, tarif, import tarif, Ducati, PPC, librairie, casier, localisation, code-barres, étiquette, famille, rayon, remplacement, équivalence, kit, forfait, applicabilité, cascade]
---

# M02 — Articles & tarifs

> **En une phrase** : le catalogue de tout ce que la concession achète, stocke ou vend (pièces, accessoires, vêtements, main-d'œuvre, motos), avec ses prix et son type de gestion hérité de G8.

## 1. À quoi ça sert
Le magasinier et le vendeur y créent et tiennent à jour les fiches articles : référence, désignation,
famille (Rayon > Sous-rayon > Catégorie), fournisseur, localisation en magasin, prix d'achat, prix de vente.
Chaque article porte un **type de gestion** (A, M, F, N, V, O, P, D, R, T) qui décide s'il est stocké, s'il est
une moto, une occasion en TVA marge, etc. Le module importe aussi les **tarifs fournisseurs** (Ducati en tête)
avec des règles automatiques de mise à jour des prix, et imprime les **étiquettes**.
C'est l'objet « ARTICLE » partagé par l'achat (M4), le stock (M5), la vente (M6), l'atelier (M8) et la reprise (M7).

## 2. Ce qu'on a aujourd'hui

Menu latéral : **Pièces & Accessoires** (`/parts`).

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Pièces & Accessoires → liste (`/parts`) | Recherche multicritère (réf., désignation, réf. fournisseur, marque, année du modèle), filtres fournisseur / rayon / stock ; colonnes stock réel, réservé, disponible, localisations 1 et 2, disponibilité fournisseur, PV TTC arrondi ; badge « remplacée par » ; boutons **Proposer à la commande** (envoie vers la proposition de commande M4) et **Dupliquer** (nouvelle réf. `-COPIE`, stock à zéro). Colonnes « en proposition » et « en commande » **affichées mais vides** (TODO dans le code). |
| Pièces & Accessoires → Nouvel article (`/parts/new`) | Fiche complète : identification, type de gestion, familles en cascade, fournisseur, marque (Ducati par défaut, marques partenaires), taille/couleur, années Du/Au, localisations 1 et 2, conditionnement, mini/maxi, PA / coefficient / PV HT / PV TTC / TVA avec recalcul croisé, PPC, verrous de prix, marge en % et en €, DEEE/éco-taxe, comptes comptables, lien catalogue Ducati, case « publiable e-shop », « librairie ». La référence devient automatiquement le premier code-barres. |
| Pièces & Accessoires → fiche (`/parts/$articleId`) | Même formulaire + onglets : **Stock** (triple stock, mouvements filtrables par sens/type/date, saisie d'un mouvement manuel), **Codes-barres** (plusieurs par article), **Kit / nomenclature** (composants d'un forfait), **Remplacement / équivalences** (réf. de remplacement avec transfert du stock et du PAMP ; anciennes références), **Applicabilité** (modèles/années compatibles, import CSV Ducati), **Statistiques**, **Historique des prix**, **Photos** (galerie de l'article — photos du DMS puis photos reprises de Shopify dans leur ordre, texte alternatif — + photo annotée de chaque localisation), GED. Section **Site web** : titre et description du site (HTML simple, aperçu nettoyé), date de reprise Shopify et, si le texte du DMS a été gardé, le texte Shopify noté à côté. Boutons : imprimer une étiquette, ouvrir le catalogue Ducati, dupliquer. |
| Pièces & Accessoires → Familles (`/parts/families`) | Arborescence Rayon / Sous-rayon / Catégorie en base (`article_categories`) avec code et compte de vente. Le référentiel officiel à 3 niveaux (UID `01-01-01`) est aussi figé dans le code. |
| Pièces & Accessoires → Modification en cascade (`/parts/cascade`) | Sélection filtrée d'articles puis action de masse : PV ±%, PA ±%, nouveau coefficient (recalcule PV HT/TTC), TVA, marque, type de gestion, casier, verrouiller/déverrouiller les prix. Chaque changement de prix est tracé. |
| Pièces & Accessoires → Import (`/parts/import`) | Dépôt d'un fichier fournisseur (.xlsx, .xls, .csv) ou collage CSV ; reconnaissance des colonnes ; traduction IT/EN → FR des désignations Ducati ; aperçu créations / mises à jour / anomalies ; application par lots. Réglages d'intégration (équivalent des cases G8), règles de PV à partir du PPC par fournisseur/rayon/marque, plancher de prix. Bandeau « Copier le SQL » si les tables de réglage manquent. |
| Pièces & Accessoires → Étiquettes (`/parts/labels`) | Éditeur de formats d'étiquettes (dimensions, éléments positionnés, code-barres Code128, image/logo, lignes libres), aperçu, impression rapide en texte libre. Impression **en masse** depuis la liste (quantité par défaut = stock réel, avec/sans prix, avec/sans code-barres). |
| Pièces & Accessoires → **Produits Shopify** (`/parts/shopify`, mission 03) | Instantané des produits et variantes du site Shopify (image, titre, SKU, prix, stock Shopify) avec leur article du DMS. Compteurs cliquables (variantes, liées automatiquement, liées à la main, à valider, ignorées, sans SKU), filtres par état et par statut sur le site. **Administrateurs** : « Relire Shopify », **Lier** (suggestions + recherche d'article), **Délier**, **Ignorer** / « Ne plus ignorer », **Reprendre photos et textes** (tous les produits reliés pas encore repris) et **Reprendre** sur une ligne ; badge et compteur « Photos et textes repris ». **Vendeurs** : lecture seule. Rien n'est écrit dans Shopify. |
| (hors menu Pièces) Tarifs clients (`/client-pricing`) | Remises et prix particuliers par client — partagé avec M1 (fonction `resolve_customer_price`). |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.parts.tsx` (conteneur), `_app.parts.index.tsx`, `_app.parts.new.tsx`, `_app.parts.$articleId.tsx`, `_app.parts.families.tsx`, `_app.parts.cascade.tsx`, `_app.parts.import.tsx`, `_app.parts.labels.tsx`, `_app.parts.shopify.tsx` (Produits Shopify), `_app.client-pricing.tsx` |
| Logique métier | `src/modules/articles/` : `api.ts` (lecture/écriture articles, écriture « résiliente », prix tracés, duplication), `article-form.tsx`, `article-tabs.tsx` (onglets), `product-families.ts` (référentiel UID), `categories-api.ts`, `subobjects-api.ts`, `applicability-api.ts`, `barcode.ts` (Code128), `article-photo.tsx`, `location-photo.tsx`, `partner-brands.ts`, `labels-batch.tsx`, `label-print.ts`, `labels/` (éditeur, rendu, modèles), `import/` (`parse.ts`, `parse-xlsx.ts`, `rules.ts`, `apply.ts`, `translate.ts`, `settings-api.ts`, `migration-sql.ts`), `shopify-api.ts` (Produits Shopify, reprise photos/textes), `article-web.tsx` (section Site web) |
| Tables | `articles` (fiche + prix courants + PAMP), `article_categories` (familles), `article_barcodes` (codes-barres), `article_suppliers` (fournisseurs secondaires), `article_kit_items` (nomenclature), `article_bins` (multi-casiers, **non utilisée par le code**), `price_changes` (historique des prix, append-only), `article_applicabilities` (compatibilités), `label_templates` (formats d'étiquettes), `article_import_settings` et `ppc_price_rules` (réglages d'import — voir §5), `shopify_products` (instantané des variantes Shopify, écrit par la fonction serveur) et `shopify_links` (décision de liaison variante ↔ article), `shopify_content_imports` (journal de la reprise photos/textes par produit ↔ article, texte Shopify noté à côté) ; colonnes `articles.web_title` / `web_description` ; photos dans `attachments` (M09 : `alt_text`, `sort_order`, `external_id` = id d'image Shopify) |
| Fonctions SQL (RPC) | `record_price_change` (modifie un prix en tagant l'origine), trigger `trace_price_change` (trace tout changement de PA/PV/coef), `transfer_stock_on_replace` (stock + PAMP vers la réf. de remplacement), `resolve_customer_price`, `round_up_euro`, `article_facets` (voir §5) ; Shopify : `shopify_products_overview`, `shopify_link_suggestions`, `shopify_link_variant`, `shopify_set_variant_decision` (admins), internes `_shopify_auto_candidates`, `_shopify_apply_auto_links`, `_shopify_content_targets`, `_shopify_apply_content` (clé de service seulement) |
| Fonctions serveur (Edge) | `shopify-sync-products` (lecture de tous les produits Shopify + liaison automatique exacte) ; `shopify-import-content` (reprise photos et textes) ; règles pures `supabase/functions/_shared/shopify-match.ts` et `shopify-content.ts` (nettoyage HTML, règle « ne pas écraser ») |
| Tâches planifiées | aucune propre au module |
| Migrations clés | `supabase/migrations/20260610120000_m2_articles.sql` (schéma + RLS), `20260610135000_m2_article_type_t.sql` (type T), `20260610140000_m2_articles_complete.sql` (parité G8, `article_bins`), `20260610160000_m1_m2_g8_extra.sql` (PPC, verrous), `20260610220000_m2_rounding_seed.sql`, `20260612140000_m2_price_changes.sql`, `20260612800000_articles_catalog_url.sql`, `20260613000000_m2_round_sale_prices.sql`, `20260613100000_m2_effective_sale_price.sql`, `20260714090000_m2_import_settings_ppc_rules.sql`, `20260717090000_m2_label_templates.sql`, `20260718090000_m2_bin2_brand_backfill.sql`, `20260720130000_m2_article_year_facets.sql`, `20260726100000_m2_article_supplier_availability.sql`, `20260726130000_m2_article_applicabilities.sql`, `20260919270000_m2_shopify_products.sql` (Shopify), `20260919320000_m2_shopify_content_import.sql` (reprise photos/textes) |
| Tests | `tests/import-rules.test.ts`, `tests/import-ducati.test.ts`, `tests/article-year.test.ts`, `tests/barcode.test.ts`, `tests/label-templates.test.ts`, `tests/product-families.test.ts`, `tests/pamp.test.ts` (PAMP côté JS), `tests/shopify-match.test.ts` (règle de liaison exacte Shopify), `tests/shopify-content.test.ts` (nettoyage HTML, règle « ne pas écraser ») |
| Libellés | `src/lib/i18n/fr.ts`, blocs `articles`, `applicability`, `labels`, `pricing`, `shopify` |

## 4. Règles métier et décisions

- **Type de gestion porté par chaque article** (B1) : énumération Postgres `article_mgmt_type` = A, M, F, N, V, O, P, D, R + **T** (main-d'œuvre, ADR-002, migration séparée car `ALTER TYPE ... ADD VALUE`).
- **Les véhicules V/O/P/D sont aussi des articles** (glossaire, « jointure cœur ») : la fiche véhicule M3 pointe vers l'article par `vehicles.article_id`. Voir M03 et M07.
- **PAMP recalculé à chaque entrée valorisée** (B5) : le champ `articles.pamp` n'est **jamais saisi à l'écran** ; il est recalculé par `record_stock_move` (M5). Formule : `(PAMP ancien × stock ancien + coût × qté) / (stock ancien + qté)`, et si le stock ancien est ≤ 0, le PAMP repart du coût d'entrée. Les marges sont affichées sur PA **et** sur PAMP (fiche article).
- **Prix : pas d'UPDATE silencieux** (règle 3, B7) : l'article porte son prix courant, mais le trigger `trace_price_change` écrit une ligne `price_changes` à **chaque** changement de PA, PV HT, PV TTC ou coefficient, quelle que soit l'origine (écran, cascade, import). `price_changes` est append-only (UPDATE/DELETE révoqués). Le changement de PAMP, lui, n'y est pas tracé : il se lit dans `stock_moves.unit_cost`.
- **Import de tarif** (INV013, ACH003) — règles paramétrables (`src/modules/articles/import/rules.ts`) : accepter ou non désignation / PA / réf. fournisseur / rayon / marque ; PV « à la hausse uniquement » par défaut ; conserver le coefficient ; ne pas recréer une référence remplacée (proposée en équivalence) ; créer les nouvelles références en **librairie** ; intégrer les codes-barres ; PA à 3 décimales ; plancher de prix (PV TTC sous le seuil → remonté au minimum).
- **Prix de vente arrondi** à l'euro supérieur si la société l'a choisi (`companies.round_sale_prices_up`, fonction `round_up_euro`), plus une table d'arrondis par tranches (migration `m2_rounding_seed`).
- **Remplacement de référence** (INV012) : `superseded_by_id` ; au remplacement, le stock de l'ancienne réf. passe sur la nouvelle avec son PAMP (`transfer_stock_on_replace`, deux mouvements `transfert` tracés, B7).
- **Rapprochement Shopify (W-6, 19/09)** : un produit Shopify n'est relié d'office à un article que si son SKU est **exactement** la référence de l'article (trim + majuscules) — ou, à défaut, son code-barres un code-barres de l'article — et que la correspondance est **unique** des deux côtés (un seul article, une seule variante). Tout le reste est « à valider » avec des suggestions (référence sans tirets/espaces, référence remplacée, référence fournisseur, libellé proche), jamais liées d'office. Une personne qui délie un produit empêche sa reliaison automatique. Chaque décision est tracée dans `events` (`shopify_link`, `shopify_unlink`, `shopify_ignore`, `shopify_auto_link`, `shopify_auto_unlink`, `shopify_sync`).
- **Reprise des photos et textes Shopify (W-4, 19/09)** : une fois, pour chaque produit relié ; ensuite **le DMS fait foi**. Un titre / une description web déjà saisis ne sont **jamais écrasés** (le texte Shopify est noté à côté dans `shopify_content_imports`) ; les photos du DMS restent et seules les images Shopify manquantes sont ajoutées (clé = id d'image Shopify, relance sans doublon). La règle est codée deux fois : `planContentImport` (TS, testée) et `_shopify_apply_content` (SQL, fait foi). Trace `events` action `shopify_content_import`, origine `reprise_shopify`.
- **Familles** : UID `Rayon-Sous-rayon-Catégorie` stocké dans `articles.category_path` (source : « Spécification de Mapping ERP / Arborescence Produits » du 19/07/2026). Les occasions reprises sont classées en `08-01-01` (particulier) et `08-02-01` (professionnel).
- **Code-barres par défaut = référence** (demande client, PA-12, juillet 2026).
- **Étiquetage** (B12) : quantité par défaut = stock réel, avec/sans code-barres, avec/sans prix. L'édition **différée cumulable** relève de M5 (voir M05).
- **Multi-société** : `articles.company_id` + RLS `is_member` ; suppression réservée à l'administrateur (`articles_delete` → `is_admin`). Les autres rôles (vendeur, magasinier…) ne sont **pas distingués** par la RLS.

## 5. État en production

Vérifié le 18/09/2026 **dans le code uniquement**. La vérification en base n'a pas pu être faite : le connecteur
Supabase de la session n'était pas authentifié. Les constats « base » ci-dessous reprennent la vérification du
**14/09/2026** (`docs/etat-projet.md` §2), recoupée par deux indices du 18/09 : aucune migration de rattrapage
dans le dépôt depuis, et `src/integrations/supabase/types.ts` (regénéré depuis la base le 11/09, commit `7d31b6d`,
puis complété le 18/09) ne contient toujours aucun des objets ci-dessous.

**Objets utilisés par le code et absents de la base au 14/09 (à revérifier)** :

| Objet | Migration | Effet réel, d'après le code |
|---|---|---|
| `articles.year_from`, `articles.year_to` | `20260720130000_m2_article_year_facets` | **Nuance importante par rapport à `etat-projet.md`** : depuis le 20/07, `createArticle`/`updateArticle` (`src/modules/articles/api.ts`, `writeResilient`) retirent la colonne manquante et réessaient. La fiche **s'enregistre**, mais les années Du/Au saisies sont **perdues sans avertissement**. Le 400 visible dans les journaux est la première tentative. |
| fonction `article_facets` | idem | Filtres par année/facettes vides (repli silencieux). |
| tables `article_import_settings`, `ppc_price_rules` | `20260714090000_m2_import_settings_ppc_rules` | Réglages d'import et règles PPC enregistrés **dans le navigateur du poste** (localStorage) ; bandeau d'avertissement sur l'écran Import. Deux postes n'ont pas les mêmes règles. |
| `companies.price_floor_threshold`, `price_floor_min` | idem | Plancher de prix lu avec des valeurs par défaut (1 € / 2 €). **Probable effet de bord hors module** : l'écran Paramètres → Sociétés envoie toujours ces deux champs (`src/routes/_app.settings.companies.tsx`, `updateCompany` sans repli) ; si les colonnes manquent, **l'enregistrement de la fiche société échoue**. À vérifier. |

Requête de contrôle (lecture seule) :
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='articles' and column_name in ('year_from','year_to','bin_location2','supplier_availability');
select to_regclass('public.article_import_settings'), to_regclass('public.ppc_price_rules');
select exists(select 1 from pg_proc where proname='article_facets');
select column_name from information_schema.columns
 where table_schema='public' and table_name='companies' and column_name like 'price_floor%';
```

**Présents d'après `types.ts`** (donc a priori appliqués) : `label_templates`, `article_applicabilities`, `articles.bin_location2`, `articles.supplier_availability`, `price_changes`.

Ce qui marche : liste, recherche, fiche (hors années), onglets, familles, cascade, import (avec réglages locaux), étiquettes, historique des prix.


> **Vérifié en base le 18/09/2026** (requête sur `information_schema`) : toujours **absents** — `articles.year_from`, `articles.year_to`, la fonction `article_facets`, les tables `article_import_settings` et `ppc_price_rules`, `companies.price_floor_threshold` et `companies.price_floor_min`. Les migrations correspondantes du dépôt n'ont jamais été appliquées. Tant qu'elles ne le sont pas, les champs concernés sont perdus sans avertissement.

## 6. Prévu / en cours
- Appliquer `20260714090000_m2_import_settings_ppc_rules` et `20260720130000_m2_article_year_facets` (`etat-projet.md` §7 « À reprendre — Réparations »). L'écran Import propose un bouton « Copier le SQL » (`src/modules/articles/import/migration-sql.ts`).
- Brancher les colonnes « en proposition » / « en commande » de la liste (TODO `src/routes/_app.parts.index.tsx`), à relier au chantier Commandes de pièces ([`../../process-commandes-pieces.md`](../../process-commandes-pieces.md)).
- Pas de dossier `docs/missions/` à ce jour.

## 7. Limites connues, dettes, pièges
- **Écriture « résiliente » = perte silencieuse** : le repli sur colonne manquante évite l'écran bloqué mais jette la donnée. Ne pas généraliser ce motif sans alerte visible.
- `articles.pamp` et `purchase_price` restent modifiables par un UPDATE direct (la RLS `articles_update` autorise tout membre). La traçabilité des prix est assurée par trigger, **pas** celle du PAMP. Toute écriture de PAMP hors `record_stock_move` viole B5.
- La reprise M7 crée l'article occasion avec `pamp` fixé directement à l'insert (`src/modules/tradein/validate-api.ts`) avant d'enregistrer l'entrée de stock : cohérent aujourd'hui, mais c'est un deuxième chemin d'écriture du PAMP.
- `article_bins` (multi-casiers) existe en base mais n'est pas utilisée : le code se limite à deux localisations (`bin_location`, `bin_location2`).
- Le référentiel officiel des familles est **en dur** dans `product-families.ts` alors que `/parts/families` gère une table : deux sources à garder alignées.
- Les fonctions `SECURITY DEFINER` du module (`record_price_change`, `transfer_stock_on_replace`) ne contrôlent l'appartenance à la société que si un utilisateur est connecté (`auth.uid() is not null`). Avec les droits d'exécution par défaut (`etat-projet.md` §5 : 90 fonctions appelables sans connexion), un appel anonyme n'est pas refusé. À vérifier et corriger avant tout portail public.
- **Reprise Shopify** : les images sont copiées une fois ; une image changée ensuite sur Shopify n'est pas reprise (le DMS fait foi). Relancer « Reprendre » sur un produit n'ajoute que les images dont l'id manque. `descriptif` (texte G8 des documents) n'est pas touché : le texte du site vit dans `web_description`. Supprimer une photo reprise puis relancer la reprise du produit la fait revenir.
- **Shopify** : l'instantané `shopify_products` n'est à jour qu'après « Relire Shopify » (pas de tâche planifiée). Le stock Shopify affiché est celui de Shopify, pas celui du DMS. Une variante disparue du site est marquée `removed_at`, jamais supprimée.
- Type généré : plusieurs tables récentes sont appelées via un client non typé (`supabase as any`) ; une faute de nom de colonne n'est pas détectée à la compilation.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| INV012 | Références remplacées et équivalences | ✅ fait | `ReplacementTab` dans `src/modules/articles/article-tabs.tsx`, `transfer_stock_on_replace` |
| INV013 | Import / MAJ des tarifs Ducati avec règles | 🟦 partiel | `src/modules/articles/import/` fait ; réglages partagés entre postes bloqués par la migration non appliquée (§5) ; import manuel, pas « automatique » |
| INV014 | Migration articles G8 + catalogues Ducati | 🟦 partiel | Import G8 articles dans Paramètres → Migration (`src/modules/migration/articles-import.ts`, commit `1a67fb8`) et tarifs Ducati via l'écran Import ; nombre d'articles repris en base : à vérifier |
| ACH003 | Import et maintien des tarifs fournisseurs | ✅ fait | même moteur d'import, fournisseur par fichier (`fileSupplier`) |
| INV007 | Étiquettes personnalisées (partagé avec M5) | ✅ fait | `/parts/labels`, `src/modules/articles/labels/` |
| B1 | Types de gestion A–R + T | ✅ fait | enum `article_mgmt_type` |
| Angle mort « modification en cascade + recalcul PA/PV + arrondis » | | ✅ fait | `/parts/cascade`, arrondis `round_up_euro` |
| Angle mort « fabrication / démontage » | | ⬜ manquant | nomenclature `article_kit_items` saisissable mais aucune décomposition en stock à la vente ni montage/démontage |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-10 | Module Articles : types A–R, prix/PAMP/coef, casiers, fournisseurs, codes-barres, kits ; type T ; parité G8 | `12c2314`, `43c3f44`, `20260610120000`…`140000` |
| 2026-06-10 | Moteur d'import tarifs (12 règles) + 10 tests | `8eda3c0` |
| 2026-06-11 | Moteur de prix interactif, familles, cascade, onglets codes-barres/kit/remplacement, arrondis | `1d72ca0`, `71fdf47`, `0dcd318`, `3363da2`, `9ac185b` |
| 2026-06-12 | `price_changes` append-only + trigger de traçage | `0392e5b`, `20260612140000_m2_price_changes` |
| 2026-06-22 / 06-29 | Lien catalogue Ducati ; arrondi PV à l'euro supérieur | `fcd42d6`, `fe9dc78` |
| 2026-07-15 | Import Excel, réglages d'intégration, règles PV/PPC, plancher, traduction FR, repli local | `62cbe87`, `850b051`, `a7f931e`, `20260714090000` (non appliquée au 14/09) |
| 2026-07-17 | Éditeur d'étiquettes, impression rapide, localisations 1/2 avec photo annotée | `bbf0028`, `739c0f5`, `54027e3`, `b2bd726` |
| 2026-07-19 | Familles en cascade Rayon > Sous-rayon > Catégorie | `b799e4b` |
| 2026-07-20 | Années Du/Au, recherche multicritère, marge %/€ | `579601f`, `20260720130000` (non appliquée au 14/09) |
| 2026-07-25 → 27 | Lot 7 backlog Italobike : duplication, code-barres = référence, applicabilités, anciennes réfs, « proposer à la commande » | `bae4f04`, `09549e3`, `e45e960`, `ec38231` |
| 2026-07-30 | Étiquette standard au format Ducati, lignes personnalisées | `4815c7d`, `cbb0253` |
| 2026-09-11 | Retour visuel d'enregistrement, bouton grisé tant que rien ne change | `7f6ce22`, `d24c84f` |
| 2026-09-19 | **Produits Shopify** (mission 03) : lecture de toute la boutique, instantané, liaison automatique exacte et unique (W-6), écran `/parts/shopify` (lier, délier, ignorer, relire) | branche `lot-shopify-rappro`, migration `20260919270000_m2_shopify_products.sql` (appliquée le 19/09), fonction `shopify-sync-products` (déployée le 19/09) |
| 2026-09-19 | **Reprise unique des photos et textes Shopify** (W-4) : champs Titre / Description sur le site, photos copiées dans le Storage du DMS avec texte alternatif, jamais d'écrasement, relance sans doublon ; reprise réelle des 300 produits reliés | branche `lot-shopify-photos`, migration `20260919320000_m2_shopify_content_import.sql` (appliquée le 19/09), fonction `shopify-import-content` (déployée le 19/09) |
