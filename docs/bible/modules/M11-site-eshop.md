---
chapitre: M11
titre: Site & e-shop
etat: 🟡
verifie_le: 2026-09-18
missions: []
mots_cles: [site, vitrine, e-shop, boutique, constructeur de site, blocs, page, publication, slug, domaine, panier, commande web, Stripe, paiement, webhook, stock unifié, publiable, Shopify]
---

# M11 — Site & e-shop

> **En une phrase** : un constructeur de site et une boutique en ligne branchés sur le même stock que le magasin, prêts techniquement mais jamais mis en ligne.

## 1. À quoi ça sert

Le module permet à la concession de composer elle-même un site vitrine multi-pages (sans code, par
blocs), de choisir quels articles sont vendus en ligne, et de recevoir des commandes payées par carte
(Stripe) qui deviennent automatiquement des factures et des sorties de stock. Le stock affiché est
celui du magasin : pas de synchronisation à faire. **Aucune boutique n'est publiée** au 18/09/2026 et
une décision client est en attente : le vrai site de la concession est peut-être **Shopify**
(le formulaire de contact actuel arrive d'ailleurs par Shopify, voir M10), auquel cas ce module
deviendrait du poids mort.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| E-shop (`/eshop`) → onglet Site | Constructeur de site : pages multiples (navigation d'en-tête), 14 types de blocs (hero, bandeau, texte, image, galerie, atouts, appel à l'action, vidéo, carte, FAQ, horaires, produits, contact, séparateur), envoi d'images, thème, aperçu en direct, adresse publique (`slug`), domaine personnalisé, **Enregistrer le brouillon** / **Publier**. |
| E-shop → onglet Produits | Liste des articles de la société (500 premiers par référence), photo (1re image GED), prix TTC, badge stock ; **publier / retirer** un article de la boutique. |
| E-shop → onglet Commandes | 100 dernières commandes web, changement de statut. |
| Vitrine publique `/shop/{slug}` (sans connexion) | Site publié, catalogue des articles publiés avec stock disponible, panier, passage de commande (réserve le stock), redirection vers Stripe, confirmation au retour (`?paid=1`). |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.eshop.tsx` (back-office), `src/routes/shop.$slug.tsx` (vitrine publique, hors garde de session) |
| Logique métier | `src/modules/web/eshop-api.ts` (produits, réglages, commandes, images), `site-builder.tsx` (éditeur), `site-renderer.tsx` (rendu public), `site-types.ts` (types de blocs), `checkout.ts` (appel Stripe) |
| Tables | `shop_settings` (réglages, brouillon `content`, version publiée `published_content`, `slug`, `custom_domain`, `published`), `web_orders`, `web_order_lines`, `articles.publishable` (M2), `attachments` (photos produit, M9) |
| Fonctions SQL (RPC) | publiques (rôle `anon`) : `shop_public_info`, `shop_public_site`, `shop_public_catalog`, `place_web_order`, `web_order_public_status` ; finalisation : `finalize_web_order` (commande payée → facture FAC + sortie de stock + règlement, idempotente) ; déclencheur `trg_enqueue_order_confirm` (mail de confirmation mis en file) |
| Stockage | bucket **public** `shop-assets` (images du site, 6 objets) ; photos produit lues dans le bucket privé `ged` via la politique `ged_public_products` |
| Fonctions serveur (Edge) | `supabase/functions/stripe-checkout` (crée la session de paiement), `supabase/functions/stripe-webhook` (vérifie la signature Stripe puis appelle `finalize_web_order`) |
| Tâches planifiées | `dispatch-notifications` (confirmations de commande, inactif faute de clé d'envoi) |
| Migrations clés | `20260610430000_m11_shop.sql`, `20260610440000_m11_storefront_public.sql`, `20260610450000_m11_site_builder.sql`, `20260610460000_m11_shop_assets.sql`, `20260612100000_m11_finalize_web_order.sql`, `20260612110000_m11_web_order_public_status.sql` |
| Libellés | `src/lib/i18n/fr.ts`, bloc `eshop` |

## 4. Règles métier et décisions

- **Stock unifié** (INV010 « gratuit par construction ») : la boutique lit le stock disponible du magasin (réel − réservé) ; une commande web **réserve** le stock (mouvement `reservation`, append-only B4/B7), le paiement le **sort** du stock réel.
- **Prix officiel côté serveur** : `place_web_order` ignore le prix envoyé par le navigateur et relit le prix catalogue (arrondi à l'euro supérieur si la société l'a réglé).
- **Paiement bouclé** : Stripe → `stripe-webhook` (signature HMAC vérifiée, tolérance 5 min) → `finalize_web_order` : commande `payee`, facture FAC numérotée, sortie de stock, règlement (E10 dans `avancement.md`, 12/06).
- **Sans clé Stripe** : `stripe-checkout` répond 501 et la commande reste « en attente de paiement », à finaliser hors ligne.
- **Décision en attente** : Shopify ou vitrine intégrée (`etat-projet.md` §8, question 1 de `plan-nouveau-client.md` §7).

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base.

- ✅ Tous les objets appelés par le code existent (tables, 6 RPC, 2 buckets, 2 fonctions Edge déployées).
- 🟡 **Rien n'est en ligne** : 2 réglages de boutique, **0 publiée**, **0 commande web**, 32 articles marqués publiables sur 82 090. La présence de `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` en production n'a pas pu être vérifiée (secrets) : **à vérifier** ; `etat-projet.md` indique « bouclé en test, clé de production attendue ».
- 🔴 **Payer 1 centime suffit.** `stripe-checkout` facture le montant **envoyé par le navigateur** (`amount`) au lieu du total de la commande, et le webhook finalise la commande sans comparer le montant payé au total. Une commande de 2 000 € réglée 0,01 € devient « payée » avec facture et sortie de stock.
- 🔴 **Pas besoin de payer du tout.** `finalize_web_order` est exécutable par `anon` et ne contrôle l'appelant que s'il est connecté (`auth.uid() is not null and not is_member(...)`). Le client reçoit l'identifiant de sa commande : un appel direct à la RPC avec la clé publique la marque payée, génère la facture et sort le stock.
- 🔴 `place_web_order` ne vérifie pas `publishable` : on peut commander (et réserver) **n'importe quel article** de la société, y compris des motos, et saturer le stock disponible par des réservations anonymes jamais payées.
- ⚠️ Dès la publication, le `company_id` devient public (`shop_public_info`, chemins d'images) : cela ouvre les failles `contacts_search`, `_next_document_number_unchecked`, `ingest_*` décrites en M0, M1 et M10.

## 6. Prévu / en cours

- Décision client : Shopify ou vitrine intégrée. Si Shopify, la page d'inscription client (lot 4 de [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md)) doit être intégrable sur un autre site.
- En attente du client : clé Stripe de production, configuration DNS OVH du domaine (`etat-projet.md` §8, `integrations-cles-api.md`).
- E-mails de confirmation : la file `notifications` pointe vers Resend sans clé ; à rebrancher sur Outlook (décision D4).

## 7. Limites connues, dettes, pièges

- **Corriger les trois failles du §5 avant toute publication.**
- `createWebOrder` (côté back-office, `eshop-api.ts`) calcule le total avec les prix fournis par l'écran et insère les lignes sans vérifier l'erreur ; aucun écran ne l'appelle (vérifié le 18/09) : code mort, la vitrine passe par `place_web_order`.
- `setWebOrderStatus` change le statut librement (passer « payée » à la main ne crée ni facture ni sortie de stock ; seule `finalize_web_order` le fait).
- Le numéro de commande web (`WEB-AAAA-xxxxxx`) est tiré de l'identifiant, hors des séquences de M0.
- `site-renderer.tsx` contient des couleurs hexadécimales et des arrondis de 12 px en dur, contraires à la charte (règle 9) ; la vitrine suit l'inspiration Strikingly/Shopify et non la charte Ducati (SIW006).
- La liste des produits du back-office est plafonnée à 500 articles ; le catalogue compte 82 090 articles.
- Le domaine personnalisé est enregistré (`custom_domain`) mais le routage d'un domaine vers `/shop/{slug}` n'est pas visible dans le code : **à vérifier**.

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| SIW000 | Paramétrage standard | ✅ fait | `shop_settings`, onglet Site |
| SIW001 | Page équipe | 🟦 partiel | possible avec les blocs génériques (atouts, galerie), pas de bloc équipe |
| SIW002 | Événements | ⬜ manquant | aucun bloc ni table d'événements |
| SIW003 | Formulaires web (contact, atelier, commercial, financement, reprise) | ⬜ manquant | le bloc « contact » n'affiche que téléphone / e-mail / adresse ; les demandes arrivent aujourd'hui par le formulaire Shopify (M10) |
| SIW004 | Galerie photos interactive | ✅ fait | bloc `gallery` (`site-types.ts`) |
| SIW005 | E-commerce avec stock synchronisé | 🟦 partiel | `place_web_order`, `finalize_web_order`, `stripe-*` ; failles bloquantes (§5), jamais publié |
| SIW006 | Design conforme à la charte Ducati | 🟦 partiel | thème réglable, mais styles en dur hors charte dans `site-renderer.tsx` |
| SIW007 | Analytics visiteurs | ⬜ manquant | aucun traceur |
| SIW008 | Import de catalogues tiers | ⬜ manquant (à clarifier au cahier) | passerait par l'import M2 + `publishable` |
| INV010 | Stock e-shop = stock magasin | ✅ fait | `shop_public_catalog` lit le stock réel − réservé |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | E-shop : catalogue sur stock unifié, photos, publication par article | `837b2f9` |
| 2026-06-11 | Réglages boutique, panier, commande web qui réserve le stock | `659879d`, migration `20260610430000` |
| 2026-06-11 | Vitrine publique `/shop/{slug}`, domaine personnalisé, Stripe Checkout | `0ee7390`, migration `20260610440000` |
| 2026-06-11 | Constructeur de site multi-pages, 14 blocs, images | `c2e04c1`, `3ff41ec`, `410f6f4`, migrations `20260610450000`, `20260610460000` |
| 2026-06-12 | Webhook Stripe signé + finalisation (facture, stock, règlement) ; confirmation au retour | `e636dbf`, `8f120db`, migrations `20260612100000`, `20260612110000` |
| 2026-06-12 | Bloc Atouts : sélecteur d'icônes | `673be91` |
| 2026-09-11 | Correctifs de typage des appels RPC | `7d31b6d` |
