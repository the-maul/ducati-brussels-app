---
titre: Étude — où trouver la disponibilité d'une pièce (stock, Ducati, fournisseurs) avant de mettre le catalogue sur le site
date: 2026-11-03
auteur: agence (lecture du code, de la base en lecture seule, des fichiers Ducati déjà reçus, recherche web — sans développement)
statut: 🟨 remise au client, séance avec Domenico à caler
concerne: [mission 09 carte 7, décision M-80, mission 06, M02, M04, M11]
---

# Disponibilité automatique des pièces : ce qu'on sait déjà, ce que Ducati peut donner, ce qu'on montre sur le site

> **En une phrase** : sans rien demander à personne, le DMS sait déjà dire « en stock chez nous » (stock réel)
> et, grâce à la colonne « État » du tarif Ducati, « commandable chez Ducati » (vide), « remplacée » (E → nouvelle
> référence) ou « plus commandable » (F) ; il ne manque côté Ducati que le **délai** (et la rupture au stock central),
> qu'on ne trouvera que dans le DCS — c'est l'objet de la séance avec Domenico — et presque tout côté
> **fournisseurs tiers** (aucun article n'est relié à un fournisseur dans le DMS).

Question de Simon (03/11/2026) : « On en est où de savoir où on pouvait aller chercher l'info [de disponibilité] ? »
Décision M-80 : le catalogue Ducati ne va sur Shopify qu'une fois la disponibilité construite ; **un client — et
le DMS — ne doit jamais pouvoir commander une pièce qu'on ne peut pas avoir.**

Tous les chiffres viennent de la base de production lue le 03/11/2026 (lecture seule, société ITALBIKE STORE),
du tarif Ducati `*_ListPrice_09_BE_FR.xlsx` (fichiers du 19/10/2026), des extractions e-catalog du 21/09/2026
(`Téléchargements\catalogue-ducati-*.json`) et du classeur Ducati « Demo / Courtoisie / Showroom 2026 ».
Rien n'a été codé, migré, envoyé, ni lu sur le portail Ducati.

Légende : **[MESURÉ]** = compté dans nos données ; **[DOC]** = lu sur la source citée ; **[DÉDUIT]** = conclusion
de l'agence, à confirmer avec Domenico.

---

## 1. Ce qu'on a déjà (chiffres en base au 03/11/2026)

### 1.1 Notre stock (DMS) — source fiable, temps réel

| Mesure | Valeur | Remarque |
|---|---:|---|
| Articles | 93 784 | dont 8 897 en librairie (non stockés) |
| Articles avec un stock réel > 0 | **4 482** | stock = somme des mouvements (B4/B7), 4 746 mouvements |
| Stock réel négatif | 175 | à corriger à l'inventaire : jamais « en stock » sur le site |
| Réservations en cours | 0 | le « réservé » existe (B4) mais rien n'est réservé aujourd'hui |
| En commande | 0 CMD, 0 commande de pièces, 1 panier Ducati ouvert (15 lignes) | le « en commande » est calculé (`article_on_order_for`) mais vide |
| Stock minimum réglé | 301 articles | 300 sont absents du tarif Ducati (articles propres au magasin) |

**[MESURÉ]** Le niveau « en stock chez nous » est donc **déjà disponible** : `disponible = réel − réservé`
(fonction `article_stock_list`) — et le stock et les prix partent déjà vers Shopify (décision du 03/11, synchro « Tous »).

### 1.2 L'état du tarif Ducati — attention, « E » ne veut pas dire « disponible »

Le tarif Ducati (`PARTS`, `ACCESSORIES`, `APPAREL` `_ListPrice_09_BE_FR.xlsx`) a une colonne **« État »** et une
colonne **« Remplacement »**. Compté ligne par ligne **[MESURÉ]** :

| État | Références | Avec une référence de remplacement | Lecture |
|---|---:|---:|---|
| (vide) | 57 596 | 0 | pièce **courante** |
| **E** | 21 079 | **21 051** (99,9 %) | pièce **remplacée** : se commande sous la nouvelle référence |
| **F** | 47 716 | 0 | **fin de série**, sans remplaçante |
| **Total** | **126 391** | | pièces 84 716 · accessoires 9 670 · vêtements 32 005 |

Par fichier **[MESURÉ]** : vide = PARTS 48 274 · ACC 2 850 · APPAREL 6 472 ; E = PARTS 16 921 · ACC 1 816 ·
APPAREL 2 342 ; F = PARTS 19 521 · ACC 5 004 · APPAREL 23 191.

**La colonne « État » donne donc déjà la disponibilité côté Ducati** : vide = active, commandable ;
E = remplacée, commander la nouvelle référence ; F = fin de série, plus commandable.

Trois preuves que **E = remplacée** (et non « disponible ») :
- 21 051 des 21 079 « E » ont une référence de remplacement, aucune « F » ni aucune courante n'en a ;
- les 16 824 articles que le DMS marque « remplacés » (chaîne G8) sont des « E » à 16 794 ;
- dans l'e-catalog, les pièces `replaced = true` sont des « E » à 6 472 sur 6 487.

**Conséquence pour le code** : `availabilityFromStatus` (`src/modules/articles/import/rules.ts`, l. 277-285)
traduisait **E → vert « courant »** et F → rouge, et ne faisait rien pour le vide. Appliqué au prochain import du
tarif, il aurait mis la pastille verte sur 21 079 pièces remplacées et aucune sur les 57 596 courantes. Aujourd'hui
la pastille n'est posée que sur **3 articles** (2 vertes, 1 rouge) : l'erreur n'a pas encore eu d'effet.
**Correction en cours par un autre lot** (03/11, commit annoncé « fix(articles): etat du tarif Ducati TAR008 ») :
vide = courante, E = remplacée (renvoi vers la remplaçante), F = fin de série. Cette étude ne touche pas au code.

Le remplacement n'est pas toujours une bonne nouvelle **[MESURÉ]** : sur les 21 051 remplaçantes, 10 392 sont
courantes, 5 825 sont elles-mêmes remplacées (chaîne à suivre) et **4 695 sont en fin de série** (la pièce
n'existe plus du tout) ; 139 sont absentes du tarif.

Croisé avec le DMS **[MESURÉ]** :

| Articles du DMS | Courante | E remplacée | F fin de série | Absente du tarif |
|---|---:|---:|---:|---:|
| Tous (93 784) | 51 508 | 16 927 | 21 402 | 3 947 |
| **En stock** (4 482) | 3 134 | 87 | **592** | 669 |

Les 592 pièces F en stock sont des **dernières pièces** : vendables tant qu'il en reste, jamais recommandables.
Les 669 en stock absentes du tarif sont surtout du Ducati Bruxelles / Ducati maison (325) et des marques tierces
(Rizoma 47, Pirelli 25, Bihr 25, Evotech 24, Termignoni 23, Dainese 23…).

### 1.3 Ce que renvoie l'e-catalog Ducati (déjà lu par l'extension)

L'extension (`tools/myducati-extension/catalog.js`) appelle, avec la session e-catalog de l'utilisateur
**[DOC, code]** : `/EPC/api/spareparts/browsing/families`, `…/superModels/1/{famille}`, `…/models/1/{famille}/{cylindrée}`,
`…/drawing/groups/1/{modèle-année}`, `…/drawing/drawing/1/{…}/{groupe}/{planche}` ; et pour les accessoires
`POST api/accessories/product/list` puis `…/product/detail/{code}` (mission 06).

| Champ | Où | Ce qu'il dit | Gardé dans le DMS ? |
|---|---|---|---|
| `price`, `vatPrice`, `discountGroup`, `minQuantity` | pièces | prix catalogue, classe de remise, minimum de commande | oui (`ducati_catalog_parts`, prix lus du 21/09 au 16/10) |
| `replaced`, `replacedPart`, `partReplacementTree` | pièces | remplacée + par quoi | oui (6 487 pièces remplacées) |
| `startDate`, `endDate`, `validities` | pièces | validité par modèle | envoyés au DMS, non exploités |
| `partDetails.partStatus` | accessoires | **« F »** sur 257 des 2 619 variantes | dans les attributs de l'accessoire |
| `basketDisabled` / `disabled` | accessoires | **panier interdit** sur exactement les 257 « F » | non |
| `lastChance` | accessoires (liste) | « dernière chance » sur 103 variantes | non |

**[MESURÉ]** Aucun champ `stock`, `availability`, `orderable`, `leadTime` ni date de livraison dans les réponses
enregistrées. L'e-catalog dit **si** une pièce se commande (pas remplacée, pas F, panier autorisé), jamais **quand**
elle arrive. Pour les pièces des vues éclatées, l'extraction n'a pas gardé de `partStatus` : reste à voir si l'API
le renvoie (une page à regarder avec Domenico, §5).

Sur les **54 630 pièces de l'e-catalog** (le candidat « catalogue sur Shopify » de la mission 09, Q4) **[MESURÉ]** :
39 834 courantes, 6 509 remplacées (E), 6 380 en fin de série (F), 1 907 absentes du tarif ; **2 729** sont en stock chez nous.

### 1.4 Le classeur démo Ducati 2026 a une colonne « Disponibilité »

Le classeur « Demo / Courtoisie / Showroom 2026 » (1 793 accessoires, onglets identiques) a une colonne
**Disponibilité** **[MESURÉ]** : « Disponible » 1 178, « Limité » 174, « NC » 21, « En cours d'élaboration » 12,
et **408 dates** « disponible à partir du » (ex. 09/02/2026, 18/02/2026, 15/04/2026). C'est la seule source Ducati
qu'on ait, en dehors du DCS, qui parle d'une disponibilité au sens « quand ». Elle est **annuelle** et ne couvre que
les accessoires de la gamme de l'année.

---

## 2. Ce que Ducati peut donner, et comment

| Source | Ce qu'elle donne | Fraîcheur | Accès | Statut |
|---|---|---|---|---|
| **Tarif ListPrice** (3 fichiers) | courante / remplacée (+ par quoi) / fin de série, prix, classe | à chaque édition (« _09 » = septembre ? fichiers reçus le 19/10) | fichier envoyé par Ducati, importé dans le DMS | **déjà là** |
| **e-catalog EPC** | remplacée, arbre de remplacement, F et panier interdit (accessoires), « dernière chance » | à chaque lecture | session de Domenico, extension navigateur | **déjà lu** (21/09) |
| **Classeur démo annuel** | Disponible / Limité / NC / date d'arrivée (accessoires de l'année) | annuel | fichier Ducati | reçu, non importé |
| **DCS** (système de commande) | commandes saisies et suivies « de la production à la livraison » **[DOC]** ; stock Bologne / délai / reliquats : **inconnu** | ? | session de Domenico, fermé (pas d'API, glossaire) | **à voir en séance** |
| **Confirmation / BL / facture Ducati** | ce qui est réellement livré, par « Commande n° » (facture PDF déjà analysée, process §1.6) | à chaque commande | mail / PDF | existe, non exploité |

Ce qu'on sait du DCS, sources publiques **[DOC]** : plateforme « Dealer Communication System » réalisée par
Accenture sur **SAP et Siebel**, pour environ 1 000 concessionnaires dans 88 pays, où le concessionnaire saisit et
**suit ses commandes en ligne de la production à la livraison** (Corriere Comunicazioni, 20/11/2015). Apple la
décrit comme une application interne sur interface SAP pour commander pièces, vêtements et accessoires, et note
qu'avant elle « les informations d'inventaire, de disponibilité et de délais » étaient éparses (page Apple, non datée).
Aucune source publique ne dit si le DCS affiche le stock de Bologne.

**[DÉDUIT]** Un système de commande sur SAP renvoie d'ordinaire, pour chaque ligne commandée, une **quantité
confirmée et une date** (contrôle de disponibilité à la commande), et garde la liste des lignes **en reliquat**.
Si le DCS le montre, il y a trois façons de le récupérer, de la plus simple à la plus automatique :
1. **Saisie au retour** : après l'envoi du `ExportDucati.xls`, on note dans le panier ce que le DCS a confirmé
   (comme le n° DCS aujourd'hui) — fiable, manuel, aucune connexion.
2. **Export du DCS** (Excel / PDF des commandes en cours ou des reliquats), déposé dans le DMS qui le relit.
3. **Lecture par l'extension** avec la session de Domenico, comme l'e-catalog — seulement avec son accord, au
   rythme qu'il fixe, sans identifiant stocké.

Comment font les autres **[DOC]** : aux États-Unis, Ducati North America a payé à ses concessionnaires le
« Parts Locator » de Lightspeed pour **voir le stock de l'entrepôt Ducati** et celui des autres concessionnaires
(Powersports Business, 11/03/2011) ; Yamaha (2011) et BRP (2012, aussi par son portail BOSSWeb) ont fait de même ;
certains fournisseurs chargent leur fichier de stock **une fois par jour** dans le DMS (Oxford Products).
Incadea annonce des liaisons constructeur couvrant la commande de pièces, sans détail public. Rien d'équivalent
n'a été trouvé pour Ducati en Europe : la disponibilité constructeur y passe par le portail du concessionnaire.

---

## 3. Fournisseurs tiers

**[MESURÉ]** 101 contacts fournisseurs dans le DMS (Bihr, Rizoma, Akrapovic, Evotech, Pirelli, Motoria…),
**0 article relié à un fournisseur** (`articles.main_supplier_id` vide partout, `article_suppliers` vide), aucun
fournisseur coché « Commandé par le DCS » (pas même DUCATI WEST EUROPE), 2 seulement avec des conditions saisies.
On ne peut donc **pas compter les articles par fournisseur** ; la marque sert de repère :

| Marque (articles / dont en stock) | Comment on commande (à confirmer) | Stock publié ? (recherche web du 03/11) |
|---|---|---|
| Rizoma (78 / 47) | importateur ou direct | aucun espace revendeur public trouvé |
| Pirelli (41 / 25), Michelin (37 / 16) | grossiste pneus ; certains pneus existent aussi au tarif Ducati (ex. 49040741A) | pas de source publique |
| Termignoni (41 / 25) | souvent via Ducati Performance (référence Ducati) | à vérifier par référence |
| Dainese (38 / 23), Shoei (38 / 14) | importateur équipement | pas de source publique |
| Akrapovic (37 / 15), Evotech (27 / 24) | direct / importateur | aucun portail public trouvé |
| Bihr (26 / 25) | grossiste | dit livrer presque tous les revendeurs d'Europe en 24 h depuis 7 entrepôts ; outil revendeur non documenté publiquement |

**[DÉDUIT]** Pour les tiers, la disponibilité sera d'abord **déclarative** (délai habituel par fournisseur, saisi
une fois), puis **par fichier de stock** quand un fournisseur en publie un (à demander à Bihr et aux importateurs).
Préalable : **relier chaque article tiers à son fournisseur** (sans cela, aucun niveau 3 n'est possible).

---

## 4. Le modèle à 4 niveaux et ce qu'on montre sur Shopify

Règle : on prend **le meilleur niveau atteint**, dans l'ordre 1 → 4. Une pièce remplacée renvoie vers sa
remplaçante, qui est évaluée à son tour.

| Niveau | Condition | Source | Fraîcheur | Sur Shopify |
|---|---|---|---|---|
| **1. En stock chez nous** | disponible (réel − réservé) > 0 | DMS (`stock_moves`) | temps réel | **« En stock »** (expédié sous 24-48 h) ; si l'état tarif est F : « **Dernières pièces** », disparaît à 0 |
| **2. Commandable chez Ducati** | état tarif vide (courante), présente dans le dernier tarif, pas remplacée, pas F dans l'e-catalog ; « Limité » / « dernière chance » = mention | tarif + e-catalog (+ DCS si la séance le permet) | à chaque tarif / lecture ; délai = **délai standard réglable** (à mesurer avec Domenico) | **« Sur commande — expédié sous X jours »** ; achat possible ; si le DCS met la ligne en reliquat, mail au client |
| **3. Commandable chez un fournisseur** | article relié à un fournisseur + délai du fournisseur (ou stock du fichier fournisseur) | fiche fournisseur, puis fichier de stock | délai saisi ; fichier quotidien quand il existe | **« Sur demande »** : formulaire (pas de paiement immédiat) tant qu'il n'y a pas de fichier de stock ; ensuite « expédié sous X jours » |
| **4. Non commandable** | F sans stock ; E sans remplaçante commandable ; absente du tarif sans fournisseur ; stock négatif | tarif, e-catalog, DMS | à chaque tarif | **non publié** (E : la page renvoie vers la remplaçante, décision Shopify du 03/11) |

Projection sur les 54 630 pièces de l'e-catalog **[MESURÉ, avant séance]** :

| Niveau | Pièces |
|---|---:|
| 1. En stock chez nous | 2 729 |
| 2. Sur commande chez Ducati (courantes, pas en stock) | 37 277 |
| 4. Remplacées (renvoi vers la remplaçante) | 6 473 |
| 4. Fin de série sans stock | 6 246 |
| 4. Absentes du tarif (inconnues, à vérifier) | 1 905 |

Soit **≈ 40 000 pièces publiables** et ≈ 14 600 jamais commandables par un client. Le niveau 3 ne concerne pas
ces pièces Ducati ; il concerne les ≈ 670 articles tiers en stock et leurs références sœurs.

Dans le DMS, le même statut s'affiche partout où l'on choisit une pièce (recherche, devis, OR, panier), en
couleur + icône + libellé (règle 9), et le panier **refuse** une ligne de niveau 4.

---

## 5. Séance avec Domenico (20 minutes, devant le DCS) — objectif unique : le **délai**

Ce que la séance doit trancher : quand une pièce **courante** (état vide) n'est pas chez nous, **en combien de jours**
l'a-t-on, et le DCS dit-il **avant** de commander si le stock central Ducati l'a (ou la met en reliquat) ? L'état
« commandable / remplacée / fin de série » est réglé par le tarif (§1.2) : on ne le rediscute pas, on le vérifie
en passant sur les références tests.

Préparer : trois références tests tirées de nos données — **49040741A** (pneu Pirelli, courante, en stock),
**52310682B** (miroir gauche, E → **52310683B** courante), **55211491A** (sonde lambda, F, en stock) — plus une
courante **qu'on n'a pas** en stock (à choisir le jour même dans le panier ouvert). Rien n'est saisi ni commandé
pendant la séance ; Domenico manipule, on regarde.

**Les 5 écrans**
1. **DCS — recherche / saisie d'une référence courante absente de notre stock** : le DCS affiche-t-il un stock
   central, une disponibilité, une **date de livraison prévue** avant validation ?
2. **DCS — après l'envoi d'un fichier `ExportDucati.xls`** : écran ou mail de **confirmation** (quantité confirmée,
   date prévue, ligne en reliquat).
3. **DCS — suivi des commandes / reliquats** : liste des lignes non livrées avec leur date ; bouton d'**export** ?
4. **DCS — les références tests 52310683B et 55211491A** : la remplaçante est-elle proposée ? la F est-elle refusée ?
   (simple vérification du tarif, 1 minute).
5. **Boîte mail Ducati** : confirmation de commande, avis d'expédition, BL, facture : l'un d'eux porte-t-il la date
   ou le reliquat ? Où et à quel rythme arrive le tarif ListPrice.

**Les 5 questions**
1. Une pièce courante commandée en **standard** (jour de commande, jour de départ de Ducati), combien de jours
   jusqu'à la réception chez nous ? En **urgente** ?
2. Arrive-t-il qu'une pièce **courante au tarif** ne soit pas livrable (rupture du stock central, reliquat) ? Souvent ?
   Combien de temps ? Le sais-tu **avant** de commander ou seulement après ?
3. Ducati confirme-t-il ligne par ligne ce qu'il livrera et quand (écran, mail, fichier) ? Peut-on l'**exporter** ?
4. Les **5 fournisseurs tiers** chez qui tu commandes le plus : par portail, mail ou téléphone ? Délai habituel ?
   Ont-ils un fichier de stock ou un espace revendeur ?
5. Si le DCS montre le délai ou le stock central : es-tu d'accord pour que l'extension le lise **avec ta session**,
   comme pour le catalogue, et à quel rythme ? Sinon, on note le retour du DCS à la main dans le panier.

**Ce qu'on enregistre** : une capture par écran (sans identifiant), le **délai standard / urgente** en jours ouvrés
(c'est le « X jours » du site), si le DCS montre une date ou un reliquat **avant** la commande (oui / non, quel écran),
le format de la confirmation (écran, mail, export), le résultat des références tests, la liste des 5 fournisseurs avec
mode de commande et délai, la réponse à la question 5 (oui / non / conditions). Le tout va dans la mission 09
(carte 7) et dans `decisions.md` ; la liaison article → fournisseur devient une carte.

---

## 6. Sources (datées)

Données internes (lues le 03/11/2026) : base de production en lecture seule (`npx supabase db query --linked`,
tables `articles`, `stock_moves`, `contacts`, `article_suppliers`, `ducati_catalog_parts`, `purchase_orders`,
`part_orders`, `supplier_baskets`) ; tarif `PARTS/ACCESSORIES/APPAREL_ListPrice_09_BE_FR.xlsx` (19/10/2026) ;
extractions e-catalog `catalogue-ducati-planches-*.json`, `catalogue-ducati-accessoires.json` (21/09/2026) ;
classeur « Fichier de commande via excel Demo Crtsy Shwrm 2026_FR VIERGE.xlsx » (30/07/2026) ; code
`tools/myducati-extension/catalog.js`, `src/modules/articles/import/rules.ts`, `supabase/migrations/20260610310000_m5_stock_views.sql`.

Web (consulté le 03/11/2026) :
- [Corriere Comunicazioni — « Piattaforma per la gestione dei concessionari Ducati »](https://www.corrierecomunicazioni.it/telco/piattaforma-per-la-gestione-dei-concessionari-ducati/) (20/11/2015) : DCS, Accenture, SAP + Siebel, suivi des commandes.
- [Apple — Ducati (iPhone en entreprise)](https://www.apple.com.cn/iphone/business/profiles/ducati) (non datée) : application DCS sur interface SAP, commande de pièces / vêtements / accessoires.
- [Powersports Business — « Ducati, ADP provide no-cost dealer inventory tool »](https://powersportsbusiness.com/?p=900) (11/03/2011) : stock de l'entrepôt Ducati NA visible des concessionnaires.
- [Powersports Business — « ADP Lightspeed DMS now integrated with Yamaha »](https://powersportsbusiness.com/?p=396) (23/08/2011) et [« BRP signs with ADP Lightspeed for Parts Locator »](https://powersportsbusiness.com/?p=10940) (17/01/2012).
- [Powersports Business — « Oxford Products USA announces integration with Lightspeed »](https://powersportsbusiness.com/?p=30521) (non datée dans l'extrait) : stock chargé chaque jour.
- [FitGap — incadea.dms](https://us.fitgap.com/products/040836/incadea-dms) (non datée) : liaisons constructeur, commande de pièces.
- [Ducati — FAQ service clients](https://www.ducati.com/ch/fr/entreprise/service-clients/faq) (consultée le 03/11/2026) : le concessionnaire est la référence pour la disponibilité et les délais d'une pièce.
- [Businesscoot — Bihr](https://www.businesscoot.com/en/company/bihr) (chiffres 2021) : grossiste, livraison 24 h en Europe.
- Recherches sans résultat utile (03/11/2026) : espace revendeur / stock en ligne de Rizoma, Akrapovic, Evotech, Bihr.
