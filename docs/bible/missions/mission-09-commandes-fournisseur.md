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

Un dossier accident envoyé à Ducati West Europe (`technique.dwe@ducati.com`, copie au responsable
DWE), comprenant **quatre pièces jointes** (texte de Ducati) :

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

## 4. Questions posées à Simon le 30/10/2026

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
| 3 | **Popup entretien → panier** | À la prise d'un RDV ou à l'ouverture d'un OR avec motif entretien : pièces du kit absentes du stock → « Mettre en commande ? » → lignes dans le panier standard (ou urgent si la date est proche). |
| 4 | **Commande urgente** | Panier séparé, une par jour, +12 % sur le prix de vente des lignes (réglable), pas de minimum, même fichier et même circuit. |
| 5 | **Dossier accident** | Fiche dossier (moto / VIN, client, assurance, expert, n° de sinistre, urgence), devis lié, photos (téléphone / tablette, PDF assemblé), photo du châssis obligatoire, formulaire Excel « Aide Réparation Moto Accidentée » généré depuis le devis, contrôle 1 500 € HTVA, bouton « Envoyer le dossier » → mail Outlook à technique.dwe@ducati.com avec les 4 pièces jointes, dossier et mail conservés, statut (brouillon / envoyé / accordé / pièces reçues / réparé). |
| 6 | **Commande démo / courtoisie** | Accessoires uniquement, classeur Ducati rempli (onglet choisi, `Q COMMANDE`, code concession), minimum 2 000 € par onglet, envoi par mail à cas.dwe@ducati.com, classeur conservé. |
| 7 | **Pièces du catalogue commandables sur le site** | Selon la réponse à la question 4. |

## 6. Décisions

- **M-78** (30/10) : les quatre types de commande fournisseur et leurs règles sont ceux de cette
  mission ; +12 % pour l'urgente (remplace +10 %).
- **M-79** (30/10) : une commande validée garde son fichier Excel et son mail d'envoi ; le numéro DCS
  se saisit à la main après coup.
