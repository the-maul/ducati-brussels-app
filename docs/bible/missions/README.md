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

## Missions

| # | Mission | État | Fichier |
|---|---|---|---|
| 01 | Nouveau client — prospects, comptes, portail | 🟦 en cours | [`mission-01-nouveau-client.md`](mission-01-nouveau-client.md) |
| 02 | Commandes de pièces | ⬜ spécifiée, non commencée | spécification : [`../../process-commandes-pieces.md`](../../process-commandes-pieces.md) |

Légende : ⬜ pas commencée · 🟦 en cours · ✅ terminée et validée par le client.
