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
| 3 bis | Importer les catalogues accessoires et vêtements Ducati | relier les produits Shopify « 98… » (1 994 sans article) | 🟦 base prête le 21/09 (tables, fonctions, recherche par référence) ; chargeur à brancher sur le format de fichier annoncé (§5) |
| 4 | Reconnaître exactement la moto du client par son VIN | « quand le client s'inscrit, tout est lié » | fiche moto, borne, espace client, motos déclarées (mission 04) ; rattachement en lot des 3 299 motos |
| 5 | Choisir les pièces sur la vue éclatée de la moto dans le devis et l'OR | remplace le copier-coller e-catalog (mission 05, carte 4) | devis/OR : planches de SA variante, clic sur un repère = ligne |
| 6 | Tenir le catalogue à jour | nouveaux millésimes, remplacements | relecture ciblée (drapeau `updated` de l'API) |

## 4. Décisions (Simon, 21/09)

- **Europe seulement** (variantes des autres marchés exclues).
- **Millésimes depuis 2000.**
- **Import par une extension Chrome** (principe My Ducati : lit avec la session de l'utilisateur, aucun identifiant stocké, envoie au DMS, rythme lent, reprise après interruption).

## 4 bis. Questions (répondues le 21/09)

1. Périmètre : variantes Europe seulement ? *Reco : oui, les autres marchés plus tard si besoin.*
2. Années : tout, ou 2005+ d'abord ? *Reco : les modèles du parc + la gamme actuelle d'abord, puis le reste.*
3. Mode d'import : *Reco : l'extension navigateur (même principe que My Ducati) lit avec la session de
   l'utilisateur connecté, n'enregistre aucun identifiant, envoie au DMS ; rythme lent (~1 page/s),
   planches communes lues une seule fois ; reprise possible après interruption.*

## 5. Ce qui a changé dans l'application

### 21/09 — Cartes 2 et 3 (+ base de la carte 3 bis)

**Pour l'utilisateur**
- **Pièces & Accessoires → Catalogue Ducati** (`/parts/catalog`) : onglet **Parcourir** (famille → modèle
  → millésime → vues éclatées → pièces) avec l'**image de la vue éclatée et ses repères cliquables** (clic
  sur un repère = la pièce est surlignée dans la liste) ; pour chaque pièce : repère, référence (et
  « remplacée par »), désignation, quantité, **prix Ducati HT pour information**, **article du DMS
  correspondant** (lien vers la fiche) et sa **disponibilité** (disponible / en commande / à commander,
  même calcul que les ventes). Onglet **État de l'import** : compteurs (modèles, modèles-années complets,
  vues, lignes, références) et lots d'import (qui, quand, état, compteurs, dernière activité, message).
- Premier remplissage par **fichiers d'extraction + chargeur** (décision M-16) : guide
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
- Tables **globales** (décision M-18), lecture équipe (`ducati_catalog_is_staff`), écriture uniquement par
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

## 5 bis. Cartes proposées (21/09)

- **Créer ou relier les articles DMS depuis le catalogue accessoires et vêtements** (les 1 994 produits
  Shopify « 98… » : liaison exacte automatique, le reste à valider, règle W-6) — décision de Simon.
- **Tenir le catalogue à jour avec l'extension** : essai réel de l'extension sur quelques modèles, puis
  relecture ciblée des nouveaux millésimes (drapeau `updated` de l'API) — ex-carte 6, rendue possible.
- **Copier dans le DMS les vues éclatées utilisées** (si les images Ducati deviennent inaccessibles).
- **Rattacher les modèles-années du catalogue au décodage VIN** (`genericSearch` / `modelYearByVin` de
  l'API) — c'est la carte 4.

## 6. Risques

- Charge sur le portail Ducati : rythme lent, pas de parallélisme, arrêt au moindre refus.
- Session Ducati expirée pendant l'import : reprise là où on s'est arrêté.
- Images des vues éclatées : volume de stockage (garder le lien, ou copier seulement les planches utilisées).
