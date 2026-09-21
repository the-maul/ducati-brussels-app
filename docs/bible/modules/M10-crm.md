---
chapitre: M10
titre: CRM & marketing
etat: 🟦
verifie_le: 2026-09-19
missions: []
mots_cles: [CRM, signature, signature de mail, fonction, téléphone de la carte, pipeline, demande, lead, carte, tâche, échéance, retard, cloche, responsable, assignation, archiver, échange, e-mail, Outlook, relève, boîte mail, prospect, résumé, note, Claude, matching, moto en stock, notification, SMS, campagne, marketing]
---

# M10 — CRM & marketing

> **En une phrase** : suivre chaque demande d'un client ou d'un prospect, de l'e-mail reçu jusqu'à la vente, sans qu'aucune ne se perde ni ne soit oubliée.

## 1. À quoi ça sert

Le CRM est le tableau des **demandes** en cours (une carte = un client = un fil). Chaque carte porte
une seule tâche ouverte à la fois — quoi faire, pour quand, par qui —, l'historique des tâches faites,
les échanges avec le client (mails, appels, SMS, notes) et ses documents. Les mails arrivant sur quatre
boîtes Outlook de la concession sont relevés toutes les 5 minutes : un client connu voit le mail
ajouté à son historique, un inconnu qui fait une vraie demande devient une fiche **prospect** avec sa
carte et sa première tâche (tri par Claude). Chaque échange ajoute un paragraphe résumé à la note de
la carte. Les vendeurs répondent par mail depuis la carte. Le marketing (campagnes, SMS, réseaux
sociaux) n'est **pas** construit.

## 2. Ce qu'on a aujourd'hui

| Écran (menu → page) | Ce qu'on peut y faire |
|---|---|
| CRM (`/crm`) | Onglet « CRM commercial » (seul pipeline existant). Tableau en 6 colonnes : nouveau, contacté, qualifié, proposition, gagné, perdu. Chaque carte montre la tâche en cours, son responsable et son échéance (rouge si dépassée, orange si pour aujourd'hui), ou alerte « plus de tâche ». Changer d'étape par menu déroulant. Filtrer par source (Mail, Web, Reprise, VN, VO, Atelier, Pièces, Financement). Créer une demande à la main (avec première tâche « Recontacter le client » confiée au responsable par défaut). **L'e-mail décide (D3)** : fiche existante → carte reliée (et si ce client a déjà une carte ouverte, on ouvre la sienne au lieu d'un doublon) ; sinon fiche prospect créée (origine « manuel »). Sans e-mail : carte sans fiche, l'écran prévient. |
| CRM → carte d'une demande | En tête : la tâche en une phrase + trois boutons **C'est fait** (termine et ouvre la suivante dans le même geste), **Modifier la tâche**, **Archiver la carte**. Modifier nom, e-mail, téléphone, intérêt, valeur, note. Onglets **Échanges** (si la carte est liée à une fiche client ; sinon bouton **Relier ou créer la fiche client** : recherche nom/e-mail/téléphone ou création avec les infos de la carte, l'onglet apparaît sans recharger), **Tâches faites**, **Documents** (GED du client), **Suivi** (qui a fait quoi et quand). Supprimer la demande. |
| CRM → carte → Échanges | Choisir ce qu'on fait : Répondre par e-mail / Noter un appel / Noter un SMS / Note interne. E-mail : éditeur enrichi, pièces jointes (y compris depuis la GED du client), choix de la boîte d'envoi — par défaut celle qui a reçu le dernier mail du client, sinon une autre boîte partagée ou sa propre adresse. |
| Clients → fiche → onglet Historique | Même panneau d'échanges, sur la fiche client. |
| Barre du haut → cloche | Les **tâches CRM confiées à la personne**, en retard ou à faire aujourd'hui, liste cliquable (admin : + tâches sans responsable, bascule « Les miennes / Toute l'équipe »). En dessous, pour vendeur, marketing et admin, les **inscriptions de clients** des 7 derniers jours (borne / en ligne), cliquables vers la fiche, « lu » par utilisateur (mission 01, lot 5). Décision N-1, détail dans M00. |
| Véhicules → fiche → « Clients intéressés » | Liste des contacts dont les modèles suivis ou les usages (Route/Sport/Off-road/Piste) correspondent à la moto ; bouton pour les prévenir par mail (Outlook) ou SMS. |
| Paramètres → Utilisateurs → responsable par défaut | Choisir à qui reviennent les nouvelles demandes du CRM commercial ; reprendre ou non ses tâches ouvertes. |
| (automatique) Relève des mails | Toutes les 5 min : mails entrants et envoyés des boîtes actives ; pièces jointes en GED ; prospects créés ; résumés ajoutés aux notes. |

## 3. Où trouver quoi

| Quoi | Où |
|---|---|
| Écrans (routes) | `src/routes/_app.crm.tsx` ; cloche dans `src/components/layout/topbar.tsx` ; matching dans `src/routes/_app.vehicles.$vehicleId.tsx` ; responsable par défaut dans `src/routes/_app.settings.users.tsx` |
| Logique métier | `src/modules/crm/api.ts` (demandes, tâches, échéances, boîtes, envoi), `lead-detail.tsx` (la carte), `link-contact-panel.tsx` (relier une carte à une fiche), `communications-panel.tsx` (échanges), `matching-api.ts` (client ↔ moto) |
| Tables | `leads` (la demande : étape, source, pipeline, échéance, responsable, archivage), `lead_tasks` (tâches, **une seule ouverte par demande**), `communications` (échanges, boîte, date de résumé), `company_mailboxes` (4 boîtes relevées, un curseur par boîte), `notifications` (file d'envoi mail/SMS), `team_notifications` (alertes internes de la cloche, **jamais envoyées** ; aujourd'hui : `kind = signup`), `team_notification_reads` (lu, par utilisateur), `contact_merge_candidates` (rapprochements proposés), `reference_values` clés `lead_sla` et `lead_task/default_assignee` |
| Fonctions SQL (RPC) | `crm_create_manual_lead` (création manuelle : fiche + carte + tâche en une transaction), `crm_link_lead_contact` (relier une carte sans fiche), `lead_audit` (suivi nominatif), `company_members` (qui peut recevoir une tâche), `default_assignee`, `set_default_assignee` (admin), `lead_sla_hours`, `create_prospect_from_email`, `log_ignored_email`, `contacts_match_candidates`, `ingest_email`, `ingest_inbound_email`, `set_mailbox_cursors`, `append_lead_exchange_note`, `pending_exchange_summaries`, `enqueue_notification` ; déclencheurs `sync_lead_from_task` (`trg_lead_tasks_sync`, recopie échéance et responsable de la tâche sur la demande), `trg_notify_team_signup` (`trg_contact_accounts_notify_signup` sur `contact_accounts` : une alerte de cloche quand le compte vient de l'inscription publique, métadonnée `signup_origin` = `web` / `comptoir` ; un compte client créé par un admin ne notifie pas) |
| Fonctions serveur (Edge) | `supabase/functions/outlook-poll` (relève), `classify-prospect-email` (tri d'un mail inconnu par Claude), `summarize-exchange` (paragraphe de note par Claude), `graph-send-email` (envoi réel), `mailbox-diag` (diagnostic d'une boîte, lecture seule), `dispatch-notifications` (file d'envoi, inactive) |
| Tâches planifiées | `outlook-poll` (`*/5 * * * *`), `dispatch-notifications` (`*/10 * * * *`), `invoice-reminders` et `appointment-reminders` (alimentent la file `notifications`) |
| Migrations clés | `20260610390000_m10_crm.sql`, `20260612240000_m10_notifications.sql`, `20260612350000_m10_email_ingest.sql`, `20260612360000_m10_email_outbound.sql`, `20260914160000_m1_prospect_from_email.sql` à `20260914260000_m10_lead_archive.sql`, `20260918140000_m10_users_pipelines_mailbox_summary.sql`, `20260918141000_m10_pending_exchange_summaries.sql`, `20260919170000_m1_signup_team_notifications.sql` (cloche des inscriptions), `20260919180000_m10_manual_lead_contact.sql` (carte manuelle reliée à une fiche), `20260921190000_m10_lead_telephone_sans_email.sql` (téléphone de la carte : jamais un e-mail), `20260921191000_m10_signature_mail.sql` (signature des e-mails) |
| Signature des e-mails (21/09) | Construction : `signatureHtml`, `signatureFor`, `signaturePhone` et **gabarit des couleurs des mails** `MAIL_STYLE` dans `supabase/functions/_shared/mail-message.ts` (seul endroit des couleurs du HTML envoyé) ; lecture des réglages : `signatureBlock` dans `graph-send-email/index.ts` ; réglages société et noms des boîtes : `src/modules/settings/mail-signature-settings.tsx` (Paramètres → Sociétés) ; nom et fonction : `src/modules/settings/user-signature-dialog.tsx` (menu du compte « Ma signature e-mail » et bouton « Signature » de Paramètres → Utilisateurs) ; API : `src/modules/settings/mail-signature-api.ts` ; aperçu : `src/components/mail-preview.tsx` ; tests : `tests/mail-signature.test.ts` |
| Libellés | `src/lib/i18n/fr.ts`, blocs `crm`, `matching`, `notif` (cloche), `mailSignature` |
| Cloche (tâches) | `listBellTasks` dans `src/modules/crm/api.ts` (`listLeadsDue`, ancienne cloche par échéance de la demande, n'est plus utilisée) |

## 4. Règles métier et décisions

- **Une demande = une carte = un client** ; **une seule tâche ouverte** par carte, garantie en base par l'index unique partiel `uq_lead_tasks_open` (décision client du 14/09 : « ne crée pas de doublon »).
- **Trois sorties d'une carte, pas plus** (14/09 au soir) : la tâche reste à faire (on ferme, aucune question) ; « C'est fait » (termine et ouvre la suivante) ; « Archiver la carte » (quitte le pipeline sans être supprimée, ni gagnée ni perdue).
- **L'échéance appartient à la tâche** ; un échange avec le client ne la déplace plus (déclencheurs `trg_leads_due` et `trg_comms_bump_lead_due` retirés le 14/09). Délai par défaut 48 h (`lead_sla`).
- **Tri des mails inconnus par l'IA (D1)** : une fiche n'est créée que pour une vraie demande d'un prospect ; fournisseur, newsletter, Ducati ou indésirable ne produisent qu'une trace (`log_ignored_email`). Réponses automatiques et adresses internes écartées avant l'appel à Claude.
- **Message relayé** (formulaire Shopify) : on extrait l'adresse réelle du corps ; `origin = web`, `source = WEB`. Direct : `mail` / `MAIL`.
- **Curseur de relève** : avance seulement après traitement réussi ; la relève **s'arrête au premier échec** pour que le message repasse (incident du 14/09 sur `occasions@`).
- **Envoi par Outlook / Microsoft Graph** (D4), jamais Resend. Le serveur vérifie que l'appelant est membre de la société et que l'adresse d'expédition appartient à la société ou à l'appelant.
- **`graph-send-email` : simulation et trace** (19/09, mission 05 carte 8) : `dryRun: true` = mêmes contrôles (connexion, société, boîte, pied de mail) mais **rien n'est envoyé ni enregistré** ; la fonction renvoie le message construit (bouton « Vérifier sans envoyer » de l'envoi d'un document). `trace: { entityType: 'documents', entityId }` = le document doit être de la société ; après l'envoi, une ligne `events` `email_sent` (qui, quand, à qui, boîte, objet, fichiers). Message Graph assemblé par `supabase/functions/_shared/mail-message.ts` (testé). Appelants existants inchangés.
- **Pied de mail (P-5, P-6)** : sous chaque mail envoyé par `graph-send-email`, destinataire unique hors concession : **sans compte** → invitation P-5 + « Créer mon compte » (`<adresse client>/inscription?email=…`) ; **compte client jamais venu sur `/mon-espace`** (`contact_accounts.first_portal_visit_at` vide) → « Votre espace Ducati Bruxelles est prêt… » + « Me connecter » (`<adresse client>/login`) ; **déjà venu**, compte de l'équipe, compte désactivé ou doute → rien. L'adresse client vient de l'appelant (`clientAppUrl()`).
- **Signature des e-mails selon l'adresse d'envoi (21/09, décision P-7)** : `graph-send-email` l'ajoute à **tous** les envois (réponse depuis une carte, document de vente, fournisseur), **entre le message et le pied de mail**. Adresse **personnelle** → nom (`profiles.full_name`) en gras + fonction (`profiles.job_title`) en gris italique ; **boîte partagée** → nom de la boîte (`company_mailboxes.signature_name`), sans personne (vide : la signature commence par la concession). Puis nom de la concession en rouge gras, adresse, « T : » (téléphone E.164 affiché `+32 (0) 2 …`), « E : » = **adresse d'envoi** en lien `mailto`, lien souligné vers le site public. Coordonnées réglables **par société** (`companies.mail_signature_brand/_address/_phone/_site_url/_site_label` ; vides → nom et adresse de la fiche société) dans Paramètres → Sociétés → « Signature des e-mails » (enregistrement séparé du reste de la fiche) ; fonction réglable par l'utilisateur (menu du compte) et par l'administrateur (Paramètres → Utilisateurs). Écritures par `set_user_mail_signature` et `set_company_mail_signature` (droits vérifiés en base, trace `events` : `user_mail_signature_update`, `company_mail_signature_update`, `mailbox_signature_update`). Lecture en best-effort : une base sans la migration donne une signature réduite (nom de la société + adresse), jamais un échec d'envoi. Les modèles de texte ne finissent plus par le nom de la société (« Cordialement, ») : la signature le porte. **Aucune donnée réelle dans le dépôt** : nom de la concession, adresse, téléphone saisis à l'écran.
- **« Vérifier sans envoyer » partout (21/09)** : la réponse depuis une carte, l'envoi d'un document et l'envoi fournisseur montrent l'**aperçu HTML** du message renvoyé par `dryRun` (texte, signature, pied de mail), dans un cadre isolé sans script (`MailPreview`). Depuis une carte, l'aperçu n'envoie pas les pièces jointes (contrôle du texte seulement).
- **Téléphone de la carte (21/09, M-23)** : `leads.phone` est **distinct** du téléphone de la fiche client. Même règle que les fiches (M01) : saisie par le composant téléphone (préfixe pays + numéro), enregistrement **E.164**, refus à l'écran d'un texte qui n'est pas un numéro (« Corrigez le téléphone… », bouton Enregistrer désactivé ; une ancienne valeur non modifiée ne bloque pas) ; en base, le déclencheur `trg_leads_phone_not_email` déplace une adresse e-mail vers `leads.email` s'il est vide, sinon vide le champ (`events` `lead_phone_email_guard`) ; cartes existantes réparées une fois (`lead_phone_email_repair`).
- **Plusieurs CRM** (18/09) : colonne `leads.pipeline` ; ajouter le CRM atelier = une valeur dans `PIPELINES` (`api.ts`). Ne pas le créer avant la demande client.
- **Note vivante** (18/09) : un paragraphe daté par échange, ajouté une seule fois (`append_lead_exchange_note`), copies d'un même envoi relevé dans deux boîtes ignorées.

## 5. État en production

Vérifié le 18/09/2026 dans le code et dans la base.

- ✅ Toutes les tables et fonctions appelées par `src/modules/crm/` existent. 37 demandes (36 actives, 35 tâches ouvertes), 514 échanges, 4 boîtes actives, 13 notifications (toutes `skipped`).
- ✅ Jobs `outlook-poll` et `dispatch-notifications` actifs dans `cron.job`. `summarize-exchange` et `send-account-invitation` déployées le 18/09.
- ✅ `createLead` essaie d'écrire `oro_id` / `reprise_status` (colonnes M7 **absentes** en base) puis retombe sur un insert sans elles : la création fonctionne, le lien reprise est perdu. `syncLeadRepriseStatus` ne fait rien en silence.
- 🔴 **Quatre fonctions Edge sont ouvertes à tout Internet** (`verify_jwt = false` en production, aucun contrôle dans le code) :
  - `classify-prospect-email` : n'importe qui peut faire travailler Claude aux frais de la concession ;
  - `outlook-poll` : n'importe qui peut déclencher la relève (et donc des appels Claude) ;
  - `mailbox-diag` : renvoie la liste des dossiers, les volumes, l'objet et l'expéditeur du dernier mail de chaque boîte écoutée (les adresses sont publiques, ex. `info@`) ;
  - `read-id-doc` (voir M1).
  `graph-send-email` a aussi `verify_jwt = false` mais contrôle l'appelant dans son code.
- 🔴 `ingest_email` et `ingest_inbound_email` sont exécutables sans être connecté et sans contrôle : avec un `company_id`, on peut injecter de faux mails dans l'historique d'un client ou tester si une adresse est cliente.
- 🔴 **Tout salarié peut détourner une boîte Outlook.** `company_mailboxes` est modifiable par n'importe quel membre (politique `company_mailboxes_all` = `is_member`, pas d'admin requis). En y ajoutant par l'API l'adresse d'un collègue du même tenant Microsoft 365, il fait **relever sa boîte** dans le CRM (permission applicative `Mail.Read` de la relève) et peut **envoyer en son nom** (`graph-send-email` accepte toute adresse présente dans la table). Seule une stratégie d'accès Exchange limitant l'application Azure à certaines boîtes empêcherait cela : **à vérifier** côté Microsoft 365.
- ⚠️ Le **matching** ne regarde que les **500 premières fiches** par ordre alphabétique (`listContacts` → `contacts_search` limité à 500) sur 8 108 : la plupart des clients intéressés ne sont jamais proposés.
- ⚠️ Envoi SMS : la file `notifications` pointe vers Resend et un fournisseur SMS sans clé ; tout part en `skipped`. Le bouton SMS du matching n'envoie donc rien, mais note l'échange comme envoyé.
- ⚠️ Deux demandes ont une source hors liste (`mail` en minuscules, et un texte libre) : elles n'apparaissent que sans filtre.
- ⚠️ Le délai `lead_sla` n'est **pas** modifiable depuis Paramètres → Tables (clé absente de `reference-tables.ts`), contrairement à ce qu'annonce `plan-nouveau-client.md`.

## 6. Prévu / en cours

Source : [`../../plan-nouveau-client.md`](../../plan-nouveau-client.md) et `etat-projet.md` §7.
- CRM atelier (à ne pas créer avant la demande client).
- Écran de revue des rapprochements (`contact_merge_candidates`).
- Questionnaire du site dans le même tuyau que les mails (lot 5) ; borne comptoir (lot 4).
- ~~Notification interne quand un prospect s'inscrit (lot 5).~~ Fait le 18/09 (cloche).
- SMS : en attente du fournisseur et de sa clé (`etat-projet.md` §8).
- Transferts de mail (demandeur ≠ expéditeur) mal reconnus : « point à surveiller » du plan.

## 7. Limites connues, dettes, pièges

- **Pas d'écran pour gérer les boîtes relevées** : ajouter une boîte = une ligne SQL dans `company_mailboxes`. Le commentaire d'`outlook-poll` renvoie à « Paramètres → Sociétés », qui n'édite que l'ancien champ `companies.inbound_mailbox`.
- **Un message en échec permanent bloque sa boîte** : la relève s'arrête au premier échec et le réessaie à chaque passage, les mails suivants de ce dossier ne sont plus traités tant qu'il n'est pas débloqué.
- La relève lit les **25 mails les plus récents** par dossier et par passage : plus de 25 mails en 5 minutes sur une boîte = les plus anciens sautés.
- Une demande créée à la main **sans e-mail** n'est liée à aucune fiche client : pas d'onglet Échanges, documents rangés sur l'entité `lead` (les documents déjà rangés sur la carte ne suivent pas quand on la relie ensuite à une fiche). Les cartes créées avant le 19/09 se relient avec le bouton de la carte.
- `createLead` (api.ts) reste utilisé par l'assistant de reprise ; l'écran CRM passe par `crm_create_manual_lead`.
- **Ne jamais écrire `const f = supabase.rpc`** : `rpc` lit `this.rest`, l'appel détaché plante dans le navigateur (« Cannot read properties of undefined (reading 'rest') ») sans aucune requête vers la base, donc **rien dans les journaux Supabase**. Écrire `supabase.rpc.bind(supabase)` ou `(supabase.rpc as any)(…)` (les parenthèses gardent `this`). Garde-fou : `tests/rpc-bound.test.ts` (dossier `src/modules/crm/`). Même motif encore présent dans `src/modules/contacts/api.ts` (`contact_merge_preview`, `contact_merge`).
- La migration `20260919180000` a été appliquée hors `supabase db push` : les deux fonctions et leurs droits sont en base, mais la version n'est **pas** inscrite dans `supabase_migrations.schema_migrations` (vérifié le 19/09).
- Le passage d'étape n'est pas un glisser-déposer mais un menu déroulant.
- `deleteLead` supprime physiquement une demande (tracé dans `events`).
- Les étapes gagné / perdu restent au tableau ; seule l'archive les en retire.
- **Deux tables de « notifications »** : `notifications` = file d'**envoi** e-mail/SMS (vidée par `dispatch-notifications`) ; `team_notifications` = alertes **internes** de la cloche, jamais envoyées. Ne jamais mettre une alerte interne dans `notifications`.
- `team_notifications.contact_id` n'a **volontairement pas** de clé étrangère (sinon `contact_merge` refuserait la fusion d'une fiche inscrite) : après une fusion, l'alerte mène à la fiche archivée.
- Modèle Claude en dur : `claude-opus-5` dans `classify-prospect-email` et `summarize-exchange` (et `claude-opus-4-8` dans `read-id-doc`).

## 8. Exigences du cahier couvertes

| Code | Libellé | État | Preuve |
|---|---|---|---|
| CRM000 | Paramétrage standard | 🟦 partiel | `lead_sla`, responsable par défaut ; ni étapes ni sources paramétrables (`LEAD_STAGES`, `LEAD_SOURCES` en dur) |
| CRM001 | Pipeline de vente structuré | ✅ fait | `_app.crm.tsx`, `leads`, `lead_tasks` |
| CRM002 | Synchronisation Salesforce | ⬜ manquant | hors build (`CLAUDE.md` §5 : écran copiable + CSV prévu, non fait) |
| CRM003 | Leads automatiques depuis web, bornes, e-mails | 🟦 partiel | e-mails et formulaire Shopify relayé : `outlook-poll` + `create_prospect_from_email` ; bornes : non |
| CRM004 | Classification automatique par type de demande et modèle | 🟦 partiel | `classify-prospect-email` (prospect ou non, intérêt, moto citée, canal) ; pas de routage par type |
| CRM005 | Pipelines distincts avec relances automatisées | 🟦 partiel | `leads.pipeline`, un seul pipeline (`PIPELINES = ['commercial']`) |
| CRM006 | Relances et rappels vendeurs | 🟦 partiel | échéances + cloche ; aucun rappel envoyé (mail/SMS) |
| CRM007 | Bornes tactiles showroom | ⬜ manquant | lot 4 |
| CRM008 | Chatbot IA vérifiant le stock et faisant un proforma | ⬜ manquant | — |
| CRM010 | Alias mail pour routage vers les bons services | 🟦 partiel | 4 boîtes relevées, réponse depuis la boîte qui a reçu ; pas de routage par service |
| CON007 | Alerte client quand un véhicule correspondant arrive | 🟦 partiel | `matching-api.ts`, déclenché à la main depuis la fiche véhicule, limité à 500 fiches, pas d'alerte automatique à l'entrée en stock |
| VEN001 | Relances automatiques templatées | ⬜ manquant côté CRM | — |
| MKT000–MKT008 | Marketing (campagnes, analytics, multicanal, réseaux sociaux, publication VO, WhatsApp, chatbot) | ⬜ manquant | aucun code ; `marketing_opt_out` existe sur `contacts` |
| TEL002 | Journal des appels manqués | ⬜ manquant | seule la saisie manuelle « Noter un appel » existe |

## 9. Historique

| Date | Changement | Commit ou migration |
|---|---|---|
| 2026-06-11 | Pipeline de leads (6 étapes) + journal des communications sur la fiche client | `de62fc4`, migration `20260610390000_m10_crm` |
| 2026-06-12 | Fiche lead ; file de notifications + crons + Edge d'envoi | `45e87ca`, `8b9c2a9`, migration `20260612240000` |
| 2026-06-22 | Connexion Outlook : mails entrants et envoyés dans l'historique, envoi depuis l'app, éditeur enrichi, pièces jointes | `1e80cc0`, `126e32d`, `f86c61c`, migrations `20260612350000`, `20260612360000` |
| 2026-07-26 | Matching client intéressé ↔ moto en stock | `6954757` |
| 2026-07-27 | Envoi via Microsoft Graph au lieu de Resend | `5df333a` |
| 2026-09-14 | Lot 1 : un mail d'inconnu crée fiche prospect + carte ; relais Shopify ; canal d'arrivée ; échéance et cloche ; suivi nominatif ; assignation ; diagnostic de boîte | `b9022cb`, `1a813fa`, `0df1673`, `a271cf4`, `145f766`, `d10bc49`, `d38bef9` |
| 2026-09-14 | La tâche devient un objet, une seule ouverte par carte ; trois sorties ; archivage | `8b66784`, `d5ae557`, `403e268`, migrations `20260914240000`, `20260914260000` |
| 2026-09-18 | Onglets de CRM (commercial), boîte de réponse par défaut, note résumée à chaque échange, responsable par défaut | `872fa30`, migrations `20260918140000`, `20260918141000` |
| 2026-09-19 | `graph-send-email` : mode simulation `dryRun`, trace `events` d'un document envoyé, message construit par `_shared/mail-message.ts` ; **déployée le 19/09** (le pied de mail à deux variantes est donc en ligne) | mission 05 carte 8 |
| 2026-09-19 | **Pied de mail à deux variantes** (P-6) : aussi pour les comptes clients jamais venus sur leur espace (« Me connecter ») ; « Créer mon compte » pour les autres | branche `lot-pied-mail`, migration `20260919200000_m0_portail_visite.sql` (appliquée le 19/09) ; fonction `graph-send-email` **à déployer** |
| 2026-09-18 | **Cloche : nouvelles inscriptions de clients** (borne / en ligne), cliquables vers la fiche, lu par utilisateur ; les 2 inscriptions de test du 18/09 reprises | branche `lot-notif-tri`, migration `20260919170000` (appliquée le 18/09) |
| 2026-09-19 | **Carte créée à la main reliée à une fiche client** (l'e-mail décide, pas de doublon de carte, fiche prospect « manuel ») ; bouton « Relier ou créer la fiche client » sur une carte sans fiche | branche `lot-carte-fiche`, migration `20260919180000` (appliquée le 19/09) |
| 2026-09-19 | **Correctif : création d'une fiche client depuis une carte créée à la main.** Les boutons « Créer » (nouvelle demande) et « Relier ou créer la fiche client » plantaient avant d'appeler la base (`rpcUntyped` détaché du client, `this` perdu) : aucun appel `crm_create_manual_lead` ni `crm_link_lead_contact` dans les journaux de production du 18/09, alors que les deux fonctions répondent correctement en base (essai en transaction annulée). Corrigé par `.bind(supabase)` + test | branche `lot-lead-fiche`, aucune migration |
| 2026-09-21 | **Téléphone de la carte CRM : jamais un e-mail** (retour client « Ne pas laisser la possibilité de mettre un mail dans champs téléphone ») : composant téléphone et refus à l'écran (carte et « Nouvelle demande »), stockage E.164, garde-fou et réparation en base sur `leads` | branche `lot-signature`, migration `20260921190000_m10_lead_telephone_sans_email.sql` (**à appliquer après** `20260921160000`) |
| 2026-09-21 | **Signature des e-mails selon l'adresse d'envoi** (P-7) : ajoutée par `graph-send-email` à tous les envois ; réglages société et noms des boîtes (Paramètres → Sociétés), nom et fonction (menu du compte, Paramètres → Utilisateurs) ; aperçu HTML dans « Vérifier sans envoyer » (carte CRM, document, fournisseur) | branche `lot-signature`, migration `20260921191000_m10_signature_mail.sql` (**à appliquer**) ; fonction `graph-send-email` **à déployer** |
| 2026-09-19 | **Cloche : chacun ses tâches** (décision N-1) — tâches ouvertes confiées à la personne au lieu de toutes les demandes en retard ; inscriptions réservées à vendeur, marketing, admin (filtré en base) | branche `lot-cloche-login`, migration `20260919190000` (appliquée le 19/09) |
