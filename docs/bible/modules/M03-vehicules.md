---
chapitre: M03
titre: Véhicules & parc
etat: 🟦
verifie_le: 2026-09-18
missions: [04]
mots_cles: [véhicule, moto, VIN, châssis, parc, statut parc, propriétaire, historique propriétaires, plaque, carte grise, bridage, A2, garantie, My Ducati, extension, bulletin technique, maintenance, coût de revient, prix affiché, jours en stock, décodage VIN]
---

# M03 — Véhicules & parc

> **En une phrase** : la fiche de chaque moto, identifiée par son VIN, avec son statut dans le parc, ses propriétaires successifs, ses documents et les données rapatriées du portail My Ducati.

## 1. À quoi ça sert
Les vendeurs et l'atelier y retrouvent toute moto connue de la concession : neuve en stock, occasion, dépôt-vente,
moto de client entretenue à l'atelier. La fiche reprend la carte grise belge (repères A, B, D.1, E…), les
caractéristiques techniques, le suivi commercial (prix d'achat, coût de revient, prix affiché, jours en stock) et
l'historique des propriétaires. Une **extension navigateur** permet d'importer depuis My Ducati la garantie, les
entretiens et les bulletins techniques de la moto. Une moto à vendre est **à la fois** une fiche véhicule et un
article (type V, O, P ou D) : c'est l'article qui porte la valorisation en stock (voir M02, M05, M07).

## 2. Ce qu'on a aujourd'hui

Menu latéral : **Véhicules** (`/vehicles`). L'extension se télécharge dans **Paramètres → Extension My Ducati**.

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Véhicules → liste (`/vehicles`) | Recherche par VIN, plaque, modèle **ou nom du propriétaire** ; filtre par statut parc (11 statuts) ; colonnes véhicule, VIN, plaque, statut, prix. |
| Véhicules → Nouveau véhicule (`/vehicles/new`) | Formulaire complet : identification (VIN avec bouton **Décoder le VIN** Ducati, plaque, n° moteur, type, marque/modèle, famille…), caractéristiques (cylindrée, kW/CV, bridé A2, énergie, norme antipollution, TPMS, trackers, clés), informations complémentaires (1ʳᵉ immatriculation, contrôle technique, km, garantie, n° livre de police, case « Papiers 100 CH »), suivi commercial (statut, PA, coût de revient, prix affiché, dates d'entrée/sortie, **jours en stock** calculés, facture d'achat en pièce jointe). |
| Véhicules → fiche (`/vehicles/$vehicleId`) | Même formulaire + sections : **Propriétaires** (historique daté, propriétaire actuel — lecture seule), **Factures & documents** (documents de vente liés au VIN), **Infos Ducati (My Ducati)** (garantie, entretiens, bulletins techniques avec PDF FR rapatrié), **GED** (photos, COC…), **Clients intéressés** (matching client ↔ moto en stock avec notification, M10), bouton vers le dossier de reprise si la moto vient d'une reprise. |
| Paramètres → Extension My Ducati (`/settings/extension`) | Téléchargement de l'extension (`public/myducati-extension.zip`) et mode d'emploi. |
| (fiche client) Onglet véhicules | Parc d'un client, via `vehicle_owners` (M1). Bouton My Ducati sur la fiche contact. |
| (fiche client) Parc → **Ajouter une moto** (`/vehicles/new?contact=<id>`) | Mission 04 carte 6 : moto du client créée avec son lien propriétaire (date de début), sans article ni suivi commercial ; si le VIN existe déjà, **« Rattacher cette moto existante au client »**. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.vehicles.tsx`, `_app.vehicles.index.tsx`, `_app.vehicles.new.tsx`, `_app.vehicles.$vehicleId.tsx`, `_app.settings.extension.tsx` |
| Logique métier | `src/modules/vehicles/` : `carte-grise.ts` + `carte-grise-apply.ts` (lecture de la carte grise, mission 04), `api.ts` (lecture/écriture avec repli sur colonne inconnue, recherche par propriétaire, propriétaires, documents), `vehicle-form.tsx`, `ducati-panel.tsx` (panneau My Ducati), `purchase-invoice-field.tsx` (facture d'achat en GED), `model-abbrev.ts` (abréviations pour étiquettes) |
| My Ducati | `src/lib/myducati.ts` (réception des données de l'extension, écriture véhicule/maintenance/bulletins/contact), `src/components/myducati-listener.tsx`, extension source `tools/myducati-extension/` (`manifest.json`, `ducati.js`, `background.js`, `dms-bridge.js`, `README.md`), spécification `docs/extension-myducati.md` |
| Décodage VIN | `src/lib/ducati-vin.ts` (VIN connu → `ducati_vin_facts`, sinon code VDS → `ducati_vds`) |
| Tables | `vehicles` (fiche VIN, statut, prix), `vehicle_owners` (historique propriétaires daté), `vehicle_maintenance` (entretiens My Ducati), `vehicle_bulletins` (bulletins techniques + PDF), `ducati_vds` (table de référence modèle par code VDS, lisible par tous les connectés), `ducati_vin_facts` (VIN connus des factures) |
| Fonctions SQL (RPC) | Mission 04 : `vin_normalize`, `vehicles_find_by_vin` (doublon de VIN + propriétaire actuel), `vehicle_create_for_contact` (moto + propriétaire en une transaction, refuse `VIN_EXISTS`), `vehicle_attach_owner` (changement de propriétaire tracé) ; `learn_ducati_vds` + trigger `trg_learn_ducati_vds` (chaque moto Ducati enregistrée enrichit la table VDS), `recompute_oro_and_vehicle` (coût de revient, voir M07), `contacts_search` (recherche par propriétaire) |
| Fonctions serveur (Edge) | `read-id-doc`, mode `carte_grise` (mission 04 carte 7 : lecture de la carte grise par Claude ; mappage `supabase/functions/_shared/carte-grise.ts`) |
| Tâches planifiées | aucune pour les véhicules (l'alerte `dormant-stock-alert` ne porte que sur les articles de type A, voir §7) |
| Migrations clés | `supabase/migrations/20260610170000_m3_vehicles.sql` (schéma, statuts, RLS), `20260612270000_m14_g8_legacy_fields.sql` (`entry_date`, `sold_date`…), `20260612600000_ducati_vds_decoder.sql`, `20260612700000_ducati_vin_facts.sql`, `20260613500000_m3_ducati_vehicle_data.sql` (My Ducati), `20260613600000_m3_bulletin_url.sql`, `20260613700000_m3_bulletin_pdf.sql`, `20260629140000_m3_vehicle_marking_to_origin.sql`, `20260716090000_m3_vehicles_papers_100hp.sql` |
| Tests | `tests/myducati.test.ts`, `tests/model-abbrev.test.ts`, `tests/vin.test.ts` (contrôle du VIN), `tests/carte-grise.test.ts` (mappage carte grise) |
| Libellés | `src/lib/i18n/fr.ts`, blocs `vehicles`, `matching`, `settings` (clés `ext*`) |

## 4. Règles métier et décisions

- **Le VIN est l'objet pivot** (glossaire, B9) : 17 caractères, reconnu par la recherche globale Ctrl+K. Les motos Ducati (`ZDM…`) peuvent être décodées automatiquement.
- **Contrôle du VIN (mission 04)** : majuscules sans séparateurs (`src/lib/vin.ts` = `vin_normalize` en base) ; 17 caractères et pas de I/O/Q = **avertissement** seulement ; un VIN déjà présent dans la société est **refusé** à la création (écran + base) et l'écran propose de rattacher la moto existante (décision M-13).
- **Moto d'un client** (mission 04, décision M-12) : véhicule de réparation, **jamais un article** ; statut « Vendu » ; créée avec son propriétaire courant par `vehicle_create_for_contact`. Libellés du formulaire avec les **codes de la carte grise** (E, A, B, D.1, D.3, P.1, P.2, P.3, V.9, R).
- **Jointure article ↔ véhicule** (B1, B9, « cœur du custom ») : `vehicles.article_id` pointe vers l'article V/O/P/D qui porte le stock et le PAMP. Ne jamais les dissocier. Création de ce lien : réception châssis (M4, type V) et validation de reprise (M7, type O/P). Le dépôt-vente (type D) n'a **pas** de création automatique de véhicule (voir M07).
- **Statuts parc** (VEH007) — énumération `vehicle_status` : `en_commande`, `stock_vn`, `stock_vo`, `depot_vente`, `reserve`, `vendu`, `livre`, `courtoisie`, `demo`, `depot_agent`, `repris` (affiché « Demande de reprise »).
- **Coût de revient** (glossaire, B3) : `PA ou prix de reprise + ORO + frais`, recalculé par `recompute_oro_and_vehicle` à chaque ligne d'ORO (M07). Le champ est **aussi saisissable** dans le formulaire (voir §7).
- **Historique des propriétaires** (VEH003, B9) : table `vehicle_owners` datée (`from_date`, `to_date`, `is_current`). Alimentée par l'import G8, la reprise (vendeur = ancien propriétaire) et lue par My Ducati pour mettre à jour le contact.
- **Bridage A2** : booléen `is_restricted` ; l'attestation de bridage (DOC006) relève de M9.
- **Champ « Marquage (gravage) » retiré** du formulaire (décision client, juin 2026) ; données recopiées dans « Origine » (`20260629140000`), colonne conservée.
- **My Ducati** : pas d'API Ducati. L'extension lit les pages du portail où l'utilisateur est déjà connecté, **aucun identifiant Ducati n'est stocké** ; elle retrouve la moto **par VIN** (elle ne crée pas de moto inconnue) ; les champs de la moto ne sont remplis que s'ils sont vides ; les entretiens et bulletins sont remplacés à chaque import, en conservant les PDF déjà rapatriés.
- **Multi-société** : `company_id` + RLS `is_member` ; suppression réservée à l'administrateur (`vehicles_delete` → `is_admin`). Audit par trigger `audit_row` (B7).

## 5. État en production

Vérifié le 18/09/2026 **dans le code uniquement** (connecteur Supabase non authentifié pendant la session ;
constats base repris du 14/09, `docs/etat-projet.md` §2, et recoupés par `types.ts`, regénéré depuis la base le 11/09
— commit `7d31b6d` — et complété le 18/09, qui ne contient pas la colonne).

| Objet | Migration | Effet réel, d'après le code |
|---|---|---|
| `vehicles.papers_100hp` | `20260716090000_m3_vehicles_papers_100hp` | **Nuance par rapport à `etat-projet.md`** (« aucune fiche véhicule enregistrable ») : depuis le 18/07, `createVehicle`/`updateVehicle` (`src/modules/vehicles/api.ts`, `stripUnknownColumn`) retirent la colonne inconnue signalée par PostgREST et réessaient. La fiche **s'enregistre**, mais la case « Papiers 100 CH » est **perdue sans avertissement**. Le 400 visible dans les journaux est la première tentative. |

Requête de contrôle (lecture seule) :
```sql
select exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='vehicles' and column_name='papers_100hp');
select column_name from information_schema.columns
  where table_schema='public' and table_name='vehicles' and column_name in ('entry_date','sold_date','my_ducati_data','ducati_state');
select to_regclass('public.vehicle_maintenance'), to_regclass('public.vehicle_bulletins'), to_regclass('public.ducati_vds');
```

Présents d'après `types.ts` : `vehicle_maintenance`, `vehicle_bulletins`, `ducati_vin_facts`, `ducati_vds`, `entry_date`/`sold_date`.
Volume annoncé le 14/09 : 3 299 véhicules repris de G8 (`etat-projet.md` §1, non recompté).

Ce qui marche : liste, recherche (y compris par propriétaire), création/modification (hors case 100 CH), décodage VIN, GED, My Ducati (sous réserve que l'extension soit installée sur le poste), matching clients.


> **Vérifié en base le 18/09/2026** (requête sur `information_schema`) : toujours **absents** — `vehicles.papers_100hp`. Les migrations correspondantes du dépôt n'ont jamais été appliquées. Tant qu'elles ne le sont pas, les champs concernés sont perdus sans avertissement.

## 6. Prévu / en cours
- Appliquer `20260716090000_m3_vehicles_papers_100hp` (`etat-projet.md` §7).
- Restes listés dans `docs/avancement.md` (Epic E2) : alerte stock > 4 mois (VEH008), création automatique du véhicule depuis un article V/O/P/D saisi à la main.
- Pas de dossier `docs/missions/` à ce jour.

## 7. Limites connues, dettes, pièges
- **Une vente ne met pas à jour la moto** : aucun code (ni trigger SQL) ne passe le véhicule en `vendu`/`livre` ni ne crée le nouveau propriétaire à la facturation (M6). Le statut et `sold_date` restent manuels. Recherché : aucune écriture sur `vehicles` dans `src/modules/sales/`, aucune `update public.vehicles` dans les migrations hors ORO.
- **Changement de propriétaire** : la section Propriétaires de la fiche reste en lecture seule ; depuis la mission 04, `vehicle_owners` est aussi écrit par « Ajouter une moto » / « Rattacher cette moto existante au client » (fiche client) et par la validation des motos déclarées (tracé `events`). Toujours rien à la vente (M6).
- **`cost_price` modifiable à la main** alors qu'il est censé être calculé (PA + ORO). Une saisie manuelle est écrasée au prochain recalcul ORO, et inversement une saisie après ORO fausse la marge.
- **Pas d'unicité du VIN en base** (simple index `idx_vehicles_vin`) : les nouvelles saisies par l'écran et `vehicle_create_for_contact` refusent un doublon, mais la réception châssis, la reprise et l'import ne passent pas par ce contrôle. 4 VIN en double au 19/09 (liste : mission 04 §5). L'import My Ducati lit la moto par VIN avec `maybeSingle()` et échoue en cas de doublon.
- **Écriture « résiliente » = perte silencieuse** d'un champ non migré (voir §5).
- L'historique des OR atelier (`repair_orders`, M8) n'est pas affiché sur la fiche véhicule : seule la table `documents` l'est. À vérifier si l'OR apparaît ailleurs (recherche globale, M8).
- L'extension dépend des **libellés français** du portail Ducati (Salesforce) : un libellé renommé par Ducati = champ ignoré. Le domaine de l'application doit figurer dans `manifest.json` (`*.netlify.app` couvert).
- `ducati_vds` et `ducati_vin_facts` sont lisibles par tout utilisateur connecté, toutes sociétés confondues (`using (true)`) : c'est voulu (référentiel constructeur), à garder sans données clients.

## 8. Exigences du cahier couvertes

| Code | Libellé court | État | Preuve |
|---|---|---|---|
| VEH000 | Paramétrage standard | ✅ fait | statuts, référentiels de listes |
| VEH001 | Fiche véhicule complète | ✅ fait | `vehicle-form.tsx`, migration `m3_vehicles` |
| VEH002 | Suivi commercial prix/marge/statut | 🟦 partiel | PA, coût de revient, prix affiché, jours en stock ; **pas de marge réalisée** sur la fiche (la marge potentielle est dans l'écran Reprise, M7) |
| VEH003 | Propriétaire actuel + historique | 🟦 partiel | lecture `vehicle_owners` ; création/rattachement depuis la fiche client (mission 04) ; pas de mise à jour à la vente |
| VEH004 | Historique réparations/entretiens | 🟦 partiel | documents liés (`listVehicleDocuments`) + entretiens My Ducati ; OR atelier non affichés (à vérifier) |
| VEH005 | Gestion documentaire par véhicule | ✅ fait | GED sur la fiche, facture d'achat (`purchase-invoice-field.tsx`) |
| VEH006 | Rentabilité par véhicule | 🟦 partiel | uniquement pour les reprises, écran `/tradein/$oroId` (voir M07) ; pas de vue de synthèse par VIN |
| VEH007 | États de gestion du parc | ✅ fait | énum `vehicle_status` + filtre liste |
| VEH008 | Alerte véhicule en stock > 4 mois | ⬜ manquant | `dormant_stock` filtre `mgmt_type = 'A'` (pièces) ; seul le compteur « jours en stock » existe sur la fiche |
| VEH009 | Garantie et conformité | 🟦 partiel | champs garantie + import My Ducati + bulletins ; campagnes de rappel non gérées |
| VEH010 | Migration véhicules G8 | ✅ fait | `src/modules/migration/vehicles-import.ts`, `tools/migration/import_g8.py` (3 299 véhicules annoncés) |
| ATE017 | Recherche par VIN avec historique | 🟦 partiel | recherche globale + fiche ; historique OR incomplet (voir VEH004) |
| B9 | N° de série V/O/P, recherche croisée | 🟦 partiel | VIN + propriétaires + documents ; pas d'unicité du VIN |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-10 | Module Véhicules : fiche VIN parité G8, parc + filtre statut, historique propriétaires, jointure article | `1e99b74`, `20260610170000_m3_vehicles` |
| 2026-06-11 | GED sur la fiche véhicule | `a453fbd` |
| 2026-06-12 | Décodeur VIN Ducati (VDS) + VIN connus | `20260612600000`, `20260612700000` |
| 2026-06-13 | Colonnes My Ducati + tables maintenance/bulletins | `20260613500000`…`700000` |
| 2026-06-29 | Extension My Ducati (import par VIN, bulletins PDF FR, maintenance), page de téléchargement ; formulaire épuré ; recherche par propriétaire ; suivi entrée/sortie/jours + facture d'achat | `7cb0b4c`, `c1708de`, `39902bf`…`97d6d54`, `b425ebf`, `09a2837`, `eb5a6cc`, `20260629140000` |
| 2026-07-18 | Case « Papiers 100 CH » + repli sur colonne inconnue | `f01ee2c`, `20260716090000` (non appliquée au 14/09) |
| 2026-07-26 | Matching client intéressé ↔ moto en stock | `6954757` |
| 2026-09-11 | Retour visuel d'enregistrement, bouton grisé tant que rien ne change | `7f6ce22`, `d24c84f` |
| 2026-09-19 | **Mission 04 carte 7** : « Lire la carte grise » (photo ou PDF) → champs pré-remplis surlignés, photo rangée dans la GED de la moto | branche `lot-m4-moto`, fonction `read-id-doc` redéployée le 19/09 |
| 2026-09-19 | **Mission 04 carte 6** : « Ajouter une moto » depuis la fiche client (propriétaire en une transaction, sans article), codes carte grise sur les libellés, contrôle du VIN, refus d'un doublon + rattachement de la moto existante | branche `lot-m4-moto`, migration `20260919300000_m3_moto_client_depuis_fiche` (appliquée le 19/09) |
