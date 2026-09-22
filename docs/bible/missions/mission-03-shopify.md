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
| Le stock et le prix du DMS s'affichent en direct sur le site | 🟦 21/09 — fait, livré en mode **Arrêtée** (rien n'est écrit sur le site) ; essai à lancer par Simon (§5 bis) |
| Une vente sur le site crée la vente et la sortie de stock dans le DMS | ⬜ |
| Publier ou retirer un article du site depuis sa fiche dans le DMS | 🟦 21/09 — fait, soumis au même mode essai (livré Arrêtée) |
| Reprendre le stock et vérifier les prix de vente des articles reliés au site | 🟦 21/09 — fait, à valider : reprise réelle des 300 articles reliés (§5 ter) ; bouton « Aligner le DMS sur le site (stock et prix) » |
| Réserver le stock dès qu'une commande du site est passée, même non payée | 🟦 21/09 — fait, à valider (§5 quater) ; même réglage Arrêté / Actif que l'import des commandes (livré Arrêté) |
| Un seul catalogue : chaque produit du site est un article du DMS (M-25) | 🟦 22/09 — fait, à valider (§5 quinquies) ; migrations `20260921200000` + `20260921201000` à appliquer |

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
## 5 bis. Le DMS écrit sur le site — mode essai (W-8, 21/09)

**Sécurité** : réglage société « Synchronisation Shopify » (écran Pièces & Accessoires → Produits Shopify,
encadré en haut) :

| Mode | Effet |
|---|---|
| **Arrêtée** (défaut, livré ainsi) | Rien n'est écrit sur le site. Les demandes s'accumulent dans la file (une ligne par article). |
| **Essai** | Seuls les **articles d'essai** choisis par un administrateur sont écrits (stock, prix, publication). |
| **Tous les articles reliés** | Tous les articles reliés sont écrits ; tout article « Publiable » peut être publié. |

Chaque changement de mode est tracé dans `events` (`shopify_sync_mode`).

### Lancer l'essai (Simon)

1. Produits Shopify → encadré « Synchronisation Shopify » → **Articles d'essai** : ajouter 1 à 3 articles
   **reliés** (badge « Relié »), idéalement des produits peu vendus.
2. **Simuler (rien n'est écrit)** : tableau prix site / prix DMS TTC / stock site / stock DMS. Vérifier chaque ligne.
3. Choisir le mode **Essai** (confirmation). Les articles d'essai partent au prochain passage (≤ 3 min) ou
   tout de suite avec **Envoyer maintenant**.
4. Vérifier sur ducatibruxelles.be et dans le **Journal des envois**.
5. Faire un mouvement de stock sur un article d'essai → le site suit en ≤ 3 min.
6. Revenir à **Arrêtée** à tout moment : plus rien ne part.

**⚠ Constat du 21/09 (simulation en lecture seule sur les 300 articles reliés)** : le DMS n'a **aucun stock**
sur ces 300 articles (259 ont du stock sur le site, 305 pièces au total) et leur **prix de vente TTC du DMS
est environ 20 % plus bas** que le prix du site (médiane : prix site = 1,245 × prix DMS ; 293 moins chers,
2 plus chers, 5 sans prix). Passer en « Tous » aujourd'hui mettrait le site à 0 et baisserait les prix.
À trancher avant l'essai : reprise du stock G8 et vérification des prix de vente (TTC ou HT ?) dans le DMS.
**→ Tranché et corrigé le 21/09 (W-10), voir §5 ter.**

### Ce qui part vers le site (carte « Le stock et le prix du DMS s'affichent en direct »)

- **Stock** = disponible du DMS (réel − réservé, B4), entier, jamais négatif, à l'emplacement unique
  « Chaussée de Bruxelles 688 » ; types A, V, O, P, D seulement. Un article pas suivi en stock sur Shopify
  est passé en suivi ; un article pas stocké à l'emplacement y est activé.
- **Prix** (W-7) = prix de vente TTC du DMS (à défaut PV HT × (1 + taux de TVA de l'article)), avec l'arrondi
  de la société (euro supérieur, plancher 2 €) ; aucun prix du DMS → prix du site inchangé (jamais 0 €).
- **Déclenchement** : mouvement de stock, changement de PV TTC / PV HT / taux de TVA, nouvelle liaison,
  changement du réglage d'arrondi → l'article relié entre dans la file `shopify_sync_queue` (dédoublonnée).
  Tâche `shopify-push` toutes les 3 min, **seulement** si une société n'est pas « Arrêtée » et a du travail.
- **Rien n'est réécrit** si le site est déjà à jour (« Déjà à jour » au journal). Erreur → nouvel essai
  automatique (2, 4, 8… min, 60 min au plus).
- **Tout resynchroniser** (administrateurs) : remet tous les articles reliés en file ; le mode décide.

### À tester (carte stock + prix)

- [ ] Mode Arrêtée : un mouvement de stock d'un article relié n'écrit rien (journal vide, file +1).
- [ ] Essai sur 1 à 3 articles : simulation, puis envoi ; prix et stock du site = DMS.
- [ ] Vente / réservation dans le DMS → stock du site mis à jour en ≤ 3 min.
- [ ] Changement de prix d'un article d'essai → prix du site en ≤ 3 min, arrondi à l'euro supérieur.
- [ ] Un article hors essai n'est jamais écrit en mode Essai.
- [ ] Retour à Arrêtée : plus rien ne part.

### Publier ou retirer depuis la fiche article (carte « Publier ou retirer »)

Fiche article → section **Site web** → encadré **Sur le site Shopify** : état (Pas sur le site / En ligne /
Retiré (brouillon) / Archivé, couleur + icône + libellé), prix et stock du site, derniers envois.
Administrateurs, selon le mode (Arrêtée : rien ; Essai : article d'essai seulement ; Tous : tout article) :

- **Publier sur le site** (case « Publiable » cochée et enregistrée, prix de vente présent) : crée le produit
  Shopify (`productSet`) avec titre web (sinon désignation), description web, photos du DMS (liens signés 24 h
  vers le Storage), prix TTC, stock disponible, **SKU = référence**, puis le relie (`shopify_links` « valide »).
  Refus si un produit du site porte déjà cette référence (le relier depuis Produits Shopify : jamais de doublon).
- **Retirer du site** : produit en **brouillon** (jamais supprimé). **Remettre en ligne** le repasse actif.
- **Mettre à jour sur le site** : renvoie titre et description, ajoute les photos du DMS pas encore envoyées
  (les photos reprises de Shopify ne sont pas renvoyées).
- Trace : `events` (`shopify_publication`, `shopify_retrait`, `shopify_remise_en_ligne`, `shopify_mise_a_jour`,
  `shopify_link`) + journal des envois. Fonction `shopify-publish`, migration `20260921111000_m2_shopify_publication.sql`.
- Point ouvert : l'application n'a pas le droit `write_publications` ; un produit créé est « Actif » mais peut ne
  pas apparaître sur le canal **Boutique en ligne** tant qu'il n'y est pas coché dans Shopify (à vérifier à l'essai).

### À tester (carte publication)

- [ ] Mode Arrêtée : boutons grisés, message « Synchronisation Shopify arrêtée ».
- [ ] Essai : publier un article d'essai « Publiable » non relié → produit visible sur le site, relié dans Produits Shopify.
- [ ] Retirer → brouillon sur Shopify ; Remettre en ligne → actif.
- [ ] Mettre à jour après changement du titre web / ajout d'une photo.
- [ ] Publier une référence déjà présente sur le site → refus clair.

## 5 ter. Reprise du stock et des prix des articles reliés (W-10, 21/09)

Carte « Reprendre le stock et vérifier les prix de vente des articles reliés au site » (branche `lot-shopify-stock`,
à valider). Décision de Simon : **stock de départ = stock Shopify ; prix = prix du site ; le prix G8 était HTVA**.

**Ce qui était faux.** Le calcul du prix envoyé au site (`shopifyTtc`) était juste (PV TTC du DMS, sinon PV HT ×
(1 + TVA de l'article), puis arrondi société sur le TTC). C'est la **donnée** qui était fausse : l'import G8 a rangé
le prix de vente G8, **hors TVA**, dans `articles.sale_price_ttc` (PV HT vide). Sur les 300 articles reliés : prix
du site = 1,245 × prix DMS pour 253 (1,21 de TVA × environ 1,03, tarif plus récent sur le site), 1,283 pour 23,
**11 prix G8 divisés par 1 000** (séparateur de milliers mal lu : 1,74 € au lieu de 2 169,04 €), 1 prix ×5, 5 sans
prix ; aucun mouvement de stock.

**Ce qui est livré.**
- Fonction SQL `shopify_realign(société, appliquer)` (migration `20260921140000_m2_shopify_reprise_stock_prix.sql`,
  appliquée le 21/09) : **aperçu** (rien n'est écrit) ou **application**, réexécutable (un article déjà aligné n'est
  pas touché). Pour chaque article relié (liaison automatique ou validée, variante encore sur le site) :
  - **stock** : si le réel du DMS ≠ stock Shopify de l'instantané (« Relire Shopify » avant) → un mouvement
    **inventaire** « annule et remplace » (B6) par `record_stock_move`, origine `reprise_shopify`, réf. « Reprise
    Shopify », note « ancien → nouveau », opérateur = l'administrateur qui clique (vide pour une exécution système) ;
    **sans prix d'achat** : le PAMP ne bouge pas (voir M05 §7) ;
  - **prix** : PV TTC = prix du site, PV HT = prix du site ÷ (1 + TVA de l'article, 21 % à défaut), au centime,
    par `record_price_change` (trace `price_changes`, origine `reprise_prix_shopify`), **seulement si différent** ;
    prix verrouillé, occasion TVA marge (O) ou pas de prix sur le site : prix inchangé ;
  - une trace de synthèse `events` (`shopify_realign`). **Rien n'est écrit sur Shopify** ; le mode reste « Arrêtée ».
- Écran **Produits Shopify** → bouton admin **« Aligner le DMS sur le site (stock et prix) »** : compteurs, liste des
  écarts (référence, stock DMS → site, PV HT actuel → nouveau, PV TTC actuel → prix du site, remarques), confirmation,
  compte rendu. Code : `src/modules/articles/shopify-realign-dialog.tsx`, `shopify-sync-api.ts` (`shopifyRealign`),
  règles miroir testées `src/modules/articles/shopify-realign-rules.ts` (`tests/shopify-realign.test.ts`).
- Simulation de synchronisation : un écart de prix qui ne vient **que** de l'arrondi société est désormais signalé
  « écart dû seulement à l'arrondi à l'euro supérieur de la société » (`shopify-push` redéployée le 21/09).

**Reprise réelle du 21/09** (instantané Shopify relu à 12:57 UTC, testée d'abord en transaction annulée) :

| Vérifié en base le 21/09 | Nombre |
|---|---|
| Articles reliés traités | **300** |
| Mouvements d'inventaire « reprise Shopify » | **259** (les 41 autres sont à 0 sur le site comme dans le DMS) |
| Pièces en stock DMS sur ces articles | **0 → 305** (221 articles à 1, 32 à 2, 4 à 3, 2 à 4) |
| Changements de prix « reprise prix site Shopify » | **300** (dont 5 articles sans prix, 11 prix G8 divisés par 1 000, 1 prix ×5) |
| Prix qui baissent | 2 : `480P5681CT` 436,37 → 250,00 € et `48120742AA` 649,65 → 350,00 € (prix du site, peut-être soldés) |
| Remarques | 2 articles en **librairie** ont reçu du stock (`8291E222A`, `96880411A`) |
| 2e exécution (aperçu) | 0 mouvement, 0 prix : idempotente |
| PAMP modifiés | 0 |

**Nouvelle simulation (lecture seule, 300 articles, 21/09 après la reprise)** : **0 écart de stock** ; **0 écart
de prix réel** ; 3 « déjà à jour » ; **297 prix seraient arrondis à l'euro supérieur** par le réglage société
« arrondir les prix de vente » (+0,01 à +0,99 €, +153,60 € au total), car les prix du site ne sont pas ronds.
**À trancher par Simon avant « Tous »** : désactiver l'arrondi de la société (Paramètres → société ; il vaut aussi
pour la caisse et les étiquettes) ou accepter des prix du site arrondis à l'euro supérieur.

**À tester (Simon)**
- [ ] Produits Shopify → « Aligner le DMS sur le site » : aperçu « déjà aligné », 0 à appliquer.
- [ ] Fiche d'un article relié : stock réel = stock du site ; historique : mouvement « inventaire », origine reprise
      Shopify ; PV TTC = prix du site, PV HT = TTC ÷ 1,21 ; historique des prix : origine reprise prix site Shopify.
- [ ] Relier un nouveau produit, « Relire Shopify », puis « Aligner » : seul ce produit apparaît dans l'aperçu.
- [ ] Simulation d'un article d'essai : prix site = prix DMS (hors arrondi), stock site = stock DMS.

**Points ouverts**
- Les **~81 000 autres articles G8** ont le même défaut probable (PV G8 hors TVA rangé en TTC, milliers mal lus) :
  la caisse et les devis les vendent au prix G8 **comme s'il était TTC**. Non corrigé ici (hors carte) : à vérifier
  avec Simon et à corriger par une carte dédiée.
- PAMP : ces 305 pièces entrent **sans valeur** (PA et PAMP à 0). À la première réception avec prix d'achat, le PAMP
  sera la moyenne pondérée avec ces pièces à 0 (ex. 1 pièce reprise + 1 reçue à 100 € → PAMP 50 €). Saisir un PA
  (ou passer un inventaire valorisé) si la valeur de stock compte avant.

## 5 quater. Réservation du stock des commandes non payées (W-12, 21/09)

Carte « Réserver le stock dès qu'une commande du site est passée, même non payée » (branche `lot-shopify-resa`,
à valider). Pourquoi : une commande payée par virement (« Bank Deposit ») n'entrait dans le DMS qu'une fois payée ;
entre-temps la pièce pouvait être vendue au comptoir, et le DMS renvoyait au site un disponible trop haut.

**Ce qui est livré** (rien ne se passe tant que « Import des commandes du site » est Arrêté ; rien n'est écrit sur Shopify) :
- **Commande pas encore payée** (Shopify `PENDING`, `AUTHORIZED`, `PARTIALLY_PAID`, reçue par webhook `orders/create` /
  `orders/updated` ou par le rattrapage) → **réservation du stock** des lignes reliées (articles A, V, O, P, D de la
  société), par le **mécanisme existant des bons de réservation RES** : mouvement `reservation` append-only
  (`record_stock_move`, `is_reservation`, origine `shopify`, réf. = n° de commande du site « #1216 »). Le disponible du DMS
  (réel − réservé, B4) baisse aussitôt ; le mouvement met l'article dans la file `shopify-push`, qui renvoie au site le
  nouveau disponible (quand la synchronisation n'est pas Arrêtée). Une ligne non reliée ne réserve rien.
- **Client** : retrouvé par e-mail (même règle que l'import, D3) et noté sur la réservation et la commande ; **jamais créé
  avant le paiement**.
- **Commande modifiée** avant paiement → réservation ajustée (réservation ou libération de l'écart, ligne retirée libérée).
- **Paiement** → dans la **même transaction** que l'import de la facture FAC (W-9) : libération de la réservation
  (`liberation`, réf. = n° de facture) puis sortie du stock réel par la facture. **Aucun double comptage** : le disponible
  ne bouge pas au paiement (vérifié : 2 réservées → payée → réel −2, réservé 0).
- **Annulation** sur le site, paiement annulé ou expiré (`VOIDED`, `EXPIRED`) → libération.
- **Expiration** : commande toujours pas payée **7 jours** (réglage société, 1 à 60) après sa création → libération par la
  tâche planifiée existante `shopify-orders-catchup` (toutes les 15 min, désormais `_cron_shopify_orders_tick` : expiration
  dans la base, puis appel de la fonction serveur si une société a l'import Actif). Une réservation expirée n'est jamais
  reprise ; si la commande est payée ensuite, elle est importée normalement.
- **Import passé à Arrêté** → les réservations en cours sont libérées (ces commandes ne seront jamais importées).
- **Idempotent** : une réservation par ligne de commande Shopify ; un webhook rejoué ne crée aucun mouvement.
- **Traces** : chaque mouvement dans `events` (`shopify_order_reservation` : commande, ligne, article, client, quantité,
  motif) ; changement de durée (`shopify_orders_reservation_days`) ; l'import note les réservations libérées.
- **Écran Ventes → Commandes du site** : statut **« Réservée (en attente de paiement) »** (couleur + icône + libellé,
  filtre et compteur), « n pièce(s) réservée(s) jusqu'au … », « Réservation libérée le … » ; encadré « Réservation du stock
  des commandes non payées » avec la durée (administrateurs).
- Code : migration `20260921150000_m6_shopify_reservation_commandes.sql` (table `shopify_order_reservations`, colonne
  `shopify_order_settings.reservation_days`, fonctions `_shopify_order_reservations_sync`, `_shopify_reservations_expire`,
  `shopify_orders_set_reservation_days`, `_cron_shopify_orders_tick` ; `_shopify_order_apply` et `shopify_orders_set_import`
  redéfinies) ; règles pures `supabase/functions/_shared/shopify-reservation.ts` (tests `tests/shopify-reservations.test.ts`) ;
  `shopify-orders` redéployée le 21/09 ; écran `src/routes/_app.sales.web-orders.tsx`, `src/modules/sales/web-orders-api.ts`.
- **Vérifié le 21/09** dans une **transaction annulée** en production (aucune donnée laissée) : réservation (disponible −1),
  webhook rejoué (0 mouvement), commande modifiée (+1), paiement (libération 2 + sortie 2 : réel −2, réservé 0, disponible
  inchangé), paiement rejoué (rien), annulation (libérée), expiration (rien à 6 jours, libérée à 8 jours, pas reprise
  ensuite), commande déjà trop ancienne (rien), commande de test (rien), arrêt de l'import (libérée, puis import refusé).
  Migration appliquée ensuite ; 0 réservation en base (import Arrêté).

**À tester (Simon)**
- [ ] Import Actif, passer sur le site une commande **payée par virement** d'un produit **relié** : Commandes du site →
      « Réservée (en attente de paiement) » ; fiche article : réservé +1, disponible −1 ; historique : « Réservation
      commande site #… ».
- [ ] Marquer la commande payée dans Shopify : « Importée », facture FAC ; stock réel −1, réservé revenu à 0, disponible
      inchangé par rapport à l'étape précédente.
- [ ] Une autre commande par virement puis l'annuler dans Shopify : réservation libérée (disponible revenu).

## 5 quinquies. Un seul catalogue : chaque produit du site est un article du DMS (M-25, 22/09)

Détail, chiffres et « À tester » : [mission 06](mission-06-catalogue-pieces.md) (§5, lot `lot-rapprochement`).
- **Le DMS est la source ; un seul stock.** Les 2 534 variantes du site sans article deviennent des articles (un par
  variante, référence = SKU), avec le **prix du site** (TTC) et le **stock du site comme stock de départ** (605
  mouvements « inventaire », 925 pièces, origine `import:shopify`), reliés (`shopify_links` : exact et unique =
  `auto_exact`, sinon `valide`). Sans SKU (94) : article « SHOP-… » à compléter, lien à valider. Pièces d'occasion :
  articles à part. Motos (240) : propositions vers la fiche véhicule.
- **Alerte « Produit du site sans article »** (liste Pièces & Accessoires, outil Rapprochements) pour tout produit créé
  directement dans Shopify : « Créer l'article » / « Rattacher ».
- L'écran « Produits Shopify » n'est plus une entrée du menu : il reste comme **Réglages du site** (mode de
  synchronisation, relire Shopify, aligner). La fiche article montre le produit du site et « Publier sur le site ».

## 6. Risques

- Double vérité sur le stock pendant la reprise : figer les modifications côté Shopify le temps de la reprise.
- Limites d'appels de l'API Shopify : regrouper les mises à jour de stock.
- Commandes du site : une commande payée par virement (« Bank Deposit ») n'entre dans le DMS qu'une fois marquée payée
  dans Shopify. **Depuis le 21/09 (§5 quater)** son stock est réservé dès la création de la commande (import Actif) ;
  la vente et la sortie de stock restent au paiement.
- Tant que peu de produits sont reliés (300 variantes sur 3 105), la plupart des commandes seront « À relier » :
  facture et règlement justes, mais stock sorti seulement après liaison + « Réessayer ».
- Le droit `read_orders` ne donne accès qu'aux 60 derniers jours de commandes : « Réessayer » échoue au-delà.
