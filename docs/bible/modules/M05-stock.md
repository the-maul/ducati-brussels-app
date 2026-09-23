---
chapitre: M05
titre: Stock & inventaire
etat: 🟦
verifie_le: 2026-09-18
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

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.stock.tsx`, `_app.stock.index.tsx`, `_app.stock.inventory.tsx`, `_app.stock.cessions.tsx`, `_app.stock.depreciation.tsx` |
| Logique métier | `src/modules/stock/` : `api.ts` (triple stock d'un article, mouvements, `recordMove`, transfert au remplacement, `computePamp` de référence), `stock-api.ts` (liste valorisée, historique, cessions), `inventory-api.ts` (sessions, arrêté, comptage, remise à zéro, réintégration, écarts, **et** fonctions sans écran : comptage par casier, tournant, file d'étiquettes), `inventory-screen.tsx`, `depreciation-api.ts`, `stock-export.ts` |
| Tables | `stock_moves` (mouvements, **append-only**), `inventory_sessions` (inventaires), `stock_snapshots` + `stock_snapshot_lines` (arrêtés et copies datées, qté + PAMP), `label_queue` (file d'étiquettes différée), `stock_depreciations` (provisions de décote, annulables jamais supprimées) ; `articles.pamp` (PAMP courant, M02) |
| Fonctions SQL (RPC) | `record_stock_move` (**porte d'entrée unique** : insère le mouvement et recalcule le PAMP), `article_stock`, `article_stock_list` (**filtrable et paginée depuis le 23/09** : `_stock` = `all` / `actif` / `pos` / `neg` / `zero`, `_search`, `_limit`, `_offset`), `article_stock_history`, `bin_stock`, `generate_stock_snapshot`, `record_inventory_count` (modes `annule_remplace`, `cumul`, `casier`), `reset_real_stock`, `reintegrate_snapshot`, `inventory_gaps`, `cycle_count_candidates`, `enqueue_label`, `transfer_stock_on_replace`, `dormant_stock`, `stock_value_owned` (hors dépôt-vente, M7), `_cron_stock_copies`, `_cron_maybe_stock_copy`, `_cron_dormant_alert` |
| Fonctions serveur (Edge) | aucune |
| Tâches planifiées | `stock-copies-daily` (tous les jours 22:30 UTC → copie datée si on est le 15 ou le dernier jour du mois), `dormant-stock-alert` (le 1er du mois 05:00 UTC → trace dans `events` le nombre et la valeur des articles A sans mouvement depuis 4 mois). Présence dans `cron.job` : à vérifier. |
| Migrations clés | `supabase/migrations/20260610200000_m5_stock_moves.sql` (fondation, PAMP), `20260610310000_m5_stock_views.sql`, `20260923170000_m2_liste_articles_stock_vignettes.sql` (pagination et filtre de `article_stock_list`, appliquée le 23/09), `20260610320000_m5_inventory.sql`, `20260612170000_pg_cron_stock.sql`, `20260612220000_m5_inventory_b12.sql` (mode casier, tournant, étiquettes), `20260726110000_m5_stock_depreciations.sql` |
| Tests | `tests/pamp.test.ts` (formule PAMP côté JS uniquement) |
| Libellés | `src/lib/i18n/fr.ts`, bloc `stock` |

## 4. Règles métier et décisions

- **Le stock réel est une somme de mouvements, pas un champ** (règle 3, B7) : `stock_moves` n'accepte que INSERT et SELECT pour les utilisateurs (`revoke update, delete ... from authenticated`). Chaque mouvement porte type, quantité signée, coût unitaire éventuel, casier, **origine** (`screen`, `reception`, `sale`, `inventory`, `replacement`, `oro`, `cession`…), n° de document, note, **opérateur** et horodatage. Une annulation est un mouvement inverse, jamais une suppression.
- **Types de mouvement** : `entree`, `sortie`, `reservation`, `liberation`, `inventaire`, `transfert`, `cession`, `correction`.
- **Triple stock** (B4) : réel = somme des mouvements hors réservation ; réservé = somme des mouvements `is_reservation` ; disponible = réel − réservé. **Qui réserve** : les bons RES / BL (M06) et, depuis le 21/09, les **commandes du site pas encore payées** (mission 03, W-12 : origine `shopify`, réf. = n° de commande « #… », libérées au paiement, à l'annulation ou après 7 jours ; table `shopify_order_reservations`). **Écart avec l'invariant** : B4 définit disponible = `réel − réservé + en commande` ; les quantités en commande ne sont pas ajoutées (colonne « en commande » vide dans Pièces). L'« arrêté » est porté par `stock_snapshots`.
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
- **Multi-société** : toutes les tables ont `company_id` (lignes d'arrêté via l'en-tête) + RLS `is_member`.

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
- **Copies datées invisibles** : aucune lecture de `stock_snapshots` dans l'application hors génération d'arrêté ; B4 exige qu'elles soient « consultables a posteriori ».
- **Porte dérobée PAMP** : la RLS `stockmoves_insert` autorise tout membre à insérer **directement** dans `stock_moves` sans passer par `record_stock_move` ; une entrée ainsi créée ne recalcule pas le PAMP. Le code de l'application passe toujours par la fonction, mais la base ne l'impose pas.
- **Appels anonymes** : `record_stock_move`, `record_inventory_count`, `enqueue_label`, `cycle_count_candidates`, `dormant_stock` sautent le contrôle d'appartenance quand `auth.uid()` est nul (prévu pour pg_cron). Si l'exécution reste ouverte au rôle `anon` (audit Supabase, `etat-projet.md` §5), un appel sans connexion peut écrire des mouvements ou lire le stock d'une société. **À vérifier en priorité** (requête §5).
- **Mouvement manuel depuis la fiche article** : n'importe quel membre peut saisir une entrée valorisée, une sortie ou une correction ; aucune restriction par rôle (magasinier).
- **Filtre « stock dormant » des dépréciations factice** : il retient les articles à disponible > 0, pas ceux sans mouvement depuis N mois (TODO dans `src/routes/_app.stock.depreciation.tsx`).
- **Alerte stock dormant limitée aux pièces (type A)** et écrite seulement dans `events` : personne n'est notifié, et les motos ne sont pas concernées (VEH008, voir M03).
- Les cessions ne figent pas leur valeur (pas de `unit_cost`) : une statistique a posteriori valorisera au PAMP du moment de la consultation.
- **Entrées sans coût et PAMP** : un mouvement positif sans `unit_cost` (inventaire, reprise Shopify W-10 du 21/09 : 305 pièces sur 259 articles, origine `reprise_shopify`) ne change pas le PAMP. Si le PAMP est à 0, la réception suivante calcule la moyenne avec ces pièces à 0 (1 pièce reprise + 1 reçue à 100 € → PAMP 50 €) : la formule ne repart du coût que si le stock avant est ≤ 0.
- **Le stock de G8 n'est pas en base** (constat du 23/09, question Q19) : `stock_moves` ne contient que
  1 093 mouvements, aucun d'origine G8. Sur les 81 473 articles repris de G8, **260 ont un stock**, venu de
  la reprise Shopify. Tant que l'export de stock G8 n'est pas importé, la liste affichera 0 partout : c'est
  la donnée qui manque, pas l'écran.
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
- **Copies datées et cron** : `article_stock_list` exige `is_member(_company)`, donc `auth.uid()` non nul. Sous `pg_cron` (aucun utilisateur connecté) elle renvoie **zéro ligne** : les copies du 15 et de fin de mois générées par `_cron_stock_copies` sont probablement **vides**. Constat du 23/09, **antérieur** au lot (le contrôle existait déjà) — à vérifier et corriger.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| INV000 | Paramétrage standard | ✅ fait | types de cession en table de paramètres |
| INV005 | Réappro min/max | 🟦 partiel | `reorder_proposals`, vue Réappro, `/purchases/reorder` ; déclenchement manuel, pas automatique |
| INV006 | Multi-emplacements (casiers) | 🟦 partiel | 2 localisations par article + casier sur le mouvement ; `article_bins` inutilisée ; casier affiché dans la liste de préparation (vue tablette, mission 05 carte 6) ; pas encore en facturation / POS |
| INV007 | Étiquettes personnalisées | ✅ fait | M02 `/parts/labels` ; file différée sans écran |
| INV010 | Stock unifié magasin + e-shop | ✅ fait | même `stock_moves`, e-shop M11 (`avancement.md` E10) |
| INV011 | Inventaire physique annuel | ✅ fait | `/stock/inventory`, fonctions de `20260610320000_m5_inventory.sql` |
| INV015 | Listes de préparation | 🟦 partiel | `/picking` + vue tablette `/preparation/$pickingId` (M6, `20260726120000_m6_picking_lists`, `20260919310000_m6_preparation_tablette`) : casiers, disponible / en commande, étapes commandé → préparé → monté ; préparation VN (moto + options) via le bouton « Préparer » d'un document ; gestion des listes (mission 02 carte 11, `20260919380000_m6_listes_preparation_gestion`) : filtres, tri, impression A4 avec casiers, régénération depuis le document, terminer, annuler / supprimer tracé, rouvrir — toujours sans mouvement de stock |
| B4 | Triple stock + copies datées | 🟦 partiel | réel/réservé/disponible faits ; « en commande » absent ; copies non consultables ; cron à vérifier |
| B5 | PAMP à chaque entrée | ✅ fait | `record_stock_move` (voir limites §7) |
| B6 | 3 modes de réajustement | 🟦 partiel | 3 modes en SQL, 2 à l'écran |
| B7 | Traçabilité append-only | ✅ fait | `stock_moves` sans UPDATE/DELETE, origine + opérateur |
| B12 | Étiquetage | 🟦 partiel | défaut = stock réel, avec/sans prix et code-barres ; édition différée sans écran |
| Angles morts | Arrêté + 8 méthodes + réintégration | ✅ fait | 3 options × 2 modes à l'écran |
| | Inventaire tournant avec taux d'écart | ⬜ manquant à l'écran | `cycle_count_candidates` seulement, pas de taux d'écart |
| | Dépréciation par taux/période | 🟦 partiel | taux manuel ; pas de période d'entrée |
| | Historique exhaustif des mouvements | ✅ fait | historique par article, origine + opérateur |
| | Cessions internes typées | ✅ fait | `/stock/cessions` |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
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
