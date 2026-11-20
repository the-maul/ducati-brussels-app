---
chapitre: TRANSVERSE-infra-mise-en-prod
titre: Solidifier avant la mise en production — sauvegardes, domaine, hébergement, données, GitHub
verifie_le: 2026-11-20
mots_cles: [sauvegarde, backup, pg_dump, PITR, Supabase Pro, compute Small, Storage, S3, rclone, age, R2, domaine, DNS, Combell, HTTPS, Netlify, Vercel, Cloudflare, RGPD, GitHub, branches, worktrees, CI]
---

# Solidifier avant la mise en production

> **En une phrase** : la base est en France (Paris) et sauvegardée 7 jours par Supabase, mais
> **les 12 Go de fichiers ne sont sauvegardés nulle part**, l'application tourne sur une adresse
> provisoire `*.netlify.app` (serveur probablement aux États-Unis) et le **dépôt GitHub est public**.
> Ce document donne l'état vérifié le 20/11/2026 et le plan pour corriger chaque point.

Légende : **[V]** vérifié aujourd'hui (API Supabase, API GitHub, DNS, code) · **[D]** déduit ou
non vérifiable sans accès (compte Netlify, tenant Microsoft) · **[Doc]** documentation officielle
de l'éditeur lue le 20/11/2026.

Méthode : lecture seule partout. Requêtes `SELECT` et lectures de l'API de gestion Supabase
(projet, sauvegardes, buckets, noms des secrets — jamais leurs valeurs), `gh api` en lecture,
`nslookup`, recherche dans le code et l'historique Git. Rien n'a été supprimé, déplacé ou réglé.

---

## Sommaire

1. [Sauvegardes de la base et des fichiers](#1-sauvegardes-de-la-base-et-des-fichiers)
2. [Nom de domaine](#2-nom-de-domaine)
3. [Hébergement de l'application](#3-hébergement-de-lapplication)
4. [Où sont toutes les données](#4-où-sont-toutes-les-données)
5. [GitHub au propre](#5-github-au-propre)
6. [Récapitulatif : qui fait quoi, combien](#6-récapitulatif--qui-fait-quoi-combien)

---

## 1. Sauvegardes de la base et des fichiers

### 1.1 Ce qui existe aujourd'hui

| Élément | Constat | Source |
|---|---|---|
| Projet | `ujmrosbgkvgvwfnuryna` « Ducati », **eu-west-3 (Paris)**, PostgreSQL **17.6**, état `ACTIVE_HEALTHY` | [V] API `/v1/projects` |
| Taille de la base | **2,70 Go** (dont `events` 999 Mo, `articles` 344 Mo, `article_links` 310 Mo, catalogue Ducati ≈ 350 Mo) | [V] `pg_database_size` |
| Sauvegardes Supabase | **8 sauvegardes physiques** quotidiennes, du 13/11 au 20/11 (vers 23:43 UTC + une le 20/11 à 10:38, probablement au passage en Small) | [V] API `/database/backups` |
| PITR (retour à la minute) | **désactivé** (`pitr_enabled: false`) | [V] |
| Fichiers du Storage | **jamais sauvegardés** : les sauvegardes de base ne contiennent que la liste des fichiers, pas leur contenu | [Doc] Supabase : « Database backups do not include objects you store via the Storage API » |
| Versioning des buckets | désactivé sur les 3 buckets : un fichier supprimé ou écrasé est perdu | [V] API `/storage/buckets` |
| Sauvegarde externe | aucune | [V] |
| Dépôt `the-maul/ducati-backup` | sauvegarde du **code**, pas des données. Sa branche `main` est au commit `7b541be` du **03/11** : **96 commits de retard**. Le tag `backup-20261118-150253` pointe lui aussi sur le 03/11 (le backup du 18/11 a été pris depuis une copie locale de `main` pas à jour) | [V] `git ls-remote backup` |

### 1.2 Ce que comprend le plan actuel (Pro + compute Small) [Doc]

| Poste | Inclus | Au-delà |
|---|---|---|
| Prix | Pro 25 $/mois, crédit compute 10 $ inclus ; Small ≈ 15 $/mois → **≈ 30 $/mois** | — |
| Disque base | 8 Go par projet (on en utilise 2,7) | 0,125 $/Go/mois |
| Stockage fichiers | 100 Go (on en utilise 12) | 0,0213 $/Go/mois |
| Trafic sortant | 250 Go + 250 Go en cache | 0,09 $/Go |
| Sauvegardes quotidiennes | **7 jours** de rétention (Team : 14, Enterprise : 30) | — |
| PITR | option payante : 7 j ≈ **100 $/mois**, 14 j ≈ 200 $, 28 j ≈ 400 $ | — |
| Journaux | 7 jours | — |
| SLA contractuel | **aucun** (Enterprise seulement) | — |

Sources : https://supabase.com/pricing · https://supabase.com/docs/guides/platform/backups ·
https://supabase.com/docs/guides/platform/compute-add-ons ·
https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery

**Ce que ça veut dire** : si quelqu'un efface des données par erreur, on peut revenir à la nuit
précédente (perte possible : jusqu'à 24 h de saisies), et seulement pendant 7 jours. Si le compte
Supabase est perdu, bloqué ou supprimé, **tout disparaît** (base et fichiers) : il n'y a aucune
copie ailleurs. D'où la sauvegarde externe ci-dessous.

PITR : à décider. Il ramène la perte maximale de 24 h à quelques minutes, pour ≈ 100 $/mois.
Pour une concession qui saisit toute la journée en caisse et à l'atelier, c'est raisonnable une fois
en production ; la sauvegarde externe reste nécessaire dans tous les cas (PITR reste chez Supabase).

### 1.3 Sauvegarde externe proposée

Workflow écrit dans cette branche : [`.github/workflows/sauvegarde-externe.yml`](../.github/workflows/sauvegarde-externe.yml).
**Il est inactif** : il ne fait rien tant que la variable `BACKUP_ENABLED` ne vaut pas `true`, et il
s'arrête proprement si un réglage manque. Il ne contient aucun secret.

Chaque nuit à 02:15 UTC :

1. **Base** : `pg_dump` (PostgreSQL 17, format compressé) des schémas `public` (métier), `auth`
   (comptes), `storage` (liste des fichiers) et `cron` (tâches planifiées), **chiffré à la volée** avec
   [age](https://age-encryption.org) puis envoyé au bucket. Le fichier en clair ne touche jamais le
   disque. Le chiffrement utilise une **clé publique** : même si le workflow ou le bucket fuyait,
   personne ne peut relire la sauvegarde sans la clé privée, gardée hors ligne par le client.
   Le coffre `vault` (secrets) n'est pas exporté.
2. **Fichiers** : copie des buckets `ged`, `shop-assets` et `wsm-images` par le **protocole S3 de
   Supabase** ([doc](https://supabase.com/docs/guides/storage/s3/authentication)) avec `rclone`,
   **chiffrés** (contenu et noms). Copie incrémentale : seule la première nuit transfère 12 Go.
   Un fichier supprimé ou remplacé côté Supabase n'est pas perdu : il part dans `_remplaces/<date>/`.
3. **Rétention** : base quotidienne 35 jours + une copie mensuelle (le 1er) gardée 13 mois.

Où le faire tourner : **dans le dépôt privé `the-maul/ducati-backup`** (copier le fichier dans son
`.github/workflows/`). Raison : le dépôt principal est public, ses journaux d'exécution sont visibles
de tous. Rien de sensible n'y est imprimé, mais l'accès à la base doit vivre dans un dépôt privé.
Coût GitHub : ≈ 10–20 min par nuit, soit ≈ 300–600 min/mois sur 2 000 gratuites (dépôt privé, compte Free).

Où stocker (bucket externe, région UE) [Doc] :

| Fournisseur | Stockage | Sortie (restauration) | UE | Verrou anti-suppression | Pour ≈ 60 Go* |
|---|---|---|---|---|---|
| **Cloudflare R2** (recommandé) | 0,015 $/Go/mois, 10 Go gratuits | **gratuite** | juridiction `eu` garantie | bucket locks | **≈ 0,75 $/mois** |
| Backblaze B2 | ≈ 0,007 $/Go | gratuite jusqu'à 3× le volume | région EU Central (Amsterdam) | Object Lock | ≈ 0,40 $/mois |
| Scaleway (Paris) | ≈ 0,015 €/Go [D] | 75 Go/mois gratuits | Paris | à vérifier | ≈ 0,90 €/mois |
| OVHcloud | ≈ 0,007 €/Go [D] | gratuite | France | Object Lock + versioning | ≈ 0,45 €/mois |
| AWS S3 Paris | 0,024 $/Go | ≈ 0,09 $/Go | Paris | Object Lock | ≈ 1,45 $/mois |

\* 12 Go de fichiers + ≈ 47 dumps de la base (taille compressée estimée 0,5–1 Go chacun, à
mesurer au premier essai). Trafic sortant Supabase ajouté : ≈ 50–80 Go/mois, dans les 250 Go inclus.

R2 est recommandé : sortie gratuite (une restauration complète ne coûte rien), données garanties en
UE, prix négligeable. OVH est l'alternative 100 % européenne si le client le préfère.

### 1.4 Ce que le client doit créer lui-même (aucun de ces éléments ne doit nous être transmis en clair)

| # | Quoi | Où | Nom à donner |
|---|---|---|---|
| 1 | Compte Cloudflare (ou OVH…) + bucket privé, juridiction UE, par ex. `ducati-sauvegardes` ; règle de cycle de vie « supprimer `_remplaces/` après 90 jours » ; verrou de bucket 30 jours conseillé | Cloudflare → R2 | variable `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` (`auto` pour R2) |
| 2 | Clé d'API R2 limitée **à ce seul bucket** (lecture + écriture) | R2 → Manage API tokens | secrets `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` |
| 3 | Clés d'accès S3 du Storage Supabase. Attention : elles donnent accès à **tous** les fichiers en ignorant la RLS — à ne mettre que dans GitHub | Supabase → Storage → Settings → S3 Access Keys | secrets `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` |
| 4 | Chaîne de connexion **Session pooler** (IPv4, les machines GitHub n'ont pas d'IPv6), avec le mot de passe de la base | Supabase → bouton Connect → Session pooler | secret `SUPABASE_DB_URL` |
| 5 | Paire de clés age : `age-keygen -o ducati-backup.key`. **La clé privée** va dans le gestionnaire de mots de passe du client + une copie papier / clé USB au coffre. La **clé publique** (`age1…`) va dans GitHub | poste du client | variable `BACKUP_AGE_RECIPIENT` |
| 6 | Deux mots de passe longs pour le chiffrement des fichiers, **notés aussi hors GitHub** (sans eux, les fichiers sauvegardés sont illisibles) | gestionnaire de mots de passe | secrets `BACKUP_RCLONE_CRYPT_PASSWORD`, `BACKUP_RCLONE_CRYPT_SALT` |
| 7 | Activer : variable `BACKUP_ENABLED` = `true`, puis lancer une fois à la main (Actions → Sauvegarde externe → Run workflow) et vérifier | GitHub → `ducati-backup` → Settings → Secrets and variables → Actions | `BACKUP_ENABLED` |

Option : variable `BACKUP_SKIP_WSM` = `true` pour ne pas copier `wsm-images` (8,3 Go de figures des
manuels, regénérables depuis le PC — mais le PC n'est pas une sauvegarde, voir §4.3).

Amélioration possible (migration, donc avec accord et backup) : un rôle PostgreSQL dédié en lecture
seule (`backup_reader`, `BYPASSRLS`, `SELECT` sur tout) pour ne pas confier le mot de passe `postgres`
à GitHub.

### 1.5 Tester la restauration (sinon la sauvegarde ne vaut rien)

Une fois par mois, et au premier essai :

```bash
rclone copy dest:ducati-sauvegardes/base/quotidien/ujmrosbgkvgvwfnuryna-AAAA-MM-JJ.dump.age .
age -d -i ducati-backup.key -o base.dump ujmrosbgkvgvwfnuryna-AAAA-MM-JJ.dump.age
docker run -d --name essai -e POSTGRES_PASSWORD=essai -p 5433:5432 postgres:17
pg_restore -h localhost -p 5433 -U postgres -d postgres --no-owner --no-privileges base.dump
psql -h localhost -p 5433 -U postgres -c "select count(*) from public.documents"   # ≈ 17 814 au 20/11
```

Points à valider au premier essai : le schéma `auth` et les tables de `cron` se lisent bien avec le
rôle de la chaîne de connexion ; durée réelle ; taille du dump. En cas de vraie restauration vers un
nouveau projet Supabase : restaurer `public` + `auth` + `storage`, recopier les fichiers avec
`rclone copy chiffre:ged supa:ged`, reposer les secrets des Edge Functions et redéployer les fonctions.

---

## 2. Nom de domaine

### 2.1 État actuel [V]

| Élément | Constat |
|---|---|
| Adresse de l'application | `https://ducatilive.netlify.app` (HTTPS Netlify, HSTS) |
| `ducatibruxelles.be` | site public **Shopify** (servi via Cloudflare) ; DNS chez **Combell** (`ns1.combell.eu`, `ns3/ns4.combell.net`) ; MX chez Combell (mailprotect) ; pas d'enregistrement SPF ni DMARC |
| `ducatibxl.be` | domaine des **boîtes Microsoft 365** (MX `…mail.protection.outlook.com`, SPF Outlook) ; DNS chez Combell ; les 4 boîtes écoutées par le DMS sont en `@ducatibxl.be` |
| `dms.ducatibruxelles.be`, `app.ducatibruxelles.be` | **n'existent pas encore** (aucune réponse DNS) — mais le code les attend déjà (décision du 18/09) |
| Supabase Auth — Site URL | `https://ducatilive.netlify.app` (corrigé depuis le 18/09) |
| Supabase Auth — Redirect URLs | encore **3 anciennes adresses Lovable** uniquement (`*.lovableproject.com`, `id-preview*…lovable.app`) : à remplacer |

### 2.2 Ce qu'il faut

Recommandation : **`dms.ducatibruxelles.be`** pour le personnel et **`app.ducatibruxelles.be`** pour
l'espace client, comme prévu dans le code (`src/lib/portal-host.ts`, `src/lib/client-app-url.ts`).
Le domaine appartient à la concession : c'est le bon choix (l'agence peut changer, l'adresse reste).
Le site Shopify (`ducatibruxelles.be` et `www`) et la messagerie ne sont **pas touchés**.

Étapes :

1. **Netlify** (nous, avec l'accès au site) : Domain management → Add domain →
   `dms.ducatibruxelles.be` puis `app.ducatibruxelles.be` ; mettre `dms` en domaine principal.
   Netlify redirige alors automatiquement `ducatilive.netlify.app` vers le nouveau domaine.
2. **Combell** (le client, ou nous avec un accès délégué) : zone DNS de `ducatibruxelles.be`, ajouter
   deux enregistrements **CNAME** : `dms` → `ducatilive.netlify.app` et `app` → `ducatilive.netlify.app`
   (TTL 1 h). Ne rien modifier d'autre (la racine et `www` restent sur Shopify).
3. **HTTPS** : automatique. Netlify obtient le certificat Let's Encrypt dès que le DNS répond
   (quelques minutes à quelques heures). Vérifier « HTTPS: certificate active » dans Netlify.
4. Mettre à jour les endroits listés au §2.3, **dans l'ordre**, un soir sans activité.
5. Garder `ducatilive.netlify.app` dans les Redirect URLs pendant 1 mois (liens déjà envoyés).

Coût : 0 € (le domaine est déjà payé ; certificat gratuit).

À faire en même temps, côté messagerie (recommandé, hors DMS) : ajouter un SPF et un DMARC à
`ducatibruxelles.be` (aujourd'hui absents : n'importe qui peut envoyer des mails « de » ce domaine).

### 2.3 Les endroits à mettre à jour après le changement

Recherche faite dans tout le code (`src/`, `supabase/functions/`, `supabase/migrations/`, `tools/`,
`integrations/`), les tâches `cron`, les fonctions SQL et les colonnes d'URL de la base.
**Aucune adresse Netlify n'est stockée en base** [V] ; les migrations ne contiennent que l'adresse
Supabase. Les endroits sont :

| # | Où | Aujourd'hui | À mettre | Qui |
|---|---|---|---|---|
| 1 | Supabase → Authentication → URL Configuration → **Site URL** | `https://ducatilive.netlify.app` | `https://dms.ducatibruxelles.be` | nous |
| 2 | idem → **Redirect URLs** | 3 adresses Lovable | `https://dms.ducatibruxelles.be/**`, `https://app.ducatibruxelles.be/**`, `https://ducatilive.netlify.app/**` (transition) ; **supprimer les 3 Lovable** | nous |
| 3 | Netlify → variables de build : `VITE_CLIENT_APP_URL` | absente (repli sur l'adresse du site) | `https://app.ducatibruxelles.be` — sert au message de bienvenue, au **lien du pied de mail envoyé par `graph-send-email`** (paramètre `origin`), aux invitations après inscription, à la borne et au lien de signature du check-up | nous |
| 4 | Netlify → `VITE_CLIENT_APP_HOST` | absente | `app.ducatibruxelles.be` — sur cet hôte la racine mène à l'espace client et les pages du personnel sont fermées. **Ne la poser qu'une fois `app.` en ligne**, puis relancer un build | nous |
| 5 | Secret Edge `APP_ORIGINS` (lu par `send-account-invitation` et `followups-send`) | absent → valeurs par défaut du code, qui contiennent déjà les 3 adresses | `https://app.ducatibruxelles.be,https://dms.ducatibruxelles.be,https://ducatilive.netlify.app` — **`app.` en premier** : `followups-send` prend la 1re adresse pour les liens des relances clients | nous |
| 6 | `graph-send-email` | prend l'`origin` envoyé par l'écran (`clientAppUrl()`), accepte toute adresse `https://` | rien à changer dans la fonction : suit le point 3 | — |
| 7 | `stripe-checkout` : secret `APP_PUBLIC_URL` | absent → adresses de retour = l'adresse du navigateur | rien (suit le domaine tout seul). Le **webhook Stripe** pointe sur Supabase (`…supabase.co/functions/v1/stripe-webhook`) : **non concerné**. Stripe n'a jamais servi (0 événement, aucun réglage société) | — |
| 8 | Shopify — application « DMS Ducati Bruxelles » : `integrations/shopify-app/shopify.app.toml` (`application_url`, `redirect_urls`) | `https://ducatilive.netlify.app` | `https://dms.ducatibruxelles.be`, puis `npx @shopify/cli@latest app deploy` depuis ce dossier | nous (fichier) + Simon (déploiement) |
| 9 | Shopify — thème : lien « Espace client » (guide `docs/bible/guides/lien-site-shopify.md`) | `https://ducatilive.netlify.app/app-client` | `https://app.ducatibruxelles.be/app-client` ; mettre à jour le guide | client (admin Shopify) |
| 10 | Shopify — webhooks des commandes | Supabase `…/functions/v1/shopify-orders` | **non concerné** | — |
| 11 | Extension navigateur My Ducati : `tools/myducati-extension/manifest.json` et `background.js` n'autorisent que `https://*.netlify.app/*` et `localhost:8080` | — | ajouter `https://dms.ducatibruxelles.be/*`, regénérer `public/myducati-extension.zip`, réinstaller sur les PC | nous (PR) + client (réinstallation) |
| 12 | CORS des Edge Functions | toutes en `Access-Control-Allow-Origin: *` | rien d'obligatoire. Plus tard, par sécurité : restreindre aux 2 domaines | — |
| 13 | CORS de l'API Supabase (REST, Storage, Auth) | ouverte à toutes les origines par Supabase | rien | — |
| 14 | Microsoft Graph (application Azure) | fonctionne par identifiants d'application, sans adresse de retour | rien | — |
| 15 | Appareils : borne d'accueil, écrans client de la caisse (appairés par une adresse), tablettes atelier, favoris des postes | adresse Netlify | rouvrir chaque appareil sur le nouveau domaine et refaire l'appairage | client (avec nous) |
| 16 | Documentation : `docs/bible/00-architecture.md`, `docs/deploiement-netlify.md`, ce document | — | mettre à jour | nous |

Non concernés car ce ne sont pas des adresses de l'application : `ducatibruxelles.be` (site public,
signature des mails, borne « Nos occasions »), les tâches `cron` (elles appellent Supabase).

---

## 3. Hébergement de l'application

### 3.1 État actuel

- Netlify, compte **personnel** de Simon (offre gratuite d'après `docs/deploiement-netlify.md`),
  build `bun run build`, preset Nitro `netlify`, déploiement à chaque push sur `main` [V code].
- Le build a besoin de 6 Go de mémoire (`NODE_OPTIONS=--max-old-space-size=6144`, depuis le 18/11).
- **Région des fonctions serveur : non vérifiable sans accès au compte.** Par défaut, Netlify les
  place à **Ohio (États-Unis)** [Doc] : chaque page rendue côté serveur et chaque fonction serveur
  (écran Utilisateurs, inscription) fait alors l'aller-retour Atlantique vers la base à Paris.
- Aucun statut de build renvoyé à GitHub, aucun SLA, pas d'équipe.

### 3.2 Comparatif (TanStack Start rendu serveur, base à Paris) [Doc, 20/11/2026]

| Critère | **Netlify Pro** (compte agence) | Vercel Pro | Cloudflare Workers (payant) |
|---|---|---|---|
| Support TanStack Start | **partenaire officiel**, preset déjà en place | via Nitro, signalé « en développement actif » ; pas partenaire officiel | partenaire officiel, mais preset à changer (`cloudflare-module`) + `wrangler.jsonc` |
| Travail de migration | **aucun** (même code, même build) | faible (preset `vercel`) | **moyen à fort** : runtime non Node complet (128 Mo de mémoire, `child_process`/`vm` absents), bundle SSR très gros (build à 6 Go de RAM), tout à re-tester |
| Région UE des fonctions | oui sur Pro : **Francfort** en libre-service ; **Paris sur demande au support** | oui : **`cdg1` Paris** au choix | pas de région : exécution près du visiteur ; « placement » vers une région cloud possible |
| Prix | **20 $/mois, membres illimités** ; 3 000 crédits/mois (recharge 10 $ / 1 500) | 20 $ **par membre**/mois, 20 $ d'usage inclus | **5 $/mois**, 10 M requêtes incluses, pas de frais de trafic |
| Déploiement depuis GitHub | oui | oui | oui |
| Aperçu par branche / PR | oui | oui | oui (URL par branche) |
| Mot de passe sur les aperçus | **inclus** (option « previews only ») | **20 $/mois par projet** | via Cloudflare Access [D] |
| Journaux des fonctions | jusqu'à 7 jours | **1 jour** (30 j en option payante) | 7 jours |
| Durée max d'une requête | 60 s (15 min en arrière-plan) | 300 s par défaut | pas de limite de durée, 30 s CPU par défaut |
| SLA contractuel | Enterprise seulement (99,99 %) | Enterprise seulement | plan Business (site), Workers non précisé |
| RGPD | DPA inclus aux CGU ; DPF annoncé [D] | DPA (SCC 2021), traitement principal aux USA | DPA basé sur le DPF + SCC |

Dans les trois cas, les journaux et métadonnées de compte restent aux États-Unis ; **les données
métier, elles, restent dans Supabase à Paris** (le serveur d'application ne stocke rien).

### 3.3 Recommandation : Netlify Pro sur le compte de l'agence, fonctions à Francfort (Paris si le support l'accepte)

Pourquoi : zéro changement de code la veille d'un démarrage, prix fixe quel que soit le nombre de
personnes, aperçus protégés par mot de passe inclus, partenaire officiel de TanStack Start. Vercel
n'apporte que Paris au lieu de Francfort (≈ 10 ms d'écart), pour un prix par personne et des journaux
d'un jour. Cloudflare est le moins cher mais demande une vraie migration à re-tester : à garder
comme piste plus tard, pas avant la mise en production.

Coût : **≈ 20 $/mois** (+ recharges si le trafic dépasse les crédits ; à surveiller le 1er mois).

> **Mise à jour du 20/11/2026 (lot Cloudflare)** : le client a un compte Cloudflare et veut tester
> Workers. Une construction Cloudflare est prête à côté de celle de Netlify (`bun run build:cloudflare`,
> `wrangler.jsonc`) et a été testée en local : voir `docs/deploiement-cloudflare.md` (verdict,
> compatibilité, taille, déploiement, domaine, coûts, bascule et retour arrière).

### 3.4 Étapes de migration

| # | Étape | Qui |
|---|---|---|
| 1 | Décider à qui appartient l'hébergement (compte de l'agence, ou compte au nom de la concession avec l'agence invitée) | client + agence |
| 2 | Créer / passer le compte Netlify en **Pro** (moyen de paiement) | **client ou agence — pas nous** |
| 3 | Relier la GitHub App Netlify au dépôt `the-maul/ducati-brussels-app` (le propriétaire du dépôt autorise) | the-maul |
| 4 | Nouveau site depuis le dépôt, branche `main`, mêmes réglages (`netlify.toml` est déjà dans le dépôt) | nous |
| 5 | Recopier les 5 variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — la clé de service est **posée par le client** ou recopiée par lui depuis Supabase | client (secret) + nous |
| 6 | Site settings → Functions → **Region** : Frankfurt (`fra`) ; demander Paris (`cdg`) au support | nous |
| 7 | Activer la protection par mot de passe « previews only » ; activer les aperçus de PR | nous |
| 8 | Premier déploiement, tests sur l'adresse provisoire du nouveau site | nous |
| 9 | Brancher les domaines (§2.2) **sur le nouveau site** ; mettre à jour la liste du §2.3 | nous + client (DNS) |
| 10 | Désactiver les builds automatiques de l'ancien site personnel (le garder 1 mois pour retour arrière), puis le supprimer | Simon |

Bonus : avec un site sur un compte d'équipe, la contrainte « un seul contributeur Git
(Simonclaw2505) » de l'offre gratuite disparaît.

---

## 4. Où sont toutes les données

### 4.1 Inventaire

| Lieu | Données | Taille | Région | Sauvegardé ? | À faire |
|---|---|---|---|---|---|
| **Supabase — base** | Tout le métier : 16 365 contacts, 6 728 véhicules, 17 814 documents de vente, articles, stock, atelier, compta, audit (`events` 518 000 lignes), 12 comptes utilisateurs, catalogue Ducati, manuels atelier (texte) | **2,70 Go** | **eu-west-3 Paris** (AWS) [V] | oui, 7 jours chez Supabase ; **pas hors Supabase** | sauvegarde externe (§1.3) ; PITR à décider |
| **Supabase — bucket `ged`** (privé) | photos et documents des clients : factures PDF reprises de G8 (`document/` 12 703 fichiers, 1,6 Go), images articles (831 Mo), photos véhicules (617 Mo), pièces des contacts — **dont pièces d'identité et permis** (586 Mo) ; tout sous la société ITALBIKE STORE | **3,68 Go**, 16 496 fichiers | Paris [V] | **non** | sauvegarde externe (§1.3) |
| **Supabase — bucket `wsm-images`** (privé) | figures des manuels d'atelier Ducati, chargées le 23/09 | **8,29 Go**, 13 196 fichiers | Paris [V] | **non** (source sur le PC, §4.3) | sauvegarde externe ; option « ne pas copier » si le client l'accepte |
| **Supabase — bucket `shop-assets`** (public) | images du constructeur de site | 7,6 Mo, 6 fichiers | Paris [V] | non | sauvegarde externe |
| Supabase — secrets des Edge Functions | 18 secrets (noms vérifiés, valeurs non lues) : Anthropic, Brevo, Graph ×3, Shopify ×3, Stripe ×2, `CRON_SECRET`, clés Supabase | — | Paris | non (c'est normal) | les noter dans le gestionnaire de mots de passe du client, pour pouvoir les reposer |
| Supabase — journaux | requêtes, Auth, fonctions | — | Paris | 7 jours | — |
| **Netlify** | code compilé, 5 variables d'environnement dont la clé de service ; journaux | — | CDN mondial ; fonctions **Ohio par défaut** [D] | le code est sur GitHub | migration §3 |
| **GitHub `the-maul/ducati-brussels-app`** | code, migrations, documentation métier (procédures G8, GAP, compte rendu client `.docx`, inventaire G8) | 12,9 Mo | USA | copie dans `ducati-backup` (en retard de 96 commits) | **passer en privé** (§5.4), remettre `ducati-backup` à jour |
| GitHub `the-maul/ducati-backup` (privé) | copie du code au 03/11 | 11,5 Mo | USA | — | backup à refaire selon la procédure |
| **Microsoft 365** (tenant `ducatibxl.be`) | les boîtes mail (domenico@, info@, shop@, occasions@) ; le DMS en lit les messages toutes les 5 min et copie les pièces jointes dans la GED | — | région du tenant **non vérifiée** [D] (Centre d'administration → Paramètres de l'organisation → Emplacement des données) | par Microsoft (rétention standard) | vérifier la région ; pas d'action DMS |
| **Anthropic (Claude API)** | contenu des mails inconnus (classement prospect), résumés d'échanges, traduction de désignations, **images de pièces d'identité / permis** (`read-id-doc`) | flux, pas de stockage voulu | USA [D] | — | vérifier le DPA et la durée de conservation côté Anthropic ; mentionner ce sous-traitant dans le registre RGPD et l'information client |
| **Brevo** | SMS : numéro + texte (rappels RDV) ; clé posée, aucun réglage SMS en base au 20/11 | flux | France / UE [D] | — | registre RGPD |
| **Shopify** (`ducati-bruxelles.myshopify.com`) | produits, stock publié, commandes et clients de l'e-shop | chez Shopify | Canada / USA [D] | par Shopify | — |
| **Stripe** | paiements (QR comptoir, e-shop) — **jamais utilisé** (0 événement) | 0 | Irlande / USA | — | décider si on le garde |
| VIES (Commission européenne) | n° de TVA vérifiés | flux | UE | — | — |
| CRM Mauluctive (agence) | titres des commits / PR (webhook GitHub `ederjcxvvgcunlptfrhj.supabase.co`) | petit | Supabase de l'agence | — | — |
| **PC de Simon** | voir §4.3 | voir §4.3 | Belgique, un seul disque | **non** | §4.3 |

### 4.2 RGPD — points d'attention

1. Le dépôt GitHub **public** expose toute la documentation métier et quelques exemples de données
   (adresses e-mail dans des commentaires de migration et de la bible). Aucune base client n'y est
   (`.gitignore` exclut `Info DB/`, les exports G8 et les factures) [V]. → passer en privé (§5.4).
2. Les pièces d'identité des clients sont dans `ged/…/contact/` et passent par Anthropic (USA) pour
   la lecture automatique : à inscrire au registre des traitements et à l'information client.
3. Les sauvegardes externes contiennent les mêmes données : chiffrées, en UE, accès limité au client.
4. Droit à l'effacement : un client effacé reste dans les sauvegardes jusqu'à leur expiration
   (35 jours / 13 mois) — c'est admis si la durée est écrite dans la politique de conservation.

### 4.3 Fichiers restés sur le PC de Simon (`C:\Users\simon\Desktop\ducati`)

Mesuré le 20/11/2026 (taille réelle des fichiers, liens `node_modules` non suivis), rien n'a été
déplacé ni supprimé. **Aucun de ces fichiers n'est sauvegardé** : un seul disque, un seul PC.

| Dossier | Contenu | Taille | Unique ? | À faire |
|---|---|---|---|---|
| `manuels-extraits\images` | figures extraites des manuels d'atelier Ducati (WSM) | **51,3 Go**, 105 436 fichiers | la base n'en a reçu que 8,3 Go (`wsm-images`) ; le reste n'existe **que** sur ce PC | décider : jeter (re-téléchargeable ?) ou copier sur un disque externe |
| `manuels-extraits\entretien`, `parcours` | plans d'entretien et parcours extraits | 0,18 Go | chargés en base (missions 07, 10) | copie de sûreté |
| `Ducati\Info DB` | **exports G8 (Excel) et ≈ 12 700 factures PDF de clients** (données personnelles) | **1,60 Go** | source de la reprise G8 (déjà chargée dans `ged`) | **copie chiffrée** sur un support sûr, puis décider de la durée de conservation |
| `Ducati\Info Doc` | 27 manuels G8 en PDF | 1,11 Go | doublon de Téléchargements | rien (référence) |
| `Ducati` (reste) | ancien clone du dépôt (juillet) + `node_modules` | 0,35 Go | non | supprimable après vérification |
| `ducati-brussels-app` | clone principal + 47 worktrees d'agents (`.claude\worktrees`, 7,0 Go) | 7,48 Go | non (sur GitHub) | nettoyage §5.2 |
| `wt-*` (103 dossiers) | worktrees de lots | 6,07 Go | non, sauf `wt-nettoyage` et `wt-marques` (§5.2) | nettoyage §5.2 |
| `2Appros` | fichiers d'approvisionnement | 0,11 Go | probable | copie de sûreté |
| `dossier Accident` | dossier accident (photos, documents) | 0,10 Go | probable | copie de sûreté |
| `uploads de whatsapp` | photos / vidéos reçues par WhatsApp | 0,06 Go | probable | copie de sûreté |
| Racine (`*.xlsx`, `*.pdf`, `*.log`, `1.mp4`) | **ListPrice PARTS / ACCESSORIES / APPAREL** (tarifs Ducati), inventaire du stock par rayon (23/09), doublons clients, entretiens en retard, `Manuel-Ducati-BXL.pdf`, journaux de chargement | 0,08 Go | les ListPrice sont aussi dans Téléchargements | copie de sûreté |
| `1 CRM`, `Chèque entreprise`, `tools-manuels`, `bible-commerciale`, `logos`, `screenshots`, `supabase`, `entretiens-extraits`, `extensionducati`, `factures ducati` | divers | < 0,03 Go | — | — |
| `C:\Users\simon\Downloads` (fichiers liés au projet) | 42 fichiers `catalogue-ducati-*.json` (extraction du catalogue, 0,44 Go) ; 44 fichiers G8 / exports / ListPrice / VIN (1,13 Go, dont `Export.PARC VEHICULES`, `ExportDucati.xls`, manuels G8) | ≈ 1,6 Go | catalogue : chargé en base ; exports : données personnelles | ranger avec `Info DB`, même traitement |

**Total lié au projet sur le PC : ≈ 70 Go**, dont ≈ 53 Go de données qui ne sont pas (ou pas
entièrement) ailleurs : les figures des manuels (51 Go) et les exports G8 / factures (≈ 2,7 Go).
Recommandation : un disque externe chiffré (BitLocker To Go) ou un dossier `pc-simon/` dans le
bucket de sauvegarde externe pour `Info DB` + exports ; décider pour les 51 Go de figures.

---

## 5. GitHub au propre

### 5.1 Branches distantes (`origin`) [V, 20/11/2026]

**80 branches** au total (hors `main`) :

| Catégorie | Nombre | État | Proposition |
|---|---|---|---|
| `backup/AAAAMMJJ-HHMMSS` | 17 | toutes contenues dans `main` | garder les 3 plus récentes + celle du 25/07 (convention) ; supprimer les 13 autres (les tags du dépôt `ducati-backup` restent) |
| `feat/lot-1…10`, `integration/backlog-italobike` (juillet) | 11 | fusionnées | supprimer |
| `lot-*`, `fix-*` fusionnées | 38 | fusionnées | supprimer (sauf les lots de la vague en cours tant qu'ils ne sont pas fusionnés) |
| `lot-g8-*` (articles, caisse, dépôt-vente, documents-vente, export-compta, numérotation, or-base, planning, stats), `fix-tests-sql` | 10 | **non fusionnées au sens Git**, mais chaque commit a son équivalent dans `main` (même titre : fusion par rebase) | supprimer après un dernier contrôle visuel |
| `lot-eclatee` (05/10, 25 fichiers) | 1 | **contenu absent de `main`** (`drawing-picker.tsx`, `update-panel.tsx`, migration `20261005120000`) ; la vue éclatée a été refaite par `lot-parcours-e` | **à décider** : abandonner ou récupérer |
| `lot-entretien-du` (05/10, 30 fichiers) | 1 | **contenu absent de `main`** (écran « entretiens dus », 2 migrations `20261005110000/111000`) | **à décider** |
| `lot-manuels` (23/09) | 1 | 2 migrations absentes de `main` (`20260923102000/103000`) | **à décider** |
| `docs/rapport-session` (26/07) | 1 | 1 rapport de session absent de `main` | archiver dans `docs/` ou supprimer |

Total proposé à la suppression : **≈ 72 branches**. Aucune n'a été supprimée.
Réglage conseillé : « Automatically delete head branches » (aujourd'hui désactivé) pour que chaque
branche fusionnée disparaisse seule.

### 5.2 Worktrees locaux (`C:\Users\simon\Desktop\ducati\wt-*`) [V]

**103 dossiers `wt-*`** + **47 worktrees d'agents** dans `ducati-brussels-app\.claude\worktrees\`,
187 branches locales (172 fusionnées). 74 worktrees ont un `node_modules` (63 sont des liens, 11 de
vrais dossiers).

| Catégorie | Nombre | Proposition |
|---|---|---|
| Fusionnés, propres, sans travail en cours | ≈ 80 | supprimer (`git worktree remove`) |
| Vague en cours (`wt-lot-decisions-q57-q60`, `wt-lot-perf-2`, `wt-lot-verif-parcours`, `wt-lot-verif-ecrans`, `wt-lot-ux-ui`, `wt-lot-infra`, `wt-lot-mise-en-prod`) | ≈ 7 | **garder** jusqu'à fusion |
| `wt-nettoyage` | 1 | **garder** : contient `docs/g8-inventaire/` (le brief de cette vague) et `docs/debrief-2026-10-29.md` **non commités** — les commiter d'abord |
| `wt-marques` | 1 | **garder** : 4 fichiers modifiés + 1 migration non commités (`20261005103000_m3_marques_europe.sql`) — décider |
| `wt-eclatee`, `wt-entretien-du`, `wt-manuels` | 3 | garder tant que le §5.1 n'est pas tranché |
| `wt-lot-g8-*` non fusionnés (dont `wt-lot-g8-achats`, **sans branche distante**, mais son commit est dans `main`) | 10 | supprimer après contrôle |
| `wt-netlify-test` | 1 | dossier **vide**, pas un dépôt Git : supprimer |
| `.claude\worktrees\agent-*` | 47 | supprimer ceux dont la branche est fusionnée (1 est verrouillé : `lot-ventes-audit`) |

Gain disque estimé : plusieurs Go (11 vrais `node_modules` + 100 copies du code).

### 5.3 Secrets dans le dépôt [V]

- Aucun secret trouvé, ni dans les fichiers actuels ni dans **tout l'historique** (recherche des
  formats Stripe `sk_live_`/`rk_live_`/`whsec_`, Supabase `sb_secret_`, GitHub `ghp_`/`github_pat_`,
  Anthropic `sk-ant-`, Brevo `xkeysib-`, Shopify `shpat_`/`shpss_`, AWS `AKIA…`, clés privées PEM,
  chaînes `postgres://user:motdepasse@`). Les occurrences trouvées sont des exemples dans la doc et
  des valeurs factices dans `tests/stripe-qr.test.ts` (qui vérifie d'ailleurs qu'aucune vraie clé
  n'est dans le code).
- Un seul jeton JWT dans tout l'historique : la clé **anon** (publique par conception).
- `.env` est commité : il ne contient que `SUPABASE_URL`, `SUPABASE_PROJECT_ID`,
  `SUPABASE_PUBLISHABLE_KEY` et leurs versions `VITE_` (valeurs publiques). Acceptable. Toute
  valeur secrète locale doit aller dans `.env.local` (déjà ignoré grâce à la règle `*.local`).
- Aucun secret GitHub Actions, aucun workflow avant cette branche.

### 5.4 Propositions

1. **Passer le dépôt en privé** (à décider, réglage par the-maul). Conséquences :
   - la protection de branche sur un dépôt privé demande **GitHub Pro (4 $/mois)** sur le compte
     the-maul [Doc] ;
   - Actions : 2 000 min/mois gratuites (la CI prend ≈ 5–8 min par PR) ;
   - Netlify gratuit + dépôt privé = un seul auteur de commit construit : réglé par Netlify Pro (§3).
2. **Protéger `main`** (réglage the-maul ; gratuit tant que le dépôt est public) : pull request
   obligatoire, contrôle `CI / Types, tests, build` obligatoire, pas de push forcé, pas de suppression.
   Attention : l'orchestrateur pousse aujourd'hui directement sur `main` → il faudra passer par des PR
   (ou l'autoriser en « bypass » pour le compte the-maul).
3. **CI minimale** : écrite dans cette branche, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) —
   installation Bun avec lockfile figé, `tsc --noEmit` (**9 erreurs** au 20/11, étape informative
   tant qu'il en reste ; à rendre bloquante ensuite), `bun test` (153 fichiers), `bun run build`.
   Elle donnera enfin un statut vert / rouge sur GitHub (Netlify n'en renvoie aucun).
4. **README** : écrit dans cette branche ([`README.md`](../README.md)).
5. **Règle du dépôt backup** (rappel `CLAUDE.md` §5.0, avec un ajout) :
   - avant chaque changement conséquent, demander au client, puis
     `git fetch origin` → **se placer sur `origin/main` à jour** (le backup du 18/11 a été pris
     depuis une copie locale en retard de 15 jours) → `git push backup origin/main:main` → tag
     `backup-AAAAMMJJ-HHMMSS` poussé sur `backup` → branche `backup/AAAAMMJJ-HHMMSS` sur `origin` ;
   - vérifier : `git ls-remote backup refs/heads/main` doit égaler `git rev-parse origin/main` ;
   - ne garder sur `origin` que les 3 dernières branches `backup/…` (les tags de `ducati-backup`
     suffisent pour remonter plus loin) ;
   - le dépôt `ducati-backup` reste **privé** et accueille le workflow de sauvegarde des données.

---

## 6. Récapitulatif : qui fait quoi, combien

| Action | Qui | Coût | Urgence |
|---|---|---|---|
| Créer le bucket externe (R2 ou OVH) + clés limitées | **client** | ≈ 1 $/mois | avant la mise en prod |
| Créer les clés S3 du Storage, la chaîne Session pooler, la paire de clés age, les 2 mots de passe, et les poser dans `ducati-backup` | **client** | 0 | avant la mise en prod |
| Copier le workflow dans `ducati-backup`, lancer le 1er essai, tester une restauration | nous (avec le client) | ≈ 0 (minutes GitHub gratuites) | dès que les secrets existent |
| PITR 7 jours | **à décider** | ≈ 100 $/mois | après la mise en prod |
| CNAME `dms` et `app` chez Combell | **client** (accès Combell) | 0 | semaine 1 |
| Domaines dans Netlify, Supabase Auth, variables, `APP_ORIGINS`, Shopify app, extension | nous | 0 | même soir que le DNS |
| Lien « Espace client » du thème Shopify | client | 0 | même soir |
| Netlify Pro (compte agence ou concession) | **client / agence** | ≈ 20 $/mois | avant la mise en prod |
| Région des fonctions Francfort / Paris, aperçus protégés | nous | 0 | à la migration |
| Dépôt en privé (+ GitHub Pro pour protéger `main`) | **à décider** (the-maul) | 0 ou 4 $/mois | dès que possible |
| Protection de `main` + CI obligatoire | the-maul (réglage) | 0 | après fusion de cette branche |
| Suppression des ≈ 72 branches et ≈ 80 worktrees fusionnés | **à décider**, puis nous | 0 | après la vague en cours |
| `lot-eclatee`, `lot-entretien-du`, `lot-manuels`, `wt-marques` | **à décider** (Simon) | — | — |
| Remettre `ducati-backup` à jour (96 commits de retard) | nous, **avec l'accord du client** (règle §5.0) | 0 | avant la prochaine migration |
| Copier `Ducati\Info DB` et les autres données uniques du PC sur un support sûr | **client** | 0 | dès que possible |
| SPF + DMARC sur `ducatibruxelles.be` | client (Combell) | 0 | recommandé |
| Registre RGPD : Anthropic, Brevo, Shopify, Stripe, sauvegarde externe | client (avec nous) | 0 | avant la mise en prod |

**Coût mensuel total proposé** : Supabase ≈ 30 $ (existant) + Netlify Pro ≈ 20 $ + stockage de
sauvegarde ≈ 1 $ = **≈ 51 $/mois**, + 100 $ si PITR, + 4 $ si dépôt privé protégé.
