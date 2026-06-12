# Formats de migration G8 (dossier `Info DB`) — spec d'adaptation

> Analyse des exports réels du client (12/06/2026) pour la reprise go-live. **On adapte
> l'app aux documents** (champs, formats), pas l'inverse. Champs ajoutés : migration
> `20260612270000_m14_g8_legacy_fields.sql`. Encodage source = **Windows-1252**, dates =
> **numéros de série Excel** (epoch 1899-12-30). Parsing xlsx : zip + XML (openpyxl casse
> sur l'attribut malformé `biltinId` des styles G8).

## Inventaire `Info DB/`
- **717 `FACTURE 26xxxxxx.pdf`** = layout de facture attendu (cf. §5) + pièces GED.
- **Export FOURNISSEURS 12.6.26.xlsx** — 101 fournisseurs.
- **Export PARC VEHICULES 12.6.26.xlsx** — 3 341 véhicules.
- **Export Facture Antérieur.xlsx** — 15 452 factures ; **Export Facture Courant.xlsx** — 2 356.
- **Liste des clients … .xlsx** — ⚠️ **VIDE** (en-tête seul, 0 ligne) → **ré-export requis**.

## ⚠️ Décisions client à valider (bloquent les imports)
1. **`company_id` des factures** : absent des exports. Toutes = **ITALBIKE STORE** ? Existe-t-il une série **NL INVEST** ?
2. **Ré-export clients** avec données (le fichier fourni est vide). Colonnes en plus vues : Identification TVA, À Surveiller, Bloqué.
3. **Colonne `Dou`** (clients) : sémantique inconnue (douanier ? douteux ?). Stockée brute (`contacts.dou`).
4. **État `RÉPARÉ`** (73% des véhicules) : pas un statut de parc → mapper `vendu`/`livre` selon présence de « Vendu le » (état brut conservé dans `vehicles.legacy_state`).
5. **Lignes de détail factures** : non présentes dans l'export (en-tête seul) → factures historiques **sans lignes** (PDF en GED). Confirmer si un export détaillé est possible.

## 1. CLIENTS → `contacts` (33 colonnes)
Mapping : Code→`legacy_code`, Statut→`type`+statut, Civilité→`civility`, Nom→`last_name`/`company_name`,
Prénom→`first_name`, N° de rue→`street_number`, Rue→`address`, Compléments→`address_complement`/`(2)`,
Boîte postale→`po_box`, CP→`zip`, Ville→`city`, Pays→`country`(ISO-2), Téléphone→`phone`, Portable→`mobile`,
Tél/Portable/E-mail pro→`phone_pro`/`mobile_pro`/`email_pro`, E-mail→`email`, Tarif→`price_list`,
Catégorie→`category`, Conditions→`payment_terms`, Création→`created_at`, Naissance→`birth_date`,
Solde→`opening_balance`, Compte comptable→`account_code`, Dou→`dou`, Véhicule→(M3 lien VIN),
Adresse livraison→`delivery_address`, N.P.A.I.→`address_mismatch`, Identification TVA→`vat_number`,
À Surveiller→`is_watch`, Bloqué→`is_blocked`.

## 2. FOURNISSEURS → `contacts` (type='fournisseur')
Code→`legacy_code`, Raison sociale→`company_name`, Ville/Pays/CP→`city`/`country`/`zip`,
Téléphone/Téléphone 2→`phone`/`mobile`, Email→`email`, Télécopie→`fax`, Contact→`contact_name`,
Compte comptable→`account_code` **(filtrer : si commence par 2 lettres = TVA → `vat_number`)**,
Franco de Port→`supplier_franco_min`, Mini cmd M/Q→`supplier_order_min`/`_qty`, N° client achat→`supplier_customer_no`.
Pays multilingues (BELGIQUE/BELGIUM, ITALIE/ITALY…) → table ISO-2. Compte G8 racine **401** (longueurs 4–8).

## 3. PARC VÉHICULES → `vehicles` (col 0 vide, index décalé)
Référence→`reference`, Etat→`status`(+`legacy_state`), Modèle→`model`, Marque→`brand`, Châssis→`vin`
(neutraliser bidon `0000…`/`1111…`), Marquage→`marking`, Entrée le→`entry_date`, N° Facture achat→
`purchase_invoice_number`, Vendu le→`sold_date`, 1ere M.C.→`first_registration_date`, Couleur→`color`,
Immatriculation→`plate`, N° de clef→`key_number`, N° livre de police→`police_book_number`,
Commentaires→`notes`, Cylindrée→`displacement` (extraire chiffres : `821CC`→821, `DEMO`→null),
Code Expo→`exposition_code`, Expo→(doublon, ignorer), QR MyMeca→`mymeca_qr` (vide partout).
**Etat→status** : EN STOCK→`stock_vo` · RÉSERVÉ→`reserve` · VÉHICULE DE PRÊT→`courtoisie` ·
VENDU NEUF/D'OCCASION→`vendu` · VENDU EN DÉPÔT→`depot_vente` · RÉPARÉ→`vendu`/`livre` (cf. décision 4).
Enum réel : `en_commande, stock_vn, stock_vo, depot_vente, reserve, vendu, livre, courtoisie, demo, depot_agent, repris`.

## 4. FACTURES (17 808) → `documents` (+ `document_payments`)
N° Facture→`number`+`legacy_number` (format moderne `YYNNNNNN`), Code client→`code_client_legacy`
(+ résolution `contact_id` via `contacts.legacy_code`), Opérateur→`operator`, Date→`issue_date`,
Montant HT/TTC/TVA→`total_*`, Acompte→`paid_amount`, **Montant Du**→pilote `status` (≈0→`payee`, >0→`validee`),
TTC<0→`doc_type='AVO'`, Marge/%→`marge`/`marge_pct`, Règlements→`document_payments` (mapping modes ci-dessous),
Remise « x,xx € TTC »→`remise_ttc` (parser virgule), Condition→`condition_reglement`,
Compta=Transféré→`compta_transferred`, Date transfert→`date_transfert`. `imported_from='G8'`.
**Lignes de détail indisponibles** (en-tête seul).
Modes règlement : ESPECES/CASH→ESP · VIREMENT→VIR · VISA/MASTERC/MAESTRO→CB · PAYPAL→PAYPAL ·
CHEQUE CADEAU→CADEAU · Multiples→MULTI · COMPENSE AVOIR/FACT N°…→COMPENSATION (réf en note).
Idempotence import : `on conflict (company_id, legacy_number)`.

## 5. Layout FACTURE attendu (FACTURE 26xxxxxx.pdf) — adaptation `print-document.ts`
- **En-tête gauche** : logo Ducati Bruxelles + logo Scrambler ; « Chaussée de Bruxelles 688, 1410 Waterloo » ;
  « +32 (0) 2 385 32 82 | info@ducatibxl.be » ; « www.ducatibruxelles.be » ; « ITALBIKE STORE S.A. — TVA : BE 0472.540.151 — IBAN : BE13 1030 5292 0339 ».
- **En-tête droite** : bloc client encadré (raison sociale, adresse, Tél, Identification T.V.A.) + **code-barres Code128** du n° de facture.
- **Bandeau** (encadré, colonnes) : `FACTURE <n°>` | DATE | HEURE | N° CLIENT | CONDITION ACCORDÉE | ÉCHÉANCE | OPERATEUR | PAGE x/y.
- **Lignes** : REFERENCE | DESIGNATION | QUANTITE | P.U. HT | P.U. TTC | REM. % | MONTANT TTC | TVA.
  Ligne de filiation « RESERVATION N°… DU … ». Pour un véhicule (V/O/P) : **bloc détail 3 colonnes** sous la ligne
  (N° série, Modèle, Kilométrage, Norme antipollution, Nb cylindres, Année modèle, Etat, N° plaque, Cylindrée,
  Couleur, Mise en circulation, Origine, Marque, N° moteur, Puissance CV, Catégorie, Fin Garantie).
- **Texte libre configurable** (marketing, instructions de virement, financement) — par société.
- **Bas page 1** : `SOUS TOTAL TTC`. **Suite page 2 =>**.
- **Page 2** : RESERVE DE PROPRIETE (texte légal) ; **encadré totaux** BRUT T.T.C. / NET H.T. / TOTAL T.V.A. /
  NET T.T.C. / **RESTE A PAYER** ; **liste des règlements & acomptes datés** (date + mode + montant) ;
  « MERCI A BIENTOT » ; notice IBAN ; CGV + mention « lu et approuvé » + signature ;
  **mention TVA marge** (« Livraison soumise au régime particulier - Biens d'occasion - … art.5, 10° ter AR n°1 »).
