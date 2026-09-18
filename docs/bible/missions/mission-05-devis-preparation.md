---
mission: 05
titre: Devis moto, options et préparation
etat: ⬜
ouverte_le: 2026-09-19
modules: [M06, M05, M02, M09, M04]
---

# Mission 05 — Devis moto, options et préparation

> **Objectif** : faire un proforma / devis complet (moto, accessoires, main d'œuvre, commentaires),
> l'envoyer au client, suivre acompte et solde, et préparer les pièces sur tablette.

Liste ERP : « Mission 05 — Devis moto, options et préparation » (`ab2f282c-e231-4e85-8600-fb6cff855265`).
Source : vidéo de Simon du 18/09 (proforma pour le client test « Moreau 2 Simon » dans G8). Transcription
locale : `C:\Users\simon\whisper-models\mission5.srt`.

## 1. Le besoin

Ce que montre la vidéo dans G8 :
- choix du type de document : proforma/devis, réservation, bon de commande, facture ;
- l'opérateur doit être l'utilisateur connecté, sans le choisir ;
- recherche d'article (ex. Scrambler 800 Icon Dark) avec la disponibilité en couleur ;
- repère « E » = référence remplacée ou équivalents : il faut prendre la dernière référence ;
- les accessoires sont cherchés sur e-catalog.ducati.com puis ressaisis ;
- ligne de main d'œuvre (MO atelier VIP 5,5 h), lignes vides, commentaires types rappelés
  (« premier entretien offert », avis de commande urgente avec l'IBAN de la société, acompte 10 %) ;
- la liste de préparation (picking) doit s'ouvrir en un clic depuis le document, sur tablette :
  disponible / commandé / préparé / monté, casier en stock, endroit où c'est préparé pour le client ;
- défaut G8 : du stock commandé pour un autre client se retrouve attribué ;
- aperçu avec textes, TVA et zone de signature, envoi par mail ;
- paiements et solde restant dû visibles ;
- règle : on lance la commande des pièces dès que l'acompte est accepté ; aucune facture ni solde
  ne doit rester impayé.

## 2. Décisions

Aucune encore. Les cartes marquées `a-confirmer` attendent une note de Simon.

## 3. Lots (cartes ERP)

| Carte | État |
|---|---|
| Créer un proforma, une réservation, un bon de commande ou une facture | ⬜ |
| Chercher un article et voir sa disponibilité en couleur | ⬜ |
| Référence remplacée : proposer automatiquement la dernière | ⬜ |
| Ajouter un accessoire trouvé dans l'e-catalog Ducati | ⬜ a-confirmer |
| Lignes de main d'œuvre, lignes vides et commentaires types | ⬜ |
| Liste de préparation en un clic, sur tablette | ⬜ |
| Ne pas attribuer le stock commandé pour un autre client | ⬜ |
| Aperçu du document et envoi par mail | ⬜ |
| Voir les paiements et le solde restant dû | ⬜ |
| Commander les pièces dès l'acompte et ne laisser aucun solde impayé | ⬜ a-confirmer |

## 4. Questions en attente

1. e-catalog Ducati : pas d'API connue. *Reco : coller la référence, le DMS la retrouve dans la librairie ou crée un article non stocké.*
2. Acompte « accepté » = payé ou seulement accordé ? *Reco : payé (au moins en partie).*
3. Qui reçoit l'alerte des soldes impayés ? *Reco : le vendeur du document + les admins.*

## 5. Ce qui a changé dans l'application

Rien encore. Liens avec la mission 02 (commandes de pièces : types, états, réservations) et avec
l'invariant B4 (disponible = réel − réservé + en commande, réservation **par client**).

## 6. Risques

- Le devis existe déjà en partie dans M06 : réutiliser, ne pas recréer un deuxième circuit.
- Numérotation par type et par société (CLAUDE.md §4.3) pour les nouveaux types de documents.
