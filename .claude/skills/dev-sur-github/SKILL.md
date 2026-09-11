---
name: dev-sur-github
description: Protocole de travail Git/GitHub du DMS Ducati Bruxelles — sauvegarde obligatoire avant tout changement conséquent, puis commit/push. À utiliser AVANT d'implémenter une migration Supabase, une refonte de module, une modification transverse (tokens, i18n, RLS, types.ts), un renommage en masse ou une montée de version, et à chaque fois qu'il faut commiter, pousser, sauvegarder, restaurer, ou parler des dépôts origin/backup.
---

# Dev sur GitHub — DMS Ducati Bruxelles

## 1. Dépôts et authentification

| Remote   | Dépôt                          | Rôle                |
|----------|--------------------------------|---------------------|
| `origin` | `the-maul/ducati-brussels-app` | principal (public)  |
| `backup` | `the-maul/ducati-backup`       | sauvegarde (privé)  |

Les dépôts appartiennent à **`the-maul`** ; le compte du client, **`ducatibruxelles`**, y est
**collaborateur**. Les URL restent donc sous `the-maul/...` — il n'existe pas de
`ducatibruxelles/ducati-*`, c'est une erreur classique qui renvoie `Repository not found`.

Le token est stocké dans le **coffre Windows** (Git Credential Manager).
**Ne jamais écrire de token dans une URL de remote ni dans `.git/config`.** Si `git remote -v`
affiche `https://ghp_...@github.com/...`, le nettoyer immédiatement :
`git remote set-url origin https://github.com/the-maul/ducati-brussels-app.git`

## 2. RÈGLE ABSOLUE — demander le backup avant tout changement conséquent

**Toujours demander au client s'il veut un backup, et attendre sa réponse, avant d'implémenter.**
Jamais d'office, jamais en silence. En cas de doute, demander quand même.

**Conséquent** : migration Supabase · refonte ou suppression de module · modification transverse
(tokens de charte, i18n, RLS, `types.ts` régénéré) · renommage/déplacement en masse · montée de
version de dépendance · toute opération difficilement réversible.

**Pas conséquent** : correctif localisé · ajout de libellé · ajustement de style · mise à jour de doc.

Formulation type : « Avant d'attaquer ça, on fait un backup ? »

## 3. Procédure de backup (après accord)

```bash
git fetch origin && git status --porcelain   # doit être vide
TS=$(date +%Y%m%d-%H%M%S)
git push backup main:main                    # instantané sur le dépôt de backup
git tag "backup-$TS" && git push backup "backup-$TS"
git push origin "main:refs/heads/backup/$TS" # branche miroir sur le principal
```

Convention héritée du 25/07/2026 : tag `backup-20260725-224552` côté `backup`,
branche `backup/20260725-224552` côté `origin`. La conserver.

**Restauration** : `git fetch backup --tags` puis `git reset --hard backup-<AAAAMMJJ-HHMMSS>`.

## 4. Avant chaque commit

1. **Guillemets/apostrophes courbes** — il n'y a **pas de build local** ; une apostrophe courbe
   dans du code source casse le build Netlify sans prévenir. Vérifier le diff :
   ```bash
   git diff --cached -U0 | grep -n "^+" | grep "[‘’“”]"
   ```
   (Les `.md` de documentation ne sont pas concernés, ils ne sont pas compilés.)
2. **Référence d'exigence dans le message** : `type(scope): description CODE` (règle §5 du CLAUDE.md).
3. **Aucun secret commité** — les clés vivent côté Supabase. `.env` ne contient que l'URL et la clé
   *publishable* (anon), c'est normal.

## 5. Avant chaque push

**D'autres personnes poussent sur `main`** (dont Lovable). Toujours :

```bash
git fetch origin && git rebase origin/main
```

avant `git push`. Ne jamais forcer un push sur `main`.

## 6. Migrations Supabase

Lovable **n'applique pas** les migrations. Toute migration versionnée dans `supabase/migrations/`
doit être **exécutée manuellement par le client** sur Supabase. Le lui rappeler explicitement,
sinon les fonctionnalités qui en dépendent échouent en production.
