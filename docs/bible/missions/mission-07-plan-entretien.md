---
mission: 07
titre: Plan d'entretien
etat: 🟦
ouverte_le: 2026-09-21
modules: [M08, M03, M06, M09, M10, M01]
---

# Mission 07 — Plan d'entretien

> **Objectif** : pour chaque moto, savoir quel entretien est dû, ce qu'il contient (opérations, pièces),
> combien de temps il prend et combien il coûte — pour proposer le bon entretien au client, bloquer le
> bon temps au planning et sortir le devis en un clic. Liée à la mission 06 (catalogue).

Liste ERP : « Mission 07 — Plan d'entretien » (`e44cc05b-8c50-4e08-9ae6-525d77cb423b`).
Demande de Simon du 21/09 (chat).

## 1. Le besoin (Simon, 21/09)

« En connaissant le temps par entretien, on peut prévoir le devis et le temps bloqué dans l'atelier… quand
le client enregistre sa moto, on peut lui demander quand il a fait les derniers entretiens prévus, et ses
km, pour savoir quoi lui proposer. » Couvre les exigences atelier **ATE013** (kits) et **ATE014**
(nomenclatures d'entretien automatiques modèle + km), manquantes jusqu'ici (voir M08).

## 2. Existant réutilisé

Variantes et pièces du catalogue (mission 06) ; entretiens My Ducati (`vehicle_maintenance`) ; OR et
historique atelier ; demandes de RDV du portail et planning (M08) ; lignes main-d'œuvre et devis (mission 05) ;
motos déclarées et « Ajouter ma moto » (mission 04) ; cloche par rôle.

## 3. Cartes

| # | Carte | Dépend de |
|---|---|---|
| 1 | Plans d'entretien par modèle et par année — 🟦 fait le 21/09, à valider (§5) | 06-2 |
| 2 | Forfaits d'entretien avec pièces, temps et devis automatique | 07-1, 06-3 |
| 3 | Lier nos documents d'entretien au modèle | 06-2 |
| 4 | Prochain entretien de chaque moto | 07-1, 06-4 |
| 5 | Demander km et derniers entretiens quand une moto est enregistrée | 07-4 |
| 6 | Rendez-vous d'entretien avec temps bloqué et devis estimé | 07-2 |
| 7 | Relances d'entretien (cloche d'abord ; mail/SMS quand les services seront choisis) | 07-4 |
| 8 | Parcours d'entretien pas à pas pour le technicien (tablette atelier) — 🟦 fait le 23/09, à valider (§5) | 07-1, 06-4, lot-manuels |

## 4. Décisions (Simon, 21/09)

- Documents reçus le 21/09 (30 PDF, dossier « uploads de whatsapp\fiches entretien ») ; extraction dans
  `C:\Users\simon\Desktop\ducati\entretiens-extraits\` (plans, échéances, opérations, temps, avec source).
- Les posters « Entretien Transparent » donnent des **temps** officiels Ducati (pas des prix) : prix = temps × taux horaire.
- **Taux horaire atelier exprimé HT** (valeur à saisir dans Paramètres).
- En cas de contradiction entre documents, **le plus récent fait foi** (l'ancien gardé en historique).
- **Échéance = le premier atteint (km ou mois)**, partout.
- **Plans piste / racing aussi dans le DMS**, avec un **usage** (route / piste amateur / racing) choisi par le client : l'entretien dépend de l'usage.
- Pièces, quantités et prix ne sont dans aucun document : ils viendront du catalogue (mission 06).
- **Taux horaire atelier : 90 € HTVA** (Simon, chat du 21/09, décision M-20). À enregistrer dans
  Paramètres → Tables → Frais de devis atelier → ligne « diagnostic » → Tarif horaire HTVA.
- **Monster V2, DesertX V2, Hypermotard V2** = trois **nouveaux modèles, millésime 2026 et suivants**
  (Simon, chat du 21/09, décision M-20) ; correction appliquée au chargement
  (`tools/maintenance-loader/corrections.mjs`).

## 4 bis. Questions (anciennes)

1. Documents d'entretien Ducati : lesquels avez-vous (manuels d'atelier, plans d'entretien par modèle) ? À déposer sur la carte 1.
2. Temps d'entretien : barème Ducati (« tempario », indicateur vu dans l'e-catalog) ou vos temps réels issus des OR ? *Reco : barème Ducati s'il est accessible, sinon temps réels.*

## 5. Ce qui a changé dans l'application

### 21/09 — Carte 1 « Plans d'entretien par modèle et par année » (ATE014)

**Pour l'utilisateur**
- **Atelier → Plans d'entretien** (`/workshop/maintenance-plans`, bouton sur la liste des OR) :
  compteurs (plans par usage, échéances, temps en vigueur, taux horaire HT ou « À saisir ») ;
  onglet **Plans** : filtre famille / usage / texte ; pour chaque plan, les modèles et années, l'usage
  (route / piste amateur / racing), la liste des contrôles et les documents sources ; les **échéances**
  (1 000 km, Oil, Desmo / Valve Check, Annual, opérations supplémentaires, paliers piste) avec leur
  intervalle **au premier atteint** (km ou mois), le **temps Ducati en vigueur**, la **main-d'œuvre HT =
  heures × taux**, les **opérations** (texte du document) et l'**historique** des anciennes valeurs
  (« remplacé par … ») ; les **modèles du catalogue Ducati rattachés** avec **Rattacher / Détacher** et
  une recherche pour rattacher un modèle (un millésime ou tous) ; bouton **Proposer les rattachements**
  (relançable quand le catalogue sera chargé) ; onglet **Couverture du catalogue** (modèles-années
  Europe depuis 2000 sans plan).
- **Fiche moto** : panneau **Plan d'entretien** — si la moto est rattachée à un modèle-année du
  catalogue, le plan de son **usage** (route par défaut, choix enregistré sur la moto), ses échéances,
  temps et prix ; sinon un message clair. Le rattachement moto ↔ catalogue viendra de la carte 06-4
  (reconnaissance par le VIN) : la colonne est prête, **pas encore remplie**.

**Données chargées en production (21/09)** : 30 documents sources, 29 listes des contrôles, **59 plans**
(53 route, 1 piste amateur, 5 racing), 456 échéances, 609 intervalles (252 en vigueur), 3 743 opérations,
**1 292 temps (425 en vigueur)**. Aucun prix, aucune pièce : rien n'est inventé, chaque valeur garde sa
source (fichier, page, édition). Catalogue Ducati vide ce jour → **0 rattachement** pour l'instant.

**Technique**
- Migrations (testées en transaction annulée, appliquées le 21/09) :
  `20260921130000_m8_plans_entretien` (tables globales `maintenance_*` comme le catalogue — décisions M-19, M-21 —,
  lecture équipe, écriture par `maintenance_ingest` : clé de service ou administrateur ; `maintenance_stats` ;
  `maintenance_hourly_rate_ht` = réglage existant « Frais de devis atelier → diagnostic → hourly_rate_ht »,
  repli article MO, null si 0),
  `20260921131000_m8_plans_entretien_catalogue` (`maintenance_plan_catalog_links` lie / a_valider / rejete,
  `maintenance_propose_catalog_links`, `maintenance_link_set`, `maintenance_catalog_coverage`,
  colonnes `vehicles.ducati_model_year_id` et `vehicles.maintenance_usage`). Une ligne `events` par
  chargement, proposition, rattachement ou détachement.
- **Chargeur** `tools/maintenance-loader/` : `node tools/maintenance-loader/load.mjs` (dossier par défaut
  `Desktop/ducati/entretiens-extraits`) ; idempotent (empreinte par plan, clé de contenu par ligne) :
  relancé à l'identique → « inchangés : 59 ». Corrections de Simon dans `corrections.mjs`.
- **Proposition de rattachement prudente** : même famille, nom de modèle (noms déduits du texte du document,
  `match_names`), millésime dans la plage du plan ; nom exact + plage connue + un seul plan du même usage
  = « lié », sinon « à valider » ; un détachement n'est jamais recréé.
- Tests : `tests/maintenance-plans.test.ts` (premier atteint, valeur en vigueur, prix = heures × taux HT,
  usage), `tests/maintenance-loader.test.ts` (extrait réel de 6 plans, `tests/fixtures/plans-entretien`).

### 23/09 — Carte 8 « Parcours d'entretien pas à pas » (ATE011 + ATE014, B11 étage 3)

**Pour l'utilisateur**
- **Fiche OR → bouton « Démarrer le parcours d'entretien »** (`/workshop/journey/$orId`) : écran
  plein cadre pensé pour une **tablette à l'atelier** (boutons ≥ 44 px, texte 15–16 px, portrait ou
  paysage, barre d'action au pouce).
- **Choix de l'entretien dû** : les entretiens du programme de la moto (Oil Service, Desmo Service,
  Annual Service…) avec l'échéance **au premier atteint** (km ou mois), le nombre d'opérations et le
  **temps officiel Ducati** (UT). Le plus urgent est proposé en premier.
- **Liste des opérations** de l'entretien : chacune se coche, ouvre sa **procédure du manuel** et a
  son **chrono** (un seul tourne à la fois). Une opération **sans procédure** reste dans la liste avec
  une simple case — elle ne bloque jamais.
- **Procédure pas à pas** : étapes numérotées et cochables, **figures grandes et zoomables**
  (plein écran, ×2,5), **couples de serrage mis en avant** (valeur Nm + repère de la figure),
  **Attention / Important / Remarque / Élimination** distingués par couleur et icône, outils
  spéciaux, produits, sous-étapes, renvois vers les procédures liées, et la **source** du manuel
  (code, version, date).
- **Observation, pièce à remplacer, photo** à tout moment (sur une étape ou sur le parcours) ; la
  photo est réduite avant enregistrement.
- **Reprise après coupure** : l'avancement est enregistré à chaque geste ; à la réouverture, l'écran
  revient sur l'opération et l'étape non terminées (« Reprendre ici »).
- **Récapitulatif** : opérations faites / restantes, **temps passé**, **temps Ducati (UT)**, **temps
  facturé** et les deux écarts (B11 étage 3), pièces, observations, photos. Le bouton
  **« Reporter sur l'OR »** ajoute les pièces (**à 0 €**) et les observations en lignes d'OR et note
  l'entretien dans les travaux. **Rien n'est facturé automatiquement.**

**Données**
Écran alimenté par des **données de démonstration** extraites des manuels d'atelier Ducati :
**2 motos** (DESERTX 2023 — modèle-année 398 —, PANIGALE V4 S 2024 — 1190), **19 procédures**,
**315 étapes**, couples, outils, produits, avertissements et **temps UT**. Aucune valeur inventée :
chaque procédure garde son manuel, son code WSM, sa version et sa date. Les **figures** (≈ 300 Mo)
ne sont pas dans le dépôt : `node tools/journey-demo/copy-images.mjs` les copie dans
`public/manuels/` (ignoré par git) ; sans elles l'écran affiche « figure non disponible » et reste
utilisable.

**Technique**
- Couche d'accès `src/modules/workshop/journey/source.ts` : **bascule automatique**
  démonstration ↔ base. Dès que les tables du lot `lot-manuels` existent (`MANUAL_TABLES`, sondées
  une fois par session), l'écran lit la base sans autre changement. **À brancher** : les trois
  fonctions de `baseSource` et les noms de colonnes.
- Règles pures `journey/rules.ts` (aucun accès base) : familles d'entretien (« First Service 1000 »
  = « Oil Service 1000 » = « Service 1000 » ; « Temporel » = « Annual Service »), entretien dû
  (réutilise `nextDue`), construction du parcours opérations ↔ procédures, avancement, chronos,
  **1 UT = 6 minutes**, comparaison des temps, lignes proposées à l'OR.
- Avancement : écrit **dans la tablette à chaque geste** (résiste à une coupure) et **recopié en
  base** quand elle répond ; à la reprise, la version la plus récente gagne.
- Migration **non appliquée** `20260923110000_m8_parcours_entretien.sql` : table
  `workshop_journeys` (un parcours par OR, état complet en jsonb, `company_id` + RLS + audit),
  colonne `workshop_time_entries.journey_operation` (B11 étage 3), fonction `or_journey_minutes(or)`.
  Tant qu'elle n'est pas appliquée, l'écran le dit et tout vit dans la tablette.
- Outils : `tools/journey-demo/build.mjs` (fabrique `public/demo/parcours-entretien.json`, 213 Ko)
  et `tools/journey-demo/copy-images.mjs` (figures d'un service).
- Tests : `tests/workshop-journey.test.ts` — 55 tests, dont 8 sur les **vraies données** des manuels.

## 5 bis. Cartes proposées (21/09)

- **Prochain entretien de chaque moto** (= carte 4) : la règle `nextDue` (premier atteint, rythme de
  roulage) est prête et testée ; il reste à lire les derniers entretiens (OR, My Ducati) et le km.
- **Rattacher les modèles du catalogue aux plans** : une fois le catalogue chargé, lancer « Proposer les
  rattachements » puis valider les « à valider » (écran prêt).
- **Temps pour les plans sans temps** (Monster V2, DesertX V2, Hypermotard V2, MY26) : poster
  « Entretien Transparent » 2026 à demander à Ducati quand il sortira.

## 5 ter. Cartes proposées (23/09)

- **Brancher le parcours sur les manuels complets** (dès que `lot-manuels` est en base) : trois
  fonctions à écrire dans `journey/source.ts`, plus le stockage des figures (`VITE_MANUELS_BASE`).
- **Appliquer la migration des parcours** (`20260923110000_m8_parcours_entretien.sql`) pour que
  l'avancement d'un technicien soit visible par le chef d'atelier et suive la tablette.
- **Photos du parcours dans la GED** : aujourd'hui elles restent dans le parcours ; les verser dans
  les pièces jointes de l'OR (`AttachmentsPanel`, ATE007).
- **Rapprochement B11 complet** : brancher les chronos du parcours sur `workshop_time_entries`
  (colonne `journey_operation` prête) pour que la pointeuse et le parcours ne comptent qu'une fois.
- **Pièces à remplacer reliées au catalogue** : aujourd'hui référence + texte libre à 0 € ; les
  chercher dans les articles (mission 06) pour sortir un devis complémentaire (ATE009).
- **Derniers entretiens de la moto** : le choix de l'entretien dû part de la mise en service ; avec
  l'historique des OR et My Ducati (carte 4), il partirait du dernier entretien réel.
