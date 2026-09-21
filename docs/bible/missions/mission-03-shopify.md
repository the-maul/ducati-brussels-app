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
| Le stock et le prix du DMS s'affichent en direct sur le site | 🟦 21/09 — fait, livré en mode **Arrêtée** (rien n'est écrit sur le site) ; essai à lancer par Simon (§5 bis) |
| Une vente sur le site crée la vente et la sortie de stock dans le DMS | ⬜ |
| Publier ou retirer un article du site depuis sa fiche dans le DMS | 🟦 21/09 — fait, soumis au même mode essai (livré Arrêtée) |

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

## 6. Risques

- Double vérité sur le stock pendant la reprise : figer les modifications côté Shopify le temps de la reprise.
- Limites d'appels de l'API Shopify : regrouper les mises à jour de stock.
