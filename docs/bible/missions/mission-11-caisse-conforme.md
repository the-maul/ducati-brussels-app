---
mission: 11
titre: Caisse conforme — le comptoir encaisse dans les règles belges
etat: 🟦
ouverte_le: 2026-11-03
modules: [M06, M12, M00]
---

# Mission 11 — Caisse conforme

> **Objectif en une phrase** : le comptoir encaisse dans les règles belges et le comptable n'a plus
> de journal à tenir à côté.

Mission née du découpage de la synthèse
[`../../etudes/2026-11-synthese-caisse-facturation.md`](../../etudes/2026-11-synthese-caisse-facturation.md)
(cartes K1 à K22), **validé par Simon le 03/11/2026**. Sources : étude légale et marché
([`2026-11-caisse-legal-et-marche.md`](../../etudes/2026-11-caisse-legal-et-marche.md)), audit de la
caisse ([`2026-11-audit-caisse-dms.md`](../../etudes/2026-11-audit-caisse-dms.md)). Missions sœurs :
[12 Paiements au comptoir](mission-12-paiements-comptoir.md), [13 Facture belge et Peppol](mission-13-facture-peppol.md),
[14 Comptabilité et registres](mission-14-comptabilite-registres.md).

## 1. Le besoin

Simon, le 03/11/2026 : « La caisse, la facturation et la comptabilité, c'est un énorme morceau, sans
doute plusieurs missions. » Décisions du même jour : **garder la caisse dans le DMS** (pas Shopify POS),
« intègre déjà tout ce que tu peux sans validation ».

Le problème : la caisse du DMS encaissait, mais la loi belge demande plus qu'un encaissement. Un
ticket doit appartenir à une caisse ouverte ; le Z du soir doit être **numéroté et figé** (c'est le
journal des recettes) ; rien ne s'efface ; les espèces sont plafonnées à 3 000 € ; au-delà de 125 €
pour une pièce du véhicule, c'est une **facture**, pas un ticket. Sans cela, le comptable continue
de tenir un journal à part et un contrôle trouve des trous.

Cette mission couvre **la caisse elle-même** (ticket, session, Z, règles d'encaissement, confort du
comptoir). Les moyens de paiement et l'écran client sont dans la mission 12, la facture et Peppol dans
la mission 13, les exports comptables dans la mission 14.

## 2. Décisions

| Code | Décision | Source |
|---|---|---|
| M-83 | La caisse **reste dans le DMS** ; défauts francs de l'audit corrigés (ticket à 0 €, arrondi 5 c, une seule session…) ; verrous en base à appliquer après backup | Simon · 03/11 ([decisions](../decisions.md), M-83 « audit caisse ») |
| Q14 | **Go** pour le backup puis la migration des verrous de caisse `20261103150000` ; backup Git fait (tag `backup-20261103-163423`) ; bloc de migrations à appliquer par Simon | Simon · 03/11 ([journal §7](../journal-2026-11-03.md)) |
| M-93 | Le **journal Z est le journal des recettes** : numéro continu par société (`Z-2026-00001`), figé à la clôture, jamais rouvert ; motif obligatoire si écart ; lignes > 500 € TTC à part ; PDF en GED, réimpression | Client · 03/11 |
| M-94 | **Pas d'encaissement caisse fermée** ; ticket et règlements rattachés à la session ouverte | Client · 03/11 |
| M-95 | **Espèces : 3 000 € au plus par vente**, acomptes compris, refus bloquant ; arrondi 5 c aussi sur le rendu et les remboursements | Loi · 03/11 |
| M-96 | **Un règlement ne se supprime jamais** : contre-passation motivée ; un ticket validé s'annule par un avoir lié, inscrit au Z | CDE III.86 · 03/11 |
| M-97 | **Facture obligatoire** pour une moto, et au-delà de 125 € TTC pour une pièce / un accessoire / une prestation du véhicule ; drapeau par famille d'article (liste à vérifier avec Domenico) | AR n° 1 art. 1er · 03/11 |
| M-98 | **Ticket par e-mail sans fiche client** : adresse saisie pour l'envoi seulement | AR 13/12/2022 · 03/11 |
| 03/11 soir | **Produit multi-clients, aucun matériel imposé** : chaque poste branche ses propres appareils (imprimante ticket, tiroir, étiquettes, douchette, écran client, terminal) | Simon · 03/11 ([decisions](../decisions.md), « 2026-11-03 (soir) ») |
| F-5 | Stock et prix jamais modifiés directement : mouvements append-only (même principe pour les règlements) | Fondations |

Recommandations de la synthèse **non encore tranchées** : mode hors ligne = non (K21) ; transaction
unique ticket + encaissement à faire avec la mission 08 (K18).

## 3. Cartes

État au 03/11/2026 (soir), vérifié avec `git log`. « Jours » = jours agence hors recette,
**estimé → reste**. « Fait » = code sur `main` ; **la migration du lot reste à appliquer** (bloc du
[journal §7](../journal-2026-11-03.md)) avant de pouvoir tester en production.

| # | Carte | Pourquoi | État | Jours | Décision requise | Dépend de |
|---|---|---|---|---|---|---|
| K1 | Appliquer la migration des verrous de caisse `20261103150000` (document validé, règlement d'une caisse clôturée, session clôturée figés ; Z corrigé) | légal | **en cours** — go + backup faits, bloc à appliquer par Simon | 0 → 0 | faite (Q14 = go) | — |
| K2 | Défauts francs de l'audit : ticket à 0 €, scan à résultat unique, ticket non réglé signalé, date locale, arrondi 5 c, avoir sur ticket, TVA par taux sur le ticket, une seule session | légal | **fait** (`af4df68`) | 0 → 0 | non (arrondi carte : non, D7) | — |
| K3 | Ticket → facture : moto, pièce / accessoire / travaux > 125 € TTC, client pro ; drapeau par famille ; client exigé au comptoir | légal | **fait** (`32c9f41`) | 1,5 → 0 | Domenico : liste des familles « du véhicule » ; ticket forcé avec motif (D1) ? | K1 |
| K4 | Plafond 3 000 € en espèces par document (acomptes cumulés), refus bloquant | légal | **fait** (`32c9f41`) | 0,5 → 0 | faite (bloquant, M-95) | — |
| K5 | Journal des recettes = Z : numéro continu, figé, ventilation par taux, remboursements, acomptes, lignes > 500 €, PDF en GED, réimpression, Caisse → Clôtures, export CSV jour / mois ; Z juste avec les avoirs | légal | **fait** (`32c9f41`, `d76de54`) | 3 → 0 | comptable : le Z du DMS remplace le journal papier (D2) | K1, K6 |
| K6 | Ticket et règlement rattachés à la session ; refus d'encaisser caisse fermée ; identifiant de caisse (`CAISSE-1`) | légal | **fait** (`32c9f41`) | 1,5 → 0 | Domenico : vendre sans session ouverte (virement, compte client) ? | K1 |
| K7 | Annuler un règlement par contre-passation motivée, jamais par suppression | légal | **fait** (`32c9f41`) | 1 → 0 | non | K1 |
| K8 | Ticket par e-mail sans fiche client | légal | **fait** (`32c9f41`) | 0,5 → 0 | non | — |
| K9 | Motif obligatoire d'un écart de caisse (fait) ; procès-verbal des numéros perdus FAC-2026-00002 à 00004 (à faire) | légal | **fait en partie** (`32c9f41`) | 0,5 → 0,25 | Domenico : note pour le PV | — |
| K10 | Alerte « OR ou BL terminé non facturé avant le 15 du mois suivant » | légal | à faire | 0,5 → 0,5 | non | — |
| K11 | Conservation 10 ans : export annuel figé (factures, tickets, Z, registres) + procédure écrite | légal | à faire | 0,5 → 0,5 | comptable : 7 ou 10 ans (reco : 10) | K5 |
| K12 | Ticket thermique 80 mm + ouverture du tiroir par l'imprimante, duplicata marqué — **par poste, sans matériel imposé** | attendu | **en cours** (lot « postes et périphériques ») | 2 → 2 | Domenico : ses appareils actuels (D11) ; plus de matériel imposé (03/11 soir) | K17 |
| K13 | « Vente détaillée » au comptoir : remise ligne / globale, prix modifié, client et création rapide, VIN sur la ligne, main-d'œuvre | attendu | à faire | 1,5 → 1,5 | non | — |
| K14 | Mettre un panier en attente / le reprendre | attendu | à faire | 1 → 1 | non | — |
| K15 | Retour / échange depuis le ticket d'origine (scan du TIK), remboursement sur le mode d'origine, inscrit au Z | attendu | à faire | 1 → 1 | non | K5, F4 |
| K16 | Droits fins de caisse (qui remise, annule, ouvre le tiroir, clôture) | attendu | à faire | 1 → 1 | **Domenico : qui fait quoi** | — |
| K17 | Une session par poste / tiroir (deux PC = deux caisses), poste = ses périphériques | attendu | **en cours** (lot « postes et périphériques ») | 2 → 2 | Domenico : combien de postes et de tiroirs ? | K6 |
| K18 | Une seule transaction pour créer le ticket et l'encaisser (une coupure ne laisse rien à moitié) | attendu | à faire | 2,5 → 2,5 | non (avec la mission 08) | — |
| K19 | Remise en banque : bordereau daté, report du fond | attendu | à faire | 1,5 → 1,5 | non | K5 |
| K20 | Rapports du jour par opérateur, par famille, marge du jour ; statistiques par rayon | attendu | à faire | 2 → 2 | non | K6 |
| K21 | Mode hors ligne | confort | **écarté** | (5 à 8) → 0 | reco : non (4G de secours + carnet manuel) | — |
| K22 | Coin café / événements payants → caisse certifiée | légal si payant | sans objet tant que le bar est gratuit | 0 → 0 | Domenico : le bar est-il gratuit ? (D9) | — |

**Bilan** : 24 jours estimés ; **8,25 livrés** (K2 à K8, K9 en partie) ; **reste 15,75 jours**, dont
4 en cours (K12, K17), **1,25 légaux** (K9 PV, K10, K11) et 10,5 attendus (K13 à K16, K18 à K20).
Ordre restant : K1 (application du bloc) → K10, K11, K9 → K17 puis K12 (postes) → K13, K14, K15, K18,
K16 → K19, K20.

## 4. Questions en attente

Les questions pour Domenico sont regroupées dans la page partagée le 03/11 **« Questions pour
Domenico : caisse, paiements, atelier »** ; celles du comptable dans la synthèse
([§4, tableau « Le comptable »](../../etudes/2026-11-synthese-caisse-facturation.md)), à envoyer dès que
Domenico donne son nom. Celles qui touchent cette mission :

1. **Simon — appliquer le bloc de migrations** dans l'ordre du journal §7 (150000 → 160000 → 170000 →
   180000 → 220000 → 190000 → 200000). *Reco : tout de suite ; sans lui, rien de cette mission n'est
   testable en production.*
2. **Domenico — familles « pièce / accessoire du véhicule »** pour la règle des 125 € (préchargement
   M-97 à relire) ; et **forcer un ticket avec motif** (D1) ? *Reco : facture imposée (nom + adresse
   suffisent), forçage motivé et tracé.*
3. **Domenico — combien de postes et de tiroirs**, et quels appareils sur chacun (imprimante, tiroir,
   douchette) ? *Reco : une caisse par tiroir ; on branche ce qu'il a, rien n'est imposé.*
4. **Domenico — qui remise, annule, ouvre le tiroir, clôture** (K16). *Reco : vendeur = remise plafonnée,
   chef = annulation et clôture.*
5. **Domenico — vendre sans caisse ouverte** (virement, compte client) ? *Reco : non au comptoir, oui
   depuis Ventes.*
6. **Domenico — note pour le PV des numéros FAC-2026-00002 à 00004** (K9) ; **le bar est-il gratuit ?** (K22).
7. **Comptable — le Z du DMS devient le journal des recettes officiel** (D2) ; **conservation 7 ou 10
   ans** (K11). *Reco : oui ; 10 ans.*

## 5. Ce qui a changé dans l'application

Tout est sur `main`. **À tester seulement après l'application du bloc de migrations** (question 1).
Chapitre : [M06 Ventes & caisse](../modules/M06-ventes-caisse.md), [M12 Compta](../modules/M12-compta.md).

| Lot | Ce qui change pour l'utilisateur | Commit | À tester |
|---|---|---|---|
| Audit de la caisse (PDV000) | Ticket à 0 € refusé ; Entrée n'ajoute plus un article au hasard ; « Nouvelle vente » prévient si le ticket n'est pas réglé ; ticket daté à l'heure belge ; **espèces arrondies à 5 cents** ; avoir possible depuis un ticket ; TVA par taux sur le ticket imprimé ; une seule caisse ouverte, clôture confirmée et définitive | `af4df68` (migration `20261103150000`) | Encaisser 12,32 € en espèces → 12,30 € ; faire un avoir sur un ticket ; tenter d'ouvrir une 2e caisse |
| Caisse conforme (PDV010) | **Z numéroté et figé** (Caisse → Clôtures, PDF, réimpression, CSV du mois) ; écart sans motif refusé ; ticket refusé caisse fermée (bandeau « Ouvrir la caisse ») ; **3 000 € d'espèces au plus** ; règlement annulé par contre-passation motivée ; **facture exigée** pour une moto ou une pièce du véhicule > 125 € ; ticket envoyé par mail sans fiche client | `32c9f41` (migration `20261103170000`) | Clôturer une caisse avec un écart sans motif (refus) puis avec motif ; lire le Z en PDF ; vendre 3 001 € en espèces (refus) ; vendre une pièce à 130 € sans client (refus) ; contre-passer un règlement |
| Z et avoirs (PDV011) | Un ticket remboursé par un avoir reste dans le Z et l'avoir le compense (CA net 0 €) ; le « réglé par avoir » n'apparaît plus comme un encaissement | `d76de54` (migration `20261103220000`) | Ticket 100 €, avoir total, clôture : CA net 0 €, aucune ligne « AVO » dans les encaissements |

## 6. Risques et points d'attention

- **Rien n'est testable en production tant que le bloc de migrations n'est pas appliqué** : le code
  sur `main` suppose les nouvelles colonnes (le dépôt et la base divergent). Ordre impératif : 150000
  avant 170000, 220000 après 180000.
- **Les Z déjà clôturés avant la migration ne sont pas renumérotés** : le premier Z numéroté sera
  celui de la première clôture après application.
- **Liste des familles > 125 €** préchargée par l'agence, non relue par Domenico : une famille mal
  classée laisse passer un ticket qui aurait dû être une facture (ou l'inverse).
- **Une seule caisse (`CAISSE-1`)** aujourd'hui : deux postes encaissant en même temps partagent la
  même session jusqu'à K17.
- **Matériel non imposé** (produit multi-clients) : l'impression 80 mm et le tiroir doivent marcher
  avec des appareils différents d'un client à l'autre ; prévoir un repli « impression navigateur ».
- Numéros M-81 à M-83 **en double** dans `decisions.md` (deux séries le 03/11) : citer la date et le
  sujet avec le numéro.
