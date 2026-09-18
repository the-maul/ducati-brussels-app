# Journal des décisions

Toutes les décisions prises par le client ou par l'équipe, **datées**, du plus récent au plus ancien.
Une décision ici fait foi : on ne revient pas dessus sans nouvelle entrée datée qui la remplace.
Les décisions d'architecture détaillées ont leur fiche ADR dans [`../decisions/`](../decisions/).

Format : **code** — décision. *Source · date.* Chapitres concernés.

---

## 2026-09-19 — Missions 04 et 05 (vidéos)

- **M-6** — Missions 04 « Fiche client et moto au comptoir » et 05 « Devis moto, options et
  préparation » tirées des vidéos de Domenico (G8, 14/09). Cartes créées avant validation (erreur, règle
  S-5), puis parcours résumé à Simon, qui a confirmé la compréhension et donné le **feu vert le 19/09**
  (« c'est ok pour développer tes cartes 4 et 5 »). Recommandations retenues : civilité M./Mme/Mx +
  forme juridique séparée ; le client peut changer son IBAN (trace + cloche) ; carte grise lue par photo
  avec vérification humaine ; moto déclarée par un client validée par l'équipe (carte ajoutée à la demande
  de Simon, cloche vendeurs + admins) ; acompte versé = encaissé ; alerte impayés = vendeur + admins ;
  e-catalog Ducati = coller la référence. *Client · 19/09.*
  [mission 04](missions/mission-04-fiche-client-moto.md), [mission 05](missions/mission-05-devis-preparation.md)
- **M-7** — **Vidéos : écouter la parole, pas seulement les images.** Domenico y dit ce qu'il voudrait
  que le DMS fasse et que G8 ne fait pas (« idéalement… », « ce serait bien… », « c'est un petit bug »).
  Chaque souhait est cité avec sa minute dans le fichier mission et dans la carte ; on distingue
  « G8 le fait déjà », « souhait dit » et « idée de Claude ». *Client · 19/09.*
- **W-6** — **Liaison des clients Shopify** : seules les correspondances **exactes** sont liées
  automatiquement ; toutes les autres sont proposées et **validées à la main**. *Client · 19/09.*
  [mission 03](missions/mission-03-shopify.md)
- **W-6 (produits)** — La même règle vaut pour les **produits** : un produit Shopify n'est relié d'office à
  un article du DMS que si l'on retrouve **exactement et uniquement** le bon article (SKU = référence après
  trim/majuscules, ou code-barres = code-barres de l'article) ; les autres sont présentés pour validation
  (lier, créer plus tard, ignorer), jamais de liaison devinée. **Rien n'est écrit dans Shopify** à ce stade.
  *Simon · 19/09.* [mission 03](missions/mission-03-shopify.md), [M02](modules/M02-articles.md)

## 2026-09-19 — Mission 02

- **M-5** — **Mission 02 « Commandes de pièces » validée par Simon** (19/09), sur la base de la
  spécification du 30/07 ([`../process-commandes-pieces.md`](../process-commandes-pieces.md)) et des
  cartes ERP de la liste « Mission 02 ». Leçon retenue : ne jamais lancer une mission tirée d'un ancien
  document sans la faire confirmer par Simon. *Client · 19/09.*

## 2026-09-18 — Réponses au questionnaire (mission 01 et au-delà)

- **N-1** — **La cloche est filtrée par rôle et par responsable** : chacun voit les tâches CRM qui lui
  sont confiées (en retard ou pour aujourd’hui) ; les administrateurs voient aussi celles sans
  responsable et peuvent basculer « Les miennes / Toute l’équipe » ; les nouvelles inscriptions ne
  vont qu’aux rôles vendeur, marketing et admin (refusées en base aux autres) ; les demandes de
  rendez-vous atelier du portail vont aux rôles mécanicien, chef d’atelier et admin. Le badge ne
  compte que ce que la personne voit. *Client (carte « Prévenir l’équipe quand un client s’inscrit ») · 19/09.*
  [M00](modules/M00-socle.md), [M10](modules/M10-crm.md)
- **S-5** — **Chaque échange sur une carte met la bible à jour** (chapitre, mission, décisions).
  Les nouvelles missions naissent d'une **vidéo** de Simon : Claude propose sa compréhension et la
  liste de cartes dans le chat, Simon valide, puis Claude crée la liste dans l'ERP et réalise.
  *Client · 18/09.* Voir [`missions/README.md`](missions/README.md).
- **S-3** — **Domaines** : `ducatibruxelles.be` = site Shopify ; **`dms.ducatibruxelles.be`** = DMS du
  personnel ; **`app.ducatibruxelles.be`** = application des clients. Pas encore en ligne : Netlify en
  attendant. *Client · 18/09.*
- **W-4** — **Shopify : le DMS fait foi pour le stock, le prix, les photos et les textes**, après une
  reprise initiale des photos et textes depuis Shopify. Une vente sur Shopify crée la vente et la sortie
  de stock dans le DMS. Faisabilité à vérifier dans l'API Shopify. *Client · 18/09.* Future mission.
- **W-5** — **Le site Shopify pointe vers `/app-client`** : page « bientôt disponible » tant que l'app
  client n'est pas ouverte ; bascule vers l'inscription par un réglage. Lien « Espace client » dans le menu
  principal et le pied de page du site, distinct des « Comptes clients » de Shopify ; formulaire facultatif
  « Prévenez-moi à l'ouverture ». *Client (carte « Proposer l'inscription à l'espace client sur le site
  Shopify ») · 19/09.* [M00](modules/M00-socle.md), [guide](guides/lien-site-shopify.md)
- **F-10** — **Pas de fusion automatique des doublons** : la liste des 12 doublons est envoyée à
  Italbike, qui fusionne lui-même dans le DMS (après correctif de la fusion). *Client · 18/09.*
- **S-4** — Nouvelle méthode : chaque mission est une **liste de cartes dans l'ERP Mauluctive** (client
  Ducati Waterloo, mission « Updates »). Claude traite les cartes et les passe « À valider » ; Simon
  teste et remet « À faire » avec ses notes, ou « Terminé ». *Client · 18/09.*

- **S-1** — **NL INVEST n'a rien à faire dans le DMS** : c'est la holding propriétaire d'Italbike.
  Elle ne contient que les données de démonstration (12 motos, 305 articles, 5 OR, aucun client).
  À retirer. *Client · 18/09.* [M00](modules/M00-socle.md)
- **S-2** — **Une société = une gestion complète et protégée de ses clients.** D'autres concessions
  pourront être ajoutées plus tard, chacune autonome et étanche. *Client · 18/09.* [M00](modules/M00-socle.md)
- **W-1** — **Le site public est Shopify.** Le constructeur de site et l'e-shop du DMS sont **à
  supprimer**. *Client · 18/09.* [M11](modules/M11-site-eshop.md)
- **W-2** — Piste validée à approfondir : **synchroniser Shopify avec le stock du DMS** par API —
  voir les produits en ligne, les lier au stock en direct, en ajouter ou en retirer ; un produit
  publié est toujours lié à un article du stock. *Client · 18/09.* Future mission.
- **W-3** — La page **« Améliorations »** est à supprimer : la planification se fait ici et dans
  l'ERP Mauluctive. *Client · 18/09.* [M00](modules/M00-socle.md)
- **P-1** — Portail client à l'adresse **`/mon-espace`** de l'application pour commencer ; plus tard
  un sous-domaine du type `app.ducatibruxelles.be` (nom exact à confirmer). *Client · 18/09.*
- **P-2** — Contenu du portail : véhicules, entretiens et réparations, factures PDF, coordonnées
  modifiables, **et la prise de rendez-vous atelier** dès la première version. *Client · 18/09.*
- **P-3** — Photos de profil et de moto dès la première version. *Client · 18/09.*
- **P-4** — Inscription en étapes : **étape 1 « Créer mon compte »** = infos personnelles, e-mail,
  **choisir sa moto** ; puis des étapes pour compléter (documents du véhicule, infos société…),
  pour enrichir au maximum la fiche client et la fiche véhicule. *Client · 18/09.*
- **P-5** — **Chaque e-mail envoyé depuis la plateforme** (vendeur, admin, technicien) porte sous la
  réponse une invitation à rejoindre l'application : « Retrouvez facilement la vie de votre moto
  (photos, entretiens, pièces, documents) et bénéficiez de bonus de fidélité en rejoignant notre
  communauté de clients sur l'application Ducati Bruxelles. » *Client · 18/09.*
- **P-6** — **Le pied de mail a deux variantes**, car un client qui a un compte (par exemple via une
  inscription) ne sait pas forcément que l'application existe : **sans compte** → texte P-5 + lien
  « Créer mon compte » (`/inscription?email=…`) ; **compte client jamais venu sur son espace** →
  « Votre espace Ducati Bruxelles est prêt : retrouvez la vie de votre moto (photos, entretiens,
  pièces, documents) et vos bonus de fidélité » + lien « Me connecter » (`/login`) ; **déjà venu** →
  pas de pied de mail. La visite de `/mon-espace` est retenue (`contact_accounts.first_portal_visit_at`
  / `last_portal_visit_at`) et affichée sur la fiche client (« Espace client : … »).
  *Client (retour de Simon) · 19/09.* [M10](modules/M10-crm.md), [M00](modules/M00-socle.md)
- **K-1** — Borne : prénom, nom, e-mail, téléphone, moto actuelle (**choix soigné de la moto**),
  intérêt, consentement marketing. *Client · 18/09.*
- **K-2** — Le client peut demander **à être recontacté**, ou passer. **S'il passe, pas de carte CRM.**
  S'il le demande, carte + tâche au responsable par défaut. Valable aussi pour l'inscription en ligne.
  *Client · 18/09.*
- **K-3** — Tablette **verrouillée en mode kiosque** sur la page d'inscription, retour à l'accueil
  après chaque client. Tablette pas encore achetée. *Client · 18/09.*
- **K-4** — Adresse affichée dans le message de bienvenue : **`app.ducatibruxelles.be`** à terme,
  l'adresse Netlify en attendant. *Client · 18/09.*
- **K-5** — **Le mot de passe est demandé à la borne**, comme en ligne (champ + confirmation, bouton
  « Afficher ») : pas d'étape de plus pour le client. Remplace « aucun mot de passe sur la tablette ».
  Garde-fou maintenu : si l'e-mail correspond à une fiche **déjà connue**, le mot de passe tapé
  **n'ouvre pas** le compte ; le client reçoit l'invitation par e-mail et l'écran le lui dit. Rien ne
  reste sur la tablette (`autocomplete="new-password"`, formulaire détruit à chaque retour à l'accueil).
  *Client (retour de test) · 18/09.* [M00](modules/M00-socle.md), [guide borne](guides/borne-kiosque.md)
- **K-6** — **Le mode borne se lance depuis Paramètres → Borne d'inscription** (administrateurs) :
  explication, bouton « Lancer le mode borne sur cet appareil » (plein écran), adresse à copier,
  QR code, guide de verrouillage de la tablette. *Client (retour de test) · 18/09.* [M00](modules/M00-socle.md)
- **U-4** — **Règles de mot de passe** partout (inscription en ligne, borne, `/reset-password`,
  création d'un compte avec mot de passe dans Paramètres → Utilisateurs) : au moins 8 caractères, une
  majuscule, une minuscule, un chiffre, un caractère spécial ; indicateur des règles remplies pendant la
  saisie ; une seule fonction de contrôle (`src/lib/password-policy.ts`), revérifiée côté serveur.
  *Client (retour de test) · 18/09.* [M00](modules/M00-socle.md)
- **U-5** — **Mails de compte** par Outlook : après toute inscription réussie, un mail « Bienvenue chez
  Ducati Bruxelles » (identifiant, lien vers l'espace client, message de bienvenue K) — ou, pour une
  fiche déjà connue, l'invitation « choisir mon mot de passe » qui reprend ce message ; après tout
  changement de mot de passe, un mail « Votre mot de passe a été modifié », sans jamais le mot de passe.
  *Client (retour de test) · 18/09.* [M00](modules/M00-socle.md)
- **F-9** — Fusions de fiches validées par les **administrateurs** ; on garde la fiche qui a des
  factures, sinon la plus ancienne, complétée par l'autre ; l'historique des deux est conservé.
  *Client · 18/09.* [M01](modules/M01-contacts.md)

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
  **Appliquée le 18/09** : 4 165 fiches (facture `FAC` G8 ou DMS, hors brouillon/annulée, fournisseurs exclus).
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
