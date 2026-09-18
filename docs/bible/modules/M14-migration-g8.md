---
chapitre: M14
titre: Migration G8
etat: 🟦
verifie_le: 2026-09-18
missions: []
mots_cles: [migration, G8, Futurosoft, import, reprise de données, Info DB, CSV, xlsx, dry-run, clients, fournisseurs, parc véhicules, factures historiques, PDF, legacy_code, legacy_number, imported_from, go-live]
---

# M14 — Migration G8

> **En une phrase** : faire passer les données de l'ancien logiciel G8 (clients, fournisseurs, parc de motos, factures et leurs PDF) dans le DMS, sans doublons et en gardant la trace de leur origine.

## 1. À quoi ça sert
Deux outils coexistent. Pour la **reprise initiale** faite par l'intégrateur, des scripts Python lisent
les exports Excel et les PDF fournis par la concession (dossier `Info DB`, hors dépôt) et les envoient
dans la base. Pour les **imports ponctuels** faits par un administrateur, un écran Paramètres →
Migration accepte un CSV collé, montre un aperçu (dry-run) avec les erreurs, puis importe par lots.
Dans les deux cas un enregistrement déjà présent n'est jamais écrasé.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Paramètres → Migration & imports (`/settings/migration`, administrateur uniquement) | 3 onglets **Contacts / Articles / Véhicules** : coller ou déposer un CSV (1re ligne = en-têtes, noms FR ou EN reconnus), **Analyser (dry-run)** : aperçu des lignes à créer et des erreurs, puis **Importer** par lots. Contacts : nom ou raison sociale obligatoire. Articles : référence + désignation obligatoires, prix TTC, marque, code-barres ; une référence existante est ignorée. Véhicules : VIN obligatoire (17 caractères max), modèle, année, plaque ; un VIN existant est ignoré |
| (poste de l'intégrateur) `tools/migration/import_g8.py` | Reprise des exports G8 : `fournisseurs`, `vehicules`, `factures`, `clients` ; dry-run par défaut, `--apply` pour écrire ; idempotent sur la clé G8 |
| (poste de l'intégrateur) `tools/migration/import_pdf_lines.py` | Reconstitue les **lignes** des factures G8 à partir des PDF `FACTURE 26xxxxxx.pdf` (lecture par position) |
| (poste de l'intégrateur) `tools/migration/import_pdf_ged.py` | Attache chaque PDF de facture G8 à son document en GED (bucket `ged`) |
| Ventes / fiche client (M6, M1) | Les factures reprises sont consultables, rattachées au client, avec le PDF d'origine en pièce jointe |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écran (route) | `src/routes/_app.settings.migration.tsx` |
| Panneau d'import générique (coller / analyser / importer) | `src/modules/migration/import-panel.tsx` |
| Lecture CSV, correspondance des en-têtes | `src/modules/migration/csv-utils.ts` |
| Imports par entité | `src/modules/migration/contacts-import.ts`, `src/modules/migration/articles-import.ts`, `src/modules/migration/vehicles-import.ts` |
| Scripts de reprise | `tools/migration/import_g8.py`, `tools/migration/import_pdf_lines.py`, `tools/migration/import_pdf_ged.py` |
| Spécification des formats G8 et correspondance des champs | `docs/migration-g8-formats.md` |
| Tables alimentées | `contacts` (clients et fournisseurs `type = 'fournisseur'`, `legacy_code`, `imported_from`, `origin`), `vehicles` (`legacy_state`, `imported_from`…), `articles` + `article_barcodes`, `documents` (`legacy_number`, `code_client_legacy`, `marge`, `remise_ttc`, `condition_reglement`, `compta_transferred`, `imported_from = 'G8'`), `document_lines`, `document_payments`, `attachments` + Storage `ged` |
| Fonctions SQL (RPC) | aucune : insertion directe (API REST en clé de service pour les scripts, client connecté pour l'écran) |
| Fonctions serveur (Edge) | aucune |
| Tâches planifiées | aucune |
| Migrations clés | `supabase/migrations/20260612270000_m14_g8_legacy_fields.sql` (champs G8), `supabase/migrations/20260612280000_m14_imported_from.sql` (marqueur d'origine) |
| Libellés | `src/lib/i18n/fr.ts`, bloc `migration` |
| Tests | `tests/migration-import.test.ts` (5 cas), `tests/pdf-text.test.ts` |

## 4. Règles métier et décisions
- **On adapte l'application aux documents du client, pas l'inverse** (`docs/migration-g8-formats.md`) : champs G8 ajoutés tels quels (`legacy_code`, `dou`, `legacy_state`, `marge`, `remise_ttc`…).
- **Idempotence** : les scripts n'insèrent que ce dont la clé G8 n'existe pas (`legacy_code`, `legacy_number`, VIN) ; l'écran ignore une référence d'article ou un VIN déjà présent. **Jamais d'écrasement.**
- **Formats G8** : encodage Windows-1252, dates en numéros de série Excel (origine 30/12/1899), xlsx lu en XML brut car `openpyxl` casse sur les styles G8.
- **Parc** : l'état G8 est conservé brut dans `vehicles.legacy_state` ; « RÉPARÉ » (73 % des véhicules) est converti en `vendu` / `livre` selon la présence d'une date de vente. VIN bidons (`0000…`, `1111…`) neutralisés.
- **Factures** : `Montant Dû` pilote le statut (≈ 0 → `payee`) ; TTC négatif → avoir `AVO` ; règlements G8 convertis (ESPECES → ESP, VISA/MASTERC/MAESTRO → CB…).
- **Pas de re-déclaration** : les factures reprises sont antérieures à la date de bascule comptable (M12) et ne génèrent ni TVA ni écritures.
- **Décisions client encore ouvertes** (`docs/migration-g8-formats.md`, « Décisions client à valider ») : société des factures (toutes ITALBIKE STORE ?), sens de la colonne `Dou`, conversion de l'état « RÉPARÉ ».

## 5. État en production
Vérifié le 18/09/2026 (code + base).
- **Objets présents** : toutes les colonnes écrites par l'écran et les scripts existent (`articles.sale_price_ttc`, `brand`, `vehicles.model_year`, `legacy_state`, `imported_from`, `contacts.legacy_code`, `documents.legacy_number`…). L'import d'articles et de véhicules **n'envoie pas** les colonnes manquantes signalées dans `docs/etat-projet.md` §2 (`vehicles.papers_100hp`, `articles.year_from/year_to`) : il n'est pas bloqué par cette dérive, contrairement aux formulaires M2 / M3.
- **Données reprises** : 8 084 contacts marqués importés (sur 8 108), dont 101 fournisseurs ; 3 299 véhicules importés (sur 3 346) ; 17 808 factures G8, toutes rattachées à **une seule société** ; 151 factures sans client retrouvé ; 716 factures avec lignes reconstituées depuis les PDF ; 27 contacts avec un solde d'ouverture.
- **Non repris** : stock réel G8 (les 300 mouvements d'origine `import` viennent des données de démonstration), PAMP, historique des OR, documents en cours (devis, réservations, OR ouverts), mouvements de stock historiques.
- 4 véhicules importés partagent leur VIN avec une autre fiche (doublons à vérifier).
- **Sécurité** : les scripts utilisent la clé de service lue dans la variable d'environnement `SUPABASE_SERVICE_ROLE_KEY` (jamais écrite dans le dépôt). Le dossier source `Info DB` contient des données personnelles et n'est pas versionné.

## 6. Prévu / en cours
- Reste noté dans `docs/avancement.md` (E12) : rapports d'écarts, mapping G8 spécifique des articles.
- À arbitrer avant le go-live (`docs/cahier-fonctionnel-v2.md` §3, point 4) : reprise des OR clôturés, des mouvements de stock, des encours et des documents en cours à la bascule.
- Stock initial et PAMP au jour de la bascule : aucun outil dédié ; passer par un inventaire M5 (arrêté + réintégration) est la voie la plus sûre (à décider).

## 7. Limites connues, dettes, pièges
- **Écran = contacts, articles, véhicules seulement** ; fournisseurs, factures et PDF ne passent que par les scripts Python, lancés depuis un poste avec la clé de service et le dossier `Info DB`.
- **Import d'articles minimal** : ni type de gestion (B1), ni casier, ni PAMP, ni stock mini / maxi, ni équivalences (INV014 demande tout cela). Pas de mouvement de stock créé.
- **Import de véhicules** : pas de lien propriétaire / client, pas d'article associé pour les types V/O/P/D (la jointure article ↔ véhicule de `CLAUDE.md` §2 n'est pas faite par l'import CSV).
- **Pas de rapport d'écart** après import (seulement le compte créés / ignorés).
- **Clients via CSV** : type forcé à `particulier` sauf colonne Type reconnue ; pays par défaut `BE`.
- **Scripts Python sur Windows** : lancer depuis PowerShell après avoir chargé la variable d'environnement (voir en-tête de chaque script) ; `import_pdf_lines.py` dépend de `pdfplumber` (à installer à part).
- Les imports insèrent des objets `Record<string, unknown>` construits à partir des en-têtes : une colonne mal nommée n'est détectée qu'à l'exécution (400 PostgREST), pas à la compilation.

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, §3 et annexe A.

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| CON005 | Export propre des contacts G8 + mapping des champs | fait | `import_g8.py clients` (commit `e385174`, 7 983 clients) ; écran CSV contacts |
| INV014 | Migration des articles G8 + catalogues Ducati | partiel | Écran CSV (référence, désignation, prix, marque, code-barres) ; pas de type de gestion, casier, PAMP, stock ; import tarifaire Ducati en M2 |
| VEH010 | Migration du parc G8 avec historique propriétaires / réparations | partiel | 3 299 véhicules repris (`import_g8.py vehicules`) ; historique propriétaires et OR non repris |
| (§3.4) | OR clôturés, mouvements de stock, encours, documents en cours | partiel | Factures historiques + PDF + soldes d'ouverture repris ; le reste non |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Import de contacts CSV (dry-run, lots) | `1cad615` |
| 2026-06-12 | Champs G8 + spécification des formats | `45c9cc2`, `20260612270000_m14_g8_legacy_fields.sql` |
| 2026-06-12 | Reprise réelle : 101 fournisseurs, 3 299 véhicules, 17 808 factures | `d262257`, `20260612280000_m14_imported_from.sql` |
| 2026-06-12 | Lignes de factures depuis les PDF ; PDF d'origine en GED | `8e9093b`, `343ebbf` |
| 2026-06-22 | Import des clients G8 (7 983), factures reliées au client, nettoyage démo | `e385174` |
| 2026-07-27 | Import CSV d'articles et de véhicules | `1a67fb8` |
