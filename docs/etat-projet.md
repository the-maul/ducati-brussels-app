# État du projet — DMS Ducati Bruxelles (document de reprise)

> **À LIRE EN PREMIER dans une nouvelle conversation.** Ce document permet de reprendre le travail
> sans rien perdre : où on en est, comment travailler, les pièges, ce qui reste.
> Dernière mise à jour : **2026-06-10**. Branche `main`, dernier commit poussé : voir `git log`.
> Voir aussi : [CLAUDE.md](../CLAUDE.md) (règles), [avancement.md](avancement.md) (checklist 140 refs),
> [g8-reference-extract.md](g8-reference-extract.md) (champs G8 par module), [decisions/](decisions/) (ADR),
> et les **docs de FONCTIONNALITÉS/parcours G8** (à consulter avant de coder un module) :
> [g8-fonctions-m1-m4-fichiers-reception.md](g8-fonctions-m1-m4-fichiers-reception.md),
> [g8-fonctions-m5-stock-inventaire.md](g8-fonctions-m5-stock-inventaire.md),
> [g8-fonctions-m6-ventes-pos.md](g8-fonctions-m6-ventes-pos.md),
> [g8-fonctions-m8-atelier.md](g8-fonctions-m8-atelier.md),
> [g8-fonctions-m0-m12-m13-compta-stats-params.md](g8-fonctions-m0-m12-m13-compta-stats-params.md).

> 🟢 **AVANCEMENT (2026-06-11, passe 3)** : E0/E1 — **tous les P1 faits** + large part des P2 (voir
> [backlog-e0-e1.md](backlog-e0-e1.md)). **Fondations anticipées** : **M5 stock** (`stock_moves` append-only,
> triple stock, PAMP testé, transfert au remplacement).
> **M6 Ventes/POS — partie A bouclée** (`/sales` + `/pos`, parité G8 du POS, cf.
> [g8-fonctions-m6-ventes-pos.md](g8-fonctions-m6-ventes-pos.md)) :
> éditeur FAC/DEV/RES/BL/TIK/AVO · **pied de facture** (remise globale %/€, mode HT/TTC, **détaxe export**,
> port taxé/non, net TTC forcé) · **encaissement** multi-modes / à échéance / rendu de monnaie (modes depuis
> `reference_values`) · **réservation + acomptes** (stock *disponible*, B4) · **conversions** DEV/RES/BL→FAC/BL
> (acompte auto-déduit, filiation) · **avoirs** (réintégration stock + remboursement) · **clôture Z** (`/pos` :
> fond de caisse, mouvements de fond, journal Z par mode + ventilation TVA, calcul monnaie) · **impression PDF**.
> 23 tests verts (PAMP + 8 sur le pied/TVA).
> **M4 Achats FAIT** (`/purchases`) : fournisseurs (RFA/code interne), réception→**entrées stock + PAMP**,
> **châssis→fiche véhicule** (B9), échéancier, régimes TVA, **proposition de commande**, **export DCS** CSV.
> **M5 Stock & inventaire FAIT** (`/stock`) : vues triple stock + valeur PAMP + historique ; **inventaire**
> (8 méthodes G8 → 3 toggles ouvert/fermé × effacement × écarts), arrêté daté, comptage 3 modes, remise à zéro,
> écarts, réintégration — **tout append-only** (B4/B6/B7). Hub **Contacts** (`/clients`) avec filtre par type.
> **M7 Reprise/Occasion FAIT** (`/tradein`) : **reprise (B3)** crée article occasion (O/P) + fiche véhicule
> + entrée stock + **ORO** (pièces/MO/frais → coût de revient, marge par VIN) ; **cessions internes** typées.
> Reste M7 : dépôt-vente + commission, reprise depuis le POS (réf REP).
> **Prochaine étape : M8 Atelier** (le plus gros : OR cycle B8, planning/RDV, chronos/productivité B11,
> garanties B10 avec acceptation/refus partiel), puis M9 (docs/GED/signatures), M10 (CRM), M12 (compta/UBL),
> M13 (reporting), M14 (migration).

> ⚠️ **PRINCIPE (rappel client, 2026-06-10)** : on ne reproduit pas l'UI de G8 (la nôtre est meilleure),
> mais le client doit **retrouver TOUTES les fonctionnalités et parcours** qu'il utilisait. Jusqu'ici on a
> surtout posé les **données et les fiches** ; il faut maintenant **construire les FONCTIONNALITÉS et user
> journeys** (les `g8-fonctions-*.md` ci-dessus les décrivent en détail). Avant de coder/compléter un
> module, lire son doc de fonctions et viser la **parité fonctionnelle**, pas seulement le schéma.

---

## 1. Où on en est (résumé)

| Epic | Module(s) | État |
|---|---|---|
| **E0 — Socle + design** | M0 | ✅ **validé** (login, multi-société, RLS, audit, séquences, design system, gestion utilisateurs) |
| **E1 — Contacts + Articles** | M1, M2 | ✅ **clôturé** (fiches **parité G8** + **moteur d'import tarifs** + 10 tests) |
| **E2 — Véhicules** | M3 | 🟦 **cœur fait** (fiche VIN parité G8, parc, historique propriétaires, jointure article) ; reste : création auto véhicule depuis article V/O/P/D, GED, alerte 4 mois |
| **E5 — Ventes & POS** | M6 | 🟦 **partie A (POS) faite** (pied, encaissement multi-modes, réservation/acomptes, conversions, avoirs, clôture Z, impression) ; reste tail dépendant M3/M7/M8/M12 |
| **E3 — Achats & réceptions** | M4 | 🟦 **cœur fait** (fournisseurs, réception→stock+PAMP, châssis→véhicule, échéancier, proposition cmd, export DCS) |
| **E4 — Stock & inventaire** | M5 | 🟦 **cœur fait** (vues stock+valeur, inventaire 3-toggles, arrêté, comptage 3 modes, remise à zéro, écarts, réintégration) |
| **E6 — Reprise/Occasion/Dépôt** | M7 | 🟦 **cœur fait** (reprise B3 → occasion+véhicule+ORO, marge par VIN, cessions internes) ; reste dépôt-vente |
| E7 → E12 | M8–M14 | ⬜ à faire (référence G8 déjà extraite, voir g8-reference-extract.md) |

**App fonctionnelle en local** sur http://localhost:8080, branchée sur la **vraie base Supabase**.

---

## 2. Comment travailler (WORKFLOW — important)

**On développe et teste EN LOCAL**, on **déploie sur Lovable à la fin**. Lovable = cible de prod ;
sa preview est trop capricieuse pour le dev quotidien (cf. §4).

Cycle pour chaque fonctionnalité :
1. Écrire le code dans `src/...` (+ migration SQL dans `supabase/migrations/` si schéma).
2. **Appliquer les migrations** : `& $sb db push --linked --yes` puis régénérer les types.
3. **Builder en local pour vérifier** : `& $bun run build` (doit finir par `✓ built`, exit 0).
   *Discipline : ne JAMAIS pousser du code qui ne build pas.*
4. **Tester** : sur http://localhost:8080 (le serveur dev tourne en continu, HMR), ou via Chrome MCP.
   Tests unitaires des règles critiques : `& $bun test`.
5. **Commit + push** : `git add` ciblé, commit avec réf. d'exigence, `git fetch` + `git rebase origin/main`
   (Lovable co-commit !), puis `git push`.
6. Mettre à jour `docs/avancement.md`.

### Commandes exactes (PowerShell)
```powershell
$sb  = "C:\Users\simon\.supabase-cli\supabase.exe"
$bun = "C:\Users\simon\.bun-cli\bun-windows-x64\bun.exe"
# Lire les secrets (variables d'env User) au début de chaque commande qui en a besoin :
$env:SUPABASE_ACCESS_TOKEN = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User")
$env:SUPABASE_DB_PASSWORD  = [Environment]::GetEnvironmentVariable("SUPABASE_DB_PASSWORD","User")
$env:GITHUB_TOKEN          = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN","User")

# Migrations + types
& $sb db push --linked --yes
& $sb gen types typescript --linked | Out-File -FilePath "src\integrations\supabase\types.ts" -Encoding utf8

# Build / tests / dev
& $bun run build
& $bun test
& $bun run dev   # serveur sur le port 8080 (lancer en background, PATH bun + env SUPABASE_SERVICE_ROLE_KEY)
```

### Démarrer/relancer le serveur dev (s'il est tombé)
```powershell
# arrêter
Get-Process bun -ErrorAction SilentlyContinue | Stop-Process -Force
# relancer (background) — hérite des secrets User
$env:SUPABASE_SERVICE_ROLE_KEY = [Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','User')
$env:PATH = "C:\Users\simon\.bun-cli\bun-windows-x64;$env:PATH"
& "C:\Users\simon\.bun-cli\bun-windows-x64\bun.exe" run dev *> ".dev-server.log" 2>&1
```
Si le serveur déconne après beaucoup de HMR : vider le cache puis relancer —
`Remove-Item -Recurse -Force node_modules\.vite, dist, .nitro, .output, .tanstack`.

---

## 3. Outillage, secrets, accès

- **Repo GitHub** : https://github.com/the-maul/ducati-brussels-app (dossier local = clone, remote `origin`).
- **Supabase** : projet **Lovable Cloud**, project ref **`ujmrosbgkvgvwfnuryna`**, lié via CLI.
- **Outils installés en standalone** (sans Node) :
  - Supabase CLI : `C:\Users\simon\.supabase-cli\supabase.exe`
  - Bun : `C:\Users\simon\.bun-cli\bun-windows-x64\bun.exe`
- **Secrets en variables d'env User** (`setx`, jamais commités, jamais affichés) :
  `SUPABASE_ACCESS_TOKEN` (PAT Supabase), `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`
  (clé admin, nécessaire aux server functions), `GITHUB_TOKEN` (PAT classic, push non-interactif).
- **Push GitHub non-interactif** : helper credential dans `.git/config` (ligne `helper =` vide qui
  neutralise GCM, puis helper qui lit `$GITHUB_TOKEN`). Plus de pop-up.
- **Compte de test (admin)** : **`simon@themaul.be`** (admin auto sur les 2 sociétés via trigger
  `grant_bootstrap_admin`). Créé dans le dashboard Supabase (Auth → Users). Les comptes du personnel
  se créent dans l'app : **Paramètres → Utilisateurs** (server function + service role).

---

## 4. Pièges à connaître (durement appris)

1. **supabase-js — deadlock `onAuthStateChange`** : NE JAMAIS appeler une méthode Supabase (requête DB/
   auth) **dans** le callback `onAuthStateChange` → deadlock du verrou (spinner infini au reload).
   Solution en place dans `src/lib/auth/auth-context.tsx` : différer avec `setTimeout(0)` + filet de
   sécurité. (corrigé commit 101c5c7)
2. **Lovable est CO-AUTEUR** du repo : il commite et pousse sur `main` tout seul (régénère
   `routeTree.gen.ts` = câblage des routes, `types.ts`, parfois "auto-fix" du code). ⇒ **toujours
   `git fetch` + `git rebase origin/main` avant de pousser**. Lovable garde la main sur
   `routeTree.gen.ts`/`types.ts`. **Ne pas lui demander de "corriger" le code** (il refork) — corriger à
   la source et pousser.
3. **`routeTree.gen.ts`** est en **`git update-index --skip-worktree`** (le dev server le régénère sans
   cesse) — ne pas le committer, le dev server/Lovable s'en occupent.
4. **Tailwind v4 / Lightning CSS** : pas de `@import` relatif d'un fichier CSS local (resterait brut →
   "@import must precede all rules"). `tokens.css` est chargé via `<link>` séparé dans
   `src/routes/__root.tsx` (PAS en @import). Couleurs en **oklch** uniquement.
5. **Enums Postgres** : `ALTER TYPE ... ADD VALUE` dans sa propre migration ; ne pas réutiliser la
   nouvelle valeur dans la même transaction.
6. **`git add -A`** balaie tout : le dossier **`infos app/`** (captures G8 fournies par le client) et
   `docs/reference-g8/` sont **gitignorés** (références binaires, gardées en local). Attention à ne pas
   re-committer de gros binaires.
7. **PowerShell 5.1** : chaîne vide droppée pour les exécutables natifs ; pas de `&&`/`||` ; here-strings
   `@'...'@` fragiles avec caractères spéciaux (préférer messages de commit simples).
8. **Stack réelle** = TanStack Start (SSR) + Bun + Vite + Tailwind v4 + shadcn (kit déjà présent dans
   `src/components/ui/`) + Supabase. Déploiement Cloudflare/Wrangler via Lovable. Routes file-based dans
   `src/routes/` (layout `_app` = garde d'auth + shell). Réutiliser les composants shadcn existants.

---

## 5. Architecture & conventions du code

- **Modules métier** : `src/modules/<module>/` (api.ts = accès Supabase typé ; `*-form.tsx` = formulaires ;
  sous-dossiers ex. `articles/import/`). Routes `src/routes/_app.<module>...tsx` ne font que câbler.
- **Patron CRUD** (suivi pour M1/M2/M3) : `api.ts` (list/get/create/update, recherche `.or()` sanitizée,
  filtre `company_id`) → `_app.<m>.tsx` (layout Outlet) + `.index.tsx` (liste+recherche) + `.new.tsx` +
  `.$id.tsx` (édition). Formulaire à état contrôlé `Record`, `buildPayload` mappe → Insert.
- **i18n** : tout libellé via `t('clé')` (`src/lib/i18n/fr.ts`). Aucune chaîne en dur. Prêt pour le NL.
- **Auth/contexte** : `useAuth()` (`src/lib/auth/auth-context.tsx`) → `activeCompanyId`, `companies`,
  `roles`, `isAdmin()`, `signOut`. Filtrer les requêtes par `activeCompanyId` ; RLS double la sécurité.
- **Design** : `src/styles/tokens.css` (charte, oklch) ; classes utilitaires `font-data` (tableaux Cond),
  `tabular-nums` (montants), `bg-success/warning/danger/info`, `StatusBadge` (couleur+icône+libellé).
- **Server functions** (admin) : `createServerFn` + middleware `requireSupabaseAuth` + `supabaseAdmin`
  (service role). Exemple : `src/lib/auth/admin.functions.ts` (gestion utilisateurs).
- **Append-only / B7** : trigger `audit_row()` sur les tables métier → table `events`. Stock/prix :
  à venir via `stock_moves`/`price_changes` (M5) — JAMAIS d'UPDATE direct du stock.

---

## 6. État détaillé par module

### M0 — Socle ✅ (migration 20260610090000)
`companies` (ITALBIKE STORE + NL INVEST), `profiles` (+ trigger création), `user_roles` (enum
`app_role`), helpers RLS `has_role/is_member/is_admin`, `events` (audit append-only), `document_sequences`
+ `next_document_number()`. UI : login `/login`, garde `_app`, bascule société, Paramètres → Utilisateurs.

> ⚠️ **Pour M1/M2/M3, le SCHÉMA et les fiches sont faits, mais PAS toutes les FONCTIONNALITÉS G8.**
> Voir les `g8-fonctions-*.md` pour la liste exhaustive des features/parcours à construire (parité fonctionnelle).

### M1 — Contacts ✅ schéma/fiche, 🟦 fonctionnalités (migrations 110000, 130000, 150000, 160000)
Table `contacts` complète (parité G8). UI `/clients` (liste/recherche/fiche). **Fonctions G8 à construire** :
onglets fiche client (**Parc** véhicules, **Relances**, **Histo Email/SMS**, **Échéances**, Documents/GED),
**encours actuel calculé** (vs autorisé), tarifs client à paliers, adresses de livraison, sous-contacts,
table civilités paramétrable. (cf. g8-fonctions-m1-m4)

### M2 — Articles ✅ schéma/fiche + import, 🟦 fonctionnalités (migrations 120000, 135000, 140000, 160000)
Tables `articles` (+ `article_barcodes`, `article_suppliers`, `article_kit_items`, `article_bins`,
`article_categories`). Type A–R **+ T** (ADR-002). UI `/parts`. **Import tarifs** :
`src/modules/articles/import/` (rules.ts = 12 règles testées, parse.ts = CSV, apply.ts) + route
`/parts/import` + `tests/import-rules.test.ts` (10 verts). **Fonctions G8 à construire** :
**moteurs de prix interactifs** (PA↔coef↔PVHT↔PVTTC↔marge + table d'arrondis tranche sup),
**remplacement de référence** (transfert stock + recalcul PAMP, historique anciennes réf),
**équivalences** (groupe + référence d'origine multifournisseur), **librairie** (export/import + réimport
auto), **modification en cascade** (sélection à jokers + actions de masse + verrous), statistiques article,
édition d'étiquettes, kits en UI, import Excel natif (xlsx). (cf. g8-fonctions-m1-m4 et m6-ventes)

### M3 — Véhicules 🟦 (migration 170000)
Tables `vehicles` (fiche VIN exhaustive G8) + `vehicle_owners` (historique). UI `/vehicles` (parc +
filtre statut + fiche). Reste : **création auto du véhicule à la réception d'un article V/O/P/D**
(jointure B9 à automatiser), GED véhicule (photos/COC), alerte stock > 4 mois (pg_cron + M13),
rentabilité par VIN (dépend de M7 ORO), ajout/changement de propriétaire depuis un OR.

### M4–M14 ⬜
Pas commencés. **Toute la référence G8 est déjà extraite** dans `g8-reference-extract.md` (fournisseurs,
réceptions, DCS, stock/inventaire 8 méthodes, POS/documents, OR/planning/garanties, journaux compta).
Captures sources dans `infos app/` (local, gitignoré).

---

## 7. Pour tester maintenant (localhost:8080)
1. Ouvrir http://localhost:8080 → login `simon@themaul.be`.
2. **Clients** : créer/éditer une fiche (le client de test "Simon Moreau" existe déjà).
3. **Pièces** : créer un article ; **Pièces → Importer un tarif** : coller un CSV
   (`Reference;Designation;PA;PV TTC;Marque` puis des lignes) → Analyser → Appliquer.
4. **Véhicules** : créer une fiche VIN ; filtrer le parc par statut.
5. **Paramètres → Utilisateurs** (admin) : créer un compte du personnel + rôles.

## 8. Prochaines étapes proposées
1. **Finir Epic 2** : automatiser création véhicule ↔ article V/O/P/D ; GED ; alerte 4 mois.
2. **Epic 3 (M4 Achats/réceptions)** : réception pièces (scan/OCR), routage CLIENT/OR/STOCK, réception
   châssis → fiche véhicule auto, **export DCS Excel** (standard/urgente), fournisseurs (franco, mini cde).
3. Puis M5 (stock/inventaire, le plus dense), M6 (POS), M7 (reprise/ORO), M8 (atelier)…
   suivre l'ordre des epics du [dossier-projet.md](dossier-projet.md) §4.3.
