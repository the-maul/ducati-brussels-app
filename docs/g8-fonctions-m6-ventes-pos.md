# G8 / Futurosoft — Fonctions M6 Ventes / Facturation / Caisse (POS) + Tarifs clients

> Reverse-engineering fonctionnel du module **Facturation** de G8 (185 p. de captures) + docs
> **Gestion des tarifs clients** (4 p.) et **Intégration tarif personnalisé** (7 p.).
> Objectif : retrouver **toutes** les fonctionnalités et parcours utilisateurs, pas l'UI.
> Les n° de page renvoient au PDF `Info Doc/Facturation G8.pdf` (sauf mention TAR = `Gestion tarifs clients 2023 G8.pdf`, INT = `Intégration tarif personnalisé G8.pdf`).
>
> **Vocabulaire G8 → notre glossaire** : « réservation/commande » = Réservation/Commande client ;
> « Pro forma/devis » = Devis ; « réparation » = OR ; « cession » = cession interne ; « Express » = vente comptoir POS ;
> « N° de série » = VIN ; « rappel d'un document » = recherche/ouverture.

---

# 1. M6 Ventes/POS — Fonctionnalités (checklist exhaustive)

## 1.1 Création de documents — les 6 types (écran « Nouveau document », p.12)
Une fenêtre à 2 parties : (gauche) **créer** un nouveau document client ; (droite) **rappeler/modifier** un document existant.
- [ ] **Express / Facture Express** — vente comptoir sans identification client (p.12-13)
- [ ] **Facture** — vente avec client identifié (p.41)
- [ ] **Réservation / Commande client** — réserver/commander un ou plusieurs articles ; gère le stock **disponible** (débité) sans toucher le **réel** (p.74)
- [ ] **Livraison (Bon de Livraison / B.L.)** — livrer du matériel à un client en compte ; facturable plus tard (p.80)
- [ ] **Pro forma / Devis** — devis (pièces, machines, réparations) ; **aucun impact stock** (p.81)
- [ ] **Réparation (O.R.)** — ordre de réparation atelier : réception → travaux → facture (p.76)

## 1.2 Saisie d'un document Express (POS) — fenêtre 4 parties (p.15)
- [ ] **Choix / saisie code opérateur** (n° ou sélection liste ; double-clic) au démarrage (p.13)
- [ ] Désactivation possible de la fonction Express (param. Système) (p.14)
- [ ] **Partie 1 — en-tête** : facture/document, type (HT/TTC), client express ou identifié
- [ ] **Partie 2 — tableau lignes** : référence, libellé, quantité, prix unitaire, remise, total ligne
- [ ] **Partie 3 — boutons fonctions avancées** (colonne droite)
- [ ] **Partie 4 — totaux temps réel** : ref. fournisseur, dispo stock, casier, PU HT, PU TTC, montant, remise, **Total HT / Total TVA / Total TTC / Reste à payer** (p.16, p.34)
- [ ] **Saisie d'une référence** : code alphabétique/numérique, article/pièce/machine/main d'œuvre ; tape début + ENTRÉE → liste si plusieurs ; flèches pour choisir (p.16-17)
- [ ] Message « Référence inconnue » si la réf n'existe pas (p.17)
- [ ] **Référence « * »** (petites pièces détachées / objets divers) : prix saisi à la volée, **coefficient majorateur** appliqué sur PV — `PV = (Prix_vente_HT × coef) + TVA` (p.18)
- [ ] **Référence Main d'œuvre (type T / réf « MO »)** : quantité = nb d'heures (0.5 = ½h, 0.25 = ¼h) ; alimente stats opérateurs (p.18-19)
- [ ] **Gestion du temps atelier** sur une ligne MO : opérateur, heures facturées/passées, date, heures garanties, code cession (p.19-20)

### Boutons « fonctions avancées » Express (p.21-38)
- [ ] **Ouverture tiroir** (poste équipé tiroir-caisse) (p.21)
- [ ] **Commentaire** : insérer/rappeler un commentaire libre sur une ligne/le document ; Valider / Mémoriser / Rappeler (texte réutilisable) (p.21-22)
- [ ] **Recherche article par Famille / Fournisseur** : navigation rayon → sous-rayon → catégorie → liste (p.22-25)
- [ ] **Garantie / Cession totale** : tout le document en cession (prix à 0, lettre « G ») — types de cessions configurables (Geste commercial, Garantie fournisseur, Garantie magasin…) (p.26-27)
- [ ] **Garantie / Cession article** : passer **une ligne** en garantie/cession (prix à 0) (p.27)
- [ ] **Prop. commande ligne** : mettre la réf de la ligne en proposition de commande — choix Stock / Dépannage / Garantie (p.27-28)
- [ ] **Prop. commande totale** : toutes les réfs du document en proposition de commande (p.28-29)
- [ ] **Article** : créer/modifier la fiche article à la volée ; visualiser l'**équivalence** (réf de remplacement) (p.29-30)
- [ ] **Opérateur** : changer l'opérateur du document (p.30)
- [ ] **Import code à barre** : lecteur portatif type Formula/data memor → injecte les réfs (p.30)
- [ ] **Import microfiches** : injecter réfs pièces sélectionnées depuis un logiciel microfiches (paramétrable, plusieurs logiciels) (p.30)
- [ ] **Insertion d'une ligne** (entre 2 lignes existantes) (p.30-31)
- [x] **Mode HT / TTC** : bascule la saisie/affichage — TVA/pro = HT, particulier = TTC (config départ) (p.31)
- [ ] **Encours article** : historique des opérations de l'article sélectionné (p.31)
- [ ] **Changement de type de document** : transformer en cours de saisie Express → Facture / Réservation / Livraison / Proforma / Réparation (p.31-32)
- [ ] **RAZ ligne** (vider une ligne) / **RAZ tout** (vider le document, confirmation) (p.33)
- [ ] **Info Stock** : disponibilité des articles saisis ; vues « Tous / Disponible / En commande / En proposition de commande / Indisponible » ; **Imprimer la liste** ; **Mettre en proposition de commande** une réf ou les indisponibles (p.33-37)
- [ ] **Stock distant** : disponibilité d'un article dans les **autres magasins** (stock réel/réservé/dispo par magasin) + **Demande Magasin** (p.37)
- [ ] **Accès au parc** : rechercher dans le parc véhicules/produits finis et ajouter au document (p.38)

### Validation & règlement Express (p.39-41, p.66-71)
- [ ] **Bouton Validation** → écran **Règlement** : récap vente, Total TTC, choix mode de règlement (p.39)
- [x] **Choix du mode de règlement** (flèches) ; revenir au tableau via ÉCHAP (p.39)
- [x] **Règlements multiples** : plusieurs modes pour une même facture (montant par mode) (p.39, p.68)
- [x] **Rendu de monnaie** : montant donné par le client → **monnaie à rendre** calculée (espèces) (p.40, p.71)
- [ ] **Choix du type d'édition** : Grand Format (A4) / Petit Format / **Ticket de caisse** / **Valider sans éditer** (p.40-41)

## 1.3 Facture avec client identifié — en plus de l'Express (p.41-73)
- [ ] **Sélection du client** dans la liste (par code ou nom) ; **Création nouveau client** à la volée (bouton Nouveau) (p.42-43)
- [ ] **Modification client** depuis le document (p.43, p.54)
- [ ] **Code tarification** : tarif/remise rattaché au client → appliqué automatiquement (empêche d'oublier le tarif) (p.44)
- [ ] **Conditions de règlement** : conditions par défaut du client, modifiables (échéances) (p.44)
- [ ] **Fonctions avancées client** (p.45-56) :
  - [ ] **Historique** : produits finis réparés / réservés / vendus au client (p.45, p.50)
  - [ ] **Adresse de facturation** (ajout adresses multiples) (p.45)
  - [ ] **Adresse de livraison** (liste, ajout/modif/suppr.) (p.45-46)
  - [ ] **Société de leasing / organisme de financement** (ajout/modif/suppr.) (p.46-47)
  - [ ] **Numéros de série / VIN** : à la vente d'un véhicule/machine, sélectionner ou créer le N° de série (lié à la fiche véhicule, types V/O/P) — saisie multiple, suivi historique (p.47-49)
  - [ ] **Prix de part** (n° de châssis affecté au produit) (p.50)
  - [x] **Frais de port** : montant HT, **Port taxé / Port non taxé**, taux & montant TVA sur port (p.52-54)
  - [x] **Détaxe** : inhibe la TVA (vente HT / export) — **uniquement en mode HT**, port à passer non taxé (p.54)
  - [ ] **Regroupement des bons de livraison** : facturer plusieurs B.L. d'un client en une facture (fin de mois) — Tout sélectionner / par client (p.55)
- [ ] **Références particulières en facture** : **REP (reprise d'occasion)** — créer véhicule/article occasion à la vente, n° auto (OCC-N°) ou VIN, écran « Reprise d'occasion » (Données véhicules) (p.57-64)
- [ ] **Reprises pour échange de pièce** : réf en négatif, valorise la pièce reprise au stock (p.65)

## 1.4 Pied de facture — remise & encaissement (p.66-71)
- [x] Écran **Pied de facture** : Total TTC, Net HT, TVA, Net TTC, frais de port (p.66)
- [x] **Remise globale** en **pourcentage** ou en **montant** (n'affecte pas le port) (p.66-67)
- [x] **Montant net TTC** modifiable (arrondi de facture) → TVA recalculée (p.67)
- [x] **Saisie des règlements immédiats** : code mode + montant (p.67-68)
- [x] **Modes de règlement** (table configurable) : ESPECES, CHEQUE, CARTE BLEU, TRAITE, LCR, CREDIT/LEASING, VIREMENT (p.68)
- [x] **Règlement total** ou **partiel** (un mode), **multi-modes** (plusieurs lignes d'encaissement) (p.68)
- [x] **Encaissements à échéances** : règlement non perçu de suite (chèque/LCR différé) → alimente le journal de caisse à la date d'échéance, client reste débiteur jusqu'au perçu (p.69)
- [x] **Modification / suppression / ajout** d'un encaissement avant validation (p.70)
- [ ] **Retour dans le corps de la facture** depuis le pied (p.70)
- [ ] **Impression d'un chèque** (imprimante chèque, montant au nom du magasin) (p.70-71)
- [ ] **Validation de la facture** → choix format d'édition (p.71)

## 1.5 Réservation / Commande client (p.74-76)
- [x] Saisie identique à la facture (réfs, quantités) ; débite stock **disponible** uniquement (p.74)
- [x] **Saisie d'acompte** : optionnel ou montant ; mode de règlement de l'acompte ; **plusieurs acomptes** possibles (p.75-76)
- [x] Échéances sur l'acompte (p.75)
- [ ] Transformation réservation → Facture / Livraison / Réparation (pas Proforma) (p.76, p.96)

## 1.6 Réparation / O.R. (p.76-80)
- [ ] Opérateur réceptionnaire + opérateur exécutant (p.77)
- [ ] **Type de réparation**, dates réception / fin (p.77)
- [ ] Client + code tarification & conditions de règlement (p.77)
- [ ] **Code cession garantie** + **état d'avancement** de la réparation (p.79)
- [ ] **Données véhicule** réparé, **Commentaire** (travaux demandés + observations réception), changement opérateur/client (p.80)

## 1.7 Bon de Livraison (B.L.) (p.80-81)
- [ ] Établi comme une facture ; débite stock **disponible** (réel débité à la facturation) (p.81)
- [ ] Rappelable plus tard et regroupable en une facture (p.80, p.135)

## 1.8 Pro forma / Devis (p.81-83)
- [ ] Établi comme une facture, **stock réel non modifié** (p.81)
- [ ] **Devis de réparation** : N° série/VIN, onglet **Commentaire** (détail travaux + observations) (p.81-82)

## 1.9 Rappel / Modification / Transformation de documents (p.84-109)
- [ ] **Rappel par n° / code-barre** (scan) (p.85)
- [ ] **Rappel par n° saisi** avec préfixe lettre type : **F**=Facture, **R**=Réservation, **L**=Livraison, **P**=Proforma, **O**=Ordre de réparation (p.85-86)
- [ ] **Rappel par méthode classique** (choix type → liste) (p.86)
- [ ] **Modification d'une facture** : double-clic ligne → corriger → revalider (réenregistre) (p.88)
- [ ] **Génération d'un avoir** : annuler une facture en générant un avoir (p.88, p.113)
- [ ] **Modification des règlements** d'une facture (immédiats vs à échéance) (p.88-91)
  - [ ] Règlement **non transféré en compta** → modifiable directement
  - [ ] Règlement **transféré en compta** (flag « Transfert comptable ») → génère une écriture d'annulation (p.90)
  - [ ] Boutons : **Supprimer le règlement** / **Ajout d'un règlement** (p.90)
- [ ] **Réservation** : modification, **suppression** (rembourse l'acompte versé), **ajout d'acompte**, transformation → Facture/Livraison/Réparation (acompte auto-déduit du total) (p.94-100)
- [ ] **B.L.** : modification/facturation, suppression, **transformation**, **duplication** (même client ou autre ; n° de série non repris) (p.101-103)
- [ ] **Pro forma** : modification, suppression, **transformation** → Facture/Réservation/B.L./Réparation (acompte possible à la conversion en réparation) (p.104-109)

## 1.10 Consultation des ventes du jour (p.110-114)
- [ ] Bilan succinct des factures de la journée — **12 colonnes** : n° facture, nom client (vide = Express), opérateur, date, dû, remise, montant HT, montant TTC, **acompte**, **marge dégagée**, **% marge**, mode de règlement (p.110-111)
- [ ] Total CA HT / TTC + marge de la journée (p.111)
- [ ] Fonctions : défilement, **Imprimer la liste**, **Visualiser une facture** (autre jour → Liste des factures), **Annuler une facture** (= générer avoir), **Modifier les règlements**, retour facturation (p.111-114)

## 1.11 Liste des documents (module dédié) (p.114-126)
- [ ] Listes : factures, réservations, proformas, ordres de réparation, régularisations, **mouvements de fond de caisse**, **acomptes**, **encaissements**, régularisations (p.114-115)
- [ ] Filtre par **client** + **période** (p.115)
- [ ] Fonctions générales : Imprimer liste, Imprimer document, Visualiser document, Ressortir fonction (p.117)
- [ ] **Liste des acomptes** : statuts **ACOMPTE** (versé non facturé) / **FACTURE** / **RENDU** (réservation-OR supprimé, remboursé) / **GARDE** (conservé par le magasin) / **C** (transféré compta) ; **suppression** d'acompte ; **modification du mode d'encaissement** ; **export Excel** (p.118-120)
- [ ] Fonctions par liste : suppression facture/réservation/proforma/OR, modification règlements, régularisations (p.120-126)

## 1.12 Statistiques quotidiennes (p.126-127)
- [ ] Récap ventes par **rayons** détaillé par référence ; « avec cumul » / « détaillées » ; visualiser / imprimer ; CA & marge par pièce + stock/qté en commande fournisseur (p.126-127)

## 1.13 Mouvements de fond de caisse (p.128-131)
- [ ] **Entrées / sorties d'argent** non liées à une vente (ex. timbres, courrier) ; alimente le journal de caisse (p.128)
- [ ] Mode de règlement + montant ; création de mode à la volée (p.130)
- [ ] **Saisie du fond de caisse de départ** (fond d'ouverture, journalier) — imprime les écarts, transféré en compta (p.130-131)

## 1.14 Utilitaires factures (p.132-138)
- [ ] **Recherche de factures de produits finis** (véhicule/machine) (p.132)
- [ ] **Duplicata de facture** (réédition même n°) — recherche par n°/nom/code client (p.133-134)
- [ ] **Génération automatique d'avoir** : annule la facture, **remet le stock**, génère règlements **négatifs** (p.135)
- [ ] **Liste des factures par client** (p.133)
- [ ] **Génération des factures par B.L. clients** : regroupe les B.L. d'un client en une facture (décade, quinzaine, fin de mois) (p.135)

## 1.15 Encaissements & relances (p.139-162)
- [ ] **Modification d'un chèque à échéance** (date, mode, suppression, encaissement immédiat) — seuls les non arrivés à échéance (p.139-141)
- [ ] **Gestion des encaissements** (dû client) : régulariser **une** facture ou **plusieurs** factures (total/partiel), à concurrence du montant, ordre chronologique (p.143-150)
- [ ] **Régularisation à une autre date** (p.148)
- [ ] **Annulation d'échéance** (p.148)
- [ ] **Saisir encaissements à échéances** sur factures sélectionnées (p.150)
- [ ] **Consultation fiche client** depuis l'encaissement (p.149)
- [ ] **Chèque de tiers** (p.150)
- [ ] **Compenser avec avoir** : compenser une facture avec un avoir (p.151)
- [ ] Imprimante **Ticket-Chèque** (p.147)
- [ ] **Gestion des relances clients** : lettres de relance / relevés de factures, jusqu'à **99 textes** paramétrables (3 zones / texte) (p.151-152)
- [ ] **Liste des clients débiteurs** : factures non soldées par client ou tous, sur période ; visualiser/imprimer (p.156-157)

## 1.16 LCR & traites (p.157-162)
- [ ] **Gestion LCR** (lettres de change relevé) → fichier banque, sauvegarde/support externe (p.157)
- [ ] **Condition de règlement « Gérée en LCR »** obligatoire sur la fiche client (p.159)
- [ ] **LCR immédiate en facturation** (à l'enregistrement) ou **différée** (après saisie facture) (p.157, p.159)
- [ ] **Regrouper plusieurs factures** sur une LCR (p.160)
- [ ] **Modification des coordonnées bancaires** d'un client ; impression des traites (p.160-161)
- [ ] **LCR Magnétiques** : type d'encaissement à générer — Encaissement après échéance / Escompte / Escompte val / Encaissement esp. délai imp. (p.162)

## 1.17 Journal de caisse / clôture (p.164-179)
- [ ] **Édition du journal de caisse** + **remises de chèques** = documents de fin de journée (p.164-165)
- [ ] **Paramétrage de l'édition** : layout configurable par poste/caisse (sélection lignes, jaune/blanc/carré-noir/chaque ligne) (p.165-166)
- [ ] **Journal des ventes / récap des encaissements de la journée (= Z)** : règlements des factures par mode, **acomptes** par mode, **entrées/sorties d'argent**, totaux intermédiaires (p.170)
- [ ] **Ventilations** : par opérateur, par famille, **par TVA**, mensuelle par opérateur/TVA (p.172-176)
- [ ] **Mouvements de fond de caisse** dans le journal (p.176)
- [ ] **Détail des ventes par référence** (p.176)
- [ ] **Calcul Monnaie** : comptage pièces/billets (dénomination × quantité) → réconciliation du tiroir (p.177)
- [ ] **Présentation Normale / Horizontale** du récap (p.170)

## 1.18 Remises en banque (p.180-184)
- [ ] **Édition des remises en banque** par mode : **espèce / chèque / LCR** (p.180)
- [ ] **Génération d'une nouvelle remise** : date, fourchette de dates, montant à remettre, nombre d'exemplaires ; liste des règlements de la période (p.180-182)
- [ ] **Report du fond de caisse** associé aux remises espèces (param. Système) (p.180)
- [ ] **Inclure les mouvements de fond de caisse** dans la remise (sorties d'argent exclues) (p.183)
- [ ] **Consultation / réédition / annulation** d'une remise archivée (p.183-184)

---

# 2. Tarifs & remises par client

## 2.1 Tarifs client (TAR p.1-4 — `Fichiers → Clients → ajout/modif/suppr Tarif client`)
- [ ] **Créer un tarif client** : code tarif (alphanumérique 5 car.) + base (libellé du tarif) (TAR p.1-2)
- [ ] Cible du tarif : **un fournisseur**, **un rayon**, **un sous-rayon**, **une catégorie**, ou **une référence spécifique** (TAR p.2)
- [ ] **Remise** simple par ligne, **OU** remises différentes selon **quantité** — jusqu'à **3 niveaux de quantité** (remise quantitative) (TAR p.2)
- [ ] **Coefficient** au lieu d'une remise : `Prix_vente_TTC = (Prix_achat_HT × Coefficient) + TVA` (TAR p.3)
- [ ] **Prix de vente fixe** imposé si la remise porte sur une seule référence (TAR p.2-3)
- [ ] **Dates de validité** : date début / date fin d'application du tarif (TAR p.3)
- [ ] **Tarif promotionnel** (case « Promotion ») : ressort même en facture **Express** (sans client identifié) ; commentaire auto « article en promotion » sur le document (TAR p.3)
- [ ] Boutons : **Guidé** (recherche), **Fiche fournisseur**, **Supprimer remise** (efface la ligne) (TAR p.3)
- [ ] **Modifier** un tarif client (même écran) (TAR p.4)
- [ ] **Supprimer** un tarif (via l'écran modification → bouton Supprimer) (TAR p.4)

## 2.2 Intégration tarif personnalisé fournisseur (INT p.1-7 — `Fichiers → Articles → Mise à jour des tarifs → Intégrer fichier perso`)
- [ ] Importer un fichier fournisseur **Excel / texte / CSV** (INT p.1-2)
- [ ] **Formats personnalisés** réutilisables : créer / dupliquer / modifier / supprimer / **Exporter / Importer** un format (INT p.2, p.6)
- [ ] **Mapping colonnes** par nom de format : Désignation, Prix d'achat, PV HT, PV TTC, Code rayon / sous-rayon / catégorie, Conditionnement, **Code barre**, Remplacement, Taille (INT p.3)
- [ ] Position colonne par **lettre Excel** ou **n° de colonne** (INT p.3-4)
- [ ] Texte **délimité** (séparateur `;`, TAB, autre) ou **largeur fixe** (position 1er caractère + nb caractères) (INT p.4-6)
- [ ] **Première ligne** = ligne d'en-tête à ignorer (INT p.3)
- [ ] Écran d'installation du tarif — cases à cocher des **changements à accepter** : désignation, prix d'achat, **prix de vente** (« à la hausse et à la baisse »), garder le coefficient, fournisseur, marque, code rayon, **nouvelles références dans la librairie**, code barre (INT p.7)

---

# 3. Règles métier & options

**TVA & prix**
- Mode **HT** (pro/TVA) vs **TTC** (particulier) configurable au départ et basculable par bouton ; impacte la saisie et l'affichage des lignes (p.31).
- **Détaxe** : inhibe la TVA (export 0 %), **uniquement en mode HT**, port en non taxé (p.54). → invariant détaxe (PDV005 dans notre app).
- **Frais de port** : Port taxé (TVA) vs Port non taxé ; montant HT saisi → TTC calculé (p.52-54).
- **Référence « * »** : prix saisi à la volée × **coefficient majorateur** (petites pièces) (p.18).
- **TVA marge** : non détaillée ici (régime O = occasion particulier) mais le flux REP/occasion en facturation crée l'article occasion (O/P) + VIN (p.57-64) → relié à B2/B3.

**Remises**
- Remise **par ligne** (montant/%) (p.16) ; **remise globale** en pied (% ou montant, hors port) (p.66-67).
- **Montant net TTC** forçable (arrondi facture) → TVA recalculée (p.67).
- Tarifs/remises client : par fournisseur/rayon/sous-rayon/catégorie/référence, remise **quantitative 3 niveaux**, coefficient, prix fixe, dates de validité, **promotion** ressortant en Express (TAR p.2-3).

**Acomptes (réservation / OR / proforma→réparation)**
- Acompte optionnel ou montant ; **plusieurs acomptes** ; échéances possibles (p.75).
- À la transformation en facture : acompte **auto-déduit** du total (p.96).
- Statuts d'acompte : ACOMPTE / FACTURE / RENDU (remboursé) / GARDE (conservé) / C (transféré compta) (p.119).
- Suppression réservation → **remboursement** de l'acompte (p.97).

**Encaissement & échéances**
- **Multi-modes** par facture : ESPECES, CHEQUE, CARTE BLEU, TRAITE, LCR, CREDIT/LEASING, VIREMENT (p.68).
- Règlement **total** ou **partiel** ; **rendu de monnaie** sur espèces (p.40, p.71).
- **À échéance** : alimente le journal de caisse à la date d'échéance ; client débiteur jusqu'au perçu (p.69).
- Règlement **transféré en compta** = verrou : modif génère une écriture d'annulation, pas un UPDATE silencieux (p.90). → cohérent avec notre B7 (append-only / audit).
- Tiroir-caisse, impression chèque, Ticket-Chèque (p.21, p.70-71, p.147).

**Numérotation & types de documents**
- Préfixes lettre pour rappel : **F/R/L/P/O** (p.85-86). → notre M0 « Numérotation des documents » (FAC-, DEV-, REC-, OR-, ORO-, etc.).
- N° de série/VIN obligatoire à la vente d'un véhicule (types V/O/P) — désactivable en paramétrage (p.47).

**Stock par type de document** (cohérent triple stock B4)
- **Facture / Express** : débite le **réel**.
- **Réservation / B.L.** : débite le **disponible** seulement (réel débité à la facturation) (p.74, p.81).
- **Proforma / Devis** : **aucun** mouvement de stock (p.81).
- **Avoir / annulation facture** : **réintègre** le stock + règlements négatifs (p.113, p.135).
- **Proposition de commande** depuis le POS (Stock / Dépannage / Garantie) (p.27-28).

**Cessions / garanties** (cohérent B10)
- Cession totale ou par ligne (prix à 0, lettre « G ») ; types configurables : Geste commercial, Garantie fournisseur, Garantie magasin (p.26-27).
- Code cession garantie + état d'avancement sur l'OR (p.79).

**Avoirs**
- Génération d'avoir manuelle (depuis facture) ou automatique (utilitaire) ; remet le stock, règlements négatifs ; **Compenser avec avoir** une facture (p.88, p.135, p.151).

**Clôture / journal de caisse (Z)**
- Fond de caisse de départ (ouverture journalière, écarts imprimés, transféré compta) (p.130-131).
- Journal des ventes = récap encaissements par mode + acomptes + entrées/sorties d'argent (p.170).
- Ventilations par opérateur / famille / **TVA** / mensuelle (p.172-176).
- **Calcul Monnaie** = comptage physique du tiroir (dénominations) (p.177).
- **Remises en banque** espèce/chèque/LCR : génération datée + n° exemplaires, inclure mouvements fond de caisse, consultation/réédition/annulation (p.180-184).

**Multi-magasins**
- Info Stock distant + Demande Magasin (p.37) ; duplication BL/réservation vers un autre client (p.101, p.104). → utile pour multi-société (ITALBIKE / NL INVEST) côté notre app, avec `company_id`.

---

# 4. Lien avec notre app (M6 `src/modules/sales` + POS)

**À couvrir impérativement (parité fonctionnelle G8)**
1. **Un écran de saisie unique** capable de produire les 6 types (Express, Facture, Devis, Réservation/Commande, B.L., OR) avec **changement de type en cours de saisie** (p.31) et conversions Devis→Facture/Réservation/BL/OR et Réservation→Facture/BL/OR (p.96, p.106). Modéliser comme un seul `document` avec `type` + `status` (cf. règle 4 audit/events).
2. **Mode HT/TTC** par document (pro vs particulier), **détaxe** (export 0 %, PDV005), **frais de port** taxé/non taxé. Tout via le dictionnaire i18n FR.
3. **Remises** : ligne + globale (% / montant) + montant net forcé ; **tarifs client** = table de règles (cible fournisseur/rayon/sous-rayon/catégorie/référence, remise quantitative 3 niveaux, coefficient, prix fixe, dates, flag promotion ressortant en Express). → module `articles` (import tarifs déjà partiellement fait au M2) + résolution au POS.
4. **Acomptes** append-only avec statuts ACOMPTE/FACTURE/RENDU/GARDE/transféré-compta ; déduction auto à la facturation ; remboursement à l'annulation. → tester (règle 7 : réservations).
5. **Encaissements** : multi-modes (ESPECES/CHEQUE/CB/TRAITE/LCR/CREDIT-LEASING/VIREMENT), partiels, à échéance, rendu monnaie ; **append-only** (B7) ; flag « transféré compta » = verrou (modif = écriture d'annulation, pas UPDATE). → relie M12 compta.
6. **Avoirs** : génération depuis facture, réintégration stock, règlements négatifs, compensation facture↔avoir. → tester (réintégration stock).
7. **Stock par type de document** : Facture/Express → réel ; Réservation/BL → disponible ; Devis → aucun (respecter triple stock B4). Mouvements via `stock_moves` (jamais d'UPDATE — règle 3).
8. **Gestion du dû client / débiteurs / relances / LCR** : régularisation mono/multi-factures à concurrence, ordre chronologique ; relances (textes paramétrables) ; LCR/traites magnétiques (export banque). → M12 + M1 (encours crédit).
9. **Clôture de caisse (Z)** : fond de départ, journal des ventes (encaissements par mode + acomptes + entrées/sorties), ventilations (opérateur/famille/TVA), calcul monnaie (comptage tiroir), remises en banque datées + réédition/annulation. → écran POS dédié + exports.
10. **Numéros de série / VIN** au POS : jointure article↔véhicule (V/O/P) déjà au cœur du custom (M3). Flux REP/occasion en facturation crée article occasion + fiche véhicule + ORO (B3).
11. **Cessions internes / garanties** typées (prix 0, types configurables) — relie M7/M8/B10.
12. **Intégration tarifs fournisseurs** : formats personnalisés réutilisables (Excel/CSV/texte délimité/largeur fixe), mapping colonnes, options « changements à accepter » (PV hausse/baisse, garder coef, librairie…). → déjà amorcé au M2 (moteur d'import tarifs) ; aligner sur ces options G8.

**Améliorations UI possibles (sans perdre de fonction)** : remplacer le « rappel par lettre F/R/L/P/O » par une recherche globale typée + VIN auto (déjà prévu M0) ; fusionner « consultation ventes du jour » / « liste documents » / « stats quotidiennes » dans un seul écran filtrable ; rendre la numérotation et les modes de règlement **configurables** (M0) au lieu de tables figées.

**Angles d'attention / à valider client (ADR)**
- Régime **TVA marge** (type O) au POS : non documenté dans ces 3 PDF — voir docs compta G8 (`Compta G8.pdf`, `Cloture fin exercice G8.pdf`) avant d'implémenter le pied de facture occasion.
- Mécanique exacte du **coefficient majorateur** réf « * » et son paramétrage.
- Détail des **ventilations TVA** et du mapping vers nos journaux (M12).
- Politique **acompte obligatoire** (montant/pourcentage minimal) : non imposée par G8 ici → à clarifier côté process Ducati Bruxelles.

> Sources : `Info Doc/Facturation G8.pdf` (185 p.), `Info Doc/Gestion tarifs clients 2023 G8.pdf` (4 p.),
> `Info Doc/Intégration tarif personnalisé G8.pdf` (7 p.). Pages indiquées = pages PDF.
