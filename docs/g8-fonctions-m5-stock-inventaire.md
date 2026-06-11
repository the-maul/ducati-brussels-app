# G8 → DMS — M5 Stock & inventaire : fonctions, parcours, règles

> Source : `docs/reference-g8/DOC_Menu_Stock.pdf` (onglet STOCK, 27 p.) + 8 procédures
> d'inventaire scannées dans `Info Doc/INVENTAIRE MAGASIN *.pdf`.
> Objectif : retrouver **toutes** les fonctionnalités et parcours G8 dans l'app moderne (UI libre).
> Les n° de page renvoient au PDF cité.

---

# M5 Stock/Inventaire — Fonctionnalités (checklist)

## A. États d'inventaire / éditions de stock (DOC_Menu_Stock §1, p.3-14)
- [ ] **Inventaire par rayon / fournisseur** (§1.1, p.4) : sélection multi rayons / sous-rayons / catégories ; bouton « modifier critères », « enregistrer sélection » (présélection nommée), « choisir sélection » (rappel).
- [ ] **Type de valorisation** (3 options, §1.1.4 p.5) : stocks **positifs+négatifs** (inventaire complet) / **positifs** seuls / **négatifs** seuls.
- [ ] **Sous-totaux** (§1.1.5 p.6) : total par rayon / par sous-rayon / par catégorie (cumulatifs).
- [ ] **Inventaire simplifié** (n'édite que stock ≠ 0), **récapitulatif** (valeur totale sans détail), **calcul des quantités vendues** sur fourchette de dates, ou liste complète (stock 0 inclus) (§1.1.6 p.6).
- [ ] **4 bases d'édition** (§1.1.7 p.7) : **Stock réel** / **Stock arrêté** (photo de l'arrêté) / **Stock à une date** (copies du 15 et fin de mois + copies fin d'inventaire) / **Comptage** (liste vierge pour noter les quantités comptées).
- [ ] 3 sorties pour chaque édition : **Visualiser / Imprimer / Export Excel**.
- [ ] **Inventaire stock produit fini** (§1.2 p.8) : articles type **V** (neufs) / **O** (occasion) / V+O ; tri par référence ou désignation ; option **Incident de stock** (anomalies parc ↔ fiche article).
- [ ] **Inventaire par code rangement / casier** (§1.3 p.10) : intervalle de casiers (vide = tout), valorisation +/−, simplifié, bases réel/arrêté/comptage.
- [ ] **Inventaire par ordre de référence** (§1.4 p.11) : tri par fourchette de référence ou de désignation (mêmes options que par casier).
- [ ] **Écart d'inventaire** (§1.5 p.12) : liste réf. avec **stock réel actuel vs stock arrêté/copie**, écart en **quantité ET en valeur**, édition par fournisseur ou rayon.

## B. Dépréciation, invendus, ruptures (§1.6 p.13-14)
- [ ] **Dépréciation de stock** : sélection sur **dates d'entrée en stock** (basé sur module Appros) + **taux de dépréciation** → diminue le **PAMP** des marchandises invendues. Sélection fournisseur/rayon. NB G8 : « la dépréciation s'applique uniquement en comptabilité, pas dans le logiciel de gestion » (à arbitrer côté app, voir plus bas).
- [ ] **Liste des invendus** sur une période (Visualiser / Imprimer).
- [ ] **Articles en rupture de stock** : stock réel négatif **ou** < stock mini (fiche article), par fournisseur / rayon / tout — base des **commandes de réapprovisionnement**.

## C. Gestion de l'arrêté d'inventaire (§2 p.14-19) — méthode « magasin ouvert » uniquement
- [ ] **Génération de l'arrêté** (§2.1 p.14) : « photocopie » du stock réel à l'instant T ; les stocks de l'arrêté **ne bougent plus** malgré facturation/appros postérieurs. *(Les modifs de **tarif** postérieures, elles, s'appliquent à l'arrêté.)*
- [ ] Onglet inaccessible si aucune méthode d'inventaire n'est démarrée.
- [ ] **Réajustement de l'arrêté** (§2.2 p.15) en 3 modes (selon méthode choisie) : annule-et-remplace / cumul / par code casier (à la volée).
- [ ] **Réintégration de l'arrêté** (§2.3 p.18) : **cumule stock réel + stock arrêté** → écrit le nouveau stock réel. **Opération unique** (« une fois pour toutes »). Effacer l'arrêté ensuite.

## D. Gestion du stock réel (§3 p.19-23) — méthode « magasin fermé »
- [ ] **Réajustement de stock réel** (§3.1) en 3 modes : annule-et-remplace / cumul / par code casier.
- [ ] **Remise à zéro de stock** (§3.2 p.22) : positifs+négatifs, ou **négatifs uniquement** ; option **conserver le stock véhicules/produits finis** ; accessible seulement si méthode « magasin fermé avec effacement des stocks » démarrée.

## E. Les 3 modes de réajustement (communs arrêté & stock réel, §2.2 / §3.1)
- [ ] **Annule et remplace** : saisie dans colonne « Nouveau stock », **écrase** la quantité existante.
- [ ] **Cumul** : saisie dans colonne « Ajouter au stock », **additionne/soustrait** (négatif possible) à l'existant ; pour articles rangés à **plusieurs endroits** ; nécessite en général une **remise à zéro préalable**.
- [ ] **Par code casier / à la volée** : sélection d'un intervalle de casiers → le logiciel affiche les réf. de ces casiers, saisie directe dans la colonne (= mode annule-et-remplace, **validation auto au changement de ligne**). Case « n'afficher que les quantités ≠ 0 ».

## F. Outils de saisie de réajustement (§2.2.1 p.15-17)
- [ ] Saisie réf. à la main, **lecteur code-barres** (bouton « Lecteur code barre » télécharge la douchette), **Fiche article**, **Import microfiches**, **Librairie** (ajout d'articles de référence non stockés).
- [ ] Question préalable : **éditer des étiquettes** (avec/sans code-barres) en fin de saisie + nombre par réf.
- [ ] Attribution de **codes casier** en même temps que la saisie des réajustements.
- [ ] Validation par tableaux successifs (conseil G8 : valider régulièrement, repartir sur un nouveau tableau) ; après validation : édition de la **liste des articles réajustés** + étiquettes associées.

## G. Étiquetage (§4 p.23-25)
- [ ] **Par référence** (§4.1) : sélection fournisseur/famille/référence + dates de modif fiches (calendrier) + code casier ; quantité par défaut = **stock réel**, modifiable, ou « 1 seule étiquette/réf » ; avec/sans code-barres, avec/sans prix.
- [ ] **Édition immédiate** (Valider) **ou différée** (mémorisée, cumulable par poste — reprise via Appros « Reprise d'édition d'étiquettes »).
- [ ] Format A4 : reprise sur ligne/colonne choisie ; lecture imprimante étiquette + format par défaut du poste.
- [ ] **Par groupe** (§4.2) : tout/partie d'un fournisseur ou rayon, sans ressaisir les réf. ; quantité = stock réel (forçable).

## H. Méthode d'inventaire (§5 p.25)
- [ ] Écran de **choix de la méthode** (8 combinaisons, voir parcours) avant de pouvoir gérer un arrêté ; procédure téléchargeable.

## I. Historique des mouvements (§6 p.26)
- [ ] Consultation de **toutes les opérations** sur le stock, **par article** et **par date**.

## J. Inventaire tournant (§7 p.27)
- [ ] Comptage partiel récurrent par fournisseur/rayon/sous-rayon/catégorie, **sans arrêt du magasin**, avec taux d'écart (module activable, doc séparée G8).

---

# Parcours utilisateur — les 8 méthodes d'inventaire

Toutes démarrent par un écran **« Méthode d'inventaire »** listant les étapes ; chaque étape se
valide « Étape suivante » (bouton en haut à gauche). Certaines étapes sont **manuelles**
(comptage, réajustement, éditions), d'autres **se valident automatiquement** (sauvegarde,
génération, réintégration, copie de stock). Une fois une méthode lancée, **ne pas en changer**
(rouge G8 = irréversible).

Deux familles :
- **Magasin FERMÉ** → on travaille **directement sur le stock réel** (on ne facture / commande / réceptionne **pas** pendant l'inventaire). Pas d'arrêté.
- **Magasin OUVERT** → on **génère un arrêté** (photo), on continue à facturer/commander pendant le comptage, puis on **réintègre** l'arrêté dans le stock réel.

Deux options croisées sur chaque famille :
- **Avec effacement des stocks** → ajoute une étape **Remise à zéro du stock réel** + comptage à la **douchette** + réajustement en **mode cumul** (au lieu de annule-et-remplace).
- **Avec édition des écarts** → ajoute **génération d'arrêté de référence** + une étape **Édition des écarts et vérification** (réel vs arrêté) avant l'édition finale.

> Tableau-clé G8 (en-tête de chaque procédure) :
> | Méthode | Magasin | Comptage | Remise à zéro | Édition écarts |
> |---|---|---|---|---|
> | f0 | fermé | édition état du stock | non | non |
> | f1 | fermé | **douchette** | **oui** | non |
> | f2 | fermé | édition état du stock | non | **oui** |
> | f3 | fermé | (douchette/CB) | **oui** | **oui** |
> | f4 | ouvert | édition état du stock | non | non |
> | f5 | ouvert | **douchette** | **oui** | non |
> | f6 | ouvert | édition état du stock | non | **oui** |
> | f7 | ouvert | **douchette/CB** | **oui** | **oui** |

## 1) Magasin FERMÉ (base) — `INVENTAIRE MAGASIN FERME G8.pdf`
Le magasin **ne facture/commande/réceptionne PAS** pendant l'inventaire.
1. **Choisir la procédure** (lancer la méthode — irréversible).
2. **Sauvegarde** (impérative ; tous les autres postes G8 fermés ; sauvegarde sur clé/serveur ; validée auto).
3. **Édition de l'inventaire initial** : éditer l'état du stock (par rayon/fournisseur) → support de comptage physique.
4. **Comptage / pointage** *(étape physique)* : noter la quantité comptée dans la colonne stock réel quand elle diffère. **Ne pas compter** ce qui est sorti du stock (facturation, cession) ; **compter** ce qui est en réservation, livraison, devis ou OR (toujours propriété du stock). Validation auto.
5. **Réajustement du stock réel en mode annule-et-remplace** : saisir les corrections (saisie « en chaîne ») ; la quantité saisie **écrase** la quantité existante. Fenêtre à fermer rigoureusement (coupure courant = données perdues).
6. **Édition de l'inventaire final** (définitif) : à remettre au comptable.
7. **Génération d'une copie de stock** (tous postes fermés ; réindexation ; validée auto).
8. **Fin d'inventaire**.

## 2) Magasin FERMÉ + effacement des stocks — `... AVEC EFFACEMENT DES STOCKS G8.pdf`
Variante : comptage **douchette**, réajustement **mode cumul**.
1. Choisir la procédure. 2. Sauvegarde.
3. **Remise à zéro du stock réel** : option **« décocher la case » pour conserver le stock véhicules/produits finis** (ne pas perdre les n° de série). N'efface pas les numéros de série. Validée auto.
4. **Comptage / pointage** (douchette).
5. **Réajustement du stock réel en mode CUMUL** : les quantités saisies **s'ajoutent** au fur et à mesure (utile multi-emplacements/multi-postes scannant en parallèle).
6. **Édition de l'inventaire final**. 7. **Génération copie de stock**. 8. **Fin**.

## 3) Magasin FERMÉ + édition des écarts — `... ET EDITION DES ECARTS G8.pdf`
Variante : on génère un **arrêté de référence** pour pouvoir comparer.
1. Choisir. 2. Sauvegarde.
3. **Génération de l'arrêté** (photo du stock à T = référence des écarts ; validée auto).
4. **Édition de l'inventaire initial**. 5. **Comptage / pointage**.
6. **Réajustement du stock réel mode annule-et-remplace**.
7. **Édition des écarts et vérification** : liste valorisée des différences **stock réel (corrigé) vs arrêté**, en quantité et valeur, **à corriger avant** l'édition finale.
8. **Édition de l'inventaire final**. 9. **Génération copie de stock**. 10. **Fin**.

## 4) Magasin FERMÉ + effacement + écarts — `... AVEC EFFACEMENT DES STOCKS ET EDITION DES ECARTS G8.pdf`
Combinaison : 1. Choisir. 2. Sauvegarde. 3. **Génération de l'arrêté**. 4. **Remise à zéro du stock réel** (conserver véhicules/PF). 5. **Comptage / lecture codes-barres**. 6. **Réajustement mode CUMUL**. 7. **Édition des écarts et vérification**. 8. **Édition inventaire final**. 9. **Génération copie de stock**. 10. **Fin**.

## 5) Magasin OUVERT (base) — `INVENTAIRE MAGASIN OUVERT G8.pdf`
On **continue à travailler** (facturation/commande/réception) pendant l'inventaire ; on opère sur l'**arrêté**.
1. **Choisir la procédure**. 2. **Sauvegarde**.
3. **Génération de l'arrêté** : photocopie du stock réel à T ; l'arrêté ne bouge plus malgré l'activité commerciale (validée auto).
4. **Remise à zéro du stock réel** *(astuce clé)* : remettre à 0 le stock réel **juste après** la génération, en **conservant véhicules/produits finis** (décocher la case). Ainsi la **réintégration** finale pourra réabsorber tous les mouvements (ventes/appros) faits pendant le comptage.
5. **Édition de l'arrêté initial** : support de comptage.
6. **Comptage / pointage** (mêmes règles d'inclusion : réserv./livraison/devis/OR comptés, sorties non).
7. **Réajustement de l'arrêté mode annule-et-remplace** : corriger les quantités **sur l'arrêté** (pas sur le réel).
8. **Édition de l'arrêté final** (définitif, pour le comptable).
9. **Sauvegarde finale**.
10. **Réintégration de l'arrêté d'inventaire** *(unique, « une fois pour toutes »)* : **cumule stock réel + stock arrêté**. Grâce à la remise à zéro de l'étape 4, le réel ne contient que les mouvements de la période d'inventaire → la réintégration ajoute le comptage **et** déduit les ventes / ajoute les réceptions de la période. Validée auto.
11. **Génération d'une copie de stock** (tous postes fermés ; validée auto).
12. **Fin d'inventaire**.

## 6) Magasin OUVERT + effacement des stocks — `... AVEC EFFACEMENT DES STOCKS G8.pdf`
Comme OUVERT base mais comptage **douchette** et **réajustement de l'arrêté en mode CUMUL** (multi-emplacements). Séquence : Choisir → Sauvegarde → Génération arrêté → Remise à zéro stock réel → Édition arrêté initial → Comptage (douchette) → Réajustement arrêté **CUMUL** → Édition arrêté final → Sauvegarde finale → Réintégration arrêté → Copie de stock → Fin.

## 7) Magasin OUVERT + édition des écarts — `... ET EDITION DES ECARTS G8.pdf`
Comme OUVERT base + étape **Édition des écarts et vérification** (réel/copie vs arrêté, quantité+valeur) **avant** l'arrêté final. Séquence : Choisir → Sauvegarde → Génération arrêté → Remise à zéro stock réel → Édition arrêté initial → Comptage → Réajustement arrêté (annule-et-remplace) → **Édition des écarts et vérification** → Édition arrêté final → Sauvegarde finale → Réintégration → Copie de stock → Fin.

## 8) Magasin OUVERT + effacement + écarts — `... AVEC EFFACEMENT DES STOCKS ET EDITION DES ECARTS G8.pdf`
Combinaison maximale : Choisir → Sauvegarde → Génération arrêté → Remise à zéro stock réel (conserver véhicules/PF) → Édition arrêté initial → Comptage / **lecture codes-barres** → Réajustement arrêté **mode CUMUL** → **Édition des écarts et vérification** → Édition arrêté final → Sauvegarde finale → **Réintégration de l'arrêté** → Copie de stock → Fin.

## Arrêté d'inventaire — cycle de vie (transverse, §2)
1. **Génération** : snapshot daté du stock réel. Immuable côté quantités ; suit les changements de **tarif** seulement.
2. **Réajustement** : corrige les quantités de l'arrêté (un des 3 modes selon méthode).
3. **(option) Édition des écarts** : réel vs arrêté, quantité + valeur.
4. **Réintégration** : `stock réel ← stock réel + stock arrêté` (unique). Précédée d'une remise à zéro du réel si on veut absorber les mouvements de la période.
5. **Effacement de l'arrêté** : recommandé après réintégration (libère l'onglet pour le prochain inventaire).
+ **Copies datées** consultables a posteriori : automatiques le **15** et **fin de mois**, + copie générée en fin d'inventaire (= « stock à une date »).

## Réapprovisionnement (issu de §1.6.3)
- Édition **Articles en rupture** (réel < 0 ou < stock mini) par fournisseur/rayon → liste de réappro.
- Sert de base aux commandes fournisseur (lien module Achats/Appros, export DCS côté Ducati).

---

# Règles métier & options

- **Triple stock** (B4) : **réel** (physique) / **arrêté** (photo datée) / **disponible** = `réel − réservé + en commande`. Copies datées (15 & fin de mois) consultables.
- **Inclusions de comptage** (règle physique G8, critique) : **compter** réservations, livraisons, devis, OR (restent propriété du stock) ; **ne pas compter** ce qui est sorti (facturé, cession).
- **Magasin fermé ⇒** aucune facturation/commande/réception pendant l'inventaire ; on agit sur le **stock réel**.
- **Magasin ouvert ⇒** activité maintenue ; on agit sur l'**arrêté** ; la **remise à zéro post-génération** est la condition pour que la réintégration absorbe correctement les mouvements de période.
- **3 modes de réajustement** (B6) : annule-et-remplace (écrase) · cumul (additionne, multi-emplacements, exige remise à zéro préalable) · par casier à la volée (= annule-et-remplace, validation auto au changement de ligne).
- **Remise à zéro** : positifs+négatifs **ou** négatifs seuls ; **conserver véhicules/produits finis** (types V/O/P : ne jamais perdre les n° de série / VIN).
- **Réintégration = opération unique** ; jamais répétée ; arrêté effacé après.
- **Valorisation** : positifs+négatifs / positifs / négatifs ; sous-totaux rayon/sous-rayon/catégorie ; simplifié (≠0) / récapitulatif / quantités vendues.
- **Écart d'inventaire** : toujours en **quantité ET valeur**, réel vs arrêté/copie.
- **Dépréciation** : par taux sur fourchette de dates d'entrée → impacte le **PAMP** des invendus. G8 la cantonne à la compta ; **décision client** (CLAUDE.md §5) : tout paramétrable/auditable, le comptable corrige après coup.
- **Stock mini** par fiche article → déclencheur rupture/réappro.
- **Étiquettes** : quantité par défaut = **stock réel** ; avec/sans code-barres ; avec/sans prix ; immédiate ou différée cumulable par poste (B12).
- **Sauvegarde obligatoire** avant tout inventaire, **finale** avant réintégration ; tous postes fermés pour génération de copie.
- **Multi-emplacements** par article (casier ≤ 12 car.) ; affiché en facturation, POS, picking.
- **Produits finis / incidents de stock** : détection anomalies parc ↔ fiche article (jointure véhicule↔article).

---

# Lien avec notre app (M5)

**Principe non négociable (CLAUDE.md règle 3 / B7)** : le **stock réel est une SOMME de mouvements append-only** (`stock_moves`), **jamais un champ qu'on UPDATE**. Toutes les opérations G8 ci-dessus se traduisent en **insertions de mouvements typés et tracés** (qui, quoi, quand, ancien→nouveau, origine), pas en écrasement de quantité.

Traduction des concepts G8 :
- **Stock réel** = vue/somme matérialisée de `stock_moves` (filtrée par `company_id`, casier, article). Le « réajustement annule-et-remplace » G8 = on **calcule l'écart** (`compté − somme_actuelle`) et on **insère un mouvement d'ajustement** de cet écart (origine = `inventaire`, méthode, opérateur). On n'« écrase » jamais : on génère le delta.
- **Réajustement mode cumul** = insertion d'un mouvement = quantité saisie (déjà un delta) — le plus naturel pour l'append-only.
- **Réajustement par casier à la volée** = mêmes mouvements, scoping par `location`/casier.
- **Remise à zéro** = mouvement(s) ramenant la somme à 0 (delta = `−stock_actuel`), avec flag « conserver V/O/P » (exclure les articles à n° de série/VIN).
- **Arrêté d'inventaire** = **snapshot daté immuable** (table `stock_snapshots` / type `arrete`) : copie des quantités à T ; ne reçoit pas les mouvements postérieurs, mais peut refléter les **prix** courants à l'édition. Les « copies du 15 / fin de mois » = snapshots `pg_cron`.
- **Réintégration** = transaction qui, pour chaque article, **insère le mouvement** portant le stock réel à `réel + arrêté` (idempotence à garantir : marquer l'arrêté `reintegrated`, refuser une 2ᵉ réintégration). La logique « remise à zéro post-génération » devient explicite : un mouvement de remise à zéro horodaté, puis réintégration qui additionne le compté.
- **Méthode d'inventaire** = entité `inventory_session` portant : `magasin_ouvert` (bool), `effacement` (bool), `edition_ecarts` (bool), `mode_reajustement` (annule_remplace | cumul | casier), `status` (machine à états reprenant les 8-13 étapes), `company_id`. L'état pilote quels écrans sont accessibles (l'onglet arrêté n'existe qu'en magasin ouvert).
- **Écart d'inventaire** = vue calculée `somme_mouvements_réels − snapshot_arrêté`, quantité + valeur (PAMP), exportable.
- **Historique mouvements** = lecture directe de `stock_moves` (par article, par date) — c'est *déjà* la table source, donc gratuit (vs G8 où c'est une fonction à part).
- **Dépréciation** = `price_changes` append-only sur le PAMP (taux + période d'entrée), auditable, réversible — jamais d'UPDATE direct du PAMP (B5/B7).
- **Étiquetage** = job d'impression (file différée cumulable par poste), quantité par défaut = stock réel calculé, options code-barres/prix.
- **Inventaire tournant** = `inventory_session` partielle récurrente (scope rayon/fournisseur), sans bloquer les ventes — naturel puisque tout est append-only.

À décider (ADR) : (1) doit-on exposer les 8 méthodes telles quelles ou les recomposer en **3 toggles** (ouvert/fermé × effacement × écarts) — recommandé pour l'UX moderne ; (2) périmètre de la dépréciation (gestion vs compta only) ; (3) granularité des snapshots automatiques (15/fin de mois + fin d'inventaire).
