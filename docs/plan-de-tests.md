# Plan de tests — DMS Ducati Bruxelles

> Checklist de recette **exhaustive** : chaque fonctionnalité, chaque parcours, et les **cas limites**
> (abandon, retour, mauvaise donnée, permissions, multi-société). Cocher `[x]` quand validé.
> Légende résultat attendu : ✓ = doit réussir · ✗ = doit être bloqué/refusé proprement (message clair, pas de crash).
>
> **Environnement** : http://localhost:8080, vraie DB Supabase, login `simon@themaul.be` (admin 2 sociétés).
> Tester systématiquement **sur les 2 sociétés** (ITALBIKE STORE / NL INVEST) via le sélecteur.
>
> Pour chaque écran, vérifier en plus : **i18n** (aucune clé brute `xxx.yyy` affichée), **charte**
> (pas de hex en dur, statuts = couleur+icône+libellé), **responsive**, **aucune erreur console**.

---

## 0. Transverses (à vérifier partout)

- [ ] **Auth** : login OK · mauvais mot de passe → ✗ message · déconnexion · reload (pas de spinner infini).
- [ ] **Multi-société** : bascule société → toutes les listes changent · une donnée d'ITALBIKE **n'apparaît jamais** dans NL INVEST (RLS).
- [ ] **Permissions/rôles** : un compte non-admin ne voit pas Paramètres ni Comptabilité (nav filtrée) ; tenter l'URL directe → ✗.
- [ ] **Append-only** : après chaque opération stock/prix, vérifier qu'il y a un **mouvement** (historique), jamais une valeur écrasée sans trace.
- [ ] **Recherche globale (Ctrl+K)** : VIN (17 car.), n° TVA, client, réf article, n° doc → résultats cliquables.
- [ ] **Champs invalides** (transverse) : texte dans un champ nombre, dates incohérentes (échéance < émission), montants négatifs non voulus → comportement maîtrisé.
- [ ] **Abandon** : ouvrir un formulaire, remplir, **quitter sans enregistrer** → aucune donnée créée, pas de doublon au retour.

---

## 1. M0 — Socle & paramètres

- [ ] **Utilisateurs** : créer un compte (8+ car.) ✓ · email déjà pris → ✗ · assigner/retirer rôles · activer/désactiver.
- [ ] **Séquences** : écran numérotation, aperçu live du prochain n° · modifier préfixe/format → le prochain document suit.
- [ ] **Tables de données** : créer/modifier (code figé)/supprimer une valeur (TVA, mode règlement, civilité, marque, type cession…) · supprimer une valeur utilisée → comportement attendu.
- [ ] **Cas** : créer 2 valeurs avec même code → ✗ (unicité).

## 2. M1 — Contacts

- [ ] **Création client** particulier : nom requis → sans nom ✗ · avec nom ✓.
- [ ] **Création fournisseur** (depuis Achats → Fournisseurs) : formulaire **sans statut/permis/catégorisation client** ; champ « Code » (pas « Code client ») ; RFA/franco/mini présents.
- [ ] **Filtre type** dans Contacts (Tous/Particuliers/Pro/Fournisseurs/Banque).
- [ ] **Onglets fiche** : Parc (VIN liés), Documents, Échéances, Livraisons, Contacts, Tarifs, **Documents/GED**, **Communications**.
- [ ] **Bandeau encours** : autorisé/actuel/disponible cohérent avec les factures impayées.
- [ ] **GED contact** : upload pièce d'identité (photo) + libellé · ouvrir · supprimer.
- [ ] **Communications** : journaliser un appel/email/SMS (entrant/sortant) → apparaît dans l'historique.
- [ ] **Cas** : créditer une limite négative, e-mail mal formé, TVA invalide → maîtrisé.

## 3. M2 — Articles & tarifs

- [ ] **Création** des 10 types (A/M/F/N/V/O/P/D/R/T) ; le type pilote TVA/stock/n° série.
- [ ] **Prix** : PA/PAMP/PVHT/PVTTC/coef/marge cohérents.
- [ ] **Onglets** : Stock (réel/réservé/dispo), Codes-barres, Kit, Remplacement (transfert + PAMP), Statistiques, **Photos**.
- [ ] **Photos article** : upload image → vignette · visible dans l'E-shop.
- [ ] **Import tarifs** (CSV) : analyser → diff/anomalies → appliquer · ré-import (réf existante non recréée).
- [ ] **Remplacement de référence** : ancienne→nouvelle, transfert stock + recalcul PAMP, alias conservé.
- [ ] **Cas** : réf dupliquée → ✗ · supprimer un article avec stock ≠ 0 → ✗.

## 4. M3 — Véhicules & parc

- [ ] **Création fiche VIN** (carte grise : E/D.1/P.1/P.2+bridé/V.9…) · filtre parc par statut.
- [ ] **Historique propriétaires** affiché.
- [ ] **GED véhicule** : photos **avant/après** (libellé) conservées dans l'historique · COC.
- [ ] **Jointure article↔véhicule** : un véhicule créé depuis une réception châssis ou une reprise porte bien `article_id`.

## 5. M4 — Achats & réceptions

- [ ] **Fournisseurs** : créer/éditer (RFA, n° client, franco/mini).
- [ ] **Réception** : en-tête (frs, n° facture/BL, dates, régime TVA), lignes (article, qté, PA, casier, étiquettes) · **Valider** → **entrées de stock + PAMP recalculé** (vérifier sur la fiche article).
- [ ] **Réception châssis** (bouton moto) : VIN/moteur/CV+bridé/TPMS… → **fiche véhicule type V créée** et liée.
- [ ] **Régime TVA** CEE / hors-CEE → TVA à 0 ; avec TVA → TVA calculée.
- [ ] **Échéancier** : ajouter des échéances (date/montant).
- [ ] **Commande** (CMD) : créée sans impact stock.
- [ ] **Proposition de commande** : articles sous mini → quantités suggérées → créer les commandes (groupées par fournisseur).
- [ ] **Export DCS** (STANDARD/URGENTE) depuis une commande → fichier CSV téléchargé.
- [ ] **Cas** : réception sans fournisseur, qté 0, PA vide → maîtrisé ; abandon en cours de saisie → rien créé.

## 6. M5 — Stock & inventaire

- [ ] **Écran Stock** : réel/réservé/disponible + valeur PAMP ; filtres (≠0, sous mini) ; **historique des mouvements** par article.
- [ ] **Cessions internes** : sortie typée (cadeau/démo/garantie) → mouvement `cession`, stock débité, tracé.
- [ ] **Inventaire** — pour chacune des combinaisons de toggles :
  - [ ] Magasin fermé, annule-et-remplace : comptage → réajustement = **delta inséré** (pas d'écrasement).
  - [ ] Magasin fermé + effacement (cumul) : remise à zéro (conserver V/O/P) → comptage cumulé.
  - [ ] Magasin ouvert : **génération arrêté** → comptage → **écarts** (réel vs arrêté, qté+valeur) → **réintégration** unique.
  - [ ] Édition des écarts activée : table écarts cohérente.
- [ ] **Réintégration 2ᵉ fois** → ✗ (« déjà réintégré »).
- [ ] **Remise à zéro** : les véhicules V/O/P **ne sont pas** remis à zéro (n° série préservés).
- [ ] **Cas** : compter une valeur négative, article inconnu → maîtrisé.

## 7. M6 — Ventes & POS

- [ ] **Créer chaque type** : FAC, DEV, RES (réservation), BL, TIK.
- [ ] **Pied de facture** : remise globale %/€, mode HT/TTC, **détaxe** (mode HT only) + mention, port taxé/non, **net TTC forcé** → TVA recalculée.
- [ ] **Stock par type** : FAC/TIK → réel débité ; RES/BL → disponible (réservé) ; DEV → aucun.
- [ ] **Encaissement** : multi-modes, partiel, **rendu de monnaie** (espèces), **à échéance** (reste dû), suppression/ajout règlement.
- [ ] **Acomptes** sur réservation ; **conversion** DEV→FAC/BL/RES, RES→FAC/BL, BL→FAC (acompte reporté, stock ajusté).
- [ ] **Avoir** depuis une facture : lignes négatives, **réintégration stock**, remboursement, facture passée annulée.
- [ ] **Impression PDF** (FAC/DEV/RES/BL/AVO).
- [ ] **Export UBL** (FAC/AVO avec numéro) → fichier XML.
- [ ] **Clôture Z** (`/pos`) : ouvrir session (fond) → mouvement entrée/sortie → journal Z (par mode + TVA) → **calcul monnaie** (comptage) → écart → clôturer.
- [ ] **Cas** : valider un doc **sans ligne** → ✗ ; encaisser plus que le dû → rendu monnaie ou maîtrisé ; convertir un doc déjà converti → ✗.

## 8. M7 — Reprise / Occasion / ORO

- [ ] **Reprise** (particulier→O / pro→P) : crée **article occasion + fiche véhicule + entrée stock + ORO**.
- [ ] **ORO** : ajouter pièces (sorties stock en cession) / MO / frais → **coût de revient** du véhicule mis à jour, **marge** affichée.
- [ ] **Clôture ORO** → verrouillé.
- [ ] **Cas** : reprise avec prix 0, sans VIN → maîtrisé.

## 9. M8 — Atelier

- [ ] **Nouvel OR** : client + VIN + km + opérateur + type + travaux + observations réception.
- [ ] **Lignes** pièce/MO/texte ; **garantie par ligne** (prix 0).
- [ ] **Statuts** à faire / en cours / prêt.
- [ ] **Garantie B10** : passer « en attente » → **facturation bloquée** (✗) ; passer « acceptée » → facturation OK ; refus total → client paie tout ; refus partiel → seules les lignes cochées en garantie à 0.
- [ ] **Transformer en facture** → facture créée (stock réel débité), OR « facturé », lien vers la facture.
- [ ] **GED OR** : photos réception (avant/après).
- [ ] **Chronos** (`/workshop/chrono`) : pointer arrivée/départ ; démarrer/arrêter le travail sur un OR ; **temps passé** visible sur l'OR ; un 2ᵉ « démarrer travail » clôt le précédent.
- [ ] **Planning** (`/workshop/planning`) : créer un RDV (client/véhicule/mécanicien/véhicule de prêt/SMS) ; changer le statut (couleurs) ; **créer l'OR depuis le RDV** ; navigation semaines.
- [ ] **Cas** : OR sans client/VIN ; transformer un OR déjà facturé → ✗.

## 10. M9 — Documents & GED

- [ ] **Upload** photo (caméra mobile) + PDF, avec **libellé** ; vignettes images ; ouverture (URL signée) ; suppression.
- [ ] **RLS Storage** : un fichier d'ITALBIKE non accessible depuis NL INVEST.
- [ ] **Cas** : upload d'un très gros fichier, type non image → maîtrisé.

## 11. M10 — CRM

- [ ] **Pipeline leads** : créer un lead ; le déplacer d'étape (nouveau→…→gagné/perdu) ; compteurs par colonne.
- [ ] **Communications** (depuis la fiche contact) : journaliser email/SMS/appel/note.
- [ ] **Cas** : lead sans nom → ✗.

## 12. M11 — E-shop

- [ ] **Catalogue** : photos (1re image GED), prix TTC, **badge stock** (en stock/rupture cohérent avec le disponible).
- [ ] **Publier / retirer** un article ; filtre « vitrine (publiés) ».
- [ ] **Stock unifié** : vendre l'article au POS → la dispo baisse dans l'e-shop.

## 13. M12 — Comptabilité & exports

- [ ] **Journal des ventes** sur période ; totaux HT/TTC.
- [ ] **Registre TVA** : ventilation par taux (base/TVA) cohérente avec les factures.
- [ ] **Export UBL** d'une facture : XML valide (vendeur/acheteur/TVA/lignes/totaux) ; avoir = type 381.
- [ ] **Export Winbooks** : CSV période téléchargé.
- [ ] **Cas** : période vide → message « aucune écriture » ; export sans facture → bouton désactivé.

## 14. M13 — Reporting

- [ ] **Dashboard** : KPIs (CA jour/mois, encours, OR ouverts, valeur stock, véhicules) cohérents.
- [ ] **Rapports** : CA 12 mois (graphe), top articles, productivité atelier (présence/travail/taux).

## 15. M14 — Migration

- [ ] **Import contacts** : coller un CSV → **Analyser** (aperçu créations/erreurs, nom requis) → **Importer** → contacts créés.
- [ ] **Cas** : CSV sans en-tête nom → toutes lignes en erreur ; délimiteur `,` vs `;` détecté ; lignes vides ignorées ; doublons (réimport) → vérifier le comportement.

---

## Parcours bout-en-bout (user journeys critiques)

1. **Achat → vente d'une pièce** : réception (PAMP) → l'article est en stock → vente au POS → encaissement → la dispo baisse → la pièce remonte dans le top articles et le CA du dashboard.
2. **Reprise occasion → remise en état → revente** : reprise (B3) → ORO (coût de revient) → fiche véhicule → vente de l'occasion (TVA marge type O) → marge réelle par VIN.
3. **Cycle atelier complet (B8)** : RDV planning → arrivée → OR (travaux + pièces + MO + photos avant/après) → chronos → prêt → transformation en facture → encaissement.
4. **Garantie (B10)** : OR garantie en attente → facturation bloquée → décision (accept/refus total/partiel) → facturation correcte.
5. **Clôture de journée** : ventes du jour → clôture Z (comptage tiroir, écart) → journal des ventes → export UBL/Winbooks.
6. **Inventaire magasin ouvert** : arrêté → activité commerciale continue → comptage → écarts → réintégration → stock cohérent.

---

## Tests automatisés (headless, `bun test`)

Couverts / à couvrir (règles critiques, règle 7) : **PAMP** ✓, **pied de facture / TVA / détaxe / remise / net forcé** ✓,
totaux **achats** (3 décimales, régimes TVA), totaux **OR** (garantie = 0), **delta d'inventaire** (annule-remplace vs cumul),
**parse CSV** d'import contacts, **génération UBL** (structure), résolution **tarifs client à paliers**.
> Les parcours UI (auth requise) se valident via ce plan manuel ou un futur E2E (Playwright) avec un compte de test.
