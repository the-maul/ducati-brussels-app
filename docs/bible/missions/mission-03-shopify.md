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
| Voir les produits Shopify et les rapprocher des articles du stock | ⬜ |
| Reprendre une fois les photos et textes de Shopify dans le DMS | ⬜ |
| Le stock et le prix du DMS s'affichent en direct sur le site | ⬜ |
| Une vente sur le site crée la vente et la sortie de stock dans le DMS | ⬜ |
| Publier ou retirer un article du site depuis sa fiche dans le DMS | ⬜ |

## 4. Questions en attente

1. Les produits Shopify portent-ils la référence de l'article (SKU = référence Ducati / code DMS) ?
2. ~~Combien d'emplacements de stock dans Shopify ?~~ **Un seul** : « Chaussée de Bruxelles 688 » (vérifié le 19/09).
3. Vente en magasin avec la caisse Shopify, ou seulement en ligne ?
4. Prix Shopify TVA comprise ?
5. Produit Shopify sans article dans le DMS : le créer dans le DMS ou le retirer du site ?
6. Frais de port : ligne à part sur la vente dans le DMS ?

## 5. Ce qui a changé dans l'application

Rien encore. Point de départ gardé lors du nettoyage du 18/09 : la case « publiable » de la fiche article.

## 6. Risques

- Double vérité sur le stock pendant la reprise : figer les modifications côté Shopify le temps de la reprise.
- Limites d'appels de l'API Shopify : regrouper les mises à jour de stock.
