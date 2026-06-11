# G8 — Fonctions M8 Atelier / SAV (extraction du manuel)

> Source : `docs/reference-g8/DOC_Menu_Atelier.pdf` (115 pages, "Module ATELIER").
> But : recenser **toutes les fonctionnalités et parcours** du module atelier G8/Futurosoft
> pour les retrouver dans notre app (M8 `src/modules/workshop`). On garde le **glossaire métier**
> (OR, ORO, cession, chrono, garantie). Les n° de page renvoient au PDF source.
>
> Le module atelier G8 gère : **réparations client** (OR + devis), **cessions internes / ORO**
> (remise en état occasion), **fabrication de produits finis** (kits/nomenclatures), **planning atelier**
> (RDV, compagnons, véhicules de prêt/courtoisie), **chronos / pointeuse** (productivité),
> **OR accident/assurance**, **OR garantie** (acceptation / refus / refus partiel). (p.5)

---

# M8 Atelier — Fonctionnalités (checklist)

## A. Ordre de réparation (OR) & devis réparation — §1 (p.6-39)

### Création — en-tête de l'OR
- Créer un OR depuis le menu Atelier, OU via Facturation → Ventes → Réparation OR (deux chemins équivalents). (p.6)
- Créer un OR pour un **véhicule NON vendu par la concession** (saisie manuelle des n° de série). (p.7)
- Créer un OR pour un **véhicule VENDU/déjà réparé par la concession** (reprise auto de l'historique). (p.31)
- Saisir / changer le **code opérateur** (réceptionnaire, réparateur ou rédacteur du devis) — modifiable jusqu'à la facturation. (p.8)
- Choisir un **type de réparation / code atelier** (carrosserie, moteur, cyclos/scooters, motos…) — s'imprime sur l'en-tête de l'OR. (p.8)
- Sélectionner le **client** : recherche par nom (autocomplétion) ou par code ; double-clic dans la liste. (p.9)
- Créer un **nouveau client** à la volée (bouton Nouveau +) depuis la sélection client. (p.9)
- Afficher automatiquement le **code tarification** et la **condition de règlement** du client (ou les saisir manuellement). (p.9)
- Saisir les **numéros de série / VIN** de la machine (non obligatoires mais fortement conseillés pour l'historique). (p.10)
- Saisir le **kilométrage** (version 2-roues) OU le **nombre d'heures** + date de vente (version motoculture) ; saisir la **date de 1re mise en circulation**, l'**immatriculation**. (p.7-10)
- Saisir, en cas d'accident, le **nom de l'expert et sa date de passage** (imprimés sur l'OR à signer). (p.7)
- **Sélectionner un véhicule depuis l'historique du client** : double-clic sur une ligne → report auto des n° de série dans l'OR. (p.9-10, 31)
- Voir la **fiche produit / historique complet du véhicule** (avec les différents propriétaires) via bouton « Voir Fiche produit ». (p.31)
- Consulter / imprimer l'**historique client** (tous documents de toutes ses machines). (p.10)
- **Modifier les coordonnées du client** sans quitter l'OR (retour fiche client → Valider). (p.10)
- **Valider l'en-tête** de l'OR pour passer à la suite. (p.11)

### Désignation des travaux & réception
- Saisir une **désignation libre des travaux** demandés par le client (texte multiligne). (p.12)
- **Mémoriser** un texte de travaux récurrent (ex. « révision 1500 km ») et le **Rappeler** plus tard. (p.12)
- Cocher des **opérations atelier prédéfinies** (jusqu'à 30 cases), chacune avec **V = Vérification** ou **R = Remplacement/Réparation** → édite une fiche de travail atelier ; libellé reporté sur la facture. (p.12)
- Saisir les **observations à la réception** (état du véhicule) — texte libre, imprimé sur l'OR pour éviter les litiges. (p.13)
- (Référentiels : codes ateliers via *Table de données → Intitulés réparations* ; opérations via *Table de données → Opérations atelier*.) (p.8, 12)

### Corps de l'OR (lignes pièces / main d'œuvre) — fonctions avancées (p.13-23)
- Saisir des **lignes de pièces** (références articles) et de **main d'œuvre** (commentaire travaux). (p.14)
- Laisser le corps vide pour un OR simple (le mécano complétera plus tard), ou saisir les lignes pour produire un **devis chiffré**. (p.14)
- **Ouverture tiroir** caisse (si équipé). (p.15)
- **Données de réparation** : revenir à l'en-tête pour modifier/compléter. (p.15)
- Insérer un **commentaire** libre multiligne sur une ligne (lettre « T » en colonne S) ; le mémoriser/rappeler par nom. (p.15)
- **Recherche article par famille / fournisseur** (rayon, sous-rayon, catégorie). (p.16)
- **Garantie / Cession article** : passer **une pièce** en garantie/cession (prix & remise à 0, lettre « G », stock débité) ; ré-appui = annulation. (p.16-17)
- **Gérer les cessions en facturation** : choisir le **type de cession** → génère un OR cession archivé auto à l'enregistrement de la facture (nécessite comptes opérateurs de cessions). (p.17)
- **Garantie / Cession totale** : tout le document passe en garantie (client ne paie rien, stock débité, tous prix à 0). (p.18)
- **Proposition de commande article** : si stock insuffisant, mettre une réf en proposition de commande fournisseur (nom/n° client stockés). (p.19)
- **Proposition de commande totale** : toutes les lignes en proposition fournisseur (1 proposition par fournisseur). (p.19)
- **Fiche article** : créer un article inexistant à la volée, ou consulter/modifier la fiche ; voir les **équivalences** (lettre E). (p.20)
- **Opérateur** : changer l'opérateur courant. (p.21)
- **Importation code-barres** (lecteur portatif type Formula). (p.21)
- **Import microfiches** : rapatrier les références sélectionnées dans les logiciels microfiches constructeur. (p.21)
- **Insérer ligne** blanche au-dessus de la ligne courante. (p.21)
- **Mode HT / TTC** : commutateur (HT pour pros/agents/mairies, TTC pour particuliers). (p.22)
- **Encours article** : historique des opérations sur l'article sélectionné. (p.22)
- **RAZ ligne** / **RAZ tout** (efface la/les ligne(s), avec confirmation). (p.23)
- **Info Stock** : disponibilité des articles du document + mise en proposition de commande. (p.23)
- **Accès au parc** : recherche/consultation du parc de produits finis en stock. (p.23)

### Validation, édition, facturation
- **Valider** → enregistrement final + édition de l'OR. (p.23)
- **Facturation directe d'un OR** (si param. « ACTIVER FACTURATION O.R. DIRECTE » coché) : à F8, choix OUI (→ pied de facture / règlement) ou NON (→ acompte + édition devis/OR). (p.23-24)
- Saisir un **acompte** (mode de règlement + montant) à la validation. (p.24)
- Choisir le **nombre d'exemplaires** à éditer ; format **A4 grand format** ou envoi **fax** (modem). (p.27)
- Cocher **« Devis pour réparation »** pour éditer un devis au lieu d'un OR. (p.27)
- Indiquer l'**état de la réparation** : « Prêt » (terminée) ou « En cours ». (p.27)
- Éditer l'OR avec **zone de signature client** ; si des références ont été saisies, elles sont **chiffrées** sur l'édition. (p.28-30)

### Rappel, modification, transformation, suppression — §1.2 (p.32-39)
- **Rappeler un OR** par n°, code ou nom client ; filtrer par **état** (à faire / en cours / prêt). (p.32)
- Voir l'**état d'avancement** de chaque OR en liste (réponse rapide au client au téléphone). (p.32)
- **Gérer les acomptes sur OR** : ajouter / modifier / supprimer un acompte (mode, montant, date) ; restitution au client si suppression. (p.32-33)
- **Imprimer OR + Fiche** de réparation associée. (p.33)
- **Supprimer un OR** (Supprimer O.R.). (p.33)
- **Dupliquer un OR** (Dupliquer O.R.). (p.33)
- **Rappeler / re-valider** un OR pour saisir pièces + MO + passage en garantie. (p.33)
- Transformer un OR rappelé en : **Réparation** (re-enregistrer en OR), **Livraison** (BL client, facturé en fin de mois), ou **Facture** (pied de facture + règlement). (p.34)
- Note métier : compléter l'OR au fil de l'eau, le re-valider en OR jusqu'au retrait du client, puis transformer en facture (évite de facturer trop tôt, permet d'ajouter accessoires + frais de garage). (p.34-35)
- **Rappeler un DEVIS réparation** : bouton « Devis de réparation » → liste des devis en cours ; mêmes opérations que rappel OR ; **transformer un devis en OR** dès l'accord client. (p.38)
- Choisir le **titre du document devis** à l'édition : Grand Format → « PROFORMA » ; Devis → « DEVIS » ; Estimation → « ESTIMATION ». (p.39)
- **Supprimer un OR ou un devis** (avec restitution d'acompte éventuel). (p.39)
- **Liste des documents clients** (identique au module Facturation). (p.39)

## B. Cessions internes / ORO — §2 (p.40-48)
- Comprendre les **types de cession** : CADEAU, CESSION VN (neuf), CESSION VO (occasion), GARANTIE, fournitures atelier… (p.40)
- **Créer les comptes opérateurs de cessions** (prérequis ; *Table de données → Comptes opérateurs de cessions*). (p.40)
- **Créer une cession interne** (sortie de stock non facturable, rattachée ou non à une machine). (p.41)
- **Créer un ORO** (ordre de réparation occasion) pour imputer la **remise en état** (pièces + MO) au **coût de revient** d'une occasion. (p.41)
- Rappel : l'ORO est **créé automatiquement** quand on reprend une occasion via un article REP en facturation ; ce module permet d'en créer un **manuellement** sinon. (p.41)
- Sélectionner un **type de cession**, un **opérateur**, une **référence machine** (neuve = cession, occasion = ORO) + n° de série ; ou aucune machine (cadeau / fournitures). (p.41)
- Créer / supprimer un **type de cession** depuis cet écran. (p.41)
- Saisir un **commentaire** (libellé de la cession / détail des travaux de remise en état). (p.41)
- Saisir les **références pièces à sortir du stock** + **main d'œuvre** (temps de remise en état). (p.42)
- **Calcul prix mini de revente** (ORO) : `Prix de reprise + contenu de l'ORO = prix mini de revente` ; marge = somme des marges des références. (p.42)
- **Valoriser** les pièces sorties (cession) ; stock **débité à la validation**. (p.42)
- Récapitulatif + possibilité de **majorer le prix de vente** du véhicule (cession VO/VN). (p.43)
- Éditer un **document interne** récapitulatif. (p.43)
- **Rappeler une cession/ORO** rattachée à un véhicule encore en stock : Imprimer / Visualiser / **Archiver** / **Rappeler (modifier)** / **Supprimer**. (p.45)
- **Liste des cessions/ORO** par période et par type (édition). (p.46)
- **Archives cessions/ORO** : archivage **auto** quand la machine est vendue (ou dès création si non rattachée à un véhicule) ; visualiser / imprimer / supprimer. (p.48)

## C. Fabrication de produits finis (kits / nomenclatures) — §3 (p.48-54)
- **Créer un produit fini** : attribuer une référence + désignation, choisir fournisseur/rayon/sous-rayon/catégorie. (p.49)
- Saisir la **composition** (références pièces + main d'œuvre + quantités). (p.49)
- Saisir la **quantité fabriquée** → met à jour les stocks de pièces ; prix de vente/achat = cumul des composants (réajustable HT/TTC). (p.49)
- Éditer la **composition** du produit fini. (p.49)
- **Rappel / modification** : **Montage rapide** (même produit, nouvelle quantité) ou **Rappeler** (ajout de pièces, prix réajustés). (p.52)
- **Démonter un produit fini** : rappeler + saisir quantité **en négatif** → réintégration immédiate du stock pièces. (p.52)
- Distinction : **Supprimer** = efface seulement la référence du PF (PAS de réintégration de stock) ≠ démontage. (p.52)

## D. Planning atelier — §4 (p.55-85)
- Choisir la **vue de lancement** : **Réception Atelier** (semainier + avancement + charge journalière), **Vue verticale** (par compagnon / heure), **Vue horizontale** (vision globale atelier). (p.55-56)
- **Paramétrer le planning** : jours de la semaine, plages horaires affichées. (p.57)
- Paramètres généraux : **compagnon par défaut**, compagnon « NON AFFECTÉ », mode de notification fin de travaux (**SMS / mail / rien**). (p.58)
- Choisir le mode de **charge disponible** : gérée par l'atelier (heures fiche atelier) ou par les compagnons (horaires par compagnon). (p.58)
- **Synchronisation couleurs/statuts OR ↔ planning** (les statuts OR modifiés dans G8 mettent à jour les couleurs RDV). (p.58)
- **Relation RDV ↔ OR** (4 options de cascade de suppression) : aucune / OR supprimé → supprime RDV / RDV supprimé → supprime OR / les deux. (p.58)
- Paramètres semainier : **tri** des RDV de la vue réception (1er tri = avancement, 2e = compagnon…). (p.59)
- Paramètres planning : **amplitude d'affichage**, **1er jour de semaine** (ex. mardi si fermé lundi), **nb de jours ouvrés**, **granularité** (10/15/20/30/45 min, 1h, 2h). (p.60)
- Paramètres **SMS/Mail** : textes par défaut (fin de réparation, rappel RDV). (p.61)
- **Catégories et couleurs de RDV** : couleurs = étapes (attente pièce, travaux terminés…) ; libellés des catégories 8-10 personnalisables. (p.62)
- **Gérer les ateliers** (ajouter / modifier / supprimer). (p.64)
- **Gérer les compagnons** (mécaniciens) : fiche horaires de travail, « Visible dans le planning », opérateur G8 associé. (p.65)
- **Jours fériés / fermetures / absences** : glisser-déposer une catégorie sur une date ; absence = compagnon + heures effectives. (p.66)
- **Véhicules de prêt / courtoisie** : table dédiée (ajouter / modifier / supprimer). (p.67)

### Prise de RDV & gestion — §4.4-4.8 (p.69-85)
- **Prendre un RDV** depuis la vue réception : sélectionner mécanicien (compagnon), atelier, **date & heure d'arrivée**. (p.69)
- Respecter la **charge / disponibilité** : blocage si « Occ. ≥ 100 % » ou « jours non travaillés » ; OK si occupation < 100 %. (p.69)
- **Planification auto** si heures début+fin renseignées, sinon RDV « non planifié » à planifier par le chef d'atelier. (p.69)
- Définir le **temps prévu** pour la réparation (jours / heures / minutes). (p.69)
- Définir la **date & heure de réception** du véhicule. (p.69)
- Programmer un **SMS de rappel RDV** (par défaut la veille). (p.69)
- Sélectionner le **client** (autocomplétion) ; créer ou modifier la fiche client ; **changer de propriétaire** du véhicule. (p.69)
- Sélectionner le **véhicule** par n° de série (autocomplétion). (p.69)
- Cocher les **travaux à réaliser** (liste) + désignation des travaux + état à la réception (avec Rappel Mémo). (p.69)
- Sélectionner un **véhicule de prêt** disponible à la date du RDV (icône « clés » sur le RDV). (p.69)
- Définir le **statut/couleur du RDV** dès la création : « RDV Prévu » par défaut, ou « Véhicule arrivé ». (p.69)
- **Consulter le détail des RDV d'un jour** (clic droit). (p.69)
- **Ajouter une réparation (créer l'OR) directement depuis le planning** (Atelier → Planning atelier). (p.80)
- **Changement de propriétaire** d'un véhicule lors de la prise de RDV. (p.81)
- **Changer le statut d'un RDV** — 4 méthodes : double-clic, clic droit → « Changer le statut », via Rappel OR. (p.82)
- **Gérer un RDV** (clic droit) : Véhicule arrivé · Changer le statut · Fixer l'heure · **Reporter** · **Découper** · **Dupliquer** · **Prêter un véhicule** · **Envoyer SMS** · **Envoyer Email** · **Annuler** le RDV. (p.84-85)

## E. Chronos atelier / pointeuse & productivité — §4.10 + §5 (p.86-101)
- **Activer la pointeuse atelier** (param. « pointeuse atelier » ; « gestion du temps atelier » doit être décoché). (p.86)
- Choisir le **mode de pointage** : Pointage manuel · Arrêt automatique · Tout automatique · Pas de pointage présence (heures du planning). (p.87)
- Option **gestion des VT BMW** (réfs commençant par VT, 1 VT = 5 min). (p.87)
- Définir le **profil Chef d'atelier** (opérateur type « chef atelier » + droits d'accès) ; il valide les chronos mais **ne peut pas facturer** les OR. (p.88)
- **Étape 1 — Déclencher l'arrivée/départ du mécanicien** (pointer / dépointer) → heure d'arrivée pour la productivité. (p.89)
- **Étape 2 — Pointer sur une fiche de travail** : sélectionner un OR/Cession → le temps se décompte ; prendre en charge un nouvel OR (le temps s'interrompt sur l'ancien). (p.91-92)
- Plusieurs mécaniciens peuvent travailler sur un même OR/Cession. (p.92)
- **Étape 3 — Association temps passé ↔ temps facturé** (réservée au chef d'atelier) : 3 modes de répartition : **Prorata** (auto, défaut) · **Sélection** (lignes choisies) · **Manuelle** (saisie ligne par ligne). (p.93-99)
- Ajouter / modifier du **temps facturé** sur l'OR/Cession. (p.93)
- Après association, **rappeler l'OR et le facturer**. (p.99)
- **Productivité atelier** (§5) : choisir une **période** + opérateur(s) ; consulter **Détail temps de présence**, **Détail temps de travail**, **Détail temps de facturation** (heures travaillées / garanties / facturées / internes / présence). (p.100-101)

## F. OR accident / assurance — §6 (p.102-107)
- **Activer la gestion des OR accident/assurance** (param. système). (p.102)
- Onglet **« Assurance »** dans l'OR : renseigner cabinet d'assurance + cabinet d'expertise. (p.102)
- **Créer / modifier un cabinet d'assurance** (coordonnées). (p.103-104)
- **Créer / modifier un cabinet d'expertise** (expert). (p.105-106)
- Renseigner **date de passage de l'expert**, **montant de la franchise**, **valeur vénale** du véhicule. (p.106)
- Compléter les infos assurance **ultérieurement** lors du rappel de l'OR. (p.106)
- **Rappeler un OR accident** (bouton O.R. accident dans Rappel Réparation). (p.106)
- **Acceptation des travaux par l'assurance** : cocher « Accepter démarrage des travaux » dans l'onglet Assurance. (p.107)

## G. OR garantie — §7 (p.108-115)
- **Activer la gestion des OR garantie** : créer une cession Garantie type « Géré en caisse ». (p.108)
- Onglet **« Garantie »** dans l'OR : renseigner le **code cession garantie** + **état d'avancement** de la prise en charge. (p.109)
- **Choix de la cession garantie** : toutes les pièces prises en charge y sont affectées (consultables dans Archives cessions/ORO après facturation). (p.110)
- Définir l'**état d'avancement** (par défaut « en attente de demande de prise en charge »), modifiable au rappel. (p.111)
- **Rappeler un OR garantie** (bouton O.R. garantie) — **impossible de facturer directement** tant que la prise en charge n'est pas tranchée. (p.111)
- **Acceptation totale** : cocher « Prise en charge sous garantie acceptée » → toutes les pièces en garantie, libellé « GAR », cession garantie générée à la facturation. (p.112)
- **Refus total** : cocher « Refus prise en charge sous garantie » → aucune pièce en garantie, **aucune cession générée**, le client paie tout. (p.113)
- **Refus partiel** : cocher « Refus partiel… » → sélectionner les pièces prises en charge (bouton Garantie sur chaque ligne) → cession garantie générée pour **ces pièces seulement**. (p.114-115)

---

# Parcours utilisateur (user journeys)

## Journey 1 — Cycle complet d'un OR (réception → facture) — invariant B8
1. **Réception client** : Atelier → Réparation client → Création d'un OR. Saisir/confirmer l'**opérateur**. (p.7-8)
2. **Sélection client** : recherche par nom/code ; si nouveau → créer la fiche (Nouveau +). Conditions tarif/règlement affichées auto. (p.9)
3. **Véhicule** : si vendu/réparé par la concession → choisir dans l'**historique** (double-clic, n° de série reportés) ; sinon saisir VIN, immat, km/heures, 1re mise en circulation. (p.9-10, 31)
4. **Désignation des travaux** : texte libre (ou Rappel d'un mémo) + cocher opérations atelier (V/R) → fiche de travail. (p.12)
5. **Observations à la réception** : état du véhicule (anti-litige). Valider l'en-tête. (p.13)
6. **Édition de l'OR** : choisir nb d'exemplaires, A4/fax, état « En cours », **faire signer le client** (zone signature). (p.27-30)
7. **Transmission atelier** : la fiche de travail part en atelier ; le mécanicien complète l'OR (pièces + MO) au fil de l'intervention. (p.14)
8. **(Optionnel) Devis** : si le client demande un chiffrage avant accord → saisir pièces/MO, éditer un **devis** (titre PROFORMA / DEVIS / ESTIMATION) ; attendre l'accord ; transformer le devis en OR. (p.14, 38-39)
9. **Réparation terminée** : rappeler l'OR, compléter pièces + main d'œuvre + commentaires ; re-valider en OR (état « Prêt ») jusqu'au retrait. (p.33-35)
10. **Facturation** : rappeler l'OR → bouton **Facture** (ou **Livraison** si facturation fin de mois) → pied de facture, règlement (déduction acomptes), édition facture. L'OR est effacé après bascule. (p.34-35)

## Journey 2 — Reprise occasion → ORO (remise en état) — invariant B3
1. Reprise déclenchée en facturation via un **article REP** → G8 crée **automatiquement** l'article occasion + l'ORO. (p.41)
2. (Ou création manuelle) Atelier → Cessions internes/ORO → Création : choisir **type de cession** (CESSION VO), **opérateur**, **référence machine occasion** + n° série. (p.41)
3. Saisir un **commentaire** (détail remise en état). (p.41)
4. Saisir les **pièces à sortir du stock** + **main d'œuvre** (temps de remise en état). (p.42)
5. Le système calcule le **prix mini de revente** = `prix de reprise + contenu ORO` ; affiche la marge. (p.42)
6. Valider → **stock débité**, possibilité de **majorer le PV** du véhicule, édition du document interne. (p.42-43)
7. Rappeler/compléter l'ORO tant que le véhicule est en stock ; **archivage auto** à la vente du véhicule. (p.45, 48)

## Journey 3 — Cession interne simple (cadeau / fourniture / garantie constructeur)
1. Prérequis : comptes opérateurs de cessions créés (CADEAU, CESSION VN, GARANTIE…). (p.40)
2. Atelier → Cessions internes → Création : choisir le **type de cession** + opérateur. (p.41)
3. Saisir une **référence machine** (ou aucune pour cadeau/fournitures). (p.41)
4. Saisir les **pièces sorties du stock** (+ commentaire). (p.42)
5. Valider → stock débité, valorisation des pièces. **Archivage immédiat** si non rattaché à un véhicule. (p.43, 48)

## Journey 4 — Prise de RDV au planning (avec véhicule de courtoisie)
1. Planning atelier → vue Réception → clic sur le « + » de la date voulue. (p.69)
2. Sélectionner **compagnon** + **atelier** + **date/heure d'arrivée** (respect de la charge ; blocage si ≥ 100 % ou jour non travaillé). (p.69)
3. Définir **temps prévu** (j/h/min) + **date/heure de réception**. (p.69)
4. Cocher **« Programmer envoi SMS rappel RDV »** (veille par défaut). (p.69)
5. Sélectionner/créer le **client**, sélectionner le **véhicule** (n° série), éventuel **changement de propriétaire**. (p.69, 81)
6. Cocher les **travaux** + désignation + état réception. (p.69)
7. Sélectionner un **véhicule de prêt** disponible (icône clés). (p.69)
8. Choisir le **statut** (RDV Prévu / Véhicule arrivé) → Valider. Planification auto si heures complètes. (p.69)
9. Suivi : changer le statut (couleurs), reporter/découper/dupliquer, envoyer SMS/email, **créer l'OR depuis le planning**, annuler. (p.80-85)

## Journey 5 — Chrono atelier (productivité) — invariant B11 (3 étages)
1. Prérequis : pointeuse activée, OR/Cession ouvert, profil chef d'atelier + droits. (p.86-88)
2. **Étage 1 — Présence** : le mécanicien pointe son **arrivée** (et son départ) dans le module Chrono atelier. (p.89)
3. **Étage 2 — Temps de travail** : il **pointe sur une fiche de travail** (OR/Cession) → le temps se décompte ; bascule auto sur un nouvel OR ; plusieurs mécanos possibles. (p.91-92)
4. **Étage 3 — Temps facturé** : le **chef d'atelier** associe temps passé ↔ temps facturé (Prorata / Sélection / Manuelle), ajuste le temps facturé. (p.93-99)
5. Rappeler l'OR et le **facturer**. (p.99)
6. Analyse : Productivité atelier → période + opérateurs → présence / travail / facturation. (p.100-101)

## Journey 6 — OR garantie (acceptation / refus total / refus partiel) — invariant B10
1. Activer la gestion + créer la cession Garantie. (p.108)
2. Créer un OR, onglet **Garantie** : code cession garantie + état « en attente de prise en charge ». (p.109-111)
3. Saisir pièces + MO comme un OR normal. (p.111)
4. **Impossible de facturer** tant que la décision n'est pas prise → rappeler l'OR. (p.111)
5. Trancher :
   - **Acceptation totale** → « Prise en charge acceptée » : toutes pièces en garantie (GAR), cession garantie auto à la facturation. (p.112)
   - **Refus total** → « Refus prise en charge » : rien en garantie, aucune cession, client paie tout. (p.113)
   - **Refus partiel** → « Refus partiel » : sélectionner ligne par ligne (bouton Garantie) les pièces couvertes → cession générée pour celles-ci seulement. (p.114-115)
6. L'OR repasse dans « Ordres de réparation » (plus dans « O.R. Garantie ») ; facturer. (p.112-115)

## Journey 7 — OR accident / assurance
1. Activer la gestion OR accident. (p.102)
2. Créer l'OR → onglet **Assurance** : choisir/créer cabinet d'assurance + cabinet d'expertise. (p.102-106)
3. Renseigner date de passage expert, franchise, valeur vénale (complétable plus tard). (p.106)
4. Saisir l'OR comme une réparation classique. (p.106)
5. À l'accord assureur → rappeler l'OR → cocher **« Accepter démarrage des travaux »**. (p.107)

---

# Règles métier & options notables

- **Deux chemins d'accès** à l'OR : module Atelier ET Facturation → Ventes (mêmes écrans). (p.6)
- **Versions 2-roues vs motoculture** : km vs heures ; immat indisponible en motoculture. (p.7) → chez nous : 2-roues uniquement (motos), mais le **kilométrage** est un champ standard.
- **Type de réparation / code atelier** imprimé sur l'OR ; référentiels paramétrables (intitulés réparations, opérations atelier). (p.8, 12)
- **Opérations cochables V/R** : Vérification vs Remplacement-Réparation, 30 cases prédéfinies → fiche de travail. (p.12)
- **Observations à la réception** : conservées et imprimées (preuve anti-litige). (p.13)
- **Garantie / cession sur une ligne** : prix & remise mis à 0, lettre « G », **stock débité** (la pièce sort), réversible. (p.16-17)
- **Cession totale / garantie totale** : tout le document à 0, client ne paie rien, stock débité. (p.18)
- **Proposition de commande** : si stock insuffisant → liste fournisseur réutilisable ; conserve le n° client pour la réaffectation à réception. (p.19)
- **Mode HT/TTC** : commutateur global du document ; HT pour pros (définissable sur la fiche client), TTC par défaut. (p.22)
- **Facturation directe OR** : paramètre système (onglet Atelier) ; sinon flux acompte + devis/OR. (p.23-24)
- **Acomptes** : ajout/modif/suppression sur OR, avec restitution au client à la suppression. (p.32-33)
- **Transformation OR** → 3 sorties : Réparation (re-OR) / Livraison (BL → facture fin de mois) / Facture. Bascule = **effacement de l'OR**. (p.34-35)
- **Devis** : 3 titres au choix (PROFORMA / DEVIS / ESTIMATION) ; modifiable tant que non facturé ; transformable en OR à l'accord. (p.38-39)
- **ORO = imputation au coût de revient** (pas en charge atelier) : `prix de reprise + ORO = prix mini de revente` ; marge = somme des marges. Cœur de la rentabilité par VIN (B3). (p.42)
- **Cession rattachée à véhicule** : modifiable/archivable tant que le véhicule est en stock → **archivage auto à la vente**. Cession non rattachée → archivage immédiat. (p.45, 48)
- **Produit fini = nomenclature (type N)** : composition pièces+MO, quantité fabriquée met à jour le stock ; **démontage = quantité négative** réintègre le stock ; suppression ≠ démontage. (p.49-52)
- **Planning — synchro statuts** : couleurs RDV pilotées par les statuts OR ; 4 options de cascade de suppression RDV↔OR. (p.58)
- **Charge atelier** : calculée par atelier (heures fiche) ou par compagnon (horaires) ; blocage à ≥ 100 % d'occupation et jours non travaillés. (p.58, 69)
- **Granularité planning** : 10 min → 2 h ; 1er jour de semaine + nb jours ouvrés configurables (atelier fermé le lundi…). (p.60)
- **SMS/Mail** : rappel RDV (veille par défaut) + notification fin de travaux ; textes paramétrables. (p.61, 69)
- **Véhicules de prêt/courtoisie** : table dédiée, dispo calculée à la date du RDV, icône « clés » sur le RDV. (p.67, 69)
- **Chronos 3 étages (B11)** : présence (pointage) → temps de travail (pointage sur OR) → temps facturé (association chef d'atelier, prorata/sélection/manuelle). (p.87-99)
- **Profil chef d'atelier** : valide les chronos, associe temps passé/facturé, **ne facture pas** les OR (séparation des droits). (p.88)
- **Multi-mécanicien sur un OR** : plusieurs compagnons cumulent du temps sur le même OR/cession. (p.92)
- **Option VT BMW** : conversion réfs « VT… » en temps (1 VT = 5 min) — spécifique BMW, non pertinent pour Ducati. (p.87)
- **OR garantie non facturable** tant que la décision (accepté/refusé/partiel) n'est pas prise. (p.111)
- **Refus partiel garantie** = re-routage ligne par ligne (bouton Garantie) → cession pour les seules pièces couvertes (correspond exactement à B10). (p.114-115)
- **OR accident** : cabinets assurance/expertise réutilisables ; franchise + valeur vénale ; complétables au rappel ; jalon « accepter démarrage des travaux ». (p.102-107)

---

# Lien avec notre app (M8 `src/modules/workshop`)

| Fonction G8 | À implémenter chez nous | Module / écran | Invariant |
|---|---|---|---|
| OR : en-tête (opérateur, client, véhicule, km, code atelier) | Écran « Nouvel OR » avec sélection contact + **VIN** (objet pivot) + reprise historique véhicule | M8 + M1 (contacts) + M3 (véhicules) | B8, B9 |
| Désignation travaux + opérations V/R + observations réception | Bloc travaux (texte + cases paramétrables) + **photos à la réception** (Storage) | M8 + M9 (documents/photos) | B8 |
| Corps OR (pièces, MO, commentaires, garantie/cession par ligne) | Éditeur de lignes type POS, types d'articles A/T, sorties stock **append-only** | M8 + M2 (articles, type T = MO) + M5 (stock_moves) | B1, B7 |
| Mémos travaux récurrents (révisions) | Bibliothèque de textes/templates de travaux | M8 (+ M0 référentiels) | — |
| Devis réparation (PROFORMA/DEVIS/ESTIMATION) → OR | Statut `devis` → `or`, génération PDF, signature | M8 + M9 (documents/signatures) | B8 |
| Statuts OR (à faire / en cours / prêt) + acomptes | `status` + table `events` (audit) + acomptes tracés | M8 (+ M0 audit) | B7, règle 4 |
| Transformation OR → Facture / BL | Génération facture (séquence par société) ou bordereau livraison | M8 + M6 (ventes/POS) + M12 (compta) | multi-société |
| Cessions internes (CADEAU/VN/VO/GARANTIE/fournitures) | Cessions internes **valorisées non facturables**, typées, tracées | M7 (tradein/cessions) + M5 | B3, B7 |
| ORO (remise en état occasion, prix mini revente) | ORO imputé au **coût de revient VIN** ; `PV − (reprise + ORO + frais)` | M7 (cœur B3) + M3 | B3 |
| Produits finis / nomenclatures + démontage | Articles type **N** (composant kit) + montage/démontage stock | M2 + M5 | B1, B7 |
| Planning (vues réception/vertical/horizontal, charge, compagnons) | Planning atelier (Realtime), compagnons = rôle `mecanicien`/`chef_atelier`, ateliers | M8 (planning) + M0 (RBAC) | — |
| RDV (date, temps prévu, travaux, SMS rappel, statut/couleur) | Prise de RDV + notifications (Edge Functions / Resend / SMS) | M8 + M9/M10 (notifs) | — |
| Véhicules de prêt / courtoisie | Parc véhicules de prêt + dispo par date + suivi | M8 (+ M3) | — |
| Chronos 3 étages (présence / travail / facturé, prorata/sélection/manuelle) | Pointeuse + association temps passé/facturé par **chef_atelier** | M8 (productivité) + M0 (RBAC, séparation droits) | **B11** |
| Productivité (présence / travail / facturation par période) | Dashboards productivité atelier | M8 + M13 (reporting) | B11 |
| OR garantie (accepté / refus total / refus partiel + re-routage) | États de prise en charge garantie + cession garantie auto à la facturation, **refus partiel ligne par ligne** | M8 (workshop) + M7 (cession garantie) | **B10** |
| OR accident / assurance (cabinets, expert, franchise, valeur vénale) | Onglet assurance sur l'OR + référentiels cabinets/experts | M8 (+ M1 pour cabinets) | — |
| Changement de propriétaire véhicule depuis le RDV | Action « changement de propriétaire » sur fiche VIN | M3 (historique propriétaires) | B9 |

### Points d'attention pour notre refonte
- **Pas d'UPDATE direct** sur stock/prix : les sorties OR/cession/garantie passent par `stock_moves` append-only (G8 « débite le stock » → chez nous = mouvement). (B5, B7)
- **Tout statut OR/RDV = couleur + icône + libellé** (charte §9) ; le rouge Ducati n'est pas un statut.
- **i18n FR dès le départ** : tous les libellés (statuts OR, types de cession, modes de chrono) via dictionnaire, structure prête NL.
- **Multi-société** : numérotation OR/ORO/devis **par société** (séquences M0 configurables : `OR-`, `ORO-`, `DEV-`).
- **Cessions / garanties = `company_id` + RLS** ; le **chef_atelier** valide les chronos mais ne facture pas (séparation de droits = rôle distinct).
- **Hors périmètre / à adapter** : option VT BMW (5 min) inutile ; microfiches/import code-barres = à reconsidérer (catalogue Ducati/DCS, librairie d'articles) ; fax → e-mail/PDF moderne.
