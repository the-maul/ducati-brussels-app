---
titre: Caisse, facturation et comptabilité — synthèse des quatre études et découpage en missions
pour: Simon (agence) et Domenico (ITALBIKE STORE / NL INVEST)
de: agence, synthèse du 03/11/2026
etat: proposition de découpage, décisions attendues (§4)
resume: docs/etudes/2026-11-caisse-legal-et-marche.md · 2026-11-paiements-comptoir.md · 2026-11-facturation-peppol-compta.md · 2026-11-audit-caisse-dms.md · ../propositions/2026-11-caisse-shopify-ou-dms.md
---

# Caisse, facturation, comptabilité : ce que dit la loi, où on en est, comment on découpe

> Demande de Simon (03/11) : « La caisse, la facturation et la comptabilité, c'est un énorme morceau,
> sans doute plusieurs missions. Reviens-moi avec une connaissance max du marché et on cause. »
> Déjà décidé : **caisse dans le DMS** (pas Shopify POS), paiement par **Omespay**, **Falco** à
> intégrer, « intègre déjà tout ce que tu peux sans validation ». Ce document résume les quatre études
> du 03/11 et la proposition Shopify / DMS, **sans rien ajouter de nouveau côté recherche** : chaque
> chiffre vient d'une étude (référence entre crochets). Rien n'a été codé, migré ni envoyé.

**Ce qui est sur `main` au 03/11 au soir** (vérifié avec `git log`) : l'audit de la caisse
(`af4df68` : sept défauts francs corrigés dans le code, migration des verrous **écrite, non
appliquée**), les quatre études, la proposition caisse et le journal de pilotage. **Les quatre lots
légaux en cours** (caisse légale, facture légale, registre des véhicules, TVA marge) **ne sont pas
encore sur `main`** : ils sont notés « en cours » ci-dessous.

---

## 1. En une page

**Ce que la loi belge impose à une concession moto (hors restauration)** — les 10 obligations qui comptent :

| # | Obligation | Amende | DMS |
|---|---|---|---|
| 1 | **Facture obligatoire**, même pour un particulier : toute moto, et toute pièce, accessoire ou travail atelier **au-dessus de 125 € TTC** ; toujours pour un client pro. Casques et vêtements : un ticket suffit (AR n° 1 art. 1). | — | En cours |
| 2 | **Rien ne s'efface** : numéros continus, une erreur se corrige par une écriture inverse (contre-passation), tout se garde **10 ans** (art. 60 CTVA). | — | Fait en partie (code) ; verrous en base à appliquer ; contre-passation en cours |
| 3 | **Facture d'acompte** dès qu'un acompte est encaissé sur une moto : la TVA est due à l'encaissement (art. 17 CTVA). | — | En cours |
| 4 | **Note de crédit** qui cite la facture d'origine et porte « TVA à reverser à l'État dans la mesure où elle a été initialement déduite » (AR n° 4). | — | En cours (aujourd'hui l'avoir **fausse le journal des ventes**) |
| 5 | **Facture électronique Peppol** entre entreprises belges, depuis le 01/01/2026. | **1 500 / 3 000 / 5 000 €** | Fichier UBL fait en partie ; **Falco à brancher** |
| 6 | **Journal des recettes** pour les tickets : un rapport Z par jour, **numéroté, figé**, ventilé par taux, ventes > 500 € à part (AR n° 1 art. 14). | — | En cours (aujourd'hui calculé à la volée) |
| 7 | **Registre des véhicules à moteur** : chaque moto qui entre (atelier ou stock) reçoit un numéro, sa sortie et sa facture sont notées (AR n° 1 art. 28). | **1 500 à 5 000 €** | En cours (absent aujourd'hui) |
| 8 | **TVA sur la marge** pour les occasions rachetées à des particuliers : **aucune TVA affichée**, mention « Régime particulier – biens d'occasion », TVA calculée globalement par période (art. 58 §4, AR n° 53). | — | En cours (aujourd'hui **faux** : 21 % sur le prix total) |
| 9 | **Espèces** : 3 000 € maximum par vente, total arrondi à 5 cents, interdiction de refuser les espèces. | **jusqu'à 10 % du montant** (plafond) | Arrondi **fait** ; plafond en cours |
| 10 | **Paiement électronique** proposé, **sans supplément ni minimum** : le « QR Stripe +5 % » décidé le 30/07 est **illégal** (art. VII.30 §3 CDE). | — | QR de virement **fait** ; terminal et QR instantané à faire |

Pas de caisse certifiée (« boîte noire ») à prévoir : elle ne vise que la restauration au-delà de
25 000 €/an. Rien n'impose de certifier le logiciel, mais tout impose de ne rien effacer.

**Ce que le DMS fait déjà** : ticket et facture numérotés par société, mentions et bloc moto (VIN) sur
la facture, multi-paiement avec rendu de monnaie, **arrondi légal des espèces** (03/11), avoir aussi
depuis un ticket, TVA par taux sur le ticket, une seule session de caisse, comptage du tiroir, détaxe
à 0 %, **QR de virement sur l'écran client**, journal des ventes, registre TVA, écritures comptables,
fichier UBL et export Winbooks provisoire.

**Ce qui est en cours (agents du 03/11, ≈ 20 jours)** : facture > 125 €, plafond 3 000 €, Z numéroté
et figé = journal des recettes, ticket rattaché à la session, contre-passation ; facture d'acompte,
avoir propre, UBL complété ; registre des véhicules ; TVA marge à la vente.

**Ce qui reste** : brancher **Falco** (Peppol), compléter les paramètres société, régimes de TVA
(export, intracom), exports pour le comptable et clôture mensuelle (**≈ 16 jours légaux**) ; puis le
confort du comptoir et les paiements (terminal Omespay, QR instantané sans supplément, écran client
sur tablette, ticket 80 mm, tiroir) (**≈ 28 jours**). **Une décision bloque tout** : le **backup puis
l'application de la migration des verrous de caisse** (Q14, Simon).

---

## 2. Toutes les cartes, une seule fois

Origine : **[L]** étude légale et marché (C = légal, A = attendu, U = utile, F = confort, D = décision),
**[A]** audit de la caisse (cartes 1 à 18), **[P]** étude paiements (lots A à E), **[F]** étude
facturation (lots 0, A à E, décisions 1 à 10), **[Pr]** proposition Shopify / DMS. Quand deux études
chiffrent la même carte différemment, on garde l'estimation la plus détaillée (indiquée).
« Jours » = jours agence, hors recette.

| # | Carte | Origine | Pourquoi | État | Jours | Décision requise | Dépend de |
|---|---|---|---|---|---|---|---|
| | **Mission 11 — Caisse conforme** | | | | | | |
| K1 | Appliquer la migration des verrous de caisse (document validé, règlement d'une caisse clôturée, session clôturée figés ; Z corrigé) | A1 | légal | à faire | 0 (backup + 10 min) | **oui** — Simon : backup + go (Q14) | — |
| K2 | Défauts francs de l'audit : ticket à 0 €, scan à résultat unique, ticket non réglé signalé, date locale, **arrondi 5 c**, avoir sur ticket, TVA par taux sur le ticket, une seule session à l'écran | A §4, L-C2 | légal | **fait** (`af4df68`) | 0 | non (arrondi sur carte : non, D7) | — |
| K3 | Basculer ticket → facture : moto, pièce / accessoire / travaux > 125 € TTC, client pro ; drapeau par famille d'article ; client minimal saisi au comptoir | L-C1, F-B, A3 (partie), F-déc. 4 | légal | en cours | 1,5 | **oui** — Domenico : familles « pièce du véhicule » ; ticket forcé avec motif autorisé ? (D1) | K1 |
| K4 | Plafond 3 000 € en espèces par document (acomptes cumulés), refus bloquant | L-C3, A9 | légal | en cours | 0,5 | oui — bloquant ou avertissement (D7, reco : bloquant) | — |
| K5 | **Journal des recettes = Z** : numéro continu par société, figé, ventes sans facture par taux, remboursements, acomptes, lignes > 500 €, PDF en GED, réimpression, vue mensuelle et export | L-C4, A6, A7, F-D (partie) | légal | en cours | 3 (L) | **oui** — comptable : le Z du DMS remplace le journal papier (D2) | K1, K6 |
| K6 | Rattacher chaque ticket et règlement à la session ; refuser d'encaisser caisse fermée ; identifiant de caisse sur le ticket | L-C5, A2 | légal | en cours | 1,5 (A : 1, L : 2) | oui — vendre sans session ouverte (virement, compte client) ? | K1 |
| K7 | Annuler un règlement par contre-passation (ligne négative motivée), jamais par suppression ; devis validés gardés | L-C9, A8 | légal | en cours | 1 | non | K1 |
| K8 | Ticket par e-mail sans fiche client (adresse saisie au comptoir) | L-C6 (partie), A13, F-E | légal (remise systématique du ticket si Z = journal) | à faire | 0,5 | non | — |
| K9 | Motif obligatoire d'un écart de caisse ; procès-verbal des numéros perdus FAC-2026-00002 à 00004 | A10 | légal | à faire | 0,5 | oui — note de Domenico pour le PV | — |
| K10 | Alerte « OR ou BL terminé non facturé avant le 15 du mois suivant » | L-C11 | légal | à faire | 0,5 | non | — |
| K11 | Conservation 10 ans : export annuel figé (factures, tickets, Z, registres) + procédure écrite | L-C12 | légal | à faire | 0,5 | oui — comptable : 7 ou 10 ans (reco : 10) | K5 |
| K12 | Ticket thermique 80 mm + ouverture du tiroir par l'imprimante, duplicata marqué | L-C6 (partie), L-A7, L-A8, A4 | attendu | **fait (03/11)** — PDV030 : ticket 80 / 58 mm par l'imprimante du poste (navigateur, Epson ePOS, Star WebPRNT, Web Serial, WebUSB), duplicata, tiroir à l'encaissement espèces + bouton tracé ; migration `20261103250000` à poser, essai sur une vraie imprimante à faire | 2 (A) | **tranché** — Simon : aucun matériel imposé, chaque poste branche le sien (M-106) | — |
| K13 | « Vente détaillée » depuis le comptoir : remise ligne / globale, prix modifié, client et création rapide, VIN sur la ligne, main-d'œuvre | L-A2, L-A4, L-U10, A3 | attendu | à faire | 1,5 | non | — |
| K14 | Mettre un panier en attente / le reprendre | L-A5 | attendu | à faire | 1 | non | — |
| K15 | Retour / échange depuis le ticket d'origine (scan du TIK), remboursement sur le mode d'origine, inscrit au Z | L-A6, L-C8 (partie), A16 (partie) | attendu | à faire | 1 | non | K5, M2 |
| K16 | Droits fins de caisse (qui remise, annule, ouvre le tiroir, clôture) | L-A14, A11 | attendu | à faire | 1 | **oui** — Domenico : qui fait quoi | — |
| K17 | Une session par poste / tiroir (deux PC = deux caisses) | L-A10, A12 | attendu | **partiel (03/11)** — les postes existent (Paramètres → Postes et périphériques, code de caisse par poste imprimé sur le ticket, PDV030) ; la session de caisse reste par société | 1,5 (reste) | oui — Domenico : combien de tiroirs ? | K6 |
| K18 | Une seule transaction pour créer le ticket et l'encaisser (une coupure ne laisse rien à moitié) | A5 | attendu | à faire | 2,5 (2 à 3) | non (avec la mission 08) | — |
| K19 | Remise en banque : bordereau daté, report du fond | L-A12, A15 | attendu | à faire | 1,5 (A) | non | K5 |
| K20 | Rapports du jour par opérateur, par famille, marge du jour ; statistiques par rayon | L-A11, L-F5 | attendu | à faire | 2 | non | K6 |
| K21 | Mode hors ligne | L-A15, D8 | confort | **écarté** | (5 à 8) | oui — reco : non (4G de secours + carnet manuel) | — |
| K22 | Coin café / événements payants → caisse certifiée | L-L7, D9 | légal si payant | sans objet | 0 | oui — Domenico : le bar est-il gratuit ? | — |
| | **Mission 12 — Paiements au comptoir** | | | | | | |
| P1 | Au moins un moyen électronique : QR de virement SEPA + écran client | L-L10, Pr | légal | **fait** (19/09) | 0 | non | — |
| P2 | Écran client généralisé sur tablette : ticket en direct, total, QR, « suivez le terminal », merci, mode vitrine | P-A, A14, L-A13 | attendu | **fait (03/11)** — tablette appairée par code, ticket en direct, montant à payer, terminal, QR SEPA (Stripe prévu), signature, merci + e-mail ; migration `20261103240000` à appliquer (M-103 à M-105) | 3,5 (3 à 4) | oui — Domenico : une tablette par poste, Android ou iPad, vitrine ? | — |
| P3 | **QR instantané sans supplément** : Stripe Checkout (Bancontact 0,35 €, cartes, Wero), règlement passé « reçu » par webhook, même lien dans le mail de commande de pièces ; remplace le « +5 % » | P-B, Pr, L-L10 | légal (supplément interdit) + attendu | **fait (03/11)** — PDV040, à déployer (migration `20261103260000`, `stripe-checkout`, `stripe-webhook`, secrets, webhook chez Stripe) | 3,5 (3 à 4) | **oui** — Domenico : frais absorbés ; compte Stripe d'ITALBIKE (clé live) | P2 |
| P4 | Terminal CCV d'Omespay piloté par le DMS (montant envoyé, résultat reçu), remboursement ; sinon terminal « à côté » (0 j) | P-C, L-C15, Pr | attendu | à faire | 5 (4 à 6) + délai Omespay | **oui** — réponse d'Omespay (mail prêt, annexe A) | P2 |
| P5 | Signature sur l'écran client (BL, prise en charge, décharge) | P-D | utile | à faire | 1,5 (1 à 2) | oui — Domenico : pour quels documents ? | P2 |
| P6 | Option : QR Bancontact Pro « On a Display » (QR belge, 120 s) | P-E | confort | à faire (option) | 2,5 (2 à 3) | oui — Domenico + sa banque (tarif) | P2 |
| | **Mission 13 — Facture belge et Peppol** | | | | | | |
| F1 | Fermer aux visiteurs non connectés les fonctions comptables (journal, registre TVA, clôture, écritures, SEPA) | F-0, M12 §5 | légal (bloquant) | à faire | 1 | non | — |
| F2 | Paramètres société complets (n° BCE, RPM, forme juridique, identifiant Peppol `0208:`, IBAN 2e société, n° créancier SEPA, téléphone / e-mail) ; n° BCE et contrôle du n° TVA sur la fiche client | F-0, F-déc. 5 | légal | à faire | 1 | **oui** — Domenico : identifiants des deux sociétés, siège de NL INVEST | — |
| F3 | **Facture d'acompte** automatique à l'encaissement (moto, client pro), déduite sur la facture finale | L-C7, F-B, F-déc. 3, L-D4 | légal | en cours | 2,5 | **oui** — comptable : série `FAA-` (étude légale) ou `FAC-` (étude facturation) ? | F5 |
| F4 | **Avoir propre** : référence imprimée, mention AR n° 4, avoir partiel, facture d'origine gardée au journal (bug), remboursement d'un ticket au Z | L-C8, F-B, F-déc. 7, A16 | légal | en cours | 2 | non (série `AVO-` existante) | — |
| F5 | **UBL complété** pour Peppol : identifiant 0208, référence acheteur, catégories S / E / G / K / AE (détaxe aujourd'hui fausse), référence de l'avoir, acompte déduit, remises | F-A (partie), F §2.4 | légal | en cours | 1,5 | non | — |
| F6 | **Connecteur Falco** : envoi à la validation, vérification que le client est sur Peppol, suivi des statuts et rejets, renvoi, UBL archivé, 2 sociétés = 2 clés | F-A, L-C13, Pr | légal | à faire | 4,5 (F-A 5 à 7, UBL compris) | **oui** — Domenico : 2 comptes Falco Expert + clés ; comptable : Horus ? | F2, F5 ; comptes Falco |
| F7 | Régimes de TVA choisis à la validation (normal, export, intracom pro, moto neuve vendue à un particulier UE, autoliquidation) avec la bonne mention ; puissance kW sur le bloc moto | F-B, F §3 (11, 21) | légal | à faire | 1,5 | non | F5 |
| F8 | Mentions légales en français + traduction en regard (Waterloo) | F-B, F-déc. 8 | légal | à faire | 0,5 | oui — Domenico : une page FR + traduction ? | — |
| F9 | Mail de facture : pièces jointes > 3 Mo, empreinte du PDF dans la trace, communication structurée | F-E | attendu | à faire | 1 | non | — |
| F10 | Relances d'impayés par Outlook (au lieu de Resend absent) | F-E, F-déc. 10 | attendu | à faire | 1 | oui — Domenico : boîte `compta@`, délais J+7 / J+21 / J+45 | — |
| F11 | Signature des mails : DKIM + DMARC sur `ducatibxl.be` (absents) | F §5 | attendu | à faire (client) | 0 (1 h chez Combell) | oui — informaticien de Domenico | — |
| F12 | Détaxe : flux « remboursement après visa de la douane » | L-U6, L-L18 | utile | à faire | 1 | non | F7 |
| F13 | Garantie légale sur le bon de commande, signature du BC ; contributions Recytyre / Bebat | F §3 (17, 18) | légal | à faire | non chiffré | non | — |
| | **Mission 14 — Comptabilité et registres** | | | | | | |
| C1 | **TVA marge à la vente** : facture TTC sans TVA, registre des achats + bordereau, comparaison globale par période, régularisation annuelle, écriture de fin de période ; tests | L-C14, F-C, Pr | légal (B2) | en cours | 4 (3 à 5) | **oui** — Simon a tranché (reprise seule, global par période) ; comptable : confirmer et dire qui tient le registre | — |
| C2 | **Registre des véhicules à moteur** alimenté par l'OR, la réception, la reprise et la vente ; alerte « sorti sans facture » ; export | L-C10, L-U12, L-D5 | légal | en cours | 3 | oui — comptable / Domenico : codes de nature d'opération | — |
| C3 | Journal des ventes et registre TVA exportables par mois, **par grille** de la déclaration, acomptes compris, tickets à part | F-D | légal | à faire | 1,5 | non | F3, F4, K5 |
| C4 | Export pour le comptable : Winbooks calé sur son gabarit **ou** Horus via Falco ; ZIP mensuel UBL + PDF | F-D, F-déc. 1 | attendu (indispensable) | à faire | 1,5 | **oui** — comptable : logiciel + fichier exemple | C3 ; F6 si Horus |
| C5 | Écritures complètes : acompte (compte 46), mouvements de caisse, arrondi et écarts (657 / 757), comptes par nature | F-D, F §4.1 | légal | à faire | 1 | oui — comptable : arrondi hors TVA en 657/757 OK ? | F3, K5 |
| C6 | Clôture mensuelle de TVA (verrou après la déclaration) | F-D, F-déc. 9 | légal | à faire | 0,5 | oui — qui pose le verrou (rôle comptable) | F1 |
| C7 | Listing clients annuel (avant le 31/03/2027) | F-D | légal | à faire | 0,5 | non | C3 |
| C8 | Relevé intracommunautaire et liste AR 48 (à la première vente UE) | F §4.2 | légal (le cas échéant) | à faire | non chiffré | non | F7 |
| C9 | Rapprochement bancaire (import CODA ou lecture du compte via Ponto) | F §4.2, P §3.2 | utile | plus tard | 3,5 (3 à 4) | oui — abonnement Ponto ? (reco : pas tout de suite) | — |
| C10 | Réception sur Peppol des factures fournisseurs → achats | F §1.3 | utile | plus tard | non chiffré | non | F6 |
| | **Ventes concession (à rattacher à la mission 08)** | | | | | | |
| V1 | Acompte minimum bloquant sur une moto (VEN009) | L-U1 | utile | à faire | 0,5 | oui — Domenico : montant ou % | F3 |
| V2 | Dépôt-vente : vente, reversement au déposant, commission | L-U4 | utile | à faire | 2,5 (2 à 3) | non | C1 |
| V3 | Cession interne typée (geste, garantie, démo, atelier) | L-U5 | utile | à faire | 2 | non | — |
| V4 | Retour au comptoir d'un achat web : avoir DMS + remboursement Shopify | L-U8, L-D6, Pr | utile | à faire | 1,5 (1 à 2) | **oui** — Domenico : qui rembourse ? | F4 |
| V5 | Regroupement des BL en une facture mensuelle (client pro) | L-U9 | utile | à faire | 1,5 | non | — |
| V6 | Tarifs clients (remise par famille, fournisseur, quantité) | L-U11 | utile | à faire | 3 | non | — |
| | **Confort (après le go-live)** | | | | | | |
| X1 | Bons cadeaux (TVA à la vente) et avoir magasin utilisable en paiement | L-F1, L-F3, A17 | confort | à faire | 3 (L ; A : 2) + 1,5 | oui — Domenico : en vend-il déjà ? (D10) | K5 |
| X2 | Fidélité (points, avantages) | L-F2 | confort | à faire | 5 (4 à 6) | oui (D10, reco : après le go-live) | — |
| X3 | Promotions automatiques (2 + 1, période) | L-F4 | confort | à faire | 2 | non | — |

Doublons retirés : acompte (L-C7 = F-B = F-déc. 3 = L-D4), avoir (L-C8 = F-B = A16 en partie),
125 € (L-C1 = F §3-13 = F-déc. 4 = L-D1), Z / journal des recettes (L-C4 = A6 = A7 = F §3-14),
session (L-C5 = A2 = A12), contre-passation (L-C9 = A8), 3 000 € (L-C3 = A9), ticket mail (L-C6 =
A13 = F-E), ticket 80 mm et tiroir (L-C6 = L-A8 = A4), écran client (P-A = A14), terminal (L-C15 =
P-C = Pr), Falco (L-C13 = F-A = Pr), TVA marge (L-C14 = F-C = Pr), registre véhicules (L-C10 = L-U12),
droits (L-A14 = A11), remise en banque (L-A12 = A15), bons cadeaux (L-F1 = A17).

**Écarts entre études, à garder en tête** : (1) l'étude légale classe l'arrondi 5 c « absent », l'audit
l'a fait le même jour ; (2) série de la facture d'acompte : `FAA-` (étude légale) ou `FAC-` (étude
facturation) — au comptable de choisir ; (3) la proposition décrivait la TVA marge « par véhicule »,
la loi belge globalise par période (décision de Simon du 03/11) ; (4) la proposition chiffrait le
terminal à 0,5 j (indépendant) : avec Omespay et un terminal piloté, c'est 4 à 6 j ; (5) aucune
fonction Stripe n'existe dans le dépôt, contrairement à certains docs ; (6) seuil des lignes à part
du journal des recettes : 500 € (texte au 10/01/2026), certains guides disent encore 250 €.

---

## 3. Découpage proposé en missions

### Mission 11 — « Caisse conforme »
**Objectif** : le comptoir encaisse dans les règles et le comptable n'a plus de journal à tenir à côté.
**Cartes** : K1 à K22. **Jours** : **9,5 légaux** (dont 7,5 en cours) + **14,5 attendus** = **24**.
**Ordre** : K1 (verrous) → K6 (ticket ↔ session) → K5 (Z = journal des recettes) → K3, K4, K7 →
K8 à K11 → puis le confort du comptoir : K13, K14, K15, K18, K16, K17, K12 (matériel), K19, K20.
**Ce qui bloque** : le **backup + go de Simon (Q14)** pour K1 ; l'avis du comptable sur le Z (D2) ;
le matériel (imprimante, tiroir) pour K12 ; les règles de droits et le nombre de tiroirs pour K16-K17.

### Mission 12 — « Paiements au comptoir »
**Objectif** : chaque moyen de paiement se confirme tout seul dans le DMS, et le client suit sur une tablette.
**Cartes** : P1 à P6. **Jours** : **13,5** (P2 + P3 + P4 + P5 ; fourchette 11 à 16) + **2,5** si Bancontact Pro.
**Ordre** : P2 (écran client, ne dépend de personne) → P3 (Stripe, dès le compte ouvert) → P4
(terminal, dès la réponse d'Omespay) → P5 → P6 en option.
**Ce qui bloque** : la **réponse d'Omespay** (modèle, ouverture de l'API cloud CCV, coût, échéance du
contrat de 24 mois, 250 € de transfert) ; l'**accord de Domenico sur un QR sans supplément** et son
compte Stripe ; les tablettes. Si Omespay ne peut pas ouvrir l'API : terminal « à côté » (0 j) jusqu'à
l'échéance du contrat.

### Mission 13 — « Facture belge et Peppol »
**Objectif** : chaque facture, acompte et avoir est juste en droit belge et part tout seul sur Peppol via Falco.
**Cartes** : F1 à F13. **Jours** : **14,5 légaux** (dont 6 en cours) + **2 attendus** + **1 utile** = **17,5**
(+ F13 non chiffré, ≈ 1 j à estimer).
**Ordre** : F1 (sécurité, tout de suite) → F2 → F5, F3, F4 (en cours) → F7, F8 → F6 en bac à sable
puis en production → F9, F10 → F12.
**Ce qui bloque** : les **identifiants des deux sociétés** (F2) et les **deux comptes Falco Expert**
avec leurs clés (F6) ; le choix de série de l'acompte (comptable) ; DKIM / DMARC (informaticien).

### Mission 14 — « Comptabilité et registres »
**Objectif** : le comptable reçoit chaque mois des fichiers qu'il importe sans retouche, et les deux
registres fiscaux se tiennent seuls.
**Cartes** : C1 à C10. **Jours** : **12** (dont 7 en cours) + **3,5** de rapprochement bancaire plus tard = **15,5**.
**Ordre** : C1, C2 (en cours) → C3 → C5 → C4 (dès le fichier exemple) → C6, C7 → C8 à la première
vente UE → C9, C10 après le go-live.
**Ce qui bloque** : **le nom du logiciel du comptable et un fichier exemple** (C4) ; sa validation de la
TVA marge et des codes du registre des véhicules.

Les cartes V1 à V6 relèvent du parcours de vente (**mission 08**, ≈ 11 j) ; X1 à X3 sont du confort
d'après le go-live (≈ 11,5 j).

---

## 4. Les décisions à prendre, par interlocuteur

### Simon
| Décision | Recommandation | Ce que ça change |
|---|---|---|
| **Q14** : backup puis migration `20261103150000_m6_caisse_audit.sql` | **Oui, maintenant** | Les documents validés, règlements et Z deviennent intouchables en base ; les lots caisse légale en dépendent |
| Valider le découpage 11 / 12 / 13 / 14 et l'ordre | 11 et 13 d'abord (légal), 12 en parallèle (écran client et Stripe ne dépendent de personne), 14 dès le fichier du comptable | Calendrier |
| Créer l'application agence sur `dev.falco-app.be` (Application ID, bac à sable) | Oui, sans attendre | On teste l'UBL avant même que Domenico ouvre ses comptes |
| Mode hors ligne (D8) | Non | 5 à 8 j évités ; 4G de secours + carnet de tickets manuels |
| Transaction unique ticket + encaissement (K18) | La faire avec la mission 08 | Évite un ticket à moitié créé si le réseau coupe |

### Domenico
| Décision | Recommandation | Ce que ça change |
|---|---|---|
| **QR « +5 % » illégal** : accepter un QR **sans supplément** (frais absorbés : Bancontact 0,35 €, carte 1,5 % + 0,25 €) | Oui, Stripe Checkout ; Bancontact Pro en plus si sa banque fait un meilleur prix ; le virement QR reste gratuit pour les motos | P3 ; amende la décision P-2 du 30/07 |
| Terminal : photo du modèle, date d'échéance du contrat Omespay ; **envoyer le mail à Omespay** (annexe A) | Rester chez Omespay et demander l'API cloud CCV | P4 piloté (5 j) ou terminal « à côté » (0 j) |
| Seuil 125 € (D1) : liste des familles « pièce / accessoire du véhicule » ; ticket forcé avec motif ? | Facture imposée (nom + adresse suffisent), forçage motivé et tracé | K3 |
| Plafond 3 000 € espèces (D7) | Bloquant | K4 |
| Matériel (D11) : imprimante 80 mm, tiroir, douchette, tablette(s) | **Tranché par Simon le 03/11 (M-106) : aucun matériel imposé**, chaque poste branche le sien (Paramètres → Postes et périphériques). Conseil pour un achat : Epson TM-m30 (ePOS) ou Star mC-Print3 (WebPRNT) en réseau, tiroir branché sur l'imprimante, douchette « clavier » USB | K12, P2 |
| Combien de postes / tiroirs ; qui remise, annule, clôture | À lui de dire | K16, K17 |
| Vendre sans caisse ouverte (virement, compte client) ? | Non au comptoir, oui depuis Ventes | K6 |
| Identifiants : n° BCE, RPM, forme juridique des deux sociétés, siège de NL INVEST, IBAN 2e société, créancier SEPA | À saisir dans Paramètres → Sociétés | F2 ; rien ne part sur Peppol sans eux |
| **Deux comptes Falco Expert** (≈ 2 × 40 €/mois HTVA) et leurs clés API | Oui | F6 |
| Nom et coordonnées du comptable | — | Toute la mission 14 |
| Langue des factures | Mentions FR + traduction en regard | F8 |
| DKIM / DMARC chez Combell | Son informaticien, 1 h | F11 ; factures moins en spam |
| Bar gratuit ? (D9) ; bons cadeaux / fidélité au go-live ? (D10) ; retour d'un achat web : qui rembourse ? (D6) ; signature sur tablette : quels documents ? ; acompte minimum ? | Bar gratuit = rien à faire ; bons cadeaux seulement s'il en vend ; avoir dans le DMS qui déclenche Shopify | K22, X1, V4, P5, V1 |

### Le comptable
| Décision | Recommandation | Ce que ça change |
|---|---|---|
| Quel logiciel (Horus ?) et **fichier exemple** qu'il importe depuis G8 | Si Horus : Falco pousse les ventes ; sinon ZIP mensuel UBL + Winbooks | C4, F6 |
| Le Z du DMS devient le journal des recettes officiel (D2) ; format au regard de l'AM du 17/03/2023 | Oui | K5 ; plus de journal papier |
| Facture d'acompte : systématique pour moto et client pro ; série `FAA-` ou `FAC-` ? | Systématique ; série au choix du comptable | F3 |
| TVA marge : confirmer reprise seule + globalisation par période ; qui tient le registre de comparaison ; écriture de fin de période | DMS tient les registres, comptable valide l'écriture | C1, avant la première vente d'occasion |
| Registre des véhicules : codes de nature d'opération ; tenu par le DMS ? | Oui, par le DMS | C2 |
| Arrondi espèces : TVA sur le montant exact, écart en 657 / 757 ? | Oui | C5 |
| Clôture mensuelle : qui pose le verrou | Le comptable, dans le DMS | C6 |
| Conservation 7 ou 10 ans ; remise pour virement (zone grise) ; PV des numéros FAC-2026-00002 à 00004 | 10 ans ; pas de remise affichée sans son avis | K9, K11 |

### Omespay
| Question | Pourquoi |
|---|---|
| Modèle exact du terminal, acquéreur du contrat, activation « Cloud Connect » de l'API CCV, coût, délai, certification, frais par réseau, échéance, support | Sans réponse, le terminal reste « à côté » et le vendeur ressaisit chaque montant |

---

## 5. Budget

| Mission | Dû quelle que soit la décision | dont en cours (03/11) | Selon décisions / confort | Total |
|---|---|---|---|---|
| 11 — Caisse conforme | 9,5 | 7,5 | 14,5 | **24** |
| 12 — Paiements au comptoir | 0 (le QR de virement suffit à la loi) | 0 | 13,5 (+ 2,5 option) | **13,5** (16) |
| 13 — Facture belge et Peppol | 14,5 | 6 | 3 | **17,5** |
| 14 — Comptabilité et registres | 12 | 7 | 3,5 | **15,5** |
| **Total des quatre missions** | **36** | **20,5** | **34,5** (+ 2,5) | **70,5** (73) |
| Hors missions : ventes concession (mission 08) | — | — | 11 | 11 |
| Hors missions : confort après go-live | — | — | 11,5 | 11,5 |

**Ce qui est dû quoi qu'on décide : 36 jours**, dont **20,5 déjà en cours** chez les agents du 03/11 ;
il reste donc **≈ 15,5 jours légaux à lancer** (Falco, paramètres société, sécurité compta, régimes de
TVA, exports et clôture, petites cartes de caisse). La mission 12 n'est pas exigée par la loi, mais elle
est demandée par Domenico depuis le 30/07 (P-2). Coûts récurrents côté client : Falco ≈ 80 €/mois HTVA
(deux sociétés), Stripe à l'usage, terminal selon le contrat Omespay. Non chiffrés : F13 (garantie,
Recytyre / Bebat), C8 (relevé intracom), C10 (factures fournisseurs Peppol).

Les estimations des études (légale ≈ 13-14 j, facturation 21-27 j, paiements 11-16 j, audit 18 cartes)
ne s'additionnent pas : elles se recouvrent d'environ un tiers (doublons du §2).

---

## Annexe A — Mail prêt à envoyer à Omespay (repris de l'étude paiements §6.1, rien n'a été envoyé)

> **Objet : Intégration de notre terminal CCV à notre logiciel de caisse — ITALBIKE STORE (Waterloo)**
>
> Bonjour,
>
> Nous sommes client Omespay pour notre terminal de paiement à la concession Ducati de Waterloo (ITALBIKE
> STORE SRL). Nous mettons en service un logiciel de caisse sur mesure qui tourne dans un navigateur (PC et
> tablette) avec un serveur en ligne. Nous souhaitons que la caisse **envoie le montant au terminal et reçoive le
> résultat du paiement** sans resaisie. Pourriez-vous nous préciser :
>
> 1. **Quel terminal exactement** est installé chez nous (modèle CCV : A77, A960, A35, Duo Base ?) et **quel est
>    l'acquéreur** de notre contrat (EMS, CCV Pay, autre) ?
> 2. Pour une caisse en navigateur avec serveur, **quelle interface officielle** proposez-vous : la **Payment API
>    cloud de CCV (moyen « terminal », Cloud Connect)** ou autre chose ? Pouvez-vous nous donner l'accès à la
>    documentation, à un **environnement de test** et aux identifiants (ou nous mettre en contact avec le partner
>    manager CCV) ?
> 3. Notre terminal **peut-il être activé en Cloud Connect** ? À quel **coût** (activation, abonnement mensuel,
>    frais d'intégration) et dans **quel délai** ? Faut-il une **certification** de notre logiciel, et qui la porte ?
> 4. Quels sont nos **frais actuels par réseau** (Bancontact, Maestro, Visa / Mastercard, Amex, Apple / Google
>    Pay) et l'**échéance de notre contrat** (date, préavis) ?
> 5. En cas de time-out, de double paiement ou de remboursement échoué, **qui assure le support** (Omespay, CCV,
>    l'acquéreur) et avec quel délai de réponse ?
>
> Merci d'avance pour votre retour,
> [Signature]

## Annexe B — Comptable

Aucune des quatre études ne contient de mail rédigé pour le comptable : elles listent ses questions
(étude facturation §6, étude légale « incertitudes »). Ces questions sont regroupées au §4 ci-dessus
(tableau « Le comptable ») et peuvent partir telles quelles dès que Domenico donne son nom. La
première demande à lui faire : **le fichier qu'il importe aujourd'hui depuis G8**.
