---
chapitre: M13
titre: Reporting
etat: ✅
verifie_le: 2026-09-18
missions: []
mots_cles: [tableau de bord, dashboard, KPI, chiffre d'affaires, CA, marge, PAMP, panier moyen, top articles, N-1, taux de transformation, productivité atelier, encours clients, valeur du stock, rapports]
---

# M13 — Reporting

> **En une phrase** : les chiffres de la concession en un coup d'œil — tableau de bord du jour et rapports sur une période (CA, marge, meilleures ventes, comparaison avec l'an passé, productivité atelier).

## 1. À quoi ça sert
Le gérant et les responsables l'ouvrent pour savoir où en est la journée et le mois (CA, factures,
encours clients, OR ouverts, valeur du stock, motos en stock) et pour analyser une période : ventes
classées par marque, rayon, article, client, opérateur ou mois, avec la marge ; comparaison avec la même
période de l'année précédente ; taux de transformation des devis et réservations ; temps de présence
et de travail des mécaniciens. Tout est calculé à la volée dans la base, rien n'est stocké.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Tableau de bord (`/dashboard`, page d'accueil) | 7 indicateurs de la société active : CA du jour, CA du mois (TTC), factures du mois, encours clients (en rouge s'il est positif), OR ouverts, valeur du stock au PAMP, véhicules en stock (statuts stock VN / VO, dépôt-vente, démo, courtoisie) |
| Rapports (`/reports`) | Période du / au (défaut : depuis le 1er janvier) ; **indicateurs** (nb factures, CA HT, panier moyen, marge, marge %) ; **ventes par** marque / rayon / article / client / opérateur / mois avec quantité, CA HT et marge ; **comparaison N / N-1** ; **taux de transformation** par type de document (créés / transformés) ; **CA des 12 derniers mois** (graphique) ; **top articles vendus** ; **productivité atelier** (présence, travail, taux par mécanicien) |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.dashboard.tsx`, `src/routes/_app.reports.tsx` |
| Appels aux fonctions de calcul | `src/modules/reports/api.ts` |
| Carte indicateur | `src/components/kpi-card.tsx` |
| Tables lues | `documents`, `document_lines`, `articles` (`pamp`, marque, rayon), `repair_orders`, `vehicles`, `workshop_time_entries`, `stock_moves` (via `article_stock_list`) |
| Fonctions SQL (RPC) | `dashboard_kpis`, `monthly_revenue`, `top_articles`, `workshop_productivity`, `report_indicators`, `report_sales_by`, `report_period_compare`, `report_transformation`, `_doc_margin` (marge d'un document : lignes au PAMP, sinon marge G8 d'en-tête), `article_stock_list` (M5) |
| Fonctions serveur (Edge) | aucune |
| Tâches planifiées | aucune (calcul à la demande) |
| Migrations clés | `supabase/migrations/20260610380000_m13_dashboard.sql`, `…20260610410000_m13_reports.sql`, `…20260612210000_m13_advanced_stats.sql`, `…20260612290000_m13_reports_header_aware.sql` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `dashboard`, `reports` |
| Graphique | `recharts` (dépendance `package.json`) |

## 4. Règles métier et décisions
- **Périmètre** : factures (`FAC`) non annulées de la société active ; le CA du tableau de bord est en **TTC**, celui des rapports en **HT**.
- **Marge sur PAMP (B5)** : `marge = HT de la ligne − PAMP de l'article × quantité`. Pour les factures reprises de G8 sans lignes, la marge d'en-tête importée (`documents.marge`) est utilisée (migration `20260612290000_m13_reports_header_aware.sql`, commit `5bb6280`).
- **Valeur du stock** : somme de `stock_value` renvoyée par `article_stock_list` (stock réel × PAMP, M5).
- **Encours clients** : somme des restes dus des factures non annulées.
- **Productivité** : minutes de présence et de travail pointées (M8) sur la période ; taux = travail / présence.
- **Multi-société** : chaque fonction reçoit l'identifiant de la société active (sélecteur de société, M0).

## 5. État en production
Vérifié le 18/09/2026 (code + base).
- **Toutes les fonctions appelées existent en base** (`dashboard_kpis`, `monthly_revenue`, `top_articles`, `workshop_productivity`, `report_*`, `_doc_margin`, `article_stock_list`).
- Les chiffres portent en pratique sur les **17 808 factures reprises de G8** (seules 3 factures ont été créées dans l'application) ; les marges historiques sont donc les marges G8 importées.
- `dashboard_kpis`, `monthly_revenue`, `top_articles` et `workshop_productivity` contrôlent l'appartenance à la société.
- **Sécurité** : `report_indicators`, `report_sales_by`, `report_period_compare` et `report_transformation` sont exécutables **sans être connecté** et laissent passer un appel anonyme (`auth.uid() is null or is_member(...)`) : CA, marges et classement des clients lisibles par quiconque connaît l'identifiant de la société. Voir `00-architecture.md` §9.

## 6. Prévu / en cours
- Aucune mission ouverte sur ce module.
- Demandes du cahier non couvertes : tableau de bord commercial quotidien dédié aux vendeurs (VEN012), productivité par mécanicien en temps facturé (ATE019), rapports personnalisables (COM004).

## 7. Limites connues, dettes, pièges
- **Marge au PAMP actuel** (corrigé le 18/11/2026 pour les ventes nouvelles : coût figé `document_lines.unit_cost` ; reste vrai pour les ventes antérieures) : la marge d'une vente passée est recalculée avec le PAMP **d'aujourd'hui**, pas celui du jour de la vente. Une entrée en stock à un autre prix modifie rétroactivement les marges affichées. B5 demande aussi la marge sur **PA**, non fournie.
- **Productivité incomplète (B11)** : pas de rapprochement avec le temps facturé (lignes main-d'œuvre des OR).
- **Performance** : la valeur du stock parcourt `article_stock_list` sur les 82 090 articles à chaque ouverture du tableau de bord ; les rapports scannent toutes les factures de la période. À surveiller si le tableau de bord devient lent.
- **Bouton « Actualiser »** des rapports ne relance que le top articles et la productivité ; les autres blocs se recalculent au changement de dates.
- ~~Pas d'export~~ : export Excel du module statistiques depuis le 18/11/2026 (onglet Statistiques).

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A.

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| VEN012 | Tableau de bord des activités commerciales quotidiennes | partiel | `/dashboard` (CA jour / mois, factures) ; pas de vue par vendeur ni devis du jour |
| ATE019 | Tableau de bord de productivité par mécanicien | fait (18/11, M8) | Productivité complète dans Atelier → Pointeuse → onglet Productivité atelier (`workshop_productivity_detail`, migration 20261118110000 à appliquer) ; ici, lien depuis le bloc Productivité ; `workshop_productivity` (présence / travail) inchangée |
| COM004 | Tableaux de bord et rapports personnalisés | partiel | 6 rapports fixes, dimension choisie ; pas de rapport paramétrable ni d'export |

Invariants : **B5** partiel (marge sur PAMP courant, pas sur PA) ; **B11** partiel.

## Ajouté le 18/11 — rattrapage G8

Source G8 : `docs/g8-inventaire` (relevé du 18/11/2026) `08-compta-stats.md` (Statistiques, Indicateurs),
`06-ventes-caisse.md` (Stats quotidiennes), `02-articles.md` (Statistiques article) ; comparaison
`comparaison-ventes-caisse-compta.md` §6 et bloquants n° 8 et 19. Branche `lot-g8-stats`.
**Migrations non appliquées** : `20261118180000_m13_chiffres_justes.sql` puis `20261118181000_m13_statistiques_g8.sql`
(après le bloc facture légale `20261103160000` / `20261103180000`) ; essai à blanc `supabase/tests/m13_statistiques_g8.sql`.

**Chiffres justes (bloquant n° 8)** — une seule règle pour le tableau de bord, les rapports d'origine et le module G8
(`_stats_is_sale`) : factures, **tickets** et **avoirs** validés comptent, l'avoir (négatif) est **déduit** ; **brouillons**,
documents annulés et **factures d'acompte (FAA)** exclus (la facture finale porte la vente). Quantités **signées**
(un retour n'augmente plus les ventes). CA d'une ligne = HT de la ligne ramené au HT du document (remise globale
répartie), **port** sur une ligne à part : quel que soit l'axe, le total = total HT des documents. **Coût figé** :
nouvelle colonne `document_lines.unit_cost` remplie à l'écriture de la ligne (PAMP du moment, B5) ; lignes
antérieures = PAMP actuel ; factures G8 sans lignes = marge G8 d'en-tête. Tableau de bord : « Factures et tickets
du mois », CA du jour / du mois en TTC avoirs déduits, nouveau compteur `credit_notes_month`. Accès : les fonctions de
rapport ne laissent plus passer un appel sans connexion et suivent la grille signée (pas le mécanicien) ; le tableau
de bord reste ouvert à tous les rôles.

**Module statistiques façon G8** — Rapports → onglet **Statistiques** (l'ancien écran devient l'onglet **Synthèse**) :

| Fonction G8 | Où dans le DMS |
|---|---|
| Axes fournisseur / marque / rayon (3 niveaux : rayon, sous-rayon, catégorie) / client / opérateur / cessions | Niveaux de classement (aussi mois, jour, année, type de document) ; familles = UID `RR-SS-CC` de `articles.category_path`, libellés de `product-families.ts` |
| Sélection : familles, fournisseur, marque, référence, désignation, casier, client, opérateur, type de cession, période + périodes prédéfinies | Panneau de sélection ; 12 périodes prédéfinies (semaine du lundi) ; options « véhicules uniquement / sauf véhicules / exclure les reprises » (G8 Remises et surfacturations) |
| Classement sur 4 niveaux + dernier niveau article | 4 listes + case « Dernier niveau : article » ; sous-totaux repliables |
| Ventes : quantité, CA HT, % poids CA, marge HT, % marge, % poids marge, nombre de factures, stock, disponible | Onglet Ventes (stock réel, disponible, en commande si le dernier niveau est l'article) + histogramme du 1er niveau |
| Exercices comparés, histogramme comparé | Case « Exercices comparés (N / N-1) » : quantité, CA, évolution, marge N-1 ; barres N / N-1 (une teinte par exercice, pas de camembert : charte §9) |
| Meilleures ventes | Onglet Meilleures ventes : 100 premiers articles par CA ou par quantité |
| Remises | Onglet Remises : brut HT, remise (ligne + globale), % remise, CA net |
| Achats par fournisseur | Onglet Achats (réceptions validées, montant net de la remise globale, port) |
| Tableau de bord mois par mois | Onglet Mois par mois : entrées / sorties de stock, sorties N-1, quantités vendues N / N-1, CA N / N-1, évolution, marge, achats N / N-1, total, stock actuel de la sélection + histogramme |
| Cessions internes | Onglet Cessions internes : mouvements `cession` typés (Paramètres → Tables) + pièces et main-d'œuvre d'ORO, valeur au coût |
| Documents en cours | Onglet Documents en cours : devis, BC, réservations, BL, OR, commandes fournisseur non transformés (nombre, quantité, CA HT, marge) |
| Indicateurs (créés / en cours / transformés, panier moyen, articles par document) | Onglet Indicateurs : FAC, TIK, AVO, FAA, DEV, BC, RES, BL, OR, CMD, REC, CES ; « transformés en » par type cible |
| Stats quotidiennes (avec cumul / détaillées) | Onglet Stats quotidiennes : article, fournisseur, quantité, montant HT, prix d'achat, marge, % marge, stock réel, disponible, en commande |
| Visualiser · Imprimer · Export Excel | Boutons (sélection appliquée au clic, comme G8) ; export `.xlsx` (SheetJS) de l'onglet affiché, sous-totaux compris |
| Statistiques article : cumulées, annuelles, N-1, N-2, par mois, « exclure cession » | Fiche article → onglet Statistiques (`article_stats`) ; ancien affichage tant que la migration n'est pas posée |

Où : `src/modules/reports/stats-core.ts` (logique pure, testée), `stats-filters.ts`, `stats-api.ts`, `stats-export.ts`,
`stats-screen.tsx`, `article-stats-panel.tsx` ; fonctions SQL `stats_query`, `stats_monthly`, `stats_indicators`,
`stats_open_documents`, `article_stats` (réponses JSON : jamais tronquées à 1 000 lignes), socle `_stats_facts`
(sources ventes, achats, cessions, mouvements), `_stats_keep` (filtres), `_stats_dim` (axes), type `stats_fact`.
Libellés : blocs `stats` et `articleStats` (FR, NL, EN, IT). Tests : `tests/statistiques-g8.test.ts`.

Pièges : le fournisseur d'un article = `articles.main_supplier_id`, sinon le premier `article_suppliers` ; or au
18/11 aucun article n'est relié à un fournisseur en base (journal §5) : l'axe fournisseur des **ventes** reste
« (non renseigné) » tant que ce lien n'est pas repris de G8 (l'onglet Achats, lui, lit le fournisseur de la réception).
Le nombre de factures n'est exact qu'au niveau le plus fin (un document peut tomber dans plusieurs groupes) : vide sur
les sous-totaux. Hors périmètre (à trancher) : commissions vendeurs, marge nette par véhicule.

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Tableau de bord branché sur la base | `bffc2bb`, `20260610380000_m13_dashboard.sql` |
| 2026-06-11 | Rapports : CA 12 mois, top articles, productivité atelier | `837b2f9`, `20260610410000_m13_reports.sql` |
| 2026-06-12 | Statistiques avancées : classement, marge, N-1, transformation | `901e7dc`, `20260612210000_m13_advanced_stats.sql` |
| 2026-06-12 | Rapports compatibles avec les factures G8 sans lignes | `5bb6280`, `20260612290000_m13_reports_header_aware.sql` |
| 2026-11-18 | **Rattrapage G8** : chiffres justes (avoirs déduits, brouillons et FAA exclus, tickets comptés, coût figé), module statistiques façon G8 (9 onglets, 4 niveaux + article, N-1, export Excel, stats quotidiennes), statistiques de la fiche article | branche `lot-g8-stats` ; `20261118180000_m13_chiffres_justes.sql`, `20261118181000_m13_statistiques_g8.sql` **non appliquées** |


## Ajouté le 20/11 — CA HT du tableau de bord (décision Q66)
Branche `lot-decisions-q63-q67`. Migration **`20261120153000_m13_ca_ht_hors_depot.sql` (non appliquée)**, essai à blanc
`supabase/tests/m13_ca_ht_hors_depot.sql` (12/12). `dashboard_kpis` (même signature, anciennes clés gardées, ≈ 80 ms
avant comme après) ajoute `revenue_ht_today` / `revenue_ht_month` (**CA HT hors ventes pour le compte des déposants**),
`revenue_ht_*_incl_consignment` (**y compris dépôt-vente**) et `consignment_ht_*` (l'écart). Ventes = `_stats_is_sale`
(factures, tickets, avoirs déduits ; brouillons, annulés, FAA exclus) ; part dépôt-vente = lignes d'article de type D
(remise globale au prorata). La commission facturée au déposant reste du CA du magasin. Carte du tableau de bord :
CA HT en grand, « y compris dépôt-vente » dessous ; sans la migration, ancien CA TTC.
