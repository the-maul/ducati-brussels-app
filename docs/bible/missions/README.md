# Missions — mode d'emploi

Une **mission** est une grande thématique demandée par le client (ex. « Nouveau client »,
« Commandes de pièces »). Elle regroupe beaucoup de changements, dans plusieurs modules.

## Règles

1. **Un fichier par mission** : `mission-NN-nom-court.md`, à partir de [`_modele-mission.md`](_modele-mission.md).
2. **Chaque mission est découpée en lots**. Un lot = un résultat testable par le client, avec son
   critère « Fait quand ».
3. **Avant de coder un lot** : questions posées au client **en une fois**, réponses consignées dans la
   mission et dans le [journal des décisions](../decisions.md). Pas de code sur une supposition.
4. **Le travail d'un lot est découpé en trois** et confié à trois agents en parallèle, chacun sur des
   fichiers distincts. L'agent principal relit, intègre, déploie et vérifie.
5. **À la fin d'un lot** : la mission est mise à jour (case cochée, date), et **chaque chapitre de
   module touché** reçoit une ligne dans sa section « Historique » et, si besoin, dans « Ce qu'on a ».
6. **Les retours du client sont groupés par lot**, testés sur une version complète, pas au fil de l'eau.

## Le cycle d'une carte (ERP Mauluctive)

Chaque mission est une **liste** dans l'ERP Mauluctive (client Ducati Waterloo, mission « Updates »,
service « Updates & Modifs »). Chaque changement est une **carte** (activité).

1. Claude traite les cartes « À faire » (ronde automatique toutes les 20 minutes) et les passe
   « À valider » avec une note « À TESTER : … ».
2. Simon teste. Si c'est bon : « Terminé ». Sinon : « À faire » avec ses notes.
3. Cartes taguées `action-client` (action de Simon) ou `a-confirmer` (question ouverte) : la ronde
   ne les traite pas tant que Simon n'y a pas ajouté de note.
4. **Tout échange sur une carte (modification, discussion, choix) met la bible à jour** : le
   chapitre du module (ce qu'on a, règles, historique), la mission, et le journal des décisions.
5. Le commit reprend le **titre exact de la carte** : l'ERP met à jour la carte au lieu d'en créer une.

## Créer une nouvelle mission à partir d'une vidéo

1. Simon envoie une vidéo (démonstration, explication de besoin).
2. Claude en extrait les images clés et la parole (retranscription), puis **propose dans le chat** :
   ce qu'il a compris, les décisions implicites, les questions, et la **liste de cartes**.
3. Simon corrige ou valide.
4. Claude crée la liste « Mission NN — … » dans l'ERP avec ses cartes, le fichier
   `missions/mission-NN-….md` et les décisions dans `../decisions.md`, puis réalise les cartes.

## Missions

| # | Mission | État | Fichier |
|---|---|---|---|
| 01 | Nouveau client — prospects, comptes, portail | 🟦 en cours | [`mission-01-nouveau-client.md`](mission-01-nouveau-client.md) |
| 02 | Commandes de pièces | 🟦 validée le 19/09, cartes en cours | spécification : [`../../process-commandes-pieces.md`](../../process-commandes-pieces.md) |
| 03 | Shopify relié au stock du DMS | 🟦 accès en cours de création | [`mission-03-shopify.md`](mission-03-shopify.md) — accès et secrets au §2 |
| 04 | Fiche client et moto au comptoir | ⬜ cartes créées le 19/09, en attente du feu vert | [`mission-04-fiche-client-moto.md`](mission-04-fiche-client-moto.md) |
| 05 | Devis moto, options et préparation | ⬜ cartes créées le 19/09, en attente du feu vert | [`mission-05-devis-preparation.md`](mission-05-devis-preparation.md) |

Légende : ⬜ pas commencée · 🟦 en cours · ✅ terminée et validée par le client.
