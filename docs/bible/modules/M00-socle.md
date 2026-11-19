---
chapitre: M0
titre: Socle
etat: 🟦
verifie_le: 2026-10-30
missions: []
mots_cles: [application client, app-client, bientôt disponible, prévenez-moi, lien Shopify, connexion, login, mot de passe, règles de mot de passe, invitation, mail de bienvenue, borne, kiosque, QR code, utilisateur, rôle, admin, société, multi-société, RLS, audit, events, numérotation, séquence, préfixe, paramètres, tables de données, recherche globale, Ctrl+K, sidebar, topbar, cloche, i18n, traduction, langue, néerlandais, anglais, italien, locale]
---

# M0 — Socle

> **En une phrase** : les fondations communes à tous les écrans — qui se connecte, pour quelle société, avec quels droits, comment tout est tracé, numéroté et paramétré.

## 1. À quoi ça sert

Le socle n'est pas un « module métier » : c'est ce que tous les autres consomment.
Il gère la connexion des utilisateurs, les deux sociétés du groupe (**ITALBIKE STORE** et **NL INVEST**)
et la bascule de l'une à l'autre, les rôles (administrateur, vendeur, magasinier, mécanicien, chef
d'atelier, comptable, marketing), la trace de chaque modification (table `events`), la numérotation
des documents par société, les tables de paramètres (TVA, modes de règlement, civilités…), la
recherche globale et l'habillage de l'application (barre latérale, barre du haut, libellés en
quatre langues : français, néerlandais, anglais, italien — chacun choisit la sienne).
Il est utilisé par tout le monde ; les écrans d'administration sont réservés aux administrateurs.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| `/login` | Se connecter par e-mail + mot de passe. Redirige vers le tableau de bord (personnel) ou `/mon-espace` (client). « Pas encore de compte ? **Créer mon compte** » mène à `/inscription`. « **Mot de passe oublié ?** » ouvre un formulaire e-mail : un lien de réinitialisation part par Outlook ; message toujours identique, « Si un compte existe pour cette adresse, un e-mail vient de partir. » |
| `/reset-password` | Choisir son mot de passe depuis le lien d'invitation (jeton à usage unique, consommé seulement à la validation), ou le changer une fois connecté. Règles de mot de passe U-4 avec indicateur, bouton « Afficher ». Après un changement réussi, mail « Votre mot de passe a été modifié » (U-5). Le personnel va sur `/dashboard`, un client sur `/mon-espace`. |
| Barre du haut → menu utilisateur | Voir ses rôles, « Changer mon mot de passe », « Ma signature e-mail », **« Langue »** (Français / Nederlands / English / Italiano : bascule immédiate de toute l'application, sans rechargement, et mémorisée dans le profil), se déconnecter. |
| Espace client → Mon profil → Préférences | Le client choisit aussi sa langue (mêmes quatre boutons), enregistrée tout de suite, hors du bouton « Enregistrer » du formulaire. |
| Barre du haut → sélecteur de société | Basculer entre ITALBIKE STORE et NL INVEST (mémorisé dans le navigateur). |
| Barre du haut → recherche (Ctrl/⌘+K) | Rechercher clients, véhicules, articles (6 résultats par groupe). Reconnaît un VIN (17 caractères) ou un n° de TVA belge. |
| Barre du haut → cloche | **Chacun voit ce qui le concerne** (décision N-1) : 1) ses **tâches CRM** ouvertes en retard ou pour aujourd'hui (un admin voit aussi celles « sans responsable », c'est-à-dire confiées à quelqu'un qui n'est plus membre actif, et bascule « Les miennes / Toute l'équipe », choix mémorisé dans le navigateur) ; 2) les **nouvelles inscriptions de clients** des 7 derniers jours, « Nouvelle inscription : Prénom Nom (borne / en ligne) », cliquables vers la fiche, pour les rôles **vendeur, marketing, admin** seulement (filtré aussi en base) ; « lu » propre à chaque utilisateur ; 3) les **demandes de rendez-vous atelier** envoyées depuis le portail (statut « demande ») pour les rôles **mécanicien, chef d'atelier, admin**, vers le planning ; 4) (mission 04) les **IBAN modifiés par des clients** dans leur espace (7 derniers jours), « IBAN modifié : Prénom Nom », vers la fiche, pour **admin, comptable, vendeur** (filtré aussi en base), « lu » par utilisateur ; 5) (mission 04, carte 8) les **motos déclarées par des clients** (espace client, inscription, borne ; 7 derniers jours), « Moto déclarée : Prénom Nom — Marque Modèle », vers Véhicules → Motos déclarées à valider, pour **admin, vendeur** (filtré aussi en base), « lu » par utilisateur ; 6) (mission 05, carte 10) **« Acompte reçu : pièces à commander »** (une ligne par document, rappel quotidien) et 7) **« Factures échues impayées »** (une fois par document et par échéance), pour le **vendeur du document** et les **admins** (filtré en base), vers le document ; disparaissent quand les pièces sont commandées / le solde payé. Le badge compte uniquement ce que la personne voit. Aucun e-mail ni SMS. |
| Barre latérale | 18 entrées (`src/lib/navigation.ts`). Chaque entrée est filtrée par la **grille des droits par rôle** (`src/lib/auth/permissions.ts`, voir §4) : une page interdite disparaît du menu et son adresse affiche « accès refusé » ; une page en lecture seule s'ouvre avec un bandeau et sans ses boutons d'écriture. |
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
| Toute l'application → bouton **« Retour »** (UX010, 03/11/2026) | En tête de chaque page (au-dessus du fil d'Ariane), sauf sur les entrées du menu de gauche (tableau de bord, première page de chaque rubrique) où il est masqué. **Retour revient exactement où on était (UX011, 03/11/2026)** : la page d'avant dans l'historique du navigateur, avec sa recherche, ses filtres, son onglet, sa page et sa position de défilement ; un formulaire en cours (Nouvel OR, nouveau document, nouveau client, nouvel article) retrouve sa saisie (bandeau « Saisie en cours retrouvée » + « Recommencer à zéro »). Une fiche créée saute son formulaire de création (Retour = la page d'avant le formulaire). Page parente seulement si on arrive par lien direct. Un formulaire modifié non enregistré demande confirmation avant de quitter ; quitter par Retour abandonne la saisie. 44 px sur tablette / smartphone. Alt+Flèche gauche (natif) reste disponible ; pas de raccourci Escape (il ferme déjà dialogues et menus). |

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
| Bouton Retour (UX010) | `src/components/layout/page-back.tsx` (bouton + suivi des pages visitées, monté par `app-shell.tsx` et `__root.tsx`), `src/lib/back-navigation.ts` (logique pure : `parentPathOf`, `isRootPage`, `decideBack`, table d'exceptions), `src/lib/use-dirty.ts` (`useLeaveGuard`, `hasUnsavedChanges`), test `tests/bouton-retour.test.ts` ; **état des pages (UX011)** : `src/lib/list-search.ts` (pur : `readListSearch`, `listSearchFromRaw`, `applyListPatch`) + `src/lib/use-list-search.ts` (`useListSearch`, `useSearchText`, `useOnChange`) pour les listes, `src/lib/form-draft.ts` (pur + registre : `formDraftKey`, `clearFormDraft`, `discardActiveDrafts`) + `src/lib/use-form-draft.ts` (`useFormDraft`) + `src/components/form-draft-banner.tsx` pour les formulaires, `useGoBack` dans `page-back.tsx`, zone `#app-main` (`app-shell.tsx`) + `scrollToTopSelectors` (`src/router.tsx`) pour le défilement, test `tests/etat-pages-retour.test.ts` |
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
| Libellés | `src/lib/i18n/fr.ts` (référence), blocs `app`, `common`, `locale`, `nav`, `action`, `feedback`, `confirm`, `company`, `search`, `status`, `auth`, `settings`, `users`, `pwd` (dont `pwd.rules`), `kiosk` (Paramètres → Borne d'inscription), `appClient` (page `/app-client` et Paramètres → Application client), `role`, `demo` ; **mêmes clés** dans `nl.ts`, `en.ts`, `it.ts` (type `DictionaryShape`, test `tests/i18n-dictionnaires.test.ts`) ; point d'entrée `src/lib/i18n/index.ts` (`t`, `setLocale`, `useLocale`, `<LocaleProvider>`) |
| Langue de l'utilisateur | colonne `profiles.locale` (migration `20261030150000_m0_langue_de_l_utilisateur.sql`) ; lecture au chargement dans `src/lib/auth/auth-context.tsx` (`setLocale`), écriture par `setUserLocale` ; sélecteur dans `src/components/layout/topbar.tsx` (menu du compte) et `src/modules/portal/profile.tsx` (espace client) |

## 4. Règles métier et décisions

- **Postes et périphériques, réglage transverse** (PDV030, M-106) : Paramètres → **Postes et périphériques** (admin) décrit les postes de la société et, par poste, un appareil par rôle (imprimante ticket, tiroir, étiquettes, douchette, écran client, terminal, balance) ; **aucun matériel imposé**. Le poste du navigateur (« Ce poste est : ... ») est mémorisé **localement** par chaque PC / tablette, jamais en base. Couche `src/lib/devices/` utilisée par la caisse (M6, ticket 80 / 58 mm, tiroir) et les étiquettes (M2, ZPL). Tables `workstations`, `workstation_devices`, `company_device_settings` (RLS : lecture membres, écriture admin), migration `20261103250000_m6_postes_peripheriques.sql` **non appliquée** ; détail dans [M06](M06-ventes-caisse.md).
- **Multi-société (COM005, CLAUDE.md règle 2)** : chaque table métier porte `company_id` ; la RLS est active sur **toutes** les tables publiques (vérifié en base le 18/09 : 80 tables, toutes `rowsecurity = true`). L'accès se résume à `is_member(company_id)` = « l'utilisateur a au moins un rôle dans cette société ».
- **Rôles** : `admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing` (énum `app_role`). Décision client du 18/09 : pas de nouveaux rôles ; commercial = vendeur, technicien = mécanicien / chef d'atelier, manager = admin.
- **Compte client** (18/09) : aucun rôle, donc aucun accès aux données de la concession ; rattaché à sa fiche par `contact_accounts`. Le portail qui lui montrera ses propres données n'existe pas encore.
- **Grille des droits par rôle (M0-RBAC003, document signé le 13/10, relu case par case contre le scan le 30/10)** : 19 pages × 6 rôles, trois niveaux (modifier / lecture seule / pas d'accès), codée en clair dans `src/lib/auth/permissions.ts` (`PAGE_RULES`) et recopiée indépendamment dans `tests/access-grid.test.ts` (un test par rôle : si l'une bouge sans l'autre, le test tombe). L'administrateur a tout en écriture. **Un opérateur peut cumuler plusieurs rôles** (note manuscrite du client) : le droit le plus large gagne. Une page absente de la grille (profil, recherche) reste ouverte ; une page de création (`/new`, `/import`, `/inventory`) exige le droit d'écrire. Les écrans dont l'adresse ne porte pas le préfixe de leur rubrique (`/accounting-closure`, `/accounting-sepa` → Comptabilité ; `/client-pricing` → Contacts ; `/consignment` → Reprises ; `/preparation/...` → Picking list) sont des **alias** (`PAGE_ALIASES`) avec exactement les droits de la rubrique. Toute nouvelle route de premier niveau doit avoir une ligne dans la grille, un test le vérifie.
- **Audit (B7, règle 4)** : le déclencheur `audit_row` écrit dans `events` (qui, quoi, quand, ancien/nouveau). `events` n'accepte ni UPDATE ni DELETE (droits vérifiés). L'origine est toujours `screen`, y compris pour les écritures faites par la relève mail ou un import.
- **Numérotation** : par société et par type, configurable par un non-technicien (exigence client, CLAUDE.md §4.3). Remise à zéro annuelle activée partout. Depuis le 18/11 : deux modes au choix pour facture / ticket / avoir (séries séparées ou compteur unique façon G8), voir « Ajouté le 18/11 » ci-dessous.
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
- **Quatre langues, une par utilisateur (I18N001, décision client du 30/10/2026, M-70)** : FR (référence et défaut — l'équipe Italbike reste en français), NL, EN, IT. Un seul dictionnaire par langue, **mêmes clés** que `fr.ts` ; le type `DictionaryShape` et le test `tests/i18n-dictionnaires.test.ts` refusent une clé manquante, une valeur vide ou un placeholder `{n}` perdu. **Toute clé ajoutée au FR doit être ajoutée aux trois autres** dans la même PR. Le choix vit dans `profiles.locale` (contrainte fr/nl/en/it, défaut fr, modifiable par l'utilisateur lui-même : RLS `profiles_update_own` + `grant update (locale)`). Au chargement de la session, la locale vient du profil ; le changement re-monte l'arbre React sous `<LocaleProvider>` (clé = locale), donc **sans rechargement** ; les textes rendus au serveur (SSR) restent FR jusqu'au chargement de la session (bref passage en FR pour un utilisateur NL/EN/IT). Les données (noms de modèles, libellés saisis par l'équipe, tables de référence) restent en FR : seule l'interface est traduite (lot 1). Règle d'écriture des dictionnaires NL/EN/IT : apostrophes droites uniquement, pas d'espace avant `:` `;` `?` `!`, noms propres (Ducati, Shopify, Bancontact, Italbike) non traduits, sigles G8 (OR, ORO, PAMP, VIN, REP, COC) conservés.
- **Bouton Retour sur toutes les pages (UX010, demande client du 03/11/2026)** : « à chaque fois qu'on clique sur un bouton, on ne sait pas revenir à la page d'avant ». Règle : le bouton est rendu par l'ossature (`AppShell`), pas par chaque page, pour qu'aucune page n'y échappe ; il est masqué sur les entrées de `mainNav` (`src/lib/navigation.ts`). Décision « historique ou parent » (`decideBack`) : historique du navigateur si la page précédente est connue et dans l'application ; page parente sinon (pas de précédente, page publique, même page, ou formulaire de création qui a ouvert la fiche : `/parts/new` → `/parts/<id>` ne revient jamais sur `new`). La page parente se déduit du chemin (dernier segment retiré, `/sales/<id>/edit` → `/sales/<id>`) avec une petite table d'exceptions (`/workshop/journey/<id>` → `/workshop/<id>`, `/preparation/<id>` → `/picking`, `/accounting-closure` et `/accounting-sepa` → `/accounting`, `/client-pricing` → `/clients`, `/consignment` → `/tradein`) — **toute nouvelle route hors schéma `/<rubrique>/<id>` s'ajoute à cette table**. Le suivi des pages visitées est en mémoire (index d'historique TanStack `__TSR_index` → chemin) : il se vide au rechargement, c'est voulu. Les formulaires qui utilisent `useIsDirty` appellent aussi `useLeaveGuard(dirty)` : Retour demande alors confirmation (« Quitter sans enregistrer »). Les pages publiques (borne, inscription, signature, espace client) gardent leur propre navigation.
- **Règle : « Retour revient exactement où on était » (UX011, retour client du 03/11/2026)** : « le bouton Retour ne revient pas à la page d'avant (avec la sélection) ». Causes trouvées : 1) l'état des listes (recherche, filtres, onglet, page) et des formulaires vivait dans l'état React, perdu dès que la page était démontée — Retour revenait bien à la page mais vide ; 2) une fiche ouverte juste après un formulaire de création remontait à la **liste** de la rubrique (« Ajouter une moto » depuis l'OR → fiche moto → Retour = liste des motos) ; 3) le défilement de la zone de travail (`<main>`, seul élément qui défile) n'était ni restauré ni remis en haut. Règles en place :
  - **Décision** : `decideBack(page, pagesPrécédentes)` remonte l'historique en **sautant** la même page et le formulaire de création déjà utilisé de la même rubrique, puis `history.go(-n)` (1 pas dans le cas normal). Parent seulement s'il n'y a rien de connu (lien direct) ou si l'on tombe sur une page publique. Le suivi des pages visitées est aussi gardé en `sessionStorage` (propre à l'onglet, comme l'historique) : **il survit désormais au rechargement** (F5), ce qui remplace la règle UX010 « il se vide au rechargement ».
  - **Listes = adresse** : Pièces (recherche, filtres, page), Clients (recherche, type, archives, page, taille, tri), Ventes (recherche, filtres), Atelier (statut), Véhicules (recherche, statut, à compléter), Commandes (type, statut), CRM (source, pipeline) gardent leur état dans les paramètres de l'adresse (`validateSearch` de la route + `useListSearch`). Une valeur égale au défaut n'apparaît pas ; une valeur illisible retombe sur le défaut. Écriture en `replace` et sans remonter en haut (`resetScroll: false`) : changer un filtre ne crée pas d'entrée d'historique. Les remises à zéro « quand la société change » passent par `useOnChange` (jamais au montage, sinon elles effaceraient l'adresse au retour). Achats : pas d'état de liste à garder. **Toute nouvelle liste principale suit ce modèle.**
  - **Formulaires en cours = brouillon d'onglet** : `useFormDraft` (Nouvel OR, nouveau document de vente, nouveau client, nouvel article) écrit la saisie dans `sessionStorage`, clé = route + société (`formDraftKey`), la restaure au retour (bandeau « Saisie en cours retrouvée », bouton « Recommencer à zéro ») et l'efface à l'enregistrement (`clearFormDraft`), au bouton « Annuler », au bouton Retour (abandon explicite, `discardActiveDrafts`) ou au bout de 12 h. Ouvrir un autre écran (fiche moto, menu, Alt+Flèche gauche) le garde. Client / moto passés dans l'adresse priment sur le brouillon (un brouillon d'un autre client n'est pas proposé). L'édition d'une fiche existante n'a pas de brouillon (elle se relit en base).
  - **Retour d'un écran de création (`?retour=`)** : « Ajouter une moto » du sélecteur de moto (OR, document de vente, RDV) passe l'adresse de l'écran (`retour`) ; la moto créée (ou rattachée), on y revient en `replace` avec `vehicleId=<la moto>` : le formulaire retrouve sa saisie **et** la nouvelle moto. `safeReturnPath` n'accepte qu'un chemin de l'application. Sur une page qui ne lit pas `vehicleId` (OR existant, planning), on revient à la page, sans présélection.
  - **Défilement** : `<main id="app-main" data-scroll-restoration-id="app-main">` + `scrollToTopSelectors: ['#app-main']` : une nouvelle page s'ouvre en haut, Retour retrouve la position.
  - **Boutons « Retour » propres à un écran** : `useGoBack()` (même décision que le bouton de l'ossature) ; les boutons libellés par une rubrique (« ← Atelier », « ← Paramètres ») restent des liens vers cette rubrique.

### Ajouté le 18/11 — rattrapage G8 : numérotation des documents (deux modes)

Sources : `docs/g8-inventaire/09-parametres.md` (« Gestion chronos »), `parcours.md` (« Numérotation G8 observée »),
`comparaison-ventes-caisse-compta.md` §5 et bloquant n° 5. Branche `lot-g8-numerotation`,
migration `20261118260000_m0_numerotation_deux_modes.sql` (**non appliquée**).

- **Décision de Simon (18/11)** : les deux modes au choix, **par société**, dans Paramètres → Numérotation des documents.
  - **Séries séparées** (comportement d'avant) : FAC / TIK / AVO, chacune avec préfixe, format, remise à zéro annuelle.
  - **Compteur unique** façon G8 : facture, ticket et avoir prennent leur numéro sur **une seule série `VEN`**
    (format par défaut : 8 chiffres, sans préfixe ni remise à zéro, ex. 22701456 → 22701457 → 22701458), au format
    réglable comme les autres. Les autres types (FAA, DEV, RES, BC, BL, OR, ORO, CMD, REC, REP, OCC, DEP, Z…) gardent leur série.
  - Réglage : table `numbering_settings` (une ligne par société : `sales_mode`, changement programmé `next_sales_mode` /
    `next_sales_mode_year`), écrite **uniquement** par `set_sales_numbering_mode` (lecture membres, aucune écriture directe).
- **Règles légales tenues en base** (AR n° 1 TVA art. 5) :
  - **Continuité sans trou ni doublon** : numéro pris sous verrou de ligne ; `document_assign_number(document)` prend le
    numéro **et** valide le brouillon dans la même transaction (si la validation est refusée — client, lignes, caisse —
    aucun numéro n'est consommé). L'écran des ventes (`createDocument`, `updateDraftDocument`) l'utilise, avec repli sur
    l'ancien chemin tant que la migration n'est pas posée.
  - **Numéro à la validation**, jamais au brouillon (inchangé).
  - **Changement de mode** immédiat **seulement** si aucune facture / ticket / avoir n'a reçu de numéro dans l'année civile
    (société neuve ou début d'année ; `_sales_numbered_this_year` compte les documents numérotés et les séries entamées,
    `document_sequences.last_issued_at`) ; sinon refus clair « Changement refusé… programmez le changement pour le
    1er janvier » et le changement **se programme** au 1er janvier suivant (appliqué au premier numéro de l'année).
    Événements `numbering_mode_change`, `numbering_mode_scheduled`, `numbering_mode_applied` dans `events`.
  - **Prochain numéro réglable vers le haut seulement**, par un **administrateur ou le comptable**, motif obligatoire
    (au moins 5 caractères) : `set_sequence_next_value`, événement `numbering_next_value_change` (ancien / nouveau, nombre
    de numéros sautés, motif). L'écran annonce le trou créé. Usage : démarrer après les données de test, ou **reprendre le
    compteur G8** (ex. VEN à 22701462).
  - **Garde sur `document_sequences`** (`trg_document_sequences_guard`) : `next_value`, `current_year`, `last_issued_at`
    ne se modifient plus par l'API (seulement par les fonctions de numérotation ; depuis la console SQL : permis mais
    tracé `numbering_next_value_sql`) ; deux séries d'une société ne peuvent plus partager un préfixe ; tout changement
    de format / libellé est tracé (`numbering_format_change`) ; une série ne se supprime plus par l'API.
  - **Unicité du numéro par société** : index `documents_company_number_uq` posé par la migration **seulement s'il n'y a
    pas déjà de doublon** en base (sinon un avis, rien n'est modifié).
  - **Plus de troncature** : un compteur qui dépasse la longueur garde tous ses chiffres (`lpad` tronquait : 100000 en
    5 positions donnait 10000, un doublon).
  - **Année de numérotation = année civile à Bruxelles** (avant : UTC, bascule le 31/12 à 23 h).
- **Écran** (`src/routes/_app.settings.numbering.tsx`, règles pures `src/modules/settings/numbering-rules.ts`) : bloc
  « Factures, tickets et avoirs : un compteur ou trois ? » (mode en vigueur, programmation, « Appliquer maintenant »
  grisé si des numéros existent dans l'année, « Programmer au 1er janvier »), séries groupées comme la Gestion chronos
  de G8 (Ventes, Atelier, Achats, Occasions et reprises, Caisse, Autres) avec une **explication par série**, l'aperçu en
  direct, le prochain numéro et le bouton « Régler » (admin / comptable), l'état Actif / En sommeil ; « Autres numéros » :
  livre de police (registre des véhicules, `AAAA-0001`, non réglable). La fenêtre de confirmation d'une facture / d'un
  avoir annonce le numéro du compteur unique quand ce mode est choisi.
- **Compteurs G8 et DMS** : devis (DEV), réservation (RES), BL, OR, ORO, commande (CMD, CDP, CEX), réception (REC),
  occasion (OCC), dépôt-vente (DEP), reprise (REP), livre de police (registre véhicules), journal Z apparaissent tous dans
  l'écran. **Remise en banque** et **mouvement de fond de caisse** n'ont pas de numéro dans le DMS au 18/11 (fonctions
  absentes, lot caisse) : une série ajoutée plus tard dans `document_sequences` apparaîtra d'elle-même (codes `RMB`, `REM`,
  `MVC`, `MFC` déjà rangés sous « Caisse »).
- **Essais à blanc** : `supabase/tests/m0_numerotation_deux_modes.sql` (transaction annulée : modes, refus en cours
  d'exercice dont ITALBIKE STORE, programmation, réglage, garde, droits) et `supabase/tests/m0_numerotation_concurrence.sql`
  (**base locale ou branche uniquement** : 8 sessions en parallèle par dblink, 240 numéros continus en compteur unique,
  FAC / TIK / AVO continues en séries séparées). Tests unitaires : `tests/numerotation.test.ts`,
  `tests/sales-brouillon-moto-confirmation.test.ts` (validation atomique et repli).

#### Trou de numérotation FAC-2026-00002 à FAC-2026-00004 — procès-verbal à faire par le comptable

- **Constat** (bible M06, base vérifiée) : les factures `FAC-2026-00002`, `FAC-2026-00003` et `FAC-2026-00004` d'ITALBIKE
  STORE (factures de test, payées) ont été **supprimées en SQL le 12/06/2026** (acteur vide dans `events`) ; la série FAC
  reprend à `FAC-2026-00005`. Une série de factures doit être continue : ce trou doit être **justifié**.
- **À faire par le comptable** : un **procès-verbal** daté et signé indiquant les numéros manquants (00002 à 00004), la
  date et la cause (données de test supprimées pendant la mise au point du logiciel, aucune opération réelle facturée),
  à conserver avec le facturier de l'exercice 2026.
- **Ce que le DMS ne fait pas** : aucun numéro n'est réutilisé ni réattribué, aucune donnée n'est purgée par ce lot.
  Le démarrage en production (purge des données de test, remise des compteurs) reste une décision du comptable : le
  réglage « vers le haut » permet de faire repartir une série au-delà des numéros de test, la purge elle-même n'est pas
  faite par ce lot.

### Ajouté le 19/11 — société de test « ItalTest » (COM005)

Demande du client : « créer une société de test, ItalTest, qui reproduit tout ce qu'il y a déjà sur ITALBIKE STORE,
pour faire des tests avec de vraies données », puis rejouer les 27 parcours G8 sans toucher à la vraie société.
Branche `lot-italtest`, migration `20261119160000_m0_societe_de_test_italtest.sql` (**non appliquée**).

- **Marquage** : table `test_companies` (une ligne par société de test : source, état de la copie, étape, compteurs).
  Écrite uniquement par les fonctions de copie ; **immuable** (ni retrait, ni changement de source), refusée sur une
  société qui contient déjà des données (ITALBIKE STORE ne peut pas être marquée « test »). Déclencheur `ENABLE ALWAYS`.
  `is_test_company(société)` la lit (utilisée aussi par le lot SMS Brevo).
- **Copie** (`admin_clone_company_for_test(source, 'ItalTest')`) : crée ou retrouve la société, donne **admin** aux
  administrateurs de la source (aucun compte créé), puis copie le référentiel avec de **nouveaux identifiants** et des
  liens recâblés (table `test_company_id_map`, ancien id → nouvel id) : paramètres (`reference_values`, numérotations
  remises à 1 avec le préfixe `TEST` devant celui de la source, ex. `TESTFAC`), comptes, tarifs et règles
  client, articles / catégories / fournisseurs / codes-barres / liens catalogue (sans les liens Shopify), contacts,
  motos et propriétaires, échéances d'entretien, kits et versions (articles cités dans le JSON recâblés), profils moteur
  et lignes par défaut des forfaits, réglages SMS, et le **stock en un mouvement d'ouverture par article**
  (`stock_moves`, origine `ouverture_societe_test`, append-only B7, aucun champ stock touché). Aucun historique : ni
  factures, tickets, OR, règlements, caisses (la société démarre **caisse fermée**), exports compta, events, GED,
  boutique Shopify, Stripe, boîtes Outlook, comptes de l'espace client, mandats SEPA.
  La justification table par table : `select * from admin_test_company_inventory()` (copiée / non copiée / à classer :
  une table nouvelle non classée est **purgée** dans la société de test mais jamais copiée, et l'essai le signale).
- **Coordonnées neutralisées** : e-mails → `test+<nouvel id>@invalid.local`, téléphones → `+00` + 9 chiffres
  (non attribuables), données MyDucati et scans de pièces d'identité vidés, tous les contacts en opposition marketing.
  Interlocuteurs, marchands de reprise, assureurs : idem. Le reste (adresses, TVA, IBAN...) est copié tel quel.
- **Aucun envoi sortant** (contrôlé en base ET dans chaque fonction Edge, `_shared/test-company.ts`, fermé par défaut) :
  file `notifications` → « skipped » ; relances d'entretien, relances d'impayés, SMS → mode « arrêté » forcé ;
  synchronisation et import Shopify coupés ; transfert comptable automatique « off » ; Stripe et boîtes Outlook refusés.
  Fonctions Edge gardées : graph-send-email (409 `test_company`, la vérification sans envoi reste possible),
  followups-send, dispatch-notifications (mails et SMS), sms-brevo, accounting-auto-transfer, proposal-sign (PDF archivé,
  pas de mail), send-account-invitation (l'avis « mot de passe modifié » passe par une vraie société de la personne),
  shopify-push / -publish / -sync-products / -import-content / -orders, stripe-checkout, outlook-poll.
  Les tâches pg_cron passent toutes par ces fonctions ou par la file `notifications` : rien ne part.
  Peppol : pas d'envoi automatique dans le DMS (UBL téléchargé seulement).
- **Rafraîchir** (Paramètres → Sociétés, bloc « Société de test », administrateurs) : confirmation, puis suppression de
  tout ce qui a été saisi dans ItalTest et recopie. Garde-fous : `_tc_run` refuse toute société absente de
  `test_companies` ; avant la purge, contrôle des **liens croisés** (une donnée d'une autre société qui pointerait vers
  ItalTest bloque tout, rien n'est supprimé). Les droits (`user_roles`) d'ItalTest sont conservés.
- **Machine à étapes** (contrôle → purge → société → identifiants → copie → stock → fin), en mode `replica` (déclencheurs
  métier coupés pendant la copie de la seule société de test ; les garde-fous ENABLE ALWAYS restent actifs), relançable
  après une interruption. L'écran l'appelle par tranches de 4 s (limite de 8 s des requêtes de l'application) :
  `admin_test_company_start` puis `admin_test_company_step(id, 4000)` en boucle ; l'API SQL par
  `admin_clone_company_for_test` (budget 85 s : la passerelle de l'API coupe la réponse vers 100 s).
- **Mesures (19/11, base de production, transaction annulée)** : première copie complète en **un appel de ~40 à 50 s**
  (93 839 articles, 152 461 liens catalogue, 8 182 contacts, 3 364 motos, 4 657 mouvements d'ouverture, 1 103 kits) ;
  appels de l'écran **≤ 4,4 s**, lot le plus long ~2,7 s (liens catalogue, lecture disque).
- **Bandeau** « Société de test » (couleur d'avertissement, icône fiole, FR/NL/EN/IT) en haut de toutes les pages ;
  fiole et mention « Test » dans le sélecteur de société.
- **Essais à blanc** : `supabase/tests/m0_societe_de_test_italtest.sql` (copie complète, recâblage, aucun envoi, refus,
  stock = source sur 300 articles + totaux, ITALBIKE inchangée — 43 contrôles), `m0_societe_de_test_rafraichir.sql`
  (source réduite : activité de test purgée, lien croisé refusé, rafraîchissement depuis l'écran — 11 contrôles),
  `m0_societe_de_test_etapes_8s.sql` (durée des appels de l'écran sur les vraies données).
- **Pièges** : un essai à blanc de plus de ~100 s est coupé par la passerelle mais **continue en base** jusqu'à son
  annulation, en gardant ses verrous (les déclencheurs posés par la migration verrouillent `notifications` et les
  réglages d'envoi pendant l'essai) : garder chaque essai sous 90 s. Les fichiers déposés en GED depuis ItalTest restent
  dans le stockage après un rafraîchissement (les lignes `attachments` sont purgées, pas les fichiers).

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
- Traduction des **données** (tables de référence, statuts stockés, textes des documents PDF) : non faite — lot 2 de la carte « Traduire l'application et les données » (seule l'interface est en quatre langues).
- Libellés encore en dur hors dictionnaire (donc toujours en FR quelle que soit la langue) : voir §7.
- Seed de démonstration (règle 8) : non fait (voir `avancement.md`).

## 7. Limites connues, dettes, pièges

- **Tout salarié voit tout** dans sa société (sauf, depuis N-1, les alertes d'inscription de la cloche) : la RLS de **lecture** ne distingue pas les rôles (`is_member`), sauf pour les tables d'administration (`companies`, `user_roles`, `document_sequences` en écriture, `reference_values` en écriture). Un mécanicien peut lire la comptabilité par l'API même si le menu la lui cache. Pour l'**écriture**, la migration `20261013140000_m0_droits_par_role_en_base.sql` (tables `page_permissions` + `table_write_pages`, fonction `can_write_table`) fait refuser par l'API ce que la grille refuse à l'écran ; son application en base n'est **pas vérifiée** (constat du 30/10). Tant qu'elle n'est pas appliquée, un rôle en lecture seule peut encore écrire par l'API : l'écran retire les boutons, la base ne refuse pas.
- `listOrgUsers` renvoie **tous** les profils de la base à un administrateur, quelle que soit sa société.
- `setUserRoles` supprime puis réinsère sans transaction ; un admin peut retirer son propre rôle admin et se verrouiller dehors.
- Un compte client qui passe par `/login` arrive sur un tableau de bord vide (aucune redirection dédiée).
- `grant_bootstrap_admin` donne le rôle admin sur toutes les sociétés à `simon@themaul.be` (adresse en dur dans la fonction).
- `contact_invitations` (table créée le 14/09) n'est pas utilisée : l'invitation passe par le jeton de récupération Supabase. 0 ligne en base.
- Libellés en dur, contraires à la règle i18n (restent en FR dans les autres langues) : cartes « Tables de données » de `_app.settings.index.tsx`, « Table inconnue » de `_app.settings.tables.$tableKey.tsx`, titres d'onglet `head: () => ({ meta: [{ title: '… — Ducati Bruxelles' }] })` de la plupart des routes, pages 404 / erreur de `__root.tsx` (en anglais), `aria-label="Menu"` de la barre du haut, textes des e-mails et des PDF générés côté serveur (`supabase/functions/`, `src/modules/*/pdf*`).
- La langue est lue avec `select('*')` sur `profiles` : tant que la migration `20261030150000` n'est pas appliquée, la colonne manque, tout le monde est en FR et l'enregistrement du choix échoue avec un message (la langue reste changée pour la session en cours).
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

## Ajouté le 19/11 — Mise en production (Paramètres, administrateurs)

**Demande client (19/11)** : un bouton « Mise en production » qui liste tout ce qui sera démarré, pour
passer de la recette à l'exploitation sans rien oublier, et revenir en arrière en cas de problème.

- **Où** : carte « Mise en production » en tête de Paramètres → fenêtre `src/modules/settings/production-dialog.tsx`
  (règles pures `production-rules.ts`, accès `production-api.ts`, libellés `src/lib/i18n/production.ts`, 4 langues).
- **La liste (17 éléments, `production_overview`)** : Shopify stock/prix/publication (`shopify_sync_settings.mode`
  arrete/essai/tous) · Shopify commandes du site (`shopify_order_settings.import_enabled`) · relances d'entretien
  (`followup_settings.mode`) · relances d'impayés (`receivable_settings.dunning_mode`) · relance automatique des
  factures échues · rappel de RDV par mail · confirmation de commande e-shop · invitation à l'espace client en pied
  de mail (ces 4 : `automation_switches`, nouveaux) · SMS (`sms_settings.mode`) · SMS de fin de travaux
  (`sms_settings.ready_auto`) · rappels de RDV par SMS (`reminder_auto`) · transfert comptable automatique
  (`accounting_transfer_settings.params.enabled` + fréquence) · relève Outlook · tri IA des prospects · résumé IA
  des échanges (`automation_switches`, nouveaux) · application client publique (`signup_settings.client_app_open`)
  · Stripe (affiché « non utilisé », jamais démarrable, décision client). Plus les **tâches pg_cron** (état,
  dernière exécution, message d'échec).
- **État** : Arrêté / Test / Actif / Non utilisé = couleur + icône + libellé (`StatusBadge`, jamais le rouge de la
  marque). **Ce qui manque** : secret absent (relevé par la fonction Edge `production-status`, oui / non, jamais la
  valeur : table `integration_status`), boîte d'envoi, adresse / numéro de test, fréquence compta, dépendance
  (SMS avant SMS de fin de travaux, relève avant IA).
- **Actions** (`production_apply(_company, _keys, _action)`) : `start` (Actif), `test`, `pause` (Arrêté). Tout ou
  rien : un élément refusé annule l'appel. Passe par l'interrupteur EXISTANT de chaque module
  (`shopify_sync_set_mode`, `shopify_orders_set_import`, `followup_settings_set`, `sms_settings_set`…), qui garde
  sa propre trace ; en plus une ligne `events` `production_switch` par élément (qui, quand, quoi, ancien / nouveau,
  action). Refus : non configuré (`MEP_NOT_CONFIGURED:<clé>:<manques>`), société de test (`MEP_TEST_COMPANY`,
  via `_sms_is_test_company` → `is_test_company` du lot ItalTest s'il existe), Stripe (`MEP_NOT_USED`). La pause
  reste possible partout, même pour une société de test.
- **Nouveaux interrupteurs** (`automation_switches`, `automation_mode(_company, _key)`) : arrêtés par défaut, sauf
  ce qui tournait déjà volontairement en production le 19/11 (vérifié : relève Outlook toutes les 5 min, 9
  prospects « mail » en 30 jours, 9 résumés en 7 jours, pied d'invitation P-5 / P-6) → actifs par défaut.
- **Lot ItalTest** : les trois nouvelles tables (`automation_settings`, `automation_switches`, `integration_status`)
  sont ajoutées à la liste « non copiées » de la copie de société de test (`_tc_skip`, complétée par la migration).
- **Piège** : `production_overview` / `production_apply` sont réservés aux administrateurs (`MEP_FORBIDDEN`).
  Les relances d'impayés ne passent en « actif » QUE par cette fenêtre : `receivable_settings_set` le refuse.

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
| 2026-09-21 | **Fonction de l'utilisateur** (`profiles.job_title`, ex. « Sales Manager ») pour la signature des e-mails : réglée par l'utilisateur (menu du compte → « Ma signature e-mail ») ou par l'administrateur (Paramètres → Utilisateurs → « Signature ») ; coordonnées de signature par société dans Paramètres → Sociétés | branche `lot-signature`, migration `20260921191000_m10_signature_mail.sql` (à appliquer) — détail M10 |
| 2026-10-13 | **Grille des droits par rôle** (M0-RBAC003) : chaque rôle ne voit que ses pages, certaines en lecture seule (menu, garde de route, bandeau, boutons) ; puis la même grille descendue en base (`page_permissions`, `can_write_table`) | `37eba65`, `4a09e63`, migration `20261013140000_m0_droits_par_role_en_base.sql` (application en base non vérifiée) |
| 2026-10-30 | **L'application parle français, néerlandais, anglais et italien** (I18N001, lot 1) : dictionnaires `nl.ts`, `en.ts`, `it.ts` (mêmes clés que `fr.ts`, test dédié), langue par utilisateur (`profiles.locale`), sélecteur « Langue » dans le menu du compte et dans Mon profil de l'espace client, bascule sans rechargement | branche `lot-app-quatre-langues`, migration `20261030150000_m0_langue_de_l_utilisateur.sql` (**à appliquer**) |
| 2026-10-30 | **Vérification contre le scan signé du 13/10** : les 19 × 6 cases de `PAGE_RULES` et de la migration collent au document, corrections violettes comprises. Écart corrigé : cinq écrans hors préfixe (`/accounting-closure`, `/accounting-sepa`, `/client-pricing`, `/consignment`, `/preparation`) étaient hors grille donc ouverts à tous ; ils prennent les droits de leur rubrique (`PAGE_ALIASES`). Test renforcé : un test par rôle, cumul de rôles sur toute la grille, menu et routes couverts | branche `lot-droits-verification` |
| 2026-10-30 | **Toute l'interface passe par le dictionnaire, titres d'onglets compris** (I18N003, lot 2 de la décision « l'app aussi au complet ») : 263 clés ajoutées aux quatre langues — `pageTitles.*` (81 pages, aide `pageTitle()` de `src/lib/i18n/index.ts`, suffixe « — Ducati Bruxelles » gardé), pages 404 / erreur de `__root.tsx`, menu mobile, textes des lecteurs d'écran de `src/components/ui/` (pagination, sidebar, breadcrumb, dialog, sheet), onglets des fiches client et article, cascade, familles, numérotation, tables de données, clôture, charte, éditeur de texte. `<LocaleHeadSync>` (`__root.tsx`) fait recalculer les titres d'onglet par le routeur au changement de langue ; `<html lang>` démarre en `fr`. Garde-fou : le test i18n refuse tout `title: '…'` littéral dans un `head()` de `src/routes`. Restent en dur, volontairement : exemples neutres (IBAN, n° TVA, téléphones, URL), unités (CH/kW), formats (PDF/CSV, polices), le gabarit de date `JJ/MM/AAAA` (syntaxe lue par l'imprimante d'étiquettes), l'en-tête CSV d'exemple de l'import tarif, la lettre « D » et le nom « Ducati Bruxelles » | branche `lot-i18n-chaines-en-dur` |
| 2026-10-30 | **Le client reçoit ses documents et mails dans sa langue** (I18N004, lot 4, M-71) : `tIn(locale, clé)` dans `src/lib/i18n` (traduire dans une langue donnée sans changer l'écran) ; langue du client sur la fiche (`contacts.locale`, source unique, le profil du compte client suit par déclencheur) ; choix de langue à l'inscription et à la borne (remise à zéro de la borne = retour à la langue de la tablette) ; mails de compte (`send-account-invitation`) et pied de mail (`graph-send-email`) dans la langue du destinataire, textes dans `supabase/functions/_shared/mail-i18n.ts` | branche `lot-documents-langue-client`, migration `20261030160000` (**à appliquer**), deux fonctions **à redéployer** — détail M01 et M09 |
| 2026-11-03 | **Un bouton « Retour » en tête de toutes les pages** (UX010, demande client) : rendu par l'ossature, masqué sur les entrées du menu, historique du navigateur si la page précédente est dans l'application sinon page parente (table d'exceptions dans `back-navigation.ts`), confirmation si un formulaire est modifié et non enregistré (`useLeaveGuard`), 44 px au toucher, libellés dans les quatre langues | branche `lot-bouton-retour` |
| 2026-11-03 | **Retour revient exactement à la page d'avant** (UX011, retour client « ne revient pas à la page d'avant avec la sélection ») : Retour saute le formulaire de création déjà utilisé et la même page (`history.go(-n)`), suivi des pages gardé dans l'onglet (survit au F5) ; recherche / filtres / onglet / page des listes Pièces, Clients, Ventes, Atelier, Véhicules, Commandes, CRM dans l'adresse ; brouillon d'onglet des formulaires Nouvel OR, nouveau document, nouveau client, nouvel article (`useFormDraft`, bandeau « Saisie en cours retrouvée ») ; « Ajouter une moto » revient au formulaire avec la moto créée (`?retour=`) ; défilement de la zone de travail restauré ; 2 libellés × 4 langues | branche `fix-bouton-retour-etat` ; aucune migration |
| 2026-11-03 | **Postes et périphériques** (PDV030, M-106) : réglage transverse par poste et par rôle, poste du navigateur mémorisé localement, couche `src/lib/devices/` (caisse et étiquettes) | migration `20261103250000_m6_postes_peripheriques.sql` non appliquée |
| 2026-11-18 | **Numérotation : deux modes au choix par société** (rattrapage G8, bloquant n° 5) : séries séparées FAC / TIK / AVO ou compteur unique façon G8 ; changement de mode seulement en début d'exercice ou programmé au 1er janvier ; prochain numéro réglable vers le haut par l'admin ou le comptable, motif tracé ; validation atomique (numéro + statut) ; garde sur les séries ; écran groupé avec explication par série ; trou FAC-2026-00002 à 00004 documenté (PV comptable) | branche `lot-g8-numerotation`, migration `20261118260000_m0_numerotation_deux_modes.sql` (**à appliquer**) |
