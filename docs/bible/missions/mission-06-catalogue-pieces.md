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
| 2 | Importer les modèles Ducati par année | « connaître à 100 % la moto » | tables catalogue (famille, cylindrée, modèle, variante, millésime) reliées au décodage VIN existant (`ducati_vds`, `ducati_vin_facts`) |
| 3 | Importer les vues éclatées et les pièces de chaque modèle | savoir quelles pièces vont sur quelle moto | planches + repères + pièces, liées aux articles (librairie) ; le prix du tarif importé fait foi |
| 4 | Reconnaître exactement la moto du client par son VIN | « quand le client s'inscrit, tout est lié » | fiche moto, borne, espace client, motos déclarées (mission 04) ; rattachement en lot des 3 299 motos |
| 5 | Choisir les pièces sur la vue éclatée de la moto dans le devis et l'OR | remplace le copier-coller e-catalog (mission 05, carte 4) | devis/OR : planches de SA variante, clic sur un repère = ligne |
| 7 | Importer les catalogues accessoires et vêtements Ducati | 1 994 produits Shopify « 98… » absents du DMS (mission 03, Q5) | même extension ; API `api/accessories/…` (catégories, familles propres, fiches produit) et `api/apparel/…` (catégories, familles, genres) ; relie ensuite les produits Shopify (W-6) |
| 6 | Tenir le catalogue à jour | nouveaux millésimes, remplacements | relecture ciblée (drapeau `updated` de l'API) |

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

(rempli à chaque lot livré)

## 6. Risques

- Charge sur le portail Ducati : rythme lent, pas de parallélisme, arrêt au moindre refus.
- Session Ducati expirée pendant l'import : reprise là où on s'est arrêté.
- Images des vues éclatées : volume de stockage (garder le lien, ou copier seulement les planches utilisées).
