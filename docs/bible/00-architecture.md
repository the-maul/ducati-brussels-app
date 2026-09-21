---
chapitre: TRANSVERSE-architecture
titre: Architecture technique
verifie_le: 2026-09-18
mots_cles: [architecture, pile technique, TanStack Start, React, Supabase, Netlify, déploiement, Edge Functions, pg_cron, secrets, Microsoft Graph, Anthropic, Stripe, Resend, VIES, Falco, RLS, rôles, i18n, migrations, types générés]
---

# Architecture technique — DMS Ducati Bruxelles

> **En une phrase** : une application web React rendue côté serveur (TanStack Start), hébergée sur
> Netlify, qui s'appuie entièrement sur un projet Supabase (base PostgreSQL, authentification, fichiers,
> fonctions serveur et tâches planifiées).

Ce chapitre est la carte du système. Les règles métier (glossaire, invariants B1–B12) sont dans
[`../../CLAUDE.md`](../../CLAUDE.md) ; l'état de reprise dans [`../etat-projet.md`](../etat-projet.md).
Tout ce qui est écrit ici a été vérifié le 18/09/2026 dans le code **et** dans la base
(`ujmrosbgkvgvwfnuryna`), sauf mention « à vérifier ».

---

## 1. Vue d'ensemble

```
Navigateur (utilisateur connecté)
   │  HTTPS
   ▼
Netlify ── https://ducatilive.netlify.app
   │  pages rendues côté serveur (fonction SSR) + fichiers statiques (dist/)
   │  server functions TanStack (admin utilisateurs, clé de service)
   ▼
Supabase (projet ujmrosbgkvgvwfnuryna)
   ├─ PostgreSQL : tables métier, RLS, fonctions SQL (RPC), triggers d'audit → events
   ├─ Auth : comptes, sessions (JWT)
   ├─ Storage : bucket privé « ged », bucket public « shop-assets »
   ├─ Edge Functions (Deno) : e-mail Outlook, IA Claude, Stripe, VIES, notifications
   └─ pg_cron + pg_net : 6 tâches planifiées (dont 2 appellent des Edge Functions)
        │
        ▼
Services externes : Microsoft Graph (Outlook), Anthropic (Claude), Stripe, VIES, [Resend, SMS, Falco : non branchés]
```

Le navigateur parle **directement** à Supabase (client `@supabase/supabase-js` avec la clé publique
« anon » + le jeton de session). La sécurité des données repose donc sur la **RLS** et sur les
contrôles écrits dans les fonctions SQL, pas sur le serveur Netlify.

## 2. Pile technique

| Couche | Technologie | Où c'est configuré |
|---|---|---|
| Langage | TypeScript 5.8 (front), SQL PostgreSQL (base), TypeScript Deno (Edge Functions), Python 3 (scripts de reprise) | `tsconfig.json` |
| Framework web | **TanStack Start** (rendu serveur) + **TanStack Router** (routes fichier par fichier) | `vite.config.ts`, `src/start.ts`, `src/server.ts`, `src/router.tsx` |
| Interface | **React 19**, **Tailwind CSS 4**, **shadcn/ui** (47 composants dans `src/components/ui/`), icônes `lucide-react` | `components.json`, `src/styles.css`, `src/styles/tokens.css` |
| Données côté client | **TanStack Query** (cache, mutations, toast global d'enregistrement) | `src/lib/mutation-feedback.ts`, `src/router.tsx` |
| Formulaires | `react-hook-form` + `zod` | — |
| Graphiques / fichiers | `recharts`, `jspdf`, `xlsx` | `package.json` |
| Build | **Vite 7** via `@lovable.dev/vite-tanstack-config` (héritage du scaffold Lovable, toujours utilisé pour la config), **Nitro** preset `netlify` | `vite.config.ts` |
| Gestionnaire de paquets | **Bun** (`bun.lock`, `bunfig.toml`) ; `package-lock.json` existe aussi | — |
| Hébergement front | **Netlify** (build à chaque push sur `main`) | `netlify.toml`, `docs/deploiement-netlify.md` |
| Back-end | **Supabase** : PostgreSQL + RLS, Auth, Storage, Edge Functions, `pg_cron` 1.6.4, `pg_net` | `supabase/config.toml`, `supabase/migrations/`, `supabase/functions/` |
| Tests | `bun test` (26 fichiers dans `tests/`) ; pas de script npm `test` | `bunfig.toml` |
| Qualité | ESLint 9, Prettier | `eslint.config.js` |

> Lovable a été abandonné le 10/08/2026 (commit `a7d9a2d`) mais le paquet `@lovable.dev/vite-tanstack-config`
> reste la base de `vite.config.ts`, et plusieurs fichiers de `src/integrations/supabase/` portent encore
> l'en-tête « automatically generated ». Ne pas les supprimer sans remplacer la configuration.

## 3. Arborescence du dépôt

| Chemin | Rôle |
|---|---|
| `CLAUDE.md` | Règles du projet : glossaire métier, invariants B1–B12, conventions, méthode (backup avant changement conséquent) |
| `docs/` | Documentation : `etat-projet.md` (reprise, à lire en premier), `avancement.md` (checklist des 140 exigences + état des migrations), `cahier-fonctionnel-v2.md` (exigences GAP, annexes A et B), `dossier-projet.md`, `charte-graphique.md`, `g8-fonctions-*.md` (rétro-ingénierie de G8 par module), `migration-g8-formats.md`, `integrations-cles-api.md`, `deploiement-netlify.md`, plans de chantier (`plan-nouveau-client.md`, `process-commandes-pieces.md`) |
| `docs/decisions/` | ADR : `ADR-000-template.md`, `ADR-001-design-tokens-mapping.md`, `ADR-002-type-gestion-T-main-oeuvre.md` |
| `docs/bible/` | Cette documentation de référence : `00-architecture.md`, `modules/Mxx-*.md`, modèle `_modele-chapitre.md` |
| `src/routes/` | **Écrans**. Un fichier = une URL. `__root.tsx` (coquille), `_app.tsx` (zone connectée, redirige vers `/login` sans session), `_app.<module>.*.tsx` (pages), `login.tsx`, `reset-password.tsx`, `shop.$slug.tsx` (vitrine publique), `index.tsx` |
| `src/routeTree.gen.ts` | Arbre des routes **généré** par le plugin TanStack — ne jamais l'éditer |
| `src/modules/<module>/` | **Logique métier par module** (accès base, calculs, composants spécifiques) : `contacts`, `articles`, `vehicles`, `purchases`, `orders`, `stock`, `sales`, `tradein`, `workshop`, `documents`, `crm`, `web`, `accounting`, `reports`, `migration`, `settings`, `improvements` |
| `src/components/` | Composants partagés : `ui/` (shadcn, ne pas réécrire), `layout/` (coquille, barre latérale, en-tête de page, navigation mobile), `global-search.tsx` (recherche Ctrl+K), `status-badge.tsx`, `kpi-card.tsx`, `photo-editor.tsx`, `rich-editor.tsx`, `confirm-provider.tsx` |
| `src/lib/` | Transverse : `i18n/` (dictionnaire `fr.ts` + `t()`), `auth/` (`auth-context.tsx` session / société active / rôles, `admin.functions.ts` server functions d'administration), `navigation.ts` (menu et filtrage par rôle), `mutation-feedback.ts`, `use-dirty.ts`, `use-save-mutation.ts`, `pricing.ts`, `ducati*.ts` (décodage VIN Ducati), `error-*.ts` |
| `src/integrations/supabase/` | `client.ts` (client navigateur), `client.server.ts` (client clé de service, SSR uniquement), `auth-middleware.ts` / `auth-attacher.ts` (jeton de session transmis aux server functions), `types.ts` (**types générés depuis le schéma**, 6 278 lignes) |
| `src/styles.css`, `src/styles/tokens.css` | Styles globaux ; **tokens de la charte** (seul endroit des couleurs et polices, en `oklch`) |
| `src/server.ts`, `src/start.ts`, `src/router.tsx` | Point d'entrée SSR (page d'erreur), middlewares globaux, création du routeur et du client Query |
| `supabase/migrations/` | **Schéma versionné** : 115 fichiers SQL horodatés `AAAAMMJJHHMMSS_<module>_<sujet>.sql`. **Non appliqués automatiquement** (§5) |
| `supabase/functions/` | 11 **Edge Functions** Deno (§6) |
| `supabase/config.toml` | Référence du projet + `verify_jwt = false` déclaré pour 4 fonctions (ne reflète pas l'état déployé, §6) |
| `tests/` | Tests `bun test` des règles critiques (PAMP, totaux ventes / atelier, UBL, SEPA, imports, reprises…) |
| `tools/migration/` | Scripts Python de reprise G8 (`import_g8.py`, `import_pdf_lines.py`, `import_pdf_ged.py`), voir M14 |
| `tools/myducati-extension/` | Extension navigateur : import « My Ducati » (par VIN) **et** import du catalogue Ducati depuis l'e-catalog (`catalog-core.js` règles testées, `catalog.js` panneau et parcours ; relais `background.js` → `dms-bridge.js` → `src/modules/catalog/bridge.ts`). `public/myducati-extension.zip` = version téléchargeable (v0.10.0) |
| `tools/catalog-loader/` | Chargeur des fichiers d'extraction du catalogue Ducati (`load.mjs`, clé de service lue dans l'environnement, jamais affichée ; `transform.mjs` testé) — mission 06 |
| `public/` | Fichiers statiques : polices Ducati Style (`fonts/`), zip de l'extension |
| `seed/` | Vide ; les données de démonstration sont dans la migration `20260612150000_seed_demo_data.sql` |
| `.claude/skills/dev-sur-github/` | Protocole Git (backup, remotes `origin` / `backup`) |
| `.claude/launch.json` | Lancement local (`npm run dev`, port 8080) — non versionné |
| `dist/` | Sortie de build (ignorée par Git) |

### Correspondance modules ↔ code

| Module | Logique (`src/modules/`) | Écrans principaux (`src/routes/`) | Chapitre |
|---|---|---|---|
| M0 Socle | `settings`, `improvements`, `src/lib/auth` | `_app.settings.*`, `_app.improvements.tsx`, `login.tsx`, `reset-password.tsx` | — |
| M1 Contacts | `contacts` | `_app.clients.*`, `_app.client-pricing.tsx` | — |
| M2 Articles | `articles` | `_app.parts.*` | — |
| M3 Véhicules | `vehicles` | `_app.vehicles.*`, `_app.settings.extension.tsx` | — |
| M4 Achats | `purchases`, `orders` | `_app.purchases.*`, `_app.orders.*` | — |
| M5 Stock | `stock` | `_app.stock.*` | — |
| M6 Ventes & caisse | `sales` | `_app.sales.*`, `_app.pos.tsx`, `_app.picking.tsx` | [M06](modules/M06-ventes-caisse.md) |
| M7 Reprises | `tradein` | `_app.tradein.*`, `_app.consignment.tsx` | — |
| M8 Atelier | `workshop` | `_app.workshop.*` | [M08](modules/M08-atelier.md) |
| M9 Documents | `documents` | (panneaux intégrés aux fiches) | — |
| M10 CRM | `crm` | `_app.crm.tsx` | — |
| M11 Web | `web` | `_app.eshop.tsx`, `shop.$slug.tsx` | — |
| M12 Compta | `accounting` | `_app.accounting*.tsx` | [M12](modules/M12-compta.md) |
| M13 Reporting | `reports` | `_app.dashboard.tsx`, `_app.reports.tsx` | [M13](modules/M13-reporting.md) |
| M14 Migration | `migration` | `_app.settings.migration.tsx` | [M14](modules/M14-migration-g8.md) |

## 4. Base de données — repères
- **Multi-société** : toute table métier porte `company_id` ; 2 sociétés en base (ITALBIKE STORE, NL INVEST). La RLS s'appuie sur `is_member(company_id)` ; quelques actions sur `is_admin` / `has_role(_company, 'admin')`.
- **Audit** : triggers `*_audit` (INSERT / UPDATE / DELETE) vers la table append-only `events` sur les tables de documents (vérifié pour `documents`, `document_payments`, `repair_orders`, `repair_order_lines`, `workshop_appointments`, `workshop_time_entries`, `cash_sessions`, `accounting_entries`).
- **Stock et prix append-only** : `stock_moves`, `price_changes` ; écriture par `record_stock_move` / `record_price_change`.
- **Numérotation** : `document_sequences` + `next_document_number(_company, _doc_type)`. Séquences par société ; en plus des préfixes de `CLAUDE.md` §4.3, les ventes ont `BL-`, `RES-`, `AVO-` et, depuis le 19/09 (mission 05), **`BC-` (bon de commande client)**, gérables dans Paramètres → Numérotation.
- **Storage** : `ged` (privé, RLS par société ; exception : images des articles publiables lisibles anonymement pour la vitrine, politique `ged_public_products`) ; `shop-assets` (public, images du constructeur de site).
- **Tables de référence globales** (sans `company_id`, exception assumée) : `ducati_vds`, `ducati_vin_facts` et le **catalogue Ducati** `ducati_catalog_*` (mission 06, décision M-19) — lecture équipe, écriture uniquement par fonctions.
- **Extensions** : `pg_cron` 1.6.4 ; `pg_net` installé dans le schéma `public` (signalé par l'audit Supabase).

### ⚠️ Dérive dépôt ↔ base
Une migration présente dans `supabase/migrations/` **n'est pas forcément appliquée**. Vérifié le 18/09/2026 :
toujours absents en base `vehicles.papers_100hp`, `articles.year_from`, `tradein_partners`,
`article_import_settings`, `oro.tradein_status` (liste complète : `etat-projet.md` §2). Conséquence :
les fiches véhicule et article s'enregistrent (le code retire la colonne absente et réessaie) mais
**perdent les champs concernés sans avertissement** ; Paramètres → Sociétés ne s'enregistre plus ;
module reprises inopérant (détail : chapitres M02, M03, M07). **La table
`supabase_migrations.schema_migrations` n'est pas fiable** : seule la présence réelle des objets fait foi
(`to_regclass`, `information_schema.columns`).

## 5. Déploiement

| Élément | Comment il part en production | Automatique ? |
|---|---|---|
| **Front + SSR** (tout `src/`, `public/`) | Push sur `main` du dépôt `the-maul/ducati-brussels-app` → Netlify lance `bun run build` → publie `dist/` + fonction SSR (`.netlify/functions-internal/`) | **Oui** |
| **Migrations SQL** (`supabase/migrations/`) | À appliquer **à la main** (éditeur SQL Supabase, outil MCP `apply_migration`, ou CLI `db push`), puis vérifier les objets et régénérer `types.ts` | **Non** |
| **Edge Functions** (`supabase/functions/`) | `npx supabase@2.117.0 functions deploy <nom> --project-ref ujmrosbgkvgvwfnuryna --use-api` | **Non** |
| **Secrets des Edge Functions** | Tableau de bord Supabase (Edge Functions → Secrets) ou `npx supabase@2.117.0 secrets set NOM=valeur --project-ref ujmrosbgkvgvwfnuryna` | **Non** |
| **Tâches pg_cron** | Créées par des migrations (`cron.schedule`) ; n'existent que si la migration a été passée | **Non** |
| **Réglages Auth** (URL du site, redirections) | Tableau de bord Supabase → Authentication → URL Configuration | **Non** |
| **Variables Netlify** | Netlify → Site settings → Environment variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (build), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (runtime SSR, **secret**, sert à l'écran Utilisateurs) | Non (réglage manuel) |

Points d'attention :
- **Netlify ne renvoie aucun statut à GitHub** : un build cassé ne se voit pas depuis le dépôt. Vérifier dans l'interface Netlify.
- **Auteur des commits** : sur le plan gratuit avec dépôt privé, Netlify ne construit que les commits d'un seul contributeur (`Simonclaw2505`, `docs/deploiement-netlify.md`). **Le dépôt est actuellement public** (vérifié via l'API GitHub le 18/09/2026) : cette contrainte est donc à revérifier.
- **Retour arrière** : Netlify → Deploys → publier un déploiement précédent (instantané). Une migration, elle, ne se défait pas.
- Remotes Git : `origin` = `the-maul/ducati-brussels-app` (public), `backup` = `the-maul/ducati-backup` (privé). Procédure de sauvegarde : `CLAUDE.md` §5.0 et skill `dev-sur-github`.

## 6. Fonctions serveur Supabase (Edge Functions)

Liste complète des 11 fonctions de `supabase/functions/`, toutes déployées et `ACTIVE` (vérifié via l'API Supabase).
« JWT » = vérification du jeton par la plateforme **telle que déployée** (≠ `config.toml`).

| Fonction | Rôle | Appelant | Secrets | JWT déployé | Contrôle d'accès dans le code |
|---|---|---|---|---|---|
| `outlook-poll` | Relève les boîtes Outlook (`company_mailboxes`), journalise les mails sur les contacts, pièces jointes en GED, fait classer les expéditeurs inconnus (→ prospect ou trace), puis déclenche `summarize-exchange` | pg_cron `outlook-poll` (toutes les 5 min) ; bouton de la fiche contact (`src/modules/crm/communications-panel.tsx`) | `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` (+ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` injectés) | non | aucun (déclenchable par n'importe qui) |
| `classify-prospect-email` | Un appel à Claude : ce mail inconnu est-il un prospect ? extraction nom, téléphone, moto… | `outlook-poll` | `ANTHROPIC_API_KEY` | non | **aucun** |
| `summarize-exchange` | Un paragraphe résumé par échange ajouté à la note de la demande CRM (Claude) | `outlook-poll` | `ANTHROPIC_API_KEY` (+ clé de service) | oui | exige la clé de service en `Authorization` |
| `graph-send-email` | Envoi d'un e-mail depuis une boîte partagée ou l'adresse de l'utilisateur (Graph `/sendMail`) | `src/modules/crm/api.ts` (`sendEmailViaOutlook`), utilisé par CRM et Ventes | `MS_GRAPH_*` (+ clé de service) | non | vérifie l'utilisateur connecté et son appartenance à la société |
| `send-account-invitation` | Mails de compte par Outlook : invitation (choisir son mot de passe, jeton à usage unique vers `/reset-password`), bienvenue, « mot de passe modifié », **mot de passe oublié** (`kind: 'reset'`) | `src/modules/settings/users-api.ts`, `src/modules/signup/signup.functions.ts`, `src/lib/auth/password-notify.ts`, `src/lib/auth/password-reset.ts` | `MS_GRAPH_*` (+ clé de service), `APP_ORIGINS` facultatif (adresses permises dans le lien de réinitialisation) | oui | invitation : administrateur de la société ou serveur (clé de service) ; `password_changed` : la personne connectée ; `reset` : **public**, limité (1 / 5 min, 5 / h par adresse, 20 / h par IP), réponse identique que le compte existe ou non |
| `mailbox-diag` | Diagnostic en lecture d'une boîte écoutée : dossiers, nombre de messages, objet / expéditeur du plus récent | aucun appelant dans `src/` (outil manuel) | `MS_GRAPH_*` (+ clé de service) | non | **aucun** (seule condition : la boîte doit être dans `company_mailboxes`) |
| `read-id-doc` | Lecture par Claude (vision) d'un permis / d'une carte d'identité stockés en GED pour préremplir la fiche client | `src/modules/contacts/id-docs.tsx` | `ANTHROPIC_API_KEY` (+ clé de service) ; modèle `claude-opus-4-8` codé en dur (à vérifier) | non | **aucun** : télécharge les fichiers avec la clé de service |
| `vies-check` | Vérification d'un n° de TVA auprès de VIES (remplace la fonction SQL bloquée par le TLS d'`ec.europa.eu`) | `src/modules/contacts/vies-api.ts` | aucun | non | aucun (service public) |
| `dispatch-notifications` | Vide la file `notifications` : e-mail via Resend, SMS via un fournisseur générique ; sans clé → `skipped` | pg_cron `dispatch-notifications` (toutes les 10 min) | `RESEND_API_KEY`, `NOTIFY_FROM`, `SMS_API_URL`, `SMS_API_KEY`, `SMS_FROM` — **aucun posé** | non | aucun |
| `stripe-checkout` | Crée une session Stripe Checkout pour une commande web ; 501 si pas de clé | `src/modules/web/checkout.ts` (vitrine publique) | `STRIPE_SECRET_KEY` | non | aucun (public par nature) |
| `stripe-webhook` | Vérifie la signature Stripe puis `finalize_web_order` (commande payée → facture + sortie de stock) | Stripe | `STRIPE_WEBHOOK_SECRET` | non | signature Stripe |

## 7. Tâches planifiées (pg_cron)

Vérifié dans `cron.job` et `cron.job_run_details` le 18/09/2026 : 6 tâches, toutes actives, dernières exécutions en succès.

| Tâche | Planification (UTC) | Action | Créée par |
|---|---|---|---|
| `stock-copies-daily` | `30 22 * * *` (22:30 chaque jour) | `_cron_maybe_stock_copy()` : copie datée du stock (15 et fin de mois, B4) | `20260612170000_pg_cron_stock.sql` |
| `dormant-stock-alert` | `0 5 1 * *` (le 1er du mois, 05:00) | `_cron_dormant_alert()` : alerte stock dormant | `20260612170000_pg_cron_stock.sql` |
| `invoice-reminders` | `0 7 * * *` (07:00) | `_cron_invoice_reminders()` : relance e-mail des factures échues (1 / facture / 7 jours) | `20260612240000_m10_notifications.sql` |
| `appointment-reminders` | `0 17 * * *` (17:00) | `_cron_appointment_reminders()` : rappel e-mail + SMS des RDV atelier du lendemain | `20260612240000_m10_notifications.sql` |
| `dispatch-notifications` | `*/10 * * * *` | `net.http_post` → Edge Function `dispatch-notifications` | `20260612240000_m10_notifications.sql` |
| `outlook-poll` | `*/5 * * * *` | `net.http_post` → Edge Function `outlook-poll` | `20260612350000_m10_email_ingest.sql` |
| `sales-alerts` | `0 6 * * *` (06:00) | `_cron_sales_alerts()` : cloche interne seulement (aucun envoi) — rappel « acompte reçu : pièces à commander », factures échues impayées (1 alerte / document / échéance), alertes réglées | `20260919351000_m6_acompte_commande_soldes.sql` (ajoutée le 19/09, SQL pur, sans appel HTTP ni secret) |

Les deux appels HTTP portent la **clé publique anon** (écrite dans la commande du job et dans les migrations — pas un secret, mais à changer si la clé est un jour régénérée). Le fuseau de `pg_cron` est UTC : 07:00 UTC = 09:00 à Bruxelles en été.

## 8. Secrets et intégrations externes

Aucune valeur de secret n'est dans le dépôt (seule la clé publique anon apparaît dans des migrations, vérifié).

| Service | Usage | Secret(s) | Où | État au 18/09/2026 |
|---|---|---|---|---|
| **Supabase** | Tout le back-end | anon (public), `SUPABASE_SERVICE_ROLE_KEY` (Netlify runtime, scripts Python, injectée dans les Edge Functions), `SUPABASE_ACCESS_TOKEN` (CLI, poste de dev) | Netlify, variables d'environnement Windows (User), Supabase | ✅ |
| **Microsoft Graph** (Outlook, Microsoft 365) | Relève de 4 boîtes (domenico@, info@, shop@, occasions@), envoi de mails, invitations | `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` (application Azure, droits Application Mail.Read / Mail.Send) | Secrets Edge | ✅ en service (864 relèves réussies sur 3 jours) |
| **Anthropic — Claude API** | `read-id-doc`, `classify-prospect-email`, `summarize-exchange` | `ANTHROPIC_API_KEY` | Secrets Edge | ✅ posée le 14/09/2026 ; facturation à l'usage (crédit requis) |
| **Stripe** | Paiement e-shop (M11) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Secrets Edge | 🟡 mode test seulement ; clé de production attendue |
| **Resend** | E-mails automatiques (relances, rappels RDV, confirmation e-shop) | `RESEND_API_KEY`, `NOTIFY_FROM` | Secrets Edge | 🟡 absente : toute la file part en `skipped` (13 notifications) |
| **Fournisseur SMS** | Rappels RDV, fin de travaux | `SMS_API_URL`, `SMS_API_KEY`, `SMS_FROM` | Secrets Edge | 🟡 fournisseur non choisi |
| **VIES** (Commission UE) | Validation TVA intracommunautaire | aucun | — | ✅ via `vies-check` |
| **Falco / Peppol** | Envoi des factures UBL | identifiants Falco + identifiant Peppol par société | à définir | 🟡 pas de connecteur ; UBL téléchargé à la main ; aucun identifiant Peppol saisi |
| **Winbooks** | Export comptable | aucun (fichier) | — | 🟡 format à caler sur le fichier du comptable |
| **Ducati DCS** | Commandes fournisseur | aucun (pas d'API, export Excel imposé) | — | ✅ export |
| **OVH** | Domaine de la vitrine | accès OVH | — | 🟡 non configuré ; aucune boutique publiée |
| **GitHub** | Dépôt | `GITHUB_TOKEN` (variable User Windows, compte `the-maul`) ; Git Credential Manager pour le push | poste de dev | ✅ |
| **CRM de l'agence (Mauluctive)** | Chaque push crée une tâche « à valider » | webhook GitHub | GitHub | ✅ depuis le 11/09 |

## 9. Authentification, rôles et sécurité

### Authentification
- Supabase Auth, e-mail + mot de passe. Session gérée dans `src/lib/auth/auth-context.tsx` (profil, rôles, sociétés, **société active**). `src/routes/_app.tsx` renvoie vers `/login` sans session.
- Comptes créés par un administrateur (Paramètres → Utilisateurs) via les server functions de `src/lib/auth/admin.functions.ts` (clé de service côté Netlify, contrôle « admin de la société ») ; mot de passe fixé par l'admin ou **invitation** (`send-account-invitation`). Comptes **équipe** (avec rôles) et comptes **client** (rattachés à leur fiche via `contact_accounts`, sans rôle).
- **Réglage à corriger** : dans Supabase, l'URL du site vaut encore `http://localhost:3000` et les redirections pointent vers d'anciennes adresses Lovable ; les e-mails de réinitialisation envoyés par Supabase lui-même mènent au mauvais endroit (`etat-projet.md` §5). Les invitations Outlook ne sont pas concernées.
- Piège : ne jamais appeler Supabase à l'intérieur de `onAuthStateChange` (blocage au rechargement).

### Rôles
Énumération `app_role` (vérifiée en base) : `admin`, `vendeur`, `magasinier`, `mecanicien`, `chef_atelier`, `comptable`, `marketing`, attribués **par société** (`user_roles`). Dans l'interface, `src/lib/navigation.ts` masque Comptabilité (admin, comptable), Améliorations et Paramètres (admin). **Côté base, la RLS ne contrôle presque partout que l'appartenance à la société** (`is_member`) : un membre de n'importe quel rôle peut lire et écrire les données de sa société par l'API. Les rôles sont donc une commodité d'affichage, pas une barrière.

### ⚠️ Failles relevées le 18/09/2026 (lecture seule, non corrigées)
1. **93 fonctions `SECURITY DEFINER` exécutables par le rôle anonyme** (droit `EXECUTE` par défaut de PostgreSQL, jamais retiré). La clé anon est publique (elle est dans le front et dans ce dépôt public).
2. **Garde contournée pour les appels anonymes** : `auth.uid()` vaut `null` sans session, donc
   - 16 fonctions de lecture écrites `auth.uid() is null or is_member(...)` renvoient les données à un anonyme : `contacts_search`, `contacts_search_count`, `debtors_list`, `sales_journal`, `vat_register`, `vo_margin_register`, `pending_deposits`, `pending_effects`, `sepa_collectable`, `report_indicators`, `report_sales_by`, `report_period_compare`, `report_transformation`, `cycle_count_candidates`, `dormant_stock`, `workshop_load` ;
   - 14 fonctions d'écriture écrites `if auth.uid() is not null and not is_member(...) then raise` laissent passer un anonyme : `close_fiscal_year`, `set_accounting_cutover`, `generate_sales_entries`, `generate_payment_entries`, `generate_auxiliary_accounts`, `record_stock_move`, `record_price_change`, `record_inventory_count`, `record_sepa_collection`, `record_sepa_unpaid`, `enqueue_notification`, `enqueue_label`, `finalize_web_order`, `settle_consignment` ;
   - `contact_encours` n'a aucun contrôle ; `_cron_invoice_reminders` et `_cron_appointment_reminders` sont appelables par tous.
   Seule barrière restante : connaître l'UUID de la société / de l'article / du document. Il n'est pas publié aujourd'hui, mais `shop_public_info` le renvoie à tout visiteur dès qu'une boutique est publiée (0 publiée au 18/09).
   **Correctif proposé** (migration à écrire, avec backup) : `revoke execute on all functions in schema public from anon, public;` puis ré-accorder explicitement les seules fonctions de la vitrine (`shop_public_*`, `place_web_order`…) ; remplacer `auth.uid() is null or` par une vérification du rôle `service_role` (`auth.role() = 'service_role'`).
3. **Edge Functions ouvertes** (déployées sans vérification de jeton et sans contrôle interne) : `read-id-doc` (quiconque connaît un chemin de fichier GED obtient l'extraction d'une pièce d'identité et consomme du crédit Anthropic), `classify-prospect-email` (appel Claude gratuit pour n'importe qui), `mailbox-diag` (dossiers et objet / expéditeur du dernier mail d'une boîte de la concession). `outlook-poll` et `dispatch-notifications` sont déclenchables par tous (sans fuite de données).
4. **Dérive de configuration** : `supabase/config.toml` ne déclare `verify_jwt = false` que pour 4 fonctions, alors que 9 sont déployées ainsi ; un redéploiement avec le CLI changera leur comportement.
5. Signalés par l'audit Supabase : protection contre les mots de passe compromis désactivée, `pg_net` dans le schéma `public`.

## 10. Conventions

- **Langues** : interface et données en français ; code, tables et colonnes en anglais ; glossaire métier de `CLAUDE.md` §2 obligatoire (OR, ORO, PAMP, VIN, TVA marge…).
- **i18n** : aucun texte en dur dans les composants ; tout passe par `t('bloc.cle')` (`src/lib/i18n/index.ts`) et le dictionnaire `src/lib/i18n/fr.ts` (≈ 1 970 lignes, un bloc par module). Structure prête pour un `nl.ts`.
- **Charte** : `docs/charte-graphique.md` fait foi ; couleurs et polices uniquement via `src/styles/tokens.css` (`oklch`) ; rouge Ducati réservé à l'identité et aux actions primaires, jamais à un statut ; tout statut = couleur + icône + libellé (`StatusBadge`) ; `tabular-nums` sur les montants ; rayon ≤ 8 px ; pas d'emoji dans l'interface.
- **Placement** : une route ne fait que câbler un module ; la logique va dans `src/modules/<module>/` ; composants `src/components/ui/` réutilisés, jamais réécrits.
- **Données** : `company_id` + RLS sur toute nouvelle table ; stock et prix en append-only ; tout document a un `status` et une trace `events`.
- **Migrations** : un fichier par changement, `AAAAMMJJHHMMSS_<module>_<sujet>.sql`, idempotent (`if not exists`, `create or replace`) ; `ALTER TYPE … ADD VALUE` seul dans sa migration ; appliquer, **vérifier la présence des objets**, régénérer `types.ts`, mettre à jour le tableau « Migrations Supabase — état d'application » de `docs/avancement.md`.
- **Commits** (imposé, le CRM de l'agence publie la ligne de sujet) : `<ce que ça change pour l'utilisateur, en français> — type(scope): description CODE` ; corps technique libre. Toujours `git fetch` + `git rebase origin/main` avant de pousser ; jamais de push forcé.
- **Backup** : avant tout changement conséquent (migration, refonte, modification transverse, `types.ts` régénéré…), **demander au client** et attendre sa réponse (`CLAUDE.md` §5.0).
- **Décisions** : toute ambiguïté = ADR courte dans `docs/decisions/` + question « à valider client ».
- **Traçabilité** : code d'exigence (ATE009, VEN006…) dans le commit ; `docs/avancement.md` à jour.

## 11. Commandes utiles

Depuis `ducati-brussels-app/` :

```bash
npm install                 # ou bun install
npm run dev                 # serveur de développement (Vite)
npm run build               # le juge de paix : doit passer avant tout push (Netlify lance bun run build)
npx tsc --noEmit            # contrôle des types (21 erreurs connues au 14/09/2026)
npm run lint
bun test                    # tests (pas de script npm "test")

# Types générés depuis le schéma live (après chaque migration appliquée) — commande à vérifier :
npx supabase@2.117.0 gen types typescript --project-id ujmrosbgkvgvwfnuryna > src/integrations/supabase/types.ts
#   (alternative : outil MCP Supabase generate_typescript_types)

# Catalogue Ducati : charger les fichiers d'extraction (Téléchargements) — mission 06
node tools/catalog-loader/load.mjs --dry-run   # puis sans --dry-run ; --stats pour les compteurs

# Déploiement d'une Edge Function :
npx supabase@2.117.0 functions deploy <nom> --project-ref ujmrosbgkvgvwfnuryna --use-api
#   + ajouter --no-verify-jwt pour les fonctions appelées sans session (cron, Stripe, vitrine)

# Poser un secret :
npx supabase@2.117.0 secrets set NOM=valeur --project-ref ujmrosbgkvgvwfnuryna
```

Vérifier qu'une migration est vraiment appliquée :

```sql
select to_regclass('public.<table>') is not null;
select exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='<table>' and column_name='<colonne>');
```

## 12. Pièges connus

1. **Migrations non appliquées** : le piège n°1 (§4). Un `PATCH` en 400 (`PGRST204`) sans erreur Postgres = colonne inconnue ; PostgREST rejette alors **tout** l'enregistrement.
2. **Guillemets et apostrophes courbes** dans le code source (`’`, `“`) : cassent le build Netlify sans prévenir. Les `.md` ne sont pas concernés. Relire le diff avant de commiter.
3. **Terminal Windows** : l'outil par défaut est PowerShell 5.1 — pas de `&&` (utiliser `;` ou `if ($?) { … }`), redirections et encodages différents (`Set-Content` écrit en ANSI : préciser `-Encoding utf8`). Les commandes Unix passent par Git Bash. Les variables d'environnement « User » (`GITHUB_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`…) se chargent avec `[Environment]::GetEnvironmentVariable("NOM","User")`. Éviter les accents dans un corps JSON passé en ligne de commande (`curl -d`).
4. **`src/integrations/supabase/types.ts` généré** : ne pas l'éditer à la main ; s'il est en retard sur la base, le code contourne avec `supabase as any` (8 fichiers le font au 18/09, dont `src/modules/sales/picking-api.ts`, `src/modules/tradein/partners-api.ts`, `src/modules/contacts/id-docs.tsx`) et perd toute vérification de colonnes. Régénérer après chaque migration.
5. **`src/routeTree.gen.ts`** : régénéré en continu par le plugin, ne pas le modifier.
6. **Tailwind 4** : pas d'import relatif d'un CSS local ; `tokens.css` est chargé par un lien séparé ; couleurs en `oklch` uniquement.
7. **Énumérations Postgres** : `ALTER TYPE … ADD VALUE` dans une migration à part (la valeur n'est pas utilisable dans la même transaction).
8. **Plusieurs personnes poussent sur `main`** : `git fetch` puis `git rebase origin/main` ; jamais de push forcé.
9. **Écritures multi-étapes côté navigateur** (ventes, OR, SEPA) : pas de transaction ; une erreur au milieu laisse des données partielles. Préférer une fonction SQL pour toute nouvelle opération composée.
10. **`verify_jwt`** : l'état déployé des Edge Functions diffère de `supabase/config.toml` (§9, point 4) ; vérifier avec la liste des fonctions avant de redéployer.
11. **Relances et rappels** : dès qu'une clé Resend ou SMS sera posée, les tâches planifiées enverront réellement aux clients ; vérifier la file `notifications` et les règles (§7) avant.
12. **Statut « prospect »** : les 8 084 contacts repris de G8 le portent tous (tri prévu, `plan-nouveau-client.md`).
