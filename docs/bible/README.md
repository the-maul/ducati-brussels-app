# Bible du DMS Ducati Bruxelles

> **Le point d'entrée unique.** Tout ce que l'application fait, où le trouver, ce qui a été décidé,
> ce qui est en cours. Pour les humains et pour l'IA qui reprend le travail.
> Rédigée le 18/09/2026 à partir d'un scan complet du code et de la base de production.

## Mode d'emploi

- **Je cherche une fonctionnalité** → tableau « Chapitres » ci-dessous, ou recherche d'un mot-clé :
  chaque chapitre liste les siens dans son en-tête (`mots_cles`).
- **Je vais modifier l'application** → lire le chapitre du module (sections 3 « Où trouver quoi »
  et 7 « Pièges »), puis [`00-architecture.md`](00-architecture.md).
- **Le client demande une nouvelle grande évolution** → créer une mission : [`missions/`](missions/README.md).
- **Une décision est prise** → une ligne datée dans [`decisions.md`](decisions.md).
- **Une question attend le client** → [`questions-en-attente.md`](questions-en-attente.md).
- **Un lot est terminé** → mettre à jour la mission, puis l'historique (§9) de chaque chapitre touché.

Pour l'IA : lire ce fichier en premier, puis le seul chapitre utile. Chemins de code exacts en §3 de
chaque chapitre. Rechercher un sujet : `grep -ril "<mot>" docs/bible/modules`.

## Chapitres

| Chapitre | État | Sujet |
|---|---|---|
| [00 Architecture](00-architecture.md) | — | Pile technique, dépôt, déploiement, fonctions serveur, tâches planifiées, secrets, sécurité, commandes, pièges |
| [M00 Socle](modules/M00-socle.md) | 🟦 | Connexion, utilisateurs et rôles, sociétés, audit, numérotation, paramètres, recherche, navigation |
| [M01 Contacts](modules/M01-contacts.md) | ✅ | Fiches clients et prospects, doublons, fusion, TVA, encours, fiches liées |
| [M02 Articles & tarifs](modules/M02-articles.md) | 🟦 | Articles, types de gestion, PAMP, tarifs et imports, casiers, étiquettes |
| [M03 Véhicules & parc](modules/M03-vehicules.md) | 🟦 | Fiche VIN, parc, propriétaires, My Ducati |
| [M04 Achats & réceptions](modules/M04-achats.md) | 🟦 | Commandes fournisseur, réceptions, export DCS, commandes de pièces |
| [M05 Stock & inventaire](modules/M05-stock.md) | 🟦 | Mouvements, triple stock, inventaires, copies datées |
| [M06 Ventes & caisse](modules/M06-ventes-caisse.md) | 🟦 | Devis, factures, avoirs, caisse, TVA marge à la vente |
| [M07 Reprise & occasion](modules/M07-reprise-occasion.md) | 🔴 | Reprises, ORO, occasions, dépôt-vente, marchands |
| [M08 Atelier](modules/M08-atelier.md) | 🟦 | OR, garanties, planning, chronos |
| [M09 Documents](modules/M09-documents.md) | 🟦 | GED, pièces jointes, PDF, signatures |
| [M10 CRM](modules/M10-crm.md) | 🟦 | Demandes, cartes et tâches, mails Outlook, résumés, matching |
| [M11 Site & e-shop](modules/M11-site-eshop.md) | 🟡 | Vitrine, boutique, paiement Stripe |
| [M12 Compta](modules/M12-compta.md) | 🟡 | Journaux, registre TVA, Winbooks, Peppol, SEPA |
| [M13 Reporting](modules/M13-reporting.md) | ✅ | Tableau de bord, CA, marges, productivité |
| [M14 Migration G8](modules/M14-migration-g8.md) | 🟦 | Reprise des données de G8 |

Légende : ✅ utilisable · 🟦 cœur fait, finitions · 🟡 attend une clé ou une décision · 🔴 cassé en production.

## Missions

| # | Mission | État |
|---|---|---|
| 01 | [Nouveau client](missions/mission-01-nouveau-client.md) | 🟦 lots 0, 1, 2 faits · lot 5 : cloche des inscriptions et tri G8 faits · reste fusion des doublons, portail, borne, questionnaire du site |
| 02 | [Commandes de pièces](missions/mission-02-commandes-pieces.md) ([spécification](../process-commandes-pieces.md)) | 🟦 règles des 4 types, suivi de l’état et pièces d’une commande faits (à valider) · reste 7 cartes |
| 03 | [Shopify](missions/mission-03-shopify.md) | 🟦 accès fait · questions en attente |
| 04 | [Fiche client et moto au comptoir](missions/mission-04-fiche-client-moto.md) | 🟦 feu vert 19/09 · 8 cartes |
| 05 | [Devis moto, options et préparation](missions/mission-05-devis-preparation.md) | 🟦 feu vert 19/09 · 10 cartes |

## Alertes relevées par le scan du 18/09

À traiter avant toute ouverture au public (portail client, boutique). Détail dans les chapitres cités.

1. **Sécurité — accès sans connexion.** Une centaine de fonctions de la base sont appelables avec la
   seule clé publique du site ; une trentaine laissent passer un visiteur non connecté (lecture du
   fichier client, du registre TVA ; écritures de stock, de paiement, de clôture comptable). Trois
   fonctions serveur (`read-id-doc`, `classify-prospect-email`, `mailbox-diag`) n'ont aucun contrôle.
   Correctif proposé : [`00-architecture.md`](00-architecture.md) §9. **Lot préparé, non appliqué :**
   [`securite-lot-S.md`](securite-lot-S.md) (couvre aussi l'alerte 6). *M00, M12, architecture.*
2. **Dérive entre le code et la base.** 30 objets utilisés par le code n'existent pas en base
   (vérifié le 18/09) : reprises (M07, cassé), années d'applicabilité et réglages d'import (M02),
   seuils de prix (Paramètres → Sociétés **ne s'enregistre plus**), case « papiers 100 ch » (M03).
   Les fiches article et véhicule s'enregistrent, mais les champs concernés sont perdus sans avertissement.
3. **TVA sur marge incohérente (invariant B2).** La facture d'une occasion achetée à un particulier
   applique la TVA sur le prix total, le registre VO sur la marge. À trancher avec le comptable avant
   la première vente d'occasion. *M06, M07, M12.*
4. **E-shop : une commande peut passer « payée » sans paiement.** *M11.*
5. **Envois automatiques prêts à partir.** Relances de factures et rappels de rendez-vous partiront
   dès qu'une clé Resend ou SMS sera posée. *M08, M12.*
6. **Désactiver un compte ne coupe pas son accès.** *M00.*
7. **Les anciens documents surestiment l'avancement** (ex. inventaire tournant annoncé, sans écran).
   La bible fait foi.

## Autres documents

- [`../etat-projet.md`](../etat-projet.md) : résumé de reprise et cycle de travail.
- [`../plan-nouveau-client.md`](../plan-nouveau-client.md) : journal détaillé de la mission 01.
- [`../avancement.md`](../avancement.md) : tableau des exigences et suivi des migrations.
- [`../cahier-fonctionnel-v2.md`](../cahier-fonctionnel-v2.md) : les 140 exigences et 12 invariants.
- [`../charte-graphique.md`](../charte-graphique.md) : charte visuelle.
