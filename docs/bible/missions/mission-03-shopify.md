---
mission: 03
titre: Shopify relié au stock du DMS
etat: 🟦
ouverte_le: 2026-09-18
modules: [M02, M05, M06, M11]
---

# Mission 03 — Shopify relié au stock du DMS

> **Objectif** : le site public Shopify (ducatibruxelles.be) affiche le stock, les prix, les photos et
> les textes du DMS, et chaque vente en ligne crée la vente et la sortie de stock dans le DMS.

Liste ERP : « Mission 03 — Shopify relié au stock du DMS » (mission Updates, client Ducati Waterloo).

## 1. Le besoin

Décisions W-1 à W-4 du 18/09 (voir [`../decisions.md`](../decisions.md)) : l'e-shop intégré au DMS est
supprimé ; Shopify reste le site public ; le DMS fait foi pour le stock, le prix, les photos et les textes,
après une reprise initiale des photos et textes depuis Shopify ; une vente Shopify crée la vente et la
sortie de stock dans le DMS.

## 2. Accès à Shopify — À NE PAS PERDRE

| Élément | Valeur | Où |
|---|---|---|
| Boutique (adresse technique) | `ducati-bruxelles.myshopify.com` | Admin Shopify → Paramètres → Domaines |
| Domaines publics | `ducatibruxelles.be` (principal), `www.ducatibruxelles.be`, `shop.ducatibruxelles.be` | idem |
| Compte admin Shopify utilisé | Domenico Desouter (media@ducatibxl.be) | — |
| Application de liaison | « DMS Ducati Bruxelles », créée dans le **Dev Dashboard** de Shopify | Admin Shopify → Paramètres → Applications → Développer des applications → Dev Dashboard |
| Mode d'accès | **client credentials grant** : le DMS échange Client ID + Client secret contre un jeton valable 24 h, renouvelé automatiquement | [doc Shopify](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens) |
| Secrets (jamais dans le dépôt, jamais dans le chat) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Secrets des fonctions Supabase (`npx supabase@2.117.0 secrets list --project-ref ujmrosbgkvgvwfnuryna`) |
| Droits (scopes) de l'application | `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`, `read_orders`, `read_customers` | Dev Dashboard → application → Versions |

Condition Shopify : l'application et la boutique doivent appartenir à la **même organisation** Shopify,
sinon l'échange de jeton échoue (`application_cannot_be_found`).

Pour renouveler le secret : Dev Dashboard → application → Settings → régénérer le Client secret, puis
`npx supabase@2.117.0 secrets set SHOPIFY_CLIENT_SECRET=… --project-ref ujmrosbgkvgvwfnuryna` (à faire
par une personne, pas par l'IA).

### Mise en route (à faire une fois, par Simon, avec son compte Shopify)

L'application est décrite dans le dépôt : [`integrations/shopify-app/shopify.app.toml`](../../../integrations/shopify-app/shopify.app.toml)
(nom, droits). Depuis ce dossier :

1. `npx @shopify/cli@latest app config link` → connexion Shopify dans le navigateur → « Create a new app »
   → nom « DMS Ducati Bruxelles ». Le `client_id` s'écrit tout seul dans le fichier.
2. `npx @shopify/cli@latest app deploy` → publie une version de l'application avec ses droits.
3. Dev Dashboard → l'application → Install app → boutique Ducati Bruxelles.
4. Dev Dashboard → l'application → Settings : copier Client ID et Client secret, puis
   `npx supabase@2.117.0 secrets set SHOPIFY_STORE_DOMAIN=ducati-bruxelles.myshopify.com SHOPIFY_CLIENT_ID=… SHOPIFY_CLIENT_SECRET=… --project-ref ujmrosbgkvgvwfnuryna`
5. Vérification : fonction serveur `shopify-ping` (nom de la boutique, droits accordés, nombre de produits, emplacements).

## 3. Lots (cartes ERP)

| Carte | État |
|---|---|
| Donner au DMS l'accès à la boutique Shopify | ✅ 19/09 — vérifié : 1 595 produits, 1 emplacement, droits OK |
| Questions Shopify à trancher avant de coder | ⬜ en attente de réponses |
| Voir les produits Shopify et les rapprocher des articles du stock | 🟦 19/09 — fait, à valider : écran Pièces & Accessoires → Produits Shopify, 300 liaisons automatiques exactes |
| Reprendre une fois les photos et textes de Shopify dans le DMS | 🟦 19/09 — fait, à valider : reprise réelle des 300 produits reliés (chiffres en §5) ; bouton « Reprendre photos et textes » sur l'écran Produits Shopify |
| Le stock et le prix du DMS s'affichent en direct sur le site | ⬜ |
| Une vente sur le site crée la vente et la sortie de stock dans le DMS | 🟦 21/09 — fait, à valider : écran Ventes → Commandes du site ; import **livré Arrêté** (Simon l'active) ; webhooks à publier par Simon (§5) |
| Publier ou retirer un article du site depuis sa fiche dans le DMS | ⬜ |

## 4. Questions en attente

1. ~~Les produits Shopify portent-ils la référence de l'article (SKU = référence Ducati / code DMS) ?~~
   **Oui pour la plupart, mais peu existent dans le DMS** (lecture réelle du 19/09) :
   - 1 595 produits, **3 105 variantes** (1 102 en ligne, 2 002 brouillons, 1 archivée) ;
   - **2 806 variantes ont un SKU** (1 335 produits), 299 n'en ont pas ; 616 ont un code-barres ;
   - 2 650 SKU ont la forme d'une référence Ducati (chiffres + lettres, ex. `82411461A`, `8291F721AA`,
     `46410541B`, `981090260`) ; 155 ont une autre forme (lettres au milieu comme `969A05208B`, ou texte
     libre comme `DESERTX`, `SUPPORT GOPRO SBK`) ;
     12 SKU sont portés par plusieurs variantes ;
   - **300 variantes ont un SKU identique à une référence du DMS** et ont été reliées automatiquement
     (toutes uniques ; 258 sur des produits en ligne ; toutes vers des articles de type A) ;
     aucune par code-barres (le DMS n'a que 2 codes-barres enregistrés) ;
   - les **2 506 autres SKU ne correspondent à aucune référence**, même sans tirets ni espaces :
     **1 994 commencent par 98** (vêtements et accessoires Ducati, ex. `981090260`) alors que le DMS n'a
     qu'**un seul** article en `981…`. Le catalogue vêtements n'est donc pas encore dans le DMS : c'est la
     vraie question à trancher (reprise G8 ou import catalogue Ducati), liée à la question 5 ;
   - 9 SKU sont d'anciennes références remplacées dans le DMS (proposées en suggestion).
2. ~~Combien d'emplacements de stock dans Shopify ?~~ **Un seul** : « Chaussée de Bruxelles 688 » (vérifié le 19/09).
3. Vente en magasin avec la caisse Shopify, ou seulement en ligne ?
4. ~~Prix Shopify TVA comprise ?~~ **Oui (Simon, 21/09)** : le DMS déduit le HT par la TVA de l'article.
5. ~~Produit Shopify sans article dans le DMS ?~~ **Décidé le 21/09** : les vêtements et accessoires Ducati (« 98… ») viennent de l'e-catalog (mission 06, carte 7), puis liaison W-6.
6. ~~Frais de port ?~~ **Ligne à part sur la vente du DMS (Simon, 21/09).**

Question 3 (caisse Shopify en magasin) : recommandation du 21/09 = **non** — la caisse Shopify n'accepte pas Bancontact en magasin (seul lecteur Belgique : WisePad 3) et doublerait caisse et stock ; encaisser au comptoir par la caisse du DMS (QR virement + terminal Bancontact au choix). En attente du feu vert de Simon, ainsi que de son accord pour que le DMS écrive sur le site (essai sur 1 à 3 produits).

Décidé le 19/09 : **W-5** l'inscription du site Shopify renvoie vers `/app-client` (page « bientôt disponible ») ; **W-6** liaison des clients Shopify : correspondances exactes seulement en automatique, les autres validées à la main.

## 5. Ce qui a changé dans l'application

Point de départ gardé lors du nettoyage du 18/09 : la case « publiable » de la fiche article.

**19/09 — « Voir les produits Shopify et les rapprocher des articles du stock »** (branche
`lot-shopify-rappro`, à valider) :

- Nouvel écran **Pièces & Accessoires → Produits Shopify** (`/parts/shopify`) : image, titre, SKU, prix,
  stock Shopify et article du DMS relié ; compteurs (variantes, liées automatiquement, liées à la main,
  à valider, ignorées, sans SKU) ; filtres. Administrateurs : **Relire Shopify**, **Lier** (suggestions +
  recherche), **Délier**, **Ignorer**. Vendeurs : lecture seule.
- Fonction serveur `shopify-sync-products` : lit toute la boutique en lecture seule (pages de 50 variantes,
  pause si Shopify limite), écrit l'instantané `shopify_products`, puis applique la règle W-6.
- Tables `shopify_products` et `shopify_links`, décisions tracées dans `events`
  (migration `20260919270000_m2_shopify_products.sql`, appliquée le 19/09).
- Détail et pièges : [M02 Articles](../modules/M02-articles.md) §2, §3, §4, §7.

**19/09 — « Reprendre une fois les photos et textes de Shopify dans le DMS »** (branche
`lot-shopify-photos`, à valider ; décision W-4 : ensuite le DMS fait foi) :

- Pour chaque produit Shopify **relié** à un article (liaison automatique exacte ou validée à la main) :
  le **titre** et la **description** (HTML Shopify nettoyé : paragraphes, listes, gras, italique, titres,
  liens sûrs ; scripts, styles, attributs et images intégrées retirés) vont dans les nouveaux champs
  **Titre sur le site** / **Description sur le site** de la fiche article (section « Site web ») ; **toutes
  les images** du produit (image principale d'abord, 2048 px maximum) sont **téléchargées depuis Shopify et
  stockées dans le DMS** (Storage privé `ged`, GED de l'article, dossier « Photos », texte alternatif
  Shopify ou, à défaut, titre du produit). Plus aucun lien vers le CDN Shopify.
- **Rien n'est écrasé** : un titre ou une description déjà saisis dans la fiche sont gardés ; le texte
  Shopify est alors noté à côté (encadré « Texte Shopify non repris » sous la description). Les photos du DMS
  restent ; seules les images Shopify manquantes sont ajoutées.
- **Relançable sans doublon** (clé = id d'image Shopify) : écran Produits Shopify → **Reprendre photos et
  textes** (tous les produits reliés pas encore repris, en erreur ou incomplets) ou **Reprendre** sur une
  ligne (ce produit seulement). Utile quand de nouvelles liaisons sont validées.
- Fonction serveur `shopify-import-content` (lecture seule Shopify, Admin GraphQL 2026-07, lots de 8 produits,
  pauses si Shopify limite, rend la main toutes les 70 s). Migration `20260919320000_m2_shopify_content_import.sql`
  (appliquée le 19/09) : `articles.web_title`, `articles.web_description`, `attachments.alt_text / sort_order /
  external_id`, table `shopify_content_imports`. Trace dans `events` : action `shopify_content_import`,
  origine `reprise_shopify`.
- **Reprise réelle du 19/09** (déclenchée depuis la base, clé x-cron-secret) : voir chiffres ci-dessous.

  | Vérifié en base le 19/09 | Nombre |
  |---|---|
  | Produits reliés repris (sur 300) | **300**, 0 en erreur, 0 incomplet |
  | Articles enrichis : titre web / description web remplis | **300** / **300** |
  | Articles où le texte du DMS a été gardé | **0** (aucun des 300 n'avait de texte web ni de photo avant la reprise) |
  | Images Shopify lues / stockées dans le DMS | **1 038** / **1 038** (137 Mo, 3,5 images par produit en moyenne) |
  | Traces `events` (`shopify_content_import`) | 301 (une relance d'un produit interrompu) |
  | Relance à blanc d'un produit déjà repris | 0 image ajoutée, 0 texte modifié (idempotence vérifiée) |

**21/09 — « Une vente sur le site crée la vente et la sortie de stock dans le DMS »** (branche
`lot-shopify-ventes`, à valider ; décisions W-4, W-7, D3, D2 ; choix de réalisation W-9) :

- **Réception** : fonction serveur `shopify-orders` (déployée le 21/09, `verify_jwt = false`, contrôle dans le code).
  - **Webhooks** `orders/create`, `orders/paid`, `orders/cancelled`, `refunds/create` : signature
    `X-Shopify-Hmac-Sha256` vérifiée (HMAC-SHA256 du corps brut, clé = **Client secret** de l'application, secret
    `SHOPIFY_CLIENT_SECRET` ; confirmé par la doc Shopify « Deliver webhooks through HTTPS » : « generated using your
    app's client secret ») et domaine de la boutique vérifié. Le corps ne sert qu'à trouver la commande, **relue ensuite
    par l'API GraphQL** (une seule forme de données, toujours à jour). Réponse 200 même si l'import échoue (statut
    « Erreur » + Réessayer ; le rattrapage repasse).
  - **Rattrapage planifié** `shopify-orders-catchup` (pg_cron toutes les 15 min, `x-cron-secret` lu dans le coffre Vault) :
    relit les commandes modifiées depuis la dernière relecture (marge 10 min, 3 jours au plus). **Aucun appel tant que
    l'import est Arrêté.**
  - Déclaration des webhooks : `integrations/shopify-app/shopify.app.toml` (`[[webhooks.subscriptions]]`), **à publier
    par Simon** (voir « Mise en route des webhooks » ci-dessous). En attendant, le rattrapage suffit.
- **Réglage société « Import des commandes du site »** (Arrêté / Actif, administrateurs, tracé `events`
  `shopify_orders_import_setting`) : **livré Arrêté**. À l'activation, seules les commandes passées **après** l'activation
  sont importées (les précédentes ont été traitées hors DMS : pas de double sortie de stock).
- **Commande payée** (`PAID`, `PARTIALLY_REFUNDED`, `REFUNDED` ; pas encore payée → « Pas encore payée » ; commande de
  test → ignorée), en **une seule transaction SQL** `_shopify_order_apply` :
  - **client** retrouvé par e-mail (minuscules, hors fournisseurs ; plusieurs fiches → la plus ancienne fiche client,
    noté en avertissement, **jamais de fusion**, D3) ; sinon **fiche créée** (particulier, statut **client** car D2 : une
    fiche facturée est client ; origine `web`, `imported_from = shopify`, id client Shopify dans `external_ref`). Une fiche
    prospect retrouvée passe client (D2, tracé par l'audit) ;
  - **facture validée `FAC`**, pas un bon de commande : la commande est **déjà payée** et la marchandise part, c'est la
    vente définitive ; FAC est le type qui sort le **stock réel** et porte le règlement (M06 §4), comme l'ancien e-shop.
    Département **E-shop** (filtre de la liste des ventes) par `imported_from = 'shopify'` ; opérateur « Site Shopify » ;
    date = date de la commande (Bruxelles) ;
  - **une ligne par article relié** (`shopify_links` automatique ou validé) : prix TTC Shopify → HT par le **taux de TVA
    de l'article** (W-7 ; 21 % si l'article n'en a pas) ; remise Shopify en **remise de ligne** ; **frais de port = ligne à
    part** « Frais de port — transporteur » (taux Shopify, sinon 21 %) ; si la somme s'écarte du total Shopify : net TTC
    forcé = total Shopify + avertissement ;
  - **produit non relié** : ligne libre avec son montant, **sans article** (jamais d'article inventé) ; commande « À relier »,
    nombre à relier dans la cloche. Une fois le produit relié (Produits Shopify), **Réessayer** pose l'article sur la ligne
    de la facture et sort le stock (`shopify_order_relink`) ; les montants de la facture ne changent pas ;
  - **sortie de stock réel** par `record_stock_move` (origine `shopify`, réf. = n° de facture, append-only B7) ;
  - **règlement reçu** : nouveau moyen **`SHOP` « Shopify Payments »** (masqué en caisse) ; `PPL` pour PayPal, `VIR` pour
    « Bank Deposit » (payé à la main), `CHQC` pour une carte cadeau ; facture « payée » ;
  - **cloche « Nouvelle commande web »** (vendeurs + administrateurs, 7 jours, mène à la facture) ; trace `events`
    `shopify_order_import` (en plus de l'audit des documents, lignes et règlements).
- **Remboursement** : **un avoir `AVO` par remboursement Shopify** (sans doublon : clé = id du remboursement) ; lignes
  remboursées en négatif au prorata de la ligne facturée ; **stock réintégré seulement si Shopify a remis l'article en
  stock** ; écart (port remboursé, geste commercial) en ligne « Ajustement du remboursement » à 21 % ; règlement négatif ;
  facture « annulée » quand tout est remboursé (même flux que « Générer un avoir »). Un remboursement à 0 € (vu en réel
  sur #1209) ne crée pas d'avoir : commande « À vérifier ». **Annulation** : avant paiement → « Annulée », rien dans le
  DMS ; après import sans remboursement → « À vérifier ».
- **Écran Ventes → Commandes du site** (`/sales/web-orders`, administrateurs + vendeurs, entrée du menu) : réglage Arrêté /
  Actif (avec confirmation), « Relire maintenant » (admin), filtre et compteurs par statut (Importée, À relier, Erreur, Pas
  encore payée, Annulée, Commande de test, À vérifier ; couleur + icône + libellé), client (fiche créée signalée), total,
  paiement Shopify, lien vers la facture et les avoirs, produits à relier (lien Produits Shopify), message d'erreur,
  **Réessayer**.
- Code : `supabase/functions/shopify-orders/index.ts` ; règles pures `supabase/functions/_shared/shopify-order.ts`
  (tests `tests/shopify-orders.test.ts` : HMAC, TTC→HT multi-taux, port en ligne séparée, produit non relié, idempotence
  des remboursements, avoir) ; `src/modules/sales/web-orders-api.ts` ; `src/routes/_app.sales.web-orders.tsx` ; cloche
  `src/components/layout/topbar.tsx`. Migration `20260921120000_m6_shopify_commandes_site.sql` (appliquée le 21/09).
- **Vérifié le 21/09** : lecture réelle, **sans écriture**, des 8 commandes des 60 derniers jours (#1209 à #1216) : e-mail
  et client lisibles (accès aux données client accordé), prix TVA comprise à 21 %, port de 18,20 € à 108,50 €, passerelles
  `shopify_payments`, `paypal`, `Bank Deposit` ; 2 commandes sur 8 ont leur produit relié (les 6 autres seraient
  « À relier ») ; totaux recalculés = totaux Shopify au centime. Scénario complet (import, webhook renvoyé, produit relié
  après coup, remboursement avec remise en stock, remboursement renvoyé) joué dans une **transaction annulée** :
  1 facture, 1 sortie de stock, 1 avoir, 1 réintégration, 1 cloche, import refusé tant que le réglage est Arrêté.
  Aucune commande réelle importée, aucune donnée de test laissée, aucun mail.

### À tester (Simon)

1. Ventes → **Commandes du site** : réglage « Arrêté », liste vide.
2. Faire la « Mise en route des webhooks » ci-dessous, puis passer le réglage à **Actif**.
3. Passer une vraie petite commande sur le site avec un produit **relié** (Produits Shopify → « Relié ») : en moins d'une
   minute (webhook) ou au plus 15 min (rattrapage) → ligne « Importée », cloche « Nouvelle commande web », facture FAC
   payée « Shopify Payments » avec la ligne de port à part, stock de l'article diminué, fiche client retrouvée ou créée.
4. Commande avec un produit **non relié** → « À relier » ; relier le produit dans Produits Shopify → **Réessayer** →
   « Importée », stock sorti.
5. Rembourser la commande dans Shopify (avec remise en stock) → avoir AVO lié à la facture, stock réintégré, facture
   « annulée » si tout est remboursé.

### Mise en route des webhooks (Simon, une fois)

Depuis le dossier `integrations/shopify-app/` : `npx @shopify/cli@latest app deploy` (publie une version de
l'application avec les abonnements aux webhooks de `shopify.app.toml`). Si Shopify refuse les webhooks de commandes :
Dev Dashboard → l'application → **API access requests → Protected customer data** (niveau 1 ; raison : « gestion des
commandes dans notre logiciel de gestion »), puis relancer `app deploy`. Le rattrapage toutes les 15 minutes marche
sans cette étape.

## 6. Risques

- Double vérité sur le stock pendant la reprise : figer les modifications côté Shopify le temps de la reprise.
- Limites d'appels de l'API Shopify : regrouper les mises à jour de stock.
- Commandes du site : une commande payée par virement (« Bank Deposit ») n'entre dans le DMS qu'une fois marquée payée
  dans Shopify ; d'ici là, le stock du DMS ne la voit pas (Shopify l'a déjà réservée de son côté).
- Tant que peu de produits sont reliés (300 variantes sur 3 105), la plupart des commandes seront « À relier » :
  facture et règlement justes, mais stock sorti seulement après liaison + « Réessayer ».
- Le droit `read_orders` ne donne accès qu'aux 60 derniers jours de commandes : « Réessayer » échoue au-delà.
