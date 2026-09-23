# Journal des décisions

Toutes les décisions prises par le client ou par l'équipe, **datées**, du plus récent au plus ancien.
Une décision ici fait foi : on ne revient pas dessus sans nouvelle entrée datée qui la remplace.
Les décisions d'architecture détaillées ont leur fiche ADR dans [`../decisions/`](../decisions/).

Format : **code** — décision. *Source · date.* Chapitres concernés.

---

## 2026-09-23 — Motos à vendre : du stock du DMS au site (mission 03)

- **M-36** — **Pas de faux client « Italbike Store ».** Une moto est **à la fois** une fiche véhicule
  (VIN, propriétaires, entretiens) **et** un article (**V** neuf, **O** occasion particulier → TVA
  marge, **P** occasion professionnel, **D** dépôt-vente). Ce qui la rend vendable est son **statut de
  parc**, déjà porté par `vehicles.status` (11 valeurs, **réutilisé**, aucun nouveau statut) :
  « En stock » (à nous, aucun propriétaire, visible sur le site) · « Dépôt-vente » (propriétaire =
  client déposant, visible sur le site) · « Vendue » (propriétaire = acheteur, retirée du site) ·
  « Moto client » (statut « Vendu » **sans article**, décision M-12 : jamais sur le site).
  *Simon · 23/09.* M03, M07, mission 03.
- **M-37** — **Le bouton « Publier sur le site » n'est proposé que pour « En stock » et
  « Dépôt-vente ».** « Réservée » et « Démo » restent au parc mais ne sont pas proposées ; à la
  **facturation**, la moto sort du stock, change de propriétaire et est dépubliée automatiquement
  (déclencheur sur `stock_moves`, donc aussi depuis la caisse et les commandes du site).
  *Équipe · 23/09.* M03, M06.
- **M-38** — **Une moto du site n'est rattachée automatiquement que si la correspondance est sûre** :
  VIN cité dans le produit (score 95) ou **SKU du site = référence G8 de la moto**, unique des deux
  côtés (score 90). Le reste — nom de modèle, titre approchant — reste **à valider à la main**.
  Mesuré le 23/09 : **aucune** correspondance par VIN possible (l'instantané Shopify ne reprend pas
  la description des produits), 30 rattachements sûrs par référence, 458 propositions à valider.
  *Équipe · 23/09.* Mission 03, M03.
- **M-39** — **On ne crée pas de fiche moto à partir d'une annonce du site.** Une fiche sans VIN est
  contraire à B9 et polluerait le parc (le site garde 213 annonces en brouillon d'anciennes motos
  vendues). Les **25 motos en ligne** qu'aucune fiche du parc ne reconnaît sont listées pour être
  créées à la main. *Équipe · 23/09.* Mission 03, M03.

---
## 2026-09-23 — Liste Pièces & Accessoires : images, provenance, filtre stock

- **M-26** — **Logos officiels pour la provenance d'un article.** La colonne « Référencé sur » de la liste
  Pièces & Accessoires et l'en-tête de la fiche article montrent le **logo Ducati** (référence du catalogue
  Ducati) et le **logo Shopify** (vendu sur le site) au lieu des badges texte. **G8 n'a pas de logo** et garde
  un badge texte sobre (fond noir Ducati, texte clair), validé tel quel. Hauteur unique **18 px**, ratio
  d'origine conservé (`object-contain`, jamais de logo déformé), texte alternatif et infobulle explicites
  (« Référence du catalogue Ducati », « Vendu sur le site (Shopify) », « Repris de G8 »). Plusieurs logos
  possibles sur une même ligne ; le filtre « Référencé » par source ne change pas. Fichiers servis par
  l'application (`public/brands/ducati.webp`, `public/brands/shopify.png`) — usage interne d'une concession
  Ducati officielle, comme indicateur de provenance. *Simon (maquette validée) · 23/09.* M02.
  **Ceci remplace** la règle « pas de logo de marque » qui était écrite dans `links-ui.tsx`.

- **M-27** — **Ordre de préférence des images d'un article.** Une seule règle pour tout l'écran :
  **photo Ducati du produit** (`ducati_catalog_products.image_url`, accessoires et vêtements) >
  **photo du site** (`shopify_products.image_url`) > **vue éclatée du catalogue Ducati**
  (`ducati_catalog_drawings.thumbnail_url` / `image_url` / `original_image_url`) > **rien**
  (emplacement vide sobre, jamais d'icône cassée). Les URL sont **externes** (e-catalog.ducati.com,
  cdn.shopify.com) : rien n'est téléchargé ni recopié, et une image qui ne se charge pas retombe sur
  l'emplacement vide. Les **photos du magasin** (GED du DMS) ne sont pas candidates en liste : elles
  exigent une URL signée par photo, impossible sur une page de 200 lignes — elles restent la galerie de
  la fiche article. Sur la fiche, une image en grand + une galerie quand plusieurs sources en ont une.
  La règle est écrite deux fois : `_article_thumbnail` (SQL, fait foi) et `sourceImages`
  (TypeScript, testée dans `tests/article-images.test.ts`). *Équipe · 23/09.* M02.

- **M-28** — **Les filtres d'une liste se calculent en base, jamais dans le navigateur.** PostgREST est réglé
  sur **`max_rows = 1000`** : toute réponse est coupée à 1 000 lignes **sans erreur ni avertissement**. Charger
  un référentiel entier pour croiser une donnée côté client donne donc un résultat faux et silencieux (c'est
  ce qui faisait afficher « 0 ligne » au filtre « stock positif » sur 93 104 articles). Toute liste d'écran
  passe par une fonction SQL qui **filtre, trie, pagine et compte** (`article_list_page`), avec un **total
  exact** et un **message d'erreur lisible** en cas d'échec — jamais une liste vide. Toute lecture
  volumineuse boucle par pages de 1 000. *Équipe · 23/09.* M02, M05.
## 2026-09-23 — Rapprochement : la machine décide, l'humain ne trie plus (missions 03 et 06)

- **M-40** — **Le rapprochement décide seul, par faisceau d'indices.** Simon (23/09, chat) :
  « pour les 10 250 rapprochements proposés, tu dois toi-même les vérifier et accepter si c'est
  raisonnablement bon… il faut trouver un moyen de purifier tous ces éléments sans validation
  humaine, c'est intenable. » La fonction `article_links_autoresolve(société)` (relançable,
  appelée à la fin de chaque `article_links_refresh`) tranche :
  **relié d'office** quand (1) le SKU du site est **exactement** la référence d'un seul article
  actif et qu'un seul produit porte ce SKU (règle W-6, désormais appliquée **en base** et plus
  seulement pendant la lecture Shopify) ; (2) la référence de l'article est le **premier mot du
  titre** du produit **et** la désignation se retrouve dans ce titre (70 % des mots) **ou** le
  prix colle à **5 %** près, sans SKU concurrent et sans autre candidat qualifié des deux côtés ;
  (3) l'article « SHOP-… » a été créé depuis ce produit même.
  **Rejeté d'office, avec la raison** quand la référence Ducati est **déjà reliée** à un autre
  article (une référence du catalogue = un article, M-25) ou quand la variante du site est déjà
  reliée par son SKU exact. Une décision humaine n'est jamais écrasée ; un lien rejeté n'est
  jamais recréé. **Résultat en production le 23/09 : 10 251 à valider → 2.**
  *Simon (chat 23/09) ; règles de réalisation : équipe.*
  [M02](modules/M02-articles.md), [mission 03](missions/mission-03-shopify.md), [mission 06](missions/mission-06-catalogue-pieces.md)

- **M-41** — **La chaîne « remplacée par » ne crée pas de second lien au catalogue.** Les
  8 368 candidats « remplacement_dms » et les 1 743 « révision » visaient **tous** (100 %) une
  référence Ducati déjà reliée — pour le remplacement, à l'article de remplacement lui-même.
  Les accepter aurait mis deux articles (ou plus) sur la même référence du catalogue, contre
  M-25, sans rien apprendre : le lien ancien → nouveau est déjà porté par le champ
  « remplacée par » de l'article. L'indice de révision, lui, est une **devinette** : l'audit a
  trouvé des variantes de couleur et de marché (50221612AB « JANTE ROUE AR. » proposée pour
  50221612AA « JANTE ROUE AR. **ROUGE** », 57312391AA « USA MUFFLER » pour 57312391CA). Les deux
  méthodes sont **rejetées en masse** et ne sont plus proposées. *Équipe · 23/09.*
  [M02](modules/M02-articles.md)

- **M-42** — **SKU partagé par plusieurs produits du site : on prend le produit ACTIF.** Demande
  de Simon (23/09). Un seul produit actif (ni brouillon ni archivé) → c'est lui qui est relié ;
  **plusieurs produits actifs** → seul cas laissé à une personne. Les 12 SKU partagés
  d'aujourd'hui (24 produits, vêtements et casques) ont déjà été traités par M-25, qui a créé un
  article « …-2 » par produit : ils ne sont pas dans la file. La règle vaut pour la suite.
  *Client · 23/09.* [mission 03](missions/mission-03-shopify.md)

- **M-43** — **Une moto du site n'est jamais un candidat d'article pièce.** Deux motos neuves
  (SKU « DESERTX », « PANIGALEV4R ») remontaient en « à valider » parce que leur SKU est aussi
  la référence d'un article. Le rapprochement écarte désormais les produits reconnus comme motos
  (`_shopify_is_moto`), comme le fait déjà la création des articles manquants : les motos du site
  passent par `shopify_vehicle_links`. *Équipe · 23/09.* [mission 03](missions/mission-03-shopify.md)

## 2026-09-21 — Un seul catalogue : les articles du DMS (missions 03 et 06)

- **M-25** — **Un seul catalogue, un seul stock : les articles du DMS (Pièces & Accessoires).** Il n'y a plus de
  « Catalogue Ducati » ni de « Produits Shopify » séparés dans le menu : les vues éclatées s'ouvrent depuis la fiche
  article (onglet « Vues éclatées / motos compatibles ») ou la fiche moto ; l'écran Shopify ne garde que les réglages
  du site ; « Rapprochements » est un outil de Pièces & Accessoires. **Tout ce qui manque est créé dans le DMS**
  (`article_links_create_missing`, relançable, sans doublon, tracé dans `events`) :
  référence du catalogue Ducati sans article → article **A en librairie** (non stocké tant qu'il n'est pas reçu), désignation
  FR, **prix public Ducati** (PV TTC = prix TTC Ducati, PV HT = prix HT, aussi en PPC ; « à compléter » sans prix) ;
  accessoire / vêtement Ducati → idem, une référence par taille / couleur ; **variante Shopify sans article → un article
  par variante** (référence = SKU, « -2 » si le SKU est partagé ; sans SKU : code « SHOP-… », à compléter, lien à
  valider), prix = prix du site TTC (W-7, W-10, W-11), **stock de départ = stock Shopify** par un mouvement
  « inventaire » append-only (origine `import:shopify`, B7), lien Shopify relié ; les pièces d'occasion (« OCC ») ont
  leur propre article ; **les motos du site ne sont pas des articles pièces** : lien proposé vers la fiche véhicule (VIN,
  modèle), à valider. Les prix passent par `price_changes` (déclencheur, origines `import:catalogue_ducati` /
  `import:shopify`). **Le DMS est la source** : un produit créé directement dans Shopify est signalé
  (« Produit du site sans article » → « Créer l'article » / « Rattacher ») ; le site affiche le stock du DMS (W-8).
  Chaque article porte des badges **G8** (repris de G8), **Shopify** (sur le site), **Ducati** (référence du catalogue),
  filtrables. Liens dans `article_links` (relié / à valider / rejeté, jamais reproposé) ; relié d'office seulement pour
  les correspondances exactes (même référence normalisée ; SKU exact et unique, W-6 inchangée). *Simon (chat 21/09 :
  « un seul catalogue avec le Shopify lié », « si des produits n'existent pas on les crée dans la db », « un seul stock
  … des petits logos G8, Shopify, Ducati ») ; règles de réalisation : équipe.*
  [M02](modules/M02-articles.md), [mission 03](missions/mission-03-shopify.md), [mission 06](missions/mission-06-catalogue-pieces.md)
## 2026-09-23 — Mission 07, carte 3 : manuels d'atelier Ducati (réalisation)

- **M-26** — **Les manuels d'atelier vivent dans leurs propres tables `wsm_*`**, à côté des
  `maintenance_*`, pas dedans. Deux sources différentes : `maintenance_*` vient des fiches PDF
  « Entretien Transparent » (59 plans, temps commerciaux, par plage d'années), `wsm_*` vient des
  manuels d'atelier du DM Ducati (469 modèles-années exacts, le geste technique, 3 336 procédures,
  36 326 étapes, temps réels en UT). Granularités, cycles de mise à jour et usages différents : on
  ne les mélange pas, **on les rapproche par le modèle-année du catalogue**
  (`ducati_catalog_model_years`). Les écrans existants de la carte 07-1 ne bougent pas.
  *Équipe · 23/09.* [mission 07](missions/mission-07-plan-entretien.md), [M08](modules/M08-atelier.md)

- **M-27** — **Déduplication des procédures conservée en base** : une procédure partagée par
  plusieurs modèles-années n'est stockée **qu'une fois** (`wsm_procedures`, clé = identifiant de
  parcours de l'extraction), ses usages sont dans `wsm_procedure_usages` avec le **chemin du DM
  propre à chaque modèle-année**. 3 336 procédures pour 23 211 usages : sans déduplication il y
  aurait 253 000 étapes au lieu de 36 326. Chaque valeur garde sa source (manuel, chemin du DM,
  titre, code WSM, version, date de mise à jour). *Équipe · 23/09.*
  [M08](modules/M08-atelier.md)

- **M-28** — **Rattachement manuel ↔ catalogue en deux règles, jamais deviné** : (1) identifiant du
  DM égal à l'identifiant e-catalog → **lié** (138 modèles-années) ; (2) même famille, même
  millésime et même nom normalisé → **lié** s'il n'y a qu'un candidat (288), **à valider** s'il y
  en a plusieurs (9, typiquement ABS / non-ABS ou 2G / 3G). **34 modèles-années n'ont aucune
  correspondance** : le catalogue e-catalog ne les a pas encore (Panigale V4 SP2 / Superleggera,
  Scrambler 2G 2023+, Streetfighter V4 3G…). Soit 426 rattachés fermement sur 469. Un rattachement
  décidé à l'écran (`origin = 'manuel'`) n'est **jamais** écrasé par une proposition automatique.
  *Équipe · 23/09.* [mission 07](missions/mission-07-plan-entretien.md)

- **M-29** — **Les 52 Go d'images des manuels ne vont ni dans le dépôt ni en base.** Seules les
  **26 384 images citées par les procédures d'entretien** comptent (**12,75 Go** : 13 198 figures
  pleine taille = 8,10 Go, 13 186 miniatures = 4,65 Go) — le reste de l'extraction concerne des
  sections hors entretien. Destination : **bucket Supabase Storage privé `wsm-images`**, lecture par
  URL signée pour les comptes de l'équipe, dédoublonnage par nom de fichier (les noms de
  l'extraction sont déjà des empreintes du contenu). `wsm_images` tient l'inventaire et l'état
  d'envoi, l'envoi est repris là où il s'est arrêté. **Recommandation : n'envoyer que les
  13 198 figures pleine taille (8,10 Go)** et afficher la vignette par redimensionnement à la volée
  de Storage, plutôt que de stocker deux fois la même image. *Équipe · 23/09.*
  [M08](modules/M08-atelier.md)

- **M-30** — **Deux formats de programme d'entretien dans les manuels, les deux sont chargés.** Les
  manuels récents nomment leurs révisions (Oil Service, Desmo Service, Annual Service…) ; **235 des
  469** n'ont qu'une **grille kilométrique** (« 1000 km », « 15000 km »…). Les échéances des seconds
  sont reconstruites depuis la grille : sans cela la moitié du parc arriverait sans aucune échéance.
  Échéance **au premier atteint** (km ou mois) partout, conformément à M-16. Les en-têtes de colonne
  qui ne sont pas des échéances (« km x 1000 », « Temps (mois) ») sont écartés.
  *Équipe · 23/09.* [M08](modules/M08-atelier.md)

## 2026-09-21 — Mission 06, carte 4 : reconnaître la moto par son VIN (choix de réalisation)

- **M-24** — **Reconnaissance du VIN hors ligne**, par une table de correspondance tirée de 2 975 VIN du parc
  reconnus par l'e-catalog : motif = caractères 1 à 9 + année (10e) → modèle-année du catalogue, avec nombre de
  motos vues et plage de n° de série **arrondie à la centaine** (aucun VIN complet, aucun lien client).
  Confiance : **unique** (un seul modèle-année, vu ≥ 5 fois : 94,9 % exact en validation croisée),
  **probable** (79,6 %), **plusieurs** (liste à choisir), **modèle**, **famille**, **inconnu**. Le VIN ne
  distingue souvent pas les versions d'un même modèle (Scrambler Icon / Classic / Full Throttle…) : on ne
  devine jamais une version, on propose la liste. **Seuls les champs vides sont remplis** ; une saisie
  différente est signalée (« d'après le VIN : … — Utiliser »). **`vehicles.ducati_model_year_id` n'est rempli
  automatiquement que si la confiance est unique** (déclencheur, `events` `vehicle_catalog_linked`) ; un choix
  fait à l'écran est tracé (`vehicle_catalog_set`) et **fait foi** : une moto détachée n'est jamais
  re-rattachée automatiquement. *Simon (« avec le VIN il fait aucun effort », 21/09) · réalisation Équipe 21/09.*
  [M03](modules/M03-vehicules.md), [mission 06](missions/mission-06-catalogue-pieces.md),
  [mission 04](missions/mission-04-fiche-client-moto.md)

## 2026-09-21 — Signature des e-mails et téléphone de la carte CRM (choix de réalisation)

- **P-7** — **Signature des e-mails selon l'adresse d'envoi**, ajoutée **côté serveur** (`graph-send-email`) à
  tous les envois, entre le message et l'invitation à l'espace client (P-5/P-6). Adresse personnelle → nom +
  fonction de l'utilisateur ; boîte partagée → **nom de la boîte, sans personne** ; puis coordonnées de la
  société (concession, adresse, téléphone, « E : » = adresse d'envoi, lien vers le site public), **réglables par
  société** dans la fiche société ; fonction réglable par l'utilisateur et par l'administrateur. Les coordonnées
  réelles sont en base, jamais dans le dépôt. Les textes proposés ne se terminent plus par le nom de la société.
  *Client (carte ERP du 21/09, modèles « Signature mail 1 et 2 ») · réalisation Équipe 21/09.*
  [M10](modules/M10-crm.md)
- **M-23** — **Le téléphone d'une carte CRM suit la règle des fiches** (M01, 21/09) : numéro seulement,
  stocké E.164, jamais une adresse e-mail (refus à l'écran, garde-fou en base sur `leads.phone`, cartes
  existantes réparées). *Client (carte ERP du 21/09) · Équipe.* [M10](modules/M10-crm.md),
  [mission 01](missions/mission-01-nouveau-client.md)

## 2026-09-21 — Mission 07, plans d'entretien (réalisation)

- **M-21** — **Plans d'entretien = données de référence globales** (comme le catalogue, M-19), chargées par
  `tools/maintenance-loader` ; **rattachement plan ↔ modèle-année du catalogue prudent** (nom exact + plage
  d'années = lié ; le reste à valider par l'atelier) ; la moto porte son **modèle-année du catalogue**
  (`vehicles.ducati_model_year_id`, rempli par la carte 06-4) et son **usage** (route par défaut). *Équipe · 21/09.*
  [mission 07](missions/mission-07-plan-entretien.md), [M03](modules/M03-vehicules.md)
## 2026-09-21 — Mission 03, réservation du stock des commandes non payées (choix de réalisation)

- **W-12** — **Une commande du site pas encore payée réserve le stock** des lignes reliées par des mouvements de
  réservation append-only (comme un bon RES), **sans créer de document ni de fiche client** avant le paiement (client
  seulement retrouvé par e-mail). Au paiement, la facture FAC (W-9) libère la réservation et sort le réel dans la même
  transaction. Libération à l'annulation, au paiement abandonné, à l'**expiration après 7 jours** (réglage société 1 à 60)
  et à l'**arrêt de l'import**. Même réglage Arrêté / Actif que l'import des commandes. *Équipe · 21/09, à valider par
  Simon.* [mission 03](missions/mission-03-shopify.md), [M05](modules/M05-stock.md), [M06](modules/M06-ventes-caisse.md)

## 2026-09-21 — Mission 03, reprise du stock et des prix des articles reliés au site

- **W-10** — **Stock de départ = stock du site Shopify ; prix de vente = prix du site ; le PV repris de G8 était
  hors TVA.** Pour les articles reliés, le stock réel du DMS est aligné sur le stock Shopify par un mouvement
  d'inventaire « annule et remplace » (origine `reprise_shopify`, sans prix d'achat : PAMP inchangé), et le prix de
  vente par un changement de prix tracé (origine `reprise_prix_shopify`) : **PV TTC = prix du site** (TVA comprise,
  W-7), **PV HT = prix du site ÷ (1 + TVA de l'article)** au centime. Rien n'est écrit sur le site. Appliqué en
  production le 21/09 sur les 300 articles reliés (259 mouvements, 305 pièces, 300 prix) ; bouton « Aligner le DMS
  sur le site (stock et prix) » pour les liaisons futures. *Simon (chat 21/09 : « stock Shopify », « prix du site »,
  « le prix était HTVA sans doute »).* [mission 03](missions/mission-03-shopify.md), [M02](modules/M02-articles.md),
  [M05](modules/M05-stock.md)

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
- **W-11** — **On garde les prix du site** (Simon, 21/09) : aucun arrondi n'est appliqué au prix envoyé à Shopify ; l'arrondi à l'euro supérieur de la société reste valable pour la caisse et les étiquettes. *Client · 21/09.* [mission 03](missions/mission-03-shopify.md)
- **M-22** — **Pas de modèles d'avant 2000** dans le catalogue (Simon, 21/09 : « pas besoin ») : annule la partie « modèles et années antérieurs » de M-20. Priorité : **lier les entretiens aux motos et aux pièces** (plans ↔ catalogue ↔ VIN ↔ kits). *Client · 21/09.*
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
- **K-7** — **Écran d'accueil de la borne à 3 tuiles** : « Configurer ma Ducati » (configurateur
  officiel, `configurator.ducati.com/bikes/be/fr`), « Créer mon compte » (le formulaire) et « Nos
  occasions » (`ducatibruxelles.be/collections/motos-doccasion-new`). Adresses réglables dans
  Paramètres → Borne d'inscription (vide = case masquée). **Pas de cadre (iframe)** : les deux sites
  l'interdisent (`X-Frame-Options: DENY`, vérifié le 21/09) ; ils s'ouvrent à la place de la borne et
  le retour à `/borne` est assuré par l'application kiosque de la tablette (liste blanche, bouton
  accueil, retour après inactivité). *Client (retour sur la carte « Borne comptoir en mode kiosque ») ·
  21/09.* [guide borne](guides/borne-kiosque.md)
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
