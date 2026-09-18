---
chapitre: M1
titre: Contacts / clients
etat: ✅
verifie_le: 2026-09-18
missions: []
mots_cles: [client, prospect, fournisseur, fiche client, code client, doublon, fusion, archiver, VIP, surveillance, bloqué, permis, carte d'identité, registre national, TVA, VIES, encours, limite de crédit, tarifs client, fiche liée, pro, privé, parc, étiquette client, My Ducati]
---

# M1 — Contacts / clients

> **En une phrase** : la fiche de chaque client, prospect ou fournisseur de la concession — identité, permis, entreprise, drapeaux, motos, documents et historique.

## 1. À quoi ça sert

C'est le carnet d'adresses central, repris de G8 (8 108 fiches en base au 18/09/2026, dont 101
fournisseurs). Les vendeurs, l'atelier et la comptabilité y retrouvent un client, ses motos, ses
factures, ses échéances, ses documents et ses échanges. La fiche porte tout ce que G8 portait
(parité de champs), plus ce que G8 n'avait pas : lecture automatique du permis et de la carte
d'identité, vérification du numéro de TVA auprès de l'UE, détection de doublons, liaison d'une fiche
professionnelle et d'une fiche privée, actions groupées sur la liste.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| Clients → liste (`/clients`) | Rechercher (insensible aux accents, par mots), filtrer par type (particulier, professionnel, banque/leasing, fournisseur, employé), trier par nom ou par **date d'arrivée**, choisir les colonnes affichées, paginer. Accès à « Tarifs client ». |
| Clients → liste → cases à cocher | **Actions groupées** sur la page affichée : archiver / réactiver, changer le statut, poser ou retirer VIP / surveillance / bloqué / opt-out marketing, lier des fiches, fusionner. |
| Clients → Nouveau (`/clients/new`) | Créer une fiche. Alerte non bloquante si une fiche strictement identique existe (nom + ville + téléphone + e-mail). Code client attribué automatiquement par la base. |
| Clients → fiche (`/clients/$contactId`) → onglet Fiche | Trois sous-onglets Info privée / Info pro / Info chez Ducati. Identité, permis (n°, date, lieu, catégorie A/A2…), carte d'identité, registre national, adresse, téléphones avec indicatif pays, e-mails, conditions de paiement, IBAN/BIC, limite de crédit, TVA (**bouton de vérification VIES** qui préremplit la raison sociale et l'adresse, liens KBO et Companyweb), régime TVA de vente, drapeaux (VIP, détaxé, à surveiller avec motif, en compte, bloqué, mode HT), intérêts (Route/Sport/Off-road/Piste), **modèles Ducati suivis**, préférence neuf/occasion, lien My Ducati. |
| Fiche → section Permis & ID | Photos recto/verso (caméra, galerie, glisser-déposer), **lecture automatique par Claude** (`read-id-doc`) qui remplit les champs. |
| Fiche → barre d'actions | Étiquette client (impression), Nouveau document de vente, Fusionner avec une autre fiche, Archiver / Réactiver, Supprimer (seulement une fiche vierge et seulement pour un admin ; sinon proposition d'archiver). Pop-up à l'ouverture si le client est débiteur. |
| Fiche → onglet Parc | Motos du client (actuelles et passées), y compris celles de la fiche liée pro/privé. |
| Fiche → onglet Documents | Factures, devis, tickets du client. |
| Fiche → onglet Échéances | Montants restant dus ; barre d'encours (autorisé / actuel / disponible). |
| Fiche → onglet Livraisons | Adresses de livraison (ajout, modification, suppression). |
| Fiche → onglet Contacts | Sous-contacts d'une entreprise (nom, rôle, téléphone, e-mail) et **fiches liées** (au plus 2). |
| Fiche → onglet Tarifs | Règles de prix propres au client (table `client_price_rules`). ⚠️ voir §7 : ces règles ne sont lues nulle part. |
| Fiche → onglet GED | Pièces jointes du client (voir M9). |
| Fiche → onglet Historique | Échanges mail / appel / SMS / notes, et réponse par e-mail (voir M10). |
| Clients → Tarifs client (`/client-pricing`) | Définir des remises par client (%, coefficient, paliers de quantité) par article ou catégorie, et **simuler** le prix obtenu. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.clients.tsx` (layout), `_app.clients.index.tsx`, `_app.clients.new.tsx`, `_app.clients.$contactId.tsx`, `_app.client-pricing.tsx` |
| Accès aux données, fusion, doublons, suppression | `src/modules/contacts/api.ts` |
| Formulaire de fiche | `src/modules/contacts/contact-form.tsx` (`buildPayload` l. 313) |
| Onglets de la fiche | `src/modules/contacts/client-tabs.tsx`, `contact-links-panel.tsx`, `subobjects-api.ts` |
| Actions groupées | `src/modules/contacts/bulk-actions-bar.tsx`, `bulk-api.ts` |
| Permis & carte d'identité | `src/modules/contacts/id-docs.tsx`, `id-docs-data.ts` |
| TVA / VIES | `src/modules/contacts/vies-api.ts` |
| Tarifs client | `src/modules/contacts/pricing.ts` |
| Étiquette client | `src/modules/contacts/contact-label-dialog.tsx`, `contact-label-data.ts` |
| Badges de modèles suivis | `src/modules/contacts/model-interest-badges.tsx` |
| Téléphone avec indicatif | `src/components/phone-input.tsx`, `src/lib/dial-codes.ts` |
| Tables | `contacts` (la fiche, ~120 colonnes), `contact_links` (paire pro ↔ privé), `contact_subcontacts` (interlocuteurs), `delivery_addresses` (adresses de livraison), `customer_price_rules` (remises utilisées par le simulateur), `client_price_rules` (onglet Tarifs, non exploité), `contact_merge_candidates` (rapprochements proposés par la relève mail, 2 lignes), `contact_accounts` (compte de connexion du client, voir M0), `vehicle_owners` (lien client ↔ moto, M3) |
| Fonctions SQL (RPC) | `contacts_search`, `contacts_search_count` (liste + recherche), `contacts_find_duplicates` (doublon strict), `contacts_match_candidates` (rapprochement souple, relève mail), `contact_dependencies`, `contact_delete_safe`, `contact_encours`, `next_contact_code` + déclencheur `set_contact_code` (`trg_contacts_code`), `resolve_customer_price`, `create_prospect_from_email` (voir M10) |
| Fonctions serveur (Edge) | `supabase/functions/vies-check` (TVA), `supabase/functions/read-id-doc` (lecture du permis / de la carte par Claude) |
| Tâches planifiées | aucune |
| Migrations clés | `20260610110000_m1_contacts.sql`, `20260610130000_m1_contacts_complete.sql`, `20260610190000_m1_client_subobjects.sql`, `20260612200000_m1_customer_pricing.sql`, `20260612340000_m1_contacts_search.sql`, `20260613400000_m1_contact_links.sql`, `20260629100000_m1_contacts_enhancements.sql`, `20260911120000_m1_contact_code_dedup_delete.sql`, `20260911170000_contact_links_unique_pair.sql`, `20260914150000_m1_new_client_foundations.sql`, `20260914200000_m1_contacts_sort_recent.sql` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `contacts`, `pricing`, `labels` |
| Tests | `tests/vies.test.ts`, `tests/id-docs.test.ts`, `tests/contact-label.test.ts`, `tests/dial-codes.test.ts` |

## 4. Règles métier et décisions

- **Statuts** : `prospect / client / client_piece / client_atelier` (énum `contact_status`). Tout nouvel arrivant entre en **prospect** (décision D2 du 14/09).
- **Tri du fichier G8 (D2)** : un contact avec au moins une facture devient client, les autres restent prospects. **Pas encore appliqué** : les 8 108 fiches sont toutes `prospect` en base.
- **Doublons (D3)** : c'est l'adresse e-mail qui décide si un contact est nouveau ; en cas de ressemblance on **propose** une fusion, validée à la main, jamais automatique. 84 adresses sont partagées légitimement (couple, famille, société).
- **Code client** : attribué par la base à l'insertion (`trg_contacts_code`), jamais saisi.
- **Suppression** : physique seulement si la fiche n'a aucune dépendance (`contact_dependencies` suit les vraies clés étrangères) et seulement pour un admin (`contact_delete_safe`). Sinon on archive (`is_active = false`). Règle 4 de `CLAUDE.md`.
- **Fusion** : réassigne `contact_id` table par table (`MERGE_TABLES` dans `api.ts`) puis archive la fiche absorbée. Pas de suppression.
- **Fiches liées** : au plus 2 (`LINK_LIMIT`), paire unique garantie en base (`uq_contact_links_pair`).
- **Permis A2** : conditionne le bridage (lien DOC006, voir M9) — le lien n'est pas encore exploité.
- **Pas de `null` explicite** sur une colonne NOT NULL avec défaut (`contacts.country`) : cause d'un incident du 14/09 (`etat-projet.md`, `plan-nouveau-client.md`).
- **RGPD** : le consentement marketing se recueille au formulaire d'inscription, pas dans la fiche créée automatiquement ; champ `marketing_opt_out`.

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base.

- ✅ Toutes les colonnes envoyées par le formulaire (`buildPayload`) existent dans `contacts`. Les fiches sont enregistrables depuis le 11/09 (migration `20260629100000` appliquée ce jour-là).
- ✅ Tables et fonctions utilisées par le code : toutes présentes (`contacts`, `contact_links`, `contact_subcontacts`, `delivery_addresses`, `customer_price_rules`, `client_price_rules`, `vehicle_owners`, et les RPC listées en §3).
- ✅ Chiffres : 8 108 fiches (6 187 particuliers, 1 820 professionnels, 101 fournisseurs) ; origine `import_g8` 8 084, `mail` 13, `web` 1, vide 10 (fiches saisies à la main : le formulaire ne pose pas `origin = manuel`).
- ✅ `read-id-doc` fonctionne depuis la pose de `ANTHROPIC_API_KEY` le 14/09.
- 🔴 **`contacts_search` est exécutable sans être connecté** (droit `anon`) et sa garde laisse passer un appel anonyme (`auth.uid() is null or is_member(...)`). Quiconque connaît le `company_id` peut lire **tout le fichier client** (y compris registre national et n° de carte d'identité). Le `company_id` devient public dès qu'une boutique est publiée (voir M11). Même défaut, sans garde du tout, pour `contact_encours` (limite de crédit et encours d'un client).
- 🔴 **`read-id-doc` est déployée sans vérification de jeton** (`verify_jwt = false`) et ne contrôle pas l'appelant : elle télécharge avec la clé service role n'importe quel chemin de la GED qu'on lui donne et en renvoie les données d'identité extraites.
- ⚠️ Migrations du dépôt absentes de la base mais sans effet, car aucun code ne s'en sert : `20260613300000_m1_contacts_private_block` (colonnes `contacts.private_*` et `vehicle_owners.owner_kind` absentes, confirmé le 18/09) et la fonction SQL `vies_check` de `20260719090000_m1_vies_check` (absente, remplacée par l'Edge Function `vies-check`).

## 6. Prévu / en cours

Tout est dans [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md) :
- écran de revue des rapprochements proposés (`contact_merge_candidates`) et traitement des 28 vrais doublons d'e-mail (lots 0 et 1) ;
- tri du fichier G8 : passage en « client » des contacts facturés (lot 5, décision D2) ;
- inscription autonome en mode borne sur tablette (lot 4, CON001) ;
- portail client (lot 3).

## 7. Limites connues, dettes, pièges

- **Deux tables de tarifs client pour un même besoin.** L'onglet Tarifs de la fiche écrit dans `client_price_rules`, que **rien ne lit**. L'écran « Tarifs client » écrit dans `customer_price_rules`, lue par `resolve_customer_price`, mais **ni le POS ni l'éditeur de ventes n'appellent cette fonction** : les remises client ne s'appliquent jamais automatiquement à une vente (CRM009 non tenu).
- **Fusion incomplète.** `MERGE_TABLES` oublie `contact_links`, `contact_accounts`, `contact_merge_candidates`, `part_orders`, `excel_order_lines`, et les pièces jointes GED (`attachments` avec `entity_type = 'contact'`). Ces éléments restent sur la fiche archivée. La fusion n'est pas transactionnelle : un échec partiel est rendu dans `failed` mais la fiche est archivée quand même.
- **Sélection des actions groupées limitée à la page affichée** (choix assumé, 11/09).
- `listContacts` (utilisé par la recherche globale et le matching M10) plafonne à **500** fiches.
- La limite de crédit n'est **pas bloquante** à la facturation : seule une alerte débiteur s'affiche à l'ouverture de la fiche (`getDebtorsList`).
- `contact-form.tsx` (1 154 lignes) lit certaines colonnes via `as any` : `types.ts` n'est pas régénéré pour toutes les colonnes récentes.
- Onglets de la fiche libellés en dur (« Fiche », « Parc », « Documents »…) dans `_app.clients.$contactId.tsx`, contraire à la règle i18n.
- Saisie forcée en MAJUSCULES sur tous les champs sauf e-mails (décision du 17/07, commit `5bcb9ff`).

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| CON000 | Paramétrage standard | ✅ fait | référentiels `civility`, `client_category`, `payment_term`, `country` dans `reference-tables.ts` |
| CON001 | Saisie autonome sur tablette/borne | ⬜ manquant | lot 4 de `plan-nouveau-client.md`, aucun écran |
| CON002 | Naissance, carte d'identité, registre national, permis | ✅ fait | `contact-form.tsx`, `id-docs.tsx`, `read-id-doc` |
| CON003 | TVA intracom, conditions de paiement, domiciliation, limite de crédit | 🟦 partiel | champs + VIES (`vies-api.ts`) + encours (`contact_encours`, `EncoursBar`) ; pas de blocage à la facturation |
| CON004 | Catégoriser par intérêt moto et statut commercial | ✅ fait | `interests`, `model_interests`, `status`, drapeaux, `segment` |
| CON005 | Import de la base G8 | ✅ fait | 8 084 fiches `origin = import_g8` ; M14 |
| CON006 | Lien bidirectionnel client ↔ véhicule | ✅ fait | `ParcTab` (`client-tabs.tsx`), `vehicle_owners`, onglet Propriétaires côté M3 |
| CON007 | Alerte client quand un véhicule correspondant arrive | voir M10 | `src/modules/crm/matching-api.ts` |
| CRM009 | Listes de prix VIP vs standard | 🟦 partiel | `customer_price_rules` + simulateur `/client-pricing` ; non appliqué aux ventes |
| CRM010 | Alias mail pour routage vers les bons services | 🟦 partiel | 4 boîtes relevées (`company_mailboxes`), pas de routage par service (voir M10) |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-10 | Module Contacts : fiche moto, permis A2, B2B/encours, drapeaux | `3dc73d7`, migrations `20260610110000`, `20260610130000` |
| 2026-06-10 | Parité champs G8 (statut, bloqué, HT, RGPD, compta) | `43c3f44`, `8caf36c` |
| 2026-06-11 | Onglets Parc, Livraisons, Tarifs ; sous-contacts B2B ; encours | `5b4c831`, `1f144f6`, `e317794` |
| 2026-06-12 | Moteur de tarifs clients (remise, coefficient, paliers) | `c73e06b`, migration `20260612200000` |
| 2026-06-22 | Recherche insensible aux accents, pagination | `1e5b7d0`, `2d7f791` |
| 2026-06-29 | Fiche en 3 sous-onglets, liaison pro ↔ privé, modèles suivis, My Ducati | `00ce7e8`, `289d121`, `3e0425a`, `7cb0b4c` |
| 2026-07-17 | Vérification TVA VIES ; permis & ID avec lecture automatique ; indicatifs téléphoniques | `fd54212`, `78ae8c8`, `ded9973` |
| 2026-07-25 | Étoile VIP, motif de surveillance, limite 2 fiches liées, pop-up débiteur | `bda3c76`, `735aff7` |
| 2026-07-27 | Archiver / fusionner une fiche | `ec38231` |
| 2026-09-11 | Fiches à nouveau enregistrables (migration `20260629100000` appliquée) | migration `20260629100000` |
| 2026-09-11 | Code client automatique, anti-doublons, suppression sûre ; actions groupées ; VIES via Edge Function | `78d074d`, `183f35b`, `9ace512`, migrations `20260911120000`, `20260911170000` |
| 2026-09-14 | Origine des fiches, prospects créés depuis un mail, tri par date d'arrivée | `b9022cb`, `a271cf4`, migrations `20260914150000` à `20260914230000` |
