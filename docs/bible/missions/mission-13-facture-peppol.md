---
mission: 13
titre: Facture belge et Peppol — chaque facture, acompte et avoir juste en droit belge, envoyé via Falco
etat: 🟦
ouverte_le: 2026-11-03
modules: [M06, M09, M12, M00, M01]
---

# Mission 13 — Facture belge et Peppol

> **Objectif en une phrase** : chaque facture, facture d'acompte et avoir est juste en droit belge et
> part tout seul sur Peppol via Falco.

Mission née du découpage de la synthèse
[`../../etudes/2026-11-synthese-caisse-facturation.md`](../../etudes/2026-11-synthese-caisse-facturation.md)
(cartes F1 à F13), **validé par Simon le 03/11/2026**. Source principale : étude facturation
([`2026-11-facturation-peppol-compta.md`](../../etudes/2026-11-facturation-peppol-compta.md)) ; aussi
l'étude légale ([`2026-11-caisse-legal-et-marche.md`](../../etudes/2026-11-caisse-legal-et-marche.md)).
Missions sœurs : [11 Caisse conforme](mission-11-caisse-conforme.md), [12 Paiements au comptoir](mission-12-paiements-comptoir.md),
[14 Comptabilité et registres](mission-14-comptabilite-registres.md).

## 1. Le besoin

Simon, le 03/11/2026 : « La caisse, la facturation et la comptabilité, c'est un énorme morceau… »,
avec pour cette partie : **intégrer Falco** (le point d'accès Peppol choisi) et la comptabilité.

Le problème : depuis le 01/01/2026, une facture entre entreprises belges **doit partir sur Peppol**
(amendes 1 500 / 3 000 / 5 000 €). La facture du DMS avait des trous : un avoir faisait **sortir la
facture d'origine du journal des ventes**, pas de facture d'acompte alors que la TVA est due dès
l'encaissement d'un acompte sur une moto, un fichier UBL incomplet, aucune liaison Falco, des
paramètres société manquants (n° BCE, identifiant Peppol).

## 2. Décisions

| Code | Décision | Source |
|---|---|---|
| M-99 | **Une facture compensée par un avoir reste au journal** (`avoir_emis`) ; avoir partiel ; référence + mention AR n° 4 ; l'avoir règle d'abord le dû | Client · 03/11 |
| M-100 | **Facture d'acompte `FAA-AAAA-NNNNN`** automatique pour une moto ou un client avec n° de TVA, sur demande sinon ; déduite de la facture finale ; rappel « avant le 15 » — **série et règle à confirmer par le comptable** | Client · 03/11 |
| M-101 | **Seuls les documents validés comptent** (brouillons et annulés hors journal, registre TVA, écritures) | Agence · 03/11 |
| M-102 | **UBL Peppol BIS 3.0** : n° BCE + identifiant `0208:` obligatoires sur la fiche société ; détaxe `G`, avoir `BillingReference`, acompte 386, `PrepaidAmount`, remises ; empreinte SHA-256 du PDF envoyé ; copie au comptable réglable (vide) | Agence · 03/11 |
| M-89 | TVA marge en UBL : catégorie `E` 0 % + texte (BEG 9) | Simon · 03/11 |
| 03/11 soir | **Une seule société, ITALBIKE STORE ; un seul compte Falco Expert.** NL INVEST retirée le 03/11, le modèle reste multi-société pour d'autres clients. | Simon · 03/11 ([decisions](../decisions.md), « 2026-11-03 (soir) ») |
| Proposition 03/11 | Falco (Horus Software, API sur plan Expert) branché au DMS par l'UBL | Agence · 03/11 |

## 3. Cartes

État au 03/11/2026 (soir), vérifié avec `git log`. « Jours » = jours agence hors recette,
**estimé → reste**. « Fait » = code sur `main` ; **la migration `20261103180000` reste à appliquer**
(bloc du [journal §7](../journal-2026-11-03.md)).

| # | Carte | Pourquoi | État | Jours | Décision requise | Dépend de |
|---|---|---|---|---|---|---|
| F1 | Fermer aux visiteurs non connectés (et vérifier les rôles) les fonctions comptables : journal, registre TVA, clôture, écritures, SEPA | légal (bloquant) | à faire (à revérifier après le lot S du 19/09) | 1 → 1 | non | — |
| F2 | Paramètres société complets (n° BCE, RPM, forme juridique, identifiant `0208:`, n° créancier SEPA, téléphone / e-mail) : **champs faits** ; reste les valeurs d'ITALBIKE STORE et le contrôle du n° BCE / TVA sur la fiche client | légal | **fait en partie** (`63c24be`) | 1 → 0,5 | **Domenico : identifiants d'ITALBIKE STORE** | — |
| F3 | **Facture d'acompte** automatique à l'encaissement (moto, client pro), déduite sur la facture finale | légal | **fait** (`63c24be`) | 2,5 → 0 | comptable : série `FAA-` confirmée ? règle pour un particulier hors moto ? | F5 |
| F4 | **Avoir propre** : référence imprimée, mention AR n° 4, avoir partiel, facture d'origine gardée au journal ; remboursement d'un ticket au Z | légal | **fait** (`63c24be`, Z : `d76de54`) | 2 → 0 | non | — |
| F5 | **UBL complété** pour Peppol : 0208, référence acheteur, catégories S / E / G / AE, référence de l'avoir, acompte déduit, remises — validé 5 / 5 au validateur Peppol | légal | **fait** (`63c24be`) | 1,5 → 0 | non | — |
| F6 | **Connecteur Falco** : envoi à la validation, client présent sur Peppol ?, statuts et rejets, renvoi, UBL archivé — **un compte, une clé** | légal | à faire | 4,5 → 4,5 | **Domenico : compte Falco Expert + clé API** ; Simon : application agence en bac à sable ; comptable : Horus ? | F2, F5 |
| F7 | Régimes de TVA choisis à la validation (normal, export, intracom pro `K`, moto neuve à un particulier UE, autoliquidation) avec la bonne mention ; puissance kW sur le bloc moto | légal | à faire | 1,5 → 1,5 | non | F5 |
| F8 | Mentions légales en français + traduction dans la langue du client | légal | **fait** (`63c24be`) | 0,5 → 0 | Domenico : la présentation lui convient ? | — |
| F9 | Mail de facture : empreinte du PDF dans la trace (**fait**) ; pièces jointes > 3 Mo, communication structurée (à faire) | attendu | **fait en partie** (`63c24be`) | 1 → 0,5 | non | — |
| F10 | Relances d'impayés par Outlook (au lieu de Resend absent) | attendu | à faire | 1 → 1 | Domenico : boîte `compta@`, délais J+7 / J+21 / J+45 | — |
| F11 | Signature des mails : DKIM + DMARC sur `ducatibxl.be` (absents) | attendu | à faire (côté client) | 0 → 0 (1 h chez Combell) | informaticien de Domenico | — |
| F12 | Détaxe : flux « remboursement après visa de la douane » | utile | à faire | 1 → 1 | non | F7 |
| F13 | Garantie légale sur le bon de commande, signature du BC ; contributions Recytyre / Bebat | légal | à faire | non chiffré (≈ 1) | non | — |

**Bilan** : 17,5 jours estimés (+ F13) ; **7,5 livrés** (F3, F4, F5, F8 ; F2 et F9 en partie) ;
**reste 10 jours** (+ ≈ 1 pour F13), dont **7,5 légaux** (F1, F2, F6, F7 ; + F13 à chiffrer), 1,5
attendus (F9, F10) et 1 utile (F12). Ordre : F1 → F2 (dès les identifiants) → F7 → F6 en bac à sable
puis en production → F9, F10 → F12, F13.

## 4. Questions en attente

Les questions pour Domenico sont dans la page partagée le 03/11 **« Questions pour Domenico : caisse,
paiements, atelier »** ; celles du comptable dans la synthèse
([§4, tableau « Le comptable »](../../etudes/2026-11-synthese-caisse-facturation.md)). Celles qui
touchent cette mission :

1. **Domenico — identifiants d'ITALBIKE STORE** : n° BCE, RPM, forme juridique, n° de créancier SEPA,
   téléphone / e-mail de facturation. *Reco : saisis dans Paramètres → Sociétés ; sans eux, l'export UBL
   est refusé et rien ne part sur Peppol.*
2. **Domenico — ouvrir le compte Falco Expert** (≈ 40 €/mois HTVA) et donner la clé API. *Reco : oui.*
3. **Simon — créer l'application agence sur `dev.falco-app.be`** (bac à sable). *Reco : sans attendre,
   pour tester l'UBL avant le compte de Domenico.*
4. **Comptable — logiciel (Horus ?)** : s'il est sur Horus, Falco lui pousse les ventes. *Reco :
   première question à lui poser, avec le fichier qu'il importe depuis G8.*
5. **Comptable — facture d'acompte** : systématique pour une moto et un client pro ; série `FAA-`
   (retenue) ou `FAC-` ; pour un particulier hors moto, sur demande ? *Reco : `FAA-`, sur demande hors moto.*
6. **Comptable — copie des factures par mail** ou export mensuel ? *Reco : export mensuel (mission 14).*
7. **Domenico — boîte `compta@` et délais de relance** (F10) ; **DKIM / DMARC** par son informaticien (F11).

## 5. Ce qui a changé dans l'application

Sur `main`. **À tester après l'application du bloc de migrations** (180000 après 160000).
Chapitres : [M06 Ventes & caisse](../modules/M06-ventes-caisse.md), [M09 Documents](../modules/M09-documents.md),
[M12 Compta](../modules/M12-compta.md).

| Lot | Ce qui change pour l'utilisateur | Commit | À tester |
|---|---|---|---|
| Facture légale (VEN006) | **Avoir partiel** (on choisit les lignes et quantités) ; la facture d'origine reste au journal, « compensée par un avoir » ; l'avoir cite la facture et porte la mention légale ; **facture d'acompte `FAA-`** créée à l'encaissement d'un acompte sur une moto ou pour un client pro, déduite de la facture finale ; rappel « à émettre avant le 15 » ; brouillons absents du journal et du registre TVA ; mentions FR + langue du client ; **UBL prêt pour Peppol** ; empreinte du PDF envoyé dans la trace | `63c24be` (migration `20261103180000`) | Acompte de 1 000 € sur une moto → FAA créée ; facture finale → acompte déduit ; avoir partiel d'une ligne → la facture reste au journal ; exporter l'UBL (refusé tant que le n° BCE manque, attendu) |
| Z et avoirs (PDV011) | Un ticket remboursé par un avoir est juste dans le Z | `d76de54` | Voir [mission 11](mission-11-caisse-conforme.md) §5 |

## 6. Risques et points d'attention

- **Aucune facture ne part sur Peppol aujourd'hui** : obligation B2B depuis le 01/01/2026 ; tant que
  F2 et F6 ne sont pas faits, Domenico est exposé aux amendes. C'est la priorité légale de ce chantier.
- **Falco n'a pas de webhook** : le suivi des statuts se fait par interrogation régulière ; un rejet
  doit remonter visiblement (cloche), sinon une facture « envoyée » peut ne jamais arriver.
- **Particulier** : son UBL n'est pas envoyable sur Peppol (pas d'identifiant), il reçoit le PDF ; ne
  pas le compter comme une erreur.
- **Intracommunautaire** (`K`) pas encore distingué de l'export (`G`) : à ne pas utiliser avant F7.
- **Choix comptables en attente** (série FAA, règle hors moto, compte 460000) : tout est réglable,
  mais une facture d'acompte émise ne se renumérote pas.
- Le modèle reste multi-société : ne rien coder qui suppose une seule société.
