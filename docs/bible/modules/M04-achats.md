---
chapitre: M04
titre: Achats & réceptions
etat: 🟦
verifie_le: 2026-09-19
missions: []
mots_cles: [achat, réception, commande fournisseur, CMD, REC, fournisseur, PAHT, PAMP, entrée de stock, châssis, moto neuve, VIN, DCS, export DCS, STANDARD, URGENTE, proposition de commande, réappro, échéancier, régime TVA, CEE, commandes de pièces, urgente, standard, accident, Excel Ducati]
---

# M04 — Achats & réceptions

> **En une phrase** : enregistrer ce que la concession commande et reçoit de ses fournisseurs, faire entrer la marchandise en stock au bon coût (PAMP), créer la fiche des motos neuves reçues et préparer les commandes Ducati au format DCS.

## 1. À quoi ça sert
Le magasinier y saisit les **réceptions** (facture ou bon de livraison fournisseur) : chaque ligne validée crée
une entrée de stock valorisée qui recalcule le PAMP de l'article. Une ligne de moto neuve avec son **châssis**
crée automatiquement la fiche véhicule. Le module gère aussi les **commandes fournisseur**, la **proposition de
commande** (articles sous le stock mini), les **fiches fournisseurs** (n° client, remise de fin d'année, franco),
l'**échéancier de paiement** et l'**export DCS** (le système de commande Ducati, fermé, qui n'accepte qu'un
fichier). Un second écran, **Commandes de pièces**, amorce le nouveau processus client (urgente / standard /
Excel / accident) décrit dans `docs/process-commandes-pieces.md`.

## 2. Ce qu'on a aujourd'hui

Menu latéral : **Achats & réceptions** (`/purchases`) et **Commandes de pièces** (`/orders`).

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Achats & réceptions → liste (`/purchases`) | Liste des documents d'achat (réceptions REC et commandes CMD) : n°, type, fournisseur, date, statut, TTC. Boutons Fournisseurs, Proposition de commande, Nouvelle réception, Nouvelle commande. |
| Achats & réceptions → Nouveau document (`/purchases/new`) | Éditeur de réception ou de commande : fournisseur, régime TVA (avec TVA / CEE / hors CEE), n° facture et BL fournisseur, n° intranet Ducati, dates ; lignes article (recherche par réf., désignation ou réf. fournisseur) ou texte libre, qté, PA HT, remise %, TVA, PV TTC, localisation, nombre d'étiquettes ; **châssis** d'une ligne moto (VIN, moteur, CV, bridé, TPMS, garantie…) ; remise globale, port, totaux ; échéances de paiement. Boutons **Brouillon** et **Valider**. |
| Achats & réceptions → document (`/purchases/$orderId`) | Consultation **en lecture seule** : en-tête, lignes, totaux, échéances. Sur une commande : **DCS Standard** et **DCS Urgente** (téléchargement CSV). Sur une réception : **étiquette client** (n° de document + nom du client, pour ranger une pièce réservée). |
| Achats & réceptions → Proposition de commande (`/purchases/reorder`) | Articles dont le disponible est sous le stock mini, quantité suggérée (maxi ou mini − disponible), regroupés par fournisseur ; **Créer les commandes** (une CMD validée par fournisseur). Un article peut y être poussé depuis la liste Pièces. |
| Achats & réceptions → Fournisseurs (`/purchases/suppliers`, `/new`, `/$supplierId`) | Fiches fournisseurs (contacts de type fournisseur) : coordonnées, n° client chez le fournisseur, code interne magasin, RFA %, franco de port, minimum de commande. |
| Commandes de pièces → liste (`/orders`) | Commandes filtrées par type (urgente, standard, Excel, accident) avec compteurs ; statut d'envoi. |
| Commandes de pièces → Nouvelle commande (`/orders/new`) | Choix du type et du canal (comptoir / mail) ; crée une commande **vide**. |
| Commandes de pièces → commande (`/orders/$orderId`) | Lignes (qté client / qté magasin), rappel des règles de seuil du type. **Aucun ajout de ligne** dans l'écran (pas de fonction d'écriture de lignes dans `src/modules/orders/api.ts`). |
| Commandes de pièces → Excel (`/orders/excel`) | **Classeur en cours** enregistré en base (un seul ouvert par société) : recherche dans le catalogue Ducati et ajout dans l'onglet actif (Demo / Courtoisie / Showroom), chargement des pièces d'une **commande client de type Excel** (la ligne garde le client), quantité, extra-remise, moto / VIN ; **total par onglet en temps réel** (prix dealer × qté) avec seuil paramétré (2 000 € HTVA) ; **Télécharger** (attribue le n° interne `CEX-AAAA-NNNNN` au 1er téléchargement, on peut continuer à charger ensuite) ; **Clôturer et archiver** (classeur `.xlsx` déposé en GED, dossier « Commandes Excel », commande « clôturée » puis « archivée », un classeur vide s'ouvre). Onglet **Historique** : n°, dates, total par onglet, statut, classeur archivé téléchargeable. |
| Barre du haut (toutes les pages) | **Pastille verte** « Commande Excel : seuil atteint (onglets) » dès qu'un onglet du classeur ouvert atteint le seuil ; visible des rôles magasinier, vendeur, admin ; mène à `/orders/excel`. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.purchases.tsx`, `_app.purchases.index.tsx`, `_app.purchases.new.tsx`, `_app.purchases.$orderId.tsx`, `_app.purchases.reorder.tsx`, `_app.purchases.suppliers.tsx`, `_app.purchases.suppliers.index.tsx`, `_app.purchases.suppliers.new.tsx`, `_app.purchases.suppliers.$supplierId.tsx` ; `_app.orders.tsx`, `_app.orders.index.tsx`, `_app.orders.new.tsx`, `_app.orders.$orderId.tsx`, `_app.orders.excel.tsx` |
| Logique métier | `src/modules/purchases/` : `write-api.ts` (création CMD/REC, calcul des totaux, **entrées de stock + PAMP**, réception châssis → véhicule, commandes depuis propositions), `api.ts` (lectures, fournisseurs, recherche article, `reorder_proposals`), `purchase-editor.tsx`, `dcs-export.ts`, `customer-label-dialog.tsx` ; `src/modules/orders/` : `api.ts`, `excel-api.ts` (classeur, numéro, clôture, GED, historique, traçabilité), `excel-alert.tsx` (pastille verte de la barre du haut, branchée dans `src/components/layout/topbar.tsx`), `thresholds.ts` (`excelTabsSummary`) |
| Tables | `purchase_orders` (en-tête CMD/REC, statut, régime TVA, totaux, lien réception ↔ commande `source_order_id`), `purchase_lines` (lignes, PAHT, casier, étiquettes), `purchase_schedules` (échéancier), colonnes fournisseur sur `contacts` (`supplier_customer_no`, `supplier_is_internal`, `supplier_rfa_rate`, `supplier_franco_min`, `supplier_order_min`) ; `part_orders`, `part_order_lines`, `excel_catalog`, `excel_orders`, `excel_order_lines` (commandes de pièces) |
| Fonctions SQL (RPC) | `record_stock_move` (entrée + PAMP, M5), `reorder_proposals`, `next_document_number` (n° CMD-/REC-/CEX-, M0) ; commande Excel : `excel_order_current`, `excel_order_tab_totals`, `excel_order_threshold`, `excel_order_assign_number`, `excel_order_close` ; trigger `excel_order_lines_frozen_guard` |
| Fonctions serveur (Edge) | aucune |
| Tâches planifiées | aucune |
| Migrations clés | `supabase/migrations/20260610290000_m4_purchases.sql` (schéma + RLS + audit), `20260610300000_m4_reorder.sql`, `20260730160000_orders_parts.sql` (commandes de pièces), `20260919220000_excel_orders_cloture.sql` (clôture, archivage, numérotation CEX, traçabilité), `20260919220100_excel_orders_lignes_figees.sql` (lignes figées après clôture) |
| Tests | `tests/purchases-totals.test.ts`, `tests/orders-thresholds.test.ts` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `purchases`, `orders`, `labels` |

## 4. Règles métier et décisions

- **Réception validée = entrées de stock + PAMP** (B5, B7) : pour chaque ligne article de quantité > 0, `record_stock_move(type 'entree', coût = PA HT × (1 − remise ligne %))`, origine `reception`, référence = n° REC. Le stock n'est jamais modifié directement (règle 3). Le PAMP n'intègre **ni la remise globale ni le port** (voir §7).
- **Numérotation par société** : le n° CMD- / REC- est attribué **à la validation** (`next_document_number`), un brouillon n'a pas de numéro.
- **Calcul des totaux** (G8 R6) : brut HT ligne sur 3 décimales puis arrondi à 2 ; remise globale ; TVA nulle en régime CEE et hors CEE ; port taxé ou non. Correctif du 11/09 : seuls les trois totaux qui sont des colonnes sont écrits (les champs d'affichage faisaient rejeter tout l'insert, **aucune commande ni réception n'était créable** avant le 11/09, commit `7d31b6d`).
- **Réception châssis → fiche véhicule** (ACH004, B9, G8 R4-R5) : une ligne avec VIN crée un `vehicles` lié à l'article (`article_id`), statut `stock_vn`, PA = coût net, prix affiché = PV TTC de la ligne. Le type de gestion de l'article n'est pas contrôlé (devrait être V).
- **Export DCS** (ACH001, glossaire) : DCS fermé, pas d'API ; deux fichiers distincts STANDARD et URGENTE. Aujourd'hui **CSV** (`;`, BOM UTF-8) avec les colonnes Reference ; Designation ; Quantite ; Type, prises sur la réf. fournisseur. Le commentaire du code le dit provisoire : « le mapping exact des colonnes sera aligné sur le gabarit Ducati fourni par le client ».
- **Proposition de commande** (INV005) : `disponible < stock mini` avec `stock mini > 0` ; quantité = (maxi, sinon mini) − disponible. Le conditionnement (`pack_qty`) est affiché mais **n'arrondit pas** la quantité (INV009 manquant). Les commandes créées depuis la proposition ont un PA à 0.
- **Commandes de pièces — décision client du 30/07/2026** (`docs/process-commandes-pieces.md` §0) : on abandonne le classement G8 Stock/Dépannage/Garantie au profit de `urgente / standard / excel / accident` (énum extensible `order_kind`). Seuils : standard 250 € HTVA ; urgente sans minimum, +10 % facturé, 1×/jour ; accident 1 500 € HTVA sinon repasse en standard ; Excel 2 000 € HTVA par onglet. Codés dans `src/modules/orders/thresholds.ts` (valeurs paramétrables via `reference_values` / `order_threshold` d'après le commentaire, à vérifier).
- **Commande Excel (mission 02, 19/09)** : total d'onglet = Σ prix dealer × qté (colonne M du classeur Ducati), le total remisé (colonne O) est affiché pour information ; seuil lu dans `reference_values` `order_threshold` / `excel` → `extra.min_ht_per_tab` (2 000 par défaut ; `extra.dealer_code` / `dealer_name` surchargent le code concession 100645). N° interne type `CEX` (Paramètres → Numérotation), attribué au 1er téléchargement et conservé. Clôture = `.xlsx` en GED (`attachments`, `entity_type = 'excel_order'`, dossier « Commandes Excel ») puis statut `cloture` → `archive` (deux traces d'audit), totaux figés dans `excel_orders.tab_totals` ; un seul classeur ouvert par société (index unique partiel). Traçabilité : chaque ligne porte `catalog_id`, `part_order_id`, `part_order_line_id` et `contact_id` (client de la précommande), pour router la pièce au bon client à la réception. Une commande clôturée est figée (trigger).
- **Multi-société + audit** : `company_id` + RLS `is_member` ; lignes contrôlées via l'en-tête ; triggers `audit_row` sur en-têtes et lignes (B7).

## 5. État en production

Vérifié le 18/09/2026 **dans le code uniquement** (connecteur Supabase non authentifié pendant la session).

- Aucun objet du module ne figure dans la liste des migrations non appliquées du 14/09 (`etat-projet.md` §2).
- `types.ts` (18/09) contient `purchase_orders`, `purchase_lines`, `purchase_schedules` et `part_orders` / `excel_catalog` : ces migrations sont a priori appliquées.
- Le blocage des commandes et réceptions (400 à l'insert) a été corrigé et poussé le **11/09** (`7d31b6d`). Avant cette date, aucune réception n'avait pu être validée depuis l'écran : **les PAMP issus de réceptions DMS sont donc postérieurs au 11/09**.
- **Catalogue Ducati chargé** (vérifié le 19/09) : 866 références pour ITALBIKE STORE (chargées le 30/07), toutes avec prix dealer. Le catalogue n'a pas de colonne d'onglet : il est **commun aux 3 onglets** (le classeur Ducati répète le même catalogue sur Demo / Courtoisie / Showroom). La spécification annonçait ~1 793 lignes : le chargement du 30/07 est peut-être partiel, à confirmer avec le fichier du client. Aucun écran d'import (l'écran signale un catalogue vide).
- Migrations `20260919220000` et `20260919220100` **appliquées** le 19/09 (testées en transaction annulée avant).

Requête de contrôle (lecture seule) :
```sql
select to_regclass('public.purchase_orders'), to_regclass('public.part_orders'), to_regclass('public.excel_catalog');
select exists(select 1 from pg_proc where proname='reorder_proposals');
select doc_type, status, count(*) from public.purchase_orders group by 1,2;
select count(*) from public.excel_catalog;
```

## 6. Prévu / en cours
- **Chantier « Commandes de pièces »** — spécifié, non commencé au-delà du squelette (`etat-projet.md` §7) : proposition depuis les documents de vente, agrégation par fournisseur avec minimum/franco, paiement par QR, terminal Bancontact, signature électronique, classeur Excel Ducati. Spécification : [`../../process-commandes-pieces.md`](../../process-commandes-pieces.md).
- Restes de l'Epic E3 (`docs/avancement.md`) : rapprochement commande ↔ réception, import code-barres / microfiches, **gabarit DCS exact** (fichier Excel à obtenir du client).
- OCR des factures fournisseurs par Claude (prévu au dossier-projet, non commencé).
- Pas de dossier `docs/missions/` à ce jour.

## 7. Limites connues, dettes, pièges
- **Un brouillon ne peut pas être validé plus tard** : l'écran d'un document est en lecture seule et il n'existe pas de fonction de mise à jour. Une réception enregistrée en brouillon n'entrera jamais en stock ; une commande ne se transforme pas en réception (`source_order_id` jamais renseigné).
- **Écritures non atomiques** : l'en-tête, les lignes, les échéances, puis chaque mouvement de stock et chaque véhicule sont écrits un par un depuis le navigateur. Une erreur au milieu laisse une réception « reçue » avec une partie des entrées de stock. Candidat à une fonction SQL transactionnelle.
- **PAMP sans frais d'approche** : port et remise globale ne sont pas répartis sur le coût unitaire ; le PAMP est surestimé en cas de remise globale et sous-estimé en cas de port.
- **Réception de moto sans contrôle** : pas de vérification de l'unicité du VIN ni du type V de l'article ; deux réceptions du même châssis créent deux fiches.
- **Export DCS provisoire** (CSV, colonnes non validées) : à ne pas présenter comme conforme tant que le gabarit Ducati n'est pas reçu. Le classeur Excel généré reprend les colonnes du modèle Ducati mais **n'est pas le fichier Ducati lui-même** (pas de formules ni de mise en forme d'origine, le modèle vierge n'est pas dans le dépôt) : à comparer avec le fichier du client avant le premier envoi. Code concession 100645 par défaut, surchargeable dans `reference_values`.
- Commande Excel : alerte de la barre du haut rafraîchie toutes les 60 s (pas de Realtime) ; archivage non atomique (dépôt GED puis clôture : si la clôture échoue, le fichier reste en GED et la commande reste ouverte, on peut recommencer).
- Recherche d'article en réception par référence / désignation / réf. fournisseur : la table des codes-barres n'est pas interrogée ; un scan fonctionne tant que le code-barres est égal à la référence (règle M02).
- Pas de distinction de rôle : tout membre de la société peut valider une réception (RLS `is_member`).
- Le module `orders` accède à ses tables par un client non typé (`supabase as any`).

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| ACH000 | Paramétrage standard | ✅ fait | fiches fournisseurs, régimes TVA |
| ACH001 | Commandes Ducati standard/urgentes, export DCS | 🟦 partiel | `src/modules/purchases/dcs-export.ts` : 2 fichiers STANDARD/URGENTE mais CSV provisoire, gabarit Ducati non reçu |
| ACH002 | Processus de commande par fournisseur | 🟦 partiel | proposition groupée par fournisseur (`createOrdersFromProposals`) ; minimum de commande / franco saisis mais non appliqués ; pas de mail formaté fournisseur |
| ACH003 | Import des tarifs fournisseurs | ✅ fait | voir M02 (`src/modules/articles/import/`) |
| ACH004 | Réception motos neuves → fiche véhicule | ✅ fait | `createPurchaseOrder`, bloc « Réception châssis » dans `write-api.ts` |
| INV001 | Réception par scan code-barres | 🟦 partiel | recherche par référence (= code-barres par défaut) ; pas de lecture de `article_barcodes` |
| INV003 | Notification client à réception complète | ⬜ manquant | aucune notification ; seule l'étiquette client existe (`customer-label-dialog.tsx`) |
| INV004 | Alerte atelier à réception de pièces d'un OR | ⬜ manquant | pas de lien ligne de réception ↔ OR |
| INV008 | Routage automatique des réceptions | ⬜ manquant | pas de fléchage CLIENT / OR / STOCK |
| INV009 | Arrondi au conditionnement fournisseur | ⬜ manquant | `pack_qty` non utilisé dans `reorder_proposals` ni l'écran |
| B5 | PAMP recalculé à chaque entrée | 🟦 partiel | fait via `record_stock_move` ; frais d'approche non intégrés |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Schéma achats (commandes, réceptions, échéances, champs fournisseur) | `adcf354`, `20260610290000_m4_purchases` |
| 2026-06-11 | Réception = entrée de stock + PAMP ; éditeur REC/CMD ; liste | `7a8f764` |
| 2026-06-11 | Réception châssis → fiche véhicule type V | `fb9aedc` |
| 2026-06-11 | Fournisseurs dans Achats ; échéancier ; proposition de commande ; export DCS CSV | `ba919dc`, `2aa8a48`, `6855534`, `4edd2d9`, `20260610300000_m4_reorder` |
| 2026-07-27 | « Proposer à la commande » depuis Pièces ; étiquette client à la réception | `ec38231`, `1a67fb8` |
| 2026-07-30 | Module Commandes de pièces par type (squelette + classeur Excel) | `2f1e4cf`, `20260730160000_orders_parts` |
| 2026-09-11 | **Commandes et réceptions à nouveau enregistrables** (insert rejeté en 400 depuis la création) | `7d31b6d` |
| 2026-09-19 | Commande Excel Ducati : classeur en base, alerte verte à 2 000 € dans la barre du haut, n° CEX, clôture + archivage GED, historique, traçabilité ligne ↔ client (mission 02) | `20260919220000_excel_orders_cloture`, `20260919220100_excel_orders_lignes_figees` |
