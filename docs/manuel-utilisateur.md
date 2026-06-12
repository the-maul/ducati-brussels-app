# Manuel d'utilisation — DMS Ducati Bruxelles

> Guide pas-à-pas pour exploiter chaque module. Pour chaque tâche : **où cliquer**, **quoi remplir**, **ce que ça crée**.
> L'application s'ouvre sur **http://localhost:8080** (ou votre adresse de production).

## Repères généraux (présents partout)
- **Menu de gauche (sidebar)** : tous les modules. L'item actif est surligné (barre rouge).
- **Barre du haut** :
  - **Sélecteur de société** (en haut à droite) : bascule entre **ITALBIKE STORE** et **NL INVEST**. ⚠️ Tout ce
    que vous voyez et créez dépend de la société active.
  - **Recherche globale** (champ central, ou **Ctrl + K**) : tapez un VIN, un nom client, une référence pièce
    ou un n° de facture pour aller droit au but.
  - **Avatar** (coin droit) : se déconnecter.
- **Logique commune** : une page = une **liste** (avec recherche/filtres) → bouton **« Nouveau… »** en haut à
  droite pour créer → un clic sur une ligne pour **ouvrir/éditer** la fiche.
- **Statuts** : toujours une **couleur + une pastille + un libellé** (jamais juste une couleur).

---

## 1. Tableau de bord (accueil)
**À quoi ça sert** : vue d'ensemble chiffrée de la société active.
- À l'ouverture, vous voyez les indicateurs **CA du jour**, **CA du mois**, **Factures du mois**,
  **Encours clients**, **OR ouverts**, **Valeur du stock**, **Véhicules en stock** — calculés en direct.
- Pas d'action ici : c'est un cockpit. Les détails se trouvent dans **Rapports** et **Comptabilité**.

---

## 2. Contacts (clients & fournisseurs)
**À quoi ça sert** : gérer **tous** les contacts (clients, prospects, fournisseurs, banques).

**Créer un client**
1. Menu **Contacts** → bouton **« Nouveau client »** (en haut à droite).
2. Choisissez le **Type** (Particulier / Professionnel / Fournisseur / Banque-leasing). Le formulaire s'adapte :
   pour un particulier vous avez Permis/Catégorie, pour un fournisseur vous avez RFA/franco/mini.
3. Remplissez au minimum le **Nom** (ou la Raison sociale pour un pro). Complétez adresse, téléphones, e-mail.
4. Onglet **B2B** : n° TVA, IBAN, conditions de paiement, limite de crédit.
5. **Créer la fiche**. → Une ligne apparaît dans la liste Contacts.

**Exploiter la fiche client** (cliquez sur un client) — onglets en haut :
- **Fiche** : modifier les coordonnées. Le **bandeau encours** (en haut) montre autorisé / actuel / disponible.
- **Parc** : toutes les motos (VIN) liées à ce client.
- **Documents** / **Échéances** : ses factures et ce qu'il reste à payer.
- **Livraisons** : ses adresses de livraison.
- **Contacts** : sous-contacts (pour un B2B).
- **Tarifs** : grilles tarifaires du client.
- **Documents & photos** : joindre une pièce d'identité, un justificatif (bouton **Ajouter**, on peut mettre un
  **libellé** ; sur mobile la caméra s'ouvre).
- **Communications** : journaliser un **appel / e-mail / SMS / note** (entrant ou sortant) → historise l'échange.

**Filtrer** : en haut de la liste, le menu déroulant **type** (Tous / Particuliers / Pro / Fournisseurs / Banque).

---

## 3. Véhicules & parc
**À quoi ça sert** : la fiche **VIN** (châssis), le parc moto, l'historique des propriétaires.

**Enregistrer une moto**
1. Menu **Véhicules** → **« Nouveau véhicule »**.
2. Remplissez l'**Identification** (VIN/châssis, marque, modèle, plaque, n° moteur, type mine…), les
   **Caractéristiques** (cylindrée, puissance, **bridé A2**, énergie, antipollution, TPMS, trackers GPS…) et les
   **Infos** (mise en circulation, kilométrage, garantie, n° livre de police…).
3. **Créer le véhicule**. → Une ligne apparaît dans le parc.

**Exploiter la fiche véhicule** (cliquez dessus) :
- En haut : **historique des propriétaires** (daté).
- Le formulaire pour modifier les champs.
- Section **Documents & photos** : ajouter des **photos** (carte grise, COC, état avant/après) avec un
  **libellé** — elles restent dans l'historique du véhicule.
- **Filtrer le parc** : menu déroulant statut (en stock neuf/occasion, dépôt-vente, réservé, vendu…).
> 💡 Un véhicule créé automatiquement par une **réception châssis** (Achats) ou une **reprise** (Reprises) est
> déjà lié à son article — pas besoin de le ressaisir.

---

## 4. Reprises & ORO
**À quoi ça sert** : reprendre une occasion (flux B3) et suivre sa **remise en état** + sa **rentabilité par VIN**.

**Saisir une reprise**
1. Menu **Reprises & ORO** → **« Nouvelle reprise »**.
2. Choisissez **Particulier** (→ occasion type O) ou **Professionnel** (→ type P), remplissez la désignation,
   le **VIN**, marque/modèle, le **prix de reprise** et le prix de revente envisagé.
3. **Créer la reprise**. → En un clic, l'app crée **l'article occasion**, **la fiche véhicule**, l'**entrée en
   stock valorisée**, et **ouvre un ORO** (ordre de remise en état). Vous arrivez directement sur l'ORO.

**Compléter l'ORO** (remise en état)
1. Ajoutez des lignes : **Pièce** (recherchez l'article → il sort du stock en cession), **Main d'œuvre**, ou
   **Frais**.
2. Chaque ligne met à jour le **coût de revient** du véhicule et la **marge potentielle** (affichés en haut).
3. **Clôturer l'ORO** quand la remise en état est finie.

**Cessions internes** (sorties valorisées non facturables : cadeau, démo, garantie, fournitures atelier) :
Menu **Stock & inventaire** → bouton **Cessions internes** → choisir l'article, la quantité, le **type de
cession** et une note → **Enregistrer**. → Le stock est débité et tracé.

---

## 5. Atelier & SAV (OR, planning, chronos)
**À quoi ça sert** : les ordres de réparation (OR), la prise de RDV et le pointage atelier.

**Créer un OR (réception d'une moto à l'atelier)** — *exemple complet*
1. Menu **Atelier & SAV** → **« Nouvel OR »**.
2. En-tête : recherchez le **Client** (ou créez-le), sélectionnez le **Véhicule** (par VIN/plaque/modèle),
   saisissez le **kilométrage**, l'**opérateur**, le **type de réparation**, et le **statut** (À faire).
3. **Travaux demandés** + **Observations à la réception** (état du véhicule, anti-litige).
4. **Lignes** : ajoutez des **Pièces** (recherchez l'article), de la **Main d'œuvre** ou du **Texte**. Pour une
   pièce prise en charge **sous garantie**, cochez la case **Garantie** de la ligne (son prix passe à 0).
5. **Enregistrer**. → L'OR apparaît dans la liste Atelier avec son statut.

**Gérer la garantie (B10)** : sur la fiche OR, le champ **Prise en charge garantie** : « En attente » **bloque la
facturation** tant que la décision n'est pas prise ; passez à **Acceptée** (toutes les pièces garanties),
**Refus total** (le client paie tout) ou **Refus partiel** (cochez ligne par ligne les pièces couvertes).

**Facturer l'OR** : sur la fiche OR, bouton **« Transformer en facture »** → crée la facture (le stock réel est
débité), l'OR passe « Facturé », et vous pouvez **« Voir la facture »** pour encaisser/imprimer.

**Planning des RDV** : Atelier → bouton **Planning** → vue semaine. Bouton **Nouveau RDV** : client, véhicule,
mécanicien, date/heure, **véhicule de prêt**, rappel SMS. Sur un RDV, changez le **statut** (couleurs) ou cliquez
**Créer l'OR** pour générer l'ordre de réparation directement.

**Pointeuse (chronos)** : Atelier → bouton **Pointeuse**. Le mécanicien tape son nom, **pointe l'arrivée**, puis
**démarre le travail** sur un OR. Le **temps passé** s'accumule et s'affiche sur l'OR.

---

## 6. Pièces & Accessoires (articles & tarifs)
**À quoi ça sert** : le référentiel articles (pièces, accessoires, forfaits, main d'œuvre, occasions…).

**Créer un article**
1. Menu **Pièces & Accessoires** → **« Nouvel article »**.
2. Remplissez référence, désignation, **type de gestion** (A pièce stockée, T main d'œuvre, etc.), rayon/casier,
   et les **prix** : saisissez **l'un** des champs (PA, coefficient, PV HT, PV TTC ou marge) → **les autres se
   recalculent** automatiquement (en tenant compte de la table d'arrondis).
3. **Créer l'article**.

**Exploiter la fiche article** (onglets) : **Stock** (réel/réservé/dispo), **Codes-barres**, **Kit/nomenclature**,
**Remplacement** (remplacer une réf → transfert du stock + recalcul PAMP), **Statistiques**, **Documents &
photos** (les photos alimentent l'e-shop).
- Bouton **« Imprimer l'étiquette »** (en haut) : génère une **étiquette code-barres scannable** (Code128) avec
  réf, désignation, prix.

**Importer un tarif fournisseur** : **Pièces → Importer un tarif** → collez un CSV (1re ligne = en-têtes) →
**Analyser** (aperçu des créations/mises à jour/anomalies) → **Appliquer**.

---

## 7. Achats & réceptions
**À quoi ça sert** : commander chez les fournisseurs et **réceptionner = entrer en stock**.

**Gérer les fournisseurs** : Achats → bouton **Fournisseurs** → **Nouveau fournisseur** (n° de client chez le
fournisseur, RFA, franco de port, minimum de commande).

**Faire une réception** (entrée de stock)
1. Achats → **Nouvelle réception**.
2. En-tête : fournisseur, **n° facture/BL**, dates, **régime TVA** (avec TVA / C.E.E. sans TVA / hors C.E.E.).
3. **Lignes** : recherchez l'article, saisissez quantité, prix d'achat, **casier**, nombre d'**étiquettes**.
4. (Réception de moto neuve) Sur une ligne, cliquez l'icône **moto** → saisissez le **châssis** (VIN, moteur,
   puissance+bridé, TPMS, garantie…) → cela **créera la fiche véhicule** (type V).
5. **Échéances** : ajoutez les échéances de paiement.
6. **Valider**. → Le stock **augmente** et le **PAMP** est recalculé (visible sur la fiche article).

**Proposition de commande (réappro)** : Achats → bouton **Proposition de commande** → la liste des articles sous
le stock mini, quantités suggérées → **Créer les commandes** (regroupées par fournisseur).

**Commande Ducati** : créez une **Nouvelle commande** ; sur sa fiche, **Export DCS Standard / Urgente**.
> ⚠️ Le format DCS sera aligné sur le gabarit Ducati réel.

---

## 8. Stock & inventaire
**À quoi ça sert** : voir le stock (triple stock + valeur) et faire l'inventaire.

**Consulter le stock** : menu **Stock & inventaire** → liste avec **Réel / Réservé / Disponible**, **PAMP**,
**Valeur** ; filtres « Stock ≠ 0 » et « Sous le mini ». Icône **historique** sur une ligne = tous les mouvements
de l'article.

**Faire un inventaire**
1. Stock → bouton **Inventaire** → **cochez les options** : *Magasin ouvert* (génère un arrêté), *Avec remise à
   zéro*, *Avec édition des écarts* → **Démarrer**.
2. (Si magasin ouvert) **Générer l'arrêté** (photo du stock).
3. **Comptage** : recherchez/scannez chaque article et saisissez la quantité **comptée** → **Valider le comptage**
   (l'app insère l'écart, jamais d'écrasement).
4. **Écarts** : comparez réel vs arrêté (quantité + valeur).
5. **Réintégrer l'arrêté** (opération unique) puis **Clôturer la caisse/inventaire**.

---

## 9. Ventes & Facturation
**À quoi ça sert** : créer et gérer les documents (facture, devis, réservation, BL, ticket, avoir).

**Créer une facture / un devis…**
1. Menu **Ventes & Facturation** → **« Nouveau document »**.
2. Choisissez le **Type** (Facture, Devis, Réservation, Bon de livraison, Ticket), sélectionnez le **Client**.
3. **Lignes** : recherchez un article ou tapez du texte libre ; ajustez qté, PU, TVA, remise.
4. **Pied de facture** : remise globale (% ou €), mode **HT/TTC**, **détaxe** (export 0 %), frais de **port**,
   **net TTC forcé** (arrondi). Les totaux se recalculent.
5. **Valider** (ou Brouillon). → Le document reçoit un **numéro**, et selon le type le **stock** est débité
   (facture/ticket = réel ; réservation/BL = disponible).

**Sur la fiche d'un document** :
- **Convertir** : Devis → Facture/BL/Réservation, Réservation → Facture/BL, BL → Facture (l'acompte se reporte).
- **Générer un avoir** (depuis une facture) : lignes négatives, stock réintégré, remboursement.
- **Imprimer** (PDF), **Export UBL** (e-facturation Peppol — le fichier ; la transmission Falco s'activera avec la clé).
- **Encaisser** : panneau de règlement (multi-modes, partiel, à échéance, **rendu de monnaie** sur espèces).

---

## 10. Caisse (comptoir)
**À quoi ça sert** : la **vente rapide au comptoir** et la **clôture Z**.

**Vendre au comptoir** : menu **Caisse** → onglet **Vente comptoir**.
1. **Scannez** (code-barres) ou recherchez un article → il s'ajoute au **panier** (réajustez les quantités).
2. Le **total** s'affiche à droite → bouton **Encaisser**.
3. Choisissez le(s) **mode(s)** de règlement (rendu de monnaie sur espèces) → **Imprimer le ticket** →
   **Nouvelle vente**. → Crée un **ticket** validé, débite le stock.

**Caisse & clôture Z** : onglet **Caisse & clôture Z** :
- **Ouvrir une session** avec le fond de caisse.
- **Mouvements de fond de caisse** : entrées/sorties d'argent.
- **Journal Z** : encaissements par mode + ventilation TVA.
- **Clôturer** : **comptage du tiroir** (par coupure) → écart calculé → clôture.

---

## 11. CRM
**À quoi ça sert** : le suivi commercial (prospects/leads).
- Menu **CRM** : un **pipeline** en colonnes (Nouveau → Contacté → Qualifié → Proposition → Gagné / Perdu).
- **Nouveau lead** : nom, e-mail, téléphone, **véhicule recherché**, source, valeur estimée.
- Sur une carte, changez l'**étape** (menu déroulant) pour faire avancer l'affaire.
- Le **suivi des échanges** se fait dans l'onglet **Communications** de la fiche contact (voir §2).
> ⚠️ L'envoi réel d'e-mails/SMS (campagnes) s'activera avec les clés Resend/SMS.

---

## 12. E-shop (site web + boutique)
**À quoi ça sert** : construire et publier un **site web** avec vos **produits**.

**Construire le site** : menu **E-shop** → onglet **Site**.
- **Pages** : créez plusieurs pages (Accueil, Atelier, Occasions…) — un **menu de navigation** apparaît en haut
  du site. Renommez/supprimez une page.
- **Blocs** : bouton **Ajouter un bloc** → choisissez parmi **Bannière, Bandeau, Texte, Image, Galerie, Colonnes
  (atouts), Bouton d'action, Vidéo, Carte, FAQ, Horaires, Produits, Contact, Séparateur**. Réordonnez (↑↓),
  supprimez (🗑). Dans **Colonnes/atouts**, l'icône se choisit dans une **bibliothèque d'emojis** ou en
  **chargeant une image**.
- **Thème** : couleurs. **Upload d'images** (bannière, galerie) directement.
- **Aperçu en direct** à droite = exactement ce que verront les visiteurs.
- **Domaine** : l'adresse publique (slug) + votre **domaine OVH** (l'app affiche le **CNAME** à créer chez OVH).
- **Enregistrer le brouillon** puis **Publier le site**.

**Choisir les produits** : onglet **Produits** → bouton **Publier/Retirer** par article (avec photo + prix +
stock). Le bloc « Produits » du site affiche les articles publiés.

**Commandes web** : onglet **Commandes web** → les commandes des visiteurs (changez le statut).

**Voir le site en ligne** : lien **/shop/votre-slug** (ou votre domaine). Le visiteur navigue, ajoute au panier,
commande.
> ⚠️ Le **paiement en ligne (Stripe)** s'active avec votre clé API (sinon la commande est enregistrée « en
> attente de paiement » et vous la traitez à la main).

---

## 13. Rapports
**À quoi ça sert** : analyses sur une période.
- Menu **Rapports** : **CA des 12 derniers mois** (graphe), **Top articles vendus**, **Productivité atelier**
  (présence / travail / taux). Choisissez la période en haut puis **Actualiser**.

---

## 14. Comptabilité
**À quoi ça sert** : journaux, TVA et exports comptables.
- Menu **Comptabilité** : choisissez une **période** → **Journal des ventes** + **Registre TVA** (ventilation par
  taux).
- **Export Winbooks** (bouton) : fichier pour le comptable.
- L'**Export UBL** d'une facture se fait depuis la fiche du document (Ventes).
> ⚠️ Les **formats Winbooks/UBL et la transmission Peppol (Falco)** seront finalisés avec vos accès comptable/Falco.

---

## 15. Paramètres (administrateur)
**À quoi ça sert** : configurer l'application. (Réservé aux administrateurs.)
- **Sociétés** : ajouter/éditer une société (nom, **TVA, adresse, IBAN, identifiant Peppol, comptes** comptables).
- **Utilisateurs** : créer des comptes du personnel et leur attribuer des **rôles** (vendeur, magasinier,
  mécanicien, chef d'atelier, comptable, marketing).
- **Tables de données** : tous les référentiels (TVA, modes/conditions de règlement, civilités, marques, types de
  cession, couleurs, tailles, pays…).
- **Numérotation des documents** : préfixes/formats des séquences (FAC-, OR-, DEV-…) avec aperçu du prochain n°.
- **Migration & imports** : **importer des contacts** depuis un CSV (Analyser en dry-run → Importer).

---

## Parcours-types résumés
1. **Vendre une pièce au comptoir** : Caisse → scanner → Encaisser → ticket.
2. **Réparer une moto** : Atelier → Nouvel OR (client+VIN+travaux) → pièces/MO → garantie → Transformer en facture → encaisser.
3. **Reprendre une occasion** : Reprises → Nouvelle reprise → ORO (pièces/MO) → l'occasion est en stock avec sa marge.
4. **Réapprovisionner** : Achats → Proposition de commande → créer les commandes → réceptionner → le stock monte.
5. **Mettre une boutique en ligne** : E-shop → Site (blocs + thème) → Produits (publier) → Publier le site.
6. **Clôturer la journée** : Caisse → onglet Clôture Z → comptage → clôturer ; puis Comptabilité → exports.
