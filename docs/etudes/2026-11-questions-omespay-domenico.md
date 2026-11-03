---
titre: Paiements — questions pour Domenico, mail pour Omespay, coûts de l'intégration du terminal
date: 2026-11-03
auteur: agence (recherche web du 03/11/2026, sans développement)
pour: Simon (agence), puis Domenico (ITALBIKE STORE / NL INVEST)
statut: 🟨 dossier de questions, rien n'a été envoyé
concerne: [M06, mission 12 carte P4, décision P-2]
suite_de: 2026-11-paiements-comptoir.md (§1, §2, §6) · 2026-11-synthese-caisse-facturation.md (§4, annexe A)
---

# Terminal Bancontact : ce qu'on doit demander, et ce que ça coûte

> Demande de Simon (03/11) : « Trouve les infos qu'on doit demander à Domenico et à son fournisseur de
> Bancontact, et check si c'est payant et combien. »
>
> **En une phrase** : brancher le terminal CCV d'Omespay sur le DMS passe par l'**API de paiement cloud de
> CCV**, qui existe bien pour les modèles qu'Omespay loue (A77, A960, A35) ; **aucun prix n'est publié**
> pour l'activer : ni par CCV, ni par Omespay, ni par un revendeur belge. Il faut donc le demander (mail §B).
> Le seul coût connu à coup sûr, c'est la **certification** : obligatoire, faite par l'agence (≈ 36 tests).

Légende : **[DOC]** lu sur la source citée ; **[TIERS]** comparateur ou revendeur, pas le fournisseur ;
**[DÉDUIT]** conclusion de l'agence ; **inconnu — à demander** : rien de publié, on ne devine pas.
Sources en §E, toutes consultées le 03/11/2026.

---

## Ce qu'on a appris de nouveau le 03/11 (par rapport à l'étude paiements)

1. **CCV Belgique confirme la liaison caisse « via le Cloud » pour l'A960, l'A77 et l'A35**, par la
   « Single Payment API » de CCV Cloud Connect ; le **Duo Base** reste en câble RS232 / USB (inutilisable
   par un DMS en navigateur). Prix de la liaison : « sur demande auprès de votre fournisseur de caisse »
   [DOC, C4].
2. **Toute intégration qui lance un paiement sur un terminal CCV doit être certifiée** (« Every integration
   that initiates payments on a terminal of CCV needs to be certified ») : 36 tests « attended »
   (annulation, montants interdits, coupure réseau, time-out, tickets, journal…), passés par nous, puis
   annoncés à CCV (pi-support@ccv.eu). **Coût et délai non publiés** [DOC, C6, C7].
3. **Accès** : test et production sur la même adresse, clé `t_…` (test) puis `l_…` (live) ; l'accès à l'API
   terminal se fait « par le partner manager régional » de CCV, la mise à bord des commerçants
   (Boarding API) est réservée aux **revendeurs autorisés** — donc à Omespay [DOC, C2, C5, C8].
4. **Le nom « Cloud Connect » prête à confusion** : CCV l'emploie à la fois pour la liaison caisse en Belgique
   (A77 / A960 / A35), pour une ancienne liaison web limitée aux P400 / V400M (page de 2022) et pour un
   produit de bornes de recharge (OCPI). Dans le mail, on parle donc de « Payment API, méthode terminal »
   [DOC, C4, C9, C10].
5. **Contrat Omespay** (CGV relues) : 24 mois depuis l'installation, puis 12 mois tacites ; préavis par
   recommandé **3 mois avant l'échéance annuelle** ; **250 € HTVA** pour passer à une autre institution de
   paiement ; **260 € HTVA** par intervention sans contrat de service ; location facturée par trimestre ;
   **EMS** est l'institution de paiement ; **aucune clause sur l'API ou l'intégration** [DOC, O5].
6. **Si l'acquéreur est EMS, Bancontact serait facturé en pourcentage (0,20 %)** d'après la grille EMS
   reprise par Companeo (14/07/2026) [TIERS, T1] — alors que CCV Pay et Worldline facturent un **montant
   fixe** (0,075 à 0,24 € chez CCV, 0,13 € chez Worldline). Sur les gros tickets d'une concession, c'est la
   question d'argent la plus importante du dossier (voir §C.3).

---

## Terminal CCV A77 (PAX) — qui ouvre l'API ?

> **Fait nouveau (03/11, photos de Domenico)** : le terminal est un **CCV A77 fabriqué par PAX** (Android ;
> étiquette « A77-OAW-RES-2SEU », S/N 1760353089 ; autocollant « OmEsPay — Your payment provider »,
> helpdesk +32 2 899 77 60, helpdesk@omespay.be). Ce n'est donc **pas un Duo Base** : le modèle fait partie
> de ceux que CCV Belgique annonce pilotables « via de Cloud » [C4]. Domenico : « il faut voir avec PAX et pas
> Omespay pour l'API ».

### La réponse en 5 lignes

1. **C'est CCV qui ouvre l'API, pas PAX** : PAX fabrique la machine, mais l'application de paiement, les clés,
   la gestion à distance (CCVStore), la Payment API et la certification sont à CCV [DOC, C11, C12, C2, C6].
2. **Omespay est la porte d'entrée** : il a le contrat, inscrit le commerçant chez CCV (Boarding API réservée
   aux revendeurs) et assure le premier support ; c'est par lui, ou par le partner manager CCV, que la liaison
   s'active [DOC, C5, C8, O5].
3. **PAX ne peut rien ouvrir sur un A77 sous marque CCV** : PAX renvoie lui-même vers « la banque, le PSP ou
   l'ISO » qui a fourni le terminal ; sur un terminal CCV, ses outils ne s'appliquent pas (SDK Neptune
   « réservé aux applications CCV », apps installées par le CCVStore et non par PAXSTORE) [DOC, P2, C11].
4. **Le chemin pour le DMS reste la Payment API cloud de CCV, méthode terminal**. L'« app-to-app » (notre app
   Android sur le A77 qui appelle le paiement CCV en local) existe, mais exige un contrat d'App Partner CCV, un
   test par CCV, une diffusion par le CCVStore et une app Android à maintenir : **écarté** [DOC, C11, C13].
5. **Action** : le mail §B part à Omespay, **CCV Belgique en copie** (partner manager) ; pas de mail à PAX
   (question facultative en §B.2 si Domenico y tient).

### Qui fait quoi sur ce terminal

| | Rôle | Ce qu'il peut ouvrir pour nous | Ce qu'il ne peut pas faire | Contact | Sources |
|---|---|---|---|---|---|
| **PAX** (fabricant) | Le boîtier : Android « PayDroid », lecteur de cartes certifié, n° de série 1760353089. Vend aux acquéreurs et aux PSP, pas aux commerçants | **Rien côté paiement.** Ses outils (PAXSTORE / MAXSTORE, SDK Neptune, POSLink / BroadPOS) servent aux acquéreurs qui gèrent eux-mêmes leur parc et leur application de paiement | Activer une API de paiement sur un terminal CCV ; installer une app sans le propriétaire du parc (« Terminal owner must approve an app before it gets installed ») | Formulaire paxtechnology.com/contact ; PAX renvoie au fournisseur du terminal pour le support | [P1] [P2] [P3] [P4] |
| **CCV** (marque, application de paiement, gestion du parc) | Application de paiement du terminal (SecPOS Evo ou acCEPT), clés, mises à jour et apps poussées par le **CCVStore**, liaison caisse | **Payment API, méthode terminal** (cloud) : clés `t_` / `l_`, `terminalId` ; **certification** (36 tests) ; programme **App Partner + CCVStore** pour l'app-to-app | — (c'est lui qui décide), mais le contrat commerçant passe par le revendeur | sales.be@ccv.eu (commercial Belgique, partner manager) ; pi-support@ccv.eu (technique, certification) | [C1] [C2] [C4] [C5] [C6] [C11] [C12] |
| **Omespay** (revendeur) | Contrat de location et de service, inscription du commerçant, premier support ; institution de paiement EMS (CGV) | **Demander l'activation** à CCV, avenant, prix, TID ; mise en relation avec le partner manager | Écrire ou certifier l'API ; installer une app sur le terminal sans CCV | helpdesk@omespay.be, +32 2 899 77 60 (autocollant) ; info@omespay.be | [O5] [O9] [C8] |

### Pourquoi Domenico pense à PAX — ce qui est vrai, ce qui ne l'est pas

- **Vrai** : la machine est une PAX ; PAX publie des SDK et un magasin d'applications (PAXSTORE, présenté
  aujourd'hui sous le nom MAXSTORE) qui permettent d'installer sa propre application sur un terminal — **chez
  les acquéreurs qui utilisent le magasin PAX** [P1, P3].
- **Pas sur ce terminal** : CCV écrit « All apps are managed/pushed/launched via CCVStore » et « The Neptune
  library cannot be used by customer apps or third-party apps (only CCV apps are allowed to use it) » [DOC, C11].
  Le « propriétaire du parc » qui approuve les apps est CCV, pas PAX [P3, C12].
- **POSLink / BroadPOS** : protocole de PAX vers **ses propres** applications de paiement (processeurs surtout
  américains) ; il n'y a pas d'application BroadPOS sur un A77 CCV [TIERS, P4 ; DÉDUIT].
- Le **S/N 1760353089** est le numéro du boîtier PAX ; l'API CCV demande le **TID** (identifiant du terminal dans
  l'application de paiement CCV), imprimé sur les tickets ou visible dans le menu du terminal [DÉDUIT] → à
  demander (question A1).

### Le mode « app-to-app » (notre application sur le A77)

Ce que c'est [DOC, C11, C13] : mode **« ECR interne »** — notre app Android tourne sur le terminal et pilote
l'application de paiement CCV par la bibliothèque **mAPI** (basée sur OPI) en local (127.0.0.1) ; elle s'annonce
par un intent-filter `eu.ccv.service.ECR` et reprend la main après chaque paiement. CCV le documente
explicitement pour « Pax A920, A77 ».

Ce que ça implique :
- **accord CCV** : contrat « App Partnership and CCVStore », NDA pour l'app d'exemple mAPI, terminal de
  développement (« debug ») fourni par CCV ;
- **test obligatoire par CCV** avant toute mise en ligne, puis **diffusion uniquement par le CCVStore** (pas de
  Google Play, pas d'APK installé à la main), APK signé V1, numéro de version croissant à chaque mise à jour ;
- **contraintes du terminal** : redémarrage quotidien (PCI), **aucun navigateur autorisé** sur le terminal
  (le DMS web ne peut pas y tourner tel quel), A77 sans imprimante (ticket électronique) ;
- **certification paiement** toujours due (« Every integration that initiates payments on a terminal of CCV
  needs to be certified ») [C6] ;
- **une app par marque** : mAPI ne sert que sur CCV ; un autre terminal (Worldline, Viva, PAX d'un autre
  acquéreur) demanderait une autre app et un autre magasin [DÉDUIT].

Verdict : utile pour une caisse **qui vit sur le terminal** (vente nomade sans PC) ; **pas pour un DMS web
multi-concessions** qui a déjà PC et tablette. On garde la liaison **cloud**. Date des sources : le guide CCV
est daté **août 2022** (toujours en ligne le 03/11/2026) ; la page CCVStore est de 2026 (liste des partenaires
« 2026-05 »).

### Ce qui reste valable pour les autres concessions

- **Règle** : l'API d'un terminal est ouverte par **celui qui possède l'application de paiement et le contrat**
  (la marque affichée sur l'écran de paiement : CCV, Worldline, Viva…), **jamais par le fabricant du boîtier**
  (PAX, Ingenico, Verifone fabriquent pour plusieurs marques) ; le revendeur n'est que l'intermédiaire
  commercial [DÉDUIT de P2, P3, C11].
- **Dans le DMS** : un seul « terminal de paiement » abstrait, deux modes —
  **piloté par API cloud** quand le fournisseur l'offre (CCV Payment API, Worldline Terminal API, Mollie, Viva,
  SumUp…) : envoyer le montant, recevoir le résultat (webhook + relecture), annuler, rembourser ;
  **« à côté »** sinon : le vendeur encaisse sur le terminal puis confirme dans le DMS. Pas d'app-to-app ni de
  câble par défaut.
- **À demander à chaque nouvelle concession** : marque sur l'écran de paiement, qui a le contrat (revendeur,
  acquéreur), TID, la liaison caisse cloud existe-t-elle pour ce modèle, son prix, la certification.

---

## A. Questions à poser à Domenico

À poser en une fois (un message, une photo, un relevé), avant d'envoyer le mail §B.

| # | Question | Pourquoi on la pose | Recommandation |
|---|---|---|---|
| 1 | ~~Photo de l'étiquette~~ **reçue le 03/11 : CCV A77 (PAX), S/N 1760353089**. Reste : le **TID** (sur un ticket de paiement ou dans le menu du terminal) et une photo de l'écran d'accueil (version du logiciel CCV) | L'A77 est pilotable par le cloud [C4] ; le S/N est celui du boîtier PAX, l'API CCV attend le **TID** comme `terminalId` [DÉDUIT] | Pas d'échange de terminal à demander ; l'API se demande à CCV via Omespay, pas à PAX (voir section « Terminal CCV A77 ») |
| 2 | **Contrat Omespay** : n° de contrat ou de client, **date d'installation**, durée, société signataire (ITALBIKE STORE ou NL INVEST ?) | Contrat de 24 mois puis 12 mois tacites, préavis 3 mois avant l'échéance [O5] : la date décide si on peut changer et quand | Noter dans l'agenda la date limite du recommandé (échéance − 3 mois) |
| 3 | **Un relevé mensuel** du terminal (PDF ou papier) — le décompte de l'acquéreur, pas la facture de location | Montre **l'acquéreur réel** (EMS ? CCV Pay ?) et les **frais réels** par réseau. EMS = Bancontact à 0,20 % [T1] ; CCV = montant fixe [C3] | C'est le document le plus utile du dossier : sans lui, on ne peut pas dire si le changement vaut le coup |
| 4 | **Facture de location** Omespay (montant par mois ou par trimestre, service compris ?) | Comparer au marché (A77 ≈ 29 à 38 €/mois [C3, T1]) | — |
| 5 | **Moyens acceptés aujourd'hui** sur le terminal : Bancontact, Maestro, Visa / Mastercard, Amex ? **QR Payconiq / Bancontact Pay** à l'écran ? Apple / Google Pay ? | Omespay ne promet que Bancontact et les grandes cartes [O1] ; CCV sait afficher un QR Payconiq sur le terminal [B1] | Si le QR Bancontact Pay est déjà actif sur le terminal, il fait double emploi avec le QR Stripe (P3) |
| 6 | **Combien de terminaux et de postes** (comptoir pièces, réception atelier, vente motos) ? Le terminal bouge-t-il dans la concession ? Branché en câble réseau, Wi-Fi ou 4G ? | L'API facture peut-être **par terminal** (inconnu) ; le pilotage cloud demande une connexion internet stable du terminal [DÉDUIT] | Un terminal par poste de caisse du DMS, relié au réseau de la concession |
| 7 | **QR sans supplément** : accepte-t-il que les frais du QR (Stripe : Bancontact 0,35 €, cartes 1,5 % + 0,25 €) soient **absorbés**, puisque le « +5 % » est interdit (art. VII.30 § 3 CDE) ? | Décision P-2 du 30/07 à amender ; sans son accord, la carte P3 ne peut pas démarrer | Oui : Stripe Checkout pour le QR et les liens de paiement, virement QR gratuit pour les motos |
| 8 | **Qui est son interlocuteur chez Omespay** (nom, e-mail, GSM) ? Erwin Struys en direct ? | Omespay ≈ 3 personnes [O3] : un nom accélère tout. Le mail §B part **de son adresse**, à son nom | Mettre l'agence (Simon) **en copie** pour les questions techniques |
| 9 | **Est-il d'accord pour qu'Omespay et CCV parlent directement à l'agence** (contact technique) ? | La certification et la sandbox se font entre CCV et le développeur [C6] | Oui, nommer Simon comme contact technique dans le mail |
| 10 | **Combien de paiements par carte par mois** environ, et **montant moyen** (pièces / atelier / acomptes motos) ? | Sans volume, impossible de chiffrer l'écart EMS (%) / CCV / Worldline (fixe) | Une estimation suffit ; le relevé (Q3) la donnera |

---

## B. Mail prêt à envoyer à Omespay

> Domenico l'envoie lui-même, de sa boîte. **Rien n'a été envoyé.** Les crochets sont à remplir avec les
> réponses aux questions A1, A2 et A8.
>
> - **À** : son interlocuteur Omespay, à défaut **helpdesk@omespay.be** (autocollant du terminal) ou
>   info@omespay.be, +32 2 899 77 60 [O9] — Omespay a le contrat et le premier support.
> - **Cc** : **CCV Belgique, sales.be@ccv.eu** [C4] — c'est CCV qui ouvre la Payment API, par son partner
>   manager régional [C5] ; et Simon (agence), contact technique.
> - **Pas PAX** : PAX fabrique le boîtier mais n'ouvre rien sur un terminal CCV (section « Terminal CCV A77 »).
>   Question facultative en §B.2.

> **Objet : Liaison de notre terminal CCV A77 à notre logiciel de caisse (Payment API CCV) — ITALBIKE STORE, Waterloo**
>
> Bonjour [prénom],
>
> Nous sommes client Omespay pour le terminal de paiement de la concession Ducati de Waterloo (ITALBIKE
> STORE SRL, contrat n° [à compléter], terminal CCV A77 fabriqué par PAX, n° de série 1760353089, TID [à compléter]).
> Nous mettons en service un
> logiciel de caisse développé sur mesure par notre agence, The Maul : il tourne dans un navigateur (PC et
> tablette) avec un serveur en ligne. Nous souhaitons que la caisse **envoie le montant au terminal et
> reçoive le résultat du paiement** (accepté, refusé, annulé), sans ressaisie par le vendeur.
>
> D'après la documentation de CCV, cela se fait par la **Payment API de CCV, méthode « terminal »**
> (liaison caisse « via le Cloud », annoncée par CCV Belgique pour les A77, A960 et Nexus Pad A35). Nous
> avons compris que cette liaison relève de CCV (application de paiement du terminal) et non de PAX, qui
> fabrique l'appareil : merci de nous corriger si ce n'est pas le cas. Nous mettons CCV Belgique en copie pour
> le contact avec le partner manager. Pourriez-vous nous répondre sur les points suivants :
>
> **Notre contrat et notre terminal**
> 1. Notre **A77** et sa version de logiciel (application de paiement CCV, SecPOS Evo ou acCEPT) sont-ils
>    **compatibles avec la liaison cloud** de la Payment API CCV, tels quels ou après mise à jour ? Quel est
>    son **TID** ? Si ce n'est pas le cas, quel modèle proposez-vous en échange, et à quelles conditions ?
> 2. Quel est **l'acquéreur** de notre contrat (EMS, CCV Pay, autre) ? La liaison cloud CCV fonctionne-t-elle
>    avec cet acquéreur ?
> 3. Quels sont **nos frais actuels** par moyen de paiement (Bancontact, Maestro, Visa / Mastercard débit et
>    crédit, cartes professionnelles, Amex, Apple / Google Pay, QR Bancontact Pay / Payconiq) ? Le Bancontact
>    est-il facturé en **montant fixe** ou en **pourcentage** ?
> 4. Quelle est la **date d'échéance** de notre contrat et la date limite de préavis ?
>
> **L'activation de la liaison**
> 5. Pouvez-vous **activer** la Payment API cloud sur notre terminal, ou nous mettre en contact avec le
>    **partner manager CCV** qui le fait (CCV, en copie, peut-il nous le désigner) ? Faut-il un **avenant** à
>    notre contrat ?
> 6. **Combien ça coûte**, poste par poste : frais d'activation (une fois), **abonnement mensuel par
>    terminal**, frais **par transaction** en plus des frais actuels, frais de **certification** de notre
>    logiciel, déplacement ou intervention éventuelle (vos CGV prévoient 260 € HTVA hors contrat de service) ?
> 7. Quel **délai** entre notre accord et la mise en service ?
>
> **La partie technique (pour notre agence)**
> 8. Pouvez-vous fournir à notre agence un **accès de test** : clé API de test, accès au portail
>    développeur de CCV, et si possible un **terminal de test** ou un mode test sur notre terminal ?
> 9. CCV demande une **certification** de toute caisse qui lance un paiement sur un terminal : qui
>    l'organise (Omespay ou CCV), combien de temps prend-elle, et y a-t-il un coût ?
> 10. Qui est le **contact technique** (nom, e-mail) chez Omespay et chez CCV ? En cas de problème en
>     production (paiement sans réponse, double paiement, remboursement), **qui assure le support** et dans
>     quel délai ?
> 11. Les **remboursements** peuvent-ils être lancés depuis notre caisse par la même liaison ?
>
> Vous pouvez répondre directement à notre contact technique, Simon ([e-mail de l'agence]), en copie de
> ce message.
>
> Merci d'avance pour votre retour.
>
> Bien à vous,
>
> Domenico Desouter
> Ducati Bruxelles — ITALBIKE STORE SRL
> [téléphone]

Différences avec le mail de l'étude paiements (§6.1) : contrat et n° de série joints ; « méthode
terminal » au lieu de « Cloud Connect » (nom ambigu) ; montant fixe ou pourcentage pour Bancontact ;
coûts **détaillés poste par poste** ; avenant ; terminal de test ; remboursements ; agence nommée comme
contact technique. Mise à jour du 03/11 (photos) : modèle A77 et S/N renseignés, TID demandé, **CCV Belgique
en copie**, rôle de PAX clarifié dans le mail.

### B.2 (facultatif) Question à PAX

Pas nécessaire : PAX renvoie au fournisseur du terminal [P2] et l'API est celle de CCV [C11]. Si Domenico
veut une confirmation écrite, quelques lignes par le formulaire paxtechnology.com/contact (en anglais) :

> *Subject: CCV-branded PAX A77 (S/N 1760353089) — integration with a third-party cash register*
>
> Hello, our dealership in Belgium uses a PAX A77 supplied and branded by CCV (reseller Omespay). We want our
> own web-based cash register to send amounts to it and receive the result. Can PAX enable any payment
> interface on this terminal (cloud API, POSLink, our own app via PAXSTORE), or must this go exclusively
> through CCV's payment application and its Payment API? Thank you.

---

## C. Ce que ça coûte

### C.1 Brancher le terminal sur le DMS (scénario S1)

| Poste | Montant | Source, date |
|---|---|---|
| Frais d'activation de la liaison cloud CCV | **inconnu — à demander** (mail Q6) | CCV et Omespay : rien de publié [C1, C4, O9] |
| Abonnement mensuel de la liaison, par terminal | **inconnu — à demander** (mail Q6) | Idem. Pour repère seulement : un intermédiaire néerlandais (Pin Vandaag) facture 2,50 €/terminal/mois son API cloud CCV / Worldline [TIERS, T4, NL] |
| Frais par transaction **en plus** de l'acquiring | **inconnu — à demander** (mail Q6) | Aucune source ne mentionne de supplément ; ne pas supposer zéro |
| Certification du logiciel par CCV | **inconnu — à demander** (mail Q9). Obligatoire [DOC, C6] | Coût, délai et intervenant non publiés |
| Certification : travail de l'agence (36 tests) | Compris dans la carte P4 (4 à 6 jours, synthèse §2) | Étude paiements §5, lot C |
| Avenant / intervention Omespay sur le terminal | **inconnu** ; **260 € HTVA** par intervention si pas de contrat de service | CGV Omespay art. 11 [O5] |
| Échange du terminal si c'est un Duo Base | **inconnu — à demander** (mail Q1) | Duo Base non pilotable par le cloud [C4] |
| Repères du marché (indicatifs) | Liaison caisse–terminal « 0 à 150 € une fois » pour Worldline / CCV ; module de liaison chez certains éditeurs ≈ 150 € ; synchronisation cloud 5 à 30 €/mois | Companeo, maj 14/07/2026 [TIERS, T2] |
| Ce que paie une caisse intégrée (Lightspeed + CCV, revendeur MDware) | Location 49 €/mois terminal compris (P400 Plus) ou achat 665 € + 20 €/mois ; Bancontact dès 0,075 € ; installation offerte ; pas de frais de liaison affichés | MDware, consulté 03/11 [TIERS, T3] |

### C.2 Garder le terminal « à côté » (scénario S0)

| Poste | Montant | Ce qu'on perd |
|---|---|---|
| Développement, activation, certification | **0 €** | — |
| Coût caché | — | **Double saisie** à chaque paiement (montant tapé dans le DMS puis sur le terminal) ; **erreurs de frappe** (19,00 € tapé 1,90 €) découvertes au Z ou chez le comptable ; aucune preuve dans le DMS que le montant encaissé est le bon ; remboursements faits à la main sur le terminal ; écran client sans état « suivez le terminal ». Ordre de grandeur annoncé par un comparateur : jusqu'à 30 min de saisie et de pointage par jour [TIERS, T2] — chiffre marketing, non vérifié |

### C.3 Changer de fournisseur à l'échéance (scénario S2) — grilles publiées, hors TVA

| | Bancontact au terminal | Cartes Visa / Mastercard | Fixe mensuel | Terminal | Pilotable par le DMS | Source, date |
|---|---|---|---|---|---|---|
| **Omespay / EMS (actuel)** | **inconnu — relevé de Domenico** ; grille EMS publique : **0,20 %** | 1,50 % | « pas de frais fixes » chez EMS ; location Omespay **inconnue** | Location Omespay **inconnue** | Oui si l'API cloud est activée (§C.1) | Companeo d'après ems.be, maj 14/07/2026 [TIERS, T1] (ems.be inaccessible le 03/11) |
| **CCV en direct (CCV Pay)** | **0,240 € → 0,075 €** selon le volume du mois ; 1 000 premiers < 5 € gratuits (offre élargie jusqu'en 03/2027) | Débit EEE dégressif comme Bancontact ; crédit EEE 1,25 % ; pro 1,6 à 2,4 % | 0 € (traitement inclus) ; service 12,35 €/mois si terminal acheté | Location dès 29,35 €/mois (A77), 38,35 € (A960) | **Oui**, même API | ccv.eu/be-fr tarifs [DOC, C3] ; Payment Review 23/10/2026 [TIERS, T5] |
| **Worldline** | **0,13 €** (cartes de débit belges) | Crédit 1,40 % + 0,10 € | 0 € (miniPOS) ; 4G 16 €/mois | Saturn 649 € ou 36 €/mois | Oui, Terminal API v2 sur terminaux Android Worldline | KBC / Worldline BE [TIERS, T6] ; Payment Review [T5] |
| **Viva.com** | 0,14 € (min. 0,03 €) | 1,69 % | 0 à 19,99 € | Non publié | Oui (Cloud Terminal API) — doc à revérifier | Payment Review [TIERS, T5] (viva.com en time-out le 03/11) |
| **SumUp** | 1,69 % (ou 0,99 % + 19 €/mois) | idem | 0 ou 19 € | 17 à 99 € (promo) | Oui (Cloud API Solo) | sumup.com/fr-be [DOC, T7] |

**Ce que ça veut dire pour une concession (exemple fictif, à refaire avec le relevé de Domenico)** :
150 paiements Bancontact par mois pour 60 000 € encaissés (ticket moyen 400 €) :
- au **pourcentage EMS 0,20 %** : **120 €/mois** ;
- chez **CCV Pay** (palier 100-199 : 0,188 €) : **≈ 28 €/mois** ;
- chez **Worldline** (0,13 €) : **≈ 20 €/mois** ;
- chez **SumUp** (1,69 %) : **≈ 1 014 €/mois** — écarté.

Si le relevé confirme un Bancontact en pourcentage, **le changement à l'échéance paie vite les 250 € de
transfert** ; s'il est déjà en montant fixe, l'écart devient faible et rester chez Omespay est raisonnable.
Les cartes de crédit (1,25 à 1,5 % partout) pèsent pareil chez tous.

---

## D. Recommandation

1. **Domenico envoie d'abord trois choses** : le TID du terminal (l'étiquette est reçue : A77), un relevé
   mensuel, la date d'installation du contrat (questions A1 à A3) ; puis il envoie le mail §B à Omespay,
   **CCV Belgique et l'agence en copie**. Pas besoin de passer par PAX.
2. **Ne rien changer ni résilier avant la réponse d'Omespay** : 250 € de transfert, préavis de 3 mois.
3. **Si Omespay active l'API cloud à un coût raisonnable** (ordre de grandeur du marché : quelques €/mois par
   terminal, activation ≤ 150 €) → on code la carte P4 et on passe la certification CCV.
4. **Sinon, ou en attendant** → terminal « à côté » (0 €, 0 jour) ; à l'échéance, comparer avec le relevé :
   **CCV en direct** (même terminal, même API, Bancontact fixe) ou **Worldline** (0,13 €).
5. **En parallèle, sans attendre personne** : écran client et QR sans supplément (cartes P2, P3).

---

## E. Sources (consultées le 03/11/2026)

**CCV (fabricant du terminal)**
- [C1] https://developer.myccv.eu/documentation/payment_api/online_payments/payment_methods/terminal/ — « A CCV Terminal is required », pays « that have access to CCV Terminals », aucun prix.
- [C2] https://developer.myccv.eu/documentation/payment_api/ ; …/general/environments/ — « This API doesn't support all CCV terminals yet », test et live sur `api.psp.ccv.eu`, clés `t_` / `l_`.
- [C3] https://www.ccv.eu/be-fr/solutions-de-paiement/traitement-des-transactions/tarifs ; https://www.ccv.eu/be-fr/solutions-de-paiement/terminaux-de-paiement — grille Bancontact 0,240 → 0,075 €, crédit EEE 1,25 %, offre jusqu'en mars 2027, location dès 29,35 €/mois.
- [C4] https://www.ccv.eu/be-nl/betaaloplossingen/betaalterminals/kassagekoppelde-betaalterminals — A960 / A77 / A35 « Kassagekoppeld via de Cloud » (Single Payment API de CCV Cloud Connect), Duo Base « via RS232 of USB » dès 639 €, prix de la liaison « op aanvraag bij jouw kassaleverancier » ; contact sales.be@ccv.eu.
- [C5] https://www.ccv.eu/en/service-contact/developer-portal/terminal-api — accès à l'API terminal « through our regional partner manager », « Cloud or locally ».
- [C6] https://developer.myccv.eu/documentation/certification/introduction/ — « Every integration that initiates payments on a terminal of CCV needs to be certified », contact pi-support@ccv.eu.
- [C7] https://developer.myccv.eu/documentation/certification/attended_terminals/ — 36 tests en 9 groupes.
- [C8] https://developer.myccv.eu/documentation/boarding_api/general/getting-started/ — Boarding API « Only autorized resellers ».
- [C9] https://developer.myccv.eu/reference/use-cases/cloud-connection/CCV_Cloud_Connect.html — ancienne liaison web P400 / V400M, éditeur de caisse certifié (manuels datés 2022/08).
- [C10] https://www.ccv.eu/en/large-enterprise-solutions/payment-services/cloud-connect — « Cloud-Connect » = bornes de recharge (OCPI).

- [C11] https://developer.myccv.eu/reference/android_app_requirements/android-developer-guidelines-and-faqs-august-2022.pdf (août 2022) — CCVStore seul canal (« All apps are managed/pushed/launched via CCVStore »), contrat « App Partnership and CCVStore », test CCV obligatoire, Neptune réservé aux apps CCV, mAPI / OPI, mode ECR interne (`eu.ccv.service.ECR`, 127.0.0.1), pas de navigateur, redémarrage quotidien, A77 sans imprimante.
- [C12] https://www.ccv.eu/en/large-enterprise-solutions/payment-services/ccvstore (© 2026, liste des partenaires 2026-05) — « The CCVStore is the B2B app store for our Android payment terminals », apps installées et gérées par le CCVStore, revue de sécurité CCV.
- [C13] https://developer.myccv.eu/documentation/android_sdk/ — « Integration with an Android terminal (Pax A920, A77, …) », adresse locale 127.0.0.1, intent-filter de retour vers l'app de l'intégrateur.

**PAX (fabricant du boîtier)**
- [P1] https://www.pax.us/products/mobile/a77/ — A77 Android, compatible PAXSTORE (gestion à distance).
- [P2] https://www.paxtechnology.com/contact — les propriétaires d'un terminal s'adressent à la « company (Bank, PSP or ISO) that provided you the PAX terminal », qui assure le « first line support ».
- [P3] https://www.paxtechnology.com/maxstore — « Marketplace owner has full control over all apps and devices » ; « Terminal owner must approve an app before it gets installed ».
- [P4] https://developer.north.com/blog/tutorial-pax-sdk-payment-application ; https://developer.cybersource.com/docs/cybs/en-us/sis-pax/integration/all/rest/sis-pax.html [TIERS] — POSLink parle à l'application BroadPOS du processeur ; apps PAX livrées par PAXSTORE, approuvées avant installation.

**Omespay**
- [O1] https://omespay.be/fr/ — moyens annoncés (Bancontact, grandes cartes).
- [O3] fiche BCE / companyweb 0447.299.959 — ≈ 3 ETP (voir étude paiements).
- [O5] https://omespay.be/algemene-voorwaarden/ — art. 4, 6, 11 (260 €), 14 (24 + 12 mois), 15 (EMS, 250 € de transfert), 17 (préavis 3 mois), 20 (location trimestrielle).
- [O9] https://omespay.be/fr/systemes-de-caisse/connexion-a-la-caisse-via-lapi-de-paiement/ — aucun prix, devis ; info@omespay.be, +32 2 899 77 60.

**Marché et comparateurs**
- [T1] https://www.companeo.be/nl_BE/betaaloplossingen/gids/betaaloplossing-ccv-ems (maj 14/07/2026) — EMS : Bancontact 0,20 %, Visa / MC 1,50 %, pas de frais fixes ; A77 29,35 €, A960 38,35 €, Duo Base 42,85 €/mois.
- [T2] https://www.companeo.be/nl_BE/betaaloplossingen/gids/kassa-koppelen-betaalterminal-vergelijking-belgie (maj 14/07/2026) — coût indicatif des liaisons caisse–terminal, temps gagné.
- [T3] https://mdware.org/en/payments — Lightspeed + CCV en Belgique : 49 €/mois ou 665 € + 20 €/mois.
- [T4] https://www.pinvandaag.nl/en/kassakoppeling/ — API cloud CCV / Worldline 2,50 €/terminal/mois (Pays-Bas, Belgique non mentionnée).
- [T5] https://paymentreview.com/blog/belgium-bancontact-card-fees-2026/ (23/10/2026, prix relevés le 19/10) — CCV, Worldline, myPOS, Viva, SumUp, Mollie, Stripe.
- [T6] https://www.kbc.be/ondernemen/nl/product/betalen-en-betaald-worden/betalingen/ontvangen/saturn-1000f2.html — Worldline Saturn : 0,13 €, 36 €/mois ou 649 €, Bancontact et Payconiq inclus.
- [T7] https://www.sumup.com/fr-be/tarifs/ — 1,69 % ou 0,99 % + 19 €/mois, terminaux en promotion.
- [B1] https://www.bancontact.com/en/news/paying-with-the-payconiq-by-bancontact-app-can-now-also-be-done-via-payment-terminal — QR Payconiq sur terminal CCV.

Non accessibles le 03/11 : ems.be/en/pricing (connexion refusée), viva.com/en-be/pricing (time-out).
