# Avancement — DMS Ducati Bruxelles

Tableau de bord de suivi **et** checklist de recette (dossier §5.1). Tenu à jour par Claude Code.
Statuts : ⬜ à faire · 🟦 en cours · ✅ fait · 🧪 recetté (validé client).

> Convention : chaque exigence est cochée quand elle est implémentée **et** que ses invariants
> et tests associés passent (CLAUDE.md §6). La colonne « Démo » pointe l'écran/scénario.

---

## Epics

| Epic | Périmètre | Statut |
|---|---|---|
| **E0 — Socle + design system** (M0) | schéma socle, auth/RLS, multi-société, events, séquences, recherche globale, **design system** | ✅ (validé en local) |
| E1 — Contacts + Articles (M1, M2) | M1 fiche client ✅ · M2 articles (types A–R, prix/PAMP/coef, casiers, fournisseurs, kits) ✅ CRUD · reste : moteur d'import tarifs + équivalences UI | 🟦 en cours |
| E2 — Véhicules (M3) | — | ⬜ |
| E3 — Achats & réceptions (M4) | — | ⬜ |
| E4 — Stock & inventaire (M5) | — | ⬜ |
| E5 — Ventes & POS (M6) | — | ⬜ |
| E6 — Reprise/Occasion/Dépôt (M7) | — | ⬜ |
| E7 — Atelier (M8) | — | ⬜ |
| E8 — Documents & portails (M9) | — | ⬜ |
| E9 — CRM & matching (M10) | — | ⬜ |
| E10 — Web & marketing (M11) | — | ⬜ |
| E11 — Compta & reporting (M12, M13) | — | ⬜ |
| E12 — Migration & go-live (M14) | — | ⬜ |

---

## Epic 0 — détail

### Design system (charte) — `src/styles/tokens.css` + `src/styles.css`
| Élément | Statut | Démo |
|---|---|---|
| Tokens couleurs Ducati (oklch) + mapping shadcn (primary=rouge, danger, sidebar noire, radius 6px) | ✅ | /demo |
| `@font-face` des 8 fontes Ducati Style + JetBrains Mono | ✅ | /demo (Typographie) |
| Échelle typo + espacements + helpers tabular-nums/mono | ✅ | /demo |
| Boutons (5 variantes), badges statut (icône+libellé), KPI, tableau dense Cond (50 lignes) | ✅ | /demo |
| Layout topbar 56px + sidebar noire 240px repliable (barre rouge actif) | ✅ | toutes pages |
| Recherche globale Ctrl+K (reco VIN/TVA) | ✅ | topbar |
| i18n FR (dictionnaire, structure prête NL) | ✅ | toute l'UI |
| Navigation complète des 10 modules (placeholders) | ✅ | sidebar |
| Contraste AA vérifié | ⬜ | à valider |

### Socle M0 (Supabase) — migration `20260610090000_m0_socle.sql` **appliquée en live**
| Réf | Élément | Statut |
|---|---|---|
| COM005 | Multi-société (`companies` ITALBIKE+NL INVEST, `company_id`) | ✅ |
| — | Rôles (enum app_role) + RLS + helpers `has_role/is_member/is_admin` | ✅ |
| — | `profiles` + création auto à l'inscription (`handle_new_user`) | ✅ |
| B7 | Audit universel `events` (append-only, update/delete révoqués) | ✅ |
| — | Séquences documentaires configurables + `next_document_number()` | ✅ |
| — | Types TS régénérés depuis le schéma live (`types.ts`) | ✅ |
| — | Auth : login + session + guard + contexte société/rôles | ✅ (validé local) |
| — | Bootstrap admin (simon@themaul.be → admin auto sur les 2 sociétés) | ✅ |
| — | Écran admin « Utilisateurs » (créer comptes + attribuer rôles) | ✅ (validé local) |
| B7 | `stock_moves` / `price_changes` append-only (stock = somme) | ⬜ (M5) |
| — | Recherche globale branchée sur la base (VIN/client/réf/doc) | ⬜ |
| — | Seed : 2 sociétés ✅, 20 clients, 300 articles, 12 véhicules, 5 OR | ⬜ |

---

## Invariants métier (Annexe B) — suivi transverse

| # | Invariant | Statut |
|---|---|---|
| B1 | Types de gestion d'article A/M/F/N/V/O/P/D/R | ⬜ |
| B2 | TVA sur marge (occasions particuliers) + registre VO | ⬜ |
| B3 | Flux reprise REP → article O/P + véhicule + ORO | ⬜ |
| B4 | Triple stock (réel/arrêté/disponible) + copies datées | ⬜ |
| B5 | PAMP recalculé à chaque entrée | ⬜ |
| B6 | 3 modes de réajustement d'inventaire | ⬜ |
| B7 | Traçabilité totale des mouvements (append-only) | 🟦 |
| B8 | Cycle OR (réception→facture, historique par véhicule) | ⬜ |
| B9 | N° de série V/O/P, recherche croisée véhicule↔client↔docs | ⬜ |
| B10 | Garantie : acceptation/refus total/partiel + re-routage | ⬜ |
| B11 | Productivité atelier : temps passé vs facturé | ⬜ |
| B12 | Étiquetage (défaut stock réel, code-barres/prix, différé) | ⬜ |

---

## Angles morts G8 (section 4 du cahier) — à ne pas oublier

⬜ Cessions internes typées · ⬜ ORO/coût de revient · ⬜ Arrêté + 8 méthodes + réintégration ·
⬜ Dépréciation de stock par taux/période · ⬜ Inventaire tournant · ⬜ Étiquetage avancé ·
⬜ Fabrication/démontage de produits finis · ⬜ Modif cascade PA/PV + arrondis ·
⬜ OR accident/assurance · ⬜ Historique exhaustif des mouvements de stock
