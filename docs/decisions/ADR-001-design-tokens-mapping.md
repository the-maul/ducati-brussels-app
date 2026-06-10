# ADR-001 — Mapping de la charte Ducati sur les tokens shadcn/Tailwind v4

- **Statut** : Accepté
- **Date** : 2026-06-10
- **Exigences liées** : charte §2-4 ; CLAUDE.md règle 9
- **Module(s)** : M0 (design system)

## Contexte
Le scaffold Lovable fournit shadcn/ui + Tailwind v4 avec un thème par défaut (slate, oklch)
défini dans `src/styles.css` via `@theme inline` + `:root`. La charte Ducati impose sa propre
palette (rouge signature, noir, sémantique distincte, couleurs métier), ses fontes (Ducati Style
Ext/Rg/Cond + JetBrains Mono) et un radius anguleux. CLAUDE.md règle 9 : `tokens.css` est la
source de vérité unique, aucun hex/font-family en dur dans les composants.

## Décision
1. **`src/styles/tokens.css`** = source unique : variables Ducati en **oklch** (hex de la charte en
   commentaire), `@font-face` des 8 fontes, échelle typo, espacements, layout. Familles nommées
   `--ff-*` pour éviter la collision avec les clés Tailwind `--font-*`.
2. **`src/styles.css`** importe `tokens.css` puis **surcharge les variables sémantiques shadcn**
   (`:root`) en les faisant pointer sur les tokens Ducati : `--primary`=rouge, `--destructive`=danger,
   `--sidebar`=noir, `--radius`=0.375rem (6px). Les composants shadcn héritent donc de la charte
   sans modification.
3. Les tokens Ducati supplémentaires (success/warning/danger/info + `-bg`, job-*, familles) sont
   exposés en utilitaires Tailwind via `@theme inline` (`bg-success`, `font-data`, `bg-job-entretien`…).

## Conséquences
- Un composant n'écrit jamais un hex : il utilise les utilitaires (`bg-primary`, `text-danger`,
  `font-data`) ou, si besoin, `var(--token)`. Toute PR avec un hex en dur hors `tokens.css` est refusée.
- Le **rouge marque** = `--primary` / `bg-primary` (actions primaires, identité). Les **statuts**
  utilisent la sémantique (`--danger`…), jamais le rouge marque (charte §1).
- JetBrains Mono est chargé via Google Fonts (`@import` dans `styles.css`) pour ne pas désynchroniser
  `bun.lock`. À reconsidérer si auto-hébergement requis (offline strict).
- Couleurs oklch approximées depuis les hex de la charte ; ajustables finement sans impact structurel.
