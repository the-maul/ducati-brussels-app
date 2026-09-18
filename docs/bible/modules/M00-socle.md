---
chapitre: M0
titre: Socle
etat: 🟦
verifie_le: 2026-09-18
missions: []
mots_cles: [connexion, login, mot de passe, invitation, utilisateur, rôle, admin, société, multi-société, RLS, audit, events, numérotation, séquence, préfixe, paramètres, tables de données, recherche globale, Ctrl+K, sidebar, topbar, cloche, i18n, traduction]
---

# M0 — Socle

> **En une phrase** : les fondations communes à tous les écrans — qui se connecte, pour quelle société, avec quels droits, comment tout est tracé, numéroté et paramétré.

## 1. À quoi ça sert

Le socle n'est pas un « module métier » : c'est ce que tous les autres consomment.
Il gère la connexion des utilisateurs, les deux sociétés du groupe (**ITALBIKE STORE** et **NL INVEST**)
et la bascule de l'une à l'autre, les rôles (administrateur, vendeur, magasinier, mécanicien, chef
d'atelier, comptable, marketing), la trace de chaque modification (table `events`), la numérotation
des documents par société, les tables de paramètres (TVA, modes de règlement, civilités…), la
recherche globale et l'habillage de l'application (barre latérale, barre du haut, libellés FR).
Il est utilisé par tout le monde ; les écrans d'administration sont réservés aux administrateurs.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| `/login` | Se connecter par e-mail + mot de passe. Redirige vers le tableau de bord. |
| `/reset-password` | Choisir son mot de passe depuis le lien d'invitation (jeton à usage unique, consommé seulement à la validation), ou le changer une fois connecté. Un compte **client** voit un message d'attente (portail pas encore construit). |
| Barre du haut → menu utilisateur | Voir ses rôles, « Changer mon mot de passe », se déconnecter. |
| Barre du haut → sélecteur de société | Basculer entre ITALBIKE STORE et NL INVEST (mémorisé dans le navigateur). |
| Barre du haut → recherche (Ctrl/⌘+K) | Rechercher clients, véhicules, articles (6 résultats par groupe). Reconnaît un VIN (17 caractères) ou un n° de TVA belge. |
| Barre du haut → cloche | Nombre de demandes CRM en retard ou pour aujourd'hui, liste cliquable (voir M10). |
| Barre latérale | 17 entrées (`src/lib/navigation.ts`). Seules Comptabilité (admin, comptable) et Paramètres (admin) sont filtrées par rôle. |
| Paramètres (admin) → Sociétés | Modifier nom, TVA, adresse, IBAN, Peppol, comptes par défaut, boîte mail historique, arrondi des prix, plancher de prix ; créer une société (RPC `create_company`). Les CGV (`cgv_text`), le pied de facture et le logo n'ont **pas** d'écran : ils se modifient en base. ⚠️ **enregistrement cassé en production**, voir §5. |
| Paramètres → Utilisateurs | Créer un compte **équipe** (rôles par société) ou **client** (rattaché à une fiche, existante ou créée ; refus d'un doublon d'e-mail). Mot de passe fixé par l'admin ou **invitation par e-mail** (Outlook). Modifier les rôles, activer/désactiver, renvoyer l'invitation. Choisir le **responsable par défaut** des nouvelles demandes CRM, avec reprise optionnelle de ses tâches ouvertes. |
| Paramètres → Tables de données | Éditer les 38 référentiels déclarés dans `reference-tables.ts` (TVA, règlements, conditions de paiement, civilités, marques, arrondis, couleurs, tailles, types de cession, pays…). |
| Paramètres → Numérotation des documents | Modifier préfixe, séparateur, longueur, suffixe, remise à zéro annuelle et libellé explicatif de chaque séquence (14 types × 2 sociétés), avec aperçu du prochain numéro. |
| Paramètres → Migration | Import G8 (voir chapitre M14). |
| Paramètres → Extension My Ducati | Télécharger l'extension navigateur et son mode d'emploi. |
| Démo charte (`/demo`) | Page de démonstration du design system, visible dans le menu (entrée marquée `dev`, non masquée en production — à vérifier). |
| Toute l'application | Toast de confirmation ou d'erreur sur chaque enregistrement (`MutationCache` global), bouton à trois états, bouton grisé tant que rien n'a changé. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/login.tsx`, `src/routes/reset-password.tsx`, `src/routes/_app.tsx` (garde de session + habillage), `src/routes/__root.tsx`, `src/routes/index.tsx` (redirige vers `/dashboard`), `src/routes/_app.settings.tsx` (garde admin), `src/routes/_app.settings.index.tsx`, `_app.settings.companies.tsx`, `_app.settings.users.tsx`, `_app.settings.tables.index.tsx`, `_app.settings.tables.$tableKey.tsx`, `_app.settings.numbering.tsx`, `_app.settings.extension.tsx`, `_app.demo.tsx` |
| Session, société active, rôles | `src/lib/auth/auth-context.tsx` |
| Administration des comptes (fonctions serveur, clé service role) | `src/lib/auth/admin.functions.ts` (`listOrgUsers`, `createOrgUser`, `setUserRoles`, `setUserActive`) |
| Logique Paramètres | `src/modules/settings/` (`companies-api.ts`, `sequences-api.ts`, `reference-api.ts`, `reference-tables.ts`, `reference-editor.tsx`, `users-api.ts`) |
| Habillage | `src/components/layout/` (`app-shell.tsx`, `app-sidebar.tsx`, `topbar.tsx`, `page-header.tsx`, `mobile-bottom-nav.tsx`), `src/lib/navigation.ts` |
| Recherche globale | `src/components/global-search.tsx` |
| Retour visuel d'enregistrement | `src/lib/mutation-feedback.ts`, `src/lib/use-save-mutation.ts`, `src/lib/use-dirty.ts` |
| Tables | `companies` (sociétés), `profiles` (profil de chaque compte), `user_roles` (rôle par société), `events` (journal d'audit, 200 000+ lignes), `document_sequences` (28 séquences), `reference_values` (144 valeurs), `contact_accounts` (compte client ↔ fiche) |
| Fonctions SQL (RPC) | `is_member`, `is_admin`, `has_role` (contrôles RLS), `next_document_number`, `_next_document_number_unchecked`, `create_company`, `handle_new_user` (déclencheur : profil à l'inscription), `grant_bootstrap_admin` (déclencheur : admin automatique pour simon@themaul.be), `audit_row` (déclencheur d'audit générique) |
| Fonctions serveur (Edge) | `supabase/functions/send-account-invitation` (invitation par Outlook, admin uniquement) |
| Tâches planifiées | aucune propre au socle |
| Migrations clés | `supabase/migrations/20260610090000_m0_socle.sql`, `20260610100000_m0_bootstrap_admin.sql`, `20260610180000_m0_reference_tables.sql`, `20260610280000_m6_fix_sequences.sql`, `20260610420000_m0_companies_mgmt.sql`, `20260612330000_m0_company_logo.sql`, `20260918140000_m10_users_pipelines_mailbox_summary.sql` (`contact_accounts`) |
| Libellés | `src/lib/i18n/fr.ts`, blocs `app`, `common`, `nav`, `action`, `feedback`, `confirm`, `company`, `search`, `status`, `auth`, `settings`, `users`, `pwd`, `role`, `demo` ; point d'entrée `src/lib/i18n/index.ts` |

## 4. Règles métier et décisions

- **Multi-société (COM005, CLAUDE.md règle 2)** : chaque table métier porte `company_id` ; la RLS est active sur **toutes** les tables publiques (vérifié en base le 18/09 : 80 tables, toutes `rowsecurity = true`). L'accès se résume à `is_member(company_id)` = « l'utilisateur a au moins un rôle dans cette société ».
- **Rôles** : `admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing` (énum `app_role`). Décision client du 18/09 : pas de nouveaux rôles ; commercial = vendeur, technicien = mécanicien / chef d'atelier, manager = admin.
- **Compte client** (18/09) : aucun rôle, donc aucun accès aux données de la concession ; rattaché à sa fiche par `contact_accounts`. Le portail qui lui montrera ses propres données n'existe pas encore.
- **Audit (B7, règle 4)** : le déclencheur `audit_row` écrit dans `events` (qui, quoi, quand, ancien/nouveau). `events` n'accepte ni UPDATE ni DELETE (droits vérifiés). L'origine est toujours `screen`, y compris pour les écritures faites par la relève mail ou un import.
- **Numérotation** : par société et par type, configurable par un non-technicien (exigence client, CLAUDE.md §4.3). Remise à zéro annuelle activée partout.
- **Invitations** envoyées par Outlook, pas par Resend ni par Supabase (décision client D4 du 14/09). Le lien pointe vers `/reset-password` de l'application.
- **Verrou Supabase** : ne jamais appeler Supabase dans `onAuthStateChange` (piège n°7 de `etat-projet.md`) ; le chargement du profil est différé par `setTimeout(0)`.

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base (projet `ujmrosbgkvgvwfnuryna`).

- ✅ Connexion, bascule de société, garde des pages, garde admin sur Paramètres.
- ✅ Création de comptes équipe et client, invitation (`send-account-invitation` déployée, `verify_jwt` actif, contrôle admin dans le code). 4 profils, 14 attributions de rôle, 0 compte client.
- ✅ Numérotation : 28 séquences (14 types × 2 sociétés), écran fonctionnel.
- ✅ Tables de données : 144 valeurs réparties sur 14 référentiels.
- 🔴 **Paramètres → Sociétés ne peut plus rien enregistrer.** Le formulaire envoie toujours `price_floor_threshold` et `price_floor_min` (`_app.settings.companies.tsx` l. 64-65, type dans `companies-api.ts`). Ces colonnes n'existent pas en base (migration `20260714090000_m2_import_settings_ppc_rules` non appliquée). PostgREST rejette tout l'UPDATE (`PGRST204`). Ce cas n'est pas listé dans `etat-projet.md` §2.
- 🔴 **Désactiver un compte ne coupe pas son accès.** `setUserActive` ne modifie que `profiles.is_active`. Ni la connexion ni `is_member` ne lisent ce champ : un salarié « désactivé » garde toutes ses données. Seule la liste des membres CRM (`company_members`) le masque.
- 🔴 **Fonctions exécutables sans être connecté.** 93 des 106 fonctions `SECURITY DEFINER` sont exécutables par le rôle `anon`. Pour le socle, les plus graves :
  - `_next_document_number_unchecked` : aucun contrôle ; quiconque connaît un `company_id` peut consommer des numéros de facture et créer des trous dans la numérotation légale.
  - `set_inbound_cursor`, `set_mail_cursors` : aucun contrôle (curseurs historiques de `companies`, plus utilisés par la relève actuelle).
  - Le `company_id` n'est pas secret : il apparaît dans les URL des images du bucket public `shop-assets` (logo société). Les RPC de la vitrine qui l'exposaient (`shop_public_info`, `shop_public_site`) disparaissent avec la migration `20260919130000` (non appliquée, voir M11).
- ⚠️ `user_roles`, `companies`, `document_sequences` **n'ont pas de déclencheur d'audit** : un changement de rôle ou de numérotation n'est pas tracé dans `events`.
- ⚠️ `events` accepte les INSERT de tout utilisateur connecté (politique `events_insert`) : une ligne d'audit peut être fabriquée depuis le navigateur.
- ⚠️ Authentification Supabase : URL du site encore `http://localhost:3000` (voir `etat-projet.md` §5). Les invitations ne sont pas concernées.
- La recherche globale ne cherche **pas** les documents (factures, OR) ni les plaques, contrairement à ce qu'annonce `dossier-projet.md` M0.

## 6. Prévu / en cours

- Portail client et règles d'accès « un client ne voit que ses données » : lot 3 de [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md).
- Correction de l'URL du site dans Supabase Authentication (tableau de bord Supabase, pas de code).
- Traduction NL : structure prête (`nl` aliasé sur `fr` dans `src/lib/i18n/index.ts`), aucune traduction faite.
- Seed de démonstration (règle 8) : non fait (voir `avancement.md`).

## 7. Limites connues, dettes, pièges

- **Tout salarié voit tout** dans sa société : la RLS ne distingue pas les rôles, sauf pour les tables d'administration (`companies`, `user_roles`, `document_sequences` en écriture, `reference_values` en écriture). Un mécanicien peut lire la comptabilité par l'API même si le menu la lui cache.
- `listOrgUsers` renvoie **tous** les profils de la base à un administrateur, quelle que soit sa société.
- `setUserRoles` supprime puis réinsère sans transaction ; un admin peut retirer son propre rôle admin et se verrouiller dehors.
- Un compte client qui passe par `/login` arrive sur un tableau de bord vide (aucune redirection dédiée).
- `grant_bootstrap_admin` donne le rôle admin sur toutes les sociétés à `simon@themaul.be` (adresse en dur dans la fonction).
- `contact_invitations` (table créée le 14/09) n'est pas utilisée : l'invitation passe par le jeton de récupération Supabase. 0 ligne en base.
- Libellés en dur, contraires à la règle i18n : cartes « Tables de données » de `_app.settings.index.tsx`, « Table inconnue » de `_app.settings.tables.$tableKey.tsx`.
- `lead_sla` et le responsable par défaut vivent dans `reference_values` mais ne sont **pas** déclarés dans `reference-tables.ts` : ils n'apparaissent pas dans Paramètres → Tables.
- Toute nouvelle migration doit être appliquée à la main puis vérifiée objet par objet (`etat-projet.md` §2).
- **Améliorations retirée le 18/09** (décision W-3) : page, module et libellés supprimés du code. Les tables `improvements` (3 lignes) et `improvement_points` (1 ligne) et les 3 pièces jointes GED correspondantes sont supprimées par la migration `20260919130000`, **non appliquée** ; les 3 fichiers du bucket `ged` sous `<société>/improvement/` sont à effacer à la main. Les 29 lignes d'audit (`events`) sont conservées.

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| COM005 | Multi-société ITALBIKE STORE + NL INVEST | ✅ fait | `companies`, `company_id` + RLS partout, sélecteur dans `topbar.tsx` |
| B7 (invariant) | Traçabilité totale | 🟦 partiel | `audit_row` sur la plupart des tables ; manquant sur `user_roles`, `companies`, `document_sequences`, `contact_links`, `contact_accounts`, `stock_moves` ; origine toujours `screen` |
| COM000 / CON000 / CRM000 / DOC000 / SIW000 | Paramétrage standard des modules | 🟦 partiel | `reference_values` + `_app.settings.tables.*` ; pas d'écran pour les boîtes mail (`company_mailboxes`) ni pour `lead_sla` |
| — (dossier M0) | Recherche globale client / VIN / plaque / réf / n° de document | 🟦 partiel | `global-search.tsx` : clients, véhicules, articles seulement |
| — (dossier M0) | Séquences documentaires par société | ✅ fait | `document_sequences`, `next_document_number`, `_app.settings.numbering.tsx` |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-10 | Design system, habillage, navigation | `19a48df` |
| 2026-06-10 | Authentification, session, contexte société/rôles ; écran Utilisateurs | `52c41c9`, `62d8847`, migration `20260610090000_m0_socle` |
| 2026-06-10 | Correctif du blocage au rechargement (verrou supabase-js) | `101c5c7` |
| 2026-06-11 | Tables de paramètres (`reference_values`) | `a14bb21`, migration `20260610180000` |
| 2026-06-11 | Recherche globale branchée sur la base | `4a6f928` |
| 2026-06-11 | Gestion des sociétés | `1382451`, migration `20260610420000` |
| 2026-06-29 | Page Améliorations ; page Extension My Ducati | `5eb15b4`, `c1708de` |
| 2026-07-26 | Fil d'Ariane global, boutons collants | `8f59518` |
| 2026-08-10 | Retrait de toute mention Lovable | `a7d9a2d` |
| 2026-09-11 | Toast global, bouton à trois états, bouton grisé si rien n'a changé | `7f6ce22`, `d24c84f` |
| 2026-09-14 | Cloche des demandes en retard | `a271cf4`, `2d82f34` |
| 2026-09-18 | Comptes équipe et client, invitation par e-mail, changement de mot de passe | `4b1ac81`, migration `20260918140000` |
| 2026-09-18 | **Page Améliorations retirée** (décision W-3) : écran, module, entrée de menu, libellés ; tables supprimées par une migration non appliquée | branche `lot-nettoyage`, migration `20260919130000` (non appliquée) |
