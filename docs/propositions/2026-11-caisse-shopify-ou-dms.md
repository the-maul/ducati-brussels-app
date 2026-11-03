---
titre: Caisse du magasin — Shopify POS ou le DMS ?
pour: Domenico (ITALBIKE STORE / Ducati Bruxelles)
de: Simon (agence), proposition du 03/11/2026
etat: proposition remise, décision attendue
---

# Caisse du magasin : Shopify POS ou le DMS ?

> **En deux mots.** On recommande de **garder la caisse dans le DMS** (scénario A) et de laisser
> Shopify faire ce qu'il fait bien : le site. Raisons principales, toutes vérifiées en novembre 2026 :
> Shopify POS **n'accepte pas Bancontact en magasin** ; il ne sait produire **ni facture TVA belge
> numérotée, ni TVA sur la marge, ni acompte sur une moto** ; il doublerait la caisse, le stock et le
> journal ; et il ne parle pas à Falco. Le DMS, lui, produit déjà le ticket, la facture, le journal Z,
> le registre TVA et le fichier UBL que Falco enverra sur Peppol. Ce qu'il reste à faire côté DMS
> tient en **10 à 15 jours** (terminal Bancontact, QR Stripe, connecteur Falco, TVA marge à la
> vente), contre 17 à 25 jours pour brancher Shopify POS **et** garder deux caisses pour toujours.

---

## 1. La question posée

Le 03/11, Simon demande « une proposition vraiment complète sur la gestion de la caisse par Shopify :
voir si ça s'intègre bien au DMS, à la facturation Falco qu'on va intégrer ».

Trois façons de faire sont possibles :

| Scénario | En une phrase |
|---|---|
| **A. Caisse = DMS** (ce qu'on a) | Tout encaissement au comptoir passe par la caisse du DMS. Shopify reste le site ; ses ventes web sont déjà importées dans le DMS. |
| **B. Caisse = Shopify POS** | Tout encaissement en magasin passe par l'appli Shopify POS sur tablette ; le DMS lit ces ventes comme il lit les ventes web. |
| **C. Mixte** | Shopify POS pour les accessoires et vêtements au comptoir ; le DMS pour les motos, l'atelier et les pièces sur OR. |

---

## 2. Ce qu'on a aujourd'hui (rappel)

- **La caisse du DMS** (chapitre M6 de la bible) : vente comptoir par scan → ticket **TIK** (stock réel
  débité), factures **FAC** avec client, devis, bons de commande, réservations avec **acompte**,
  avoirs, règlements multi-modes (espèces avec rendu, carte, virement, « à échéance »), **détaxe
  export** (TVA 0 %, mention art. 39), **journal Z** (encaissements par mode, ventilation TVA,
  comptage du tiroir par coupure), **QR de virement SEPA sur le 2e écran** (fait le 19/09), export
  **UBL Peppol** d'une facture (fait, téléchargé à la main). Honnêteté : ce parcours n'a quasiment pas
  servi en vraies conditions (6 documents créés dans le DMS au 31/10) et la **TVA marge n'est pas
  encore calculée à la vente** (voir §4).
- **Shopify** : site public, 2 892 produits reliés au stock du DMS ; une commande payée en ligne crée
  dans le DMS une facture FAC payée, la sortie de stock et, en cas de remboursement, un avoir
  (mission 03). Un seul emplacement Shopify (« Chaussée de Bruxelles 688 »).
- **Paiement comptoir décidé le 30/07 (P-2)** : QR de virement (fait), **QR Stripe +5 %** et
  **terminal Bancontact physique** (à venir ; marque et modèle à fournir).
- **Falco** : pas encore branché ; identifiants attendus.

---

## 3. Ce que la recherche a vérifié (novembre 2026)

### 3.1 Shopify POS en Belgique

| Point | Constat | Source |
|---|---|---|
| Disponibilité | Shopify POS et Shopify Payments sont disponibles en Belgique ; lecteurs proposés : **WisePad 3**, **POS Terminal** (229 €), **Verifone Victa Mobile** (nouveau partenariat annoncé le 08/10/2026, déploiement progressif) ; **Tap to Pay** sur iPhone/Android disponible en Belgique. Tous exigent Shopify Payments. | [S1] [S2] [S3] [S4] |
| **Bancontact en magasin** | **Non.** Texte officiel : « You can't accept Bancontact as a payment method for in-person sales using the Shopify POS app. » Bancontact n'existe que pour le site. En magasin, les lecteurs Shopify prennent Visa / Mastercard / Maestro / Amex / sans contact / Apple & Google Pay. Une carte Bancontact co-badgée Maestro peut passer comme carte Maestro, **mais ce n'est confirmé nulle part par Shopify**. | [S5] [S6] |
| Terminal Bancontact externe (Worldline, CCV, banque) | Possible, mais **à la main** : on crée un « type de paiement personnalisé », on encaisse sur le terminal, puis on tape « Marquer comme payé » dans Shopify. Aucun rapprochement automatique, deux appareils, double saisie à chaque vente. | [S7] |
| Prix | POS « occasionnel » (Lite) inclus dans tout abonnement ; **POS Pro : 79 €/mois par emplacement** (facturé à l'année). Taux carte en personne via Shopify Payments : **1,4 % (Basic) / 1,3 % (Grow) / 1,2 % (Advanced)**, page France en euros ; la page belge affiche les mêmes taux en ligne (2 % + 0,25 € en Basic, relevé le 14/08/2026) — à confirmer dans l'admin Shopify. Matériel Belgique : POS Terminal 229 €, imprimante de reçus 299 €, scanner 139 € ; WisePad 3 ≈ 59 € (prix France, indicatif). | [S8] [S9] [S10] [S2] |
| Retours, échanges, personnel | Retours d'une commande web en magasin et échanges « à n'importe quel emplacement », rôles du personnel, inventaire et rapports détaillés : **POS Pro** seulement. | [S9] [S11] |
| Numérotation | Shopify numérote ses **commandes** (#1001, #1002…) dans une seule série site + magasin ; ce ne sont pas des factures. Une facture TVA belge numérotée en continu demande une appli tierce ou un système externe (le DMS). | [S12] |
| Journal des recettes belge | Un commerçant belge a dû faire développer un rapport sur mesure : « Shopify's built-in reports don't follow Belgian GAAP » (fil d'octobre 2025). Les rapports natifs sont par date de vente, pas de paiement, sans ventilation TVA « journal des recettes ». | [S13] |
| Lien compta belge | Aucun connecteur Shopify POS → Winbooks, Octopus ou Horus trouvé. Yuki et Exact Online ont des connecteurs **pour les commandes du site**, pas pour la caisse. | [S14] |
| TVA sur la marge | Shopify applique un taux sur le prix total ; il ne sait pas calculer une TVA sur la seule marge par véhicule ni cacher la TVA sur le document. Seules des applis tierces (ex. « Vintax ») le simulent, pour des boutiques, pas pour des motos avec VIN. | [S15] |

### 3.2 Obligations belges d'un commerce de détail (hors horeca)

| Obligation | Ce que ça impose | Source |
|---|---|---|
| Ticket ou facture | Vente à un particulier : un ticket suffit s'il ne demande pas de facture. Vente à un professionnel : **facture obligatoire**. Pour une moto, la facture est de toute façon le document de propriété (immatriculation, garantie). | [S16] [S17] |
| Mentions et numérotation | Facture = numéro **séquentiel unique** (une ou plusieurs séries), date, identité des deux parties, n° TVA, taux, montant de TVA… | [S16] |
| Journal des recettes | Pour les ventes **sans facture** (tickets) : recettes du jour ventilées par taux de TVA, tenues au jour le jour ; dispense du registre papier si les tickets sont conservés numériquement. | [S17] |
| **E-facturation B2B (Peppol)** | **Depuis le 01/01/2026**, toute facture entre deux assujettis belges doit être **structurée (Peppol BIS / UBL)** et transiter par un **point d'accès Peppol** ; le PDF par e-mail n'est plus une facture valable en B2B. **Les particuliers (B2C) et les clients étrangers ne sont pas concernés** (PDF/papier toujours permis). Amendes : 1 500 € (première infraction) à 5 000 € (récidive) selon Deloitte ; tolérance de 3 mois janvier–mars 2026, terminée. | [S18] [S19] |
| **TVA sur la marge** (occasions reprises à des particuliers) | Art. 58 §4 CTVA : TVA = marge brute × 21/121, calculée **par véhicule** ; mention « Régime particulier – Biens d'occasion » ; **interdit de faire apparaître la TVA** sur la facture ; registre d'achats/ventes par véhicule, 7 ans. Une caisse standard ne sait pas faire ça. | [S20] |
| Détaxe export | Art. 39 CTVA : vente hors UE sans TVA, document justificatif (facture avec mention, visa douane pour le voyageur, seuil 125 €). | [S21] |

### 3.3 Falco : c'est quoi, précisément

Il n'y a qu'un « Falco » qui colle à « facturation » en Belgique : **Falco, l'application de facturation
de Horus Software** (éditeur du logiciel comptable **Horus Office**, très utilisé par les comptables
belges). Ouverte à tous les indépendants et PME depuis 2024-2025, **point d'accès Peppol certifié**.
Attention aux homonymes (CrowdStrike Falcon, etc.) qui n'ont rien à voir. [S22] [S23]

- **Ce qu'elle fait** : factures, devis, rappels, achats (réception Peppol illimitée sur tous les plans),
  banque, tableau de bord, lien direct avec le comptable **s'il utilise Horus**. [S22]
- **Tarifs (HTVA)** : Light 3,5 €/mois … Expert essential **40 €/mois** (1 utilisateur), Expert
  Premium 50 €/mois (3 utilisateurs). **L'API est réservée au plan Expert** : 500 factures Peppol
  envoyées par mois incluses, puis **0,10 €/facture**. [S24] [S25]
- **L'API, lue dans la documentation (docs.falco-app.be, novembre 2026)** [S26] :
  - base `https://api.falco-app.be/v1`, bac à sable `https://api.sandbox.falco-app.be/v1` (livraison
    Peppol simulée) ; authentification par deux en-têtes (`X-Falco-App-Secret` de l'agence,
    `X-Falco-Api-Key` généré par le client dans son compte Falco) ;
  - `POST /invoices/imports/ubl` : **on envoie un fichier UBL déjà produit par le DMS**, avec
    `send_peppol: true` et, si le comptable est sur Horus, `send_accounting: true` (+ numéro et
    journal comptable) ; réponse = `document_id` + statut Peppol `submitted` / `failed` ;
  - `POST /invoices/imports/pdf` (PDF + métadonnées, Falco fabrique l'UBL) et
    `POST /invoices/imports/send` (renvoyer un document importé) ;
  - `GET /peppol/participants/check` : **vérifier qu'un client est inscrit sur Peppol** avant d'envoyer ;
  - `/customers`, `/articles` (nom, prix HT/TTC, taux « 21.00 », compte comptable Horus), `/invoices`
    (création de factures dans Falco même), `/documents/sales` et `/purchases` ;
  - statuts de livraison : NotSent, Success, Failure, Rejected ; un UBL invalide est **rejeté** avant envoi.
- **Ce que Falco n'est pas** : ni une caisse, ni un connecteur Shopify (aucune mention de POS,
  e-commerce ou Shopify sur le site). Ce qui entre dans Falco, c'est une **facture** : la nôtre (UBL),
  ou une facture qu'on recrée chez lui.

### 3.4 Ce qui manque à une caisse Shopify pour une concession

Une vente POS Shopify arrive dans Shopify avec : articles, prix TTC, remise, taxe, mode de paiement,
client éventuel, numéro de commande. Il lui manque tout ce que le DMS porte : le **lien avec la moto
(VIN) et l'OR**, le **client du DMS** et son **encours**, l'**acompte** sur une moto commandée, la **TVA
marge** et le **registre VO**, le **dépôt-vente** (reversement au déposant + commission), la **cession
interne**, la **numérotation de facture par société** (ITALBIKE STORE / NL INVEST), et le document UBL
pour Falco. Rien de tout cela n'est produisible par Shopify POS, même avec POS Pro.

---

## 4. Les trois scénarios, face à face

| | **A. Caisse = DMS** | **B. Caisse = Shopify POS** | **C. Mixte** |
|---|---|---|---|
| **Le vendeur au comptoir** | Un seul écran : scan → panier → encaisser (espèces, carte sur **terminal Bancontact externe** + saisie du mode, QR virement sur le 2e écran, QR Stripe à venir) → ticket ou facture, PDF par mail. | Tablette Shopify POS + lecteur WisePad 3 / Tap to Pay **sans Bancontact**, ou terminal Bancontact externe **et** « Marquer comme payé » dans Shopify à chaque vente. Pour une facture au nom d'une société : repasser dans le DMS. | Deux caisses selon le produit : le vendeur choisit l'outil à chaque client ; un panier mixte (casque + pièce posée sur un OR) se coupe en deux tickets. |
| **Domenico** | **Une caisse, un stock, un journal Z**, une session de caisse, un tiroir. | **Deux caisses** (Shopify pour le magasin, DMS pour motos / atelier / B2B), **deux stocks à réconcilier** en permanence, **deux clôtures** (tiroir Shopify + journal Z du DMS), deux listes de clients. | Idem B, en permanence, avec en plus la règle « quel produit va où » à faire respecter. |
| **Le comptable et Falco** | **La facture DMS fait foi** : FAC numérotée par société, UBL produit par le DMS → **API Falco → Peppol → Horus**. Tickets dans le journal des recettes du DMS (ventilé TVA). Registre TVA, écritures, export Winbooks existants. | Le document remis au client est un reçu Shopify (#1234, pas une facture TVA). Pour Falco, il faut **recréer** la facture (dans le DMS par import, ou dans Falco à la main) : le client repart avec un papier qui n'est pas celui des livres. Journal des recettes à reconstruire (rapport sur mesure, [S13]). Deux séries de numéros. | Deux journaux de recettes à additionner, deux séries de numéros, risque d'oubli de l'une des deux à la déclaration TVA. |
| **Acompte sur une moto** | Fait (réservation RES + acompte reporté sur la facture). | Impossible proprement dans POS (pas d'acompte natif) : repasser dans le DMS. | DMS (par règle), mais le vendeur doit y penser. |
| **Pièces facturées sur un OR** | Fait (OR → facture, B8). | Impossible : Shopify ne connaît ni l'OR ni la moto. | DMS. |
| **Reprise d'occasion / TVA marge** | À finir côté DMS (§6), registre VO existant. | Impossible (TVA sur le prix total, TVA affichée = **interdit** en régime marge). | DMS. |
| **Détaxe export** | Fait (TVA 0 %, mention art. 39). | Client « exonéré de taxes » possible, mais sans mention légale ni justificatif adapté. | DMS si on y pense. |
| **Client pro avec encours** | Fait (encours, « à échéance », relances). | POS ne gère pas l'encours ; vente « non payée » bloquée ou saisie en custom. | DMS. |
| **Retour au comptoir d'un article acheté en ligne** | Avoir DMS sur la facture importée (existant) + remboursement à déclencher dans Shopify (ou l'inverse). **Point à cadrer** (§6, question 3). | Natif **avec POS Pro** (79 €/mois) : le retour en magasin crée un remboursement Shopify, que le DMS transforme en avoir (déjà fait pour les remboursements web). C'est le **seul** cas où B gagne. | Comme B pour les accessoires. |
| **Coûts récurrents** | Terminal Bancontact : ≈ 25 à 35 €/mois en location bancaire (KBC/Worldline, [S27]) + commissions ; Stripe QR : frais Stripe (+5 % refacturés au client, décision P-2) ; Falco Expert 40 €/mois. | POS Pro 79 €/mois + 1,4 % sur chaque carte via Shopify Payments (sans Bancontact), ou terminal externe (≈ 30 €/mois) + double saisie ; matériel 230 à 670 € ; Falco Expert 40 €/mois. | Comme B. |
| **Effort d'intégration DMS (jours, honnête)** | Terminal Bancontact externe : 0,5 j (mode de règlement « Carte » existe) ; rattacher le ticket à la session de caisse : 1 j ; ticket par e-mail sans client : 0,5 j ; QR Stripe +5 % : 2 j ; **connecteur Falco : 4 à 6 j** (§6) ; TVA marge à la vente : 3 à 5 j avec le comptable. **Total ≈ 10 à 15 j**, dont Falco et TVA marge sont dus **dans tous les scénarios**. | Import des ventes POS (modes de paiement personnalisés, ticket TIK sans client, facture sur demande, retours, caisses/tiroirs Shopify, clients) : 8 à 12 j ; **plus** tout ce qui reste dans A (Falco, TVA marge, Stripe) : **≈ 17 à 25 j**, et le DMS ne saura toujours pas qui a payé par quelle carte sans double saisie. | 6 à 10 j d'import + règles de routage + Falco + TVA marge : **≈ 15 à 21 j**. |
| **Risques** | Un seul : le terminal Bancontact n'est pas relié au DMS (saisie du mode à la main, comme dans G8). Écart de caisse détecté au journal Z. | Double stock (une vente POS hors ligne ou « à relier » ne sort pas du stock DMS), double numérotation, écarts de caisse entre tiroir Shopify et journal Z, ticket client ≠ document comptable, dépendance à Shopify Payments sans Bancontact (refus de paiement de clients belges). | Tous ceux de B, plus l'erreur humaine « mauvaise caisse ». |

---

## 5. Les cas qui cassent, en clair

1. **Un client belge paie avec sa carte Bancontact.** A : terminal Bancontact, 2 secondes. B : le
   lecteur Shopify ne prend pas Bancontact ; soit on espère que la carte passe en Maestro (non garanti),
   soit on dégaine un second terminal et on ressaisit dans Shopify.
2. **Un client commande une Panigale et verse 2 000 € d'acompte.** A : réservation + acompte,
   reporté sur la facture, alerte « pièces à commander ». B/C : rien dans POS ; on retourne au DMS.
3. **Une occasion reprise à un particulier est revendue.** A : facture « régime particulier – biens
   d'occasion », registre VO (calcul à la vente à finir). B : impossible sans enfreindre la règle « pas
   de TVA affichée ».
4. **Un garagiste pro achète des pièces à crédit, facture Peppol obligatoire.** A : facture FAC
   « à échéance », UBL → Falco → Peppol. B : reçu Shopify non valable en B2B depuis le 01/01/2026 ;
   il faut recréer la facture ailleurs.
5. **Un touriste suisse achète un blouson détaxé.** A : case « détaxe », TVA 0 %, mention légale.
   B : exemption de taxe générique, sans mention ; justificatif à refaire.
6. **Un client ramène au comptoir un casque acheté sur le site.** B (POS Pro) : retour natif.
   A : avoir DMS sur la facture importée + remboursement à déclencher dans Shopify : à cadrer (§6, question 3).

---

## 6. Recommandation : scénario A, avec Falco branché au DMS

**On garde la caisse dans le DMS. Shopify reste le site.** Ce n'est pas une question de goût : c'est
Bancontact, la facture belge et la TVA marge qui tranchent. Le seul vrai avantage de Shopify POS (le
retour en magasin d'une commande web) ne vaut ni 79 €/mois, ni une deuxième caisse, ni un deuxième stock.

**Ce qu'il faut acheter / paramétrer (Domenico) :**
1. **Un terminal Bancontact** auprès de la banque ou de Worldline / CCV (location ≈ 25 à 35 €/mois,
   [S27]) ; nous donner marque et modèle (décision P-2). Il reste indépendant du DMS : le vendeur
   choisit « Carte » dans le DMS et encaisse sur le terminal, comme avec G8.
2. **Un compte Falco plan Expert** (40 €/mois HTVA) : c'est le seul plan avec l'API. Dans Falco, créer
   la clé API pour l'application « DMS Ducati » et nous la transmettre (nous avons le secret
   d'application côté agence, posé dans les secrets Supabase, jamais dans le code).
3. **L'identifiant Peppol** de chaque société (`0208:BE0xxxxxxxxx` pour ITALBIKE STORE et NL INVEST),
   à saisir dans Paramètres → Sociétés (champ déjà prévu).
4. **La clé Stripe de production** pour le QR Stripe +5 % (toujours P-2).

**Ce que l'agence fait ensuite (ordre proposé) :**

| Lot | Contenu | Jours |
|---|---|---|
| Connecteur **DMS → Falco → Peppol** | Fonction serveur `falco-send` ; à la validation d'une facture ou d'un avoir dont le client a un n° TVA belge : vérification `peppol/participants/check`, envoi de l'UBL du DMS par `POST /invoices/imports/ubl` (`send_peppol`, et `send_accounting` si le comptable est sur Horus), `document_id` et statut rangés dans le journal des exports, relecture des statuts, rejets affichés sur la facture avec le motif, bouton « Renvoyer » ; tests sur le bac à sable Falco ; clients sans Peppol → PDF par mail comme aujourd'hui. | **4 à 6** (dont 1 à 2 jours de mise au point de l'UBL si Falco rejette nos premiers fichiers : identifiants Peppol du client, codes de TVA) |
| TVA marge **à la vente** (B2) | Calcul de la TVA sur la marge par véhicule type O, TVA non affichée, mention légale, écritures et registre VO alignés ; **règles à valider avec le comptable** (prix d'achat = prix de reprise + ORO ?). | 3 à 5 |
| Caisse comptoir, finitions | Ticket rattaché à la session de caisse, ticket par e-mail sans client, QR Stripe +5 %. | 3 à 4 |

Au total **10 à 15 jours**, dont les deux premiers lots sont nécessaires **quelle que soit** la caisse choisie.

**Les 3 questions à trancher avec Domenico et le comptable :**
1. **Le comptable est-il sur Horus Office ?** Si oui, Falco pousse directement nos factures dans sa
   compta (`send_accounting`) et l'export Winbooks devient inutile ; si non, on garde Winbooks et Falco
   ne sert qu'au Peppol. Ça change le paramétrage, pas la recommandation.
2. **TVA marge : quel prix d'achat ?** Prix de reprise seul, ou prix de reprise + remise en état (ORO) ?
   Et faut-il émettre la facture d'occasion depuis le DMS dès la première vente VO, ou attendre que le
   calcul soit validé ? À poser au comptable avant la première vente d'occasion.
3. **Retour en magasin d'un achat web : qui rembourse ?** Soit le vendeur fait l'avoir dans le DMS et
   le remboursement est déclenché dans Shopify (le DMS peut l'appeler : à ajouter, ≈ 1 à 2 jours), soit
   le remboursement se fait dans l'admin Shopify et le DMS fabrique l'avoir (déjà en place). Il faut
   choisir une seule règle.

**Et si Domenico tient quand même à Shopify POS ?** Alors seulement le scénario **C limité** aux
accessoires et vêtements, avec POS Pro, terminal Bancontact externe (double saisie) et un import des
ventes POS dans le DMS ; en sachant qu'on vivra avec deux caisses et deux stocks et qu'il faudra
retirer la caisse comptoir du DMS pour ces produits pour éviter la confusion. On ne le conseille pas.

---

## 7. Sources (consultées le 03/11/2026)

- [S1] Shopify Help Center, « Choosing a card reader » (tableau Europe : WisePad 3, POS Terminal, Verifone Victa Mobile — Belgique, Shopify Payments) — https://help.shopify.com/en/manual/sell-in-person/hardware/card-readers/choosing-card-reader
- [S2] Shopify Hardware Store Belgique (POS Terminal 229 €, imprimante OmniLink 299 €, scanner DS2208 139 €) — https://hardware.shopify.com/fr-be
- [S3] Shopify France, « Shopify s'associe à Verifone pour son matériel POS », 08/10/2026 — https://www.shopify.com/fr/blog/shopify-et-verifone-pos
- [S4] Shopify Help Center, « Activate Tap to Pay » (pays dont la Belgique ; iPhone XS ou plus récent) — https://help.shopify.com/en/manual/shopify-admin/shopify-app/mobile-tap-to-pay/activate-tap-to-pay
- [S5] Shopify Help Center, « Bancontact » (« You can't accept Bancontact … in-person sales using the Shopify POS app ») — https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods/bancontact
- [S6] Shopify Help Center, « Shopify Payments for Belgium — payment methods » (lecteur Shopify ou terminal externe) — https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/belgium/payment-methods
- [S7] Shopify Help Center, « Card payments in Shopify POS » (terminal externe : type de paiement personnalisé, « Mark as paid » à la main) — https://help.shopify.com/en/manual/sell-in-person/shopify-pos/payment-management/card-payments
- [S8] Shopify, tarifs (page France, EUR) : Basic 32 €/mois, Grow 92 €, Advanced 384 € ; carte en personne 1,4 / 1,3 / 1,2 % ; POS Pro 79 €/mois par emplacement — https://www.shopify.com/fr/pricing
- [S9] Shopify, tarifs POS (page France) : « Vente en personne occasionnelle » incluse ; POS Pro +79 €/mois par emplacement, retours et échanges à tout emplacement, rôles du personnel — https://www.shopify.com/fr/pos/pricing
- [S10] Clickforest, « Que coûte une boutique en ligne ? » (page belge Shopify relevée le 14/08/2026 : 2 % + 0,25 € en ligne, Basic) — https://www.clickforest.com/fr/blog/prix-creation-boutique-en-ligne ; La Caisse Idéale, « Shopify POS avis 2026 » (WisePad 3 ≈ 59 €, prix France) — https://www.lacaisseideale.fr/articles/shopify-pos-avis/
- [S11] FirstPier / Askphill, comparatifs POS Lite vs Pro 2026 (retours de commandes web en magasin = Pro) — https://www.firstpier.com/resources/shopify-pos ; https://askphill.com/blogs/blog/shopify-pos-whitepaper
- [S12] Shopify Community, « Tax Invoice » (numérotation Shopify propre, non modifiable ; factures séquentielles à produire à part) — https://community.shopify.com/t/tax-invoice/371562
- [S13] Shopify Community, « Daily sales numbers for accountant (Dagontvangstenboek België) », 26/10–16/11/2025 — https://community.shopify.com/t/daily-sales-numbers-for-accountant-dagontvangstenboek-belgie/572545
- [S14] Yuki Support Belgium, « Yuki en Shopify » (commandes du site via Webwinkelfacturen) — https://support.yuki.be/nl/support/solutions/articles/80000787747-yuki-en-shopify ; Studio Mikado, intégrations compta belges — https://www.studio-mikado.be/en/integration-with-belgian-accounting-programs/
- [S15] Shopify App Store, « Vintax: Margin Scheme VAT » — https://apps.shopify.com/vintax
- [S16] MyFid, « Factures TVA Belgique 2026 : mentions obligatoires et Peppol » — https://www.myfid.be/ressources/comptabilite/factures-tva/
- [S17] Accountable, « Comment tenir un livre de caisse et un journal des recettes » (Belgique) — https://www.accountable.eu/fr-be/help-center/comment-tenir-un-livre-de-caisse-et-un-journal-des-recettes/
- [S18] Acerta, « Facturation électronique via Peppol à partir du 1er janvier 2026 » (B2B belge ; B2C et étranger exclus ; amendes 50 à 5 000 €) — https://www.acerta.be/fr/independants/facturation-electronique ; SPF Finances → https://efacture.belgium.be (loi du 06/02/2024, AR du 14/07/2025)
- [S19] Deloitte Belgium, « Mandat Peppol en Belgique : ce qui change pour les PME », 29/01/2026 (1 500 à 5 000 €, tolérance janvier–mars 2026) — https://www.deloitte.com/be/en/services/tax/blogs/tax-legal-pulse-fr/mandat-peppol-en-belgique-ce-qui-change-pour-les-pme.html
- [S20] Karbill, « TVA sur la marge automobile en Belgique : guide complet », mis à jour le 14/03/2026 (art. 58 §4 CTVA, registre, TVA non affichée) — https://www.karbill.be/guide/tva-marge-automobile ; Wolters Kluwer, « TVA réglementation sur la marge bénéficiaire » — https://123support.wolterskluwer.be/files/images/pdf/manual/TVA_marge_beneficiaire.pdf
- [S21] SPF Finances, « Restitution de la TVA lors de l'exportation de marchandises » (seuil 125 €, visa douane) — https://fin.belgium.be/fr/particuliers/international/voyager-bagages/voyager-dehors-ue/restitution-tva ; hub.brussels, « Fiche 6 — Aspect TVA » (art. 39 CTVA) — https://hub.brussels/app/uploads/2023/11/Fiche_6-_Aspect-TVA.pdf
- [S22] Falco (Horus Software), site officiel et page Peppol (« Point d'accès Peppol agréé ») — https://www.falco-app.be/ ; https://www.falco-app.be/peppol/
- [S23] ITdaily, « Application de facturation Falco disponible pour tous les entrepreneurs belges » ; Compta Perspectives, « Horus Software ouvre son application de facturation Falco à tous les entrepreneurs » — https://fr.itdaily.be/nouvelles/logiciel/falco-facturation-disponible-pour-entrepreneurs/ ; https://comptaperspectives.be/horus-software-ouvre-son-application-de-facturation-falco-a-tous-les-entrepreneurs/
- [S24] Falco, tarifs (Light 3,5 € → Expert 40 / 50 €/mois HTVA, 500 factures Peppol/mois puis 0,10 €) — https://www.falco-app.be/tarifs/
- [S25] Falco, « API Falco » (réservée au plan Expert) ; Ibgraf, « Falco dévoile son API » — https://www.falco-app.be/api/ ; https://www.ibgraf.com/falco-api-factures-electroniques
- [S26] Falco, documentation développeur : authentification, environnements, `POST /invoices/imports/ubl`, `POST /invoices/imports/send`, `GET /peppol/participants/check`, `POST /articles` — https://docs.falco-app.be/ ; https://docs.falco-app.be/docs/getting-started ; https://dev.falco-app.be/fr/home
- [S27] KBC Brussels, terminaux de paiement (Worldline DX4000 24,99 €/mois, DX8000 34,99 €/mois, Bancontact accepté) ; Bobex, prix des terminaux en Belgique — https://www.kbcbrussels.be/entreprendre/fr/entreprendre/ontvangen/terminaux-paiement.html ; https://www.bobex.be/fr-be/terminal-de-paiement/prix-terminal-de-paiement/

Références internes : `CLAUDE.md` §2–3 (TVA marge, détaxe, types O/P/D, invariants B2, B4, B7),
`docs/bible/modules/M06-ventes-caisse.md`, `docs/bible/modules/M12-compta.md`,
`docs/bible/missions/mission-03-shopify.md` §4 question 3, `mission-02` (P-2), `docs/bible/decisions.md`.
