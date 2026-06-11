# G8 / Futurosoft — Fonctionnalités & parcours (M0 Paramètres · M12 Compta/exports · M13 Reporting/stats)

> Extraction des manuels G8 (PDF scannés, OCR visuel). Objectif : recenser **toutes** les
> fonctionnalités et parcours utilisateur à retrouver dans notre DMS, indépendamment de l'UI.
> Sources lues (dossier `Info Doc/`) :
> - `Compta G8.pdf` (26 p.) — module Compta : gestion des comptes, paramétrage transfert, lancement transfert, clôture.
> - `Paramètres2 G8.pdf` (40 p.) — paramétrage système/station + 19 tables de données (référentiels M0).
> - `Statistiques2 G8 2020.pdf` (11 p.) — module statistiques (filtres, classement, résultats).
> - `Gestion des LCR et traites2 G8.pdf` (15 p.) — effets de commerce : LCR/traites, immédiat/différé, impayés, magnétique.
> - `Annuler ou modifier règlements G8.pdf` (5 p.) — annulation/modification de règlements (avant/après transfert compta).
> - `Cloture fin exercice G8.pdf` (7 p.) — clôture de fin d'exercice, contrôles à éditer avant clôture.
> - `Editions Mettre en place des CGV G8.pdf` (1 p.) — CGV recto/verso sur documents.
>
> Note : ces docs sont G8 « mono-société » France. **Chez nous tout est multi-société** (ITALBIKE / NL INVEST),
> Belgique (TVA 21 %, Peppol/UBL), donc chaque écran ci-dessous porte un `company_id` et des séquences par société.

---

# 1. Fonctionnalités (checklist)

## 1.1 Comptabilité & exports (M12)

### Gestion des comptes comptables (`Compta → Gestion des Comptes`)
Écran à 9 onglets latéraux, chacun mappe une famille d'objets G8 vers des comptes du plan comptable :

- [ ] **Comptes clients** — code client → compte auxiliaire + intitulé + compte collectif. 2 colonnes (compte auxiliaire + intitulé). Bouton **Création automatique** (génère les comptes auxiliaires clients), **Mettre à jour clients**, **Récupérer depuis client**, **Supprimer lignes**, **Éditer liste**. Le compte client peut aussi être reporté dans la fiche client.
- [ ] **Comptes fournisseurs** — idem clients (compte auxiliaire + collectif), création automatique.
- [ ] **Comptes ventes** — relation entre codification produits (Rayon / Sous-rayon / Catégorie) et comptes de vente. Par ligne : **Type produit**, **Taux** (TVA : permet de distinguer les ventes par taux, ex. 20 % vs 5,5 % → chez nous 21 % / 6 % / 0 %), **Compte Général**, **Compte Détaxe** (ventes export = même compte mais N° de compte différent → correspondance détaxe), **Compte Rétrocession** (imputation comptes de vente en rétrocession), **N° de compte** modifiable par port (P1=oui / P2=non, gestion par poste). Compte d'achat possible pour rayon Reprise/Occasions. FRAIS (référence produit particulière) = imputer sur un compte différent selon le rayon.
- [ ] **Comptes achats** — relation codification produits réceptionnés ↔ comptes d'achat (mêmes colonnes : type produit, taux TVA, compte général, compte détaxe, N° par port P1/P2).
- [ ] **Comptes cessions** — compte de cession différent par Rayon / Sous-rayon / Catégorie. Les cessions internes = opérations extracomptables permettant la **compta analytique** ; comptes en classe 8 ou 9.
- [ ] **Comptes TVA** — par ligne : **Taux TVA**, **Compte Général** (N° compte correspondant au libellé), **Compte TVA achat** (N° compte TVA déductible/achats), **Compte TVA collectée** (vente). **Compte occasion** (TVA différente pour les VO → TVA marge). Possibilité de taux TVA nul (0 %). Bouton **Valider**.
- [ ] **Comptes règlements** — par code règlement (1 Espèces, 2 Chèque, 3 Carte bancaire, 4 Virement, 5 Prélèvement, 6 Carte cadeau, 8 Fidélité, XX Garantie…) : colonnes **Code RGT**, **Département**, **Compte**, **Journal** (code + libellé). Mappe chaque mode de règlement vers compte de trésorerie + journal.
- [ ] **Comptes Mvt fond de caisse** — par type de mouvement de caisse : **Code mouvement**, **Département**, **Compte mouvement**, **Journal**, **Taux de TVA** (+ N° compte TVA). Gère les entrées/sorties d'espèces de caisse.

### Paramétrage du transfert comptable (`Paramétrage transfert`)
Onglets : **Général · Ventes · Règlements · Achats · Cessions · Dépôts ventes · TVA occasion**.

- [ ] **Général** :
  - [ ] **Type de comptabilité** (liste de logiciels cibles : Ciel, EBP Compta, CIVERS… ; bouton + pour ajouter/modifier un type de compta) — le format d'export diffère selon le logiciel choisi.
  - [ ] **Répertoire cible**, **Fichier écritures cible** (ex. `ECRITURES.CSV`), **Fichier comptes cible** (ex. `COMPTES.CSV`) — nom + emplacement des fichiers générés.
  - [ ] **Mode de transfert** : *De date à date* (sélection de période) **ou** *Par numéro de facture* (saisie d'une plage de numéros).
  - [ ] **Mode d'écriture** : *Écriture facture par facture* (une écriture par facture) **ou** *Écriture semi-globale* (toutes factures regroupées sur compte client par défaut — empêche le lettrage auto, ↓ nombre d'écritures).
  - [ ] Option **Transfert par département**.
- [ ] **Ventes** : Compte client par défaut, Compte général par défaut, Compte rétrocession par défaut, Intitulé client par défaut (auto si compte absent), Compte vente par défaut, Journal des ventes par défaut (ex. VT), Compte TVA par défaut, **Compte Ecotaxe DEEE** (N° compte écotaxe).
- [ ] **Règlements** : case **Transfert des règlements** (génère les écritures de règlement : règlements clients, acomptes sur réservation, mouvements de fond de caisse). **Journal de règlement par défaut**, **Compte règlement par défaut**.
- [ ] **Achats** : case **Transfert des achats** (génère écritures liées aux réceptions). Compte fournisseur par défaut, Compte général par défaut, Intitulé fournisseur par défaut, Compte achat par défaut, Journal des achats par défaut (ex. AC), Compte TVA achats par défaut, **Compte TVA Intracom dûe** (achats intracommunautaires).
- [ ] **Cessions** : case **Transfert des cessions internes**, **Journal des cessions par défaut**, **Compte de cession par défaut** (compte extracomptable).
- [ ] **Dépôts ventes** : case **Transfert des dépôts ventes** (écritures liées aux ventes de dépôt-vente).
- [ ] **TVA occasion** : compte extracomptable de récupération de la **marge dégagée à la vente d'un véhicule d'occasion** — base de calcul de la **TVA marge** (B2).

### Lancement du transfert (`Lancement transfert`)
- [ ] Saisie période (date à date) **ou** plage de factures, selon paramétrage.
- [ ] Bouton **Valider** → écran de **contrôle/prévisualisation** des écritures avant transfert (suivi du déroulement).
- [ ] Génère les **fichiers d'écritures** à importer dans le logiciel de comptabilité externe.

### Effets de commerce — LCR / Traites (M12, lié M6)
- [ ] **Paramétrage Conditions de règlement** (`Paramétrage → Table de données → Conditions de règlement`) : pour calculer les dates d'échéance et imprimer les LCR. Champs : Code condition, Libellé, Quantième (lettre A–Z pour tri/classement), **Date d'échéance** sélectionnable (Comptant, 15/20/30/45/60/90/120/150/180 jours), **Jour du règlement** (ex. 10, 5…), **Règlement Fin de mois** (O/N), **Géré en édition LCR** (O/N — précise si la condition génère une LCR/traite).
- [ ] **Paramétrage Mode de règlement LCR** (`Table de données → Mode de règlement`) : créer un mode de règlement « LCR » avec libellé, Visible en caisse (Oui/Non).
- [ ] **Paramétrage Entête remises en banque** (`Table de données → Entête remises en banque`) : table des IBAN/BIC des comptes bancaires de la société (édition des remises de chèques + disquette LCR).
- [ ] **Affectation conditions de règlement sur fiche client** : Domiciliation, BIC/SWIFT, IBAN, Identification TVA (Vente intracommunautaire / Vente à l'exportation), Code affacturage. Date d'échéance de la facture calculée auto selon ces conditions.
- [ ] **LCR immédiate** (à la facturation) : mode règlement LCR + date d'échéance saisis directement sur la facture ; édition d'une traite papier unitaire.
- [ ] **LCR différée** (`Facturation → Encaissement → gestion des LCR et traites`) : génération groupée pour plusieurs factures d'un ou plusieurs clients ; sélection **banque** (parmi entêtes remises), critères de sélection cumulables : **Période de date d'échéance**, **Client**, **Tranche de date d'échéance**, **Type de LCR à générer** (Code entrée : Encaissement après échéance / Escompte / Escompte val / Encaissement après échéance dispo / Encaissement val dispo), **Code daily** (cession de créance ou « pas d'indication »). Tableau des échéances avec **case à décocher par ligne** (exclure des factures).
- [ ] **Contrôle coordonnées bancaires** : G8 vérifie IBAN/BIC client, alerte si incomplet, saisie manuelle possible dans le tableau (non sauvegardée sur la fiche).
- [ ] **Imprimer les traites** (LCR papier à faire signer, cas LCR non acceptées) — question « Solder les factures sélectionnées ? » répondre **Non** (les échéances seraient supprimées).
- [ ] **LCR magnétiques** : génération d'un **fichier** (nom + emplacement à choisir) destiné à être importé/transféré à la banque ; option de solder les factures concernées + apparition en relances clients.
- [ ] **Récapitulatif** des traites imprimées (affichage + impression).
- [ ] **Impayés LCR** (`Facturation → Utilitaires factures → Liste des factures`) : remise de la facture en dû. Sélectionner la facture impayée → modifier le mode de règlement LCR en **négatif** → Valider. G8 propose de **conserver les conditions de règlement initiales** (Oui = régénérer une nouvelle traite ; Non = autre mode de règlement). La facture revient « non payée » → régénérer une LCR **ou** encaisser dans un autre mode.

### Annulation / modification de règlements (M12, lié M6)
- [ ] **Annuler un règlement non transféré en compta** (`Facturation → Utilitaire facture → Liste des factures`) : choisir la facture (par n° ou par client) → bouton **Règlement** → l'annulation est passée en **négatif** à la date du jour.
- [ ] **Modifier un règlement non transféré** : même chemin → corriger le carré du bas (montant/mode) → valider ; passé en négatif pour annuler celui d'origine.
- [ ] **Modifier/annuler un règlement déjà transféré en compta ou remis en banque** : pas d'annulation manuelle directe ; **saisir un règlement en négatif** (remboursement client + annulation du règlement) puis ré-imputer/régulariser. Conditions de règlement reproposées.

### Clôture de fin d'exercice (M12)
- [ ] **Sauvegarde préalable** (base de données) — locale (poste/clé USB) ou en ligne (serveurs), option « inclure les index ».
- [ ] **Vérification de la date de fin d'exercice** (`Param → Paramètre G8 → Système`).
- [ ] **Recommandations avant clôture** (`Compta → Cloture exercice`, bas de page) : effectuer le transfert comptable **avant** la clôture si vente expresse + règlement transféré sur compte client ; l'inventaire est indépendant de la clôture ; possibilité d'accéder ensuite aux statistiques.
- [ ] **Documents/éditions à sortir avant clôture** (factures à échéance, chèques, LCR sont supprimés à la clôture) :
  - [ ] **Liste des clients débiteurs/créditeurs** (`Facturation → Encaissements → Liste des clients débiteurs`) — choix client, sélection d'échéances, période.
  - [ ] **Liste des acomptes en cours** (`Facturation → Documents clients`, filtre Acomptes en cours).
  - [ ] **Liste des chèques à échéance** (`Facturation → Encaissements → Gestion des chèques à échéance → Liste des chèques à échéance`) — période d'échéance, impression ou export fichier.
- [ ] **Lancement de la clôture** (`Compta → Cloture exercice`) : période Du/au, **Suivi des traitements** par poste de données (Ventes, Produits vendus, Règlements, Ventilations TVA, Achats, Produits achetés, Châssis réceptionnés + leurs archives) avec colonnes **Sauvegarde / Archivage / Réintégration / Compactage**. Vérifier que tous les G8 sont fermés. Bouton **Clôturer** → archive les documents de l'exercice précédent.
- [ ] **Erreurs de clôture** : ne pas relancer, contacter le support.

### CGV & mentions légales (M9/M0, lié M12)
- [ ] **CGV recto/verso sur documents** (`Paramètre → Système → Édition`) : associer un document **PDF ou Word** comme conditions générales de vente, imprimé au dos des documents (factures…). Vérifier que l'imprimante gère le recto/verso. Champ « chemin du document ».

## 1.2 Statistiques / Reporting (M13)

### Activation
- [ ] Activation du module statistiques moderne via `Param système` (case « Module statistique beta »). Apports : personnalisation des niveaux de classement, **histogramme interactif**, **diagramme interactif**, mémorisation des sélections, interactivité tableau↔histogramme↔diagramme, **4 niveaux de classement**.

### Écran 3 zones : A Filtres · B Classement & Options · C Résultats

- [ ] **A. Filtres** (cumulables) :
  - [ ] **Par famille** : Rayon / Sous-rayon / Catégorie.
  - [ ] **Par article** : Fournisseur, Marque, Désignation article, Code casier.
  - [ ] **Par client** : Client, Catégorie client, Département géographique, Tarif client.
  - [ ] **Par autre** : Opérateur, Type de cession interne.
  - [ ] **Par date** : période + **périodes prédéfinies** (mois en cours, année en cours, année flottante, hier, semaine en cours/précédente, mois précédent, exercice en cours/précédent…).
  - [ ] **Présélection enregistrée** : nommer + bouton « + » pour sauvegarder un ensemble de filtres, réutilisable via menu déroulant.
- [ ] **B. Classement** : jusqu'à **4 niveaux** parmi : Catégorie client, Catégorie (famille), Client, Département client, Fournisseur, Marque, Mensuel (mois par mois), Nomenclature, Opérateur, Rayon, Sous-rayon, Tarif client, Type de cession (~30 000 combinaisons). Statistiques détaillées en plus (détails article).
- [ ] **B. Options** (6, chacune Inclus / Exclus / Uniquement) : **Rétrocessions, O.R., Temps facturé, Reprises, Véhicules, Nomenclature**.
- [ ] **C. Résultats** — 8 onglets :
  - [ ] **Ventes** : tableau (période sélectionnée) ; **Exercice comparé** (N-1, N-2) ; **Histogramme** ; **Histogramme comparé** ; **Diagramme circulaire** (camembert).
  - [ ] **Meilleures ventes** : par quantité vendue ou par marge ; info à afficher sélectionnable.
  - [ ] **Remise** : remises faites par période (montant et/ou pourcentage), nb de factures concernées.
  - [ ] **Achats** : quantité d'articles réceptionnés, montant d'achat, poids/rapport à la sélection, nb de réceptions ; histogramme/diagramme.
  - [ ] **Tableau de bord mois par mois** : Quantités Entrées/Sorties (colonnes E/S, total annuel + valeur de stock) ; Quantités comparées (rotation de stock) ; CA mois/mois + total annuel ; Marge mois/mois + total annuel.
  - [ ] **Cessions internes** : par cession (cession VN, cession VO…) avec valorisation au PV HT et au PAMP.
  - [ ] **Documents en cours** : Proforma, Réservations, Ordres de réparation, Livraisons ; affichage tableau (CA HT + marge), histogramme (Marge + CA HT), diagramme circulaire.
  - [ ] **Indicateurs** : tableau récap des documents créés / en cours / transformés, avec CA HT, **panier moyen**, **nb d'articles par document**, taux de transformation (réception, cession interne, réservation, réparation, proforma → facture).
- [ ] **Astuces** : recherches partielles dans la recherche article — `ABC`=égal, `ABC%`=commence par, `%ABC%`=contient, `%ABC`=finit par, `ABC;EFG`=égal à ABC ou EFG (infobulle au survol).

## 1.3 Paramètres (M0)

### Paramétrage système / station (6 catégories : Caisse, Éditions, Étiquetage, Département, Imprimantes, Lecteurs code-barres)

- [ ] **Caisse** :
  - [ ] **Mode de facturation HT / TTC** (saisie en HT ou TTC ; inversion = recréer la facture).
  - [ ] **Avertissement si stock nul en caisse** / **interdire la vente si stock nul**.
  - [ ] **Saisie du stock autorisé en fiche article**.
  - [ ] **Affichage coefficient (Poids)** en caisse.
  - [ ] **Retour à la ligne après lecture code-barres**.
  - [ ] **Contrôle de la saisie du numéro de châssis** (nb de caractères).
  - [ ] **Numéro de réception** : activer N° à la validation (avec/sans édition) ou désactiver.
  - [ ] **Opérateur par défaut** (fixe pour toutes les commandes, sinon demandé à chaque saisie).
  - [ ] **Tiroir-caisse** (connecté ou non).
  - [ ] **Caisse** : créer/affecter plusieurs caisses (1 poste = 1 caisse).
  - [ ] **Activer fonctions rétrocessions sur le poste**.
  - [ ] **Poste de facturation ou d'encaissement** : Facturation+encaissement / Facturation uniquement / Encaissement uniquement.
  - [ ] **Afficher la sélection des magasins** (voir autres magasins de la société).
- [ ] **Éditions** (paramétrage des documents imprimés) :
  - [ ] Nombre d'exemplaires par défaut (par document).
  - [ ] Entête + logo image (gauche de l'édition des factures).
  - [ ] Entête sur édition ticket.
  - [ ] Type d'imprimante ticket.
  - [ ] Éditions des documents appros avec/sans référence fournisseur ; édition des codes casiers en réception.
  - [ ] Éditions des **O.R. non chiffrés** (sans prix) ; **O.R. sans nom du client**.
  - [ ] Éditions des **devis/proforma sans référence** (figurer désignation, pas la référence produit).
  - [ ] Éditions des **fiches de reprise et dépôts vente** sans références.
  - [ ] Éditions des **Inserts commandes** (info stock + dispo de l'article).
  - [ ] Éditions des **factures sans prix** ; **bons de livraisons chiffrés** (prix unitaires).
  - [ ] Éditions des **documents appros chiffrés** (prix d'achat).
  - [ ] **Texte en pied de facture** (Créer/modifier texte, Rappel texte mémorisé).
  - [ ] **Impression fiche de travail** : Complète si éléments cochés / Partielle / Complète même si pas d'éléments cochés / Seule si éléments cochés / Seule même si pas cochés / Partielle seule si éléments cochés / Ne pas imprimer de fiche de travail.
- [ ] **Étiquetage / afficheur** : imprimante + format d'étiquette par défaut, devises, **personnalisation du format d'étiquette** (nb d'étiquettes, hauteur/largeur, espaces, code-barres, prix…).
- [ ] **Département** : département par défaut, afficher tous les départements en régularisation/liste des clients débiteurs, imprimer documents clients avec image rattachée au département / avec la raison sociale rattachée.
- [ ] **Imprimantes dédiées** : choisir une imprimante différente par type de document (étiquettes, factures, réservations, livraisons, proforma, OR, appros…), par poste.
- [ ] **Lecteur code-barres** : type de lecteur (F951/FCC8000, Datalogic, Cipher, Voyager, Symbol, Honeywell, Application « Newland »…), port de connexion, **Mode TSE**.
- [ ] **Microfiches** : import des microfiches (tarifs/catalogues) depuis logiciels microfiches.
- [ ] **Intranet fournisseur** (`Serveurs de commande`) : table des serveurs de commande constructeurs pour automatiser le transfert des commandes par modem — AIXAM, APRILIA, B2B, BMW ATLAS/PIX, BRP BOSSWeb, DERBI, **DUCATI Arco by Software, DUCATI DCS, DUCATI DCS (Excel)**… Champs : Fichier exporté, Code client, Code abonné, Mot de passe, Fournisseur, Nom fournisseur, Chemin+nom du fichier exporté, Préfixe à ignorer, bouton « Créer format personnalisé ». **(Chez nous : DCS fermé → export Excel imposé, ACH001.)**
- [ ] **Paramètre de connexion** : serveur SMTP/email pour envoi de mail via G8 (login, mot de passe, serveur IP, port).
- [ ] **Gestion des chronos** (`Gestion des numéros de chrono`) : compteurs/numérotation par type de document — **Documents clients** (n° facture, devis, réservation, OR), **Documents achats** (réception, transfert, commande, demande magasin), **Chronos divers** (n° client, fournisseur), **Chronos atelier** (carte grise, dépôt vente, n° clé moto), **Documents compta**, **châssis** (n° de série). ⚠ modification dangereuse. **(Chez nous = écran M0 « Numérotation des documents », par société, préfixes/format/RAZ annuelle configurables.)**
- [ ] **Droits d'accès** (RBAC) : login + mot de passe admin → liste des utilisateurs G8 → par utilisateur, **arbre des opérations** (case à cocher par traitement, ex. interdire « Consultation des ventes »). Message bloquant « Vos droits d'accès ne permettent pas l'utilisation de cette fonction ». **(Chez nous = rôles M0 + RLS Supabase.)**

### Tables de données (référentiels — 19 tables)
Liste complète de l'écran `Tables de données` :
- [ ] **Taux de TVA** : code + libellé par taux. **(Chez nous : 21 % / 6 % / 0 % export + régime marge.)**
- [ ] **Modes de règlement** : code, libellé, compte règlement, journal règlement, Visible en caisse (O/N) ; options LCR fichier CFCN / Traites papier / Prélèvements SEPA. **Création** (Nouveau+), **Modification** (le code ne change pas), **Suppression** (impossible si déjà utilisé).
- [ ] **Conditions de règlement** : (voir LCR §1.1) Libellé, Code identifiant, Quantième, Date d'échéance, Jour du règlement, Règlement fin de mois, Géré en édition LCR.
- [ ] **Entête remises en banque** : IBAN des comptes bancaires (édition remises de chèques + LCR).
- [ ] **Mouvement fond de caisse** : types de mouvements de caisse → code, libellé, compte général/auxiliaire, journal, taux de TVA, compte TVA.
- [ ] **Opérateurs cessions** : types de cessions internes (cession VN démo, cadeau, fournitures atelier, garantie…) → code, libellé, options (cession concerne, hors gestion de stock, prend en compte le stock…). Utilisée par `Atelier → Cession interne O.R.O.` et la garantie.
- [ ] **Catégorie client** : classement clients ; code profession (obligatoire si activé). Codes >50 ou libellé commençant par « AGENT » = rôle particulier.
- [ ] **Types de réparations** : code + libellé (ex. ATELIER VELO) ; affectés aux OR et imprimés dessus.
- [ ] **Civilités clients** : titres (Monsieur, Madame…) ; saisie obligatoire option.
- [ ] **Marques** : code marque, libellé, type (PIAGGIO, HONDA, YAM…) ; simplifie la saisie des n° de série multi-marques (facturation, OR, bon de réception).
- [ ] **Opérations atelier** : ~42 opérations courantes (cases à cocher en OR) — vidange/échange, courroie de transmission, freinage, embrayage, pneus, direction, éclairage…
- [ ] **Organisme de financement** : sociétés de crédit (Nouveau+).
- [ ] **Cabinets d'assurances** : nom, ville, téléphone, fax, email (Nouveau+).
- [ ] **Experts Assurance** : table des experts.
- [ ] **Couleurs** : codes couleur des articles.
- [ ] **Tailles** : tailles des articles (vêtements/équipements).
- [ ] **Nature Produit fini** : préfénir la nature des produits finis (véhicules) → Numéro de série, Référence, Marque, Modèle, Immatriculation, Numéro de fiche, Genre, **Cylindrée, Puissance en Kw, Énergie, Norme antipollution, Code antipollution, N° de police** (sur édition / affichage de prix). Plusieurs natures de produit fini possibles.
- [ ] **Tâche atelier (Travaux hors facturation)** : tâches improductives (productivité atelier B11).
- [ ] **Catégorie de produit fini** : classement des véhicules.
- [ ] **Code exposition** : statut/emplacement d'exposition.
- [ ] **Pays** : pré-enregistrement des pays (France par défaut + pays hors France) ; code, libellé, nom, pays par défaut.

---

# 2. Parcours utilisateur (flux clés, étape par étape)

## 2.1 Paramétrer les comptes comptables (pré-requis transfert)
1. `Compta → Gestion des Comptes`.
2. Onglet **Comptes clients** → **Création automatique** (génère les auxiliaires) ou saisie manuelle ; renseigner intitulé + collectif.
3. Onglets **Ventes** / **Achats** : pour chaque Rayon/Sous-rayon/Catégorie + taux de TVA, saisir compte général, compte détaxe, compte rétrocession.
4. Onglet **TVA** : par taux, saisir compte général + compte TVA achat (déductible) + compte TVA collectée + compte occasion (marge).
5. Onglet **Règlements** : pour chaque code règlement, saisir département, compte, journal.
6. Onglet **Mvt fond de caisse** : par type de mouvement, compte + journal + TVA.
7. Pré-requis : avoir paramétré le type de compta dans `Param système → onglet Compta`.

## 2.2 Lancer un transfert comptable (export vers compta)
1. `Paramétrage transfert` → onglet **Général** : choisir type de compta, répertoire/fichiers cible, mode (date à date / par n° facture), mode d'écriture (facture par facture / semi-globale).
2. Cocher les transferts voulus dans **Règlements / Achats / Cessions / Dépôts ventes** + renseigner journaux/comptes par défaut + TVA occasion.
3. `Lancement transfert` → saisir période **ou** plage de factures.
4. **Valider** → écran de contrôle/prévisualisation des écritures.
5. Vérifier le déroulement → fichiers `ECRITURES.CSV` / `COMPTES.CSV` générés.
6. Importer les fichiers dans le logiciel de compta externe.

## 2.3 Éditer une liste de ventes / un journal (avant clôture)
1. `Facturation → Encaissements → Liste des clients débiteurs` (ou `→ Gestion des chèques à échéance → Liste des chèques à échéance`).
2. Choisir client / période d'échéance / plage de dates.
3. Imprimer ou exporter en fichier.
4. (Acomptes : `Facturation → Documents clients`, filtre **Acomptes en cours**, bouton **Liste**.)

## 2.4 Lettrage / imputation d'un paiement
- Le **lettrage automatique** dépend du mode d'écriture : *facture par facture* → lettrage possible ; *semi-globale* → lettrage auto empêché (factures regroupées sur compte client par défaut).
- Le règlement est imputé au compte de trésorerie + journal du **mode de règlement** (table Comptes règlements) ; les acomptes/réservations génèrent leurs propres écritures si « Transfert des règlements » est coché.

## 2.5 Gérer une LCR / traite
**Différé (groupé) :**
1. Affecter conditions de règlement + RIB/IBAN sur la **fiche client** (ou à la facture si non défini).
2. `Facturation → Encaissement → gestion des LCR et traites`.
3. Choisir la **banque** (entête remise), puis critères de sélection (période d'échéance, client, tranche, type de LCR, code daily).
4. Décocher les échéances à exclure dans le tableau ; G8 contrôle les coordonnées bancaires (alerte si incomplet).
5. **Imprimer les traites** (papier à signer) → répondre **Non** à « solder les factures ? » ; **ou** **LCR magnétiques** → choisir nom/emplacement du fichier → importer à la banque.
6. Récapitulatif des traites (Oui pour afficher/imprimer).

**Immédiat :** saisir mode de règlement LCR + date d'échéance directement sur la facture → traite éditée unitairement à la validation.

**Impayé :** `Facturation → Utilitaires factures → Liste des factures` → sélectionner la facture → passer le mode LCR en **négatif** → Valider → conserver conditions initiales (Oui = régénérer, Non = autre mode) → la facture revient en dû.

## 2.6 Annuler / modifier un règlement
1. `Facturation → Utilitaire facture → Liste des factures` → choisir la facture (par n° ou client) → bouton **Règlement**.
2. **Non transféré** : modifier le carré du bas (montant/mode) et valider, **ou** annuler → passage en **négatif** à la date du jour.
3. **Déjà transféré / remis en banque** : pas d'annulation directe → saisir un **règlement en négatif** (remboursement + annulation) → réaffecter les conditions de règlement → régulariser (nouvelle échéance/encaissement).

## 2.7 Clôturer un exercice
1. **Sauvegarder** la base (`Param → Sauvegarder la base de données`, locale ou en ligne).
2. Vérifier la **date de fin d'exercice** (`Param → Paramètre G8 → Système`).
3. **Avant la clôture** : effectuer le transfert comptable ; éditer listes clients débiteurs/créditeurs, acomptes en cours, chèques à échéance, LCR (supprimés à la clôture).
4. **Fermer tous les postes G8.**
5. `Compta → Cloture exercice` → période Du/au → vérifier le **Suivi des traitements** (Sauvegarde / Archivage / Réintégration / Compactage par poste de données) → **Clôturer**.
6. En cas d'erreur : ne pas relancer, contacter le support.

## 2.8 Sortir une statistique de marge
1. Module **Statistiques**.
2. **A. Filtres** : période (ou période prédéfinie) + filtres voulus (famille/article/client/opérateur).
3. **B. Classement** : choisir jusqu'à 4 niveaux (ex. Marque → Catégorie → Article) + Options (Inclure/Exclure/Uniquement : OR, Reprises, Véhicules…).
4. **C. Résultats** → onglet **Meilleures ventes** (tri par marge) ou **Tableau de bord mois par mois** (colonne Marge mois/mois + total annuel) ou **Ventes** (+ Exercice comparé N-1/N-2).
5. Visualiser tableau / histogramme / diagramme circulaire (interactifs).
6. Optionnel : nommer + « + » pour **enregistrer la présélection** de filtres.

## 2.9 Mettre en place les CGV
1. `Paramètre → Système → Édition`.
2. Champ « chemin du document » → sélectionner le **PDF ou Word** des CGV.
3. Vérifier que l'imprimante imprime en **recto/verso** (CGV au verso des documents).

---

# 3. Règles métier & options

## 3.1 TVA & régimes
- **Comptes de TVA par taux** : achat (déductible) ≠ collectée (vente) ; **compte occasion** distinct pour la **TVA marge** (B2). Taux nul (0 %) possible (export/détaxe).
- **Détaxe** : compte de vente détaxe = même rayon mais N° de compte différent (correspondance détaxe), géré par la TVA 0 % export.
- **Achats intracommunautaires** : compte **TVA Intracom dûe** dédié.
- **TVA occasion** : compte extracomptable de récupération de la marge VO = base de calcul de la TVA marge à la revente.
- **Écotaxe DEEE** : compte dédié.
- **Belgique (chez nous)** : 21 % / 6 % / 0 % + régime marge VO (type O) ; type P = 21 % standard.

## 3.2 Paramètres globaux du transfert comptable
- **Type de comptabilité** (logiciel cible) conditionne le format des fichiers exportés (extensible).
- **Mode d'écriture** : *facture par facture* (lettrage possible) vs *semi-globale* (regroupé sur compte client par défaut, lettrage auto impossible, moins d'écritures).
- **Mode de transfert** : de date à date vs par n° de facture.
- Cases d'activation par flux : règlements, achats, cessions internes, dépôts ventes.
- Comptes & journaux **par défaut** par flux (utilisés si le compte précis manque) — ventes (VT), achats (AC), règlements, cessions.
- Transfert par département possible.

## 3.3 Comptes comptables (mappings)
- Comptes **clients/fournisseurs** : auxiliaires (génération automatique) + collectif ; reportables sur la fiche.
- Comptes **ventes/achats** mappés par **Rayon / Sous-rayon / Catégorie × taux de TVA** ; compte détaxe + compte rétrocession ; N° de compte modulable par poste (P1/P2).
- Compte d'achat pour rayon **Reprise/Occasions** ; référence **FRAIS** imputable sur compte distinct.
- Comptes **cessions** en classe 8/9 (compta analytique extracomptable).
- Comptes **règlements** & **mouvements de fond de caisse** : compte + journal (+ TVA pour les mouvements de caisse).

## 3.4 Conditions de règlement / échéances (LCR)
- Date d'échéance : Comptant, 15/20/30/45/60/90/120/150/180 jours ; Jour du règlement ; Fin de mois (O/N) ; Quantième (A–Z pour tri) ; **Géré en édition LCR** (O/N).
- Calcul auto de la date d'échéance facture depuis les conditions de la fiche client.
- LCR papier (à signer, non acceptées) vs **magnétique** (fichier banque) ; cession de créance (code daily) ; types d'encaissement (escompte, après échéance…).
- Coordonnées bancaires (IBAN/BIC) contrôlées ; saisie manuelle temporaire possible (non persistée).

## 3.5 Caisse / facturation
- Saisie HT ou TTC (verrou : recréer la facture pour changer).
- Blocage / avertissement vente si stock nul ; saisie du stock autorisée en fiche article.
- Poste typé : facturation+encaissement / facturation seule / encaissement seul ; multi-caisses (1 caisse/poste) ; tiroir-caisse ; opérateur fixe ou demandé.
- Contrôle du nb de caractères du n° de châssis (cohérent avec VIN 17 car.).
- N° de réception à la validation (avec/sans édition) ou désactivé.

## 3.6 Numérotation (chronos)
- Compteurs par type de document : clients (facture, devis, réservation, OR), achats (réception, transfert, commande, demande magasin), divers (n° client, fournisseur), atelier (carte grise, dépôt-vente, clé moto), compta, châssis. Modification sensible. **(Chez nous : par société, préfixes/format/RAZ annuelle configurables — M0 « Numérotation des documents ».)**

## 3.7 Droits d'accès (RBAC)
- Par utilisateur, arbre des opérations en cases à cocher (autoriser/interdire chaque traitement) ; message bloquant si non autorisé. **(Chez nous : rôles M0 `admin, vendeur, magasinier, mecanicien, chef_atelier, comptable, marketing` + RLS.)**

## 3.8 Statistiques
- Jusqu'à 4 niveaux de classement (~30 000 combinaisons) ; 6 options Inclure/Exclure/Uniquement (Rétrocessions, OR, Temps facturé, Reprises, Véhicules, Nomenclature).
- Périodes prédéfinies + comparaison N-1/N-2 ; présélections de filtres enregistrables.
- Valorisation cessions internes au PV HT **et** au PAMP ; rotation de stock (E/S mois par mois).
- Recherches partielles (`%`, `;`) sur la désignation article.

---

# 4. Lien avec notre app (M0 / M12 / M13)

> Rappel CLAUDE.md §5 : **on construit nous-mêmes les flux compta/TVA** (marge VO, multi-société, UBL) selon les
> invariants ; **le comptable du client corrige après coup**. Donc tout doit être **paramétrable et auditable**
> (taux, régimes, comptes, journaux, registres exportables), jamais figé en dur.

**M12 — Comptabilité & exports.**
- Reconstruire le **mapping comptes** (clients, fournisseurs, ventes, achats, TVA, règlements, cessions, mouvements de caisse) en tables paramétrables `company_id` + RLS ; génération auto des auxiliaires. Mapping ventes/achats par Rayon/Sous-rayon/Catégorie × taux de TVA.
- Module **transfert/export comptable** paramétrable : format cible (au lieu de Ciel/EBP → **UBL/Peppol** + export CSV/journaux pour le comptable belge), mode date-à-date / par n° de pièce, écriture pièce-par-pièce vs semi-globale, comptes/journaux par défaut par flux, par société.
- **TVA** : régimes 21 % / 6 % / 0 % export + **TVA marge VO** (compte/registre dédié, B2) ; TVA intracom ; détaxe (PDV005). Tout en table, auditable.
- **Effets de commerce LCR/traites** : conditions de règlement + échéancier + génération papier/magnétique + impayés (remise en dû). Append-only sur les règlements (B7), pas d'UPDATE silencieux.
- **Annulation/modification de règlements** : jamais d'UPDATE destructif → contre-passation en **négatif** + trace `events` (qui/quoi/quand/ancien-nouveau/origine, B7). Distinguer « avant/après transfert ».
- **Clôture d'exercice** : sauvegarde + archivage + suivi des traitements par poste de données, par société ; éditions pré-clôture (débiteurs, acomptes, chèques/LCR à échéance) exportables.

**M13 — Reporting / statistiques.**
- Reproduire l'écran 3 zones (Filtres / Classement 4 niveaux / Résultats 8 onglets) : Ventes (+comparé N-1/N-2), Meilleures ventes (qté/marge), Remises, Achats, Tableau de bord mois/mois (E-S, rotation, CA, marge), Cessions internes (PV HT & PAMP), Documents en cours (proforma/réservation/OR/livraison), Indicateurs (panier moyen, taux de transformation).
- Filtres par famille/article/client/opérateur/cession + périodes prédéfinies + présélections enregistrables ; recherches partielles `%`/`;`.
- Marges suivies **sur PA et PAMP** (B5) ; respecter charte §9 (pas de camemberts multicolores → adapter les diagrammes circulaires de G8).

**M0 — Paramètres.**
- Écran **Numérotation des documents** (= chronos G8) par société, préfixes/format/RAZ/aperçu live (déjà exigé §4.3).
- **Tables de données / référentiels** à recréer : taux TVA, modes de règlement, conditions de règlement, entêtes remises bancaires, mouvements fond de caisse, opérateurs cessions, catégories client, types de réparation, civilités, marques, opérations atelier, organismes de financement, cabinets/experts assurance, couleurs, tailles, nature/catégorie produit fini, tâches atelier, code exposition, pays — toutes `company_id` + RLS.
- **Droits d'accès** → rôles M0 + RLS (granularité par opération à conserver côté UI/permissions).
- **Paramètres caisse/éditions/imprimantes/lecteurs/étiquetage** : options de facturation (HT/TTC, blocage stock nul), modèles d'éditions (OR non chiffrés, factures sans prix, texte pied de facture), étiquettes personnalisables (B12), **CGV PDF/Word** sur documents.
- **Intranet fournisseur / DCS** : chez nous **export Excel imposé** (STANDARD/URGENTE, ACH001), pas d'API Ducati.
