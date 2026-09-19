---
mission: 04
titre: Fiche client et moto au comptoir
etat: 🟦
ouverte_le: 2026-09-19
modules: [M01, M03, M00, M09]
---

# Mission 04 — Fiche client et moto au comptoir

> **Objectif** : créer un client et sa moto au comptoir avec des données propres et complètes, et
> faire en sorte que le client puisse compléter lui-même son profil et déclarer sa moto (espace client,
> borne), l'équipe étant prévenue et validant — comme dans un vrai DMS : une seule fiche client, un seul
> parc, alimentés par le comptoir, la borne et l'espace client.

Liste ERP : « Mission 04 — Fiche client et moto au comptoir » (`c3ab4e5d-f23c-45fc-a041-cdf2ea60ffc6`).
Source : vidéo de Domenico (G8, 14/09, envoyée par Simon le 18/09). Transcription :
`C:\Users\simon\whisper-models\mission4.srt` (whisper small, approximative : croisée avec les images).
**Feu vert de Simon le 19/09** (« c'est ok pour développer tes cartes 4 et 5 »).

## 1. Le parcours montré dans la vidéo (G8)

| Min. | Ce qu'il fait dans G8 | Ce qu'il dit (souhait) |
|---|---|---|
| 0:09 | Liste Clients → Nouveau : fiche « Prospect », nom MOREAU 2, prénom SIMON, « Particulier » | — |
| 0:39 | Civilité : une seule liste qui mélange MR, MME et des formes de société (SA, SPRL, SCRL, ASBL, SARL, BV…) | « on sait choisir monsieur madame et éventuellement le statut pro… **c'est un petit peu à revoir, c'est un petit peu vieux** » |
| 0:49 | Tape +32 412 34 56 78 dans Téléphone, puis le **recopie** dans Portable | « je copie téléphone dans portable **parce que c'est comme ça dans G8, pour les envois de SMS** — il faut que le numéro soit dans portable » |
| 1:15 | Tape l'e-mail en minuscules | « on met le mail **en minuscule, je préfère** » |
| 1:29 | Rue de la Victoire 1, code postal 5000 → G8 remplit **NAMUR** tout seul | (déjà dans G8, à garder) |
| 1:39 | Infos supplémentaires : date de naissance, CP/ville de naissance, nom de naissance ; onglet compta : IBAN, BIC, n° TVA, conditions de règlement | « **ça serait bien dans le portail** qu'on mettra à jour : date de naissance, lieu… les infos pour les gens, le numéro de compte bancaire, le numéro TVA » |
| 2:39 | Depuis la fiche client : « Saisie produit fini » → « Réparation produit fini » (= la moto d'un client, pas une moto à vendre) | — |
| 2:47 | Fiche véhicule : n° de série (E), marque (D.1), plaque (A), n° moteur, cylindrée (P.1), puissance CV (P.2), bridé, énergie (P.3), norme (V.9), couleur, 1re mise en circulation (B), km, fin de garantie, année modèle | « on essaie de **maximiser toutes les infos pour remplir tous les champs** » |
| 3:01 | — | « on encode un véhicule quand il vient, pour une demande de pièces ou de rendez-vous » |
| 3:19 | — | « on demande généralement le **certificat d'immatriculation** pour avoir toutes les données : 1re mise en circulation, n° de châssis, kW, norme » |

Les lettres E, D.1, A, P.1… affichées par G8 sont les **codes officiels des cases de la carte grise** :
on les garde à côté des libellés, l'employé recopie case par case.

## 2. Ce que le DMS a déjà (inventaire du 19/09)

- **Fiche client** (`src/modules/contacts/contact-form.tsx`) : type particulier / pro ; civilité codée en
  dur (Monsieur, Madame, Autre) et, pour un pro, le même champ sert de forme juridique ; **un seul mobile**
  (+ « Mobile 2 ») ; adresse découpée ; TVA (contrôle VIES), IBAN, BIC **pour les pros seulement** ; date de
  naissance pour les clients ; **pas de lieu de naissance** ; e-mail **pas** mis en minuscules ; **pas** de
  code postal → ville.
- Table de référence `civility` (Paramètres) : MR, MME, SRL, SA, SPRL, SCRL, ASBL, BV — **pas lue** par le formulaire.
- **SMS** : partent vers `mobile` (sinon `phone`) — le problème G8 du « recopier dans portable » n'existe déjà plus.
- **Fiche véhicule** (`src/modules/vehicles/vehicle-form.tsx`) : tous les champs de la vidéo existent, décodage
  du VIN Ducati ; **pas** de contrôle VIN 17 caractères ni de doublon ; **pas** de création depuis la fiche client
  (le lien propriétaire `vehicle_owners` n'est écrit que par le flux reprise).
- **Inscription / borne** : le client déclare « sa moto » (famille, modèle, année) dans `contact_declared_vehicles`,
  **qu'aucun écran de l'équipe ne lit**.
- **Espace client** : le client modifie son profil (liste blanche, sans IBAN ni lieu de naissance) ; il **voit** ses
  motos et y dépose des documents (dont la carte grise) mais **ne peut pas en ajouter**.
- **Cloche** : un seul type de notification d'équipe (`signup`), visibilité par rôle.
- **Lecture de documents** : `read-id-doc` lit carte d'identité et permis (Claude Vision) — réutilisable pour la carte grise.

## 3. Cartes : pourquoi chacune, et comment elle s'intègre

| # | Carte | Répond à (vidéo) | Intégration dans l'existant |
|---|---|---|---|
| 1 | Créer une fiche client rapide au comptoir | 0:09–2:09 : la fiche G8 est longue, remplie client en face | Même formulaire M01, en deux temps : l'essentiel (civilité, nom, prénom, mobile, e-mail, adresse) puis « Compléter » (naissance, IBAN, TVA…) replié ; recherche de doublon par e-mail/mobile avant création (règle D3) |
| 2 | Moderniser la liste des civilités | 0:39 « c'est un petit peu vieux » | Civilité = M. / Mme / Mx (particulier) ; **forme juridique** = champ séparé pour les pros, lu dans la table `civility` de Paramètres (plus de liste codée en dur) ; reprise G8 : SA, SPRL… passent en forme juridique |
| 3 | Un seul numéro mobile, utilisé pour les SMS | 0:59 recopie téléphone → portable « pour les SMS » | Déjà un seul mobile qui sert aux SMS : on ajoute le format international automatique (+32…) et on corrige les fiches G8 où le mobile n'est que dans « téléphone » (liste proposée, pas de fusion automatique) |
| 4 | E-mail en minuscules et code postal qui remplit la ville | 1:15 « en minuscule, je préfère » ; 1:33 G8 remplit Namur | Minuscules à la saisie **et** en base (toutes les sources : comptoir, borne, portail, CRM) ; table des codes postaux belges → ville proposée (choix si plusieurs communes), aussi à la borne et dans l'espace client |
| 5 | Naissance, IBAN et n° TVA complétés par le client dans son espace | 1:49 « ça serait bien dans le portail » | Champs ouverts aux particuliers (IBAN aussi) ; lieu de naissance ajouté ; l'espace client permet de les compléter ; un changement d'IBAN par le client est tracé et **prévient l'équipe** (cloche) |
| 6 | Créer la moto du client depuis sa fiche | 2:39 « Saisie produit fini → réparation » | Bouton « Ajouter une moto » sur la fiche client → fiche véhicule M03 pré-liée au propriétaire (`vehicle_owners`) ; libellés avec les codes carte grise (E, D.1, A, B, P.1, P.2, P.3, V.9) ; VIN 17 caractères contrôlé ; si le VIN existe déjà : proposer de rattacher la moto existante au lieu d'en créer une 2e |
| 7 | Remplir la moto à partir d'une photo de la carte grise | 3:19 « on demande le certificat d'immatriculation pour avoir toutes les données » | **Idée de Claude** (pas dite dans la vidéo), validée par Simon le 19/09 : photo ou PDF → `read-id-doc` en mode « carte grise » → champs pré-remplis, l'employé vérifie avant d'enregistrer ; la photo est rangée dans les documents de la moto |
| 8 | Le client déclare sa moto, l'équipe est prévenue et la valide | Demande de Simon du 19/09 (« quand un client enregistre une moto, une notif doit arriver chez les vendeurs et admin ») | Espace client : « Ajouter ma moto » (+ photo de carte grise) ; borne/inscription : la moto déclarée n'est plus perdue. Chaque déclaration → notification (cloche) vendeurs + admins avec lien direct → écran « Motos déclarées à valider » : rattacher à une moto existante (même VIN) ou créer la fiche du parc |

## 4. Décisions (Simon, 19/09 — feu vert global sur les recommandations)

- Civilités : M. / Mme / Mx, forme juridique séparée pour les pros.
- Le client peut changer son IBAN dans son espace, avec trace et notification à l'équipe.
- Carte grise par photo : oui, vérification humaine obligatoire avant enregistrement.
- Moto déclarée par un client : jamais ajoutée au parc sans validation d'un membre de l'équipe.

## 5. Ce qui a changé dans l'application

### Lot du 19/09 — cartes 1 à 5 (branche `lot-m4-client`, à valider)

Migrations appliquées en base le 19/09 (testées d'abord dans une transaction annulée) :
`20260919260000` à `20260919265000`. `types.ts` régénéré.

**Carte 1 — Créer une fiche client rapide au comptoir** (commit `f8dfa48`)
- Clients → Nouveau : **l'essentiel** ouvert (type, forme juridique et raison sociale pour un pro,
  civilité, prénom, nom, mobile, e-mail, adresse) ; tout le reste (statut, code, mobile 2, TVA, IBAN,
  naissance, permis, compta, catégories, notes) dans **« Compléter la fiche »**, replié à la création,
  ouvert en modification.
- Avant de créer : si l'**e-mail** (sans casse ni espaces) ou le **numéro** (comparé au mobile, au
  mobile 2 et au téléphone, tous formats) existe déjà, fenêtre « Ce client existe peut-être déjà »
  avec **« Ouvrir la fiche »** par ligne, « Annuler » ou « Créer quand même ». Jamais de fusion (D3).
- Base : `contact_phone_key(text)`, `contacts_find_by_email_or_mobile(...)` (sous RLS).

**Carte 2 — Moderniser la liste des civilités** (commit `b040ac1`)
- Civilité de la personne : **M. / Mme / Mx** (valeurs enregistrées `Monsieur`, `Madame`, `Mx` : les
  ~6 000 fiches existantes ne changent pas ; MR / MME de G8 reconnus à la lecture).
- **Forme juridique** : champ séparé pour les pros, nouvelle colonne `contacts.legal_form`, liste lue
  dans Paramètres → Tables → Civilités (lignes « Professionnel »). Plus de liste codée en dur.
- Reprise G8 : 22 formes juridiques absentes ajoutées à la table de référence (SCS, SCOM, SARL, CS,
  SNC, SPRLU, SAS, LDA, SC (VOF)…) ; **1 210 fiches** dont la civilité était une forme juridique :
  valeur **copiée** dans `legal_form` (la civilité n'est pas effacée).

**Carte 3 — Un seul numéro mobile, utilisé pour les SMS** (commit `35eaa5d`)
- Mobile (et mobile 2) enregistré au **format international** : `0471 12 34 56` → `+32471123456` ;
  un numéro en `+` est gardé (espaces retirés). Même règle dans l'espace client.
- **Correctif** : enregistrer une fiche effaçait son « téléphone » repris de G8 (`phone: null`) ; ce
  n'est plus le cas.
- Clients → **« Mobiles à compléter »** (`/clients/mobiles`) : fiches actives sans mobile dont le
  téléphone est un GSM belge (**2 934** au 19/09), bouton **« Utiliser comme mobile »** par ligne,
  tracé dans `events` (`phone_to_mobile`). Pas de correction en masse.

**Carte 4 — E-mail en minuscules et code postal qui remplit la ville** (commit `2749626`)
- E-mail sans espaces et en minuscules à la saisie (fiche, CRM) **et en base** (déclencheur
  `trg_contacts_normalize_email`, à l'insertion et quand l'e-mail change). Les 7 e-mails existants
  avec majuscules ne sont pas réécrits ; **une paire ne diffère que par la casse** : fiches **231**
  et **8293** (GILSON, `fredgilson_1@msn.com`) → à fusionner à la main.
- Table **`be_postal_codes`** (2 757 localités, 1 145 codes, province). Code postal → ville remplie
  (une localité) ou boutons de choix (plusieurs, ex. 4000 Glain / Liège / Rocourt). Au comptoir et
  dans « Mon profil ». L'inscription et la borne n'ont pas de champ code postal.
- Source : liste bpost reprise par `github.com/jief/zipcode-belgium` (mise à jour 2020) — le site
  bpost n'était pas joignable. À rafraîchir un jour depuis bpost (aucun écran d'import).

**Carte 5 — Naissance, IBAN et n° TVA complétés par le client dans son espace** (commit `8966f82`)
- **Lieu de naissance** (`contacts.birth_place`) au comptoir et dans l'espace client.
- IBAN, BIC et TVA **ouverts aux particuliers** (section « Banque et TVA ») ; IBAN contrôlé
  (modulo 97) dès qu'il est saisi ou modifié.
- « Mon profil » : lieu de naissance + carte **« Coordonnées bancaires »** (IBAN, BIC, TVA pour un
  particulier). `portal_update_profile` : liste blanche élargie, IBAN contrôlé en base.
- Changement d'IBAN par le client : ligne `events` (`portal_iban_changed`) + **cloche** « IBAN
  modifiés par des clients » pour **admin, comptable, vendeur**.

**À tester (Simon / Domenico)** : créer une fiche avec un e-mail existant ; une fiche pro (forme
juridique) ; code postal 5000 ; « Mobiles à compléter » sur une fiche ; changer l'IBAN depuis
`/mon-espace/profil` puis regarder la cloche avec un compte vendeur ou comptable.

### Lot du 19/09 — cartes 6 à 8 (branche `lot-m4-moto`, à valider)

Migrations appliquées en base le 19/09 (testées d'abord dans une transaction annulée) :
`20260919300000` et suivantes (voir chaque carte). `types.ts` régénéré.

**Carte 6 — Créer la moto du client depuis sa fiche**
- Fiche client → onglet **Parc** → **« Ajouter une moto »** → formulaire véhicule
  (`/vehicles/new?contact=<id>`) : bandeau « Propriétaire » (nom du client) + **« Propriétaire depuis
  le »** (aujourd'hui par défaut). Pas de « Suivi commercial » (prix, stock) : c'est une moto de client.
- Enregistrer = **une seule transaction** en base (`vehicle_create_for_contact`) : fiche véhicule +
  lien propriétaire courant (`vehicle_owners`, date de début) + ligne `events`
  (`vehicle_created_for_contact`). **Aucun article** V/O/P/D n'est créé (`article_id` vide) ; statut
  « Vendu », comme les 2 418 motos « RÉPARÉ » reprises de G8 (décision M-12).
- Codes officiels de la carte grise à côté des libellés : **E** VIN, **A** plaque, **B** mise en
  circulation, **D.1** marque, **D.3** modèle, **P.1** cylindrée, **P.2** kW, **P.3** énergie,
  **V.9** norme, **R** couleur (directive 1999/37/CE, reprise telle quelle par la carte grise belge ;
  pas de case européenne pour les CV, le n° moteur ni l'année modèle). Aussi en création/modification
  « normales ».
- **VIN** : mis en majuscules sans espaces ni tirets (écran et base, `vin_normalize`) ; avertissement
  (jamais bloquant, pour les vieux cadres) s'il ne fait pas 17 caractères ou contient I, O ou Q.
- **VIN déjà en base** (même société) : encadré « Ce VIN existe déjà dans le parc » avec la moto, son
  propriétaire actuel, **« Ouvrir la fiche »** et, depuis une fiche client, **« Rattacher cette moto
  existante au client »** (`vehicle_attach_owner` : l'ancien propriétaire courant est clôturé à la date
  choisie, historique gardé, `events` `vehicle_owner_attached`). L'enregistrement d'une 2e fiche est
  refusé à l'écran **et** en base (`VIN_EXISTS`).
- **VIN en double déjà présents** (19/09, rien modifié) : 4 VIN, chaque fois une fiche « vendu » (G8)
  et une fiche « Demande de reprise » : `ZDM1A02BGMB009261` (Multistrada V4 S), `ZDM1V00AANB003184`
  (Supersport 950 S), `ZDM3K00AANB005633` (Scrambler 800 Nightshift), `ZDMB200AAFB011445`
  (Hypermotard). À fusionner à la main (aucun écran de fusion de motos).

**Carte 7 — Remplir la moto à partir d'une photo de la carte grise**
- Formulaire véhicule (nouvelle moto, moto de client, modification) → **« Lire la carte grise »**
  (photo ou PDF, parties I et II). La photo est déposée dans la GED de la moto (bucket `ged`,
  `<société>/vehicle/<id>/…`, même stockage que les documents déposés par le client dans son espace),
  dossier **« Carte grise »** ; pour une moto pas encore enregistrée, elle y est rangée à
  l'enregistrement (identifiant de la moto fixé d'avance).
- Fonction serveur **`read-id-doc`, mode `carte_grise`** (même accès, même téléchargement, même modèle
  Claude `claude-opus-4-8` que la lecture d'identité ; déployée le 19/09) : Claude recopie chaque case
  (A, B, C.1, D.1, D.2, D.3, E, J, P.1, P.2, P.3, R, V.9) avec une confiance (nette / douteuse / pas sûre) ;
  `supabase/functions/_shared/carte-grise.ts` normalise (VIN, plaque `M-ABC-123`, date, nombres,
  énergie `ESSENCE`, norme `EURO n`, CV calculés depuis les kW) et baisse la confiance d'une valeur qui
  ne passe pas le contrôle.
- À l'écran : les champs **vides** sont remplis et **surlignés** — bleu + coche « Lu sur la carte
  grise », orange + triangle « Lu, à vérifier » ; un champ déjà saisi et différent **n'est jamais
  écrasé** (« Sur la carte grise : … » + **Utiliser**). Le surlignage disparaît quand l'employé touche le
  champ. Titulaire lu (C.1) affiché pour comparer au client ; cases lues mais non reprises listées.
  Rien n'est enregistré sans cliquer sur Enregistrer.
- **Pas testé avec une vraie carte grise** : mappage couvert par `tests/carte-grise.test.ts`.

## 6. Risques

- Reprise G8 : mobiles rangés dans « téléphone » et formes juridiques dans la civilité → proposer, ne pas corriger en masse sans accord.
- VIN en doublon déjà présents en base (index non unique) : lister avant d'imposer une règle.
