---
mission: 08
titre: Ventes et facturation — vendre une moto ou des pièces de bout en bout
etat: 🟦
ouverte_le: 2026-10-31
modules: [M06, M09, M01, M05]
---

# Mission 08 — Ventes et facturation

> **Objectif** : qu'un vendeur puisse, depuis la fiche d'un client, faire un devis pour une moto ou
> des pièces, l'envoyer, encaisser l'acompte, le transformer en facture et, au besoin, l'annuler par
> un avoir — sans jamais tomber sur un bouton muet, un document vide ou un montant faux.

Carte CRM d'origine : « Ventes & facturation : créer un devis pour un client ne fonctionne pas »
(Simon, 30/10/2026). Audit du parcours fait le 31/10/2026 (code + base de production en lecture,
écritures testées dans des transactions annulées), branche `lot-ventes-audit`.

## 1. Le besoin

Simon, le 30/10 : « j'ai essayé de créer un devis pour un client mais ça ne marche pas du tout
bien ; quand je clique sur Valider, je peux extraire en PDF mais c'est vide, à 0 EUR et en
français vu qu'il n'y a pas de client choisi. »

Le besoin derrière : **vendre au comptoir**. Une moto (avec ses options et le montage) ou des
pièces et accessoires, pour un client identifié, avec un devis qui ressemble à celui de G8, un
acompte, une facture, un avoir si on s'est trompé, et le stock qui bouge au bon moment. Le
module existe depuis juin (mission 05 en septembre) mais **n'a jamais servi pour de vrai** : il
fallait le dérouler comme un vendeur, pas ajouter une carte de plus.

## 2. Ce que le DMS a (inventaire honnête du 31/10/2026)

### 2.1 Les chiffres (base `ujmrosbgkvgvwfnuryna`)

| Quoi | Valeur |
|---|---|
| Documents de vente | **17 814**, dont **6 créés dans le DMS** (17 808 repris de G8) |
| Les 6 du DMS | 2 devis de Simon du 29/10 (`DEV-2026-00001` « Devis atelier » avec une ligne « Diagnostic (4 h) » à **0 €**, `DEV-2026-00002` avec une ligne « TEST » à **0 €**, tous deux **avec un client**), 2 factures de démo de juin, 1 facture d'OR de juin (lignes « vis », « thierry » à 0 €), 1 ticket de caisse de juin |
| Règlements | 2 (démo de juin) · Signatures : **0** · Mouvements de stock d'origine vente : **1** |
| Contacts | 8 179 (8 178 en français, 1 en italien) |
| Sociétés | **1** en base (ITALBIKE STORE) ; NL INVEST n'existe pas en production |
| Séquences | DEV à 3, FAC à 5, TIK à 2 ; BC, RES, BL, AVO jamais utilisées |
| Paramètres | 31 articles de main-d'œuvre (type T), 10 modes de règlement, IBAN / logo / CGV / pied de facture renseignés, **0 commentaire type**, **0 règle de validité** (donc « Devis valable 1 mois » par défaut), **tarif horaire des frais de devis atelier non renseigné** (d'où le « Diagnostic (4 h) » à 0 €) |

Lecture des deux devis de Simon : le client **était** choisi (fiche en français → PDF en français,
c'est la règle I18N004 : le document part dans la langue de la fiche du client, pas dans celle de
l'écran). Le « vide à 0 € » vient de lignes sans prix : un texte libre « TEST », et des frais de
diagnostic dont le tarif horaire n'est pas paramétré. L'écran a laissé valider, numéroter et
imprimer tout ça sans un mot.

### 2.2 Le parcours, étape par étape

| Étape | Ce qui se passe | Verdict |
|---|---|---|
| Fiche client → « Nouveau document » | Ouvre l'éditeur avec `?contactId=`. **Le client n'était repris que s'il faisait partie des 500 premiers contacts** (recherche sans terme, 8 179 fiches) : pour la plupart des clients, l'éditeur s'ouvrait **sans client, sans message**. Libellé du bouton écrit en dur (hors dictionnaire). Type proposé : **Facture**, pas devis. | **Cassé → corrigé** (lecture directe de la fiche, toast si introuvable, libellé traduit). Type par défaut : carte 3. |
| Ventes → Nouveau | Même éditeur, sans client. On pouvait **valider sans client** (sauf ticket) : devis, bon de commande, facture pour personne. | **Cassé → corrigé** (refus avec message, brouillon toujours possible sans client). |
| Ligne article | Recherche dès 2 caractères (`part_order_article_search` : référence, désignation, réf. fournisseur, code-barres), prix de vente et TVA repris, pastille disponible / en commande / à commander. **Aucun résultat = rien à l'écran** : le vendeur tape un texte libre sans le savoir, à 0 €. | Marche ; **muet → corrigé** (« Aucun article trouvé pour … : la ligne restera en texte libre »). |
| Ligne main-d'œuvre / texte / vide / commentaire type | Fonctionne (mission 05 carte 5). Table des commentaires types vide. | Marche. |
| Devis atelier (frais de devis) | Case « Devis atelier » → « Diagnostic (4 h) » à **0 €** parce que le tarif horaire n'est pas renseigné ; l'écran l'écrit en petit mais laisse ajouter la ligne. | **Muet** → carte 4. |
| Totaux | `computeTotals` juste pour les lignes positives (8 tests + 5). **Pour un avoir (lignes négatives), la TVA était perdue (0) et une remise en € mettait le HT à 0.** | **Faux → corrigé** (2 tests). |
| Enregistrer en brouillon | Crée le document sans numéro… **et c'est une impasse** : aucun écran ne permet de rouvrir, modifier, valider ou convertir un brouillon (seulement le dupliquer en un autre brouillon, ou le supprimer). | **Cassé** → carte 1. |
| Valider | Avant : numéro pris **avant** d'écrire les lignes ; si une ligne était refusée par la base (ex. moto sans VIN, trigger `trg_moto_sans_vin_bloque_la_vente`), il restait un **document validé, numéroté et vide**. On pouvait valider un devis sans aucun montant. Message d'erreur : « Erreur » (les erreurs Supabase ne sont pas des `Error`, le détail était perdu). | **Cassé → corrigé** : en-tête en brouillon, lignes, puis numéro et statut (brouillon orphelin retiré en cas de refus, aucun numéro consommé) ; validation à 0 € refusée depuis l'écran de vente ; vrai motif affiché sous les totaux **et** en toast. Testé en base (transaction annulée) : `DEV-2026-00003`, opérateur posé par le serveur, 3 lignes d'audit `events`. |
| Fiche du document | Lignes, totaux, reste à payer, financement, QR de virement, GED, conversions, avoir. Un document **validé n'est plus modifiable** (ni supprimable) : conforme. | Marche. |
| Aperçu PDF | Vrai PDF (jsPDF) avec en-tête société, client, lignes (article, MO en heures, texte, vide), détail TVA, totaux, règlements, reste à payer, validité, case « Bon pour accord », CGV. Langue = langue de la fiche client. Le PDF **reflète fidèlement** ce qui est en base : un devis à 0 € donne un PDF à 0 €. | Marche (4 tests). |
| Imprimer | Fenêtre HTML ; **une erreur était avalée** (promesse sans `catch`). | **Muet → corrigé** (toast). |
| Envoyer par e-mail | Fenêtre avec boîte d'envoi, destinataire, PDF joint, « Vérifier sans envoyer », archivage GED, trace `events`. Jamais utilisée en vrai. | Marche sur le papier ; à tester avec sa propre adresse (mission 05 carte 8). Fonction `graph-send-email` à redéployer (I18N004). |
| Acompte / règlement | Multi-modes, différé, espèces avec rendu, « versé par l'organisme ». Message d'erreur générique. | Marche ; message **corrigé**. Suppression physique d'un règlement : carte 9. |
| Devis → bon de commande / réservation / BL / facture | Lignes recopiées (type compris), pied, acomptes reportés, financement reporté, réservation libérée, source « convertie ». Facture = sortie du stock réel ; devis et BC ne touchent pas au stock. Pas de confirmation avant de créer la facture (numérotée, irréversible). | Marche (tests) ; confirmation : carte 6. |
| TVA marge (type O) | La mention légale est imprimée, mais **la TVA est calculée sur le prix total**, pas sur la marge (B2, connu depuis le 18/09). | **Faux** → carte 5. |
| Avoir | Lignes négatives, réintégration du stock, remboursement des règlements, facture annulée. TVA de l'avoir : corrigée ci-dessus. | Marche désormais. |
| Numérotation | `next_document_number` : par société et par type, remise à zéro annuelle, numéro seulement à la validation. Testé en base : `DEV-2026-00003`, `DEV-2026-00004`, `FAC-2026-00005`, `BC-2026-00001` (transaction annulée). | Marche. |
| Facture d'OR (atelier) | `transformToInvoice` passe par le même `createDocument` : **un OR sans client ne pourra plus être facturé** (refus « Choisissez un client »). Non modifié (autre lot). | À savoir. |

## 3. Cartes proposées

### A. Ce qui empêche de vendre aujourd'hui

**Carte 1 — Rouvrir et modifier un brouillon, puis le valider**
- *Pourquoi* : « Enregistrer en brouillon » est une impasse ; un vendeur qui prépare un devis en deux fois le perd. Un devis validé ne se modifie pas non plus : pour changer une ligne, il faut tout refaire (dupliquer → modifier → valider, et l'ancien reste).
- *Test* : Ventes → Nouveau → Brouillon → l'ouvrir → modifier une ligne → Valider → numéro attribué.
- *Avis* : indispensable, à faire en premier. Même éditeur, chargé depuis le document ; réservé aux brouillons (un document validé reste figé, B7).

**Carte 2 — Choisir la moto sur le devis**
- *Pourquoi* : l'éditeur ne permet pas de rattacher un véhicule (seul un devis ouvert depuis un OR en a un). Un devis moto sans fiche moto = pas de VIN, pas de bloc véhicule sur le PDF, pas d'historique par VIN (B9, VEN004).
- *Test* : Nouveau devis → choisir une moto du parc ou du stock → le PDF montre VIN / modèle.
- *Avis* : nécessaire pour vendre une moto ; petit sélecteur dans l'en-tête, comme le client.

**Carte 3 — Proposer « Devis / proforma » par défaut, pas « Facture »**
- *Pourquoi* : le type proposé est Facture ; un clic sur Valider par réflexe consomme un numéro de facture et sort le stock. Depuis la fiche client, le vendeur veut d'abord un devis.
- *Test* : fiche client → Nouveau document → le type affiché est Devis / proforma ; Ventes → Nouveau aussi.
- *Avis* : décision client (G8 ouvrait sur « Facture » ?) ; le lien `?docType=DEV` existe déjà depuis cet audit, il suffit de l'utiliser.

**Carte 4 — Frais de devis atelier : refuser la ligne à 0 €**
- *Pourquoi* : sans tarif horaire (Paramètres → Tables → Frais de devis atelier), la case « Devis atelier » ajoute « Diagnostic (4 h) » à 0 €, et c'est exactement le devis `DEV-2026-00001` de Simon.
- *Test* : tarif vide → le bouton « Ajouter les frais » refuse et renvoie vers le paramètre ; tarif rempli → ligne au bon prix.
- *Avis* : franc, petit, à faire avec la carte 1 ; et **renseigner le tarif** en production dès maintenant.

**Carte 5 — TVA sur la marge pour une occasion de particulier (type O)**
- *Pourquoi* : la facture d'une occasion calcule la TVA sur le prix total ; le registre VO (M12) la recalcule sur la marge : les deux ne concordent pas (B2). Première vente d'occasion = première facture fausse.
- *Test* : facturer un article de type O acheté 8 000 € vendu 10 000 € → TVA = 21 % de 2 000 €, mention art. 58 §4.
- *Avis* : à trancher avec le comptable avant la première VO ; règle 7 de `CLAUDE.md` exige des tests.

### B. Ce qui est pénible ou risqué

**Carte 6 — Demander confirmation avant de créer une facture ou un avoir**
- *Pourquoi* : « Convertir en facture » et « Générer un avoir » agissent au premier clic : numéro consommé, stock sorti ou réintégré, facture annulée. Pas de retour possible.
- *Test* : clic → fenêtre « Créer la facture FAC-… pour X € ? » → Annuler ne fait rien.
- *Avis* : petit, à faire ; même fenêtre que la suppression d'un brouillon.

**Carte 7 — Une seule transaction pour créer un document**
- *Pourquoi* : l'écran enchaîne en-tête, lignes, numéro, mouvements de stock depuis le navigateur. Depuis cet audit, un refus des lignes ne laisse plus d'orphelin, mais un échec **après** le numéro laisse un document validé sans stock sorti. La bonne forme est une fonction SQL `document_create` (tout ou rien) + le garde-fou en base écrit dans `supabase/migrations/20261031130000_m6_ventes_corrections.sql` (non appliqué).
- *Test* : simuler une moto sans VIN sur une facture → rien n'est créé, message clair.
- *Avis* : à faire avant le go-live, avec les conversions et les avoirs (mêmes enchaînements).

**Carte 8 — Dire au vendeur dans quelle langue partira le document**
- *Pourquoi* : Simon a lu « en français » comme une erreur ; c'est la langue de la fiche du client (I18N004). Une pastille « Documents en : Français » à côté du client dans l'éditeur et sur la fiche du document évite la question.
- *Test* : client en néerlandais → pastille « Nederlands » → PDF « NOG TE BETALEN ».
- *Avis* : petit, utile le jour où l'équipe envoie des devis à des clients flamands.

**Carte 9 — Annuler un règlement par un règlement négatif, pas par suppression**
- *Pourquoi* : la corbeille d'un règlement l'efface de la table (trace `events` seulement). Un comptable veut voir l'erreur et sa correction.
- *Test* : règlement de 100 € → « Annuler » → ligne −100 € datée, reste à payer recalculé.
- *Avis* : à faire avant la première clôture de caisse réelle.

### C. Ce qui manque

**Carte 10 — Signature électronique du devis / bon de commande (VEN003)**
- *Pourquoi* : 0 signature en base, table `document_signatures` inutilisée ; le PDF a une case « Bon pour accord » à signer à la main. Le bloc de signature existe (`signature-pad.tsx`, M7).
- *Test* : envoyer le devis → le client signe sur l'écran client ou sur la tablette → PDF signé en GED, statut « accepté ».
- *Avis* : grosse carte, après les cartes 1 et 2.

**Carte 11 — Échéance et conditions de règlement par défaut par type de document**
- *Pourquoi* : sans échéance saisie, le PDF imprime la date du jour comme échéance et « AU GRAND COMPTANT » ; la colonne `condition_reglement` n'est remplie que par la reprise G8.
- *Test* : Paramètres → « Conditions de règlement » (ex. facture à 30 jours) → nouveau document pré-rempli.
- *Avis* : petit, confortable.

**Carte 12 — Deuxième société en base**
- *Pourquoi* : la numérotation est par société (testé), mais NL INVEST n'existe pas en production : tout est ITALBIKE STORE. À créer avec ses séquences, IBAN, logo, CGV quand le client le demandera (COM005).
- *Avis* : décision client ; rien à coder, une ligne dans Paramètres → Sociétés.

## 4. Décisions
Aucune nouvelle décision : les corrections du 31/10 n'ont changé aucune règle métier (un document
validé a un client sauf le ticket de caisse ; un devis sans aucun montant ne se valide pas depuis
l'écran de vente, un brouillon reste libre).

## 5. Ce qui a changé dans l'application (31/10/2026, branche `lot-ventes-audit`, à valider)

Module [M06](../modules/M06-ventes-caisse.md) (§9 pour l'historique) :
- `src/modules/sales/write-api.ts` : `documentValidationError` (sans ligne / sans client sauf TIK /
  sans montant), refus dans `createDocument` pour un document validé ; écriture en-tête brouillon →
  lignes → numéro + statut → stock, brouillon orphelin retiré si les lignes sont refusées ;
  `computeTotals` juste pour les montants négatifs (TVA et remise € des avoirs).
- `src/modules/sales/document-editor.tsx` : client lu directement par `getContact` (toast s'il
  est introuvable), type proposé par `?docType=`, refus clairs avant d'écrire, erreur réelle
  (`errorMessage`) sous les totaux et en toast, « Aucun article trouvé » sous la recherche.
- `src/routes/_app.sales.new.tsx` (`docType`), `src/routes/_app.clients.$contactId.tsx` (libellé
  traduit), `src/routes/_app.sales.$documentId.tsx` (impression et SMS : vraie erreur en toast),
  `src/modules/sales/payment-panel.tsx`, `document-mail-dialog.tsx` (vraie erreur).
- Dictionnaires FR / NL / EN / IT : `sales.needClient`, `sales.needAmount`, `sales.articleNone`,
  `contacts.newDoc`.
- Tests : `tests/sales-validation.test.ts` (15 cas : totaux à 3 lignes, refus de validation,
  devis → facture, avoir avec TVA et remise). Migration **écrite, non appliquée** :
  `supabase/migrations/20261031130000_m6_ventes_corrections.sql` (garde-fou en base).

Vérifié en base, transactions annulées, en simulant un administrateur : numérotation par société et
par type (`DEV-2026-00003` puis `-00004`, `FAC-2026-00005`, `BC-2026-00001`), création
en-tête → lignes → validation (opérateur écrit par le serveur, 3 lignes `events`).

## 6. Risques et points d'attention
- **Facture d'OR sans client** : refusée désormais par `createDocument` (« Choisissez un client »).
  Le module atelier n'a pas été modifié ; si un OR sans client doit pouvoir être facturé, dire-le.
- **Dupliquer** une facture G8 sans lignes donne toujours un brouillon vide (le contrôle « au moins
  une ligne » ne s'applique qu'à la validation) ; un brouillon reste une impasse (carte 1).
- Les écritures de stock après le numéro ne sont toujours pas dans la même transaction (carte 7).
- Rien n'a été vu dans un navigateur : lecture du code, base en lecture, tests unitaires et SQL.
