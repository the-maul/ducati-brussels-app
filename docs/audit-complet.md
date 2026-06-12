# Audit complet avant go-live — DMS Ducati Bruxelles

> **Objectif** : confronter ce qu'on a codé à la **réalité de G8 (Orisha/Futurosoft)** et au **droit belge**,
> sans complaisance. Distinguer **RÉEL · PARTIEL · SIMULÉ/STUB · MANQUANT**. Préparer la revue client.
> **Méthode** : relecture des 38 captures G8 (`infos app/` + `docs/reference-g8/`), des manuels G8
> (`Info Doc/` : Compta, LCR, Clôture, Statistiques, Tarifs clients, Annulation règlements, CGV…),
> et **audit du code réel** (`src/modules`, `src/routes`, `supabase/migrations`, `supabase/functions`, `tests`).
> Date : 2026-06-12.

---

## 0. Résumé exécutif (à lire en premier)

**Ce qui est solide et démontrable en confiance** : le **cœur transactionnel** est réel et bien architecturé
en append-only (B7) : **POS/ventes** (FAC/DEV/RES/BL/TIK/AVO, pied de facture, encaissement multi-modes,
clôture Z), **stock/PAMP** (triple stock, mouvements append-only, PAMP testé), **atelier** (OR cycle B8,
garantie B10 refus partiel, chronos B11, planning), **reprise/ORO** (marge par VIN), **site builder e-shop**,
**dashboard/rapports** branchés sur la vraie DB.

**Ce qu'il NE faut PAS démontrer comme « fait »** (cassé en bout de chaîne ou format non final) :
1. ~~**Paiement Stripe de bout en bout** — pas de webhook~~ → ✅ **RÉSOLU (P0.1, 2026-06-12)** : `stripe-webhook` + `finalize_web_order` (commande→payée + facture + sortie stock), déployé et testé. Reste à poser le vrai `whsec` live.
2. **Exports compta/Ducati** — ✅ **Winbooks RÉSOLU (P0.2)** : vrai moteur d'écritures + export Actage (compte tiers réel). Reste : UBL **non transmis** à Falco/Peppol (P0.4), DCS au mauvais format (P0.3).
3. **E-mails / SMS** — **aucun envoi réel** nulle part (le « journal des communications » CRM n'envoie rien).
4. **TVA sur marge (occasions)** — absente (exigence légale belge).
5. **Notifications / signatures électroniques** — non implémentées.

**3 vérités dérangeantes à intégrer :**
- **Même G8 ne « tient pas les livres »** : c'est un **exporteur** vers un logiciel comptable tiers. MAIS il
  **génère de vraies écritures équilibrées**. ✅ **CONSTRUIT (P0.2, 2026-06-12)** : moteur d'écritures
  (ventilation compte vente×TVA, comptes auxiliaires clients, TVA collectée, règlements sur trésorerie),
  append-only + équilibré + testé, et **export Winbooks Actage avec compte tiers réel** (fini l'UUID).
- **Des pans entiers de G8 ne sont pas construits** : **effets de commerce (LCR/traites)**, **clôture
  d'exercice archivante**, **moteur de statistiques** (4 niveaux × 8 onglets), **moteur de tarifs clients**
  (coefficient + remise quantitative à paliers), **annulation de règlements transférés** (contre-passation).
- ~~**Invariant B7 violé sur les prix**~~ → ✅ **CORRIGÉ (P0.5, 2026-06-12)** : table `price_changes`
  append-only + trigger traçant **toute** modification de prix (cascade incluse) ; RPC `record_price_change`
  pour l'origine. Plus aucun UPDATE de prix silencieux.
- ~~**Aucune donnée seed**~~ → ✅ **FAIT (2026-06-12)** : seed complet par société (300 articles tous types, 20 clients, 12 véhicules, 5 OR).

---

## 1. État honnête par module

Légende : ✅ RÉEL · 🟡 PARTIEL · 🟠 SIMULÉ/STUB · ⛔ MANQUANT.

### M0 — Socle / Paramètres
- ✅ Multi-société + RLS + rôles + audit `events` (B7) · séquences configurables · tables de référence · gestion utilisateurs · **gestion des sociétés** (TVA/IBAN/Peppol).
- 🟠 Recherche globale (Ctrl+K présent, branchement DB à confirmer en UI).
- ✅ **Seed data** (2026-06-12) : par société 300 articles (tous types A–R/T), 20 clients, 12 véhicules, 5 OR + stock + comptes auxiliaires. Règle 8 respectée.

### M1 — Contacts
- ✅ Fiche parité G8, CRUD, recherche, filtre par type, hub Contacts.
- 🟡 Onglets (parc, communications, sous-contacts, livraisons) · encours autorisé/actuel calculé.
- ✅ **Tarifs client** (remise %/coefficient/paliers) — moteur `resolve_customer_price` + écran (2026-06-12).

### M2 — Articles & tarifs
- ✅ Référentiel A–R/T, barcodes (Code128 réel), kits, casiers · **moteur de prix interactif** · **table d'arrondis** · import tarifs CSV (testé) · remplacement de réf (transfert stock + PAMP).
- ✅ **Modification en cascade** : actions prix tracées via `record_price_change` (P0.5).
- ✅ **`price_changes` append-only** (P0.5) : table + trigger traçant toute modif de prix. ⛔ reste : équivalences · librairie · stats article détaillées.

### M3 — Véhicules
- ✅ Fiche VIN parité G8, parc, filtres, historique propriétaires, création auto depuis reprise.
- 🟡 Création auto depuis réception châssis (présente, à re-tester).
- ✅ **Alerte stock dormant > 4 mois (pg_cron)** (2026-06-12) : `dormant_stock` + job mensuel.

### M4 — Achats & réceptions
- ✅ Fournisseurs (RFA/franco/mini), réception → entrées stock + PAMP, proposition de commande, échéancier, régimes TVA.
- 🟡 Réception châssis → véhicule (à re-tester).
- 🟠 **Export DCS** = CSV générique `Reference;Designation;Quantite;Type` — **PAS le format DCS Ducati réel**.

### M5 — Stock & inventaire
- ✅ `stock_moves` append-only · triple stock · **PAMP recalculé (B5, testé)** · arrêté daté, écarts, réintégration · cessions internes.
- 🟡 **B6 : 2 modes de réajustement sur 3** (annule-remplace + cumul ; le « casier à la volée » n'est pas un vrai 3e mode).
- ✅ **Copies datées auto 15/fin de mois (B4)** via pg_cron (2026-06-12). ⛔ reste : inventaire tournant · étiquetage différé (B12) · dépréciation PAMP.

### M6 — Ventes / POS / Caisse
- ✅ Éditeur tous types + numérotation · pied de facture (testé) · stock à la validation (réel/réservé) · conversions · avoirs · encaissement multi-modes/différé/rendu monnaie · **clôture Z** · **caisse comptoir** (scan→panier→ticket) · impression (HTML→print).
- ⛔ N° série/REP au POS · duplicata · regroupement BL · **mode de règlement « REPRISE MOTO »** · **« Visible en caisse » par mode** · ouverture tiroir / impression chèque · acompte direct.

### M7 — Reprise / Occasion / Dépôt / ORO
- ✅ Flux B3 (article O/P + véhicule + entrée stock + ORO) · ORO imputé au coût de revient · marge par VIN · cessions internes typées.
- ✅ **TVA sur marge (B2) + registre VO + attestation PDF** (2026-06-12) : calcul (PV−PA, 21/121), registre chronologique, résumé déclaration, attestation TRAXIO. ⛔ reste : **dépôt-vente (type D) + commission** · reprise depuis POS.

### M8 — Atelier
- ✅ OR cycle B8 · garantie B10 (refus partiel, blocage facturation) · chronos B11 (pointage + temps/OR) · planning/RDV + création OR depuis RDV.
- 🟡 **Rapprochement temps passé/facturé** (passé enregistré ; association non faite).
- ⛔ Devis réparation PDF · **notifications SMS/mail RDV** · checklist « opérations atelier » réutilisable · tâches hors-facturation · planning avec **taux de charge %**.

### M9 — Documents / GED
- ✅ Pièces jointes (Storage privé `ged`, RLS, URL signées, libellés, photos) sur véhicule/contact/OR/article.
- ⛔ **Signature électronique** · **portails client** · **modèles de documents configurables** · **CGV imprimées au verso**.

### M10 — CRM
- ✅ Pipeline leads (kanban 6 étapes).
- 🟠 **Journal de communications = saisie d'historique, n'envoie RIEN** (ni e-mail ni SMS).
- ⛔ **Envoi e-mail/SMS réel** (Resend/Twilio/Graph — zéro code d'envoi) · campagnes/mailings · matching auto · RGPD portabilité · histo email/SMS réel.

### M11 — E-shop / Site
- ✅ Catalogue stock unifié · **site builder multi-pages + 14 blocs + upload images** · **storefront public `/shop/{slug}` (anon sécurisé)** · commande web + réservation stock · réglages + domaine.
- 🟠 **Stripe Checkout** : session créée **si clé fournie**, sinon 501 silencieux.
- ✅ **`stripe-webhook`** (P0.1, 2026-06-12) : Edge Function signature HMAC + RPC `finalize_web_order` idempotente → commande **payée** + **facture FAC** (ventilation TVA) + **sortie stock réel** (append-only) + règlement. Storefront confirme au retour (`?paid=1`). **Déployé + testé par POST** (clé test posée). *Reste : poser le vrai `whsec` depuis l'endpoint Stripe live.*
- ⛔ e-mails de commande · automatisation DNS OVH.

### M12 — Compta / UBL / Winbooks
- ✅ Journal des ventes + registre TVA (RPC) · champs vendeur société (TVA/IBAN/Peppol).
- ✅ **Plan comptable PCMN + mapping paramétrable** (P0.2, 2026-06-12) : `chart_of_accounts`, `account_mappings` (dimension×clé→compte+journal), comptes auxiliaires clients/fournisseurs (`generate_auxiliary_accounts`).
- ✅ **Moteur de génération d'écritures équilibrées** (P0.2) : `generate_sales_entries` (client TTC / ventes HT par compte×taux / TVA collectée) + `generate_payment_entries` (trésorerie/client), append-only + idempotent. **Testé par POST : pièces équilibrées.**
- ✅ **Export Winbooks au format réel Actage** (P0.2) : depuis les écritures, **compte tiers réel** (fini l'UUID), montants signés équilibrés. *Reste : caler les colonnes sur le gabarit exact du comptable.*
- 🟡 **UBL Peppol BIS 3.0** généré et testé, **mais juste téléchargé** (non transmis).
- ⛔ **Transmission Falco/Peppol** (aucun connecteur) · TVA marge VO (compte dédié seedé 451090, calcul B2 à brancher) · annulation de règlements transférés.

### M13 — Reporting
- ✅ Dashboard KPIs réels · CA 12 mois · top articles · productivité atelier.
- 🟡 Rotation de stock, comparaison N-1/N-2, ventilations multi-niveaux (G8 fait beaucoup plus, cf. §3).

### M14 — Migration
- ✅ Import contacts CSV (dry-run + lots, testé).
- ⛔ Import articles/véhicules · rapports d'écarts · mapping G8.

---

## 2. Conformité aux invariants B1–B12 (CLAUDE.md §3)

| Invariant | État | Note |
|---|---|---|
| B1 types de gestion A–R/T | ✅ | porté par l'article |
| **B2 TVA marge VO + registre** | ✅ | **FAIT (2026-06-12)** : `vo_margin_register`/`vo_margin_summary` (PV−PA, 21/121) + panneau registre + attestation PDF TRAXIO. Reste : ventiler la TVA marge dans le moteur d'écritures (compte 451090). |
| B3 flux de reprise | ✅ | reprise → occasion + véhicule + ORO |
| **B4 triple stock + copies datées** | ✅ | triple stock ✅ ; **copies 15/fin de mois auto** via pg_cron (2026-06-12) |
| B5 PAMP | ✅ | moyenne pondérée, testée |
| **B6 3 modes de réajustement** | 🟡 | **2/3** (casier à la volée manquant) |
| **B7 append-only stock** | ✅ | `record_stock_move`, `revoke update/delete` |
| **B7 append-only prix** | ✅ | **CORRIGÉ (P0.5, 2026-06-12)** : `price_changes` + trigger traçant toute modif de prix (cascade incluse) |
| B8 cycle OR | ✅ | réception → facture |
| B9 n° de série | ✅ | jointure article↔véhicule |
| B10 garantie (refus partiel) | ✅ | ligne par ligne |
| B11 productivité (3 étages) | 🟡 | présence + travail ✅ ; **temps facturé non rapproché** |
| B12 étiquetage | 🟡 | étiquette code-barres ✅ ; **file différée cumulable ⛔** |

**Tests (règle 7)** : 39 tests, **tous sur fonctions pures** (PAMP, totaux, import, UBL, barcode). **Non couverts
alors qu'exigés** : réservations, arrêté/réintégration inventaire, encours crédit, imputation ORO, TVA marge,
**RLS**. Aucun test d'intégration DB.

---

## 3. Parité G8 — ce que G8 fait que nous avons sous-estimé

> Source : manuels G8 (`Info Doc/`) + captures. **G8 lui-même n'est pas un logiciel comptable** (il exporte
> vers Ciel/EBP/CIVERS/Winbooks), mais le **travail amont** est ce qu'il faut répliquer.

### 3.1 Compta — moteur de génération d'écritures (pas un simple export)
G8 fait : **mapping plan comptable** (comptes clients/fournisseurs auxiliaires + collectifs ; comptes
ventes/achats par **Rayon×Sous-rayon×Catégorie×TVA** ; compte détaxe/rétrocession ; comptes **TVA
collectée/déductible/intracom/occasion-marge/écotaxe** ; comptes règlements par mode → trésorerie+journal ;
cessions en classe 8/9 analytique). **Paramétrage du transfert** (cible Ciel/EBP/Winbooks → format ; par date
ou par n° facture ; **pièce-par-pièce** (permet lettrage) vs **semi-globale**). **Prévisualisation des
écritures** avant export.
➡️ **Notre M12 doit construire ces écritures**, pas dumper des factures. L'export (CSV/UBL) est la dernière étape.

### 3.2 Effets de commerce — LCR / traites (sous-système entier, ⛔ chez nous)
Conditions de règlement avec **« géré en LCR »**, calcul auto d'échéance ; **LCR immédiate** (traite papier) ;
**LCR groupée** (sélection banque + type LCR : encaissement/escompte/dispo/daily) ; **génération fichier
magnétique banque** ; **gestion des impayés** (remise en dû via mode LCR négatif) ; récapitulatifs.
➡️ Équivalent belge moderne : **domiciliation SEPA (pain.008)** + effets de commerce.

### 3.3 Clôture d'exercice archivante (⛔ chez nous)
Sauvegarde obligatoire → **éditions pré-clôture impératives** (débiteurs/créditeurs, acomptes, chèques/LCR à
échéance) → transfert compta AVANT → clôture **par poste de données** (Sauvegarde/Archivage/Réintégration/
Compactage). Pas un simple flag.

### 3.4 Statistiques (moteur 4 niveaux × 8 onglets — 🟡 chez nous = basique)
Filtres cumulables (famille/article/client/opérateur/cession/période, présélections), **classement 4 niveaux**,
6 options Inclus/Exclus/Uniquement, 8 onglets (Ventes + **comparaison N-1/N-2**, **Meilleures ventes par marge**,
Remises, Achats, **Tableau de bord rotation/CA/marge**, **Cessions valorisées PV HT + PAMP**, Documents en
cours, **Indicateurs : panier moyen, taux de transformation**).

### 3.5 Tarifs clients — moteur multi-niveaux (⛔ chez nous)
Tarif client = remise % **OU** coefficient `(PAHT×coef)+TVA=PVTTC` **OU** **remise quantitative à paliers**,
par produit/famille, affecté au client. + **Import catalogue fournisseur** (Excel/CSV/largeur fixe) avec
**formats de mapping réutilisables** et options fines (PV hausse/baisse, garder coef, ne pas recréer réf
remplacées, créer en librairie). Volumétrie réelle vue : **96 000 articles**.

### 3.6 Annulation / modification de règlements (🟡 — partiel chez nous)
**Contre-passation systématique** (négatif à la date du jour). Distinction **avant transfert compta** (annulation
directe) vs **après transfert / remise en banque** (règlement négatif = écriture d'annulation). Cohérent B7.

### 3.7 Autres éléments G8 repérés sur captures (à ne pas oublier)
« Sur édition » **par champ** véhicule (config d'impression + libellé renommable) · **« Visible en caisse » par
mode** · mode **« REPRISE MOTO »** · types de cession **« comptabilisée / non »** · **encours financier vs
autorisé** + client bloqué/à surveiller · **conditionnement d'achat** · réf de **remplacement** · n° clé / code
antidémarrage / **GPS tracker (ID+PIN)** / marquage antivol + date / **TPMS** / **kilométrage N.C./Réel/N.G.** ·
**livre de police** · **contrôle technique** (date) · **tâches atelier hors-facturation** · **planning taux de
charge %** · **checklist opérations atelier** · **ouverture tiroir / impression chèque** · article **« Carte
grise / Demande COC »** (rayon administratif) · **RGPD portabilité + histo email/SMS** · **intégration MyMeca**
(QR par moto + RDV en ligne) · **multi-département** (filtre).

---

## 4. Droit belge — exigences & écarts

| Domaine | Exigence Belgique | État |
|---|---|---|
| **Plan comptable** | **PCMN** (AR 12/09/1983) : 400 clients, 440 fournisseurs, 451/411 TVA, 70 ventes, 60 achats | ✅ **mapping PCMN seedé + paramétrable** (P0.2) |
| **TVA** | 21 / 12 / 6 / 0 % ; intracom ; export ; **détaxe** | 🟡 codes présents ; **12 % à confirmer** |
| **TVA marge VO** | art. 58 §4 CTVA : **registre de comparaison** obligatoire, TVA sur (PV−PA), **attestation TRAXIO** | ✅ **FAIT (2026-06-12)** registre + résumé + attestation PDF |
| **e-Facturation** | **Peppol BIS / UBL obligatoire B2B (loi 06/02/2024, en vigueur 2026)** | 🟡 UBL généré, **non transmis** |
| **Effets / paiement** | lettre de change + **domiciliation SEPA pain.008** | ✅ **FAIT (2026-06-12)** mandats + pain.008 + impayés |
| **Registre VO / livre de police** | registre des véhicules d'occasion + traçabilité VIN | 🟡 VIN/propriétaires ✅ ; **registre formel ⛔** |
| **Conservation** | **7 ans** (livres + pièces, art. III.86 CDE) ; clôture archivante | ✅ **clôture archivante** (2026-06-12) ; rétention 7 ans = politique d'hébergement |
| **Multi-société** | company_id + séquences par société + **facturation inter-sociétés** | ✅ socle ; inter-sociétés à valider |
| **Déclaration TVA / listing / intracom** | alimentés par nos exports (ventilation + n° TVA client) | 🟡 ventilation TVA ✅ ; listing/intracom ⛔ |
| **RGPD** | opposition marketing, **portabilité**, registre | 🟡 opt-out ✅ ; portabilité ⛔ |
| **Bridage A2 / contrôle technique** | attestation bridage/débridage, suivi CT | 🟡 champs ✅ ; attestation/alertes ⛔ |
| **Écotaxes (Recupel/Bebat)** | éco-participation sur certaines lignes | ⛔ à gérer |

---

## 5. Bugs & parcours cassés (P0 — à corriger avant toute démo « marchande »)

1. ~~**Stripe sans webhook**~~ → ✅ **CORRIGÉ (P0.1, 2026-06-12)** : webhook signé + `finalize_web_order` + confirmation au retour `?paid=1`.
2. **Export DCS** au mauvais format → rejeté par Ducati.
3. ~~**Export Winbooks** : `CustomerAccount` = UUID~~ → ✅ **CORRIGÉ (P0.2)** : moteur d'écritures + export Actage avec compte tiers réel (PCMN).
4. **UBL** téléchargé mais **non transmis** (Falco/Peppol = fiction à ce stade).
5. ~~**`price_changes`** absent → **B7 violé**~~ → ✅ **CORRIGÉ (P0.5)** : table + trigger traçant toute modif de prix.
6. **Boutons à demi-morts** : « Notifications » topbar (décoratif), « Export UBL/Winbooks/DCS » (formats non finaux), CRM « ajouter communication » (n'envoie rien).

---

## 6. API / intégrations à brancher (liste consolidée)

Détail dans [`integrations-cles-api.md`](integrations-cles-api.md). Synthèse priorisée :

| Service | Pour | Clé / action | Priorité |
|---|---|---|---|
| **Stripe** | paiement e-shop | `sk_test`/`sk_live` + **`whsec` (webhook à écrire)** | P0 |
| **Falco / Peppol** | e-facturation B2B (légal 2026) | credentials API Falco + Peppol ID par société | P0 |
| **Winbooks** | compta du comptable | **gabarit d'import réel** + mapping PCMN | P0 |
| **Ducati DCS** | commandes fournisseur | **gabarit Excel STANDARD/URGENTE réel** | P0 |
| **Resend** | e-mails (commande, relances, RDV) | `RESEND_API_KEY` + domaine vérifié | P1 |
| **SMS** (Twilio/Spryng/MessageBird) | rappels RDV, notifs | clé API + n° expéditeur | P1 |
| **OVH** | domaine du site public | CNAME + (option API OVH) | P1 |
| **Microsoft Graph** | mail/agenda 365 | client id/secret/tenant | P2 |
| **MyMeca** | RDV en ligne + QR (G8 l'intègre) | à clarifier avec le client | P2 |
| **VIES** | validation TVA intracom | aucune clé (public) | — |

---

## 7. Plan de remise au propre (priorisé)

**P0 — boucler les parcours & formats (avant facturation réelle) :**
1. ✅ **FAIT (2026-06-12)** `stripe-webhook` (signature + commande→payée + génération facture + sortie stock réel) — déployé + testé par POST ; reste le `whsec` live.
2. ✅ **FAIT (2026-06-12)** Moteur d'écritures comptables + mapping PCMN + export Winbooks au vrai format Actage (compte tiers réel) — testé par POST, pièces équilibrées. Reste : caler le gabarit exact du comptable.
3. **Format DCS Ducati exact**.
4. **Transmission UBL→Falco/Peppol** (connecteur + validation schéma BIS 3.0).
5. ✅ **FAIT (2026-06-12)** `price_changes` append-only + trigger sur toute modif de prix (cascade routée via `record_price_change`). Testé par POST.

**P1 — exigences légales & complétude métier :**
6. ✅ **FAIT (2026-06-12)** TVA sur marge (B2) + registre VO + attestation PDF. Testé par POST.
7. **E-mails/SMS réels** (Resend/Twilio) : confirmations, relances, notifs RDV, CRM.
8. ✅ **FAIT (2026-06-12)** Seed data (20 clients / 300 articles tous types / 12 véhicules / 5 OR) par société — règle 8.
9. ✅ **FAIT (2026-06-12)** Domiciliation SEPA (pain.008) + mandats + échéancier + impayés (remise en dû). Testé par POST.
10. ✅ **FAIT (2026-06-12)** Clôture d'exercice archivante (fige la période + arrêté archivé) + éditions pré-clôture (débiteurs, acomptes, effets). Testé par POST.
11. ✅ **FAIT (2026-06-12)** Copies stock auto 15/fin de mois + alerte stock dormant 4 mois (**pg_cron**). Testé par POST, jobs actifs.

**P2 — parité fine G8 :**
12. ✅ **FAIT (2026-06-12)** Moteur de tarifs clients (remise %/coefficient/paliers quantitatifs, résolu par spécificité) + simulateur. Testé par POST. 🟡 reste : import catalogue fournisseur multi-format avec mappings réutilisables (l'import tarifs CSV M2 existe déjà).
13. **Statistiques avancées** (4 niveaux, comparaison N-1, taux de transformation, cessions PV+PAMP).
14. 3e mode d'inventaire (casier), inventaire tournant, étiquetage différé.
15. Dépôt-vente + commission, reprise au POS, n° série au POS.
16. Signature électronique + portails + modèles de documents + CGV verso.
17. Tâches atelier hors-facturation, checklist opérations, planning taux de charge.
18. Tests d'intégration (réservations, réintégration, ORO, encours, **RLS**).

---

## 8. Recommandation pour la revue client de demain

**Démontrer (solide)** : POS/ventes + clôture Z · stock + inventaire (PAMP, écarts, réintégration) · atelier
(OR + garantie + chronos + planning) · reprise/ORO (marge par VIN) · **site builder e-shop** (le rendu moderne) ·
dashboard/rapports.

**Présenter comme « en cours / à finaliser avec vos clés »** (sans simuler le succès) : paiement en ligne,
exports compta (UBL Peppol/Winbooks) et DCS, e-mails/SMS, TVA marge.

**À préparer avant la démo** : un **jeu de données seed** réaliste (sinon écrans vides), et **ne pas cliquer**
les boutons d'export/paiement en présentant comme finalisés.

> **Honnêteté assumée** : ce DMS a un **cœur métier réel et conforme** (append-only, invariants stock/OR), mais
> la couche **intégrations + compta belge + légal (TVA marge, Peppol, effets)** reste à construire pour atteindre
> la parité G8 et la conformité. Le présent document est la feuille de route pour « remettre au propre ».
