# Extension « DMS Ducati — Import My Ducati »

Importe les infos d'une moto depuis le portail **My Ducati** (où vous êtes connecté) vers le
DMS, **par VIN**, sans stocker d'identifiant Ducati côté serveur.

## Installation (Chrome / Edge)
1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisir le dossier `tools/myducati-extension`.
4. (Optionnel) Épingler l'extension.

> Si le DMS tourne sur un **domaine personnalisé** (pas `*.netlify.app`), ajoutez-le dans
> `manifest.json` (`host_permissions` + `content_scripts[1].matches`) puis rechargez l'extension.

## Utilisation
1. Garder **l'onglet du DMS ouvert** (vous y êtes connecté).
2. Sur My Ducati, ouvrir la **fiche d'une moto** (onglet Détails ; pour les bulletins/événements,
   ouvrir aussi ces onglets avant d'importer).
3. Cliquer le bouton rouge **« ⬇ Importer dans le DMS »** (en bas à droite).
4. Le DMS retrouve la moto par son **VIN** et remplit : compte client Ducati, infos moto,
   garantie, maintenance, bulletins. Un message de confirmation s'affiche dans le DMS.

## Fonctionnement
`ducati.js` (scrape la page par libellés) → `background.js` (relais) → `dms-bridge.js`
(injecte dans l'app via `postMessage`) → l'app enregistre sous votre session (RLS).

## Limites / maintenance
- Le portail Ducati est un Salesforce **sans API** : le scrape se fait par **libellés FR**.
  Si Ducati renomme un libellé, l'ajuster dans `ducati.js` (un champ non trouvé est ignoré,
  jamais bloquant).
- La moto doit déjà exister dans le DMS (matching par VIN).
