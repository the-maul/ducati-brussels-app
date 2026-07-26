# Rapport de session — Backlog Italobike/Ducati Bruxelles

> Auteur : Atlas · Session du 2026-07-25 → 26 · Base de départ : commit 579601f
> Backup figé : repo GitHub `the-maul/ducati-backup` + tag `backup-20260725-224552`.

## Résumé exécutif
Traitement du backlog client (Domenico, 37 items / 7 modules). **7 Pull Requests** ouvertes sur
`the-maul/ducati-brussels-app`, chacune buildée verte (`bun run build` exit 0) et vérifiée.
Chaque item a été : (1) confronté à la demande client dans les `.docx` sources, (2) implémenté via
Claude Code, (3) vérifié manuellement (diff + rebuild indépendant + test données réelles), (4) commité
avec un code d'exigence traçable.

## Pull Requests
| PR | Branche | Module | Contenu |
|----|---------|--------|---------|
| #1 | feat/lot-1-contacts | Contacts | dropdown conditions paiement · retrait champs tarifaires · intérêt Piste · motif surveillance · étoile VIP + alerte près du nom · code client en colonne · limite 2 fiches liées + pop-up héritage · pop-up débiteur |
| #2 | feat/lot-2-parts | Pièces | catalogue nettoyé (retrait Type/Marque) + colonnes dispo fournisseur/triple stock/localisation 2 · header sticky · case e-shop en haut · duplication référence · code-barres=référence · filtres mouvements |
| #3 | feat/lot-3-stock | Stock | multi-filtres (fournisseur/rayon/dates) · export CSV inventaire · vue réappro/back-order · **module dépréciation de stock** |
| #4 | feat/lot-4-sales | Ventes | filtres page ventes · acomptes en liste · actions rapides (supprimer/dupliquer/imprimer) · envoi mail/SMS + historique · purge devis · **picking list digitale** |
| #5 | feat/lot-5-documents | Atelier/Docs | formulaire moto accidentée + Programme Aide Réparation Ducati 15% (export Excel + mailto) |
| #6 | feat/lot-6-ux-transverse | Transverse/CRM | fil d'Ariane global · boutons Annuler/Enregistrer sticky · **matching client↔moto en stock** + notification |
| #7 | feat/lot-7-parts-plus | Pièces/Ventes | **applicabilité article** (table + import CSV Ducati + onglet fiche) · **statut de disponibilité sur documents** (pastille V/O/R + % + filtre) |

## Migrations appliquées en base (vérifiées, RLS active)
- `contacts.watch_note` (motif de surveillance)
- `articles.supplier_availability` + `articles.bin_location2` (rattrapée — migration 20260718 jamais appliquée)
- `stock_depreciations` (RLS is_member, append-only)
- `picking_lists` + `picking_list_items` (RLS is_member)
- `article_applicabilities` (RLS is_member)

Toutes appliquées via l'API Management Supabase. Les fichiers `.sql` sont versionnés dans `supabase/migrations/`.

## ⚠️ DÉPENDANCES EXTERNES à traiter (ne bloquent pas le code, déjà câblé)
1. **Envoi e-mail réel** : poser `RESEND_API_KEY` + `NOTIFY_FROM` (expéditeur vérifié) dans les secrets
   Edge Functions Supabase. L'Edge Function `dispatch-notifications` + la file `notifications` sont prêtes.
2. **Envoi SMS réel** : choisir un provider + poser `SMS_API_URL` + `SMS_API_KEY` (+ `SMS_FROM`).
   Tant que non posés : les notifications restent en file (`pending`/`skipped`) mais l'historique CRM
   (`communications`) fonctionne déjà — l'utilisateur voit ce qui a été envoyé.
3. **IBAN via CODA** (Contacts) : nécessite un flux d'import CODA bancaire à spécifier — non implémenté.
4. **Import du CSV d'applicabilité** `55611132AA` : à faire via le bouton de l'onglet Applicabilités.

## TODO résiduels (documentés dans le code, non bloquants)
- Canal e-shop des documents : heuristique sur `imported_from` (pas de colonne canal dédiée).
- Filtre contenu VN/VO/DV : basé sur `vehicle_id`, à affiner via `document_lines → articles.mgmt_type`.
- « En commande » (dispo documents) = 0% tant qu'il n'y a pas de lien `purchase_lines`.
- Usage moto (Route/Sport/Off-road/Piste) pour le matching : heuristique v1 sur `model`/`segment_type`
  à remplacer par une colonne dédiée quand le client renseignera les 4 cases sur la fiche moto.
- Familles d'articles : CRUD 3 niveaux déjà fonctionnel, i18n à finir + édition/renommage.

## Items du backlog déjà couverts par l'existant (avant cette session)
- Module Inventaire : sessions, arrêté daté/snapshots, comptage 3 modes, remise à zéro sélective (VN/VO/DV),
  écarts, réintégration, scan casier, file d'étiquettes, cycle count — déjà en place.
- Import tarifs (mapping colonnes Excel) : moteur `articles/import/` déjà présent.
- Export DCS standard/urgente : `purchases/dcs-export.ts` déjà présent.

## Reste à faire (itérations futures, non traité cette session)
- Étiquettes intelligentes Brother QL-1110NWB (rapprochement réception↔client sur l'étiquette).
- Cascade IA (reclassement de groupes mal classés — scraping DCS ?).
- Équivalences = anciennes références liées (affichage dans la fiche).
- Modèles PDF Bon de livraison / Facture conformes aux exemples fournis (PDF POS déjà en place).
- Import clients G8 + articles/véhicules (patron import contacts déjà là).
- Tableau de bord réappro avancé (Min/Max/back-order filtré) — base posée en PR #3.
