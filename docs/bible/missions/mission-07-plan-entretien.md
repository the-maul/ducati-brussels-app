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
| 3 | Lier nos documents d'entretien au modèle — 🟦 fait le 23/09, à valider (§5) : manuels d'atelier chargés, onglet « Manuels d'atelier » | 06-2 |
| 4 | Prochain entretien de chaque moto | 07-1, 06-4 |
| 5 | Demander km et derniers entretiens quand une moto est enregistrée | 07-4 |
| 6 | Rendez-vous d'entretien avec temps bloqué et devis estimé | 07-2 |
| 7 | Relances d'entretien (cloche d'abord ; mail/SMS quand les services seront choisis) | 07-4 |

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

### 23/09 — Carte 3 « Lier nos documents d'entretien au modèle » (ATE014) — manuels d'atelier

**Pour l'utilisateur**
- **Atelier → Plans d'entretien**, nouvel onglet **Manuels d'atelier** : la liste des **469
  modèles-années** couverts par un manuel d'atelier Ducati (filtre famille + recherche), et pour
  chacun son **programme d'entretien officiel** — les échéances avec leur km / mi / mois **au premier
  atteint**, le nombre d'opérations, le nombre de procédures et le **temps réel du manuel en UT**
  (1 UT = 6 min) —, les **modèles du catalogue rattachés** et la source (fichier de l'extraction).
- C'est un **écran de vérification**, pas encore le parcours technicien : les étapes, les figures et
  les couples pas à pas viendront sur une autre branche.

**Données chargées en production le 23/09** (extraction locale `Desktop/ducati/manuels-extraits`,
accord Ducati) : **461 manuels d'atelier couvrant 469 modèles-années** (2012-2027) ·
**1 949 échéances** · **28 988 opérations** · **3 336 procédures uniques** (**36 326 étapes**,
**5 764 couples**) pour **22 864 usages** · **14 363 procédures rattachées à une échéance** ·
**1 783 temps en UT** · 917 tableaux de couples généraux (**147 976 lignes**) · 1 273 jeux d'outils
(21 291 lignes) · 460 tableaux de ravitaillements (3 068 lignes) · 406 tableaux de produits
(19 514 lignes) · **26 384 images citées (12,75 Go)**, hors dépôt et hors base.

**Rattachement au catalogue** : 138 par identifiant e-catalog + 280 par nom et millésime = **418
rattachés fermement sur 461**, **9 à valider** (ABS / non-ABS, 2G / 3G), **34 sans correspondance**
(le catalogue ne contient pas encore ces modèles-années). Voir décision M-28.

**Technique**
- Migrations **écrites, testées en transaction annulée, PAS appliquées** :
  `supabase/migrations/20260923100000_m8_manuels_atelier.sql` (15 tables `wsm_*` globales, RLS
  lecture équipe, écriture par clé de service ou administrateur) et
  `supabase/migrations/20260923101000_m8_manuels_atelier_chargement.sql` (`wsm_ingest_procedures`,
  `wsm_ingest_manuals`, `wsm_ingest_images`, `wsm_propose_catalog_links`, `wsm_link_set`,
  `wsm_stats`, `wsm_manual_list`, `wsm_manual_overview`). Une ligne `events` par appel du chargeur,
  jamais par ligne (`wsm_procedures_loaded`, `wsm_manuals_loaded`, `wsm_images_indexed`,
  `wsm_links_proposed`, `wsm_manual_linked` / `_unlinked`).
- **Chargeur** `tools/wsm-loader/` (`transform.mjs` pur et testé, `load.mjs`, `images.mjs`,
  `env.mjs`) : lecture en flux (un fichier à la fois), idempotent — empreinte par modèle-année et
  par procédure, clé de contenu par ligne. Essai à blanc complet en **6 s** sur les vrais fichiers.
- **Vitesse mesurée aux volumes réels** (jeu complet simulé, transaction annulée) :
  `wsm_manual_list` 38 ms sur les 469, 7 ms filtrée · `wsm_manual_overview` 11 ms · `wsm_stats` 15 ms.
  Très en dessous du `statement_timeout` de 8 s.
- Tests : `tests/wsm-loader.test.ts` (26 tests, extraits **réels** en fixture dans
  `tests/fixtures/manuels-atelier/` — un manuel à révisions nommées, un manuel en grille
  kilométrique, une procédure ; aucune donnée personnelle).

### 23/09 (soir) — Chargement en production et branchement du parcours technicien

**Chargement fait.** Le premier chargement s'arrêtait sur « fetch failed » : PostgREST coupe toute
requête à 8 s, même avec la clé de service (décision M-32). Le chargeur borne désormais ses lots,
**coupe en deux** un lot trop long, réessaie avec attente doublée, affiche l'erreur complète et tient
un **journal de reprise**. Vérifié : les 3 175 procédures déjà écrites avaient toutes la bonne
empreinte, rien à nettoyer, la reprise a simplement ajouté les 161 manquantes.

**En base aujourd'hui** : 461 manuels · 3 336 procédures · 36 326 étapes · 5 764 couples ·
22 864 usages · 1 949 échéances · 28 988 opérations · 14 363 procédures par échéance ·
1 783 temps UT · 917 tableaux de couples (147 976 lignes) · 1 273 jeux d'outils · 460
ravitaillements · 406 tableaux de produits.

**Reste à appliquer** (migrations écrites et vérifiées en transaction annulée, **non appliquées**) :
`20260923102000_m8_manuels_atelier_modeles_couverts.sql` (un manuel couvre plusieurs
modèles-années, M-31, + la règle de rapprochement des noms qui donne 418 rattachements au lieu de
253) et `20260923103000_m8_manuels_atelier_vues_parcours.sql` (les trois vues du parcours
technicien, M-33). Puis :
`node tools/wsm-loader/load.mjs --only manuals --force` et
`node tools/wsm-loader/load.mjs --links --company 3d9f0f13-a691-4d07-ad58-34590df86e33`.

**Branchement de l'écran « parcours technicien »** (branche `lot-manuels-branchement`) : les trois
vues portent exactement les noms de `MANUAL_TABLES` et les formes de `journey/types.ts`, donc
`source.ts` bascule tout seul de la démonstration à la base. Deux corrections y sont faites :
`getProcedure` lit `etapes` directement dans la vue (plus de ressource imbriquée PostgREST), et
`listPrograms` ne prend que l'identité des modèles-années — le `select('*')` d'origine ramenait
**6,47 Mo** pour 461 lignes alors que la liste n'est affichée qu'en mode démonstration.

## 5 bis. Cartes proposées (21/09)

- **Prochain entretien de chaque moto** (= carte 4) : la règle `nextDue` (premier atteint, rythme de
  roulage) est prête et testée ; il reste à lire les derniers entretiens (OR, My Ducati) et le km.
- **Rattacher les modèles du catalogue aux plans** : une fois le catalogue chargé, lancer « Proposer les
  rattachements » puis valider les « à valider » (écran prêt).
- **Temps pour les plans sans temps** (Monster V2, DesertX V2, Hypermotard V2, MY26) : poster
  « Entretien Transparent » 2026 à demander à Ducati quand il sortira.
