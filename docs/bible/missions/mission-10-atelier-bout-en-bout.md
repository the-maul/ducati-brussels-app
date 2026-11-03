---
mission: 10
titre: Atelier de bout en bout — de l'arrivée de la moto à sa restitution
etat: 🟦
ouverte_le: 2026-11-03
modules: [M08, M05, M04, M06, M03, M10, M13]
---

# Mission 10 — Atelier de bout en bout

> **Objectif** : qu'un chef d'atelier puisse rentrer une moto, choisir l'entretien, voir les pièces
> (en stock, à réserver ou à commander), préparer sa picking list, démarrer l'entretien étape par
> étape avec les pièces et les couples, finir l'OR et rendre la moto, **sans ressaisir** d'un écran
> à l'autre : une seule chaîne, pas des pièces de puzzle.

Demande de Simon du 03/11/2026 (chat). Audit fait le 03/11/2026 : code de `main` (`55bcf9a`) et
base de production `ujmrosbgkvgvwfnuryna` lus, **écritures essayées dans des transactions
annulées** (administrateur simulé, société ITALBIKE `3d9f0f13-…`). Aucune migration appliquée,
aucune donnée gardée. Branche `mission-10-atelier`.

## 1. Le besoin

Simon, le 03/11 : « On a l'impression qu'on a beaucoup de pièces du puzzle pour l'atelier, mais
rien qui tient ensemble. Il faut pouvoir rentrer la moto, choisir l'entretien, voir s'il doit
commander des pièces (il peut les réserver dans le stock ou les commander), créer sa picking list,
démarrer son entretien et voir chaque étape avec les pièces et ce qu'il faut faire, step by step.
Tu vois autre chose ? On créerait une mission spéciale pour ça. »

Précision de Simon (vendeur de la concession) : les entretiens réels sont surtout **« entretien
annuel »** et **« entretien annuel + huile »** (= « Annual Service » / « Oil Service » de l'extract
DCS). Les kits d'entretien sont générés en ce moment par un autre agent, à partir des manuels et des
plans (« annuel », « annuel + huile », 1 000 km, pour chaque modèle-année) : cette mission **ne
refait pas ce travail**, elle en dépend.

Le constat de l'audit, en une phrase : **chaque morceau existe et marche seul** (OR, check-up,
signature, kits, picking list, panier, parcours technicien, prochain entretien, relances), mais
**« l'entretien choisi » n'est pas une donnée de l'OR** : chaque écran le redemande ou le devine à
sa façon, et rien ne passe d'une étape à la suivante.

## 2. Le parcours cible (9 étapes)

1. **Rendez-vous** (ou arrivée sans RDV) : client, moto, motif = l'entretien (annuel, annuel +
   huile, 1 000 km, autre), mécanicien et **temps bloqué** (temps Ducati de l'entretien).
2. **Ouverture de l'OR** : depuis le RDV (tout est repris) ou au comptoir ; km relevé ; l'entretien
   choisi est **enregistré sur l'OR** (échéance Ducati du manuel de la moto), proposé d'après le
   prochain entretien connu de la moto.
3. **Réception et check-up** : photos d'état, actions de l'entretien pré-remplies (temps Ducati,
   pièces du kit), constats (pneus, freins…), proposition envoyée, **accord signé** ou accord verbal.
4. **Pièces** : le kit de l'entretien face au stock : ce qui est là est **réservé** pour cet OR, ce
   qui manque part **dans le panier** (standard, ou urgente si le RDV est proche). Une seule
   action, un seul calcul.
5. **Picking list** : créée depuis l'OR (kit + pièces ajoutées), sans avoir à démarrer l'entretien ;
   préparée sur tablette, casiers, emplacement de préparation.
6. **Entretien pas à pas** : le technicien démarre sur l'entretien déjà choisi ; chaque opération
   montre la procédure du manuel, **ses pièces**, les couples, les figures, et son chrono (qui est la
   pointeuse) ; constats et photos pendant le travail.
7. **Fin des travaux** : pièces consommées = lignes de l'OR (avec article et prix), temps passé
   comparé au temps Ducati et au temps facturé, OR **« prêt »**, client prévenu.
8. **Restitution** : facture depuis l'OR (sortie de stock, réservation libérée), date des
   interventions reportées, fiche de restitution, clés rendues.
9. **Après** : prochain entretien recalculé (source « OR du DMS »), historique sur la fiche moto,
   registre des véhicules, relance 15 jours avant l'échéance suivante.

## 3. Ce que le DMS a (étape par étape, chiffres en base du 03/11/2026)

**Volumes atelier** : 7 OR (6 de démo « OR-SEED », 1 facturé en juin), **0 OR avec motif**,
**0 ligne de check-up**, 0 proposition signée ; 3 RDV (tous du portail, **sans motif**, 1 avec OR) ;
3 pointages ; **0 parcours** technicien ; **0 kit** ; 2 picking lists (de documents de vente,
**0 depuis un OR**) ; 0 commande de pièces ; 1 panier Ducati (15 lignes) ; 0 popup ; **0 mouvement
de réservation de stock** dans toute la base ; 0 intervention reportée ; 0 relance. Toutes les
migrations atelier citées « non appliquées » dans M08 / mission 07 **sont en fait en base**
(parcours, kits, picking depuis l'OR, check-up, prochain entretien, panier, popup, dossiers
accident) : les écrans tournent sur la vraie base, sans données.

**Référentiels** : 59 plans d'entretien « posters » (98 rattachements fermes au catalogue, **282
motos** couvertes) ; **461 manuels d'atelier** en base (3 336 procédures, 36 326 étapes, 28 988
opérations, 1 949 échéances), 418 rattachements fermes, **1 348 motos du parc** reliées à un manuel ;
13 196 figures dans le stockage `wsm-images` (privé) ; taux horaire **90 € HT** (Paramètres → Frais
de devis atelier) ; 11 motifs d'entrée (`entretien_annuel`, `entretien_1000`, `entretien_15000`,
`entretien_30000`, `vidange`, pneus, freins, accident, garantie, diagnostic, autre) ; prochain
entretien connu pour 2 866 motos (223 extract DCS, 1 facture G8, 2 642 estimations « plan ») ;
1 226 échéances dépassées, 773 dans les 60 jours (123 de source fiable).

| # | Étape | Ce qui existe | État |
|---|---|---|---|
| a | RDV / arrivée | Planning semaine (`/workshop/planning`), RDV avec client, moto (sélecteur partagé du 03/11), mécanicien en **texte libre**, durée saisie, motif (03/11), popup « pièces manquantes » ; demande de RDV du portail (relance) ; « Créer l'OR » depuis le RDV. Arrivée sans RDV = Nouvel OR. | **partiel** : pas de capacité par mécanicien (`workshop_load` sans appelant), temps bloqué saisi à la main, motif du RDV **perdu à la création de l'OR** (corrigé, §4 n° 6) |
| b | Ouverture de l'OR | `/workshop/new` et fiche OR : client + moto (corrigé le 03/11, `cd50704`), km, opérateur (texte), motif d'entrée, travaux, observations, lignes, GED photos. | **partiel** : le motif est une liste « posters » (15 000 / 30 000 km) qui ne connaît pas « annuel + huile » ; **l'échéance Ducati n'est pas enregistrée sur l'OR** ; le km du RDV n'est pas repris |
| c | Check-up, proposition signée | Onglet Check-up tablette, pré-remplissage depuis le plan, constats photo / temps / pièces / prix, proposition `DEV-` envoyée dans la langue du client, signature à distance ou au doigt, accord verbal, garde-fou, reportées. Essayé en transaction : OK. | **fait** (à valider) — mais le pré-remplissage lit les **posters** (282 motos), pas les manuels (1 348) ; les pièces n'arrivent que si un kit correspond au code du poster |
| d | Pièces : kit → stock → réserver ou commander | Kits par famille de moteur × échéance (écran prêt, **0 kit**), calcul du manquant (`repair_order_order_needs`, essayé : filtre à huile 44440312B, 40 en stock, rien à commander), « Commander les pièces manquantes » (commande de pièces typée), « Ajouter au panier standard », popup à l'ouverture de l'OR. | **partiel** : **aucune réservation de stock depuis l'OR** (n'existe que pour RES / BL et le site) ; **trois chemins** pour commander ; le panier n'est pas compté « en commande » dans le manquant de l'OR ; consommables (huile 3,4 l, liquides) sans article |
| e | Picking list depuis l'OR | `picking_open_for_repair_order`, vue tablette `/preparation/…` (préparé / monté, casier, emplacement), impression. Essayé : **sans parcours démarré, liste vide** ; après parcours + kit généré en transaction : 6 lignes (filtre, bouchon, huile 3,4 l, liquide de refroidissement 2,5 l, liquide de frein, huile de fourche 411 cm³). | **partiel** : la liste lit l'échéance **du parcours technicien** — il faut démarrer l'entretien avant de préparer les pièces (ordre inversé) ; elle reprend aussi les pièces refusées par le client |
| f | Parcours technicien pas à pas | `/workshop/journey/$orId` : choix de l'échéance, opérations, procédure du manuel étape par étape, couples, avertissements, outils, constats, photos, chrono par opération, reprise après coupure, récapitulatif. **Lit les vraies données** (vues `ducati_manual_*` en base, bandeau « démonstration » inactif) ; avancement enregistré en base (`workshop_journeys`, essayé). | **partiel** : **figures invisibles en production** (URL `/manuels/…` locale, stockage privé non signé) ; l'échéance est re-choisie (ignore le motif et le prochain entretien connu) ; **pas de pièces par opération** ; chronos hors pointeuse (`workshop_time_entries.journey_operation` jamais écrit) ; la route ne vérifie pas l'accord client (seul le bouton est grisé) |
| g | Fin : pièces, temps, OR prêt | « Reporter sur l'OR » (pièces à **0 € sans article**, observations, note de travaux) ; temps passé / Ducati / facturé affichés au récapitulatif ; temps pointé sur l'OR. | **partiel** : le report **effaçait l'état du check-up** (corrigé, §4 n° 5) ; pièces du kit jamais converties en lignes facturables ; **aucun passage « prêt »** ni avis au client (ATE018) ; pas de rapprochement par mécanicien |
| h | Restitution | « Transformer en facture » (sortie de stock des lignes pièce, actions ok / reportées exclues), étape « date des interventions reportées » (+30 j), prochain entretien recalculé à la facture (essayé : « plan 08/01/2027 » → « OR du DMS 03/11/2027 »), relances CRM (interrupteur Arrêté / Test / Actif). | **partiel** : transformation non atomique (facture puis OR) ; **pas de fiche de restitution** ni d'historique des OR sur la fiche moto ; registre des véhicules à moteur en cours (autre agent) |
| i | Relance suivante | `vehicles_maintenance_upcoming` + page Relances (15 j avant, J+5 → CRM). | **fait** (à valider), dépend de l'interrupteur et des sources fiables |

## 4. Les coutures cassées (ce qui ne passe pas d'une étape à la suivante)

Classées de la plus grave à la moins grave.

1. **« L'entretien choisi » n'existe nulle part sur l'OR.** Le motif (`reason_code`) sert au
   check-up et au popup ; le parcours technicien redemande l'échéance (`workshop_journeys`) ; la
   picking list ne lit **que** le parcours ; le check-up lit les plans « posters », le parcours et
   les kits lisent les manuels ; l'échéance connue de la moto (`vehicle_maintenance_due`) n'est lue
   que pour un bandeau. Trois sources, trois noms (« entretien_annuel », « Annual Service »,
   « annual_service »), aucune ne fait foi.
2. **Pas de réservation de stock pour l'atelier.** Le disponible affiché ne protège pas les pièces
   d'un entretien prévu : le comptoir ou le site peuvent vendre le dernier filtre à huile de la
   moto qui arrive demain. 0 mouvement de réservation en base, aucun chemin depuis l'OR.
3. **Les pièces préparées ne deviennent pas des lignes de l'OR.** La picking list (kit) et le
   report du parcours (pièces à 0 €, sans article) ne créent pas de ligne pièce facturable : à la
   facture, le kit n'est **ni facturé ni sorti du stock**, sauf si quelqu'un l'a ressaisi.
4. **Picking list avant l'entretien impossible.** Sans parcours démarré, « Créer la picking list »
   crée une liste **vide** sans le dire ; les boutons « picking » et « commander » du parcours ne
   sont qu'au récapitulatif final, donc après le travail.
5. **Le report du parcours effaçait le check-up** — **corrigé** (`journey/api.ts`) : les lignes de
   l'OR étaient réécrites sans leur carte, leur état, leur photo ni leur lien vers la proposition ;
   une action refusée par le client (« reportée ») redevenait facturable, une action « OK » aussi.
6. **Le motif du RDV ne suivait pas l'OR** — **corrigé** (`planning-api.ts`) : un RDV « Entretien
   annuel » donnait un OR sans motif, donc sans pré-remplissage ni contrôle des pièces.
7. **Trois façons de commander** (popup, « Commander les pièces manquantes », « Ajouter au panier
   standard ») et le panier n'est pas compté « en commande » dans le manquant de l'OR
   (`article_on_order_for` ignore `supplier_basket_lines`) : une pièce mise au panier peut être
   recommandée par l'autre bouton.
8. **Chronos en double.** La pointeuse (`workshop_time_entries`) et les chronos du parcours (dans
   l'état du parcours) ne se parlent pas : le temps passé de l'OR et celui du récapitulatif
   diffèrent, B11 n'est rapproché nulle part.
9. **Figures des manuels absentes en production** : les 13 196 figures sont dans le stockage privé
   `wsm-images`, l'écran les cherche sur `/manuels/…` (copie locale) : « figure non disponible ».
10. **Pas de fin de travaux** : rien ne passe l'OR à « prêt », personne n'est prévenu, le comptoir ne
    sait pas quoi facturer ni rendre.
11. **Le bandeau « prochain entretien » du check-up lisait une ancienne ligne sans libellé** —
    **corrigé** (`checkup/api.ts`) : ligne courante, libellé traduit comme sur la fiche moto.

## 5. Cartes proposées (par ordre de réalisation)

Estimations en jours de travail d'agent, test compris. « Dépend de » = carte ou lot à faire avant.

| # | Carte | Pourquoi | Test à faire dans l'app | Jours | Dépend de |
|---|---|---|---|---|---|
| 1 | **L'entretien choisi est enregistré sur l'OR** | Couture n° 1 : un seul « entretien choisi » (échéance Ducati du manuel de la moto : Annual Service, Oil Service, Oil Service 1000, Desmo / Valve Check) posé à l'ouverture de l'OR ou repris du RDV, proposé d'après le prochain entretien connu et le km ; lu par le check-up, le popup, la picking list et le parcours (qui démarre dessus sans redemander). Motifs alignés : « Entretien annuel », « Entretien annuel + huile », « 1 000 km », « Desmo », « Autre ». | RDV « Entretien annuel + huile » → Créer l'OR : l'OR affiche « Oil Service » pour la Streetfighter V4 SP2 ; Démarrer le parcours : il s'ouvre sur Oil Service sans écran de choix. | 2 | Question 1 |
| 2 | **Les kits en base, consommables désignés** | Sans kit, popup, pièces du check-up, picking et manquant sont vides (0 kit aujourd'hui). Lot de l'autre agent ; ici seulement : désigner une fois les articles huile moteur / liquides (`maintenance_fluid_article_set`), vente au litre. | Atelier → Kits : un kit « Oil Service » a filtre + bouchon + huile 3,4 l avec un article et un casier. | 0,5 (+ lot kits) | lot kits, question 4 |
| 3 | **Figures des manuels visibles en production** | Couture n° 9 : URL signées du stockage `wsm-images` au lieu de `/manuels/`. | Parcours d'une moto reliée à un manuel → une procédure : les figures s'affichent et se zooment, sur la tablette de l'atelier. | 0,5 | — |
| 4 | **Le check-up se pré-remplit depuis le manuel et le kit** | Le pré-remplissage lit les 59 posters (282 motos) ; les manuels couvrent 1 348 motos et donnent opérations + temps UT ; le kit donne les pièces au prix de vente. | OR d'une moto reliée à un manuel, motif « Entretien annuel » → Check-up → Pré-remplir : une carte « Annual Service » avec temps Ducati, pièces du kit et prix, puis les opérations. | 1,5 | 1, 2 |
| 5 | **Les pièces de l'entretien deviennent des lignes de l'OR** | Couture n° 3 : à la validation de l'entretien (check-up ou ouverture), les pièces du kit entrent en lignes pièce de l'OR (article, quantité, PV) ; le report du parcours propose des pièces **avec article** (recherche) et non à 0 € ; la picking list ne reprend plus les actions OK / reportées. | OR entretien → les lignes du kit sont sur l'OR ; facture → les pièces sont facturées et le stock baisse d'autant. | 1,5 | 2, 4 |
| 6 | **Réserver les pièces de l'entretien dans le stock** | Couture n° 2 : réservation (mouvements `reservation`, origine atelier, réf. n° d'OR) des pièces de l'OR disponibles, à l'accord client ou à la picking list ; libérée à la facture ou à l'annulation ; disponible et casier visibles sur l'OR. Règle critique (tests obligatoires, règle 7). | OR avec filtre à huile (40 en stock) → « Réserver » : Stock affiche réservé 1, disponible 39 ; facture → réservé 0, réel 39. | 2 | 5, question 2 |
| 7 | **Une seule façon de commander depuis l'atelier : le panier** | Couture n° 7 : popup, « Commander les pièces manquantes » et « Ajouter au panier » fusionnés en un bouton « Commander ce qui manque » (standard, ou urgente si RDV < N jours) ; les lignes du panier comptent « en commande » dans le manquant. | Ajouter au panier depuis l'OR → rouvrir : « Rien à commander » ; le panier montre la ligne avec le n° d'OR. | 1 | 6, question 3 |
| 8 | **Picking list avant l'entretien** | Couture n° 4 : la liste lit l'entretien de l'OR (carte 1), plus le parcours ; message clair si rien à préparer ; boutons picking / commander aussi au début du parcours. | OR sans parcours → Créer la picking list : les pièces du kit et de l'OR, casiers, disponible. | 0,5 | 1, 5 |
| 9 | **Chaque opération montre ses pièces** | Demande « chaque étape avec les pièces » : les besoins du kit sont déjà reliés aux libellés d'opérations (`matched_labels`) ; les afficher sur l'opération (référence, quantité, casier, préparée oui / non). | Parcours Oil Service → opération « Vidange de l'huile moteur et remplacement du filtre » : filtre 44440312B, bouchon, huile 3,4 l, casier AT/STOCK BAS. | 1,5 | 2, 8 |
| 10 | **Le chrono du parcours est la pointeuse (B11)** | Couture n° 8 : un démarrage / arrêt d'opération écrit un pointage `travail` (colonne `journey_operation`) au nom du technicien connecté ; temps passé de l'OR = un seul total ; temps passé / Ducati / facturé par OR et par mécanicien (Rapports). | Démarrer 10 min sur une opération → Pointeuse et fiche OR montrent 10 min ; Rapports → Productivité : ligne du mécanicien. | 2 | question 5 |
| 11 | **Fin des travaux : OR prêt, client prévenu** | Couture n° 10 : bouton « Travaux terminés » au récapitulatif (report sur l'OR, OR « prêt », cloche comptoir) ; mail « votre moto est prête » dans la langue du client, sous l'interrupteur des relances (ATE018). | Terminer un parcours → l'OR passe « Prêt », le comptoir a une cloche, le client (en mode Test : l'adresse de test) reçoit le mail. | 1,5 | 5, question 7 |
| 12 | **Restitution : fiche de restitution et facture sûre** | Fiche de restitution (travaux faits, reportées et leur date, prochain entretien, km de sortie), signature au doigt facultative ; facture et passage de l'OR en « facturé » dans une seule transaction (piège M08 §7). | OR prêt → Restituer : fiche PDF, facture, OR facturé ; un double clic ne crée pas deux factures. | 1,5 | 11, question 10 |
| 13 | **Tableau du chef d'atelier** | Voir d'un coup d'oeil les OR du jour par état : à réceptionner, attente accord, attente pièces, prêt à préparer, en cours (qui, depuis quand), prêts, à facturer. | Atelier → Aujourd'hui : chaque OR d'essai apparaît dans la bonne colonne au fil du parcours. | 1,5 | 1, 6, 11 |
| 14 | **Planning de charge par mécanicien** | Mécaniciens = comptes de l'équipe (rôles mécanicien / chef d'atelier), horaires, capacité par jour ; temps bloqué = temps Ducati de l'entretien choisi ; `workshop_load` branché ; absences. | Nouveau RDV « Entretien annuel » : 1 h 30 bloquée chez le mécanicien choisi, sa journée passe à 80 % ; au-delà de 100 % : alerte. | 3 | 1, question 5 |
| 15 | **Historique des OR sur la fiche moto** (ATE017) | La fiche moto ne liste pas ses OR ; indispensable à la réception (« qu'a-t-on fait la dernière fois ? »). | Fiche moto → onglet Atelier : OR, date, km, entretien, montant, lien. | 0,5 | — |
| 16 | **Photos d'état guidées à la réception** | Aujourd'hui GED libre : guider 4 côtés + compteur + dégâts, horodatées, reprises sur la fiche de restitution. | Nouvel OR → Réception : 5 cases photo, la fiche de restitution les montre. | 0,5 | 12 |
| 17 | **Pièces apportées par le client** | Ligne « pièce client » sans article ni stock, mention sur la facture (pas de garantie pièce). | OR → « + Pièce du client » : ligne à 0 €, mention imprimée, aucun mouvement de stock. | 0,5 | — |
| 18 | **Moto de courtoisie suivie** (ATE005) | 11 motos « courtoisie » en base, prêt en texte libre : contrat de prêt, km et carburant départ / retour, état, signature, rappel de retour. | RDV avec courtoisie → prêt ouvert sur la moto ; retour : km, alerte si non rendue. | 2 | question 9 |
| 19 | **Garantie Ducati ou magasin (B10 complet)** | Invariant B10 incomplet : pas de distinction Ducati / magasin, pas de cession garantie, coût jamais suivi (ATE016, ATE020). Assez gros pour une mission à part. | OR garantie Ducati → lignes en cession garantie, état d'avancement, refus partiel re-routé au client. | 3 | question 8 |
| 20 | **Motif d'entrée et type de réparation : un seul choix à l'accueil** | Doublon apparent sur la page OR (retour du 03/11) : « Accident », « Garantie », « Pneus », « Diagnostic » sont dans les deux listes. *Reco* §9. Chaque motif porte son type (colonne « Type » du motif dans Paramètres → Tables) ; l'OR garde `repair_type` pour l'imputation et les stats, affiché en lecture, modifiable. | Nouvel OR, motif « Garantie Ducati » → type « Garantie Ducati » posé, prise en charge garantie affichée ; aucun deuxième choix à faire. | 0,5 | question 11 |
| 21 | **Kilométrage contrôlé et repris du RDV** | Le km se saisit à vide : rien n'empêche 1 200 km sur une moto déjà relevée à 18 000 km ; le km du RDV n'est pas repris (couture b). Alerte si km < dernier km connu (OR, déclaration client, DCS), reprise du RDV. | OR d'une moto relevée à 18 000 km → saisir 1 200 : alerte « inférieur au dernier relevé (18 000 km le …) ». | 0,5 | — |
| 22 | **Barre d'actions de l'OR allégée** | Neuf boutons de même poids en tête de l'OR (facture, devis, parcours, picking, deux façons de commander, dossier accident, retour) : le chef d'atelier ne voit pas l'essentiel. Garder « Transformer en facture » + l'action de l'étape en cours, le reste dans un menu « Plus ». Dépend de la carte 7 (un seul bouton commander). | OR en cours : 3 boutons visibles + « Plus » ; OR accident : bandeau du dossier accident en tête. | 0,5 | 7 |
| 23 | **Mécanicien affecté distinct de l'opérateur** | L'opérateur (03/11) = qui a l'OR à son nom (réceptionnaire). Le mécanicien du RDV est un texte libre et n'arrive pas sur l'OR. Colonne `mechanic_id` (membre atelier), reprise du RDV, lue par la pointeuse et le planning de charge (carte 14). | RDV avec « John » → Créer l'OR : opérateur = connecté, mécanicien = John ; Pointeuse : John voit l'OR. | 0,5 | question 5, 14 |
| 24 | **Remise client et PV HT partout** | Le 03/11 la remise du client (Clients → Tarifs clients, `resolve_customer_price`) est posée sur les lignes de l'OR ; pas encore sur les documents de vente ni la caisse ; `sale_article_exact_lookup` (coller une réf. e-catalog) renvoie encore un PV HT vide pour les articles au TTC seul. | Client avec remise 10 % → devis : la ligne a 10 % ; coller une réf. e-catalog d'un article au TTC seul : PU HT non nul. | 0,5 | — |
| 25 | **Changer l'article d'une ligne** | Une ligne pièce choisie devient un texte modifiable sans référence visible ; pour changer d'article il faut supprimer la ligne. Afficher la référence, le stock et un bouton « changer ». | Ligne « Plaquettes » → changer → rechercher → la ligne garde sa quantité, prend le nouvel article et son prix. | 0,5 | — |

Cartes 20 à 25 ajoutées le 03/11 après les retours du client sur « Nouvel OR » (§9).

Ordre conseillé : **1 → 2 → 3** (indépendantes, ouvrent tout), puis **4 → 5 → 6 → 7 → 8** (la chaîne
des pièces), **9 → 10 → 11 → 12** (le travail et sa fin), puis 13 à 19. Total ≈ 27 jours ; le cœur
demandé par Simon (cartes 1 à 12) ≈ 17 jours.

### Ce qu'un vrai atelier a en plus (« tu vois autre chose ? »)

| Indispensable au go-live | Utile ensuite |
|---|---|
| Planning de charge par mécanicien et temps bloqué (carte 14) | Pont / poste de travail réservé dans le planning |
| Huile et liquides au litre, désignés une fois (carte 2) | Travaux sous-traités (peinture, jantes, sellerie) avec leur bon et leur coût |
| OR « prêt » + client prévenu (carte 11) | Essai routier tracé (km départ / retour, qui) |
| Fiche de restitution + facture atomique (carte 12) | Notes internes non visibles du client (ATE012, colonne `notes` déjà en base) |
| Historique des OR sur la fiche moto (carte 15) | Étiquette de clé / porte-clés numéroté imprimé avec l'OR |
| Tableau du chef d'atelier (carte 13) | Pièces apportées par le client (carte 17) |
| Garantie Ducati / magasin, B10 (carte 19, mission à part) | Moto de courtoisie suivie (carte 18) |
| Un compte (ou un code) par mécanicien pour pointer (question 5) | Photos d'état guidées (carte 16), impression de l'OR (libellé existant sans bouton) |

## 6. Questions pour Simon / Domenico

1. **« Entretien annuel » et « annuel + huile »** : faut-il comprendre « Annual Service » et « Oil
   Service » de Ducati ? Attention : sur les motos récentes le manuel met **déjà la vidange dans
   l'Annual Service** (vérifié sur une Streetfighter V4 SP2 : Annual Service = filtre, bouchon, huile
   3,4 l, liquide de refroidissement, liquide de frein, huile de fourche ; Oil Service = filtre,
   bouchon, huile). *Reco* : les motifs de l'OR = les échéances du manuel de la moto, avec vos mots
   (« Entretien annuel », « Entretien annuel + huile », « 1 000 km », « Desmo », « Autre ») ; on
   retire « 15 000 km » / « 30 000 km » qui viennent des posters.
2. **Réserver les pièces** : quand ? À l'accord du client, à la picking list, ou dès le RDV ?
   *Reco* : à l'accord du client (ou à l'ouverture de l'OR sans proposition), libérées à la facture.
3. **Commander** : on garde un seul bouton qui va au panier (standard ; urgente si le RDV est à moins
   de N jours — combien ?) et on retire « Commander les pièces manquantes » (commande de pièces) ?
   *Reco* : oui, N = 3 jours.
4. **Huile et liquides** : quels articles (bidon 1 l, 4 l, fût à la pompe) et facturés au litre ?
   *Reco* : un article par produit, vendu au litre (quantité décimale), désigné une fois par l'atelier.
5. **Les mécaniciens** : combien, leurs noms, leurs horaires ; un compte chacun ou une tablette
   partagée avec un code ? Combien de ponts ? *Reco* : un compte chacun (4 comptes atelier existent),
   connexion rapide sur la tablette.
6. **Temps facturé d'un entretien** : le temps Ducati × 90 € HT (forfait), ou le temps réellement
   passé ? *Reco* : le temps Ducati, l'écart reste visible pour la productivité.
7. **Fin des travaux** : prévenir le client automatiquement (mail ; SMS quand un fournisseur sera
   choisi) ? Qui reçoit l'alerte « moto prête » au comptoir ?
8. **Garantie** : qui monte les dossiers garantie Ducati aujourd'hui et où (portail Ducati) ? Faut-il
   les suivre dans le DMS dès le go-live ?
9. **Motos de courtoisie** : contrat de prêt, caution, km, carburant : à suivre dans le DMS ?
10. **Restitution** : voulez-vous une fiche de restitution signée par le client (travaux faits,
    reportées, prochain entretien) ?
11. **Motif et type de réparation** : un seul choix à l'accueil (le motif, qui donne le type), ou
    garder deux listes ? *Reco* : un seul choix, type déduit et modifiable (carte 20).
12. **Opérateur** : est-ce le réceptionnaire (qui a l'OR à son nom) ou le mécanicien qui répare ?
    *Reco* : l'opérateur = réceptionnaire / responsable de l'OR, un champ « Mécanicien » à part (carte 23).

## 7. Ce qui a changé dans l'application (audit du 03/11)

Trois corrections franches, sans migration (commit de la mission) :

- `src/modules/workshop/journey/api.ts` — « Reporter sur l'OR » recopie les lignes existantes **avec**
  leur état de check-up (carte, état, photo, ligne de proposition) : une action refusée par le client
  reste reportée et non facturée.
- `src/modules/workshop/planning-api.ts` — « Créer l'OR » depuis un RDV reprend le **motif** du RDV.
- `src/modules/workshop/checkup/api.ts` — le bandeau « prochain entretien » du check-up lit la ligne
  **courante** de la moto et affiche son libellé (« Annuel », « Vidange (Oil Service) »…).

## 8. Risques et points d'attention

- **Dépendance aux kits** : tant que le lot kits n'est pas en base, les cartes 4 à 9 se testent sur
  un kit généré en transaction annulée (`maintenance_kit_generate(<société>, 50, 0, '<modèle-année>')`,
  4 kits créés pour la Streetfighter V4 SP2 dans l'essai du 03/11).
- **Réservations = règle critique** (règle 7) : tests obligatoires, mouvements append-only (B7).
- **Les bibles M08 et mission 07 disent « non appliquée »** pour des migrations qui sont en base
  (vérifié le 03/11) : à corriger lors de la prochaine mise à jour de ces chapitres.
- **Deux référentiels d'entretien** (posters et manuels) : la carte 1 doit trancher lequel fait foi
  pour le temps et les opérations (*reco* : le manuel de la moto, le poster en repli).

## 9. Retours du client sur « Nouvel OR » (03/11/2026, ATE001b) — fait

Simon a testé « Nouvel OR » (captures du 03/11). Livré sur `main` (branche `fix-page-or`), migration
`20261103230000_m8_page_or.sql` **écrite, essayée en transaction annulée, non appliquée** ; l'écran
marche sans elle (repli).

| # | Retour | Ce qui était cassé, et pourquoi | Ce qui change |
|---|---|---|---|
| 1 | Opérateur en texte libre (rouge) | Champ `Input` libre, rien ne le reliait à un compte. | Liste de l'équipe (`company_members` : mécaniciens, chef d'atelier, administrateurs dont Domenico ; le connecté y est toujours), **connecté par défaut**, modifiable ; id dans `repair_orders.operator_id` (après migration ; avant : le nom seul), le nom reste dans `operator` ; ancien OR : le texte retrouve son membre (« SIMON ») ou reste affiché « (ancienne saisie) » (« thierry »). |
| 2 | Type de réparation libre (« on ne doit pas avoir une liste ? ») | `Input` libre ; une table « Types de réparation » (`repair_type`) existait dans Paramètres mais vide et jamais lue. | Liste réglable `workshop_repair_type` (11 types préchargés), pré-remplie par le motif (entretien / vidange → Entretien, accident → Accident / carrosserie, pneus, freins → Réparation, diagnostic) sans écraser un choix manuel ; « ENTRETIEN » des OR de démo retrouve son code, « calandre » reste en « ancienne saisie ». |
| 3 | « FREIN » : propositions cachées sous le cadre, 2 propositions obscures | La liste était un bloc `absolute` dans le tableau des lignes (`overflow-x-auto`) : coupée par le conteneur. La recherche (`part_order_article_search`, limite 8) triait par référence : sur 1 413 articles « frein », les 8 premiers « 000028810… » (anciens modèles, rien en stock) ; seuls 2 tenaient dans la zone visible. | Un seul composant `ArticleLinePicker` (OR, check-up, documents de vente) : liste en surcouche (Popover, portail), flèches / Entrée / Échap, 20 résultats avec stock, casier et PV HT ; nouvelle fonction `article_line_search` : référence / code-barres exact, début de référence, puis désignation (tous les mots, aussi l'original fournisseur), **en stock d'abord**, catalogue après. Essai : « FREIN » → pédales, pompes, disques, leviers en stock ; « 44440312B » → le filtre à huile en premier. Sans la migration : ancienne fonction, 20 résultats, en stock d'abord. Les désignations sont déjà en FR (`designation` = version FR ; 1 article traduit sur 93 784 : la traduction du catalogue reste à lancer). |
| 4 | PU HT à 0, TVA 21 en dur | 81 089 articles sur 93 784 n'ont que leur PV TTC (`sale_price_ht` vide) ; la recherche renvoyait `coalesce(sale_price_ht, 0)`. Même défaut dans les ventes, la caisse et le check-up. | PU HT = PV HT, sinon PV TTC / (1 + TVA), arrondi catalogue de la société ; TVA de l'article ; remise du client (Tarifs clients) posée si elle existe (0 règle en base aujourd'hui) ; une ligne passée en main-d'œuvre prend le taux horaire atelier (90 € HT). Corrigé à la source (`searchSaleArticles`) : ventes, caisse, check-up aussi. |
| 5 | Motif « Accident », aucun dossier dans Dossiers accident | Rien n'ouvrait le dossier à l'enregistrement : seul un bouton parmi neuf en tête de l'OR (OR-2026-00003, motif accident, 0 dossier en base). L'écran Dossiers accident liste bien tous les statuts, brouillons compris. | À l'enregistrement d'un OR accident (motif ou type), le dossier est **créé en brouillon**, lié à l'OR, au client, à la moto et à l'expert (jamais deux) ; bandeau « Dossier accident » bien visible sur l'OR (statut + « Ouvrir le dossier » / « Créer le dossier ») ; le bouton d'en-tête dit « Voir le dossier accident » s'il existe. |
| 6 | Revue de la page | Garantie et expert toujours affichés ; ordre mélangé. | Ordre : client, moto, km / motif, type, opérateur / statut, puis **garantie seulement pour un OR garantie** et **expert + date seulement pour un accident** (restent visibles s'ils sont remplis) / travaux demandés, observations. Le reste : cartes 20 à 25 ci-dessus. |

**Recommandation motif / type de réparation** : ce ne sont pas les mêmes informations — le **motif**
dit *pourquoi la moto entre* (il pilote l'entretien choisi, le check-up, le kit, la carte 1), le
**type** dit *comment l'OR s'impute* (garantie Ducati ou magasin, ORO au coût de revient, PDI, accident :
stats et facturation, B3 / B10). Mais demander les deux à l'accueil fait doublon (accident, garantie,
pneus, diagnostic sont dans les deux listes). *Reco* : **un seul choix à l'accueil**, le motif, chaque
motif portant son type dans Paramètres (carte 20) ; le type reste une colonne de l'OR, pré-rempli,
visible et modifiable (« Entretien annuel » → Entretien ; « Garantie » se dédouble en « Garantie
Ducati » / « Garantie magasin »). Pas de fusion sans décision (question 11).

Questions 11 et 12 ajoutées au §6.

**Essai à blanc (03/11, transaction annulée, administrateur simulé, société ITALBIKE)** : colonne
`operator_id` posée, OR d'essai au nom de « Simon-atelier », opérateur hors société refusé (« L'operateur
choisi n'est pas membre de la societe. »), 11 types préchargés, dossier accident en brouillon lié à l'OR,
`article_line_search` : « FREIN » 20 articles en stock en tête, « plaquette frein » (tous les mots),
« 44440312B » exact en premier. Rien gardé.

Application (après backup et go) :
`npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103230000_m8_page_or.sql`
