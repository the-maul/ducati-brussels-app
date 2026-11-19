---
chapitre: M8
titre: Atelier & SAV
etat: 🟦
verifie_le: 2026-11-19
missions: [07]
mots_cles: [check-up, proposition d'intervention, accord client, signature, accord verbal, interventions reportées, motif d'entrée, OR, ordre de réparation, atelier, garantie, refus partiel, planning, rendez-vous, RDV, chronos, pointeuse, présence, temps passé, mécanicien, code mécano, tâche improductive, gestion du temps atelier, contrôle du temps atelier, heures facturées, heures internes, heures garanties, productivité, rendement, facture unique, véhicule de prêt, moto accidentée, aide réparation Ducati, expert, kit, forfait d'entretien, famille de moteur, picking list, liste de préparation, commander les pièces, prochain entretien, échéance, extract DCS, relances d'entretien]
mots_cles: [compagnon, liste d'attente, RDV en attente, capacité, taux d'occupation, jours fériés, absences, moto de prêt, contrat de prêt, check-up, proposition d'intervention, accord client, signature, accord verbal, interventions reportées, motif d'entrée, OR, ordre de réparation, atelier, garantie, refus partiel, planning, rendez-vous, RDV, chronos, pointeuse, présence, temps passé, mécanicien, véhicule de prêt, moto accidentée, aide réparation Ducati, expert, kit, forfait d'entretien, famille de moteur, picking list, liste de préparation, commander les pièces, prochain entretien, échéance, extract DCS, relances d'entretien]
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
| Atelier & SAV → liste (`/workshop`) | **Depuis le 18/11** : vues OR / devis de réparation / OR garantie / OR accident, recherche n° / immat / client / châssis, filtres statut / période / opérateur / type, 50 par page, export Excel (voir « Ajouté le 18/11 ») ; accès planning et pointeuse |
| Atelier → Nouvel OR (`/workshop/new`) | En-tête (ordre du 03/11, ATE001b) : client, véhicule (motos du client en tête), kilométrage, **motif d'entrée**, **type de réparation** (liste réglable Paramètres → Tables → Types de réparation, pré-remplie par le motif : entretien, accident, pneus, freins → réparation, diagnostic ; « garantie » laissée au choix Ducati / magasin), **opérateur** (liste de l'équipe : mécaniciens, chef d'atelier, administrateurs ; l'utilisateur connecté par défaut ; ancien texte gardé « (ancienne saisie) »), statut, **prise en charge garantie seulement pour un OR garantie**, **expert et date d'expert seulement pour un accident** (toujours visibles s'ils sont déjà remplis), travaux demandés, observations à la réception ; **OR accident → dossier accident ouvert en brouillon à l'enregistrement** (lié à l'OR, au client, à la moto) ; lignes : recherche d'article partagée avec les ventes (liste en surcouche, flèches / Entrée / Échap, 20 résultats, référence exacte d'abord, en stock d'abord, stock + casier + PV HT), **PU HT = PV HT de l'article (déduit du TTC s'il manque), TVA de l'article, remise du client (Tarifs clients)**, ligne main-d'œuvre = taux horaire atelier ; lignes pièce / main-d'œuvre / texte avec case « garantie » (prix forcé à 0) ; totaux HT/TVA/TTC ; numéro `OR-` attribué à la création |
| Atelier → fiche OR (`/workshop/$orId`), onglet **Check-up** (31/10, ATE008 / ATE009, pensé tablette) | **Motif d'entrée** (Paramètres → Tables → Motifs d'entrée atelier ; un motif « entretien » pré-remplit les actions du plan d'entretien de la moto : temps Ducati en vigueur × taux horaire + pièces du kit) ; une **colonne de grandes cartes**, une par action : libellé, état **OK / à faire / à prévoir** (couleur + icône + libellé), **photo** (appareil ou galerie, rangée dans la GED de l'OR, dossier « Check-up »), temps (proposé par le plan, sinon saisi, heures décimales), pièces (recherche dans les articles), prix calculé (MO = heures × taux horaire HT des frais de devis atelier, pièces = PV) ; **« + Constat »** ; total des actions proposées toujours visible en bas ; **« Envoyer la proposition »** (devis « Proposition d'intervention » relié à l'OR, mail dans la langue du client avec le lien de signature, visible dans l'espace client) ; en tête de l'OR, **« Accord client »** en grand : signé le … par … / **EN ATTENTE** / accord verbal le … par … (téléphone) ; boutons **« Faire signer sur la tablette »** (même écran que le lien du client, signature au doigt), **« Accord verbal »** (qui, quand, canal, note → `events`), « Voir la proposition », « Renvoyer » ; tant que l'accord est en attente, bandeau et boutons « Démarrer le parcours » / pointeuse grisés |
| Atelier → fiche OR (`/workshop/$orId`) | Modifier l'OR, **temps passé** (somme des pointages), **transformer en facture** (bloqué tant que la garantie est « en attente » ; depuis le 31/10, si la moto a des **interventions reportées** « à planifier », une étape **« Date pour les interventions reportées »** propose une date — +30 jours par défaut, modifiable — ou « pas maintenant », avant la facture), voir la facture, **« Ouvrir un dossier accident »** (03/11 : fiche, photos, devis lié, formulaire Ducati, mail à Ducati — voir ligne suivante), pièces jointes / photos (GED), **Devis de pièces** (ouvre un devis rattaché à l'OR, case « Devis atelier » cochée, voir M6), **Créer la picking list** (kit d'entretien de l'échéance + pièces ajoutées par le technicien, mission 07 carte 2), **Commander les pièces manquantes** (avec choix du type de commande) |
| Atelier → **Dossiers accident** (`/workshop/accidents`, `/workshop/accidents/$fileId`, 03/11, mission 09 carte 5) | Liste des dossiers (moto / VIN, client, devis, statut couleur + icône + libellé, envoyé le) ; fiche : moto / VIN / client, assurance, n° de sinistre, expert, **urgence + note** ; **devis lié** (devis existant de la moto ou « Créer un devis » ; total HT, dont pièces, **sous 1 500 € HTVA : « passe en commande standard »**, sinon remise prévue 15 % des pièces) ; **photos** (appareil / galerie, plusieurs, légende, **« Photo du châssis »** obligatoire) ; rapport de l'expert (PDF, facultatif) ; **« Générer le formulaire »** Excel Ducati (modèle rempli, téléchargé, conservé) ; checklist **« Dossier complet ? »** ; **« Envoyer le dossier »** (grisé tant que la checklist a un ✗) → fenêtre Outlook : boîte, destinataire `technique.dwe@ducati.com`, copie vide, objet / corps pré-remplis, 4 pièces jointes, « Vérifier sans envoyer » ; après envoi : statut Envoyé, date / destinataires, « Renvoyer », statuts suivants (accordé, pièces reçues, réparé, clos) ; panneau GED du dossier |
| Atelier → Planning (`/workshop/planning`) | Vue semaine des rendez-vous, création d'un RDV (client, véhicule, mécanicien, atelier, date, durée, travaux, observations, véhicule de prêt, case « SMS de rappel »), changement de statut (prévu, arrivé, en cours, terminé, annulé), **création de l'OR depuis le RDV** |
| Atelier → Pointeuse (`/workshop/chrono`) | Pointer l'arrivée / le départ, démarrer / arrêter le travail sur un OR ouvert, pointages du jour ; **18/11 (rattrapage G8)** : **code mécano** scanné ou tapé (poste partagé), **scan du n° d'OR**, **tâches improductives** (nettoyage atelier, nettoyage motos, entrée / sortie motos expo), tableau « Atelier maintenant » (présent depuis, travail en cours) ; onglet **Productivité atelier** (voir §4) |
| Atelier → Planning (`/workshop/planning`) | **Depuis le 18/11 (rattrapage G8, migration à appliquer)** : quatre vues — **Réception** (semaine du mardi au samedi par défaut, temps prévu / capacité et **taux d'occupation** par jour, fériés et fermetures, filtre compagnon, légende des statuts cochable), **Activité** (une colonne par compagnon, une ligne par créneau de 10 min, pauses / absences grisées, **liste d'attente** et **glisser-déposer**), **Motos de prêt** (disponibilité 14 jours, prêts, sortie / retour avec km et carburant, **contrat imprimable**), **Réglages** (compagnons reliés à l'équipe, horaires matin / après-midi, paramètres, calendrier) ; « Assistant planification » (statut, type de RDV, sans affectation, compagnon, temps prévu, km, moto de prêt), **Rechercher RDV** (client, immatriculation, châssis), **Valider RDV et saisie OR** (temps prévu obligatoire). Avant la migration : ancienne vue semaine (mécanicien en texte libre) |
| Atelier → Pointeuse (`/workshop/chrono`) | Pointer l'arrivée / le départ, démarrer / arrêter le travail sur un OR ouvert, pointages du jour |
| Atelier → **Plans d'entretien** (`/workshop/maintenance-plans`, mission 07) | Compteurs (plans par usage, échéances, temps en vigueur, **taux horaire HT** ou « À saisir ») ; onglet **Plans** : filtre famille / usage / texte, fiche du plan (modèles, années, usage, liste des contrôles, documents), **modèles du catalogue Ducati rattachés** (état Lié / À valider / Détaché, motif, boutons **Rattacher** / **Détacher**, recherche d'un modèle du catalogue pour rattacher un ou tous ses millésimes), **échéances** (intervalle au premier atteint km ou mois, temps Ducati en vigueur, **main-d'œuvre HT = heures × taux**, opérations, historique des anciennes valeurs avec « remplacé par ») ; bouton **Proposer les rattachements** (relançable) ; onglet **Couverture du catalogue** : modèles-années Europe depuis 2000 sans plan. Rattacher / détacher / proposer : administrateur ou chef d'atelier |
| Atelier → Plans d'entretien → onglet **Extract DCS** (mission 07 carte 4, 31/10) | **Importer l'extract DCS** « ENTRETIEN EN RETARD 180 JOURS + 6 MOIS A VENIR » (feuille Export) : choisir le fichier, **Vérifier** (essai à blanc : lignes lues, doublons, motos connues / inconnues avec les VIN inconnus, lignes déjà importées, propriétaires avec e-mail), **Importer** (relançable sans doublon) ; extracts déjà importés ; **Recalculer toutes les motos**. Administrateur ou chef d'atelier |
| Atelier → **Kits d'entretien** (`/workshop/kits`, mission 07 carte 2) | La liste des kits **famille de moteur × échéance** (type d'entretien, source manuel / plan / règle, pièces, lignes « à plusieurs réf. », besoins absents, modèles-années servis, version ; filtre « Plusieurs références ») ; bouton **Proposer les kits** (tout le parc par lots, barre d'avancement, 03/11) ; provenance de chaque ligne ; contenu d'un kit avec référence, quantité, **casier**, disponible et « en commande » ; **ajouter** une pièce (recherche référence / désignation / code-barres), **changer une quantité**, **retirer** une ligne — chaque correction crée une version |
| Rapports (M13) → Productivité atelier | Présence et travail par mécanicien sur la période ; lien vers la productivité complète (Pointeuse → onglet Productivité atelier, 18/11) |
| Fiche OR → ligne main-d'œuvre → **horloge** (18/11) | Fenêtre **« Gestion du temps atelier »** : mécanicien, heures facturées (= quantité), passées, internes, garanties, date des travaux |
| Fiche OR → **Transformer en facture** → **« Contrôle du temps atelier »** (18/11) | Récapitulatif par ligne MO modifiable, rapprochement facturé / passé / pointé, puis facture (quantité MO = heures facturées) |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.workshop.tsx` (layout), `src/routes/_app.workshop.index.tsx`, `src/routes/_app.workshop.new.tsx`, `src/routes/_app.workshop.$orId.tsx`, `src/routes/_app.workshop.planning.tsx`, `src/routes/_app.workshop.chrono.tsx` |
| Lecture des OR, recherche véhicule | `src/modules/workshop/api.ts` |
| Écriture OR, garantie, transformation en facture | `src/modules/workshop/write-api.ts` (appelle `createDocument` de `src/modules/sales/write-api.ts`) |
| Éditeur d'OR | `src/modules/workshop/or-editor.tsx` (onglets « Fiche et lignes » / « Check-up », motif d'entrée) ; page OR (03/11) : `or-page-rules.ts` (opérateur par défaut, type de réparation, champs conditionnels, accident → dossier), `or-page-api.ts` (équipe, types, `ensureAccidentFileForOr`) ; recherche d'article des lignes `src/modules/sales/article-line-picker.tsx` (partagée avec les ventes), prix `src/modules/sales/article-price.ts` |
| Check-up, proposition, accord client, interventions reportées (31/10, ATE008 / ATE009) | `src/modules/workshop/checkup/rules.ts` (règles pures : prix d'une carte, cartes ↔ lignes de l'OR par `checkup_key`, partition gardées / reportées, texte accepté + SHA-256, garde-fou `canStartWork`, date +30 j, choix de l'échéance selon le motif), `checkup/api.ts` (motifs, photos GED, pré-remplissage plan + kit, `proposal_create_from_or`, `proposal_sign_link`, accord verbal, `deferred_interventions`, lecture silencieuse de `vehicle_maintenance_due`), `checkup/checkup-tab.tsx` (cartes tablette), `checkup/approval-panel.tsx` (accord client, fenêtre accord verbal), `checkup/deferred.tsx` (étape de facturation, encadré fiche moto / onglet fiche client) ; écran de signature : M09 (`src/modules/documents/proposal-sign*`), route publique `src/routes/signer.$token.tsx` ; fonction serveur `supabase/functions/proposal-sign` |
| Chronos | `src/modules/workshop/chrono-api.ts` (18/11 : `MechanicRef` code mécano, `startTask` tâche improductive) |
| **Temps MO, contrôle du temps, productivité** (18/11, rattrapage G8) | `src/modules/workshop/labour-time/rules.ts` (règles pures : fenêtre G8, quantité facturée, lignes du contrôle, rapprochement, productivité par mécanicien / jour / semaine / mois, total, grille Excel, tableau atelier, scan code mécano / n° d'OR), `labour-time/api.ts` (sonde de schéma, codes mécano, tâches, RPC), `labour-time/time-dialog.tsx`, `labour-time/time-control-dialog.tsx`, `labour-time/productivity-panel.tsx` ; écrans `or-editor.tsx`, `_app.workshop.$orId.tsx`, `_app.workshop.chrono.tsx` ; tests `tests/workshop-temps-mo.test.ts`, essai à blanc `supabase/tests/m8_temps_mo.sql` |
| Planning / RDV | `src/modules/workshop/planning-api.ts` |
| Chronos | `src/modules/workshop/chrono-api.ts` |
| Planning / RDV | `src/modules/workshop/planning-api.ts` (ancien planning, avant migration) ; **18/11** : `src/modules/workshop/planning/` — `rules.ts` (règles pures : statuts alignés sur l'OR, fériés belges, capacité, taux d'occupation, créneaux, glisser-déposer, liste d'attente, temps prévu), `api.ts` (compagnons, horaires, réglages, calendrier, RDV, recherche, RDV → OR), `planning-data.ts`, `planning-screen.tsx`, `reception-view.tsx`, `activity-view.tsx`, `appointment-dialog.tsx`, `search-dialog.tsx`, `settings-view.tsx`, `status-icon.ts`, `ui-bits.tsx` ; motos de prêt `src/modules/workshop/loans/` (`rules.ts`, `api.ts`, `loans-view.tsx`, `contract-print.ts`) |
| Frais de devis atelier (accident / diagnostic) | `src/modules/workshop/quote-fees.ts` (calcul pur), `src/modules/workshop/quote-fees-api.ts` (lecture des paramètres) ; utilisés par `src/modules/sales/document-editor.tsx` |
| Kits d'entretien (mission 07, carte 2) | `src/modules/workshop/kits/rules.ts` (règles pures : déduction du besoin, résolution dans le catalogue, quantités, famille de moteur, manquant), `kits/api.ts`, `kits/kits-screen.tsx` (écran Kits d'entretien), `kits/order-from-workshop-dialog.tsx` (commander les manquantes avec choix du type) ; route `src/routes/_app.workshop.kits.tsx` ; boutons sur `src/routes/_app.workshop.$orId.tsx`, `src/modules/workshop/journey/journey-screen.tsx` et `src/modules/sales/picking-actions.tsx` |
| Tables et fonctions des kits (mission 07, carte 2) | **Règles globales** (sans `company_id`, comme `maintenance_*`) : `maintenance_part_families`, `maintenance_part_need_rules`, `maintenance_part_catalog_rules`, `maintenance_fluid_rules`, vue `wsm_service_operation_labels` ; fonctions `maintenance_deduce_parts`, `maintenance_engine_family_key`, `maintenance_parts_coverage`. **Kits de la société** (`company_id` + RLS) : `maintenance_kits`, `maintenance_kit_items`, `maintenance_kit_model_years`, `maintenance_kit_versions`, `maintenance_fluid_articles` ; fonctions `maintenance_kit_generate`, `maintenance_kits_list`, `maintenance_kit_detail`, `maintenance_kit_for_model_year`, `maintenance_kit_item_save`, `maintenance_kit_item_delete`, `maintenance_fluid_article_set`. **Préparation et commande** : `picking_lists.repair_order_id`, `part_orders.repair_order_id`, fonctions `_repair_order_service`, `picking_open_for_repair_order`, `repair_order_order_needs`, `picking_order_needs`, `part_order_create_for_workshop` |
| Plans d'entretien (mission 07) | `src/modules/workshop/maintenance-plans.ts` (règles pures : premier atteint `nextDue`, valeur en vigueur `pickCurrent`, prix `labourPriceHt`, usage), `maintenance-api.ts`, `maintenance-plans-screen.tsx` (écran), `maintenance-plan-view.tsx` (échéances), `vehicle-maintenance-panel.tsx` (fiche moto) ; route `src/routes/_app.workshop.maintenance-plans.tsx` ; chargeur `tools/maintenance-loader/` (`load.mjs`, `transform.mjs`, `corrections.mjs`) |
| Manuels d'atelier Ducati (mission 07, carte 3) | `src/modules/workshop/wsm-api.ts` (lecture, libellé d'échéance, temps en UT), `wsm-manuals-panel.tsx` (onglet « Manuels d'atelier » de l'écran Plans d'entretien) ; chargeur `tools/wsm-loader/` (`transform.mjs` pur et testé, `load.mjs`, `images.mjs`, `env.mjs`) ; données source dans `Desktop/ducati/manuels-extraits` (hors dépôt) |
| Prochain entretien de chaque moto (mission 07, cartes 4 et 5, 31/10) | `src/modules/workshop/maintenance-due.ts` (règles pures : libellé d'entretien, type DCS, + 12 mois / + 6 mois, plan seul, premier atteint, parseur de la feuille Export, dédoublonnage), `maintenance-due-api.ts` (échéance, recalcul, lots, import DCS), `vehicle-next-service-panel.tsx` (encadré fiche moto), `dcs-import-panel.tsx` (onglet Extract DCS) ; composant partagé `src/components/service-declaration-fields.tsx` ; scripts `tools/migration/import_dcs_entretiens.py`, `tools/migration/recalculer_entretiens.py` |
| Tables et fonctions du prochain entretien (migration `20261031100000`, **non appliquée**) | `vehicle_maintenance_due` (`kind` first_1000 / oil / annual / km, `due_date`, `due_km`, `source` or_dms / invoice_g8 / client / dcs_extract / plan, `source_ref`, `is_current`), `dcs_maintenance_imports` ; `vehicles.last_service_at / last_service_km / last_service_where / declared_km / declared_km_at` ; fonctions `maintenance_label_is_service`, `vehicle_maintenance_recompute`, `vehicle_maintenance_recompute_batch`, **`vehicles_maintenance_upcoming(_company, _days)`** (lue par la page Relances M10, colonnes figées), `dcs_maintenance_import`, `dcs_maintenance_import_files`, `portal_vehicle_service_declare`, `portal_declaration_service_set` ; déclencheurs `trg_vehicles_maintenance_due`, `trg_repair_orders_maintenance_due`, `trg_declared_vehicle_service_copy` |
| **Dossiers accident** (mission 09 carte 5, 03/11) | `src/modules/workshop/accident/rules.ts` (règles pures : seuil 1 500 € HTVA, remise 15 % des pièces, checklist, objet / corps du mail, statuts, cellules du formulaire Ducati et remplissage du XML de la feuille), `form-xlsx.ts` (modèle `public/modeles/formulaire-commande-moto-accidentee.xlsx` rempli via fflate), `photos-pdf.ts` (jsPDF, une photo par page), `api.ts` (tables, photos GED, devis de la moto, paramètres mail), `send.ts` (4 pièces jointes + `graph-send-email`), `accident-file-screen.tsx`, `accident-photos.tsx`, `accident-send-dialog.tsx`, `accident-files-list.tsx` ; routes `_app.workshop.accidents.index.tsx`, `_app.workshop.accidents.$fileId.tsx` ; boutons sur `_app.workshop.$orId.tsx` et `_app.sales.$documentId.tsx` (devis) |
| Tables plans d'entretien (globales, sans `company_id`, comme le catalogue Ducati) | `maintenance_sources` (30 documents), `maintenance_checklists` (listes des contrôles), `maintenance_plans` (modèle, années, usage, `match_names`, empreinte), `maintenance_plan_services` (échéances), `maintenance_service_intervals` / `_operations` / `_times` (avec source et `status` en_vigueur / historique), `maintenance_plan_catalog_links` (plan ↔ modèle-année du catalogue : lie / a_valider / rejete) ; fonctions `maintenance_ingest`, `maintenance_stats`, `maintenance_hourly_rate_ht`, `maintenance_propose_catalog_links`, `maintenance_link_set`, `maintenance_catalog_coverage` |
| Tables manuels d'atelier (globales, décision M-26) | `wsm_manuals` (469 modèles-années), `wsm_manual_catalog_links` (↔ catalogue : lie / a_valider / rejete), `wsm_services` + `wsm_operations` (programme officiel), `wsm_procedures` **dédupliquées** + `wsm_procedure_usages` + `wsm_procedure_steps` + `wsm_procedure_torques`, `wsm_service_procedures`, `wsm_torque_tables` / `wsm_tool_sets` / `wsm_fluid_tables` / `wsm_product_tables` (lignes en jsonb, lues en bloc), `wsm_times` (UT), `wsm_images` (inventaire et envoi vers le bucket `wsm-images`) ; fonctions `wsm_ingest_procedures`, `wsm_ingest_manuals`, `wsm_ingest_images`, `wsm_propose_catalog_links`, `wsm_link_set`, `wsm_stats`, `wsm_manual_list`, `wsm_manual_overview` |
| Tables | `repair_orders` (en-tête OR, statut, `warranty_status`, expert, totaux, `invoice_document_id` ; **31/10** : `reason_code`, `customer_approval` en_attente / signe / accord_verbal / refuse, `approval_at` / `approval_by` / `approval_by_name` / `approval_channel` / `approval_note`, `proposal_document_id`), `repair_order_lines` (lignes `kind` piece/mo/texte, `is_warranty` ; **31/10** : `checkup_key`, `checkup_state` ok / a_faire / a_prevoir / reporte, `photo_path`, `proposal_line_id`), **`deferred_interventions`** (31/10 : `id`, `company_id`, `vehicle_id`, `contact_id`, `repair_order_id`, `document_id`, `document_line_id`, `label`, `amount_ttc`, `planned_date`, `status` a_planifier / planifie / relance / fait / abandonne, `created_at`, `updated_at` ; RLS `is_member` ; **lue par l'agent « relances marketing » : ne pas renommer ces colonnes**), `workshop_time_entries` (pointages `presence` / `travail`, `minutes`), `workshop_appointments` (RDV, `loaner_vehicle`, `notify_sms`, `or_id`) ; **en base mais sans écran** : `workshop_operations` (40 opérations types), `repair_order_operations` (checklist cochée sur un OR), `workshop_tasks` (tâches hors facturation) |
| Fonctions SQL (RPC) | `next_document_number` (type `OR`), `or_worked_minutes`, `workshop_productivity` (M13) ; **31/10** : `repair_order_write_lines` (lignes réécrites en une transaction), `proposal_create_from_or`, `proposal_sign_link`, `repair_order_verbal_approval`, `portal_proposals` (espace client), et pour la fonction serveur seulement `proposal_by_token`, `proposal_apply_signature` ; **sans appelant** : `workshop_load` (taux de charge du planning) |
| Fonctions serveur (Edge) | `supabase/functions/dispatch-notifications` (rappels RDV, inactif) ; **`supabase/functions/proposal-sign`** (31/10 : lecture par jeton, signature, archivage du PDF signé et mail au client — à déployer) |
| Tâches planifiées | `appointment-reminders` (17:00, `_cron_appointment_reminders`), `dispatch-notifications` (toutes les 10 min) |
| Migrations clés | `supabase/migrations/20260610340000_m8_repair_orders.sql`, `…20260610350000_m8_chrono.sql`, `…20260610360000_m8_appointments.sql`, `…20260612250000_m8_workshop_extra.sql`, `…20260612240000_m10_notifications.sql` (rappels) |
| Libellés | `src/lib/i18n/{fr,nl,en,it}.ts`, blocs `workshop`, `accident` (ancienne fenêtre, clés conservées), **`accidentFile`** (03/11), `kits`, `workshopOrder`, **`checkup`** (31/10), `notif.proposal*`, `portal.proposals` |
| Tables dossiers accident (migration `20261103110000`, **non appliquée**) | `accident_files` (fiche, `quote_document_id`, `is_urgent` / `urgent_note`, `status`, `sent_at` / `sent_to` / `sent_cc` / `mail_subject`, `form_path` / `photos_pdf_path` / `vin_photo_path` / `expert_report_path`, RLS `is_member`, audit `audit_row`), `accident_file_photos` (`path`, `caption`, `is_vin` unique par dossier, `taken_at`, `sort`) ; paramètre `reference_values` `accident_file_mail` (`to` préchargé = technique.dwe@ducati.com) |
| Tests | **`tests/workshop-accident-file.test.ts`** (03/11 : cellules du formulaire C4 / C5 / blocs B-I-P, 39 lignes par bloc, débordement, XML de la feuille, vrai modèle Ducati rempli sans toucher au reste de l'archive, lignes pièces seulement, seuil 1 500 €, remise 15 %, checklist, objet et corps du mail, copie Graph, noms des pièces jointes, statuts), **`tests/workshop-checkup.test.ts`** (31/10 : prix d'une carte MO + pièces, total du check-up, cartes ↔ lignes, lignes facturables, partition gardées / reportées, création des reportées, texte accepté et SHA-256, garde-fou, date +30 j, échéance selon le motif, lien cliquable du mail), `tests/maintenance-due.test.ts` (40 cas : règle Ducati + 12 / + 6 mois, plan seul, premier atteint, 23 libellés réels, parseur DCS, dédoublonnage), `tests/maintenance-kits.test.ts` (28 cas : déduction du besoin, faux amis du catalogue, quantités 2/2/4 bougies, courroies « toutes nécessaires » vs filtres « variantes », famille de moteur, picking list, manquant, type DCS), `tests/workshop-totals.test.ts` (2 cas : totaux, ligne garantie à 0), `tests/workshop-quote-fees.test.ts` (frais de devis : 125 €, plafond 4 h, pas de doublon), `tests/maintenance-plans.test.ts` (premier atteint, valeur en vigueur, prix = heures × taux HT), `tests/maintenance-loader.test.ts` (chargeur, extrait réel `tests/fixtures/plans-entretien`) |

## 4. Règles métier et décisions
- **Cycle OR (B8)** : réception (observations, photos en GED) → OR → réparation → transformation en facture via M6. Statuts `a_faire`, `attente_devis`, `attente_pieces`, `en_cours`, `pret`, `client_informe` (G8, 18/11), `facture`, `annule`. Un OR facturé ne peut plus être re-facturé.
- **Le stock est débité par la facture, pas par l'OR** (B7) : les pièces d'un OR ne bougent le stock réel qu'à la transformation en facture (`transformToInvoice` → `createDocument` FAC validée).
- **Garantie (B10)** : statut `aucune`, `en_attente`, `accepte`, `refus_total`, `refus_partiel`. Une ligne cochée « garantie » passe à prix 0 sur l'OR et sur la facture. **Refus partiel** = on décoche ligne par ligne ce que le client paiera (re-routage manuel). Facturation interdite tant que la garantie est `en_attente` (contrôle dans `write-api.ts` et bouton grisé).
- **Chronos (B11)** : un pointage `presence` (arrivée/départ) et des pointages `travail` rattachés à un OR ; démarrer un nouveau travail clôt le précédent ; minutes calculées à la clôture.
- **Main-d'œuvre = article de type T** (ADR-002, `docs/decisions/ADR-002-type-gestion-T-main-oeuvre.md`) : sur l'OR, la ligne « main-d'œuvre » est un `kind = 'mo'` ; le rapprochement temps passé / temps facturé devait s'appuyer sur ces lignes (non fait, §7).
- **Dossier accident = aide à la réparation Ducati** (mission 09 carte 5, 03/11/2026, M-83 ; remplace la fenêtre « Aide réparation Ducati » du commit `9504e36`) : **un dossier part complet ou ne part pas**. Complet = devis du DMS lié, formulaire Excel « Aide Réparation Moto Accidentée » généré depuis ses lignes pièces (dans le modèle Ducati lui-même), **≥ 4 photos** avant réparation, **une photo du n° de châssis gravé**, devis **≥ 1 500 € HTVA** (`ACCIDENT_FILE_MIN_HT` ; en dessous : commande standard, bouton « Envoyer » grisé). Remise prévue = 15 % des pièces (`ACCIDENT_FILE_DISCOUNT_RATE`), affichée sur la fiche. L'envoi est un **mail Outlook** (`graph-send-email`, boîte partagée ou adresse de l'utilisateur) à `technique.dwe@ducati.com` (Paramètres → Tables → « Mail du dossier accident », code `to` ; copie `cc` **vide par défaut**), objet « Dossier Accident : CLIENT - modèle 6 derniers du VIN », corps de Domenico (+ « Dossier urgent : … »), **4 pièces jointes régénérées à l'envoi** et conservées dans la GED du dossier (entité `accident_file`). Statuts : brouillon → envoyé (par le mail seulement) → accordé → pièces reçues → réparé → clos. Le rapport de l'expert se dépose sur le dossier mais ne part pas à Ducati.
- **Frais de devis atelier** (mission 02, process-commandes-pieces §1.4, décision M-5) : quand un devis de pièces vient de l'atelier, on ajoute les frais du devis — **accident = 125 € HTVA fixe** ; **diagnostic = tarif horaire de l'atelier × heures, 4 h maximum, sans nouveau devis** (heures modifiables vers le bas seulement). Paramètres par société : Paramètres → Tables → **Frais de devis atelier** (`reference_values`, `table_key = 'workshop_quote_fee'`, codes `accident` : `amount_ht`, `vat_rate` ; `diagnostic` : `hourly_rate_ht`, `max_hours`, `vat_rate`). Aucun tarif horaire n'existait : `hourly_rate_ht = 0` reprend le prix de vente de l'article `MO` (type T), lui-même à 0 en production le 19/09 → **tarif horaire à saisir**. La ligne est une ligne dédiée sans article (pas de mouvement de stock à la facturation).
- **Plans d'entretien** (mission 07, décision M-16) : **échéance au premier atteint** (km ou mois) ; **le document le plus récent fait foi** (la valeur à utiliser est `en_vigueur`, les anciennes restent `historique` avec « remplacé par ») ; plans **route / piste amateur / racing** choisis par l'usage de la moto (route par défaut) ; **prix main-d'œuvre = heures × taux horaire HT**, le taux étant le **même réglage** que le diagnostic des frais de devis (Paramètres → Tables → Frais de devis atelier → `hourly_rate_ht`, repli article `MO`) ; prix vide tant que le taux est à 0. Aucun prix, aucune pièce ni quantité dans les documents Ducati (viendront du catalogue, carte 07-2). Rattachement au catalogue **prudent** : nom exact + millésime dans la plage + un seul plan du même usage = lié d'office ; sinon « à valider ».
- **Prochain entretien de chaque moto** (mission 07 cartes 4 et 5, décisions **M-73** et **M-74**, 31/10) : une ligne courante par moto dans `vehicle_maintenance_due`, avec sa **source**. Ordre de confiance : OR facturé du DMS → facture G8 relue → déclaration du client → extract DCS → plan seul (date de départ) ; entre les quatre premières, **le dernier entretien le plus récent gagne**. Prochain = dernier + **12 mois** ; premier entretien = début de garantie + **6 mois** ou **1 000 km** ; km d'échéance seulement si le plan de la moto donne l'intervalle de la vidange ; **au premier atteint** (M-16). Un OR qui passe « facturé », une moto modifiée (km, dernier entretien, garantie, mise en circulation, rattachement au catalogue) ou un extract DCS importé relancent le calcul (déclencheurs). Source « plan » = estimation à 180 jours près, à filtrer dans les relances — **fait le 03/11 (M-87, CRM012)** : `followup_settings.sources` exclut « plan » par défaut, voir [M10](M10-crm.md).
- **OR créé depuis un RDV** : l'OR hérite du client, du véhicule, du km, du mécanicien, des travaux et des observations ; **depuis le 18/11 (Q43)** l'OR naît « à faire » et le RDV passe « réceptionné » (avant : « en cours » des deux côtés) ; le RDV garde le lien `or_id`. RDV d'entretien : les lignes du kit arrivent sur l'OR (Q49).
- **Registre des véhicules à moteur (AR n° 1 art. 28, M-88, 03/11)** : l'**ouverture d'un OR** avec une moto inscrit son entrée au registre (code 1, ou 2 si garantie acceptée ; moto choisie plus tard = inscrite à ce moment) ; la **facturation de l'OR** inscrit la sortie et la référence de la facture. Aucun code dans `or-editor.tsx` : tout passe par le déclencheur `trg_vehicle_register_repair_orders`. Un OR sur une moto du stock déjà inscrite (PDI) ne double pas l'entrée. Voir [M03](M03-vehicules.md) §4.

### Ajouté le 18/11 — rattrapage G8 : temps de main-d'œuvre, contrôle avant facture, facture unique, productivité

Sources : `docs/g8-inventaire/07-atelier.md` §3, §4, §7, §8, §9 ; `comparaison-atelier-parc.md` §2, §9, bloquants #5 et #15.
Migration `20261118110000_m8_temps_main_oeuvre.sql` (**non appliquée**) ; tant qu'elle manque, l'atelier marche comme avant
(pas d'horloge sur les lignes, pas de contrôle du temps, pointeuse au nom du compte connecté, onglet Productivité qui le dit).

- **Gestion du temps atelier (G8)** : sur une ligne main-d'œuvre, l'horloge ouvre la fenêtre mécanicien, **heures facturées**,
  **heures passées**, **heures internes**, **heures garanties**, **date des travaux** (`repair_order_lines.mechanic_code /
  mechanic_name / billed_hours / worked_hours / internal_hours / warranty_hours / work_date`). **Sur une ligne MO, la quantité
  = les heures facturées** ; `billed_hours` non vide = temps saisi ou contrôlé (il suit la quantité). **Règle G8** : des heures
  internes ou garanties remettent les heures facturées à zéro (« le temps facturé se saisit sur une nouvelle ligne MO »).
- **Les cartes du check-up gardent leur temps** : `repair_order_write_lines` reprend le temps de l'ancienne ligne MO de même
  `checkup_key` quand la carte ne l'envoie pas.
- **Avec la garantie (lot B10, même jour)** : une ligne MO **couverte** par la garantie vaut 0 € pour le client et sa
  **quantité = ses heures garanties** (le coût de garantie imputé à la facture = heures × taux MO garantie) ; une ligne
  re-routée vers le client (refus total, ligne refusée en refus partiel) se contrôle et se facture comme une ligne normale.
  `repair_order_write_lines` est redéfinie par les deux migrations : celle du lot garantie (`20261118130000`, posée
  **après**) a été complétée pour garder aussi le temps MO — si l'une est retouchée, garder les deux jeux de colonnes.
- **Contrôle du temps atelier** : « Transformer en facture » → (date des interventions reportées) → fenêtre de contrôle (une
  ligne par MO facturable : mécanicien, date, facturées, passées, internes, garanties, montant HT) avec le **rapprochement**
  facturé / passé / pointé / non facturé / % facturé et le temps pointé par mécanicien (`repair_order_time_summary`).
  Proposé par défaut : heures facturées = quantité (G8 facturait 0 € sans temps saisi), une seule ligne MO = le temps pointé
  de l'OR comme temps passé. Valider → `repair_order_time_control` (quantités, montants, totaux de l'OR) → facture.
- **Facture d'OR unique et atomique** : la facture porte `documents.repair_order_id` ; index unique partiel
  `uq_documents_invoice_per_repair_order` (une facture non annulée par OR, brouillon compris) + garde
  `trg_documents_repair_order_invoice_guard` (verrou de l'OR, message « OR … déjà facturé ») ; la validation de la facture
  passe l'OR « facturé » dans la même transaction (`trg_documents_repair_order_invoiced`). Un brouillon orphelin est retiré
  avant de refacturer ; une facture validée existante ne peut pas être doublée.
- **Pointeuse** (la même table `workshop_time_entries`, pas de second chrono) : `mechanic_code` (code mécano scanné ou tapé,
  Paramètres → Tables → **Codes mécano (pointeuse)**, code = code G8, libellé = nom), `kind = 'improductif'` + `task_code`
  (Paramètres → Tables → **Tâches improductives (pointeuse)**, préchargées : nettoyage atelier, nettoyage motos, entrée /
  sortie motos expo). Démarrer un OR ou une tâche clôt le travail en cours ; pointer le départ clôt aussi le travail en cours.
  Scan du n° d'OR (complet ou compteur seul, un seul OR ouvert doit correspondre).
- **Productivité atelier** (onglet de la pointeuse) : `workshop_productivity_detail(_company, _from, _to)` (une ligne par jour
  et par mécanicien, heures) + `labour-time/rules.ts`. **Présence** = pointages présence ; **passé** = pointages travail (à
  défaut, sur la période, les heures passées saisies sur les lignes) ; **facturé** = heures MO des OR facturés (date des
  travaux, sinon date de facture) ; **à facturer** = OR ouverts ; **internes / garanties** = heures saisies (ligne en garantie
  = ses heures en garanties) ; **improductif** = tâches pointées ; **non facturé** = passé − facturé − à facturer − internes −
  garanties ; **% facturé** = facturé (+ à facturer si coché) / passé ; **rendement production** = (facturé + internes +
  garanties) / passé ; **rendement atelier** = passé / (passé + improductif) ; **% improductif** = improductif / présence.
  Regroupement par mécanicien, jour, semaine ISO, mois, journée × mécanicien ; ligne « Non pointé » pour la MO sans mécanicien ;
  **Envoyer vers Excel** (feuille récapitulative + détail par journée et mécanicien).

### Check-up, proposition d'intervention, accord client, interventions reportées (31/10/2026, M-75 à M-77)

- **Aucune intervention sans accord tracé.** Dès qu'une proposition d'intervention est partie
  (`repair_orders.customer_approval = 'en_attente'`), l'OR n'est plus « à faire » pour l'atelier :
  bandeau en tête, « Démarrer le parcours » et la pointeuse grisés (`canStartWork`). L'accord est
  soit la **signature électronique** du client (`signe`, à distance ou au comptoir, voir M09), soit
  un **accord verbal** noté par le vendeur (`accord_verbal` : qui, quand, canal téléphone / comptoir /
  e-mail, note), tracé dans `events` (`customer_approval_verbal`). Sans proposition, rien ne bloque.
- **Une carte = une action du check-up**, portée par les lignes de l'OR : une ligne main-d'oeuvre
  (libellé, état, photo, heures) + ses lignes pièces, réunies par `checkup_key` (clé stable posée par
  l'écran, qui survit aux réécritures de lignes). États : `ok` (rien à faire, jamais proposé ni
  facturé), `a_faire`, `a_prevoir` (proposés), `reporte` (décoché par le client à la signature :
  exclu des totaux et de la facture, devient une intervention reportée).
- **Prix d'une carte** = heures × taux horaire HT (même réglage que le diagnostic : Paramètres → Tables →
  Frais de devis atelier → `hourly_rate_ht`, repli article `MO`) + pièces au prix de vente. Le temps
  est **proposé** par le plan d'entretien (temps Ducati en vigueur), sinon saisi. Taux absent → MO à
  0 € et bandeau d'alerte, jamais un prix inventé.
- **Motif d'entrée** : table de référence `workshop_reason` (préchargée : entretien annuel, 1 000 km,
  15 000 km, 30 000 km, vidange, pneus, freins, accident, garantie, diagnostic, autre ; réglable dans
  Paramètres → Tables). Un code commençant par `entretien` (ou `vidange`) pré-remplit : une carte
  « Entretien … » (temps + pièces du kit de l'échéance quand la mission 07 carte 2 est en base) puis
  une carte par opération du plan, à 0 h. Sans moto reliée au catalogue : message clair, rien d'inventé.
- **La proposition est un devis** (`documents`, `doc_type = 'DEV'`, `doc_kind = 'proposition_intervention'`,
  `repair_order_id`) créé en une transaction par `proposal_create_from_or` : une ligne par ligne de l'OR
  « à faire » / « à prévoir » (`checkup_key`, `photo_path` repris, `repair_order_lines.proposal_line_id`
  posé), numéroté `DEV-`, aucun mouvement de stock (B7 : seule la facture sort les pièces). Une
  proposition précédente non signée est annulée et remplacée. Le PDF porte la **photo en vignette**
  sous chaque action.
- **À la signature** (`proposal_apply_signature`, M09) : lignes gardées / décochées, totaux du devis
  recalculés sur les lignes gardées, lignes OR décochées → `checkup_state = 'reporte'`, une
  **`deferred_interventions`** par carte décochée (`a_planifier`, montant TTC de la carte), OR
  `customer_approval = 'signe'`, événement `proposal_signed`, cloche `proposal_signed` pour l'équipe.
- **Interventions reportées** : à la **facturation / remise des clés**, le comptoir fixe une date
  (par défaut **+30 jours**, modifiable) ou « pas maintenant » ; `planned_date` + `status = 'planifie'`.
  Visibles sur la fiche moto (encadré) et la fiche client (onglet « Reportées ») avec « Fixer une
  date », « Faite », « Abandonner ». Les relances (`relance`) sont l'affaire de l'agent « relances
  marketing », qui lit cette table telle quelle.
- **Facturation** : les lignes `ok` et `reporte` ne sont jamais facturées ; une carte sans heures
  devient une ligne texte de la facture (`invoiceableRoLines`).
- **Lignes réécrites en une transaction** (`repair_order_write_lines`, piège §7 réglé) ; tant que la
  migration n'est pas posée, l'ancien chemin (suppression puis insertion, sans les colonnes du
  check-up) reste utilisé et l'écran dit que le check-up attend la migration.

### L'entretien choisi et la réservation des pièces au RDV (03/11/2026, M-109 à M-113)

- **Une seule notion** : `service_code` sur l'OR et le RDV (annual = Annual Service / Entretien annuel, oil =
  Oil Service / Entretien annuel + huile, first_1000, desmo), posé par le **motif** (colonne « Entretien » des
  motifs, Paramètres → Tables ; déclencheur `_trg_workshop_service_code`). Il pilote le kit (kits réunis,
  annuel + huile = Annual + Oil sans doublon), le check-up, la picking list (plus besoin du parcours), le
  parcours (ouvert sur l'entretien de l'OR), la commande depuis l'OR et le prochain entretien.
- **Réservation dès le RDV** (planning, téléphone, comptoir, espace client) : déclencheurs sur
  `workshop_appointments` ; le manque au panier (urgente < N jours, standard sinon), minimax immédiat ; RDV
  annulé → libéré, déplacé → suivi, OR ouvert → suit l'OR, facture → consommé (la facture sort le stock, une
  seule fois). OR sans RDV : bouton « Réserver / mettre à jour » du bloc « Pièces réservées ».
- Écrans : bloc « Pièces réservées » (OR, RDV), fiche article → Stock, avertissement au comptoir.
- Migration `20261103270000_m8_entretien_reservation.sql` **non appliquée** ; essai à blanc 22 / 22 (`supabase/tests/m8_entretien_reservation.sql`).
  Détail : [mission 10 §10](../missions/mission-10-atelier-bout-en-bout.md).
- Piège : les pièces réservées ne sont pas encore des **lignes de l'OR** (carte 5) : à la facture, une pièce
  réservée absente des lignes est **libérée**, pas facturée (le bloc le signale).

### Ajouté le 18/11 — rattrapage G8 : planning de charge et motos de prêt (ATE002, ATE005, ATE010, ATE022)
Source : relevé G8 du 18/11 (`docs/g8-inventaire/07-atelier.md` §5, §6, §13, §14, parcours n° 20) et
comparaison (`comparaison-atelier-parc.md` §7, §8, bloquants #7 et #14). Migrations
`20261118120000_m8_planning_charge_g8.sql` puis `20261118121000_m8_motos_de_pret.sql` (**non appliquées**,
essai à blanc `supabase/tests/m8_planning_charge_g8.sql`). Tant qu'elles manquent, l'écran garde l'ancien planning.
- **Compagnons** (`workshop_mechanics`) : fin du mécanicien en texte libre. Chaque compagnon est relié (ou non) à un
  membre de l'équipe (garde : membre de la société), visible ou non au planning, ordre d'affichage, atelier, actif.
  À la migration, les membres « mécanicien » (visibles) et « chef d'atelier » (cachés) sont repris, avec les
  horaires G8 observés (mardi → samedi, 09:00-12:30 / 13:30-18:00) — à ajuster dans Planning → Réglages.
  Le RDV garde `mechanic_name` (recopié par la base) pour l'impression et les anciens RDV.
- **Horaires** (`workshop_mechanic_hours`) : matin / après-midi par jour, total jour et semaine ; un jour sans plage = repos.
- **Capacité** = somme des plages des compagnons **visibles et actifs** − jours fériés légaux belges (10 jours, Pâques
  calculé ; réglage activable) − fermetures / fériés saisis − pauses (tout l'atelier ou un compagnon) − absences.
  **Charge** = temps prévu des RDV placés (ni annulés, ni demandes, ni en attente ; sans temps saisi = une case).
  **Taux d'occupation** = charge / capacité (G8 : 2 h sur 24 h = 8,33 %). Rouge au-delà de 100 %, orange dès 85 %.
- **Réglages** (`workshop_planning_settings`, une ligne par société) : plage 09:00-18:00, 1er jour mardi, 5 jours,
  granularité 10 min, fériés belges, taux affiché, **bloquer les RDV simultanés** (garde en base, refus au glisser-déposer),
  conditions générales du contrat de prêt.
- **Calendrier** (`workshop_calendar_blocks`) : férié, fermeture, absence (compagnon obligatoire), pause, du … au ….
- **RDV en attente** (`workshop_appointments.unassigned`) : sans compagnon (la base le retire), date souhaitée gardée
  dans `starts_at` ; liste d'attente = RDV en attente + **demandes de l'espace client** (statut `demande`), sans OR.
  Glisser sur un compagnon / un créneau : refus sur un créneau indisponible (hors horaires, pause, absence, fermeture,
  férié) et, si le réglage le demande, sur un chevauchement ; une demande de l'espace client placée passe « Rendez-vous fixé ».
- **Temps prévu obligatoire avant l'OR** : `planned_minutes` devient facultatif (RDV en attente), mais la base refuse de
  poser `or_id` sans temps prévu (« Temps prevu obligatoire… »), et l'écran le demande (G8 « Veuillez saisir le temps prévu »).
  L'OR reprend client, moto, **km du RDV** (`mileage`, obligatoire dès qu'une moto est choisie), travaux, motif et
  **compagnon** (opérateur = membre lié si la colonne `operator_id` est en base).
- **Statuts du RDV alignés sur l'OR** (G8 « Catégories et couleurs ») : demande client · rendez-vous fixé · véhicule
  arrivé · travaux commencés · attente devis / pièces · travaux terminés · client informé · travaux facturés · annulé,
  chacun couleur + icône + libellé. Un changement de statut de l'OR met le RDV à jour (trigger
  `trg_repair_orders_sync_appointment` : à faire → arrivé, en cours → commencés, attente* → attente, prêt → terminés,
  client informé → client informé, facturé → facturés ; même table en TS `appointmentStatusForOr`). Un simple
  changement d'avancement ne déclenche jamais le contrôle des RDV simultanés.
- **Types de RDV** : Paramètres → Tables → « Types de rendez-vous atelier » (`workshop_appointment_type`), couleur métier
  `--job-*` (fond 10 %, bordure gauche, charte §5.6) et temps prévu proposé ; 6 types préchargés.
- **Rechercher RDV** : `workshop_appointment_search` (nom du client, immatriculation sans tirets, châssis ≥ 4 caractères).
- **Motos de prêt** (`workshop_loaner_vehicles`, `workshop_loans`) : flotte (modèle, marque, plaque, châssis, couleur,
  1re MC, km), prêt = moto + client + période prévue, numéro `PRET…` (séquence réglable), lien RDV et **OR** (repris
  automatiquement quand l'OR est créé depuis le RDV). Gardes en base : pas deux prêts actifs qui se chevauchent sur la même
  moto ; sortie = date + km ; retour = date + km ≥ sortie ; au retour le compteur de la moto prend le km de retour.
  Contrat imprimable A4 (emprunteur, permis, moto, période, sortie / retour, OR, conditions générales, signatures).
  Les **conditions générales** sont un **projet** écrit par nous : à relire par Domenico (Planning → Réglages).

### Ajouté le 19/11 — rattrapage G8 : contrat de prêt repris de G8 (ATE005, ATE022, à trancher T10)
Décision client (T10 ✅ « contrat G8 + nos CG ») : le contrat contient **au minimum** tout le contrat G8
« CONTRAT DE PRÊT DE VÉHICULE DE REMPLACEMENT » (une page A4) ; **nos conditions générales sont acceptées telles
quelles** (à ajuster plus tard) et s'impriment **au verso**, dans la langue du client. Migration
`20261119180000_m8_contrat_pret_g8.sql` (**non appliquée**, essai à blanc `supabase/tests/m8_contrat_pret_g8.sql`).
- **Écran « Contrat »** (Planning → Prêts → bouton Contrat, `loans/contract-dialog.tsx`) : tout est **pré-rempli** et
  corrigeable — conducteur depuis la fiche client (nom, né le / à = `birth_date` / `birth_place`, adresse, GSM / tél.,
  permis n° / délivré le / par = `license_issued_by`, à défaut `license_place`) ; **n° licence** saisi sur le prêt (pas
  sur la fiche client) ; moto du client = celle de l'OR, sinon du RDV, sinon au choix parmi ses motos ; OR n° / du ;
  **livraison prévue** = « promis le » de l'OR ; franchise ; « Fait à » (ville de la société) ; langue du contrat
  (langue de la fiche client) ; double exemplaire (coché par défaut). La saisie est gardée sur le prêt (`driver_*`,
  `customer_vehicle_id`, `delivery_planned_at`, `deductible_amount`, `contract_place`) : le conducteur peut donc être
  différent du client. Tant que la migration manque, le contrat s'imprime sans rien enregistrer (bandeau d'avertissement).
- **Impression** (`loans/contract-print.ts`) : par exemplaire (« de l'utilisateur » / « de la concession »), un recto =
  date, mention police, conducteur, « Dont le véhicule » (marque, modèle, MEC, immatriculation, châssis, OR n° / du,
  livraison prévue le / à), « Reçoit un véhicule de remplacement en parfait état » (marque, modèle, MEC, immatriculation,
  châssis, **puissance**), tableau **départ / retour** (date, heure, km, carburant ; vide = pointillés à remplir à la
  main), phrase de **franchise**, déclaration (« état du véhicule et conditions générales »), « Fait en double exemplaire
  à … le … », cadre de signature « L'utilisateur (mention manuscrite « lu et approuvé ») » + « Pour la concession » ;
  un verso = nos conditions générales. Couleurs / polices lues dans les tokens de la charte au moment d'imprimer
  (aucun hex dans le fichier, test).
- **Franchise par société** : `workshop_planning_settings.loan_deductible` (500 € par défaut, Planning → Réglages).
  Un prêt **fige** la franchise du jour de sa création (garde en base) ; elle reste modifiable sur l'écran Contrat.
- **CG par langue** : FR = `loan_terms` (inchangé), NL / EN / IT = `loan_terms_i18n` (traductions de notre texte
  posées par la migration si absentes) ; Réglages → choix de la langue au-dessus du texte. Langue vide → FR imprimé.
- **Moto de prêt** : `power` (puissance imprimée ; à défaut kW / ch de la fiche du parc liée) et `current_fuel`.
  **Au retour** : la moto de prêt prend le km **et le carburant** du retour (le carburant est proposé à la sortie
  suivante) ; la fiche moto du parc liée (`vehicle_id`) prend le km de retour s'il est supérieur. Le retard reste
  signalé par le badge « En retard » (pas d'autre rappel de retour existant).
- Règles pures : `loans/contract-rules.ts` ; tests `tests/contrat-pret-g8.test.ts` (rubriques G8 présentes dans les
  quatre langues, double exemplaire, franchise, pré-remplissage, CG par langue, pas de hex).

### Kits de pièces d'entretien (M-20, M-38 à M-43, M-90 à M-92)

- **03/11 — Tout le parc, au minimum « annuel » et « annuel + huile »** (M-91) : chaque modèle-année du
  catalogue (2 399) reçoit les kits « Entretien annuel + huile » (Oil Service), « Entretien annuel »
  (Annual Service) et « 1er entretien 1 000 km » si sa source le prévoit. Le **besoin** vient du manuel
  d'atelier, sinon du plan Ducati, sinon de la règle « vidange + filtre » (M-92) ; la **référence** des
  vues éclatées du modèle-année ; chaque ligne garde sa **provenance** (`maintenance_kit_items.provenance`).
  Un Annual Service qui contient déjà la vidange est repris tel quel pour « annuel + huile » (pas de
  double huile). `maintenance_kit_generate_all` = tout le parc, idempotent, par lots.
- **Deux références pour le même besoin : on garde les deux** (M-90) : une ligne par référence avec sa
  quantité, `catalog_refs` = toutes les références, niveau `a_confirmer` qui **ne bloque plus** (le kit
  sert, le popup propose les deux) ; `absent` = aucune référence trouvée, signalé, jamais commandé.

- **Les pièces d'un entretien se déduisent, elles ne se saisissent pas** : libellés d'opérations des
  manuels (`wsm_operations` balisées par échéance ∪ `wsm_service_procedures`) → besoin par famille de
  pièce → référence dans les **vues éclatées du catalogue Ducati de CE modèle-année** → article du
  DMS. Consommables : produit, spécification et quantité des **tableaux de ravitaillements**.
  Quantités prises dans la colonne « quantité » de la vue éclatée, jamais supposées.
- **Rien n'est inventé.** Niveaux : `sur`, `a_confirmer` (plusieurs références — on les garde toutes,
  M-90 —, ou article du consommable pas encore désigné ; ne bloque pas), `absent` (aucune référence
  alors que l'opération l'exige, 03/11), `non_applicable` (famille optionnelle absente du catalogue,
  jamais en kit). Plusieurs références = **toutes
  nécessaires** (courroies, joints de pompe à eau : `take_all`) ou **variantes à trancher** (filtres).
- **Un kit = famille de moteur × échéance × contenu** (M-40). La famille de moteur est la signature
  filtre à huile + bougie + courroie de distribution du modèle-année.
- **Le kit appartient à l'atelier** (M-41) : proposé, puis corrigé ; chaque correction incrémente la
  version et enregistre une photo du contenu ; une nouvelle proposition ne retouche jamais un kit
  corrigé. **Aucun mouvement de stock** : un kit décrit ce qu'il faut, il ne sort rien.
- **Une seule notion de liste de préparation** (M-42) : `picking_lists` a deux origines possibles,
  un document de vente **ou** un ordre de réparation. Depuis un OR, elle reprend le kit de l'échéance
  du parcours **et** les pièces « pièce » de l'OR ajoutées par le technicien.
- **Commander ne recrée pas le circuit d'achat** (M-43) : commande de pièces `part_orders` avec son
  `order_kind` (standard / urgente / accident ; **Excel garde son classeur**), reliée à l'OR par
  `part_orders.repair_order_id`, puis proposition fournisseur puis fichier DCS. Manquant = besoin −
  libre − en commande pour ce client − déjà en brouillon ; pièces seulement (types A et N).

### Ajouté le 18/11 — rattrapage G8 : OR garantie (B10) et OR accident côté assureur

Lot `lot-g8-garantie-accident`, sources `docs/g8-inventaire/07-atelier.md` §1, §11, §12, §15,
`04-fournisseurs-achats.md` (Historique garantie), `02-articles.md` (fiche fournisseur › Garantie),
parcours 18 et 19, comparaison §4 / §5, bloquants #8 et #13. Migration
`20261118130000_m8_garantie_et_accident.sql` (**non appliquée**, essai à blanc
`supabase/tests/m8_garantie_et_accident.sql`). Tant qu'elle manque, les écrans le disent et l'OR
continue de s'enregistrer comme avant.

- **Type de garantie (cession) sur l'OR** : 05 garantie fournisseur · 06 garantie magasin / atelier ·
  07 geste commercial (`repair_orders.warranty_cession_code`, libellés de Paramètres → Tables →
  Types de cession interne). Type de réparation « Garantie Ducati » → 05, « Garantie magasin » → 06
  (proposé, s'il est vide). Choisir un type sur un OR sans prise en charge le passe « en attente »
  (G8 : « Demande de prise en charge en attente ») et pré-remplit le **commentaire de la demande**
  « Demande de garantie pour le châssis … immat. … » (`warranty_note`).
- **Ligne « G »** : la case garantie d'une ligne la met à 0 € pour le client (lettre **G**).
  **Refus total** → toutes les lignes demandées en garantie sont **re-routées vers le client**
  (facturées à leur prix). **Refus partiel** → chaque ligne en garantie a « Acceptée / Refusée →
  client » (`repair_order_lines.warranty_decision`) ; seule la ligne refusée est facturée. Avant le
  18/11, une ligne cochée restait à 0 € même en refus total : corrigé. Règles pures
  `src/modules/workshop/warranty/rules.ts` (`lineCoveredByWarranty`), utilisées par les totaux,
  l'éditeur et la facture (`write-api.ts`).
- **MO garantie au taux garantie** : Paramètres → Tables → **Garantie atelier** (`workshop_warranty`,
  code `mo`, `hourly_rate_ht`, préchargé **46,94 € HT** = MO_ATELIER GARANTIE relevé dans G8, **à
  confirmer**). Le prix client de la ligne MO reste le taux atelier (s'il est re-routé, le client paie
  ce taux) ; le taux garantie sert à valoriser ce que la garantie prend en charge (encart « Garantie »
  sous les lignes de l'OR).
- **Imputation à la facturation** : au passage « facturé », un déclencheur
  (`trg_ro_impute_warranty` → `repair_order_impute_warranty`) fige sur chaque ligne couverte son
  **coût** (pièce : PAMP × qté ; MO : heures × taux garantie), son **PA** et sa **valeur au PV**
  (`warranty_cost_ht`, `warranty_pa_ht`, `warranty_sale_ht`, `repair_orders.warranty_imputed_at`).
  Le stock sort toujours par la facture client à 0 € (pas de mouvement en plus, B7).
- **Retours / remboursements constructeur** (`warranty_returns`) : en garantie fournisseur (05),
  une ligne par pièce couverte est créée à l'imputation, état **attente remboursement** (puis attente
  échange, remboursé, échangé ; passer à remboursé / échangé date la « réception garantie »), avec
  prise en charge, réception, facture d'achat, BL, PAUHT, n° ticket / OR, montant. Fournisseur = le
  fournisseur principal de l'article. Écrans : Atelier → vue **Retours constructeur** (historique
  global, filtres état / dates) et **fiche fournisseur** (section « Garantie »).
- **Vues de la liste des OR** (Atelier) : Ordres de réparation · **O.R. garantie** (type, avancement,
  châssis) · **O.R. accident** (cabinet, franchise, date OR, expert, passage, accepté, immat.,
  châssis) · Retours constructeur · **Garanties et statistiques** (liste « Garanties » : temps MO,
  achat pièces au PAMP, coût MO, coût MO + pièces — vue `warranty_lines_v` ; « Garanties / CA » par
  client : CA HT des factures, garanties au PAMP / PA / PV, % garantie / CA — fonction
  `warranty_stats_by_client`). Vue dans l'adresse (`/workshop?view=garantie|accident|retours|stats`).
- **OR accident côté assureur** : fichier des **cabinets d'assurance et experts**
  (`insurance_parties` : code, nom, adresse, téléphones, fax, e-mail, n° d'entreprise, TVA, contact,
  commentaires, **compte comptable**, **tarif associé**) dans Atelier → Dossiers accident → onglet
  « Cabinets et experts » (et « Nouveau » depuis l'OR). Le volet **Assurance** (cabinet, expert, date
  de passage, **franchise en montant ou en % de l'OR**, **valeur vénale**, **cote**, **démarrage des
  travaux accepté** avec qui / quand) vit sur le **dossier accident existant** de l'OR (colonnes
  ajoutées à `accident_files`, pas de second dossier) : affiché sur la page de l'OR et sur la fiche
  du dossier. Le nom du cabinet / de l'expert est recopié dans `accident_files.insurer` /
  `expert_name` (mail et formulaire Ducati) et l'expert + la date de passage sur l'OR
  (`expert_name`, `expert_date`) ; quand le dossier existe, ces deux champs ne se saisissent plus
  dans l'en-tête de l'OR (une seule saisie). **Document accident** : PDF d'une page (OR, client,
  moto, assureur, expert, passage, franchise, valeurs, accord, travaux, 3 cadres de signature),
  téléchargé et rangé dans la GED du dossier (`accident/accident-sheet-pdf.ts`).
- Code : `src/modules/workshop/warranty/` (`rules.ts`, `api.ts`, `warranty-views.tsx`),
  `src/modules/workshop/accident/insurance-*.ts(x)`, `accident-ors-table.tsx`,
  `accident-sheet-pdf.ts` ; libellés `warranty.*`, `insurance.*` (FR / NL / EN / IT) ; tests
  `tests/workshop-warranty.test.ts`, `tests/workshop-accident-insurance.test.ts`,
  `tests/workshop-totals.test.ts` (refus total / partiel).
- **À trancher (non décidé ici)** : statut comptable de la cession 05 « garantie fournisseur »
  (G8 : non comptabilisée ; DMS : comptabilisée) — la migration ne touche pas à la case
  « Comptabilisée » et ne passe aucune écriture. Voir aussi le rapport du lot.

### Ajouté le 19/11 — OR accident : expert des deux côtés (Q51) et tarif de l'assureur appliqué (T4)

Lot `lot-accident-expert` (ATE016 / ATE020), décisions `docs/g8-inventaire/a-trancher.md` **Q51**
(client, 19/11), **T4**, **T5**. Migration `20261119200000_m8_accident_expert_et_tarif_assureur.sql`
(**non appliquée**, essai à blanc `supabase/tests/m8_accident_expert_tarif_assureur.sql`, 17/17 ok
en transaction annulée). Tant qu'elle manque, l'ancien chemin reste actif (copie faite par l'écran).

- **Expert et date de passage : une seule source, le dossier accident** (`accident_files.expert_id`,
  `expert_name`, `expert_visit_date`). Les colonnes de l'OR (`repair_orders.expert_name`,
  `expert_date`) sont un **miroir tenu par la base dans les deux sens** :
  - saisie depuis l'OR (volet Assurance de la page OR) ou depuis le dossier (fiche du dossier) :
    fonction `accident_file_set_expert(_file, _expert_id, _visit_date, _origin)` — l'expert se
    choisit dans la **table des experts** (Atelier → Dossiers accident → Cabinets et experts ;
    « Nouveau » le crée à la volée), le nom et l'e-mail de la fiche sont recopiés sur le dossier ;
  - écritures directes (anciens écrans, imports) : modifier l'OR met le dossier à jour (expert
    retrouvé par son nom dans la table, sinon gardé en texte) — déclencheur `trg_ro_expert_to_file` ;
    modifier le dossier met l'OR à jour — `trg_accident_files_expert_after` ; un dossier ouvert pour
    un OR qui a déjà un expert / une date les reprend — `trg_accident_files_expert_before` ;
  - **trace** : `events.action = 'accident_expert_change'`, `entity_type = 'accident_files'`,
    `old_data` / `new_data` (expert, nom, date, OR), `origin` = **« OR »** ou **« dossier »** (en plus
    de l'audit ligne à ligne) ;
  - contrôles : l'expert est une fiche « expert » de la même société, le cabinet une fiche « cabinet »
    de la même société ; non-membre refusé.
  - La fiche du dossier n'a plus de champ texte « Expert » quand le volet Assurance est là (affiché en
    lecture, « choisi dans le volet Assurance ») : plus de double saisie.
- **Tarif de l'assureur (T4)** : la fiche cabinet choisit un **tarif commun** (`insurance_parties.
  price_list_id`, liste des tarifs de Clients → Tarifs, même moteur que « REMISE 15 % ») ; l'ancien
  texte est rattaché au tarif de même code / libellé (déclencheur, reprise des fiches existantes).
  `repair_order_price_list(_or)` dit quel tarif vaut pour un OR : **le cabinet du dossier accident
  l'emporte sur le client** (T4b, à confirmer), sinon le tarif du client.
  - Le calcul reste **le moteur unique** `src/modules/sales/customer-pricing.ts` (pas de second
    moteur) ; la fonction de prix des lignes d'OR est `src/modules/workshop/or-line-pricing.ts`
    (`priceOrLine`, `repriceOrLines`) : pièce / MO avec article = prix catalogue + tarif ; **MO sans
    article** = taux horaire atelier + tarif (règles « tout le catalogue » ou par référence
    `MO_ATELIER`, comme l'article MO de G8 : `CustomerPricer.priceLabour`) ; texte et pièce libre
    jamais touchés.
  - **Automatique** : à la saisie d'une ligne (article ou passage en MO) et quand le cabinet est
    choisi / changé / retiré, l'éditeur re-tarife toutes les lignes pièces / MO (bandeau « Tarif de
    l'assureur … appliqué à N ligne(s) », bouton **Annuler**). `repair_orders.insurer_price_list_id`
    retient le tarif assureur avec lequel les lignes ont été calculées : le re-tarifage ne se refait
    que s'il change ; jamais sur un OR facturé. Le tarif s'affiche au-dessus des lignes de l'OR.
  - Non touché : les lignes des **cartes du check-up** (OR d'entretien, pas d'assurance) ; les prix
    modifiés à la main sont recalculés depuis le catalogue (T4c, à confirmer).
- Code : `or-line-pricing.ts` / `or-line-pricing-api.ts`, `accident/insurance-api.ts`
  (`setAccidentExpert`, `insurerTariffSchemaReady`), `insurance-panel.tsx` (prop `origin`),
  `insurance-parties.tsx` (choix du tarif), `accident-file-screen.tsx`, `or-editor.tsx`,
  `sales/customer-pricing-api.ts` (`orInsurerTariff`, `priceLabour`) ; libellés `insurance.*`
  (FR / NL / EN / IT) ; tests `tests/or-tarif-assureur.test.ts`.
- **Coordination** : le taux horaire atelier (standard 109,74 HT, VIP 90 par tarif client, lot
  `lot-decisions-atelier`) doit passer par `priceOrLine` (branche MO) ; une règle client « par
  référence MO_ATELIER, prix net 90 » donne déjà 90 € sur une ligne MO sans article.

### Ajouté le 18/11 — décisions du client sur les écarts G8 (lot « décisions atelier », Q42 à Q49)
Source : `docs/g8-inventaire/a-trancher.md` (Q42 à Q49, tranchées le 18/11). Branche `lot-decisions-atelier`.
Migrations **non appliquées** : `20261119190000_m8_km_et_statuts_or_g8.sql`, `20261119191000_m8_acompte_or.sql`,
`20261119192000_m8_taux_horaire_atelier_vip.sql`, `20261119193000_m8_kit_rdv_vers_or.sql` ; essais à blanc
`supabase/tests/m8_km_et_statuts_or_g8.sql`, `m8_acompte_or.sql`, `m8_taux_et_kit_rdv.sql` ; tests
`tests/workshop-decisions-atelier.test.ts`, `workshop-or-ticket.test.ts`, `workshop-taux-kit-rdv.test.ts`.
- **Q42 — km obligatoire comme G8** : exigé à la **création de l'OR** et **quand une moto est rattachée ou changée** ;
  ensuite modifiable sans être redemandé (fini le contrôle à chaque modification). Règle pure `mileageRequired`
  (`or-base/rules.ts`) + garde en base `trg_repair_orders_mileage_required`. RDV : exigé dès qu'une moto est choisie
  (`trg_appointments_mileage_required`) ; un RDV sans moto (moto à créer) et une demande de l'espace client restent
  possibles. « Valider RDV et saisie OR » sur un RDV sans moto ou sans km ouvre **« Avant d'ouvrir l'OR »** (choisir la
  moto + km, ou ouvrir l'OR sans moto : le km sera demandé au rattachement). La copie d'un OR reprend son km.
  Les fonctions serveur / imports (`auth.uid()` vide) ne sont pas contrôlés. Le km alimente l'historique comme avant.
- **Q43 — statuts comme G8** : l'OR créé depuis le RDV naît **« à faire »**, le RDV passe **« réceptionné »** (`arrive`,
  libellé « Réceptionné · moto déposée ») — la base aligne le RDV sur l'OR à la pose de `or_id`
  (`trg_appointments_status_from_or`). L'OR passe **« en cours »** au **premier pointage de travail** sur l'OR
  (`trg_wte_start_or`, OR « à faire » seulement) ou par **« Démarrer »** sur la fiche OR (`repair_order_start`, refusé si
  l'accord client est en attente) ; le RDV suit (déclencheur existant). Trace `events` `repair_order_work_started`
  (origine `chrono` ou `screen`). Planning : **déposée** = orange + icône parking, **en travail** = bleu + clé ;
  RDV fixé = neutre. OR : en cours = bleu, prêt / client informé = vert, facturé / annulé = neutre.
- **Q44 — liste des OR** : ouverture sur **« Ouverts »** (ni facturés, ni annulés) ; « Tous les statuts » au choix, gardé
  dans l'adresse (pas de mécanisme de préférence par poste dans le DMS).
- **Q45 — acompte sur l'OR** : **même mécanisme que l'acompte de vente**, pas de second système. L'acompte est un
  règlement `document_payments` porté par un **bon de commande (BC) rattaché à l'OR** (`documents.repair_order_id`, un
  seul non annulé par OR, numéroté du n° de l'OR, une ligne texte « Acompte sur l'ordre de réparation … »), créé à la
  première saisie (`repair_order_deposit_document`). Panneau « Acompte » de la fiche OR = `PaymentPanel` +
  `DepositInvoicePanel` des ventes : caisse ouverte, espèces, plafond, contre-passation, **FAA automatique** (moto sur
  l'OR) ou sur demande, rappel cloche « à facturer avant le 15 ». À la **validation de la facture de l'OR**, la base
  reporte les acomptes sur la facture (`trg_documents_repair_order_deposit` : `transferred_from`, **date de
  l'encaissement** — la caisse close est respectée, cf. `20261119150000` —, `deposit_invoice_id` → la FAA est déduite au
  journal / registre TVA / écritures) et passe le BC « converti ». Non reportés (trace `events`) : un règlement
  contre-passé, un bon d'achat (BA), et tout si le client de la facture diffère de celui de l'acompte.
  Colonne **« Acompte »** dans la liste et l'export (`repair_order_deposits`), ligne **« Acompte versé »** sur le PDF et
  le ticket.
- **Q46 — impression** : PDF A4 inchangé (langue du client, par défaut) + **format ticket 80 mm** (`or-base/or-ticket.ts`,
  imprimé par `printReceipt` du poste comme les tickets de caisse ; sans poste réglé : ticket 80 mm par le navigateur) :
  concession, n° OR + code-barres, reçu le, client, téléphone, moto (modèle, immat, VIN abrégé « ...8 derniers »), km,
  travaux demandés, promis le, acompte.
- **Q47 — couleurs du planning comme G8 et DMS** : la couleur du **type de RDV** (Paramètres → Tables → Types de
  rendez-vous atelier, colonne « Couleur de la case au planning ») colore le **fond** de la case (teinte 20 % du token,
  bordure gauche pleine) ; palette **fermée** de tokens `--job-*` (pas de hex libre, rouge Ducati exclu), **neutre par
  défaut** ; le statut reste un petit badge couleur + icône + libellé (vue Activité comprise).
- **Q48 — taux horaire** : source unique inchangée (Frais de devis atelier, ligne DIAGNOSTIC, `hourly_rate_ht`) ;
  **bug corrigé** : le code saisi « DIAGNOSTIC » (majuscules) n'était jamais lu (lecture `diagnostic`) → le taux valait 0.
  Taux standard **109,74 HT** ; forfait DIAGNOSTIC = taux × heures (pas un forfait fixe), `amount_ht` aligné.
  **VIP 90,00 HT** = tarif client « VIP » du **moteur de tarifs existant** (ligne « prix net » sur l'article MO) :
  donner ce tarif au client sur sa fiche. `labour-rate.ts` (`clientLabourRate`, `useClientLabourRate`) : seul un tarif qui
  vise l'article MO change le taux. Appliqué aux lignes MO de l'OR, aux kits / forfaits insérés et au check-up ; quand le
  client change à l'écran, les lignes MO encore à l'ancien taux suivent (un prix saisi à la main n'est pas touché).
- **Q49 — kit du RDV d'entretien sur l'OR** : « Valider RDV et saisie OR » d'un RDV d'entretien pose **toutes** les lignes
  du kit choisi (pièces, liquides, DDS, contrôles, petites fournitures, CONTRI, MO au taux du client) : lecture
  `workshop_service_kit_lines` (mêmes kits et même fusion annuel + huile que la réservation, lignes de service
  comprises), insertion par `kitInsertLines` (`kits/kit-from-appointment.ts`). **Aucune nouvelle réservation** : celle du
  RDV suit l'OR et la facture la consomme (B7, somme des mouvements = 0). « Insérer un kit » reste disponible ; s'il
  ajouterait des articles déjà présents, l'écran prévient et propose « Ne pas réinsérer » (`kitDuplicateCount`).

### Ajouté le 18/11 — rattrapage G8 (lot « OR de base »)
Source : relevé G8 du 18/11 (`docs/g8-inventaire/07-atelier.md`, `parcours.md`, comparaison atelier §1, §3, §6, bloquants #2, #4, #6, #11, #12). Code : `src/modules/workshop/or-base/` (règles pures `rules.ts`, testées `tests/workshop-or-base.test.ts`). Migration **`20261118100000_m8_or_base_g8.sql` (non appliquée)**, essai à blanc `supabase/tests/m8_or_base_g8.sql`. Tant qu'elle n'est pas posée, l'OR s'enregistre comme avant (promis le, 30 points et km confirmé ne sont pas gardés, bandeau d'information sur l'OR ; le km du RDV n'est pas gardé).
- **Impression OR / fiche de travail** (bouton « Imprimer » de la fiche OR, `print-dialog.tsx`, `or-pdf.ts`, jsPDF) : OR seul / fiche de travail seule / OR + fiche ; **édition chiffrée** (PU et total TTC, totaux) ou non ; **OR sans le nom du client** ; en-tête société, n°, reçu le, promis le, opérateur, moto (modèle, référence, immat, châssis, **km**), travaux demandés, observations à la réception, points V / R, lignes (garantie marquée G, actions du check-up OK / reportées exclues), cadre **« Dépôt du véhicule »** avec signature client / réceptionnaire. La fiche de travail porte la grille complète des 30 points (cases V / R pré-cochées) et la place « travaux effectués / mécanicien / temps passé ». PDF dans la **langue du client**, depuis la version **enregistrée** de l'OR. Les informations complémentaires ne sont jamais imprimées.
- **Liste des OR** (`/workshop`, `or-list-screen.tsx`) : vues **OR · Devis de réparation** (attente devis ou proposition en attente d'accord) **· OR garantie** (prise en charge engagée ou type garantie) **· OR accident** (motif / type accident ou expert, colonnes expert et passage) ; recherche **n° d'OR, immat, client, châssis** ; filtres statut (dont « Ouverts »), période de réception, opérateur, type de réparation ; colonnes client, moto (modèle, référence, immat, châssis), reçu le, promis le, opérateur, km, montant TTC, statut ; **50 par page avec le total** (fini le plafond des 100 derniers) ; **Export Excel** du filtre courant (10 000 OR au plus) ; état dans l'adresse (UX011).
- **Kilométrage obligatoire** dès qu'une moto est choisie (nouvel OR et modification — **remplacé le 18/11 par Q42** : création de l'OR et rattachement d'une moto seulement) ; sous le champ, **dernier relevé** connu (le plus grand km parmi les OR non annulés, le km de la fiche moto, le dernier entretien, le km déclaré par le client ; l'OR en cours exclu) ; km **inférieur** → fenêtre bloquante « Confirmer X km / Corriger » ; la confirmation est gardée dans `repair_orders.mileage_ack_previous` (relevé dépassé), audit `events` par `audit_row`. **Km du RDV** : champ « Kilométrage » au planning (`workshop_appointments.mileage`), repris sur l'OR créé depuis le RDV.
- **Statuts G8** : à faire, **attente devis**, **pièces en commande** (`attente_pieces`), en cours, prêt, **client informé** (+ facturé, annulé posés par le DMS). Pas de contrainte en base (texte libre, les fonctions SQL ne testent que `facture` / `annule`) ; la pointeuse accepte les OR à faire / attente devis / pièces en commande / en cours ; l'espace client affiche les nouveaux statuts.
- **« Prévenir le client (moto prête) »** sur un OR « prêt » avec client (`ready-mail-dialog.tsx`) : mail préparé dans la langue du client (objet, corps, montant), boîte Outlook au choix, **« Vérifier sans envoyer » seulement** ; l'envoi réel est derrière `READY_MAIL_LIVE` (false). « Marquer client informé » passe l'OR au statut G8. Pas de trace `events` du mail (`graph-send-email` ne trace que `documents` et `accident_files`).
- **Rappel SMS de RDV** : `_cron_appointment_reminders` n'enfile plus le SMS que si `notify_sms` est coché (bug : tous les clients avec un portable l'auraient reçu). Le mail de rappel est inchangé. Aucun fournisseur SMS n'est posé.
- **Historique atelier sur la fiche moto** (`vehicle-history-panel.tsx`) : OR de la moto (date, n°, statut, km, travaux, montant, badge « Entretien »), dernier relevé, dernier entretien, liste des relevés de km ; clic → OR.
- **Popup « Commentaire client »** (`client-comment-popup.tsx`) : à l'ouverture d'un OR (ou au choix du client sur un nouvel OR), le commentaire de la fiche client (`contacts.notes`) s'affiche ; « Modifier » le corrige sur la fiche, « Valider » ferme. Rien si la fiche n'a pas de commentaire.
- **Modèles de commentaires** (« Modèles » à côté des travaux, observations et informations complémentaires, `comment-templates-menu.tsx`) : **Rappeler** (remplit ou ajoute à la ligne), **Mémoriser ce texte**, **Supprimer** (administrateur ; les autres rôles retirent le modèle de la liste). Même bibliothèque que les commentaires types des ventes (`document_comment_templates`).
- **30 points « à vérifier (V) / à remplacer (R) »** (`check-points-panel.tsx`) : grille repliable sous les travaux, `repair_orders.check_points` (objet `{code: 'V' | 'R'}`, contrainte « objet JSON »).
- **Promis le** (`repair_orders.promised_at`) sur l'OR, affiché dans la liste et imprimé ; « Reçu le » = date de création de l'OR.

### Ajouté le 19/11 — SMS par Brevo (décision client du 18/11, T14 / T15, ATE018, ATE006)
Comme G8 : **SMS automatique de fin de travaux** quand l'OR passe à « Prêt », **rappel de RDV par SMS** selon la case du RDV, **« SMS programmés »** (envoi différé, liste, annulation). Fournisseur : **Brevo** (API SMS transactionnelle). Les mails ne changent pas (boîte Outlook, `graph-send-email` ; le mail de rappel de RDV reste celui de `_cron_appointment_reminders`). Branche `lot-sms-brevo`, migration **`20261119170000_m8_sms_brevo.sql` (non appliquée)**, essai à blanc `supabase/tests/m8_sms_brevo.sql` (28 contrôles, rejoué avec et sans la migration ItalTest). Règles pures `src/modules/crm/sms-rules.ts` + adaptateur `supabase/functions/_shared/brevo-sms.ts`, tests `tests/sms-brevo.test.ts`.
- **Un seul système** : la file `notifications` + `dispatch-notifications` (pg_cron, 10 min). La base choisit ce qui part (`sms_dispatch_claim`) et le trace, la fonction envoie par Brevo et rend le résultat (`sms_dispatch_result`). Le « fournisseur générique » (`SMS_API_*`) est remplacé. Secrets : `BREVO_API_KEY` (absente : statut « Non envoyé / clé Brevo absente », aucune erreur), `BREVO_SMS_SENDER` (facultatif, défaut `DucatiBXL`, 11 alphanumériques ; l'expéditeur saisi dans Paramètres → SMS passe avant).
- **Interrupteur par société** (`sms_settings`, pas de ligne = **Arrêté**, comme les relances CRM011) : Arrêté (rien ne part, les SMS restent visibles « Non envoyé / envoi des SMS arrêté ») · Test (tout part au numéro de test, `is_test`, `sent_to`) · Actif (confirmation). Options : SMS auto de fin de travaux (oui), rappel de RDV (oui) et délai « N avant » (24 h, de 1 h à 7 jours), signature `{societe}`, horaires `{horaires}`, modèles par type et par langue du client (FR / NL / EN / IT, vide = texte par défaut ; balises `{prenom} {nom} {moto} {or} {horaires} {societe} {date} {heure}`, G8 : `[client] [daterdv] [heurerdv]`). Textes par défaut sobres, dans l'alphabet SMS standard (1 SMS) ; G8 n'a pas de texte relevé dans l'inventaire.
- **Fin de travaux** : déclencheur `trg_repair_orders_ready_sms` (passage à `pret`). **Un seul SMS par OR** (index unique `uq_notif_sms_once`), même si le statut fait des allers-retours. Pas de client / envoi auto coupé / client qui refuse les SMS (consentement RGPD `contact_consents`, `_consent_channel(...,'sms') = 'refuse'`) / pas de mobile (mobile, puis GSM, puis téléphone s'il est mobile ; numéros en E.164, Belgique par défaut) : rien n'est enfilé, la raison va dans `events` (`sms_ready_not_queued`). Une erreur ne bloque jamais le changement de statut. L'OR affiche l'état du SMS (« SMS de fin de travaux : Programmé / Envoyé / Non envoyé + raison »). Au moment d'envoyer, un OR revenu en arrière est écarté (`or_not_ready`).
- **Rappels de RDV** : tâche `sms-appointment-reminders` (15 min, `_cron_sms_appointment_reminders`) : RDV `prevu`, case « SMS de rappel » cochée, à moins de N du RDV et à plus d'une heure. Un rappel par RDV et par horaire : un RDV déplacé ou annulé avant l'envoi est écarté (`rdv_changed`). La tâche mail du soir n'enfile plus de SMS.
- **SMS programmés** (bouton du planning atelier + Paramètres → SMS) : liste des SMS en attente et historique (statut, raison, numéro de test), **Annuler** (`sms_cancel`, trace `events`), **Programmer** des rappels pour les RDV entre deux dates (type de RDV, seulement les RDV cochés ou tous, N j / h / min avant ou jour J-n à heure fixe, message libre à balises ou modèle de la langue du client) → `sms_schedule_appointments`, sans doublon avec le rappel automatique.
- **Paramètres → SMS** (`/settings/sms`, administrateurs) : état de la clé (jamais la clé), solde SMS Brevo, expéditeur par défaut, réglages, modèles avec aperçu et compteur (Unicode signalé), **« Envoyer un SMS de test à mon numéro »** (numéro saisi, jamais un client, 5 par heure, part même en mode Arrêté) → fonction Edge `sms-brevo` (`sms_test_prepare`, trace dans la file).
- **Société de test** : marquage du lot ItalTest (`test_companies`, `is_test_company`), lu par `_sms_is_test_company` s'il existe. Rien ne part jamais : SMS enfilé directement « Non envoyé / société de test », mode forcé à Arrêté, SMS de test et SMS programmés refusés, contrôle répété à l'envoi.
- **Piège** : le mail de rappel de RDV (inchangé) formate l'heure en UTC (`to_char(starts_at)`) ; les SMS utilisent l'heure de Bruxelles.

## 5. État en production
Vérifié le 18/09/2026 (code + base).
- **Tous les objets utilisés par le code existent** : `repair_orders`, `repair_order_lines`, `workshop_time_entries`, `workshop_appointments` avec toutes les colonnes écrites (y compris `price_mode` lu à la facturation), fonctions `or_worked_minutes`, `next_document_number`. RLS active et triggers d'audit (`trg_ro_audit`, `trg_rolines_audit`, `trg_appt_audit`, `trg_wte_audit`) présents.
- **Volumes** : 11 OR, 22 lignes, 3 pointages, **0 rendez-vous**. Module utilisable mais peu utilisé.
- **Rappels de RDV inopérants** : la tâche `appointment-reminders` tourne chaque jour (succès en base) et enfilerait un e-mail et un SMS la veille ; `dispatch-notifications` les marque `skipped` faute de clé Resend et de fournisseur SMS.
- **Tables sans écran** : `workshop_operations` (40 lignes), `repair_order_operations`, `workshop_tasks` (0 ligne) et la fonction `workshop_load` existent en base depuis `20260612250000_m8_workshop_extra.sql` (commit `6d7b17a`, qui n'a touché que la migration et `types.ts`) mais **aucun code de `src/` ne les utilise**.
- **Sécurité** : `or_worked_minutes` et `workshop_load` sont exécutables sans être connecté ; `workshop_load` contourne le contrôle de société pour un appel anonyme (`auth.uid() is null or …`). Voir `00-architecture.md` §9.

**Kits d'entretien (03/11).** Tables et fonctions de la carte 2 en base, **0 kit** : la génération n'a
jamais été lancée. Migration `20261103200000_m8_kits_generation.sql` (tout le parc, M-90 à M-92)
**écrite, essayée en transaction annulée, non appliquée** ; essai à blanc : 200 modèles-années → 131
kits, 200 / 200 avec « annuel » et « annuel + huile » ; parc complet : 2 398 / 2 399 (voir mission 07).
Après application : lancer « Proposer les kits » (ou `tools/migration/generer_kits.py --apply`).

**Kits d'entretien (23/09).** Les quatre migrations de la carte 2 sont écrites et
testées **en transaction annulée sur la base de production** (déduction, génération des kits, picking
list depuis un OR, calcul du manquant, création d'une commande urgente reliée à l'OR, édition et
versionnement d'un kit, non-écrasement d'un kit corrigé). Elles ne sont **pas appliquées** : aucun
kit n'existe encore en base. Mesure faite sur les données réelles : 370 modèles-années reliés à un
manuel, **4 529 des 4 629 besoins fermes résolus jusqu'à l'article du DMS (97,8 %)**, 44 familles de
moteur, **385 kits** pour 1 355 couples modèle-année × échéance.

**Prochain entretien (31/10, non déployé).** Migration `20261031100000_m8_prochain_entretien.sql` écrite et
testée **en transaction annulée sur la base de production** (détection des libellés réels, import DCS avec
dédoublonnage et VIN inconnus, déclaration client plus récente qui l'emporte, plan seul, lot de 300 motos,
`vehicles_maintenance_upcoming`). **Pas appliquée** : aucune échéance en base, les écrans le disent
(« migration 20261031100000 à appliquer »). Mesuré : 37 lignes G8 d'entretien seulement sur 6 527 factures
rattachées à une moto ; extract DCS du 29/10 : 228 lignes, 223 motos connues.

## 6. Prévu / en cours
- CRM atelier (onglet prévu dans M10, `docs/plan-nouveau-client.md`) : relances et suivi client côté atelier.
- Reste noté dans `docs/avancement.md` (E7) : rapprochement temps facturé (prorata / sélection), notifications SMS / e-mail, devis de réparation PDF.
- En attente client : compte Brevo, crédits SMS, clé `BREVO_API_KEY`, expéditeur déclaré (lot SMS du 19/11).
- Spécification G8 détaillée : `docs/g8-fonctions-m8-atelier.md`.

## 7. Limites connues, dettes, pièges
- **Choix de la moto sur l'OR (corrigé le 03/11/2026, ATE001)** : jusque-là l'en-tête de l'OR cherchait la moto dans tout le parc sans tenir compte du client (les motos du client n'apparaissaient jamais), et à la réouverture de l'OR le client était retrouvé via `listContacts` plafonné à 500 sur plus de 8 000 contacts : au-delà, la case client revenait vide. Désormais un seul composant `src/modules/vehicles/vehicle-picker.tsx` (logique pure `vehicle-pick.ts`, tests `tests/or-choix-moto.test.ts`) sert l'OR, le RDV du planning et les documents de vente : motos du client (propriétaire courant, `vehicle_owners.is_current`) en tête, puis recherche VIN / plaque / modèle dans le parc, client sans moto → message + « Ajouter une moto à ce client », erreur de chargement → toast, et le client est chargé par `getContact(id)`. Piège qui reste : une moto choisie n'est pas rattachée automatiquement au client (si elle appartient à quelqu'un d'autre, c'est volontaire : moto de passage).
- **Page OR (corrigé le 03/11/2026, ATE001b, retours client)** : (1) l'opérateur était un texte libre → liste de l'équipe (`company_members`), connecté par défaut, id dans `repair_orders.operator_id` (migration `20261103230000`, **non appliquée** : en attendant, le nom seul est enregistré dans `operator`, l'écran marche) ; (2) type de réparation libre → liste `workshop_repair_type` (l'ancienne clé `repair_type` des Paramètres n'avait jamais servi, renommée) ; (3) **propositions d'article cachées** : la liste était un bloc `absolute` dans le tableau `overflow-x-auto` des lignes, coupée par le conteneur, et la recherche renvoyait 8 articles triés par référence (pour « FREIN » : 1 413 articles, les 8 premiers « 0000… » obscurs) → `ArticleLinePicker` (Popover, portail) unique OR / check-up / ventes, fonction `article_line_search` (migration `20261103230000` ; repli `part_order_article_search` + en stock d'abord) ; (4) **PU HT à 0** : 81 089 articles sur 93 784 n'ont que leur PV TTC (`sale_price_ht` vide), la recherche renvoyait `coalesce(sale_price_ht, 0)` → HT = TTC / (1 + TVA) dans `searchSaleArticles` (corrige aussi les ventes, la caisse et le check-up) ; (5) motif « Accident » sans dossier : rien n'ouvrait le dossier à l'enregistrement, seul un bouton parmi neuf dans l'en-tête → dossier ouvert en brouillon à l'enregistrement + bandeau « Dossier accident » sur l'OR. Règles pures `or-page-rules.ts`, `sales/article-price.ts`, tests `tests/workshop-page-or.test.ts`.
- **Réécriture des lignes à chaque enregistrement** : depuis le 31/10, `writeLines` appelle `repair_order_write_lines` (suppression + insertion **en une transaction**) ; l'audit enregistre toujours des suppressions / insertions à chaque sauvegarde (les identifiants de lignes changent : c'est `checkup_key` et `proposal_line_id`, recopiés, qui relient les cartes à la proposition). Tant que la migration 20261031110000 n'est pas appliquée, l'ancien chemin non atomique reste en service.
- **Transformation en facture non atomique** (corrigé le 18/11, **effectif après la migration 20261118110000**) : la facture porte `repair_order_id`, la base refuse une 2e facture du même OR (index unique + garde avec verrou) et passe l'OR « facturé » à la validation de la facture, dans la même transaction. Reste non atomique côté navigateur : les mouvements de stock de la facture (comme toute facture M6).
- **Une facture d'OR annulée par avoir** : statut `avoir_emis`, pas `annulee` → l'OR ne peut pas être refacturé (à trancher, voir journal du lot).
- **Garantie = prix 0, pas de cession** : les pièces en garantie sortent du stock via une facture client à 0 €, sans **cession interne de garantie** ni **facture interne à Ducati** (ATE020). **Depuis le 18/11 (rattrapage G8)** : le coût est figé à la facturation sur les lignes couvertes (PAMP, PA, PV, MO au taux garantie), suivi dans les listes « Garanties » / « Garanties / CA » et, en garantie fournisseur, dans les retours constructeur — mais toujours **pas de facture interne à Ducati** ni d'écriture comptable (statut comptable de la cession 05 à trancher).
- **Pas d'impression d'OR** : le libellé `workshop.print` existe mais aucun bouton ; la **proposition d'intervention** (PDF, signature) existe depuis le 31/10, pas la fiche de réception elle-même.
- **Check-up (31/10)** : pré-remplissage depuis le kit seulement si `maintenance_kit_for_model_year` retrouve l'échéance par son code normalisé (les codes des posters et des manuels diffèrent : souvent seules les cartes d'opérations arrivent, sans pièces) ; les photos du check-up passent par la GED de l'OR (pas de limite de taille, comme le panneau GED du personnel) ; la fonction serveur `proposal-sign` doit être **déployée** et les secrets Graph posés pour que le PDF signé parte par mail (sinon la signature est enregistrée et l'écran le dit) ; `types.ts` non régénéré : `checkup/api.ts` appelle ses fonctions sans typage.
- **Rappel RDV** : `_cron_appointment_reminders` ignore la case `notify_sms` ; il enfile e-mail **et** SMS pour tout RDV `prevu` du lendemain. À corriger avant de poser les clés d'envoi.
- **Chronos sans rôle** (corrigé le 18/11 avec la migration 20261118110000) : le mécanicien s'identifie par son **code mécano** (Paramètres → Tables → Codes mécano) ; sans code, pointage au nom du compte connecté comme avant. Les codes ne sont pas encore reliés aux comptes ni à la « table des compagnons » du planning (à rapprocher si le lot planning en crée une).
- **Productivité** (complétée le 18/11, migration 20261118110000) : `workshop_productivity_detail` + `labour-time/rules.ts`. L'ancienne `workshop_productivity` (Rapports M13) reste telle quelle. Les heures MO des **remises en état (ORO, table `oro`)** ne sont pas encore comptées en cessions internes.
- **Liste limitée à 100 OR**, sans pagination.
- **Parcours d'entretien sur données de démonstration** : l'écran technicien lit
  `public/demo/parcours-entretien.json` (2 motos, 19 procédures) tant que le lot `lot-manuels` n'est
  pas en base ; les **figures ne sont pas dans le dépôt** (≈ 300 Mo) et se copient à la main
  (`node tools/journey-demo/copy-images.mjs`).
- **Avancement d'un parcours dans la tablette seulement** : la migration
  `20260923110000_m8_parcours_entretien.sql` n'est pas appliquée ; en attendant, l'avancement vit
  dans le navigateur du technicien (un autre poste ne le voit pas) et l'écran l'affiche clairement.
- **Photos du parcours hors GED** : elles restent dans l'avancement (base64), elles ne rejoignent pas
  les pièces jointes de l'OR.
- **Pas d'historique OR sur la fiche véhicule** : seules `src/modules/contacts/api.ts` (fiche client) et le module atelier lisent `repair_orders` ; la fiche véhicule (M3) ne liste pas les OR du VIN.

- **Kits : la règle seule pour 2 081 modèles-années** (03/11) : sans manuel ni plan rattaché (surtout
  variantes USA / autres marchés et modèles d'avant 2012), le kit « annuel + huile » est filtre +
  bouchon + huile (quantité d'huile à ajuster) et le kit « annuel » est **vide**, à compléter une fois
  par famille de moteur. Les 86 modèles-années à grille non balisée (M-30) passent aussi par le plan
  ou la règle.
- **Kits : plusieurs références gardées** (M-90) : 4 couples distincts sur le parc (filtre à huile
  `42710251A` / `44440312B` des V4, crépine `42710171A` / `89420112B`-`89420113B`, filtre à air
  `42610201A` / `42610261A`) ; l'atelier retire la ligne inutile. Le **check-up** ne pré-remplit encore
  que les lignes `sur` avec article ; la **picking list** d'un OR reprend aussi une ligne absente
  (désignation sans article).
- **Consommables sans article tant que l'atelier ne l'a pas désigné** : le manuel donne le produit
  (SHELL Advance 15W-50) et la quantité (3,8 l), pas une référence Ducati. La ligne de kit part en
  « à confirmer » et n'entre pas dans le calcul du manquant à commander. Réglage une fois pour
  toutes par `maintenance_fluid_article_set`.
- **La picking list d'un OR ne se « régénère » pas** : le bouton « Régénérer depuis le document » est
  réservé aux listes d'un document de vente. Pour re-synchroniser une liste d'OR, re-cliquer
  « Créer la picking list » sur l'OR : la fonction est idempotente et ajoute seulement ce qui manque.
- **Prochain entretien : la source « plan » estime.** Sans aucun entretien connu, l'échéance est déduite de la date de départ (6 mois puis tous les 12 mois, fenêtre de 180 jours) : pour les vieilles motos c'est une estimation, pas une date Ducati. Les relances doivent filtrer sur `source`. Les factures G8 ne donnent presque rien (37 lignes d'entretien) : G8 facturait des pièces, pas des forfaits.
- **`types.ts` non régénéré** : les migrations 20260923160000–163000 n'étant pas appliquées, le
  module `workshop/kits` appelle ses fonctions SQL sans typage (même parade que `journey/source.ts`).
  À régénérer après application.

## 8. Exigences du cahier couvertes
Référentiel : `docs/cahier-fonctionnel-v2.md`, annexe A (Atelier, 24 exigences).

| Code | Besoin | Statut | Preuve / manque |
|---|---|---|---|
| ATE000 | Paramétrage du module | partiel | Séquence `OR-` (M0) ; référentiel d'opérations en base sans écran |
| ATE001 | Prise de RDV en ligne | manquant | RDV saisis en interne seulement (`planning-api.ts`) ; pas de formulaire public |
| ATE002 | Planning visuel avec capacité par mécanicien | fait (18/11, migration à appliquer) | Compagnons reliés à l'équipe, horaires, capacité et taux d'occupation par jour et par compagnon, vues Réception / Activité, liste d'attente + glisser-déposer, fériés / fermetures / absences / pauses (`src/modules/workshop/planning/`, `20261118120000`) ; `workshop_load` reste sans appelant (remplacé par le calcul de `rules.ts`) |
| ATE003 | Synchro Outlook ↔ planning | manquant | Graph utilisé pour les mails seulement (M10) |
| ATE004 | Lien RDV → client → véhicule → intervention | fait | `workshop_appointments.contact_id / vehicle_id / or_id`, `createOrFromAppointment` |
| ATE005 | Motos de courtoisie | partiel | Champ texte `loaner_vehicle` sur le RDV ; statut véhicule `courtoisie` (M3) ; pas de suivi de prêt |
| ATE006 | Rappels RDV e-mail et SMS | partiel | `_cron_appointment_reminders` + file ; aucun envoi réel (clés absentes). **18/11** : le SMS ne part plus que si la case « SMS de rappel » du RDV est cochée (`20261118100000`) ; aucun fournisseur SMS posé ; **19/11** : SMS de rappel par Brevo selon la case, délai N avant, SMS programmés + annulation (`20261119170000`, non appliquée) |
| ATE005 | Motos de courtoisie | fait (18/11, migration à appliquer) | Flotte, disponibilité, prêt lié au RDV / OR, sortie et retour (km, date, carburant), contrat imprimable avec conditions générales (`src/modules/workshop/loans/`, `20261118121000`) ; pas encore de rappel automatique de retour |
| ATE006 | Rappels RDV e-mail et SMS | partiel | `_cron_appointment_reminders` + file ; aucun envoi réel (clés absentes) |
| ATE007 | Photos à la réception | fait | `AttachmentsPanel` entité `repair_order` sur la fiche OR |
| ATE008 | Signature client sur l'OR + envoi | partiel (31/10) | **Signature électronique de la proposition d'intervention** (à distance : nom + clic ; au comptoir : tracé au doigt), PDF signé envoyé et archivé ; pas encore de fiche de réception signée |
| ATE009 | Devis complémentaire avec accord client | fait (31/10) | Check-up → proposition d'intervention (devis relié à l'OR, photos) → signature du client ligne par ligne → accord tracé, garde-fou avant intervention, interventions reportées |
| ACH005 | Commande pour moto accidentée (dossier accident Ducati) | fait (03/11) | Dossier accident complet ou rien : devis lié, formulaire Excel au format Ducati, photos + châssis, mail Outlook à technique.dwe@ducati.com avec 4 pièces jointes, statuts (mission 09 carte 5) |
| ATE010 | États personnalisés et codes couleur | partiel (18/11) | **8 statuts** (les 6 de G8 : à faire, attente devis, pièces en commande, en cours, prêt, client informé + facturé, annulé) avec couleur + icône + libellé (`or-base/or-status-badge.tsx`) ; non paramétrables |
| ATE010 | États personnalisés et codes couleur | partiel | OR : 5 statuts fixes avec badge couleur + icône ; **RDV (18/11)** : 9 statuts alignés sur l'OR (couleur + icône + libellé, légende cochable) et types de RDV paramétrables avec couleur métier ; couleurs des statuts non paramétrables (charte) |
| ATE011 | Checklists par type de véhicule | partiel (23/09) | **Parcours d'entretien pas à pas** : opérations de l'entretien cochables, procédures du manuel étape par étape (`/workshop/journey/$orId`, mission 07 carte 8), sur données de démonstration ; tables `workshop_operations` / `repair_order_operations` toujours sans écran |
| ATE012 | Notes internes non visibles du client | fait (18/11) | « Informations complémentaires (non imprimées) » sur l'OR = `repair_orders.notes`, jamais imprimées (`or-pdf.ts`) |
| ATE013 | Kits / combos de pièces | partiel (03/11) | **Kits d'entretien par famille de moteur × échéance** (mission 07 carte 2, M-20/M-40/M-41) : proposition depuis les manuels + le catalogue (97,8 % des besoins fermes résolus), correction par l'atelier, versionnement, picking list depuis l'OR et commande des manquantes ; **03/11 (ATE013b, M-90 à M-92)** : génération pour tout le parc (manuel > plan > règle), « annuel » et « annuel + huile » pour chaque modèle-année, deux références gardées, provenance par ligne — migration à appliquer. Reste : le devis d'entretien chiffré (pièces + MO) et l'insertion d'un kit comme ligne de forfait sur un OR |
| ATE014 | Nomenclatures d'entretien auto (modèle + km) | partiel (31/10) | Plans d'entretien par modèle / années / usage (mission 07 carte 1) **+ parcours technicien : entretien dû, opérations, procédures, couples, temps UT** (carte 8) ; **+ kits de pièces par famille de moteur et par entretien** (carte 2, 23/09) ; **+ prochain entretien de chaque moto avec sa source, extract DCS importable, déclaration du client** (cartes 4 et 5, 31/10, migration non appliquée) |
| ATE015 | Pointage du temps par intervention | fait | `chrono-api.ts`, `/workshop/chrono` ; 18/11 : code mécano, scan d'OR, tâches improductives |
| ATE016 | Suivi garantie Ducati / magasin | fait (18/11, migration non appliquée) | Type de cession 05 / 06 / 07 sur l'OR, avancement, refus partiel avec re-routage, vue O.R. garantie, retours constructeur (rattrapage G8) |
| ATE017 | Recherche VIN avec tout l'historique | partiel (18/11) | Recherche VIN globale (M0) ; **liste des OR** cherche n° / immat / client / châssis ; **fiche moto : historique atelier** (OR, km, entretiens, `or-base/vehicle-history-panel.tsx`) |
| ATE018 | Notification de fin de travaux programmable | partiel (18/11) | OR « prêt » → bouton **« Prévenir le client »** : mail préparé dans la langue du client, `graph-send-email` en **mode test seulement** (`READY_MAIL_LIVE = false`), « Marquer client informé » ; pas de SMS, pas d'envoi automatique ; **19/11** : SMS automatique par Brevo au passage « Prêt », un seul par OR, modèle par langue, option société, état affiché sur l'OR (`20261119170000`, non appliquée) |
| ATE019 | Tableau de bord productivité par mécanicien | fait (18/11, migration à appliquer) | Pointeuse → **Productivité atelier** : présence, passé, facturé, à facturer, non facturé, internes, garanties, improductif, % facturé, rendements, par mécanicien / jour / semaine / mois, export Excel. Avant : présence / travail ; le **récapitulatif du parcours** rapproche temps passé / temps Ducati (UT) / temps facturé sur un OR (23/09), pas encore agrégé par mécanicien |
| ATE020 | Facturation interne garantie et productivité | partiel (18/11) | Coût de la garantie imputé à la facturation (PAMP / PA / PV, MO au taux garantie), listes Garanties et Garanties / CA ; pas de facture interne à Ducati (§7) |
| ATE021 | Planification des essais démo | manquant | — |
| ATE022 | Parc de motos prêtées et démo | partiel | Motos de prêt suivies (18/11, voir ATE005) ; motos de démo : statut véhicule `demo` (M3), pas de planning d'essais (ATE021) |
| ATE023 | Accès rapide aux accessoires en stock (upselling) | partiel | Recherche d'articles dans l'éditeur d'OR (`ArticleLinePicker` / `searchSaleArticles`, 03/11 : stock, casier et PV HT affichés, en stock d'abord) |

Invariants : **B8** fait (cycle complet, facture via M6) ; **B10** fait côté écran et base (18/11, migration `20261118130000` non appliquée : type de cession garantie, acceptation / refus total / refus partiel **avec re-routage des lignes vers le client**, imputation du coût à la facturation ; statut comptable de la cession 05 à trancher) ; **B11** complété le 18/11 (lot temps MO, migration `20261118110000` non appliquée : présence → temps par OR → **rapprochement temps passé / facturé** par ligne MO et par mécanicien, productivité complète). Avant : B11 partiel (présence et travail pointés ; depuis le 23/09 le **parcours d'entretien** compare temps passé, temps officiel Ducati et temps facturé sur un OR — mais ses chronos ne sont pas encore versés dans `workshop_time_entries`, la colonne `journey_operation` est prête et la migration non appliquée).

## Ajouté le 18/11 — rattrapage G8 (lot parc, kits et OR)

Source : `docs/g8-inventaire/02-articles.md` (Nomenclatures), `07-atelier.md`, `comparaison-atelier-parc.md` §6, §10 et bloquant #17.

- **Insérer un kit / forfait comme lignes** de l'OR (bouton **Insérer un kit** sous les lignes) ou d'un document
  de vente : kits d'entretien existants (`maintenance_kits`, ceux du modèle-année de la moto en tête) et forfaits
  d'article existants (`article_kit_items`) — aucune nouvelle notion de kit. Mode **détail** (titre + une ligne
  par pièce au prix de la pièce, MO en ligne main-d'œuvre, besoin sans article en texte) ou, pour un forfait qui
  a un prix, mode **forfait** (une ligne au prix du forfait + contenu en texte). Le stock sort à la facture (B7).
  `kits/insert-rules.ts`, `kits/insert-api.ts`, `kits/kit-insert-dialog.tsx`.
- **Remplacer une référence dans tous les kits** (Atelier → Kits → **Remplacer une référence**) : aperçu puis
  application dans tous les kits d'entretien actifs (nouvelle version + instantané) et tous les forfaits ; une
  ligne portant déjà la nouvelle pièce est fusionnée. Migration `20261118143000_m8_kits_remplacer_reference.sql`
  (`kits_replace_article`, admin / chef d'atelier / magasinier, trace `events`).
- **Devis de réparation** (page OR) : crée un devis DEV brouillon qui **recopie les lignes de l'OR** (mêmes règles
  que la facture : actions OK / reportées exclues, garantie à 0 €) et l'ouvre ; le « Devis de pièces » vide reste.
- **Dupliquer l'OR** (page OR) : nouvel OR « à faire », même client, moto, travaux et lignes, sans check-up ni garantie.
  `or-copy-rules.ts`, `or-copy.ts`. Tests `tests/kits-insertion.test.ts`.
- **À trancher** : G8 insère une nomenclature au **prix forfait TTC** ; les kits d'entretien du DMS n'ont pas de prix
  forfait (somme des pièces) ; export Excel de la liste des OR non fait (la liste des OR est le bloquant #4, autre lot).

## Ajouté le 19/11 — rattrapage G8 (lot forfaits G8)

Source : `docs/g8-inventaire/nomenclatures-g8.md` (37 nomenclatures, prix de la vraie base G8). Décisions Q40, Q41
([journal](../decisions.md)).

- **Articles « forfait » de G8** (Pièces) : CONTRI, PETITES FOURNITURES, APPAREIL DE DIAGNOTI (DDS), PRISE EN
  CHARGE et les contrôles à 0 € (CONTROLE BATTERIE / DES FREINS / DES NIVEAUX / ECLAIRAGE / ET USURE PN, TENSION
  DE COURROIES, TENSION ET GRAISSAGE, REGLAGE SOUPAPES, TEST MOTO) en type **F** (ligne de service : ni stock,
  ni préparation, ni commande, ni réservation) ; MOTO 4XT TECH EN FUT (au litre), HUILE DE FREIN DOT 5, HUILE DE
  FOURCHE ELF, FILTRE A HUILE 1199, PRODUITS NETTOYAGE MOT (« MAXI POWER ») en type **A** ; la MO des forfaits
  pointe vers l'article **MO** (type T) existant. Articles déjà présents réutilisés (CHAIN CLEANER, COOLELF,
  MOTO 4 ROAD, MO). Prix par `price_changes` (bloc séparé `20261119142000`, vraie base G8) ; les pièces Ducati
  gardent le prix du tarif Ducati.
- **Les 37 forfaits G8** = articles **N** « nomenclature » (prix = somme des lignes, comme G8) + composants
  (`article_kit_items`, dans l'ordre de la fiche G8). Toutes les références de pièces existent chez ITALBIKE
  (aucune manquante). Ils apparaissent dans **Insérer un kit** (OR, ventes) ; la MO d'un forfait sans prix
  propre prend le **taux horaire de l'atelier** (Q40). Catalogue source : `src/modules/workshop/forfaits/g8-catalog.ts`.
- **Atelier → Kits → Réglages des kits** (`kits/kit-settings-dialog.tsx`, `kits/settings-api.ts`) :
  1. **Liquide → article** (table existante `maintenance_fluid_articles` + unité de vente, contenance, unité
     entière) : huile moteur → MOTO 4XT au litre, fourche → HUILE DE FOURCHE ELF (flacon 0,5 l arrondi),
     frein → HUILE DE FREIN DOT 5 (flacon 0,5 l), refroidissement → COOLELF au litre ;
  2. **Quantité d'huile par défaut selon la famille moteur** (`maintenance_engine_profiles`, forfaits G8) :
     2 soupapes 3,10 l ; 4 soupapes / Testastretta 3,40 l ; 748/749/916/996/998/999 3,40 l + joint 22032083A ;
     Panigale 1199/1299/899/959 3,40 l + FILTRE A HUILE 1199 ; Multistrada 1200 2010-2012 4,00 l de MOTO 4 ROAD.
     Motif lu sur le nom de la famille moteur du kit et les modèles du catalogue ; V4 : aucun profil (rien
     d'inventé). Sert quand la source ne donne pas la quantité (« quantité reprise du forfait G8 » en
     provenance), pour un filtre introuvable et pour remplir un kit de vidange vide (huile + filtre + joint) ;
  3. **Lignes ajoutées par défaut à chaque kit** (`maintenance_kit_default_lines`) : DDS, 6 contrôles, tension
     et graissage, petites fournitures, CONTRI ;
  4. **Rattrapage** (`maintenance_kits_complete`, par lots, aperçu) ; chaque kit modifié prend une version
     (`maintenance_kit_versions`, motif « rattrapage G8 »). Le générateur applique la même chose aux kits qu'il crée.
- Écran Kits : « article à désigner » seulement si aucun article n'est rattaché ; une ligne rattachée dont la
  quantité est douteuse affiche « Quantité à vérifier ». Provenance visible (forfait G8, quantité source).
- **Choix du kit d'un modèle-année** (`_workshop_kit_for`) : un kit qui contient des pièces passe avant un kit
  vide ou fait seulement de lignes standard (avant : 5 RDV ne réservaient rien).
- Préparation (picking) : les lignes F / T de l'OR et les lignes de service des kits ne sont plus à préparer.
- Taux MO garantie préchargé 46,94 → **83,00 € HT** (MO GARANTIE DWE, vraie base) par `20261119143000`.
- Tests : `tests/forfaits-g8.test.ts` (totaux de forfaits = pieds de fiche G8 formation et vraie base,
  conversion des liquides, profils moteur, MO au taux atelier) ; essai à blanc `supabase/tests/m8_forfaits_g8.sql`.
- **Piège** : `maintenance_fluid_article_set` (ancienne entrée) versionne désormais chaque kit touché. Lignes
  encore sans article : `maintenance_kits_unlinked(société)` (courroies sans référence au catalogue).

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-11-19 | **SMS par Brevo** (T14 / T15, ATE018, ATE006) : SMS automatique de fin de travaux, rappels de RDV selon la case, SMS programmés + annulation, Paramètres → SMS (état, modèles, SMS de test), interrupteur Arrêté / Test / Actif, société de test bloquée | branche `lot-sms-brevo`, `20261119170000_m8_sms_brevo.sql` (**non appliquée**), fonctions `dispatch-notifications` + `sms-brevo` |
| 2026-11-18 | **Rattrapage G8, temps de main-d'œuvre** (B11, ATE015 / ATE019) : « Gestion du temps atelier » par ligne MO, « Contrôle du temps atelier » avant facture (quantité MO = heures facturées), **facture d'OR unique et atomique**, pointeuse à code mécano + scan d'OR + tâches improductives, productivité atelier complète avec export Excel | branche `lot-g8-temps-mo`, `20261118110000_m8_temps_main_oeuvre.sql` (**non appliquée** ; essai à blanc `supabase/tests/m8_temps_mo.sql`, rejoué sur PGlite 33 / 33) ; la réécriture des lignes du lot garantie (`20261118130000`, posée après) a été fusionnée pour garder le temps MO |
| 2026-11-18 | **Rattrapage G8 — OR garantie et OR accident** (B10, ATE016, ATE020, bloquants #8 et #13) : type de cession 05 / 06 / 07, commentaire de demande, refus total / partiel avec re-routage des lignes, MO au taux garantie, imputation du coût à la facturation, retours constructeur (global et par fournisseur), listes Garanties et Garanties / CA, vues O.R. garantie / O.R. accident ; fichier des cabinets et experts, volet assureur sur le dossier accident (franchise montant / %, valeur vénale, cote, démarrage accepté), document accident PDF | branche `lot-g8-garantie-accident`, `20261118130000_m8_garantie_et_accident.sql` (**non appliquée**) |
| 2026-11-18 | **Rattrapage G8 « OR de base »** : impression OR / fiche de travail (chiffrée ou non, sans nom du client, signature de dépôt), liste des OR (vues OR / devis / garantie / accident, recherche n° / immat / client / châssis, filtres, pagination, export Excel), km obligatoire + contrôle « inférieur au dernier relevé » + km du RDV, statuts G8 (attente devis, pièces en commande, client informé), message « moto prête » (mode test), rappel SMS qui respecte la case du RDV, historique atelier sur la fiche moto, popup commentaire client, modèles de commentaires, 30 points V / R, notes internes non imprimées, promis le | branche `lot-g8-or-base`, `20261118100000_m8_or_base_g8.sql` (**non appliquée**) |
| 2026-11-03 | **Page OR (ATE001b, retours client)** : opérateur choisi dans l'équipe (connecté par défaut, `operator_id`), type de réparation en liste réglable pré-remplie par le motif, garantie / expert affichés seulement quand ils servent, recherche d'article unique en surcouche (OR, check-up, ventes) mieux classée, PU HT déduit du TTC + TVA de l'article + remise client + MO au taux horaire, OR accident → dossier accident en brouillon et bandeau sur l'OR | branche `fix-page-or`, `20261103230000_m8_page_or.sql` (**non appliquée**, essayée en transaction annulée) |
| 2026-11-03 | **Créer un OR montre bien les motos du client, le client ne s'efface plus** (bug client, ATE001) : sélecteur de moto partagé OR / RDV / documents de vente (`vehicles/vehicle-picker.tsx`), motos du client en tête puis recherche parc, client sans moto → « Ajouter une moto à ce client », client et moto de l'OR chargés par id (plus via la liste plafonnée à 500), bouton « Nouvel OR » sur la fiche moto, `/workshop/new?contactId=&vehicleId=` | branche `fix-or-motos-du-client` |
| 2026-11-03 | **Mission 10 « Atelier de bout en bout »** : audit du parcours complet (9 étapes, 11 coutures, 19 cartes, voir [mission 10](../missions/mission-10-atelier-bout-en-bout.md)) ; constaté en base : migrations atelier du 23/09 au 03/11 **appliquées** (parcours, kits, picking depuis l'OR, check-up, prochain entretien, panier, popup), 0 kit, 0 parcours, 0 réservation ; corrigé : « Reporter sur l'OR » garde l'état du check-up, « Créer l'OR » depuis un RDV reprend le motif, bandeau « prochain entretien » du check-up sur la ligne courante | branche `mission-10-atelier` |
| 2026-11-03 | **L'entretien choisi suit la moto de l'OR, ses pièces sont réservées dès le RDV, le manque part en commande** (mission 10 cartes 1 et 6, début 7, ATE015, M-109 à M-113) : `service_code` sur l'OR et le RDV, motifs alignés sur le manuel, kits réunis, réservation `stock_reservations` au RDV (y compris espace client), minimax immédiat, libération / suivi de l'OR / consommation à la facture, bloc « Pièces réservées », avertissement au comptoir | branche `lot-atelier-entretien-reservation`, `20261103270000_m8_entretien_reservation.sql` (non appliquée) |
| 2026-11-18 | **Rattrapage G8 : planning de charge et motos de prêt** (ATE002, ATE005, ATE010, ATE022, bloquants #7 et #14) : compagnons reliés à l'équipe et horaires, capacité et taux d'occupation, vues Réception / Activité, RDV en attente + liste d'attente + glisser-déposer, fériés belges / fermetures / absences / pauses, statuts du RDV alignés sur l'OR, types de RDV, Rechercher RDV, temps prévu obligatoire avant l'OR, km du RDV repris sur l'OR ; flotte de prêt, prêts, sortie / retour, contrat imprimable. Tests `tests/atelier-planning-g8.test.ts` | branche `lot-g8-planning`, `20261118120000_m8_planning_charge_g8.sql`, `20261118121000_m8_motos_de_pret.sql` (**non appliquées**), essai à blanc `supabase/tests/m8_planning_charge_g8.sql` |
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
| 2026-09-23 | **Parcours d'entretien pas à pas** pour le technicien sur tablette (mission 07 carte 8, ATE011 + ATE014) : entretien dû, opérations, procédures du manuel, figures zoomables, couples, chronos, récapitulatif vers l'OR | `20260923110000_m8_parcours_entretien.sql` (**non appliquée**) |
| 2026-09-23 | **Kits de pièces d'entretien** (mission 07 carte 2, ATE013 + ATE014, M-20) : déduction entretien → pièces depuis les manuels et le catalogue (97,8 % des 4 629 besoins fermes résolus, 44 familles de moteur, 385 kits), écran Atelier → Kits d'entretien, picking list depuis l'OR, commande des pièces manquantes avec choix du type | `20260923160000_m8_entretien_pieces_regles.sql`, `20260923161000_m8_kits_entretien.sql`, `20260923162000_m8_picking_depuis_or.sql`, `20260923163000_m8_commande_depuis_or.sql` (**non appliquées**) |
| 2026-10-31 | **Prochain entretien de chaque moto** (mission 07 cartes 4 et 5, ATE014, M-73 / M-74) : `vehicle_maintenance_due` avec sa source, import de l'extract DCS (onglet + script), encadré sur la fiche moto, km et dernier entretien déclarés par le client (espace client, inscription, borne), `vehicles_maintenance_upcoming` pour les relances | `20261031100000_m8_prochain_entretien.sql` (**non appliquée**) |
| 2026-10-31 | **Check-up à l'accueil, proposition d'intervention, accord client signé, interventions reportées** (ATE008 / ATE009, M-75 à M-77) : motif d'entrée, onglet Check-up tablette (cartes état / photo / temps / pièces / prix), devis « Proposition d'intervention » envoyé dans la langue du client et visible dans l'espace client, signature d'un clic ou au doigt, accord verbal tracé, garde-fou, date des reportées au comptoir, encadrés fiche moto / client, cloche | branche `lot-checkup-atelier`, `20261031110000_m8_checkup_et_accord_client.sql` (**non appliquée**, essayée en transaction annulée), fonction `proposal-sign` **à déployer** |
| 2026-11-03 | **Un entretien prévu sans les pièces en stock propose de les commander** (mission 09 carte 3, ATE013, M-82) : motif du RDV (`workshop_appointments.reason_code`, même liste que l'OR) ; à la prise d'un RDV d'entretien et à l'ouverture d'un OR avec motif entretien, popup « N pièces manquent pour cet entretien : les mettre en commande ? » (kit de l'échéance − stock libre − en commande), Standard / Urgente (urgente si RDV à moins de N jours, réglage ligne `urgente`), « Mettre en commande » → `basket_add_lines` (panier de la carte 1) ou repli commande de pièces en brouillon ; mémoire `workshop_parts_prompts` (jamais deux fois les mêmes pièces, « Pas maintenant » compris), trace `events`. Code `src/modules/workshop/parts-popup*`, planning, fiche OR ; tests `tests/workshop-parts-popup.test.ts` | `20261103120000_m4_commande_demo.sql` (**non appliquée**, essayée en transaction annulée le 03/11) |
| 2026-11-03 | **Kits d'entretien pour tout le parc** (mission 07 carte 2 suite, ATE013b, M-90 à M-92) : besoin lu dans le manuel, sinon le plan, sinon la règle « vidange + filtre » ; « annuel » et « annuel + huile » (+ 1 000 km) pour chacun des 2 399 modèles-années ; deux références pour le même besoin gardées toutes les deux ; provenance par ligne ; `maintenance_kit_generate_all` ; écran « Proposer les kits » avec barre d'avancement ; script `tools/migration/generer_kits.py` | `20261103200000_m8_kits_generation.sql` (**non appliquée**, essayée en transaction annulée) |
| 2026-11-03 | **Dossiers accident** (mission 09 carte 5, ACH005, M-83) : fiche, devis lié (seuil 1 500 € HTVA, remise 15 %), photos avec photo du châssis, rapport d'expert, formulaire Excel « Aide Réparation Moto Accidentée » rempli dans le modèle Ducati, PDF de photos, mail Outlook à Ducati avec 4 pièces jointes (copie vide par défaut), checklist « complet ou rien », statuts ; l'ancienne fenêtre « Aide réparation Ducati » est retirée | branche `lot-dossier-accident`, `20261103110000_m8_dossiers_accident.sql` (**non appliquée**, essayée en transaction annulée), fonction `graph-send-email` **à redéployer** |
| 2026-09-23 | **Manuels d'atelier Ducati** (mission 07 carte 3, ATE014) : 15 tables `wsm_*`, chargeur `tools/wsm-loader`, onglet « Manuels d'atelier », rattachement au catalogue (426 fermes / 9 à valider / 34 sans correspondance sur 469) | `20260923100000_m8_manuels_atelier.sql`, `20260923101000_m8_manuels_atelier_chargement.sql` (**non appliquées**) |
| 2026-11-03 | **Registre des véhicules à moteur** : entrée à l'ouverture de l'OR, sortie à sa facture (déclencheur SQL, M-88) | branche `lot-registre-vehicules`, migration `20261103190000_m3_registre_vehicules_moteur.sql` (**non appliquée**) |
| 2026-11-18 | **Rattrapage G8, lot parc** : kit / forfait inséré en lignes (OR et vente), remplacer une référence dans tous les kits, devis de réparation recopiant l'OR, dupliquer un OR | branche `lot-g8-parc`, migration `20261118143000` (**non appliquée**) |
| 2026-11-19 | **Contrat de prêt repris de G8** (ATE005, ATE022, T10 « contrat G8 + nos CG ») : tout le contrat G8 (conducteur, permis, licence, moto du client + OR + livraison prévue, moto de prêt + puissance, départ / retour date-heure-km-carburant, franchise par société 500 € par défaut, mention police, « lu et approuvé », double exemplaire), pré-rempli, nos CG au verso dans la langue du client ; retour → km + carburant de la moto de prêt et km de sa fiche du parc | branche `lot-contrat-pret`, migration `20261119180000_m8_contrat_pret_g8.sql` (**non appliquée**), essai `supabase/tests/m8_contrat_pret_g8.sql` |
