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

## Import du catalogue Ducati (e-catalog) — mission 06

Sur `e-catalog.ducati.com`, bouton rouge **« Importer le catalogue »** (en bas à gauche) :
lecture de la liste des modèles, filtre Europe + millésimes depuis 2000 (liste modifiable),
puis import en série (1 page/s par défaut), pause / reprise, reprise automatique après fermeture.
Le DMS doit être ouvert dans un autre onglet (compte administrateur).

- `catalog-core.js` : règles pures (filtre, plan, état de reprise), testées par `bun test`.
- `catalog.js` : panneau et parcours de l'e-catalog (session de l'utilisateur, aucun identifiant stocké).
- `background.js` / `dms-bridge.js` : relais vers l'onglet du DMS (`src/modules/catalog/bridge.ts`).

Guide complet : `docs/bible/guides/catalogue-ducati.md`. Premier remplissage : fichiers d'extraction
chargés par `tools/catalog-loader/load.mjs`.
