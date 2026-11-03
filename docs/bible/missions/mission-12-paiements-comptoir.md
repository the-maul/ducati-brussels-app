---
mission: 12
titre: Paiements au comptoir — chaque moyen de paiement se confirme tout seul, le client suit sur une tablette
etat: 🟦
ouverte_le: 2026-11-03
modules: [M06, M11, M09]
---

# Mission 12 — Paiements au comptoir

> **Objectif en une phrase** : chaque moyen de paiement se confirme tout seul dans le DMS, et le
> client suit son ticket à payer sur une tablette face à lui.

Mission née du découpage de la synthèse
[`../../etudes/2026-11-synthese-caisse-facturation.md`](../../etudes/2026-11-synthese-caisse-facturation.md)
(cartes P1 à P6), **validé par Simon le 03/11/2026**. Sources : étude paiements
([`2026-11-paiements-comptoir.md`](../../etudes/2026-11-paiements-comptoir.md)), questions Omespay /
Domenico et coûts du terminal ([`2026-11-questions-omespay-domenico.md`](../../etudes/2026-11-questions-omespay-domenico.md)).
Missions sœurs : [11 Caisse conforme](mission-11-caisse-conforme.md), [13 Facture belge et Peppol](mission-13-facture-peppol.md),
[14 Comptabilité et registres](mission-14-comptabilite-registres.md).

## 1. Le besoin

Simon, le 03/11/2026 : « La caisse, la facturation et la comptabilité, c'est un énorme morceau… »
avec, pour cette partie : **garder la caisse dans le DMS**, **intégrer les moyens de paiement**
(Omespay, le fournisseur du terminal Bancontact) et **le ticket à payer sur la tablette face au
client**. Demande de Domenico depuis le 30/07 (P-2) : trois moyens au comptoir — QR, terminal, virement.

Le problème : aujourd'hui seul le **QR de virement** est relié au DMS (et le vendeur confirme à la
main « Paiement reçu ») ; le terminal est « à côté » (le vendeur retape le montant) ; le « QR Stripe
+5 % » prévu le 30/07 est **illégal** en Belgique (art. VII.30 § 3 CDE : aucun supplément selon le moyen
de paiement). La loi n'exige qu'un moyen électronique (déjà là) : cette mission est **attendue**, pas
légale.

## 2. Décisions

| Code | Décision | Source |
|---|---|---|
| P-2 | Trois moyens au comptoir : QR Stripe, terminal Bancontact physique, QR de virement SEPA | Client · 30/07 ([decisions](../decisions.md), « Commandes de pièces ») |
| P-2 étape 1 | **QR de virement SEPA** (EPC069-12, communication structurée) sur l'écran client par vendeur, confirmation manuelle | Équipe · 19/09 |
| 03/11 soir | **QR de paiement sans supplément accepté par Domenico** : le « +5 % » du 30/07 est abandonné (amende P-2) | Simon · 03/11 ([decisions](../decisions.md), « 2026-11-03 (soir) ») |
| 03/11 soir | **Terminal = CCV A77** (matériel PAX, Android), réf. A77-OAW-RES-2SEU, fourni par Omespay ; qui ouvre l'API (PAX, CCV ou Omespay) : étude en cours | Simon · 03/11 |
| 03/11 soir | **Aucun matériel imposé** (produit multi-clients) : chaque poste branche son écran client et son terminal | Simon · 03/11 |
| Journal §1, §7 | Fournisseur de paiement : **Omespay** (revendeur CCV) ; **écran client sur tablette : go** (lot en cours) | Simon · 03/11 ([journal](../journal-2026-11-03.md)) |

Conséquence de l'A77 : d'après CCV Belgique, l'A77 fait partie des modèles pilotables « via le
Cloud » (Payment API, méthode terminal) ; le Duo Base ne l'est pas. Reste à savoir **qui l'active,
à quel prix** (rien de publié) et la **certification CCV** (obligatoire, ≈ 36 tests passés par l'agence).

## 3. Cartes

État au 03/11/2026 (soir), vérifié avec `git log`. « Jours » = jours agence hors recette, **estimé → reste**.

| # | Carte | Pourquoi | État | Jours | Décision requise | Dépend de |
|---|---|---|---|---|---|---|
| P1 | Au moins un moyen électronique : QR de virement SEPA + écran client | légal | **fait** (`d3cef17`, 19/09) | 0 → 0 | non | — |
| P2 | **Écran client généralisé sur tablette** : ticket en direct, total, QR, « suivez le terminal », merci, mode vitrine ; un écran par poste | attendu | **fait (03/11, à valider)** — tablette appairée par code sans compte, ticket en direct, montant à payer, terminal, QR de virement (Stripe prévu), merci + ticket par e-mail, langue du client ; migration `20261103240000` **à appliquer** ; mode vitrine : non (accueil neutre) | 3,5 → 0 | Domenico : une tablette par poste, Android ou iPad, vitrine ? | K17 (postes) |
| P3 | **QR instantané sans supplément** : Stripe Checkout (Bancontact 0,35 €, cartes, Wero), règlement passé « reçu » par webhook, même lien dans le mail de commande de pièces ; remplace le « +5 % » | légal (supplément interdit) + attendu | **en cours** (accord de Domenico le 03/11) | 3,5 → 3,5 | Domenico : compte Stripe d'ITALBIKE STORE et clé live | P2 |
| P4 | **Terminal CCV A77 piloté par le DMS** (montant envoyé, résultat reçu), remboursement, certification CCV ; sinon terminal « à côté » (0 j) | attendu | **en cours** (étude : qui ouvre l'API, PAX / CCV / Omespay ; mail Omespay prêt, non envoyé) | 5 → 5 (+ délai Omespay) | Domenico : envoyer le mail à Omespay, relevé mensuel, date du contrat | P2 |
| P5 | Signature sur l'écran client (BL, prise en charge, décharge) | utile | **socle fait (03/11)** : « Faire signer » sur le comptoir et le document, texte modifiable, PNG + empreinte SHA-256 rangés en GED ; reste à brancher les documents choisis | 1,5 → 0,5 | Domenico : pour quels documents ? | P2 |
| P6 | Option : QR Bancontact Pro « On a Display » (QR belge, 120 s) | confort | à faire (option) | 2,5 → 2,5 | Domenico + sa banque (tarif) | P2 |

**Bilan** : 13,5 jours estimés (+ 2,5 en option) ; **P2 livré le 03/11** (et le socle de P5) ; **reste
9 jours** : P3 et P4 en cours (8,5), P5 0,5, + 2,5 si P6.
Ordre : P2 (ne dépend de personne) → P3 (dès la clé Stripe) → P4 (dès la réponse d'Omespay) → P5 → P6.

## 4. Questions en attente

Les questions pour Domenico sont dans la page partagée le 03/11 **« Questions pour Domenico : caisse,
paiements, atelier »**, détaillées dans [`2026-11-questions-omespay-domenico.md`](../../etudes/2026-11-questions-omespay-domenico.md)
(§A, 10 questions ; §B, mail pour Omespay). Celles qui bloquent cette mission :

1. **Domenico — photo de l'étiquette du terminal, relevé mensuel, date d'installation du contrat**
   (A1 à A3). *Reco : les trois avant d'envoyer le mail ; le relevé dit si Bancontact est facturé en
   pourcentage (EMS 0,20 %) ou en montant fixe.*
2. **Domenico — envoyer le mail à Omespay** (§B, de sa boîte, Simon en copie comme contact technique).
   *Reco : ne rien résilier avant la réponse (250 € de transfert, préavis 3 mois).*
3. **Domenico — compte Stripe d'ITALBIKE STORE** et clé live (P3). *Reco : Stripe Checkout, frais
   absorbés ; le virement QR reste gratuit pour les motos.*
4. **Domenico — tablettes** : une par poste ? Android ou iPad ? mode vitrine quand le comptoir est libre ?
5. **Domenico — signature sur tablette** : pour quels documents (BL, prise en charge atelier, décharge) ?
6. **Domenico — volume** : combien de paiements par carte par mois, montant moyen (pour comparer
   Omespay / CCV en direct / Worldline à l'échéance).

## 5. Ce qui a changé dans l'application

P2 (écran client sur tablette) est sur `main` depuis le 03/11 ; P3 et P4 sont **en cours**.
Déjà livré avant : chapitre [M06 Ventes & caisse](../modules/M06-ventes-caisse.md),
[mission 02](mission-02-commandes-pieces.md) carte 9.

| Lot | Ce qui change pour l'utilisateur | Commit | À tester |
|---|---|---|---|
| **Écran client sur tablette (P2, PDV020)** | La tablette posée face au client s'appaire à la caisse par un code (sans compte) ; le client voit son ticket se remplir, le montant à payer, « Payez sur le terminal », le QR de virement, signe au doigt si on le lui demande, peut recevoir son ticket par e-mail ; le vendeur voit un aperçu et l'état de la tablette ; Paramètres → Écrans clients pour révoquer | branche `lot-ecran-client` (03/11) ; migration `20261103240000_m6_ecran_client.sql` **à appliquer** | Ouvrir `/ecran-client` sur la tablette, saisir le code à la caisse, faire une vente, payer, vérifier le merci puis l'accueil |
| QR de virement sur le 2e écran (P1) | Au comptoir, le client voit un QR de virement (montant + communication structurée) sur un 2e écran ; le vendeur confirme « Paiement reçu » | `d3cef17` (19/09) | Déjà à valider depuis le 19/09 : scanner le QR avec une app bancaire, vérifier montant et communication |

## 6. Risques et points d'attention

- **Le terminal dépend d'un tiers** : sans réponse d'Omespay, P4 ne démarre pas ; repli = terminal
  « à côté » (0 j), le vendeur retape le montant (risque d'erreur de frappe vu au Z).
- **Coûts du terminal inconnus** : activation, abonnement par terminal, certification CCV — rien n'est
  publié ; ne rien promettre à Domenico avant la réponse.
- **Contrat Omespay** : 24 mois puis 12 mois tacites, préavis 3 mois, 250 € pour changer d'institution
  de paiement : une date d'échéance manquée bloque un an de plus.
- **Clé Stripe live** : secret à poser côté Supabase, jamais commité ; aucune fonction Stripe n'existe
  encore dans le dépôt (contrairement à d'anciens documents).
- **Produit multi-clients** : l'écran client et le terminal se règlent **par poste** ; ne rien coder en
  dur pour l'A77 ni pour une tablette précise.
- Les **frais du QR** (Bancontact 0,35 €, cartes 1,5 % + 0,25 €) sont absorbés : ne jamais les ajouter
  au ticket (illégal).
