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
- **P-3** (30/07) : commande Excel = classeur Ducati Demo / Courtoisie / Showroom, **2 000 € par onglet**.
- Règles (spécification §1.3) : standard minimum 250 € HTVA ; urgente sans minimum, +10 % facturé au
  client, au plus une par jour et par société ; accident minimum 1 500 € HTVA sinon repasse en
  standard ; Excel minimum 2 000 € HTVA par onglet. **Réglables par société dans Paramètres.**

## 3. Lots (cartes ERP)

| # | Carte | Fait quand | État | Date |
|---|---|---|---|---|
| 1 | Règles des 4 types de commande réglables dans Paramètres | Les minimums, le supplément, le « une par jour » et le repli se règlent dans Paramètres → Tables ; le serveur refuse une validation hors règle avec un message clair ; la règle est rappelée sur l'écran de la commande | 🟦 à valider | 19/09 |
| 2 | Ajouter et modifier les pièces d'une commande | On ajoute, modifie, supprime des lignes (article, qté client / magasin, fournisseur, prix) tant que la commande est en brouillon | 🟦 à valider | 19/09 |
| 3 | Créer une commande depuis un devis ou une facture | Bouton « Proposition de commande » ligne / totale sur un document de vente, avec choix du type | ⬜ à faire | — |
| 4 | Regrouper par fournisseur et envoyer | Écran « Rappel proposition » groupé par fournisseur avec minimum / franco, génération de la commande fournisseur | ⬜ à faire | — |
| 5 | Suivre l'état d'une commande : en attente de paiement, payée, à envoyer, envoyée | Transitions par boutons, contrôlées par le serveur, historique (qui, quand) ; liste filtrable par état et par type avec compteurs | 🟦 à valider | 19/09 |
| 6 | Envoyer au client le document de réservation PDF | PDF de réservation généré et envoyé par mail au client | ⬜ à faire | — |
| 7 | Commande Excel Ducati : alerte 2 000 €, clôture, archivage | Saisie enregistrée en base, alerte verte dans la barre du haut, n° interne au 1er téléchargement, clôture et archivage du classeur | ⬜ à faire (écran brouillon en mémoire existant) | — |
| 8 | Frais atelier sur devis | Accident 125 € fixe, diagnostic au taux horaire (max 4 h) ajoutés automatiquement, réglables | ⬜ à faire | — |
| 9 | Paiement par QR code (attend IBAN/BIC) | QR de virement SEPA sur le 2e écran du comptoir | 🟡 attend l'IBAN et le BIC du client | — |
| 10 | Questions à trancher | Réponses du client consignées ici et dans `../decisions.md` | ⬜ à poser | — |

## 4. Questions en attente

1. **Autres types de commande** au-delà des quatre (spécification D3) ? *Recommandation* : rien à
   coder, la liste est extensible (une valeur d'énum + une ligne dans Paramètres).
2. **Urgente « une par jour »** : compter les commandes **validées** dans la journée (choix actuel) ou
   **envoyées** au fournisseur ? *Recommandation* : validées, c'est le moment où le client s'engage.
3. **Qui peut annuler une commande déjà payée** ? Choix actuel : administrateur ou comptable
   (remboursement à prévoir). *À confirmer.*
4. **Signature électronique** : simple signature horodatée ou prestataire à valeur légale (eIDAS) ?
5. **IBAN / BIC** de la concession pour le QR de virement, **modèle du terminal Bancontact**.
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
