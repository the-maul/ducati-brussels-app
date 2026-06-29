# Transfert au client — autonomie + propriété complète

Cible : client **non technique** qui veut tout piloter lui-même, avec une **escalade** pour le
trop technique. L'app touche 3 systèmes : **GitHub** (code), **Netlify** (déploiement),
**Supabase** (base + secrets). On transfère les trois, et on met **Lovable** par-dessus comme
cockpit d'édition.

> Réalité à dire au client : sur une app sur mesure, il sera autonome pour le **contenu, les
> réglages et les petites modifs** (énorme part déjà paramétrable + via Lovable/IA). Pour la
> **logique métier complexe, les migrations de base et les bugs**, il faut garder un **contact
> technique** (toi ou un dev). Lovable couvre l'essentiel, pas le 100 %.

## Ce qui est DÉJÀ autonome dans l'app (aucun code requis)
Paramètres → **Sociétés** (TVA, comptes, arrondi prix), **Numérotation** des documents,
**Tables de données** (TVA, marques, règlements, civilités…), **Utilisateurs & rôles**,
**Extension My Ducati**. → 80 % des « réglages courants » se font ici, sans toucher au code.

## A. Cockpit d'autonomie : Lovable (recommandé)
1. Le client crée un compte sur **lovable.dev**.
2. **Connecter le repo GitHub** au projet Lovable (intégration GitHub bidirectionnelle :
   Lovable lit/écrit dans le repo). L'app est déjà compatible (scaffold `@lovable.dev`).
3. **Connecter notre Supabase existant** dans Lovable (URL + clés ; ne PAS recréer une base).
4. Le client édite en langage naturel / visuel → Lovable commit → Netlify redéploie.

## B. Transfert GitHub
- `github.com/<owner>/ducati-brussels-app` → **Settings → General → Danger Zone →
  Transfer ownership** vers le compte/organisation GitHub du client.
- (Ou : le client crée son compte, tu le mets **admin** le temps du transfert.)
- Penser à transférer aussi les **secrets d'actions** s'il y en a (ici : aucun critique).

## C. Transfert Netlify
- Option simple : le client crée son compte Netlify et **« Import from GitHub »** le repo
  (le `netlify.toml` configure tout). Il recrée les **variables d'environnement** :
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (cf. docs/deploiement-netlify.md).
- Puis brancher le **domaine** sur son site, et débrancher l'ancien.
- (Si on passe par l'hébergement Lovable, Netlify devient optionnel.)

## D. Transfert Supabase (base + secrets)
- Supabase → **Organization → Members** : inviter le client comme **Owner**, ou
  **transférer le projet** vers son organisation (il doit gérer la **facturation**).
- Lui remettre, depuis *Settings → API*, les clés (anon + service_role) — à **regénérer**
  si on veut couper l'accès de l'ancien intégrateur.
- Secrets des Edge Functions (Stripe, Microsoft Graph) : *Edge Functions → Secrets* —
  à reconfigurer à son nom le moment venu.

## E. Comptes externes à remettre (le client gère ses propres clés)
Stripe, Microsoft Graph (Outlook), Resend/e-mail, etc. : créés **par le client**, clés
posées dans Supabase. Aucune clé ne vit dans le repo.

## F. Garde-fous conseillés
- Garder une **branche protégée** `main` n'est pas nécessaire si Lovable est le seul éditeur ;
  sinon activer la protection + review.
- Définir une **escalade** : qui appelle-t-il quand « c'est trop technique » ? (toi / un dev).
- Sauvegardes Supabase : activées par défaut (vérifier le plan).

## Ordre conseillé
1. Lovable connecté (il prend ses marques sans rien casser, sur le repo actuel).
2. Transfert Supabase (propriété + facturation).
3. Transfert GitHub.
4. Netlify à son nom + domaine.
5. Regénérer les clés pour couper les accès de l'ancien intégrateur (si fin de mission).
