---
titre: Caisse de la concession — ce que la loi belge impose et ce que fait le marché
pour: Domenico (ITALBIKE STORE / Ducati Bruxelles) et l'agence
de: agence, étude remise le 03/11/2026
etat: étude remise, décisions attendues (§4)
prolonge: ../propositions/2026-11-caisse-shopify-ou-dms.md (§3.2, obligations déjà vérifiées)
---

# Caisse de la concession : cadre légal belge et marché des logiciels de caisse

> **En deux mots.** La caisse reste dans le DMS (décision du 03/11). Avant de la finir, on a voulu
> savoir **ce qu'une caisse de commerce de détail doit faire en Belgique** (hors horeca) et **ce que
> font les logiciels du marché**. Résultat : le DMS a déjà le gros (ticket, facture, avoir, acompte,
> multi-paiement, rendu de monnaie, journal Z, comptage du tiroir, détaxe, UBL). Il lui manque
> **sept points légaux** qu'aucun ticket de caisse ne peut ignorer en Belgique : la **facture
> obligatoire dès 125 € pour les pièces et accessoires moto** vendus à un particulier, l'**arrondi
> à 5 centimes** des espèces, un **journal des recettes** au sens du fisc (Z numéroté, figé, par
> taux), le **registre des véhicules à moteur** (« registre des garagistes »), la **facture
> d'acompte**, la **mention légale sur l'avoir** et l'**annulation d'un règlement par contre-passation**
> (jamais par suppression). Tout cela tient en **≈ 12 à 15 jours**, hors terminal Bancontact,
> Falco et TVA marge déjà chiffrés le 03/11. Côté marché, aucune caisse « grand public » ne fait
> acompte sur moto, pièces sur OR, TVA marge ou registre VO : le choix du DMS se confirme.

Ce que cette étude ne refait pas : les obligations déjà vérifiées le 03/11 (ticket ou facture,
mentions et numérotation, journal des recettes dans ses grandes lignes, Peppol B2B 2026, TVA
marge art. 58 §4, détaxe art. 39) — proposition du 03/11, §3.2. Elle les prolonge et les précise.

---

## 1. Ce que la loi belge impose à une caisse de concession (hors horeca)

Périmètre : ITALBIKE STORE (puis NL INVEST), Waterloo ; ventes de motos neuves et d'occasion,
pièces, accessoires, vêtements ; atelier ; clients particuliers et professionnels, belges et
étrangers. Sources consultées le 03/11/2026, listées au §5 ; les références [L…] renvoient à cette liste.

### 1.1 Tableau des obligations

| # | Obligation | Détail utile pour la caisse | Source | État du DMS |
|---|---|---|---|---|
| L1 | **Facture obligatoire ou ticket suffisant ?** | Entre assujettis (B2B) : facture toujours. Vers un **particulier** : ticket suffisant **sauf** pour les opérations listées à l'art. 1er §2 de l'AR n° 1, dont **(1° a)** toute livraison d'un **véhicule terrestre à moteur** neuf ou d'occasion > 48 cm³ ou > 7,2 kW, et **(9°)** les **pièces détachées, accessoires et équipements** de ces véhicules ainsi que les **travaux** (hors lavage) **dès que le prix TTC dépasse 125 €**. Un casque, un blouson ou un t-shirt ne sont pas des « pièces du véhicule » : ticket possible quel que soit le montant. | [L1] AR n° 1, art. 1er (version 01/01/2026) ; [L2] | **Partiel.** Le DMS sait faire ticket (TIK, sans client) et facture (FAC). Il n'impose pas la facture au-delà de 125 € pour une pièce ou un accessoire moto, ni pour un OR. Le client peut donc repartir avec un ticket là où la loi veut une facture. |
| L2 | **Mentions de la facture** | Art. 5 AR n° 1 : date d'émission, **numéro séquentiel unique** (une ou plusieurs séries), nom / adresse / n° TVA du vendeur, identité et n° TVA du client, date du fait générateur si différente, désignation, base par taux, prix unitaire HT, taux et montant de TVA, mention de l'exonération ou du régime (« Régime particulier – biens d'occasion », « art. 39 »), référence aux documents antérieurs (une facture ne peut redébiter une TVA déjà facturée : acompte). Véhicule neuf : marque, modèle, cylindrée, puissance, **n° de châssis**. | [L1] art. 5 ; [L3] | **Fait** (numérotation par société et par type, mentions, bloc moto avec VIN sur le PDF, mentions marge / détaxe dans la langue du client). |
| L3 | **Délai d'émission** | Au plus tard le **15e jour du mois** qui suit le fait générateur (livraison, fin des travaux) ou l'encaissement d'un acompte. | [L1] art. 4 | **Fait** (la facture est émise à la validation) ; aucune alerte « BL non facturé avant le 15 » (confort, voir §3). |
| L4 | **Acompte** | La TVA devient exigible **à l'encaissement** de tout acompte (art. 17 §1 CTVA). Quand une facture est due (B2B, et **tout véhicule** même vendu à un particulier), il faut une **facture d'acompte** avec les mentions ordinaires + date d'encaissement, dans le même délai ; la facture finale fait référence à l'acompte et ne redébite pas sa TVA. Pour un particulier qui achète autre chose qu'un véhicule, un reçu d'acompte suffit ; l'acompte entre au journal des recettes le jour où il est encaissé. | [L4] [L5] (règle à confirmer avec le comptable : sources concordantes sur l'encaissement, divergentes sur le document) | **Partiel.** Acompte sur RES / BC, reporté sur la facture, dans le journal Z. **Pas de facture d'acompte** (ni numéro, ni PDF, ni UBL) ; l'acompte sur une Panigale vendue à un particulier n'est donc pas facturé dans les formes. |
| L5 | **Note de crédit (avoir)** | Référence obligatoire à la facture rectifiée (art. 12 §3 AR n° 1) et mention **« TVA à reverser à l'État dans la mesure où elle a été initialement déduite »** (AR n° 4, art. 4 §1) ; numérotation séquentielle propre ou commune ; en B2B, l'avoir passe par Peppol comme la facture. | [L1] art. 12 ; [L6] | **Partiel.** Avoir généré depuis la facture (lignes négatives, stock réintégré, facture annulée, UBL « CreditNote ») ; **la mention « TVA à reverser… » n'est pas imprimée** et la référence à la facture d'origine n'est pas affichée en clair sur le PDF. |
| L6 | **Journal des recettes** | Pour les opérations **sans facture** (tickets) : un journal **par siège d'exploitation**, recettes **du jour**, **ventilées par taux**, avec **inscription distincte** (nature du bien) de toute livraison dont le prix unitaire **dépasse 500 € TTC** (seuil relevé de 250 à 500 € le 10/01/2026), appuyé sur des pièces justificatives (doubles de tickets). Tenue **numérique permise** ; une **caisse enregistreuse qui produit un rapport financier (Z) et remet systématiquement un ticket** est **assimilée** à la tenue digitale du journal. Le Z doit porter : identification de la caisse, date et heure, **numéro d'ordre continu**, période, total des montants, total des réductions et remboursements, chiffre d'affaires net TVAC. Le ticket : date, **n° d'ordre**, identification de la caisse et de l'établissement, articles et montants TVAC, réductions et remboursements, total. Journal et pièces restent **au siège** jusqu'à la fin du 3e mois suivant la clôture. | [L1] art. 14 §2 3° et 15 §4 ; [L7] AR 13/12/2022 (en vigueur 01/01/2023) ; [L8] | **Partiel.** `cash_z_report` calcule encaissements par mode et ventilation TVA **à la demande, sur une plage horaire**, sans numéro d'ordre, sans figer, sans « lignes > 500 € », sans séparer ventes avec facture / sans facture ; le ticket ne porte ni identification de caisse ni n° d'ordre de ticket (il a son n° TIK). Le ticket **n'est pas rattaché à la session**. |
| L7 | **Système de caisse enregistreuse certifié (GKS / SCE)** | Réservé à l'**horeca** : établissements dont les services de restauration dépassent **25 000 € HTVA par an** (par établissement). Un commerce de détail sans service de restauration n'est **pas** visé ; une cafétéria **payante** de concession qui dépasserait 25 000 € le serait (exemple officiel du magasin de meubles avec cafétéria). SCE 2.0 : obligatoire pour les nouveaux établissements horeca depuis le 01/07/2026. | [L9] [L10] | **Sans objet** tant que le « bar » de la concession reste gratuit ou marginal. À confirmer (décision D9). |
| L8 | **Paiement en espèces : plafond** | **3 000 €** par transaction (ensemble du montant dû, même fractionné) entre un professionnel et toute personne ; interdit pour un immeuble. Loi du 18/09/2017, art. 67. Amende jusqu'à 10 % du montant, plafonnée. | [L11] | **Absent.** Rien n'empêche d'encaisser 4 000 € en espèces sur une moto. |
| L9 | **Espèces : arrondi à 5 centimes** | Obligatoire depuis le **01/12/2019** sur le **total** payé **en espèces**, en présence physique, montant > 5 c : 1-2 c → 0 ; 3-4-6-7 c → 5 ; 8-9 c → dizaine. Seule la part payée en espèces est arrondie en cas de paiement mixte. Arrondi facultatif sur la carte, à condition d'afficher « Le montant total est toujours arrondi ». Le ticket mentionne le montant arrondi. CDE art. VI.7/1 et VI.7/2. | [L12] [L13] | **Absent.** Le rendu de monnaie se calcule au centime ; le net TTC forcé permet d'arrondir « à la main », ce n'est pas la règle. |
| L10 | **Moyen de paiement électronique obligatoire** | Depuis le **01/07/2022**, tout vendeur à des consommateurs doit proposer **au moins un** moyen électronique (terminal, Bancontact, Payconiq / Bancontact Pro par QR, virement instantané…) ; **pas de supplément ni de minimum** pour la carte. CDE art. VI.7/3. | [L14] [L15] | **Fait sur le papier** (modes « Carte », « Virement QR »), **mais le terminal Bancontact n'existe pas encore** (décision P-2 : marque et modèle attendus). Le QR de virement SEPA est fait. |
| L11 | **Obligation d'accepter les espèces** | Depuis le **31/03/2024** (loi du 08/02/2024), un commerce physique ne peut plus refuser les espèces (exceptions : grosses coupures disproportionnées, > 50 pièces, sécurité). | [L16] | **Fait** (mode « Espèces » toujours disponible). |
| L12 | **Faut-il remettre un ticket ? Ticket électronique ?** | Hors horeca, **pas d'obligation générale** de remettre un ticket papier pour une vente de biens ; le commerçant doit fournir une **preuve d'achat sur demande**. Le ticket peut être remis **par voie électronique** (e-mail, plateforme, QR) depuis l'AR du 13/12/2022 ; papier obligatoire seulement pour restaurants, hôtels, car-wash. Mais si la caisse sert de journal des recettes (L6), le ticket doit être **remis systématiquement** (papier ou électronique). | [L7] [L17] | **Partiel.** Ticket imprimé (HTML A4 navigateur), PDF et e-mail seulement pour un document **avec client** ; un ticket sans client ne part pas par mail (PDV003). Pas de format 80 mm. |
| L13 | **Conservation** | Factures, livres et pièces : **10 ans** à compter du 1er janvier de l'année qui suit (loi du 20/11/2022, art. 60 CTVA, pour la TVA exigible depuis le 01/01/2023) ; biens d'investissement 15 / 25 ans ; livres comptables du CDE : 7 ans (le 10 ans fiscal prime). Tickets digitaux et rapports Z : modalités de l'AM du 17/03/2023. | [L18] | **Fait** (base + GED, rien n'est purgé) ; **à écrire noir sur blanc** dans la politique de sauvegarde (export annuel figé). |
| L14 | **Inaltérabilité / anti-fraude** | **Pas d'équivalent belge de la NF525 française** pour un commerce de détail : aucune certification de logiciel de caisse hors GKS horeca. Ce qui existe : la comptabilité doit garantir **continuité, régularité et irréversibilité des écritures** (CDE art. III.86 et AR comptes annuels), le journal des recettes ne peut être tenu sur feuilles mobiles, un règlement ou une facture ne se « corrige » pas : on **contre-passe** (règlement négatif, note de crédit). Le fisc confronte le registre des véhicules, le journal des recettes, le stock et la facturation. | [L1] art. 14 ; [L19] ; [L20] | **Partiel** (B7). Documents validés figés, audit `events` complet, numéro pris une seule fois. **Mais** `deletePayment` **supprime physiquement** un règlement et la purge des devis supprime des documents ; le journal Z n'est pas figé. |
| L15 | **E-facturation Peppol B2B (2026) et e-reporting (2028)** | Depuis le **01/01/2026**, toute facture entre assujettis belges = UBL Peppol BIS 3.0 via un point d'accès ; B2C et étrangers exclus. **Avant-projet (juillet 2026)** : **e-reporting quasi temps réel au 01/01/2028**, Peppol « 5 coins », remplace le listing clients ; **les ventes B2C sont exclues** du projet ; le texte n'est pas voté. Pas de mandat B2C en vue. | [L21] [L22] ; proposition 03/11 [S18] [S19] | **Partiel.** UBL produit et téléchargé ; **connecteur Falco à faire** (4 à 6 j, déjà chiffré). Le ticket B2C n'a rien à faire sur Peppol. |
| L16 | **Registre des véhicules à moteur (« registre des garagistes »)** | Art. 28 AR n° 1 (version 10/01/2026) : tout assujetti qui effectue **régulièrement** des livraisons ou prestations relatives à des véhicules à moteur, ou qui s'entremet dans la vente de VO, tient **par siège** un registre où chaque véhicule qui **entre** reçoit un **n° d'ordre**, la **date d'entrée**, la **plaque** (ou le châssis), le n° TVA UE du donneur d'ordre le cas échéant et un **code de nature d'opération** ; à la **sortie**, la date ; **au plus tard fin du mois suivant la sortie**, la **référence de la facture** (ou le motif de l'absence de document). Registre au siège ; cyclomoteurs A/B et speed pedelecs exclus. Amende **1 500 à 5 000 €** (art. 70 §4 CTVA). Circulaire 2018/C/47. | [L1] art. 28 ; [L23] [L24] | **Absent.** L'OR enregistre réception, plaque, VIN, dates et se transforme en facture (B8), mais **aucun registre numéroté exportable** n'existe, et les motos **vendues** (entrée = reprise ou réception VN, sortie = livraison) n'y sont pas. |
| L17 | **TVA sur la marge (VO rachetés à des particuliers)** | Déjà vérifié le 03/11 : TVA = marge × 21/121 **par véhicule**, mention « Régime particulier – biens d'occasion », **TVA jamais affichée**, registre d'achats / ventes par véhicule. Prolongement : l'acompte sur une occasion en régime marge se facture **sans TVA apparente** ; la note de crédit sur une vente en marge suit le même régime. | prop. 03/11 [S20] ; [L25] | **Partiel** (mention imprimée, registre VO en M12 ; **calcul à la vente absent**, 3 à 5 j déjà chiffrés). |
| L18 | **Détaxe export (art. 39 CTVA)** | Déjà vérifié : TVA 0 % hors UE, facture avec mention, visa douane du voyageur, seuil 125 €. Prolongement : au comptoir, le **voyageur** paie TVA comprise et se fait rembourser après visa (ou via un opérateur de détaxe) ; la vente **directe** à 0 % suppose une expédition hors UE prouvée. | prop. 03/11 [S21] | **Fait** pour la facture à 0 % avec mention ; **pas de flux « remboursement après visa »** (bordereau, remboursement différé). |
| L19 | **Bons cadeaux (TVA)** | Transposition de la directive 2016/1065 (Code TVA, art. 1er §15-16, depuis 2019 ; circ. 2018/C/127) : un **bon à usage unique** (taux et lieu connus à l'émission) est taxé **à la vente du bon** ; un **bon à usage multiple** (p. ex. valable sur pièces à 21 % et sur une prestation future) est taxé **à l'utilisation**. Un bon cadeau de concession valable sur tout le magasin belge à 21 % est en pratique **à usage unique** : TVA et journal des recettes au jour de la vente du bon, ticket à l'utilisation sans TVA. Pas de durée de validité légale. | [L26] [L27] | **Absent** (confort, §3). |
| L20 | **Retours et échanges en magasin** | **Aucun droit de rétractation** pour un achat en magasin (14 jours seulement à distance) ; échange ou remboursement = politique commerciale, aux conditions affichées ; **garantie légale de 2 ans** (réparation / remplacement / remboursement) sur preuve d'achat. Fiscalement : remboursement = **remboursement inscrit au journal des recettes** (ticket) ou **note de crédit** (facture). | [L28] | **Partiel.** Avoir sur facture ; **pas de « retour » sur un ticket TIK** (pas d'avoir sans client, pas de remboursement en espèces tracé au Z comme « remboursement »). |
| L21 | **Livre de caisse et écarts** | Pas de texte unique ; le fisc attend que le **solde théorique de la caisse** (fond + recettes espèces − sorties) corresponde **à tout moment** au contenu physique, que chaque entrée / sortie soit **justifiée** (pièce), qu'un écart soit **constaté et motivé**, et qu'un jour fermé soit une recette nulle. Solde négatif = signal d'alarme au contrôle. | [L29] [L30] | **Fait** (fond d'ouverture, entrées / sorties motivées, comptage par coupure, écart théorique / compté, historique) ; **mais** rien n'empêche deux sessions ouvertes et le Z n'est pas figé (L6). |

### 1.2 Ce qu'il faut retenir pour la caisse

1. **Le seuil de 125 €** change la vie du comptoir : une pièce ou un accessoire **de la moto** vendu plus de 125 € TTC à un particulier doit faire l'objet d'une **facture** (client identifié), pas d'un ticket. Vêtements et casques restent au ticket. Le DMS doit le savoir par article (famille « pièce / accessoire véhicule » vs « équipement du pilote ») et basculer le ticket en facture au-delà du seuil.
2. **Le journal des recettes, c'est le Z** : si le DMS produit chaque soir un rapport Z **numéroté, figé, par société et par siège**, avec les totaux par taux, les remboursements, les lignes > 500 €, et que chaque vente comptoir remet un ticket (papier ou mail), le comptable n'a plus de journal à tenir à côté. Aujourd'hui le Z est un calcul à la volée.
3. **Deux registres à produire**, pas un : le **registre VO** (TVA marge, existant en M12) et le **registre des véhicules à moteur** (art. 28, absent), qui concerne **chaque moto qui entre à l'atelier ou en stock**.
4. **Espèces** : arrondi 5 c et plafond 3 000 € sont des règles de caisse, pas de compta ; elles se codent dans le panneau de règlement.
5. **Rien n'oblige à certifier le logiciel**, mais tout oblige à ne **rien effacer** : contre-passer, jamais supprimer.

---

## 2. Ce que font les logiciels du marché

Lu : pages fonctionnelles et documentation officielle de chaque éditeur (ou, à défaut, comparatifs
belges datés), le 03/11/2026. Quand une fonction n'est pas documentée, la case dit « non documenté » :
ce n'est pas « absent ». Les solutions sont groupées : caisses généralistes, terminaux « avec caisse »,
logiciels métier concession / garage, facturation.

| Solution | Fonctions de caisse mises en avant | Spécifique Belgique | Pertinence pour une concession | Source |
|---|---|---|---|---|
| **Shopify POS** (pour mémoire, 03/11) | Paniers enregistrés repris sur un autre appareil ; remises montant / % et promotions ; **paiements fractionnés** ; **acompte / layaway** ; retours et échanges (Pro) ; reçus papier, e-mail ou SMS au choix du client ; **suivi du tiroir** ; PIN, rôles, approbations, commissions (Pro) ; cartes cadeaux ; écran client (kit POS Terminal) ; inventaire multi-emplacements ; click & collect ; mode hors ligne (cartes plafonnées, à ses risques). | **Pas de Bancontact en magasin** ; numérotation de commandes, pas de factures TVA ; pas de journal des recettes belge (rapport sur mesure). | Accessoires seulement ; rien pour moto, OR, TVA marge, Peppol. | [M1] + prop. 03/11 |
| **Lightspeed Retail** (X-Series, siège belge à Gand) | Remises automatiques et manuelles ; **split payments** ; **« Deposits / Laybys »** ; retours, échanges, **store credit** (avoirs magasin) ; reçus e-mail / SMS / imprimés ; rapports par produit, employé, magasin, paiement, export ; profils clients, groupes ; fidélité à paliers ; cartes cadeaux (en ligne, magasin « à venir ») ; points de vente et caisses illimités ; **mode hors ligne** ; **commandes spéciales** et **ordres de service** (réparations) ; devis depuis le POS ; facturation via tiers. | Bancontact et Payconiq via Lightspeed Payments ; Peppol via Billit ou Recommand (intégrations) ; pas de journal des recettes documenté. | La plus proche d'un comptoir de concession (special orders, work orders, laybys) ; pas de VIN, pas de TVA marge, pas de registre. ≈ 89 €/mois + paiements. | [M2] [M3] |
| **Odoo POS** (éditeur belge) | Commandes en parallèle ; remises % produit / commande, listes de prix ; **paiement en plusieurs fois et plusieurs modes** ; contrôle du tiroir et ajustements ; **session de caisse** avec vérification du fond à la fermeture (même hors ligne) ; historique, ventes par mode ; clients B2B avec n° TVA et **facture depuis la caisse** ; fidélité (points, eWallet), **bons cadeaux** ; multi-caissiers, multi-points de vente ; **mode hors ligne** ; terminaux externes (Worldline, Adyen, Stripe, Viva…). | Localisation belge complète : **arrondi de caisse 0,05**, Peppol intégré, déclaration TVA Intervat, import CODA, **caisse certifiée GKS avec boîte noire** (horeca). Pas d'acompte en caisse documenté. | Caisse la plus « belge » du marché ; la jointure article ↔ véhicule (VIN, ORO, marge par VIN) resterait à construire — c'est le cœur du DMS. | [M4] [M5] |
| **Hiboutik** (FR, version BE) | Vente par code-barres ou recherche ; remises % / valeur, prix spéciaux ; **plusieurs règlements par vente avec rendu de monnaie**, paiement sur **compte client** et **paiements différés** ; **retours, échanges, avoirs** ; tickets imprimés, notes et factures par e-mail ; **Z de caisse journalier, Z mensuel, exports comptables** ; statistiques (marges, taxes, par heure, fournisseur, client) ; historique client, groupes ; **fidélité par points** ; **cartes cadeaux** ; multi-points de vente, transferts de stock ; **suivi du fond de caisse, retraits / dépôts, historique des actions sur la caisse** ; factures et devis. | Support BE ; TPE Ingenico intégré (Bancontact non confirmé) ; pas de Peppol. | Bonne référence pour la liste « attendu » (Z, avoirs, compte client, fond de caisse) ; pas métier. Gratuit / Premium. | [M6] [M7] |
| **Tactill** (FR, iPad) | Encaissement iPad / iPhone, catalogue et stock, tableau de bord temps réel, paiement intégré, équipes et droits, **échanges avec le comptable**, remboursements, entrées / sorties d'espèces, journal de caisse, rapports quotidiens par e-mail, mode hors ligne partiel. | « Caisse certifiée 2018 » = **NF525 française**, sans objet en Belgique ; pas de page belge. | Trop simple (pas de compte client, pas d'acompte documenté). | [M8] [M9] |
| **SumUp POS** (terminaux + caisse gratuite) | Catalogue, stock, employés, reçus, remboursements, rapports ; terminal avec imprimante intégrée (SumUp Terminal). | **Bancontact sur tous les terminaux** ; 1,69 % ; caisse gratuite **non certifiée SCE** (sans objet hors horeca). | Terminal possible ; caisse insuffisante. | [M10] |
| **Zettle by PayPal** | Caisse + lecteur ; reçus e-mail, remboursements, rapports. | **Non disponible en Belgique** (12 pays, BE absent). | Hors sujet. | [M11] |
| **Mollie** (terminaux) | Tap Terminal (reçu par QR / e-mail), PAX A920Pro mobile avec imprimante, PAX A35 fixe ; **Tap to Pay** iPhone / Android ; intégration aux caisses tierces (API, activation par QR) ; 1,20 % cartes domestiques (0 €/mois) ou 0,10 € + 0,85 % (20 €/mois). | Éditeur néerlandais très présent en BE ; **Bancontact en magasin non confirmé sur la page produit** (confirmé en ligne seulement). | Candidat sérieux pour **relier le terminal au DMS par API** ; vérifier Bancontact en personne. | [M12] |
| **Stripe Terminal** | Lecteurs WisePad 3, Reader S700 / S710, Tap to Pay ; SDK pour intégrer le paiement dans sa propre caisse ; mode hors ligne. | **Disponible en Belgique** ; cartes Visa / Mastercard / Maestro / Amex ; **Bancontact n'est pas listé comme moyen en personne** (seules girocard DE, CB FR, eftpos AU, Interac CA ont un traitement local). | Intégrable au DMS (déjà Stripe pour le site), mais **sans Bancontact natif** : une carte Bancontact passe en Maestro / Debit Mastercard co-badgé, non garanti. | [M13] |
| **Square** | Caisse complète (US / UK / FR / ES / IE…). | **Non disponible en Belgique** (liste officielle : US, CA, AU, JP, UK, IE, FR, ES). | Hors sujet. | [M14] |
| **Clover (Fiserv)** | Terminaux-caisse Flex / Mini / Station. | **Aucune offre belge trouvée** (pages US / CA). | Hors sujet. | [M15] |
| **ASPOS (Valk Solutions, ex-Countr)** | Scan, PLU, changement d'utilisateur / ticket ; promotions liées à la carte client ; **paiements mixtes** (espèces, PIN, crédit, carte cadeau, bon) ; **retour par scan du ticket d'origine**, retours web en magasin ; ticket imprimé ou **par e-mail**, ticket modifiable ; **clôture journalière automatique** ; **commandes clients avec acomptes** ; fidélité, cartes cadeaux ; base centrale multi-magasins, stock des autres magasins ; **mode hors ligne** ; **écran client** ; PIN certifié. | Néerlandais, pays non précisés. | Référence « chaîne de magasins » : acompte, retour par ticket, écran client. | [M16] |
| **G8 / Orisha Retail Shops** (ancien DMS du client) | Atelier (RDV, états des lieux, OR photos, GMobile), stock par scan, réceptions, **interfaces fournisseurs et centrales**, panier et CRM, signature électronique terrain, reprises et dépôts-ventes (témoignage), tableaux de bord multi-magasins, e-commerce ShopG8, e-facturation « accompagnée ». Détail de la caisse : voir `docs/g8-fonctions-m6-ventes-pos.md` (Express, règlements multiples, acomptes, cessions, journal de caisse, calcul monnaie, remises en banque). | Site FR / NL, Benelux cité ; pas de page belge spécifique (G8 est mono-société France). | **C'est la référence du client** : tout ce que G8 faisait au comptoir est dans la liste §3. | [M17] + docs G8 |
| **Karbill** (BE, garages auto) | Devis, factures, **acomptes**, garanties, suivi des paiements et relances, OR, agenda, historique véhicule, pièces et stock, **Peppol intégré sans frais** ; 0 → 99 €/mois ; FR / NL. Publie des guides sur le **registre de garage** et la **TVA marge** automobile. | Belge, Peppol, registre et TVA marge documentés dans ses guides (fonctions non confirmées sur la page produit). | Montre ce qu'un garage belge attend : acompte facturé, Peppol, registre. Pas de caisse comptoir. | [M18] [L23] |
| **Everlog Dealer Business** (FR, moto) | DMS multi-sites (atelier, commerce, compta, magasin), BI temps réel, CRM, eDMS, intégrations constructeurs (Harley-Davidson homologué ; Suzuki, Honda, **Ducati**, BMW cités), interface Sage. | Français. | DMS concurrent « de référence » côté constructeurs ; caisse non détaillée publiquement. | [M19] |
| **Autoflex10** (NL, garages / dealers) | Ordres de travail → devis / facture, planning lié aux OR, **facture par e-mail avec lien de paiement (iDEAL)**, > 100 intégrations (Exact, Twinfield, paiements PIN), cloud. | Néerlandais ; iDEAL, pas Bancontact. | L'idée « facture + lien de paiement » (= notre QR / lien Stripe). | [M20] |
| **Keyloop / Incadea / Pinewood** (DMS auto) | Ventes, service, pièces, compta dans une même plateforme ; un seul dossier client ; Keyloop ≈ 200 partenaires API, Pinewood fermé. | Présents en BE via les réseaux auto ; caisse non documentée publiquement. | Hors d'échelle pour une concession moto. | [M21] |
| **Falco / Billit / Teamleader / Yuki / Exact** (facturation) | Factures, devis, rappels, **Peppol** envoi / réception, lien comptable ; aucune fonction de caisse ni de ticket B2C. | Tous points d'accès Peppol belges ; Billit : intégration Lightspeed POS. | Confirme le rôle de Falco : **recevoir l'UBL du DMS**, pas remplacer la caisse. | [M22] + prop. 03/11 |

### 2.1 Ce que tout le marché fait (le « socle attendu »)

Les six caisses généralistes lues (Shopify, Lightspeed, Odoo, Hiboutik, ASPOS, SumUp) ont **toutes** :
vente par scan, remise ligne et globale, **plusieurs modes sur une vente**, rendu de monnaie, reçu
**imprimé ou par e-mail**, **remboursement / retour** depuis le ticket d'origine, **session de caisse
avec fond, entrées / sorties et clôture**, rapports du jour par mode et par taux, fiche client avec
historique, droits par employé. Cinq sur six ont **acompte / layaway**, **cartes cadeaux**, **mode hors
ligne**, **multi-caisses**. Trois ont l'**écran client** et le **store credit** (avoir magasin).

### 2.2 Ce qu'aucune caisse du marché ne fait

Acompte **sur une moto commandée** reporté sur la facture avec alerte pièces ; pièces **facturées sur
un OR** ; **TVA marge par VIN** avec registre ; **dépôt-vente** (reversement + commission) ; **cession
interne** typée ; **registre des véhicules à moteur** ; facture **par société** (ITALBIKE / NL INVEST) ;
UBL vers Falco. C'est exactement ce que le DMS porte déjà ou doit porter.

---

## 3. Liste de contrôle : ce que notre caisse doit faire

État : **fait / partiel / absent** d'après la bible (M06, M12, M09, M07) et le code (`src/modules/sales/`,
`src/routes/_app.pos.tsx`, `supabase/migrations/20260610270000_m6_cash.sql`). Estimation en jours
agence si absent ou partiel (hors validation client et compta). Les lignes **L** renvoient au §1.

### 3.1 LÉGAL (obligatoire)

| # | Ce que la caisse doit faire | Source | État | Jours |
|---|---|---|---|---|
| C1 | **Basculer ticket → facture** quand la loi l'impose : tout véhicule ; pièce / accessoire / travaux **moto > 125 € TTC** pour un particulier ; tout client pro. Nécessite un **drapeau par famille d'article** « pièce ou accessoire du véhicule » et un **client minimal** (nom, adresse) saisi au comptoir. | L1 | Partiel (TIK / FAC existent, pas de règle) | 1,5 |
| C2 | **Arrondi à 5 c** de la part payée en espèces, affiché sur le ticket ; option « arrondi aussi sur carte » avec la mention légale. | L9 | Absent | 1 |
| C3 | **Plafond 3 000 € en espèces** : refus avec message, par document (acomptes cumulés compris). | L8 | Absent | 0,5 |
| C4 | **Journal des recettes = Z figé** : clôture de session → rapport Z **numéroté en continu** par société / siège, **immuable** (ligne `cash_z_reports` append-only), avec : identification de la caisse et de l'établissement, période, nombre de tickets, totaux par taux (HT / TVA / TTC) des **ventes sans facture**, réductions, **remboursements**, acomptes encaissés, entrées / sorties, encaissements par mode, **liste des lignes > 500 € TTC** avec nature du bien ; PDF archivé en GED + export CSV ; vue « journal » mensuelle pour le comptable. | L6, L21 | Partiel (`cash_z_report` à la volée) | 3 |
| C5 | **Rattacher chaque ticket et chaque règlement comptoir à la session de caisse** (poste, opérateur) ; **une seule session ouverte** par caisse (contrainte en base) ; identifiant de caisse sur le ticket. | L6 | Partiel (session non liée, double ouverture possible) | 2 |
| C6 | **Ticket conforme** : date, **n° d'ordre** (TIK-…), identification caisse + établissement, lignes TVAC, remises, remboursements, total, montant arrondi, moyen(s) de paiement, n° TVA société ; **ticket par e-mail sans client** (adresse saisie à la volée) ; **format 80 mm** pour imprimante thermique. | L6, L12 | Partiel (A4 HTML ; mail seulement avec client) | 2 |
| C7 | **Facture d'acompte** : à l'encaissement d'un acompte sur un document avec client (RES / BC / DEV accepté), émettre **FAC d'acompte** numérotée (série FAC ou série propre `FAA-`), PDF, UBL si B2B, **déduite** sur la facture finale avec référence (« Acompte facturé n° … du … »). Régime marge : sans TVA apparente. | L4, L2 | Absent | 2,5 |
| C8 | **Avoir** : imprimer la **référence de la facture d'origine** et la mention **« TVA à reverser à l'État dans la mesure où elle a été initialement déduite »** ; **remboursement d'un ticket** (avoir sans client ou « remboursement » TIK négatif) inscrit au Z en « remboursements ». | L5, L20 | Partiel | 1,5 |
| C9 | **Jamais supprimer un règlement** : remplacer `deletePayment` par un **règlement négatif** motivé (et verrou si la session est clôturée ou la période transférée) ; même chose pour la purge des devis **validés** (garder, marquer). | L14 | Partiel | 1 |
| C10 | **Registre des véhicules à moteur** (art. 28) : table `vehicle_register` par société / siège : n° d'ordre, date d'entrée, plaque ou VIN, n° TVA UE donneur d'ordre, code de nature (réparation, entretien, vente VN, vente VO, reprise, dépôt, essai…), date de sortie, référence facture ou motif ; **alimentée automatiquement** par l'OR (entrée = réception, sortie = restitution, facture = facture de l'OR), par la réception VN, la reprise (M7) et la vente de moto ; **alerte** « véhicule sorti il y a > 1 mois sans facture » ; export PDF / CSV ; exclusion cyclomoteurs A / B. | L16 | Absent | 3 |
| C11 | **Délai de facturation** : alerte « BL / OR terminé non facturé avant le 15 du mois suivant ». | L3 | Absent | 0,5 |
| C12 | **Conservation 10 ans** : export annuel figé (factures, tickets, Z, registres) en GED + procédure écrite. | L13 | Partiel | 0,5 |
| C13 | **Peppol** : connecteur Falco (déjà chiffré 03/11). | L15 | Partiel | 4 à 6 (déjà prévu) |
| C14 | **TVA marge à la vente** (déjà chiffré 03/11). | L17 | Partiel | 3 à 5 (déjà prévu) |
| C15 | **Moyen de paiement électronique opérationnel** : terminal Bancontact (P-2). Deux voies : **(a) terminal indépendant** (Worldline / CCV / banque) + saisie du mode dans le DMS : 0,5 j ; **(b) terminal relié** (Mollie ou Stripe Terminal SDK : montant poussé, résultat rapatrié, règlement créé automatiquement) : 3 à 5 j, sous réserve Bancontact en personne. | L10 | Partiel | 0,5 ou 3 à 5 |

**Total légal hors lots déjà chiffrés : ≈ 13 à 14 jours** (C1 à C12, avec C15a).

### 3.2 ATTENDU (toute caisse du marché le fait)

| # | Fonction | État | Jours |
|---|---|---|---|
| A1 | Scan code-barres, recherche, ajout au panier, quantité, suppression | Fait | – |
| A2 | **Remise par ligne et remise globale au comptoir** (le POS crée le TIK avec `discount_pct: 0`) | Partiel (fait dans l'éditeur, pas au POS) | 0,5 |
| A3 | Multi-paiement, partiel, rendu de monnaie, différé « à échéance » | Fait | – |
| A4 | Client sur la vente comptoir (historique, tarif client, encours) et **création rapide** d'un client | Partiel (éditeur oui, POS non) | 1 |
| A5 | **Mettre un panier en attente / reprendre** (plusieurs clients au comptoir) | Absent | 1 |
| A6 | Retour / échange depuis le ticket d'origine (scan du n° TIK) | Absent (voir C8) | 1 |
| A7 | Ticket par e-mail, impression 80 mm, réimpression **duplicata** marqué | Partiel (voir C6) | 0,5 |
| A8 | **Tiroir-caisse** : ouverture par l'imprimante (ESC/POS `pulse`) et « ouvrir le tiroir » tracé | Absent | 1 |
| A9 | Session de caisse : fond, entrées / sorties, comptage, écart, Z | Fait | – |
| A10 | **Multi-poste** : plusieurs caisses par société (poste = session), opérateur par vente | Partiel (une session par société) | voir C5 |
| A11 | Rapports du jour : par mode, par taux, **par opérateur, par famille**, marge du jour (G8 « ventes du jour », 12 colonnes) | Partiel (mode, taux) | 2 |
| A12 | **Remise en banque** : bordereau daté espèces / chèques (G8 p.180), report du fond | Absent | 2 |
| A13 | Écran client (QR, montant, merci) | Fait | – |
| A14 | Droits par rôle (qui peut remiser, annuler, ouvrir le tiroir, clôturer) | Partiel (rôles M0, pas de granularité caisse) | 1 |
| A15 | **Mode hors ligne** | Absent (application web) | 5 à 8 (déconseillé, voir D8) |
| A16 | Commandes spéciales (article non en stock → commande fournisseur) | Fait (commander les pièces depuis le document) | – |

### 3.3 UTILE POUR UNE CONCESSION

| # | Fonction | État | Jours |
|---|---|---|---|
| U1 | **Acompte moto** : RES / BC avec acompte, reporté, alerte pièces à commander, **acompte minimum** bloquant (VEN009) | Partiel (règle minimum absente) | 0,5 + C7 |
| U2 | **Pièces sur OR** → facture de l'OR, garantie à 0 € | Fait | – |
| U3 | **TVA marge** à la vente + registre VO | Partiel | C14 |
| U4 | **Dépôt-vente** : vente, reversement au déposant, commission facturée | Partiel (M7 🔴, `/consignment` sans menu) | 2 à 3 |
| U5 | **Cession interne** typée (geste commercial, garantie, démo, atelier) à prix 0, tracée, valorisée | Partiel (ligne garantie à 0 sur l'OR ; pas de document de cession) | 2 |
| U6 | **Détaxe** : facture 0 % + flux « remboursement après visa douane » | Partiel | 1 |
| U7 | **Client pro à échéance**, encours, relances | Fait (relances inactives faute de Resend) | – |
| U8 | **Retour au comptoir d'un achat web** : avoir DMS + remboursement Shopify déclenché par le DMS | Partiel (décision à prendre, D6) | 1 à 2 |
| U9 | **Regroupement de BL** en une facture mensuelle (client pro) | Absent (G8 p.135) | 1,5 |
| U10 | **Numéro de série / VIN sur une ligne de vente** (types V / O / P) depuis le POS | Partiel (éditeur oui, POS non) | 1 |
| U11 | **Tarifs clients** (remise par famille / fournisseur / quantité, promotion visible en Express) | Partiel (classe de remise Ducati M-… ; pas de tarif par client) | 3 |
| U12 | Registre des véhicules (voir C10) | Absent | C10 |

### 3.4 CONFORT

| # | Fonction | État | Jours |
|---|---|---|---|
| F1 | **Bons cadeaux** : vente (usage unique, TVA à la vente), solde, utilisation en règlement, expiration, Z | Absent | 3 |
| F2 | **Fidélité** (points, avantages Ducati) | Absent | 4 à 6 |
| F3 | **Store credit** (avoir magasin utilisable en règlement, sans remboursement) | Absent | 1,5 (avec F1) |
| F4 | Promotions automatiques (2 + 1, période) | Absent | 2 |
| F5 | Statistiques quotidiennes par rayon / référence (G8 p.126) | Partiel (M13) | 1 |
| F6 | Impression d'étiquettes depuis la caisse | Fait (B12, M05) | – |

---

## 4. Décisions à prendre avec le client

| # | Question | Ce qu'on recommande | Conséquence |
|---|---|---|---|
| D1 | **Seuil de 125 € au comptoir** : quand une pièce ou un accessoire moto dépasse 125 € TTC pour un particulier, le vendeur doit-il **toujours** saisir un client (facture), ou acceptez-vous un ticket si le client refuse de s'identifier ? | Facture **imposée** par le DMS (nom + adresse suffisent ; eID plus tard) ; le vendeur peut forcer un ticket avec motif tracé. | C1 : règle par famille d'article à valider avec Domenico (quelles familles sont « pièces du véhicule »). |
| D2 | **Le Z du DMS devient le journal des recettes officiel** ? (ventes comptoir sans facture) | Oui, à faire valider par le comptable : Z numéroté, figé, PDF mensuel ; plus de journal papier. | C4, C5, C6. |
| D3 | **Terminal Bancontact : indépendant ou relié au DMS ?** | Commencer **indépendant** (Worldline / CCV via la banque, 25 à 35 €/mois, Bancontact garanti) ; relier plus tard via Mollie si le volume le justifie, après vérification de Bancontact en personne chez Mollie. Stripe Terminal : disponible en BE mais **sans Bancontact natif**, à éviter pour le comptoir. | C15 (0,5 j maintenant, 3 à 5 j plus tard). |
| D4 | **Facture d'acompte** : émise automatiquement à chaque acompte encaissé sur une moto ou un client pro ? Même série FAC ou série `FAA-` ? | Automatique, série propre `FAA-` (lisible pour le comptable), déduite sur la facture finale. **À confirmer avec le comptable.** | C7. |
| D5 | **Registre des véhicules à moteur** : le DMS le tient (alimenté par l'OR et les ventes) ou le comptable le tient ailleurs ? | Le DMS : toutes les données existent déjà (OR, réception, reprise, vente) ; export PDF / CSV. | C10 ; il faut la **liste des codes de nature d'opération** voulus. |
| D6 | **Retour d'un achat web au comptoir : qui rembourse ?** (déjà posée le 03/11) | Le vendeur fait l'avoir dans le DMS ; le DMS déclenche le remboursement Shopify. | U8, 1 à 2 j. |
| D7 | **Espèces** : arrondi aussi sur les paiements par carte (avec affichage légal) ou espèces seulement ? Plafond 3 000 € bloquant ou simple avertissement ? | Espèces seulement ; plafond **bloquant** (l'amende vise le commerçant). | C2, C3. |
| D8 | **Mode hors ligne** : faut-il que la caisse vende sans internet ? | Non : 4G de secours + carnet de tickets manuels numérotés à ressaisir ; un vrai mode hors ligne coûte 5 à 8 j et complique l'audit. | A15 écarté. |
| D9 | **Coin café / événements** : y a-t-il une vente de boissons ou de restauration **payante** ? | Si elle reste gratuite ou < 25 000 €/an, **aucune caisse certifiée** n'est nécessaire ; sinon, GKS obligatoire pour cette activité seulement. | L7. |
| D10 | **Bons cadeaux et fidélité** : voulus pour le go-live ? | Bons cadeaux oui si Domenico en vend déjà (3 j) ; fidélité après le go-live. | F1, F2. |
| D11 | **Matériel du comptoir** : imprimante thermique 80 mm (ESC/POS), tiroir, douchette, 2e écran : à acheter par le client. | Imprimante Epson / Star réseau ou USB, tiroir piloté par l'imprimante. | C6, A8. |

---

## 5. Sources (consultées le 03/11/2026)

### Légal (Belgique)

- [L1] Arrêté royal n° 1 du 29/12/1992 relatif aux mesures tendant à assurer le paiement de la TVA, texte consolidé au 31/12/2025 (modifications au 01/01/2026 et 10/01/2026 : art. 1er, 15, 28) — https://refli.be/en/lex/1992003823 ; Justel — https://www.ejustice.just.fgov.be/cgi_loi/change_lg_2.pl?language=fr&nm=1992003823&la=F
- [L2] Centre de contrôle de Namur, arrêtés royaux TVA (PDF, art. 1er : véhicules > 48 cm³ / 7,2 kW, pièces et travaux > 125 €) — https://www.ccnamur.be/Files/ar.pdf
- [L3] MyFid, « Factures TVA Belgique 2026 : mentions obligatoires et Peppol » — https://www.myfid.be/ressources/comptabilite/factures-tva/ ; Keyfico, « TVA : mentions obligatoires sur les factures » — http://www.keyfico.be/t-v-a-mentions-obligatoires-sur-les-factures/
- [L4] MyFid, « Facturer un acompte en Belgique : obligations et changements » (TVA exigible à l'encaissement, facture pour le 15 du mois suivant, e-facturation 2026) — https://www.myfid.be/ressources/comptabilite/facture-acompte/ ; Mafacturation, « Mentions obligatoires facture Belgique : cas particuliers » — https://mafacturation.be/fr/blog/mentions-obligatoires-facture-belgique-cas-particuliers
- [L5] Circulaire AGFisc n° 53/2013 (facture d'acompte : toutes les mentions sauf la date d'exigibilité) — https://infos-tva.avocats.be/sites/default/files/Circulaire%20TVA%20autofacturation%20n%2053-2013%20pdf_00308925.pdf ; Belgian VAT Desk, « Flash 93 : les nouvelles règles de facturation » — https://www.vatdesk.be/fr/flash-tva/facturation-tva-2/
- [L6] Amarris Direct, « Créditer ou corriger une facture ? » (mention « TVA à reverser à l'État… », AR n° 4 art. 4 §1) — https://amarris-direct.be/blog/comptabilite-et-factures/crediter-ou-corriger-facture/ ; Juristax, « Déduction Belgique » — https://juristax.eu/tva-be-belgique/deduction-belgique/
- [L7] Arrêté royal du 13/12/2022 modifiant l'AR n° 1 (tickets de caisse digitaux, caisse enregistreuse avec rapport financier assimilée au journal des recettes digital ; en vigueur 01/01/2023) — https://etaamb.openjustice.be/fr/arrete-royal-du-13-decembre-2022_n2022034588.html ; Moniteur belge 20/12/2022
- [L8] enFact, « Journal des recettes » — https://www.enfact.be/blog/journal-des-recettes ; Billy, « Tenir un livre de caisse ou de recettes en Belgique » — https://billy.tech/livre-caisse-recettes/ ; infos-tva.avocats.be, FAQ 2 obligations comptables TVA — https://infos-tva.avocats.be/faq_2_obligations_comptables
- [L9] SPF Finances, site officiel du Système de caisse enregistreuse, « Qui doit utiliser le SCE ? » (seuil 25 000 €, par établissement, exemple magasin de meubles avec cafétéria) — https://www.systemedecaisseenregistreuse.be/fr/klant/algemeen/qui-doit-utiliser-le-sce
- [L10] Monni, « Le système SCE 2.0 est obligatoire depuis le 1er juillet 2026 » — https://monni.be/fr/gks-2-0-systemes-de-caisse ; fiskaly, « GKS 2.0 et FDM en Belgique » — https://www.fiskaly.com/blog/gks-2-0-fdm-requirements-belgium
- [L11] SPF Économie, « Paiement cash, c'est maximum 3 000 euros ! » — https://news.economie.fgov.be/164290-paiement-cash-c-est-maximum-3-000-euros/ ; Jubel / Studio Legale, « Les paiements en espèces » (loi 18/09/2017, art. 66-67) — https://www.jubel.be/fr/les-paiements-en-especes/
- [L12] SPF Économie, « L'arrondi obligatoire souffle ses 4 bougies » — https://news.economie.fgov.be/232412-l-arrondi-obligatoire-souffle-ses-4-bougies/ ; bienarrondir.belgium.be — https://bienarrondir.belgium.be/
- [L13] ConsumerConnect (SPF Économie), « Arrondi des paiements en espèces » (règles, paiement mixte, mention pour la carte, CDE VI.7/1-VI.7/2) — https://consumerconnect.be/fr/themes/achat-produit-ou-service/modes-de-paiement/paiements-en-especes/arrondi
- [L14] Fiducial, « Obligation d'offrir le paiement électronique dans les commerces à partir du 1er juillet 2022 » — https://www.fiducial.be/news/obligation-d-offrir-le-paiement-electronique-dans-les-commerces-a-partir-du-1er-juillet-2022 ; Worldline, « À partir du 1er juillet, vous devrez accepter les paiements électroniques » — https://worldline.com/fr-be/home/main-navigation/resources/blogs/2022/right-to-pay-digital
- [L15] myPOS, « Que couvre l'obligation de paiement électronique en Belgique ? » (pas de supplément ni de minimum) — https://www.mypos.com/fr-be/blog/finances/que-couvre-lobligation-de-paiement-electronique-en-belgique
- [L16] Test-Achats, « Les commerçants sont obligés d'accepter le cash » — https://www.test-achats.be/argent/comptes-a-vue/news/les-commercants-doivent-accepter-les-paiements-en-cash ; Titeca, « Paiements en espèces : ce que vous devez savoir » (31/03/2024) — https://www.titeca.be/en/news-item/cash-payments-what-do-you-need-to-know/ ; ConsumerConnect, « Refus des paiements en espèces » — https://consumerconnect.be/fr/themes/achat-produit-ou-service/modes-de-paiement/paiements-en-especes/refus-des-paiements-en-especes
- [L17] RTBF, « Le ticket de caisse devient obligatoire en Allemagne dès 2020 : et chez nous ? » (SPF Économie : preuve d'achat sur demande, e-mail permis) — https://www.rtbf.be/article/le-ticket-de-caisse-devient-obligatoire-en-allemagne-des-2020-et-chez-nous-10396558 ; Test-Achats, « La fin du ticket de caisse » — https://www.test-achats.be/famille-prive/droits-des-consommateurs/news/ticket-de-caisse
- [L18] DroitBelge, « Depuis le 1er janvier 2023, les délais de conservation… » (10 ans) — https://www.droitbelge.be/news_detail.asp?id=1115 ; YouInv, « Durée de conservation des factures en Belgique » — https://youinv.com/en/blog/duree-conservation-factures-belgique ; Degand & Partners, « Conserver ses factures électroniques en 2025 » (CDE 7 ans vs fiscal 10 ans) — https://blog.degandpartners.com/fr/article/conserver-ses-factures-electroniques-en-2025-obligations-bonnes-pratiques-et-erreurs-a-eviter/27730
- [L19] BOFiP (France), obligation de logiciels de caisse sécurisés (NF525 : droit français uniquement) — https://bofip.impots.gouv.fr/bofip/10691-PGP.html
- [L20] Billy, « Contrôle fiscal en Belgique » (livres de caisse, registre, confrontation) — https://billy.tech/controle-fiscal-belgique/
- [L21] VATupdate, « Belgium confirms 2026 Peppol e-invoicing mandate with 2028 near real-time reporting » et briefing de juillet 2026 (B2C exclu) — https://www.vatupdate.com/2025/07/23/belgium-confirms-2026-peppol-e-invoicing-mandate-with-2028-near-real-time-reporting-to-follow/ ; https://www.vatupdate.com/2026/07/25/briefing-document-belgium-mandatory-b2b-e-invoicing/
- [L22] Commission européenne, « eInvoicing in Belgium » (pas de mandat B2C) — https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108877/eInvoicing+in+Belgium ; EU e-invoicing hub, Belgium updates 2026 — https://www.eu-einvoicing.com/belgium/updates/belgium-e-invoicing-news-updates-2026
- [L23] Karbill, « Registre de garage TVA Belgique 2025 : obligation légale » — https://www.karbill.be/blog/registre-garage-tva-belgique-obligation-legale-2025 ; Certifisc, « Registre garage Belgique » — https://www.certifisc.be/fr/posts/wat-is-het-garageregister
- [L24] Traxio, « TVA : comment tenir ou compléter le registre des garages ? » — https://www.traxio.be/fr/articles/tva-comment-tenir-ou-completer-le-registre-des-garages ; Billit, « Qu'est-ce qu'un registre de garage ? » — https://www.billit.eu/fr-be/resources/blog/qu-est-ce-qu-un-registre-de-garage-et-qui-doit-tenir-un-tel-registre/ ; circulaire 2018/C/47 du 19/04/2018 (SPF Finances)
- [L25] Karbill, « TVA sur la marge automobile en Belgique » (14/03/2026) — https://www.karbill.be/guide/tva-marge-automobile
- [L26] RSM Belgium, « Le régime TVA des bons » — https://www.rsm.global/belgium/sites/default/files/media/tax_insights_le_regime_tva_des_bons.pdf ; Jubel, « Les bons soumis à un nouveau régime de TVA à partir de 2019 » — https://www.jubel.be/fr/les-bons-soumis-a-un-nouveau-regime-de-t-v-a-a-partir-de-2019
- [L27] Forum for the Future, « Circulaire 2018/C/127 concernant le traitement des bons en matière de TVA » — https://blog.forumforthefuture.be/fr/article/circulaire-2018c127-concernant-le-traitement-des-bons-en-matiere-de-tva/4318
- [L28] Test-Achats, « Soldes Belgique 2026 : retour ou échange possible ? » — https://www.test-achats.be/famille-prive/soldes/dossier/soldes-et-droit-de-retour ; L'Avenir, « Peut-on retourner un article soldé ? » (01/07/2025) — https://www.lavenir.net/lifestyle/2025/07/01/peut-on-retourner-un-article-solde-ce-que-dit-la-loi-RJZ7NR55NZBEVGQ3CM4LII3WVQ/
- [L29] Accountable, « Qu'est-ce qu'un livre de recettes et un livre de caisse ? » — https://www.accountable.eu/fr-be/blog/livre-de-caisse-et-livre-de-recettes/
- [L30] Billit, « Livre de caisse ou journal des recettes ? » — https://www.billit.eu/fr-be/resources/blog/livre-de-caisse-ou-journal-des-recettes-difference-exemples-et-obligation/ ; Novadesko, « Livre de caisse en Belgique : qui est obligé ? » — https://novadesko.com/fr/blog/livre-de-caisse-obligatoire-belgique-horeca-commercants

### Marché

- [M1] Shopify, « POS features » — https://www.shopify.com/pos/features ; Help Center Bancontact et Shopify Payments Belgique : voir proposition du 03/11 [S5] [S6]
- [M2] Lightspeed, « Retail POS features » (split payments, deposits / laybys, store credit, special orders, work orders, offline) — https://www.lightspeedhq.com/pos/retail/features/
- [M3] Lightspeed Belgique, caisse retail (Bancontact) — https://fr.lightspeedhq.be/caisse/retail/boutique-de-vetements/ ; Billit, « Lier Billit à Lightspeed POS » — https://www.billit.eu/fr-be/articles-d-aide/integrations/lightspeed-pos-retail-restaurant/ ; Recommand, intégration Peppol Lightspeed — https://recommand.eu/fr-BE/integrations/lightspeed
- [M4] Odoo, « Point of Sale features » — https://www.odoo.com/app/point-of-sale-features
- [M5] Odoo, documentation 19.0, localisation fiscale Belgique (Peppol, arrondi 0,05, caisse certifiée, FDM, Intervat, CODA, import WinBooks) — https://www.odoo.com/documentation/19.0/fr/applications/finance/fiscal_localizations/belgium.html
- [M6] Hiboutik, « Fonctionnalités » — https://www.hiboutik.com/fr/fonctionnalites/ ; site belge — https://www.hiboutik.be/
- [M7] Guide-terminal-paiement.be, « Caisse enregistreuse et logiciel : prix et choix en Belgique 2026 » — https://www.guide-terminal-paiement.be/caisse-enregistreuse/logiciel-de-caisse-gratuit-payant/
- [M8] Tactill, site — https://www.tactill.com/ ; centre d'aide « La caisse iPad » — https://help.tactill.com/fr/articles/864648-la-caisse-ipad
- [M9] Outilios, « Avis Tactill (2026) » — https://outilios.fr/tactill-la-caisse-ipad-ultra-simple-plebiscitee-par-les-petits-commercants/ ; Independant.io, Tactill — https://independant.io/avis/tactill/
- [M10] Companeo, « SumUp caisse enregistreuse : avis, prix et alternatives » (Belgique) — https://www.companeo.be/fr_BE/points-de-vente/guide/sumup-caisse-avis-belgique-pro ; Guide-terminal-paiement.be, « Terminal SumUp » — https://www.guide-terminal-paiement.be/type-terminal-de-paiement/sumup-terminal/
- [M11] Wikipedia, Zettle (13 pays, Belgique absente) — https://en.wikipedia.org/wiki/Zettle ; Loyverse, pays Zettle — https://loyverse.com/izettle
- [M12] Mollie, « In-person payments » (Tap Terminal, PAX A920Pro, PAX A35, Tap to Pay, tarifs) — https://www.mollie.com/products/in-person-payments
- [M13] Stripe, documentation Terminal, « Global availability » (BE inclus ; moyens en personne par pays) — https://docs.stripe.com/terminal/payments/collect-card-payment/supported-card-brands ; « How Terminal works » — https://docs.stripe.com/terminal/overview
- [M14] Square, « Countries where Square is available » — https://squareup.com/help/us/en/article/5146-countries-where-square-is-available
- [M15] Clover (Fiserv) : pages US / CA seulement, aucune offre belge trouvée (recherche du 03/11/2026)
- [M16] Valk Solutions, « ASPOS POS » (ex-Countr) — https://www.valksolutions.nl/solutions-overview/aspos-management-suite/aspos-pos
- [M17] Orisha, « G8, logiciel pour concessions moto » — https://www.orisha.com/fr/commerce/activite/moto ; LeBonLogiciel, fiche Futurosoft G8 — https://lebonlogiciel.com/organisation-facturation-et-planification-gestion-commerciale-erp-gpao/futurosoft-g8/2049
- [M18] Karbill, site (fonctions, prix) — https://www.karbill.be/
- [M19] Everlog, « Moto : 2 logiciels de gestion pour votre concession » — https://www.everlog.com/secteurs/moto/
- [M20] Autoflex, « Werkplaatssoftware » et FAQ — https://www.autoflex.nl/garagesoftware/werkplaats/ ; https://www.autoflex.nl/faq/
- [M21] Keyloop, blog DMS — https://keyloop.com/blog/industry-insights/how-to-select-the-right-dealer-management-system-for-new-and-used-car-operations ; InPractise, « Pinewood DMS » — https://inpractise.com/articles/pinewood-dms-implementation-closed-suite-vs-partner-ecosystem
- [M22] Accountable, « Peppol en Belgique : quel logiciel de facturation choisir en 2026 ? » — https://www.accountable.eu/fr-be/blog/logiciel-peppol-facturation/ ; Falco : proposition du 03/11 [S22] à [S26]

Références internes : `CLAUDE.md` §2-3 (TVA marge, détaxe, types A-R, B2 B4 B7), `docs/g8-fonctions-m6-ventes-pos.md`,
`docs/g8-fonctions-m0-m12-m13-compta-stats-params.md`, `docs/bible/modules/M06-ventes-caisse.md`,
`M12-compta.md`, `M09-documents.md`, `M07-reprise-occasion.md`, `docs/propositions/2026-11-caisse-shopify-ou-dms.md`,
`src/modules/sales/` (`pos-sale.tsx`, `cash-api.ts`, `cash-screen.tsx`, `payment-panel.tsx`, `write-api.ts`,
`document-pdf.ts`), `src/routes/_app.pos.tsx`, `supabase/migrations/20260610270000_m6_cash.sql`.

### Incertitudes à lever avec le comptable

1. **Facture d'acompte** : les sources concordent sur l'exigibilité à l'encaissement ; elles divergent sur l'obligation d'une facture d'acompte vers un particulier hors véhicule (nous retenons : obligatoire dès qu'une facture est due, donc pour toute moto et tout client pro).
2. **Contenu exact du ticket et du Z** pour une caisse non horeca assimilée au journal des recettes : l'AR du 13/12/2022 mentionne « les 8 derniers caractères de la signature digitale », notion issue du GKS ; l'arrêté ministériel du 17/03/2023 fixe les modalités : à lire avant de figer le format du Z.
3. **Article 28 (registre des véhicules)** : version du 10/01/2026 lue sur un texte consolidé ; la circulaire 2018/C/47 reste la référence pratique (codes de nature d'opération).
4. **Bancontact en personne** chez Mollie : non confirmé sur la page produit ; chez Stripe Terminal : non listé.
5. **Seuil des lignes distinctes du journal des recettes** : 500 € TTC dans le texte consolidé (10/01/2026) ; les guides comptables citent encore 250 €.
