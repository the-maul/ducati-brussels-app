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

(rempli à chaque lot livré)

## 6. Risques

- Ne pas créer un deuxième circuit de vente : tout passe par les documents M06 existants.
- Cartes 7 et 10 touchent les commandes de pièces (mission 02) : livrer après « Ajouter et modifier les pièces d'une commande ».
