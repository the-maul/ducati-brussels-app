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
| 2 | Ajouter et modifier les pièces d'une commande | On ajoute, modifie, supprime des lignes (article, qté client / magasin, fournisseur, prix) tant que la commande est en brouillon | ⬜ à faire | — |
| 3 | Créer une commande depuis un devis ou une facture | Bouton « Proposition de commande » ligne / totale sur un document de vente, avec choix du type | ⬜ à faire | — |
| 4 | Regrouper par fournisseur et envoyer | Écran « Rappel proposition » groupé par fournisseur avec minimum / franco, génération de la commande fournisseur | ⬜ à faire | — |
| 5 | Suivre l'état d'une commande : en attente de paiement, payée, à envoyer, envoyée | Transitions par boutons, contrôlées par le serveur, historique (qui, quand) ; liste filtrable par état et par type avec compteurs | ⬜ à faire | — |
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

## 5. Ce qui a changé dans l'application

- [M04 Achats](../modules/M04-achats.md) : règles des types dans Paramètres → Tables → « Règles des
  types de commande », fonctions `part_order_rules` / `part_order_check_rules` / `part_order_validate`,
  rappel des règles et contrôle en direct sur l'écran de la commande, bouton « Valider la commande »,
  n° `CDP-`. Migration `20260919210000_orders_rules`.

## 6. Risques et points d'attention

- Les lignes ne se saisissent pas encore à l'écran (carte 2) : pour tester la validation, il faut des
  lignes créées en base ou attendre la carte 2.
- Le total HT des règles = Σ (qté client + qté magasin) × PU HT : la part magasin compte dans le
  minimum fournisseur. À confirmer avec le client.
- `types.ts` n'est pas régénéré : le module `orders` passe par un client non typé (dette existante).
