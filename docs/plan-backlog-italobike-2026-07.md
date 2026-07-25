# Plan d'intégration — Backlog client Italobike/Ducati Bruxelles (Domenico, 25/07/2026)

> Auteur : Atlas · Date : 2026-07-25 · Backup état actuel : tag `backup-20260725-224552` (commit `579601f`)
> Source demandes : `ducati-backlog-italobike.md` (37 items / 7 modules) + specs `.docx` départements.
> Légende effort : 🟢 = socle déjà là, à finir/brancher · 🟡 = partiel · 🔴 = à créer de zéro.

---

## Principe de travail proposé
- **1 lot = 1 branche = 1 PR** par module, buildée en local (`bun run build` vert) avant push.
- Migrations SQL append-only, RLS + `company_id` respectés (invariants CLAUDE.md B1–B12).
- Chaque item tracé par un code (ex. `feat(contacts): VIP étoile liste CTC-07`) + MAJ `docs/avancement.md`.
- Ordre = dépendances techniques : **Familles/Fournisseurs d'abord** (impactent stock→compta), puis le reste.

---

## LOT 0 — Prérequis structurants (bloque tout le reste)
| # | Item | État | Effort |
|---|---|---|---|
| 0.1 | Bouton **Familles** = CRUD rayons/sous-rayons/catégories (3 niveaux) | route `parts.families` existe, à finaliser CRUD | 🟡 |
| 0.2 | Migration fiches G8 : structure 3 niveaux + 5 blocs, fournisseurs & familles d'abord | moteur import existe | 🟡 |
| 0.3 | Import liste clients G8 (`Liste clients 22-06.xlsx`) | patron import contacts existe (M14) | 🟢 |

## LOT 1 — Contacts / CRM (spec `Département CONTACTS.docx`)
| # | Item | État | Effort |
|---|---|---|---|
| 1.1 | **Fil d'Ariane** partout (composant `breadcrumb.tsx` existe, à câbler sur les routes) | composant présent | 🟡 |
| 1.2 | Boutons **Annuler/Enregistrer sticky** (haut+bas, fixes au scroll) | à généraliser | 🟡 |
| 1.3 | Création **compte privé lié** : pop-up héritage mail/tel/adresse + Civilité, **limite 2 fiches** | `contact-links-panel` existe, sans limite ni pop-up | 🟡 |
| 1.4 | **Code client interne** visible en colonne liste (à gauche du Nom) | champ présent | 🟢 |
| 1.5 | Pop-up **TVA à création pro** → préremplissage auto (VIES) | `vies-api.ts` existe | 🟢 |
| 1.6 | **Conditions de paiement** → dropdown (immédiat/7j/15j/30j) | champ texte libre → passer en select | 🟢 |
| 1.7 | **VIP = étoile** + **À surveiller = ⚠ + note** visibles liste & fiche | flags `is_vip`/`is_watch` existent, affichage à faire | 🟡 |
| 1.8 | Supprimer champs Segment tarifaire / Tarif / Catégorie | 🟢 |
| 1.9 | **Modèles d'intérêt** (tags haut de fiche + colonne liste, supprimables) | `model-interest-badges` existe | 🟡 |
| 1.10 | Ajouter intérêt **« Piste »** (à côté Route/Sport/Off-road) + lien fiches motos | interests existent | 🟢 |
| 1.11 | Pop-up **client débiteur** à l'ouverture fiche (« Redevable de X€ → solder ? ») | `debtors_list` RPC existe | 🟡 |
| 1.12 | Modifier/fusionner/supprimer/archiver une fiche contact | partiel | 🟡 |
| 1.13 | Remplissage auto **IBAN** via CODA (reconnaissance nom) | 🔴 (dépend import CODA) |
| 1.14 | CRM : créer lead + **faire ressortir clients intéressés** quand moto entre en stock (mail auto/semi) | pipeline leads existe, matching à créer | 🔴 |

## LOT 2 — Pièces & Accessoires (spec `DEPARTEMENT - Pièces & Accessoires.docx`)
| # | Item | État | Effort |
|---|---|---|---|
| 2.1 | **Étiquettes intelligentes** Brother QL-1110NWB 62×29 : perso flexible, saisie libre, rapprochement réception↔client (nom+n° doc sur étiquette) | `label-print`/`labels-batch`/`quick-label` existent | 🟡 |
| 2.2 | Catalogue : **supprimer** colonnes Type & Marque | 🟢 |
| 2.3 | Catalogue : **ajouter** Dispo fournisseur (pastille V/J/R), Stock réel, Réservé, Disponible, En proposition, En commande, Localisation 2 | pastille dispo frs = 🔴, reste 🟡 |
| 2.4 | **Duplication référence** rapide (liste + fiche) | 🔴 |
| 2.5 | **Proposition de commande** rapide (liste + fiche) | reorder existe | 🟡 |
| 2.6 | Bouton **Cascade** = reclassement de groupes mal classés (IA/scraping DCS) | route `parts.cascade` existe | 🟡 |
| 2.7 | **Import tarifs** : mapping colonnes Excel↔ERP par fournisseur, mémorisé | moteur import + settings existent | 🟢 |
| 2.8 | Fiche article : supprimer « Mode de facturation », **Équivalences** = anciennes réfs liées | 🟡 |
| 2.9 | Case **« Publier e-shop »** en haut de fiche | flag existe | 🟢 |
| 2.10 | Scroll : lignes glissent sous recherche/filtres (header sticky) | 🟡 |
| 2.11 | Fiche article : **fenêtre applicabilités** d'une référence | 🔴 (dépend 2.13) |
| 2.12 | Filtre mouvements : dropdown Tout/Entrée/Sortie + cases types docs + dates Du/Au + aperçu/suppression docs | 🟡 |
| 2.13 | Intégrer **CSV applicabilité** (`applicabilitiesList_55611132AA.csv`, ~55k lignes) | 🔴 |
| 2.14 | Référence = **code-barres par défaut** | `barcode.ts` existe | 🟢 |

## LOT 3 — Stock & Inventaire (specs `Stock & inventaire.docx` + `Inventaire ERP.docx`)
| # | Item | État | Effort |
|---|---|---|---|
| 3.1 | **Multi-filtres** stock (dates, fournisseurs, rayons, référence) | écran stock existe | 🟡 |
| 3.2 | **Export inventaire filtré** | 🟡 |
| 3.3 | **Dépréciation de stock** (filtres, baisse charge comptable) | 🔴 |
| 3.4 | Vision stock **temps réel ou à date donnée** | triple stock existe | 🟡 |
| 3.5 | Tableau de bord réfs régulières + localisation + Min/Max + back-order, filtré rayon/frs | 🔴 |
| 3.6 | Inventaire complet : sauvegarde état T, **remise à zéro sélective (VN/VO/DV)** | inventaire 3-toggles existe | 🟢 |
| 3.7 | Inventaire : **scan code-barres**, ajout photos, **création article à la volée** | partiel | 🟡 |
| 3.8 | Inventaire cible par rayon/fournisseur | 🟡 |
| 3.9 | **Verrouillage localisation**, étiquetage ligne par ligne ou en masse | 🟡 |
| 3.10 | Sauvegarde auto, interruption à tout moment, reprise avec aperçu | 🟡 |

## LOT 4 — Ventes & Facturation (spec `VENTES & FACTURATION.docx`)
| # | Item | État | Effort |
|---|---|---|---|
| 4.1 | Filtres page Ventes : Département (E-shop vs magasin, renommer « Internet »→« E-shop ») | 🟡 |
| 4.2 | **Statut dispo sur docs** (pastille V/R/O + %, transitions devis→BC→proposition) | 🔴 |
| 4.3 | Filtre **type contenu** (VN/VO/DV/Sans véhicule) | 🟡 |
| 4.4 | Filtres dates Du/Au, type client Pro/Part, client (nom/code), n° doc | 🟡 |
| 4.5 | **Envoi mail + SMS** depuis document + **historique** dans fiche client | journal comms existe, **envoi réel = à créer (Resend/SMS)** | 🔴 |
| 4.6 | Actions rapides : supprimer / dupliquer / imprimer doc | impression existe | 🟡 |
| 4.7 | **Acomptes en liste** (vert reçu / rouge solde dû) | acomptes existent | 🟡 |
| 4.8 | **Picking List digitale** (auto à réception + attribution manuelle + localisation) | 🔴 |
| 4.9 | **Purge devis** antérieurs à une date | 🟡 |

## LOT 5 — Commandes / Documents (formulaires joints)
| # | Item | État | Effort |
|---|---|---|---|
| 5.1 | Flux **commandes standard/urgentes** (export DCS format imposé) | `dcs-export.ts` existe | 🟡 |
| 5.2 | **Formulaire moto accidentée** + Programme Aide Réparation Ducati (15% si devis>1500€ HT pièces, envoi Technique@ducati.fr) | 🔴 |
| 5.3 | Modèles PDF **Bon de livraison** + **Facture** conformes aux exemples fournis | PDF POS existe | 🟡 |

## LOT 6 — Admin / Financier (hors code)
| # | Item | État |
|---|---|---|
| 6.1 | Chèque Entreprise à introduire (50% sur audit+MVP = 9 750€) | tâche gestion, hors dev |

---

## Estimation macro (à affiner après validation)
- **Quick wins 🟢 (brancher l'existant)** : ~9 items → 2–3 j
- **Finitions 🟡 (compléter UX/logique)** : ~22 items → 8–10 j
- **Créations 🔴 (from scratch)** : ~10 items → 8–12 j
  - dont les gros morceaux : applicabilité CSV 55k lignes (2.11+2.13), picking list (4.8), envoi mail/SMS réel (1.14+4.5), dépréciation stock (3.3), statut dispo docs (4.2).

## Dépendances externes à obtenir de toi/Domenico
- Secrets Supabase (SUPABASE_ACCESS_TOKEN, DB_PASSWORD, SERVICE_ROLE_KEY) pour appliquer migrations + tester.
- Clé API **SMS** (provider ?) et **Resend** (mail) pour LOT 4.5.
- Format DCS exact + gabarit Winbooks du comptable.
- Confirmation provider IBAN/CODA (LOT 1.13).

## Ordre d'exécution recommandé
1. LOT 0 (prérequis familles/import) → 2. LOT 1 (contacts, forte valeur, socle prêt) →
3. LOT 2 (pièces) → 4. LOT 3 (stock) → 5. LOT 4 (ventes) → 6. LOT 5 (docs).
