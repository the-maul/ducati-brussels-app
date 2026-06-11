# Avancement — DMS Ducati Bruxelles

Tableau de bord de suivi **et** checklist de recette (dossier §5.1). Tenu à jour par Claude Code.
Statuts : ⬜ à faire · 🟦 en cours · ✅ fait · 🧪 recetté (validé client).

> Convention : chaque exigence est cochée quand elle est implémentée **et** que ses invariants
> et tests associés passent (CLAUDE.md §6). La colonne « Démo » pointe l'écran/scénario.

---

## Epics

| Epic | Périmètre | Statut |
|---|---|---|
| **E0 — Socle + design system** (M0) | socle/auth/RLS/multi-société/events/design ✅ · **fonctionnalités G8 en cours** (séquences UI, recherche DB, tables de params) → [backlog-e0-e1.md](backlog-e0-e1.md) | 🟦 fonctionnalités |
| E1 — Contacts + Articles (M1, M2) | fiches **parité champs** + import tarifs ✅ · **fonctionnalités G8 en cours** (M1 : onglets/encours calculé/tarifs paliers ; M2 : prix interactif/cascade/remplacement réf/équivalences) → [backlog-e0-e1.md](backlog-e0-e1.md) | 🟦 fonctionnalités |
| E2 — Véhicules (M3) | Fiche VIN **parité G8** (carte grise A/B/D.1/E, bridé A2, TPMS, trackers, garantie, n° police), parc + filtre statut, historique propriétaires, jointure article↔véhicule, CRUD ✅ · reste : création auto véhicule depuis article V/O/P/D, GED, alerte 4 mois | 🟦 cœur fait |
| E3 — Achats & réceptions (M4) | Module `/purchases` : fiches **fournisseurs** (n° client, code interne, RFA, franco/mini) · éditeur **réception/commande** · **réception → entrées de stock + PAMP** (B5) · **réception châssis → fiche véhicule** (type V, B9) · échéancier fournisseur · régimes TVA (avec/CEE/hors-CEE) · **proposition de commande** (réappro stock mini, groupée par frs) · **export DCS** CSV (STANDARD/URGENTE) ✅ · reste : rapprochement cmd↔réception, import code-barre/microfiches, gabarit DCS exact | 🟦 cœur fait |
| E4 — Stock & inventaire (M5) | Fondation (stock_moves append-only, triple stock, PAMP testé) · écran **Stock** `/stock` (réel/réservé/disponible + **valeur PAMP** + filtres + **historique mouvements**) · **Inventaire** : 8 méthodes G8 **recomposées en 3 toggles** (ouvert/fermé × effacement × écarts), **arrêté daté**, comptage/réajustement **3 modes** (annule-remplace/cumul/casier), **remise à zéro** (conserve V/O/P), **écarts** réel vs arrêté (qté+valeur), **réintégration** unique — tout en append-only (B4/B6/B7) ✅ · reste : étiquetage différé (B12), inventaire tournant, dépréciation PAMP, copies auto 15/fin de mois | 🟦 cœur fait |
| E5 — Ventes & POS (M6) | Éditeur `/sales` (FAC/DEV/RES/BL/TIK + AVO), numérotation, encours client ✅ · **POS parité G8 (partie A) faite** : pied de facture (remise globale %/€, mode HT/TTC, **détaxe export PDV005**, port, net TTC forcé) · encaissement multi-modes/rendu monnaie/à échéance · réservation+acomptes (stock disponible B4) · conversions DEV/RES/BL→FAC/BL · avoirs (réintégration stock + remboursement) · **clôture Z** (`/pos` : fond de caisse, mouvements, journal Z, ventilation TVA, calcul monnaie) · impression PDF ✅ · reste : duplicata, regroupement BL, relances/LCR (M12), n° série/REP au POS (M3/M7), cessions/garanties (M7/M8) → [g8-fonctions-m6-ventes-pos.md](g8-fonctions-m6-ventes-pos.md) | 🟦 cœur fait |
| E6 — Reprise/Occasion/Dépôt (M7) | Module `/tradein` : **reprise (flux B3)** — crée article occasion (O/P) + fiche véhicule + entrée stock valorisée + ouvre un **ORO** · **ORO** (pièces/MO/frais imputées au **coût de revient** du véhicule, pièces sorties en cession de stock, marge potentielle par VIN) · **cessions internes** typées (sortie valorisée non facturable, base garanties) ✅ · reste : dépôt-vente + commission, reprise depuis le POS (réf REP) | 🟦 cœur fait |
| E7 — Atelier (M8) | Module `/workshop` : **OR (cycle B8)** — en-tête (client + VIN + km + opérateur + type + travaux + observations réception), lignes pièces/MO/texte, statuts à faire/en cours/prêt/facturé, **transformation en facture** (via M6, stock réel débité à la facturation) · **garantie B10** (statut acceptée/refus total/**refus partiel ligne par ligne**, pièce garantie = prix 0, facturation bloquée si en attente) · OR accident (expert/date) · **chronos B11** (`/workshop/chrono` : pointage présence + temps de travail par OR, temps passé affiché sur l'OR) · **planning/RDV** (`/workshop/planning` : vue semaine, prise de RDV, statuts colorés, **création d'OR depuis le RDV**) ✅ · reste : association temps facturé (prorata/sélection), notifications SMS/mail (M10), devis réparation PDF | 🟦 cœur fait |
| E8 — Documents & portails (M9) | **GED** : pièces jointes génériques (Supabase Storage, bucket privé `ged`, RLS par société) rattachées à toute entité — panneau réutilisable câblé sur **véhicule** (photos/COC), **contact** (pièce d'identité) et **OR** (photos réception) · PDF templatés déjà au POS (M6) ✅ · reste : signature électronique, portails client, modèles de documents configurables | 🟦 en cours |
| E9 — CRM & matching (M10) | — | ⬜ |
| E10 — Web & marketing (M11) | — | ⬜ |
| E11 — Compta & reporting (M12, M13) | **M13** : tableau de bord branché sur la vraie DB (CA jour/mois, factures, **encours clients**, OR ouverts, **valeur de stock** PAMP, véhicules en stock) ✅ · reste M13 : ventilations, productivité atelier, rotation · **M12 compta/UBL** non commencé | 🟦 M13 amorcé |
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
