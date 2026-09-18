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
- **Marge au PAMP actuel** : la marge d'une vente passée est recalculée avec le PAMP **d'aujourd'hui**, pas celui du jour de la vente. Une entrée en stock à un autre prix modifie rétroactivement les marges affichées. B5 demande aussi la marge sur **PA**, non fournie.
- **Productivité incomplète (B11)** : pas de rapprochement avec le temps facturé (lignes main-d'œuvre des OR).
- **Performance** : la valeur du stock parcourt `article_stock_list` sur les 82 090 articles à chaque ouverture du tableau de bord ; les rapports scannent toutes les factures de la période. À surveiller si le tableau de bord devient lent.
- **Bouton « Actualiser »** des rapports ne relance que le top articles et la productivité ; les autres blocs se recalculent au changement de dates.
- **Pas d'export** (CSV / Excel) des rapports.

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A.

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| VEN012 | Tableau de bord des activités commerciales quotidiennes | partiel | `/dashboard` (CA jour / mois, factures) ; pas de vue par vendeur ni devis du jour |
| ATE019 | Tableau de bord de productivité par mécanicien | partiel | `workshop_productivity` (présence / travail) ; pas de temps facturé |
| COM004 | Tableaux de bord et rapports personnalisés | partiel | 6 rapports fixes, dimension choisie ; pas de rapport paramétrable ni d'export |

Invariants : **B5** partiel (marge sur PAMP courant, pas sur PA) ; **B11** partiel.

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Tableau de bord branché sur la base | `bffc2bb`, `20260610380000_m13_dashboard.sql` |
| 2026-06-11 | Rapports : CA 12 mois, top articles, productivité atelier | `837b2f9`, `20260610410000_m13_reports.sql` |
| 2026-06-12 | Statistiques avancées : classement, marge, N-1, transformation | `901e7dc`, `20260612210000_m13_advanced_stats.sql` |
| 2026-06-12 | Rapports compatibles avec les factures G8 sans lignes | `5bb6280`, `20260612290000_m13_reports_header_aware.sql` |
