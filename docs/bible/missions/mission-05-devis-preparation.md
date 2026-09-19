---
mission: 05
titre: Devis moto, options et préparation
etat: 🟦
ouverte_le: 2026-09-19
modules: [M06, M05, M02, M04, M09]
---

# Mission 05 — Devis moto, options et préparation

> **Objectif** : faire au comptoir un proforma complet (moto + options + montage + commentaires),
> l'envoyer, suivre l'acompte et le solde, lancer la commande des pièces au bon moment, et préparer la
> moto et ses options sur tablette sans confusion entre clients.

Liste ERP : « Mission 05 — Devis moto, options et préparation » (`ab2f282c-e231-4e85-8600-fb6cff855265`).
Source : vidéo de Domenico (G8, 14/09, envoyée par Simon le 18/09), proforma n° 2260796 pour le client
test « MOREAU 2 SIMON ». Transcription : `C:\Users\simon\whisper-models\mission5.srt` (approximative,
croisée avec les images). **Feu vert de Simon le 19/09.**

## 1. Le parcours montré dans la vidéo (G8)

| Min. | Ce qu'il fait dans G8 | Ce qu'il dit (souhait) |
|---|---|---|
| 0:19 | Fiche client → Nouveau doc : Facture / Réservation / Livraison / Ordre de réparation / **Proforma** (« équivaut au devis ») | — |
| 0:36 | Choisit l'opérateur à la main (« 2 - DOMENICO ») | « **dans le nouveau système on pourrait directement le connaître** : si c'est Simon qui se connecte, c'est toujours Simon qui génère les documents » |
| 1:09 | Cherche « Scrambler 800 » : 6 variantes, prix, stock ; prend l'Icon Dark 2G (9 990 €), disponible en vert | — |
| 1:23 | Va sur **e-catalog.ducati.com** chercher les options (échappement racing, poignées chauffantes, Quick Shift, supports + valises latérales souples) et recopie les références | « à l'avenir, **on pourrait voir comment assimiler ça dans le nouveau site** » |
| 2:19 | Lignes marquées « E » | « le changement de référence… **il faut prendre la dernière** » ; « le E veut dire que la référence a changé ou qu'il y en a d'autres qui correspondent » ; « la couleur verte = disponible » |
| 3:29 | Ajoute « MO ATELIER VIP1 » 5,5 h « pour le montage, préparation » | — |
| 3:39 | Ligne blanche, puis « rappeler un commentaire » : liste de commentaires enregistrés (commande urgente +10 % avec l'IBAN, 2 h de maîtrise offertes, entretien chaîne inclus, expédition dès acompte de 10 %) ; il le modifie : « PREMIER ENTRETIEN OFFERT » | « on peut rappeler des commentaires… et on peut modifier » |
| 4:29 | Valide, ouvre « Infos stock » : Disponible / Indisponible / En commande, casier (CUISINE/A14), bouton « Associer la commande au client », « Mise en proposition de commande » | — |
| 4:49 | Les valises apparaissent « en commande »… mais pour un autre client | « **c'est un petit bug** dans l'attribution des références commandées : ça ne devrait pas suivre l'attribution à Simon, sauf si c'était commandé pour le stock (ce qui n'arrive jamais) » |
| 5:26 | Doit « rappeler » le document pour sortir la picking list | « **idéalement, pouvoir générer avec un clic droit ou un clic une pick list, ça devrait aller tout seul, je ne dois pas devoir rentrer dans le document** » |
| 5:53 | Picking list : la moto + toutes les options, casier, disponibilité | « **l'idée serait d'avoir ça en digital sur une tablette** : ce qui est disponible, commandé, préparé, monté… localiser où ça se trouve dans le stock et **où ça se trouve quand c'est préparé pour le client** » |
| 7:19 | Aperçu du proforma : en-tête Italbike Store, lignes, commentaires, TVA, « reste à payer », case signature, « devis valable 1 mois » ; envoi par mail au client | — |
| 7:59 | Fiche client : règlements sous le document (« aucun règlement »), **encours financier** en haut à droite | « au niveau visuel **important d'avoir en grand le solde restant dû** » |
| 8:19 | — | « **mettre en place une règle** pour que le bon de commande soit **toujours lancé une fois qu'il y a un acompte versé**, et **ne pas laisser traîner des factures à payer ou des soldes** » |

## 2. Ce que le DMS a déjà (inventaire du 19/09)

- **Documents de vente** : DEV, RES, BL, FAC, TIK, AVO et conversions DEV→RES/BL/FAC ; **pas** de proforma ni de bon de commande ; colonne `operator` jamais remplie (seulement la reprise G8).
- **Lignes** : article ou texte libre ; pas de type de ligne (main-d'œuvre, texte, ligne vide) ; **pas** de commentaires types.
- **Recherche d'article en vente** : sans stock ; pastille de disponibilité par document ou par ligne ; « en commande » **absent** (TODO).
- **Références remplacées** : `superseded_by_id` + onglet Équivalences + transfert de stock ; `equivalence_group` inutilisé ; « librairie » = simple case.
- **Réservations** : valider une RES ou un BL réserve le stock (trace = n° de document).
- **Picking** : tables et écran `/picking` existent.
- **Casiers** : casier principal + plusieurs casiers par article.
- **Impression** : HTML imprimable, pas de vrai PDF. **Mail** : Outlook sans pièce jointe (la fonction d'envoi sait en joindre).
- **Paiements** : `document_payments`, acompte sur RES, reste dû = TTC − payé, report à la conversion ; **financement absent** (table de référence « organismes de financement » existante).
- **Commandes de pièces** : `part_orders` a `contact_id`, `vehicle_id` et `source_document_id` (jamais rempli) ; quantités client / magasin.

## 3. Cartes : pourquoi chacune, et comment elle s'intègre

| # | Carte | Répond à (vidéo) | Intégration dans l'existant |
|---|---|---|---|
| 1 | Créer un proforma, une réservation, un bon de commande ou une facture | 0:19 choix du type ; 0:36 « le nouveau système devrait connaître l'opérateur » | Le DEV existant devient « Devis / proforma » (même chose chez eux) ; ajout du **bon de commande** (commande ferme signée) dans la chaîne DEV → BC → RES/FAC ; numérotation par société ; opérateur = utilisateur connecté, écrit automatiquement et imprimé |
| 2 | Chercher un article et voir sa disponibilité en couleur | 1:09 et 2:29 « couleur verte = disponible » | La recherche de ligne affiche disponible / en commande / à commander (couleur + icône + libellé) calculé sur le triple stock B4 ; « en commande » vient des commandes de pièces |
| 3 | Référence remplacée : proposer automatiquement la dernière | 2:19 « il faut prendre la dernière » | Repère « Remplacée » sur l'ancienne référence ; en un clic la ligne passe sur la dernière de la chaîne `superseded_by` ; équivalents visibles |
| 4 | Ajouter un accessoire trouvé dans l'e-catalog Ducati | 1:23 recopie depuis e-catalog ; « à l'avenir, l'assimiler dans le nouveau site » | Pas d'API Ducati : coller la référence (ou le lien e-catalog) → retrouvée dans les articles/librairie ou créée comme article non stocké à compléter ; lien vers l'e-catalog depuis la ligne. L'intégration du catalogue au site = mission 03 (Shopify) |
| 5 | Lignes de main d'œuvre, lignes vides et commentaires types | 3:29 MO VIP1 5,5 h ; 3:39 ligne blanche, commentaires rappelés et modifiables | Type de ligne : article / main-d'œuvre (T, heures décimales) / texte / ligne vide ; **commentaires types** gérés dans Paramètres (nom court + texte), rappelés dans le document puis modifiables |
| 6 | Liste de préparation en un clic, sur tablette | 5:26 « un clic, sans rentrer dans le document » ; 5:53 « en digital sur une tablette » | Bouton « Préparer » sur la ligne du document dans les listes (fiche client, ventes) → écran tablette `/picking` existant enrichi : moto + options, casier, état par ligne disponible → commandé → préparé → monté, et « emplacement de préparation » du client |
| 7 | Ne pas attribuer le stock commandé pour un autre client | 4:49 « c'est un petit bug dans l'attribution des références commandées » | « En commande » pour un client = uniquement les commandes de pièces **liées à ce client** (ou quantité magasin) ; la commande d'un autre client n'apparaît jamais comme la sienne ; affectation explicite (« Associer la commande au client ») tracée |
| 8 | Aperçu du document et envoi par mail | 7:19 aperçu, signature ; envoi par mail | Aperçu fidèle (en-tête société, lignes, commentaires, TVA, reste à payer, signature, validité) ; envoi Outlook **avec le PDF en pièce jointe** ; copie rangée dans les documents du client |
| 9 | Voir les paiements et le solde restant dû | 7:59 « important d'avoir en grand le solde restant dû » ; encours financier | Paiements existants ; **reste à payer en grand** sur le document et la fiche client ; financement en cours (organisme, montant) affiché |
| 10 | Commander les pièces dès l'acompte et ne laisser aucun solde impayé | 8:19 « une règle pour que le bon de commande soit toujours lancé une fois l'acompte versé, et ne pas laisser traîner des soldes » | Acompte **encaissé** → le DMS propose (et rappelle) la commande des pièces manquantes, liée au client et au document (`source_document_id`) — s'appuie sur la carte mission 02 « Créer une commande de pièces depuis un devis » ; alerte dans la cloche (vendeur du document + admins) pour les soldes et factures impayés |

## 4. Décisions (Simon, 19/09 — feu vert global sur les recommandations)

- « Acompte versé » = acompte **encaissé** (au moins une partie), pas seulement accordé.
- Alerte des impayés : vendeur du document + admins.
- e-catalog Ducati : pas de lecture automatique (pas d'API) ; coller la référence.
- Proforma = devis (même document), libellé « Devis / proforma ».

## 5. Ce qui a changé dans l'application

### Carte 1 — Créer un proforma, une réservation, un bon de commande ou une facture (19/09, à valider)
- Le type DEV s'affiche **« Devis / proforma »** (écran, liste, impression, séquence).
- Nouveau type **« Bon de commande »** (`BC`, préfixe `BC-`, séquence par société visible dans
  Paramètres → Numérotation). Chaîne : DEV → BC → RES / BL / FAC (DEV peut toujours aller directement
  en RES / BL / FAC). Un BC ne bouge pas le stock ; il accepte un **acompte**, reporté à la conversion
  comme sur une réservation. Pastille de disponibilité affichée sur le BC.
- **Opérateur = utilisateur connecté** : écrit par le serveur à la création (`documents.operator_user_id`
  + nom dans `documents.operator`), affiché dans l'éditeur (lecture seule), sur la fiche du document et
  imprimé dans le bandeau « OPERATEUR ». Les documents repris de G8 gardent leur texte d'origine.
  L'opérateur ne peut plus être changé après la création.
- Migration `20260919280000_m6_bon_de_commande_operateur.sql` ; code `src/modules/sales/write-api.ts`
  (`CONVERSIONS`, `DEPOSIT_DOC_TYPES`), `document-editor.tsx`, `availability.ts`,
  `src/routes/_app.sales.$documentId.tsx`, `_app.sales.index.tsx` ; test `tests/sales-doc-chain.test.ts`.

### Carte 2 — Chercher un article et voir sa disponibilité en couleur (19/09, à valider)
- La recherche d'article d'une ligne (devis, bon de commande, facture… mais aussi caisse, OR et tarifs
  clients, qui partagent `searchSaleArticles`) cherche désormais aussi par **réf. fournisseur et
  code-barres** et affiche pour chaque article une pastille **Disponible** (vert, libre = réel − réservé),
  **En commande** (bleu, commande fournisseur CMD validée sans réception) ou **À commander** (orange),
  couleur + icône + libellé ; survol = détail réel / réservé / en commande.
- Sur la ligne choisie, colonne « Dispo » recalculée selon la quantité saisie.
- Pas de nouveau calcul : réutilise la fonction SQL `part_order_article_search` de la mission 02
  (`article_stock` + `_article_on_order_qty`). Articles M / F / T : pas de pastille.
- Code : `src/modules/sales/write-api.ts` (`searchSaleArticles`), `availability.ts` (`saleStockStatus`),
  `availability-badge.tsx` (`SaleStockBadge`), `document-editor.tsx` ; test `tests/sales-stock-status.test.ts`.
- Limite : « en commande » ne distingue pas encore pour quel client la pièce est commandée (carte 7).

### Carte 3 — Référence remplacée : proposer automatiquement la dernière (19/09, à valider)
- Dans la recherche d'article, une référence remplacée porte le repère **« Remplacée »**.
- Une fois posée sur la ligne : bandeau **« Remplacée par … »** (et « dernière référence de la chaîne »
  quand il y a plusieurs remplacements), pastille de disponibilité de la dernière référence et bouton
  **« Prendre … »** qui remplace la ligne par la **dernière** référence (quantité et remise conservées,
  prix et TVA de la nouvelle référence).
- La chaîne `superseded_by_id` est suivie jusqu'au bout, avec protection contre les boucles
  (A → B → A : arrêt + message) et une borne de 30 maillons. En base au 19/09 : 16 331 références
  remplacées, dont 4 969 dont le remplaçant est lui-même remplacé ; aucune boucle.
- **Équivalents** (`equivalence_group`) listés sous la ligne, cliquables (aucun groupe rempli en base au 19/09).
- Code : `src/modules/sales/replacement.ts` (`followReplacementChain`, `getReplacementInfo`),
  `replacement-hint.tsx`, `document-editor.tsx`, `write-api.ts` ; test `tests/sales-replacement-chain.test.ts`.

### Carte 4 — Ajouter un accessoire trouvé dans l'e-catalog Ducati (19/09, à valider)
- Dans l'éditeur de document de vente, bouton **« Coller une référence ou un lien e-catalog »** : on colle
  une référence Ducati (ex. `96680574A`, `96782291BA`, espaces et minuscules acceptés) ou un lien copié
  dans e-catalog.ducati.com. **Le site n'est jamais appelé** : la référence est lue dans le texte ou dans
  l'URL (paramètre, segment du chemin, ancre). Les liens EPC réels (`/EPC/parts/106/125/…/45968`) ne
  contiennent en général **pas** la référence (identifiants internes) : l'écran la demande alors.
- **Recherche exacte** dans les articles de la société : référence, réf. fournisseur, code-barres
  (comparaison sans espaces / tirets / points, en majuscules), **librairie comprise**, avec la pastille de
  disponibilité. Une référence remplacée affiche « Remplacée par … » et le bouton qui pose la **dernière**
  (carte 3). « Ajouter » pose la ligne comme la recherche habituelle.
- **Rien trouvé** → **« Créer l'article à compléter »** : désignation et prix de vente saisis (TTC ou HT
  selon le mode du document) ; article **type A en librairie** (non stocké tant qu'il n'est pas
  réceptionné, même règle que l'import des tarifs), marque Ducati, réf. fournisseur = référence, lien
  e-catalog gardé s'il a été collé, drapeau **« À compléter »**. Créé par le chemin habituel
  (`createArticle`, code-barres = référence) ; trace `events` `article_to_complete` (origine `ecatalog`),
  puis `article_completed` quand le magasin décoche le drapeau. La ligne prend le prix saisi.
- **Pièces & Accessoires** : filtre **« À compléter uniquement »**, badge « À compléter » dans la liste,
  case « À compléter » sur la fiche (le magasin la décoche après avoir saisi PA, fournisseur, famille).
- Sur les lignes d'articles Ducati (référence au format Ducati, ou lien e-catalog connu) : lien
  **« Voir dans l'e-catalog »** (nouvel onglet ; lien exact de l'article sinon accueil du catalogue ; la
  référence est copiée pour la coller dans la recherche — aucun format d'URL de recherche connu). Rien
  n'est téléchargé du site.
- Migration `20260919340000_m2_article_a_completer_ecatalog.sql` (appliquée le 19/09). Code :
  `src/modules/sales/ecatalog.ts` (lecture et normalisation, pur), `ecatalog-api.ts`, `ecatalog-paste.tsx`,
  `document-editor.tsx` (bouton + lien), `src/modules/articles/api.ts` (filtre), `article-form.tsx`,
  `src/routes/_app.parts.index.tsx` ; test `tests/sales-ecatalog.test.ts`.

**À tester (carte 4)**
1. Ventes → Nouveau document → « Coller une référence ou un lien e-catalog » → coller une référence
   existante (ex. une référence de la librairie) → elle apparaît avec sa pastille → « Ajouter ».
2. Coller une référence inconnue → « Créer l'article à compléter » (désignation + prix) → la ligne est
   ajoutée avec ce prix ; lien « Voir dans l'e-catalog » sous la ligne.
3. Pièces & Accessoires → Filtres → « À compléter uniquement » : l'article créé y est ; le compléter et
   décocher « À compléter ».

### Carte 5 — Lignes de main d'œuvre, lignes vides et commentaires types (19/09, à valider)
- Sous les lignes du document : boutons **Ajouter une ligne** (article), **Main d'œuvre**, **Texte**,
  **Ligne vide** et **Rappeler un commentaire**.
- **Main d'œuvre** : choix parmi les articles de type **T** (liste à l'ouverture, filtre à la frappe),
  quantité en **heures décimales** (pas de 0,25 h), prix = taux horaire ; jamais de mouvement de stock.
  Un article T choisi dans une ligne normale devient aussi une ligne main-d'œuvre.
- **Texte** : commentaire sur plusieurs lignes, sans montant. **Ligne vide** : séparation, sans montant.
  Les deux sont exclus des totaux et contrôlés en base (contrainte : aucun montant).
- **Commentaires types** : Paramètres → **Commentaires types** (nom court + texte, actif, ordre ;
  suppression réservée à l'administrateur, les autres désactivent). Dans le document, « Rappeler un
  commentaire » insère le texte en ligne texte, **modifiable ensuite**. Table livrée **vide** : aucun
  commentaire pré-rempli (pas d'IBAN), l'équipe les saisit.
- Le type de ligne suit les conversions (DEV → BC → RES/BL/FAC), les duplications et les avoirs ;
  fiche du document et impression affichent le texte multi-lignes, la ligne vide et « 5,50 h ».
- **Traçabilité** : chaque ligne de document écrite, modifiée ou supprimée laisse désormais une trace
  dans `events` (jusqu'ici seul l'en-tête l'était).
- Migration `20260919290000_m6_lignes_types_commentaires.sql` (colonne `document_lines.line_type`,
  défaut `article` pour toutes les lignes existantes ; table `document_comment_templates` avec RLS ;
  audit des lignes). Code : `write-api.ts` (`LineType`, `lineHasAmount`, `lineMovesStock`,
  `rowToLineInput`, `searchLabourArticles`), `document-editor.tsx`, `comment-templates-api.ts`,
  `comment-templates-editor.tsx`, route `src/routes/_app.settings.comments.tsx`, `print-document.ts`,
  `_app.sales.$documentId.tsx` ; test `tests/sales-line-types.test.ts`.

### Carte 8 — Aperçu du document et envoi par mail (19/09, à valider)
- Sur la fiche d'un document de vente : bouton **« Aperçu PDF »** (ouvre le vrai PDF dans un onglet :
  lire, imprimer, télécharger). L'impression HTML existante reste en place.
- Le PDF reprend l'impression : **en-tête société** (logo, adresse, TVA, IBAN lus dans `companies`),
  bloc client, code-barres du n°, bandeau date / heure / n° client / condition / échéance / **opérateur**,
  lignes (article, **main-d'œuvre en heures**, **texte** multi-lignes, **ligne vide**), bloc véhicule,
  **détail TVA par taux**, brut / net HT / TVA / net TTC, **règlements et acomptes**, **RESTE À PAYER**,
  mention TVA marge ou détaxe, **validité** (« Devis valable 1 mois (jusqu'au …) » sur un devis /
  proforma), notes, pied de facture, **case « Bon pour accord »** (devis, BC, réservation, BL), CGV au
  verso, « Page i / n ».
- **Validité réglable** : Paramètres → Tables → « Validité des documents (PDF) » : code = type (DEV,
  BC…), libellé = texte imprimé (`{date}` = date limite), durée en mois (0 = sans date). Sans ligne :
  « Devis valable 1 mois ». Ligne inactive : pas de mention. Aucune ligne créée en base.
- **« Envoyer par e-mail »** : destinataire = e-mail du client, **modifiable** ; **boîte d'envoi au
  choix** (même règle que le CRM : boîtes de la société + sa propre adresse, par défaut celle qui a reçu
  le dernier mail du client) ; objet et message pré-remplis modifiables ; **PDF joint** (nom, taille,
  bouton « Voir ») ; pied de mail P-5 / P-6 ajouté par le serveur comme avant ; bouton
  **« Vérifier sans envoyer »** (simulation serveur : boîte, pied de mail, pièce jointe, rien ne part).
- Après l'envoi : PDF rangé dans la **GED du client** (dossier « Documents de vente ») et dans celle du
  **document**, note « Envoyé par e-mail à … depuis … le … » ; ligne **`events`** `email_sent` sur le
  document (qui, quand, à qui, quelle boîte, objet, fichier) écrite par le serveur.
- Choix technique : PDF **dans le navigateur avec jsPDF** (déjà utilisé par M7), justifié dans
  [M09 §4](../modules/M09-documents.md). Pas de migration. Fonction `graph-send-email` étendue
  (`dryRun`, `trace`), compatible avec ses appelants, **déployée le 19/09**.
- Code : `src/modules/sales/document-pdf.ts`, `document-pdf-data.ts`, `pdf-print-style.ts`,
  `document-mail-api.ts`, `document-mail-dialog.tsx`, `src/routes/_app.sales.$documentId.tsx`,
  `src/modules/settings/reference-tables.ts`, `supabase/functions/graph-send-email/index.ts`,
  `supabase/functions/_shared/mail-message.ts` ; tests `tests/sales-document-pdf.test.ts`,
  `tests/graph-send-email-message.test.ts`.

**À tester (carte 8)**
1. Ventes → un devis / proforma avec une ligne main-d'œuvre, un commentaire et une ligne vide →
   **Aperçu PDF** : vérifier en-tête, lignes, détail TVA, reste à payer, « Devis valable 1 mois », case
   signature.
2. **Envoyer par e-mail** → mettre **votre propre adresse** comme destinataire → **Vérifier sans
   envoyer** (message vert, rien ne part) → **Envoyer** : le mail arrive avec le PDF joint.
3. Fiche du client → onglet GED → dossier « Documents de vente » : le PDF envoyé y est ; il est aussi
   dans la GED du document.

## 6. Risques

- Ne pas créer un deuxième circuit de vente : tout passe par les documents M06 existants.
- Cartes 7 et 10 touchent les commandes de pièces (mission 02) : livrer après « Ajouter et modifier les pièces d'une commande ».
