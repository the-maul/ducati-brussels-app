# Déploiement — Netlify (frontend) + Supabase (backend)

DMS Ducati Bruxelles. Le **backend est déjà en prod** (Supabase : base + RLS, Auth,
Storage GED, Edge Functions, pg_cron). Seul le **frontend SSR** (TanStack Start) est
déployé ici, sur **Netlify**, branché au repo GitHub `the-maul/ducati-brussels-app`.

## Workflow

```
git push origin main  ──►  Netlify rebuild auto  ──►  https://<site>.netlify.app
```

- Build : `bun run build` → `vite.config.ts` force le preset nitro **`netlify`**
  (hors Lovable, le plugin de déploiement est sinon désactivé).
- Sortie : statiques + redirects dans `dist/` (publish) ; fonction SSR dans
  `.netlify/functions-internal/` (détectée automatiquement par Netlify).
- Réglages lus depuis `netlify.toml` (commande de build + publish dir).

## Variables d'environnement (Netlify → Site settings → Environment variables)

| Clé | Valeur | Secret ? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://ujmrosbgkvgvwfnuryna.supabase.co` | non (publique) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | clé **anon** (cf. `.env`) | non (publique) |
| `SUPABASE_URL` | `https://ujmrosbgkvgvwfnuryna.supabase.co` | non |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** | **OUI** |

> `SUPABASE_SERVICE_ROLE_KEY` ne sert qu'à l'écran **admin → Utilisateurs** (création de
> comptes). Il reste **uniquement** dans Netlify, jamais dans le repo.

## Mise en route (à faire une seule fois)

1. Netlify → **Add new site** → **Import an existing project** → **GitHub** →
   `the-maul/ducati-brussels-app`, branche `main`.
2. Renseigner les 4 variables ci-dessus **avant** le premier déploiement.
3. **Deploy** → URL `https://<aléatoire>.netlify.app`.
4. Supabase → **Authentication → URL Configuration** :
   - **Site URL** : `https://<site>.netlify.app`
   - **Redirect URLs** : `https://<site>.netlify.app/**`
5. (Optionnel) **Change site name** pour un sous-domaine propre, puis brancher un vrai
   domaine plus tard (CNAME) sans rien refaire.

## Contributeur Git (important — plan gratuit + repo privé)

Sur le plan gratuit et un repo **privé**, Netlify ne build que les commits d'**un seul**
contributeur GitHub : **`Simonclaw2505`**. Les commits de ce repo sont donc signés avec
cette identité (réglage **local au repo**) :

```
git config user.name  "Simonclaw2505"
git config user.email "264277255+Simonclaw2505@users.noreply.github.com"
```

Le *push* peut être fait par le token `the-maul` (propriétaire du repo) — seul l'**auteur**
du commit compte pour Netlify. Si on change ce contributeur côté Netlify, mettre à jour
l'auteur ici en conséquence.

## Rollback

Netlify → **Deploys** → choisir un déploiement précédent → **Publish deploy**. Instantané.

## Ce qui n'est PAS sur Netlify

Base, Auth, Storage, Edge Functions (envoi mail Outlook, Stripe…), tâches `pg_cron`
(relève Outlook, copies de stock) : tout cela tourne sur **Supabase**, indépendamment du
frontend. Aucun de ces éléments n'est impacté par un déploiement Netlify.
