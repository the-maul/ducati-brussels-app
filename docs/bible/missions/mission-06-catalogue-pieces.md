---
mission: 06
titre: Catalogue pièces Ducati
etat: 🟦
ouverte_le: 2026-09-21
modules: [M02, M03, M06, M08, M09, M14]
---

# Mission 06 — Catalogue pièces Ducati

> **Objectif** : avoir dans le DMS tout le catalogue Ducati (modèles, millésimes, variantes, vues
> éclatées, pièces) pour connaître à 100 % la moto de chaque client et choisir ses pièces sans quitter
> le DMS. Socle de la mission 07 (plan d'entretien).

Liste ERP : « Mission 06 — Catalogue pièces Ducati » (`46b450e7-ecac-4b83-8782-c669b5cf63d5`).
Demande de Simon du 21/09 (chat). **Accord de Ducati pour remplir notre base : confirmé par Simon le 21/09.**

## 1. Le besoin (Simon, 21/09)

« On construit un catalogue qui permet de connaître à 100 % la moto du client. On viendra y lier nos
documents d'entretien. Comme ça le client ou l'atelier peuvent sélectionner le travail, on sait combien de
temps ça va prendre, le devis… et quand le client s'inscrit, tout est immédiatement lié. »

## 2. Ce que montre l'e-catalog (exploration du 21/09, lecture seule, session de Simon)

- Site `e-catalog.ducati.com/EPC`, connexion Ducati (idp.ducati.com). Derrière les pages, une **API JSON** :
  - `api/spareparts/browsing/families` → 14 familles (Off-road, Heritage, Scrambler, Superbike, Supersport,
    Multistrada, Diavel, Desert X, Monster, Streetfighter, Hypermotard, Desmosedici RR, SportClassic, Sport Touring) ;
  - `…/superModels/1/{famille}` → cylindrées ; `…/models/1/{famille}/{cylindrée}` → modèles et leurs millésimes ;
  - `api/spareparts/drawing/groups/…/{modèle}/{année}` → groupes Cadre / Moteur / Électrique / Outils / Pneu /
    Lubrifiant et leurs planches (≈ 76 par modèle-année) ;
  - `api/spareparts/drawing/drawing/…/{planche}` → image de la vue éclatée, **coordonnées de chaque repère**
    (hotspots), pièces (position, référence, désignation, quantité, prix, groupe de remise, remplacement,
    arbre de remplacement, indicateur `hasTempario` = temps Ducati) ;
  - `api/spareparts/search/genericSearch` (POST) : recherche référence / description / **VIN** → la variante
    exacte (ex. `ZDM1A02BGMB009261` → « MSV4STIP 21 BLG LS G-B STD DMH »).
- Volume mesuré : **887 modèles, 2 378 modèle-années** (1990 → 2027) ; ≈ 180 000 planches au total avant
  dédoublonnage ; nombreuses variantes hors Europe (USA, Thaïlande, Brésil, Argentine…).
- Autres catalogues dans le menu : accessoires, vêtements.

## 3. Cartes

| # | Carte | Pourquoi | Intégration |
|---|---|---|---|
| 1 | Vérifier l'accès et mesurer le catalogue sur un modèle | ne rien lancer en masse sans mesurer | ✅ fait le 21/09 (§2) |
| 2 | Importer les modèles Ducati par année | « connaître à 100 % la moto » | 🟦 fait le 21/09, à valider : tables, fonctions, chargeur, écran (§5) ; données à charger après l'extraction. Le lien avec le décodage VIN (`ducati_vds`, `ducati_vin_facts`) relève de la carte 4 |
| 3 | Importer les vues éclatées et les pièces de chaque modèle | savoir quelles pièces vont sur quelle moto | 🟦 fait le 21/09, à valider : planches + repères + pièces, article du DMS retrouvé par la référence (sans créer d'article) ; le prix du tarif importé fait foi (§5) |
| 4 | Reconnaître exactement la moto du client par son VIN | « quand le client s'inscrit, tout est lié » | 🟦 fait le 21/09, à valider (§5, migration `20260921210000` à appliquer) : reconnaissance hors ligne, remplissage sur fiche moto, reprise, espace client ; 2 974 motos déjà rattachées par l'e-catalog |
| 5 | Choisir les pièces sur la vue éclatée de la moto dans le devis et l'OR | remplace le copier-coller e-catalog (mission 05, carte 4) | 🟦 fait le 05/10, à valider (§5 « 05/10 ») : bouton « Choisir sur la vue éclatée » dans le devis/la facture et l'OR, repères cliquables, ajout en un clic (article existant ou créé à la volée) |
| 7 | Importer les catalogues accessoires et vêtements Ducati | 1 994 produits Shopify « 98… » absents du DMS (mission 03, Q5) | 🟦 base prête le 21/09 (tables, fonctions, recherche par référence, §5) ; API relevée (listes `POST …/product/list`, fiches `POST …/product/detail/{code}`) ; chargeur à brancher sur le format de fichier annoncé ; relier les produits Shopify = carte proposée (W-6) |
| 6 | Tenir le catalogue à jour | nouveaux millésimes, remplacements | 🟦 fait le 05/10, à valider (§5 « 05/10 », migration `20261005120000` **à appliquer**) : journal des changements, relecture ciblée par date, onglet « Mise à jour » avec bouton, plan remis à l'extension |

## 4. Décisions (Simon, 21/09)

- **Europe seulement** (variantes des autres marchés exclues).
- **Millésimes depuis 2000.**
- **Accessoires et vêtements aussi** (Simon, 21/09 : « oui top ») : ils résolvent la question 5 de la mission 03.
- **Import par une extension Chrome** (principe My Ducati : lit avec la session de l'utilisateur, aucun identifiant stocké, envoie au DMS, rythme lent, reprise après interruption).

## 4 bis. Questions (répondues le 21/09)

1. Périmètre : variantes Europe seulement ? *Reco : oui, les autres marchés plus tard si besoin.*
2. Années : tout, ou 2005+ d'abord ? *Reco : les modèles du parc + la gamme actuelle d'abord, puis le reste.*
3. Mode d'import : *Reco : l'extension navigateur (même principe que My Ducati) lit avec la session de
   l'utilisateur connecté, n'enregistre aucun identifiant, envoie au DMS ; rythme lent (~1 page/s),
   planches communes lues une seule fois ; reprise possible après interruption.*

## 5. Ce qui a changé dans l'application

### 21/09 — Cartes 2 et 3 (+ base de la carte 7)

**Pour l'utilisateur**
- **Pièces & Accessoires → Catalogue Ducati** (`/parts/catalog`) : onglet **Parcourir** (famille → modèle
  → millésime → vues éclatées → pièces) avec l'**image de la vue éclatée et ses repères cliquables** (clic
  sur un repère = la pièce est surlignée dans la liste) ; pour chaque pièce : repère, référence (et
  « remplacée par »), désignation, quantité, **prix Ducati HT pour information**, **article du DMS
  correspondant** (lien vers la fiche) et sa **disponibilité** (disponible / en commande / à commander,
  même calcul que les ventes). Onglet **État de l'import** : compteurs (modèles, modèles-années complets,
  vues, lignes, références) et lots d'import (qui, quand, état, compteurs, dernière activité, message).
- Premier remplissage par **fichiers d'extraction + chargeur** (décision M-17) : guide
  [`guides/catalogue-ducati.md`](../guides/catalogue-ducati.md).
- **Extension Chrome** : bouton « Importer le catalogue » sur l'e-catalog (liste Europe / depuis 2000
  modifiable, import en série ~1 page/s, pause, reprise après fermeture, arrêt sur 401/403/429 ou
  session expirée). Pour les **mises à jour** ; pas encore essayée en réel. Page Paramètres → Extension
  complétée, zip reconstruit (v0.10.0).

**Technique**
- Migrations (appliquées le 21/09, testées d'abord en transaction annulée) :
  `20260921100000_m3_catalogue_ducati_modeles` (familles, cylindrées, modèles avec marché / `is_europe`,
  modèle-années, lots d'import), `20260921101000_m2_catalogue_ducati_planches` (groupes, planches avec
  repères, liaison planche ↔ modèle-année, lignes, fiche par référence avec prix info),
  `20260921102000_m2_catalogue_ducati_accessoires_vetements`, `20260921103000_m2_catalogue_ducati_chargeur`
  (lots « chargeur » par clé de service, `name`, `item_id`, import groupé, recalcul « complet »).
- Tables **globales** (décision M-19), lecture équipe (`ducati_catalog_is_staff`), écriture uniquement par
  les fonctions `ducati_catalog_*` (security definer ; admin de la société ou clé de service). Traces
  `events` par **lot** (démarrage, arbre reçu, pause, reprise, arrêt, erreur, fin), jamais par ligne.
- **Dédoublonnage** : une planche partagée n'est stockée qu'une fois (id Ducati) ; l'import d'un
  modèle-année renvoie seulement les planches dont les pièces manquent.
- **Référence normalisée** : `ducati_catalog_norm_ref` = forme de l'index `idx_articles_ref_compact`
  (majuscules, A-Z0-9) ; `ducati_catalog_article_for(société, référence)` et
  `ducati_catalog_drawing_lines(société, planche)` retrouvent l'article **sans en créer**.
- Code : `src/modules/catalog/` (écran, api, pont extension), `src/components/catalog-import-listener.tsx`,
  `tools/catalog-loader/` (chargeur), `tools/myducati-extension/catalog-core.js` + `catalog.js`.
- Tests : `tests/ducati-catalog-core.test.ts` (filtre Europe/année, références, dédoublonnage, reprise),
  `tests/ducati-catalog-loader.test.ts` (fichiers d'extraction, extrait fictif `tests/fixtures/catalogue-ducati`).
  Chaîne chargeur → base essayée sur l'extrait fictif en transaction annulée (aucune donnée écrite).

**Mesures et durées** (21/09)
- Pièces Europe ≥ 2000 : ≈ 1 000 modèles-années (estimation, ≈ 45 % des 2 378) ; ≈ 77 000 pages sans
  vues communes (≈ 27 h à 1 page/s), **≈ 6 à 9 h** attendues avec le dédoublonnage.
- Accessoires : 15 familles, 2 077 entrées de liste, **1 937 produits distincts** (liste par famille
  `POST api/accessories/product/list` puis fiche `POST api/accessories/product/detail/{code}`) → ≈ 35 min.
  Vêtements : **512 produits** (une seule liste) → ≈ 10 min. Les appels POST exigent l'en-tête anti-CSRF
  du site (`X-XSRF-TOKEN`, lu dans le cookie au moment de l'appel, jamais stocké).
- Images d'accessoires : publiques (`EPCResources/GRAPHICS/immagini_pim/…`). Images des vues éclatées :
  adresse Ducati gardée, affichage à vérifier sur les vraies données.

**Images** : pas de copie massive. Option ultérieure : copier dans le stockage du DMS **seulement les vues
utilisées** (devis / OR), au premier usage.

### 21/09 — Catalogue visible et relié aux articles (lot `lot-catalogue-pa`)

Plainte de Simon : « ya pas catalogue… je vois rien », « pas connecté aux produits déjà inscrits ».

**Pour l'utilisateur**
- **Menu** : « Catalogue Ducati » sous Pièces & Accessoires (mêmes personnes), seule l'entrée la plus précise
  s'allume.
- **Vue éclatée** : pour chaque pièce, l'article du DMS (lien vers la fiche, disponibilité, **prix de vente HT**)
  ou **« Créer l'article »** (pièce stockée A ou non stockée M) → écran Nouvel article pré-rempli (référence,
  désignation Ducati) ; l'article n'existe qu'après « Créer ».
- **Fiche article → onglet « Catalogue Ducati »** : motos (famille, modèle, année) et vues où la référence
  apparaît, 20 par page, Europe d'abord, « Ouvrir la vue » (pièce surlignée).
- **Recherche Pièces & Accessoires** : une référence sans article propose « Trouvée dans le catalogue Ducati ».
- **Catalogue** : champ « Référence Ducati » ; l'adresse de la page garde la vue ouverte (liens partageables,
  bouton Retour du navigateur).
- **État de l'import** : compteur « Articles reliés ».

**Technique**
- Migration `20260921170000_m2_catalogue_ducati_liens_articles.sql` — **à appliquer** (essayée en transaction
  annulée le 21/09) : index `idx_dc_parts_ref_prefix` (recherche « commence par »), vue
  `ducati_catalog_article_links` (security_invoker), fonctions `ducati_catalog_find_parts`,
  `ducati_catalog_part_usage` (paginée, `total_count`), `ducati_catalog_article_link_count`. Additive, lecture
  seule, aucune écriture d'article/stock/prix. Tant qu'elle n'est pas appliquée : l'onglet de la fiche affiche
  « lien pas encore disponible », l'encadré de recherche et le compteur restent absents ; la vue éclatée
  (article, disponibilité, prix, « Créer l'article ») fonctionne déjà.
- Mesures (21/09, rôle authenticated, statement_timeout 8 s) : **45 394 articles actifs reliés sur 81 785**
  (45 394 références Ducati sur 49 403 ont un article) ; compteur 0,2 s ; pire référence (85250241A, 4 430
  emplacements) 1,0 s ; recherche 0,01 s ; lignes d'une vue 0,09 s.
- Code : `src/modules/catalog/part-usage.tsx`, `reference-panel.tsx`, `create-article-button.tsx`,
  `catalog-search-hint.tsx` ; `src/lib/navigation.ts` (sous-entrée `child`, `activeNavTo`) ; `/parts/new`
  accepte `?reference=&designation=&mgmt=A|M&from=catalog` ; `/parts/catalog` accepte `?my=&drawing=&ref=&tab=`.
- Test : `tests/ducati-catalog-article-link.test.ts` (normalisation, détection d'une référence, menu).

### 21/09 — Carte 4 : reconnaître la moto par son VIN (lot `lot-vin`, à valider)

Demande de Simon : « avec le VIN il fait aucun effort… il peut compléter beaucoup plus les infos ».

**Moteur de reconnaissance hors ligne** (le DMS n'interroge pas l'e-catalog) :
- 3 144 VIN du parc passés dans l'e-catalog, **2 975 reconnus** (2 970 dont le modèle-année est chargé) ;
  2 974 motos avaient déjà reçu leur `ducati_model_year_id` par ce passage.
- Table `ducati_vin_patterns` : **797 lignes, 486 motifs** (caractères 1 à 9 + année) → modèle-année,
  nombre de motos vues, plage de série **arrondie à la centaine**. Aucun VIN complet, aucun client.
  Table `ducati_vin_model_specs` : cylindrée, kW, CV, cylindres, norme de **577 modèles-années** (valeur la
  plus fréquente du parc).
- **Précision mesurée par validation croisée** (chaque VIN retiré puis reconnu avec les autres, 2 970 VIN) :
  famille **99,4 %**, cylindrée **97,9 %**, version **71,5 %**, modèle-année exact **70,1 %** en premier
  choix, bon modèle-année **dans la liste proposée 92,2 %**. Par niveau : unique 16,6 % des VIN (94,9 %
  exact), probable 41,4 % (79,6 %), plusieurs 37,3 % (bon choix dans la liste 95,5 %), modèle 3,0 %,
  famille 1,1 %, inconnu 0,6 %.
- Pourquoi pas 100 % : le VIN Ducati code la famille, le moteur et le cadre, **pas la finition** (Scrambler
  Icon / Classic / Full Throttle / Urban Enduro ont le même descripteur et des n° de série entremêlés).
  L'e-catalog, lui, consulte la base de production Ducati VIN par VIN.
- Correction au passage : le 10e caractère `1`…`9` = 2001…2009 (l'ancien décodeur disait 2031…2039).

**À l'écran** : encart « Reconnaissance par le VIN » sous le VIN (fiche moto, moto de client, création depuis
une moto déclarée, assistant de reprise et modification de reprise, « Ajouter ma moto » de l'espace client) ;
détail en M03 §4. Côté équipe : liens **Vues éclatées (n)** (`/parts/catalog?my=`) et **Plan d'entretien**.
Infos de nos factures pour ce VIN exact (couleur, n° moteur, plaque…) reprises automatiquement.

**À l'enregistrement** : déclencheur `trg_vehicles_catalog_from_vin` (confiance unique seulement, trace
`events`). Sur les 282 motos Ducati du parc encore sans rattachement : 9 unique, 61 probable, 28 plusieurs,
50 modèle, 10 famille, 124 inconnu (VIN incomplets ou jamais vus).

Fichiers : `src/lib/vin-identify.ts`, `src/modules/vehicles/vin-identify-api.ts`,
`src/modules/vehicles/vin-identify-panel.tsx`, `tools/vin-patterns/build.ts` (régénère la table et la
mesure), `tests/vin-identify.test.ts`, migration `20260921210000_m3_vin_reconnaissance.sql` (**à appliquer**).
Testée hors production (base PostgreSQL locale : même résultat que les fonctions TypeScript sur 3 000 VIN).

### 23/09 — Accessoires et VÊTEMENTS Ducati : un article par référence (carte 7, lot `lot-vetements`)

Les deux catalogues sont arrivés : `catalogue-ducati-accessoires.json` (1 937 produits, 2 613 références,
1 190 distinctes) et `catalogue-ducati-vetements.json` (2 563 produits, **13 726 références**, 13 684 distinctes,
dont **5 211 encore au catalogue** et 8 473 retirées). Leur `…-arbre.json` donne les motos compatibles
(accessoires), la catégorie (« PERFORMANCE WEAR / Cuir »), le genre et les familles de motos (vêtements).

**Prix** : l'e-catalog donne les deux, `price` **HT** et `priceWithVAT` / `partDetails.vatPrice` **TTC**
(rapport 1,21 vérifié). Le DMS garde le TTC en PV TTC et le HT en PV HT (convention W-10), les deux aussi en PPC ;
sans prix, l'article est « à compléter ». Les prix sont posés par `price_changes` (origine `import:catalogue_ducati`).

**Règle d'article** : une référence vendable = **un article** (référence = SKU), type A en **librairie**
(non stocké tant qu'il n'est pas reçu), désignation = nom du produit + taille / couleur / version
(« Ducati Corse C7 — 46 / perforé »), note = catégorie · genre · collection · familles de motos · « hors production ».
**Un article qui existe déjà n'est jamais modifié** (les vêtements du site gardent leur fiche et leur stock).
Les références **retirées du catalogue** (8 473) restent consultables dans le catalogue mais ne créent pas d'article.

**Fait le 23/09 (chargement réel en production)** : les deux catalogues sont chargés (4 500 produits,
16 339 références, 47 434 compatibilités moto) et les **4 775 articles manquants avaient été créés le matin**
(`article_links_create_missing`). Le chargeur a ensuite **complété 3 866 articles** (taille, couleur, version,
catégorie, genre, collection, « hors production ») : 208 au premier passage, 3 658 après correction (voir §5 ter).

| Vérifié en base le 23/09 | Nombre |
|---|---|
| Articles du DMS | 93 103 |
| Articles reliés à une pièce du catalogue Ducati | 49 429 |
| Articles reliés à un accessoire / vêtement Ducati | **6 880** |
| Articles complétés par le chargeur (taille) / (note catégorie·genre·familles) | **3 663** / **3 865** |
| Références du catalogue avec une taille / produits avec une catégorie | 13 250 / 512 |
| Variantes du site portant le badge Ducati | **2 352** sur 3 106 |
| Produits du site concernés par ces catalogues | 2 093, dont **2 071 reliés** |
| Produits du site encore sans lien Ducati | **22** (11 ont déjà une correspondance à valider, 11 sont à rattacher) |
| Prix (price_changes `import:catalogue_ducati`) / mouvements de stock touchés | 7 341 (inchangé) / 0 |
| Articles créés pendant ce chargement | 0 (déjà créés le matin) |

**Technique**
- Chargeur `tools/accessories-loader/` (accessoires **et** vêtements) : lit `detail.accessoryVariants` ou
  `detail.variants`, les attributs `APP_TAGLIA` / `APP_TAGLIA_CASCHI` (taille), `APP_COLOR`, `APP_VERSIONE`,
  `APP_CODICE_MADRE`, `APP_COLLECTIONYEAR`, le statut `partStatus` et l'arbre (catégorie, genre traduit —
  Uomo → Homme —, familles). `--dry-run` résume les fichiers **et** interroge la base (articles à créer,
  produits du site concernés). Idempotent : l'import est un upsert, la création ne double jamais un article.
- Migrations `20260923120000` (appliquée le 23/09), `20260923121000` et `20260923122000` (appliquées le 23/09
  après le premier chargement) : désignation et note enrichies dans `article_links_create_missing`, catégorie / genre / familles /
  version / collection sur la fiche (`article_links_for_article`), aperçu `ducati_products_creation_preview`,
  **rattrapage `ducati_products_repair_designations`** (complète les articles déjà créés, uniquement s'ils sont
  en librairie, de marque Ducati, jamais retouchés ; ne touche ni prix ni stock ; relançable : 0 au 2e passage).
- Fiche article → onglet « Vues éclatées / motos compatibles » : pour un accessoire ou un vêtement, catégorie,
  genre, collection, version et **familles de motos**.
- Tests : `tests/accessories-loader.test.ts` (format réel des deux fichiers, genre, tailles, archivées).

**Lancé le 23/09** (`node tools/accessories-loader/load.mjs`, ≈ 4 min) ; relançable sans risque :
le journal `catalogue-ducati-produits-chargement.json` (dossier des fichiers) évite de réimporter ce qui est
déjà passé, `--force` le rejoue, `--dry-run` ne fait que lire.

### 5 ter. Le chargeur coupait à 8 secondes (corrigé le 23/09)

Le premier chargeur échouait sur « fetch failed », puis sur `57014 canceling statement due to statement timeout`.
**Cause** : PostgREST se connecte avec le rôle `authenticator`, qui a `statement_timeout = 8 s` — même avec la
clé de service. Un import de 50 produits (jusqu'à 700 références) ou une création de 4 775 articles ne tient
pas dans ces 8 s, et la connexion est coupée sans message utile.

**Corrigé** : import par lots de 25 produits (1 Mo maximum par appel), création et rattrapage **en boucle avec
`_limit`** (300 articles, 500 rattrapages par appel) jusqu'à épuisement, délai explicite par requête (60 s),
**4 réessais** avec attente doublée, message d'erreur complet (statut HTTP + corps), progression et durée de
chaque lot, **reprise** par journal. Côté base : `article_links_create_missing` ne relance le rapprochement
(≈ 4 s) qu'au **dernier** lot (migration `20260923121000`), et le rattrapage ne prend que des articles qui ont
vraiment quelque chose à compléter — sinon le même lot revenait et la boucle s'arrêtait à 208 articles
(migration `20260923122000`). Les tailles Ducati contenant des retours à la ligne sont remises au propre.

### 05/10 — Cartes 5 et 6 (lot `lot-eclatee`)

#### Carte 5 — choisir les pièces sur la vue éclatée depuis un devis, une facture ou un OR

**Pour l'utilisateur**
- Un devis, une facture ou un OR qui porte une **moto reliée au catalogue** (colonne
  `vehicles.ducati_model_year_id`, carte 4) affiche un bouton **« Choisir sur la vue éclatée »**
  à côté de « Ajouter une ligne ». Sans moto, ou moto non reconnue, **le bouton ne s'affiche pas** :
  rien à montrer, donc rien à cliquer.
- Il ouvre les **groupes et les planches de CE modèle-année** (vignettes, filtre par nom / code /
  groupe), puis la **vue éclatée Ducati avec ses repères cliquables** — exactement l'écran
  « Catalogue Ducati », le même composant.
- Chaque pièce porte un bouton d'ajout :
  - **« Ajouter »** quand l'article du DMS existe (lien par référence normalisée) : la ligne est posée
    avec la **quantité Ducati**, le **prix de vente de l'article** et sa **disponibilité** (même calcul
    que les ventes) ;
  - **« Créer et ajouter »** sinon : l'article est créé à la volée par le **chemin déjà en place**
    (`createToCompleteArticle`, mission 05 carte 4) — librairie, marque Ducati, type A,
    « à compléter », prix de vente = **prix public Ducati HT** de la planche, création tracée dans
    `events`. Le magasin complète ensuite PA, fournisseur et famille.
- On peut enchaîner plusieurs pièces sans fermer la fenêtre (le compteur « n pièces ajoutées » suit).
- **Limite connue** : pour un devis ou une facture, les lignes ne se modifient qu'à la **création**
  (c'est vrai de tout le module Ventes aujourd'hui, pas de ce lot) — un document déjà enregistré se
  reprend par « Dupliquer » / « Convertir ». L'**OR**, lui, se modifie aussi après enregistrement.

**Technique**
- `src/modules/catalog/drawing-picker.tsx` (nouveau) : bouton + fenêtre. `DrawingView` **n'est pas
  réécrit** : il reçoit deux propriétés facultatives (`onAdd`, `addState`) qui ajoutent une colonne
  d'ajout ; sans elles, l'écran Catalogue est inchangé.
- `src/modules/catalog/api.ts` : `getVehicleCatalogRef(vehicleId)` -> modèle-année de la moto (null
  si non reliée), `vehicleCatalogLabel`.
- Branchements : `src/modules/sales/document-editor.tsx` (réutilise `addEcatalogLine`, qui accepte
  désormais une `quantity` imposée) et `src/modules/workshop/or-editor.tsx` (`addDrawingLine`).
- **Aucune migration** : les tables et la fonction `ducati_catalog_drawing_lines` existaient déjà.

**Mesures (05/10, production)**
- **Planches d'une moto type : 70** (médiane sur les 857 modèles-années) ; **71** pour les
  modèles-années réellement portés par une moto du parc ; de 38 à 152 selon le modèle.
  Exemples : Monster 696 2009 (64 motos) 50 planches, Monster 821 2015 70, Panigale 899 2014 72.
- **Temps de chargement** : liste des groupes et planches d'un modèle-année **15,6 ms** ;
  pièces d'une planche (avec article, prix et disponibilité) **57 ms** pour une planche médiane
  (20 lignes) et **451 ms** pour la plus chargée du catalogue (271 lignes). **Sous la seconde dans
  tous les cas.**
- **Aucun index à ajouter** : vérifié par `explain analyze`, la requête utilise déjà
  `ducati_catalog_model_year_drawings_pkey` (préfixe `model_year_id`),
  `ducati_catalog_drawing_lines_drawing_id_line_no_key` (préfixe `drawing_id`),
  `idx_dc_parts_ref_prefix` et `idx_articles_ref_compact`. Le temps restant est celui de
  `article_stock` et `_article_on_order_qty`, eux-mêmes indexés (`stock_moves(article_id)`,
  `part_order_lines(article_id)`, `purchase_lines(article_id)`, `purchase_orders(source_order_id)`).
- **Portée immédiate** : **6 325 documents** et **2 976 motos** portent une moto reliée au catalogue.

#### Carte 6 — tenir le catalogue à jour

**Le problème trouvé d'abord.** Avant ce lot, une mise à jour était **impossible** : une planche
dont les pièces étaient déjà connues n'était **jamais** redemandée (`ingest_model_year` ne rendait
que les planches sans pièces). Aucun remplacement, aucun changement de prix ne pouvait être vu.
Et aucune des **5 724** références marquées « remplacée » ne portait **par quoi** elle est remplacée
(`replaced_part` : 0 sur 5 724), parce que `coalesce(excluded.x, t.x)` empêchait aussi tout retour en
arrière : une pièce qui cessait d'être remplacée restait marquée à vie.

**Pour l'utilisateur**
- **Pièces & Accessoires -> Catalogue Ducati -> onglet « Mise à jour »** (`/parts/catalog?tab=update`) :
  - **date du dernier import**, modèles-années complets, références au catalogue, **remplacements vus
    aujourd'hui** ;
  - **ce qui a changé au dernier passage** : pastilles comptées (nouveaux modèles-années, nouvelles
    planches, planches modifiées, nouvelles références, références remplacées, remplacements levés,
    prix changés) **et la liste détaillée** (référence, désignation, prix avant -> après, remplacée par) ;
  - un choix **« relire ce qui n'a pas été vu depuis »** (7 / 15 / 30 / 90 / 180 jours), un aperçu
    chiffré de ce que ça représente, et le bouton **« Mettre à jour »**.
- **Le DMS n'appelle jamais Ducati.** Le bouton **prépare** un plan ; la marche à suivre (4 étapes)
  s'affiche juste en dessous. C'est l'**extension Chrome**, avec la session e-catalog de Simon, qui
  lit et dépose les données ; elle reçoit le plan quand elle se présente.
- Dans l'extension, un bandeau bleu annonce « Mise à jour ciblée demandée par le DMS » et l'import
  **se limite** aux modèles-années du plan.

**Technique** — migration `20261005120000_m2_catalogue_ducati_mise_a_jour.sql`, **à appliquer**
(essayée deux fois en transaction annulée le 05/10, dont un essai fonctionnel complet) :
- `ducati_catalog_changes` : le **journal** (lot, nature, clé, libellé, détail avant/après).
  Lecture équipe, écriture par les fonctions d'import seulement. Index par lot, par nature, par date.
- Compteurs sur `ducati_catalog_import_batches` : `model_years_new`, `drawings_new`,
  `drawings_changed`, `parts_new`, `parts_replaced`, `parts_price_changed`.
- `ducati_catalog_ingest_model_year(..., _refresh_before timestamptz)` : **relecture ciblée**. Les
  planches lues avant cette date sont redemandées, les autres restent sautées — « sans tout
  recharger ». C'est le seul endroit qui en décide. Les signatures à 3 arguments sont supprimées
  (garder les deux créerait une ambiguïté d'appel) ; les appelants existants tombent sur la nouvelle
  avec `_refresh_before` à null, donc **comportement inchangé par défaut**.
- `ducati_catalog_ingest_drawings` : prend une **photo de l'état d'avant** pour les seules références
  du lot, puis écrit le journal (nouvelle référence / remplacée / remplacement levé / prix changé).
  **Correctif** : `replaced`, `replaced_part` et `replacement_tree` suivent désormais le catalogue
  **dans les deux sens**.
- `ducati_catalog_update_plan(_stale_days, _limit)` : ce qu'il faut relire — jamais lu, incomplet, ou
  vu avant la date. Les modèles-années **portés par une moto du parc passent devant**.
- `ducati_catalog_update_requests` + `ducati_catalog_update_request` / `_cancel` / `_pending` /
  `_consume` : le plan armé. Une seule demande ouverte à la fois ; elle reste vivante tant que le lot
  qui l'a prise en charge tourne. `ducati_catalog_import_state` la remet à l'extension.
- `ducati_catalog_update_summary` : tout l'écran en un appel.
- Code : `src/modules/catalog/update-panel.tsx` (nouveau), `api.ts`, `bridge.ts` (le DMS applique
  lui-même la date de relecture : **l'extension n'a rien à décider**),
  `src/routes/_app.parts.catalog.tsx` (3e onglet).
- Extension **0.11.0** (zip reconstruit) : `catalog-core.js` accepte `onlyModelYears` dans
  `buildPlan` (pur, testé), `catalog.js` va chercher le plan à l'ouverture du panneau et après la
  lecture de l'arbre.
- Chargeur : `node tools/catalog-loader/load.mjs --refresh-days 30 --changes`.
- Tests : 3 cas de plus dans `tests/ducati-catalog-core.test.ts` (plan ciblé, plan vide, plan qui ne
  vise que du hors-Europe). **724 tests verts.**

**Mesures (05/10, production)**
- Catalogue en base : **857 modèles-années tous complets**, **36 700 planches** toutes avec leurs
  pièces, **61 143** liaisons planche <-> modèle-année, **822 775 lignes**, **49 403 références**.
- **Références marquées remplacées : 5 724** (112 110 lignes de planche) ; **0 vue aujourd'hui**
  (aucun passage depuis le 21/09) ; **0 portait son remplacement** avant ce lot.
- Essai fonctionnel du 05/10 (transaction annulée, planche 17780 du Monster 696 2009) :
  relecture ciblée **0 planche sur 50 sans date, 50 sur 50 avec date** ; journal écrit
  **1 nouvelle référence, 1 remplacement posé avec sa référence remplaçante, 10 prix changés,
  5 remplacements levés** — ces 5 sont précisément des références que l'ancien import avait
  marquées à tort et que le correctif nettoie.

## 5 bis. Cartes proposées (21/09)

- **Créer ou relier les articles DMS depuis le catalogue accessoires et vêtements** (les 1 994 produits
  Shopify « 98… » : liaison exacte automatique, le reste à valider, règle W-6) — décision de Simon.
- **Tenir le catalogue à jour avec l'extension** : essai réel de l'extension sur quelques modèles, puis
  relecture ciblée des nouveaux millésimes (drapeau `updated` de l'API) — ex-carte 6, rendue possible.
- **Copier dans le DMS les vues éclatées utilisées** (si les images Ducati deviennent inaccessibles).
- ~~Rattacher les modèles-années du catalogue au décodage VIN~~ — fait (carte 4, hors ligne).
- **Enrichir la table des motifs à chaque nouveau VIN reconnu** (extension My Ducati : `modelYearByVin` pour
  les VIN « plusieurs » / « inconnu », puis relance de `tools/vin-patterns/build.ts`).
- **Champ VIN à la borne et à l'inscription en ligne** (aujourd'hui famille / modèle / année seulement).

### 21-22/09 — Un seul catalogue : les articles du DMS (lot `lot-rapprochement`, décision M-25)

Demande de Simon : « je veux un seul catalogue, avec le Shopify lié… si des produits n'existent pas encore on les crée
dans la db… un seul stock… des petits logos G8, Shopify, Ducati ». Une première version (trois « vues » et un simple
aperçu des manquants) a été refusée par Simon le 21/09 ; ce qui suit la remplace.

**Réponse à « comment Shopify peut avoir des produits qui ne sont pas dans la base ? »** — Le site Shopify a été rempli
à la main, directement dans Shopify, avant le DMS : sur 3 106 produits (variantes) du site, seuls 300 avaient un SKU
égal à une référence du DMS. Les 2 806 autres n'avaient pas d'article : 1 994 vêtements « 98… » et 401 accessoires
« 96/97… » que G8 n'a jamais eus, 94 produits sans SKU, 240 motos, et quelques pièces d'occasion ou SKU en double.
Avec ce lot, chaque produit du site devient un article du DMS (2 534 créés, stock et prix du site repris), les motos
sont proposées à leur fiche véhicule, et tout nouveau produit créé dans Shopify est signalé.

**Mesure des correspondances (lecture seule, 21/09)** — inchangée par rapport à la première version :

| Sens | Méthode | Liens | Faux positifs (échantillon vérifié) | Traitement |
|---|---|---|---|---|
| Ducati ↔ DMS | Même référence (majuscules, sans espaces / points / tirets) | 45 394 | 0/12 (désignations EN/IT = traductions) | relié |
| Ducati ↔ DMS | Autre indice de révision (une seule réf. Ducati, hors notices) | 1 721 | une lettre ≈ 2/15, deux lettres 3/10 (couleurs) | à valider 50 / 35 |
| Ducati ↔ DMS | Remplacée dans le DMS (chaîne G8) | 8 368 | 0/10 (lien « remplacée par ») | à valider 60 |
| Ducati ↔ DMS | Préfixe / suffixe « /2 » · zéros · EAN | 3 · 0 · 0 | 3/3 (kits) | à valider 40 |
| Ducati ↔ DMS | Référence à un caractère près | 19 553 | 15/15 faux | écarté |
| Shopify ↔ DMS | SKU exact et unique (W-6) | 300 | 0/12 | relié |
| Shopify ↔ DMS | SKU exact mais partagé par plusieurs produits | 23 | — | à valider 90 |
| Shopify ↔ DMS | Référence dans le titre · ancienne réf. remplacée | 8 · 10 | 0/9 · 0/10 | à valider 80 · 70 |
| Shopify ↔ DMS | Désignation + prix (trigrammes, local) | 19 | 19/20 faux | écarté |
| Shopify ↔ Ducati | SKU = pièce · accessoires (fichier du 22/09) | 277 · 149 | 0/12 | via l'article |

**Création des articles manquants — chiffres réels (transaction annulée du 22/09, base de production)**

| Création | Articles | Détail |
|---|---|---|
| Références du catalogue pièces Ducati sans article | **4 009** | type A, librairie ; 2 693 avec prix public Ducati (price_changes `import:catalogue_ducati`), 1 316 sans prix → « à compléter » |
| Variantes Shopify sans article | **2 534** | 2 372 avec SKU, 24 SKU partagés (« -2 »), 44 pièces d'occasion, 94 sans SKU (« SHOP-… », à compléter, lien à valider) ; 2 505 prix du site (`import:shopify`) ; **605 stocks de départ = 925 pièces** (mouvements « inventaire », origine `import:shopify`) |
| Motos du site | **0 article** | 240 variantes ; 406 propositions de fiche véhicule à valider (VIN ou modèle) |
| Accessoires Ducati (fichier du 22/09, chargeur pas lancé) | **≈ 1 018** à la charge | 1 937 produits, 2 613 références (1 190 distinctes), 47 434 compatibilités moto ; **149 produits Shopify** de plus reçoivent leur référence Ducati (badge Ducati) ; vêtements : fichier attendu (1 994 SKU « 98… » du site) |

Après création : 88 327 articles ; **49 429 reliés au catalogue Ducati** (toutes les 49 403 références + 26 occasions),
**2 741 reliés au site** (sur 3 106 variantes ; + 94 à confirmer), 81 473 badges G8 ; 126 produits du site restent
signalés « sans article » (94 à confirmer, 23 SKU partagés, 9 références dans le titre). Deuxième passage : 0 créé.
Essai d'une tranche de 60 accessoires (72 références) : 30 articles créés, 47 liens Ducati, 15 articles du site reliés.

**Pour l'utilisateur**
- **Menu** : Pièces & Accessoires et son outil **Rapprochements** ; plus d'entrées « Catalogue Ducati » ni « Produits
  Shopify ». Boutons de la liste : Rapprochements, **Réglages du site** (synchronisation, relire Shopify).
- **Liste** : badges **G8 / Shopify / Ducati** (infobulle), filtre **Référencé** (Shopify, pas sur le site, Ducati, G8,
  ni Shopify ni Ducati) ; alerte **« N produit(s) du site sans article »**.
- **Fiche article, tout sur une page** : carte **Catalogue Ducati** (photo ou vue éclatée, référence, prix public
  Ducati pour information, remplacement, temps Ducati, candidats, « Relier à une référence Ducati ») et carte **Site
  Shopify** (photo, prix site, stock site, en ligne / brouillon, candidats, **« Publier sur le site »**) ; onglet
  **« Vues éclatées / motos compatibles »**. **Fiche moto** : lien « Vues éclatées de cette moto ».
- **Rapprochements** : compteurs, correspondances à valider (accepter / rejeter en masse), **« Créer les articles
  manquants »** (lots de 200, relançable), **Produits du site sans article** (« Créer l'article » / « Rattacher »),
  **Motos du site ↔ fiches véhicule** (accepter / rejeter).

**Technique**
- Migrations **à appliquer, dans l'ordre** : `20260921200000_m2_rapprochement_article_pivot.sql` puis
  `20260921201000_m2_catalogue_unique_creation_articles.sql` (la seconde crée les articles : ≈ 20 s). Essayées ensemble
  dans une transaction annulée le 22/09 ; aucune donnée écrite.
- `article_links` (sortes `ducati_part`, `ducati_product`, `shopify_variant`, `g8`) ; `shopify_vehicle_links` ; fonctions
  `article_links_refresh` (4 s en administrateur), `article_links_create_missing(société, portée, limite, variante)`
  (0,7 s pour un lot vide, une variante à la fois pour « Créer l'article »), `shopify_unlinked_products`,
  `shopify_vehicle_links_refresh / _review / _decide`, `_shopify_is_moto`.
- Chargeur **`tools/accessories-loader/`** (non lancé) : `node tools/accessories-loader/load.mjs --dry-run` sur le vrai
  fichier : 1 937 produits, 2 613 références, prix HT (`price`) et TTC (`priceWithVAT`, ratio 1,21), motos compatibles
  par `…-arbre.json`. Lancé sans `--dry-run` : catalogue chargé, articles créés, rapprochement relancé.
- Code : `src/modules/articles/links-rules.ts`, `links-api.ts`, `links-ui.tsx` (badges), `links-tools.tsx`,
  `unlinked-alert.tsx`, `article-links-panel.tsx` ; `src/routes/_app.parts.links.tsx`. Tests :
  `tests/article-links.test.ts`, `tests/accessories-loader.test.ts`.

**À tester (Simon)** — après application des deux migrations :
- [ ] Pièces & Accessoires : chercher `564P7181AA` (garde-boue, nouvel article du catalogue Ducati) → badge Ducati,
      librairie, prix 242 € TTC.
- [ ] Chercher `981088363` (casque du site) → badges Shopify ; fiche : prix site = PV TTC, stock = stock du site.
- [ ] Filtre Référencé « G8 » puis « Pas sur le site » : les listes changent.
- [ ] Rapprochements → « Produits du site sans article » : « Créer l'article » sur une ligne sans SKU → l'article
      « SHOP-… » s'ouvre ; « Motos du site » : accepter une moto → elle est reliée à sa fiche.
- [ ] Créer un produit test dans Shopify, « Relire Shopify » (Réglages du site) → l'alerte « produit du site sans
      article » apparaît.

## 5 bis. Cartes proposées (22/09)

- **Rattacher à la main les 22 produits du site** dont le SKU est porté par plusieurs produits (écran Rapprochements).
- **Décider du sort des 8 473 références retirées du catalogue** (aujourd'hui : consultables, sans article).
- **Compléter les 1 316 pièces Ducati sans prix** et les **94 produits du site sans SKU** (filtre « à compléter »).
- **Valider les 9 produits du site reliés à une référence remplacée** et les 23 SKU partagés.
- **Relire la « référence de remplacement » du catalogue Ducati** au prochain chargement (5 724 pièces marquées remplacées).

## 6. Risques

- Charge sur le portail Ducati : rythme lent, pas de parallélisme, arrêt au moindre refus.
- Session Ducati expirée pendant l'import : reprise là où on s'est arrêté.
- Images des vues éclatées : volume de stockage (garder le lien, ou copier seulement les planches utilisées).

## Purge du rapprochement — 23/09 (à valider)

Simon, 23/09 : « il faut trouver un moyen de purifier tous ces éléments sans validation humaine,
c'est intenable. » La file des rapprochements « à valider » est passée de **10 251 à 2**.

| Méthode | Avant | Relié d'office | Rejeté (avec la raison) | Reste |
|---|---:|---:|---:|---:|
| `remplacement_dms` (catalogue Ducati) | 8 368 | 0 | 8 368 | 0 |
| `revision` (catalogue Ducati) | 1 743 | 0 | 1 743 | 0 |
| `prefixe_suffixe` (catalogue Ducati) | 3 | 0 | 3 | 0 |
| `creation_sans_sku` (site) | 95 | 93 | 2 | 0 |
| `sku_ambigu` (site) | 23 | 23 | 0 | 0 |
| `remplacement_dms` (site) | 10 | 0 | 9 | 1 |
| `ref_dans_titre` (site) | 9 | 8 | 0 | 1 |
| **Total** | **10 251** | **124** | **10 125** | **2** |

Les causes ont été corrigées, pas seulement les lignes : la règle W-6 est appliquée **en base**
(elle n'existait que dans la lecture Shopify, donc un article créé après la dernière lecture ne
pouvait jamais être relié d'office) ; une référence du catalogue ne reçoit plus de second
candidat ; « sku_ambigu » ne sort que si plusieurs produits portent vraiment le SKU ; les motos du
site ne sont plus proposées à un article pièce. Décisions **M-40 à M-43**,
migrations `20260923140000`, `20260923141000`, `20260923142000` (**appliquées en production**).

Les **2 restants** sont un seul produit du site, en brouillon, dont le titre se réduit à
« 56113651A - » (aucune désignation, prix 162,25 € contre 50,53 € côté DMS) : deux articles se
le disputent (56113651A, cité dans le titre, et 56113033A, son remplacement). C'est le seul cas
où la machine refuse de trancher.
