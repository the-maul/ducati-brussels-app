# Hébergement sur Cloudflare Workers — essai (20/11/2026)

> **Statut** : préparé et testé en local, **rien n'est déployé**. La production reste sur Netlify
> (`ducatilive.netlify.app`). Les deux constructions coexistent : `bun run build` (Netlify, inchangé)
> et `bun run build:cloudflare` (Cloudflare). Complète le §3 de `docs/infra-mise-en-prod.md`.

## 1. Verdict

**Oui, le DMS fonctionne sur Cloudflare Workers**, à condition de prendre l'offre **Workers Paid
(5 $/mois)** : l'offre gratuite limite le calcul à 10 ms par requête, trop peu pour le rendu serveur
de pages de cette taille, et son plafond de taille était à la limite.

Vérifié en local (`wrangler dev`, moteur workerd identique à la production Cloudflare, sans compte) :

| Contrôle | Résultat |
|---|---|
| Build Cloudflare | OK en ~2 min (même besoin mémoire que Netlify : 6 Go) |
| Démarrage du serveur | OK ; temps de démarrage mesuré ≈ 50 ms (limite Cloudflare : 1 s) |
| `/` | 307 → `/dashboard` (comme sur Netlify) |
| `/login` (rendu serveur) | 200, titre « Connexion — Ducati Bruxelles », `lang="fr"`, aucune erreur console |
| `/dashboard` sans session | rendu serveur 200 puis renvoi vers `/login` côté navigateur (comportement actuel) |
| `/inscription`, `/app-client` | 200 ; fonctions serveur (`/_serverFn/…`) appelées et 200 |
| Statiques `/assets/*` | 200, `cache-control: public, max-age=31536000, immutable` |
| Polices, images, langues NL/EN/IT (chargées à la demande, piège n° 14) | 200 |
| `/favicon.ico` | 200 `image/webp` servi en statique (sans réveiller le serveur) |
| Page inconnue | 404 HTML de l'application |
| Tests `bun test` | 2 425 / 2 425 OK |
| Build Netlify (`bun run build`) | OK, sortie identique (preset `netlify`) |

Non testé (exige un compte ou des secrets) : connexion réelle, écran Utilisateurs (clé de service),
envoi réel d'une inscription, domaine personnalisé.

## 2. Ce qui a été ajouté au dépôt

| Fichier | Rôle |
|---|---|
| `vite.config.ts` | choisit la cible : `DEPLOY_TARGET=cloudflare` → preset Nitro `cloudflare-module` ; sinon `netlify` (défaut, production) |
| `wrangler.jsonc` | nom du Worker `ducati-dms`, `compatibility_date` 2026-11-01, `nodejs_compat`, journaux activés, `keep_vars` |
| `package.json` | `build:cloudflare`, `cf:dev` (serveur local sur le port 8787), `cf:deploy` |
| `.github/workflows/deploiement-cloudflare.yml` | déploiement par GitHub Action, **désactivé** (manuel + variable `CLOUDFLARE_ACTIF=oui` + 2 secrets) |
| `src/modules/signup/app-client.functions.ts` | lit aussi l'IP fournie par Cloudflare (`cf-connecting-ip`) pour la limite anti-abus |

Choix du preset : la doc TanStack Start recommande aujourd'hui `@cloudflare/vite-plugin` ; ce
projet construit déjà avec Nitro (Netlify) et Lovable le déployait en Nitro `cloudflare-module`.
Garder Nitro permet deux cibles depuis la même configuration, sans nouvelle dépendance. Nitro génère
`.output/server/wrangler.json` (point d'entrée + dossier des statiques) à partir de `wrangler.jsonc`,
et `.wrangler/deploy/config.json` qui l'indique à Wrangler.

Équivalent de `netlify.toml` :

| Netlify | Cloudflare |
|---|---|
| `command = "bun run build"`, `publish = "dist"` | `bun run build:cloudflare` → `.output/public` (statiques) + `.output/server` (Worker) |
| `NODE_OPTIONS=--max-old-space-size=6144` | même variable dans le workflow |
| redirection 200 `/favicon.ico` → `/brands/ducati.webp` | `.output/public/_redirects` (écrit au build par `vite.config.ts`) |
| en-têtes `/assets/*` (générés par Nitro) | `.output/public/_headers` (générés par Nitro) |
| région des fonctions | sans objet : le Worker tourne près du visiteur (Bruxelles → nœud européen) |

## 3. Variables d'environnement (aucune valeur ici)

| Variable | Quand | Où la poser | Secret ? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | build | déjà dans `.env` du dépôt | non (publique) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | build | déjà dans `.env` du dépôt | non (publique) |
| `VITE_CLIENT_APP_URL` | build, facultative | variable GitHub (Actions → Variables) | non |
| `VITE_CLIENT_APP_HOST` | build, facultative — seulement quand `app.` est en ligne | variable GitHub | non |
| `VITE_MANUELS_BASE` | build, facultative (figures des manuels) | variable GitHub si utilisée | non |
| `SUPABASE_URL` | serveur | Cloudflare → Workers → ducati-dms → Settings → Variables and Secrets | non |
| `SUPABASE_PUBLISHABLE_KEY` | serveur (middleware d'authentification) | idem | non |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur (écran Utilisateurs, inscription, liste d'attente) | idem, type **Secret**, **posée par le client** | **OUI** |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | déploiement | GitHub → Actions → Secrets | **OUI** (jeton) |

Lues dans le code mais inutilisées : `DATABASE_URL`, `STRIPE_SECRET_KEY` (exemples en commentaire de
`src/lib/config.server.ts`). Sur Workers, les variables ne sont disponibles **que pendant une
requête** : le code les lit déjà dans les fonctions (jamais au chargement du module) ; avec
`nodejs_compat` et une date ≥ 2025-04-01, `process.env` est rempli automatiquement.

Essai local : copier `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` de `.env` dans `.dev.vars`
(ignoré par Git), puis `bun run build:cloudflare` et `bun run cf:dev` → http://localhost:8787.

## 4. Inventaire de compatibilité Workers

Code exécuté côté serveur : `src/server.ts`, `src/start.ts`, le rendu de toutes les routes, et
7 fichiers de fonctions serveur (`src/lib/auth/admin.functions.ts`, `src/modules/signup/*.functions.ts`,
`src/lib/api/example.functions.ts`) + `src/integrations/supabase/*`.

| Point | Constat | Action |
|---|---|---|
| Modules Node (`fs`, `path`, `crypto`, `buffer`, `stream`, `child_process`) | aucun dans le code serveur ; seul `node:process` (`config.server.ts`), couvert par `nodejs_compat` | rien |
| PDF (jspdf), Excel (xlsx), captures (html2canvas, canvg) | **générés dans le navigateur**, jamais sur le serveur | rien ; mais ils pèsent ~2 Mo dans le Worker car importés en tête de composants (voir taille) |
| Images / sharp | aucun ; redimensionnement par `<canvas>` dans le navigateur | rien |
| WebSockets | Supabase Realtime va du navigateur à Supabase, pas par le Worker | rien |
| Appels longs | fonctions serveur courtes (quelques appels Supabase) ; tâches lourdes = Edge Functions Supabase et `pg_cron`, non concernées | rien |
| Temps CPU | rendu SSR mesuré en local 30 à 70 ms (temps total) ; limite Paid 30 s par défaut | rien ; Free (10 ms) insuffisant |
| Mémoire (128 Mo par instance) | le Worker charge les pages à la demande ; démarrage 50 ms | à surveiller dans les journaux du 1er mois |
| IP du visiteur (limite anti-abus de la liste d'attente) | lisait l'en-tête Netlify seulement → sur Cloudflare tous les visiteurs auraient partagé un même compteur | **corrigé** (`cf-connecting-ip`) |
| Messages d'erreur « Configure them in Netlify… » | fichiers générés Supabase (`client.ts` & co) | texte seulement, sans effet |
| Langues à la demande (piège n° 14) | modules `nl/en/it` séparés dans le Worker et dans les statiques, chargés à la demande | vérifié |

**Taille du Worker (mesurée par `wrangler deploy --dry-run`)** : 436 modules, **13,6 Mo non compressés,
2,93 Mo compressés (gzip)**. Limites : 10 Mo compressés en Paid (3 Mo en gratuit : à la limite) ;
la page « Limits » de Cloudflare indique désormais 64 Mo non compressés comme seul plafond. Marge
confortable en Paid dans les deux cas. Gain possible plus tard (pas nécessaire) : charger jspdf,
xlsx et html2canvas par `import()` au moment du clic, ce qui retire ~2 Mo du Worker.

## 5. Déploiement : deux options

| | **A. Workers Builds** (Cloudflare relié à GitHub) | **B. GitHub Action + `wrangler deploy`** |
|---|---|---|
| Mise en place | le client installe l'application GitHub de Cloudflare ; le propriétaire du dépôt (the-maul) l'autorise sur le dépôt | le client crée un **jeton API** à droits minimaux ; the-maul le pose en secret GitHub |
| Ce qui est construit | chaque push (branches configurables), aperçu par branche | uniquement quand on le décide (bouton « Run workflow »), après les tests |
| Tests avant mise en ligne | non (Cloudflare construit et publie) | **oui** (`bun test` avant le build) |
| Machine de build | 8 Go, 20 min max — suffisant | 16 Go (GitHub, déjà utilisée par la CI) |
| Coût | 6 000 min de build incluses en Paid | gratuit (dépôt public) |
| Accès | le compte Cloudflare du client lit tout le dépôt | Cloudflare n'a aucun accès au dépôt ; le jeton ne sait que publier ce Worker, révocable en 1 clic |

**Recommandation : B (GitHub Action)**, fichier prêt dans `.github/workflows/deploiement-cloudflare.yml`,
désactivé. Raisons : rien ne part en ligne sans tests verts ; on garde la main sur le moment de la
mise en ligne pendant l'essai ; aucun accès du compte Cloudflare au dépôt ; même machine que la CI
actuelle. Mode `version` = envoi d'une version avec adresse d'aperçu **sans** la mettre en ligne.

Jeton à créer par le client (Cloudflare → My Profile → API Tokens → Create Token → Custom token) :
- **Account → Workers Scripts → Edit**, limité au compte de la concession ;
- au moment du domaine seulement, si le workflow doit gérer la route : **Zone → Workers Routes → Edit**
  limité à la zone `ducatibruxelles.be` (sinon le domaine se branche à la main dans le tableau de bord) ;
- durée : date d'expiration (ex. 1 an) ; filtre IP inutile (GitHub change d'adresses).

## 6. Domaine `dms.ducatibruxelles.be`

Contrainte Cloudflare : un **domaine personnalisé de Worker exige que la zone DNS soit chez
Cloudflare**. Un simple CNAME chez Combell vers `*.workers.dev` **ne fonctionne pas**.

| Option | Ce que ça demande | Avis |
|---|---|---|
| 1. Garder l'adresse `ducati-dms.<compte>.workers.dev` pendant l'essai | rien | **pour l'essai** |
| 2. Déplacer la zone `ducatibruxelles.be` chez Cloudflare (offre gratuite) | recopier **tous** les enregistrements (Shopify racine + `www` en « DNS only », MX et mails Combell, vérifications), puis changer les serveurs de noms chez Combell (registrar) | **pour la bascule** ; le site Shopify et la messagerie ne doivent pas bouger : vérifier chaque enregistrement avant le changement |
| 3. Configuration partielle (CNAME) | offre Business (≈ 200 $/mois) | non |

`ducatibxl.be` (boîtes Microsoft 365) n'est pas concerné.

Adresses à mettre à jour au moment de la bascule (détail : `docs/infra-mise-en-prod.md` §2.3, mêmes
lignes qu'avec Netlify, seule la cible change) :
1. Supabase Auth → **Site URL** `https://dms.ducatibruxelles.be` ; **Redirect URLs** : `https://dms.ducatibruxelles.be/**`,
   `https://app.ducatibruxelles.be/**`, l'adresse `workers.dev` pendant l'essai, `https://ducatilive.netlify.app/**`
   pendant 1 mois (retour arrière).
2. Secret Edge `APP_ORIGINS` : ajouter le nouveau domaine (`app.` en premier) et l'adresse `workers.dev` pendant l'essai.
3. Variables GitHub `VITE_CLIENT_APP_URL` / `VITE_CLIENT_APP_HOST` (au lieu de Netlify).
4. Shopify : `integrations/shopify-app/shopify.app.toml` (`application_url`, `redirect_urls`) + lien « Espace client » du thème.
5. Extension My Ducati : `tools/myducati-extension/manifest.json` et `background.js` n'autorisent
   que `*.netlify.app` → ajouter `https://dms.ducatibruxelles.be/*` (et l'adresse `workers.dev` pour l'essai),
   regénérer `public/myducati-extension.zip`, réinstaller sur les PC.
6. Appareils (borne, écrans client caisse, tablettes) : rouvrir sur la nouvelle adresse et ré-appairer.

## 7. Coûts et usage estimé

Workers Paid : **5 $/mois** par compte, 10 M requêtes et 30 M ms de CPU inclus ; **requêtes vers les
statiques gratuites et illimitées** ; pas de frais de trafic.

Usage estimé : **12 comptes** du personnel (base au 20/11). L'application est une page unique : le
serveur n'est sollicité qu'au chargement complet d'une page (ouverture, rechargement, nouvel onglet)
et pour quelques fonctions serveur ; la navigation et les données passent ensuite par le navigateur
et Supabase. Hypothèse large : 15 personnes × 150 chargements/jour + espace client, borne, robots
≈ **3 000 à 5 000 requêtes Worker/jour, ≈ 150 000/mois = 1,5 % du forfait** ; CPU ≈ 150 000 × 50 ms
= 7,5 M ms = 25 % du forfait. **Coût attendu : 5 $/mois fixes** (Netlify Pro : ≈ 20 $/mois).

## 8. Plan de bascule et retour arrière

1. **Essai** (aucun impact) : compte Workers Paid du client, jeton, secrets GitHub, variables
   serveur posées par le client ; workflow en mode `production` → `ducati-dms.<compte>.workers.dev` ;
   ajouter cette adresse dans Supabase Redirect URLs et `APP_ORIGINS` ; recette dans la société ItalTest
   (connexion, OR, caisse, PDF, Excel, inscription, écran Utilisateurs) pendant 1 à 2 semaines.
2. **Préparer le DNS** : zone `ducatibruxelles.be` créée chez Cloudflare, enregistrements recopiés et
   vérifiés (Shopify, MX) ; changement des serveurs de noms chez Combell un jour calme ; attendre la
   propagation (site Shopify et mails vérifiés).
3. **Bascule** (un soir sans activité) : domaine `dms.` (puis `app.`) ajouté au Worker (Custom Domain,
   certificat automatique) ; mise à jour des adresses du §6 ; Netlify **laissé en service** sur
   `ducatilive.netlify.app`.
4. **Retour arrière** :
   - mauvaise version sur Cloudflare : tableau de bord → Deployments → version précédente (ou
     `npx wrangler rollback`), instantané ;
   - problème Cloudflare lui-même : retirer le Custom Domain et remettre `dms` en CNAME vers
     `ducatilive.netlify.app` (dans la zone Cloudflare, en « DNS only »), Site URL Supabase sur l'adresse
     Netlify ; l'ancienne adresse Netlify a continué de fonctionner pendant tout ce temps.
5. **Après 1 mois sans incident** : arrêter les builds Netlify, puis fermer le site personnel.

Les données ne bougent pas (Supabase à Paris) : aucune migration de base, aucun risque de perte.
