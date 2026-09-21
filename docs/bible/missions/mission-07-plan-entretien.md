---
mission: 07
titre: Plan d'entretien
etat: 🟦
ouverte_le: 2026-09-21
modules: [M08, M03, M06, M09, M10, M01]
---

# Mission 07 — Plan d'entretien

> **Objectif** : pour chaque moto, savoir quel entretien est dû, ce qu'il contient (opérations, pièces),
> combien de temps il prend et combien il coûte — pour proposer le bon entretien au client, bloquer le
> bon temps au planning et sortir le devis en un clic. Liée à la mission 06 (catalogue).

Liste ERP : « Mission 07 — Plan d'entretien » (`e44cc05b-8c50-4e08-9ae6-525d77cb423b`).
Demande de Simon du 21/09 (chat).

## 1. Le besoin (Simon, 21/09)

« En connaissant le temps par entretien, on peut prévoir le devis et le temps bloqué dans l'atelier… quand
le client enregistre sa moto, on peut lui demander quand il a fait les derniers entretiens prévus, et ses
km, pour savoir quoi lui proposer. » Couvre les exigences atelier **ATE013** (kits) et **ATE014**
(nomenclatures d'entretien automatiques modèle + km), manquantes jusqu'ici (voir M08).

## 2. Existant réutilisé

Variantes et pièces du catalogue (mission 06) ; entretiens My Ducati (`vehicle_maintenance`) ; OR et
historique atelier ; demandes de RDV du portail et planning (M08) ; lignes main-d'œuvre et devis (mission 05) ;
motos déclarées et « Ajouter ma moto » (mission 04) ; cloche par rôle.

## 3. Cartes

| # | Carte | Dépend de |
|---|---|---|
| 1 | Plans d'entretien par modèle et par année (documents Ducati à déposer par Simon) | 06-2 |
| 2 | Forfaits d'entretien avec pièces, temps et devis automatique | 07-1, 06-3 |
| 3 | Lier nos documents d'entretien au modèle | 06-2 |
| 4 | Prochain entretien de chaque moto | 07-1, 06-4 |
| 5 | Demander km et derniers entretiens quand une moto est enregistrée | 07-4 |
| 6 | Rendez-vous d'entretien avec temps bloqué et devis estimé | 07-2 |
| 7 | Relances d'entretien (cloche d'abord ; mail/SMS quand les services seront choisis) | 07-4 |

## 4. Décisions (Simon, 21/09)

- Documents reçus le 21/09 (30 PDF, dossier « uploads de whatsapp\fiches entretien ») ; extraction dans
  `C:\Users\simon\Desktop\ducati\entretiens-extraits\` (plans, échéances, opérations, temps, avec source).
- Les posters « Entretien Transparent » donnent des **temps** officiels Ducati (pas des prix) : prix = temps × taux horaire.
- **Taux horaire atelier exprimé HT** (valeur à saisir dans Paramètres).
- En cas de contradiction entre documents, **le plus récent fait foi** (l'ancien gardé en historique).
- **Échéance = le premier atteint (km ou mois)**, partout.
- **Plans piste / racing aussi dans le DMS**, avec un **usage** (route / piste amateur / racing) choisi par le client : l'entretien dépend de l'usage.
- Pièces, quantités et prix ne sont dans aucun document : ils viendront du catalogue (mission 06).

## 4 bis. Questions (anciennes)

1. Documents d'entretien Ducati : lesquels avez-vous (manuels d'atelier, plans d'entretien par modèle) ? À déposer sur la carte 1.
2. Temps d'entretien : barème Ducati (« tempario », indicateur vu dans l'e-catalog) ou vos temps réels issus des OR ? *Reco : barème Ducati s'il est accessible, sinon temps réels.*

## 5. Ce qui a changé dans l'application

(rempli à chaque lot livré)
