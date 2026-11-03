# Mission 09 — Commandes fournisseur Ducati : standard, urgente, accident, démo

> Spécification donnée par Simon le 30/10/2026 (texte, captures G8, dossier accident réel, modèles
> Excel Ducati). **Elle fait foi** et remplace, là où elles diffèrent, la spécification du 30/07
> ([`../../process-commandes-pieces.md`](../../process-commandes-pieces.md)) et les règles de la
> [mission 02](mission-02-commandes-pieces.md) (règles des 4 types, suivi d'état, regroupement par
> fournisseur, fichier DCS « provisoire »). Ce qui a été livré par la mission 02 est réutilisé.
>
> Simon : « Enregistre bien tout et crée une mission complète pour ça, je ne me répéterai pas. »

## 1. Le besoin

Comme dans G8, **retrouver toutes nos commandes** (écran « Rappel proposition commande »), et passer
quatre types de commandes chez Ducati, chacune avec ses règles, son fichier et son circuit d'envoi.

## 2. Les quatre types

### A. Commande STANDARD (capture G8 « Rappel proposition commande »)

Un **panier** qui se remplit de quatre façons :

1. **Minimax** — automatiquement : toute pièce stockée dont le stock est passé **sous son minimum**
   entre dans le panier avec la quantité qui ramène au-dessus (le DMS a `articles.stock_min` ; le
   maximum est à ajouter ; l'export G8 ne porte pas ces seuils, ils se règlent dans le DMS).
2. **Atelier, non urgent** — les mécaniciens indiquent les pièces nécessaires. **Automatiquement** :
   quand un entretien est prévu (RDV, OR avec motif entretien) et que le stock n'a pas les pièces du
   kit, un **popup** propose de les mettre dans le panier.
3. **Comptoir** — le vendeur commande des pièces pour des clients (commandes de pièces de la mission
   02 : qté client / qté magasin, règles de paiement).
4. **Site web** — les commandes Shopify. **À ajouter : commander une pièce du catalogue Ducati sur
   le site même sans stock** (on propose la commande, délai fournisseur).

Conditions de validation : **minimum 250 € HTVA** ; un bouton **« Enlever ce qui est déjà en stock »**.

À la validation :
- un champ **« Numéro de commande » vide**, rempli à la main plus tard (c'est le numéro que donne le
  DCS) ;
- la **date** et l'**opérateur connecté** sont enregistrés ;
- le bouton **« Commander »** génère le **fichier Excel exactement comme `ExportDucati.xls`**
  (capture) : colonnes `Line Number`, `Product Code`, `Day`, `Month`, `Year`, `Quantity` ; en-tête en
  ligne 1, lignes à partir de la ligne 4 ; une colonne G facultative avec le **nom du client** pour les
  lignes commandées pour un client ; format **.xls** (celui que le DCS accepte — à confirmer, voir §4) ;
- le fichier se **télécharge** et **reste enregistré à côté de la commande** ;
- le statut passe à **« Commandée »**.

On peut avoir **plusieurs paniers ouverts** en même temps.

### B. Commande URGENTE

Même processus que la standard, mais **séparée** (une seule par jour), **prix de vente majoré de
12 %** (frais), **pas de montant minimum**. (La spécification du 30/07 disait +10 % : **+12 % fait
foi**, réglable dans Paramètres.)

### C. Commande pour ACCIDENT = ouverture d'un dossier accident

Un dossier accident envoyé à Ducati West Europe (`technique.dwe@ducati.com` ; **sans copie par
défaut** — décision du 03/11/2026, le champ « Copie » existe mais reste vide, une copie se règle dans
Paramètres → Tables → « Mail du dossier accident », code `cc`), comprenant **quatre pièces jointes**
(texte de Ducati) :

1. **Fichier de commande** — Excel au format exact de
   `Formulaire Commande - Moto accidentée -.xlsx` (feuille 1 : titre « Aide Réparation Moto
   Accidentée », `Chassis N°` en C4, `Nom Client` en C5, puis trois blocs de colonnes
   Référence / Désignation / Qté à partir de la ligne 8, colonnes B-D, I-K, P-R) — *« nous
   transmettons la commande pour vous »* : c'est Ducati qui commande ;
2. **Devis de réparation** — le devis du DMS (pièces + main-d'œuvre), PDF ;
3. **Photos de la moto avant réparation** mettant en évidence les dommages (PDF de photos) ;
4. **Photo du n° de châssis gravé sur le cadre**.

Dossier réel fourni comme modèle (`dossier Accident\DOSSIERACCIDENT`, données client, **non commité**) :
devis G8 de 24 pièces + 9 h de MO (5 277,74 € HT), accord de l'expert par mail (CED), 15 photos
horodatées (vues 4 côtés, châssis, chaque dommage), formulaire Excel rempli, mail de Domenico
« Pourrais-tu faire suivre ce dossier accident s'il te plaît » avec les 4 pièces jointes.

Règles : **minimum 1 500 € HTVA** ; l'Excel généré est **envoyé par mail** à `technique.dwe@ducati.com`
quand le dossier est estimé complet (bouton « Envoyer le dossier ») ; il faut donc pouvoir **charger
les photos** (téléphone / tablette), **remplir la fiche** (châssis, client, expert, assurance, n° de
sinistre, urgence) et joindre le devis.

### D. Commande DÉMO / COURTOISIE (fichier `Fichier de commande Demo Crtsy Shwrm 2026_FR VIERGE.xlsx`)

Comme la standard, mais **accessoires uniquement**, pour équiper les motos de courtoisie et de démo.
**Minimum 2 000 €** (par onglet du classeur Ducati : Demo / Courtoisie / Showroom ; le classeur
contient le catalogue accessoires 2026 avec prix public, prix concession, classe de remise, et la
colonne `Q COMMANDE` à remplir ; code concession 100645 en D2). À la validation, le classeur rempli
part **par mail à `cas.dwe@ducati.com`**.

## 3. Ce que le DMS a déjà (mission 02, livré le 19/09, à valider)

- Types `urgente / standard / excel / accident` (`src/modules/orders/api.ts`), règles par type dans
  Paramètres → Tables (minimums, supplément, une par jour), commandes de pièces avec qté client /
  magasin, états (attente de paiement → payée → à envoyer → envoyée), commande depuis un devis / une
  facture, écran Achats → « Commandes de pièces à passer » groupé par fournisseur, fichier DCS
  **provisoire** (CSV), écran « Commande Excel Ducati » (`_app.orders.excel.tsx`, onglets Demo /
  Courtoisie / Showroom, alerte 2 000 €), frais de devis atelier (accident 125 €, diagnostic).
- Aucune commande n'a jamais été passée dans le DMS (0 `part_orders`, 0 `purchase_orders` au 30/10).
- Manque : le **panier** (minimax automatique, popup entretien, plusieurs paniers), le **fichier
  `ExportDucati.xls`** exact, le **numéro DCS** saisi à la main, le fichier **conservé** avec la
  commande, le **dossier accident** complet (photos, formulaire, mail), l'**envoi par mail** des
  classeurs, les **pièces du catalogue commandables sur Shopify**.

## 4. Questions posées à Simon le 30/10/2026 — réponses du 03/11/2026

1. **+12 % confirmé** pour l'urgente.
2. Fichier `ExportDucati` : **prendre le format du document chargé (.xls, Excel 97)**. La colonne G
   (nom du client sur certaines lignes de la capture) : Simon demande à Domenico si le DCS la lit ;
   en attendant on la remplit (sans effet si le DCS l'ignore).
3. Mail du dossier accident : **oui pour `technique.dwe@ducati.com`** ; `xavier.labranche@ducati.com`
   était en copie du mail réel de Domenico (Ducati West Europe). **Précision du 03/11 (après-midi) :
   ne PAS pré-remplir cette copie** — le champ « Copie » existe, vide par défaut, modifiable à la
   main ; une copie permanente se règle dans Paramètres → Tables (`accident_file_mail`, code `cc`).
4. Pièces du catalogue sur le site : **d'abord éclaircir la disponibilité automatique** (en stock
   Ducati Bruxelles / disponible chez Ducati / disponible chez un fournisseur) pour qu'un client
   — et le DMS — ne commande jamais une pièce qu'on ne peut pas avoir. **On construit d'abord
   l'information de disponibilité ; ensuite seulement on importe tout dans Shopify comme produits.**
   La carte 7 devient « Disponibilité automatique des pièces » (sources à établir : stock DMS,
   état E/F du tarif Ducati, disponibilité DCS / portail Ducati, fournisseurs tiers).

### Questions d'origine

1. Urgente : **+12 %** (nouvelle valeur) et non +10 % — confirmé ?
2. `ExportDucati.xls` : le DCS exige-t-il le **vieux format .xls** (Excel 97) ou un .xlsx passe-t-il ?
   La colonne G (nom du client sur certaines lignes) est-elle lue par le DCS ou juste pour vous ?
3. Dossier accident : le mail part **depuis le DMS** (boîte Outlook de l'expéditeur connecté) à
   `technique.dwe@ducati.com`, copie `xavier.labranche@ducati.com` — ok ? Texte proposé : celui de
   Domenico (« Pourrais-tu faire suivre ce dossier accident… », mention « Dossier urgent » optionnelle).
4. Pièces du catalogue sur Shopify sans stock : **publier les 54 630 références** comme produits
   « sur commande », ou un **formulaire « commander une pièce »** sur le site (référence + moto) qui
   crée la ligne dans le panier standard ? (recommandation : le formulaire d'abord — le catalogue
   entier sur Shopify est un autre chantier).

## 5. Cartes

| # | Carte | Ce qu'elle livre |
|---|---|---|
| 1 | **Le panier standard** | Plusieurs paniers ouverts ; lignes venues du minimax (stock sous le minimum → quantité pour remonter au-dessus ; `stock_max` ajouté), de l'atelier, du comptoir (commandes de pièces), du site ; bouton « Enlever ce qui est déjà en stock » ; minimum 250 € HTVA ; validation = date + opérateur + champ « Numéro de commande (DCS) » vide, modifiable après ; statut « Commandée » ; écran « Toutes nos commandes » filtrable par type / statut / période. |
| 2 | **Le fichier `ExportDucati`** | Génération exacte (Line Number, Product Code, Day, Month, Year, Quantity, nom client en G), téléchargement, fichier conservé avec la commande (GED), régénérable. |
| 3 | **Popup entretien → panier** — 🟦 fait le 03/11/2026, à valider (voir §7) | À la prise d'un RDV ou à l'ouverture d'un OR avec motif entretien : pièces du kit absentes du stock → « Mettre en commande ? » → lignes dans le panier standard (ou urgent si la date est proche). |
| 4 | **Commande urgente** | Panier séparé, une par jour, +12 % sur le prix de vente des lignes (réglable), pas de minimum, même fichier et même circuit. |
| 5 | **Dossier accident** — **faite le 03/11/2026, à valider** (voir §7) | Fiche dossier (moto / VIN, client, assurance, expert, n° de sinistre, urgence), devis lié, photos (téléphone / tablette, PDF assemblé), photo du châssis obligatoire, formulaire Excel « Aide Réparation Moto Accidentée » généré depuis le devis, contrôle 1 500 € HTVA, bouton « Envoyer le dossier » → mail Outlook à technique.dwe@ducati.com avec les 4 pièces jointes, dossier et mail conservés, statut (brouillon / envoyé / accordé / pièces reçues / réparé / clos). |
| 6 | **Commande démo / courtoisie** — 🟦 fait le 03/11/2026, à valider (voir §7) | Accessoires uniquement, classeur Ducati rempli (onglet choisi, `Q COMMANDE`, code concession), minimum 2 000 € par onglet, envoi par mail à cas.dwe@ducati.com, classeur conservé. |
| 7 | **Disponibilité automatique des pièces** | Établir, source par source, ce que le DMS peut savoir automatiquement : stock Ducati Bruxelles (DMS), disponible chez Ducati (état E/F du tarif + disponibilité DCS / portail dealer, à vérifier avec Domenico), disponible chez un fournisseur tiers. Afficher ces statuts dans le DMS (recherche, devis, panier). **Ensuite** : import de tout le catalogue dans Shopify comme produits « sur commande » avec ces statuts. |

## 6. Décisions

- **M-78** (30/10) : les quatre types de commande fournisseur et leurs règles sont ceux de cette
  mission ; +12 % pour l'urgente (remplace +10 %).
- **M-79** (30/10) : une commande validée garde son fichier Excel et son mail d'envoi ; le numéro DCS
  se saisit à la main après coup.
- **M-81** (03/11) : le panier démo / courtoisie est le classeur ouvert existant (`excel_orders`,
  kind = `demo`), accessoires uniquement ; le classeur Ducati vierge (prix concession) n'entre jamais
  dans le dépôt : il est déposé une fois par an dans la GED privée depuis Paramètres, rempli cellule
  par cellule (D2, blocs motos, `Q COMMANDE`) et conservé avec la commande.
- **M-82** (03/11) : un entretien prévu (RDV ou OR avec motif entretien) dont le kit n'est pas en
  stock déclenche un popup une seule fois par pièce et par OR / RDV ; urgente proposée si le RDV est
  à moins de 5 jours (réglable), standard sinon ; « Pas maintenant » est mémorisé aussi.
- **M-83** (03/11) : le mail du dossier accident part **sans copie par défaut** (champ « Copie » vide,
  modifiable ; copie permanente réglable dans Paramètres → Tables → « Mail du dossier accident »).
  Un dossier accident **part complet ou ne part pas** (devis lié, formulaire généré, ≥ 4 photos, photo du
  châssis, devis ≥ 1 500 € HTVA) ; sous 1 500 € HTVA, c'est une commande standard.

## 7. Livré le 03/11/2026 — cartes 3, 5 et 6 (à valider)

Branche `lot-demo-et-popup`, migration `supabase/migrations/20261103120000_m4_commande_demo.sql`
(**non appliquée**, essayée en transaction annulée sur la base de production le 03/11 : aucune
erreur). Elle ne dépend que des tables en place (`excel_orders`, `excel_catalog`,
`workshop_appointments`, `attachments`, `events`) : le panier démo n'attend pas `supplier_baskets`.
Aucune fonction serveur à déployer (`graph-send-email` existante réutilisée).

### Carte 6 — commande démo / courtoisie (ACH003)

**Pour l'utilisateur** (Pièces → Commandes de pièces → Commande démo / courtoisie, `/orders/excel`) :
1. Le panier démo est le classeur ouvert : badge « Panier démo — accessoires uniquement », onglet
   choisi (Demo / Courtoisie / Showroom) pour les ajouts, blocs **Moto 1 à 4** de l'onglet (modèle,
   n° de commande, n° de série), recherche dans le catalogue accessoires, **ajout par référence**
   (une pièce détachée ou un vêtement est refusé avec la raison), chargement d'une commande client
   (les non-accessoires sont refusés et listés).
2. **Minimum 2 000 € par onglet utilisé** (réglage existant « Minimum € HTVA par onglet Excel ») :
   message orange par onglet avec ce qui manque, bouton Commander grisé tant que ce n'est pas atteint.
3. **Télécharger le classeur rempli** : le classeur Ducati vierge de l'année (déposé dans Paramètres
   → « Déposer le classeur Ducati de l'année », administrateur) est rempli : D2 = code concession,
   I3..O5 = motos, colonne L `Q COMMANDE` des lignes concernées ; formules, noms définis, onglets
   Feuil12 / Feuil2 conservés ; n° `CEX-` attribué au 1er téléchargement (comme le 19/09).
4. **Commander (mail à Ducati)** : fenêtre d'envoi (boîte Outlook au choix, destinataire
   `cas.dwe@ducati.com` réglable dans Paramètres → Tables → Règles des types de commande, ligne
   `excel`, colonne « Adresse Ducati du classeur démo », objet « Commande <onglet> — <société> —
   <date> », classeur en pièce jointe, « Vérifier sans envoyer »). Ordre réel : classeur conservé en
   GED (dossier « Commandes Excel ») → mail → statut **« Commandée »** (date, opérateur, mail et
   classeur conservés, trace `events`), nouveau classeur vide ouvert.
5. **Historique** : commandées (date, mail, classeur téléchargeable) et anciens classeurs archivés ;
   **n° DCS** saisi à la main dans la ligne (fonction `excel_order_set_dcs_number`, tracée).

**Technique** : `src/modules/orders/demo-rules.ts` (règles pures), `demo-workbook.ts` (SheetJS :
lecture / remplissage / écriture compressée), `demo-api.ts`, `demo-mail-dialog.tsx`,
`demo-template-card.tsx` (Paramètres), `src/routes/_app.orders.excel.tsx` ; trigger
`excel_order_lines_accessory_guard` (référence ∉ `excel_catalog` → refus, en disant si c'est un
vêtement du catalogue Ducati ou une pièce du DMS), fonctions `excel_order_mark_ordered`
(numéro, minimum par onglet, accessoires, classeur conservé obligatoire) et
`excel_order_set_dcs_number`, lignes figées dès « commandee ». Tests `tests/orders-demo.test.ts`.
Limite : SheetJS (édition communautaire) ne réécrit pas la mise en forme (couleurs, largeurs) ;
valeurs, formules, noms et onglets sont conservés (vérifié sur le classeur réel : 866 références,
1,6 Mo compressé, 0,5 s).

### Carte 3 — un entretien prévu sans les pièces en stock propose de les commander (ATE013)

**Pour l'utilisateur** :
1. **Prise d'un rendez-vous** (Atelier → Planning → Nouveau RDV) : nouveau champ **Motif du
   rendez-vous** (même liste que l'OR : Entretien annuel, 15 000 km, Vidange…). Avec un motif
   entretien et une moto reliée au catalogue, après l'enregistrement : popup **« 4 pièces manquent
   pour cet entretien : les mettre en commande ? »** avec la liste (référence, désignation, qté du
   kit, stock libre, déjà en commande, manque), choix **Standard** / **Urgente** (urgente proposée si
   le RDV est à moins de N jours, N = Paramètres → Tables → Règles des types de commande, ligne
   `urgente`, colonne « urgente si RDV à moins de (jours) », défaut 5), bouton **Mettre en commande**
   ou **Pas maintenant**.
2. **Ouverture d'un OR** avec motif entretien : même popup à l'ouverture de la fiche (la moto est là :
   urgente proposée). Le bouton existant **« Commander les pièces manquantes »** de l'OR reste là
   pour les mécaniciens.
3. Pas de popup si rien ne manque ; **jamais deux fois les mêmes pièces** pour le même OR / RDV
   (mémoire `workshop_parts_prompts`, « Pas maintenant » compris) ; une nouvelle pièce du kit, elle,
   est reproposée.
4. **Mettre en commande** → `basket_add_lines(_company, _kind, _lines)` (panier standard / urgent de
   la carte 1). **Si cette fonction n'est pas en base** (carte 1 pas encore appliquée), **repli** :
   une commande de pièces du type choisi est créée en brouillon (mission 02 : `part_orders` +
   `part_order_line_save`), reliée au client de l'OR, note « Pièces d'entretien manquantes
   (<échéance>) — OR <n°> » ; le message le dit (« panier standard pas encore en base »).

**Technique** : `src/modules/workshop/parts-popup-rules.ts` (manquant = kit − max(réel − réservé, 0)
− en commande, doublons additionnés, mémoire, standard / urgente), `parts-popup-api.ts` (kit de
l'échéance : `maintenance_kit_for_model_year` + `maintenance_kit_detail`, mémoire, panier / repli),
`parts-popup.tsx`, `src/routes/_app.workshop.planning.tsx`, `_app.workshop.$orId.tsx`,
`planning-api.ts` (`reason_code` du RDV, créé sans motif si la colonne manque encore). Table
`workshop_parts_prompts` (append-only, RLS membre) + fonction `workshop_parts_prompt_log` (trace
`events`). Tests `tests/workshop-parts-popup.test.ts`. Dépend des kits de la mission 07 (migrations
`20260923160000` à `20260923163000`, **non appliquées**) : sans kit en base, aucun popup.

### À tester (03/11)

1. Appliquer la migration `20261103120000_m4_commande_demo.sql`. Paramètres → carte **« Classeur
   Ducati de l'année »** → déposer `Fichier de commande Demo Crtsy Shwrm 2026_FR VIERGE.xlsx`.
2. Commandes de pièces → **Commande démo / courtoisie** : onglet Demo, Moto 1 (modèle, n° de commande,
   n° de série), ajouter par référence `96782441AA` (accepté) puis une référence de pièce détachée
   (refusée : « c'est une pièce détachée ») ; monter l'onglet au-dessus de 2 000 € (le message
   orange disparaît).
3. **Télécharger le classeur rempli** : ouvrir le .xlsx dans Excel → D2 = 100645, I3..I5 = la moto,
   colonne L remplie sur la ligne de la référence, D7 / E7 recalculés, onglets Feuil2 présents.
4. **Commander (mail à Ducati)** → destinataire = votre adresse → **Vérifier sans envoyer** puis
   **Envoyer et commander** : mail reçu avec le classeur ; l'écran repart d'un classeur vide ;
   Historique : ligne « Commandée », classeur téléchargeable, saisir le **n° DCS**.
5. Atelier → Planning → Nouveau RDV : moto reliée au catalogue (avec kit), motif « Entretien
   15 000 km », date dans 3 jours → popup avec **Urgente** proposée → **Mettre en commande** →
   commande de pièces en brouillon (ou panier urgent si la carte 1 est appliquée). Rouvrir : plus de
   popup pour ces pièces. Même RDV à 10 jours → Standard proposé.
6. Ouvrir un OR avec la même moto et motif entretien → popup à l'ouverture → **Pas maintenant** →
   recharger la fiche : plus de popup.
### Carte 5 — Dossier accident (03/11/2026, branche `lot-dossier-accident`, à valider)

**Ce qui est fait.** Atelier → **Dossiers accident** (liste) ; un dossier s'ouvre depuis la fiche d'un
**OR** (« Ouvrir un dossier accident », qui retrouve le dossier déjà ouvert pour cet OR) ou depuis un
**devis** avec moto (même bouton). Sur la fiche : moto / VIN / client (de l'OR ou du devis), assurance,
n° de sinistre, expert et son e-mail, interrupteur « Dossier urgent » + note (reprise dans le mail) ;
**devis lié** (choisir un devis existant de cette moto, ou « Créer un devis » qui ouvre Ventes → nouveau
devis atelier ; total HT, dont pièces HT ; sous 1 500 € HTVA : badge « passe en commande standard »,
sinon la **remise prévue de 15 % des pièces**) ; **photos** (appareil ou galerie, plusieurs à la fois,
légende par photo, bouton « Photo du châssis » pour marquer LA photo du n° gravé, horodatage = date de
la photo) ; **rapport de l'expert** (PDF déposé, facultatif, conservé mais pas joint au mail) ;
**formulaire Ducati** (« Générer le formulaire » : les lignes pièces du devis — référence, désignation,
quantité, pas la main-d'œuvre ni les frais de devis — écrites **dans le modèle Ducati lui-même**
(`public/modeles/formulaire-commande-moto-accidentee.xlsx`, feuille 1 : C4 châssis, C5 client, blocs
B-D / I-K / P-R à partir de la ligne 8, 39 lignes par bloc), téléchargé et rangé dans la GED du
dossier) ; checklist **« Dossier complet ? »** (devis, formulaire, ≥ 4 photos, photo du châssis,
≥ 1 500 €) ; **« Envoyer le dossier »** grisé tant qu'elle n'est pas verte. La fenêtre d'envoi reprend
celle des documents de vente : boîte d'envoi (boîte partagée ou adresse de l'utilisateur), destinataire
`technique.dwe@ducati.com` (Paramètres → Tables → « Mail du dossier accident », code `to`), **copie vide**
(code `cc` si on en veut une), objet « Dossier Accident : CLIENT - modèle 6 derniers du VIN », corps =
texte de Domenico (+ « Dossier urgent : … »), **4 pièces jointes régénérées à l'envoi** (formulaire
.xlsx, devis PDF du DMS, PDF des photos — une par page, titre « Photos avant réparation — modèle — VIN »,
légende et horodatage —, photo du châssis en JPG), « Vérifier sans envoyer » (simulation serveur). Après
l'envoi : statut « envoyé », `sent_at / sent_to / sent_cc / mail_subject`, pièces rangées dans la GED du
dossier, trace `events` (`email_sent` sur `accident_files`), bouton « Renvoyer ». Statuts suivants
choisis à la main : accordé → pièces reçues → réparé → clos.

**Où.** `src/modules/workshop/accident/` (`rules.ts` règles pures, `form-xlsx.ts` modèle rempli via
fflate, `photos-pdf.ts`, `api.ts`, `send.ts`, `accident-file-screen.tsx`, `accident-photos.tsx`,
`accident-send-dialog.tsx`, `accident-files-list.tsx`), routes `_app.workshop.accidents.index.tsx` et
`_app.workshop.accidents.$fileId.tsx`, migration `20261103110000_m8_dossiers_accident.sql`
(**non appliquée**), fonction `graph-send-email` (copie `cc`, trace sur `accident_files`) **à redéployer**,
tests `tests/workshop-accident-file.test.ts`. L'ancienne fenêtre « Aide réparation Ducati »
(`accident-help-dialog.tsx`, `mailto:`) est retirée : le dossier la remplace.

**Comment tester** (après `db push` et `functions deploy graph-send-email`) :
1. Ouvrir un OR avec moto et client → « Ouvrir un dossier accident » : la fiche s'ouvre, statut Brouillon,
   checklist tout en ✗.
2. Devis lié : « Créer un devis » → devis atelier avec quelques pièces (> 1 500 € HT) et de la MO → valider →
   revenir au dossier → choisir ce devis ; vérifier le total, la remise prévue 15 % des pièces ; essayer un
   devis < 1 500 € : badge « passe en commande standard », bouton Envoyer grisé.
3. Photos (tablette) : 4 photos + 1 du n° de châssis marquée « Photo du châssis » ; légendes.
4. « Générer le formulaire » : ouvrir le .xlsx : C4 = VIN, C5 = client, pièces en B/C/D dès la ligne 8,
   bordures et logo du modèle intacts.
5. Checklist verte → « Envoyer le dossier » → mettre **sa propre adresse** en destinataire → « Vérifier sans
   envoyer » (aperçu, 4 pièces jointes) → « Envoyer » : mail reçu avec les 4 fichiers ; dossier « Envoyé »,
   pièces dans la GED du dossier, bouton « Renvoyer ».
6. Paramètres → Tables → « Mail du dossier accident » : changer `to`, ajouter `cc` → la fenêtre d'envoi suit.
