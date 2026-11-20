# Revue UX / UI du DMS — 20/11/2026

> **Demande du client (Simon)** : un passage UI et UX sur tout le DMS, « pour l'ergonomie humaine ».
> Mot pour mot : « par exemple pour "mon atelier", ça va pas du tout, c'est brouillon, je comprends
> jamais où j'en suis… fais-moi des retours ».
>
> **Utilisateurs** : un concessionnaire, un chef d'atelier, des mécaniciens sur tablette, des vendeurs
> et des magasiniers. Tous connaissent G8 : un logiciel ancien et dense, mais qu'ils maîtrisent.
>
> **Branche** : `lot-ux-ui` (worktree `wt-lot-ux-ui`, depuis `origin/main` `eb56025`). Aucune migration
> (plage réservée 20261120140000 → 149999 : non utilisée).

## Comment la revue a été faite

- **Site** : le site déployé `ducatilive.netlify.app`, compte admin de Simon, société **ItalTest**
  (bandeau jaune). J'ai joué la tâche principale de chaque écran comme le ferait l'utilisateur concerné.
- **Tailles d'écran** :
  - poste fixe : 1280 × 800 ;
  - tablette en paysage : 1024 × 768 ;
  - tablette en portrait : 768 × 1024 ;
  - téléphone : 375 × 812.
- **Mesures automatiques** sur chaque écran (script dans la page) :
  - nombre d'éléments cliquables ;
  - cibles de moins de 44 / 48 px ;
  - boutons sur fond rouge Ducati ;
  - arrondis de plus de 8 px ;
  - textes de moins de 12 px ;
  - débordement horizontal ;
  - hauteur de la page.
- **Arrondis** : aucun écran ne dépasse 8 px, la charte est respectée sur ce point partout.
- **Couleurs** : je n'ai trouvé aucune couleur écrite en dur. Les couleurs passent par les tokens.
- **Captures** : dans `docs/revue-ux-captures/`. Elles sont en basse définition : le panneau du
  navigateur fait 375 px de large et réduit l'image.
- **Données de test créées dans ItalTest** (à supprimer si besoin) :
  - un RDV du 20/11 à 09:00 : Didier Dupont, Monster 696, compagnon John, « TEST UX - entretien annuel » ;
  - l'OR **TESTOR-2026-00001**, né de ce RDV ;
  - la réservation du RDV, qui a mis 2 pièces au panier urgente d'ItalTest (filtre à huile, huile).
- **Ce que je n'ai pas fait** :
  - aucun pointage : voir le constat n° 1 ;
  - aucun encaissement ;
  - aucun changement dans « Mise en production ».

**Notes : 1 = inutilisable, 3 = utilisable avec effort, 5 = évident sans formation.**
**Coûts : S ≈ ½ journée, M ≈ 1 à 3 jours, L ≈ une semaine ou plus.**

---

## Les 10 constats les plus importants

### 1. « Mon atelier » affiche un état faux, ce qui pourrait toucher la vraie société (bug à traiter avant la mise en production)

Ce que j'ai vu :
- L'en-tête de « Mon atelier » (ItalTest) disait **« Aucun pointage en cours »**.
- Au premier « Démarrer », le DMS a répondu : « Vous pointez déjà sur l'OR **OR-2026-00003** depuis
  13:22. Il sera mis en pause… ».
- OR-2026-00003 est un OR d'**ITALBIKE STORE**.

Ce que ça veut dire :
- L'écran lit les pointages de la société active seulement.
- La fonction de pointage (`workshop_work_start`, règle « un seul pointage actif par mécanicien ») les
  regarde **toutes sociétés confondues**.
- Démarrer une moto dans ItalTest aurait donc mis en pause un vrai pointage d'ITALBIKE. J'ai annulé
  (capture 05).

À trancher : la règle « un seul pointage actif » vaut-elle par société ou pour toute la personne ? Dans
les deux cas, l'en-tête doit montrer ce pointage, avec sa société. → **lot de correction, pas un quick win.**

### 2. Sur tablette, l'information utile n'est jamais dans le premier écran

- **« Mon atelier » en tablette paysage** : la première moto commence à 690 px, sur un écran de
  768 px. Au-dessus, on trouve :
  - le bandeau ItalTest ;
  - le titre ;
  - le nom et la date ;
  - le choix de l'atelier ;
  - un encadré bleu d'explication ;
  - un bloc « Aucun pointage en cours ».
- **« Mon atelier » sur téléphone** : la première moto commence à 931 px. Rien n'est visible sans faire
  défiler (captures 01, 03, 04).
- **La fiche OR en tablette** fait **6 100 px de haut**. Le client, la moto et le kilométrage n'arrivent
  qu'après **6 écrans**, sous la liste de 28 opérations (capture 07).

### 3. Le menu latéral reste ouvert sur tablette

- Le menu de 240 px reste ouvert en 1024 px et en 768 px. En portrait, il prend **un tiers de l'écran**.
- Conséquence : le titre « OR TESTOR-2026-00001 » s'écrit sur 4 lignes (capture 08).
- La charte (§4.2) demande un menu replié sous 1280 px. → **corrigé (quick win).**

### 4. Des titres de page écrasés en colonne

- Écrans touchés :
  - Achats & réceptions (8 boutons en tête) ;
  - Stock (6 boutons) ;
  - fiche client ;
  - et tous les écrans qui ont beaucoup d'actions.
- Sur ces écrans, le titre et la description tombent dans une colonne de 60 à 100 px : une lettre ou
  un mot par ligne. Ça arrive en 1280 px comme en 1024 px (captures 16, 17, 18).
- → **Corrigé (quick win)** : les boutons passent sous le titre quand ils ne tiennent pas à côté.

### 5. Le rouge Ducati est partout, donc il n'indique plus rien

- La charte veut **un seul bouton primaire par écran**. Voici ce que j'ai compté :

| Écran | Boutons rouges |
|---|---|
| Photos de réception | **7** (6 × « Prendre la photo » + « Terminer et démarrer ») — capture 06 |
| Fiche moto | 4 (3 × « Enregistrer » + « Ajouter la prime ») |
| Fiche OR | 2 (« Démarrer » + « Enregistrer ») |
| Pointeuse | 2 (« Pointer l'arrivée » + « Démarrer ») |
| Parcours guidé | 2 |
| Paramètres | 3 |

- Le rouge sert aussi à des gestes sans importance : le « Fermer » de la fenêtre « Pièces réservées »
  (capture 12), le « Fermer » de la fiche utilisateur, ou « Ajouter » un mouvement de fond de caisse
  alors que l'action de l'onglet est « Clôturer ».
- Le mécanicien ne sait plus quel bouton est « le bon ».
- → **En partie corrigé** : photos, « Fermer », « Terminer le parcours ».

### 6. Des états qui se contredisent sur le même écran

- **Parcours guidé** : avant tout démarrage (0/28), le bouton rouge en tête est « Terminer le parcours »
  (capture 14). → **corrigé.**
- **Frise de la fiche OR** : l'étape « Travail » s'affiche « **étape en cours** » alors que le titre dit
  « À faire : prêt à démarrer ». On croit que le travail a commencé. → **corrigé** en « étape actuelle ».
- **Opérateur de l'OR** : « John (**ancienne saisie**) » sur un OR créé à l'instant depuis le RDV du
  jour. → **libellé corrigé** en « (saisi à la main) ». Le fond reste à traiter : le RDV doit passer le
  compte du compagnon à l'OR.
- **« Mon atelier » en vue « Tous »** : on lit « Aucune moto ne **vous** est attribuée ». → **corrigé.**
- **Fiche moto d'un client** :
  - le statut parc dit « Vendu » ;
  - l'encadré dit « Moto confiée par un client » (le vocabulaire du dépôt-vente) ;
  - les blocs « Bilan économique » et « Primes » s'affichent, alors qu'ils ne servent à rien pour une
    moto de client.
- **Caisse** : « Écart : − 1 027,00 € » s'affiche avant tout comptage du tiroir.
- **Mise en production** : la fréquence est écrite au format serveur (« 30 23 * * * ») alors que la
  dernière exécution est à « 00:30 ». Le décalage UTC / Bruxelles n'est pas expliqué.

### 7. Les mêmes choses portent des noms différents d'un écran à l'autre

| Notion | Les noms qu'on trouve |
|---|---|
| Le pas-à-pas d'entretien | « Parcours guidé » (bandeau OR), « Parcours technicien » (bloc opérations), « Démarrer le parcours d'entretien » (menu), « PARCOURS D'ENTRETIEN » (titre de la page) |
| La pointeuse | « Pointeuse » (menu, Mon atelier), « CHRONOS ATELIER » (titre) → **corrigé** en « Pointeuse atelier » |
| Les clients | « Contacts » (menu), « Contacts » (titre), « Nouveau client » (bouton), `/clients` (adresse) |
| Les retours | « Retour » + « ← Atelier » + « Retour à l'OR » sur le même écran (OR, parcours) |

### 8. Du jargon technique et des codes internes visibles

- « productivité **B11** » (pointeuse) → **retiré**.
- « Triple stock (réel / réservé / disponible) » : ça contredit le glossaire, où le triple stock est
  réel / **arrêté** / disponible. → **reformulé**.
- « Tâches planifiées (**pg_cron**) », les noms techniques (`accounting-auto-transfer`) et les
  expressions cron. → **titre corrigé**, le reste est à faire.
- « Prop. commande » → **corrigé** en « Proposition de commande ».
- Des « (s) » partout : « 2 pièce(s) manquante(s) », « 28 obligatoire(s) restante(s) »,
  « Compléter 5 champ(s) vide(s) », « 0 document(s) ». → **corrigé** dans « Mon atelier » et sur la
  fiche OR.
- Le plan d'entretien est affiché en anglais : « Annual Service / Service Temporel + Oil Service + … ».
- « Assistant planification » (repris de G8) pour la simple fenêtre « Nouveau RDV ».
- Des accents manquants dans les libellés du check-up et de l'accord client : « Reportees »,
  « A prevoir », « Signe », « Refuse », « demarre »… → **corrigé pour les libellés d'écran**. Les textes
  de signature et de mail destinés au client sont à revoir à part : la signature les enregistre avec
  une empreinte SHA-256, donc on ne les change pas en passant.

### 9. Des cibles tactiles trop petites sur les écrans d'atelier

| Écran (tablette 1024 px) | Cibles sous 44 px |
|---|---|
| Fiche OR | **140 sur 235** |
| Planning | 29 sur 29 (boutons de 32 px, boutons des cartes de 28 px) |
| Pointeuse | 10 sur 11 (36 px) |
| Fenêtre RDV | 18 sur 20, dont les croix d'effacement de **8 × 20 px** |
| Fermeture des fenêtres | 16 × 16 px |

- La charte demande **44 px** en mode atelier, la consigne de cette revue **48 px**.
- « Mon atelier » et le parcours guidé sont bons (48 à 64 px).

### 10. Des listes sans fin et des fiches en un seul long rouleau

| Écran | Constat |
|---|---|
| Stock | Toutes les lignes dans la page : **4 819 éléments cliquables**, page de **202 884 px** de haut, chargement de plus de 4 s. Pas de pagination, alors que la charte demande 25/50/100 ou un défilement virtuel. |
| Fiche client | **24 onglets** sur 2 lignes, avec des doublons : « Documents » et « Documents & photos » ; « Échéances », « Relances et échéances » et « Relances ». |
| Fiche moto | 17 blocs empilés (5 800 px). La charte §5.7 prévoit 5 onglets : Infos · Historique atelier · Documents · Photos · Comptabilité. |
| Paramètres | ~20 cartes à plat, sans regroupement. Certains réglages s'y modifient directement (minimax, envoi des relances) au milieu des liens. |

---

## « Mon atelier » — revue approfondie

**Note : 2 / 5.** Les briques sont bonnes : cartes lisibles depuis le 19/11, gros boutons, un geste
par moto, et la confirmation sur l'ancien OR. C'est l'ordre et la quantité d'informations qui rendent
l'écran « brouillon ».

### Ce que voit un mécanicien en arrivant (tablette paysage, captures 01 à 04)

1. **L'œil va d'abord** sur le grand nom en capitales (« simon@themaul.be »), puis sur l'encadré bleu
   « Vous regardez tout l'atelier… ». Ni l'un ni l'autre ne dit quoi faire.
2. **« Où j'en suis »** :
   - sans pointage, un bloc entier de 90 px dit « Aucun pointage en cours » ;
   - avec un pointage, l'état n'est que dans ce bloc. Il n'est pas rappelé sur la carte de la moto,
     sauf par une bordure bleue et un badge parmi 5 autres ;
   - et, on l'a vu, l'état peut être faux (constat n° 1).
3. **« Que faire ensuite »** :
   - chaque carte a son bouton rouge. Avec 6 motos, il y a 6 boutons rouges de même poids, et aucun
     ne dit lequel faire maintenant ;
   - l'ordre (heure du RDV) est bon, mais rien ne le montre visuellement.
4. **Une carte porte jusqu'à 8 badges de même taille.** Exemples : « Attribuée à John »,
   « Rendez-vous fixé », « À faire », « En cours : X », « Opérations 0/28 », « Photos remises à plus
   tard », « 2 pièce(s) manquante(s) », plus le motif. Les badges neutres (attribuée, statut du RDV)
   pèsent autant que les alertes (pièces manquantes, photos).
5. **Le vocabulaire diffère de la fiche OR** :
   - la carte dit « RDV sans OR », « Photos remises à plus tard » ;
   - la fiche OR dit « Réception (photos) · remis à plus tard » sur une frise en 5 étapes.
   - Le mécanicien voit deux représentations différentes du même dossier.
6. **Des clics avant de travailler** (RDV sans OR, moto d'un collègue) :
   - « Ouvrir l'OR et démarrer » ;
   - → confirmation « Moto attribuée à John » ;
   - → fenêtre de 6 photos (7 boutons rouges, « — OR » sans numéro dans le titre) ;
   - → « Plus tard, démarrer » ;
   - → confirmation « Un autre travail est en cours » ;
   - → parcours.
   - Ça fait **3 à 5 fenêtres** avant d'arriver au travail.
7. **Des éléments qui n'ont rien à faire sur l'écran de travail** :
   - « Page d'accueil après connexion » (un réglage de compte) ;
   - le lien « Pointeuse » répété ;
   - « Actualiser » (l'écran se relit déjà toutes les 45 s).
8. **Sur la carte, la moto (le repère visuel du mécanicien) passe après** le n° d'OR, le motif et
   l'ancienneté. Sur une carte de 380 px de large, le nom du modèle s'écrit sur 2 lignes.

### Proposition (validée avec le client avant de coder)

**Principe : une ligne d'en-tête, un bandeau « je travaille sur… » qui n'existe que s'il y a quelque
chose, puis la liste du jour dans l'ordre, avec la même frise que la fiche OR.**

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ MON ATELIER · vendredi 20/11          Atelier de : [ John ▾ ]              ⟳   │ ← 56 px, 1 ligne
├───────────────────────────────────────────────────────────────────────────────┤
│ ▶ JE TRAVAILLE SUR  OR-2026-00004 · MONSTER 696 · 1-MCG-408                     │ ← bandeau collant,
│   Entretien annuel + huile · opération 3/28 « Contrôle filtre à air » · 42 min  │   seulement si un
│   [ ⏸ PAUSE ]        [ ■ TERMINER ]        [ CONTINUER LE PARCOURS → ]          │   pointage tourne
├───────────────────────────────────────────────────────────────────────────────┤   (sinon absent)
│ AUJOURD'HUI · 3 motos                                                           │
│                                                                                 │
│ ┌─ 09:00 ────────────────────────────────────────────────────── À FAIRE MAINTENANT ┐
│ │ MONSTER 696 · 1-MCG-408                                     Didier Dupont      │
│ │ OR-2026-00004 · Entretien annuel + huile · 2 h prévues                          │
│ │ (1) Photos ✓ ─ (2) Travail ─ (3) Opérations 0/28 ─ (4) Prêt ─ (5) Facture         │ ← même frise
│ │ ⚠ 2 pièces manquantes : filtre à huile, huile 4XT                               │ ← alertes seules
│ │                                    [ ▶  DÉMARRER ]  (rouge)   [ Fiche OR ]      │
│ └──────────────────────────────────────────────────────────────────────────────┘
│ ┌─ 11:00 ───────────────────────────────────────────────────────────────────────┐
│ │ PANIGALE V4 S · 2-ABC-123                                    Marc Lambert       │
│ │ Pas encore d'OR · Pneus                                                          │
│ │ (1) Photos ─ (2) Travail ─ (3) Opérations ─ (4) Prêt ─ (5) Facture                │
│ │                                    [ ▶  DÉMARRER ]  (contour)  [ Voir le RDV ]   │
│ └──────────────────────────────────────────────────────────────────────────────┘
│ ┌─ En pause depuis hier 17:58 (fin de journée) ────────────────────────────────┐
│ │ MULTISTRADA V4 · 1-XYZ-987 …                          [ ↻ REPRENDRE ] (contour)  │
│ └──────────────────────────────────────────────────────────────────────────────┘
├───────────────────────────────────────────────────────────────────────────────┤
│ ▸ À PRENDRE · 2 OR non attribués                       (replié, ouvert si 1+)  │
│ ▸ OR ANCIENS À VÉRIFIER · 4                            (replié)                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Ce qui change :**
- **L'en-tête tient sur une ligne** : nom de l'écran, date, sélecteur « Atelier de », bouton de
  relecture.
  - Le nom de l'utilisateur part dans le menu du compte.
  - L'encadré bleu disparaît. Son message va dans la confirmation, au moment où il sert.
- **Le bandeau « Je travaille sur… »** apparaît seulement si un pointage tourne ou est en pause. Il
  reste collé en haut pendant le défilement et reprend le bloc actuel (Pause / Terminer / Reprendre),
  avec en plus :
  - la moto ;
  - l'opération en cours ;
  - « Continuer le parcours ».
- **« Aujourd'hui »** regroupe les RDV du jour, les OR du jour et les OR en cours ou en pause.
  - Ce sont des lignes en pleine largeur : une colonne en portrait, deux en paysage seulement au-delà
    de 1200 px.
  - Ordre actuel conservé : en cours, puis par heure.
- **Sur chaque carte** :
  - la **moto d'abord** (gros caractères), puis le client à droite ;
  - le n° d'OR et le motif en dessous ;
  - **la frise des 5 étapes, la même que sur la fiche OR**, à la place des badges « statut / photos /
    opérations / pointage » ;
  - les badges ne restent **que pour les alertes** : pièces manquantes, ancien OR, accord client en
    attente.
- **Un seul bouton rouge sur l'écran** :
  - le geste de la **première moto à faire** (« À faire maintenant ») ;
  - les autres cartes ont le même bouton en contour ;
  - quand un pointage tourne, aucun rouge sur les cartes : le rouge est sur « Continuer le parcours ».
- **« RDV sans OR » devient « Pas encore d'OR »**, et le bouton s'appelle « Démarrer » partout.
  L'OR est créé tout seul, comme aujourd'hui.
- **Une seule confirmation au plus avant de travailler.** On fusionne « Moto attribuée à X » et
  « Un autre travail est en cours » en un seul message : « Vous allez pointer à votre nom sur
  OR-2026-00004. Votre travail sur OR-2026-00003 sera mis en pause. [Démarrer] ».
  - Les photos restent proposées, mais la fenêtre a :
    - un seul bouton rouge, « Terminer et démarrer » ;
    - un « Plus tard » bien visible ;
    - le n° d'OR dans le titre.
- **Ce qui disparaît de l'écran** :
  - « Page d'accueil après connexion » (part dans « Mon profil ») ;
  - le second lien « Pointeuse » ;
  - le texte « Touchez Démarrer… », remplacé par l'étiquette « À faire maintenant ».

**Coût** : **M** (2 à 3 jours). Aucune règle métier ne change : les mêmes fonctions (`buildDayCards`,
`sortCards`, `startWorkWithConfirm`) sont réutilisées, et la frise est le composant du bandeau de la
fiche OR. Le constat n° 1 (pointage d'une autre société) est un correctif à part, **S** côté écran,
**S/M** côté base.

**Déjà fait dans la branche (quick wins)** :
- en-tête compact : « Aucun pointage en cours » est un badge sur la ligne du nom, et le gros bloc
  n'apparaît que si un pointage tourne ou est en pause ;
- le « que faire » est dit une fois, au-dessus des cartes ;
- l'encadré « Vous regardez… » est réduit ;
- le libellé du vide est juste en vue « Tous » ou « un compagnon » ;
- le pluriel « 2 pièces manquantes » ;
- la fenêtre photos a un seul bouton rouge et un titre sans « — OR » vide ;
- le menu latéral est replié sur tablette.

---

## Revue écran par écran

### Fiche OR (refaite le 19/11 : frise « Où en est cet OR ») — 2,5 / 5 — captures 07, 08, 09

- **Ce qui marche** : la frise et le gros bouton « Prochaine étape » en haut. C'est la bonne idée, et
  l'œil y va en premier.
- **Problème 1 — la fiche est un rouleau de 6 100 px** (15 300 px sur téléphone).
  - Les 28 opérations sont dépliées par défaut, au-dessus de l'en-tête client / moto / km / lignes.
  - « Mode opératoire non disponible pour ce modèle », « Voir sur la vue éclatée » et « Non faite » sont
    répétés **28 fois**.
- **Problème 2 — deux boutons rouges** :
  - « Démarrer » en haut ;
  - « Enregistrer » en bas des lignes ;
  - et « Transformer en facture » existe à la fois dans le bandeau et dans « Plus d'actions ».
- **Problème 3 — sur tablette** : 140 cibles de moins de 44 px. Sur téléphone, la page déborde de
  28 px en largeur (tableau des lignes). On a 3 retours (« Retour », « ← Atelier », menu), et le plan
  d'entretien est affiché en anglais.

**Proposition** : 3 zones fixes, dans cet ordre.
1. Le bandeau (inchangé), suivi d'**une ligne d'identité** : moto · plaque · client · km · motif, qui
   reste toujours visible.
2. Des **onglets** : « Travail » (opérations + photos + pièces réservées) · « Lignes et prix »
   (éditeur + acompte) · « Documents ».
   - Le mécanicien arrive sur « Travail », le réceptionnaire sur « Lignes et prix ».
3. Un « Enregistrer » collé en bas de l'onglet « Lignes », en secondaire tant qu'il n'y a rien à
   enregistrer.

Libellé unique : « Parcours guidé ». Un seul « Retour ». Coût : **M**.

**Fait** :
- liste des opérations repliée au-delà de 8 opérations ;
- « Mode opératoire non disponible » dit une seule fois quand aucune opération n'en a ;
- « étape actuelle » au lieu de « étape en cours » ;
- « Obligatoires restantes : n » ;
- « (saisi à la main) » au lieu de « (ancienne saisie) » ;
- « Proposition de commande » en toutes lettres.

### Planning — 3 / 5 — captures 10, 11, 12

- **Problème 1 — la fenêtre « Assistant planification »** (= nouveau RDV) commence par Statut / Type /
  Motif. Le client et la moto, ce que le réceptionnaire a en tête en premier, ne viennent qu'en
  4e ligne.
  - 12 gestes pour un RDV.
  - Les libellés font 11 px (la charte en demande 12).
  - Les croix d'effacement font 8 × 20 px.
- **Problème 2 — après « Enregistrer », la fenêtre « Pièces réservées » s'ouvre toute seule.**
  - Ça fait une fenêtre de plus à chaque RDV d'entretien.
  - Son seul bouton, « Fermer », était rouge. → **corrigé** (contour).
- **Problème 3 — sur tablette**, tous les boutons font 28 à 32 px, et le taux d'occupation est indiqué
  par la couleur seule (vert / orange / rouge, sans icône).

**Proposition** :
- fenêtre RDV dans l'ordre client → moto → motif → date et heure → compagnon → temps, puis le reste
  replié sous « Plus d'options » ;
- titre « Nouveau rendez-vous » ;
- « Pièces réservées » en encadré dans la fenêtre plutôt qu'en seconde fenêtre ;
- en mode tactile, boutons des cartes à 44 px ;
- jauge d'occupation avec icône et libellé.

Coût : **M**.

### Pointeuse — 2,5 / 5 — capture 13

- **Problème 1 — deux boutons rouges** (« Pointer l'arrivée », « Démarrer »). L'écran mélange :
  - la présence ;
  - le travail sur OR ;
  - les tâches improductives ;
  - le tableau du jour.
  Ce sont 4 blocs de même poids.
- **Problème 2 — l'écran est pensé pour le bureau** : contrôles à 36 px, libellés à 11 px. Il reste le
  point d'entrée des postes partagés (code mécano).
- **Problème 3 — le titre** « Chronos atelier » ne correspond pas au menu « Pointeuse », et le
  sous-titre contient le code « B11 ». → **corrigé**.

**Proposition** : un mode « borne » en 3 gros boutons :
- « Je suis arrivé / Je pars » ;
- « Travailler sur un OR » (scan) ;
- « Tâche atelier ».

Le reste (tableau, productivité) passe dans un onglet pour le chef d'atelier. Coût : **M**.

### Parcours guidé — 3 / 5 — capture 14

- **Problème 1** : « Terminer le parcours » était rouge avant tout démarrage. → **corrigé** : rouge
  seulement à 100 %.
- **Problème 2** : 4 noms pour le même écran (voir le constat n° 7), et 2 boutons retour.
- **Problème 3** : sans manuel relié, les 28 opérations répétaient « Mode opératoire non disponible ».
  → **corrigé** (dit une fois). Le titre du programme reste en anglais.

**Proposition** : un nom unique, « Parcours guidé », et le titre du programme en français (« Entretien
annuel + vidange + huile de fourche »). Coût : **S**.

### Caisse (clôture Z) — 3 / 5

- **Problème 1** : le rouge est sur « Ajouter » (un mouvement de fond de caisse). L'action de l'onglet
  est « Clôturer la session ».
- **Problème 2** : « Écart : − 1 027,00 € » s'affiche en grand avant tout comptage, ce qui inquiète
  pour rien. Les montants au-delà de 1 000 € n'ont pas de séparateur de milliers (« 1027,00 € »).
- **Problème 3** : rapport X, mouvements, comptage et sessions passées sont sur un seul rouleau.

**Proposition** :
- clôture en 3 étapes : compter le tiroir → vérifier l'écart → clôturer (rouge) ;
- l'écart s'affiche seulement après le comptage ;
- un formateur de montants unique pour tout le DMS (voir « Transverse »).

Coût : **M**.

### Vente comptoir — 3,5 / 5 — capture 15

- **Ce qui marche** : bon écran. 3 gestes pour ajouter un article, un seul bouton rouge
  (« Encaisser »), les totaux bien visibles.
- **Problème 1** : la liste des résultats fait la largeur du champ (≈ 250 px en 1280). Les
  désignations tiennent sur 3 lignes, sans stock ni casier, alors que la recherche de l'OR les affiche.
- **Problème 2** : Entrée ne choisit pas le premier résultat. La liste reste ouverte après l'ajout et
  cache la ligne du panier.
- **Problème 3** : le panier est perdu sans avertissement si on change d'écran. Libellés à 10 px
  (« Remise globale % »…).

**Proposition** :
- réutiliser la liste de résultats de l'OR (`ArticleLinePicker` : largeur 560 px, stock et casier,
  flèches / Entrée) ;
- fermer la liste après l'ajout ;
- avertir avant de quitter un panier non vide.

Coût : **S/M**.

### Achats & réceptions — 2 / 5 — capture 16

- **Problème 1** : titre écrasé (→ **corrigé**). **8 boutons d'action en tête**, de même poids.
- **Problème 2** : 3 niveaux d'onglets empilés :
  - (Réceptions / Commandes / Propositions / Rétrocessions / Échéances / TVA / Frais / Historique /
    Remises fin d'année) ;
  - puis (Tout / Livraisons / Factures achat) ;
  - plus les filtres de période.
- **Problème 3** : jargon G8 (« Rétrocession », « Remises fin d'année ») sans aide ; « 0 document(s) ».

**Proposition** :
- en tête, une seule action rouge selon le rôle du magasinier : « Nouvelle réception » ;
- les autres « Nouveau… » dans un menu « Créer » ;
- onglets réduits à Réceptions · Commandes · Propositions ; les rapports (échéances, TVA, frais,
  historique, remises) dans un menu « Rapports » ;
- une phrase d'aide sous chaque terme G8.

Coût : **M**.

### Stock — 2,5 / 5 — capture 17

- **Problème 1** : toute la liste est rendue d'un coup (4 819 éléments, 202 884 px). C'est lent et
  illisible.
- **Problème 2** : le rouge est sur « Inventaire », une tâche rare. Le geste quotidien (chercher une
  pièce) n'est pas mis en avant. « Réappro » en abrégé.
- **Problème 3** : un stock négatif (−1) s'affiche sans alerte. « Valeur du stock : 801519,71 € » sans
  séparateur (→ **corrigé**). Le sous-titre contredisait le glossaire (→ **corrigé**).

**Proposition** :
- pagination 50 / 100, comme les contacts ;
- le champ de recherche en premier, avec le focus à l'ouverture ;
- badge « Rupture / Stock négatif » (danger + icône) ;
- « Inventaire » en bouton secondaire.

Coût : **M**.

### Clients (liste et fiche) — 2,5 / 5 — capture 18

- **Problème 1** : la fiche client a **24 onglets** sur 2 lignes, avec des doublons.
  - « Reportees » sans accent (→ **corrigé**).
  - 6 tuiles d'encours pour dire « rien à payer ».
- **Problème 2** : dans la liste :
  - les lignes se cliquent mais ne sont pas des liens (pas d'ouverture dans un nouvel onglet, pas de
    clavier) ;
  - « Particulier » et « Professionnel » s'affichent sur la même fiche ;
  - les téléphones sont en « +00… » ;
  - 7 boutons d'action, dont « RGPD - Purge » et « Modification en cascade » (dangereux) à côté de
    « Nouveau client ».
- **Problème 3** : « Contacts » ou « Clients » selon l'endroit.

**Proposition** :
- fiche en 6 onglets : L'essentiel · Motos · Documents · Atelier · Relances · Plus (le reste) ;
- encours en une seule tuile « Rien à payer / Reste à payer X € » ;
- actions dangereuses sous « Outils », à part ;
- un seul mot, « Clients ».

Coût : **M/L**.

### Fiche moto — 2,5 / 5 — capture 19

- **Problème 1** : 17 blocs les uns sous les autres (5 800 px), et 3 « Enregistrer » rouges + 1 rouge
  « Ajouter la prime ».
- **Problème 2** : moto de client « Vendu » + « Moto confiée par un client » + bilan économique /
  primes affichés. Ça mélange la moto de stock et la moto de client.
- **Problème 3** :
  - les codes de la carte grise (E, D.1, P.2, V.9…) précèdent chaque champ ;
  - « Compléter 5 champ(s) vide(s) » ;
  - « Papiers 100 CH » obscur ;
  - « Interventions reportees » (→ **corrigé**).

**Proposition** :
- les onglets de la charte §5.7 ;
- les blocs « commerce » (bilan, primes, à vendre) seulement pour une moto du stock ;
- un seul « Enregistrer » collé en bas ;
- les codes de la carte grise en petit, à droite du libellé.

Coût : **M**.

### Paramètres — 3 / 5 — capture 20

- **Problème 1** : ~20 cartes à plat. On ne sait pas ce qui est quotidien (utilisateurs, tables) et ce
  qui est rare (classeur Ducati, extension).
- **Problème 2** : des réglages modifiables directement dans la liste (minimax, envoi des relances),
  avec 3 boutons rouges.
- **Problème 3** : jargon (« dry-run », « PPC », « Rapprochements », « Réassort minimax »).

**Proposition** : 4 groupes titrés :
- Société et utilisateurs ;
- Documents et numérotation ;
- Atelier et stock ;
- Envois et connexions (mise en production, SMS, Stripe, Shopify, My Ducati).

Chaque réglage dans sa page, avec une phrase d'aide sans jargon. Coût : **S/M**.

### Fenêtre « Mise en production » — 3,5 / 5 — capture 21

- **Ce qui marche** : explications claires, état par ligne (couleur + libellé), « Pour démarrer : … »
  très utile, un seul bouton rouge.
- **Problème 1** : la fenêtre fait 2 700 px de haut. Les cases à cocher font 16 px, sans libellé
  « Démarrer / Tester / Pause » sur la ligne.
- **Problème 2** : le tableau des tâches est technique (noms anglais, format cron, heures UTC
  contre heures de Bruxelles). → **titre corrigé** (« Tâches automatiques du serveur »).
- **Problème 3** : l'état « ACTIF » (Relève Outlook, IA) s'affiche dans la société de test sans
  préciser si ça agit sur elle.

**Proposition** :
- sur chaque ligne, un choix « Arrêté · Test · Actif » en 3 boutons ;
- tableau des tâches replié, en français (« tous les jours à 00:30 »), heure de Bruxelles.

Coût : **S/M**.

---

## Transverse

| Sujet | Constat | Proposition | Coût |
|---|---|---|---|
| Menu sur tablette | Ouvert par défaut (240 px) | **Fait** : replié de 768 à 1279 px | S ✓ |
| En-têtes de page | Titre écrasé dès que les actions sont nombreuses | **Fait** : actions sous le titre | S ✓ |
| Boutons tactiles | 36 px partout (charte : 44 px en atelier) | `pointer-coarse:min-h-11` sur Button, Input, SelectTrigger, Tabs : un seul réglage dans `src/components/ui`, à valider car il touche tous les écrans tablette | S |
| Bouton rouge désactivé | Il devient rose pâle (opacité 50 %). La charte demande gris `--gray-100` / `--gray-400` | Variante « disabled » du bouton | S |
| Montants | **93** formateurs locaux `toFixed(2).replace('.', ',')` sans séparateur de milliers | Un `formatEur` unique dans `src/lib` | M |
| Chargement | Roue plein écran sur chaque page (la charte demande des squelettes) | Squelettes sur Mon atelier, OR, listes | M |
| Bandeau ItalTest | 70 px de texte permanent | Une ligne jaune « Société de test » + « ? » qui déplie l'explication | S |
| Pluriels « (s) » | Partout | Une aide de pluriel i18n (`{n, plural}`) | M |
| Libellés 10 à 11 px | En-têtes de tableaux, libellés de formulaires | 12 px (charte `--text-label`) | S |

## Quick wins faits dans la branche `lot-ux-ui`

Aucune règle métier ne change, aucune migration. Les libellés sont traduits dans les 4 langues quand
le sens change.

1. **Menu latéral replié par défaut de 768 à 1279 px** (charte §4.2) — `components/layout/app-shell.tsx`.
2. **En-têtes de page** : le titre garde au moins 18rem et les actions passent dessous — fini les
   titres en colonne (Achats, Stock, fiche client…) — `components/layout/page-header.tsx`.
3. **« Mon atelier »** — `my-workshop/my-workshop-screen.tsx`, `i18n/mon-atelier.ts` :
   - en-tête compact ;
   - « Aucun pointage en cours » en badge sur la ligne du nom ;
   - bloc de pointage seulement s'il y a un pointage ;
   - consigne dite une fois au-dessus des cartes ;
   - encadré réduit ;
   - texte vide juste en vue « Tous » ou « compagnon » ;
   - « 1 pièce manquante » / « n pièces manquantes ».
4. **Photos de réception** : les 6 « Prendre la photo » en secondaire (le badge « Obligatoire »
   reste), seul « Terminer et démarrer » est rouge ; titre sans « — OR » vide —
   `reception/reception-sheet.tsx`.
5. **Parcours guidé** : « Terminer le parcours » rouge seulement à 100 % ; « Mode opératoire non
   disponible » dit une fois — `journey/journey-screen.tsx`.
6. **Fiche OR, bloc opérations** : replié par défaut au-delà de 8 opérations ; « Mode opératoire non
   disponible » dit une fois — `plan-ops/plan-ops-panel.tsx`.
7. **« Fermer » en contour** (au lieu du rouge) : fenêtre « Pièces réservées », fiche utilisateur.
8. **Libellés** :
   - « étape actuelle » ;
   - « Obligatoires restantes : n » ;
   - « (saisi à la main) » ;
   - « Proposition de commande » ;
   - « Pointeuse atelier » sans « B11 » ;
   - sous-titre du stock conforme au glossaire ;
   - « Tâches automatiques du serveur » ;
   - accents des libellés du check-up et de l'accord client (« Reportées », « À prévoir »,
     « Signé », « Refusé »…).
9. **Valeur du stock** avec séparateur de milliers.

Vérifications :
- suite `bun test` complète : 2 326 tests verts sur 153 fichiers, dont le test des dictionnaires
  (mêmes clés dans les 4 langues) ;
- `bun run build` : OK.
- Limite : le site déployé ne contient pas encore ces changements. Je n'ai pas pu les revoir à l'écran
  connecté (le navigateur intégré n'ouvre pas un serveur local, et je ne saisis aucun mot de passe).
  À contrôler après déploiement.

## À refondre en priorité (à valider avec le client)

1. **Le pointage d'une autre société** (constat n° 1) : correctif avant la mise en production — S/M.
2. **« Mon atelier » selon la maquette** : frise commune, un seul rouge, une seule confirmation — M.
3. **La fiche OR en 3 zones** : ligne d'identité fixe + onglets Travail / Lignes / Documents — M.
4. **Le mode tactile global à 44 px** et le bouton désactivé gris : un réglage dans `components/ui` — S.
5. **Le stock paginé** et la recherche en premier — M.
6. **La fiche client en 6 onglets** et la fiche moto en onglets (charte §5.7) — M/L.
7. **Un vocabulaire unique** : Parcours guidé, Pointeuse, Clients, un seul « Retour », titres de plans
   en français — S.
