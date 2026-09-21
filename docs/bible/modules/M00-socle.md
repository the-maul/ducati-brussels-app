---
chapitre: M0
titre: Socle
etat: 🟦
verifie_le: 2026-09-18
missions: []
mots_cles: [application client, app-client, bientôt disponible, prévenez-moi, lien Shopify, connexion, login, mot de passe, règles de mot de passe, invitation, mail de bienvenue, borne, kiosque, QR code, utilisateur, rôle, admin, société, multi-société, RLS, audit, events, numérotation, séquence, préfixe, paramètres, tables de données, recherche globale, Ctrl+K, sidebar, topbar, cloche, i18n, traduction]
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
| `/login` | Se connecter par e-mail + mot de passe. Redirige vers le tableau de bord (personnel) ou `/mon-espace` (client). « Pas encore de compte ? **Créer mon compte** » mène à `/inscription`. « **Mot de passe oublié ?** » ouvre un formulaire e-mail : un lien de réinitialisation part par Outlook ; message toujours identique, « Si un compte existe pour cette adresse, un e-mail vient de partir. » |
| `/reset-password` | Choisir son mot de passe depuis le lien d'invitation (jeton à usage unique, consommé seulement à la validation), ou le changer une fois connecté. Règles de mot de passe U-4 avec indicateur, bouton « Afficher ». Après un changement réussi, mail « Votre mot de passe a été modifié » (U-5). Le personnel va sur `/dashboard`, un client sur `/mon-espace`. |
| Barre du haut → menu utilisateur | Voir ses rôles, « Changer mon mot de passe », se déconnecter. |
| Barre du haut → sélecteur de société | Basculer entre ITALBIKE STORE et NL INVEST (mémorisé dans le navigateur). |
| Barre du haut → recherche (Ctrl/⌘+K) | Rechercher clients, véhicules, articles (6 résultats par groupe). Reconnaît un VIN (17 caractères) ou un n° de TVA belge. |
| Barre du haut → cloche | **Chacun voit ce qui le concerne** (décision N-1) : 1) ses **tâches CRM** ouvertes en retard ou pour aujourd'hui (un admin voit aussi celles « sans responsable », c'est-à-dire confiées à quelqu'un qui n'est plus membre actif, et bascule « Les miennes / Toute l'équipe », choix mémorisé dans le navigateur) ; 2) les **nouvelles inscriptions de clients** des 7 derniers jours, « Nouvelle inscription : Prénom Nom (borne / en ligne) », cliquables vers la fiche, pour les rôles **vendeur, marketing, admin** seulement (filtré aussi en base) ; « lu » propre à chaque utilisateur ; 3) les **demandes de rendez-vous atelier** envoyées depuis le portail (statut « demande ») pour les rôles **mécanicien, chef d'atelier, admin**, vers le planning ; 4) (mission 04) les **IBAN modifiés par des clients** dans leur espace (7 derniers jours), « IBAN modifié : Prénom Nom », vers la fiche, pour **admin, comptable, vendeur** (filtré aussi en base), « lu » par utilisateur ; 5) (mission 04, carte 8) les **motos déclarées par des clients** (espace client, inscription, borne ; 7 derniers jours), « Moto déclarée : Prénom Nom — Marque Modèle », vers Véhicules → Motos déclarées à valider, pour **admin, vendeur** (filtré aussi en base), « lu » par utilisateur ; 6) (mission 05, carte 10) **« Acompte reçu : pièces à commander »** (une ligne par document, rappel quotidien) et 7) **« Factures échues impayées »** (une fois par document et par échéance), pour le **vendeur du document** et les **admins** (filtré en base), vers le document ; disparaissent quand les pièces sont commandées / le solde payé. Le badge compte uniquement ce que la personne voit. Aucun e-mail ni SMS. |
| Barre latérale | 17 entrées (`src/lib/navigation.ts`). Seules Comptabilité (admin, comptable) et Paramètres (admin) sont filtrées par rôle. |
| Paramètres (admin) → Sociétés | Modifier nom, TVA, adresse, IBAN, Peppol, comptes par défaut, boîte mail historique, arrondi des prix, plancher de prix ; créer une société (RPC `create_company`). Les CGV (`cgv_text`), le pied de facture et le logo n'ont **pas** d'écran : ils se modifient en base. ⚠️ **enregistrement cassé en production**, voir §5. |
| Paramètres → Utilisateurs | Créer un compte **équipe** (rôles par société) ou **client** (rattaché à une fiche, existante ou créée ; refus d'un doublon d'e-mail). Mot de passe fixé par l'admin (règles U-4, vérifiées aussi côté serveur) ou **invitation par e-mail** (Outlook). Modifier les rôles, activer/désactiver, renvoyer l'invitation. Choisir le **responsable par défaut** des nouvelles demandes CRM, avec reprise optionnelle de ses tâches ouvertes. |
| Paramètres → Tables de données | Éditer les 38 référentiels déclarés dans `reference-tables.ts` (TVA, règlements, conditions de paiement, civilités, marques, arrondis, couleurs, tailles, types de cession, pays…). |
| Paramètres → Numérotation des documents | Modifier préfixe, séparateur, longueur, suffixe, remise à zéro annuelle et libellé explicatif de chaque séquence (14 types × 2 sociétés), avec aperçu du prochain numéro. |
| Paramètres → Migration | Import G8 (voir chapitre M14). |
| Paramètres → Borne d'inscription | (K-6) Explication, bouton **« Lancer le mode borne sur cet appareil »** (plein écran puis `/borne`, déconnexion préalable cochée par défaut), adresse de la borne à copier, **QR code** de cette adresse, guide de verrouillage de la tablette affiché dans l'application. |
| `/app-client` (public) | (W-5) **Le lien du site Shopify** (« Espace client »), adresse stable. Réglage « bientôt disponible » (par défaut) : page de présentation pensée téléphone — « Notre application client sera bientôt disponible », ce qu'elle apportera (vie de la moto, factures, rendez-vous atelier, bonus de fidélité), formulaire **facultatif** « Prévenez-moi à l'ouverture » (e-mail + case de consentement explicite ; champ piège, ticket signé, 5 envois / heure par appareil, 200 / heure au total ; réponse identique si l'adresse est déjà inscrite), « Retour au site » vers ducatibruxelles.be. Réglage « ouverte » : redirection vers `/inscription`. |
| Paramètres → Application client | (W-5) Interrupteur **« Ouvrir l'application client au public »** (statut Bientôt disponible / Ouverte), bouton « Voir la page », **adresse à mettre sur le site** copiable en un clic, liste des personnes « Prévenez-moi » (date, prévenu ou non) avec **export CSV**. Guide Shopify : [`../guides/lien-site-shopify.md`](../guides/lien-site-shopify.md). |
| Paramètres → Extension My Ducati | Télécharger l'extension navigateur et son mode d'emploi. |
| Démo charte (`/demo`) | Page de démonstration du design system, visible dans le menu (entrée marquée `dev`, non masquée en production — à vérifier). |
| Toute l'application | Toast de confirmation ou d'erreur sur chaque enregistrement (`MutationCache` global), bouton à trois états, bouton grisé tant que rien n'a changé. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/login.tsx`, `src/routes/reset-password.tsx`, `src/routes/_app.settings.kiosk.tsx` (Borne d'inscription), `src/routes/app-client.tsx` (page publique, W-5), `src/routes/_app.settings.app-client.tsx` (Application client), `src/routes/_app.tsx` (garde de session + habillage), `src/routes/__root.tsx`, `src/routes/index.tsx` (redirige vers `/dashboard`), `src/routes/_app.settings.tsx` (garde admin), `src/routes/_app.settings.index.tsx`, `_app.settings.companies.tsx`, `_app.settings.users.tsx`, `_app.settings.tables.index.tsx`, `_app.settings.tables.$tableKey.tsx`, `_app.settings.numbering.tsx`, `_app.settings.extension.tsx`, `_app.demo.tsx` |
| Session, société active, rôles | `src/lib/auth/auth-context.tsx` |
| Règles de mot de passe (U-4) | `src/lib/password-policy.ts` (`isStrongPassword`, `checkPassword`) — **seule** source, importée par l'inscription, la borne, `/reset-password`, Paramètres → Utilisateurs et `admin.functions.ts` ; champ et indicateur : `src/components/password-field.tsx` (`PasswordInput`, `PasswordRules`) |
| Mail « mot de passe modifié » (U-5) | `src/lib/auth/password-notify.ts` (appelé par `/reset-password`) |
| Mot de passe oublié | `src/lib/auth/password-reset.ts` (appelé par `/login`), fonction Edge `send-account-invitation` `kind: 'reset'`, table `password_reset_requests`, fonctions `password_reset_allow` / `password_reset_target` (migration `20260919191000`) |
| Application client (W-5) | Page : `src/modules/signup/app-client-page.tsx` ; server functions publiques (clé de service) : `src/modules/signup/app-client.functions.ts` (`getAppClientStatus`, `startAppClientNotify`, `submitAppClientNotify`) ; écran admin : `src/modules/settings/app-client-api.ts` ; colonne `signup_settings.client_app_open`, table `app_client_waitlist` (migration `20260919240000`) |
| QR code | `src/lib/qr.ts` (générateur sans dépendance, niveau M) |
| Administration des comptes (fonctions serveur, clé service role) | `src/lib/auth/admin.functions.ts` (`listOrgUsers`, `createOrgUser`, `setUserRoles`, `setUserActive`) |
| Logique Paramètres | `src/modules/settings/` (`companies-api.ts`, `sequences-api.ts`, `reference-api.ts`, `reference-tables.ts`, `reference-editor.tsx`, `users-api.ts`) |
| Habillage | `src/components/layout/` (`app-shell.tsx`, `app-sidebar.tsx`, `topbar.tsx`, `page-header.tsx`, `mobile-bottom-nav.tsx`), `src/lib/navigation.ts` |
| Recherche globale | `src/components/global-search.tsx` |
| Retour visuel d'enregistrement | `src/lib/mutation-feedback.ts`, `src/lib/use-save-mutation.ts`, `src/lib/use-dirty.ts` |
| Référentiel global | `be_postal_codes` (codes postaux belges → localité, mission 04 ; lecture pour les connectés, pas de `company_id`) |
| Tables | `companies` (sociétés), `profiles` (profil de chaque compte), `user_roles` (rôle par société), `events` (journal d'audit, 200 000+ lignes), `document_sequences` (28 séquences), `reference_values` (144 valeurs), `contact_accounts` (compte client ↔ fiche) |
| Fonctions SQL (RPC) | `is_member`, `is_admin`, `has_role` (contrôles RLS), `next_document_number`, `_next_document_number_unchecked`, `create_company`, `handle_new_user` (déclencheur : profil à l'inscription), `grant_bootstrap_admin` (déclencheur : admin automatique pour simon@themaul.be), `audit_row` (déclencheur d'audit générique) |
| Fonctions serveur (Edge) | `supabase/functions/send-account-invitation` : mails de compte par Outlook, paramètre `kind` = `invite` (choisir son mot de passe), `welcome` (bienvenue après inscription), `password_changed` (sécurité). `invite`/`welcome` : admin de la société, ou serveur avec la clé de service + `purpose: 'signup'` (compte client uniquement). `password_changed` : la personne connectée, pour elle-même. `reset` (mot de passe oublié) : **public**, sans connexion ; réponse identique que le compte existe ou non ; 1 envoi par adresse / 5 min et 5 / heure, 20 demandes / heure par IP ; lien seulement vers une adresse connue de l'application (secret facultatif `APP_ORIGINS`, sinon Netlify + `app.` / `dms.ducatibruxelles.be` + localhost). |
| Tâches planifiées | aucune propre au socle |
| Migrations clés | `supabase/migrations/20260610090000_m0_socle.sql`, `20260610100000_m0_bootstrap_admin.sql`, `20260610180000_m0_reference_tables.sql`, `20260610280000_m6_fix_sequences.sql`, `20260610420000_m0_companies_mgmt.sql`, `20260612330000_m0_company_logo.sql`, `20260918140000_m10_users_pipelines_mailbox_summary.sql` (`contact_accounts`), `20260919170000_m1_signup_team_notifications.sql`, `20260919190000_n1_cloche_par_role.sql` et `20260919265000_m1_portail_iban_naissance.sql` (cloche : type `client_iban_changed`), `20260919302000_m3_motos_declarees.sql` (cloche : type `vehicle_declared`) |
| Libellés | `src/lib/i18n/fr.ts`, blocs `app`, `common`, `nav`, `action`, `feedback`, `confirm`, `company`, `search`, `status`, `auth`, `settings`, `users`, `pwd` (dont `pwd.rules`), `kiosk` (Paramètres → Borne d’inscription), `appClient` (page `/app-client` et Paramètres → Application client), `role`, `demo` ; point d'entrée `src/lib/i18n/index.ts` |

## 4. Règles métier et décisions

- **Multi-société (COM005, CLAUDE.md règle 2)** : chaque table métier porte `company_id` ; la RLS est active sur **toutes** les tables publiques (vérifié en base le 18/09 : 80 tables, toutes `rowsecurity = true`). L'accès se résume à `is_member(company_id)` = « l'utilisateur a au moins un rôle dans cette société ».
- **Rôles** : `admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing` (énum `app_role`). Décision client du 18/09 : pas de nouveaux rôles ; commercial = vendeur, technicien = mécanicien / chef d'atelier, manager = admin.
- **Compte client** (18/09) : aucun rôle, donc aucun accès aux données de la concession ; rattaché à sa fiche par `contact_accounts`. Le portail qui lui montrera ses propres données n'existe pas encore.
- **Audit (B7, règle 4)** : le déclencheur `audit_row` écrit dans `events` (qui, quoi, quand, ancien/nouveau). `events` n'accepte ni UPDATE ni DELETE (droits vérifiés). L'origine est toujours `screen`, y compris pour les écritures faites par la relève mail ou un import.
- **Numérotation** : par société et par type, configurable par un non-technicien (exigence client, CLAUDE.md §4.3). Remise à zéro annuelle activée partout.
- **Invitations** envoyées par Outlook, pas par Resend ni par Supabase (décision client D4 du 14/09). Le lien pointe vers `/reset-password` de l'application.
- **Mot de passe oublié (19/09)** : même mécanique que l'invitation (Outlook, jeton à usage unique vers `/reset-password`), **jamais** `supabase.auth.resetPasswordForEmail` tant que l'URL du site de Supabase Auth pointe vers localhost. Ne jamais révéler si un compte existe (même réponse, envoi fait après la réponse). Rien n'est envoyé à un compte désactivé, banni ou sans société. `password_reset_requests` ne garde que des empreintes SHA-256 (ni e-mail ni IP en clair), purgées après 24 h ; table technique sans `company_id` (anti-abus global, comme l'authentification), fermée à anon et authenticated.
- **Règles de mot de passe (U-4, 18/09)** : au moins 8 caractères, une majuscule, une minuscule, un chiffre, un caractère spécial (72 au plus). Une seule fonction, `isStrongPassword` (`src/lib/password-policy.ts`), à l'écran **et** côté serveur (inscription, création de compte). Pour `/reset-password`, le contrôle est à l'écran (la mise à jour passe directement par Supabase Auth) : pour le rendre infranchissable, régler aussi les exigences de mot de passe dans le tableau de bord Supabase (Authentication → Policies), réglage non fait.
- **Mails de compte (U-5, 18/09)** : après toute inscription réussie (en ligne ou borne), « Bienvenue chez Ducati Bruxelles » (identifiant, lien vers l'espace client, message de bienvenue K) ; fiche déjà connue → invitation qui reprend ce message. Après tout changement de mot de passe, « Votre mot de passe a été modifié », sans le mot de passe. Expéditeur : `info@` de la société si elle l'a, sinon sa boîte principale.
- **Visite de l'espace client (P-6, 19/09)** : à chaque ouverture de `/mon-espace`, `portal_touch()` remplit `contact_accounts.first_portal_visit_at` (une fois) et `last_portal_visit_at` (au plus toutes les 5 min). Sert au pied de mail (M10) et à la fiche client : « Espace client : pas de compte / compte créé, jamais ouvert / dernière visite le … ».
- **Lien du site Shopify (W-5, 19/09)** : le site pointe toujours vers `/app-client`. Le réglage `signup_settings.client_app_open` (faux par défaut, audité dans `events`) est lu **sans connexion** par une server function avec la clé de service — aucune fonction SQL ouverte à anon. « Ouverte » ne redirige vers `/inscription` que si l'inscription elle-même est ouverte (`is_open`). `app_client_waitlist` : e-mail en minuscules, unique par société, preuve du consentement (`consent_at`, `consent_text` = texte exact de la case), empreinte salée de l'IP (jamais l'IP en clair) pour la limite ; écriture par la clé de service seulement, lecture par les administrateurs (RLS `is_admin`), aucun droit pour anon. `notified_at` servira au mail d'ouverture (pas encore écrit).
- **Borne (K-5, K-6, 18/09)** : le client choisit son mot de passe à la borne ; une fiche déjà connue ne s'ouvre jamais avec le mot de passe tapé (invitation par e-mail à la place). Le mode borne se lance depuis Paramètres → Borne d'inscription.
- **Téléphone à l'inscription (21/09)** : le champ e-mail de `/inscription` porte `autocomplete="username"` (c'est l'identifiant), le téléphone `tel-national` ; le numéro est contrôlé à l'écran et par la server function (`toE164`, `src/lib/phone.ts`) et enregistré au format E.164. Voir M01 §4 « Jamais d'e-mail dans un téléphone ».
- **Cloche par rôle et par responsable (N-1, 19/09)** : tâches CRM confiées à la personne (admin : + sans responsable, bascule équipe) ; inscriptions → vendeur, marketing, admin ; demandes de rendez-vous du portail → mécanicien, chef d'atelier, admin ; IBAN modifié par un client (mission 04) → admin, comptable, vendeur ; moto déclarée par un client (mission 04, carte 8, type `vehicle_declared`) → admin, vendeur. La lecture est refusée en base aux autres rôles (`can_see_team_notification`, politique `team_notifications_member_read`).
- **Alertes nominatives liées à un document** (mission 05, carte 10, migration `20260919351000`) : colonnes `team_notifications.document_id`, `target_user_id` (destinataire : lu par la politique `team_notifications_target_read`, en plus des rôles de `can_see_team_notification`), `payload` (détails mis en forme par l'écran), `dedupe_key` (index unique partiel (société, type, clé) : anti-doublon par `on conflict do nothing`), `resolved_at` (alerte réglée, plus affichée). Types `order_after_deposit` et `unpaid_balance` → admin par `can_see_team_notification`, vendeur par `target_user_id`.
- **Ajouter un type d'alerte à la cloche** (4 étapes) : 1) élargir la contrainte `team_notifications_kind_check` **sans retirer** les types existants (la migration `20260919265000` la reconstruit à partir de la définition en place) ; 2) ajouter le cas dans `can_see_team_notification` en recopiant **tous** les cas en place ; 3) insérer la ligne (fonction SECURITY DEFINER ou déclencheur) ; 4) l'afficher dans `src/components/layout/topbar.tsx` (`listTeamNotifications(company, user, kind)` de `src/modules/crm/api.ts`) et l'ajouter au badge.
- **Verrou Supabase** : ne jamais appeler Supabase dans `onAuthStateChange` (piège n°7 de `etat-projet.md`) ; le chargement du profil est différé par `setTimeout(0)`.

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base (projet `ujmrosbgkvgvwfnuryna`).

- ✅ Connexion, bascule de société, garde des pages, garde admin sur Paramètres.
- ✅ Création de comptes équipe et client, invitation (`send-account-invitation` déployée, `verify_jwt` actif, contrôle admin dans le code). 4 profils, 14 attributions de rôle, 0 compte client.
- ⚠️ **Invitation de la borne non reçue au test du 18/09** : l'inscription borne de 13:36:38 UTC a appelé `send-account-invitation` à 13:36:39, qui a répondu **401** (journal `function_edge_logs`, déploiement `…_4`). C'était encore la **version 4** de la fonction, réservée aux administrateurs : l'appel serveur avec la clé de service y était traité comme un utilisateur (`/auth/v1/user` → `not_signed_in`). La version 6, qui accepte la clé de service pour `purpose: 'signup'`, a été déployée à 13:37:19, **40 s plus tard**. Aucun jeton n'a été généré (`recovery_sent_at` vide). L'inscription en ligne de 13:28 n'envoyait aucun mail, par conception à l'époque. Corrigé par le lot « retours borne » : mails de bienvenue et de changement de mot de passe (U-5), à **déployer** (`send-account-invitation`).
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

- **Tout salarié voit tout** dans sa société (sauf, depuis N-1, les alertes d'inscription de la cloche) : la RLS ne distingue pas les rôles, sauf pour les tables d'administration (`companies`, `user_roles`, `document_sequences` en écriture, `reference_values` en écriture). Un mécanicien peut lire la comptabilité par l'API même si le menu la lui cache.
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
| 2026-09-18 | **Cloche : nouvelles inscriptions de clients** (borne et en ligne), lu par utilisateur (mission 01, lot 5) | branche `lot-notif-tri`, migration `20260919170000_m1_signup_team_notifications.sql` (appliquée le 18/09) |
| 2026-09-18 | Retours de test de la borne : mot de passe demandé à la borne (K-5), Paramètres → Borne d'inscription avec lancement, adresse, QR code et guide (K-6), règles de mot de passe partagées (U-4), mails de bienvenue et « mot de passe modifié » (U-5), cibles tactiles ≥ 44 px sur `/inscription` et `/borne` | branche `lot-borne-retours` ; fonction `send-account-invitation` à redéployer ; aucune migration |
| 2026-09-18 | **Page Améliorations retirée** (décision W-3) : écran, module, entrée de menu, libellés ; tables supprimées par une migration non appliquée | branche `lot-nettoyage`, migration `20260919130000` (non appliquée) |
| 2026-09-19 | **Visite de l'espace client retenue** (`portal_touch`, colonnes `first_portal_visit_at` / `last_portal_visit_at`) et affichée sur la fiche client (P-6) | branche `lot-pied-mail`, migration `20260919200000_m0_portail_visite.sql` (appliquée le 19/09) |
| 2026-09-19 | **Cloche filtrée par rôle et par responsable** (décision N-1) : mes tâches CRM (admin : + sans responsable, bascule « Les miennes / Toute l'équipe »), inscriptions pour vendeur/marketing/admin (filtré en base), demandes de rendez-vous du portail pour l'atelier | branche `lot-cloche-login`, migration `20260919190000_n1_cloche_par_role.sql` (appliquée le 19/09) |
| 2026-09-19 | **Lien du site Shopify vers l'application client** (W-5) : page publique `/app-client` « bientôt disponible » avec « Prévenez-moi à l'ouverture », bascule vers `/inscription` par Paramètres → Application client, liste et export CSV des inscrits, guide Shopify | branche `lot-app-bientot`, migration `20260919240000_m0_app_client_bientot.sql` (appliquée le 19/09) |
| 2026-09-19 | **Cloche : moto déclarée par un client** (mission 04, carte 8) pour admin et vendeur, vers « Motos déclarées à valider » | branche `lot-m4-moto`, migration `20260919302000` (appliquée le 19/09) |
| 2026-09-19 | **Cloche : IBAN modifié par un client** (mission 04, carte 5) pour admin, comptable, vendeur ; référentiel global `be_postal_codes` (carte 4) | branche `lot-m4-client`, migrations `20260919264000`, `20260919265000` (appliquées le 19/09) |
| 2026-09-19 | **/login : « Créer mon compte » et « Mot de passe oublié ? »** — lien de réinitialisation par Outlook (`send-account-invitation` `kind: 'reset'`, public, réponse identique, 1 envoi / 5 min et 5 / heure par adresse) | branche `lot-cloche-login`, migration `20260919191000_m0_password_reset_throttle.sql` (appliquée le 19/09) ; fonction `send-account-invitation` **à redéployer** |
| 2026-09-19 | **Cloche : acompte reçu → pièces à commander, factures échues impayées** (mission 05, carte 10) pour le vendeur du document + admins ; alertes nominatives (`target_user_id`), anti-doublon (`dedupe_key`), réglées (`resolved_at`) | branche `lot-cmd-devis`, migration `20260919351000_m6_acompte_commande_soldes.sql` (appliquée le 19/09) |
| 2026-09-21 | **Inscription : le téléphone n'accepte plus qu'un numéro** (un e-mail écrit par le navigateur finissait dans le GSM), enregistré au format E.164 ; e-mail marqué comme identifiant (`username`) | branche `lot-profil`, migration `20260921160000` (à appliquer) — détail M01 |
