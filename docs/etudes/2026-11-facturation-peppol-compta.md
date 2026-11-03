---
titre: Facturation, Peppol et comptabilité — Falco, la facture belge « bien faite » et le comptable
pour: Domenico (ITALBIKE STORE / NL INVEST) et son comptable ; agence
de: Agence, étude du 03/11/2026
etat: étude remise, décisions attendues (§6)
prolonge: ../propositions/2026-11-caisse-shopify-ou-dms.md §3.2-3.3 et §6 ; complète ./2026-11-caisse-legal-et-marche.md (caisse : arrondi, espèces, rapport Z, registre des véhicules)
---

# Facturation, Peppol et comptabilité : Falco, la facture belge « bien faite » et ce que le comptable attend

> **En deux mots.** Le DMS sait déjà produire une facture numérotée par société, son PDF, l'envoyer
> par Outlook, générer un fichier UBL Peppol BIS 3.0, un journal des ventes, un registre TVA, des
> écritures PCMN et un export Winbooks. Pour faire les factures « bien », il manque surtout : **le
> connecteur Falco** (envoi Peppol automatique à la validation, suivi des statuts, rejets), **la
> facture d'acompte** (obligatoire en Belgique dès qu'un acompte est encaissé sur une moto), **la
> note de crédit propre** (référence imprimée à la facture d'origine, avoir partiel, et un bug : la
> facture annulée disparaît du journal des ventes), **la TVA sur la marge à la vente** (calcul global
> par période, pas par véhicule, et jamais de TVA affichée), l'**identifiant Peppol `0208:` (n° BCE)**
> de chaque société, l'**UBL complété** (BuyerReference, BillingReference, catégories de TVA du
> scénario BEG 9), et côté mail **DKIM et DMARC absents** sur `ducatibxl.be`. Tout ça tient en
> **4 lots, 17 à 25 jours**, dont 2 décisions avec le comptable avant de coder (Horus ou pas ;
> méthode TVA marge). Coût Falco : **2 × 40 €/mois HTVA** (un abonnement Expert par société).

---

## 1. Falco : fiche technique et plan d'intégration

### 1.1 Ce qu'est Falco, vérifié le 03/11/2026

Falco est l'application de facturation de **Horus Software SA** (Chaudfontaine, éditeur du logiciel
comptable Horus Office), **point d'accès et SMP Peppol certifiés** par BOSA (ID Peppol PBE000593,
≈ 123 000 participants, 5e point d'accès belge) [F1] [F2]. L'API est **réservée aux plans Expert**
(essential 40 €/mois ou 440 €/an, Premium 50 €/mois ; HTVA), avec **500 factures Peppol sortantes
par mois incluses puis 0,10 €/facture**, réception Peppol illimitée, 30 jours d'essai [F3] [F4].

**Deux sociétés = deux abonnements.** Depuis août 2025, un plan Falco s'entend **par organisation
(= un n° de TVA)** ; les « profils commerciaux » ne couvrent pas une seconde entité légale [F5] [F6].
ITALBIKE STORE et NL INVEST auront donc chacune un compte Expert (**≈ 80 €/mois HTVA**, ou 880 €/an),
chacune sa clé API, chacune son identifiant Peppol `0208:` (n° BCE). Les abonnements de facturation
électronique ouvrent droit à la **déduction majorée de 120 %** (petites sociétés, périodes
imposables 2024-2027, circulaire 2026/C/46) [P12] — pas le DMS développé en interne.

### 1.2 Fiche technique de l'API (docs.falco-app.be, 39 pages de référence lues, dates 2025-10 → 2026-09) [F7]

| Point | Ce que dit la documentation |
|---|---|
| Base | `https://api.falco-app.be/v1` ; bac à sable `https://api.sandbox.falco-app.be/v1` (livraison Peppol **simulée**, données remises à zéro périodiquement, **API seulement : aucune interface** pour voir les données de test) |
| Authentification | 2 en-têtes : `X-Falco-App-Secret` (secret de l'**application de l'agence**, créée sur dev.falco-app.be : `as_test_…` / `as_live_…`) + `X-Falco-Api-Key` (clé générée **par le client** dans Falco, « Accès API → Lier une application », avec l'**Application ID** de l'agence et les permissions cochées ; affichée une seule fois). Une app, **une clé par société** |
| Portées | `invoices:ingest:ubl`, `invoices:send`, `peppol:participants:read`, `documents:sales:read`, `customers:*`, `articles:*`, `peppol:inbound:*`… ; la clé ne porte que les scopes approuvés par le client |
| Limites | **60 requêtes/minute par App Secret** (partagées entre nos 2 sociétés) → `429`, backoff conseillé ; `POST /invoices/imports/validate-ubl` « heavily rate limited », pas pour la production ; pages de 20 à 100/200 ; montants en **chaînes à 2 décimales** ; erreurs RFC 9457 (`application/problem+json`) ; **aucune idempotence documentée** (le DMS doit mémoriser le `document_id` avant tout nouvel essai) ; **aucun webhook** : **polling obligatoire** |
| `GET /organization/whoami` | Confirme l'organisation derrière une clé : n° TVA, `peppol_identifier`, `product_code` (expert_essential / expert_premium), **`peppol_invoices_sent_this_month`** (suivi du quota), `linked_to_accounting` (lié à Horus Office ou non) |
| `POST /invoices/imports/ubl` | `multipart/form-data` : `file` (XML UBL) + `metadata` JSON `{ send_peppol, send_accounting, accounting_info { number, journal } }`. **Notre numéro de facture est conservé** (Falco ne modifie jamais un UBL importé). Réponse `201 { document_id, peppol_status { status: submitted \| failed, error_message }, accounting_status { … } }` : **« submitted » n'est pas un statut final** |
| `POST /invoices/imports/validate-ubl` | Valide contre Peppol BIS Billing 3.0 **et les règles propres de Falco** ; renvoie `success \| warning \| failure \| sender_error` et une liste `lines[] { status, line_id (XPath), description }`. Règle Falco connue : le n° de TVA de l'émetteur doit être celui de l'organisation |
| `POST /invoices/imports/pdf` | PDF + métadonnées complètes (Falco **ne lit pas le PDF**, il fabrique l'UBL depuis les métadonnées : client, lignes, `tax_subtotals` avec `tax_regime.type ∈ standard, vat_reverse_charge, intra_community, export, zero_rated_goods, taxes_not_applicable, other_exoneration`, `billing_references[]`, `prepaid_amount`). Voie de secours si notre UBL pose problème |
| `POST /invoices/imports/send` | Renvoie un document déjà importé (`document_id`), avec ou sans Peppol / compta |
| `GET /documents/sales/{id}` | Suivi : `peppol_send_status ∈ not_sent \| success \| failure \| rejected`, `events[]` (`peppol_send_success`, `peppol_send_failure`, `peppol_message_level_response`, `peppol_invoice_response`, `fiduciary_import_success/failure`…), `files[]` ; `…/download/ubl` récupère l'UBL |
| `GET /peppol/participants/check?participant_identifier=0208:0xxxxxxxxx&document_type=invoice` et `…/find?vat_number=BE0…` | **Vérification en temps réel (SML/SMP)** qu'un client reçoit les factures Peppol ; 404 typé `participant-does-not-exist` / `access-point-not-found` / `unsupported-vat-number` |
| `/invoices` (natif) | Création de factures **dans Falco** (brouillon → approve → send, Falco numérote, e-mail envoyé par Falco, PDF Falco). **Pas retenu** : double numérotation, pas d'acompte, pas de régime marge, pas de lien NC → facture |
| `/peppol/inbound`, `/documents/purchases` | Factures d'achat reçues sur Peppol (liste, téléchargement, réponse métier) — réception à activer dans Falco (inscription Peppol de la société, désinscription de l'ancien point d'accès) |
| Comptable | **Horus Office** : `send_accounting: true` pousse la pièce dans le dossier du comptable (journal + numéro). **Autre logiciel (Winbooks, Octopus, Exact, Yuki, BOB) : aucun export structuré ni API** ; seul un « export comptable » manuel (ZIP de documents par période d'import) existe [F8] |

Inconnues à lever en bac à sable ou avec `developer@falco-app.be` : comportement d'un **doublon** de
numéro ; acceptation du **régime de la marge** (catégorie `E` + texte d'exemption, §2.4) par les
« règles Falco » ; taille maximale d'un UBL ; fréquence de polling recommandée ; rotation des clés.

### 1.3 Plan d'intégration proposé

**Architecture** : une fonction serveur `falco-send` (Deno, secrets `FALCO_APP_SECRET`,
`FALCO_API_KEY_<société>` et `FALCO_ENV` dans Supabase, jamais dans le code), une table
`peppol_transmissions` (document, société, `falco_document_id`, UBL envoyé, statut, événements,
horodatages, erreurs ; **append-only** comme `events`), une tâche planifiée `falco-poll` (toutes les
15 min), et un bloc « Facture électronique » sur la fiche d'une facture / d'un avoir.

**Séquence à la validation d'une facture ou d'un avoir (FAC / AVO numéroté)** :

1. **Qualifier le client** : (a) `contacts.vat_number` belge (`BE0…`/`BE1…`) et client établi en
   Belgique → **Peppol obligatoire** ; (b) particulier, ou pro étranger (FR, NL, CH) → PDF par mail
   (§5), Peppol facultatif si le client y est inscrit ; (c) ticket TIK → jamais.
2. **Vérifier l'inscription** du client : `GET /peppol/participants/find?vat_number=` (et `check`
   sur `0208:` + n° BCE si connu) ; résultat mémorisé sur la fiche client (`peppol_id`,
   `peppol_checked_at`) et revérifié tous les 30 jours. Client belge assujetti **non inscrit** :
   alerte sur la facture, envoi PDF « par accord » (FAQ SPF : la facture reste valable, le client
   s'expose aux amendes), et **jamais de renvoi Peppol rétroactif** [P6].
3. **Construire l'UBL** (règles §2.4 : `EndpointID schemeID="0208"` = n° BCE des deux parties,
   `PartyTaxScheme/CompanyID` = `BE0…`, `BuyerReference` ou `OrderReference` « NA », catégories de
   TVA S / E / G / K / AE, `BillingReference` sur un avoir, `PrepaidAmount` sur une facture finale
   après acompte) ; **archiver l'UBL** avec son empreinte SHA-256 dans la GED du document (c'est la
   facture légale, pas le PDF).
4. En bac à sable d'abord, puis en production pendant le premier mois : `validate-ubl` → journaliser
   les avertissements ; puis `POST /invoices/imports/ubl` avec `send_peppol: true` et
   `send_accounting` selon la décision §6.1. Enregistrer `document_id` **avant** tout nouvel essai
   (pas d'idempotence côté Falco).
5. **Polling** `GET /documents/sales/{id}` : `not_sent` → « en attente », `success` → « livrée au
   point d'accès du client » (événement MLR), `failure` → « échec technique, renvoi automatique
   jusqu'à 3 fois puis alerte », `rejected` → **rejet** : motif affiché sur la facture, alerte dans la
   cloche du comptable et de l'administrateur, bouton « Corriger et renvoyer ». La réponse métier du
   client (`peppol_invoice_response` : acceptée / refusée / payée) est affichée quand elle existe.
6. **Un rejet se corrige par une note de crédit + nouvelle facture** quand l'erreur porte sur le
   contenu (montants, client, TVA) ; par un simple renvoi quand elle porte sur la forme (identifiant,
   champ manquant) et que la facture n'a jamais été acceptée. Le DMS ne modifie jamais une facture
   numérotée (M-82) : la règle vaut aussi pour Peppol.
7. **Preuve et conservation** : UBL émis, réponse Falco, événements MLR / Invoice Response et PDF
   conservés **10 ans** (§2.5) et exportables ; rien n'est supprimé.

**Deux sociétés** : la fonction choisit la clé API d'après `documents.company_id` ; quota surveillé par
`whoami.peppol_invoices_sent_this_month` (alerte à 400) ; rate limit partagé (60/min) : envoi en
file, pas en rafale (clôture Shopify, factures d'OR en série).

**Réception des factures fournisseurs** (Ducati West Europe, Motul…) : hors périmètre de cette étude ;
`GET /peppol/inbound` permettra plus tard d'alimenter M04 (COM002 « numérisation des factures
d'achat » devient inutile pour les fournisseurs belges sur Peppol).

**Coût** : Falco 2 × 40 €/mois HTVA ; développement lot A (§7) 5 à 7 jours.

---

## 2. Peppol et e-reporting : ce qui est obligatoire, quand

### 2.1 B2B belge : obligatoire depuis le 01/01/2026 (loi du 06/02/2024, AR du 08/07/2025 publié le 14/07/2025)

Trois conditions cumulatives [P1] [P2] : fournisseur assujetti **établi en Belgique** ; client
assujetti **tenu de communiquer son n° de TVA belge** ; opération **localisée en Belgique** et non
exemptée par l'art. 44. Format : **Peppol BIS Billing 3.0 (UBL)** par le réseau Peppol ; un autre
format EN 16931 est possible par accord entre les parties, mais l'entreprise doit rester capable
d'envoyer **et de recevoir** via Peppol [P1]. Le PDF envoyé en plus n'est pas la facture ; le client ne
peut pas l'exiger [P3]. **Sanctions** (AR n° 44) : 1 500 € / 3 000 € / 5 000 € pour absence de
moyens techniques, après avertissement ; la tolérance générale (janvier–mars 2026) est **terminée**
[P4] [P5]. Circulaire 2026/C/43 (loi du 10/02/2026) : si le destinataire ne peut techniquement pas
recevoir, le fournisseur émet une facture non structurée [B9].

### 2.2 B2C, étranger, B2G

- **Particulier** : pas d'obligation ; PDF par e-mail (avec acceptation, au moins tacite : art. 53 §2
  al. 4 CTVA) ou papier [P6] [B8]. Un indépendant qui achète pour son activité est un assujetti →
  Peppol.
- **Client professionnel français, néerlandais, suisse** : hors champ (pas établi en Belgique ;
  livraison intracommunautaire ou exportation) → PDF/papier, Peppol facultatif ; le reporting
  intra-UE arrivera avec ViDA au plus tard le **01/07/2030** [P6] [P7].
- **B2G** : obligatoire pour les marchés publics ≥ 3 000 € HTVA publiés après le 01/03/2024 (Mercurius) ; sans objet pour la concession sauf vente à une commune ou une zone de police [P8].

### 2.3 E-reporting 2028 : avant-projet, pas encore loi (état au 03/11/2026)

Le Conseil des ministres a approuvé le **18/07/2026** un avant-projet : **e-reporting quasi temps réel
des données de facturation B2B à partir du 01/01/2028** (modèle Peppol « 5 coins » : le SPF Finances
reçoit une copie des données via le point d'accès ; déclaration bilatérale vendeur + acheteur ; délai
envisagé 5 jours, jeu de données calqué sur le « Tax Data Document » ViDA), **suppression du listing
clients annuel** pour les assujettis concernés, transposition ViDA au 01/07/2030. Avis APD / Conseil
d'État en cours ; AR d'exécution attendu début 2027 [P9] [P10] [P11]. **Le B2C et les caisses ne sont
pas dans le projet actuel** (l'accord de gouvernement l'évoquait, l'avant-projet ne le reprend pas) ;
donc, pour la caisse du DMS, rien à transmettre au fisc en 2028 **dans l'état des textes** — à
resurveiller à la publication de l'AR. Ce que ça implique déjà : factures structurées **complètes et
justes** (n° de TVA du client validé, codes de catégorie de TVA corrects), car le point d'accès
transmettra la copie au fisc sans repasser par nous ; les points d'accès belges préparent des contrôles
schématron sur le n° de TVA ; ISO 27001 obligatoire pour les prestataires au 01/10/2027 [P11].

### 2.4 Règles de forme à respecter dans notre UBL (Peppol BIS 3.0 v3.0.21, scénarios BEG) [P13] [P14] [P15]

| Sujet | Règle | État de `src/modules/accounting/ubl.ts` |
|---|---|---|
| Identifiant Peppol | `EndpointID schemeID="0208"` = **n° BCE** (10 chiffres, sans BE) pour le vendeur **et** l'acheteur ; `9925:BE0…` (TVA) seulement en complément. Les prestataires belges doivent enregistrer leurs clients sous 0208 | **Fait (03/11)** : `0208` + n° BCE (vendeur : fiche société, obligatoire à l'export ; acheteur belge : tiré de son n° de TVA) ; **aucune société n'a encore son n° BCE en base** |
| Référence acheteur | `BuyerReference` **ou** `OrderReference` obligatoire (PEPPOL-EN16931-R003) ; BEG : « NA » si pas de bon de commande | **Fait (03/11)** : `BuyerReference` « NA » + `OrderReference` (commande d'origine) |
| N° TVA | `PartyTaxScheme/CompanyID` = `BE0xxxxxxxxx` ; `PartyLegalEntity/RegistrationName` = dénomination BCE | Fait |
| TVA 21 / 6 % | catégorie `S`, TVA = base × taux arrondie **par taux** (BR-CO-17) | Fait (arrondi par taux) |
| Détaxe export | `G` + `VATEX-EU-G` | **Fait (03/11)** : `G` + `VATEX-EU-G` |
| Livraison intracom | `K` + `VATEX-EU-IC`, n° TVA étranger de l'acheteur, date ou période de livraison + pays | Absent |
| Autoliquidation | `AE` + `VATEX-EU-AE` + note document « Autoliquidation. En l'absence de contestation… » | Code présent mais mal attribué |
| **TVA sur la marge** | Scénario BEG 9 (25/02/2026) : catégorie **`E`, 0 %, aucune TVA sur la facture**, `TaxExemptionReason` = « Livraison soumise au régime particulier d'imposition de la marge bénéficiaire. TVA non déductible. » ; **pas** de code VATEX, **pas** la catégorie `O` (interdit les n° TVA) ; la TVA due (marge × 21/121) est calculée hors facture | **Fait (03/11)** : `E` 0 % + texte, sans VATEX (lots TVA marge et facture légale) |
| Avoir | racine `CreditNote`, type 381, `BillingReference` vers la facture d'origine (BR-55) | **Fait (03/11)** : `BillingReference` (n° + date) |
| Acompte | facture finale : `PrepaidAmount` (BT-113), `PayableAmount = TaxInclusive − Prepaid` (BR-CO-16), référence à la facture d'acompte | **Fait (03/11)** : `PrepaidAmount`, `BillingReference` vers chaque FAA ; FAA en type 386 |
| Paiement | `PaymentMeansCode` 30 + IBAN (BR-50) ; `DueDate` ou `PaymentTerms` si montant dû > 0 | Fait (IBAN) ; échéance si connue |
| Lignes | montant = qté × prix ± remises (tolérance 0,02), prix ≥ 0, quantité négative possible ; remise de ligne en `AllowanceCharge` | **Fait (03/11)** : remise de ligne en `AllowanceCharge`, remise globale / port en remise / frais de document, prix jamais négatif, lignes texte exclues, aucun élément vide ; 5 UBL de test validés (phive, OpenPeppol 2026.5) |
| Langue des mentions | langue de la région du siège d'exploitation (Waterloo → FR) | Fait (FR) |

### 2.5 Conformité d'un logiciel maison

- **Conserver l'UBL original** émis et reçu (le PDF ne suffit pas ; convertir « alourdit
  significativement la charge de la preuve »), avec intégrité, authenticité, lisibilité garanties par
  une **piste d'audit fiable** (art. 60 §5 CTVA) ; stockage électronique possible hors Belgique dans
  l'UE si accès en ligne complet depuis la Belgique [P16] [B10].
- **Durée : 10 ans** par prudence (art. 60 CTVA porté à 10 ans par la loi du 20/11/2022 ; la loi du
  18/12/2025 ramène le délai CIR à 7 ans et une circulaire 2026/C/31 serait venue aligner la TVA,
  non vérifiée sur Fisconetplus ; la page SPF e-invoice dit encore 7 ans) ; 15 ans pour les biens
  d'investissement immobiliers [P16] [B10].
- Journaliser **MLR et Invoice Response** (preuve de transmission, utile pour les amendes « moyens
  techniques » et l'e-reporting) ; détecter les **doublons** côté DMS (Peppol ne le fait pas) [P6].
- **Listing clients annuel** : toujours dû (avant le 31 mars, clients belges assujettis > 250 € HTVA)
  au moins pour 2026 et 2027 [P17] ; **relevé intracommunautaire** mensuel pour les livraisons
  art. 39bis (grille 46) ; **liste trimestrielle AR 48** pour les motos neuves vendues à des particuliers
  de l'UE (§3).

---

## 3. La facture belge « bien faite » pour une concession : liste de contrôle

Référentiel : art. 5 §1 AR n° 1 (texte au 01/01/2025), AR n° 53 (marge), AR n° 4 (notes de crédit),
AR n° 48 (moyens de transport neufs), art. 17, 53, 58 §4 et 60 CTVA, lois linguistiques [B1] à [B10].
Légende : ✅ fait · 🟦 partiel · ⬜ absent · 🔴 faux.

| # | Exigence | Base | DMS aujourd'hui | État |
|---|---|---|---|---|
| 1 | **Numéro séquentiel unique**, une ou plusieurs séries, inscrit au facturier de sortie ; pas de trou | AR 1 art. 5 §1 1°, art. 15 §2 | `next_document_number` : série par société et par type (`FAC-2026-00001`, `AVO-`, `TIK-`), verrou ligne, numéro pris à la validation seulement, brouillon sans numéro (M-82) ; remise à zéro annuelle avec l'année dans le numéro (admis) | ✅ |
| 2 | Date d'émission ; date du fait générateur ou de l'encaissement si différente | 5 §1 1°, 5° | `issue_date` ; pas de date de livraison distincte ; la date d'encaissement d'un acompte n'est pas sur une facture (voir 9) — **fait (03/11)** pour l'acompte : la facture d'acompte imprime la date de l'encaissement | 🟦 |
| 3 | Identité complète du vendeur : dénomination, siège, **n° TVA**, (CSA : n° BCE, RPM, forme juridique) | 5 §1 2°, CSA 2:20 | `legal_name`, adresse, `vat_number`, IBAN/BIC sur le PDF ; **n° BCE / RPM / forme juridique absents** des paramètres société — **fait (03/11)** : n° BCE et RPM sur la fiche société et en en-tête (forme juridique dans la raison sociale) | ✅ |
| 4 | Identité du client : nom, adresse, **n° TVA** (n° TVA étranger pour une livraison intracom) | 5 §1 3°, 4° b) | `contacts.vat_number`, adresse ; pas de contrôle de validité (mod 97 / VIES) ; `company_number` (BCE) absent | 🟦 |
| 5 | Description, quantité, prix unitaire HT, remises | 5 §1 6°, 8° | Lignes, remise ligne et pied, HT/TTC | ✅ |
| 6 | **Par taux** : base, taux, montant de TVA en euro | 5 §1 8°, 9° | `vatBreakdown` sur le PDF | ✅ |
| 7 | **Véhicule** : marque, modèle, cylindrée, puissance, **VIN**, 1re mise en circulation, kilométrage (données art. 8bis §2 obligatoires pour un moyen de transport neuf ; le 7° vise « voitures », pour une moto le 6° suffit mais on les met toujours) ; **plaque** pour tout travail d'atelier | 5 §1 7°, CTVA 8bis §2 | Bloc moto du PDF : marque, modèle, année, VIN, plaque, km, couleur, cylindrée, mise en circulation, n° moteur (mission 08 carte 2) ; **puissance kW absente** ; plaque sur la facture d'OR : à vérifier (M8) | 🟦 |
| 8 | **Régime de la marge** (occasion type O) : mention **« Régime particulier - Biens d'occasion »** (AR 53 art. 8), **aucune TVA apparente**, prix TTC facturé ; base d'imposition = **marge totale de la période de déclaration** (globalisation, AR 53 art. 3), registre d'achats + registre de comparaison, bordereau d'achat au particulier, individualisation par VIN, inventaire annuel du stock marge ; exclusion de l'exemption intracom (39bis) | CTVA 58 §4, AR 53 | Mention imprimée avec l'ancienne formule (« Livraison soumise au régime particulier… art. 58 §4 ») ; **la vente taxe à 21 % sur le prix total et affiche la TVA** (B2 non respecté) ; registre VO par véhicule (`vo_margin_register`) ; pas de bordereau d'achat ; pas de calcul global par période ni d'inventaire marge | 🔴 |
| 9 | **Facture d'acompte** : TVA exigible à l'encaissement (art. 17 §1 al. 3) ; facture obligatoire au plus tard le 15 du mois suivant, **y compris pour un particulier qui commande une moto** (AR 1 art. 1) ; facture finale qui **référence** la facture d'acompte et ne refacture pas la TVA déjà due (5 §1 11°) | CTVA 17, 53 §2 ; AR 1 art. 1, 4, 5 | Acompte = règlement sur RES/BC reporté sur la FAC finale ; **aucun document « facture d'acompte »**, la TVA n'est déclarée qu'à la facture finale ; le registre TVA ignore les acomptes encaissés — **fait (03/11)** : facture d'acompte `FAA-` (automatique moto / client assujetti, sur demande sinon), facture finale qui la référence et la déduit, rappel « avant le 15 » | ✅ |
| 10 | **Note de crédit** : référence « spécifique et non équivoque » à la facture rectifiée ; mention « TVA à reverser à l'État dans la mesure où elle a été initialement déduite » (AR 4 art. 4 §1 3°) sur un avoir avec TVA à un assujetti ; avoir partiel possible ; la facture d'origine **reste** au facturier | CTVA 53 §2 al. 3, 79 ; AR 1 art. 12 ; AR 4 | `generateCreditNote` : lignes inversées, `source_document_id`, remboursements ; **la référence à la facture n'est pas imprimée**, pas de mention AR 4, **avoir total uniquement**, et **la facture passe en `annulee`** → elle **sort du journal des ventes et du registre TVA** (`status <> 'annulee'`) alors que l'avoir négatif y reste : **le journal devient faux** (double déduction) — **fait (03/11)** : référence n° + date et mention AR 4 imprimées, avoir partiel, `AVO-` continu, facture conservée au journal (`avoir_emis`) | ✅ |
| 11 | Mention d'exonération : export « Exonération art. 39 §1 CTVA » (+ preuves AR 18 : déclaration d'exportation, accusé de réception si l'acheteur emporte ; véhicule immatriculé en BE : export dans les 3 mois) ; intracom « art. 39bis » + n° TVA étranger + preuve de transport (AR 52) ; **moyen de transport neuf vendu à un particulier de l'UE** (< 6 mois **ou** ≤ 6 000 km) : facture **sans TVA belge**, mentions 8bis §2, **liste trimestrielle AR 48** | 5 §1 10° ; CTVA 39, 39bis, 8bis ; AR 18, 48, 52 | Détaxe = TVA 0 + mention art. 39 (PDV005) ; **pas de distinction export / intracom / moyen de transport neuf**, pas de liste AR 48, pas de relevé intracom | 🟦 |
| 12 | Autoliquidation « Autoliquidation » ; autofacturation « Autofacturation » | 5 §1 9°bis, 9°ter | Sans objet au comptoir ; non géré | ⬜ |
| 13 | **Ticket ou facture ?** Facture obligatoire même pour un particulier : toute moto > 48 cm³ / 7,2 kW (neuve ou occasion) ; pièces, accessoires, équipements et travaux atelier **> 125 € TTC** ; vente à tempérament ; assujetti ou personne morale toujours. Ticket possible : vêtements, casques, goodies, et pièces ≤ 125 € | AR 1 art. 1 ; CTVA 53 §2 | La caisse fait un TIK sans client pour n'importe quel montant et n'importe quel article ; **aucun garde-fou** | ⬜ |
| 14 | **Journal des recettes** pour les ventes sans facture : total journalier par taux, inscription distincte des biens > 500 € TTC et des ventes marge sans facture ; ticket numéroté 4-8 positions sans interruption ; rapport Z numéroté | AR 1 art. 14 §2 3°, 15 §4 ; AR 53 art. 9 | Journal Z par session (encaissements par mode, ventilation TVA) ; TIK numérotés ; **le ticket n'est pas rattaché à la session**, pas de n° d'ordre du rapport Z, pas de journal des recettes imprimable par jour et par taux | 🟦 |
| 15 | Délai d'émission : 15e jour du mois suivant le fait générateur | AR 1 art. 4 | Facture à la validation ; OR terminés non facturés : pas d'alerte « à facturer avant le 15 » | 🟦 |
| 16 | **Langue** : siège d'exploitation à Waterloo → mentions légales **en français** ; traduction NL/EN en plus autorisée ; pour un client belge la version FR fait foi (NL INVEST : à confirmer selon son siège) | Lois coordonnées 1966 art. 52 ; décret flamand 1973 | PDF dans la langue de la fiche client (I18N004) : un client NL reçoit un PDF **tout en néerlandais** → ajouter la version française (recto FR / verso NL ou deux pages) — **fait (03/11)** pour les mentions légales (FR puis langue du client) ; libellés du document toujours dans la langue du client | 🟦 |
| 17 | Garantie légale (2 ans ; occasion ≥ 1 an **stipulée dans le bon de commande signé avant la vente**) ; bon de commande obligatoire dès qu'un acompte est versé (Traxio) | CC 1649quater ; Traxio 09/2026 | BC existe (mission 05) ; aucune mention de garantie, pas de signature du BC (VEN003) | 🟦 |
| 18 | Contributions environnementales : Recytyre (pneus) en ligne séparée soumise à TVA ; Bebat (batteries) mention obligatoire B2B | Organismes | Rien | ⬜ |
| 19 | **Conservation** 10 ans : copies des factures, UBL, journaux ; piste d'audit | CTVA 60 | GED (PDF archivé à l'envoi seulement), `events`, écritures append-only ; **PDF non archivé si la facture est seulement imprimée** ; suppression de pièces GED possible par tout membre (M9 §5) ; pas d'UBL archivé | 🟦 |
| 20 | **Facture électronique** : B2B belge → UBL via Peppol (facture légale = l'UBL) ; B2C → acceptation du client pour le PDF ; duplicata = même numéro + mention « Double » | AR 1 art. 13ter ; CTVA 53 §2 al. 4 | UBL téléchargé à la main (M12) ; PDF par Outlook ; pas de notion de duplicata (réimpression identique = acceptable) | 🟦 |
| 21 | Clients étrangers : pro FR/NL avec n° TVA → intracom (46 + relevé) ; particulier FR/NL : moto neuve → sans TVA (39bis 2°), occasion → TVA belge 21 % ou marge ; suisse → export art. 39 | CTVA 14, 39, 39bis | Détaxe unique « TVA 0 % » : pas de qualification du cas | ⬜ |

**Ce que ça change pour le vendeur** : à la validation d'une facture, le DMS doit **choisir le
régime** (normal 21 % / 6 % ; marge ; export ; intracom B2B ; moyen de transport neuf B2C UE ;
autoliquidation) d'après le type d'article, le pays, le n° de TVA et l'âge / kilométrage de la moto,
et imprimer la mention qui va avec. Aujourd'hui il n'a qu'une case « détaxe ».

---

## 4. La comptabilité : ce que le comptable attend, ce que le DMS exporte, ce qui manque

### 4.1 Ce qu'un comptable belge attend d'une caisse / d'un ERP [B6] [B7] [G8]

- **Facturier de sortie** (journal des ventes + notes de crédit) : n° d'ordre, date, client (n° TVA),
  base et TVA **par taux**, ventilation **par grille de la déclaration** avec totaux par période
  (AR 1 art. 15 §3) ; en pratique un fichier par mois, **figé après le dépôt de la déclaration**
  (20 du mois suivant), sans modification rétroactive (toute correction = note de crédit).
- **Journal des recettes** (tickets) : total par jour et par taux, biens > 500 € individualisés.
- **Facturier d'entrée** (achats) et **journaux financiers** (banque, caisse, cartes), OD.
- **Écritures PCMN** : vente `400 / 70x / 451` ; règlement `550 ou 570 / 400` ; ticket `570 (ou 580
  cartes) / 70x / 451` ; **acompte `550 / 46 (461) + 451`** (compte 46 « acomptes reçus sur
  commandes », avis CNC — pas 440 ni 4890) puis `46 / 70x` à la livraison ; **vente marge** :
  `400 / 70x « ventes marge »` au TTC, sans 451 à la vente, puis **OD de fin de période** `70x marge /
  451` = marge totale × 21/121 d'après le registre de comparaison ; achat marge `60x / 440`
  (bordereau, sans TVA) ; NC `70x + 451 / 400` ; écarts de caisse 657/757.
- **Grilles** : vente 21 % → 03 + 54 ; 6 % → 01 + 54 ; **marge** → 00 (prix d'achat, statistique) +
  03 (marge HTVA) + 54 ; export → 47 ; intracom → 46 + relevé ; autoliquidation → 45 ; NC émises → 49
  (48 si 44/46) + 64 ; achats stock → 81, frais → 82, investissements → 83 ; acquisitions intracom
  (motos achetées en UE) → 86 + 55 + 59.
- **Listing clients** annuel, relevé intracom mensuel, liste AR 48 trimestrielle.
- **Formats d'import** : Winbooks Classic = fichier **ACT (dBase)** ou import Excel avec mappage de
  colonnes (une facture = 1 ligne DOCTYPE 1 client TTC avec VATBASE/VATTAX + n lignes DOCTYPE 3
  comptes 70x avec VATCODE + ligne 451 ; DOCNUMBER **numérique** 8 positions, DBKCODE, PERIOD,
  DATEDOC, AMOUNTEUR signé, contrôle de rupture de séquence) ; **Horus Office** = API JSON-RPC
  `invoices.sales.new` (journal, type, numéro, date, échéance, client, lignes compte / base / TVA /
  TaxType / TaxOrigin, PDF joint) ou dossier UBL surveillé ; **Octopus** = import UBL/XML ou API REST
  « bookings » (CSV obsolète) ; **Exact Online** = API `SalesEntries` ; **Yuki** = XML SOAP
  `ProcessSalesInvoices` ou dépôt UBL ; **BOB 50** = import Excel à la reprise, sinon connecteurs
  UBL. Point commun 2026 : **tous acceptent l'UBL** (c'est le format que nous produirons pour Peppol).

### 4.2 Ce que le DMS exporte aujourd'hui (`src/modules/accounting/`, M12) et ce qui manque

| Besoin du comptable | DMS aujourd'hui | Manque / défaut | Priorité |
|---|---|---|---|
| Journal des ventes par période | `sales_journal` (FAC, TIK, AVO non annulés), écran + clic vers la facture | Pas d'export fichier du journal lui-même ; **exclut les factures `annulee`** (avoir) ; TIK mélangés aux factures (le ticket relève du journal des recettes) ; pas de ventilation par grille | Haute |
| Registre TVA par taux | `vat_register` (par taux de ligne, en-têtes G8 sans lignes) | Pas de grille (00/01/03/45/46/47/49/54/64) ; pas de régime (marge, export, intracom) ; **acomptes encaissés ignorés** (TVA exigible non déclarée) | Haute |
| Journal des recettes (tickets) | Journal Z par session de caisse (`cash_z_report`) | Pas de journal des recettes par jour et par taux imprimable/exportable ; ticket non rattaché à la session | Moyenne |
| Écritures PCMN | `generate_accounting_entries` : ventes (client TTC / 70x par compte × taux / 451) et règlements (trésorerie / client), append-only, équilibre contrôlé, comptes par `account_mappings` paramétrables, date de bascule | Avoir : sens inversé ✅ mais facture d'origine sortie du journal ; **acomptes** : pas d'écriture 46 ; **marge** : mapping `vat_margin` et compte 451090 créés mais **jamais utilisés** (écritures à 21 % sur le total) ; pas de comptes par nature (motos neuves / occasion / pièces / MO) sans paramétrage ; mouvements de caisse (fond, sorties) non comptabilisés | Haute |
| Export Winbooks | CSV « Actage » depuis les écritures : DocType, DbkCode, DocNumber, DocOrder, AccountGL, AccountRP, BookYear, Period, Date, Comment, Amount, VatCode | Colonnes provisoires : il manque **DATEDOC, DUEDATE, VATBASE, VATTAX, ACCOUNTRP = référence tiers Winbooks (10 car.)**, DOCNUMBER numérique (le nôtre est `FAC-2026-00001`), journaux ventes / NC distincts (DBKTYPE 2 / 3) ; gabarit du comptable toujours attendu | Haute si Winbooks |
| Export Horus | Aucun | Si le comptable est sur Horus : `send_accounting` via Falco couvre les ventes ; les règlements et la caisse restent à exporter (ou saisis par le comptable depuis la banque) | Selon §6.1 |
| Export UBL (archive pour tout comptable) | UBL par facture, téléchargé à la main, tracé dans `accounting_exports` | Pas d'export groupé par période (ZIP d'UBL) ; UBL non archivé en GED | Moyenne |
| Registre de comparaison TVA marge | `vo_margin_register` par véhicule (PA = `articles.purchase_price`), CSV, attestation | **Méthode par véhicule ≠ méthode belge (globalisation par période + régularisation annuelle + inventaire)** ; PA sans ORO ; aucun bordereau d'achat ; pas de registre des achats marge | Haute avant la 1re VO |
| Listing clients annuel | Aucun | Agrégat par n° TVA belge > 250 € HTVA, format Intervat (XML ou saisie) | Moyenne (mars 2027) |
| Relevé intracom, liste AR 48 | Aucun | Nécessite la qualification du régime (§3 ligne 21) | Basse (à la première vente UE) |
| Débiteurs, acomptes en cours, effets | `debtors_list`, `pending_deposits`, `pending_effects` (CSV) | OK pour la clôture | — |
| Clôture de période | `close_fiscal_year` (fige les documents datés dans la période) | Pas de clôture **mensuelle** TVA (verrou après dépôt) ; pas de verrou des règlements et écritures de la période | Moyenne |
| Rapprochement bancaire (COM001) | Aucun import de relevé | Import CODA / CSV banque, lettrage sur communication structurée (QR virement déjà en communication structurée belge) | Phase suivante |
| Sécurité (M12 §5) | Fonctions `sales_journal`, `vat_register`, `close_fiscal_year`, `generate_*` exécutables **sans être connecté** | Corriger les gardes `auth.uid() is null or …` avant d'ouvrir quoi que ce soit au comptable | **Bloquant** |

---

## 5. Envoi des factures par e-mail : constat DNS et recommandations

### 5.1 Constat sur `ducatibxl.be` (requêtes `nslookup` du 03/11/2026 sur les résolveurs Google 8.8.8.8 et Cloudflare 1.1.1.1 ; zone hébergée chez Combell `ns1.combell.eu`)

| Enregistrement | Résultat | Lecture |
|---|---|---|
| MX | `ducatibxl-be.mail.protection.outlook.com` | Messagerie Microsoft 365 : cohérent avec Graph |
| SPF (`TXT @`) | `v=spf1 include:spf.protection.outlook.com -all` | ✅ Correct et strict : seuls les serveurs Microsoft 365 peuvent envoyer ; Graph `sendMail` passe par eux |
| DKIM (`selector1._domainkey`, `selector2._domainkey`) | **NXDOMAIN** (inexistants) | ⚠️ **DKIM non activé pour le domaine** : Microsoft signe avec la clé par défaut `*.onmicrosoft.com`, qui **ne s'aligne pas** avec `ducatibxl.be` |
| DMARC (`_dmarc`) | **NXDOMAIN** | ⚠️ **Aucune politique DMARC** : Gmail / Yahoo / Outlook.com la demandent pour les expéditeurs en volume ; sans DMARC, l'usurpation du domaine n'est pas déclarée, et la délivrabilité des factures (PDF en pièce jointe, mots « facture », « paiement ») est fragilisée |

### 5.2 Recommandations (Domenico ou son informaticien, chez Combell ; 1 heure)

1. **Activer DKIM** dans Microsoft 365 (Defender → Email authentication → DKIM → `ducatibxl.be`) :
   Microsoft fournit deux CNAME `selector1._domainkey` et `selector2._domainkey` (cibles
   `…dkim.mail.microsoft` ou `…onmicrosoft.com` selon le tenant : copier les valeurs exactes du
   tenant) ; les publier chez Combell, attendre la propagation, puis « Enable » [M3].
2. **Publier DMARC** en surveillance d'abord : `_dmarc.ducatibxl.be TXT "v=DMARC1; p=none;
   rua=mailto:dmarc@ducatibxl.be"`, lire les rapports un mois, puis passer à `p=quarantine` puis
   `p=reject` [M3].
3. Garder le SPF tel quel (ne pas y ajouter Shopify, Stripe ou Resend sans réflexion : chacun envoie
   depuis ses propres domaines).

### 5.3 Contraintes Microsoft Graph et pratiques côté DMS

- **Taille** : une pièce jointe de moins de **3 Mo** passe dans le `sendMail` simple ; de 3 à 150 Mo
  il faut créer le message en brouillon et une **session de téléversement** par pièce (chunks de 4 Mo)
  [M1] [M2]. Nos PDF de facture font 50 à 300 Ko ; le dossier accident (4 pièces, photos) peut
  dépasser 3 Mo : prévoir la session de téléversement dans `graph-send-email` (0,5 j), et limiter les
  photos à 2 000 px (déjà fait). Message total ≤ 35 Mo par défaut (Exchange Online).
- **Débit** : limite Outlook ≈ 150 Mo / 5 min par boîte et 10 000 messages/jour par boîte ; les
  relances automatiques devront partir en file, pas en rafale.
- **Ce que fait déjà `graph-send-email`** : appelant connecté et membre de la société, boîte d'envoi
  vérifiée (partagée ou adresse de l'utilisateur sur le même domaine), signature, pied de mail dans la
  langue du client, mode « vérifier sans envoyer », **trace `events` `email_sent`** (qui, quand, à
  qui, boîte, objet, fichiers), copie dans « Éléments envoyés », PDF rangé en GED client + document.
  C'est une **preuve d'envoi** raisonnable (piste d'audit) ; ajouter l'**empreinte SHA-256 du PDF** dans
  la trace et dans `attachments.content_hash` (déjà prévu pour la relève) pour prouver que le PDF
  archivé est celui envoyé.
- **Contenu du mail de facture** : objet « Facture FAC-2026-00012 — ITALBIKE STORE », montant, échéance,
  IBAN + **communication structurée** (déjà calculée pour le QR), lien vers l'espace client ; **joindre
  l'UBL au PDF** pour les clients non Peppol est licite et utile (le comptable du client peut l'importer),
  mais ne vaut pas « facture structurée émise » au sens de l'AR 1 art. 13ter [B8].
- **Copie au comptable** : plutôt qu'un `cc` à chaque facture (bruit, risque d'erreur), lui donner
  un **export mensuel** (ZIP des UBL + PDF + journal) ou, s'il est sur Horus, `send_accounting`.
- **Relances** : `_cron_invoice_reminders` enfile une relance par facture échue tous les 7 jours, mais
  `dispatch-notifications` ne sait pas envoyer (Resend absent). Brancher les relances sur
  `graph-send-email` (boîte partagée `compta@` ou `info@`), **après** avoir vérifié la liste des
  factures échues reprises de G8 (13 notifications en file le 18/09).
- **Ticket par e-mail sans client** (PDV003) : saisie d'une adresse au comptoir, sans fiche client ; à
  faire dans le lot C.

---

## 6. Les décisions à prendre avec Domenico et son comptable

| # | Question | Pourquoi ça compte | Notre recommandation |
|---|---|---|---|
| 1 | **Le comptable est-il sur Horus Office ?** Sinon, lequel (Winbooks, Octopus, Exact, Yuki, BOB) et quel format veut-il ? | Falco pousse en compta seulement vers Horus ; sinon le DMS reste la source de l'export (Winbooks ACT à caler sur son gabarit, ou UBL) | Demander le **fichier exemple** qu'il importe aujourd'hui depuis G8 ; si Horus : `send_accounting` + export des règlements ; sinon : ZIP mensuel UBL + ACT |
| 2 | **TVA marge** : confirmer la **globalisation par période** (AR 53 art. 3) et le **prix d'achat** retenu (prix de reprise seul ; l'ORO et les frais sont des charges normales avec TVA déductible, pas une composante du prix d'achat marge — à faire confirmer) ; qui tient le registre de comparaison (DMS ou comptable) ; régularisation annuelle et inventaire marge | Le DMS calcule aujourd'hui par véhicule et facture la TVA sur le total : il faut trancher avant la première vente d'occasion | DMS = registre d'achats + registre de comparaison + calcul global par période exportable ; facture TTC sans TVA avec la mention AR 53 ; comptable valide l'OD mensuelle |
| 3 | **Factures d'acompte** : les émettre systématiquement (c'est la loi dès qu'un acompte est encaissé sur une moto, même à un particulier) — ou le comptable préfère-t-il une autre pratique pour les acomptes sous 15 jours avant livraison ? | Change le parcours RES/BC → facture | Facture d'acompte automatique à l'encaissement (série `FAC-`), TVA déclarée, facture finale avec `PrepaidAmount` |
| 4 | **Ticket ou facture au comptoir** : appliquer le seuil 125 € TTC pour pièces / accessoires / atelier et « facture obligatoire » pour toute moto ; demander le nom à partir de quel montant ? | Garde-fou en caisse | Oui ; au-dessus de 125 € le vendeur doit choisir un client ou cocher « vêtement / goodies » |
| 5 | **Identifiants** : n° BCE des deux sociétés, RPM, forme juridique, siège d'exploitation de NL INVEST (langue !), IBAN de la seconde société, n° de créancier SEPA | Paramètres société incomplets (M12 §5) | À saisir dans Paramètres → Sociétés avant tout envoi Peppol |
| 6 | **Comptes Falco** : 2 abonnements Expert ; qui est administrateur ; migration de la réception Peppol (si une des sociétés reçoit déjà ses factures ailleurs, « clé de migration ») | Sans clé API, rien ne part | Domenico crée les comptes, nous donnons l'Application ID, il génère les clés |
| 7 | **Note de crédit partielle** et **mention AR 4** sur les avoirs : règle de numérotation (`AVO-` propre, recommandé) | Aujourd'hui avoir total uniquement | Série `AVO-`, référence imprimée, avoir partiel par lignes |
| 8 | **Langue des factures** : recto FR + traduction NL/EN sur la même facture, ou deux documents ? | Lois linguistiques (Waterloo) | Mentions légales FR toujours ; libellés traduits en regard |
| 9 | **Clôture mensuelle** : date de verrou (après dépôt TVA) et qui la pose (comptable, rôle `comptable`) | Intangibilité | Verrou mensuel par le comptable dans le DMS, après correction du contrôle d'accès |
| 10 | **Relances** : boîte d'envoi, délais, ton ; **DMARC/DKIM** : qui touche au DNS Combell | §5 | Boîte `compta@`, J+7 / J+21 / J+45 ; DNS par l'informaticien de Domenico |

---

## 7. Estimation par lot (jours agence, hors recette client)

| Lot | Contenu | Jours | Dépend de |
|---|---|---|---|
| **0. Préalables** | Corriger les gardes des fonctions compta appelables sans connexion ; paramètres société (BCE, RPM, Peppol `0208:`, IBAN, SEPA) avec écran ; `company_number` + contrôle mod 97 / VIES du n° de TVA sur la fiche client | 2 | Décision 5 |
| **A. Connecteur Falco → Peppol** | UBL complété (0208, BuyerReference « NA », catégories S/E/G/K/AE, BillingReference, PrepaidAmount, remises en AllowanceCharge, lignes texte exclues, tests) ; fonction `falco-send`, table `peppol_transmissions`, polling, statuts et rejets sur la facture, qualification du client (Peppol obligatoire / PDF), vérification `participants/find`, archivage UBL + SHA-256 en GED, bac à sable puis production | 5 à 7 | Décisions 1, 6 ; comptes Falco |
| **B. Facture « bien faite »** | Facture d'acompte (document, TVA exigible, facture finale avec référence et déduction) ; note de crédit : référence imprimée, mention AR 4, avoir partiel, **facture d'origine conservée au journal** (statut `avoir_emis` au lieu de `annulee`) ; régimes de TVA à la validation (normal, marge, export, intracom B2B, moyen de transport neuf B2C UE) avec mentions légales exactes et puissance kW sur le bloc moto ; garde-fou ticket / facture (moto, > 125 €) ; recto FR + traduction ; duplicata | 5 à 6 | Décisions 3, 4, 7, 8 |
| **C. TVA marge à la vente (B2)** | Facture VO TTC sans TVA (mention AR 53), registre des achats marge + bordereau d'achat, registre de comparaison **global par période** avec régularisation annuelle et inventaire, écritures (70x marge, OD 451 de fin de période), tests obligatoires (règle 7) | 3 à 5 | Décision 2 |
| **D. Compta pour le comptable** | Journal des ventes et journal des recettes exportables par mois avec grilles TVA (acomptes compris) ; export Winbooks ACT calé sur le gabarit (DATEDOC, DUEDATE, VATBASE, VATTAX, ACCOUNTRP, DOCNUMBER numérique, journaux VEN/NCV) **ou** paramétrage Horus `send_accounting` ; ZIP mensuel UBL + PDF ; listing clients annuel ; clôture mensuelle ; mouvements de caisse en écritures | 4 à 5 | Décisions 1, 9 ; fichier exemple |
| **E. Mail** | DKIM/DMARC (client) ; session de téléversement Graph > 3 Mo ; empreinte du PDF dans la trace ; relances par Graph ; ticket par e-mail sans client | 2 | Décision 10 |
| **Total** | | **21 à 27** (dont 17 à 25 hors lot E) | |

Recouvrement avec l'étude caisse du même jour (`2026-11-caisse-legal-et-marche.md`, ≈ 13 à 14 jours) : la facture d'acompte, la mention de l'avoir et le seuil de 125 € y sont aussi comptés ; à ne chiffrer **qu'une fois** (ici, lot B) lors du devis. Le lot A peut commencer dès les comptes Falco ouverts, en bac à sable, sans attendre le comptable ;
les lots B et C attendent les décisions 2 et 3 ; le lot D attend le fichier exemple du comptable.

---

## 8. Sources (consultées le 03/11/2026)

**Falco / Horus**
- [F1] Falco, « Point d'accès Peppol » et « API Falco » — https://www.falco-app.be/peppol/ ; https://www.falco-app.be/api/ (© 2026)
- [F2] peppolstatus.com, points d'accès belges (Horus Software, PBE000593, données du 03/11/2026) — https://peppolstatus.com/countries/be/ ; peppolsolutions.eu, fiche Horus Software SA — https://peppolsolutions.eu/directory/horus-software-sa/
- [F3] Falco, tarifs et comparatif des offres — https://www.falco-app.be/tarifs/ ; https://www.falco-app.be/comparatif-offres/
- [F4] Falco FAQ, « Connexion API » (plan Expert, Application ID, clé affichée une fois) — https://faq.falco-app.be/connexion-api
- [F5] Falco FAQ, « Migrer ma licence vers les nouveaux plans tarifaires d'août 2025 » (plan par société) — https://faq.falco-app.be/mon-abonnement/migrer-ma-licence-falco-vers-les-nouveaux-plans-tarifaires-d'aout-2025
- [F6] Falco FAQ, « Profils commerciaux » (une seule entité légale) — https://faq.falco-app.be/facturation/profils-commerciaux
- [F7] Falco, documentation développeur (getting started 21/09/2026, authentication 27/10/2025, environments 01/11/2025, best practices 21/10/2025 ; références `post_invoices-imports-ubl` 20/07/2026, `post_invoices-imports-pdf`, `post_invoices-imports-validate-ubl`, `get_documents-sales-document-id` 22/05/2026, `get_peppol-participants-check` / `find` 04/05/2026, `get_organization-whoami`, `get_peppol-inbound`) — https://docs.falco-app.be/ (index https://docs.falco-app.be/llms.txt) ; portail https://dev.falco-app.be/fr/home (contenu derrière connexion)
- [F8] Falco FAQ, « Comment envoyer ses documents à son comptable » (export ZIP, sans liaison Horus) — https://faq.falco-app.be/falco-sans-liaison-comptable-horus/export-comptable/comment-envoyer-ses-documents-a-son-comptable ; « Importer et envoyer mes factures externes via Peppol » (UBL non modifiable, statuts) — https://faq.falco-app.be/reception-peppol/comment-importer-et-envoyer-mes-factures-de-vente-ou-notes-de-credit-externes-via-peppol ; « S'inscrire sur Peppol » (0208 / 9925) — https://faq.falco-app.be/reception-peppol/comment-s'inscrire-sur-peppol-et-configurer-son-acces

**Peppol, e-facturation, e-reporting**
- [P1] SPF Finances / BOSA, « Pour qui la facturation électronique deviendra-t-elle obligatoire ? » (09/10/2024) — https://efacture.belgium.be/fr/article/pour-qui-la-facturation-electronique-deviendra-t-elle-obligatoire
- [P2] Lexing, « La facturation électronique sera obligatoire dès le 1er janvier 2026 » (21/10/2025) — https://lexing.be/en/la-facturation-electronique-sera-obligatoire-des-le-1er-janvier-2026/ ; Deg & Partners, « …que retenir de l'arrêté royal du 14 juillet 2025 » — https://blog.degandpartners.com/fr/article/la-facturation-electronique-devient-une-obligation-legale-que-retenir-de-larrete-royal-du-14-juillet-2025-/27879
- [P3] einvoice.belgium.be, FAQ générales B2B (mise à jour 06/05/2026) — https://einvoice.belgium.be/en/FAQ/general-questions-b2b
- [P4] einvoice.belgium.be, FAQ « questions spécifiques » (Q26 sanctions AR 44 ; Q31 régimes particuliers) — https://einvoice.belgium.be/en/FAQ/specific-questions-about-e-invoicing
- [P5] efacture.belgium.be, « Fin de la période de tolérance » (07/04/2026) — https://efacture.belgium.be/fr/news/fin-de-la-periode-de-tolerance-pour-le-facturation
- [P6] einvoice.belgium.be, FAQ Peppol (0208 obligatoire, annuaire, doublons) — https://einvoice.belgium.be/en/FAQ/general-questions-about-peppol ; annuaire https://lookup.peppol.org ; API https://directory.peppol.eu/public/menuitem-docs-rest-api
- [P7] einvoice.belgium.be, FAQ e-reporting — https://einvoice.belgium.be/en/FAQ/general-questions-about-e-reporting
- [P8] einvoice.belgium.be, « E-invoicing government » (09/10/2024) — https://einvoice.belgium.be/en/article/e-invoicing-government
- [P9] KPMG, « Belgium: proposal to introduce e-reporting of invoicing data from 2028 » (22/07/2026) — https://kpmg.com/us/en/taxnewsflash/news/2026/07/tnf-belgium-proposal-to-introduce-e-reporting-of-invoicing-data-from-2028.html ; EY (31/07/2026) — https://globaltaxnews.ey.com/news/2026-1652-belgium-announces-proposed-e-reporting-requirements-beginning-in-2028
- [P10] ITAA, « E-reporting dès 2028 : 6 points » (29/05/2026) — https://www.blogitaa.be/fr/2026/05/29/e-reporting-des-2028-6-points-pour-preparer-votre-cabinet-et-vos-clients/ ; Fiscal Requirements (21/09/2026) — https://www.fiscal-requirements.com/news/5985-belgium-e-reporting-near-real-time-b2b-reporting-proposed-for-2028
- [P11] OpenPeppol, forum des prestataires belges (contrôles n° TVA, ISO 27001 au 01/10/2027, plénière 08/09/2026) — https://openpeppol.atlassian.net/wiki/spaces/Belgium/pages/1111883917
- [P12] efacture.belgium.be, « Incitants fiscaux » (10/10/2024) ; circulaire 2026/C/46 du 19/03/2026 via Forum for the Future — https://efacture.belgium.be/fr/article/incitants-fiscaux-ladoption-de-la-facturation-electronique ; https://blog.forumforthefuture.be/fr/article/circulaire-2026c46-relative-a-la-deduction-de-frais-majoree-pour-les-depenses-de-facturation-electronique/30758
- [P13] OpenPeppol, Peppol BIS Billing 3.0, règles (v3.0.21, mai 2026) — https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/ ; https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
- [P14] BEG (SPF), scénario 9 « Régimes TVA particuliers et Tax Category Codes en Belgique » (25/02/2026) — https://efacture.belgium.be/sites/default/files/uploads/e-facturation-scenario-9.pdf ; scénario 1 « Minimal invoice » (2025) — https://einvoice.belgium.be/sites/default/files/Scenario_1_Minimal%20invoice-2025.docx ; liste BEG — https://einvoice.belgium.be/en/article/business-expert-group-overview
- [P15] econnect, « Belgian VAT » (n° BE1…) — https://econnect.eu/en/docs/knowledge/regulations/europe/belgium/belgian-vat ; goroute, « Belgium Peppol 0208 enterprise number » — https://goroute.ai/blog/belgium-peppol-0208-enterprise-number/
- [P16] einvoice.belgium.be, « How do I keep invoices received » (08/04/2026) — https://einvoice.belgium.be/en/article/how-do-i-keep-invoices-received-electronic-invoicing ; Larcier-Intersentia, « Archivage des factures électroniques » (10/02/2026) — https://www.larcier-intersentia.com/fr/archivage-factures-electroniques-belgique
- [P17] SPF Finances, « Liste annuelle des clients assujettis » — https://finances.belgium.be/fr/entreprises/tva/declaration/liste_annuelle_clients_assujettis
- [P18] Points d'accès alternatifs : Billit — https://www.billit.eu/fr-be/tarifs ; Banqup — https://www.banqup.com/fr-be/pricing ; Odoo — https://www.odoo.com/peppol-partena ; Octopus — https://www.octopus.be/nl/peppol ; e-invoice.be (09/09/2026) — https://e-invoice.be/blog/best-peppol-access-points ; Accountable (05/10/2026) — https://www.accountable.eu/fr-be/blog/logiciel-peppol-facturation/ ; Feen (15/06/2026) — https://www.feen.be/blog/peppol-ready-invoicing-tools-compared-2026

**Facture belge, TVA, comptabilité**
- [B1] SPF Finances, Arrêtés royaux TVA, textes consolidés au 31/03/2026 (AR n° 1 art. 1, 4, 5, 12, 13ter, 14, 15 ; AR n° 4 art. 4 ; AR n° 18 ; AR n° 23 ; AR n° 48 art. 3-4 ; AR n° 50 ; AR n° 53 art. 2, 3, 7, 8, 9) — copie https://www.ccnamur.be/Files/ar.pdf
- [B2] SPF Finances, Code de la TVA, coordination officieuse n° 58 (09/06/2024) : art. 8bis, 17, 39, 39bis, 53, 58 §4, 60 — copie https://wiki.noalyss.eu/lib/exe/fetch.php?media=code-tva-2024.pdf
- [B3] SPF Finances, « Régime d'imposition de la marge » — https://finance.belgium.be/en/node/1575 ; commentaire administratif art. 5 AR 1 (ancien) — https://www.fiscalis.be/web/content/11602
- [B4] Circulaire 2024/C/47 (moyens de transport neufs, 03/07/2024) via Forum for the Future — https://blog.forumforthefuture.be/fr/article/circulaire-2024c47-relative-au-regime-tva-applicable-aux-livraisons-et-acquisitions-intracommunautaires-des-moyens-de-transport-neufs/23599
- [B5] Traxio, FAQ « Vue sur votre garantie » (09/2026) — https://www.traxio.be/media/h4wco3on/faq-vue-sur-votre-garantie_09-26.pdf ; « Nouveau régime de garantie légale » — https://www.traxio.be/fr/articles/a-partir-du-1-juin-2022-nouveau-regime-de-garantie-legale-sur-les-biens-vendus-aux-particuliers ; BEHVA — https://www.behva.be/fr/garantie-sur-les-vehicules-doccasion/
- [B6] CNC, avis « Avances et acomptes facturés non encore reçus – compte 46 » — https://www.cnc-cbn.be/fr/avis/avances-et-acomptes-factures-non-encore-recus-compte-46 ; Wolters Kluwer Expert/M, « TVA réglementation sur la marge bénéficiaire » (24/08/2009) — https://123support.wolterskluwer.be/files/images/pdf/manual/TVA_marge_beneficiaire.pdf
- [B7] Intervat, aide cadre II (grille 00) — https://eservices.minfin.fgov.be/intervat/static/help/FR/cadre_ii_operations_a_la_sortie.htm ; DB Accounting, notice déclaration TVA (28/03/2025) — https://www.dbaccounting.be/post/d%C3%A9claration-tva-notice-explicative
- [B8] Retis, « Loi facturation électronique » (acceptation art. 53 §2) — https://www.retis.be/publications/reglementations/loi-facturation-electronique/
- [B9] OECCBB, circulaire 2026/C/43 (18/03/2026, loi du 10/02/2026) — https://blog.oeccbb.be/fr/article/circulaire-2026c43-relative-aux-modifications-apportees-par-la-loi-du-10.02.2026-portant-des-dispositions-diverses-en-matiere-de-taxe-sur-la-valeur-ajoutee/30752
- [B10] IRE, note sur la loi du 18/12/2025 (délais de conservation, 26/02/2026) — https://www.ibr-ire.be/fr/actualites/news-detail/loi-portant-des-dispositions-diverses-du-18-12-2025-note-de-synth-se-sur-l-impact-pour-les-associations-et-fondations ; RSM Belgium, délais de conservation TVA — https://www.rsm.global/belgium/fr/insights/mise-jour-concernant-les-delais-de-conservation-des-documents-tva-et-les-delais-de-prescription
- [B11] Langue : Adjoint du gouverneur, « Langue de la facture » — https://www.adjunctvandegouverneur.be/fr/information/la-legislation-linguistique-et-les-entreprises/langue-de-la-facture ; Grant Thornton (29/11/2018) — https://www.grantthornton.be/fr/the-field/articles/votre-facture-dans-quelle-langue/
- [B12] SPW Finances, TMC moto — https://finances.wallonie.be/home/fiscalite/fiscalite-des-vehicules/moto.html ; Recytyre — https://www.recytyre.be/fr/membres-recytyre-facturation-de-la-contribution-environnementale ; Bebat — https://help.bebat.be/en/mention-contribution-on-invoices
- [G8] Formats comptables : WinBooks, structure des fichiers ACT/CSF (Annex 2) — https://www.logidrive.com/media/faq/winbooks-structure-fichiers.pdf ; import Excel — https://help.winbooks.be/space/HelpWBC/5376756/L+import+de+fichiers+Excel ; Horus Office API `invoices.sales.new` — https://docs.horus-software.be/reference/invoices_sales_new.md ; Octopus import — https://login.octopus.be/manual/FR/import.htm ; Exact Online `SalesInvoices` — https://start.exactonline.be/docs/HlpRestAPIResourcesDetails.aspx?name=SalesInvoiceSalesInvoices ; Yuki `SalesInvoices.xsd` — https://support.yuki.nl/en/support/solutions/articles/80000787298-sales-functional-description-of-fields-sales-invoices-xml ; Sage BOB 50, guide de récupération (2012) — https://plugandgo.be/wp-content/uploads/2014/04/Guide_technique_BOB50_R%C3%A9cup%C3%A9ration_des_autres_logiciels.pdf

**Mail**
- [M1] Microsoft Learn, « Attach large files to Outlook messages » (3 Mo en un POST, 3–150 Mo par session de téléversement, chunks de 4 Mo) — https://learn.microsoft.com/en-us/graph/outlook-large-attachments ; `attachment: createUploadSession` — https://learn.microsoft.com/en-us/graph/api/attachment-createuploadsession
- [M2] Microsoft Q&A, limites `sendMail` et 150 Mo / 5 min par boîte — https://learn.microsoft.com/en-us/answers/questions/1730503/when-sending-emails-using-microsoft-graph-api-what ; https://learn.microsoft.com/en-in/answers/questions/1824204/graph-api-user-sendmail-request-size-limit
- [M3] DKIM / DMARC Microsoft 365 : LazyAdmin, « Configure DKIM Office 365 » — https://lazyadmin.nl/office-365/configure-dkim-office-365/ ; EasyDMARC, « Microsoft 365 SPF and DKIM configuration » — https://easydmarc.com/blog/microsoft-365-spf-and-dkim-configuration-step-by-step/ ; relevés DNS `ducatibxl.be` du 03/11/2026 (`nslookup -type=txt`, `-type=mx`, `-type=cname selector1/2._domainkey`, `-type=txt _dmarc`, résolveurs 8.8.8.8 et 1.1.1.1)

**Références internes** : `CLAUDE.md` §2-3 et §5 (décision F-3), `docs/bible/modules/M06-ventes-caisse.md`, `M09-documents.md`, `M12-compta.md`, `docs/propositions/2026-11-caisse-shopify-ou-dms.md`, `docs/g8-fonctions-m0-m12-m13-compta-stats-params.md`, `src/modules/accounting/{ubl,api,sepa}.ts`, `src/modules/sales/{write-api,document-pdf,document-mail-api}.ts`, `supabase/functions/graph-send-email/index.ts`, migrations `20260610280000_m6_fix_sequences.sql`, `20260610400000_m12_accounting.sql`, `20260612130000_m12_entry_engine.sql`, `20260612300000_m12_vat_register_header.sql`.

**Incertitudes résiduelles** : réaction de Falco à un doublon de numéro et au régime marge (`E` + texte) ; durée de conservation TVA (7 ou 10 ans après la loi du 18/12/2025) ; base légale exacte du seuil 250 € du listing ; grille 46 ou liste AR 48 pour une moto neuve vendue à un particulier UE ; siège réel de NL INVEST ; codes TVA Winbooks « marge » du comptable ; contenu de l'AR d'exécution de l'e-reporting (2027).
