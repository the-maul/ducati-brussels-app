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
| E1 — Contacts + Articles (M1, M2) | fiches **parité champs** + import tarifs ✅ · **code client auto** (trigger `trg_contacts_code`), détection de doublons, suppression sûre (`contact_delete_safe`) ✅ · **actions groupées sur la liste clients** (archiver/réactiver, statut, drapeaux VIP/surveillance/bloqué/opt-out, lier, fusionner ; sélection limitée à la page affichée) ✅ · **fonctionnalités G8 en cours** (M1 : onglets/encours calculé/tarifs paliers ; M2 : prix interactif/cascade/remplacement réf/équivalences) → [backlog-e0-e1.md](backlog-e0-e1.md) | 🟦 fonctionnalités |
| E2 — Véhicules (M3) | Fiche VIN **parité G8** (carte grise A/B/D.1/E, bridé A2, TPMS, trackers, garantie, n° police), parc + filtre statut, historique propriétaires, jointure article↔véhicule, CRUD ✅ · reste : création auto véhicule depuis article V/O/P/D, GED, alerte 4 mois | 🟦 cœur fait |
| E3 — Achats & réceptions (M4) | Module `/purchases` : fiches **fournisseurs** (n° client, code interne, RFA, franco/mini) · éditeur **réception/commande** · **réception → entrées de stock + PAMP** (B5) · **réception châssis → fiche véhicule** (type V, B9) · échéancier fournisseur · régimes TVA (avec/CEE/hors-CEE) · **proposition de commande** (réappro stock mini, groupée par frs) · **export DCS** CSV (STANDARD/URGENTE) ✅ · reste : rapprochement cmd↔réception, import code-barre/microfiches, gabarit DCS exact | 🟦 cœur fait |
| E4 — Stock & inventaire (M5) | Fondation (stock_moves append-only, triple stock, PAMP testé) · écran **Stock** `/stock` (réel/réservé/disponible + **valeur PAMP** + filtres + **historique mouvements**) · **Inventaire** : 8 méthodes G8 **recomposées en 3 toggles** (ouvert/fermé × effacement × écarts), **arrêté daté**, comptage/réajustement **3 modes** (annule-remplace/cumul/casier), **remise à zéro** (conserve V/O/P), **écarts** réel vs arrêté (qté+valeur), **réintégration** unique — tout en append-only (B4/B6/B7) ✅ · reste : étiquetage différé (B12), inventaire tournant, dépréciation PAMP, copies auto 15/fin de mois | 🟦 cœur fait |
| E5 — Ventes & POS (M6) | Éditeur `/sales` (FAC/DEV/RES/BL/TIK + AVO), numérotation, encours client ✅ · **POS parité G8 (partie A) faite** : pied de facture (remise globale %/€, mode HT/TTC, **détaxe export PDV005**, port, net TTC forcé) · encaissement multi-modes/rendu monnaie/à échéance · réservation+acomptes (stock disponible B4) · conversions DEV/RES/BL→FAC/BL · avoirs (réintégration stock + remboursement) · **clôture Z** (`/pos` : fond de caisse, mouvements, journal Z, ventilation TVA, calcul monnaie) · impression PDF ✅ · reste : duplicata, regroupement BL, relances/LCR (M12), n° série/REP au POS (M3/M7), cessions/garanties (M7/M8) → [g8-fonctions-m6-ventes-pos.md](g8-fonctions-m6-ventes-pos.md) | 🟦 cœur fait |
| E6 — Reprise/Occasion/Dépôt (M7) | Module `/tradein` : **reprise (flux B3)** — crée article occasion (O/P) + fiche véhicule + entrée stock valorisée + ouvre un **ORO** · **ORO** (pièces/MO/frais imputées au **coût de revient** du véhicule, pièces sorties en cession de stock, marge potentielle par VIN) · **cessions internes** typées (sortie valorisée non facturable, base garanties) ✅ · reste : dépôt-vente + commission, reprise depuis le POS (réf REP) | 🟦 cœur fait |
| E7 — Atelier (M8) | Module `/workshop` : **OR (cycle B8)** — en-tête (client + VIN + km + opérateur + type + travaux + observations réception), lignes pièces/MO/texte, statuts à faire/en cours/prêt/facturé, **transformation en facture** (via M6, stock réel débité à la facturation) · **garantie B10** (statut acceptée/refus total/**refus partiel ligne par ligne**, pièce garantie = prix 0, facturation bloquée si en attente) · OR accident (expert/date) · **chronos B11** (`/workshop/chrono` : pointage présence + temps de travail par OR, temps passé affiché sur l'OR) · **planning/RDV** (`/workshop/planning` : vue semaine, prise de RDV, statuts colorés, **création d'OR depuis le RDV**) ✅ · reste : association temps facturé (prorata/sélection), notifications SMS/mail (M10), devis réparation PDF | 🟦 cœur fait |
| E8 — Documents & portails (M9) | **GED** : pièces jointes génériques (Supabase Storage, bucket privé `ged`, RLS par société) rattachées à toute entité — panneau réutilisable câblé sur **véhicule** (photos/COC), **contact** (pièce d'identité) et **OR** (photos réception) · PDF templatés déjà au POS (M6) ✅ · reste : signature électronique, portails client, modèles de documents configurables | 🟦 en cours |
| E9 — CRM & matching (M10) | Module `/crm` : **pipeline de leads** (6 étapes nouveau→gagné/perdu, kanban, création, déplacement d'étape) · **journal des communications** (e-mail/SMS/appels/notes, entrant/sortant) câblé en onglet de la fiche contact (comble l'histo M1) ✅ · reste : campagnes/mailings, matching auto véhicule↔lead, notifications SMS/mail (Resend/Edge) | 🟦 cœur fait |
| E10 — Web & marketing (M11) | **E-shop** `/eshop` : catalogue produits (**stock unifié** avec le magasin), **photos** (1re image GED), prix TTC, badge stock, **publication/retrait** par article (flag `publishable`), filtre vitrine, recherche · **réglages boutique** (nom, **slug → URL publique**, description, hero, thème, contact, publication) · **panier + commande web** (crée une commande, **réserve le stock**) · **commandes web** (liste + statuts) · **storefront PUBLIC** `/shop/{slug}` (hors auth, RPC anonymes sécurisées, images produits publiques, panier + commande) · **domaine personnalisé** (OVH) · **Stripe Checkout** (Edge Function prête) · **CONSTRUCTEUR DE SITE type Strikingly** (`/eshop` onglet Site) : **multi-pages** (nav d'en-tête) + **14 blocs** (hero, bandeau, texte, image, galerie, colonnes/atouts, CTA, vidéo, carte, FAQ, horaires, produits, contact, séparateur) + **upload d'images** (bucket public) + thème + **aperçu en direct** + **Publier** ; la vitrine publique `/shop/{slug}` rend le site multi-pages ✅ · **`stripe-webhook` FAIT (P0.1, 2026-06-12)** : Edge Function signée + `finalize_web_order` (commande→**payée** + **facture FAC** + **sortie stock réel** + règlement, idempotent) + **confirmation au retour `?paid=1`** ; déployé + testé par POST (reste : poser le vrai `whsec` Stripe live) · reste : e-mails Resend, config DNS OVH → voir [integrations-cles-api.md](integrations-cles-api.md) | ✅ paiement bouclé (whsec live à poser) |
| E11 — Compta & reporting (M12, M13) | **M13** : tableau de bord branché sur la vraie DB (CA jour/mois, factures, **encours clients**, OR ouverts, **valeur de stock** PAMP, véhicules en stock) ✅ · **M13 rapports** `/reports` : **CA 12 mois** (graphe), **top articles vendus**, **productivité atelier** (présence/travail/taux) ✅ · **M12** : écran `/accounting` — **journal des ventes** + **registre TVA** (ventilation par taux) sur période · **export UBL (Peppol BIS 3.0)** d'une facture/avoir (bouton sur la fiche, → transmission via **Falco**) · **moteur d'écritures comptables FAIT (P0.2, 2026-06-12)** : **plan comptable PCMN** (`chart_of_accounts`) + **mapping paramétrable** (`account_mappings`) + **comptes auxiliaires** clients/fournisseurs + **génération d'écritures équilibrées** (ventes : client TTC / ventes HT par compte×taux / TVA collectée ; règlements : trésorerie/client) append-only + idempotent + **aperçu avec contrôle d'équilibre** · **export Winbooks au format réel Actage** (compte tiers réel, fini l'UUID) ✅ · champs vendeur (TVA/adresse/IBAN/Peppol) + comptes par défaut sur la société · journal des exports tracé ✅ · reste : connecteur Falco live (clé API), validation Peppol fine, gabarit Winbooks exact du comptable, TVA marge VO (B2) | 🟦 cœur + compta réelle |
| E12 — Migration & go-live (M14) | **Import de contacts CSV** (`Paramètres → Migration`) : mapping souple des en-têtes FR/EN, **dry-run** (aperçu créations/erreurs, validation nom requis), application par lots ✅ · reste : import articles/véhicules (même patron), rapports d'écarts, mapping G8 spécifique | 🟦 amorcé (contacts) |

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
| **Retour visuel d'enregistrement** — `<Toaster/>` monté à la racine + `MutationCache` global : toute écriture produit un toast, y compris les écrans à venir | ✅ | toute l'UI |
| **Bouton à trois états** (`SaveButton` : disquette → spinner → coche verte) + navigation différée de 800 ms pour que la coche soit vue | ✅ | fiches contact/article/véhicule |
| **Bouton grisé tant que rien n'a changé** (`useIsDirty`) | ✅ | fiches contact/article/véhicule |
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

### Migrations Supabase — état d'application

Une migration versionnée dans `supabase/migrations/` **n'est pas appliquée par le déploiement**.
C'est une étape distincte du push. Tant qu'elle n'est pas passée, le code parti en production
référence des colonnes inexistantes et **PostgREST rejette tout l'INSERT/UPDATE**, pas seulement
le champ nouveau.

| Migration | Appliquée | Conséquence si oubliée |
|---|---|---|
| `20260629100000_m1_contacts_enhancements` | ✅ 11/09/2026 | Diagnostiquée non appliquée dès juin, restée en l'état jusqu'au 11/09 : `model_interests`, `vehicle_preference`, `notify_model_stock`, `license_scan_path`, `national_id_scan_path` et l'énum `employe` manquaient → **aucune fiche client n'était enregistrable** (400 `PGRST204`). |
| `20260911120000_m1_contact_code_dedup_delete` | ✅ 11/09/2026 | Code client auto, détection de doublons, suppression sûre, civilités nettoyées. |
| `20260911170000_contact_links_unique_pair` | ✅ 11/09/2026 | Sans l'index unique, `linkContact` créait des liens en double en silence (sa garde `duplicate/unique` ne se déclenchait jamais). |
| `20260914150000_m1_new_client_foundations` | ✅ 14/09/2026 | Lot 0 du chantier « nouveau client » : `company_mailboxes` (boîtes multiples, un curseur de relève par boîte), `contacts.origin` (rétro-rempli à `import_g8` sur 8 084 fiches), `contact_invitations` (jetons à usage unique). Appliquée **et vérifiée objet par objet** le jour même. |
| `20260914160000_m1_prospect_from_email` | ✅ 14/09/2026 | Lot 1 : `create_prospect_from_email` (fiche + lead + journal, idempotent sur l'identifiant du message Graph), `log_ignored_email` (trace d'un mail écarté, sans fiche), `contacts_match_candidates` (recherche souple : `contacts_find_duplicates` exige nom + ville + téléphone + e-mail identiques, inutilisable sur un mail entrant), table `contact_merge_candidates`. Appliquée, **testée de bout en bout sur la vraie base** puis données de test supprimées. |
| `20260914170000_m1_prospect_relay_sender` | ✅ 14/09/2026 | Correctif : un message **relayé** (formulaire du site, Shopify) ne pose plus l'adresse du relais sur la fiche. Sans ça, tous les clients venus du formulaire se seraient empilés sur une seule fiche. |
| `20260914180000_m1_prospect_channel_and_address` | ✅ 14/09/2026 | Canal d'arrivée distinct (`web` / `mail`, visible comme colonne du CRM) et capture de la ville, du code postal, du pays et de la référence de moto ou de châssis citée. |
| `20260914190000_m10_lead_due_date` | ✅ 14/09/2026 | `leads.due_at` + `last_activity_at`. Échéance posée à la création de toute tâche et **repoussée à chaque échange** avec le client. Délai paramétrable dans `reference_values` / `lead_sla` (48 h par défaut). |
| `20260914200000_m1_contacts_sort_recent` | ✅ 14/09/2026 | `contacts_search` accepte un tri par date d'arrivée. L'ancienne signature à 5 arguments est **supprimée** : sans ça PostgREST aurait eu deux fonctions homonymes. |

> ⚠️ **Sept migrations du dépôt ne sont toujours PAS appliquées**, dont trois qui cassent la
> production en silence (fiche véhicule et fiche article non enregistrables, module reprises
> inopérant). Liste complète et méthode de vérification : [`etat-projet.md`](etat-projet.md) §2.

**À vérifier avant chaque mise en production** : les colonnes utilisées par les formulaires
existent bien en base. Un `PATCH` en 400 sans erreur Postgres associée dans `edge_logs` est la
signature d'une colonne inconnue rejetée par PostgREST.

**Ne pas se fier à `supabase_migrations.schema_migrations`** : une migration passée à la main dans
l'éditeur SQL n'y figure pas. Seule la présence réelle des objets fait foi (`to_regclass`,
`information_schema.columns`).

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
