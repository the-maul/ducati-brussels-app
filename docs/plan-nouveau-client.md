# Plan « Nouveau client » — acquisition, fiche, compte et portail

> **Chantier en cours.** Ouvert le **2026-09-14**. Ce document est la **source de vérité** du chantier :
> décisions prises, état des briques existantes, découpage en lots, critères d'acceptation.
> À lire avant de toucher à la capture des mails, à l'inscription client ou au portail.
> Voir aussi : [`etat-projet.md`](etat-projet.md) (état général), [`../CLAUDE.md`](../CLAUDE.md) (règles).

---

## 1. Le problème

Aujourd'hui, un prospect qui écrit à la concession est **perdu**. Le mail reste dans la boîte Outlook.
La relève automatique existe et tourne, mais elle **ignore délibérément tout expéditeur inconnu** :
la fonction `ingest_inbound_email` renvoie `matched = false` et ne crée rien.

Objectif : qu'une demande d'information devienne **une fiche client, une tâche CRM et une invitation
à créer un compte**, quel que soit le canal d'arrivée.

---

## 2. Les quatre canaux d'entrée

| # | Canal | Ce qui doit se passer |
|---|---|---|
| 1 | **E-mail** vers une boîte d'écoute | Analyse du mail, création d'une fiche « prospect » préremplie, tâche CRM, invitation à créer un compte |
| 2 | **Site web** (questionnaire → `shop@ducatibxl.be`) | Identique au canal 1 |
| 3 | **Comptoir** (l'atelier renvoie toujours vers le comptoir) | Tablette en libre-service : le client crée lui-même son compte et sa fiche. Plus un encodage manuel par le vendeur |
| 4 | **Téléphone** | Encodage manuel par le vendeur |

---

## 3. Décisions déjà prises (client, 2026-09-14)

- **D1 — Pas de branche « ignorer » séparée.** C'est l'analyse du mail par l'IA qui décide.
  Elle ne crée une fiche **que** si c'est une demande d'information d'un prospect, sur un véhicule,
  une pièce ou un renseignement. Un fournisseur, une newsletter, un mail de Ducati ou un indésirable
  ne produit **rien**.
- **D2 — Tri du fichier repris de G8.** Un contact **sans facture identifiée reste prospect**.
  Un contact **avec au moins une facture devient client**. Tout nouvel arrivant entre en **prospect**.
- **D3 — Détection des doublons.** C'est **l'adresse e-mail** qui détermine si le contact est nouveau.
  En cas de **ressemblance** (nom et prénom identiques, ou même société), on **propose une fusion**,
  **validée à la main**. Jamais de fusion automatique.
- **D4 — Envoi des e-mails.** On passe par **Outlook / Microsoft Graph**, déjà opérationnel.
  Pas de Resend, pas de nouveau fournisseur, pas de domaine à faire vérifier.

### Chiffres du tri D2 (relevés le 2026-09-14)

| Mesure | Valeur |
|---|---|
| Contacts au total | 8 094 |
| dont fournisseurs (hors tri) | 101 |
| Avec au moins une facture → **client** | 4 165 |
| Restants → **prospect** | ~3 828 |
| Contacts avec un e-mail renseigné | 6 134 |
| Adresses e-mail portées par plusieurs fiches | 112 (hors fournisseurs) |
| dont **mêmes nom et prénom** → vrais doublons à fusionner | 28 |
| dont **noms différents** → adresse partagée, à conserver | 84 |

> **La reconnaissance par e-mail n'est pas suffisante à elle seule.** 84 adresses sont partagées par
> des personnes différentes : un couple, une famille, ou l'adresse générale d'une société. Un mail
> venant d'une de ces adresses est **ambigu** et ne doit pas être rattaché au hasard : il faut
> demander à qui le rattacher dans la tâche CRM. Seuls les 28 cas à nom identique relèvent de la fusion.

---

## 4. Ce qui existe déjà (ne pas réécrire)

| Brique | État | Emplacement |
|---|---|---|
| Relève Outlook toutes les 5 min, idempotente, pièces jointes en GED | ✅ | `supabase/functions/outlook-poll/index.ts` |
| Journalisation d'un mail sur un contact connu | ✅ | RPC `ingest_inbound_email` (migration `20260612350000`) |
| Envoi d'e-mail depuis la boîte de la société | ✅ envois réels confirmés | `supabase/functions/graph-send-email/index.ts` |
| Appel Claude avec **sortie au format imposé** (gabarit à copier) | ✅ | `supabase/functions/read-id-doc/index.ts` |
| Clé `ANTHROPIC_API_KEY` posée côté Supabase | ✅ | secret Edge Function |
| Statut `prospect / client / client_piece / client_atelier` | ✅ enum en base | type `contact_status` |
| Détection de doublons (nom, ville, téléphone, e-mail) | ✅ | RPC `contacts_find_duplicates` |
| Champs professionnels séparés des champs privés | ✅ | `contacts.company_name`, `vat_number`, `email_pro`, `phone_pro`, `mobile_pro`, `contact_name` |
| Prise de photo caméra + galerie + recadrage + compression | ✅ écrit deux fois | `src/modules/contacts/id-docs.tsx`, `src/modules/tradein/reprise-photos-panel.tsx` |
| Motif de page publique (RPC `security definer` ouvertes à `anon`) | ✅ | `src/routes/shop.$slug.tsx`, migration `20260610440000` |
| File de notifications (relance, programmation, traçabilité) | 🟡 pointe vers Resend sans clé, tout part en « ignoré » | table `notifications`, `supabase/functions/dispatch-notifications/index.ts` |
| Pipeline CRM (leads, étapes, journal des communications) | ✅ | tables `leads`, `communications` |

### Limites connues à corriger

1. **La relève ne lit qu'un aperçu de 255 caractères** du corps du mail (`bodyPreview`), et 25 messages
   par passage. L'analyse a besoin du **corps complet**.
2. **Une seule boîte d'écoute par société** (`companies.inbound_mailbox`, champ texte simple).
   Il en faut au moins deux : la boîte générale et `shop@ducatibxl.be`.
3. **Aucune colonne d'origine** sur `contacts`. Impossible aujourd'hui de distinguer une fiche créée
   automatiquement d'une fiche saisie par un vendeur.
4. **Le portail client n'existe pas et ne peut pas exister en l'état.** Toute la sécurité repose sur
   « cet utilisateur est-il membre de la société » (`profiles` + `user_roles`, rôles internes
   uniquement). Un client n'est pas membre : il ne verrait rien.

---

## 5. Architecture cible

```
Boîtes Outlook (générale + shop@)
        │  relève toutes les 5 min, corps complet
        ▼
  ingest_inbound_email
        │
        ├── expéditeur connu ──────────────► journal du contact (inchangé)
        │
        └── expéditeur inconnu
                │
                ▼
        Analyse Claude (1 appel, sortie au format imposé)
                │
                ├── pas un prospect ──────► rien, seulement une trace
                │
                └── prospect
                        ├─► fiche contact, statut « prospect », origine « mail »
                        ├─► tâche CRM (demande, date, canal, contact)
                        ├─► doublon possible ? ──► proposition de fusion à valider
                        └─► invitation par e-mail (jeton à usage unique)
                                    │
                                    ▼
                           Page d'inscription publique
                                    │
                                    ▼
                        Compte client ⇄ fiche contact
                                    │
                                    ▼
                        Portail client (mobile d'abord)
```

---

## 6. Découpage en lots

Chaque lot = une branche, une PR, un titre lisible par le client. Chaque lot est **testé et montré**
avant de passer au suivant. Les migrations sont **appliquées à la main sur Supabase** et cochées dans
le tableau de `docs/avancement.md` (voir le risque n°1 au §8).

### Lot 0 — Décisions et fondations

**But** : lever les inconnues et poser le socle de données.

- [ ] Trancher les questions ouvertes du §7.
- [x] Migration : plusieurs boîtes d'écoute par société, **avec un curseur de relève par boîte**
      (un curseur unique ferait sauter des mails sur la seconde boîte relevée).
- [x] Migration : colonne `contacts.origin` (`mail`, `web`, `comptoir`, `manuel`, `import_g8`),
      rétro-remplie à `import_g8` pour les fiches reprises de G8.
- [x] Migration : table `contact_invitations` (jeton, contact, expiration, usage unique).
- [ ] Revue des **28 vrais doublons** d'e-mail, fusion validée à la main.

**Fait quand** : les migrations sont appliquées **et vérifiées en base**, les 28 doublons sont traités.

### Lot 1 — Capture des mails

**But** : plus aucun prospect perdu. Ce lot apporte de la valeur **seul**, même si le portail ne sort jamais.

- [x] **Côté base, appliqué et testé le 14/09** : `create_prospect_from_email` (fiche + lead +
      journal, idempotent sur l'identifiant du message Graph), `log_ignored_email` (trace sans
      fiche), `contacts_match_candidates` (recherche souple) et `contact_merge_candidates`.
- [x] **Analyse du mail écrite** : `supabase/functions/classify-prospect-email`. Un seul appel
      à Claude, sortie au format imposé. Ce n'est pas un agent : ni boucle, ni outil. Répond à
      « est-ce un prospect ? » et extrait nom, prénom, téléphone, société, numéro de TVA, objet
      de la demande, et le côté **privé ou professionnel**.
- [x] **Relève réécrite** : `supabase/functions/outlook-poll` lit le **corps complet** du mail
      (avant : 255 caractères d'aperçu), boucle sur **plusieurs boîtes** avec un curseur par
      boîte, et traite l'expéditeur inconnu au lieu de l'ignorer. Les réponses automatiques et
      nos propres adresses sont écartées sans appel à l'analyse, pour ne pas payer pour rien.
- [x] **Déployé le 14/09** : `classify-prospect-email` et `outlook-poll` sont en production.
- [x] **Boîtes configurées** : `domenico@`, `info@`, `shop@` et `occasions@ducatibxl.be`, toutes
      sur ITALBIKE STORE. Les curseurs ont été mis à l'heure de l'activation pour éviter que la
      première relève ne rattrape plusieurs jours de courrier d'un coup.
      Pour en ajouter une autre plus tard, il suffit d'une ligne dans `company_mailboxes` :
      la relève boucle sur la table, il n'y a pas de code à toucher.
- [x] **Relève vérifiée en production** : exécutée deux fois à la main, sans erreur, les trois
      boîtes sont lisibles par Microsoft Graph. Un premier 503 sur `info@` était passager.
- [x] **Clé `ANTHROPIC_API_KEY` posée le 14/09.** Elle manquait depuis le début du projet. Cela
      débloque aussi `read-id-doc`, la lecture automatique des permis et cartes d'identité
      construite en juillet, qui n'avait donc jamais fonctionné en production.
- [x] **Analyse vérifiée sur trois cas réels** : une particulière demandant une Monster 937
      (reconnue prospect, téléphone et intérêt extraits, non professionnelle), une newsletter de
      fournisseur (écartée), et une société demandant un devis d'entretien de flotte (reconnue
      prospect et professionnelle, raison sociale et numéro de TVA extraits).
- [ ] **Écran de revue** des rapprochements proposés (`contact_merge_candidates`).

**Fait quand** : un mail de test envoyé depuis une adresse inconnue produit une fiche et une tâche ;
un mail de fournisseur ou une newsletter ne produit rien ; un mail d'un client connu se comporte
comme avant.

**Vérifié le 14/09 sur la vraie base** : fiche créée en statut prospect avec l'origine `mail` et un
code client attribué automatiquement, lead créé à l'étape « nouveau » avec l'intérêt repris, mail
journalisé, trace présente pour un mail écarté, et le rejeu du même message ne duplique rien.
Un défaut a été trouvé et corrigé au passage : `contact_id` est à la fois une colonne de sortie de
la fonction et une colonne de table, ce qui rendait la clause de conflit ambiguë. Données de test
supprimées après contrôle.

#### Retours client du 14/09, traités le jour même

Le premier vrai prospect créé en production venait du **formulaire de contact Shopify**. Il a révélé
cinq manques, tous corrigés :

1. **Expéditeur relayé.** La fiche portait `mailer@shopify.com` au lieu de l'adresse du client, et la
   notification Shopify suivante s'était déjà rattachée à cette fiche. À terme tous les clients venus
   du formulaire s'y seraient empilés. L'analyse reconnaît maintenant un message relayé et extrait
   l'adresse réelle du corps. Quand aucune adresse n'est trouvable, la fiche est créée **sans**
   adresse plutôt qu'avec celle du relais.
2. **Canal d'arrivée.** Une demande passée par le site arrive techniquement par mail, mais ce n'est
   pas le même canal. Relayé donne `origin = web` et `source = WEB`, direct donne `mail` et `MAIL`.
3. **Cartes invisibles dans le CRM.** Le filtre comparait la source à une liste figée (REP, VN, VO,
   ATELIER, PIECE, FINANCEMENT). Une demande arrivée par mail n'appartenait à aucune colonne et
   n'était visible que sous « Tous les leads ». Deux entrées ajoutées.
4. **Capture incomplète.** On ne retenait que nom, téléphone et intérêt. L'analyse rend désormais
   aussi ville, code postal, pays et la référence de moto ou de châssis citée. La tâche CRM porte un
   résumé complet : demande, moto citée, TVA, localité, date et canal de réception.
5. **Documents invisibles.** Le panneau Documents de la tâche visait l'entité `lead`, alors que la
   relève dépose les pièces jointes sur l'entité `contact`. Les deux dossiers ne se voyaient pas.

#### Échéance de traitement et notification

- [x] `leads.due_at` et `last_activity_at`, avec un délai **paramétrable** dans
      Paramètres → Tables → `lead_sla` (48 h par défaut, par société).
- [x] Échéance posée à la création de **toute** tâche, quelle qu'en soit l'origine, et **repoussée à
      chaque échange** avec le client, entrant comme sortant (déclencheur sur `communications`).
- [x] Échéance visible sur la carte du pipeline, en rouge si dépassée, en orange si c'est pour
      aujourd'hui. Modifiable à la main depuis la fiche de la tâche.
- [x] **Cloche** dans la barre du haut : nombre de demandes en retard ou à traiter aujourd'hui,
      menant au pipeline.

> Les 22 tâches existantes ont reçu une échéance calculée depuis leur dernière modification.
> 21 sont donc immédiatement en retard : ce sont d'anciennes demandes de reprise jamais traitées.
> À arbitrer avec le client : les traiter, ou repartir d'une échéance neuve.

#### Tri de la liste des contacts

- [x] `contacts_search` accepte un paramètre de tri : par nom (inchangé par défaut) ou par date
      d'arrivée. Sans cela, une fiche créée automatiquement se range à sa place alphabétique parmi
      8 000 autres et personne ne la voit. Colonne « Créé le » ajoutée aux colonnes affichables.

#### Refonte de la carte d'une demande

- [x] **Suivi : qui a fait quoi et quand.** Tout était déjà tracé, `leads` porte un déclencheur
      d'audit qui écrit dans `events`. Il ne manquait que la lecture. Elle passe par une fonction
      serveur `lead_audit`, et non par une requête directe : `profiles` n'est lisible que pour
      soi-même (`profiles_select_own`), donc une jointure côté application aurait renvoyé un suivi
      anonyme. Plutôt que d'ouvrir les profils de tout le personnel, la fonction renvoie le suivi
      déjà nominatif. Chaque ligne indique l'action, l'auteur, la date et le détail du changement.
- [x] **Fil des échanges et réponse depuis la carte.** Le panneau de communications de la fiche
      client est réutilisé tel quel : éditeur enrichi, pièces jointes, envoi réel par Outlook.
      Il lit les échanges du **client**, ce qui corrige un défaut de fond : les mails captés par la
      relève portent l'identifiant du client et non celui de la demande, alors que la chronologie
      de la carte ne lisait que ce dernier.

Une seule communication sur 276 portait un identifiant de demande

- [x] **Choix de la boîte d'expédition.** L'envoi partait toujours de la boîte d'écoute historique
      de la société. On peut désormais choisir parmi les boîtes actives. Le serveur revérifie que
      l'adresse demandée appartient bien à la société : on ne part jamais d'une adresse arbitraire
      fournie par le navigateur.
- [x] **Carte plus lisible.** E-mail et téléphone passent sur toute la largeur. Côte à côte, le
      sélecteur d'indicatif rognait le numéro au point de le rendre illisible. Les trois panneaux
      de droite (échanges, suivi, documents) sont en onglets plutôt qu'empilés.
- [x] **Sortie de la carte.** On ne quitte plus sans se prononcer : clôturer en gagné ou en perdu,
      reporter avec une nouvelle échéance, ou laisser telle quelle. Le dernier choix est explicite
      et rappelle que la demande réapparaîtra dans les retards.
- [x] **Assignation.** `leads.assigned_to` existait sans moyen de choisir une personne : ni
      `user_roles` ni `profiles` ne sont lisibles au-delà de soi-même, et la fonction serveur
      `listOrgUsers` refuse l'accès à qui n'est pas administrateur. Nouvelle fonction
      `company_members`, limitée à la société. La carte affiche en tête ce qu'il y a à faire, à
      qui c'est confié et pour quand.
- [x] **Clôturer en passant le relais.** Depuis la sortie de carte, on peut clôturer celle-ci
      **et** ouvrir la suivante, en désignant qui s'en charge et pour quand. Sans cela, clôturer
      faisait disparaître ce qu'il restait à faire.
- [x] **Défilement.** La carte dépassait la hauteur de l'écran dès que le fil de mails était long,
      et le bas devenait inatteignable.

#### Deux défauts de production trouvés le 14/09 sur un vrai mail

Un message reçu sur `occasions@` n'arrivait pas dans le CRM. Le diagnostic a montré qu'il était
bien dans la boîte de réception, et que la relève l'avait consommé sans rien créer.

1. **Le curseur avançait avant la réussite du traitement.** Dès qu'un message était retenu, la
   relève notait son horodatage. Si l'analyse ou la création échouait ensuite, le message était
   sauté définitivement : ni fiche, ni tâche, ni trace, et l'erreur partait dans la réponse du
   passage automatique que personne ne lit. La relève traite désormais du plus ancien au plus
   récent, n'avance le curseur qu'après traitement complet, et **s'arrête au premier échec** pour
   que le message repasse au tour suivant. Le détail de l'erreur SQL est aussi remonté, au lieu
   d'un simple « rien créé ».
2. **Un prospect sans pays faisait échouer toute la création.** `contacts.country` est NOT NULL
   avec une valeur par défaut. La fonction lui passait explicitement la valeur extraite, nulle
   quand le message ne mentionne aucun pays, ce qui **écrase le défaut** et viole la contrainte.
   Le test manuel passait parce qu'on y fournissait « BE » à la main. Règle à retenir : ne jamais
   passer `null` à une colonne NOT NULL qui a un défaut.

> **Point à surveiller.** Le message rattrapé était un transfert : expéditeur `sylvielicausi@`,
> demandeur réel Patrick Levrette. L'analyse a bien extrait la bonne personne, mais n'a pas
> considéré le message comme relayé, donc la fiche porte l'adresse de l'expéditeur. À affiner si
> les transferts deviennent courants.

#### Correction structurelle : la tâche devient un objet à part

**Ce qui n'allait pas.** « Créer une tâche de suivi » créait une **nouvelle demande**. Chaque relance
dupliquait donc la carte du client, et le pipeline se remplissait de doublons. Le client l'a dit
sans détour : « ne crée pas de doublon, sinon on est foutu ».

**Le modèle retenu.** Une demande = une carte = un client. Elle porte :

- **une seule tâche ouverte à la fois** : ce qu'il faut faire, pour quand, et par qui, jamais vide ;
- l'**historique des tâches faites**, en liste chronologique, avec qui l'a faite et quand ;
- les **échanges** avec le client, où l'on répond par mail depuis la boîte de son choix ;
- les **documents** liés.

On ne crée jamais une deuxième carte pour le même fil : on termine la tâche en cours et on en ouvre
une nouvelle **sur la même carte**.

**La garantie est en base, pas à l'écran.** Un index unique partiel (`uq_lead_tasks_open`) interdit
deux tâches ouvertes sur une même demande. Même un appel direct est refusé.

**La sortie de carte ne parle plus de gagné ni de perdu.** On dit si la tâche est toujours à faire,
auquel cas une échéance dépassée doit être repoussée, ou si elle est faite, auquel cas on ouvre la
suivante dans le même geste.

**L'échéance appartient désormais à la tâche**, plus à la demande. Les deux déclencheurs posés plus
tôt dans la journée sont retirés : un échange avec le client ne doit pas déplacer en silence une
date décidée par un humain. La demande recopie l'échéance et le responsable de sa tâche ouverte,
pour que la cloche, la pastille du pipeline et la liste des retards continuent de fonctionner.

**Nettoyage.** La carte en double créée par l'ancienne fonction a été supprimée. Les six cartes
« PCB CONSTRUCT » viennent du module Reprises en juillet et ne sont pas de ce fait : elles restent
à arbitrer avec le client.

#### Le flux de la carte, rendu lisible (retour client du 14/09 au soir)

Retour mot pour mot : « on comprend pas tes boutons on comprend pas le flow »,
« journaliser veut rien dire », et « je ne sais pas dire que la tache est faite
et en remettre une directement dans la carte ».

**La regle, desormais : une carte a trois sorties, et trois seulement.**

| Sortie | Ce que fait l'utilisateur | Ce qui se passe |
|---|---|---|
| 1. La tache reste a faire | il ferme la carte | rien ne bouge, **aucune question posee** |
| 2. La tache est faite | bouton « C'est fait » | le formulaire de la tache suivante s'ouvre dans la carte ; un seul bouton termine l'ancienne **et** ouvre la nouvelle |
| 3. Plus rien a faire | bouton « Archiver la carte » | la carte quitte le pipeline et les rappels ; elle n'est pas supprimee |

La boite de dialogue de sortie ne s'affiche plus qu'a une seule condition : **la
carte se retrouve sans tache et sans archivage**. Tant qu'une tache est en cours,
fermer la carte ne pose aucune question. C'est la demande explicite du client.

Consequences dans l'interface :

- l'en-tete de la carte affiche la tache en une phrase (quoi, pour quand, par qui)
  puis trois boutons qui disent ce qu'ils font : **C'est fait**, **Modifier la
  tache**, **Archiver la carte** ;
- une carte sans tache l'annonce en rouge — « cette carte n'a plus de tache :
  personne ne va la reprendre » — avec le formulaire de la suivante juste en dessous ;
- terminer et ouvrir la suivante reste **un seul geste** : la carte ne peut jamais
  se retrouver terminee sans successeur, donc pas de doublon de carte ;
- dans les echanges, on ne choisit plus un « canal » : on choisit ce qu'on fait,
  **Repondre par e-mail** / **Noter un appel** / **Noter un SMS** / **Note interne**.
  Le mot « journaliser » a disparu, remplace par « Enregistrer dans l'historique » ;
- dans une carte, la reponse par e-mail est le mode **par defaut** : le choix de
  l'adresse d'expedition (une des quatre boites) est visible immediatement, plus
  cache derriere un selecteur de canal.

#### Retours client du 18/09 : utilisateurs, plusieurs CRM, boîte de réponse, note vivante

Demandes, mot pour mot en substance :

1. « On doit créer des utilisateurs de la plateforme » : un espace d'administration pour créer des
   comptes **client** (lié à sa fiche, créée au besoin) ou **équipe** (commercial, technicien,
   manager), avec une invitation par mail pour générer un mot de passe. Deux comptes créés sans
   invitation, avec un mot de passe commun à changer : domenico@ducatibxl.be (manager, existait
   déjà avec tous les rôles) et simon@ducatibxl.be (commercial = vendeur). **Pas de nouveaux
   rôles** : les rôles existants suffisent.
2. La tâche commerciale revient par défaut à Simon, réattribuable à la main à Domenico.
3. Plusieurs CRM en onglets. Un CRM atelier viendra, **à ne pas créer maintenant**.
4. La boîte de réponse par défaut est celle qui a reçu le mail (shop@, occasions@…), mais chacun
   peut choisir sa propre adresse.
5. La note de la carte reprend la demande : l'enrichir d'un petit paragraphe par échange.

Réalisé le 18/09 :

| Demande | Réalisation |
|---|---|
| 1 | Écran Utilisateurs : « Membre de l'équipe » ou « Client ». Client : fiche existante (recherche) ou nouvelle fiche, refus d'un doublon d'e-mail (décision D3). Mot de passe fixé ou invitation Outlook. Table `contact_accounts`. Un client n'a aucun rôle, donc aucun accès aux données de la concession. |
| 1 bis | Page `/reset-password` : choisir son mot de passe depuis l'invitation, ou le changer une fois connecté (menu utilisateur). |
| 2 | Réglage « Nouvelles demandes du CRM commercial » dans l'écran Utilisateurs, fonction `set_default_assignee`, reprise optionnelle des tâches ouvertes de l'ancien responsable. **Le compte simon@ducatibxl.be est à créer par l'administrateur**, puis à choisir dans ce réglage. |
| 3 | Colonne `leads.pipeline`, onglet « CRM commercial ». Ajouter l'atelier = une valeur dans `PIPELINES`. |
| 4 | Colonne `communications.mailbox`, remplie par la relève et rattrapée pour les mails déjà enregistrés. La carte propose d'abord la boîte qui a reçu le mail, puis sa propre adresse. L'envoi vérifie désormais que l'appelant est membre de la société. |
| 5 | Fonction `summarize-exchange`, appelée à chaque relève : un paragraphe daté par mail, appel ou SMS, ajouté une seule fois (`append_lead_exchange_note`), copies d'un même envoi ignorées, réponses d'agenda écartées. |

### Lot 2 — Invitation et compte client

- [x] Génération du jeton et du lien d'invitation (18/09).
- [x] Invitation envoyée par Outlook, pas par Resend (18/09). La file `dispatch-notifications` reste à rebrancher.
- [x] Modèle d'e-mail d'invitation (18/09). Lien de désinscription : sans objet pour un mail de compte.
- [x] Page qui consomme le jeton : `/reset-password` (18/09).
- [x] Rattachement du compte de connexion à la fiche contact existante (18/09).
- [ ] Règles d'accès : un client ne voit **que** ses propres données. Aujourd'hui il ne voit rien
      (aucun rôle) ; les règles de lecture de ses propres données viendront avec le portail.

**Fait quand** : le lien reçu par mail mène à un compte rattaché à la bonne fiche, sans créer de doublon,
et un client connecté ne peut lire aucune donnée d'un autre client.

### Lot 3 — Portail client

- [ ] Vue téléphone d'abord : ses véhicules, ses entretiens, ses achats, ses informations.
- [ ] En lecture seule dans un premier temps.
- [ ] Complétion accompagnée du profil, sans lourdeur.
- [ ] Photo de profil et photo de moto, appareil photo ou galerie, en réutilisant l'existant.

**Fait quand** : un client de test retrouve ses factures et son véhicule sur son téléphone.

### Lot 4 — Comptoir et site

- [ ] La page d'inscription en **mode borne** sur tablette : session qui se réinitialise après chaque client.
- [ ] Message de confirmation : « Bravo et merci pour votre enregistrement. Bienvenue chez Ducati Bruxelles.
      Vous pourrez désormais retrouver vos informations et celles de vos achats et de vos véhicules
      directement sur [adresse de l'application] ».
- [ ] Chemin d'encodage manuel pour le vendeur.
- [ ] Intégration de la page d'inscription sur le site public.

**Fait quand** : un client s'enregistre seul sur la tablette et reçoit le message ; le vendeur peut aussi
encoder à la main.

### Lot 5 — Finitions

- [ ] Le questionnaire du site entre dans le même tuyau que les mails.
- [ ] Tri du fichier G8 : passage en « client » des 4 165 contacts facturés (décision D2).
- [ ] Notification interne quand un prospect s'inscrit.

---

## 7. Questions ouvertes (à trancher au Lot 0)

1. **Le site public est-il Shopify ?** Le dépôt contient un constructeur de site et une boutique
   complète avec panier et paiement (`src/modules/web/`, route `/shop/{slug}`). Shopify n'y est
   mentionné qu'en inspiration graphique, il n'existe **aucune intégration**. Si le vrai site est
   Shopify, ce module devient du poids mort et la page d'inscription doit être **intégrable ailleurs**.
2. **Quelles boîtes mail exactement** faut-il écouter, et sous quelle société ?
3. **Le portail vit-il sur le même domaine** que le DMS, ou sur un sous-domaine séparé ?
4. **Que voit un client d'une société par rapport à l'autre** (ITALBIKE STORE et NL INVEST) ?

---

## 8. Risques

1. **Les migrations ne sont pas appliquées** (risque principal). Une migration versionnée n'est **pas**
   appliquée par le déploiement : quelqu'un doit l'exécuter à la main sur Supabase. Le module de reprises
   de juillet est complet dans le code et **mort en production** pour cette seule raison. Chaque lot de
   ce plan dépend d'une migration. Elles doivent être appliquées **et vérifiées** à la fin de chaque lot.
2. **Sécurité du portail.** L'audit signale déjà de nombreuses fonctions sensibles appelables sans être
   connecté. Chaque nouvelle fonction publique doit être écrite avec le minimum de surface.
3. **RGPD.** Créer une fiche et répondre à quelqu'un qui écrit relève de l'intérêt légitime. Le
   démarchage ultérieur demande un consentement : la case va sur le **formulaire d'inscription**, pas
   dans la fiche créée automatiquement. Le champ `contacts.marketing_opt_out` existe déjà.
4. **Volume et boucles.** Listes de diffusion, réponses automatiques, retours d'erreur : prévoir un
   garde-fou avant d'ouvrir la création automatique en production.
