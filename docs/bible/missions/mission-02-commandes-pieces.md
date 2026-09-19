---
mission: 02
titre: Commandes de pièces
etat: 🟦
ouverte_le: 2026-09-19
modules: [M04, M05, M06]
---

# Mission 02 — Commandes de pièces

> **Objectif** : passer une commande de pièces pour un client selon quatre types (urgente, standard,
> accident, Excel) aux règles réglables, la suivre du paiement à l'envoi au fournisseur, et prévenir
> le client avec un document de réservation.

Liste ERP : « Mission 02 » (mission Updates, client Ducati Waterloo).

## 1. Le besoin

Spécification client du 30/07/2026 : [`../../process-commandes-pieces.md`](../../process-commandes-pieces.md)
(§0 types, §1.3 seuils, §1.4 validation du devis, §1.5 cycle de vie, §1.6 commande Excel).
Une commande = une **réservation de pièces**, validée selon **4 types**, comparée au stock. Le
classement G8 Stock / Dépannage / Garantie est abandonné.

## 2. Décisions

- **M-5** (19/09) : mission validée par Simon sur la base de la spécification du 30/07 et des cartes ERP.
- **P-1** (30/07) : classement `urgente / standard / excel / accident`, **extensible**.
- **P-2** (30/07) : paiement comptoir = QR Stripe + terminal Bancontact + QR de virement SEPA (IBAN et terminal à fournir).
  **Étape 1 faite le 19/09** : QR de virement SEPA (IBAN d'ITALBIKE STORE déjà en base, BIC vide : facultatif).
  À venir : QR Stripe (+5 %) → **clé Stripe de production** ; terminal Bancontact → **marque et modèle du terminal**
  (détail dans [`../decisions.md`](../decisions.md), P-2).
- **P-3** (30/07) : commande Excel = classeur Ducati Demo / Courtoisie / Showroom, **2 000 € par onglet**.
- Règles (spécification §1.3) : standard minimum 250 € HTVA ; urgente sans minimum, +10 % facturé au
  client, au plus une par jour et par société ; accident minimum 1 500 € HTVA sinon repasse en
  standard ; Excel minimum 2 000 € HTVA par onglet. **Réglables par société dans Paramètres.**

## 3. Lots (cartes ERP)

| # | Carte | Fait quand | État | Date |
|---|---|---|---|---|
| 1 | Règles des 4 types de commande réglables dans Paramètres | Les minimums, le supplément, le « une par jour » et le repli se règlent dans Paramètres → Tables ; le serveur refuse une validation hors règle avec un message clair ; la règle est rappelée sur l'écran de la commande | 🟦 à valider | 19/09 |
| 2 | Ajouter et modifier les pièces d'une commande | On ajoute, modifie, supprime des lignes (article, qté client / magasin, fournisseur, prix) tant que la commande est en brouillon | 🟦 à valider | 19/09 |
| 3 | Créer une commande depuis un devis ou une facture | Bouton « Proposition de commande » ligne / totale sur un document de vente, avec choix du type | 🟦 à valider | 19/09 |
| 4 | Regrouper par fournisseur et envoyer | Écran « Rappel proposition » groupé par fournisseur avec minimum / franco, génération de la commande fournisseur | ⬜ à faire | — |
| 5 | Suivre l'état d'une commande : en attente de paiement, payée, à envoyer, envoyée | Transitions par boutons, contrôlées par le serveur, historique (qui, quand) ; liste filtrable par état et par type avec compteurs | 🟦 à valider | 19/09 |
| 6 | Envoyer au client le document de réservation PDF | PDF de réservation généré et envoyé par mail au client | 🟦 à valider (toutes les lignes, voir §5) | 19/09 |
| 7 | Commande Excel Ducati : alerte 2 000 €, clôture, archivage | Saisie enregistrée en base, alerte verte dans la barre du haut, n° interne au 1er téléchargement, clôture et archivage du classeur | ⬜ à faire (écran brouillon en mémoire existant) | — |
| 8 | Frais atelier sur devis | Accident 125 € fixe, diagnostic au taux horaire (max 4 h) ajoutés automatiquement, réglables | ⬜ à faire | — |
| 9 | Paiement par QR code sur un 2e écran au comptoir | QR de virement SEPA sur le 2e écran du comptoir | 🟦 à valider (étape 1 : QR de virement ; Stripe et Bancontact à venir, voir §2) | 19/09 |
| 10 | Questions à trancher | Réponses du client consignées ici et dans `../decisions.md` | ⬜ à poser | — |

## 4. Questions en attente

1. **Autres types de commande** au-delà des quatre (spécification D3) ? *Recommandation* : rien à
   coder, la liste est extensible (une valeur d'énum + une ligne dans Paramètres).
2. **Urgente « une par jour »** : compter les commandes **validées** dans la journée (choix actuel) ou
   **envoyées** au fournisseur ? *Recommandation* : validées, c'est le moment où le client s'engage.
3. **Qui peut annuler une commande déjà payée** ? Choix actuel : administrateur ou comptable
   (remboursement à prévoir). *À confirmer.*
4. **Signature électronique** : simple signature horodatée ou prestataire à valeur légale (eIDAS) ?
5. ~~IBAN / BIC~~ (IBAN en base, BIC facultatif ; carte 9 faite). Reste : **modèle du terminal Bancontact**
   et **clé Stripe de production** (QR Stripe +5 %).
8. **Communication du QR de virement** (carte 9) : structurée belge par défaut (dérivée du n° du document),
   ou libre au choix du vendeur. *À confirmer* : le comptable veut-il une autre règle (ex. n° de client) ?
6. **Prix proposé sur une ligne** (carte 2) : le PV HTVA de la fiche article, modifiable ligne par
   ligne. *Recommandation* : garder le prix de vente client, puisque le minimum et le supplément
   urgente se calculent sur ce que paie le client. Le prix d'achat servira au regroupement par
   fournisseur (carte 4). *À confirmer.*
7. **« En commande » dans le disponible** (carte 2) : compté aujourd'hui sur les commandes
   fournisseur (CMD) validées sans réception reçue liée, pas sur les commandes de pièces (elles le
   seront quand elles deviendront des commandes fournisseur, carte 4). *À confirmer.*
   **Mis à jour le 19/09 (mission 05, carte 7)** : les commandes de pièces validées comptent
   désormais : leur quantité magasin pour tout le monde (tant qu'elle n'est pas associée à un client),
   leur quantité client pour ce client seulement. Carte 4 : exclure les pièces transformées en CMD.

## 5. Ce qui a changé dans l'application

- [M04 Achats](../modules/M04-achats.md) : règles des types dans Paramètres → Tables → « Règles des
  types de commande », fonctions `part_order_rules` / `part_order_check_rules` / `part_order_validate`,
  rappel des règles et contrôle en direct sur l'écran de la commande, bouton « Valider la commande »,
  n° `CDP-`. Migration `20260919210000_orders_rules`.
- [M04 Achats](../modules/M04-achats.md) : cycle de vie brouillon → en attente de paiement → payée →
  à envoyer → envoyée (+ annulée) par `part_order_transition` uniquement (garde sur la table),
  historique `part_order_status_history` + `events`, boutons d'état et historique sur l'écran de la
  commande, liste filtrable par type et par état avec compteurs. Migration `20260919211000_orders_status_flow`.
- [M04 Achats](../modules/M04-achats.md) : **pièces d'une commande** (carte 2) sur l'écran de la
  commande en brouillon : recherche d'article par référence, désignation, réf. fournisseur ou
  code-barres (Entrée après un scan ajoute l'article trouvé), avec casier et **disponible** (réel −
  réservé + en commande, détail en infobulle) ; saisie de la quantité client, de la quantité magasin,
  du fournisseur (fournisseur principal de l'article proposé) et du prix HTVA (PV HTVA de l'article
  proposé) ; modification et suppression (avec confirmation) ; totaux HTVA, TVA, TVAC ; **rappel du
  seuil du type en direct** (minimum, reste à commander, bascule accident → standard, supplément) qui
  tient compte de la pièce en cours de saisie. Pièces figées dès la validation (serveur). Chaque
  ajout, modification, suppression écrit une trace dans `events`. Aucun mouvement de stock.
  Fonctions `part_order_article_search`, `part_order_lines_detail`, `part_order_line_save`,
  `part_order_line_delete`, trigger `part_order_lines_guard`. Migration `20260919250000_orders_lines`.

- [M06 Ventes](../modules/M06-ventes-caisse.md) / [M09 Documents](../modules/M09-documents.md) :
  **document de réservation en PDF envoyé par mail** (carte 6, livrée avec la carte 8 de la
  [mission 05](mission-05-devis-preparation.md)). Sur une réservation (RES) : « Aperçu PDF » et
  « Envoyer par e-mail » (objet et message propres à la réservation de pièces, PDF joint, boîte au
  choix, pied de mail conservé) ; le PDF est rangé en GED du client et de la réservation, l'envoi est
  tracé dans `events`. **Manque** : la sélection des pièces cochées / décochées de la spécification
  §1.4 n'est **pas modélisée** (aucune colonne de sélection sur les lignes, et la commande de pièces
  n'est pas encore reliée à la réservation, `source_document_id` jamais rempli) : **toutes les lignes**
  de la réservation figurent dans le PDF, ce que la fenêtre d'envoi rappelle. À faire avec la carte 3
  (« Créer une commande depuis un devis ») : choisir les lignes, les enregistrer, puis ne mettre qu'elles
  dans le PDF.

- [M06 Ventes](../modules/M06-ventes-caisse.md) : **paiement par QR de virement SEPA sur le 2e écran**
  (carte 9, étape 1 de P-2). Sur un document de vente validé : bloc « Paiement par QR (virement) » →
  « Payer par QR (virement) » → montant (reste à payer / acompte 10 % / montant libre) et communication
  (structurée belge `+++…+++` calculée modulo 97 depuis le n° du document, ou texte libre « n° + nom ») avec
  aperçu du QR → règlement **attendu** « Virement QR » + affichage sur l'**écran client** `/ecran-client`
  (fenêtre ouverte par le vendeur, session équipe, plein écran, Realtime) : QR en très grand, montant,
  bénéficiaire, IBAN, communication, nom du client. « Paiement reçu » → règlement reçu (date, qui), trace
  `events`, reste à payer à jour, l'écran dit « Merci, paiement reçu » puis revient à l'accueil. QR au
  format EPC069-12 v002 (librairie `qrcode`). Fonctions `qr_payment_start` / `qr_payment_confirm` /
  `qr_payment_cancel` / `counter_display_show` / `counter_display_current`, table `counter_displays`.
  Migration `20260919360000_m6_qr_virement_ecran_client`. Aucun flux bancaire : la réception est confirmée
  à la main. Stripe (+5 %) et Bancontact : pas faits (voir §2).

### À tester (carte 9)

1. Ventes → un document validé (devis, réservation ou facture) avec un client et un reste à payer →
   bloc « Paiement par QR (virement) » → **Ouvrir l'écran client** : une fenêtre s'ouvre (accueil au nom de
   la société) ; la glisser sur le 2e écran, bouton plein écran en bas à droite.
2. **Payer par QR (virement)** → choisir « Acompte 10 % » puis « Montant libre », vérifier l'aperçu ;
   **Afficher sur l'écran client** : l'écran montre le QR en grand, le montant, ITALBIKE STORE, l'IBAN et la
   communication `+++…+++`. **Scanner le QR avec une appli bancaire SANS valider le virement** :
   bénéficiaire, IBAN, montant et communication doivent être pré-remplis, puis annuler dans l'appli.
3. Sur le document : **Paiement reçu** → confirmer : l'écran client affiche « Merci, paiement reçu » puis
   revient à l'accueil ; le règlement passe à « Reçu », le reste à payer baisse. Tester aussi
   **Abandonner** sur un autre QR (le règlement attendu disparaît, l'écran revient à l'accueil).
- [M04 Achats](../modules/M04-achats.md) / [M06 Ventes](../modules/M06-ventes-caisse.md) : **créer une commande
  de pièces depuis un document de vente** (carte 3, parité G8 « Mise en proposition de commande »). Sur la
  fiche d'un devis / proforma, bon de commande, réservation, BL ou facture (validé, ni annulé ni converti) :
  bouton **« Commander les pièces »** (tout le document) et icône panier sur une ligne « À commander » (cette
  pièce seulement). La fenêtre ne propose que les **pièces manquantes pour le client du document** : besoin −
  libre (réel − réservé, en rendant au document ce qu'il a lui-même réservé ou sorti) − « en commande » pour
  ce client (calcul unique `article_on_order_for`, mission 05 carte 7) − ce qui est déjà lancé en brouillon
  pour ce client ou ce document. Pièces seulement (types A et N) : motos, non stockés, texte et main-d'œuvre
  exclus. On coche les pièces, on choisit le **type** (règles de Paramètres affichées + **seuil en direct**) et
  le canal ; **qté client** = manquant par défaut, **qté magasin** = 0, **fournisseur principal** proposé
  (modifiable), **prix HTVA net du document** (modifiable). La commande est créée **en brouillon**, liée au
  **client**, à la **moto** du document et au **document** (`part_orders.source_document_id`, enfin rempli),
  puis s'ouvre ; ses pièces passent par `part_order_line_save` (contrôles, trace `events`) et la création
  écrit un `events` `part_order_from_document` sur le document et sur la commande. **Lien dans les deux
  sens** : bloc « Commandes de pièces liées » sur la fiche du document (y compris celles passées depuis le
  document d'origine, DEV → BC → RES) ; bloc « Document / Client / Moto » en tête de l'écran de la commande.
  Fonctions `document_order_needs`, `part_order_create_from_document`, `document_part_orders` (internes
  `_document_order_needs`, `_document_chain`). Migration `20260919350000_m4_commande_depuis_document`
  (appliquée le 19/09 après test en transaction annulée). Code : `src/modules/orders/from-document.ts`,
  `order-from-document-dialog.tsx`, `document-orders-panel.tsx`, `order-origin.tsx`,
  `src/routes/_app.sales.$documentId.tsx`, `_app.orders.$orderId.tsx` ; test `tests/orders-from-document.test.ts`.
  Le choix des lignes n'alimente pas encore le PDF de réservation (carte 6) : toutes les lignes y restent.

### À tester (carte 3)

1. Ventes → un devis / proforma validé, avec un client et une pièce sans stock → bandeau « X pièce(s)
   manquante(s) » → **Commander les pièces** : seules les pièces manquantes sont listées (quantité client =
   manquant, magasin 0, fournisseur principal).
2. Choisir le type (ex. Accident) : le bloc « Seuil du type — en direct » change ; décocher une pièce ou
   changer une quantité : le total bouge. **Créer la commande** : l'écran de la commande s'ouvre, en tête
   « Document / Client / Moto » cliquables.
3. Revenir sur le devis : « Commandes de pièces liées » montre la commande ; le bandeau « manquante » a
   disparu (pièces lancées en brouillon).

### À tester (carte 6)

1. Ventes → une réservation (RES) avec un client → **Aperçu PDF** : lignes, acompte, reste à payer,
   case signature.
2. **Envoyer par e-mail** → destinataire = votre adresse → **Vérifier sans envoyer**, puis **Envoyer** :
   objet « Réservation de vos pièces … », PDF joint.
3. Fiche du client → GED → « Documents de vente » : le PDF de la réservation y est.

### À tester (cartes 1 et 5)

1. Paramètres → Tables → « Règles des types de commande » : les 4 lignes et leurs valeurs ; changer
   le minimum standard (ex. 300), enregistrer.
2. Commandes de pièces → Nouvelle commande : les types affichent leur règle (valeurs de Paramètres).
3. Écran d'une commande : rappel des règles ; en brouillon sans pièce, message rouge « aucune pièce »
   et bouton Valider grisé (les lignes arriveront avec la carte 2).
4. Avec des lignes : Valider → n° `CDP-…`, état « En attente de paiement » ; Marquer payée (choisir le
   moyen) → Passer à envoyer → Marquer envoyée ; l'historique montre chaque passage, l'auteur et l'heure.
5. Liste : filtres Type et État combinés, compteurs qui se mettent à jour.

### À tester (carte 2)

1. Commandes de pièces → Nouvelle commande (type Accident) → dans l'écran de la commande, taper une
   référence, un bout de désignation ou scanner un code-barres : la liste montre casier, disponible
   et prix HTVA ; cliquer une pièce.
2. Saisir quantité client et quantité magasin, choisir le fournisseur, ajuster le prix : le total de
   la ligne et le bloc « Seuil du type — en direct » bougent pendant la frappe (sous 1 500 €, badge
   « Repasse en Standard » et ce qu'il manque). Ajouter la pièce.
3. Crayon : modifier une quantité ; corbeille : supprimer (confirmation). Totaux HTVA / TVA / TVAC à jour.
4. Valider la commande : les crayons et corbeilles disparaissent (« les pièces ne se modifient plus »).

## 6. Risques et points d'attention

- Le **disponible** compte « en commande » les commandes fournisseur (CMD) validées sans réception
  liée ; or l'écran Achats ne relie pas encore une réception à sa commande (`source_order_id`, voir
  M04 §7) : une CMD validée resterait « en commande » après sa réception. Aucune CMD en base au 19/09.
- Le stock disponible affiché n'est **pas réservé** par la commande de pièces (règle de la carte : le
  stock n'est jamais modifié ici). La réservation viendra avec le document de réservation (carte 6).
- Le total HT des règles = Σ (qté client + qté magasin) × PU HT : la part magasin compte dans le
  minimum fournisseur. À confirmer avec le client.
- `types.ts` n'est pas régénéré : le module `orders` passe par un client non typé (dette existante).
