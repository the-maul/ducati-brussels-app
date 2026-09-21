# Journal des décisions

Toutes les décisions prises par le client ou par l'équipe, **datées**, du plus récent au plus ancien.
Une décision ici fait foi : on ne revient pas dessus sans nouvelle entrée datée qui la remplace.
Les décisions d'architecture détaillées ont leur fiche ADR dans [`../decisions/`](../decisions/).

Format : **code** — décision. *Source · date.* Chapitres concernés.

---

## 2026-09-21 — Mission 03, commandes du site (choix de réalisation)

- **W-9** — **Une commande payée sur le site = une facture `FAC` validée et payée** dans le DMS (pas un bon de
  commande : elle est déjà payée et la marchandise part), avec sortie du stock réel, règlement reçu « Shopify
  Payments » (nouveau moyen `SHOP`, PayPal → `PPL`, « Bank Deposit » → `VIR`) et département E-shop. Une commande pas
  encore payée n'entre pas dans le DMS ; un remboursement Shopify = un avoir (stock réintégré seulement si Shopify l'a
  remis en stock) ; un remboursement à 0 € ou une annulation sans remboursement = « À vérifier ». Nouveau client créé
  en **client** (D2) ; plusieurs fiches avec le même e-mail : la plus ancienne fiche client, sans fusion (D3). Réglage
  « Import des commandes du site » **livré Arrêté** ; à l'activation, seules les commandes postérieures sont importées.
  *Équipe · 21/09, à valider par Simon.* [mission 03](missions/mission-03-shopify.md), [M06](modules/M06-ventes-caisse.md)
## 2026-09-21 — Mission 06, catalogue Ducati (réalisation)

- **M-17** — **Premier remplissage du catalogue par fichiers d'extraction** : l'extraction tourne dans le
  Chrome de Simon (script piloté dans l'onglet e-catalog, avec sa session) et dépose des fichiers
  `catalogue-ducati-*.json` dans *Téléchargements* ; le chargeur `tools/catalog-loader/load.mjs` les pousse
  en base (clé de service de l'environnement, jamais affichée). L'extension Chrome « Importer le catalogue »
  passe au second plan (mises à jour). *Simon avec l'agent principal · 21/09.*
  [mission 06](missions/mission-06-catalogue-pieces.md), [guide](guides/catalogue-ducati.md)
- **M-18** — **Accessoires et vêtements Ducati** ajoutés au périmètre du catalogue (carte 7 « Importer les
  catalogues accessoires et vêtements Ducati », confirmée par Simon : « oui top ») : stockés avec leurs références par taille/couleur, leur
  compatibilité modèle/année, photos (adresses) et prix Ducati à titre d'information. **Aucun article DMS
  n'est créé** à ce stade : la création / liaison (notamment les 1 994 produits Shopify « 98… ») sera une
  étape décidée par Simon. *Simon · 21/09.* [mission 06](missions/mission-06-catalogue-pieces.md), [M02](modules/M02-articles.md)
- **M-19** — **Tables du catalogue Ducati globales** (sans `company_id`, comme `ducati_vds`) : donnée de
  référence commune aux deux sociétés ; lecture réservée aux comptes de l'équipe, écriture uniquement par les
  fonctions d'import (administrateur ou chargeur). Le **prix catalogue Ducati** est gardé pour information
  et **ne modifie jamais** le prix des articles (`price_changes` intact). *Équipe · 21/09.*
  [M02](modules/M02-articles.md), [M03](modules/M03-vehicules.md)

## 2026-09-19 — Mission 04, cartes 6 à 8 (choix de réalisation)

- **M-12** — **Moto d'un client = véhicule de réparation** : créée depuis la fiche client avec son lien
  propriétaire, **sans article** (pas de type V/O/P/D, pas de stock), statut parc **« Vendu »** comme les
  2 418 motos « RÉPARÉ » reprises de G8 (l'énumération `vehicle_status` n'a pas de statut « client » ;
  pas de nouveau statut ajouté). *Équipe · 19/09.* [M03](modules/M03-vehicules.md)
- **M-13** — **Un VIN = une fiche par société** pour toute nouvelle saisie : refus en base
  (`VIN_EXISTS`) et proposition de rattacher la moto existante. Pas d'index unique : 4 VIN sont déjà en
  double (reprise + fiche G8), à fusionner à la main. Le contrôle 17 caractères / I-O-Q n'est qu'un
  avertissement (vieux cadres). *Équipe · 19/09.* [M03](modules/M03-vehicules.md)

## 2026-09-19 — Mission 04, cartes 1 à 5 (choix de réalisation)

- **M-8** — **Civilité** : valeurs enregistrées `Monsieur` / `Madame` / `Mx` (celles des ~6 000 fiches
  existantes ne changent pas), affichées **M. / Mme / Mx**. La **forme juridique** vit dans
  `contacts.legal_form` ; pour les 1 210 fiches G8 concernées, elle a été **copiée** depuis `civility`,
  sans rien effacer. *Équipe · 19/09.* [M01](modules/M01-contacts.md)
- **M-9** — **E-mail en minuscules garanti en base**, mais seulement pour les nouvelles saisies (insertion
  ou e-mail modifié) : les e-mails existants ne sont pas réécrits (une paire ne diffère que par la casse,
  fiches 231 / 8293, à fusionner à la main — D3). *Équipe · 19/09.* [M01](modules/M01-contacts.md)
- **M-10** — **Codes postaux** : liste bpost reprise par le jeu public `jief/zipcode-belgium` (2020), le
  site bpost n'étant pas joignable le 19/09 ; province déduite des tranches officielles. À rafraîchir
  depuis bpost si une localité manque. *Équipe · 19/09.* [M01](modules/M01-contacts.md)
- **M-11** — **Mobiles G8 rangés dans « téléphone »** : jamais recopiés en masse ; liste « Mobiles à
  compléter » et un clic par fiche, tracé (`phone_to_mobile`). *Équipe · 19/09, conforme au risque noté
  dans la mission 04.* [M01](modules/M01-contacts.md)

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
- **M-14** — **Missions 06 « Catalogue pièces Ducati » et 07 « Plan d'entretien »** ouvertes le 21/09 à la
  demande de Simon, proposition validée (« ok »). **Ducati a donné son accord** pour remplir notre base à
  partir de l'e-catalog (confirmé par Simon). Lecture uniquement avec la session de l'utilisateur, aucun
  identifiant Ducati stocké ni saisi par Claude. [mission 06](missions/mission-06-catalogue-pieces.md),
  [mission 07](missions/mission-07-plan-entretien.md) *Client · 21/09.*
- **M-15** — Catalogue Ducati : **Europe seulement, millésimes depuis 2000, import par extension Chrome** (lecture avec la session de l'utilisateur, aucun identifiant stocké). *Client · 21/09.* [mission 06](missions/mission-06-catalogue-pieces.md)
- **W-7** — Shopify : **prix TVA comprise** ; **frais de port en ligne à part** dans la vente du DMS. *Client · 21/09.* [mission 03](missions/mission-03-shopify.md)
- **W-8** — **Le DMS écrit sur le site Shopify et gère les produits** (stock, prix TTC, publication/retrait, textes et photos) : accord explicite de Simon dans le chat le 21/09 (« d'accord pour que le DMS écrive sur le site, il gère les produits »). Mise en route par un essai sur quelques produits avant l'ouverture à tous. *Client · 21/09.* [mission 03](missions/mission-03-shopify.md)
- **M-16** — Plan d'entretien : taux horaire **HT** ; document **le plus récent fait foi** ; échéance au **premier atteint (km ou mois)** ; plans **piste/racing** gérés avec un **usage** choisi par le client. *Client · 21/09.* [mission 07](missions/mission-07-plan-entretien.md)
- **M-20** — Plan d'entretien (Simon, 21/09) : **taux horaire atelier 90 € HT** ; « Monster V2 », « DesertX V2 » et « Hypermotard V2 » sont de **nouveaux modèles, millésime 2026** ; **un kit de pièces par famille de moteur et par entretien**, proposé automatiquement à partir du catalogue et corrigeable par l'atelier. Catalogue : extraire aussi les **modèles et années antérieurs** (avant 2000). *Client · 21/09.* [mission 07](missions/mission-07-plan-entretien.md)
- **S-7** — **Cartes ERP : pièces jointes et scission** (Simon, 21/09). Les notes peuvent porter
  des fichiers (images, documents, vidéos, audio) : ils sont toujours ouverts et compris avant de coder
  (vidéo/audio transcrits). Quand une note ajoute un besoin qui dépasse la carte, une **nouvelle carte**
  est créée (proposée par l'agent, créée par l'agent principal) plutôt que de gonfler l'existante.
  Détail : [`missions/README.md`](missions/README.md) §« Le cycle d'une carte ». *Client · 21/09.*
- **S-6** — **Sauvegarde du code du 19/09 01:15** (accord de Simon dans le chat) : tag `backup-20260919-011526` sur le dépôt `ducati-backup` et branche `backup/20260919-011526` sur le dépôt principal (commit 6be3d89). Code seulement : la base n'est pas copiée par cette procédure. *Client · 19/09.*
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
- **P-2 étape 1 faite** (carte 9, 19/09) — **QR de virement SEPA** au comptoir, gratuit. Norme **EPC069-12
  version 002** (UTF-8, `SCT`, BIC omis tant qu'il est vide : facultatif dans l'EEE en v002), correction
  d'erreur M. Communication **structurée belge** `+++XXX/XXXX/XXXXX+++` calculée depuis le numéro du
  document (1er chiffre = type : DEV 1, BC 2, RES 3, BL 4, FAC 5, TIK 6, AVO 7 ; puis les 9 derniers
  chiffres du numéro ; contrôle = modulo 97, 97 si le reste vaut 0), placée dans le champ « référence
  structurée » du QR ; ou texte libre « n° du document + nom du client ». **Pas de flux bancaire** : le
  vendeur confirme « Paiement reçu ». Écran client **par vendeur** (utilisateur × société), session équipe
  obligatoire. Librairie **`qrcode`** (1.5.4, MIT, la plus répandue sur npm, sans dépendance native, déjà
  prévue par la spécification §4.5) ; seule sa partie « matrice » est utilisée, le dessin SVG est fait
  dans l'application (couleurs de la charte). *Équipe · 19/09.*
  [mission 02](missions/mission-02-commandes-pieces.md), [M06](modules/M06-ventes-caisse.md)
- **P-2 étapes 2 et 3 à faire** — **QR Stripe (+5 %)** : il faudra la **clé Stripe de production**
  (`STRIPE_SECRET_KEY` + secret du webhook, en secrets Supabase, jamais commités), le choix Payment Link ou
  PaymentIntent, et la règle du supplément de 5 % (ligne de frais sur le document ?). **Terminal
  Bancontact** : il faudra la **marque et le modèle du terminal** (et son prestataire : Stripe Terminal,
  Worldline, CCV…) pour savoir s'il a une API. Les deux pourront réutiliser l'écran client
  (`counter_displays`) et le règlement « attendu » puis « reçu ». *Équipe · 19/09.*

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
