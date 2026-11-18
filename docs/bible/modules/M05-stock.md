---
chapitre: M05
titre: Stock & inventaire
etat: 🟦
verifie_le: 2026-11-18
missions: []
mots_cles: [stock, mouvement de stock, stock réel, stock réservé, stock disponible, triple stock, arrêté, copie datée, PAMP, valeur de stock, inventaire, comptage, réajustement, annule et remplace, cumul, casier, réintégration, remise à zéro, écarts, inventaire tournant, cession interne, dépréciation, stock dormant, étiquetage différé, réappro]
---

# M05 — Stock & inventaire

> **En une phrase** : le stock est la somme de tous les mouvements enregistrés (jamais un chiffre qu'on corrige à la main) ; ce module les montre, les valorise au PAMP et organise les inventaires.

## 1. À quoi ça sert
Le magasinier y voit, pour chaque article, le stock **réel**, **réservé** et **disponible**, la valeur au PAMP et
l'historique complet des mouvements (qui, quoi, quand, d'où). Il y mène l'**inventaire** à la manière de G8 :
photo datée du stock (« arrêté »), comptage, réajustement, écarts, réintégration. Il y enregistre aussi les
**cessions internes** (sorties non facturées : cadeau, démo, fournitures atelier, garantie) et les
**dépréciations** de vieux stock pour le comptable. Les autres modules écrivent dans le stock par la même porte
unique : réception (M4), vente et réservation (M6), ORO (M7), atelier (M8).

## 2. Ce qu'on a aujourd'hui

Menu latéral : **Stock & inventaire** (`/stock`).

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Stock & inventaire → liste (`/stock`) | Tous les articles avec réel / réservé / disponible, PAMP, valeur, mini, localisation ; **valeur totale du stock** ; recherche ; filtres « Stock ≠ 0 », « Sous le mini », fournisseur, rayon, dates ; vue **Réappro** (manques) ; **export CSV** filtré ; clic sur une ligne → **historique des mouvements** (date, type, qté, origine, réf. document, opérateur). |
| Stock & inventaire → Inventaire (`/stock/inventory`) | Démarrer un inventaire avec 3 options (magasin ouvert → génère un arrêté ; avec remise à zéro → mode cumul ; avec édition des écarts), saisir les quantités comptées, valider le comptage (mode **annule et remplace** ou **cumul**), générer l'arrêté, remettre le réel à zéro (en conservant les motos V/O/P/D), afficher les **écarts** réel vs arrêté (qté + valeur), **réintégrer** l'arrêté (une seule fois), clôturer. |
| Stock & inventaire → Cessions internes (`/stock/cessions`) | Sortie de stock typée (types pris dans la table de paramètres `cession_type`) avec note ; liste des 100 dernières cessions. |
| Stock & inventaire → Dépréciations (`/stock/depreciation`) | Filtrer le stock (fournisseur, rayon, « seulement stock dormant »), appliquer un % de décote sur la valeur PAMP avec motif, aperçu, liste des dépréciations en cours et provision totale, annulation. |
| Pièces → fiche article → onglet Stock (`/parts/$articleId`) | Triple stock de l'article, mouvements filtrables, **saisie d'un mouvement manuel** (entrée avec coût, sortie, correction…). Voir M02. |
| Pièces → Étiquettes (`/parts/labels`) et impression en masse | Quantité par défaut = stock réel. Voir M02. |

### Ajouté le 18/11 — rattrapage G8 (lot `lot-g8-stock`, migrations `20261118210000` / `211000` / `212000`, **non appliquées**)

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Stock & inventaire → Inventaire (`/stock/inventory`) | **Inventaire guidé** : choix d'une des **8 méthodes G8** (magasin ouvert / fermé × effacement des stocks × édition des écarts), aperçu des étapes, **procédure imprimable** (PDF via l'impression du navigateur), puis **check-list d'étapes datées** (date, heure, opérateur, résultat) avec **Valider** sur l'étape suivante et **Retour** sur la dernière validée. Étapes qui agissent en base : sauvegarde / copie (photo datée), génération de l'arrêté, remise à zéro du stock réel (compensable par Retour), effacement de l'arrêté, **réintégration unique** (définitive), fin. Grille de comptage sur l'arrêté (magasin ouvert) ou sur le réel (magasin fermé), feuilles « arrêté initial / final », écarts (quantité + valeur) imprimables. |
| Stock & inventaire → Réajustement (`/stock/readjust`) | **Gestion du stock réel** et **Gestion d'arrêté** de G8 : grille en **3 modes** (annule et remplace · cumul multi-emplacements · par casier à la volée) sur le **stock réel** ou sur un **arrêté** (généré hors inventaire puis réintégré une fois) ; liste = **tous les articles stockés** (A/V/O/P/D), recherche douchette (référence, désignation, réf. fournisseur, code-barres), filtre casier, « pas encore comptés » ; option « mettre les étiquettes en attente » ; **remise à zéro** (positifs et négatifs / négatifs seuls, motos conservées au choix) avec **confirmation forte** (taper `REMISE A ZERO`) et copie du stock prise juste avant. |
| Stock & inventaire → Édition du stock (`/stock/edition`) | Les **8 onglets G8** (stock réel · stock arrêté · copie de stock · stock non réajusté · écart de stock · stock à une date · dépréciation · invendus) + **articles en rupture** ; familles rayon › sous-rayon › catégorie, fournisseur, marque, casier, référence, types de gestion ; stocks nuls / négatifs / motos en démo / dépôts **inclus · exclus · uniquement** ; achats et ventes d'une période ; **classement 4 niveaux** avec sous-totaux ; valeur au PAMP ; **export Excel** ; impression ; **inventaire par rayon / fournisseur / casier / référence** (feuille avec colonne « Compté ») ; génération d'une **copie de stock à la demande**. |
| Stock & inventaire → Étiquetage (`/stock/labels`) | **Reprise étiquetage** + **étiquetage par groupe** G8 : par référence, par groupe (familles / fournisseur), **à la réception** (quantité reçue ou nombre d'étiquettes de la ligne), par **date de modification de l'article** ou **du PV** (`price_changes`), par **casier** ; éco-participation, seulement en stock ; quantité par défaut **stock réel ou 1** ; avec / sans prix, avec / sans code-barres, **double étiquette au prix tarif** (PPC) ; **imprimer maintenant** (imprimante d'étiquettes du poste, Zebra ZPL, sinon navigateur) ou **mettre en attente** : panneau **« Étiquettes en attente » par poste**, cumulées par article, imprimées en une fois (heure + auteur notés) ou retirées. |

Règles ajoutées (miroirs TypeScript testés : `src/modules/stock/inventory-rules.ts`, `labels-rules.ts`, `edition-rules.ts`, `tests/inventaire-guide.test.ts` ; essai à blanc `supabase/tests/m5_inventaire_guide.sql`) :
- **Étapes par méthode** (`_inventory_method_steps`) — ouvert : début · sauvegarde · génération de l'arrêté · remise à zéro du réel · édition arrêté initial · [effacement de l'arrêté] · comptage · réajustement de l'arrêté · [édition des écarts] · édition arrêté final · sauvegarde finale · réintégration · copie · fin. Fermé : début · sauvegarde · génération de l'arrêté · édition arrêté initial · [remise à zéro du réel] · comptage · réajustement du réel · [édition des écarts] · sauvegarde finale · copie · fin. Journal **append-only** `inventory_step_log` (valide / retour).
- **Arrêté immuable + réajustements ajoutés** : `stock_snapshot_lines` n'est plus modifiable par personne ; les comptages sur l'arrêté sont des lignes `stock_snapshot_adjustments` (mode, compté, casier, ancien, nouveau, delta, opérateur, heure). Arrêté réajusté = photo + somme des deltas (`_snapshot_effective`). Cumul = somme des comptages cumul (on part de 0) ; casier = somme du dernier comptage de chaque casier.
- **Réintégration** (`_snapshot_reintegrate`, une seule fois) : réel cible = arrêté réajusté + mouvements faits depuis l'arrêté **hors** mouvements de l'inventaire ; juste avec ou sans remise à zéro, ventes pendant le comptage comprises.
- **Réajustement du réel** (`stock_readjust`) : casier = annule et remplace pour un article à un seul emplacement, stock du casier (`bin_stock`) pour un article multi-emplacements.
- **Copies** : `_stock_photo` / `_stock_levels` ne dépendent plus de l'utilisateur connecté → **les copies pg_cron du 15 et de fin de mois ne sont plus vides** (piège §7 corrigé), une seule copie automatique par jour, jour calculé à l'heure de Bruxelles. `stock_snapshots` gagne `status`, `origin` (manuel / auto / inventaire), `session_id`, `created_by`, `reintegrated_at`.
- **Droits** : écritures via `can_write_table(company, 'inventory_sessions')` (page /stock) et `'label_queue'` (pages /parts et /stock).
- **Étiquettes** : `label_queue` gagne `workstation_id` (poste ; lien posé si la migration postes `20261103250000` est passée), `source`, `source_ref`, `with_tarif`, `printed_at`, `printed_by` ; fonctions `enqueue_labels`, `label_queue_pending`, `label_queue_done`, `label_candidates`.
- **Pas de promotions** : le DMS n'a pas de prix promo sur l'article ; l'étiquetage « articles en promotion » de G8 n'est pas repris (voir questions en attente).

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.stock.tsx`, `_app.stock.index.tsx`, `_app.stock.inventory.tsx`, `_app.stock.cessions.tsx`, `_app.stock.depreciation.tsx` |
| Logique métier | `src/modules/stock/` : `api.ts` (triple stock d'un article, mouvements, `recordMove`, transfert au remplacement, `computePamp` de référence), `stock-api.ts` (liste valorisée, historique, cessions), `inventory-api.ts` (sessions, arrêté, comptage, remise à zéro, réintégration, écarts, **et** fonctions sans écran : comptage par casier, tournant, file d'étiquettes), `inventory-screen.tsx`, `depreciation-api.ts`, `stock-export.ts` |
| Tables | `stock_moves` (mouvements, **append-only**), `inventory_imports` + `inventory_import_lines` (inventaires **importés** de G8 : le fichier tel que lu, son rapprochement et le mouvement produit — depuis le 23/09), `inventory_sessions` (inventaires), `stock_snapshots` + `stock_snapshot_lines` (arrêtés et copies datées, qté + PAMP), `label_queue` (file d'étiquettes différée), `stock_depreciations` (provisions de décote, annulables jamais supprimées) ; `articles.pamp` (PAMP courant, M02) |
| Réservations de l'atelier (03/11, M-111) | table `stock_reservations` (état : besoin, réservé, mis au panier, consommé ; active / libérée / consommée), mouvements dans `stock_moves` ; fonctions `workshop_reservations_sync`, `workshop_reservations_list`, `article_reservations` (fiche article, comptoir), internes `_workshop_reservations_sync`, `_workshop_reservation_release`, `_workshop_reservations_invoice`, `_workshop_minimax_after`, `_minimax_stock`, `_basket_minimax_need` ; règles miroir `src/modules/workshop/reservations/rules.ts` (`tests/atelier-reservation.test.ts`) |
| Fonctions SQL (RPC) | `record_stock_move` (**porte d'entrée unique** : insère le mouvement et recalcule le PAMP), `article_stock`, `article_stock_list` (**filtrable et paginée depuis le 23/09** : `_stock` = `all` / `actif` / `pos` / `neg` / `zero`, `_search`, `_limit`, `_offset`), `article_stock_history`, `bin_stock`, `generate_stock_snapshot`, `record_inventory_count` (modes `annule_remplace`, `cumul`, `casier`), `reset_real_stock`, `reintegrate_snapshot`, `inventory_gaps`, `cycle_count_candidates`, `enqueue_label`, `transfer_stock_on_replace`, `dormant_stock`, `stock_value_owned` (hors dépôt-vente, M7), `_cron_stock_copies`, `_cron_maybe_stock_copy`, `_cron_dormant_alert` ; **import d'inventaire** (23/09) : `inventory_import_open`, `inventory_import_stage`, `inventory_import_resolve`, `inventory_import_preview` (dry-run), `inventory_import_apply` (par lots), `inventory_import_report` (contrôles), `inventory_import_vin_candidates` / `inventory_import_complete_vins` |
| Fonctions serveur (Edge) | aucune |
| Tâches planifiées | `stock-copies-daily` (tous les jours 22:30 UTC → copie datée si on est le 15 ou le dernier jour du mois), `dormant-stock-alert` (le 1er du mois 05:00 UTC → trace dans `events` le nombre et la valeur des articles A sans mouvement depuis 4 mois). Présence dans `cron.job` : à vérifier. **`basket-minimax-daily`** (04:00 UTC, mission 09, 03/11/2026, migration non appliquée) : remplit le panier de commande Ducati standard avec les pièces sous leur minimum (voir M04). |
| Seuils de réassort | `articles.stock_min` (« Stock mini ») et **`articles.stock_max`** (« Stock maxi », quantité cible du minimax) sur la fiche article (M02, `article-form.tsx`) ; lus par `reorder_proposals` (M04) et, depuis le 03/11, par `basket_fill_minimax` / `_cron_basket_minimax` (M04, mission 09) |
| Migrations clés | `supabase/migrations/20260610200000_m5_stock_moves.sql` (fondation, PAMP), `20260610310000_m5_stock_views.sql`, `20260923170000_m2_liste_articles_stock_vignettes.sql` (pagination et filtre de `article_stock_list`, appliquée le 23/09), `20260610320000_m5_inventory.sql`, `20260612170000_pg_cron_stock.sql`, `20260612220000_m5_inventory_b12.sql` (mode casier, tournant, étiquettes), `20260726110000_m5_stock_depreciations.sql`, `20260923190000_m5_inventaire_import.sql` (outil d'import d'inventaire, appliquée le 23/09) |
| Outil de reprise | `tools/migration/import_inventaire_g8.py` — lit l'export G8 « Inventaire du stock réel par RAYON » (.xlsx, sans dépendance), dépose, rapproche, `--apply`, `--rapport`, `--vins` ; modes hors ligne `--lire` / `--deltas` pour les tests |
| Tests | `tests/pamp.test.ts` (formule PAMP côté JS uniquement), `tests/inventaire-g8.test.ts` (lecture du fichier d'inventaire et calcul des écarts, fixture anonyme `tests/fixtures/inventaire-g8/`) |
| Libellés | `src/lib/i18n/fr.ts`, bloc `stock` |

## 4. Règles métier et décisions

- **Le stock réel est une somme de mouvements, pas un champ** (règle 3, B7) : `stock_moves` n'accepte que INSERT et SELECT pour les utilisateurs (`revoke update, delete ... from authenticated`). Chaque mouvement porte type, quantité signée, coût unitaire éventuel, casier, **origine** (`screen`, `reception`, `sale`, `inventory`, `replacement`, `oro`, `cession`…), n° de document, note, **opérateur** et horodatage. Une annulation est un mouvement inverse, jamais une suppression.
- **Types de mouvement** : `entree`, `sortie`, `reservation`, `liberation`, `inventaire`, `transfert`, `cession`, `correction`.
- **Triple stock** (B4) : réel = somme des mouvements hors réservation ; réservé = somme des mouvements `is_reservation` ; disponible = réel − réservé. **Qui réserve** : les bons RES / BL (M06), **depuis le 03/11 l'atelier** (pièces du kit d'un RDV d'entretien, puis de son OR : `stock_reservations`, origine `atelier`, réf. « RDV JJ/MM/AAAA HH:MI » ou n° d'OR, M-111 / M-113, migration `20261103270000_m8_entretien_reservation.sql` non appliquée) et, depuis le 21/09, les **commandes du site pas encore payées** (mission 03, W-12 : origine `shopify`, réf. = n° de commande « #… », libérées au paiement, à l'annulation ou après 7 jours ; table `shopify_order_reservations`). **Écart avec l'invariant** : B4 définit disponible = `réel − réservé + en commande` ; les quantités en commande ne sont pas ajoutées (colonne « en commande » vide dans Pièces). L'« arrêté » est porté par `stock_snapshots`.
- **PAMP** (B5) : recalculé dans `record_stock_move` sur toute entrée de quantité positive avec coût : `(PAMP × stock avant + coût × qté) / (stock avant + qté)` ; si le stock avant est ≤ 0, le PAMP repart du coût. Les sorties, inventaires et cessions ne changent pas le PAMP. Valeur de stock = réel × PAMP.
- **Copies datées** (B4) : le 15 et en fin de mois, une copie (`kind = 'copie'`) de toutes les sociétés, par pg_cron.
- **Inventaire — 8 méthodes G8 recomposées en 3 options** (dossier-projet M5, cahier §4) : magasin ouvert/fermé × effacement × édition des écarts.
- **Trois modes de réajustement** (B6) : *annule et remplace* (écart = compté − réel), *cumul* (la saisie s'ajoute, multi-emplacements), *par casier* (écart calculé sur le stock du seul casier, `bin_stock`). Le réajustement est toujours un mouvement `inventaire`, jamais un UPDATE.
- **Réintégration unique** de l'arrêté (`reintegrated = true`, refus si déjà fait) ; la remise à zéro peut conserver les véhicules V/O/P/D (n° de série).
- **Cessions internes** (angle mort G8) : mouvement `cession`, quantité négative, type de cession dans `ref`. Valorisées implicitement au PAMP courant (aucun coût stocké sur le mouvement).
- **Dépréciation** (angle mort G8) : provision de **valeur** (`base_value × taux`), **sans** mouvement de stock ni changement de PAMP ; annulable (`is_active = false`), jamais supprimée (B7).
- **Étiquetage** (B12) : quantité par défaut = stock réel ; file différée cumulable par opérateur (`label_queue`, `enqueue_label`).
- **Dépôt-vente hors valorisation** : `stock_value_owned` exclut le type D (voir M07).
- **Lire le stock, c'est paginer** (M-28, 23/09) : `article_stock_list` prend `_stock`, `_search`, `_limit`,
  `_offset` et `listStock` (TypeScript) boucle par pages de 1 000. Portée par défaut des écrans Stock :
  **`actif`** = les articles qui ont **au moins un mouvement** OU un **stock mini renseigné** (1 241 lignes au
  23/09, contre 93 104 articles). Les autres sont à zéro partout et ne changent aucun total ni aucune valeur de
  stock. Au-delà de 20 000 lignes, `listStock` lève une erreur lisible plutôt que de renvoyer une liste fausse.
- **Importer un inventaire** (M-44 à M-48, 23/09) : l'export G8 « Inventaire du stock réel par
  RAYON » est déposé tel quel dans `inventory_import_lines`, puis rapproché — **par VIN** pour les
  lignes à châssis, par **référence normalisée** (majuscules, sans espace ni ponctuation) sinon.
  Chaque ligne produit **un seul** mouvement `inventaire` de quantité `cible − stock calculé`,
  origine `import:g8-inventaire-AAAAMMJJ`, n° d'inventaire en `ref`, rayon en note, casier en
  `bin_location`. Les réservations ne sont **jamais** touchées, et relancer l'import à l'identique
  n'écrit rien. Le PAMP passe par `record_stock_move` quand le stock de départ est ≤ 0 (B5) et est
  aligné en clair sinon (trace `events.inventory_pamp_set`) ; le prix d'achat passe par
  `record_price_change` et seulement s'il était vide ; le changement de casier est tracé
  (`events.inventory_bin_set`). Aucune fiche moto n'est créée ni dupliquée (M-47).
- **Multi-société** : toutes les tables ont `company_id` (lignes d'arrêté via l'en-tête) + RLS `is_member`.
- **Minimax = réassort automatique vers le stock maximum** (mission 09, 03/11/2026, M04) : une pièce stockée (A) dont le **stock réel** passe sous `stock_min` (> 0) entre dans le panier de commande Ducati standard avec `greatest(stock_max, stock_min) − stock réel − déjà en commande` ; tous les jours par pg_cron, ou au bouton « Remplir depuis les minimums ». ~~C'est le stock réel qui déclenche (une réservation n'achète pas)~~ — **depuis le 03/11 (M-112, migration `20261103270000_m8_entretien_reservation.sql`)** : c'est le **stock du minimax = réel − réservé − manque des RDV** qui déclenche, et une réservation d'atelier qui fait passer une pièce sous son minimum la met **tout de suite** au panier standard ouvert (origine minimax), sans attendre la nuit ; ce qui est « en commande » (CMD, commandes de pièces, autres paniers, lignes non minimax du panier) est déduit. La commande du panier **ne touche pas au stock** (B7) : il entre à la réception. **Depuis le 18/11 (décision de Simon, `20261119130000`)** : **toute** sortie de stock (vente, ticket, BL, cession, réajustement…) déclenche le même calcul tout de suite (déclencheur `trg_stock_moves_zz_minimax`), une entrée ou une libération ramène la ligne au besoin ; réglage par société automatique (défaut) / proposition manuelle ; détail dans M04 « Ajouté le 18/11 — réassort minimax immédiat ».

## 5. État en production

Vérifié le 18/09/2026 **dans le code uniquement** (connecteur Supabase non authentifié pendant la session).

- Aucun objet du module ne figure dans la liste des migrations non appliquées du 14/09 (`etat-projet.md` §2) ; `types.ts` contient `stock_moves`, `inventory_sessions`, `stock_snapshots`, `label_queue`, `stock_depreciations`.
- **Les tâches pg_cron n'ont pas été vérifiées** : la migration `20260612170000_pg_cron_stock.sql` avale l'erreur si pg_cron n'est pas disponible (`raise notice 'pg_cron scheduling skipped'`). Il faut regarder `cron.job` pour savoir si les copies du 15 et de fin de mois tournent.
- Les entrées par réception n'existent que depuis le correctif achats du **11/09** (M04 §5).

Requête de contrôle (lecture seule) :
```sql
select jobname, schedule, active from cron.job where jobname in ('stock-copies-daily','dormant-stock-alert');
select kind, count(*), max(created_at) from public.stock_snapshots group by kind;
select move_type, origin, count(*) from public.stock_moves group by 1,2 order by 3 desc;
select has_function_privilege('anon', 'public.record_stock_move(uuid, public.stock_move_type, numeric, numeric, boolean, text, text, text, text)', 'execute');
```


> **Vérifié en base le 18/09/2026** : les tâches planifiées `stock-copies-daily` et `dormant-stock-alert` **existent** dans `cron.job`.

## 6. Prévu / en cours
- Écrans manquants pour des fonctions SQL déjà livrées : comptage **par casier**, **inventaire tournant**, **file d'étiquettes différée**, **consultation des copies datées** (voir §7).
- Brancher « en commande » dans le disponible (B4) avec le chantier Commandes de pièces ([`../../process-commandes-pieces.md`](../../process-commandes-pieces.md)). **Premier branchement le 19/09** (mission 02, carte 2) : l'écran d'une commande de pièces affiche disponible = réel − réservé + en commande, « en commande » = commandes fournisseur CMD validées sans réception reçue liée (fonction `_article_on_order_qty`, M04). La liste Stock et `article_stock` restent à réel − réservé. **Depuis la mission 05 carte 7** : « en commande » = un seul calcul `article_on_order_for` paramétré par client (voir M06 §4) ; sans client, il compte aussi la quantité magasin des commandes de pièces validées non associée à un client. **Depuis la mission 02 carte 4** : une commande de pièces devenue commande fournisseur n'est comptée **qu'une fois** (par la commande de pièces ; la ligne de CMD ne compte que son surplus pour le stock) et plus du tout une fois la CMD reçue (réception liée).
- Tests automatisés exigés par la règle 7 (arrêté / réintégration, PAMP côté SQL) : non écrits.
- Pas de dossier `docs/missions/` à ce jour.

## 7. Limites connues, dettes, pièges
- **`etat-projet.md` et `avancement.md` surestiment l'écran** : ils annoncent « 3 modes d'inventaire, tournant, étiquetage différé ». Les fonctions SQL existent (`record_inventory_count` mode `casier`, `cycle_count_candidates`, `enqueue_label`) et leurs appels sont écrits dans `inventory-api.ts` (`recordBinCount`, `getCycleCandidates`, `enqueueLabel`, `getLabelQueue`, `markLabelsPrinted`), mais **aucun écran ne les appelle**. L'inventaire n'offre que *annule et remplace* et *cumul*.
- ~~**Copies datées invisibles**~~ — **résolu le 18/11** (onglets Copie de stock / Stock arrêté / Stock à une date de `/stock/edition`), après application de `20261118211000`.
- **Porte dérobée PAMP** : la RLS `stockmoves_insert` autorise tout membre à insérer **directement** dans `stock_moves` sans passer par `record_stock_move` ; une entrée ainsi créée ne recalcule pas le PAMP. Le code de l'application passe toujours par la fonction, mais la base ne l'impose pas.
- **Appels anonymes** : `record_stock_move`, `record_inventory_count`, `enqueue_label`, `cycle_count_candidates`, `dormant_stock` sautent le contrôle d'appartenance quand `auth.uid()` est nul (prévu pour pg_cron). Si l'exécution reste ouverte au rôle `anon` (audit Supabase, `etat-projet.md` §5), un appel sans connexion peut écrire des mouvements ou lire le stock d'une société. **À vérifier en priorité** (requête §5).
- **Mouvement manuel depuis la fiche article** : n'importe quel membre peut saisir une entrée valorisée, une sortie ou une correction ; aucune restriction par rôle (magasinier).
- **Filtre « stock dormant » des dépréciations factice** : il retient les articles à disponible > 0, pas ceux sans mouvement depuis N mois (TODO dans `src/routes/_app.stock.depreciation.tsx`).
- **Alerte stock dormant limitée aux pièces (type A)** et écrite seulement dans `events` : personne n'est notifié, et les motos ne sont pas concernées (VEH008, voir M03).
- Les cessions ne figent pas leur valeur (pas de `unit_cost`) : une statistique a posteriori valorisera au PAMP du moment de la consultation.
- **Entrées sans coût et PAMP** : un mouvement positif sans `unit_cost` (inventaire, reprise Shopify W-10 du 21/09 : 305 pièces sur 259 articles, origine `reprise_shopify`) ne change pas le PAMP. Si le PAMP est à 0, la réception suivante calcule la moyenne avec ces pièces à 0 (1 pièce reprise + 1 reçue à 100 € → PAMP 50 €) : la formule ne repart du coût que si le stock avant est ≤ 0.
- **~~Le stock de G8 n'est pas en base~~ — résolu le 23/09** : l'inventaire G8 du 23/09 17h10 est
  importé (4 249 lignes lues, 4 232 appliquées, 3 627 mouvements d'origine
  `import:g8-inventaire-20260923`, 560 articles créés). `stock_moves` passe de 1 119 à 4 746
  mouvements, la portée `actif` de 1 241 à **4 808** lignes, la valeur de stock de ~0 à
  **689 303 €**. Les écarts connus qui restent sont listés juste en dessous.
- **17 motos du fichier d'inventaire sans article stocké (249 875 €)** — écart assumé du 23/09 :
  8 châssis absents du parc (motos neuves jamais saisies dans le DMS) et 9 motos dont la fiche existe
  mais **sans article**, parce que leur statut de parc n'en crée pas (véhicule de prêt
  « courtoisie », « vendu », « repris »). L'import **n'a rien créé** pour elles (M-47). Deux
  décisions attendent Simon : saisir les 8 fiches manquantes, et dire si une moto « véhicule de
  prêt » doit porter du stock valorisé.
- **175 articles à stock négatif** après import : **174 viennent du fichier G8 tel quel** (M-45) et
  **1 est antérieur** (référence `85245scsc`, « pneu moto », −1, PAMP 0 — donnée d'essai). Ils
  disparaîtront au prochain comptage ; aucun n'a été créé par l'import.
- **46 motos attendent encore leur prix d'achat** (contre 66 avant le 23/09) : l'inventaire a
  renseigné les **20** motos qu'il contenait. Les 46 autres ne sont pas dans le stock G8 (vendues ou
  hors parc) : leur prix d'achat ne peut venir que d'une facture d'achat.
- **25 motos du site attendent toujours leur châssis** (M-48) : 8 rapprochements étaient possibles,
  **aucun sans ambiguïté**. Elles restent bloquées à la facturation, comme prévu par M-40.
- **126 lignes du fichier sans PAMP** : leur valeur de stock est 0 dans G8 comme dans le DMS. Les
  articles créés pour elles portent le marqueur « à compléter »
  (`to_complete_source = 'inventaire_g8'`).
- **La valeur du stock du DMS n'est pas celle du fichier, et c'est normal** : 689 303 € contre
  911 707 € au fichier. L'écart se décompose en −249 875 € (les 17 motos écartées) et +27 470 € de
  stock que G8 ne connaît pas : **25 470 € de données de démonstration** (`SEED-A-…`, règle 8),
  2 000 € d'une moto hors inventaire, et 232 pièces reprises de Shopify le 21/09 valorisées 0.
- **Toute réponse est coupée à 1 000 lignes (PostgREST `max_rows`)** — silencieusement. Avant le 23/09,
  `listStock` demandait tout le stock en un appel : sur 93 104 articles les écrans ne recevaient que les
  1 000 premières **références**, dont aucune n'a de mouvement. Conséquences constatées : filtre « stock positif »
  de Pièces à **0 ligne**, **valeur totale du stock à 0 €** sur `/stock`, inventaire et étiquettes tronqués,
  disponibilité fausse dans Ventes. Corrigé par la pagination + la portée `actif`.
- **Écrans Stock encore à revoir** (hors lot du 23/09) : `/stock`, `/stock/inventory`, `/stock/depreciation`,
  `/parts/labels` et Ventes chargent toujours **toute** la portée `actif` dans le navigateur puis filtrent côté
  client. C'est juste et rapide aujourd'hui (1 241 lignes), mais il faudra les passer au même motif que Pièces
  (filtre + pagination en base) quand le stock réel sera repris. Conséquence de la portée `actif` : un article
  **sans aucun mouvement et sans mini** n'apparaît plus dans la liste d'inventaire ni dans l'impression
  d'étiquettes en masse (il reste accessible par sa fiche).
- Calcul du stock à la volée (somme de tous les mouvements à chaque liste) : correct mais coûteux quand l'historique grossira. **Index ajouté le 23/09** : `idx_stockmoves_article_cover (article_id) include (is_reservation, qty_delta)` (lecture par index seul).
- ~~**Copies datées et cron**~~ (**corrigé le 18/11** par `20261118210000` : `_stock_photo` sans contrôle d'utilisateur) : `article_stock_list` exige `is_member(_company)`, donc `auth.uid()` non nul. Sous `pg_cron` (aucun utilisateur connecté) elle renvoie **zéro ligne** : les copies du 15 et de fin de mois générées par `_cron_stock_copies` sont probablement **vides**. Constat du 23/09, **antérieur** au lot (le contrôle existait déjà) — à vérifier et corriger.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| INV000 | Paramétrage standard | ✅ fait | types de cession en table de paramètres |
| INV005 | Réappro min/max | 🟦 partiel | `reorder_proposals`, vue Réappro, `/purchases/reorder` ; déclenchement manuel, pas automatique |
| INV006 | Multi-emplacements (casiers) | 🟦 partiel | 2 localisations par article + casier sur le mouvement ; `article_bins` inutilisée ; casier affiché dans la liste de préparation (vue tablette, mission 05 carte 6) ; pas encore en facturation / POS |
| INV007 | Étiquettes personnalisées | ✅ fait | M02 `/parts/labels` ; file différée sans écran |
| INV010 | Stock unifié magasin + e-shop | ✅ fait | même `stock_moves`, e-shop M11 (`avancement.md` E10) |
| INV011 | Inventaire physique annuel | ✅ fait | `/stock/inventory`, fonctions de `20260610320000_m5_inventory.sql` |
| INV015 | Listes de préparation | 🟦 partiel | **Deux origines depuis le 23/09** (mission 07 carte 2, M-42) : un document de vente **ou** un ordre de réparation (`picking_lists.repair_order_id`, `picking_open_for_repair_order`) — depuis un OR, la liste reprend le kit de l'échéance d'entretien et les pièces ajoutées par le technicien, et un bouton « Commander les pièces manquantes » y est posé. `/picking` + vue tablette `/preparation/$pickingId` (M6, `20260726120000_m6_picking_lists`, `20260919310000_m6_preparation_tablette`) : casiers, disponible / en commande, étapes commandé → préparé → monté ; préparation VN (moto + options) via le bouton « Préparer » d'un document ; gestion des listes (mission 02 carte 11, `20260919380000_m6_listes_preparation_gestion`) : filtres, tri, impression A4 avec casiers, régénération depuis le document, terminer, annuler / supprimer tracé, rouvrir — toujours sans mouvement de stock |
| B4 | Triple stock + copies datées | 🟦 partiel | réel/réservé/disponible faits ; « en commande » absent de la liste ; **copies consultables, copies cron non vides, stock à une date (18/11, migrations non appliquées)** |
| B5 | PAMP à chaque entrée | ✅ fait | `record_stock_move` (voir limites §7) |
| B6 | 3 modes de réajustement | ✅ fait (18/11, non appliqué) | 3 modes à l'écran, sur le réel et sur l'arrêté (`/stock/readjust`, inventaire guidé) |
| B7 | Traçabilité append-only | ✅ fait | `stock_moves` sans UPDATE/DELETE, origine + opérateur |
| B12 | Étiquetage | ✅ fait (18/11, non appliqué) | défaut = stock réel ou 1, avec/sans prix et code-barres, double prix tarif, édition différée cumulée **par poste** (`/stock/labels`) |
| Angles morts | Arrêté + 8 méthodes + réintégration | ✅ fait | 8 méthodes en check-list datée avec retour arrière (18/11) |
| | Inventaire tournant avec taux d'écart | ⬜ manquant à l'écran | `cycle_count_candidates` seulement, pas de taux d'écart |
| | Dépréciation par taux/période | 🟦 partiel | taux manuel ; pas de période d'entrée |
| | Historique exhaustif des mouvements | ✅ fait | historique par article, origine + opérateur |
| | Cessions internes typées | ✅ fait | `/stock/cessions` |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-11-18 | **Rattrapage G8 stock** : inventaire guidé (8 méthodes, check-list datée, retour arrière), arrêté réajustable en 3 modes (append-only), réintégration juste et unique, réajustement / remise à zéro du réel, copies consultables et copies cron corrigées, édition multi-critères (8 onglets + rupture, Excel, feuilles d'inventaire), étiquetage par source + file différée par poste | `20261118210000_m5_inventaire_guide`, `20261118211000_m5_editions_stock`, `20261118212000_m5_etiquetage` (non appliquées) |
| 2026-11-03 | Minimax du panier de commande Ducati (mission 09, M04) : `stock_max` = quantité cible, remplissage quotidien `basket-minimax-daily` sur le stock réel, « en commande » déduit ; aucun mouvement de stock | `20261103100000_m4_paniers_de_commande` (non appliquée) |
| 2026-09-23 | **Stock réel de G8 importé** (M-44 à M-48) : 4 249 lignes lues, 4 232 appliquées, 3 627 mouvements `inventaire` origine `import:g8-inventaire-20260923`, 560 articles créés, 4 106 PAMP posés, 4 067 prix d'achat tracés, 3 295 casiers, 20 motos rapprochées par VIN ; 17 motos écartées (249 875 €) | `20260923190000_m5_inventaire_import.sql` |
| 2026-06-11 | Fondation : mouvements append-only, triple stock, PAMP + 5 tests, transfert au remplacement | `1f36698`, `20260610200000_m5_stock_moves` |
| 2026-06-11 | Écran Stock valorisé + historique ; inventaire (arrêté, comptage 2 modes, remise à zéro, écarts, réintégration) | `d93d21e`, `20260610310000`, `20260610320000` |
| 2026-06-11 | Cessions internes typées | `eef6cdc` |
| 2026-06-12 | pg_cron : copies du 15 et de fin de mois, alerte stock dormant | `d58b392`, `20260612170000_pg_cron_stock` |
| 2026-06-12 | Mode casier, inventaire tournant, file d'étiquettes (SQL + API, sans écran) | `6ab5091`, `20260612220000_m5_inventory_b12` |
| 2026-07-26 | Filtres multicritères, export CSV, vue réappro ; dépréciation de stock | `c5a2c7a`, `24ea053`, `20260726110000_m5_stock_depreciations` |
| 2026-09-11 | Paramètres SQL facultatifs passés en `undefined` (appels `record_stock_move` etc.) | `7d31b6d` |
| 2026-09-19 | Disponible avec « en commande » (CMD validées sans réception liée) sur l'écran des commandes de pièces (mission 02, carte 2) | `20260919250000_orders_lines` |
| 2026-09-19 | « En commande » affiché aussi dans la recherche d'article des ventes (mission 05, carte 2), même calcul `_article_on_order_qty` | code seul |
| 2026-09-19 | « En commande » par client (mission 05, carte 7) : un seul calcul `article_on_order_for(article, contact, document)` = CMD pour le stock + quantité magasin non associée des commandes de pièces + commandes de CE client ; la commande d'un autre client n'est jamais comptée ; `_article_on_order_qty` = ce calcul sans client (stock seulement) | `20260919311000_m6_en_commande_par_client` |
| 2026-09-19 | « En commande » sans double comptage (mission 02, carte 4) : `article_on_order_for` redéfinie, une pièce de commande de pièces reliée à une ligne de CMD compte une seule fois ; CMD reçue = plus en commande. Aucun mouvement de stock | `20260919370000_m4_proposition_commande_fournisseur` |
| 2026-09-19 | Liste de préparation sur tablette (mission 05, carte 6) : casiers (principal, second, `article_bins`) et triple stock par ligne ; **aucun mouvement de stock** au changement d'étape (commandé / préparé / monté) | `20260919310000_m6_preparation_tablette` |
| 2026-09-19 | Gestion des listes de préparation (mission 02, carte 11) : impression A4 avec casiers, régénération depuis le document, annuler / supprimer, terminer ; **aucun mouvement de stock** | `20260919380000_m6_listes_preparation_gestion` |
| 2026-09-21 | Reprise du stock Shopify des 300 articles reliés (mission 03, W-10) : 259 mouvements « inventaire » annule-et-remplace, origine `reprise_shopify`, 0 → 305 pièces, PAMP inchangé ; fonction réexécutable `shopify_realign` | `20260921140000_m2_shopify_reprise_stock_prix.sql` |
| 2026-09-23 | `article_stock_list` filtrable et paginée (`_stock` / `_search` / `_limit` / `_offset`, portée `actif`), `listStock` boucle par pages de 1 000 : fin de la troncature silencieuse à 1 000 lignes | `20260923170000_m2_liste_articles_stock_vignettes.sql` |
| 2026-09-21 | Réservation du stock par les commandes du site non payées (mission 03, W-12) : mouvements `reservation` / `liberation` origine `shopify` ; libération au paiement (avant la sortie de la facture, même transaction), à l'annulation, à l'expiration (7 jours, réglable) et à l'arrêt de l'import | `20260921150000_m6_shopify_reservation_commandes.sql` |
| 2026-11-03 | **Réservation des pièces de l'entretien dès le RDV** (mission 10 carte 6, M-111 à M-113) : `stock_reservations`, mouvements `reservation` / `liberation` origine `atelier`, libérée à l'annulation, suit l'OR, consommée à la facture (une seule sortie), re-réservée à l'entrée en stock ; minimax sur réel − réservé − manque, immédiat après réservation | `20261103270000_m8_entretien_reservation.sql` (non appliquée) |
| 2026-11-18 | Réassort minimax immédiat sur toute sortie de `stock_moves` (déclencheur, jamais bloquant, tracé), réglage automatique / manuel par société (voir M04) | `20261119130000_m4_minimax_immediat.sql` (à appliquer) |
