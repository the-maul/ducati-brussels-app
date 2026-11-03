---
titre: Étude — moyens de paiement au comptoir (Omespay, terminal Bancontact, QR, écran client)
date: 2026-11-03
auteur: agence (recherche web + lecture du code, sans développement)
statut: 🟨 remise au client, décision en attente
concerne: [M06, mission 02 carte 9, décision P-2]
---

# Moyens de paiement au comptoir : ce qu'on peut brancher, à quel prix, et comment le DMS sait que c'est payé

> **En une phrase** : le terminal Bancontact d'Omespay est un terminal **CCV** qui peut probablement être piloté
> par la caisse via l'API cloud de CCV (à confirmer par Omespay) ; le **« QR Stripe +5 % » est illégal en
> Belgique** et doit être remplacé par un QR sans supplément ; l'écran client existe déjà et se généralise
> en tablette face au client.

Ce document répond à la demande de Domenico (30/07, P-2) : intégrer à la caisse du DMS **tous** les moyens
de paiement du comptoir — terminal Bancontact / cartes, QR de virement (fait le 19/09), QR Stripe — et faire
**apparaître le ticket sur une tablette face au client**. Il part de ce qui existe dans le DMS
([M06](../bible/modules/M06-ventes-caisse.md), [mission 02](../bible/missions/mission-02-commandes-pieces.md),
[proposition caisse du 03/11](../propositions/2026-11-caisse-shopify-ou-dms.md) §6) et de recherches web du
3 novembre 2026 (sources en §7, toutes datées). Rien n'a été codé, ni migré, ni envoyé.

Légende : **[DOC]** = lu noir sur blanc sur la source citée ; **[DÉDUIT]** = conclusion de l'agence, à confirmer.

---

## 1. Omespay : qui c'est, ce qu'ils vendent, comment on s'y branche

| | Constat | Source |
|---|---|---|
| Nom commercial | **OmEs pay** (omespay.be) | [O1] |
| Société | **Nous 2 BV / SRL**, BCE **0447.299.959**, Bornestraat 28, 3850 Nieuwerkerken (Limbourg) ; ex-« Payment Consulting » (Landen) ; activité paiement depuis 2016 (Erwin Struys) [DOC] | [O2] [O3] [O4] |
| Taille | **≈ 3 ETP** (2,7 en 2025), marge brute 2025 ≈ 318 k€, fonds propres redevenus positifs en 2025 [DOC] | [O3] |
| Nature | **Ni acquéreur, ni PSP** : revendeur / loueur de terminaux et intermédiaire commercial qui place le contrat d'acquiring chez un tiers. Les CGV nomment **EMS (European Merchant Services, groupe Fiserv)** comme institution de paiement ; la page « À propos » dit travailler « avec divers acquéreurs » [DOC]. L'argent est donc traité par l'acquéreur, pas par Omespay [DÉDUIT] | [O2] [O5] |
| Terminaux | Marque **CCV** uniquement : **Compact A77** (mobile), **Plus Mobile A960** (mobile, imprimante), **Nexus Pad A35** (pinpad fixe « pour caisse intégrée »), **Duo Base A80-A35** (fixe, liaison câble RS232/USB) ; SoftPOS via « l'app du partenaire » [DOC] | [O6] |
| Moyens acceptés | Site : Bancontact ; LinkedIn : Bancontact, Maestro, Visa, Mastercard, UnionPay. Apple/Google Pay, Payconiq, Amex, titres-repas : **non promis** (« selon terminal, acquéreur et contrat ») [DOC] | [O1] [O4] |
| Tarifs | **Rien de publié** (devis). Repères marché CCV / EMS en Belgique : location A77 dès ≈ 29 €/mois, service ≈ 12 €/mois ; Bancontact EMS ≈ 0,20 % ou CCV Pay 0,24 → 0,075 €/transaction dégressif ; cartes crédit ≈ 1,25–1,5 % [TIERS, oct. 2026] | [O7] [T2] |
| Contrat (CGV) | **24 mois**, reconduction tacite 12 mois, résiliation par recommandé **3 mois avant l'échéance** ; **250 € HTVA pour transférer le contrat vers une autre institution de paiement** ; intervention hors contrat 260 € HTVA ; matériel loué reste propriété de Nous 2 [DOC] | [O5] |
| Réputation | Témoignages positifs sur le site ; 82 % sur Bobex (6 avis, sous l'ancien nom « Kassa-Pay ») ; aucun Trustpilot, aucun litige trouvé [DOC] | [O8] |

**Intégration logicielle — ce qu'Omespay documente.** Leur page « Connexion à la caisse via l'API de
paiement » [O9] explique le *principe* (la caisse envoie montant + référence, reçoit un statut réussi / refusé /
annulé / inconnu ; interface **locale** sur le réseau du magasin ou **API cloud** avec identifiants et webhooks ;
gestion des time-out, doubles clics, webhooks dupliqués) et la répartition des rôles : Omespay « vérifie la
compatibilité caisse / terminal / prestataire, configure les identifiants et l'environnement de test, teste les
scénarios » ; « le développeur de l'application reste responsable de son propre code » ; « nous utilisons
uniquement des protocoles, connecteurs, plugins ou API pris en charge » ; « une clé API ne constitue pas une
intégration complète ». **Mais : aucune documentation technique, aucun SDK, aucun nom de protocole, aucun
partenaire caisse nommé** (seule caisse citée sur le site : Flowmate, caisse GKS horeca). Omespay n'a pas d'API
propre : c'est l'API du *prestataire* (CCV, ou l'acquéreur) qui sert [DÉDUIT].

**La voie technique réaliste** est donc celle du fabricant, **CCV**, documentée publiquement [C1] [C2] :
- **CCV Payment API, moyen `terminal`** : appel HTTPS depuis notre serveur (clé API serveur, jamais dans le
  navigateur) avec `amount`, `currency`, `merchantOrderReference`, `webhookUrl` et `details.terminalId` ; réponse
  `pending` + `reference` ; CCV « réveille » le terminal (`wakeUpType: CLOUD_CONNECT`), le client paie, et **le
  résultat revient par webhook (ou par relecture périodique du statut)** ; remboursement par la même API [DOC].
- Restrictions écrites : « A CCV Terminal is required », « This API doesn't support all CCV terminals yet »,
  limité aux pays où CCV vend des terminaux ; accès au portail développeur par un *partner manager* CCV et
  parcours de certification en 5 étapes [DOC]. L'ancien « Cloud Connect » n'existait que pour P400 / V400M et
  exigeait un éditeur de caisse certifié [DOC].
- Le **SDK Android** CCV (connexion locale) est inutilisable depuis un navigateur ; le **Duo Base** (câble
  RS232/USB) non plus [DÉDUIT].

**Ce qu'on ignore et qu'il faut demander (mail en §6)** : le modèle exact livré à Waterloo, l'acquéreur du
contrat (EMS ou CCV Pay — la Payment API CCV avec un terminal sous contrat EMS n'est documentée nulle part),
si le terminal est ou peut être activé en « Cloud Connect », le coût et le délai, qui porte la certification et
le support de niveau 2.

---

## 2. Terminaux pilotables par une caisse web (Belgique, novembre 2026)

Contrainte : le DMS tourne dans un navigateur (PC ou tablette) avec un serveur Supabase (Edge Functions). Seule
une **API cloud** (appel HTTPS depuis le serveur + webhook ou relecture) est exploitable ; USB, série, SDK Android
et « app-to-app » sont exclus. Second point, propre à une concession : les tickets sont élevés (300 à 20 000 €).
**Un tarif Bancontact fixe par transaction (0,07 à 0,24 €) est sans commune mesure avec un tarif en % (1,5 % sur
3 000 € = 45 €).**

| Fournisseur | Bancontact au terminal | Intégration pour une caisse web | Retour du résultat | Coût (BE) | Accès / contrat | Avis |
|---|---|---|---|---|---|---|
| **CCV** (via Omespay ou en direct) | Oui [DOC] | **Payment API cloud, `method: terminal`** (A77 / A960 / A35 « pas encore tous les terminaux ») [DOC] | **Webhook + relecture** [DOC] | Bancontact **0,24 → 0,075 €** dégressif, 1 000 premières tx < 5 € offertes jusqu'en 03/2027 ; crédit EEE 1,25 % ; location dès 29,35 €/mois [DOC] | Programme développeur, certification, partner manager | **1er choix** si Omespay confirme l'activation cloud |
| **Worldline** | Oui (acquéreur historique) | **Terminal API v2** cloud (Nexo, v2.1 du 05/08/2026) — **sur terminaux Android Worldline** (Axium EX4000, Saturn…) ; Yomani XR / Yoximo non cités → probablement exclus [DÉDUIT] | Sync (HTTP 200, 4 min) ou **202 + webhook** [DOC] | Bancontact ≈ 0,13 € via KBC/CBC ; EX4000 199 €, Saturn 649 € ou 36 €/mois [TIERS] | Clé API délivrée par le support, pas de self-service | **2e choix**, tarif Bancontact le plus bas |
| **Mollie Terminal** | « Cartes de débit domestiques » : Bancontact **non nommé** → à faire confirmer par écrit [DÉDUIT] | `GET /v2/terminals` + `POST /v2/payments method=pointofsale` (PAX A35 / A920Pro) [DOC] | **Webhook + GET** [DOC] | Pro 20 €/mois : débit **0,15 € + 0,20 %**, crédit 0,10 € + 1,50 % ; PAX A35 350 € [DOC 03/11/2026] | 100 % en ligne | **3e choix**, le plus simple à coder, 0,20 % variable |
| **Viva.com** | Oui, 0,14 € [DOC via extrait] | Cloud Terminal API `/ecr/v1` (OAuth2) ; terminaux Android Viva | Relecture de session + webhooks | Bancontact 0,14 €, Visa/MC 1,69 %, compte 0 à 20 €/mois [TIERS] | En ligne | Doc **inaccessible** le 03/11 (time-out), à revérifier |
| **myPOS** | Oui [DOC] | ePOS API (`/epos/v1/payments`), Carbon / Ultra / Sigma / Flex seulement [DOC] | **Relecture** seulement (pas de webhook vu) | Pro 39 €/mois → Bancontact **0,12 €** ; One 0 €/mois → 1,49 % [DOC] | Mensuel sans engagement | Possible, moins répandu en Wallonie |
| **SumUp Solo** | Oui [DOC] | Cloud API `…/readers/{id}/checkout` [DOC] | Webhook `solo.transaction.updated` [DOC] | **1,69 %** ou 0,99 % + 19 €/mois ; Solo 49–79 € [DOC] | Sans engagement | **Non** : % sur gros tickets |
| **Stripe Terminal** | **Partiel** : Bancontact seulement **co-badgé Visa/MC** « over the co-brand rails » [DOC] | Server-driven (API) ou SDK JS navigateur ; S700 / WisePOS E en BE [DOC] | Webhooks `payment_intent.*` | **1,4 % + 0,10 €** ; S700 259 € [DOC] | Self-service | **Non** : Bancontact pur refusé, % sur gros tickets |
| **Adyen** | Oui [DOC] | Terminal API cloud (nexo) | Sync ou async + WebSocket | Interchange++ + 0,60 %, **minimum de facturation par secteur** [DOC] | Contrat sur mesure, grands comptes | **Non** pour un point de vente |
| **Zettle (PayPal)** | — | — | — | — | **Pas disponible en Belgique** [DOC] | Écarté |
| **Pay. (pay.nl)** | Oui | `POST /v1/orders` + terminalCode, relecture 1 req/s [DOC] | Relecture + exchangeUrl | A35 595 € ou 44,95 €/mois (24 mois) ; Bancontact 0,10 € + 35 €/mois [TIERS] | Société NL, présence BE non confirmée | Écarté |

Sources : [C1]–[C3], [W1]–[W3], [T1]–[T9]. Détail par fournisseur conservé dans les notes de recherche de l'agence.

Cohérent avec l'étude caisse du même jour ([`2026-11-caisse-legal-et-marche.md`](2026-11-caisse-legal-et-marche.md),
décision D3 : « commencer indépendant, relier plus tard ») — la présente étude précise *comment* relier, et avec qui.

**Ce que ça veut dire pour Domenico.** Trois scénarios, du moins au plus coûteux en effort :
- **S0 — garder le terminal « à côté »** (comme aujourd'hui avec G8) : le vendeur choisit « Carte » dans le DMS,
  tape le montant sur le terminal, encaisse ; le DMS enregistre le règlement. Zéro développement, mais double
  saisie et aucune preuve dans le DMS que le montant encaissé est le bon.
- **S1 — piloter le terminal CCV d'Omespay par l'API cloud CCV** : montant envoyé, résultat reçu, règlement
  passé « reçu » automatiquement, écran client « Suivez les instructions sur le terminal ». Dépend de la réponse
  d'Omespay (modèle, activation cloud, coût, certification).
- **S2 — changer de terminal** (Worldline Android ou CCV en direct) si Omespay ne peut pas ouvrir l'API, en tenant
  compte des 250 € de transfert et de l'échéance du contrat de 24 mois.

---

## 3. QR de paiement : virement SEPA, Bancontact Pro, Stripe, Mollie — et le point légal

### 3.1 Le point légal : « +5 % si paiement par Stripe » est interdit en Belgique

- **Art. VII.30, § 3 du Code de droit économique** (inséré par la loi du 19 juillet 2018) : « Il est interdit au
  bénéficiaire de demander des frais au payeur pour l'utilisation d'un instrument de paiement donné et pour les
  services de paiement auxquels s'applique le règlement (UE) 260/2012 » [DOC, texte consolidé ejustice, L1].
  La Belgique a utilisé l'option de la directive PSD2 (art. 62 § 5) pour interdire **toute** surcharge, et pas
  seulement sur les cartes à interchange plafonné : cartes de débit et de crédit, Bancontact, portefeuilles
  (Apple / Google Pay), virements et domiciliations SEPA sont tous couverts [DOC + DÉDUIT].
- **Art. VI.42 CDE** : même là où un supplément resterait admis (moyens « atypiques »), il ne peut jamais dépasser
  « les coûts qu'elle supporte pour l'utilisation de ces mêmes moyens » [DOC, L1]. Un forfait de 5 % dépasse de
  loin les 1,5 % + 0,25 € de Stripe.
- **SPF Économie**, page « Coût de l'utilisation d'un moyen de paiement », mise à jour le **15/09/2026**,
  vérifiée par l'agence le 03/11/2026 [L2] : pour les moyens électroniques « habituels » (carte de débit, carte de
  crédit, virement, domiciliation…), l'entreprise ne peut « facturer au consommateur des suppléments », « ni lui
  imposer le paiement d'un montant minimum » ; seuls les moyens « atypiques » (bracelets cashless de festival)
  tolèrent des frais, « pas supérieurs à ceux réellement supportés par l'entreprise ». Contrôle : DG Inspection
  économique.
- Depuis le **1er juillet 2022** (art. VI.7/4 CDE), tout commerçant doit proposer au moins un moyen de paiement
  **électronique** en présence du client, sans montant minimum, et ne peut pas refuser les espèces (art. VI.7/5)
  [DOC, L1, L3]. Le QR de virement livré le 19/09 satisfait déjà cette obligation [DÉDUIT].
- Côté Stripe : pas de clause « surcharge » dans le Stripe Services Agreement, mais l'utilisateur « must comply
  with all Laws applicable to its business » [DOC, S5] ; les règles Visa / Mastercard n'autorisent la surcharge
  que là où la loi le permet [DÉDUIT].

**Conclusion : la décision P-2 du 30/07 (« QR Stripe +5 % ») ne peut pas être appliquée telle quelle.** Ce qui
reste licite :
1. **Un seul prix quel que soit le moyen**, les frais étant absorbés par la concession (solution sûre).
2. **Une remise réelle pour paiement par virement** (PSD2 art. 62 § 3 autorise à « proposer une réduction » ; le
   SPF l'admet pour la domiciliation [L4]) — à condition que le prix affiché reste le prix réellement payable et
   que la remise ne déguise pas une surcharge. Zone grise : avis du comptable / juriste avant de l'afficher.
3. **Limiter les moyens selon le montant** (ex. carte jusqu'à X €, virement au-delà), admis s'il est annoncé
   clairement avant l'achat [L3]. C'est la bonne façon d'orienter les gros montants vers le virement gratuit.
4. Rien n'empêche de ne **pas** proposer Stripe au comptoir et de le réserver à la vente à distance, mais un
   « frais de service » qui n'apparaît que quand on paie par Stripe serait une surcharge déguisée [DÉDUIT].

### 3.2 (a) QR de virement SEPA — fait, et ses limites

Ce qui existe (M06, mission 02 carte 9) : QR **EPC069-12 v002** avec IBAN d'ITALBIKE STORE, montant,
communication structurée belge dérivée du n° du document ; règlement **attendu** « Virement QR » ; écran client ;
**confirmation à la main** par le vendeur (« Paiement reçu »). Gratuit, aucun contrat.

- **Le virement est instantané dans les faits** : depuis le 9 janvier 2025 les banques doivent recevoir
  l'instantané au prix du virement normal, et depuis le **9 octobre 2025** le proposer dans tous les canaux
  (règlement (UE) 2024/886) ; « certaines banques traitent automatiquement tous les virements comme
  instantanés » [DOC, Febelfin, E1]. L'argent arrive en moins de 10 secondes.
- **Mais la caisse ne le voit pas.** Pour savoir que c'est payé sans que le vendeur regarde l'app bancaire, il
  faut lire le compte : (i) **Ponto** (Isabel Group) — abonnement mensuel par compte lié, tarif non publié,
  webhooks annoncés [DOC, E2] ; (ii) **GoCardless Bank Account Data** (ex-Nordigen) — accès PSD2, **4 relectures
  par jour et par compte** autorisées par les banques, pas de webhook [DOC, E3] ; (iii) Isabel 6 / export CODA
  pour le rapprochement du lendemain. Aucune de ces voies ne donne une **confirmation au comptoir en direct** à
  coût raisonnable [DÉDUIT]. Le QR de virement reste donc le moyen des **gros montants** (motos, acomptes
  importants) où le client accepte que le vendeur vérifie, et le rapprochement se fait en compta (M12).

### 3.3 (b) Bancontact Pro « On a Display » (ex-Payconiq by Bancontact)

- La marque **Payconiq est retirée** : l'app grand public s'appelle Bancontact Pay, les URL passent sur
  `pay.bancontact.net` en production depuis le 11/05/2026, l'offre pro s'appelle **Bancontact Pro** et accepte
  Bancontact Pay, les apps bancaires belges **et Wero** avec la même solution [DOC, P1, P2].
- Produit **« On a Display »** = QR dynamique à usage unique sur l'écran client : `POST /v3/payments` (montant
  en centimes, référence ≤ 35 car., description ≤ 140 car., `callbackUrl`), QR fourni en SVG/PNG, **valide 120 s**,
  statuts PENDING → IDENTIFIED (scanné) → SUCCEEDED / FAILED / CANCELLED / EXPIRED, **callback signé (JWS ES256)**
  avec relecture `GET /v3/payments/{id}` en secours ; chaque paiement porte un `endToEndId` qui apparaît sur le
  relevé bancaire (rapprochement automatique) [DOC, P3, P4, vérifié par l'agence le 03/11].
- Accès : contrat marchand Bancontact, **distribué par BNP Paribas Fortis, Belfius, CBC, ING, KBC** ou en direct ;
  préproduction en ≈ 2 semaines [DOC, P5]. Partenaires caisse listés : ≈ 40 intégrateurs horeca/retail ; Mollie,
  Worldline, Viva, CCV n'y figurent pas pour ce produit [DOC].
- **Tarif non publié** ; l'ancienne grille Payconiq (≈ 0,06 € par transaction + 18 €/an de redevance, gel tarifaire
  annoncé jusqu'à fin 2026) n'a pas pu être vérifiée sur une page datée [TIERS, P6] → à demander à la banque de
  la concession. Plafond réel = plafond de l'app bancaire du client (souvent 2 500 à 5 000 €) [DÉDUIT].
- Confirmation : **instantanée**, par callback → Realtime → écran client « Merci ». C'est le QR « à la belge »,
  celui que les clients connaissent (le même qu'au restaurant).

### 3.4 (c) Stripe : QR vers une page Checkout

- **Rien n'est câblé aujourd'hui** : contrairement à ce qu'écrivent `docs/integrations-cles-api.md` et
  `docs/process-commandes-pieces.md` (« `stripe-checkout` déjà écrite, dormante »), **le dépôt ne contient ni
  fonction `stripe-checkout`, ni `stripe-webhook`, ni `src/modules/web/checkout.ts`** (vérifié le 03/11 sur
  `origin/main`) ; seul un commentaire `STRIPE_SECRET_KEY` subsiste dans `src/lib/config.server.ts`. Tout est à
  faire.
- Tarifs Belgique (page officielle, 03/11/2026) [S1] : cartes EEE **1,5 % + 0,25 €**, premium 2,8 % + 0,25 €,
  hors EEE 3,15 % + 0,25 €, **Bancontact 0,35 €/transaction**, Apple / Google Pay au tarif carte, Checkout et
  Payment Links sans frais, litige 20 €.
- Moyens BE dans Checkout [DOC, S2, S3] : cartes, **Bancontact** (confirmation immédiate, aucun litige possible,
  Stripe affiche lui-même un QR Bancontact sur ordinateur), **Wero** (QR scanné dans l'app Wero, < 10 s), Apple /
  Google Pay, SEPA. **Payconiq : absent** [DOC].
- Mécanique pour le comptoir [DÉDUIT de S3, S4] : une Edge Function crée une **Checkout Session** (montant exact,
  `client_reference_id` = n° du document, `metadata` = id du règlement, `expires_at` = +30 min ; minimum 30 min,
  maximum 24 h), l'URL est dessinée en QR sur l'écran client, le client scanne, paie (Bancontact / carte / Wero),
  le webhook **`checkout.session.completed`** passe le règlement à « reçu ». Les **Payment Links** (QR généré par
  le tableau de bord Stripe) sont statiques et **n'expirent pas** : à réserver au paiement à distance par mail.
- Atout : **une seule intégration sert trois usages** — QR au comptoir, lien de paiement dans le mail de commande
  de pièces (process §5, « paiement par mail »), et le paiement du site si un jour on quitte Shopify Payments.
  Inconvénient : % sur les cartes ; le client qui scanne choisit lui-même Bancontact (0,35 €) ou carte (1,5 %).

### 3.5 (d) Mollie

- Tarifs BE (03/11/2026) [M1] : **Bancontact 0,39 €**, cartes EEE **1,80 % + 0,25 €**, virement 0,25 €, Pro 20 €/mois
  optionnel. Payconiq : absent.
- **QR Bancontact natif** : `POST /v2/payments` avec `method=bancontact` et `include=details.qrCode` → le QR est
  renvoyé par Mollie, **limité à 1 500 €**, session 1 h ; webhook (POST de l'id, puis relecture) [DOC, M2, M3].
- Wero via Mollie annoncé pour la Belgique « T3 2026 » en bêta, **non garanti (contestation 120 jours)** [DOC, M4].
- Intérêt : Mollie couvre **à la fois** le QR (3.5) et un terminal PAX (§2) avec une seule clé API et une doc très
  simple ; limite : Bancontact non nommé au terminal, 0,20 % variable, plafond QR 1 500 €.

### 3.6 Synthèse QR

| | Confirmation | Frais (BE) | Plafond | Contrat | Effort DMS |
|---|---|---|---|---|---|
| Virement SEPA (fait) | Manuelle (vendeur) ; auto possible via Ponto, pas en direct | 0 € | Illimité | Aucun | 0 j (fait) ; rapprochement Ponto : 3–4 j, abonnement |
| **Bancontact Pro On a Display** | **Instantanée**, callback signé | Non publié (≈ 0,06 €/tx + 18 €/an à vérifier) | App bancaire du client | Via la banque, ≈ 2 sem. préprod | 3–4 j |
| **Stripe Checkout** | **Instantanée**, webhook | Bancontact 0,35 € ; cartes 1,5 % + 0,25 € | Carte / banque du client | Compte Stripe, self-service | 3–4 j (rien n'existe) |
| Mollie QR Bancontact | Instantanée, webhook | 0,39 € | **1 500 €** | Self-service | 3 j |

---

## 4. L'écran client (tablette face au client)

### 4.1 Ce qui existe déjà dans le DMS (lu dans le code le 03/11)

- Route **`/ecran-client`** (`src/routes/ecran-client.tsx`) : page plein écran sans navigation, **session équipe
  obligatoire** (sans session → `/login`, sans rôle → message), `robots: noindex`.
- Composant **`CustomerDisplay`** (`src/modules/sales/customer-display.tsx`, 146 lignes) : trois états — accueil
  neutre (nom de la société), **QR de virement en très grand** (montant en 72 px, bénéficiaire, IBAN,
  communication, nom du client, bandeau « en attente »), **« Merci, paiement reçu »** pendant 8 s puis remise à
  zéro côté serveur. Bouton discret plein écran.
- Synchronisation : table **`counter_displays`** (une ligne par **société × vendeur**, colonnes `payment_id`,
  `updated_at`, RLS « sa propre ligne », aucune écriture directe), **Realtime Supabase** (`postgres_changes` filtré
  sur `user_id`) **plus relecture toutes les 5 s** en secours (`refetchInterval`, même en arrière-plan). Lecture par
  la RPC `counter_display_current` (joint règlement, document, client, société), écriture par
  `counter_display_show` / `qr_payment_start` / `qr_payment_confirm`
  (`supabase/migrations/20260919360000_m6_qr_virement_ecran_client.sql`).
- **Limite actuelle** : l'écran ne connaît qu'un **règlement QR** ; il ne montre ni les lignes du ticket ni le
  total, ni un état « terminal », ni un QR d'un autre type.
- **Signature** : `src/modules/documents/signature-pad.tsx` (canvas doigt / stylet / souris → PNG), déjà utilisé
  par l'écran de signature des propositions d'intervention (`proposal-sign-screen.tsx`, route publique
  `/signer/$token`, « Faire signer sur la tablette » dans l'OR, 31/10) et par la validation des reprises. Documenté
  « réutilisable (attestations, bons, décharges) ».

### 4.2 Ce que font les caisses du marché

Les écrans client des caisses courantes (Lightspeed, Square, Shopify POS, Odoo POS, Tiller, Clover, Toast)
affichent la même chose : **le ticket en direct** (lignes, quantités, remises, total TVA comprise) pendant la
saisie ; au moment de payer, **le moyen choisi** (« Suivez les instructions sur le terminal », QR à scanner) ; puis
**la confirmation** et des options : signature, pourboire (horeca, sans objet ici), choix du reçu (papier / e-mail),
avis de satisfaction, et un **mode « vitrine »** (visuels promo) au repos. Les caisses sur tablette les plus
répandues utilisent un **deuxième appareil** (iPad / Android) synchronisé par le réseau, exactement ce que fait
déjà `/ecran-client` par Supabase Realtime.

### 4.3 Ce qu'on propose

Généraliser `counter_displays` en **« état de l'écran client »** (toujours une ligne par société × vendeur,
toujours Realtime + relecture 5 s), avec un `mode` :

| Mode | Déclencheur côté vendeur | Ce que voit le client |
|---|---|---|
| `accueil` | Rien / fin de vente | Nom de la société, visuel Ducati (mode vitrine optionnel) |
| `ticket` | Document ouvert dans l'éditeur (brouillon ou validé) | **Lignes en direct** (désignation, quantité, PU TTC, remise), total HT / TVA / **TTC en grand**, reste à payer |
| `qr` | « Payer par QR » (virement, Bancontact Pro ou Stripe) | QR en grand, montant, type de QR, consignes, compte à rebours (120 s Bancontact Pro, 30 min Stripe) |
| `terminal` | « Payer par carte » (S1) | « Suivez les instructions sur le terminal », montant, annulation possible par le vendeur |
| `signature` | « Faire signer » (BL, prise en charge, décharge) | Texte court + `SignaturePad` plein écran, « Effacer » / « Valider » ; PNG rangé en GED, SHA-256 comme pour les propositions |
| `merci` | Règlement reçu | « Merci, paiement reçu », montant, 8 s |

- **Tablette** : n'importe quelle tablette (Android ou iPad) en navigateur, en **mode kiosque / plein écran**,
  connectée avec le compte du vendeur (session équipe, comme aujourd'hui), posée face au client. Aucune
  application à installer. Une tablette par poste de vente ; la ligne `counter_displays` est déjà par vendeur.
- **Données affichées** : nom du client, lignes, montants — rien d'autre (pas d'adresse, pas de téléphone), comme
  la règle actuelle du composant.
- **Confirmation** : quel que soit le moyen (callback Bancontact Pro, webhook Stripe, webhook CCV, clic « Paiement
  reçu » pour le virement), c'est **le règlement `document_payments` qui passe de `attendu` à `recu`**, et l'écran
  suit. Un seul mécanisme, déjà en place (`qr_payment_confirm` → `recompute_document_paid`).

---

## 5. Recommandation

1. **Terminal : rester chez Omespay (CCV) et demander l'ouverture de l'API cloud CCV** (mail §6). Si Omespay
   confirme un A77 / A960 / A35 activable en Cloud Connect à un coût raisonnable → **S1** (le DMS pilote le
   terminal). Sinon → **S0** (terminal « à côté », zéro développement) jusqu'à l'échéance du contrat de 24 mois,
   puis **S2** (Worldline Android ou CCV direct). Ne pas changer de terminal *avant* d'avoir la réponse : 250 € de
   transfert + échéance.
2. **Abandonner le « QR Stripe +5 % »** (illégal) et le **remplacer par un QR à confirmation instantanée sans
   supplément** : **Stripe Checkout** (Bancontact 0,35 € + cartes + Wero) parce qu'une seule intégration couvre
   le comptoir, le lien de paiement par mail des commandes de pièces et le site ; **Bancontact Pro On a
   Display** en option si la banque propose un tarif fixe plus bas et si Domenico veut le QR « à la belge » que
   ses clients connaissent (les deux cohabitent sans problème : même écran, même règlement attendu).
3. **Garder le QR de virement SEPA pour les gros montants** (motos, acomptes), confirmation manuelle ; pas de
   Ponto tant que le volume ne le justifie pas.
4. **Écran client sur tablette** : généraliser l'écran existant (lignes + total en direct, QR, terminal, merci,
   signature) — c'est le socle commun aux trois moyens.
5. **Rendre la confirmation uniforme** : tout moyen aboutit à un règlement `attendu` → `recu` par une fonction
   serveur, avec `events`, et l'écran client suit par Realtime.

**Effort (jours agence, hors délais fournisseurs)**

| Lot | Contenu | Jours |
|---|---|---|
| **A — Écran client généralisé** | `counter_displays.mode` + charge utile, ticket en direct depuis l'éditeur, états qr / terminal / merci, mode vitrine, tablette kiosque, tests | **3 à 4** |
| **B — QR Stripe Checkout** | Compte Stripe (clé live + secret webhook en secrets Supabase), Edge Functions `stripe-checkout-start` et `stripe-webhook` (signature vérifiée, idempotence), règlement attendu → reçu, expiration 30 min, remboursement depuis un avoir, lien dans le mail de commande de pièces, tests | **3 à 4** |
| **C — Terminal CCV cloud (S1)** | Edge Functions `terminal-start` / `terminal-webhook` + relecture de secours, règlement attendu → reçu / refusé / annulé, time-out et annulation côté vendeur, remboursement, écran client « terminal », tests ; **+ délai externe** : activation Omespay / CCV, certification | **4 à 6** |
| **D — Signature sur l'écran client** | Mode `signature` réutilisant `SignaturePad` et la logique SHA-256 / GED des propositions, pour BL et décharges | **1 à 2** |
| **E (option) — Bancontact Pro On a Display** | Contrat via la banque, `POST /v3/payments`, callback JWS vérifié, relecture, QR 120 s | **2 à 3** |

Soit **11 à 16 jours** pour A + B + C + D (E en plus si choisi), en commençant par A + B qui ne dépendent de
personne. À mettre à jour dans la proposition caisse du 03/11 (§6, lot « Caisse comptoir, finitions » : « QR
Stripe +5 % » → « QR sans supplément »).

**Prérequis côté client** : réponse d'Omespay (§6) ; compte Stripe au nom d'ITALBIKE STORE avec clé live et secret
de webhook (jamais dans le code) ; si Bancontact Pro : contrat via la banque ; une tablette par poste.

---

## 6. Questions à poser — mails prêts à envoyer (rien n'a été envoyé)

### 6.1 À Omespay (Erwin Struys / support) — de la part de Domenico ou de l'agence, en son nom

> **Objet : Intégration de notre terminal CCV à notre logiciel de caisse — ITALBIKE STORE (Waterloo)**
>
> Bonjour,
>
> Nous sommes client Omespay pour notre terminal de paiement à la concession Ducati de Waterloo (ITALBIKE
> STORE SRL). Nous mettons en service un logiciel de caisse sur mesure qui tourne dans un navigateur (PC et
> tablette) avec un serveur en ligne. Nous souhaitons que la caisse **envoie le montant au terminal et reçoive le
> résultat du paiement** sans resaisie. Pourriez-vous nous préciser :
>
> 1. **Quel terminal exactement** est installé chez nous (modèle CCV : A77, A960, A35, Duo Base ?) et **quel est
>    l'acquéreur** de notre contrat (EMS, CCV Pay, autre) ?
> 2. Pour une caisse en navigateur avec serveur, **quelle interface officielle** proposez-vous : la **Payment API
>    cloud de CCV (moyen « terminal », Cloud Connect)** ou autre chose ? Pouvez-vous nous donner l'accès à la
>    documentation, à un **environnement de test** et aux identifiants (ou nous mettre en contact avec le partner
>    manager CCV) ?
> 3. Notre terminal **peut-il être activé en Cloud Connect** ? À quel **coût** (activation, abonnement mensuel,
>    frais d'intégration) et dans **quel délai** ? Faut-il une **certification** de notre logiciel, et qui la porte ?
> 4. Quels sont nos **frais actuels par réseau** (Bancontact, Maestro, Visa / Mastercard, Amex, Apple / Google
>    Pay) et l'**échéance de notre contrat** (date, préavis) ?
> 5. En cas de time-out, de double paiement ou de remboursement échoué, **qui assure le support** (Omespay, CCV,
>    l'acquéreur) et avec quel délai de réponse ?
>
> Merci d'avance pour votre retour,
> [Signature]

### 6.2 À Domenico (à trancher avant de coder)

1. **Le +5 % est interdit** : accepte-t-il un QR **sans supplément** (frais absorbés : Bancontact 0,35 €, cartes
   1,5 % + 0,25 €) ? Ou préfère-t-il **ne pas** offrir la carte à distance et garder virement + Bancontact Pro ?
   Veut-il afficher une **remise pour virement** (à valider avec le comptable) ?
2. Quel **terminal** a-t-il physiquement (photo du modèle) et **quand** le contrat Omespay arrive-t-il à échéance ?
3. **Stripe ou Bancontact Pro** (ou les deux) pour le QR instantané ? Sa banque (laquelle ?) peut donner le tarif
   Bancontact Pro en une semaine.
4. **Tablette** : une par poste de vente ? Android ou iPad ? Faut-il un mode vitrine (visuels Ducati) au repos ?
5. **Signature sur l'écran client** : pour quels documents (BL, décharge, prise en charge atelier) ?
6. Les **gros montants** (motos) : garder le virement QR avec confirmation à la main, ou faut-il une lecture du
   compte (Ponto, abonnement) ?

---

## 7. Sources (consultées le 3 novembre 2026)

**Omespay**
- [O1] https://omespay.be/ et https://omespay.be/fr/ — accueil, « koppeling gecertificeerd », aucun prix.
- [O2] https://omespay.be/contact/ — Nous 2 BV/SRL, BE 0447.299.959.
- [O3] https://www.companyweb.be/en/0447299959/nous-2 ; https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer=0447299959 — fiche BCE, effectifs et comptes 2022-2025.
- [O4] https://be.linkedin.com/company/omespay ; https://be.linkedin.com/company/paymentconsulting.be — fondée 2016, CCV, OmniPay.
- [O5] https://omespay.be/algemene-voorwaarden/ — CGV : 24 mois, préavis 3 mois, EMS, 250 € transfert.
- [O6] https://omespay.be/betaaloplossingen/betaalterminals/ — A960, A77, A35, Duo Base.
- [O7] https://www.bobex.be/nl-be/betaalterminal/ccv/ ; https://www.companeo.be/nl_BE/betaaloplossingen/gids/betaaloplossing-ccv-ems (maj 14/07/2026) — repères de prix CCV / EMS.
- [O8] https://www.bobex.be/nl-be/leveranciers/kassa-pay/ ; https://www.bobex.be/nl-be/betaalterminal/payment-consulting/ — avis, ancien positionnement.
- [O9] https://omespay.be/fr/systemes-de-caisse/connexion-a-la-caisse-via-lapi-de-paiement/ (vérifiée par l'agence) ; https://omespay.be/hoe-werkt-kassakoppeling-betaalterminal/ ; https://omespay.be/betaalintegratie-testscenarios/ (blogs du 12-13/09/2026).

**CCV**
- [C1] https://developer.myccv.eu/documentation/payment_api/online_payments/payment_methods/terminal/ (vérifiée par l'agence) — moyen `terminal`, webhook / relecture, « A CCV Terminal is required ».
- [C2] https://developer.myccv.eu/documentation/payment_api/ ; https://developer.myccv.eu/solutions/ccv_terminals/ ; https://developer.myccv.eu/reference/use-cases/cloud-connection/CCV_Cloud_Connect.html ; https://www.ccv.eu/en/solutions/developer-portal/ — architecture, « pas encore tous les terminaux », certification en 5 étapes.
- [C3] https://www.ccv.eu/be-fr/solutions-de-paiement/traitement-des-transactions/tarifs ; https://www.ccv.eu/be-fr/solutions-de-paiement/terminaux-de-paiement ; https://www.ccv.eu/be-nl/betaaloplossingen/betaalterminals/kassagekoppelde-betaalterminals — grille Bancontact dégressive, location dès 29,35 €/mois.

**Worldline et autres terminaux**
- [W1] https://docs.instore.worldline-solutions.com/terminal-api/ ; …/build-your-integration/sending-your-first-request ; …/build-your-integration/how-to-setup-your-terminal/ ; …/faq — Terminal API v2, app via SmartPOS Store, clé par le support.
- [W2] https://docs.terminal.worldline-solutions.com/release-notes/index (v2.1.0 du 05/08/2026) ; …/build-your-integration/overview-of-async-processing — 202 + webhook.
- [W3] https://paymentreview.com/blog/belgium-bancontact-card-fees-2026/ (23/10/2026) ; https://www.guide-terminal-paiement.be/type-terminal-de-paiement/terminal-de-paiement-belgique-comparatif/ (oct. 2026) — grilles belges comparées.
- [T1] https://docs.mollie.com/docs/integrating-mollie-terminals (17/09/2026) ; https://docs.mollie.com/docs/point-of-sale (27/10/2026) — Mollie Terminal.
- [T2] https://www.mollie.com/be-fr/pricing (03/11/2026) — grille Mollie BE.
- [T3] https://developer.sumup.com/terminal-payments/cloud-api/ ; https://www.sumup.com/fr-be/tarifs/ — SumUp.
- [T4] https://docs.stripe.com/terminal/payments/regional ; https://docs.stripe.com/terminal/payments/setup-reader ; https://stripe.com/be/pricing — Stripe Terminal (Bancontact co-badgé seulement).
- [T5] https://docs.adyen.com/point-of-sale/design-your-integration/choose-your-architecture/cloud/ ; https://docs.adyen.com/point-of-sale/what-we-support/payment-methods ; https://www.adyen.com/pricing — Adyen.
- [T6] https://developers.mypos.com/apis/epos ; https://www.mypos.com/en-be/pricing-and-fees — myPOS.
- [T7] https://www.zettle.com/ — pays couverts, Belgique absente.
- [T8] https://developer.pay.nl/docs/pos-integration-guide (28/07/2026) ; https://www.pay.nl/en/in-store-payments — Pay.
- [T9] https://github.com/QrCommunication/sdk-php-viva-isv — Viva Cloud Terminal (doc officielle inaccessible le 03/11).

**Point légal**
- [L1] https://www.ejustice.just.fgov.be/eli/loi/2013/02/28/2013A11134/justel — Code de droit économique consolidé : art. VI.7/4, VI.7/5, VI.42, VII.30 § 3.
- [L2] https://economie.fgov.be/fr/themes/ventes/politique-des-prix/paiements/cout-de-lutilisation-dun-moyen (maj 15/09/2026, vérifiée par l'agence) — suppléments interdits.
- [L3] https://economie.fgov.be/fr/themes/ventes/politique-des-prix/paiements/obligation-de-proposer-un (maj 30/03/2026) — moyen électronique obligatoire depuis le 01/07/2022.
- [L4] https://economie.fgov.be/fr/themes/ventes/politique-des-prix/paiements/refus-de-domiciliation-ou-de — remise admise pour la domiciliation.
- Directive (UE) 2015/2366 art. 62 § 3-5 et règlement (UE) 2024/886 : EUR-Lex inaccessible aux outils le 03/11 ; cités de mémoire, transposition belge lue dans [L1].

**Stripe (QR)**
- [S1] https://stripe.com/be/pricing — 1,5 % + 0,25 €, Bancontact 0,35 €.
- [S2] https://docs.stripe.com/payments/bancontact ; https://docs.stripe.com/payments/wero — moyens BE.
- [S3] https://docs.stripe.com/api/checkout/sessions/create ; https://docs.stripe.com/payments/checkout/how-checkout-works — `expires_at` 30 min à 24 h, `client_reference_id`.
- [S4] https://docs.stripe.com/checkout/fulfillment ; https://docs.stripe.com/payment-links/share ; https://docs.stripe.com/api/payment-link/object — webhook `checkout.session.completed`, QR de Payment Link sans expiration.
- [S5] https://stripe.com/en-be/legal/ssa — « comply with all Laws ».

**Bancontact Pro / Payconiq**
- [P1] https://docs.bancontactpro.com/guides/general/payloadurlupdate — retrait de la marque Payconiq, URL `pay.bancontact.net` dès le 11/05/2026.
- [P2] https://www.bancontact.com/fr/professionnel/qu-est-ce-que-bancontact-pro ; https://wero-wallet.eu/ — Bancontact Pay + Wero.
- [P3] https://docs.bancontactpro.com/guides/instore/ondisplay052025v4 (vérifiée par l'agence) — On a Display, 120 s, statuts, void.
- [P4] https://docs.bancontactpro.com/guides/general/callback052025 ; https://docs.bancontactpro.com/guides/general/faq — callback JWS, `endToEndId`.
- [P5] https://docs.bancontactpro.com/guides/general/gettingstarted052025v4 ; https://www.bancontact.com/fr/professionnel/partenaires/liste — onboarding, banques distributrices.
- [P6] https://www.bancontact.com/en/news/introducing-the-payconiq-operating-fee-for-merchants-a-fixed-fee-of-18-per-year (05/02/2024) — redevance 18 €/an (ancienne grille Payconiq).

**Mollie (QR)**
- [M1] https://www.mollie.com/be-fr/pricing — Bancontact 0,39 €, cartes 1,80 % + 0,25 €.
- [M2] https://docs.mollie.com/docs/qr-codes — `include=details.qrCode`, QR Bancontact < 1 500 €.
- [M3] https://docs.mollie.com/docs/bancontact ; https://docs.mollie.com/docs/webhooks — session 1 h, webhook.
- [M4] https://docs.mollie.com/docs/wero — Wero BE T3 2026, non garanti.

**Virement instantané et lecture de compte**
- [E1] https://febelfin.be/fr/themes/numerisation-et-innovation/virements/virement-instantane — obligations 09/01/2025 et 09/10/2025.
- [E2] https://myponto.com/en/pricing/customer-paying-model/ — abonnement par compte, tarif non publié.
- [E3] https://docs.gocardless.com/bank-account-data/overview ; …/quick-start-guide — 90 jours, 4 appels/jour/compte.

**Code du DMS lu** : `src/routes/ecran-client.tsx`, `src/modules/sales/customer-display.tsx`,
`src/modules/sales/qr-payment-api.ts`, `src/modules/sales/qr-payment-card.tsx`, `src/modules/documents/signature-pad.tsx`,
`supabase/migrations/20260919360000_m6_qr_virement_ecran_client.sql`, `supabase/functions/` (liste), `src/lib/config.server.ts`.
