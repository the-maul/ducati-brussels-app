# CLAUDE.md — DMS Ducati Bruxelles

Règles du projet, à respecter dans **chaque** PR. Toute violation des invariants B1–B12
ou des règles ci-dessous justifie le refus d'une PR.

---

## 0. Contexte projet

- **Quoi** : remplacement du DMS **G8 / Futurosoft** par un DMS sur mesure pour la concession
  **Ducati Bruxelles**. 14 modules (M0–M14), 140 exigences du GAP Analysis, 12 invariants métier G8.
- **Entités juridiques (multi-société, COM005)** : **ITALBIKE STORE** + **NL INVEST**.
  Tout document/mouvement porte un `company_id` ; flux croisés (facturation inter-sociétés) possibles ;
  numérotations de documents **par société**.
- **Objectif** : livraison 100 % fonctionnelle en **un seul go-live** (pas de « phase 2 reportée »).
  L'ordre des epics est un ordre de **dépendances techniques**, pas un phasage commercial.
- **Stack & déploiement** (scaffold Lovable existant, repo `the-maul/ducati-brussels-app`) :
  - Front : **Lovable.dev** — **TanStack Start / Router** (SSR : `src/server.ts`, `src/start.ts`,
    routes typées dans `src/routes/`, `routeTree.gen.ts` **généré, ne pas éditer à la main**),
    **TypeScript + Vite + Tailwind + shadcn/ui** (tout le kit `src/components/ui/` déjà présent),
    runtime/lockfile **Bun** (`bun.lock`, `bunfig.toml`). Le code doit rester **déployable tel quel
    par Lovable** — pas de dépendance exotique hors de ce que Lovable supporte. **Réutiliser** les
    composants `src/components/ui/` existants, ne pas les réécrire.
  - Données/back : **Supabase** déjà câblé dans `src/integrations/supabase/`
    (`client.ts`, `client.server.ts`, `auth-middleware.ts`, `types.ts` **généré depuis le schéma**).
    PostgreSQL, Auth, Storage (photos/PDF), Edge Functions, Realtime (planning/notifications),
    `pg_cron` (alertes 4 mois, relances). Config dans `supabase/config.toml`.
  - **Conventions de placement** : schéma versionné dans `supabase/migrations/` ; fonctions serveur
    dans `supabase/functions/` ; logique métier par module dans `src/modules/<module>/` ; les routes
    `src/routes/` ne font que câbler les modules. Styles globaux dans `src/styles.css` ;
    les tokens de la charte dans `src/styles/tokens.css` (importé par `styles.css`), seul lieu des
    couleurs/typos (règle 9).
- **Sources de vérité** (lire avant de coder un module) :
  - 👉 [`docs/etat-projet.md`](docs/etat-projet.md) — **À LIRE EN PREMIER** : où on en est, workflow,
    outillage/secrets, pièges, état par module, prochaines étapes (document de reprise).
  - [`docs/dossier-projet.md`](docs/dossier-projet.md) — architecture, 14 modules, plan des epics.
  - [`docs/cahier-fonctionnel-v2.md`](docs/cahier-fonctionnel-v2.md) — 140 exigences (Annexe A) + invariants (Annexe B).
  - [`docs/charte-graphique.md`](docs/charte-graphique.md) — **source de vérité visuelle unique**.

---

## 1. Les règles à graver (§4.2 du dossier-projet)

1. **Langues.** UI et **données en FR**, **code en EN** (identifiants, noms de tables/colonnes,
   commentaires techniques). Le **glossaire métier** ci-dessous (§2) est obligatoire et fait foi.
2. **Multi-société + RLS.** Toute table porte `company_id`. **RLS active partout.** Rôles définis en M0
   (`admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing`).
3. **Stock et prix : jamais d'UPDATE direct.** Tout passe par des tables **append-only**
   (`stock_moves`, `price_changes`). Le **stock réel est une somme de mouvements, pas un champ**
   modifiable. Idem pour le PAMP et les prix (voir B5, B7).
4. **Statut + audit.** Tout document a un `status` et une trace dans la table `events` (append-only) :
   qui, quoi, quand, ancien/nouveau, origine (écran, import, API). **Aucun UPDATE silencieux.** (B7)
5. **Invariants B1–B12 = contraintes de conception.** Voir §3. Toute PR qui en viole un est refusée.
6. **Traçabilité des exigences.** Chaque exigence implémentée référence son code dans le commit
   (ex. `feat(workshop): devis complémentaire ATE009`). Met à jour `docs/avancement.md`.
7. **Tests obligatoires** sur les règles critiques : **PAMP, TVA marge, réservations,
   arrêté/réintégration d'inventaire, encours crédit, imputation ORO**. (dossier §4.2.7)
8. **Seed data dès l'Epic 0** : 2 sociétés, 20 clients, 300 articles (tous types A–R),
   12 véhicules, 5 OR — pour des démos permanentes. (`/seed/`)
9. **Design = charte.** [`docs/charte-graphique.md`](docs/charte-graphique.md) est la source de vérité visuelle.
   Toutes les couleurs/typos viennent de [`src/styles/tokens.css`](src/styles/tokens.css) —
   **aucun hex ni font-family en dur** dans les composants. Le **rouge Ducati est réservé aux actions
   primaires / à l'identité**, jamais à un statut (impayé = `--danger`, pas `--ducati-red`).
   **Tout statut = couleur + icône + libellé.** Densité Cond dans les tableaux, `tabular-nums` sur tous
   les montants. Anti-patterns du §9 de la charte refusés en PR : pas de dégradés/glassmorphism,
   pas de camemberts multicolores, **border-radius ≤ 8px** (standard 6px, badges 4px), pas d'emojis dans l'UI,
   Ext jamais en corps de texte/tableaux.
10. **i18n dès le jour 1.** Tous les libellés UI passent par un **dictionnaire FR** (clé → texte),
    structure prête pour le **NL** (Bruxelles, charte §8). **Pas de chaînes en dur** dans les composants.

---

## 2. Glossaire métier (obligatoire — FR, fait foi)

Termes hérités de G8 à employer tels quels dans l'UI, les données et les discussions.

| Terme | Définition |
|---|---|
| **VIN** | *Vehicle Identification Number* — n° de châssis, 17 caractères alphanumériques. Objet pivot de première classe (fiche véhicule + historique propriétaires). Reconnu automatiquement par la recherche globale. |
| **OR** | **Ordre de Réparation** — dossier atelier : réception → travaux → facture, avec historique cumulé par véhicule (cycle B8). |
| **ORO** | **Ordre de Remise en État** — dossier de remise en état ouvert lors d'une **reprise/occasion**. Pièces et main-d'œuvre s'imputent au **coût de revient du véhicule** (PAS en charge atelier). Cœur de la rentabilité par VIN (B3). |
| **PAMP** | **Prix d'Achat Moyen Pondéré** — recalculé à **chaque entrée** en stock. Les marges se suivent à la fois sur PA et sur PAMP (B5). |
| **PAHT** | Prix d'Achat Hors Taxes (saisi à la réception). |
| **Coût de revient** | Pour un véhicule d'occasion : `PAHT (ou prix de reprise) + ORO + frais`. Base de la marge réelle. |
| **Arrêté (d'inventaire)** | **Photo datée** du stock à un instant T (le stock « arrêté » du triple stock). Sert de référence à l'inventaire ; réintégration unique après comptage (B4, B6). |
| **Triple stock** | **réel** (physique) / **arrêté** (photo datée) / **disponible** (`réel − réservé + en commande`). Copies datées consultables a posteriori (B4). |
| **TVA marge** | Régime TVA des occasions rachetées à des **particuliers** (type O) : la TVA est calculée à la revente **uniquement sur la marge** (valeur ajoutée), pas sur le prix total. Registre VO obligatoire (B2). |
| **Dépôt-vente** | Type **D** : véhicule confié par un client, **n'entre PAS en valorisation de stock** (il reste sa propriété). À la vente : reversement au déposant + **commission** facturée. |
| **REP** | Référence de **reprise**, type de gestion **R** (préfixe `REP-`). Point de départ du flux B3 : reprise → article occasion + fiche véhicule + ORO. |
| **COC** | **Certificat de Conformité** — document constructeur (demande générable en PDF, DOC001). |
| **DCS** | Système de commande **Ducati** (fermé). On n'y accède pas par API : on **exporte au format Excel imposé** (ACH001), types **STANDARD** et **URGENTE**, 2 fichiers distincts. |
| **Librairie** | Catalogue d'articles **de référence non stockés** (catalogues Ducati notamment) : présents en base pour devis/commande mais sans stock tant qu'ils ne sont pas réceptionnés. |
| **Casier** | Code d'**emplacement** de rangement (jusqu'à 12 caractères). Multi-emplacements par article ; affiché en facturation, POS et picking (INV006, B6). |
| **Type de gestion** | Caractéristique d'article héritée de G8 (B1) — voir tableau ci-dessous. |
| **Cession interne** | Sortie de stock **valorisée mais non facturable** et **typée** (cadeau, cession VN démo, fournitures atelier, garantie). Tracée pour stats et marge. |
| **Bridage / A2** | Limitation de puissance d'une moto. Le permis **A2** conditionne le bridage → **attestation de bridage/débridage** (DOC006), liée à la fiche véhicule + au permis client. |
| **Tournant (inventaire)** | Inventaire **tournant** : comptage partiel récurrent avec taux d'écart, sans arrêt du magasin. |
| **Détaxe** | Client étranger drapeau « détaxé » → **TVA 0 % export** au POS + mention légale (PDV005). |

### Types de gestion d'article (B1) — à employer partout

| Code | Signification |
|---|---|
| **A** | Pièce **stockée** |
| **M** | Article **non stocké** (vendu sans gestion de stock) |
| **F** | **Texte** / ligne libre (pas un article physique) |
| **N** | **Composant de forfait/kit** (nomenclature) |
| **V** | **Véhicule neuf** (avec n° de série / VIN) |
| **O** | **Occasion particulier** → **TVA marge** |
| **P** | **Occasion professionnel** → TVA 21 % |
| **D** | **Dépôt-vente** |
| **R** | **Référence de reprise** (REP) |
| **T** | **Main d'œuvre** (taux horaire, quantité décimale ; hérité de G8 — voir ADR-002) |

> **Jointure cœur du custom** : les véhicules de type **V/O/P/D** sont **à la fois des articles**
> (valorisation, stock) **ET des fiches véhicule** (VIN, historique propriétaires). C'est ce que ni Odoo
> ni un e-commerce ne font proprement — c'est le cœur de la valeur. Ne jamais les dissocier.

---

## 3. Les 12 invariants métier (Annexe B) — contraintes de conception

Toute PR qui en viole un est **refusée**. Chaque invariant a ses tests (règle 7).

- **B1 — Types de gestion d'article.** A / M / F / N / V / O / P / D / R / **T** (voir §2 ; T = main d'œuvre, ADR-002). Porté par chaque article.
- **B2 — TVA sur marge.** Occasions rachetées à des particuliers (type O) : TVA calculée à la revente
  **uniquement sur la marge**, pas sur le prix total. Mentions légales + **registre VO**. Type P = TVA 21 %.
- **B3 — Flux de reprise.** Reprise client (réf. type **R**, `REP-`) → **création automatique** de l'article
  occasion (O ou P) **+ fiche véhicule + ouverture d'un ORO** imputant pièces et MO au **coût de revient**.
  Rentabilité réelle = `PV − (prix de reprise + remise en état + frais)`.
- **B4 — Triple stock.** réel / arrêté (photo) / disponible (`réel − réservé + en commande`).
  Copies datées (15 et fin de mois) consultables a posteriori.
- **B5 — PAMP.** Recalculé sur chaque entrée ; marges suivies à la fois sur PA **et** sur PAMP.
- **B6 — Trois modes de réajustement d'inventaire.** annule-et-remplace · cumul (multi-emplacements) ·
  par casier à la volée.
- **B7 — Traçabilité totale des mouvements de stock.** Horodatage, ancien/nouveau stock, origine de
  l'opération, opérateur. Tables **append-only**, jamais d'UPDATE silencieux.
- **B8 — Cycle OR.** réception (observations/photos) → OR transmis atelier → devis éventuel →
  accord client → réparation → transformation en facture, **historique cumulé par véhicule**.
- **B9 — Numéros de série.** Suivis sur les types V/O/P ; recherche croisée **véhicule ↔ client ↔ documents**.
- **B10 — Garantie.** OR garantie (Ducati ou magasin) avec imputation (cession garantie), états
  d'avancement, **acceptation / refus total / refus partiel avec re-routage des lignes**.
- **B11 — Productivité atelier.** Présence pointée → temps par fiche de travail → **rapprochement
  temps passé / temps facturé** (les 3 étages chronos G8).
- **B12 — Étiquetage.** Quantités par défaut = stock réel ; avec/sans code-barres ; avec/sans prix ;
  édition immédiate **ou différée cumulable** (par poste).

---

## 4. Architecture — repères

### 4.1 Objets pivots
Trois objets traversent tout le système, chacun avec un `company_id` :
**CONTACT** (CON), **VÉHICULE** (VIN, VEH), **ARTICLE** (avec type de gestion, INV/ACH).

### 4.2 Les 14 modules ↔ dossiers `src/modules/`
| Module | Dossier | Rôle |
|---|---|---|
| M0 Socle | (transverse) | auth, multi-société, RBAC, audit, recherche globale |
| M1 Contacts | `contacts` | fiche client moto, B2B, encours crédit |
| M2 Articles & tarifs | `articles` | référentiel, types A–R, PAMP, import tarifs |
| M3 Véhicules & parc | `vehicles` | fiche VIN, statuts parc, historique propriétaires |
| M4 Achats & réceptions | `purchases` | réceptions, routage, châssis, export DCS |
| M5 Stock & inventaire | `stock` | mouvements, triple stock, 8 méthodes d'inventaire |
| M6 Ventes & POS | `sales` | comptoir, devis→facture, TVA marge |
| M7 Reprise/Occasion/Dépôt | `tradein` | flux B3, ORO, dépôt-vente, cessions internes |
| M8 Atelier | `workshop` | RDV, planning, OR, chronos, garanties |
| M9 Documents & signatures | `documents` | PDF templatés, signature, GED, portails |
| M10 CRM & marketing | `crm` | pipelines, leads, matching, campagnes |
| M11 Site web & e-shop | `web` | vitrine charte, e-commerce stock unifié |
| M12 Compta & exports | `accounting` | journaux, UBL/Peppol, TVA |
| M13 Reporting | `reports` | dashboards, productivité, rotation |
| M14 Migration G8 | `migration` | imports dry-run, rapports d'écarts |

### 4.3 Séquences documentaires (M0, par société et par type)
Préfixes par défaut : `FAC-` (facture), `TIK-` (ticket caisse), `DEV-` (devis), `CMD-` (commande
fournisseur), `REC-` (réception), `OR-` (ordre de réparation), `ORO-` (remise en état occasion),
`OCC-` (occasion), `DEP-` (dépôt-vente), `REP-` (reprise), `COC-` (demande de COC).

> **Gérables par l'utilisateur (exigence client).** Les préfixes, le format (compteur, longueur,
> remise à zéro annuelle, séparateur société) et leur signification sont **configurables dans un écran
> M0 « Numérotation des documents »**, avec un **libellé explicatif par séquence** et un **aperçu en
> direct** du prochain numéro. Un non-technicien doit comprendre et reprendre la main sans nous.

### 4.4 Correspondance sidebar ↔ modules (charte §4.1)
Dashboard → M13 · Véhicules → M3+M7 · Atelier & SAV → M8 · Pièces & Accessoires → M2+M4+M5 ·
Ventes & Facturation → M6 · Clients (CRM) → M1+M10 · Caisse → M6 (POS) · E-shop → M11 ·
Rapports → M13 (exports compta M12) · Paramètres → M0 (+ M14 Migration, admin uniquement).

---

## 5. Méthode de travail

- **Une branche par epic, une PR par fonctionnalité.** Référence d'exigence dans **chaque commit**
  (`type(scope): description CODE`).
- **`docs/avancement.md`** : tableau des 140 refs + 12 invariants + 10 angles morts, chacun avec
  statut (à faire / en cours / fait / recetté) et lien de démo. C'est le tableau de bord ET la
  checklist de recette contractuelle — généré et tenu à jour par Claude Code.
- **Toute ambiguïté = ADR courte** (`docs/decisions/ADR-XXX-*.md`, voir le gabarit) **+ question dans
  la liste « à valider client »**. Jamais de supposition silencieuse.
- **Tests** : les règles critiques de la règle 7 sont couvertes avant qu'un epic soit déclaré « fait ».
- **Outils externes** : connectés au fil des epics (voir dossier §3). Les **secrets** (clés API Stripe,
  Resend, Claude API, Microsoft Graph, etc.) sont fournis par le client et stockés côté Supabase
  (Edge Function secrets / variables d'env), **jamais commités**.
- **Comptabilité (décision client)** : on **construit nous-mêmes** les flux compta/TVA (marge VO,
  multi-société, UBL) selon les invariants ; **le comptable du client corrige après coup**. Donc :
  rendre tout **paramétrable et auditable** (taux, régimes, comptes, registres exportables), pas figer
  des hypothèses comptables en dur — pour que la correction soit un réglage, pas une réécriture.

### À NE PAS connecter / hors build
Salesforce (pas d'API Ducati — écran copiable + export CSV), DIV, DCS (fermé → export Excel),
3CX/VoIP (projet séparé ; juste un champ « log d'appel » sur le contact), paie/RH, comptabilité
réglementaire (le DMS produit journaux + factures UBL ; le comptable tient les livres).

---

## 6. Définition de « terminé » pour un module

1. Exigences GAP du module implémentées et **référencées** dans les commits.
2. **Invariants concernés respectés** + tests verts (règle 7).
3. **Zéro hex / font-family en dur** ; tout libellé via le dictionnaire i18n FR.
4. **`company_id` + RLS** sur toutes les nouvelles tables ; mouvements stock/prix **append-only**.
5. Données **seed** présentes pour démo.
6. `docs/avancement.md` mis à jour ; ADR écrites pour les décisions non triviales.
7. **Déployable par Lovable** sans étape manuelle hors Supabase migrations/functions.
