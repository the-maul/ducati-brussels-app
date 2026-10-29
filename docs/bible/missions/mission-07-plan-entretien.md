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
| 2 | Forfaits d'entretien avec pièces, temps et devis automatique — 🟦 fait 23/09 (kits, picking list, commande) | 07-1, 06-3 |
| 3 | Lier nos documents d'entretien au modèle — 🟦 fait le 23/09, à valider (§5) : manuels d'atelier chargés, onglet « Manuels d'atelier » | 06-2 |
| 4 | Prochain entretien de chaque moto — 🟦 fait le 31/10, à valider (§5) : échéance et source sur la fiche moto, extract DCS importable en un clic, `vehicles_maintenance_upcoming` pour les relances | 07-1, 06-4 |
| 5 | Demander km et derniers entretiens quand une moto est enregistrée — 🟦 fait le 31/10, à valider (§5) : espace client, inscription, borne, fiche moto | 07-4 |
| 6 | Rendez-vous d'entretien avec temps bloqué et devis estimé — 🟦 **réorientée le 30/10 (M-72)** : pas de liste de rendez-vous hypothétiques pour l'atelier ; le rendez-vous naît de la réponse du client à la relance (lien « Prendre rendez-vous » du mail → demande de RDV du portail, moto présélectionnée) et **ferme la relance** ; fait le 31/10, à valider (§5) | 07-2 |
| 7 | Relances d'entretien — 🟦 **fait le 31/10, à valider (§5)** : mails automatiques préparés par le marketing (entretien dû −15 j, intervention reportée à la date fixée), J+5 sans réponse → CRM commercial « à rappeler » (M-72) ; SMS toujours en attente d'un fournisseur | 07-4 |
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
### 23/09 — Carte 3 « Lier nos documents d'entretien au modèle » (ATE014) — manuels d'atelier

**Pour l'utilisateur**
- **Atelier → Plans d'entretien**, nouvel onglet **Manuels d'atelier** : la liste des **469
  modèles-années** couverts par un manuel d'atelier Ducati (filtre famille + recherche), et pour
  chacun son **programme d'entretien officiel** — les échéances avec leur km / mi / mois **au premier
  atteint**, le nombre d'opérations, le nombre de procédures et le **temps réel du manuel en UT**
  (1 UT = 6 min) —, les **modèles du catalogue rattachés** et la source (fichier de l'extraction).
- C'est un **écran de vérification**, pas encore le parcours technicien : les étapes, les figures et
  les couples pas à pas viendront sur une autre branche.

**Données prêtes à charger** (extraction locale `Desktop/ducati/manuels-extraits`, accord Ducati) :
**469 modèles-années** (2012–2027) · **1 984 échéances** · **29 403 opérations** ·
**3 336 procédures uniques** (**36 326 étapes**, **5 764 couples**) pour **23 211 usages** ·
**14 681 procédures rattachées à une échéance** · **1 843 temps en UT** ·
933 tableaux de couples généraux (**150 356 lignes**) · 1 297 jeux d'outils (21 610 lignes) ·
468 tableaux de ravitaillements (3 123 lignes) · 414 tableaux de produits (19 939 lignes) ·
**26 384 images citées (12,75 Go)**, hors dépôt et hors base.

**Rattachement au catalogue** : 138 par identifiant e-catalog + 288 par nom et millésime = **426
rattachés fermement**, **9 à valider** (ABS / non-ABS, 2G / 3G), **34 sans correspondance** (le
catalogue ne contient pas encore ces modèles-années). Voir décision M-28.

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

### 31/10 — Cartes 4 et 5 « Prochain entretien de chaque moto » et « Demander km et derniers entretiens » (ATE014) — à valider

> Décision de Simon du 30/10 (parcours « entretien ») : **chaque moto doit avoir une date de prochain
> entretien connue, avec sa source**, pour alimenter les relances marketing (page Relances, M10) et
> l'accueil atelier (M8). Décisions M-73 et M-74.

**Pour l'utilisateur**
- **Fiche moto → encadré « Prochain entretien »** : « Annuel — avant le 14/05/2026 » avec son état
  (badge **dépassé de 169 j** / **dans n j** / km atteint), le km d'échéance s'il est connu (« ou
  27 000 km »), la **source** (OR facturé dans le DMS, facture G8 relue, déclaré par le client,
  extract DCS du … ligne n, plan Ducati) et le dernier entretien connu ; bouton **Recalculer** ;
  bloc **« Déclaré par le client »** (km actuel, date et km du dernier entretien, chez nous /
  ailleurs / je ne sais pas) modifiable par l'équipe, chaque enregistrement relance le calcul.
- **Atelier → Plans d'entretien → onglet « Extract DCS »** : bouton **« Importer l'extract DCS »**
  (fichier « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR » sorti de DCS, feuille Export, lu dans
  le navigateur comme l'import de tarif) → **Vérifier (essai à blanc)** : lignes lues, doublons du
  fichier, motos connues / inconnues du DMS (liste des VIN inconnus dépliable), lignes déjà importées,
  propriétaires avec e-mail → **Importer**. Relançable chaque mois : un VIN déjà importé pour la même
  date et le même type n'entre pas deux fois. Liste des extracts déjà importés. Bouton **« Recalculer
  toutes les motos »** (par lots de 200). Administrateur ou chef d'atelier.
- **Espace client → Mes motos → fiche d'une moto** : carte **« Prochain entretien »** (date, état,
  bouton « Prendre rendez-vous pour cet entretien » quand c'est dans 60 jours ou dépassé — jamais la
  source technique) et le formulaire **km actuel / dernier entretien (date, km, chez nous / ailleurs /
  je ne sais pas)** → la fiche est mise à jour et l'échéance recalculée.
- **« Ajouter ma moto » (espace client), inscription en ligne et borne** : mêmes champs, facultatifs,
  sous le choix de la moto ; enregistrés avec la moto déclarée (`contact_declared_vehicles.mileage_km`,
  `last_services`) et **recopiés sur la fiche à la validation** par l'équipe (ou à la validation d'office
  M-63), seulement dans les champs vides.

**La règle (M-73, M-74)**
- Sources, par ordre de confiance : **1. OR facturé du DMS** dont une ligne (ou les travaux) est un
  entretien ; **2. facture G8 relue** (`documents` / `document_lines`, 89 853 lignes) avec une ligne
  d'entretien ; **3. déclaration du client** ; **4. extract DCS** (date planifiée = la vérité, dernier
  entretien = − 12 mois, ou − 6 mois pour le premier) ; **5. plan seul** : aucun entretien connu,
  seulement une date de départ (début de garantie, puis mise en circulation).
- Entre 1 et 4, **le dernier entretien le plus récent gagne** ; à date égale, l'ordre de confiance.
  Prochain = dernier + **12 mois** ; premier entretien = début de garantie + **6 mois** ou **1 000 km** ;
  km d'échéance = km du dernier entretien + intervalle de la vidange du plan de la moto **si le plan est
  rattaché** (rien n'est inventé sinon). **Au premier atteint** (M-16) : date ou km (km déclaré ou constaté).
- Plan seul : 6 mois puis tous les 12 mois, en gardant une **fenêtre de retard de 180 jours** (celle de
  l'extract DCS) ; source « plan » = estimation, à filtrer dans les relances si on veut du sûr.
- Un entretien dans un libellé de facture : « VIDANGE », « ENTRETIEN SF V2 », « RODAGE 1000 KM »,
  « REVISION 30.000 KM », « Oil/Annual/Desmo Service » oui ; « BOUCHON VIDANGE HUILE », « KIT DE REVISION
  DE PIVOTS », « SERVICE BOOKLET », « T-SHIRT DESMO », « MANUEL D'UTILISATION ET ENTRETIEN » non (vérifié
  sur les libellés réels G8 : sans ces exclusions, les pièces et le merchandising passaient pour des entretiens).

**Mesuré en transaction annulée sur la base de production (31/10)** : 3 364 motos, 3 324 avec VIN,
26 avec début de garantie, 2 843 avec mise en circulation, 6 527 factures G8 rattachées à une moto mais
**37 lignes d'entretien seulement** (G8 facturait surtout des pièces), 1 OR facturé, 0 entretien My Ducati.
Extract DCS du 29/10 : **228 lignes** (143 Annual Service, 73 Oil Service, 12 Oil Service 1000 km),
échéances du 14/05/2026 au 26/04/2027, **223 motos connues** par leur VIN. Sur un lot de 300 motos :
255 avec une échéance (254 « plan », 1 « extract DCS »).

**Technique**
- Migration **écrite, testée en transaction annulée, PAS appliquée** :
  `supabase/migrations/20261031100000_m8_prochain_entretien.sql` — colonnes `vehicles.last_service_at`,
  `last_service_km`, `last_service_where` (ici / ailleurs), `declared_km`, `declared_km_at` ; tables
  `vehicle_maintenance_due` (une ligne courante par moto et par kind, historique conservé, RLS lecture
  équipe / écriture admin, audit) et `dcs_maintenance_imports` (dépôt de l'extract, unique VIN + date +
  type) ; fonctions `maintenance_label_is_service(text)`, `vehicle_maintenance_recompute(_company,
  _vehicle)`, `vehicle_maintenance_recompute_batch(_company, _after, _limit)`,
  **`vehicles_maintenance_upcoming(_company, _days)`** (signature et colonnes figées pour la page
  Relances : `vehicle_id, vin, model_label, contact_id, contact_name, email, phone, locale, kind,
  due_date, due_km, days_left, source` ; `days_left` négatif = dépassé ; `locale` lue de façon tolérante),
  `dcs_maintenance_import(_company, _file, _rows, _apply)`, `dcs_maintenance_import_files` ; déclencheurs
  (moto modifiée, OR passé « facturé », moto déclarée rattachée) ; espace client
  `portal_vehicle_service_declare`, `portal_declaration_service_set`, `portal_vehicle` enrichi
  (`maintenance_due`, `declared_km`, `last_service_*`).
- Règles pures `src/modules/workshop/maintenance-due.ts` (miroir TypeScript des fonctions SQL : libellé,
  type DCS, + 12 mois / + 6 mois, plan seul, premier atteint, parseur de la feuille Export, dédoublonnage) ;
  accès base `maintenance-due-api.ts` (sans typage généré tant que la migration n'est pas appliquée,
  `isMissingSchema` → message clair) ; écrans `vehicle-next-service-panel.tsx` (fiche moto),
  `dcs-import-panel.tsx` (onglet Extract DCS) ; composant partagé
  `src/components/service-declaration-fields.tsx` (inscription, borne, espace client) ; espace client
  `src/modules/portal/next-service-card.tsx` ; inscription `signup-form.tsx` + `signup.functions.ts`
  (champ `service`, posé sur la moto déclarée après `signup_register`).
- Scripts : `tools/migration/import_dcs_entretiens.py "<fichier.xlsx>" [--apply]` (essai à blanc par
  défaut, même fonction SQL que le bouton, rapport motos connues / inconnues, VIN inconnus, propriétaires
  avec e-mail, lignes déjà importées) ; `tools/migration/recalculer_entretiens.py [--apply]` (état des lieux,
  puis recalcul par lots des 3 364 motos avec le compte par source). **Le fichier DCS n'est jamais commité.**
- Tests : `tests/maintenance-due.test.ts` (40 cas : + 12 / + 6 mois, fin de mois, plan seul, premier
  atteint, choix du dernier entretien, 9 libellés positifs et 14 négatifs réels, parseur sur des lignes et
  sur un petit xlsx fabriqué en mémoire, dédoublonnage).

### À tester (cartes 4 et 5)

1. Appliquer la migration `20261031100000_m8_prochain_entretien.sql` (essai à blanc d'abord, voir
   00-architecture §), puis `python tools/migration/recalculer_entretiens.py --apply`.
2. **Atelier → Plans d'entretien → Extract DCS** : choisir le fichier « ENTRETIEN EN RETARD 180 JOURS +
   6 MOIS A VENIR.xlsx » → **Vérifier** : 228 lignes, 223 motos connues, VIN inconnus listés →
   **Importer**. Relancer le même fichier : tout doit être « déjà importé ».
3. Ouvrir la fiche d'une moto de l'extract (Véhicules → recherche par VIN) : encadré **Prochain
   entretien** « Annuel — avant le 14/05/2026 — dépassé de n j — source : extract DCS du … ».
4. Saisir dans « Déclaré par le client » un dernier entretien plus récent (ex. 01/09/2026, ailleurs) →
   Enregistrer : l'échéance passe au 01/09/2027, source « déclaré par le client ». Effacer la date →
   Enregistrer → retour à l'extract DCS.
5. Espace client → Mes motos → une moto : carte « Prochain entretien », saisir le km actuel et le dernier
   entretien → « Merci, c'est noté » et la date se met à jour. Inscription (ou borne) : après le choix de
   la moto, les trois champs apparaissent ; après validation de la moto déclarée (Véhicules → Motos
   déclarées), la fiche porte le km et le dernier entretien déclarés.

### 23/09 — Carte 2 « Kits de pièces d'entretien » (ATE013 + ATE014, M-20)

> Demande de Simon (23/09), mot pour mot : « relier les entretiens au pièces.. on doit pouvoir aussi
> créer une picking list a partir de ce qui a été prévu comme entretien. et pouvoir commander depuis
> l'or ou la picking list (en choisissant le type de commande). »

**1. Relier un entretien aux pièces (M-38, M-39).** Pour un modèle-année et une échéance, les pièces
sont **déduites** des libellés d'opérations des manuels d'atelier, puis retrouvées dans les **vues
éclatées du catalogue Ducati de ce modèle-année**, donc dans les articles du DMS. Les consommables
(huile moteur, liquide de refroidissement, liquide de frein, huile de fourche) viennent des
**tableaux de ravitaillements** avec leur quantité et leur spécification. « Remplacement des
bougies » réclame des bougies ; « Contrôle et nettoyage du filtre à air » ne réclame rien. Les
quantités viennent de la colonne « quantité » de la vue éclatée : **2 bougies sur un bicylindre,
4 sur un V4, 2 courroies**. Treize familles de pièces, trois jeux de règles **en table** (donc
corrigeables sans migration).

**Couverture mesurée le 23/09** (sur les 370 modèles-années reliés à un manuel d'atelier) :

| Mesure | Valeur |
|---|---|
| Modèles-années reliés à un manuel et au catalogue | 370 |
| Modèles-années dont l'entretien donne des pièces | 284 |
| Couples (modèle-année × échéance) | 1 355 |
| Besoins fermes déduits | 4 629 |
| **Besoins fermes résolus jusqu'à l'article du DMS** | **4 529 — 97,8 %** |
| Besoins « à confirmer par l'atelier » | 100 (78 filtres à huile, 18 courroies, 2 courroies de pompe à eau) |
| Lignes optionnelles résolues en plus (bouchon de vidange, joint de bougie, crépine) | 1 374 |
| Lignes de kit utilisables au total | 5 903 |
| Familles de moteur distinctes | 44 |
| Kits (famille de moteur × échéance × contenu) | 385 |

Par famille : filtre à huile 1 128/1 206 · huile moteur 1 206/1 206 · bougies 630/630 · filtre à air
443/445 · courroies de distribution 428/446 · liquide de refroidissement 294/294 · huile de fourche
278/278 · liquide de frein 64/64 · joints de pompe à eau 32/32 · courroie de pompe à eau 26/28.

Les 86 modèles-années sans pièce déduite sont ceux dont la grille du manuel n'est pas balisée par
échéance (M-30 : 235 des 469 manuels n'ont qu'une grille kilométrique reconstruite) : **rien n'est
inventé pour eux**, l'atelier composera le kit à la main.

Exemples vérifiés à la main dans les vues éclatées :

| Moto | Échéance | Pièces déduites |
|---|---|---|
| MONSTER / MONSTER + 2027 | Oil Service | filtre à huile `44440441A` ×1 · bouchon de vidange `89310153A` ×1 · huile moteur 3,8 l (SHELL Advance 15W-50) |
| MONSTER / MONSTER + 2027 | Valve Check | bougies `67040581B` **×2** · joints de bougie `78812031B` ×2 · liquide de refroidissement 2,25 l |
| MONSTER 821 2016 | 30 000 km | filtre à huile `44440035A` · bouchon `89320062A` · bougies `67040451A` **×2** · filtre à air `42610191A` · **courroies `73740252A` ×2** · huile moteur · huile de fourche |
| MONSTER 821 2016 | 1 000 km | filtre à huile + bouchon + huile moteur **seulement** (ni bougie ni filtre à air : c'est bien la révision des 1 000 km) |
| PANIGALE V4 S 2024 | Desmo Service | bougies `67040511A` **×4** · **aucune courroie** (V4 à chaîne de distribution) |

**2. Les kits (M-40, M-41).** Un kit par **famille de moteur × échéance**, proposé automatiquement
et **corrigeable par l'atelier** : ajout, retrait, quantité. Chaque correction fait une **nouvelle
version** avec une photo complète du contenu ; une nouvelle proposition **ne retouche jamais** un kit
déjà corrigé. Écran **Atelier → Kits d'entretien** (`/workshop/kits`), accessible aussi depuis
Atelier → Plans d'entretien.

**3. La picking list depuis l'entretien prévu (M-42).** Bouton **« Créer la picking list »** sur la
fiche OR et au récapitulatif du parcours technicien : la liste reprend **les pièces du kit de
l'échéance en cours** et **les pièces ajoutées par le technicien** (lignes « pièce » de l'OR, que le
bouton « Reporter sur l'OR » du parcours remplit déjà). Chaque ligne porte son **stock disponible**,
son **casier** et ce qui **manque**. C'est la liste de préparation existante, pas une nouvelle :
mêmes statuts, même écran tablette, même impression.

**4. Commander les pièces manquantes (M-43).** Bouton **« Commander les pièces manquantes »** sur la
fiche OR, au récapitulatif du parcours et sur la liste de préparation elle-même. La fenêtre ne
propose que ce qui manque (besoin − libre − en commande − déjà en brouillon) et demande le **type de
commande** (standard / urgente / accident, avec ses règles de Paramètres et le seuil en direct). La
commande est créée **en brouillon**, reliée à l'OR, et repart dans la proposition de commande
fournisseur puis le fichier DCS (ACH001 : seule « urgente » sort en URGENTE). **Aucun mouvement de
stock.**

- Migrations **écrites, testées en transaction annulée, PAS appliquées** :
  `20260923160000_m8_entretien_pieces_regles.sql`, `20260923161000_m8_kits_entretien.sql`,
  `20260923162000_m8_picking_depuis_or.sql`, `20260923163000_m8_commande_depuis_or.sql`.
- Code : `src/modules/workshop/kits/` (`rules.ts` règles pures, `api.ts`, `kits-screen.tsx`,
  `order-from-workshop-dialog.tsx`), route `src/routes/_app.workshop.kits.tsx`, boutons sur
  `src/routes/_app.workshop.$orId.tsx`, `src/modules/workshop/journey/journey-screen.tsx` et
  `src/modules/sales/picking-actions.tsx`.
- Tests : `tests/maintenance-kits.test.ts` (28 tests, cas de référence issus des vraies vues
  éclatées Monster 821 / Monster + 2027 / Panigale V4 S).

### À tester (carte 2)

1. Atelier → Plans d'entretien → **Kits d'entretien** → **« Proposer les kits »**. Attendre la fin
   (le compteur avance par lots). Des kits « famille de moteur — échéance » apparaissent.
2. Ouvrir un kit : les pièces, leur quantité, leur casier et le disponible. Les lignes **« À
   confirmer »** sont celles où plusieurs références sont possibles, ou dont l'article n'est pas
   encore désigné (huile, liquides).
3. Changer une quantité, ajouter une pièce, en retirer une : le numéro de **version** monte.
   Relancer « Proposer les kits » : **le kit corrigé ne bouge pas**.
4. Ouvrir un OR dont la moto est reliée au catalogue Ducati, démarrer le **parcours d'entretien** et
   choisir une échéance. Revenir sur l'OR → **« Créer la picking list »** : la liste s'ouvre avec les
   pièces du kit (+ celles reportées par le technicien), avec casiers et disponible.
5. Sur la liste (ou sur l'OR) → **« Commander les pièces manquantes »** : seules les pièces qui
   manquent sont proposées, choisir **urgente** ou **standard**, créer. La commande s'ouvre en
   brouillon et porte le lien vers l'OR.
6. Relancer « Commander les pièces manquantes » : la fenêtre doit dire **« Rien à commander »**
   (ce qui est déjà en brouillon n'est pas recommandé).

### 31/10 — Cartes 6 et 7 « Relances d'entretien » et « Rendez-vous d'entretien » (CRM006, VEN001 côté entretien ; décision M-72)

**Pour l'utilisateur**
- **Clients (CRM) → Relances** (`/crm/relances`, vendeur, marketing, admin) : trois onglets **À envoyer**,
  **Envoyées (en attente)**, **À rappeler / Closes** ; pour chaque relance le client, la moto, l'objet
  (« Desmo Service 24 000 km », « Pneu arrière »), la date (envoi prévu / envoyé le / réponse ou clôture),
  le canal (e-mail), le statut (couleur + icône + libellé) et la source (entretien dû, intervention
  reportée). Compteurs : à envoyer cette semaine, en attente de réponse, à rappeler.
- **Actions** sur une relance : aperçu du mail (dans la langue du client, variables remplies), envoyer
  maintenant, décaler, marquer répondue, clore, annuler, ouvrir la carte CRM (quand J+5 l'a créée).
- **Planifier maintenant** : construit ou actualise la liste à partir des entretiens dus (lot « dates
  d'entretien », envoi 15 jours avant) et des interventions reportées (lot « check-up atelier », à la
  date fixée). Tourne aussi seul chaque matin à 6 h ; les mails dus partent à 6 h 15 par Outlook.
- **Modèles** : objet et texte par type de relance et par langue (FR/NL/EN/IT), préchargés, modifiables ;
  variables `{prenom} {nom} {moto} {date} {objet} {km} {lien_rdv}` expliquées, variable inconnue
  signalée, aperçu avec des valeurs d'exemple.
- **Côté client** : le mail contient un bouton « Prendre rendez-vous » vers son espace (formulaire de
  RDV ouvert, moto présélectionnée). Sa demande marque la relance répondue ; le rendez-vous (portail,
  comptoir ou planning) la ferme. Un mail de réponse relevé par Outlook dans les 5 jours la marque aussi
  répondue.
- **J+5** sans réponse ni rendez-vous : la relance passe « À rappeler » et une **carte CRM commerciale**
  apparaît (ou la carte ouverte du client est réutilisée) avec la tâche « Rappeler {client} — {moto} :
  {objet} » confiée au responsable par défaut des nouvelles demandes. Un rendez-vous pris ensuite
  termine la tâche.

**Comment tester (après application de la migration et déploiement de `followups-send`)**
1. CRM → Relances → **Planifier maintenant** : le message indique le nombre de relances créées (vide tant
   que les lots « dates d'entretien » et « check-up atelier » ne sont pas en base : c'est voulu).
2. Pour un essai sans ces lots : insérer une relance sur sa propre fiche (e-mail = le sien) avec
   `send_at = current_date` (SQL), puis **Aperçu du mail** et **Envoyer maintenant** : le mail arrive
   dans sa boîte, dans la langue de la fiche, avec le bouton « Prendre rendez-vous ».
3. Cliquer le bouton : l'espace client s'ouvre sur la demande de RDV, moto présélectionnée ; envoyer la
   demande → la relance passe « Répondue » puis « Close » (le rendez-vous « demande » est créé).
4. Simuler J+5 : `update followups set sent_at = now() - interval '6 days' where id = …` puis
   `select followups_j5('<société>')` (ou attendre 6 h) → la relance passe « À rappeler », la carte CRM
   et la tâche apparaissent (cloche du responsable par défaut) ; « Ouvrir la carte CRM » y mène.
5. Prendre un rendez-vous au comptoir pour cette moto → relance close, tâche terminée.

**Technique**
- Migration `20261031120000_m10_relances.sql` (**non appliquée**, essai à blanc réussi en transaction
  annulée sur la base de production le 31/10 : planification, rendu NL, J+5 → carte + tâche, RDV → close
  + tâche terminée, mail entrant → répondue, refus sans session). Tolère l'absence de
  `vehicles_maintenance_upcoming` et `deferred_interventions` (`to_regprocedure` / `to_regclass`) et de
  `contacts.locale` (`to_jsonb`).
- Edge `followups-send` (**à déployer** : `npx supabase@2.117.0 functions deploy followups-send --project-ref ujmrosbgkvgvwfnuryna`),
  `config.toml` : `verify_jwt = false` (pg_cron par x-cron-secret, membre par jeton). Pas de file
  `notifications` : elle finit en `skipped` faute de Resend ; ici Outlook / Graph (D4).
- Tâches pg_cron `followups-plan` (6 h, SQL) et `followups-send` (6 h 15, pg_net + Vault `cron_secret`
  comme S5 : sans ce secret, la fonction refuse l'appel du cron ; l'envoi manuel depuis l'écran
  fonctionne quand même).
- Tests `tests/followups.test.ts` (date d'envoi, J+5, RDV → close, variables, langue, onglets, droits).
### 31/10 — Parcours check-up → proposition → signature → reportées (ATE008 + ATE009, M-75 à M-77)

> Décision de Simon (30/10), mot pour mot : « À l'accueil d'une moto, elle rentre pour une raison
> (entretien annuel, 15 000 km…). L'atelier, quand il ouvre la carte de la moto, fait un check-up :
> on est à l'entretien des 15 000, il y a 6 actions à faire, et ils remarquent que le pneu est abîmé,
> que les freins sont morts… ils prennent une photo, ajoutent l'action à faire dessus, le temps
> (estimation automatisée), les pièces, et le prix vient s'ajouter. Le membre de l'atelier envoie la
> proposition d'intervention (par mail et sur l'app client). Le client valide l'entièreté ou décoche
> ce qu'il ne veut pas tout de suite et signe d'un clic. Le comptoir doit aussi pouvoir faire signer
> directement en tactile sur la tablette. Si le client n'a pas signé au comptoir, le vendeur vérifie
> que c'est validé (en l'appelant) avant intervention. Au retrait du véhicule (facturation, clés), le
> comptoir demande et remet une date pour les interventions non faites. »

**Pour l'utilisateur**
1. **Accueil** : sur l'OR, le **motif d'entrée** (liste réglable dans Paramètres → Tables → Motifs
   d'entrée atelier). Un motif « entretien … » ou « vidange » permet de **pré-remplir** les actions
   depuis le plan d'entretien de la moto (carte 1) et les pièces du kit (carte 2) : une carte
   « Entretien » avec le temps Ducati et les pièces, puis une carte par opération.
2. **Onglet Check-up** (tablette) : une colonne de grandes cartes — libellé, état **OK / À faire / À
   prévoir** (couleur + icône + libellé), **photo** (appareil ou galerie, rangée dans la GED de l'OR,
   dossier « Check-up »), temps (proposé, sinon saisi, en heures décimales), pièces (recherche dans
   les articles), prix calculé (MO = heures × taux horaire HT + pièces au PV). **« + Constat »** pour
   un pneu, des freins… Total des actions proposées toujours visible en bas.
3. **« Envoyer la proposition »** : l'OR est enregistré, un devis « Proposition d'intervention »
   (`DEV-`) est créé et relié à l'OR, puis la fenêtre d'envoi s'ouvre avec l'objet, le message et
   le **lien de signature** dans la **langue du client**. Le PDF joint porte la photo en vignette
   sous chaque action. La proposition apparaît aussi dans **l'espace client** (accueil).
4. **Le client signe** (`/signer/<jeton>`, sans connexion) : une case par action, il décoche ce
   qu'il ne veut pas tout de suite, le total se recalcule, il tape son nom et clique **« J'accepte et
   je signe »**. Au comptoir, **« Faire signer sur la tablette »** ouvre le même écran avec une
   **signature au doigt**. Résultat : document accepté avec les lignes retenues, les lignes
   décochées deviennent des **interventions reportées**, l'OR passe **« Accord client : signé »**,
   un PDF signé part par mail au client, l'équipe reçoit une **cloche**.
5. **Garde-fou** : en tête de l'OR, en grand, « Signé le … par … » / **« EN ATTENTE »** / « Accord
   verbal le … par … (téléphone) ». Tant que l'accord est en attente, « Démarrer le parcours » et la
   pointeuse sont grisés. **« Accord verbal »** (qui, quand, canal, note) lève le blocage et laisse
   une trace dans l'historique.
6. **À la facturation / remise des clés** : si la moto a des interventions reportées à planifier,
   une étape **« Date pour les interventions reportées »** propose une date (+30 jours, modifiable)
   ou « Pas maintenant ». Les reportées sont visibles sur la **fiche moto** (encadré) et la **fiche
   client** (onglet « Reportées »).

**Technique**
- Migration `supabase/migrations/20261031110000_m8_checkup_et_accord_client.sql` (**non appliquée**,
  essayée en transaction annulée sur la base de production le 29/10 : lignes, proposition, signature,
  reportée, accord verbal, double signature refusée). Fonction serveur `supabase/functions/proposal-sign`
  **à déployer** (`npx supabase@2.117.0 functions deploy proposal-sign --project-ref ujmrosbgkvgvwfnuryna`).
- Code : `src/modules/workshop/checkup/` (règles pures, accès base, onglet, accord, reportées),
  `src/modules/documents/proposal-sign*` (écran de signature), `src/routes/signer.$token.tsx`,
  PDF `src/modules/sales/document-pdf.ts`, cloche `src/components/layout/topbar.tsx`, espace client
  `src/modules/portal/portal-home.tsx`. Détail des règles : [M08](../modules/M08-atelier.md) §4 et
  [M09](../modules/M09-documents.md) §4.
- Tests : `tests/workshop-checkup.test.ts` (prix d'une carte MO + pièces, partition acceptées /
  reportées, hash du texte accepté, garde-fou, création des reportées, date +30 j, échéance selon
  le motif, lien cliquable).

### À tester (31/10)

1. Appliquer la migration et déployer `proposal-sign`. Paramètres → Tables → Frais de devis atelier :
   un tarif horaire HTVA (sinon la main-d'oeuvre reste à 0 €).
2. Ouvrir un OR avec client et moto → motif « Entretien 15 000 km » → onglet **Check-up** →
   « Pré-remplir depuis le plan d'entretien » (moto reliée au catalogue) ou **« + Constat »** :
   « Plaquettes avant usées », état **À faire**, photo, 1,5 h, une pièce. Le prix de la carte et le
   total du bas suivent.
3. **« Envoyer la proposition »** : la fenêtre d'envoi s'ouvre (langue du client, lien de signature
   dans le message) ; « Vérifier sans envoyer » puis envoyer. L'OR affiche **« Accord client : EN
   ATTENTE »**, « Démarrer le parcours » est grisé.
4. Ouvrir le lien reçu (ou l'espace client) : décocher une action, taper le nom, **« J'accepte et je
   signe »** → « Merci, c'est signé », exemplaire signé par mail.
5. Revenir sur l'OR : **« Signé le … par … »**, l'action décochée est marquée **reportée**, le
   parcours est à nouveau possible ; cloche « Propositions d'intervention signées ».
6. Variante comptoir : **« Faire signer sur la tablette »** → signature au doigt → PDF avec le tracé.
7. Variante téléphone : **« Accord verbal »** (qui, quand, téléphone, note) → « Accord verbal le … ».
8. **« Transformer en facture »** : l'étape « Date pour les interventions reportées » propose
   +30 jours → « Fixer la date » → la facture s'ouvre ; fiche moto et fiche client montrent
   l'intervention **planifiée** à cette date.

## 5 bis. Cartes proposées (21/09)

- ~~**Prochain entretien de chaque moto** (= carte 4)~~ — **fait le 31/10** (voir §5) : sources OR / G8 / client / extract DCS / plan, `vehicle_maintenance_due`.
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
- **Trancher les 100 besoins « à confirmer »** (carte 2) : surtout des filtres à huile (deux
  références sur le même modèle-année, vues « CARTER HUILE » et « POMPE A HUILE COMPLETE ») et des
  courroies. À faire une fois par famille de moteur, pas par moto : 44 familles au total.
- **Désigner les articles des consommables** (carte 2) : huile moteur, liquide de refroidissement,
  liquide de frein, huile de fourche. Le manuel donne le produit et la quantité, l'atelier choisit
  l'article du DMS **une fois pour toutes** (`maintenance_fluid_article_set`) ; toutes les lignes de
  kit non corrigées suivent.
- **Prix des kits et devis automatique** (reste de la carte 2) : les pièces sont là, le temps Ducati
  aussi (carte 1) ; il reste à sortir un **devis d'entretien** complet (pièces + main-d'œuvre) depuis
  le kit, ce qui achève ATE013.
- **Écran de couverture entretien → pièces** : la fonction `maintenance_parts_coverage` existe et
  est appelable par lots ; un onglet la rendrait visible sans passer par SQL.
