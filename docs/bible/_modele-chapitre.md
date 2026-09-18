---
chapitre: MXX            # code du module (M0…M14) ou TRANSVERSE-xxx
titre: Nom du module
etat: ✅ | 🟦 | 🟡 | 🔴   # ✅ utilisable · 🟦 cœur fait, finitions · 🟡 attend une clé/décision · 🔴 cassé en prod
verifie_le: AAAA-MM-JJ    # date de la dernière vérification code + base
missions: []              # missions qui modifient ce chapitre, ex. [mission-01-nouveau-client]
mots_cles: []             # termes qu'on cherchera (ex. devis, facture, VIN, relance)
---

# MXX — Nom du module

> **En une phrase** : à quoi sert ce module pour la concession.

## 1. À quoi ça sert
Deux à cinq phrases pour un humain qui ne connaît pas le code : qui l'utilise, pour faire quoi.

## 2. Ce qu'on a aujourd'hui
Ce que l'utilisateur voit et peut faire, écran par écran. Une ligne par fonctionnalité.

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|

## 3. Où trouver quoi
Pour un développeur ou une IA : chaque chemin est cliquable et exact.

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/…` |
| Logique métier | `src/modules/…` |
| Tables | `nom_table` (rôle en quelques mots) |
| Fonctions SQL (RPC) | `nom_fonction` |
| Fonctions serveur (Edge) | `supabase/functions/…` |
| Tâches planifiées | nom du job pg_cron |
| Migrations clés | `supabase/migrations/…` |
| Libellés | `src/lib/i18n/fr.ts`, bloc `…` |

## 4. Règles métier et décisions
Chaque règle avec sa source : invariant (B1–B12), exigence (code GAP), décision client datée.

## 5. État en production
Ce qui marche vraiment sur https://ducatilive.netlify.app, vérifié le JJ/MM (code + objets en base).
Signaler tout objet utilisé par le code mais absent de la base.

## 6. Prévu / en cours
Liens vers les missions (`../missions/…`) et changements décidés non encore faits.

## 7. Limites connues, dettes, pièges
Ce qu'un développeur doit savoir avant de toucher à ce module.

## 8. Exigences du cahier couvertes
Codes GAP du module (`docs/cahier-fonctionnel-v2.md`, annexe A) : faits / partiels / manquants.

## 9. Historique
| Date | Changement | Commit ou migration |
|---|---|---|
