# Backlog parité G8 — M0 (Socle & paramètres) · M1 (Contacts) · M2 (Articles & tarifs)

> Backlog de fonctionnalités pour atteindre la **parité fonctionnelle G8** sur les modules M0, M1, M2.
> Légende : `✅` fait · `⬜` à faire. Priorités : **P1** = indispensable parité / bloquant ; **P2** = important ; **P3** = confort / plus tard.
> Sources : `docs/g8-fonctions-m1-m4-fichiers-reception.md`, `docs/g8-fonctions-m6-ventes-pos.md`, `docs/g8-fonctions-m0-m12-m13-compta-stats-params.md`, `docs/g8-reference-extract.md`.

## 🟢 AVANCEMENT (mise à jour 2026-06-10 — passe 2)

**✅ TOUS LES P1 SONT FAITS.** + fondations M5/M6 anticipées pour fermer les dépendances + large part des P2.

**M0** : recherche globale DB · écran séquences (aperçu live) · **19 tables de paramètres** (dont la
**table d'arrondis** intégrée au moteur de prix) · références utilitaires POS seedées.
**M1** : onglets **Parc · Documents · Échéances · Livraisons · Contacts (sous-contacts) · Tarifs** +
**bandeau encours** (autorisé/actuel/disponible) calculé.
**M2** : prix interactif + **arrondis** · familles · cascade · onglets **Stock · Codes-barres · Kit ·
Remplacement (avec transfert PAMP) · Statistiques**.
**M5 (anticipé)** : registre `stock_moves` append-only, triple stock, **PAMP** (5 tests), transfert au remplacement.
**M6 (anticipé)** : `documents`/lignes/règlements + `contact_encours()` + seed → encours, échéances, stats.

**⛔ Reste : items appartenant à des MODULES non encore construits** (hooks en place, se rempliront avec) :
- M1 : onglets **Relances** (M12), **RDV atelier** (M8), **Histo e-mail/SMS** + **Groupes** + **mailings** (M10),
  **GED/pièce d'identité** (M9), saisie produit fini historique + « nouveau doc depuis fiche » (M6 POS/M8).
- M2 : **file d'étiquettes différée** (M5/B12), **n° de série en stock** UI complète (M5).
- M0 : **export DCS** (M4), **paramètres étiquetage** (M5), **imprimantes/lecteurs** (config matériel).

**Reste self-contained (P2/P3, faisable sans nouveau module)** : M0 paramètres caisse/éditions + droits fins
(RBAC) + CGV ; M2 librairie import/export, formats d'import réutilisables, import Excel natif, référence
d'origine multifournisseur, aligner PV↔PPC.

---

## 🟢 AVANCEMENT (passe 1)

**Intégré dans la passe 1 :**
- **M0** : recherche globale branchée DB ✅ · écran **config des séquences** (aperçu live) ✅ · **18 tables
  de paramètres** (TVA, modes/conditions règlement, civilités-pro, marques typées, types cession, catégorie
  client, couleurs, tailles, pays, catégories produit fini, codes expo, financement, assurances, opérations/
  tâches atelier) via `reference_values` + éditeur générique, seedées ✅.
- **M1** : onglet **Parc** (VIN liés) ✅ · **adresses de livraison** ✅ · **tarifs client à paliers** ✅
  (fiche client à onglets).
- **M2** : **prix interactif** (PA/coef/PVHT/PVTTC + marges) ✅ · **familles** (arborescence) ✅ ·
  **modification en cascade** + verrous ✅ · **codes-barres** ✅ · **kit/nomenclature** ✅ ·
  **remplacement de référence** ✅ (fiche article à onglets).

**⛔ BLOQUÉS par dépendance** (ne peuvent PAS être finis dans E0/E1 seuls — se complètent avec le module) :
- M1 : **encours actuel/solde** (M6 documents) · onglets **Documents/Échéances/Relances/RDV/Histo/GED**
  (M6/M8/M9/M10/M12) · saisie produit fini historique, nouveau doc depuis fiche (M6/M8).
- M2 : **statistiques article** (ventes M6) · **transfert stock/PAMP** au remplacement (M5) ·
  **file d'étiquettes différée** (M5) · n° de série en stock (UI complète avec M5).

**Reste self-contained (faisable, surtout P2/P3)** : M0 paramètres caisse/éditions, RBAC fin, imprimantes,
export DCS (M4), CGV ; M1 sous-contacts ; M2 table d'arrondis, librairie import/export, formats d'import
réutilisables, import Excel natif, références utilitaires, référence d'origine, aligner PV↔PPC.

---

---

## M0 — Socle & paramètres

### Authentification, rôles, multi-société, audit
- [✅] **Auth login** — connexion par email/mot de passe (Supabase Auth). Priorité P1.
- [✅] **Rôles RBAC (enum `app_role`)** — `admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing`. Priorité P1.
- [✅] **RLS active partout** — isolation des données par société/rôle au niveau Postgres. Priorité P1.
- [✅] **Multi-société + bascule** — chaque donnée porte `company_id` (ITALBIKE STORE / NL INVEST) avec sélecteur de société actif. Priorité P1.
- [✅] **Audit `events` (append-only)** — trace qui/quoi/quand/ancien-nouveau/origine sur chaque mutation. Priorité P1.
- [✅] **Écran Paramètres → Utilisateurs** — créer/éditer comptes et assigner les rôles. Priorité P1.
- [⬜] **Droits par opération (granularité fine)** — au-delà des 7 rôles, masquer/interdire des traitements précis par utilisateur (arbre d'opérations G8) côté UI/permissions. Priorité P2.

### Numérotation des documents (séquences)
- [✅] **Tables `document_sequences` + `next_document_number()`** — moteur de numérotation par société et par type existe en base (sans UI). Priorité P1.
- [⬜] **Écran de configuration des séquences** — gérer préfixe / format (longueur compteur, séparateur société) / remise à zéro annuelle / signification, avec **libellé explicatif par séquence** et **aperçu live du prochain numéro** (exigence client forte ; FAC-/DEV-/REC-/OR-/ORO-/OCC-/DEP-/REP-/COC-/CMD-/TIK-). Priorité P1.

### Recherche globale
- [✅] **Coquille recherche globale Ctrl+K** — palette reconnaît les formats VIN / n° TVA. Priorité P1.
- [⬜] **Recherche globale branchée DB** — interroger réellement contacts / véhicules (VIN) / articles / documents, recherche croisée véhicule↔client↔documents (B9), résultats cliquables. Priorité P1.

### Tables de paramètres / référentiels G8 (écran « Tables de données »)
> Chacune : `company_id` + RLS, CRUD (Nouveau/Modifier code-figé/Supprimer-si-non-utilisé), liste imprimable. Réutiliser les composants `src/components/ui/`.

- [⬜] **Taux de TVA** — code + libellé + taux (21 % / 6 % / 0 % export / intracom + régime marge VO). Priorité P1.
- [⬜] **Modes de règlement** — code, libellé, visible-en-caisse O/N, compte + journal (Espèces, Chèque, CB, Virement, LCR, CREDIT/LEASING, REPRISE MOTO…). Priorité P1.
- [⬜] **Conditions de règlement** — libellé, quantième (A–Z), échéance (comptant/15/30/45/60/90…), jour de règlement, fin-de-mois O/N, géré-en-LCR O/N. Priorité P1.
- [⬜] **Civilités (typées Professionnel)** — titres extensibles portant le flag **Professionnel** (SPRL/SA/ASBL ⇒ B2B). Priorité P1.
- [⬜] **Marques (typées)** — code, libellé, type (Produit fini / Pneumatique / Pièce) pour simplifier la saisie n° de série multi-marques. Priorité P1.
- [⬜] **Catégorie client** — classement clients (code profession, codes >50 / « AGENT » = rôle particulier). Priorité P2.
- [⬜] **Types de cession interne** — CESSION VN/VO démo, cadeau, fournitures atelier, garantie fourn./magasin, geste commercial ; options (comptabilisée O/N, hors stock, prend stock) — base B10. Priorité P1.
- [⬜] **Couleurs** — codes couleur des articles. Priorité P2.
- [⬜] **Tailles** — tailles vêtements/équipements. Priorité P2.
- [⬜] **Pays** — code, libellé, pays par défaut (Belgique). Priorité P2.
- [⬜] **Nature de produit fini** — natures de véhicule (MOTO…) + champs portés (cylindrée, puissance Kw, énergie, norme antipollution, n° police…). Priorité P2.
- [⬜] **Catégorie de produit fini** — gammes Ducati (Panigale / Monster / Multistrada / Scrambler / DesertX…). Priorité P2.
- [⬜] **Types de réparation** — code + libellé (imprimé sur OR) — pour M8. Priorité P3.
- [⬜] **Opérations atelier (checklist)** — ~42 opérations cochables en OR (vidange, courroie, freinage, pneus…) — pour M8. Priorité P3.
- [⬜] **Tâches atelier hors facturation** — tâches improductives (productivité B11) — pour M8. Priorité P3.
- [⬜] **Organisme de financement** — sociétés de crédit/leasing (Nouveau+). Priorité P3.
- [⬜] **Cabinets d'assurance** — nom, ville, tél, fax, email. Priorité P3.
- [⬜] **Experts assurance** — table des experts. Priorité P3.
- [⬜] **Code exposition** — statut/emplacement d'exposition véhicule. Priorité P3.
- [⬜] **Entête remises en banque** — IBAN/BIC des comptes société (édition remises chèques + LCR) — pour M12. Priorité P3.
- [⬜] **Mouvement fond de caisse (types)** — code, libellé, compte, journal, TVA — pour M6/M12. Priorité P3.

### Paramètres système / éditions / matériel
- [⬜] **Paramètres caisse** — mode HT/TTC par défaut, blocage/avertissement vente stock nul, saisie stock autorisée en fiche, opérateur par défaut, type de poste (facturation/encaissement). Priorité P2.
- [⬜] **Paramètres éditions** — nb exemplaires, entête/logo, OR non chiffrés, factures sans prix, **texte pied de facture**, fiche de travail. Priorité P2.
- [⬜] **CGV PDF/Word sur documents** — associer un document CGV imprimé au verso (chemin du document). Priorité P3.
- [⬜] **Paramètres étiquetage** — imprimante + format d'étiquette par défaut, personnalisation (B12) — pour M5. Priorité P3.
- [⬜] **Imprimantes & lecteurs code-barres** — imprimante par type de document, type de lecteur / port. Priorité P3.
- [⬜] **Export DCS Ducati (intranet fournisseur)** — pas d'API : export Excel imposé STANDARD/URGENTE (ACH001) — pour M4. Priorité P3.

---

## M1 — Contacts

### Fiche client — champs (parité G8)
- [✅] **Fiche client CRUD** — création/édition/suppression avec parité de champs G8. Priorité P1.
- [✅] **Statut à 4 valeurs** — Client pièce / Client atelier / Client / Prospect. Priorité P1.
- [✅] **Flags facturation** — client bloqué, mode HT, client en compte. Priorité P1.
- [✅] **RGPD** — opposé au marketing direct. Priorité P1.
- [✅] **Adresse complète éclatée** — n° rue, rue, complément, complément 2, boîte postale, CP, pays, « n'habite pas à l'adresse ». Priorité P1.
- [✅] **3 téléphones** — Téléphone / Portable / GSM (+ fax, emails). Priorité P1.
- [✅] **Tarif / catégorie client** — grille tarifaire nommée + catégorie (GENERAL / INTERNET). Priorité P1.
- [✅] **Compta / BIC / affacturage** — compte comptable, domiciliation, BIC, code affacturage. Priorité P1.
- [✅] **TVA intracom / export** — type de vente (intracommunautaire / exportation), n° TVA. Priorité P1.
- [✅] **Permis de conduire** — permis (A2 lié au bridage, DOC006). Priorité P1.
- [✅] **Encours autorisé** — `credit_limit` saisi sur la fiche. Priorité P1.

### Onglets / sous-objets de la fiche client (À FAIRE)
- [⬜] **Encours actuel + solde calculés** — afficher encours autorisé vs encours actuel vs solde (dérivés des documents M6) → contrôle crédit. Priorité P1.
- [⬜] **Onglet Parc** — tous les n° de série (VIN) liés au client (vendus / réparés / repris) + historique détaillé (jointure M3). Priorité P1.
- [⬜] **Adresses de livraison (multi)** — liste, ajout/modif/suppression d'adresses de livraison distinctes. Priorité P1.
- [⬜] **Sous-contacts (multi-contacts)** — contacts rattachés à une fiche B2B (nom, fonction, coordonnées). Priorité P2.
- [⬜] **Onglet Documents / historique** — liste des documents du client (déplier détail), ré-édition, règlements/acomptes (dépend M6). Priorité P2.
- [⬜] **Onglet Échéances** — liste des échéances du client (dépend M6/M12). Priorité P2.
- [⬜] **Onglet Info Stock** — opérations réalisées pour ce client (date / type doc / quantité). Priorité P2.
- [⬜] **Onglet Relances** — relances du client (dépend M12). Priorité P2.
- [⬜] **Onglet RDV Atelier** — RDV passés/à venir colorés par statut (dépend M8). Priorité P3.
- [⬜] **Onglet Histo Email/SMS** — historique des communications (dépend M10). Priorité P3.
- [⬜] **Onglet Groupes** — appartenance à des groupes clients (segmentation CRM M10). Priorité P3.
- [⬜] **Pièce d'identité / Images / GED** — documents joints à la fiche (dépend M9). Priorité P3.

### Tarifs client & fonctions avancées
- [⬜] **Tarifs client à paliers (fonctionnels)** — code 5 car., cible fournisseur/rayon/sous-rayon/catégorie/référence, **3 paliers de quantité**, remise % OU prix net OU coefficient `(PAHT×coef)+TVA=PVTTC`, dates début/fin, flag **Promotion** (ressort en Express). Priorité P1.
- [⬜] **Saisie produit fini (historique pré-migration)** — enregistrer un véhicule/réparation antérieur à l'app (3 onglets Véhicule/Client/Condition) ressortant au prochain passage. Priorité P2.
- [⬜] **Nouveau document depuis la fiche** — créer facture / livraison / OR directement depuis le client (dépend M6/M8). Priorité P2.
- [⬜] **Listes & mailings clients** — sélection en entonnoir → étiquettes / mailing (CRM M10). Priorité P3.

---

## M2 — Articles & tarifs

### Fiche article — champs (parité G8)
- [✅] **Fiche article CRUD** — création/édition/suppression avec parité de champs G8. Priorité P1.
- [✅] **Types de gestion A–R + T** — A/M/F/N/V/O/P/D/R + T (main d'œuvre, ADR-002) pilotant TVA/stock/n° série (B1). Priorité P1.
- [✅] **Descriptif + visible sur documents** — texte long + flag, note courte. Priorité P1.
- [✅] **Prix PA / PAMP / PVHT / PVTTC / PPC HT-TTC** — tous les niveaux de prix + coef + TVA + DEEE/écotaxe. Priorité P1.
- [✅] **Verrous tarifs** — prix achat bloqué / prix vente bloqué. Priorité P1.
- [✅] **Multi-casier** — table `article_bins` (casier ≤12 car. + qté par casier, base B6). Priorité P1.
- [✅] **Comptes vente/achat** — compte vente + compte achat sur la fiche. Priorité P1.
- [✅] **Config reprise (onglet R/P)** — préfixe + familles cibles des occasions générées (flux B3). Priorité P1.
- [✅] **Kits / nomenclature (champs)** — mode de facturation forfait vs nomenclature porté par l'article kit. Priorité P1.

### Moteur de prix & tarifs
- [✅] **Moteur d'import tarifs** — CSV, mapping de format, 12 règles métier (PV hausse, coef conservé, librairie, PA 3 décimales), diff + anomalies, apply (testé). Priorité P1.
- [⬜] **Moteur de prix interactif** — saisir 1 des 4 champs (coef / PVHT / PVTTC / marge) recalcule les 3 autres, en tenant compte de la **table d'arrondis** ; affiche marge sur PAHT **et** sur PAMP. Priorité P1.
- [⬜] **Table d'arrondis** — paramétrage par fournisseur/rayon/sous-rayon/catégorie + fourchettes de prix, arrondi toujours à la tranche supérieure ; « pour tous les fournisseurs ». Priorité P1.
- [⬜] **Recalcul PA/PV par sélection** — sur fournisseur/rayon : appliquer taux % (PAHT/PVTTC, négatif, par palier de PA) OU nouveau coefficient, avec arrondi paramétré, append-only `price_changes`. Priorité P2.
- [⬜] **Formats d'import réutilisables** — créer/dupliquer/modifier/exporter/importer un format de mapping fournisseur (Excel/CSV/texte délimité/largeur fixe), options « changements à accepter ». Priorité P2.
- [⬜] **Import Excel natif** — lecture directe `.xlsx` (en plus du CSV) dans le moteur d'import. Priorité P3.

### Modification en cascade & opérations de masse
- [⬜] **Modification en cascade** — sélection (fournisseur/rayon/marque/type-gestion/inutilisé 12-18-24 mois/stock/jokers `%`/`;`) ou import Excel → liste cochable → édition directe + actions de masse (prix %/€/fixe/coef/marge, famille, fournisseur, TVA, type, casier…), append-only `price_changes`. Priorité P1.
- [⬜] **Verrous MAJ tarifs en masse** — bloquer/débloquer MAJ désignations / PA / PV sur une sélection (protège du prochain import). Priorité P1.
- [⬜] **Aligner PV ↔ PPC** — opération de masse dans les 2 sens. Priorité P3.

### Remplacement de référence, équivalences, librairie
- [⬜] **Remplacement de référence + transfert PAMP** — saisir nouvelle réf par-dessus l'ancienne ; si réf existante (pièces) : transfert stock réel+disponible, recalcul PAMP, alias ancienne réf, MAJ docs en attente (append-only `stock_moves`). Priorité P1.
- [⬜] **Équivalences (UI)** — lier des références équivalentes (table n-n), ajout double-clic / suppression clic, symbole sur fiche, proposition auto en POS. Priorité P2.
- [⬜] **Référence d'origine multifournisseur** — lien pièce grossiste ↔ pièce fournisseur principal (`origin_reference_id`). Priorité P3.
- [⬜] **Librairie (import/export)** — flag `is_library`, export/import par fournisseur ou rayon (stock=0 obligatoire pour exporter), réimport auto à la saisie d'une réf complète, purge fournisseur abandonné. Priorité P2.

### Familles, kits, n° de série, références utilitaires
- [⬜] **Familles (arborescence)** — rayon › sous-rayon › catégorie : créer/modifier (libellé seul, code figé)/supprimer/déplacer, liste imprimable, comptes comptables rattachés. Priorité P1.
- [⬜] **Kits / nomenclatures (UI)** — créer une réf regroupant des composants (type N), éclatement auto à la vente selon le mode forfait/nomenclature, liste imprimable. Priorité P2.
- [⬜] **N° de série en stock (UI types V/O/P)** — consulter/ajouter/modifier/supprimer un n° de série + infos véhicule depuis la fiche article (jointure M3). Priorité P2.
- [⬜] **Références utilitaires (templates)** — REP (type R), MO type T (quantité en centièmes), petites fournitures `+2.0` (% du total), coefficient fixe `*coeff`, texte F, LB, FRAIS_BL — comportements POS. Priorité P2.

### Statistiques & étiquettes article
- [⬜] **Statistiques article** — ventes/achats cumulés mois+année + détail mois par mois sur 3 exercices ; liste des documents en cours où figure l'article. Priorité P2.
- [⬜] **Édition d'étiquettes** — quantité défaut = stock réel, avec/sans code-barres, avec/sans prix, immédiat ou différé cumulable par poste (B12). Priorité P2.

---

## Synthèse

**Items À FAIRE (`⬜`) par module et priorité :**

| Module | P1 | P2 | P3 | Total à faire |
|---|---|---|---|---|
| **M0 — Socle & paramètres** | 7 | 3 | 13 | 23 |
| **M1 — Contacts** | 4 | 6 | 5 | 15 |
| **M2 — Articles & tarifs** | 6 | 9 | 4 | 19 |
| **Total** | **17** | **18** | **22** | **57** |

**Items DÉJÀ FAITS (`✅`) :** M0 = 7 · M1 = 11 · M2 = 11 → **29 fonctionnalités acquises**.

**Lecture rapide des P1 restants (bloquants parité) :**
- **M0** : écran config des séquences (aperçu live), recherche globale branchée DB, droits fins (P2), et les tables de paramètres cœur (TVA, modes/conditions de règlement, civilités-pro, marques typées, types de cession).
- **M1** : encours actuel/solde calculés, onglet Parc (VIN), adresses de livraison, tarifs client à paliers fonctionnels.
- **M2** : moteur de prix interactif + table d'arrondis, modification en cascade + verrous de masse, remplacement de référence avec transfert PAMP, familles (arborescence).
