---
chapitre: M1
titre: Contacts / clients
etat: ✅
verifie_le: 2026-09-18
missions: [04]
mots_cles: [client, civilité, forme juridique, code postal, localité, mobile, SMS, IBAN, lieu de naissance, mobiles à compléter, prospect, fournisseur, fiche client, code client, doublon, fusion, archiver, VIP, surveillance, bloqué, permis, carte d'identité, registre national, TVA, VIES, encours, limite de crédit, tarifs client, fiche liée, pro, privé, parc, étiquette client, My Ducati]
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
| Clients → liste → cases à cocher | **Actions groupées** sur la page affichée : archiver / réactiver, changer le statut, poser ou retirer VIP / surveillance / bloqué / opt-out marketing, lier des fiches, fusionner (**admins seulement**). |
| Fusion (liste ou fiche) | On coche la fiche **gardée** ; avant de valider, un récapitulatif dit quelle fiche est gardée, lesquelles sont archivées, et ce qui sera rapatrié (documents, motos, échanges, pièces jointes, OR, rendez-vous, cartes CRM, autres). Les blocages (deux comptes client, deux soldes d'ouverture G8) sont affichés et le bouton reste grisé. Tout ou rien : un refus ne modifie rien. |
| Clients → Nouveau (`/clients/new`) | Créer une fiche **en deux temps** (mission 04) : l'essentiel (type, forme juridique, civilité, nom, prénom, mobile, e-mail, adresse) puis « Compléter la fiche », replié. Avant création : si l'**e-mail ou le numéro** existe déjà (ou une fiche strictement identique), fenêtre avec « Ouvrir la fiche » par ligne ou « Créer quand même » (D3). Code postal belge → localité proposée. Code client attribué automatiquement par la base. |
| Clients → Mobiles à compléter (`/clients/mobiles`) | (mission 04) Fiches actives sans mobile dont le téléphone G8 est un GSM belge ; bouton « Utiliser comme mobile » par ligne, tracé. |
| Clients → fiche (`/clients/$contactId`) → onglet Fiche | Trois sous-onglets Info privée / Info pro / Info chez Ducati. Identité, permis (n°, date, lieu, catégorie A/A2…), carte d'identité, registre national, adresse, téléphones avec indicatif pays, e-mails, conditions de paiement, IBAN/BIC, limite de crédit, TVA (**bouton de vérification VIES** qui préremplit la raison sociale et l'adresse, liens KBO et Companyweb), régime TVA de vente, drapeaux (VIP, détaxé, à surveiller avec motif, en compte, bloqué, mode HT), intérêts (Route/Sport/Off-road/Piste), **modèles Ducati suivis**, préférence neuf/occasion, lien My Ducati. |
| Fiche → section Permis & ID | Photos recto/verso (caméra, galerie, glisser-déposer), **lecture automatique par Claude** (`read-id-doc`) qui remplit les champs. |
| Fiche → barre d'actions | Étiquette client (impression), Nouveau document de vente, Fusionner une autre fiche dans celle-ci (admin), Archiver / Réactiver, Supprimer (seulement une fiche vierge et seulement pour un admin ; sinon proposition d'archiver). Pop-up à l'ouverture si le client est débiteur. |
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
| Accès aux données, fusion, doublons, suppression | `src/modules/contacts/api.ts` (`mergeContacts`, `getMergePreview`, `mergeErrorMessage` appellent les RPC de fusion) |
| Récapitulatif avant fusion | `src/modules/contacts/merge-summary.tsx` (`useMergePreviews`, `MergeSummary`), utilisé par `bulk-actions-bar.tsx` et `_app.clients.$contactId.tsx` |
| Formulaire de fiche | `src/modules/contacts/contact-form.tsx` (`buildPayload`) ; civilité / forme juridique : `civility.ts` ; mobiles à compléter : `mobile-fix.tsx` + route `_app.clients.mobiles.tsx` |
| Normalisation mobile, e-mail, IBAN | `src/lib/contact-normalize.ts` (`normalizeMobile`, `normalizeEmail`, `belgianGsmFromPhone`, `isValidIban`) |
| Code postal → localité | `src/components/zip-city-suggest.tsx` (fiche client et « Mon profil »), table `be_postal_codes` |
| Onglets de la fiche | `src/modules/contacts/client-tabs.tsx`, `contact-links-panel.tsx`, `subobjects-api.ts` |
| Actions groupées | `src/modules/contacts/bulk-actions-bar.tsx`, `bulk-api.ts` |
| Permis & carte d'identité | `src/modules/contacts/id-docs.tsx`, `id-docs-data.ts` |
| TVA / VIES | `src/modules/contacts/vies-api.ts` |
| Tarifs client | `src/modules/contacts/pricing.ts` |
| Étiquette client | `src/modules/contacts/contact-label-dialog.tsx`, `contact-label-data.ts` |
| Badges de modèles suivis | `src/modules/contacts/model-interest-badges.tsx` |
| Téléphone avec indicatif | `src/components/phone-input.tsx`, `src/lib/dial-codes.ts` |
| Tables | `contacts` (la fiche, ~120 colonnes), `contact_links` (paire pro ↔ privé), `contact_subcontacts` (interlocuteurs), `delivery_addresses` (adresses de livraison), `customer_price_rules` (remises utilisées par le simulateur), `client_price_rules` (onglet Tarifs, non exploité), `contact_merge_candidates` (rapprochements proposés par la relève mail, 2 lignes), `contact_accounts` (compte de connexion du client, voir M0), `vehicle_owners` (lien client ↔ moto, M3) |
| Fonctions SQL (RPC) | `contacts_search`, `contacts_search_count` (liste + recherche), `contacts_find_duplicates` (doublon strict), `contacts_match_candidates` (rapprochement souple, relève mail), `contact_dependencies`, `contact_delete_safe`, `contact_encours`, `next_contact_code` + déclencheur `set_contact_code` (`trg_contacts_code`), `resolve_customer_price`, `create_prospect_from_email` (voir M10), `contacts_find_by_email_or_mobile` + `contact_phone_key` (doublon e-mail/numéro), `contacts_phone_gsm_candidates` + `contact_use_phone_as_mobile` + `contact_be_gsm` (mobiles à compléter), `iban_is_valid`, déclencheur `trg_contacts_normalize_email`, **`contact_merge`** (la fusion), `contact_merge_preview` (récapitulatif et blocages), `contact_merge_refs` (inventaire interne des références, non exécutable par les utilisateurs) |
| Fonctions serveur (Edge) | `supabase/functions/vies-check` (TVA), `supabase/functions/read-id-doc` (lecture du permis / de la carte par Claude) |
| Tâches planifiées | aucune |
| Migrations clés | `20260610110000_m1_contacts.sql`, `20260610130000_m1_contacts_complete.sql`, `20260610190000_m1_client_subobjects.sql`, `20260612200000_m1_customer_pricing.sql`, `20260612340000_m1_contacts_search.sql`, `20260613400000_m1_contact_links.sql`, `20260629100000_m1_contacts_enhancements.sql`, `20260911120000_m1_contact_code_dedup_delete.sql`, `20260911170000_contact_links_unique_pair.sql`, `20260914150000_m1_new_client_foundations.sql`, `20260914200000_m1_contacts_sort_recent.sql`, `20260919140000_m1_contact_merge.sql` (fusion), mission 04 : `20260919260000_m1_doublon_email_mobile.sql`, `20260919261000_m1_forme_juridique.sql`, `20260919262000_m1_mobile_depuis_telephone.sql`, `20260919263000_m1_email_minuscules.sql`, `20260919264000_ref_codes_postaux_be.sql`, `20260919265000_m1_portail_iban_naissance.sql` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `contacts`, `pricing`, `labels` |
| Tests | `tests/vies.test.ts`, `tests/id-docs.test.ts`, `tests/contact-label.test.ts`, `tests/dial-codes.test.ts`, `tests/contact-normalize.test.ts`, `tests/civility.test.ts` |

## 4. Règles métier et décisions

- **Statuts** : `prospect / client / client_piece / client_atelier` (énum `contact_status`). Tout nouvel arrivant entre en **prospect** (décision D2 du 14/09).
- **Tri du fichier G8 (D2)** : un contact avec au moins une facture devient client, les autres restent prospects, fournisseurs exclus. **Appliqué le 18/09/2026** (migration `20260919160000_d2_contacts_client_status.sql`) : **4 165 fiches** passées de `prospect` à `client`.
  - **Définition de « facture »** : une ligne de `documents` avec `doc_type = 'FAC'`, hors `brouillon` et `annulee`, de la même société que la fiche — factures reprises de G8 (`imported_from = 'G8'`) comme factures créées dans le DMS. Les avoirs (`AVO`) et tickets (`TIK`) ne comptent pas (aucune fiche n'a un avoir sans facture ; 1 seul ticket, sans client). Les factures à 0 € comptent.
  - Détail : 4 164 fiches facturées par G8 + 1 fiche de démonstration (« SIMON MOREAU », code 9206, factures `FAC-DEMO-001/002` du DMS). Aucun fournisseur, aucune fiche archivée parmi elles.
  - **Résultat** (8 110 fiches) : `client` 4 165 (3 065 particuliers, 1 100 professionnels) ; `prospect` 3 945 (3 124 particuliers, 720 professionnels, 101 fournisseurs).
  - **Pas de mise à jour automatique** : une fiche `prospect` qui reçoit sa première facture dans le DMS **reste** `prospect` tant qu'on ne change pas son statut (à décider : déclencheur à la validation d'une facture ?).
  - Retour arrière : ancien statut archivé dans `archive_d2_20260918.contacts_status` (schéma non exposé) ; script `supabase/rollbacks/20260919160000_d2_contacts_client_status_ROLLBACK.sql` (non appliqué). Trace : une ligne `events` par fiche (audit) + une ligne de synthèse `d2_client_status`.
- **Doublons (D3)** : c'est l'adresse e-mail qui décide si un contact est nouveau ; en cas de ressemblance on **propose** une fusion, validée à la main, jamais automatique. 84 adresses sont partagées légitimement (couple, famille, société).
- **Civilité / forme juridique (mission 04, carte 2)** : `civility` = civilité de la **personne** (valeurs `Monsieur`, `Madame`, `Mx`, affichées M. / Mme / Mx) ; `legal_form` = forme juridique d'un pro, choisie dans la table de référence `civility` (lignes `professional = true`). Les 1 210 fiches G8 dont la civilité était une forme juridique ont été copiées dans `legal_form` le 19/09 ; leur `civility` garde l'ancienne valeur (non affichée, jamais effacée par le formulaire).
- **Mobile (carte 3)** : un seul mobile, celui des SMS, enregistré au format international (`+32…`). Le « téléphone » G8 n'est plus modifié par le formulaire. Les GSM rangés dans « téléphone » se reprennent fiche par fiche (« Mobiles à compléter »), jamais en masse.
- **E-mail (carte 4)** : minuscules et sans espaces, garanti par la base (déclencheur à l'insertion et quand l'e-mail change) ; les anciens e-mails ne sont pas réécrits.
- **IBAN (carte 5)** : contrôle modulo 97 à la saisie (fiche) et en base (espace client) ; ouvert aux particuliers. Un changement d'IBAN par le client est tracé (`events.action = 'portal_iban_changed'`) et signalé dans la cloche (admin, comptable, vendeur).
- **Code client** : attribué par la base à l'insertion (`trg_contacts_code`), jamais saisi.
- **Suppression** : physique seulement si la fiche n'a aucune dépendance (`contact_dependencies` suit les vraies clés étrangères) et seulement pour un admin (`contact_delete_safe`). Sinon on archive (`is_active = false`). Règle 4 de `CLAUDE.md`.
- **Fusion (F-9, F-10, D3)** : fonction SQL `contact_merge(_keep, _absorb)`, **une transaction** (tout ou rien), réservée aux **administrateurs**, les deux fiches de la **même société**, jamais une fiche avec elle-même. Italbike fusionne lui-même ses doublons (F-10) ; jamais de fusion automatique (D3).
  - **Tout** ce qui pointe vers le doublon passe sur la fiche gardée : `documents`, `vehicle_owners`, `communications`, `attachments` (GED, `entity_type = 'contact'`), `repair_orders`, `workshop_appointments`, `leads` (et donc leurs `lead_tasks`), `sepa_mandates`, `delivery_addresses`, `contact_subcontacts`, `client_price_rules`, `customer_price_rules`, `consignments.depositor_id`, `purchase_orders.supplier_id`, `articles.main_supplier_id` / `reprise_supplier_id`, `article_suppliers`, `part_orders`, `part_order_lines.supplier_id`, `excel_order_lines`, `contact_links`, `contact_invitations`, `contact_merge_candidates`, `contact_accounts`, `contact_declared_vehicles`, `portal_uploads` (`contact_id` et `entity_id`), `notifications` (`entity_type = 'contact'`).
  - **Filet de sécurité** : après les déplacements, la fonction relit les vraies clés étrangères vers `contacts` ; s'il reste une référence (table ajoutée plus tard et oubliée ici), elle **annule tout** (`MERGE_UNHANDLED_REFERENCE`). Toute nouvelle table qui pointe vers un contact doit être ajoutée à `contact_merge` et à `contact_merge_refs`.
  - **Doublons évités** : lien pro ↔ privé entre les deux fiches supprimé, lien déjà présent côté gardée supprimé ; fournisseur d'article déjà présent supprimé ; même moto possédée des deux côtés → une seule ligne, avec la date de début la plus ancienne ; rapprochement proposé entre les deux fiches supprimé (résolu par la fusion). Le contenu de chaque ligne supprimée est gardé dans la trace.
  - **Cartes CRM** : une seule carte ouverte par fiche et par pipeline. Si la gardée en a déjà une, la carte ouverte du doublon est **archivée** (motif « Fusion de fiches… ») ; sa tâche en cours passe sur la carte gardée si celle-ci n'en a pas.
  - **Refus** (rien n'est modifié) : les deux fiches ont chacune un compte client de l'application (`MERGE_BOTH_ACCOUNTS`) ; les deux ont un solde d'ouverture G8 (`MERGE_BOTH_OPENING_BALANCE`).
  - **Champs** : les champs **vides** de la gardée sont complétés par le doublon, jamais écrasés (liste des colonnes lue dans le schéma). Valeurs par défaut traitées comme vides : statut `prospect`, segment `standard`, limite de crédit et solde d'ouverture à 0. VIP, bloqué, surveillance et opt-out marketing : posés si l'un des deux l'est. Intérêts et modèles suivis : réunis. Coordonnées différentes (e-mails, téléphones, adresse) et notes du doublon recopiées dans les notes de la gardée. La gardée est active si l'une des deux l'était.
  - **Doublon** : **archivé** (jamais supprimé), note « Fiche fusionnée le … dans la fiche … », et ses e-mails vidés (ils sont sur la gardée) pour que la relève mail et l'inscription, qui cherchent par e-mail sans filtrer les archivées, ne s'y rattachent plus.
  - **Trace** : deux lignes `events` (`merge` sur la gardée, `merged_into` sur le doublon) : auteur, date, les deux fiches avant fusion, ce qui a été déplacé table par table, les lignes dédoublonnées, les cartes archivées, la fiche gardée après fusion. L'historique `events` du doublon reste sous son identifiant.
- **Fiches liées** : au plus 2 (`LINK_LIMIT`), paire unique garantie en base (`uq_contact_links_pair`).
- **Permis A2** : conditionne le bridage (lien DOC006, voir M9) — le lien n'est pas encore exploité.
- **Pas de `null` explicite** sur une colonne NOT NULL avec défaut (`contacts.country`) : cause d'un incident du 14/09 (`etat-projet.md`, `plan-nouveau-client.md`).
- **RGPD** : le consentement marketing se recueille au formulaire d'inscription, pas dans la fiche créée automatiquement ; champ `marketing_opt_out`.

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base.

- ✅ Toutes les colonnes envoyées par le formulaire (`buildPayload`) existent dans `contacts`. Les fiches sont enregistrables depuis le 11/09 (migration `20260629100000` appliquée ce jour-là).
- ✅ Tables et fonctions utilisées par le code : toutes présentes (`contacts`, `contact_links`, `contact_subcontacts`, `delivery_addresses`, `customer_price_rules`, `client_price_rules`, `vehicle_owners`, et les RPC listées en §3).
- ✅ Statuts (18/09, après D2) : 4 165 `client`, 3 945 `prospect` (dont les 101 fournisseurs), aucun `client_piece` / `client_atelier`.
- ✅ Chiffres : 8 108 fiches au scan du 18/09, 8 110 à l'application de D2 (6 189 particuliers, 1 820 professionnels, 101 fournisseurs) ; origine `import_g8` 8 084, `mail` 13, `web` 1, vide 10 (fiches saisies à la main : le formulaire ne pose pas `origin = manuel`).
- ✅ `read-id-doc` fonctionne depuis la pose de `ANTHROPIC_API_KEY` le 14/09.
- 🔴 **`contacts_search` est exécutable sans être connecté** (droit `anon`) et sa garde laisse passer un appel anonyme (`auth.uid() is null or is_member(...)`). Quiconque connaît le `company_id` peut lire **tout le fichier client** (y compris registre national et n° de carte d'identité). Le `company_id` devient public dès qu'une boutique est publiée (voir M11). Même défaut, sans garde du tout, pour `contact_encours` (limite de crédit et encours d'un client).
- 🔴 **`read-id-doc` est déployée sans vérification de jeton** (`verify_jwt = false`) et ne contrôle pas l'appelant : elle télécharge avec la clé service role n'importe quel chemin de la GED qu'on lui donne et en renvoie les données d'identité extraites.
- ⚠️ Migrations du dépôt absentes de la base mais sans effet, car aucun code ne s'en sert : `20260613300000_m1_contacts_private_block` (colonnes `contacts.private_*` et `vehicle_owners.owner_kind` absentes, confirmé le 18/09) et la fonction SQL `vies_check` de `20260719090000_m1_vies_check` (absente, remplacée par l'Edge Function `vies-check`).

## 6. Prévu / en cours

Tout est dans [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md) :
- écran de revue des rapprochements proposés (`contact_merge_candidates`) et traitement des 28 vrais doublons d'e-mail (lots 0 et 1) ;
- ~~tri du fichier G8 : passage en « client » des contacts facturés (lot 5, décision D2)~~ fait le 18/09 ;
- passage automatique en « client » à la première facture validée dans le DMS (non décidé) ;
- inscription autonome en mode borne sur tablette (lot 4, CON001) ;
- portail client (lot 3).

## 7. Limites connues, dettes, pièges

- **Deux tables de tarifs client pour un même besoin.** L'onglet Tarifs de la fiche écrit dans `client_price_rules`, que **rien ne lit**. L'écran « Tarifs client » écrit dans `customer_price_rules`, lue par `resolve_customer_price`, mais **ni le POS ni l'éditeur de ventes n'appellent cette fonction** : les remises client ne s'appliquent jamais automatiquement à une vente (CRM009 non tenu).
- **Fusion — corrigée le 19/09** (voir §4). Avant, la fusion se faisait dans le navigateur table par table (`MERGE_TABLES`) : elle oubliait les pièces jointes GED, les fiches liées, le compte client, les rapprochements, les cartes CRM en double, les commandes pièces, les fournisseurs d'articles, les dépôts-ventes, etc. ; elle n'était pas transactionnelle (fiche archivée même après un échec) et tout membre de la société pouvait fusionner. Les fusions faites avant le 19/09 ont pu laisser des éléments sur des fiches archivées.
- **Nouvelle table qui pointe vers un contact** : l'ajouter à `contact_merge` (et à `contact_merge_refs` pour le récapitulatif), sinon toute fusion d'une fiche qui y a des lignes sera **refusée** par le filet de sécurité (voulu : mieux vaut un refus qu'une donnée orpheline).
- **Fusion et limite de 2 fiches liées** : la fusion ne vérifie pas `LINK_LIMIT` ; la fiche gardée peut se retrouver avec 3 ou 4 liens si les deux fiches en avaient.
- **Carte CRM archivée par la fusion** : si les deux cartes avaient une tâche en cours, celle du doublon reste sur la carte archivée (comme le bouton Archiver du CRM, qui ne ferme pas les tâches).
- **Sélection des actions groupées limitée à la page affichée** (choix assumé, 11/09).
- `listContacts` (utilisé par la recherche globale et le matching M10) plafonne à **500** fiches.
- La limite de crédit n'est **pas bloquante** à la facturation : seule une alerte débiteur s'affiche à l'ouverture de la fiche (`getDebtorsList`).
- `contact-form.tsx` (1 154 lignes) lit certaines colonnes via `as any` : `types.ts` n'est pas régénéré pour toutes les colonnes récentes.
- Onglets de la fiche libellés en dur (« Fiche », « Parc », « Documents »…) dans `_app.clients.$contactId.tsx`, contraire à la règle i18n.
- Saisie forcée en MAJUSCULES sur tous les champs sauf e-mails (décision du 17/07, commit `5bcb9ff`).
- **Codes postaux** : jeu de 2020 (jief/zipcode-belgium, d'après bpost), sans écran d'import ; un code créé depuis n'est pas proposé (la ville reste saisissable à la main).
- **Doublon d'e-mail ne différant que par la casse** : fiches 231 et 8293 (GILSON) — à fusionner à la main.
- `civility` des fiches pro reprises de G8 contient encore la forme juridique (copiée dans `legal_form`) : ne pas s'en servir pour une formule de politesse sans passer par `personCivility()`.

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
| 2026-09-18 | **Décision D2 appliquée** : 4 165 fiches ayant au moins une facture (`FAC`, G8 ou DMS) passées de `prospect` à `client` ; ancien statut archivé, retour arrière prêt | branche `lot-notif-tri`, migration `20260919160000_d2_contacts_client_status.sql` (appliquée le 18/09), rollback `supabase/rollbacks/20260919160000_d2_contacts_client_status_ROLLBACK.sql` |
| 2026-09-19 | **Mission 04, cartes 1 à 5** : fiche en deux temps + doublon e-mail/numéro ; civilité M./Mme/Mx et forme juridique séparée (1 210 fiches copiées) ; mobile au format international, « Mobiles à compléter », téléphone G8 plus effacé ; e-mail en minuscules (déclencheur) ; codes postaux belges → localité ; lieu de naissance, IBAN/BIC/TVA pour les particuliers, IBAN modifiable dans l'espace client avec alerte | branche `lot-m4-client`, commits `f8dfa48` à `8966f82`, migrations `20260919260000` à `20260919265000` (appliquées le 19/09) |
| 2026-09-19 | **Fusion de fiches réécrite** : une fonction SQL transactionnelle réservée aux admins, qui rapatrie toutes les références (27 tables et colonnes), gère les doublons, complète les champs vides, trace dans `events` ; récapitulatif avant fusion | migration `20260919140000_m1_contact_merge.sql` (appliquée en base le 18/09) |
| 2026-09-19 | Fiche client : « Encours financier » en haut à droite avec le **reste à payer en grand** (documents ouverts, financement accepté déduit, à recevoir des organismes), onglet Documents avec reste à payer, badge de financement et règlements sous chaque document, bouton « Préparer » (mission 05, cartes 6 et 9, voir M06) | `20260919312000_m6_financement_reste_a_payer.sql` |
