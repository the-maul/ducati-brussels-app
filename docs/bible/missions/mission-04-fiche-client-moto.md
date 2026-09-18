---
mission: 04
titre: Fiche client et moto au comptoir
etat: ⬜
ouverte_le: 2026-09-19
modules: [M01, M03, M00]
---

# Mission 04 — Fiche client et moto au comptoir

> **Objectif** : créer en quelques secondes un client et sa moto quand il est au comptoir, avec des
> données propres (mobile unique, e-mail en minuscules, ville trouvée par le code postal).

Liste ERP : « Mission 04 — Fiche client et moto au comptoir » (`c3ab4e5d-f23c-45fc-a041-cdf2ea60ffc6`).
Source : vidéo de Simon du 18/09 (création d'un client et de son véhicule dans G8). Transcription locale :
`C:\Users\simon\whisper-models\mission4.srt`.

## 1. Le besoin

Ce que montre la vidéo dans G8 :
- la fiche client est longue et on la remplit au comptoir, client en face ;
- la liste des civilités est datée ; les professionnels n'ont pas de champ « forme juridique » propre ;
- on recopie le téléphone dans « portable », sinon les SMS ne partent pas ;
- l'e-mail est saisi avec des majuscules ; la ville se tape à la main ;
- date et lieu de naissance, IBAN, n° TVA sont demandés au client ;
- la moto se crée ensuite comme « produit fini réparation », à partir de la carte grise : VIN, plaque,
  n° moteur, marque/modèle, cylindrée, kW/CV, bridage P1/P2, norme, couleur, 1re immatriculation, km,
  fin de garantie, année modèle.

## 2. Décisions

Aucune encore. Les cartes marquées `a-confirmer` attendent une note de Simon.

## 3. Lots (cartes ERP)

| Carte | Fait quand | État |
|---|---|---|
| Créer une fiche client rapide au comptoir | création en un écran court, champs secondaires pliés | ⬜ |
| Moderniser la liste des civilités | M./Mme + forme juridique séparée pour les pros | ⬜ a-confirmer |
| Un seul numéro mobile, utilisé pour les SMS | un champ mobile au format +32, source des SMS | ⬜ |
| E-mail en minuscules et code postal qui remplit la ville | saisie normalisée, ville proposée | ⬜ |
| Naissance, IBAN et n° TVA complétés par le client dans son espace | champs éditables dans /mon-espace | ⬜ a-confirmer |
| Créer la moto du client depuis sa fiche | bouton sur la fiche client, tous les champs carte grise | ⬜ |
| Remplir la moto à partir d'une photo de la carte grise | lecture photo → champs pré-remplis, vérifiés par l'employé | ⬜ a-confirmer |

## 4. Questions en attente

1. Civilités : garder d'autres titres (Dr, Me…) ? *Reco : non, M./Mme + forme juridique.*
2. Le client peut-il changer lui-même son IBAN dans son espace ? *Reco : oui, avec une trace et une alerte à l'équipe.*
3. Lecture de la carte grise par photo : d'accord ? *Reco : oui, même principe que la carte d'identité (`read-id-doc`).*

## 5. Ce qui a changé dans l'application

Rien encore. Points de départ : fiche contact (M01), fiche véhicule (M03), table de référence
`civility` (Paramètres), fonction `read-id-doc`.

## 6. Risques

- Données G8 existantes : le mobile est parfois dans « téléphone », parfois dans « portable » ; il
  faudra une reprise (proposer la liste, pas de fusion automatique — même règle que les doublons).
- Contrôle du VIN (17 caractères) et du doublon de VIN avant création.
