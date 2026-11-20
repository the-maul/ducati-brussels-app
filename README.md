# DMS Ducati Bruxelles

Logiciel de gestion de la concession Ducati Bruxelles (ITALBIKE STORE). Il remplace G8 / Futurosoft :
clients, motos (VIN), pièces et stock, achats, ventes et caisse, atelier (OR, planning, chronos),
reprises et dépôt-vente, documents, CRM, compta (exports), statistiques, et un espace client.

> **À lire avant de toucher au code** : [`CLAUDE.md`](CLAUDE.md) (règles, glossaire, invariants B1–B12),
> puis la bible [`docs/bible/README.md`](docs/bible/README.md) (un chapitre par module) et
> l'architecture [`docs/bible/00-architecture.md`](docs/bible/00-architecture.md).
> Mise en production, sauvegardes, domaine, hébergement : [`docs/infra-mise-en-prod.md`](docs/infra-mise-en-prod.md).

## Ce qui tourne où

| Partie | Technologie | Hébergement |
|---|---|---|
| Écrans + rendu serveur | TanStack Start (React 19, Vite, Nitro), Tailwind 4, shadcn/ui | Netlify — https://ducatilive.netlify.app (build à chaque push sur `main`) |
| Base, comptes, fichiers | Supabase : PostgreSQL 17 + RLS, Auth, Storage, Edge Functions (Deno), pg_cron | Projet `ujmrosbgkvgvwfnuryna`, région **eu-west-3 (Paris)** |
| Services externes | Microsoft Graph (Outlook), Anthropic (Claude), Brevo (SMS), Shopify, Stripe, VIES | voir `docs/infra-mise-en-prod.md` §4 |

## Démarrer en local

Prérequis : [Bun](https://bun.sh) 1.x (ou Node 20+ et npm).

```bash
bun install
bun run dev          # http://localhost:8080
bun test             # tests des règles critiques (dossier tests/)
bunx tsc --noEmit    # contrôle des types
bun run build        # le build de production (celui de Netlify)
```

Le fichier `.env` ne contient que des valeurs **publiques** (URL du projet et clé « anon »).
Aucun secret ne doit jamais être commité : les clés (service, Stripe, Graph, Anthropic, Brevo,
Shopify) vivent dans les secrets Supabase ou les variables Netlify.

## Organisation du dépôt

| Chemin | Rôle |
|---|---|
| `src/routes/` | Écrans (un fichier = une URL) ; `routeTree.gen.ts` est généré, ne pas l'éditer |
| `src/modules/<module>/` | Logique métier par module (contacts, articles, vehicles, workshop, sales…) |
| `src/components/ui/` | Kit shadcn/ui — à réutiliser, pas à réécrire |
| `src/lib/i18n/` | Dictionnaires FR / NL / EN / IT — aucun texte en dur dans les écrans |
| `src/styles/tokens.css` | Seul endroit des couleurs et polices (charte) |
| `supabase/migrations/` | Schéma versionné ; **appliqué à la main**, pas automatiquement |
| `supabase/functions/` | Edge Functions ; **déployées à la main** (`npx supabase@2.117.0 functions deploy …`) |
| `supabase/tests/` | Essais SQL en transaction annulée |
| `tests/` | Tests `bun test` |
| `tools/` | Chargeurs (catalogue, manuels, entretiens), extension My Ducati, reprise G8 |
| `docs/` | Documentation (bible, décisions, inventaire G8, études) |

## Règles de contribution

- Une branche par lot (`lot-…`), une pull request vers `main`. Jamais de push direct ni forcé sur `main`.
- Titre de commit / PR : `<ce qui change pour l'utilisateur, en français> — type(scope): description CODE`
  (le CRM de l'agence publie cette phrase au client).
- La CI (`.github/workflows/ci.yml`) vérifie types, tests et build sur chaque PR.
- Avant un changement conséquent (migration, refonte, RLS, montée de version) : **demander au client
  s'il faut un backup**, puis suivre la procédure `CLAUDE.md` §5.0 (dépôt `the-maul/ducati-backup`).

## Déploiement

| Élément | Comment | Automatique ? |
|---|---|---|
| Front + SSR | push sur `main` → Netlify `bun run build` | oui |
| Migrations SQL | éditeur SQL / API Supabase, puis vérifier les objets et régénérer `types.ts` | non |
| Edge Functions | `npx supabase@2.117.0 functions deploy <nom> --project-ref ujmrosbgkvgvwfnuryna --use-api` | non |
| Secrets | tableau de bord Supabase (Edge Functions → Secrets) / Netlify (variables) | non |

Retour arrière du front : Netlify → Deploys → publier un déploiement précédent. Une migration, elle,
ne se défait pas : d'où la sauvegarde avant chaque migration.
