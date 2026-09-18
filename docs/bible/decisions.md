# Journal des décisions

Toutes les décisions prises par le client ou par l'équipe, **datées**, du plus récent au plus ancien.
Une décision ici fait foi : on ne revient pas dessus sans nouvelle entrée datée qui la remplace.
Les décisions d'architecture détaillées ont leur fiche ADR dans [`../decisions/`](../decisions/).

Format : **code** — décision. *Source · date.* Chapitres concernés.

---

## 2026-09-18 — Méthode de travail

- **M-1** — Une **bible** de l'application : un chapitre par module (ce qu'on a, où le trouver,
  règles, état en production, prévu, pièges, historique), un fichier par **mission**, ce journal.
  Tenue à jour à chaque lot. *Client · 18/09.* Tous.
- **M-2** — Chaque demande est **découpée en trois** et confiée à trois agents en parallèle ;
  l'agent principal intègre, déploie et vérifie. *Client · 18/09.*
- **M-3** — Avant de coder un lot : **questions posées en une fois**, réponses consignées ici.
  Retours du client **groupés par lot**. *Proposé et accepté · 18/09.*
- **M-4** — La référence visible du client est **Netlify** (https://ducatilive.netlify.app).
  *Client · 18/09.*

## 2026-09-18 — Mission 01, retours sur le CRM

- **U-1** — **Pas de nouveaux rôles.** Commercial = `vendeur`, technicien = `mecanicien` ou
  `chef_atelier`, manager = `admin`. *Client · 18/09.* [M00](modules/M00-socle.md)
- **U-2** — Deux sortes de comptes : **équipe** (avec rôles) et **client** (rattaché à sa fiche,
  créée au besoin, sans rôle). Mot de passe fixé par l'administrateur **ou** invitation par e-mail.
  *Client · 18/09.* [M00](modules/M00-socle.md), [M01](modules/M01-contacts.md)
- **U-3** — domenico@ducatibxl.be = manager ; simon@ducatibxl.be = commercial. Créés **sans
  invitation**, mot de passe commun provisoire à changer. *Client · 18/09.*
- **C-5** — La tâche des nouvelles demandes commerciales revient **par défaut à Simon**,
  réattribuable à la main (ex. à Domenico). *Client · 18/09.* [M10](modules/M10-crm.md)
- **C-6** — **Plusieurs CRM**, en onglets. Un CRM atelier viendra ; **ne pas le créer avant qu'on y
  travaille**. *Client · 18/09.* [M10](modules/M10-crm.md)
- **C-7** — Boîte de réponse par défaut = **celle qui a reçu le mail du client** ; chacun peut
  choisir sa propre adresse. *Client · 18/09.* [M10](modules/M10-crm.md)
- **C-8** — La **note** d'une demande s'enrichit d'**un petit paragraphe par échange** qui résume où
  en est la demande. *Client · 18/09.* [M10](modules/M10-crm.md)
- **C-9** — Une demande d'une adresse e-mail inconnue crée une fiche **« prospect »**. *Confirmé · 18/09.*

## 2026-09-14 — Mission 01, la carte CRM

- **C-1** — Une carte entre avec une tâche « Recontacter le client » à **J+2 maximum**.
  *Client · 14/09.* [M10](modules/M10-crm.md)
- **C-2** — Une carte porte **une seule tâche ouverte** : titre, échéance, personne assignée
  (**jamais vide**). **Jamais de carte en double** pour le même client. *Client · 14/09.*
- **C-3** — La carte montre : infos du client, tâche à faire, échanges, tâches réalisées en liste
  chronologique, documents liés. *Client · 14/09.*
- **C-4** — Trois sorties d'une carte : la tâche reste à faire / elle est faite et on ouvre la
  suivante / on **archive** la carte. On ne dit ni « gagné » ni « perdu ». La fenêtre de sortie ne
  s'affiche **que** si la carte reste sans tâche et sans archivage. *Client · 14/09.*

## 2026-09-14 — Mission 01, décisions de départ

- **D1** — Pas de liste d'exclusion : **c'est l'analyse du mail par l'IA qui décide** si c'est un
  prospect. Fournisseur, newsletter, Ducati, indésirable → rien. *Client · 14/09.*
- **D2** — Tri du fichier G8 : **avec au moins une facture → client**, sans facture → prospect.
  Tout nouvel arrivant entre en prospect. *Client · 14/09.* [M01](modules/M01-contacts.md)
- **D3** — **L'adresse e-mail** détermine si le contact est nouveau. En cas de ressemblance, on
  **propose** une fusion, **validée à la main**. Jamais de fusion automatique. *Client · 14/09.*
- **D4** — Les e-mails partent par **Outlook / Microsoft Graph**. Pas de Resend. *Client · 14/09.*

## 2026-07-30 — Commandes de pièces

Détail : [`../process-commandes-pieces.md`](../process-commandes-pieces.md) §5.

- **P-1** — Classement des commandes : `urgente / standard / excel / accident`, extensible.
- **P-2** — Paiement au comptoir : **les trois** moyens — QR Stripe, terminal Bancontact physique,
  QR de virement SEPA. Reste à fournir : modèle du terminal et IBAN.
- **P-3** — Commande Excel : classeur Ducati Demo / Courtoisie / Showroom, seuil **2 000 € par
  onglet** (spécification §1.6).

## Fondations (juin–juillet 2026)

- **F-1** — **Un seul go-live**, 100 % fonctionnel, pas de phase 2 reportée. *CLAUDE.md §0.*
- **F-2** — Deux sociétés : **ITALBIKE STORE** et **NL INVEST** ; tout porte un `company_id`,
  numérotation des documents par société. *CLAUDE.md §0.*
- **F-3** — Comptabilité : **on construit** les flux compta et TVA, **le comptable corrige après
  coup** ; tout doit être paramétrable et auditable. *Client · CLAUDE.md §5.*
- **F-4** — Hors périmètre : Salesforce, DIV, accès direct DCS (export Excel à la place), 3CX/VoIP,
  paie, comptabilité réglementaire. *CLAUDE.md §5.*
- **F-5** — Stock et prix jamais modifiés directement : mouvements **append-only**. *Invariants B5, B7.*
- **F-6** — ADR-001 : mapping de la charte Ducati sur les tokens de l'interface.
  [`../decisions/ADR-001-design-tokens-mapping.md`](../decisions/ADR-001-design-tokens-mapping.md)
- **F-7** — ADR-002 : type de gestion **T** pour la main-d'œuvre.
  [`../decisions/ADR-002-type-gestion-T-main-oeuvre.md`](../decisions/ADR-002-type-gestion-T-main-oeuvre.md)
- **F-8** — Backlog client de Domenico du 25/07 : [`../plan-backlog-italobike-2026-07.md`](../plan-backlog-italobike-2026-07.md).
