# Cahier des fonctionnalités v2 — Remplacement du DMS G8

**Client final :** Concession Ducati Bruxelles (entités ITALBIKE STORE + NL INVEST)
**Sources croisées :**
1. Documentations du système existant **G8 / Futurosoft** (modules Fichiers 138 p., Atelier 115 p., Stock 27 p.) → ce que le client utilise aujourd'hui.
2. **GAP Analysis** issue de la préanalyse Zenor Solutions (140 exigences, base Odoo) → ce que le client a exprimé comme besoin cible.

> **Lecture clé :** les deux corpus sont bien liés. Le GAP analysis EST l'expression de besoin pour remplacer G8 — il référence explicitement G8 (imports contacts CON005, articles INV014, véhicules VEH010). Le périmètre cible est plus large que G8 (CRM, e-commerce, marketing, VoIP, signature électronique) mais **moins profond sur certains points où G8 est riche** (voir section 4 — c'est là que se joue la différenciation).

---

## 1. Vue d'ensemble du besoin cible (GAP Analysis)

**Volumétrie :** 140 exigences — 103 standard (73,6 %), 34 développements (24,3 %), 3 à clarifier.
**Phasage client :** Phase 1 = 113 exigences (cœur métier), Phase 2 = 27 (web, marketing, VoIP).

| Domaine | # | Phase | Poids dev |
|---|---|---|---|
| Atelier (Réparation) | 24 | 1 | 7 dev |
| Ventes | 17 | 1 (+2 portails en Ph2) | 4 dev |
| Inventaire | 16 | 1 | 3 dev |
| CRM | 11 | 1 (+2 en Ph2) | 2 dev, 1 à clarifier (Salesforce) |
| Véhicules (Fleet) | 11 | 1 | 5 dev |
| Point de Vente | 10 | 1 | 0 dev |
| Site Web / E-commerce | 9 | 2 | 1 dev, 1 à clarifier |
| Marketing | 9 | 2 | 2 dev |
| Documents & Formulaires | 9 | 1 | 7 dev |
| Contacts | 8 | 1 | 2 dev |
| Comptabilité | 7 | 1 | 0 dev |
| Achats | 5 | 1 | 2 dev |
| Téléphonie (VoIP) | 4 | 2 | 1 à clarifier |

Le détail exhaustif des 140 exigences est en **Annexe A**. Les invariants métier hérités de G8 (règles de gestion à respecter quel que soit l'outil) sont en **Annexe B**.

---

## 2. Périmètre fonctionnel consolidé (besoin client, par domaine)

Synthèse de ce que le logiciel doit couvrir, en fusionnant l'exprimé (GAP) et l'implicite (usage G8 actuel).

### 2.1. Contacts & CRM
- Fiche client avec champs métier moto : date de naissance, carte d'identité, registre national, **permis moto** (n°, date, lieu) [CON002] — G8 gère déjà un onglet permis de conduire.
- Champs B2B : TVA intracom, conditions de paiement, IBAN/domiciliation, **limite de crédit** [CON003] — équivalent encours autorisé/actuel G8.
- Catégorisation clients : route, sport, off-road, VIP, standard, à surveiller, détaxé [CON004] — recouvre les drapeaux G8 (client douteux, détaxé, en compte).
- Saisie autonome en magasin via tablette/borne [CON001, CRM007].
- **Lien bidirectionnel client ↔ véhicule** [CON006] — équivalent du parc G8.
- Alerte automatique quand un véhicule correspondant aux intérêts du client arrive [CON007].
- Pipeline commercial structuré, leads automatiques (web/email/bornes), classification auto, pipelines distincts avec relances automatisées, rappels vendeurs [CRM001-006].
- Listes de prix différenciées VIP/standard [CRM009] — équivalent tarifs clients G8.
- Alias mail de routage [CRM010]. Synchronisation Salesforce **à clarifier** [CRM002]. Chatbot IA devis proforma [CRM008].

### 2.2. Ventes & Reprise
- Devis configuré moto + accessoires + image [VEN004], relances automatiques templatées [VEN001].
- **Signature électronique** [VEN003], acomptes et validation de commande conditionnée à acompte [VEN002, VEN009].
- **TVA sur marge pour les VO** [VEN006, COM006] — règle déjà portée par le type de gestion O dans G8 : TVA calculée uniquement sur la valeur ajoutée à la revente. Point de conformité critique.
- **Référencement automatique occasions/dépôt-vente avec préfixe** [VEN007] — décalque des types O/P/D et de la référence REP de G8.
- **Processus de reprise + dépôt-vente avec suivi des commissions** [VEN008] — chez G8 : reprise REP → création auto de l'article occasion + ORO pour imputer la remise en état au coût de revient. Cette mécanique de rentabilité par véhicule doit survivre à la migration.
- Fiches véhicule imprimables A6 pour affichage magasin [VEN005].
- Paiement QR code bancaire [VEN010], Stripe [VEN011].
- Tableau de bord commercial quotidien [VEN012], visibilité paiements pour vendeurs [VEN013], stockage documents de financement [VEN014], portails web financement et reprise avec upload (Ph2) [VEN015-016].

### 2.3. Point de Vente (comptoir)
- Encaissement multi-méthodes, terminal de paiement connecté, ticket numérique par email, QR paiement [PDV001-004].
- **Détaxe clients étrangers** [PDV005] — drapeau client détaxé G8.
- Remises ligne et pied de facture [PDV006].
- Fond de caisse ventilé par coupure, clôture quotidienne, remises en banque et arrondis [PDV007-009].

### 2.4. Véhicules (parc)
- **Fiche véhicule complète** : caractéristiques techniques, suivi commercial (prix, marge, statut), **historique des propriétaires successifs**, historique réparations/entretiens, gestion documentaire [VEH001-005] — c'est le parc G8 + le changement de propriétaire du planning atelier.
- **Rentabilité par véhicule** [VEH006] — dépend de l'imputation type ORO (achat + remise en état + frais vs prix de vente).
- États de gestion du parc [VEH007] — équivalents des recherches G8 : en stock (neuf/occasion/dépôt-vente/réservé/livré/dépôt agent), vendus, en réparation, en commande.
- **Alerte stock > 4 mois** [VEH008] — version automatisée de la logique invendus/dépréciation G8.
- Données de garantie et conformité par véhicule [VEH009]. Migration depuis G8 [VEH010].

### 2.5. Atelier & Réparation (domaine le plus lourd : 24 exigences)
- **RDV en ligne** avec collecte d'infos véhicule [ATE001], planning visuel avec capacité par mécanicien [ATE002], synchro Outlook bidirectionnelle [ATE003], chaîne RDV→Client→Véhicule→Intervention [ATE004].
- **Motos de courtoisie** [ATE005] — véhicules de prêt G8. Parc motos prêtées + démo [ATE022], planification des essais démo [ATE021] + contrat d'essai digital signé [DOC004].
- Rappels RDV email/SMS [ATE006] — paramètres SMS/Mail du planning G8.
- **Photos à la réception** [ATE007] + fiche de réception digitale [DOC003] — remplacent les « observations à la réception » papier de l'OR G8.
- **Signature client sur l'OR** avec envoi automatique [ATE008].
- **Devis complémentaire en cours d'intervention avec approbation client** [ATE009] — workflow devis ↔ OR de G8, en digital.
- Workflow atelier à états personnalisés + codes couleur [ATE010] — statuts RDV et catégories couleur G8.
- **Checklists par type de véhicule** [ATE011] et **nomenclatures d'entretien auto par modèle + kilométrage** [ATE014] — extension des nomenclatures/forfaits G8.
- Notes internes invisibles client [ATE012]. Kits/combos de pièces [ATE013] — forfaits G8.
- **Pointage temps par intervention** [ATE015] + **tableau de bord productivité par mécanicien** [ATE019] — chronos/pointeuse G8 (3 étapes : présence → fiche de travail → association temps passés/temps facturés). L'association temps passé vs temps facturé est l'indicateur de rendement que le client connaît : à conserver.
- **Garanties Ducati ou magasin** [ATE016] + **facturation interne pour coûts de garantie** [ATE020] + dossiers de garantie PDF avec photos [DOC002] — équivalents OR garantie + cessions garantie G8 (acceptation/refus total/partiel).
- Recherche par **VIN** avec historique complet [ATE017].
- Notification fin de travaux programmable [ATE018]. Accès mécaniciens aux accessoires en stock pour upselling [ATE023].

### 2.6. Inventaire & Pièces
- Réception par **scan code-barres** [INV001].
- **Traçabilité pièces ↔ client/OR** [INV002] + alerte atelier à réception de pièces liées à un OR [INV004] + notification client à réception complète [INV003] — version aboutie des « propositions de commande » depuis l'OR G8.
- **Réapprovisionnement auto min/max** [INV005] — stock mini/maxi de la fiche article G8 + édition ruptures.
- **Multi-emplacements (casiers, étagères)** [INV006] — codes casier G8 (12 car., affichage en facturation).
- **Étiquettes personnalisées** [INV007] — G8 a un module d'étiquetage très complet (cf. Annexe B) ; valider avec le client le niveau attendu.
- Routage automatique des réceptions [INV008], **arrondis au conditionnement fournisseur** [INV009] — cond. achat G8.
- **Stock unifié magasin + e-shop** [INV010].
- **Inventaire physique annuel** [INV011] — attention : G8 offre 8 méthodes d'inventaire, arrêté + réintégration, comptage, écarts, inventaire tournant. Le GAP réduit ça à une ligne « standard ». Creuser le mode opératoire réel du client (magasin ouvert ou fermé ?) avant de trancher.
- **Références remplacées et équivalences** [INV012] — fonctions natives G8 (équivalences + remplacement de références).
- **Import/MAJ auto des tarifs Ducati avec règles métier** [INV013] + migration articles G8 + catalogues Ducati [INV014] — équivalent industrialisé de la « librairie » G8 + recalcul PA/PV + arrondis.
- Listes de préparation commandes clients et préparation VN [INV015].

### 2.7. Achats
- **Commandes Ducati standard et urgentes avec export au format DCS** (template Excel imposé) [ACH001] — intégration constructeur, spécifique et incontournable.
- Processus de commande par fournisseur [ACH002], import/maintien des tarifs fournisseurs [ACH003].
- **Réception des motos neuves avec création automatique de la fiche véhicule** [ACH004].

### 2.8. Comptabilité
- Rapprochement/consolidation des paiements [COM001], OCR factures [COM002], relances impayés [COM003], tableaux de bord [COM004].
- **Multi-société : ITALBIKE STORE + NL INVEST** [COM005] — structurant pour l'architecture (deux entités juridiques, flux croisés probables).
- **TVA sur marge VO** [COM006].

### 2.9. Documents & Formulaires (7 dev sur 9 — quasi tout en spécifique)
- Demande de **COC** générable en PDF [DOC001], dossiers de garantie PDF avec photos [DOC002], fiche de réception digitale [DOC003], **contrat d'essai signé électroniquement** [DOC004], fiche de reprise digitale [DOC005], **attestation de bridage/débridage** [DOC006] (obligation A2 — spécifique moto), GED financement [DOC007], alias mail d'archivage [DOC008].

### 2.10. Phase 2 — Web, Marketing, Téléphonie
- **Site & e-commerce** : charte Ducati, e-shop stock synchronisé, formulaires personnalisés (contact, atelier, commercial, financement, reprise) branchés sur les workflows, pages équipe/événements/galerie, analytics [SIW001-008 ; import catalogues tiers à clarifier].
- **Marketing** : campagnes email + analytics d'intérêt, publication multicanal et réseaux sociaux, **publication auto des occasions sur plateformes externes** (type 2ememain/AutoScout) [MKT006], WhatsApp, chatbot IA [MKT001-008].
- **VoIP** : téléphonie intégrée, journal d'appels manqués partagé, transcription des messages vocaux à clarifier [TEL001-003].

---

## 3. Exigences de migration (explicites dans le GAP)

1. **Contacts** : export propre depuis G8 + mapping des champs [CON005].
2. **Articles** : migration G8 + intégration catalogues Ducati [INV014] — penser aux types de gestion, équivalences, codes casier, PAMP, stock mini/maxi.
3. **Véhicules** : migration du parc G8 vers la gestion de flotte cible [VEH010] — avec historique propriétaires et réparations si possible.
4. Non listés dans le GAP mais à arbitrer : historique des OR clôturés, historique des mouvements de stock, encours/soldes clients, documents en cours (OR ouverts, devis, commandes) au moment de la bascule.

---

## 4. Lecture critique — les angles morts du GAP par rapport à l'usage G8

C'est ici que tu peux te différencier (ou sécuriser le projet). Fonctions présentes dans G8, absentes ou sous-spécifiées dans le GAP — à valider avec le client : « vous en servez-vous ? »

| Fonction G8 | Statut dans le GAP | Risque si ignoré |
|---|---|---|
| **Cessions internes typées** (cadeau, cession VN, fournitures atelier) | Partiellement couvert via ATE020 (facturation interne) | Perte de traçabilité des sorties non facturables ; marges faussées |
| **ORO / imputation remise en état au coût de revient occasion** | Implicite dans VEN008 + VEH006, jamais décrit comme mécanisme | La « rentabilité par véhicule » promise ne fonctionnera pas sans ce flux |
| **Arrêté d'inventaire + 8 méthodes + réintégration** | Réduit à INV011 « inventaire annuel standard » | Si le client inventorie magasin ouvert, le standard peut ne pas suffire |
| **Dépréciation de stock par taux/période (PAMP)** | Absent (seule l'alerte 4 mois VEH008 pour les véhicules) | Besoin comptable de fin d'exercice non couvert |
| **Inventaire tournant avec taux d'écart** | Absent | Pratique éventuelle du magasinier perdue |
| **Étiquetage avancé** (file d'attente par poste, édition différée, formats A4, par groupe) | INV007 = « étiquettes personnalisées » en dev | Sous-estimation possible du besoin réel comptoir |
| **Fabrication / démontage de produits finis** | Absent | Si le client prépare des motos « montées » (pack accessoires), flux manquant |
| **Modification en cascade + recalcul PA/PV + arrondis paramétrés** | Partiellement via INV013 (tarifs Ducati) | Gestion tarifaire de masse hors Ducati (accessoires, équipement) non outillée |
| **OR accident / cabinets d'assurance et d'expertise** | Absent | Si l'atelier traite des sinistres, workflow complet manquant |
| **Historique exhaustif des mouvements de stock** (qui/quoi/quand/méthode) | Non explicité | Exigence d'audit implicite chez un concessionnaire |

Inversement, le GAP demande beaucoup de choses que G8 n'a pas : CRM/pipeline, signature électronique, photos, e-commerce, multi-société, paiements modernes, marketing automation, VoIP, documents digitaux. C'est la valeur perçue de la migration — le risque n°2 du concurrent le dit lui-même : « il n'est pas possible de recréer exactement le produit existant ».

---

## 5. Contexte concurrentiel (pour mémoire)

- Offre en présence : intégrateur Odoo (Odoo.sh), périmètre 140 items, **16 semaines** d'implémentation en 2 phases, charge annoncée 10 j chef de projet + 15 j analyste + 42 j développeur (~67 j/h), récurrent ~1 733 €/an HTVA (2 licences + hébergement) hors maintenance au code custom (16 €/100 lignes).
- Risques admis par le concurrent : disponibilité du client, impossibilité de recréer G8 à l'identique, interdépendances, dispersion des sujets.
- Implication pour ton positionnement : la bataille ne se gagne pas sur la liste des 140 items (73 % de standard) mais sur (a) les 34 développements métier moto, (b) les angles morts de la section 4, (c) la qualité de la migration G8, (d) le coût total récurrent.

---

## 6. Priorisation consolidée (proposition)

| Priorité | Contenu |
|---|---|
| **Must (Ph1 cœur)** | Contacts+champs moto, véhicules/parc avec historique, OR digital complet (photos, signature, devis complémentaire, états), pointage temps, pièces/stock (casiers, min/max, scan, traçabilité OR), reprise/occasion + TVA marge, POS, compta multi-société, migration G8 |
| **Should (Ph1)** | Garanties + facturation interne, checklists/nomenclatures entretien, export DCS Ducati, import tarifs Ducati, documents digitaux (réception, essai, reprise, bridage, COC), courtoisie/démo, CRM pipeline+relances |
| **Could (Ph2)** | Site + e-commerce stock synchro, formulaires web, marketing, publication occasions multi-plateformes, WhatsApp, VoIP, bornes showroom, chatbot |
| **À clarifier avant chiffrage** | Salesforce (CRM002), import catalogues tiers e-shop (SIW008), transcription vocale (TEL003), mode opératoire d'inventaire réel, usage des fonctions G8 listées en section 4 |
## Annexe A — Référentiel complet des 140 exigences (GAP Analysis)

Légende type : **S** = couvert en standard par l'outil cible, **D** = développement spécifique, **?** = à clarifier.

### Contacts (8 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| CON000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| CON001 | 1 | S | Saisie autonome des coordonnées client en magasin via tablette/borne |
| CON002 | 1 | D | Ajout de champs métier spécifiques sur la fiche client : date de naissance, n° carte d'identité, registre national, permis moto (numéro, date, lieu) |
| CON003 | 1 | S | Configuration des champs B2B : TVA intracommunautaire, conditions de paiement, domiciliation, limite de crédit |
| CON004 | 1 | S | Catégoriser les clients par type d'intérêt moto et statut commercial |
| CON005 | 1 | S | Import de la base de données clients existante depuis le système G8 |
| CON006 | 1 | S | Lien bidirectionnel entre fiches clients et véhicules |
| CON007 | 2 | D | Système d'alerte client automatique lorsqu'un véhicule correspondant aux critères d'intérêt est disponible |

### CRM (11 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| CRM000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| CRM001 | 1 | S | Pipeline de vente structuré avec suivi des prospects du premier contact à la clôture |
| CRM002 | 1 | ? | Synchronisation bidirectionnelle avec Salesforce |
| CRM003 | 1 | S | Création automatique de leads depuis les formulaires web, bornes et emails |
| CRM004 | 1 | S | Classification automatique des leads par type de demande et modèle d'intérêt |
| CRM005 | 1 | S | Configuration de pipelines CRM distincts avec relances automatisées |
| CRM006 | 1 | S | Workflow automatisé de relance client et rappels vendeurs |
| CRM007 | 2 | D | Bornes tactiles en showroom pour encodage client et configuration moto |
| CRM008 | 2 | D | Chatbot/IA vérifiant le stock et générant automatiquement des devis proforma |
| CRM009 | 1 | S | Listes de prix différenciées VIP vs standard |
| CRM010 | 1 | S | Configuration des alias mail pour routage automatique vers les bons services |

### Ventes (17 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| VEN000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| VEN001 | 1 | S | Emails de rappel automatiques avec templates personnalisés pour relance devis |
| VEN002 | 1 | S | Gestion des acomptes et conditions de paiement sur les devis/commandes |
| VEN003 | 1 | S | Signature électronique des devis/commandes par le client |
| VEN004 | 1 | S | Devis configuré avec véhicule + accessoires + image du véhicule |
| VEN005 | 1 | D | Génération de fiches véhicule imprimables en A6 pour affichage magasin |
| VEN006 | 1 | S | Gestion de la TVA sur marge bénéficiaire pour les véhicules d'occasion |
| VEN007 | 1 | S | Référencement automatique des motos occasion et dépôt-vente avec préfixe |
| VEN008 | 1 | D | Processus de reprise moto client et dépôt-vente avec suivi des commissions |
| VEN009 | 1 | S | Validation de commande moto conditionnée à un acompte |
| VEN010 | 1 | S | Paiement par QR code bancaire |
| VEN011 | 1 | S | Intégration Stripe pour paiements en ligne |
| VEN012 | 1 | S | Tableau de bord des activités commerciales quotidiennes |
| VEN013 | 1 | S | Visibilité des paiements clients pour les vendeurs |
| VEN014 | 1 | S | Stockage des documents de financement dans la fiche client |
| VEN015 | 2 | D | Portail web de dépôt de documents pour les demandes de financement client |
| VEN016 | 2 | D | Portail web de demande de reprise moto avec upload photos et documents |

### Point de Vente (10 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| PDV000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| PDV001 | 1 | S | Encaissement multi-méthodes au comptoir |
| PDV002 | 1 | S | Connexion terminal de paiement au POS |
| PDV003 | 1 | S | Tickets de caisse numériques envoyés par email |
| PDV004 | 1 | S | QR code de paiement au POS |
| PDV005 | 1 | S | Gestion de la détaxe pour clients étrangers |
| PDV006 | 1 | S | Remises manuelles sur les lignes et en pied de facture |
| PDV007 | 1 | S | Comptage détaillé du fond de caisse avec ventilation par coupure |
| PDV008 | 1 | S | Clôture de caisse quotidienne avec récapitulatif |
| PDV009 | 1 | S | Suivi des remises en banque et gestion des arrondis |

### Véhicules (Fleet) (11 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| VEH000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| VEH001 | 1 | D | Fiche véhicule complète avec toutes les caractéristiques techniques |
| VEH002 | 1 | D | Suivi commercial des véhicules : prix, marge, statut |
| VEH003 | 1 | S | Suivi du propriétaire actuel et historique des propriétaires successifs |
| VEH004 | 1 | S | Historique complet des réparations et entretiens par véhicule |
| VEH005 | 1 | S | Gestion documentaire par véhicule |
| VEH006 | 1 | D | Vue synthétique de la rentabilité par véhicule |
| VEH007 | 1 | S | États de gestion du parc moto |
| VEH008 | 1 | D | Alerte automatique pour les véhicules en stock depuis plus de 4 mois |
| VEH009 | 1 | D | Suivi des données de garantie et conformité par véhicule |
| VEH010 | 1 | S | Migration des données véhicules depuis G8 vers Odoo Fleet |

### Atelier (Réparation) (24 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| ATE000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| ATE001 | 1 | S | Prise de rendez-vous atelier en ligne avec collecte d'informations véhicule |
| ATE002 | 1 | S | Planning visuel de l'atelier avec capacité par mécanicien |
| ATE003 | 1 | S | Synchro bidirectionnelle Outlook <-> planning Odoo |
| ATE004 | 1 | S | Lien RDV -> Client -> Véhicule -> Type d'intervention |
| ATE005 | 1 | S | Attribution de motos de courtoisie aux clients pendant réparation |
| ATE006 | 1 | S | Notifications automatiques de rappel RDV par email et SMS |
| ATE007 | 1 | S | Documentation photographique à la réception du véhicule |
| ATE008 | 1 | S | Signature client sur l'OR avec envoi automatique |
| ATE009 | 1 | S | Devis complémentaire en cours d'intervention avec workflow d'approbation client |
| ATE010 | 1 | S | Workflow atelier avec états personnalisés et codes couleur |
| ATE011 | 1 | D | Checklists d'intervention par type de véhicule |
| ATE012 | 1 | S | Notes internes sur l'OR non visibles par le client |
| ATE013 | 1 | S | Kits/combos de pièces pour les interventions courantes |
| ATE014 | 1 | D | Nomenclatures d'entretien automatiques basées sur le modèle et le kilométrage |
| ATE015 | 1 | S | Pointage du temps de travail des mécaniciens sur chaque intervention |
| ATE016 | 1 | S | Suivi des interventions sous garantie (Ducati ou magasin) |
| ATE017 | 1 | D | Recherche véhicule par VIN avec accès à tout l'historique |
| ATE018 | 1 | S | Notification client de fin de travaux avec possibilité d'envoi programmé |
| ATE019 | 1 | D | Tableau de bord de productivité atelier par mécanicien |
| ATE020 | 1 | D | Facturation interne pour suivi des coûts de garantie et productivité |
| ATE021 | 1 | D | Planification des essais moto démo |
| ATE022 | 1 | S | Suivi du parc de motos prêtées et de démonstration |
| ATE023 | 1 | S | Accès rapide pour les mécaniciens aux accessoires en stock pour upselling |

### Inventaire (16 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| INV000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| INV001 | 1 | S | Réception par scan code-barres |
| INV002 | 1 | S | Traçabilité des commandes de pièces liées à un client ou un OR atelier |
| INV003 | 1 | S | Notification client automatique à la réception complète de sa commande |
| INV004 | 1 | S | Alerte atelier à la réception de pièces liées à un OR |
| INV005 | 1 | S | Règles de réapprovisionnement automatique avec seuils min/max |
| INV006 | 1 | S | Gestion multi-emplacements (casiers, étagères) |
| INV007 | 1 | D | Impression d'étiquettes personnalisées pour les articles |
| INV008 | 1 | S | Routage automatique des articles reçus vers la bonne destination |
| INV009 | 1 | S | Arrondis de commande au conditionnement fournisseur |
| INV010 | 1 | S | Stock unifié magasin + e-shop |
| INV011 | 1 | S | Inventaire physique annuel |
| INV012 | 1 | D | Gestion des références remplacées et équivalences produits |
| INV013 | 1 | D | Import et mise à jour automatique des listes de prix Ducati avec règles métier |
| INV014 | 1 | S | Migration des articles depuis G8 et intégration des catalogues Ducati |
| INV015 | 1 | S | Listes de préparation pour les commandes clients et les préparations VN |

### Achats (5 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| ACH000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| ACH001 | 1 | D | Commandes Ducati standard et urgentes avec export au format DCS (template Excel) |
| ACH002 | 1 | S | Processus de commande adapté par fournisseur |
| ACH003 | 1 | D | Import et maintien des tarifs fournisseurs |
| ACH004 | 1 | S | Processus de réception des motos neuves avec création de la fiche véhicule |

### Comptabilité (7 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| COM000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| COM001 | 1 | S | Rapprochement et consolidation des paiements |
| COM002 | 1 | S | Numérisation et traitement automatique des factures |
| COM003 | 1 | S | Relances automatiques pour les impayés |
| COM004 | 1 | S | Tableaux de bord et rapports personnalisés |
| COM005 | 1 | S | Gestion multi-société : ITALBIKE STORE + NL INVEST |
| COM006 | 1 | S | Régime de TVA sur marge pour les VO |

### Documents & Formulaires (9 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| DOC000 | 1 | S | Paramétrage des fonctionnalités standard du module |
| DOC001 | 1 | D | Formulaire PDF de demande de COC générable depuis Odoo |
| DOC002 | 1 | D | Génération de dossiers de garantie PDF avec photos |
| DOC003 | 1 | D | Fiche de réception véhicule digitale (remplace le papier) |
| DOC004 | 1 | D | Contrat d'essai moto digital avec signature électronique |
| DOC005 | 1 | D | Fiche de reprise moto digitale |
| DOC006 | 1 | D | Formulaire d'attestation de bridage/débridage |
| DOC007 | 1 | D | Gestion documentaire pour les dossiers de financement |
| DOC008 | 1 | S | Alias mail pour archivage automatique de documents |

### Site Web / E-commerce (9 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| SIW000 | 2 | S | Paramétrage des fonctionnalités standard du module |
| SIW001 | 2 | S | Page équipe sur le site web |
| SIW002 | 2 | S | Gestion et publication d'événements sur le site |
| SIW003 | 2 | D | Formulaires web personnalisés (contact, atelier, commercial, financement, reprise) |
| SIW004 | 2 | S | Page galerie photos interactive |
| SIW005 | 2 | S | E-commerce avec stock synchronisé |
| SIW006 | 2 | S | Design du site conforme à la charte graphique Ducati |
| SIW007 | 2 | S | Analytics et tracking des visiteurs |
| SIW008 | 2 | ? | Import et publication des catalogues tiers sur l'e-shop |

### Marketing (9 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| MKT000 | 2 | S | Paramétrage des fonctionnalités standard du module |
| MKT001 | 2 | S | Campagnes email régulières |
| MKT002 | 2 | S | Analytics email avec tracking des intérêts |
| MKT003 | 2 | S | Publication multicanal unifiée |
| MKT004 | 2 | S | Intégration réseaux sociaux |
| MKT005 | 2 | S | Publication automatique sur les réseaux sociaux |
| MKT006 | 2 | D | Publication automatique des véhicules d'occasion sur les plateformes externes |
| MKT007 | 2 | S | Communication via WhatsApp |
| MKT008 | 2 | D | Chat automatisé / chatbot IA |

### Téléphonie (VoIP) (4 exigences)

| Réf | Ph. | Type | Besoin |
|---|---|---|---|
| TEL000 | 2 | S | Paramétrage des fonctionnalités standard du module |
| TEL001 | 2 | S | Solution de téléphonie IP intégrée à Odoo |
| TEL002 | 2 | S | Journal des appels manqués visible par tous |
| TEL003 | 2 | ? | Transcription automatique des messages vocaux |


---

## Annexe B — Invariants métier hérités de G8 (règles à respecter quel que soit l'outil)

1. **Types de gestion d'article** (ou équivalent) : pièces stockées (A), non stockées (M), textes (F), composants forfait (N), véhicules neufs avec n° série (V), occasions particulier avec TVA marge (O), occasions professionnel (P), dépôt-vente (D), référence de reprise (R).
2. **TVA sur marge** : pour les occasions rachetées à des particuliers, la TVA est calculée à la revente uniquement sur la valeur ajoutée (marge), pas sur le prix total.
3. **Flux de reprise** : reprise client (référence type REP) → création automatique de l'article occasion + ouverture d'un dossier de remise en état (ORO) imputant pièces et main d'œuvre au coût de revient du véhicule → rentabilité réelle = PV − (prix de reprise + remise en état + frais).
4. **Triple stock** : réel (physique), arrêté/photo (inventaire), disponible (réel − réservé + en commande). Copies datées consultables a posteriori.
5. **PAMP** recalculé sur les entrées ; marges suivies à la fois sur PA et sur PAMP.
6. **Trois modes de réajustement** : annule-et-remplace, cumul (multi-emplacements), par casier à la volée.
7. **Traçabilité totale des mouvements de stock** : horodatage, ancien/nouveau stock, origine de l'opération, opérateur.
8. **Cycle OR** : réception (observations/photos) → OR transmis atelier → devis éventuel → accord client → réparation → transformation en facture, avec historique cumulé par véhicule.
9. **Numéros de série** suivis sur les types V/O/P, recherche croisée véhicule ↔ client ↔ documents.
10. **Garantie** : OR garantie avec imputation (cession garantie), états d'avancement, acceptation / refus total / refus partiel avec re-routage des lignes.
11. **Productivité atelier** : présence pointée, temps par fiche de travail, rapprochement temps passé / temps facturé.
12. **Étiquetage** : quantités par défaut = stock réel, avec/sans code-barres, avec/sans prix, édition immédiate ou différée cumulable.
