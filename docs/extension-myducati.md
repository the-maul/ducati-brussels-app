# Extension navigateur « My Ducati » — plan de récupération des données

But : depuis le portail Ducati (`ducati.my.site.com`, où l'utilisateur est **déjà connecté**),
une extension Chrome lit la fiche d'une moto **par VIN** et renvoie les infos dans le DMS
(contact + moto), sans stocker d'identifiant Ducati côté serveur.

## Architecture
- **Content script** injecté sur les pages moto du portail Ducati : lit le DOM (onglets
  Détails / Événements / Bulletins), structure les champs.
- **Pont avec le DMS** : contrat déjà en place côté app (bouton « Mettre à jour ») —
  l'app poste `{ source:'dms-ducati', action:'fetch-myducati', vin }` ; l'extension répond
  `{ source:'dms-ducati-ext', action:'myducati-result', vin, payload }`.
- Déclenchement par **VIN** des motos liées au contact (recoupement).

## Données récupérables (relevé des captures)

### A. Compte client Ducati → **fiche CONTACT** (section « Info chez Ducati »)
| Donnée Ducati | Champ DMS | Statut |
|---|---|---|
| Code Ducati (ex. 04657509) | `ducati_code` | existe |
| Email du compte | `my_ducati_email` | existe |
| Nom / Prénom | `my_ducati_last_name` / `my_ducati_first_name` | existe |
| Téléphone | `my_ducati_phone` | **à créer** |
| Ville / Pays | `my_ducati_city` / `my_ducati_country` | **à créer** |
| Activité Marketing (oui/non) | `my_ducati_marketing` | **à créer** |
| Profilage (oui/non) | `my_ducati_profiling` | **à créer** |
| Score « Monetary » (0–7) | `my_ducati_score` | **à créer** |
| Propriétaire actuel (oui/non) | `my_ducati_is_current_owner` | **à créer** |
| (charge brute complète) | `my_ducati_data` (jsonb) | existe |

### B. Moto → **fiche VÉHICULE**
| Donnée Ducati | Champ DMS | Statut |
|---|---|---|
| VIN | `vin` | existe |
| Modèle | `model` | à confirmer |
| Plaque d'immatriculation | `plate` | à confirmer |
| Numéro de moteur | `engine_number` | **à créer/confirmer** |
| État (En Service…) | `ducati_state` | **à créer** |
| Utilisation (Client…) | `ducati_usage` | **à créer** |
| Date de production | `production_date` | **à créer** |
| Date d'expédition depuis Ducati | `ship_date` | **à créer** |
| Dernier kilométrage | `last_km` | **à créer/confirmer** |
| Moto facturée à (concessionnaire) | `invoiced_to` | **à créer** |

### C. Garantie → **fiche VÉHICULE** (ou table dédiée `vehicle_warranty`)
Date début, date fin, type (Conventionnelle 24 mois), état (En cours/Expiré),
activée par (concessionnaire), âge depuis activation, état de maintenance.
→ champs `warranty_start / warranty_end / warranty_type / warranty_state / warranty_activated_by`.

### D. Événements de maintenance → **nouvelle table `vehicle_maintenance`**
Une ligne par événement (à venir / en cours / passé) :
`kind (upcoming|current|past)`, `type` (Desmo Service, Annual Service…), `state`
(Prévu/Fait/Ignoré), `km`, `date` / `due_date`, `dealer` (concessionnaire), `ducati_event_id`.

### E. Bulletins techniques → **nouvelle table `ducati_bulletins`** (par modèle/année)
`bulletin_id`, `title`, `number` (ex. SRV-TTB-26-010), `published_at`, `model`, `model_year`.
Affichés sur la fiche moto (lecture).

## Étapes de build (après validation de ce plan)
1. Migrations : champs B/C sur `vehicles` (+ contact A), tables `vehicle_maintenance` et
   `ducati_bulletins` (company_id + RLS).
2. Extension Chrome (manifest v3 : content script + service worker) + notice d'installation.
3. Mapping libellé → champ dans le content script ; renvoi `payload` structuré.
4. Côté app : étendre le remplissage (contact + moto + garantie + maintenance + bulletins).

> ⚠️ Le portail Ducati est un Salesforce sans API officielle : le scraping DOM est **fragile**
> (un changement de page Ducati peut casser le mapping). L'extension est conçue pour
> dégrader proprement (champ non trouvé = ignoré) et reste **déclenchée par l'utilisateur**,
> sur sa session — aucun identifiant Ducati stocké.
