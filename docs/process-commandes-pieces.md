# Processus « Commandes de pièces » — spec de réconciliation Miro × G8 × repo

> Source Miro : board live fourni par le client (2026-07-30). Captures G8 : 3 écrans réels
> (Rappel proposition de commande, Proforma, Mise en proposition de commande). État repo : `main` au 2026-07-30.
> **Objectif** (consigne client) : *construire le processus du Miro, en conservant les données/sémantique G8,
> en intégrant les outils (paiement QR/Stripe, signature électronique, mail Graph).*
> Ce document est la source de vérité du chantier. Aucune donnée inventée : tout est tracé à sa source.

---

## 0. TL;DR — le point qui change tout

**DÉCISION CLIENT (2026-07-30) : on ABANDONNE le classement G8 `Stock / Dépannage / Garantie`.**
Le nouvel axe de classement des commandes = **`urgente / standard / excel / accident`** (liste **extensible**).
On veut **voir et gérer les commandes PAR TYPE** sur cet axe.

- On **garde** de G8 : le **flux** (document de vente → proposition ligne/totale → agrégation par fournisseur
  avec **Mini. commande** / **Franco port** → commande fournisseur DCS/mail) et les **champs de données**
  (Qté client / Qté magasin / Fournisseur / Stock dispo / Réf fournisseur / Casier…).
- On **remplace** l'ancien enum de type G8 (`Stock/Dépannage/Garantie`) par le nouvel enum métier ci-dessous.
  L'ancien radio *Stock/Dépannage/Garantie* des écrans G8 n'est **pas** repris.

| Type de commande (nouvel enum) | Seuil / règle (Miro) |
|---|---|
| **standard** (journalière) | Minima **250 € HTVA**, déclenchement manuel (automatisable) |
| **urgente** | Pas de minima, **+10 %** facturé client (9,09 % réel), **max 1×/jour** |
| **accident** | Minima **1500 € HTVA** sinon repasse en *standard* |
| **excel** | commande consolidée dans un **classeur Excel Ducati** (Demo/Courtoisie/Showroom), **minima 2000 € HTVA _par onglet_**, voir §1.6 |

> `order_kind` est un **enum extensible** (nouvelles valeurs ajoutées par migration `ALTER TYPE`).
> La vue « commandes » se filtre/segmente **par `order_kind`**. Pas de colonne Stock/Dépannage/Garantie.

---

## 1. Processus cible (Miro) — transcription fiable

### 1.1 Définition
**Une commande** = une **réservation de pièces**, **validée selon 4 types**, **comparée avec le stock**.

### 1.2 Quand passe-t-on une commande ? (déclencheurs)
1. Client comptoir qui commande des pièces
2. Nouveau client qui configure sa moto avec un vendeur
3. Commande à l'atelier s'il manque des pièces
4. Commande suite à un accident + demande de devis
5. Commande via le site web

### 1.3 Les 4 types (seuils exacts lus sur le board)
- **Accident** : minima **1500 € HTVA**, sinon repasse en *standard*.
- **Journalière (standard)** : minima **250 € HTVA**, déclenchement **manuel** (automatisable).
- **Urgente** : **pas de minima** mais **+10 %** facturé client (**9,09 %** réel), **max 1×/jour**.
- **Excel** : export DCS Excel imposé *(desc. à finaliser côté client)*.

### 1.4 Validation devis (boîte « Validation devis »)
1. Proforma ou devis.
2. Choix **« Paiement direct »** ou **« Envoi par mail »**.
3. Choix **livraison rapide (+10 %)** ou standard, ou Excel, ou accident.
4. **Par mail** : valider la sélection (cocher/décocher) · choix paiement **QR code / link** ou **+5 %**
   (si Stripe) · si vient de l'atelier, ajout des frais du devis (**accident = 125 €** ;
   **diagnostic = tarif horaire, max 4 h, sans nouveau devis**) · **signature électronique** en + du paiement.
5. **Comptoir** : choix du moyen de paiement (si paiement direct) · **QR code sur 2ᵉ écran** · **Cash** ·
   **Bancontact** (envoi vers **Terminal de paiement**, ticket en exemple, **données client requises → réconciliation**).

### 1.5 Cycle de vie du statut
- **Par mail** : `en attente de paiement` → (paiement QR/preuve) → `payée` + `à envoyer`.
- **Comptoir** : encaissement cash validé / paiement électronique passé / QR OK → `payée` + `à envoyer`.
- Puis **dispatch selon le type** (urgente jour / standard sous seuil 250 € / Excel / accident).
- Un **document de réservation** est enregistré, généré en **PDF** et **envoyé par mail** au client.

### 1.6 Commande Excel — spec détaillée (fichiers réels analysés)

> Analysé : `Fichier de commande via excel Demo Crtsy Shwrm 2026_FR VIERGE.xlsx` (template Ducati)
> + `Facture commande via excel.PDF` (facture ITALBIKE STORE n°2200002305, reçue de Ducati).
> ⚠️ **Ce type n'existe PAS dans G8.** C'est un nouveau flux propre au DMS.

**Principe métier** :
Le client passe commande → on crée sa **précommande**, **il paie**, on choisit le format **« Commande Excel »**
→ la commande est **sauvegardée `payée` + `commandée`**. Les pièces (et la moto) viennent **remplir une version
du classeur Excel Ducati**. On peut **télécharger l'Excel prérempli**, continuer à charger dessus, puis
**clôturer + archiver** (l'Excel est enregistré avec son **numéro de commande interne DMS**) et le template est **vidé**
pour la commande suivante.

**Structure du template (réelle)** :
- **3 onglets de commande** = **`Demo` / `Courtoisie` / `Showroom`** (titres internes `DEMO`/`COURTOISIE`/`STOCK`).
  Feuilles annexes `Feuil12`/`Feuil2` = listes de référence (codes concession → nom + « Acc Cross »).
- En-tête onglet : `Code concession` (D2, ex. **100645** = Ducati Bruxelles), `Nom concession`,
  `Concession cross` (Oui/Non), **`Montant de commande remisé minimum` = 2 000 euros (D5)**,
  bloc **Moto 1..4** (Modèle moto + `Numéro de commande` + `Numéro de série`/VIN).
- Catalogue : **~1793 lignes** (ligne d'en-tête en **row 10**), colonnes :
  `FAMILLE · CATEGORIES FR · REFERENCE · DESCRIPTION FR · VARIANTES · MODELS <= MY24 · MODELS MY25/26 ·
  Masterbook · CLASSE DE REMISE · PRIX AU PUBLIC HT 2026 (J) · Dealer/Importer PRICE 2026 (K) ·
  Q COMMANDE (L) · Valeur commande (M) · Extra-Discount (N) · Prix concessionnaire final (O) · Disponibilité`.
- **Formules clés** (à reproduire côté DMS) :
  - Ligne : `M = K × L` (valeur = prix dealer × quantité), `O = M − (M × N)` (prix final après extra-remise).
  - Onglet : `Montant total = SUMPRODUCT(M11:M1803)`.
  - **Seuil** : `SI SUM(O11:O1803) ≤ 2000 → "Reste à commander pour extra-discount: X€" SINON total remisé`.
    ⇒ **le minima 2000 € HTVA est PAR ONGLET** (Demo, Courtoisie, Showroom séparément).

**Comportement DMS attendu** :
1. Dès qu'on **ajoute des pièces** à une « commande Excel », le **montant s'affiche dans le DMS** (par onglet).
2. Quand **une section (onglet) dépasse 2000 €**, une **notification verte** apparaît dans la **navbar** (seuil extra-discount atteint).
3. On peut **télécharger l'Excel prérempli** (remplir la colonne `Q COMMANDE` (L) des bonnes lignes réf. + le bloc moto).
4. On peut **clôturer** OU **continuer à charger** même après un 1ᵉʳ téléchargement.
5. **Après ≥ 1 téléchargement** (⇒ un **n° de commande interne DMS** est créé), on peut **archiver** l'Excel
   (enregistré avec son n° de commande) et le **template est vidé** pour la commande suivante.
6. **Facture Ducati** = ce qu'on **reçoit de Ducati après envoi** (le PDF analysé : lignes regroupées par
   « Commande n° » + « Votre réf » ex. *Acc Showroom 2026*, totaux séparés **Accessoires** vs **Pièces détachées**).
7. **Traçabilité BL** (besoin explicite) : à réception du **bon de livraison** lié à cette commande, on doit
   **reconnaître que les pièces viennent d'une commande Excel** et **retrouver à quel client relier la pièce reçue**
   (lien réf. article Excel ↔ n° commande interne ↔ client précommande).

---

## 2. Modèle de données G8 à conserver (captures réelles)

### 2.1 Écran « PROFORMA — Mode TTC » (document de vente = point de départ)
- En-tête : Client (n° + nom), Département, Solde, Tarif client, Conditions, Opérateur.
- Lignes : **Réf. article · Libellé · Quantité · Prix unitaire · Remise · Total ligne · [S]** (pastille stock).
- Pied par ligne : **Stock réel · Qté réservée · Qté en cde · Stock dispo · Réf fournisseur · Casier · Poids · Poids total**.
- Actions clés (panneau droit) : Ouverture tiroir, Commentaires, **Regroupement B.L./Réservations**,
  Recherche articles par Famille/Fourn, **Garantie/Cession** (article/totale), **Proposition de commande
  (ligne / totale)**, Client, Opérateur, Import code barre, **Import microfiches**, **Mode HT/TTC**,
  **Mode détaxé**, Article, **Encours articles**, **Tarifications**, **Nomenclature**, **Frais de port**, Supp. Remises.
- Totaux : **Total HT · Total TVA · Total TTC · Reste à Payer**.
- Barre : Chgt document, **Librairie**, Recherche article, Raz ligne, **N° Série**, Raz tout,
  Inser.ligne, **Historique**, **Prévisualiser**, **Valider**.

### 2.2 Écran « Mise en proposition de commande » (le cœur)
- ⚠️ **Le radio G8 `Stock / Dépannage / Garantie` est REMPLACÉ** par le sélecteur de type métier
  **`urgente / standard / excel / accident`** (extensible) — décision client 2026-07-30.
- Colonnes G8 conservées : **Quantité client · Quantité magasin · Référence · Désignation · Quantité doc. ·
  Stock dispo. · Reçu client · Cmd client · Cmd magasin · Prop. cmd client · Prop. cmd magasin · Fournisseur**.
- Actions : **Inverser qté client / qté magasin · RAZ Quantité · Restaure Quantité · Indisponible uniquement · Valider**.
- Commentaires + Opérateur.
- ➜ distingue **commande pour le client** (qté client) vs **réappro magasin** (qté magasin), par **fournisseur**.

### 2.3 Écran « Rappel proposition de commande » (agrégation par fournisseur)
- Filtre : **par type de commande** → `Tout / urgente / standard / excel / accident` (remplace le
  filtre G8 Tout/Stock/Dépannage/Garantie).
- Table fournisseurs : **Code · Raison sociale · Montant total · Mini. commande · Franco port**
  (+ un montant par type de commande : montant urgente / standard / accident…).
- Table lignes : **Référence · Réf. fournisseur · Fournisseur · Désignation · P.U. HT · Quantité ·
  Qté C · Qté M · Date · Type (`urgente/standard/excel/accident`) · Montant HT**.
- Actions : **Adresses · Mail (adresse fournisseur) · Imprimer demande de prix · Visualiser cde tout type ·
  Supprimer cde tout type · Edition avec numéros de ligne · Valider**.
- ➜ **Mini. commande** et **Franco port** = les seuils qui pilotent le déclenchement (à relier aux 250 €/1500 €/urgent du Miro).

---

## 3. État du repo — ce qui existe déjà

Stack : TanStack Start (SSR) + Supabase + Bun + Vite + Tailwind v4 + shadcn. Modules dans `src/modules/`.

| Brique | État | Emplacement |
|---|---|---|
| Devis/proforma (DEV) + éditeur multi-docs (FAC/DEV/RES/BL/TIK/AVO) | ✅ | `src/modules/sales/document-editor.tsx`, `write-api.ts` |
| Réservation (débite le *disponible*, triple stock B4) | ✅ | `write-api.ts` (`RESERVE_DOC_TYPES`, `record_stock_move`) |
| Conversion DEV→RES→BL→FAC + report acomptes | ✅ | `write-api.ts` `convertDocument()` |
| Pied de facture (remise globale, HT/TTC, détaxe, port, net forcé) | ✅ | `write-api.ts` `computeTotals()` |
| Paiement multi-modes (cash, rendu monnaie, différé) | ✅ | `sales/payment-panel.tsx` |
| Paiement en ligne **Stripe Checkout** | 🟡 câblé, **dormant** (clé absente) | `src/modules/web/checkout.ts` |
| `finalize_web_order` (statut payée + facture + sortie stock, idempotent, webhook) | ✅ RPC | `supabase/migrations/…m11_finalize_web_order.sql` |
| Achats fournisseurs + réception→stock+PAMP + échéancier | ✅ | `src/modules/purchases/` |
| **Proposition de réappro** (articles sous stock mini) | 🟡 dynamique, lecture seule | `purchases/api.ts` `getReorderProposals`, RPC `reorder_proposals` |
| **Franco / mini commande fournisseur** (schéma) | ✅ colonne `supplier_franco_min` | migration `…m4_purchases.sql`, `…m14_g8_legacy_fields.sql` |
| **Export DCS STANDARD / URGENTE** | 🟡 **CSV** (Réf/Désignation/Qté/Type) | `purchases/dcs-export.ts` |
| Génération PDF (jspdf) | ✅ | `sales/print-document.ts` |
| Envoi mail **Microsoft Graph** (envois réels confirmés) | ✅ | Edge `graph-send-email` |
| Encours client | ✅ | `sales/api.ts` `contact_encours` |
| Statuts + audit append-only (B7, table `events`) | ✅ | migrations M0/M6 |

---

## 4. Gap analysis — à créer / compléter

### 🔴 À CRÉER (n'existe pas)
1. **Écran « Mise en proposition de commande »** (parité G8 §2.2, **type = `order_kind` métier**, PAS Stock/Dépannage/Garantie) :
   depuis un document de vente, bouton *Proposition de commande ligne/totale* → sélection
   **type de commande (`urgente/standard/excel/accident`)**, **Qté client / Qté magasin**, **Fournisseur**.
   → nouvelle table `order_proposals` + `order_proposal_lines` (persistée, contrairement au `reorder_proposals`
   actuel qui est calculé), RLS `company_id`, audit `events`.
2. **Écran « Rappel proposition de commande »** (parité G8 §2.3) : agrégation **par fournisseur**,
   **filtre + segmentation par `order_kind`** (`Tout/urgente/standard/excel/accident`), colonnes Mini. commande /
   Franco port, actions (demande de prix, mail fournisseur, visualiser/supprimer, valider → commande fournisseur).
3. **Enum `order_kind` extensible + seuils paramétrables** :
   `standard` **250 €**, `urgente` **+10 %** & **max 1×/jour**, `accident` **1500 €**→sinon `standard`, `excel`→DCS.
   Seuils dans `reference_values` (pas de hardcode, CLAUDE.md §9/§10) + RPC de contrôle + `pg_cron` (regroupement standard).
   ⚠️ Enum **extensible** (ajout de types futurs par `ALTER TYPE`). **Aucune reprise** du classement G8 Stock/Dépannage/Garantie.
4. **Statut de dispatch commande** : `en_attente_paiement → payee → a_envoyer → envoyee`, + flag `order_kind`.
   Migration Postgres (ALTER TYPE dans sa propre migration, cf. piège enums) + trigger audit.
5. **Paiement par QR code (2ᵉ écran comptoir)** : Stripe **Payment Link** / PaymentIntent + lib `qrcode`,
   route d'affichage `/pos/qr/:id`, **Realtime Supabase** pour bascule auto du statut au paiement, surcoût **+5 % Stripe**.
6. **Bancontact via Terminal physique** : Stripe Terminal **ou** API du TPE existant + réconciliation
   (données client + ticket). ⚠️ **Décision d'archi ouverte** (quel TPE / prestataire ?).
7. **Signature électronique** : `signature_pad` (canvas) + Supabase Storage + horodatage dans `events`.
8. **Frais atelier conditionnels** : accident = **125 €** fixe ; diagnostic = tarif horaire (max 4 h) sans nouveau devis.
   Paramétrable, branché sur le module `workshop`.
9. **Module « Commande Excel » (§1.6)** — nouveau flux, n'existe ni dans G8 ni dans le repo :
   - **Import du catalogue Ducati** (~1793 réf. × 3 gammes) depuis le classeur `.xlsx` → table `excel_catalog`
     (famille, catégorie, référence, description, modèles, classe de remise, prix public HT, prix dealer, dispo).
   - Table `excel_orders` + `excel_order_lines` (onglet `demo/courtoisie/showroom`, réf, qté, moto/VIN, n° cmd interne,
     statut `en_cours/telecharge/cloture/archive`), RLS `company_id`, audit `events`.
   - **Calcul temps réel par onglet** : `valeur = prix_dealer × qté`, `total onglet = Σ`, **seuil 2000 € HTVA/onglet**.
   - **Notification navbar verte** quand un onglet ≥ 2000 € (Realtime).
   - **Génération .xlsx prérempli** (lib `exceljs`/`xlsx`) : remplit `Q COMMANDE` (col L) + bloc moto, garde les formules.
   - **Clôture / archivage** : au 1ᵉʳ téléchargement → n° commande interne ; archive `.xlsx` en Storage lié au n° ; **vidage du template**.
   - **Traçabilité BL→client** : lien `réf article ↔ n° commande Excel ↔ client précommande` pour router les pièces à réception.
   - **Rapprochement facture Ducati** : parser le PDF reçu (regroupé par n° cmd, Accessoires vs Pièces détachées) — optionnel/phase 2.

### 🟡 À COMPLÉTER (partiel)
9. **Activer Stripe** : configurer `STRIPE_SECRET_KEY` (secret Edge), tester `stripe-checkout` + `stripe-webhook` bout-en-bout.
10. **Mapping DCS exact** : aligner colonnes sur le **vrai gabarit Excel Ducati** (à fournir) + sortir du **.xlsx** si imposé (CSV aujourd'hui).
11. **Orchestration « commande → PDF réservation → mail »** : le PDF et Graph existent séparément, il manque le déclencheur auto.
12. **Persistance de la proposition** : remplacer le `addToReorderProposal` (redirection) par une vraie ligne persistée
    (TODO déjà noté dans `purchases/api.ts`).

### Technos à intégrer
Stripe (Payment Links + QR + webhook actif) · **QR link vers compte bancaire** (EPC/SEPA QR) · **TPE Bancontact physique** ·
`qrcode` · `signature_pad` · **Realtime Supabase** · migrations Postgres (types de commande, statuts, seuils) ·
**pg_cron** (regroupement standard) · **`exceljs`/`xlsx`** (génération .xlsx Commande Excel + import catalogue Ducati).

---

## 5. Décisions (tranchées 2026-07-30)
- **D1 — Paiement comptoir ✅ TRANCHÉ** : **les trois** → Stripe **QR** + **TPE Bancontact physique** +
  **QR link lié au compte en banque** (QR SEPA/EPC de virement). Reste à préciser : marque/modèle du TPE Bancontact + IBAN pour le QR SEPA.
- **D2 — Commande Excel ✅ TRANCHÉ** : spec complète en **§1.6** (classeur Demo/Courtoisie/Showroom, seuil **2000 €/onglet**,
  notif navbar verte, download prérempli, clôture+archivage avec n° interne, template vidé, traçabilité BL→client).
- **D3 — Types futurs** : l'enum `order_kind` est extensible ; autres types à prévoir au-delà de `urgente/standard/excel/accident` ?
- **D4 — Signature électronique** : valeur légale voulue (canvas simple horodaté vs prestataire eIDAS) ?
- **D5 — ~~Gabarit DCS~~ RÉSOLU** : le « gabarit Excel » = le classeur Ducati (fourni et analysé, §1.6).
  *(La question portait sur le format d'export imposé par Ducati — c'est ce fichier. Plus de zone d'ombre.)*
  Reste éventuellement : **IBAN concession** (pour le QR SEPA) + **infos TPE Bancontact** (D1).

---

## 6. Ordre de bataille proposé (backlog technique)
1. **Migration socle commandes** : tables `order_proposals(_lines)`, enum `order_kind`, `dispatch_status`,
   seuils dans `reference_values`, triggers audit. (dépendance de tout le reste)
2. **UI Proposition (ligne/totale)** depuis le document de vente (parité G8 §2.2).
3. **UI Rappel proposition** agrégé fournisseur + seuils franco/mini (parité G8 §2.3).
4. **Génération commande fournisseur** depuis le Rappel → DCS (.xlsx) / demande de prix / mail Graph.
5. **Workflow validation devis** : canal (mail/comptoir), frais atelier conditionnels, statut de dispatch.
6. **Paiement** : activer Stripe → Payment Link → QR 2ᵉ écran → Realtime bascule statut → (+5 % / +10 %).
7. **Bancontact TPE** (selon D1) + réconciliation.
8. **Signature électronique** + PDF réservation auto + mail.
9. **Tests** des règles critiques (seuils 250/1500, +10 %/+5 %, max 1×/jour, dispatch) — obligatoire (CLAUDE.md §7).
