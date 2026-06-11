# G8 / Futurosoft — Fonctionnalités & parcours (M1 Contacts · M2 Articles · M3 Véhicules · M4 Réceptions)

> Extraction **fonctionnelle** (actions, boutons, enchaînements, règles) du DMS G8 hérité, pour reconstruction iso-fonctionnelle.
> Périmètre = **Module Fichiers** + **Réception véhicules neufs** + **Modification en cascade**.
> **Sources** :
> - `docs/reference-g8/DOC_Menu_Fichiers.pdf` — manuel « Module Fichiers », 138 p. (réf. pages `[Mxx]` ci-dessous). `Info Doc/Fichiers2 G8.pdf` (265 Mo) = même manuel scanné HD, **pas de contenu supplémentaire**.
> - `docs/reference-g8/RECEPTION DES VEHICULES NEUFS G8 3.2.26.pdf` — captures réception neufs (réf. `[Rx]`).
> - `Info Doc/Fichiers Modification en Cascade G8.pdf` — tuto modif cascade (réf. `[Cx]`).

---

# 1. Fonctionnalités (checklist)

## 1.1 — M2 Articles & tarifs (`Fichiers › Articles`)

### Fiche article — création / champs métier
- [ ] Création article guidée : **choix fournisseur d'abord, puis famille (rayon / sous-rayon / catégorie)** obligatoire avant saisie `[M10]`.
- [ ] Bouton **« Création auto »** : enchaîne plusieurs créations en conservant fournisseur + familles sélectionnés `[M25]`.
- [ ] Partie DESCRIPTIF : référence, désignation, **descriptif (texte long, option "visible sur documents clients")**, code-barre, réf. fournisseur, taille, couleur, marque, poids/volume/longueur `[M13-15]`.
- [ ] Partie CLASSEMENT : fournisseur/rayon/sous-rayon/catégorie, **type de gestion** (A/M/F/N/V/O/P/D/R/T), taux TVA, **code casier (≤12 car., chiffres ou lettres)**, dates auto (créé/modifié/vendu/acheté/dernier tarif) `[M15-18]`.
- [ ] Partie PRIX **interactive** : PAHT, **coefficient**, PVHT, PVTTC, % marge, DEEE/Éco-participation — saisir 1 des 4 (coeff/PVHT/PVTTC/marge) recalcule les 3 autres en tenant compte de la **table d'arrondis** `[M18-19, M30]`.
- [ ] **PAMP** affiché (valeur moyenne en stock, MAJ à chaque réception ; **réinitialisé au PA fiche quand stock réel = 0** ; base de la marge en facturation) `[M19]`.
- [ ] Valeur stock réel = `Qté réel × PAMP` ; **marge sur PAHT** ET **marge sur PAMP** (valeur + %) affichées séparément `[M19-20]`.
- [ ] **Référence d'origine** (si option « commandes multifournisseurs ») : lie une pièce grossiste à la pièce fournisseur principal ; symbole sur la fiche → ouvre les équivalences `[M20]`.

### Onglets de la fiche article
- [ ] **Stock** : réel / disponible (`réel − réservé/OR/BL`) / **arrêté** (photo dernier arrêté inventaire) / mini / maxi / qté cmd fournisseur (auto) / qté cmd client (auto) / conditionnement d'achat `[M21-22]`.
- [ ] **Nomenclature** : rattacher l'article à une/plusieurs nomenclatures `[M23]`.
- [ ] **Mouvements** : tous mouvements (facturation, livraison, réparation…) `[M23]`.
- [ ] **En cours fournisseur** : documents fournisseur liés (nom, date, qté, type) `[M24]`.
- [ ] **Comptabilité** : n° compte vente / achat `[M24]`.
- [ ] **Note** : zone libre 2 lignes `[M24]`.
- [ ] **Image** : document associé `[M22]`.
- [ ] **Reprise** : onglet n'apparaissant que pour types R / P (préfixe + fournisseur/rayon/sous-rayon/catégorie cibles des occasions reprises) `[M25-26]`.

### Fonctions avancées en modification d'article
- [ ] **Liste des documents en cours** où figure l'article `[M33]`.
- [ ] **Équivalences** : lier des références équivalentes (autres fournisseurs/grossistes) ; ajouter (double-clic), supprimer (clic ligne) ; symbole sur fiche si param « recherche équivalence auto en caisse » actif `[M34-36]`.
- [ ] **Statistiques** : ventes/achats cumulés mois+année courants + détail mois par mois sur 3 derniers exercices `[M36]`.
- [ ] **N° de série en stock** (types V/O/P uniquement) : consulter / modifier / supprimer / **ajouter** un n° série + toutes infos véhicule `[M37-39]`.
- [ ] **Remplacement de référence** : saisir une nouvelle réf par-dessus l'ancienne → confirmation `[M40]`.

### Références utilitaires (templates obligatoires)
- [ ] **REP** (type R) : reprise occasion. TVA 0 % (particulier → O / TVA marge) ou 20 %/21 % (pro → P) `[M25-26]`.
- [ ] **Article occasion** (type O part. / P pro) : PAHT = prix reprise, PVTTC = prix revente `[M26]`.
- [ ] **Main d'œuvre** (type T) : 1 réf par taux horaire / par mécanicien ; **quantité en centièmes** (1h15 → 1.25, 1h10 → 1.16) `[M27]`.
- [ ] **Petites fournitures** : réf `+ 2.0` (type M) → calcule auto X % du total des lignes (placer en **dernière ligne**) `[M28]`.
- [ ] **Articles à coefficient fixe** : réf commençant par `*` + coeff (`*2.230`, type M) → PVTTC caisse ÷ coeff = marge ; pas de stock ni stats `[M28-29]`.
- [ ] **Référence texte** (type F) : désignation = texte prédéfini (réf masquée à l'édition) ou vide = texte libre en caisse `[M29-30]`.
- [ ] **Référence LB** (type F) : injectée auto en facturation fin de mois / facturation OR (n°+date BL, identif. machine réparée) `[M30]`.
- [ ] **Référence FRAIS_BL** (type M) : majoration % en facturation fin de mois `[M30]`.

### Prix de base, arrondis, recalcul, librairie
- [ ] Liste des prix par fournisseur / par désignation `[M46-50]`.
- [ ] **Paramétrage des arrondis** : tableau par fournisseur/rayon/sous-rayon/catégorie + fourchettes de prix, **arrondi toujours à la tranche supérieure** ; bouton « Pour tous les fournisseurs » `[M51-52]`.
- [ ] **Recalcul PA/PV** (sur sélection fournisseur/rayon) : appliquer un **taux %** (PAHT ou PVTTC, négatif autorisé, par paliers de prix d'achat) **OU** un **nouveau coefficient** ; applique l'arrondi paramétré `[M52-56]`.
- [ ] **Librairie** : exporter/importer des références (par fournisseur ou par rayon) entre fichier article ↔ librairie (**stock = 0 obligatoire pour exporter**) ; **réimport auto** si réf complète saisie en document ; modification en cascade de la librairie (ex. purge d'un fournisseur abandonné) `[M57-59]`.
- [ ] **Modification en cascade** des articles (voir §1.5).

### Familles & Nomenclatures
- [ ] **Familles** : arborescence rayon › sous-rayon › catégorie ; créer/modifier (libellé seul, code figé)/supprimer/déplacer ; liste imprimable `[M129-132]`.
- [ ] **Nomenclatures / forfaits** : créer une réf regroupant des articles ; au moment de la vente choisir **Forfait** (1 ligne, prix global) ou **Nomenclature** (détail ligne par ligne) ; vente = saisie de la réf → éclatement auto ; liste imprimable `[M134-138]`.

## 1.2 — M1 Contacts / Clients (`Fichiers › Clients`)

### Fiche client — champs
- [ ] Code auto, civilité (extensible), **nom (seul champ obligatoire)**, adresse(+suite)/CP/pays, **email principal + email autre**, tél/fax/portable, date de naissance `[M61-62]`.
- [ ] Flags : **client en compte**, **client douteux**, **mode HT**, **client détaxé**, nbre exemplaires `[M63-64]`.
- [ ] Conditions & tarifs : **tarif client**, condition de règlement, profession, code TVA, n° TVA, commentaires `[M64-66]`.

### Onglets de la fiche client
- [ ] **Solde / Encours / IBAN** : compte comptable, code affacturage, domiciliation, BIC/SWIFT, IBAN, **encours autorisé / encours actuel / solde client** `[M66-68]`.
- [ ] **Contacts** (multi-contacts), **Images**, **Permis de conduire** `[M68-69]`.
- [ ] **Info Stock** : opérations réalisées pour ce client (date/type doc/quantité) `[M70]`.
- [ ] **Document** : liste des documents (déplier détail), rappel des docs en cours, ré-édition, consult/modif règlements/acomptes, régularisation factures/avoirs dus `[M70]`.
- [ ] **Rdv Atelier** : RDV passés/à venir, lignes colorées par statut `[M71]`.
- [ ] **Parc** : tous les n° de série attribués au client (vendus/réparés/repris) + historique détaillé `[M71]`.
- [ ] **Adresse livraison** (multi-adresses), **Histo Email/SMS**, **Groupe**, **CRM** (actions planifiées), **Archive Documents**, **Relance** `[M72-73]`.

### Fonctions avancées client
- [ ] **Saisie produit fini** : enregistrer historique véhicule **antérieur à G8** (vente neuf / vente occasion / réparation) en 3 onglets Véhicule/Client/Condition → ressort auto au prochain passage `[M74-76]`.
- [ ] **Échéances** : liste des échéances du client `[M77]`.
- [ ] **Édition fiche** ; **Nouveau document** (facture / livraison / réparation directe) `[M77]`.

### Tarifs client & mailings
- [ ] **Tarif client** : code alphanum. 5 car. ; appliqué à fournisseur/rayon/sous-rayon/catégorie/référence ; **jusqu'à 3 paliers de quantité** ; remise % OU prix net OU coefficient (`(PAHT×coeff)+TVA=PVTTC`) ; **dates début/fin** ; case **Promotion** (commentaire auto sur doc, redémarrage G8 requis) `[M85-88]`.
- [ ] **Listes & mailings clients** : sélection en entonnoir, étiquettes/mailing `[M88]`.

## 1.3 — M3 Véhicules & parc (`Fichiers › Parc`)

- [ ] **Définition** : parc = historique de toute machine vendue/réparée/reprise/en stock (neuf ou occasion) avec n° de série. **N° châssis = seul champ impératif** pour construire l'historique `[M90]`.
- [ ] Données série : châssis/cadre, moteur, immatriculation, marque, type, genre, cylindrée, n° clés, couleur/taille, 1re mise en circulation, kilométrage `[M90]`.
- [ ] **Fiche produit fini** (type V forcé) : créer/modifier/supprimer + créer/modifier/supprimer les **n° série en stock** depuis le bas d'écran `[M91-94]`.
- [ ] **Recherche multi-critères du parc** par état `[M97-100]` :
  - Tous les produits finis
  - En stock : neufs / occasion / dépôt-vente / **réservés clients** / **livrés clients** / **en dépôt agent**
  - Vendus : neufs / occasion / dépôt-vente / **rétrocessions**
  - Réparés : en réparation / réparés (historique)
  - En commande
- [ ] Fonctions liées à la recherche : **Export Excel**, Fiche produit, Fiche article, **Mise en dépôt agent** (génère bon réservation dépôt), **Véhicule vendu** (retire un n° série déjà vendu), **Remettre en stock**, **Annuler mise en dépôt**, **Supprimer châssis** `[M101-103]`.
- [ ] **Historique véhicule (Fiche produit)** : haut = infos véhicule, bas = tous mouvements chrono (vente/réparation/rachat/**cession interne**/revente) avec client + n° doc + date ; ré-éditer fiche de reprise ; imprimer historique complet `[M104]`.
- [ ] **Fiche produit fini repris** : édition avec ou sans prix d'achat `[M105]`.
- [ ] **Achat occasion** (hors module facturation) en 3 onglets **Véhicule / Client / Conditions** (prix reprise, PVTTC, rayon/sous-rayon/catégorie auto-paramétrables) → édite **fiche de reprise** `[M105-108]`.
- [ ] **Dépôt-vente** : véhicule appartenant au client (pas de rachat) → fiche de dépôt = contrat ; prix de vente **minimum de réserve** (onglet Conditions) `[M109-110]`.
- [ ] **Vente d'un dépôt-vente** : sélectionner → Vendre → choisir acheteur (ou Nouveau client) → prix final → **calcul commission** ; onglets Conditions/Acquéreur/Observations ; édite attestation (≠ facture) + enregistre règlement `[M110-112]`.
- [ ] **Modification dépôt-vente** ; **Supprimer** (purge totale) vs **Retour client** (sort du stock, conserve trace historique) `[M113]`.

## 1.4 — M4 Achats & réceptions

### Module Achats (réception/cmd) — menu `[R1]`
- [ ] Nouveau document : **Réception**, **Commande**, **Proposition commande**, **Vos demandes en attente**, **Rétrocession** ; Rappel : Réception / Commande / Proposition cde / Demandes magasin reçues.

### Écran Réception `[R3]`
- [ ] En-tête : fournisseur, opérateur, **N° facture, N° BL, date facture, date BL, date réception**, remise par ligne (on/off), N° intranet, montant port HT, **port taxé**, taux TVA sur port.
- [ ] Lignes : réf. article / réf. fournisseur / libellé / quantité / **étiquettes** / prix unitaire / remise / total ligne / **PVTTC unit.** / flags S R / **code casier** ; totaux Qté reçue / Total prix public / Total HT.
- [ ] Saisie réf article → propositions multi-variantes (couleur, version) avec prix `[R3]`.
- [ ] Actions latérales : Commentaires, Fiche article, **Importation code-barre**, **Import microfiches**, **Recherche articles par famille**, **Fiche fournisseur**, **En cours commande**, **Rappel cde**, Sélection ligne / Sélection totale, **Changement Frs**, **Rapprochement cmd** `[R3]`.
- [ ] Boutons bas : **Librairie**, recherche référence, **N° Série**, Raz ligne, Raz tout, **Inser. ligne** `[R3]`.

### Réception châssis (véhicule neuf) `[R4-R5]`
- [ ] Bloc **Identification** : **N° de série/châssis (E)**, référence, marque (D.1), modèle, n° de plaque (A), **n° de moteur**, **origine**, n° de clé, **ID Tracker**, **PIN Tracker**.
- [ ] Bloc **Caractéristiques** : cylindrée (P.1), **puissance en CV (P.2) + case Bridé**, énergie (P.3), norme antipollution (V.9), couleur, catégorie, nb de cylindres.
- [ ] Bloc **Infos supplémentaires** : nature produit fini (MOTO/B), **mise en circulation**, **kilométrage (N.C. / Réel / N.G.)**, **TPMS AV / TPMS AR**, **Fin garantie**, **année modèle**, **véhicule de démonstration**, **code exposition**, **véhicule en dépôt marque**.
- [ ] Bloc **Prix** : PAHT, **prix de revient**, PVTTC ; bloc **Facture fournisseur** (numéro, date).
- [ ] Validation ligne châssis → crée fiche véhicule (type V) + n° série en stock `[R5]`.

### Rappel réception / Facture fournisseur `[R6]`
- [ ] 3 régimes : **Achat avec TVA** / **Achat C.E.E. sans TVA** / **Achat hors C.E.E. sans TVA**.
- [ ] Totaux : Brut HT (calcul sur 3 décimales), Port HT, Remise HT %, Net HT ; N° + date facture.
- [ ] **Échéances** : échéances dues, total échéances TTC, ajouter une échéance (n°/date/montant) ; boutons Livraison / Facture.

### Fournisseurs (`Fichiers › Fournisseurs`)
- [x] Fiche : code auto, **n° de client chez le fournisseur** (imprimé sur commandes), nom (obligatoire), coordonnées (adresse multi-zones imprimée sur BC, tél/fax/email) `[M115-116]` — *champs sur la fiche contact fournisseur*
- [x] **Code fournisseur interne** = magasin lui-même (rattache MO, reprise occasion…) `[M116]`.
- [ ] Modifier/consulter/supprimer (**suppression bloquée si articles rattachés** → réaffecter ou supprimer articles) ; liste imprimable `[M117-119]`.
- [x] **Remise fin d'année (RFA)** : saisie remise accordée → injectée dans les stats + ajoutée à la marge fournisseur `[M121]` — *champ RFA ; injection stats/marge avec M13*

## 1.5 — Modification en cascade (`Fichiers › Articles › Modification en cascade`) `[C1-C4]`

- [ ] **Sélection** par : fournisseur, rayon/sous-rayon/catégorie, marque, **fichier (article et/ou librairie)**, référence/désignation/casier (avec jokers `ABC` / `ABC%` / `%ABC` / `%ABC%` / `ABC;EFG`), taux TVA, année, PV/PPC, **stocks (positif/négatif/=0)**, **type de gestion**, **inutilisé depuis 12/18/24 mois**. Sinon **import Excel** de la liste de réf à modifier.
- [ ] **Lister** → tableau coché ; édition directe en cellule (désignation, casier, PAHT, PVHT/PVTTC, stock réel, mini, maxi ; réf. non modifiable) avec option « Confirmer modification article ».
- [ ] **Modifier ensemble** (menu) : Activer/désactiver « Visible sur documents clients » ; **Aligner PV↔PPC** (2 sens) ; **Bloquer/Débloquer MAJ** désignations / PA / PV (verrous mise à jour tarifs) ; Changer casier / couleur / descriptif / **famille (rayon/sous-rayon/cat.)** / format de contenant / **fournisseur** / **marque** / **nomenclature** / **prix** / taille / **taux TVA** / **type de gestion**.
- [ ] **Changer de prix** (sous-écran) : augmenter PA de X % · augmenter PA de X € · **fixer PA à** · augmenter PVTTC de X % · augmenter PVTTC de X € · **fixer PVTTC à** · **appliquer un coefficient** · **appliquer une marge** %.
- [ ] **Supprimer ensemble** / Supprimer article (stock=0 requis) ; **Envoyer en librairie** / **Librairie vers article** ; **Import code-barre** / **Import microfiches** ; Fiche article.

---

# 2. Parcours utilisateur (flux clés)

### 2.1 Réception d'une moto neuve → fiche véhicule (sur base facture achat Ducati) `[R1-R6]`
1. `Achats › Nouveau document › Réception` (variante « véhicules neufs ») `[R1]`.
2. Saisir en-tête depuis la **facture d'achat Ducati** : fournisseur (DUCATI WEST EUROPE), opérateur, **N° facture, date facture**, date réception, port/pub si présents `[R2-R3]`.
3. Saisir la **ligne article véhicule** (réf modèle ex. `MONSTERV2 RED`) → propositions de variantes (couleur) → choisir, qté 1, prix unitaire HT depuis la facture `[R3]`.
4. Sur la ligne véhicule → **N° Série / Réception châssis** : saisir **N° châssis** (ex. `ZDM5000AATB000207`), **N° moteur**, puissance CV + **bridé**, énergie, norme antipollution, couleur, catégorie, cylindres, mise en circulation, kilométrage, TPMS AV/AR, **fin garantie**, année modèle, démo, ID/PIN Tracker `[R4-R5]`.
5. PAHT/prix de revient/PVTTC reportés ; **valider** → création **fiche véhicule type V + entrée n° série en stock** rattachée à la réf article `[R5]`.
6. `Rappel réception` → choisir régime (**Achat C.E.E. sans TVA** pour import Ducati Italie), vérifier totaux (calcul 3 décimales) et **planifier les échéances** de paiement `[R6]`.
> **Effet** : le véhicule devient simultanément **article** (PAMP, stock) **et fiche véhicule** (VIN, historique) — jointure cœur.

### 2.2 Remplacer une référence article + transfert stock/PAMP `[M40-41]`
1. Modifier l'article → saisir la **nouvelle référence** par-dessus l'ancienne → confirmer.
2. **Cas réf inexistante** : ancienne réf disparaît ; en facturation, saisir l'ancienne réf bascule auto vers la nouvelle ; historique des anciennes réf conservé ; étiquettes code-barre anciennes restent valables.
3. **Cas réf déjà existante (pièces uniquement)** : **stocks réel + disponible transférés** vers la nouvelle réf, **PAMP recalculé**, ancienne réf supprimée, bascule auto en facturation ; G8 met à jour les **documents en attente** (BL, réservation, OR).

### 2.3 Modification en cascade des tarifs `[C1-C4]`
1. `Fichiers › Articles › Modification en cascade` → poser la **sélection** (fournisseur/rayon/marque/type gestion/inutilisé…) ou importer un Excel → **Lister**.
2. Cocher les références cibles → **Modifier ensemble › Changer de prix**.
3. Choisir l'opération (augmenter/fixer PA, augmenter/fixer PVTTC, appliquer coefficient, appliquer marge) → Valider.
4. Variante **recalcul par fournisseur/rayon** : `Articles › Recalcul PA/PV` → taux % (PAHT/PVTTC, par palier de PA) ou nouveau coefficient → **Modifier prix de base** ; l'**arrondi** paramétré (`Paramétrage des arrondis`, tranche supérieure) s'applique aux réf du fournisseur/rayon sélectionné `[M52-56]`.
5. Verrous : poser « Bloquer MAJ prix d'achat/de vente/désignations » sur les réf qui **ne doivent pas** être écrasées par un futur import tarifs `[C3-C4]`.

### 2.4 Gestion des équivalences `[M34-36]`
1. Fiche article (réf constructeur) → bouton **Équivalence** → liste des équivalents.
2. **Ajouter** : double-clic sur la réf équivalente (autre fournisseur/grossiste) → ligne ajoutée. **Supprimer** : clic sur la ligne.
3. Si param « recherche équivalence auto en caisse » actif → en vente, proposition auto d'un équivalent (prix, dispo, délai).

### 2.5 Export / import librairie `[M57-59]`
1. **Export** : `Articles › Gestion librairie › Export par fournisseur (ou rayon)` → sélection → Valider (stock=0 obligatoire) → barre de progression.
2. **Import** : même écran sens librairie → fichier article ; **réimport auto** dès qu'une réf complète est saisie dans un document.
3. **Purge fournisseur abandonné** : tout exporter en librairie → `Modification en cascade de la librairie` → **Supprimer ensemble**.

### 2.6 Reprise d'occasion (entrée parc) `[M105-108]`
1. `Parc › Achat occasion` → onglet **Véhicule** (réf, châssis, moteur…) → onglet **Client** (vendeur) → onglet **Conditions** (prix reprise, PVTTC, rayon/sous-rayon/catégorie).
2. Valider → édition **fiche de reprise** + création article occasion (O particulier / P pro) avec n° série en parc. (Saisir la facture d'achat occasion en compta — G8 ne la génère pas.)

### 2.7 Dépôt-vente : entrée → vente `[M109-112]`
1. `Parc › Création dépôt-vente` (même écran qu'occasion) → fiche de dépôt = contrat ; prix mini de réserve.
2. `Parc › Vente d'un dépôt-vente` → Vendre → acheteur → prix final → **commission calculée** → attestation (≠ facture) + règlement.
3. Sortie : **Retour client** (garde trace) ou **Supprimer** (purge).

---

# 3. Règles métier & options

- **Type de gestion pilote la TVA & le stock** : O → TVA sur marge (revente) ; P → TVA pleine ; seuls V/O/P portent des **n° de série** ; F = texte ; M = non stocké ; N = composant forfait ; R = utilitaire reprise ; T = MO (quantité en centièmes) `[M15-17, M27]`.
- **PAMP** : MAJ à chaque réception ; **réinitialisé au PA fiche quand stock = 0** ; base de calcul de la marge en facturation ; marge suivie sur PAHT **et** PAMP `[M19]`.
- **Champs prix interactifs** : PAHT/coeff/PVHT/PVTTC/marge — modifier 1 recalcule les autres ; **table d'arrondis** toujours à la tranche supérieure, appliquée à la création et aux MAJ tarifs `[M18-19, M56]`.
- **Stock réel ne doit pas être modifié à la main** (aucune trace) → passer par module Appros ; zone verrouillable via param « Saisie en stock autorisé en fiche article » `[M21]`. → conforte l'invariant **append-only B7**.
- **Triple stock** natif : réel / disponible (`réel − réservé/OR/BL`) / **arrêté** (photo dernier arrêté inventaire) `[M21]` → invariant **B4**.
- **Remplacement de référence** : transfert stock + recalcul PAMP **pour pièces uniquement** ; conserve historique anciennes réf + MAJ documents en attente `[M41]`.
- **Librairie** : export uniquement si stock=0 ; réimport auto à la saisie ; sert à alléger le fichier article et purger les fournisseurs abandonnés `[M57-59]`.
- **Casier** ≤12 caractères, multi-usage (affiché en facturation, base inventaire par armoire/étagère/local) `[M18]`.
- **Verrous MAJ tarifs** (PA/PV/désignation, blocage/déblocage) protègent les réf à la prochaine mise à jour de tarifs `[C3-C4]`.
- **Tarif client** : 3 paliers quantité, remise/prix net/coefficient, dates début/fin, flag promotion (commentaire auto) `[M86-87]`.
- **Encours client** : encours autorisé vs actuel + solde + client douteux/en compte → base du contrôle crédit `[M67-68]` → invariant **B (encours crédit)**.
- **Réception véhicule neuf** : régimes TVA (avec / C.E.E. sans / hors C.E.E. sans) + échéances de paiement ; calcul brut sur 3 décimales `[R6]`.
- **Champs réglementaires véhicule** (codes carte grise) : E (châssis), D.1 (marque), P.1 (cylindrée), P.2 (puissance + bridé), P.3 (énergie), V.9 (norme antipollution), A (plaque) `[R4-R5]`.
- **Suppressions protégées** : article (stock=0 + pas en réservation/BL/OR), fournisseur (pas d'articles rattachés), famille `[M44, M118]`.
- **Saisie produit fini** : historiser un véhicule pré-G8 (vente neuf/occasion/réparation) `[M74-76]`.

---

# 4. Lien avec notre app (M1–M4)

| Domaine G8 | Module cible | Ce qu'il faut porter (au-delà des champs déjà en place) |
|---|---|---|
| Type de gestion A–R/T pilotant TVA/stock/n° série | **M2 `articles`** | Logique conditionnelle déjà cadrée (B1). Ajouter : onglet **Reprise** (préfixe + familles cibles) pour R/P, références utilitaires (REP, MO type T centièmes, `+2.0` petites fournitures, `*coeff`, texte F, LB, FRAIS_BL). |
| Coeff/PVHT/PVTTC/marge interactifs + **table d'arrondis** | **M2** | Implémenter le **recalcul interactif** 4 champs + moteur d'arrondis (tranche sup, par fournisseur/rayon/fourchette) — réutilisé par le moteur d'import tarifs déjà fait (M2). |
| **Modification en cascade** (sélection + 20 actions + changer prix) | **M2** | Écran de sélection avec jokers + import Excel ; actions de masse (prix %/€/fixe/coeff/marge, famille, fournisseur, TVA, type gestion, **verrous MAJ**, envoi/retour librairie). Append-only sur `price_changes`. |
| **Équivalences** & **référence d'origine** multifournisseur | **M2** | Table `article_equivalences` (lien n-n) + proposition auto en POS (M6). |
| **Librairie** (export/import, réimport auto) | **M2** | Flag `is_library` + actions export/import par fournisseur/rayon (B : stock=0). |
| **Remplacement de référence** + transfert stock/PAMP | **M2/M5** | Procédure dédiée : append-only `stock_moves` (transfert), recalcul PAMP, conservation alias anciennes réf, MAJ docs en attente. |
| **Nomenclatures / forfaits** (forfait vs détail) | **M2** | Type N + choix mode facturation à la vente. |
| **Fiche client** : encours/solde, parc, RDV, **CRM/relances**, **histo email/SMS**, RGPD (permis, images, groupes) | **M1 `contacts`** (+ M10) | Onglets Parc (VIN liés), Échéances, Info Stock, Relance, Histo Email/SMS, Saisie produit fini (historique pré-migration). Encours autorisé/actuel = contrôle crédit. |
| **Tarifs client** (paliers, promo, dates) | **M1/M6** | Table `client_prices` (paliers qté, remise/net/coeff, dates, promo). |
| **Parc véhicule** : recherche par état (stock/vendu/réparé/dépôt agent/rétrocession), historique chrono par VIN | **M3 `vehicles`** | États du parc + historique mouvements (vente/réparation/cession interne/reprise) par VIN ; mise en/annulation dépôt agent ; export Excel. |
| **Achat occasion / dépôt-vente / commission** | **M7 `tradein`** | Flux 3-onglets, fiche reprise/dépôt, prix mini réserve, calcul commission, Retour client vs Suppression. |
| **Réception** (en-tête, lignes, casier, étiquettes, **réception châssis**, régimes TVA, échéances) | **M4 `purchases`** | Écran réception + sous-écran châssis créant fiche véhicule + entrée stock ; régimes TVA C.E.E. ; échéancier ; import code-barre/microfiches ; rapprochement commande. |
| **Fournisseurs** : code interne magasin, **RFA**, suppression protégée | **M4** | Champ code interne (rattache MO/reprise) ; saisie RFA → stats/marge. |

> **Constat global** : nos fiches portent déjà les **champs** ; l'écart résiduel est **fonctionnel** — moteurs interactifs (prix/arrondis/cascade), actions de masse, **transfert de référence**, équivalences, librairie, états/historique du parc, et le sous-écran **réception châssis → fiche véhicule**. Tout cela s'aligne sur les invariants B1/B4/B5/B7 déjà posés.
