---
chapitre: M8
titre: Atelier & SAV
etat: 🟦
verifie_le: 2026-09-23
missions: []
mots_cles: [OR, ordre de réparation, atelier, garantie, refus partiel, planning, rendez-vous, RDV, chronos, pointeuse, présence, temps passé, mécanicien, véhicule de prêt, moto accidentée, aide réparation Ducati, expert]
---

# M8 — Atelier & SAV

> **En une phrase** : suivre chaque moto qui entre à l'atelier, du rendez-vous jusqu'à la facture, avec la garantie, le temps passé par les mécaniciens et le planning de la semaine.

## 1. À quoi ça sert
Le chef d'atelier, les mécaniciens et le réceptionnaire l'utilisent pour prendre les rendez-vous,
ouvrir l'**ordre de réparation (OR)** d'une moto (client, VIN, kilométrage, travaux demandés,
observations et photos à la réception), y ajouter pièces et main-d'œuvre, gérer la prise en charge
**garantie** (acceptée, refusée en tout ou en partie) et transformer l'OR en facture. Les mécaniciens
pointent leur présence et le temps passé sur chaque OR pour mesurer la productivité (B11).

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Atelier & SAV → liste (`/workshop`) | Les 100 derniers OR de la société, filtre par statut (à faire, en cours, prêt, facturé, annulé), accès planning et pointeuse |
| Atelier → Nouvel OR (`/workshop/new`) | En-tête : client, véhicule (recherche VIN / plaque / modèle), kilométrage, opérateur, type de réparation, travaux demandés, observations à la réception, statut, garantie, expert et date d'expertise (accident) ; lignes pièce / main-d'œuvre / texte avec case « garantie » (prix forcé à 0) ; totaux HT/TVA/TTC ; numéro `OR-` attribué à la création |
| Atelier → fiche OR (`/workshop/$orId`) | Modifier l'OR, **temps passé** (somme des pointages), **transformer en facture** (bloqué tant que la garantie est « en attente »), voir la facture, **aide à la réparation Ducati** pour moto accidentée (remise 15 % si pièces > 1 500 € HT, fichier Excel de commande, e-mail préparé), pièces jointes / photos (GED), **Devis de pièces** (ouvre un devis rattaché à l'OR, case « Devis atelier » cochée, voir M6) |
| Atelier → Planning (`/workshop/planning`) | Vue semaine des rendez-vous, création d'un RDV (client, véhicule, mécanicien, atelier, date, durée, travaux, observations, véhicule de prêt, case « SMS de rappel »), changement de statut (prévu, arrivé, en cours, terminé, annulé), **création de l'OR depuis le RDV** |
| Atelier → Pointeuse (`/workshop/chrono`) | Pointer l'arrivée / le départ, démarrer / arrêter le travail sur un OR ouvert, pointages du jour |
| Atelier → **Plans d'entretien** (`/workshop/maintenance-plans`, mission 07) | Compteurs (plans par usage, échéances, temps en vigueur, **taux horaire HT** ou « À saisir ») ; onglet **Plans** : filtre famille / usage / texte, fiche du plan (modèles, années, usage, liste des contrôles, documents), **modèles du catalogue Ducati rattachés** (état Lié / À valider / Détaché, motif, boutons **Rattacher** / **Détacher**, recherche d'un modèle du catalogue pour rattacher un ou tous ses millésimes), **échéances** (intervalle au premier atteint km ou mois, temps Ducati en vigueur, **main-d'œuvre HT = heures × taux**, opérations, historique des anciennes valeurs avec « remplacé par ») ; bouton **Proposer les rattachements** (relançable) ; onglet **Couverture du catalogue** : modèles-années Europe depuis 2000 sans plan. Rattacher / détacher / proposer : administrateur ou chef d'atelier |
| Rapports (M13) → Productivité atelier | Présence et travail par mécanicien sur la période |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.workshop.tsx` (layout), `src/routes/_app.workshop.index.tsx`, `src/routes/_app.workshop.new.tsx`, `src/routes/_app.workshop.$orId.tsx`, `src/routes/_app.workshop.planning.tsx`, `src/routes/_app.workshop.chrono.tsx` |
| Lecture des OR, recherche véhicule | `src/modules/workshop/api.ts` |
| Écriture OR, garantie, transformation en facture | `src/modules/workshop/write-api.ts` (appelle `createDocument` de `src/modules/sales/write-api.ts`) |
| Éditeur d'OR | `src/modules/workshop/or-editor.tsx` |
| Chronos | `src/modules/workshop/chrono-api.ts` |
| Planning / RDV | `src/modules/workshop/planning-api.ts` |
| Frais de devis atelier (accident / diagnostic) | `src/modules/workshop/quote-fees.ts` (calcul pur), `src/modules/workshop/quote-fees-api.ts` (lecture des paramètres) ; utilisés par `src/modules/sales/document-editor.tsx` |
| Plans d'entretien (mission 07) | `src/modules/workshop/maintenance-plans.ts` (règles pures : premier atteint `nextDue`, valeur en vigueur `pickCurrent`, prix `labourPriceHt`, usage), `maintenance-api.ts`, `maintenance-plans-screen.tsx` (écran), `maintenance-plan-view.tsx` (échéances), `vehicle-maintenance-panel.tsx` (fiche moto) ; route `src/routes/_app.workshop.maintenance-plans.tsx` ; chargeur `tools/maintenance-loader/` (`load.mjs`, `transform.mjs`, `corrections.mjs`) |
| Manuels d'atelier Ducati (mission 07, carte 3) | `src/modules/workshop/wsm-api.ts` (lecture, libellé d'échéance, temps en UT), `wsm-manuals-panel.tsx` (onglet « Manuels d'atelier » de l'écran Plans d'entretien) ; chargeur `tools/wsm-loader/` (`transform.mjs` pur et testé, `load.mjs`, `images.mjs`, `env.mjs`) ; données source dans `Desktop/ducati/manuels-extraits` (hors dépôt) |
| Moto accidentée (aide Ducati 15 %) | `src/modules/workshop/accident-form.ts`, `src/modules/workshop/accident-help-dialog.tsx` |
| Tables plans d'entretien (globales, sans `company_id`, comme le catalogue Ducati) | `maintenance_sources` (30 documents), `maintenance_checklists` (listes des contrôles), `maintenance_plans` (modèle, années, usage, `match_names`, empreinte), `maintenance_plan_services` (échéances), `maintenance_service_intervals` / `_operations` / `_times` (avec source et `status` en_vigueur / historique), `maintenance_plan_catalog_links` (plan ↔ modèle-année du catalogue : lie / a_valider / rejete) ; fonctions `maintenance_ingest`, `maintenance_stats`, `maintenance_hourly_rate_ht`, `maintenance_propose_catalog_links`, `maintenance_link_set`, `maintenance_catalog_coverage` |
| Tables manuels d'atelier (globales, décision M-26) | `wsm_manuals` (469 modèles-années), `wsm_manual_catalog_links` (↔ catalogue : lie / a_valider / rejete), `wsm_services` + `wsm_operations` (programme officiel), `wsm_procedures` **dédupliquées** + `wsm_procedure_usages` + `wsm_procedure_steps` + `wsm_procedure_torques`, `wsm_service_procedures`, `wsm_torque_tables` / `wsm_tool_sets` / `wsm_fluid_tables` / `wsm_product_tables` (lignes en jsonb, lues en bloc), `wsm_times` (UT), `wsm_images` (inventaire et envoi vers le bucket `wsm-images`) ; fonctions `wsm_ingest_procedures`, `wsm_ingest_manuals`, `wsm_ingest_images`, `wsm_propose_catalog_links`, `wsm_link_set`, `wsm_stats`, `wsm_manual_list`, `wsm_manual_overview` |
| Tables | `repair_orders` (en-tête OR, statut, `warranty_status`, expert, totaux, `invoice_document_id`), `repair_order_lines` (lignes `kind` piece/mo/texte, `is_warranty`), `workshop_time_entries` (pointages `presence` / `travail`, `minutes`), `workshop_appointments` (RDV, `loaner_vehicle`, `notify_sms`, `or_id`) ; **en base mais sans écran** : `workshop_operations` (40 opérations types), `repair_order_operations` (checklist cochée sur un OR), `workshop_tasks` (tâches hors facturation) |
| Fonctions SQL (RPC) | `next_document_number` (type `OR`), `or_worked_minutes`, `workshop_productivity` (M13) ; **sans appelant** : `workshop_load` (taux de charge du planning) |
| Fonctions serveur (Edge) | `supabase/functions/dispatch-notifications` (rappels RDV, inactif) |
| Tâches planifiées | `appointment-reminders` (17:00, `_cron_appointment_reminders`), `dispatch-notifications` (toutes les 10 min) |
| Migrations clés | `supabase/migrations/20260610340000_m8_repair_orders.sql`, `…20260610350000_m8_chrono.sql`, `…20260610360000_m8_appointments.sql`, `…20260612250000_m8_workshop_extra.sql`, `…20260612240000_m10_notifications.sql` (rappels) |
| Libellés | `src/lib/i18n/fr.ts`, blocs `workshop`, `accident` |
| Tests | `tests/workshop-totals.test.ts` (2 cas : totaux, ligne garantie à 0), `tests/workshop-quote-fees.test.ts` (frais de devis : 125 €, plafond 4 h, pas de doublon), `tests/maintenance-plans.test.ts` (premier atteint, valeur en vigueur, prix = heures × taux HT), `tests/maintenance-loader.test.ts` (chargeur, extrait réel `tests/fixtures/plans-entretien`) |

## 4. Règles métier et décisions
- **Cycle OR (B8)** : réception (observations, photos en GED) → OR → réparation → transformation en facture via M6. Statuts `a_faire`, `en_cours`, `pret`, `facture`, `annule`. Un OR facturé ne peut plus être re-facturé.
- **Le stock est débité par la facture, pas par l'OR** (B7) : les pièces d'un OR ne bougent le stock réel qu'à la transformation en facture (`transformToInvoice` → `createDocument` FAC validée).
- **Garantie (B10)** : statut `aucune`, `en_attente`, `accepte`, `refus_total`, `refus_partiel`. Une ligne cochée « garantie » passe à prix 0 sur l'OR et sur la facture. **Refus partiel** = on décoche ligne par ligne ce que le client paiera (re-routage manuel). Facturation interdite tant que la garantie est `en_attente` (contrôle dans `write-api.ts` et bouton grisé).
- **Chronos (B11)** : un pointage `presence` (arrivée/départ) et des pointages `travail` rattachés à un OR ; démarrer un nouveau travail clôt le précédent ; minutes calculées à la clôture.
- **Main-d'œuvre = article de type T** (ADR-002, `docs/decisions/ADR-002-type-gestion-T-main-oeuvre.md`) : sur l'OR, la ligne « main-d'œuvre » est un `kind = 'mo'` ; le rapprochement temps passé / temps facturé devait s'appuyer sur ces lignes (non fait, §7).
- **Aide à la réparation Ducati** (note réseau Ducati, backlog DOC-02, commit `9504e36`) : remise supplémentaire de 15 % sur les pièces si le devis pièces dépasse 1 500 € HT (`ACCIDENT_HELP_THRESHOLD_HT`, `ACCIDENT_HELP_DISCOUNT_RATE`). Le dossier est préparé (Excel + `mailto:`), l'envoi reste manuel depuis la messagerie de l'utilisateur.
- **Frais de devis atelier** (mission 02, process-commandes-pieces §1.4, décision M-5) : quand un devis de pièces vient de l'atelier, on ajoute les frais du devis — **accident = 125 € HTVA fixe** ; **diagnostic = tarif horaire de l'atelier × heures, 4 h maximum, sans nouveau devis** (heures modifiables vers le bas seulement). Paramètres par société : Paramètres → Tables → **Frais de devis atelier** (`reference_values`, `table_key = 'workshop_quote_fee'`, codes `accident` : `amount_ht`, `vat_rate` ; `diagnostic` : `hourly_rate_ht`, `max_hours`, `vat_rate`). Aucun tarif horaire n'existait : `hourly_rate_ht = 0` reprend le prix de vente de l'article `MO` (type T), lui-même à 0 en production le 19/09 → **tarif horaire à saisir**. La ligne est une ligne dédiée sans article (pas de mouvement de stock à la facturation).
- **Plans d'entretien** (mission 07, décision M-16) : **échéance au premier atteint** (km ou mois) ; **le document le plus récent fait foi** (la valeur à utiliser est `en_vigueur`, les anciennes restent `historique` avec « remplacé par ») ; plans **route / piste amateur / racing** choisis par l'usage de la moto (route par défaut) ; **prix main-d'œuvre = heures × taux horaire HT**, le taux étant le **même réglage** que le diagnostic des frais de devis (Paramètres → Tables → Frais de devis atelier → `hourly_rate_ht`, repli article `MO`) ; prix vide tant que le taux est à 0. Aucun prix, aucune pièce ni quantité dans les documents Ducati (viendront du catalogue, carte 07-2). Rattachement au catalogue **prudent** : nom exact + millésime dans la plage + un seul plan du même usage = lié d'office ; sinon « à valider ».
- **OR créé depuis un RDV** : l'OR hérite du client, du véhicule, du mécanicien, des travaux et des observations ; le RDV passe `en_cours` et garde le lien `or_id`.

## 5. État en production
Vérifié le 18/09/2026 (code + base).
- **Tous les objets utilisés par le code existent** : `repair_orders`, `repair_order_lines`, `workshop_time_entries`, `workshop_appointments` avec toutes les colonnes écrites (y compris `price_mode` lu à la facturation), fonctions `or_worked_minutes`, `next_document_number`. RLS active et triggers d'audit (`trg_ro_audit`, `trg_rolines_audit`, `trg_appt_audit`, `trg_wte_audit`) présents.
- **Volumes** : 11 OR, 22 lignes, 3 pointages, **0 rendez-vous**. Module utilisable mais peu utilisé.
- **Rappels de RDV inopérants** : la tâche `appointment-reminders` tourne chaque jour (succès en base) et enfilerait un e-mail et un SMS la veille ; `dispatch-notifications` les marque `skipped` faute de clé Resend et de fournisseur SMS.
- **Tables sans écran** : `workshop_operations` (40 lignes), `repair_order_operations`, `workshop_tasks` (0 ligne) et la fonction `workshop_load` existent en base depuis `20260612250000_m8_workshop_extra.sql` (commit `6d7b17a`, qui n'a touché que la migration et `types.ts`) mais **aucun code de `src/` ne les utilise**.
- **Sécurité** : `or_worked_minutes` et `workshop_load` sont exécutables sans être connecté ; `workshop_load` contourne le contrôle de société pour un appel anonyme (`auth.uid() is null or …`). Voir `00-architecture.md` §9.

## 6. Prévu / en cours
- CRM atelier (onglet prévu dans M10, `docs/plan-nouveau-client.md`) : relances et suivi client côté atelier.
- Reste noté dans `docs/avancement.md` (E7) : rapprochement temps facturé (prorata / sélection), notifications SMS / e-mail, devis de réparation PDF.
- En attente client : fournisseur SMS et clé (`etat-projet.md` §8).
- Spécification G8 détaillée : `docs/g8-fonctions-m8-atelier.md`.

## 7. Limites connues, dettes, pièges
- **Réécriture des lignes à chaque enregistrement** : `writeLines` supprime toutes les lignes de l'OR puis les réinsère, sans vérifier l'erreur de la suppression et sans transaction. Une coupure entre les deux laisse un OR vide ; l'audit enregistre des suppressions / insertions à chaque sauvegarde.
- **Transformation en facture non atomique** : facture créée, puis OR passé `facture` dans un second appel ; en cas d'échec du second, l'OR reste facturable une deuxième fois.
- **Garantie = prix 0, pas de cession** : les pièces en garantie sortent du stock via une facture client à 0 €, sans **cession interne de garantie** ni **facture interne à Ducati** (ATE020). Le coût de la garantie n'est donc suivi nulle part.
- **Pas d'impression d'OR** : le libellé `workshop.print` existe mais aucun bouton ; pas de fiche de réception à signer (ATE008).
- **Rappel RDV** : `_cron_appointment_reminders` ignore la case `notify_sms` ; il enfile e-mail **et** SMS pour tout RDV `prevu` du lendemain. À corriger avant de poser les clés d'envoi.
- **Chronos sans rôle** : un pointage est rattaché à l'utilisateur connecté (`mechanic_id`) avec un nom libre ; un poste partagé pointera tout le monde sous le même compte.
- **Productivité** : `workshop_productivity` compare présence et travail, **pas** temps passé et temps facturé (B11 incomplet).
- **Liste limitée à 100 OR**, sans pagination.
- **Pas d'historique OR sur la fiche véhicule** : seules `src/modules/contacts/api.ts` (fiche client) et le module atelier lisent `repair_orders` ; la fiche véhicule (M3) ne liste pas les OR du VIN.

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A (Atelier, 24 exigences).

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| ATE000 | Paramétrage du module | partiel | Séquence `OR-` (M0) ; référentiel d'opérations en base sans écran |
| ATE001 | Prise de RDV en ligne | manquant | RDV saisis en interne seulement (`planning-api.ts`) ; pas de formulaire public |
| ATE002 | Planning visuel avec capacité par mécanicien | partiel | Vue semaine ; `workshop_load` (capacité) non branché |
| ATE003 | Synchro Outlook ↔ planning | manquant | Graph utilisé pour les mails seulement (M10) |
| ATE004 | Lien RDV → client → véhicule → intervention | fait | `workshop_appointments.contact_id / vehicle_id / or_id`, `createOrFromAppointment` |
| ATE005 | Motos de courtoisie | partiel | Champ texte `loaner_vehicle` sur le RDV ; statut véhicule `courtoisie` (M3) ; pas de suivi de prêt |
| ATE006 | Rappels RDV e-mail et SMS | partiel | `_cron_appointment_reminders` + file ; aucun envoi réel (clés absentes) |
| ATE007 | Photos à la réception | fait | `AttachmentsPanel` entité `repair_order` sur la fiche OR |
| ATE008 | Signature client sur l'OR + envoi | manquant | Pas d'impression ni de signature d'OR |
| ATE009 | Devis complémentaire avec accord client | manquant | Aucun workflow de devis sur l'OR |
| ATE010 | États personnalisés et codes couleur | partiel | 5 statuts fixes avec badge couleur + icône ; non paramétrables |
| ATE011 | Checklists par type de véhicule | partiel | Tables `workshop_operations` / `repair_order_operations` en base, sans écran |
| ATE012 | Notes internes non visibles du client | partiel | Colonne `repair_orders.notes` en base, non exposée par l'éditeur (`or-editor.tsx` ne gère que `reception_notes`) |
| ATE013 | Kits / combos de pièces | manquant (M2) | Type N (composant de forfait) défini en B1, pas d'insertion de kit sur l'OR |
| ATE014 | Nomenclatures d'entretien auto (modèle + km) | partiel (21/09) | Plans d'entretien par modèle / années / usage avec échéances, opérations et temps (mission 07 carte 1) ; reste le prochain entretien de chaque moto (07-4) et les forfaits avec pièces (07-2) |
| ATE015 | Pointage du temps par intervention | fait | `chrono-api.ts`, `/workshop/chrono` |
| ATE016 | Suivi garantie Ducati / magasin | partiel | `warranty_status` + lignes garantie ; pas de distinction Ducati / magasin ni de dossier de garantie |
| ATE017 | Recherche VIN avec tout l'historique | partiel | Recherche VIN globale (M0) et sur l'OR ; historique des OR absent de la fiche véhicule |
| ATE018 | Notification de fin de travaux programmable | manquant | Pas de déclencheur au passage `pret` |
| ATE019 | Tableau de bord productivité par mécanicien | partiel (M13) | Présence / travail ; pas de temps facturé |
| ATE020 | Facturation interne garantie et productivité | manquant | Voir §7 |
| ATE021 | Planification des essais démo | manquant | — |
| ATE022 | Parc de motos prêtées et démo | partiel (M3) | Statuts véhicule `demo` / `courtoisie` |
| ATE023 | Accès rapide aux accessoires en stock (upselling) | partiel | Recherche d'articles dans l'éditeur d'OR (`searchSaleArticles`), sans stock affiché |

Invariants : **B8** fait (cycle complet, facture via M6) ; **B10** partiel (acceptation / refus total / refus partiel ligne par ligne, sans cession garantie) ; **B11** partiel (présence et travail pointés, rapprochement avec le temps facturé absent).

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | OR (cycle B8) + garantie B10 avec refus partiel, transformation en facture | `65216de`, `20260610340000_m8_repair_orders.sql` |
| 2026-06-11 | Chronos B11 (pointeuse) | `95b0085`, `20260610350000_m8_chrono.sql` |
| 2026-06-11 | Planning / RDV, création d'OR depuis le RDV | `3e973a6`, `20260610360000_m8_appointments.sql` |
| 2026-06-11 | Photos de réception (GED sur l'OR) | `a453fbd` |
| 2026-06-12 | Rappels RDV planifiés (file de notifications) | `20260612240000_m10_notifications.sql` |
| 2026-06-12 | Opérations atelier, tâches hors facturation, taux de charge (base seulement) | `6d7b17a`, `20260612250000_m8_workshop_extra.sql` |
| 2026-07-26 | Moto accidentée + programme d'aide Ducati 15 % | `9504e36` |
| 2026-07-26 | Fil d'Ariane et boutons collants | `8f59518` |
| 2026-09-11 | Correction du type `OrPayload` (import cassé depuis l'origine) et typage | `c1dd2b7` |
| 2026-09-19 | Frais de devis atelier : accident 125 €, diagnostic au tarif horaire (4 h max), bouton « Devis de pièces » sur l'OR (mission 02) | `20260919230000_m8_frais_devis_atelier.sql` |
| 2026-09-21 | **Plans d'entretien par modèle et par année** (mission 07 carte 1, ATE014) : tables, chargeur, écran Atelier → Plans d'entretien, rattachement au catalogue Ducati, plan sur la fiche moto | `20260921130000_m8_plans_entretien.sql`, `20260921131000_m8_plans_entretien_catalogue.sql` (appliquées le 21/09) |
| 2026-09-23 | **Manuels d'atelier Ducati** (mission 07 carte 3, ATE014) : 15 tables `wsm_*`, chargeur `tools/wsm-loader`, onglet « Manuels d'atelier », rattachement au catalogue (426 fermes / 9 à valider / 34 sans correspondance sur 469) | `20260923100000_m8_manuels_atelier.sql`, `20260923101000_m8_manuels_atelier_chargement.sql` (**non appliquées**) |
