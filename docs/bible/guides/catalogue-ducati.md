# Guide — Mettre le catalogue Ducati dans le DMS

> Pour : Simon. Mission 06 (catalogue pièces Ducati), cartes « Importer les modèles Ducati par année »
> et « Importer les vues éclatées et les pièces de chaque modèle ».
> Décisions M-14 / M-15 (21/09) : accord de Ducati, **Europe seulement, millésimes depuis 2000**,
> lecture avec **votre** session e-catalog, **aucun identifiant Ducati enregistré**.

Il y a deux chemins :

| Chemin | Quand | Ce qu'il faut |
|---|---|---|
| **A. Fichiers d'extraction + chargeur** (priorité du 21/09) | Premier remplissage | Les fichiers `catalogue-ducati-*.json` dans *Téléchargements*, un terminal sur le PC de développement |
| **B. Extension Chrome** « Importer le catalogue » | Mises à jour plus tard (nouveaux millésimes) | L'extension DMS Ducati installée, l'e-catalog et le DMS ouverts |

Dans les deux cas, le résultat se voit dans le DMS : **Pièces & Accessoires → Catalogue Ducati**
(onglets « Parcourir » et « État de l'import »).

---

## A. Charger les fichiers d'extraction (premier remplissage)

L'extraction tourne dans votre Chrome, sur l'onglet de l'e-catalog, et dépose dans
`C:\Users\simon\Downloads\` :

- `catalogue-ducati-arbre.json` — familles, cylindrées, modèles, millésimes (Europe, depuis 2000) ;
- `catalogue-ducati-groupes-001.json`, `-002…` — pour chaque modèle-année, ses groupes et ses vues ;
- `catalogue-ducati-planches-001.json`, `-002…` — chaque vue éclatée **une seule fois**, avec ses repères
  et ses pièces.

Puis, dans un terminal ouvert dans le dossier du dépôt :

1. Vérifier les fichiers sans rien écrire :
   ```
   node tools/catalog-loader/load.mjs --dry-run
   ```
   Il affiche le nombre de familles, modèles, modèles-années, planches et lignes trouvés.
2. Charger :
   ```
   node tools/catalog-loader/load.mjs
   ```
   - La clé d'accès à la base est lue dans la variable Windows `SUPABASE_SERVICE_ROLE_KEY` (déjà posée
     sur le PC). Elle n'est **jamais affichée ni écrite**.
   - On peut relancer autant de fois qu'on veut : rien n'est créé en double (chaque élément est
     reconnu par son identifiant Ducati). Un fichier déjà chargé et inchangé est sauté
     (`--force` pour tout recharger). Le suivi est dans `Downloads\catalogue-ducati-chargement.json`.
   - Si l'extraction continue et dépose de nouveaux fichiers, relancer la même commande : seuls les
     nouveaux sont chargés.
3. Voir ce qui est en base : `node tools/catalog-loader/load.mjs --stats`, ou l'écran du DMS.

Un « modèle-année » est marqué **complet** quand toutes ses vues ont leurs pièces. Le chargeur
recalcule cet état à la fin de chaque passage.

---

## B. L'extension Chrome (mises à jour)

### Installer (une fois)

1. Dans le DMS : **Paramètres → Extension My Ducati → Télécharger l'extension** (fichier zip), puis
   décompresser le zip dans un dossier fixe (ex. `Documents\extension-dms-ducati`).
   Ou, sur le PC de développement, utiliser directement le dossier `tools/myducati-extension` du dépôt.
2. Chrome : ouvrir `chrome://extensions`, activer **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisir le dossier. Si une ancienne version est déjà
   installée : bouton **Actualiser** (flèche ronde) sur sa carte.
4. La même extension sert à My Ducati et au catalogue (version 0.10.0 ou plus).

### Lancer un import

1. Ouvrir le **DMS** dans un onglet, connecté avec un compte **administrateur**, société choisie.
   Garder cet onglet ouvert pendant tout l'import.
2. Dans un autre onglet, se connecter à l'**e-catalog** (`https://e-catalog.ducati.com/EPC/`).
3. Sur l'e-catalog, bouton rouge **« Importer le catalogue »** (en bas à gauche).
4. **Lire la liste des modèles** (≈ 150 pages, 3 minutes). Le panneau montre ensuite :
   - le résumé (modèles gardés, modèles-années à lire, modèles hors Europe exclus, millésimes avant 2000
     exclus) ;
   - la liste des familles et des modèles à cocher / décocher (un modèle hors Europe peut être coché) ;
   - le délai entre deux pages (1 s par défaut, jamais moins de 0,5 s) et la durée estimée.
5. **Lancer l'import**. Les pages sont lues **une par une** ; les vues éclatées déjà connues du DMS
   sont sautées.
6. **Pause** / **Reprendre** à tout moment. Si le navigateur est fermé, l'import reprend tout seul
   à la réouverture de l'e-catalog (après quelques secondes, bouton « Ne pas reprendre »).
7. Arrêt immédiat avec un message clair si :
   - la session Ducati a expiré ou l'accès est refusé → se reconnecter à l'e-catalog, puis **Reprendre** ;
   - l'e-catalog demande de ralentir → attendre une dizaine de minutes, augmenter le délai, **Reprendre** ;
   - l'onglet du DMS est fermé → le rouvrir, **Reprendre**.

### Ce que l'extension enregistre

Dans le navigateur (`chrome.storage.local`) : la liste à lire, l'avancement et les compteurs.
**Aucun identifiant, mot de passe ni jeton.** Les données du catalogue partent vers le DMS, qui les
enregistre sous votre session DMS.

---

## Durées (estimations au 21/09)

- **Pièces, Europe depuis 2000** : environ 1 000 modèles-années (≈ 45 % des 2 378 mesurés). Chaque
  modèle-année = 1 page « groupes » + ses vues (≈ 76). Sans vues communes : ≈ 77 000 pages, soit
  ≈ 27 h à 1 page/s. Les vues sont très partagées entre variantes et millésimes voisins : on attend
  3 à 5 fois moins de vues distinctes, soit **≈ 6 à 9 h** de lecture au total (réparties sur
  plusieurs sessions grâce à la reprise).
- **Accessoires** (mesuré le 21/09) : 15 familles, ≈ 1 940 produits distincts → ≈ 1 960 pages,
  **≈ 35 min**. **Vêtements** : 512 produits → ≈ 520 pages, **≈ 10 min**.
- Le chargement en base des fichiers est rapide (quelques minutes).

## Images

Les images des vues éclatées restent **sur le site Ducati** : le DMS garde seulement leur adresse
(pas de copie massive). Si Ducati change ses adresses ou si une image ne s'affiche plus, une étape
ultérieure pourra **copier seulement les vues réellement utilisées** (dans un devis / un OR) dans le
stockage du DMS.
