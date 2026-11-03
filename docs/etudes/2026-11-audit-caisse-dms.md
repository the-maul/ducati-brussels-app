---
titre: Audit de la caisse du DMS face à G8 et au cadre légal belge
date: 2026-11-03
auteur: Claude (agence), à la demande de Simon
etat: audit remis, défauts francs corrigés (branche `audit-caisse-dms`), migration écrite non appliquée
modules: [M06]
---

# Audit de la caisse du DMS (03/11/2026)

> **En deux mots.** Le client a décidé de **garder la caisse dans le DMS** (proposition du 03/11,
> `docs/propositions/2026-11-caisse-shopify-ou-dms.md`) et demande de vérifier « qu'on a un système
> de caisse fonctionnel, comparé à la doc G8 ». Verdict : **la chaîne existe de bout en bout** (vente
> comptoir → ticket numéroté → encaissement multi-modes → journal Z → clôture avec comptage), mais
> elle **n'a jamais servi** (1 ticket à 0 EUR en juin, 1 session ouverte depuis 5 mois, 0 clôture) et
> elle avait **sept défauts francs** qui la rendaient inacceptable pour un inspecteur : ticket à 0 EUR
> accepté, ticket validé modifiable et supprimable depuis l'application, règlement effaçable, session
> clôturée réouvrable, TVA du jour absente du journal Z, pas d'arrondi légal des espèces, ticket sans
> ventilation de TVA par taux. **Tous sont corrigés** dans ce lot (code) ; les verrous en base sont
> écrits dans une migration **à appliquer** (§4). Le reste (ticket 80 mm, tiroir, numérotation du Z,
> rattachement du ticket à la session, journal des recettes, plafond espèces) est proposé en cartes (§5).

Méthode : lecture du code (`src/routes/_app.pos.tsx`, `src/modules/sales/pos-sale.tsx`,
`cash-screen.tsx`, `cash-api.ts`, `payment-panel.tsx`, `write-api.ts`, `print-document.ts`,
`document-pdf*.ts`), des migrations `documents`, `document_payments`, `cash_sessions`, `stock_moves`
et des droits par rôle ; base de production `ujmrosbgkvgvwfnuryna` **en lecture**, essais
d'écriture dans des transactions **annulées** (administrateur simulé, société ITALBIKE STORE).
**Rien n'a été vu dans un navigateur** (pas d'écran, pas d'imprimante, pas de scanner).

---

## 1. Ce qui marche, écran par écran (avec les chiffres réels)

### 1.1 Les chiffres de la base (03/11/2026)

| Quoi | Valeur |
|---|---|
| Documents de vente | **17 814** (17 808 repris de G8) ; FAC payées 17 665, FAC validées 35, AVO 111, DEV 2, **TIK 1** |
| Tickets de caisse du DMS | **1** : `TIK-2026-00001` du 11/06/2026, **0,00 EUR**, sans client, sans règlement, 1 sortie de stock (−1), opérateur vide (antérieur au trigger opérateur) |
| Règlements | **2** (démo de juin : ESP 121 + ESP 105), 0 règlement sur un ticket |
| Sessions de caisse | **1**, ouverte le 11/06/2026 à 15 h 34 avec 250 EUR de fond, **jamais clôturée** (ouverte depuis 5 mois) ; 0 mouvement de fond de caisse ; **0 journal Z clôturé** |
| Modes de règlement (Paramètres → Tables) | 10 : Espèces, Maestro / Débit, Virement, Visa/Mastercard Débit, Visa/Mastercard Crédit, Chèque cadeau, PayPal, Reprise moto, Virement QR (masqué), Shopify Payments (masqué) |
| Séquences | TIK à 2, FAC à 5, DEV à 3, AVO / RES / BL / BC jamais utilisées |
| **Trous de numérotation** | `FAC-2026-00002`, `-00003`, `-00004` : trois factures **payées** supprimées le 12/06/2026 en SQL (acteur vide, pas depuis l'écran) ; seule `FAC-2026-00001` (0 EUR) subsiste. À consigner pour le comptable (§3) |
| Société | ITALBIKE STORE, TVA BE0472540151, Chaussée de Bruxelles 688, 1410 Waterloo, IBAN, logo, pied et CGV renseignés ; **aucune colonne téléphone / e-mail** sur la société (le ticket ne les imprime donc pas) |
| Droits d'écriture sur `/pos` | admin, vendeur, magasinier, mécanicien, chef d'atelier, comptable (tout le monde sauf marketing) : **tous peuvent ouvrir, encaisser, annuler, clôturer** |
| Audit `events` | documents : 17 818 créations, 24 221 modifications, 4 suppressions ; règlements : 10 événements **sans société** (`company_id` vide, l'audit générique lit une colonne absente) |
| Volume G8 à absorber | 75 à 175 factures par mois en 2026 (140 000 à 490 000 EUR TTC / mois), hors tickets Express G8 non repris |

### 1.2 Le parcours, comme un vendeur puis comme un inspecteur

| Étape | Ce que fait le DMS | Verdict |
|---|---|---|
| **Ouverture de session** (Caisse → onglet « Caisse & clôture Z ») | Fond de caisse d'ouverture + note → `cash_sessions` (qui, quand). Une seule session « ouverte » est lue… **mais rien n'empêchait d'en ouvrir deux** (testé en base : 2 ouvertes). Fond négatif accepté. | Marche ; doublon **corrigé** (écran + index unique en base) |
| **Vente comptoir** (onglet « Vente comptoir ») | Champ unique scan / recherche (référence, désignation, réf. fournisseur, code-barres, dès 2 caractères) → panier (quantité, PU TTC, total) → totaux HT / TVA / TTC → « Encaisser » crée un **ticket TIK validé et numéroté** (stock réel débité) puis affiche le panneau de règlement. **Sur Entrée, le premier résultat était ajouté même s'il y en avait cinq** ; **un panier à 0 EUR passait** (c'est le ticket de juin). Pas de remise, pas de prix modifié, pas de client, pas de ligne texte ni de main-d'œuvre au comptoir (tout cela existe dans Ventes → Nouveau document, type « Ticket »). | Marche ; 0 EUR et scan **corrigés** ; fonctions Express G8 manquantes → cartes |
| **Encaissement** | Multi-modes (lignes de règlement), montant partiel, « à échéance » (différé avec date), espèces avec montant remis et **rendu de monnaie**, « versé par l'organisme » si financement. Enregistrement → `document_payments` → `recompute_document_paid` (statut « payée » quand tout est perçu). **Aucun arrondi à 5 cents des espèces** (obligatoire en Belgique depuis le 01/12/2019). « Nouvelle vente » repartait **sans vérifier que le ticket était réglé** : ticket numéroté, stock sorti, 0 EUR encaissé, aucun avertissement. | Marche ; arrondi et ticket non réglé **corrigés** |
| **Ticket** | « Imprimer le ticket » = même gabarit HTML A4 que la facture (en-tête société, n°, date, **heure**, opérateur, lignes, totaux, règlements, CGV au verso), imprimé par le navigateur. **Pas de ventilation de la TVA par taux** sur ce gabarit (le PDF l'a, pas l'impression) ; modes de règlement imprimés en code (« MAE »). Pas de format 80 mm, pas de tiroir, pas d'e-mail sans client. | Marche ; TVA par taux et libellés **corrigés** ; 80 mm / tiroir / e-mail → cartes |
| **Facture depuis un ticket** | Pas de conversion TIK → FAC : si le client veut une facture, il faut refaire la vente dans Ventes → Nouveau document (type Facture, client) et annuler le ticket par un avoir. G8 fait de même (changement de type **en cours de saisie**, pas après). | Différent → carte |
| **Retour / avoir / remboursement** | « Générer un avoir » existe sur la fiche du document (lignes négatives, stock réintégré, règlements remboursés en négatif, source annulée). **Sur un ticket, le bouton s'affichait puis répondait « document source non facturable »** (`generateCreditNote` n'acceptait que FAC). Avoir toujours total : pas de retour partiel. | **Corrigé** (TIK accepté) ; avoir partiel → carte |
| **Annulation d'un ticket** | = avoir (ci-dessus). Après clôture : l'avoir se crée à sa date, le ticket d'origine reste dans son Z (correct). | Marche désormais |
| **Mouvements de caisse** | Entrée / sortie, montant, mode, motif, horodatés, audités. Montant ≤ 0 accepté par la base. Dépôt en banque = sortie espèces motivée (pas de bordereau de remise). | Marche ; montant ≤ 0 **corrigé** ; remise en banque → carte |
| **Journal Z / clôture** | Récap par mode (ventes FAC/TIK, acomptes, avoirs, total), ventilation TVA, entrées / sorties, comptage par coupure (500 EUR → 1 cent), espèces théoriques, écart, « Clôturer la session ». **Défauts** : la ventilation TVA **oubliait les ventes du jour** (`issue_date < aujourd'hui`) et **comptait les brouillons** ; les acomptes sur bon de commande (BC) n'étaient pas dans la colonne acomptes ; les espèces théoriques additionnaient des mouvements saisis en carte / virement ; la clôture ne gardait ni qui a clôturé, ni les espèces attendues, ni le Z lui-même (recalculé à la volée : si un règlement change après, **le Z change**) ; une session clôturée **se rouvrait par simple UPDATE** et acceptait encore des mouvements. Pas de numéro de Z, pas d'impression / PDF du Z. | Marche ; calculs, figeage et non-réouverture **corrigés** (code + migration) ; n° de Z et impression → cartes |
| **Rapport X** | Le panneau « Journal Z » de la session ouverte **est** le X (lecture en cours de journée, pas de figeage). | Marche (sans impression) |
| **Historique des Z** | Liste des sessions (ouverte, clôturée, fond, compté, statut) ; pas de détail d'une session passée ni de réimpression. Après la migration : le Z de chaque session est **figé** dans `cash_sessions.z_report`. | Partiel → carte |
| **Multi-poste / multi-tiroir** | Une session par société (pas par poste). Deux vendeurs sur deux PC partagent la même session. | Différent → carte (décision) |
| **Multi-société** | Tout porte `company_id` (sessions, mouvements, documents, séquences). Une seule société en base (NL INVEST absente). | Prêt, non prouvé |
| **Droits** | RLS par rôle (`can_write_table`) : écrire sur `/pos` = tout faire (encaisser, annuler, clôturer, supprimer un règlement). Aucun droit fin « qui peut annuler / remiser / rouvrir ». | Différent → carte |
| **Impression matérielle** | Aucune : pas de tiroir, pas d'imprimante ticket, afficheur client = l'« écran client » (2e écran : QR de virement et merci), pas le panier. | Manque → cartes |
| **Hors ligne** | Impossible (application web sur Supabase). G8 était local. | Manque (non proposé : hors architecture) |
| **Audit** | `events` sur documents, lignes, règlements, sessions, mouvements (qui, quoi, quand, avant / après, origine « écran »). Règlements : **société absente** de l'événement ; acteur vide pour les 4 suppressions de juin (SQL). | Marche ; société **corrigée** (migration) |

### 1.3 Vérifié en base (transactions annulées, administrateur simulé)

Avant correction, en tant qu'administrateur depuis l'application (RLS « écriture par rôle ») :
modifier les totaux d'un ticket validé → **accepté** ; le repasser en brouillon → **accepté** ; le
supprimer → **accepté** ; supprimer ou modifier un règlement perçu → **accepté** ; rouvrir une
session clôturée → **accepté** ; ouvrir deux sessions → **accepté** ; ajouter un mouvement sur une
session clôturée → **accepté** ; créer un ticket à 0 EUR sans règlement → **accepté**
(`TIK-2026-00002`) ; journal Z du 11/06/2026 borné à 18 h : ventilation TVA **vide** (le même Z
borné au lendemain : 36 157,74 EUR de base) ; un brouillon daté d'aujourd'hui **compte** dans la
TVA du Z. Somme des règlements = `paid_amount` sur les 6 documents du DMS (0 écart).

Après la migration (même méthode, bloc annulé) : les neuf écritures ci-dessus sont **refusées** avec
un message en clair ; la purge d'un devis validé reste permise (VTE-09) ; le passage « payée →
validée » du recalcul reste permis ; la chaîne brouillon → lignes → numéro → validation passe
(`TIK-2026-00002`) puis ses lignes sont figées ; un règlement ESP sur ce ticket le passe « payée » ;
l'événement d'audit du règlement porte la société ; la clôture écrit `closed_by`, `expected_cash`
(250,00 EUR) et `z_report` ; une deuxième session ouverte est refusée (index unique) ; un
mouvement négatif est refusé.

---

## 2. G8 (Facturation, écrans Express / règlement / caisse) vs DMS

Référence : `docs/g8-fonctions-m6-ventes-pos.md` §1.2, 1.4, 1.10, 1.11, 1.13, 1.17, 1.18.
**Fait** = équivalent ; **partiel** = une partie ; **différent** = autre chemin ; **absent**.

| Fonction G8 | DMS | Commentaire |
|---|---|---|
| Choix / code opérateur au démarrage (p.13) | différent | Opérateur = utilisateur connecté, écrit par le serveur (mission 05). Pas de changement d'opérateur sur un document. |
| Désactiver l'Express (p.14) | absent | Rôle « marketing » seul sans accès ; pas de réglage « poste d'encaissement ». |
| En-tête : type HT / TTC, client express ou identifié (p.15) | partiel | Comptoir : TTC, anonyme. Client, HT / TTC : dans Ventes → Nouveau document (type Ticket). |
| Lignes : référence, libellé, quantité, PU, **remise**, total (p.16) | partiel | Comptoir : pas de remise ni de prix modifié ; éditeur de vente : oui (remise ligne et globale, net forcé). |
| Totaux temps réel + reste à payer (p.34) | fait | Comptoir : HT / TVA / TTC puis « reste à encaisser » (ajouté dans ce lot). |
| Saisie d'une référence, liste si plusieurs (p.16-17) | fait | Corrigé : Entrée n'ajoute que le résultat unique, sinon on choisit. « Aucun article » affiché. |
| Référence « * » (prix à la volée × coefficient) (p.18) | absent | Ligne libre avec prix dans l'éditeur de vente, pas de coefficient. |
| Main-d'œuvre (MO, heures) (p.18-19) | partiel | Éditeur de vente : ligne main-d'œuvre (article T, heures) ; pas au comptoir. |
| Ouverture tiroir (p.21) | absent | Aucun matériel branché. |
| Commentaire sur ligne / document, mémorisé (p.21-22) | fait (éditeur) | Lignes texte + commentaires types (mission 05) ; pas au comptoir. |
| Recherche par famille / fournisseur (p.22-25) | absent | Recherche texte seulement. |
| Garantie / cession totale ou par ligne (p.26-27) | partiel | Prix 0 depuis l'OR (M8) ; pas de cession typée au comptoir (M7). |
| Proposition de commande ligne / totale (p.27-29) | fait (éditeur) | « Commander les pièces » depuis le document (mission 02). |
| Fiche article à la volée, équivalence (p.29-30) | partiel | Article « à compléter » (e-catalog), référence remplacée proposée. |
| Import code-barres portatif / microfiches (p.30) | différent | Scan clavier dans le champ ; coller une référence e-catalog. |
| Insertion de ligne, RAZ ligne / tout (p.30-33) | partiel | Suppression de ligne ; pas d'insertion entre deux lignes, pas de RAZ tout. |
| Mode HT / TTC (p.31) | fait (éditeur) | Pied de facture. |
| Encours article (p.31) | partiel | Stats article sur la fiche article (M2). |
| Changement de type en cours de saisie (p.31-32) | différent | Type choisi dans l'éditeur ; pas depuis le comptoir (→ carte « Vente détaillée »). |
| Info stock / stock distant / parc (p.33-38) | partiel | Pastille disponible / en commande / à commander ; pas de stock distant (une société). |
| Validation → écran règlement (p.39) | fait | Ticket créé puis panneau de règlement (ordre inverse de G8 : G8 n'imprime qu'après règlement). |
| Modes de règlement paramétrables, visibles en caisse (p.68) | fait | Paramètres → Tables → Modes de règlement (`visible_pos`). |
| Règlements multiples, partiel, à échéance (p.68-69) | fait | Multi-lignes, « à échéance » + « marquer perçu ». |
| Rendu de monnaie (p.40, p.71) | fait | Sur les espèces arrondies (ce lot). |
| Modification / suppression d'un règlement (p.70, p.90) | partiel | Suppression physique (trace `events`) ; interdite après clôture (migration). G8 : écriture d'annulation si transféré en compta → carte « contre-passation ». |
| Impression chèque, ticket-chèque (p.70, p.147) | absent | Hors usage belge (pas de chèques). |
| Édition : A4 / petit format / **ticket de caisse** / sans éditer (p.40-41) | partiel | A4 HTML et PDF ; pas de ticket 80 mm. |
| Consultation des ventes du jour (p.110-114) | partiel | Liste des ventes filtrable ; pas de marge par facture ni de total du jour → M13. |
| Liste des mouvements de fond de caisse / acomptes / encaissements (p.114-120) | partiel | Mouvements de la session ouverte ; acomptes sur le document ; pas de liste dédiée. |
| Mouvements de fond de caisse (p.128-130) | fait | Entrée / sortie, mode, motif, horodatage. |
| Fond de caisse de départ, écarts (p.130-131) | fait | Fond à l'ouverture, écart à la clôture (figé par la migration). |
| Journal de caisse / remises de chèques de fin de journée (p.164-165) | partiel | Journal Z à l'écran ; pas d'édition imprimée. |
| Récap encaissements du jour par mode, acomptes, entrées / sorties (p.170) | fait | Corrigé : acomptes BC inclus, ventes du jour incluses. |
| Ventilations TVA / opérateur / famille (p.172-176) | partiel | TVA faite ; opérateur / famille → M13. |
| Calcul monnaie (comptage par coupure) (p.177) | fait | 15 coupures. |
| Présentation normale / horizontale (p.170) | absent | Sans objet. |
| Remises en banque (p.180-184) | absent | Sortie espèces motivée seulement → carte. |
| Duplicata de facture (p.133) | fait | Réimpression / PDF à tout moment (même numéro). |
| Avoir depuis facture, stock remis, règlements négatifs (p.88, p.135) | fait | Étendu au ticket dans ce lot. |
| Paramètres caisse : poste = caisse, tiroir, imprimante ticket, en-tête ticket (M0 §caisse) | absent | Une session par société, pas par poste. |

---

## 3. Légal et attendu vs DMS

| Exigence | Source | DMS | Commentaire |
|---|---|---|---|
| Mentions du ticket : nom, adresse, n° TVA du vendeur | AR n° 1 art. 5 ; usage | fait | En-tête société (nom, raison sociale, adresse, TVA, IBAN). Téléphone / e-mail : colonnes absentes de `companies`. |
| Date **et heure** | usage caisse | fait | Date d'émission + heure de création (`created_at`). Date locale depuis ce lot (était la date UTC : après minuit, ticket daté de la veille). |
| Numéro continu par série | AR n° 1 art. 5 §1 10° | fait, **avec trous historiques** | Séquence `TIK-AAAA-NNNNN` par société, prise à la validation seulement. **FAC-2026-00002 à 00004 supprimées le 12/06** : trou à documenter (procès-verbal interne : factures de test supprimées avant mise en service). La migration interdit désormais la suppression d'un document numéroté. |
| Lignes : désignation, quantité, prix unitaire, montant | idem | fait | Référence, désignation, quantité, PU HT, PU TTC, remise, montant TTC, taux. |
| **TVA ventilée par taux** (base et montant) | AR n° 1 art. 5 §1 ; TVA 21 / 6 / 0 | fait depuis ce lot | Le PDF l'avait ; l'impression du ticket ne l'avait pas. |
| Total TTC, **moyen de paiement**, montant reçu, rendu | usage, contrôle fiscal | fait | Règlements datés avec libellé du mode (était le code), rendu de monnaie à l'écran (pas sur le ticket → carte 80 mm). |
| **Arrondi à 5 cents des paiements en espèces** | Code de droit économique art. VI.7/2, AR 01/12/2019 | **fait depuis ce lot** | Était absent. Espèces arrondies au multiple de 5 cents le plus proche ; l'écart est un règlement `ARR` (mode « Arrondi espèces », masqué en caisse) : le tiroir et le journal Z montrent les espèces réellement reçues. Le document n'est pas modifié (B7). Position à confirmer avec le comptable : l'administration admet que la TVA suive le montant arrondi ; ici la TVA reste calculée sur le montant exact et l'arrondi est comptabilisé à part (compte 657/757). |
| **Plafond espèces 3 000 EUR** par vente | loi du 18/09/2017 (blanchiment) art. 67 | **absent** | Aucun contrôle à l'encaissement → carte (petite). |
| Journal des recettes (ventes sans facture ventilées par taux, jour par jour) | AR n° 1 art. 14 §2 ; circulaire 2013 | partiel | Le Z donne la ventilation TVA de la période (FAC + TIK + AVO) ; pas de journal des recettes **par jour** limité aux tickets, pas d'export → carte. |
| **Inaltérabilité** des documents validés et des journaux clôturés | AR n° 1, art. 60 CTVA (conservation fidèle), B7 | **code : oui ; base : non → migration** | Testé : tout modifiable par un membre. La migration fige en-tête et lignes des documents validés du DMS, les règlements d'une caisse clôturée, les sessions clôturées (qui, attendu, Z figé). Les fonctions serveur (Shopify / Stripe) et les documents repris de G8 restent libres. |
| Conservation 7 ans (10 ans pour les livres) | art. 60 CTVA, CDE | fait | Base Supabase + PDF en GED ; sauvegardes du dépôt. Rien de supprimé automatiquement sauf la **purge des devis** (décision VTE-09, devis seulement). |
| Clôture quotidienne, écart de caisse motivé | usage comptable | partiel | Clôture avec écart ; motif de l'écart non demandé → carte (petite). |
| Piste d'audit (qui, quoi, quand) | B7, règle 4 CLAUDE.md | fait | `events` sur documents, lignes, règlements (société ajoutée par la migration), sessions, mouvements. Acteur vide quand l'écriture vient du SQL (12/06). |
| Caisse enregistreuse certifiée (« boîte noire ») | horeca seulement | sans objet | Concession moto : non concernée. |
| Facture obligatoire à un assujetti | art. 53 CTVA | partiel | Ticket anonyme possible ; la facture se fait dans Ventes → Nouveau document. Rien ne force un client pro vers une facture → carte « Vente détaillée ». |

---

## 4. Ce qui a été corrigé dans ce lot (code, sans décision)

| Défaut | Correction | Fichiers | Test |
|---|---|---|---|
| Ticket à 0 EUR / panier sans ligne accepté | Même règle que l'écran de vente : au moins une ligne et un montant, message clair | `pos-rules.ts` (`posCartError`), `pos-sale.tsx` | `caisse-vente-comptoir.test.ts` |
| Entrée ajoutait le premier résultat même s'il y en avait plusieurs | Ajout d'office seulement si un seul résultat ; sinon « choisissez dans la liste » / « aucun article » | `pos-rules.ts` (`scanAutoPick`), `pos-sale.tsx` | idem |
| « Nouvelle vente » sans encaisser : ticket numéroté dû sans un mot | Reste à encaisser affiché ; fenêtre de confirmation si le ticket n'est pas réglé (il reste dû dans « Soldes à encaisser », s'annule par un avoir) ; lien « Ouvrir le ticket » | `pos-sale.tsx` (`ticketRemaining`) | idem |
| Date du ticket en UTC | Date locale du poste | `pos-rules.ts` (`localIsoDate`) | idem |
| Pas d'arrondi légal des espèces | Espèces arrondies à 5 cents, écart porté par un règlement `ARR`, rendu de monnaie sur l'arrondi, affiché avant d'encaisser | `cash-rounding.ts`, `payment-panel.tsx`, migration (mode `ARR`) | `caisse-arrondi-especes.test.ts` (19 cas) |
| Avoir impossible sur un ticket (bouton visible, erreur ensuite) | FAC et TIK acceptés (`canGenerateCreditNote`), messages dans le dictionnaire | `write-api.ts`, `_app.sales.$documentId.tsx` | `caisse-vente-comptoir.test.ts` |
| Ticket imprimé sans TVA par taux, modes en code | Ventilation TVA par taux (même calcul que le PDF), libellés des modes | `print-document.ts` | calcul `vatBreakdown` déjà testé |
| Deux sessions ouvertes ; fond négatif ; mouvement ≤ 0 ; clôture rejouable | Refus à l'écran (message) ; clôture seulement si encore ouverte ; confirmation avant clôture (théorique / compté / écart, « définitive ») | `cash-api.ts`, `cash-screen.tsx` | — |
| Espèces théoriques avec des mouvements en carte / virement | Seuls les mouvements en espèces comptent pour le tiroir | `cash-rules.ts`, `cash-screen.tsx` | `caisse-cloture.test.ts` |
| Erreurs d'impression avalées au comptoir | Erreur affichée | `pos-sale.tsx` | — |

**En base, migration écrite et testée (transaction annulée), NON APPLIQUÉE**
`supabase/migrations/20261103150000_m6_caisse_audit.sql` :
journal Z corrigé (ventes du jour, brouillons exclus, avoirs en négatif, acomptes BC, espèces à
part, récap des documents) ; une seule session ouverte par société ; clôture définitive (qui,
espèces attendues, Z figé) ; aucune écriture sur une session clôturée ; règlement perçu d'une
caisse clôturée intouchable (correction par règlement inverse) ; audit des règlements avec la
société ; document validé du DMS figé (numéro, type, date, client, montants, lignes), jamais
supprimé (sauf purge des devis) ; mode `ARR`. Commande, après accord et backup (règle 5.0) :

```
npx supabase@2.117.0 db query --linked --project-ref ujmrosbgkvgvwfnuryna -f supabase/migrations/20261103150000_m6_caisse_audit.sql
```

Dictionnaires FR / NL / EN / IT complétés (`pos.*`, `cash.*`, `sales.cashRounding`,
`sales.creditNote*`). `npx tsc --noEmit` : 10 erreurs, toutes préexistantes. `bun test` : 1 094 + 40 cas verts.

---

## 5. Cartes proposées

### A. Empêche d'encaisser au quotidien

**Carte 1 — Appliquer la migration des verrous de caisse** · *pourquoi* : sans elle, tout ce qui
est figé à l'écran reste modifiable en base par n'importe quel membre ; *test* : les neuf essais
du §1.3 refusés ; *estimation* : 0 jour de code, un backup + 10 minutes ; décision client (règle 5.0).

**Carte 2 — Rattacher chaque ticket à la session de caisse et refuser d'encaisser caisse fermée**
· *pourquoi* : le Z travaille par horaire (ouverture → clôture) ; un ticket encaissé caisse fermée
tombe dans aucun Z ; G8 lie le poste à la caisse ; *test* : caisse fermée → « Ouvrez la caisse »
; ticket → `cash_session_id` ; Z = tickets de la session ; *estimation* : 1 jour (colonne, règle
à la création, Z par session plutôt que par heures). Décision : un vendeur peut-il vendre sans
session (compte client, virement) ?

**Carte 3 — « Vente détaillée » depuis le comptoir** · *pourquoi* : remise, prix modifié, client
(facture pour un pro, art. 53 CTVA), ligne texte, main-d'œuvre, HT / TTC existent dans l'éditeur
de vente mais pas au comptoir ; G8 change de type en cours de saisie ; *test* : panier scanné →
« Vente détaillée » → éditeur pré-rempli, type Ticket ou Facture, client ; *estimation* : 1 jour
(passage du panier à `/sales/new?docType=TIK`).

**Carte 4 — Ticket 80 mm et tiroir-caisse** · *pourquoi* : le ticket sort en A4 par le
navigateur ; un comptoir attend un ticket thermique et l'ouverture du tiroir à l'encaissement
espèces ; *test* : imprimante 80 mm → ticket avec en-tête, lignes, TVA par taux, mode, reçu, rendu,
arrondi ; tiroir s'ouvre sur « Espèces » ; *estimation* : 2 jours + marque / modèle de
l'imprimante et du tiroir (décision matériel, comme le terminal Bancontact P-2).

**Carte 5 — Une seule transaction pour créer le ticket et son encaissement** · *pourquoi* :
en-tête, lignes, numéro, stock, règlement partent du navigateur en plusieurs appels (carte 7 de
la mission 08) ; une coupure laisse un ticket numéroté sans stock ou sans règlement ; *test* :
couper le réseau entre deux étapes → rien n'est créé ; *estimation* : 2 à 3 jours (fonction SQL
`document_create` + `document_pay`), à faire avec la mission 08.

### B. Conformité (illégal ou indéfendable devant un contrôle)

**Carte 6 — Numéro de Z, impression / PDF du Z, réimpression d'un Z passé** · *pourquoi* : un
journal de caisse se numérote en continu et s'imprime ; le Z est désormais figé en base mais ni
numéroté ni imprimable ; *test* : clôture → `Z-2026-00001` → PDF (ventes par mode, TVA par taux,
documents, mouvements, fond, compté, écart, qui) archivé en GED ; liste des Z avec réimpression ;
*estimation* : 1,5 jour.

**Carte 7 — Journal des recettes quotidien (tickets) exportable** · *pourquoi* : les ventes sans
facture doivent figurer dans un journal des recettes tenu au jour le jour, ventilé par taux (AR
n° 1 art. 14) ; le Z le fait par session, pas par jour ni en export ; *test* : Comptabilité →
« Journal des recettes » : un jour par ligne, base et TVA par taux, total, export CSV / UBL ;
*estimation* : 1 jour (fonction SQL + écran M12).

**Carte 8 — Annuler un règlement par contre-passation, plus jamais par suppression** · *pourquoi*
: la corbeille efface le règlement (carte 9 de la mission 08) ; après clôture c'est maintenant
refusé, mais avant clôture le règlement disparaît ; un comptable veut l'erreur et sa correction ;
*test* : règlement 100 EUR → « Annuler » → ligne −100 EUR datée, motif ; *estimation* : 1 jour.

**Carte 9 — Plafond de 3 000 EUR en espèces** · *pourquoi* : loi anti-blanchiment ; rien ne
l'empêche ; *test* : 3 100 EUR en espèces → refus avec le texte de loi ; *estimation* : 0,5 jour.

**Carte 10 — Motif obligatoire d'un écart de caisse et procès-verbal des trous de numérotation**
· *pourquoi* : écart non commenté ; trois numéros de facture perdus le 12/06 ; *test* : clôture
avec écart → motif ; document « PV des numéros FAC-2026-00002 à 00004 » en GED ; *estimation* :
0,5 jour + une note du client.

### C. Pénible

**Carte 11 — Droits fins de caisse** · *pourquoi* : tout rôle qui écrit sur `/pos` peut annuler,
supprimer un règlement, clôturer ; G8 a un arbre de droits par traitement ; *test* : vendeur →
pas de « Générer un avoir » ni de clôture sans admin / comptable ; *estimation* : 1 jour
(réglage par rôle, RLS). Décision : qui annule, qui clôture, qui remise.

**Carte 12 — Sessions par poste / tiroir** · *pourquoi* : une session par société ; deux PC = un
seul tiroir ; *test* : poste A et poste B ouvrent chacun leur session, chaque Z est séparé ;
*estimation* : 2 jours. Décision : combien de tiroirs à Waterloo ?

**Carte 13 — Ticket par e-mail sans client (PDV003)** · *pourquoi* : seul un document avec client
part par mail ; *test* : « Envoyer le ticket » → adresse saisie → PDF ; *estimation* : 0,5 jour.

**Carte 14 — Afficheur client : panier et total en direct** · *pourquoi* : l'écran client ne
montre que le QR ; *test* : lignes et total sur le 2e écran pendant la vente ; *estimation* : 1 jour.

### D. Manque

**Carte 15 — Remise en banque (PDV009)** · bordereau daté espèces / chèques cadeaux, sortie de
caisse liée, consultation et réimpression (G8 p.180-184) ; *estimation* : 1,5 jour.

**Carte 16 — Retour partiel et échange** · avoir sur une partie des lignes, remboursement sur le
mode d'origine, échange sans sortie d'argent ; *estimation* : 2 jours.

**Carte 17 — Chèques cadeaux** · émission numérotée, solde, utilisation en caisse (le mode
« Chèque cadeau » existe sans suivi) ; *estimation* : 2 jours.

**Carte 18 — Deuxième société et Bancontact** · NL INVEST absente ; terminal (P-2) : rien à coder
tant que marque et modèle ne sont pas connus (saisie du mode « Carte » à la main, comme G8).

---

## 6. Ce que je n'ai pas pu voir sans navigateur

Le rendu réel des écrans (`/pos`, fenêtre de confirmation, panneau de règlement avec la ligne
« Espèces arrondies »), l'impression (fenêtre du navigateur, mise en page du ticket, bloc TVA),
le comportement d'un lecteur de code-barres (Entrée après le scan, vitesse de la recherche à
2 caractères sur 17 000 articles), l'écran client sur un second moniteur, et le vrai délai des
appels Supabase entre « Encaisser » et le panneau de règlement. À recetter sur place avec Simon
après déploiement : vendre un casque en espèces (10,02 EUR → 10,00 + arrondi), imprimer, clôturer.
