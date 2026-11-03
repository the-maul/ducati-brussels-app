---
mission: 14
titre: Comptabilité et registres — le comptable importe sans retouche, les registres fiscaux se tiennent seuls
etat: 🟦
ouverte_le: 2026-11-03
modules: [M12, M03, M06, M07, M08]
---

# Mission 14 — Comptabilité et registres

> **Objectif en une phrase** : le comptable reçoit chaque mois des fichiers qu'il importe sans
> retouche, et les deux registres fiscaux (TVA marge, véhicules à moteur) se tiennent seuls.

Mission née du découpage de la synthèse
[`../../etudes/2026-11-synthese-caisse-facturation.md`](../../etudes/2026-11-synthese-caisse-facturation.md)
(cartes C1 à C10), **validé par Simon le 03/11/2026**. Sources : étude facturation
([`2026-11-facturation-peppol-compta.md`](../../etudes/2026-11-facturation-peppol-compta.md)) et étude
légale ([`2026-11-caisse-legal-et-marche.md`](../../etudes/2026-11-caisse-legal-et-marche.md)).
Missions sœurs : [11 Caisse conforme](mission-11-caisse-conforme.md), [12 Paiements au comptoir](mission-12-paiements-comptoir.md),
[13 Facture belge et Peppol](mission-13-facture-peppol.md).

## 1. Le besoin

Simon, le 03/11/2026 : « La caisse, la facturation et la comptabilité, c'est un énorme morceau… »,
avec pour cette partie : **intégrer Falco et la comptabilité**. Règle du projet (CLAUDE.md §5) : on
construit nous-mêmes les flux compta / TVA, **le comptable corrige après coup** ; tout doit donc être
paramétrable et exportable.

Le problème : la TVA des occasions de particulier était **fausse** (21 % sur le prix total au lieu de
la marge), le **registre des véhicules à moteur** n'existait pas (amende 1 500 à 5 000 €), et le
comptable n'a encore **aucun fichier** qu'il sache importer (l'export Winbooks est provisoire, son
logiciel n'est pas connu).

## 2. Décisions

| Code | Décision | Source |
|---|---|---|
| M-89 | **TVA sur la marge** : base = vente − reprise seule ; TVA due **globale par période** ; pas de TVA sur la facture ; une moto O = un document à part ; réglages comptables à confirmer | Simon · 03/11 (« OUI ») |
| M-88 | **Le DMS tient le registre des véhicules à moteur** (AR n° 1 art. 28) : par société, numéro continu par année, automatique (OR, reprise, réception, dépôt-vente, vente), append-only ; codes de nature à valider par le comptable | Agence · 03/11 |
| M-100 | Écritures de la facture d'acompte : FAA `400 / 460000 / 451`, contre-passation à la facture finale | Client · 03/11 |
| M-101 | Seuls les documents validés comptent dans le journal, le registre TVA et les écritures | Agence · 03/11 |
| M-93 | Journal des recettes = journaux Z figés, export CSV jour / mois | Client · 03/11 |
| 03/11 soir | Une seule société, ITALBIKE STORE. NL INVEST retirée le 03/11, le modèle reste multi-société pour d'autres clients. | Simon · 03/11 ([decisions](../decisions.md), « 2026-11-03 (soir) ») |

## 3. Cartes

État au 03/11/2026 (soir), vérifié avec `git log`. « Jours » = jours agence hors recette,
**estimé → reste**. « Fait » = code sur `main` ; **migrations `20261103160000` et `20261103190000` à
appliquer** (bloc du [journal §7](../journal-2026-11-03.md), puis `vehicle_register_backfill`).

| # | Carte | Pourquoi | État | Jours | Décision requise | Dépend de |
|---|---|---|---|---|---|---|
| C1 | **TVA marge à la vente** : facture TTC sans TVA, registre des achats, comparaison globale par période, report, écriture de fin de période ; tests | légal (B2) | **fait** (`ef3f953`) | 4 → 0 | comptable : confirmer grilles, comptes 700200 / 451090, OD, exclusion du stock initial | — |
| C2 | **Registre des véhicules à moteur** alimenté par l'OR, la réception, la reprise et la vente ; alerte « sorti sans facture » ; écran, CSV, PDF | légal | **fait** (`df4c46e`) | 3 → 0 | comptable / Domenico : codes de nature d'opération | — |
| C3 | Journal des ventes et registre TVA exportables par mois, **par grille** de la déclaration, acomptes compris, tickets à part | légal | à faire (journal et registre déjà justes depuis `63c24be`) | 1,5 → 1,5 | non | F3, F4, K5 |
| C4 | Export pour le comptable : Winbooks calé sur son gabarit **ou** Horus via Falco ; ZIP mensuel UBL + PDF | attendu (indispensable) | à faire | 1,5 → 1,5 | **comptable : logiciel + fichier exemple** | C3 ; F6 si Horus |
| C5 | Écritures complètes : acompte compte 46 (**fait**) ; mouvements de caisse, arrondi et écarts (657 / 757), comptes par nature (à faire) | légal | **fait en partie** (`63c24be`) | 1 → 0,5 | comptable : arrondi hors TVA en 657 / 757 ? | F3, K5 |
| C6 | Clôture mensuelle de TVA (verrou après la déclaration) | légal | à faire | 0,5 → 0,5 | qui pose le verrou (rôle comptable) | F1 |
| C7 | Listing clients annuel (avant le 31/03/2027) | légal | à faire | 0,5 → 0,5 | non | C3 |
| C8 | Relevé intracommunautaire et liste AR 48 (à la première vente UE) | légal (le cas échéant) | à faire | non chiffré | non | F7 |
| C9 | Rapprochement bancaire (import CODA ou lecture du compte via Ponto) | utile | plus tard | 3,5 → 3,5 | abonnement Ponto ? (reco : pas tout de suite) | — |
| C10 | Réception sur Peppol des factures fournisseurs → achats | utile | plus tard | non chiffré | non | F6 |

**Bilan** : 15,5 jours estimés ; **7,5 livrés** (C1, C2, C5 en partie) ; **reste 8 jours**, dont
**4,5 à lancer** (C3 à C7, presque tout légal) et **3,5 plus tard** (C9), + C8 et C10 non chiffrés.
Ordre : C3 → C5 → C4 (dès le fichier exemple) → C6, C7 → C8 à la première vente UE → C9, C10 après
le go-live.

## 4. Questions en attente

Les questions du comptable sont regroupées dans la synthèse
([§4, tableau « Le comptable »](../../etudes/2026-11-synthese-caisse-facturation.md)) et partent dès
que Domenico donne son nom ; celles de Domenico dans la page partagée le 03/11 **« Questions pour
Domenico : caisse, paiements, atelier »**. Celles qui touchent cette mission :

1. **Domenico — nom et coordonnées du comptable.** *Bloque toute la mission ; à demander en premier.*
2. **Comptable — quel logiciel, et le fichier qu'il importe aujourd'hui depuis G8** (C4). *Reco : si
   Horus, Falco pousse les ventes ; sinon ZIP mensuel UBL + Winbooks calé sur son gabarit.*
3. **Comptable — TVA marge** : confirmer reprise seule + globalisation par période, grilles 00 / 03 / 54,
   comptes 700200 / 451090, écriture de fin de période, exclusion du stock initial repris de G8. *Reco :
   le DMS tient les registres, le comptable valide l'écriture — avant la première vente d'occasion.*
4. **Comptable — registre des véhicules** : codes de nature d'opération, siège unique, date de départ
   de la reprise d'historique. *Reco : registre tenu par le DMS.*
5. **Comptable — arrondi des espèces** : TVA sur le montant exact, écart en 657 / 757 ? *Reco : oui.*
6. **Comptable — qui pose le verrou de clôture mensuelle** (C6). *Reco : lui, dans le DMS, rôle comptable.*

## 5. Ce qui a changé dans l'application

Sur `main`. **À tester après l'application du bloc de migrations** (160000, puis 190000 suivi de
`select * from vehicle_register_backfill('3d9f0f13-a691-4d07-ad58-34590df86e33');`).
Chapitres : [M12 Compta](../modules/M12-compta.md), [M03 Véhicules](../modules/M03-vehicules.md),
[M06 Ventes & caisse](../modules/M06-ventes-caisse.md), [M07 Reprise](../modules/M07-reprise-occasion.md).

| Lot | Ce qui change pour l'utilisateur | Commit | À tester |
|---|---|---|---|
| TVA marge à la vente (VEN005, B2) | Une moto d'occasion rachetée à un particulier se vend **sans TVA sur la facture** (prix convenu, mention légale en 4 langues) ; prix de reprise obligatoire ; la moto est seule sur son document ; Comptabilité → registre de la marge **par période** (ventes − achats + report), export CSV et écriture Winbooks | `ef3f953` (migration `20261103160000`) | Facturer une moto O : aucune TVA affichée, mention présente ; ajouter une pièce sur le même document (refus) ; lire la période dans le registre de la marge |
| Registre des véhicules à moteur (VEH010) | Véhicules → **Registre** : chaque moto qui entre (OR, reprise, réception, dépôt-vente) reçoit un numéro, sa sortie et sa facture sont notées ; filtres, CSV, PDF, ligne de rectification ; encadré sur la fiche moto ; compteur « facture à inscrire » dans la cloche | `df4c46e` (migration `20261103190000`) | Ouvrir un OR → ligne d'entrée ; facturer l'OR → sortie + facture ; exporter le PDF du mois |
| Facture légale (VEN006, partie compta) | Journal des ventes juste (facture compensée gardée, brouillons exclus) ; écritures de la facture d'acompte au compte 460000 | `63c24be` | Voir [mission 13](mission-13-facture-peppol.md) §5 |

## 6. Risques et points d'attention

- **Sans le comptable, C4 ne peut pas être fini** : un export « à l'aveugle » sera à refaire ; ne pas
  le coder avant son fichier exemple.
- **TVA marge non relue par le comptable** : à faire valider **avant la première vente d'occasion**
  après la mise en production ; 87 articles O en base, dont 84 issus de la reprise du stock initial.
- **Registre des véhicules** : codes de nature repris d'une circulaire de 2018, non relus sur le texte
  officiel ; la reprise d'historique (`vehicle_register_backfill`) doit tourner une seule fois juste
  après la migration.
- **Rôles** : le menu Comptabilité est réservé à `admin` et `comptable`, mais les fonctions ne
  contrôlent que l'appartenance à la société (voir F1, mission 13).
- **Conservation** : 10 ans (art. 60 CTVA depuis 2023) ; certains guides disent encore 7 ans.
