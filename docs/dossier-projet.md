# DOSSIER COMPLET — DMS Ducati Bruxelles
### Remplacement de G8/Futurosoft par un DMS sur mesure (Lovable + Supabase + Claude Code)

**Entités juridiques** : ITALBIKE STORE + NL INVEST (multi-société, COM005 — structurant)
**Référentiel d'exigences** : 140 refs du GAP Analysis (Annexe A du cahier v2) + 12 invariants métier G8 (Annexe B) + angles morts G8 (section 4 du cahier v2)
**Design** : charte graphique Ducati Bruxelles (`/docs/charte-graphique.md`) — source de vérité visuelle unique ; fontes Ducati Style (Ext/Rg/Cond, 8 fichiers .ttf à déposer dans `/public/fonts/`) + JetBrains Mono via npm
**Objectif** : livraison 100% fonctionnelle en un seul go-live — pas de "phase 2 reportée" : tout le périmètre (y compris web/marketing/portails) est dans le build.

---

# 1. ARCHITECTURE — les 14 modules

## 1.1. Principe directeur

Trois objets pivots traversent tout le système. Chaque enregistrement porte un `company_id` (ITALBIKE / NL INVEST) :

- **CONTACT** — client particulier/pro/banque leasing/fournisseur (CON001-007)
- **VÉHICULE** — identifié par VIN, objet de première classe avec cycle de vie complet et historique propriétaires (VEH001-010, ATE017, invariant B9)
- **ARTICLE** — avec **type de gestion** hérité de G8 (invariant B1) : A pièce stockée, M non stockée, F texte, N composant forfait, V véhicule neuf, O occasion particulier (TVA marge), P occasion pro, D dépôt-vente, R référence de reprise

Règle d'architecture non négociable : **les véhicules de type V/O/P/D sont à la fois des articles (valorisation, stock) ET des fiches véhicule (VIN, historique)** — c'est la jointure que ni Odoo ni un e-commerce ne font proprement, et le cœur de la valeur du custom.

## 1.2. Les 14 modules et leurs exigences

| # | Module | Refs couvertes | Invariants G8 |
|---|--------|----------------|---------------|
| M0 | Socle (auth, multi-société, RBAC, audit, recherche globale) | COM005 | B7 (traçabilité) |
| M1 | Contacts | CON000-007, CRM009-010 | — |
| M2 | Articles & tarifs | INV012-013, ACH003 | B1 (types), B5 (PAMP) |
| M3 | Véhicules & parc | VEH000-010, ATE017 | B9 (n° série) |
| M4 | Achats & réceptions | ACH000-004, INV001, INV008-009, INV003-004 | B5 |
| M5 | Stock & inventaire | INV005-007, INV010-011, INV015 + angles morts (arrêté, 8 méthodes, tournant, dépréciation, étiquetage avancé) | B4, B6, B7, B12 |
| M6 | Ventes & POS | VEN000-014, PDV000-009 | B2 (TVA marge) |
| M7 | Reprise / Occasion / Dépôt-vente | VEN007-008, VEH006 | B3 (flux REP→ORO) |
| M8 | Atelier | ATE000-023 | B8, B10, B11 |
| M9 | Documents & signatures | DOC000-008, VEN015-016 | — |
| M10 | CRM & marketing | CRM000-008, CON007, MKT000-008 | — |
| M11 | Site web & e-shop | SIW000-008 | — |
| M12 | Compta & exports | COM000-006 + Peppol/UBL | B2 |
| M13 | Reporting & dashboards | VEN012, ATE019, COM004, VEH008 | B11 |
| M14 | Migration G8 | CON005, INV014, VEH010 + historiques | tous |

Hors build (intégrations externes, voir §3) : VoIP 3CX (TEL001-003), paie/RH, comptabilité réglementaire belge (le DMS produit les journaux et factures UBL, le comptable tient les livres dans son outil).

---

# 2. SPÉCIFICATION PAR MODULE — ce que chaque module fait

## M0 — Socle
**Rôle** : fondations techniques que tout le reste consomme.
- Auth Supabase + rôles : admin, vendeur, magasinier, mécanicien, chef d'atelier, comptable, marketing. RLS sur toutes les tables.
- **Multi-société** : table `companies` (ITALBIKE STORE, NL INVEST), `company_id` sur tout document/mouvement, possibilité de flux croisés (facturation inter-sociétés), bascule de contexte dans l'UI, numérotations de documents par société.
- **Audit universel** (B7) : table `events` append-only — qui, quoi, quand, ancien/nouveau, origine (écran, import, API). Aucun UPDATE silencieux sur stock ou prix.
- Recherche globale : un champ unique qui résout client / VIN / plaque / référence article / n° de document.
- Séquences documentaires par société et par type : FAC-, TIK-, DEV-, CMD-, REC-, OR-, ORO-, OCC-, DEP-, REP-, COC-.

## M1 — Contacts
**Rôle** : la fiche client moto complète, mieux que G8.
- Champs métier moto (CON002, dev) : date de naissance, n° carte d'identité, registre national, **permis moto (n°, date, lieu, catégorie A/A2)** — le permis A2 conditionne le bridage (lien avec DOC006).
- B2B (CON003) : TVA intracom (validation VIES), conditions de paiement, IBAN, **limite de crédit avec encours calculé en temps réel** (équivalent encours autorisé/actuel G8) — blocage paramétrable à la facturation.
- Catégorisation (CON004) : intérêts (route/sport/off-road), statut (VIP, standard, à surveiller, détaxé, en compte) — les drapeaux pilotent les comportements (détaxé → TVA 0% export au POS, douteux → alerte).
- **Critères d'intérêt structurés** (CON007) : modèles, fourchette prix, puissance, neuf/occasion → moteur de matching (voir M10).
- Saisie autonome tablette/borne (CON001) : formulaire plein écran "Je m'enregistre", création directe en base + lead CRM.
- Listes de prix par segment (CRM009) : VIP vs standard, appliquées automatiquement aux devis/POS.
- Lien bidirectionnel client ↔ véhicules (CON006) : onglet "Ses motos" sur la fiche client, onglet "Propriétaires" sur la fiche véhicule.

## M2 — Articles & tarifs
**Rôle** : le référentiel pièces/accessoires avec toute la profondeur G8.
- Fiche article : référence, désignation, marque, rayon/sous-rayon/catégorie, **type de gestion A/M/F/N/V/O/P/D/R** (B1), fournisseur principal + secondaires avec réf. fournisseur, codes-barres multiples, code casier (multi-emplacements), conditionnement achat, stock mini/maxi, PA / **PAMP recalculé à chaque entrée** (B5) / PV TTC, coefficient.
- **Équivalences & remplacements** (INV012, dev) : `superseded_by` en chaîne + groupe d'équivalences ; à la saisie d'une référence remplacée, le système propose la nouvelle et affiche le stock résiduel de l'ancienne.
- **Moteur d'import tarifs** (INV013 + ACH003, dev) — applique les 12 règles du cahier des charges : accepter changements désignation/PA/fournisseur/rayon/marque, PV à la hausse uniquement, **conserver le coefficient**, ne pas recréer les remplacées, les ajouter aux équivalences, créer les nouvelles en "librairie" (catalogue non stocké), codes-barres fournisseurs, PA 3 décimales. Écran : upload CSV/Excel → mapping colonnes → prévisualisation diff → rapport d'anomalies → application. Profils d'import sauvegardés par fournisseur (Ducati, Rizoma, Bihr, Evotech, CNC).
- Modification en cascade hors imports (angle mort G8) : recalcul PA/PV de masse par rayon/fournisseur avec arrondis paramétrés.
- Forfaits/kits (ATE013, B1 type N) : nomenclature de composants, prix forfait ou somme des composants, décomposition automatique en stock à la facturation. Couvre aussi l'angle mort "fabrication/démontage" : un kit monté = sortie composants + entrée produit fini, réversible.

## M3 — Véhicules & parc
**Rôle** : l'objet VIN, avantage compétitif n°1.
- **Fiche véhicule complète** (VEH001, dev) : VIN, n° moteur, plaque, n° de clé, marque/modèle/millésime, couleur, cylindrée, puissance (+ version bridée O/N), énergie, norme antipollution, catégorie, km, TPMS, date 1ère immat, fin de garantie, statut bridage (lien DOC006).
- **Suivi commercial** (VEH002, dev) : prix d'achat (PAHT), coût de revient (= PAHT + remise en état ORO + frais), prix affiché, marge prévisionnelle/réelle, statut (en commande, en stock VN, en stock VO, dépôt-vente, réservé, vendu, livré, courtoisie, démo, dépôt agent) — équivalents des recherches parc G8 (VEH007).
- **Historique propriétaires** (VEH003, B9) : table `vehicle_owners` datée ; le changement de propriétaire depuis un OR (comme dans G8) est conservé.
- Historique interventions (VEH004) : tous les OR/ORO du VIN, cumulé inter-propriétaires (ATE017, dev).
- GED par véhicule (VEH005) : COC, certificat immat, factures d'achat/entretien, photos.
- **Rentabilité par véhicule** (VEH006, dev) : vue synthèse PV − (reprise/achat + ORO + frais) — dépend du flux B3, voir M7.
- **Alerte stock > 4 mois** (VEH008, dev) : edge function quotidienne → notification + liste "rotation lente" dans M13.
- Garantie & conformité (VEH009, dev) : type de garantie, échéances, campagnes de rappel saisies manuellement (pas d'accès DCS).

## M4 — Achats & réceptions
**Rôle** : réplique des flux G8 Appros, plus l'intégration DCS.
- Commandes fournisseur : génération depuis propositions (mini/maxi + réservations clients/OR + ruptures), processus par fournisseur (ACH002) : **export Excel format DCS Ducati avec types STANDARD / URGENTE** (ACH001, dev) générant 2 fichiers distincts ; mail formaté pour Rizoma ; etc. Profils paramétrables.
- **Réception pièces** : par scan code-barres (INV001), sur facture ou BL (n°, date, remise par ligne, port, échéances fournisseur, achat CEE sans TVA — comme l'écran G8 documenté). OCR : upload PDF facture → Claude API → lignes pré-remplies à valider.
- **Routage à la réception** (INV008) : chaque ligne fléchée CLIENT / OR ATELIER / STOCK. Si CLIENT complet → notification mail/SMS (INV003) + pousser vers facturation si payé intégralement. Si OR → alerte atelier sur la fiche de travail + statut OR "pièces reçues" (INV004).
- Arrondis au conditionnement (INV009).
- **Réception motos neuves** (ACH004) : réplique de l'écran G8 "Réception châssis" — saisie VIN, n° moteur, origine, caractéristiques, année modèle, PAHT → **création automatique de la fiche véhicule M3** + entrée en stock type V.

## M5 — Stock & inventaire
**Rôle** : tout le module Stock G8, sans exception — c'est le terrain où Odoo standard perd.
- **Triple stock** (B4) : réel / arrêté (photo datée) / disponible (réel − réservé + en commande). Copies de stock datées (15 et fin de mois) consultables.
- Mouvements immuables (B7) : table `stock_moves` append-only avec horodatage, ancien/nouveau, méthode, opérateur — l'écran "Historique mouvements" de G8.
- Multi-emplacements (INV006) : codes casier 12 car., affichés en facturation et POS.
- Réservations : pour client (commande) ou OR (pièces atelier).
- Réappro auto mini/maxi (INV005) + édition ruptures.
- **Inventaires — les 8 méthodes G8** : magasin ouvert/fermé, avec/sans effacement des stocks, avec/sans édition des écarts. **Arrêté d'inventaire** (génération photo, réajustement en 3 modes — annule-et-remplace, cumul, par casier à la volée (B6) — réintégration unique, effacement), écarts d'inventaire entre 2 stocks, comptage, **inventaire tournant** avec taux d'écart, états par rayon/fournisseur/code rangement/référence/produits finis, valorisations +/−, simplifié/récapitulatif, exports Excel/PDF.
- **Dépréciation de stock** (angle mort) : taux par période d'entrée → liste à déprécier pour le comptable (PAMP ajusté côté compta uniquement, comme G8) + liste des invendus.
- **Étiquetage avancé** (INV007, dev + B12) : par référence/groupe, quantité par défaut = stock réel, avec/sans code-barres, avec/sans prix, planches A4 (reprise ligne/colonne) ou imprimante étiquettes, **édition différée cumulable par poste**.
- Picking lists (INV015) : préparation commandes clients + préparation accessoires VN.

## M6 — Ventes & POS
**Rôle** : comptoir + cycle devis→facture.
- **POS** : scan, client de passage ou fiche, lignes avec casier affiché, remises ligne + pied (PDV006), encaissement multi-modes (PDV001), terminal connecté (PDV002), ticket par mail (PDV003), **QR de paiement EPC** (PDV004/VEN010), Stripe pour paiements en ligne (VEN011), **détaxe clients étrangers** (PDV005 — drapeau client + TVA 0% export + mention légale), **fond de caisse ventilé par coupure** (PDV007), clôture Z quotidienne (PDV008), remises en banque + arrondis (PDV009), suivi cash Bpost plaques.
- **Devis/commandes véhicules** : configurateur moto + accessoires + image sur l'offre (VEN004), acompte exigible pour valider (VEN002/VEN009), signature électronique (VEN003), relances auto templatées (VEN001), encours/limite de crédit (M1).
- **TVA sur marge VO** (VEN006/COM006, B2) : régime automatique selon type O ; base = marge ; mentions légales ; registre des VO. TVA 21% pour type P. Validation comptable obligatoire avant go-live.
- Fiches A6 (VEN005, dev) → générées par M9.
- Visibilité paiements pour vendeurs (VEN013) : statut financier du client sur devis/commande + notification à réception du paiement.
- Documents de financement sur la fiche (VEN014).
- Tableau de bord commercial quotidien (VEN012) → M13.

## M7 — Reprise / Occasion / Dépôt-vente
**Rôle** : le flux B3 complet — la mécanique de rentabilité que le GAP sous-spécifie.
- **Reprise** : référence type R (REP-) → évaluation (formulaire interne ou portail VEN016) → document de reprise signé (DOC005) → **création automatique de l'article occasion (type O ou P) + de la fiche véhicule + ouverture d'un ORO** (ordre de remise en état) dont pièces et MO s'imputent au **coût de revient du véhicule**, pas en charge atelier. Rentabilité réelle (VEH006) = PV − (prix de reprise + ORO + frais).
- **Dépôt-vente** (type D, DEP-) : contrat avec conditions et **commission** (VEN008, dev), le véhicule n'entre pas en valorisation de stock (il appartient au client), reversement vendeur à la vente, commission facturée.
- Référencement auto OCC- / DEP- (VEN007).
- **Cessions internes typées** (angle mort + ATE020) : cession VN démo, cadeau, fournitures atelier, garantie — sorties valorisées non facturables, tracées pour les stats et la marge.

## M8 — Atelier
**Rôle** : les 24 exigences ATE + le cycle OR G8 (B8).
- **RDV en ligne** (ATE001) : page publique/QR, champs obligatoires VIN + 1ère immat + coordonnées → file de validation opérateur → planning + mail de confirmation.
- **Planning** (ATE002) : calendrier par mécanicien (3), capacité h ou %, code couleur par statut (ATE010), drag & drop. **Synchro Outlook bidirectionnelle** (ATE003) via Microsoft Graph API.
- **OR digital** : chaîne RDV→client→véhicule→intervention (ATE004) ; réception avec **photos** (ATE007) + fiche de réception digitale signée (DOC003) remplaçant le papier ; **signature client sur l'OR** + envoi auto (ATE008) ; lignes pièces (réservation stock auto, casiers affichés), MO, forfaits/kits (ATE013) ; **notes internes invisibles client** (ATE012) ; textes prédéfinis.
- **Devis complémentaire en cours d'intervention** (ATE009) : lien envoyé au client → validation + signature + paiement en ligne (Stripe) → lignes injectées dans l'OR.
- **Checklists par modèle** (ATE011, dev) + **nomenclatures d'entretien auto par modèle × kilométrage** (ATE014, dev) : table maintenance_schedules → proposition automatique des lignes à la création de l'OR.
- **Chronos** (ATE015, B11) : les 3 étages G8 — pointage présence, temps par fiche de travail, **rapprochement temps passé vs temps facturé** ; saisie start/stop sur tablette atelier.
- **Garanties** (ATE016, B10) : OR garantie Ducati ou magasin, dossier PDF avec photos (DOC002), workflow acceptation / refus total / **refus partiel avec re-routage des lignes** (vers facture client ou cession), **facturation interne des coûts de garantie** (ATE020, dev).
- Statuts + notifications : mail/SMS automatiques au changement de statut, envoi programmable (ATE018), rappels RDV (ATE006).
- **Courtoisie & démo** (ATE005, ATE021-022) : parc dédié (statut véhicule), attribution depuis l'OR, planning des essais démo, **contrat d'essai signé** (DOC004) avec copie permis.
- Upselling (ATE023) : recherche accessoires en stock depuis l'écran mécanicien.
- OR accident/assurance (angle mort) : tiers payeur (assureur/expert) sur l'OR, facturation partagée client/assurance.
- Recherche VIN → historique complet (ATE017).

## M9 — Documents & signatures
**Rôle** : 7 dev sur 9 — quasi tout en spécifique, donc tout chez nous en natif.
- **Générateur PDF templaté** (edge function) : demande de COC (DOC001), dossier garantie avec photos (DOC002), fiche de réception (DOC003), contrat d'essai (DOC004), fiche de reprise (DOC005), **attestation bridage/débridage** (DOC006 — obligation permis A2, lien fiche véhicule + permis client), fiche A6 vitrine (VEN005), contrat dépôt-vente, contrat vente particulier-à-particulier, ticket/facture.
- **Signature électronique** : canvas tactile (tablette comptoir/atelier), horodatage, hash du document, archivage Storage, envoi auto au client.
- **GED** : documents liés à client/véhicule/dossier financement (DOC007, VEN014), alias mail d'archivage (DOC008 — inbound parse → rattachement auto).
- **Portails publics** (VEN015-016) : lien unique par dossier — financement (upload CNI, fiches de paie, avertissement-extrait de rôle…) et reprise (descriptif champs obligatoires, photos 4 faces + points imposés, COC, certificat immat, factures) avec checklist de complétude → création du dossier dans M7.

## M10 — CRM & marketing
**Rôle** : tout ce que G8 n'a jamais eu — la valeur perçue de la migration.
- Pipelines distincts (CRM005) : essai / VN / VO / pièces-accessoires / atelier, étapes paramétrables, relances auto + rappels vendeurs (CRM006, VEN001).
- **Leads automatiques** (CRM003) : formulaires web (SIW003), bornes (CRM007), **emails entrants classifiés par IA** (CRM004) — Claude API : type de demande + modèle d'intérêt + extraction coordonnées + brouillon de réponse.
- **Chatbot/IA proforma** (CRM008, dev) : demande de référence → vérification stock → devis proforma envoyé automatiquement (avec garde-fou : validation humaine paramétrable).
- **Matching "agence immobilière"** (CON007, dev) : à l'entrée d'un véhicule en stock, croisement avec les critères clients → tâches vendeurs + mails automatiques aux clients matchés.
- Marketing (MKT001-008) : campagnes email + analytics d'intérêt (Brevo), publication multicanal, réseaux sociaux, **publication auto des occasions sur plateformes externes** (MKT006, dev — AutoScout24 API pro ; 2ememain/Marketplace : génération du contenu d'annonce + flux semi-auto), WhatsApp (API Business), chatbot site.
- Salesforce (CRM002, à clarifier) : pas d'API exposée par Ducati → écran "fiche Salesforce" copiable + export CSV au format attendu. Limitation documentée et assumée.

## M11 — Site web & e-shop
**Rôle** : vitrine charte Ducati + e-commerce sur la MÊME base (INV010 = gratuit par construction).
- Pages : équipe (SIW001), événements (SIW002), galerie (SIW004), occasions/neuves avec fiches véhicules, analytics (SIW007).
- **Formulaires personnalisés** (SIW003, dev) : contact, RDV atelier, demande commerciale, financement, reprise → branchés directement sur les workflows (leads M10, RDV M8, portails M9).
- E-shop (SIW005) : catalogue articles publiables, stock temps réel, panier, paiement Stripe, commandes → flux M6 ; catalogues tiers (SIW008, à clarifier) : via le moteur d'import M2 + flag "publiable e-shop".
- Charte Ducati (SIW006) : police et guidelines fournies par le client.

## M12 — Compta & exports
**Rôle** : produire des données comptables irréprochables, sans tenir les livres.
- **Multi-société** (COM005) : journaux séparés ITALBIKE / NL INVEST, facturation inter-sociétés.
- Journaux de ventes/achats/caisse exportables (CSV + format logiciel du comptable), lettrage de paiements (COM001), OCR factures fournisseurs (COM002, via M4), relances impayés automatiques avec escalade (COM003 — 3 rappels puis génération du courrier recommandé), **factures UBL/Peppol** (obligation belge B2B 2026) via access point (Billit/Recommand).
- TVA : déclaration préparatoire par taux et régime (21%, marge, intracom, export), **registre TVA marge des VO** (B2).

## M13 — Reporting & dashboards
- Commercial quotidien (VEN012) : CA, encaissements, devis en cours, relances dues.
- **Productivité atelier** (ATE019, B11) : heures pointées vs facturées par mécanicien, retards, taux d'occupation, coûts garantie (ATE020).
- Stock : valorisation, rotation, ruptures, invendus, **rotation lente véhicules > 4 mois** (VEH008).
- Véhicules : marge réelle par VIN (VEH006), stock VN/VO/dépôt.
- Compta (COM004) : entrées/sorties, impayés, multi-société consolidé.
- Manager IA (bonus) : digest quotidien Claude API — retards atelier, pièces reçues débloquant des OR, leads chauds non traités sous 48h.

## M14 — Migration G8
**Rôle** : LE chantier qui fait réussir ou échouer la bascule. Module d'import dédié avec dry-run et rapports.
- Contacts (CON005) : mapping champs G8 → M1 (drapeaux, encours, permis).
- Articles (INV014) : types de gestion, équivalences, casiers, PAMP, mini/maxi, codes-barres + catalogues Ducati en librairie.
- Véhicules (VEH010) : parc complet avec historique propriétaires et réparations.
- À arbitrer avec le client (non listé au GAP) : OR clôturés (historique), mouvements de stock historiques, encours/soldes clients, **documents ouverts au jour J** (OR en cours, devis, commandes, réservations) — stratégie de bascule : week-end de migration, double saisie 0 jour, G8 en lecture seule 6 mois.

---

# 3. OUTILS À CONNECTER (Supabase + Lovable)

| Outil | Sert à | Modules | Quand le connecter |
|---|---|---|---|
| **GitHub** | repo, branches, PR, CI — pont Lovable ↔ Claude Code | tous | Jour 1 |
| **Supabase** | PostgreSQL, Auth, Storage (photos/PDF), Edge Functions, Realtime (planning, notifications), pg_cron (alertes 4 mois, relances) | tous | Jour 1 |
| **Resend** | mails transactionnels (confirmations RDV, notifications statut, relances) + inbound parse pour les alias d'archivage DOC008 et leads mail CRM003 | M8, M9, M10 | Epic 2 |
| **Brevo** | campagnes newsletters + analytics d'intérêt (MKT001-002) | M10 | Epic 10 |
| **Twilio (ou smsmode)** | SMS rappels RDV et fin de travaux | M8 | Epic 7 |
| **Stripe** | paiements en ligne : acomptes devis, devis complémentaires atelier, e-shop (VEN011) — activer Bancontact dans Stripe pour la Belgique | M6, M8, M11 | Epic 6 |
| **Terminal de paiement** | POS comptoir (PDV002) — selon le TPE du client : Stripe Terminal, CCV ou Viva (API cloud) | M6 | Epic 6 |
| **QR EPC** | virement instantané : généré localement (lib qrcode), zéro coût | M6 | Epic 6 |
| **Billit ou Recommand** | access point Peppol — factures UBL B2B (obligation 2026) | M12 | Epic 6 |
| **Claude API (Anthropic)** | OCR factures (M4), classification leads + brouillons (M10), chatbot proforma (CRM008), digest manager (M13) | M4, M10, M13 | Epic 5 puis 10 |
| **Microsoft Graph** | synchro Outlook bidirectionnelle du planning (ATE003) — app registration Azure côté client | M8 | Epic 7 |
| **WhatsApp Business API** (via Twilio ou Meta) | MKT007 | M10 | Epic 10 |
| **AutoScout24 API pro** | publication occasions (MKT006) ; 2ememain/Marketplace en semi-auto | M10 | Epic 10 |
| **SheetJS (lib)** | exports Excel : DCS Ducati (ACH001), inventaires, journaux comptables | M4, M5, M12 | Epic 4 |
| **pdf-lib / pdfmake (lib edge)** | tous les PDF de M9 | M9 | Epic 8 |
| **VIES (API gratuite UE)** | validation TVA intracom (CON003) | M1 | Epic 2 |
| **n8n (optionnel)** | orchestrations marketing exotiques si besoin — tu maîtrises déjà | M10 | au besoin |

À NE PAS connecter : Salesforce (pas d'API côté Ducati), DIV (coût), DCS (fermé — on passe par l'export Excel), 3CX (projet télécom séparé ; prévoir juste un champ "log d'appel" sur le contact pour plus tard).

---

# 4. PLAN CLAUDE CODE — build complet en un seul go-live

## 4.0. Lecture honnête de "tout d'un coup"
Tout le périmètre est dans le build (y compris l'ex-"phase 2" web/marketing) et il n'y a qu'UN go-live. Mais Claude Code construit séquentiellement : l'ordre des epics ci-dessous est un ordre de **dépendances techniques**, pas un phasage commercial. Chaque epic se termine par des critères d'acceptation vérifiables — c'est ce qui t'évite de découvrir en semaine 12 que le stock est faux. Ordre de grandeur réaliste pour un solo builder outillé Claude Code : 10-14 semaines de build + 2-3 semaines de migration/recette/formation. C'est compétitif face aux 16 semaines/67 j-h de Zenor, à périmètre PLUS large (ils reportaient 27 exigences en phase 2).

## 4.1. Mise en place du repo (Jour 1)
```
/CLAUDE.md                  ← règles du projet (voir 4.2)
/docs/
  cahier-fonctionnel-v2.md  ← le document des 140 refs + annexes A et B (tel quel)
  charte-graphique.md       ← design system Ducati (tel quel) — source de vérité visuelle
  dossier-projet.md         ← ce document
  decisions/ADR-xxx.md      ← une note par décision d'architecture
/public/fonts/              ← les 8 .ttf Ducati Style (Ext_Rg, Ext_Bd, Rg, Bd, XBd, Cond_Rg, Cond_Bd, Cond_XBd)
/src/styles/tokens.css      ← toutes les variables CSS de la charte (§2-3), seul endroit où des couleurs/typos sont définies
/supabase/migrations/       ← schéma versionné
/supabase/functions/        ← edge functions (pdf, ocr, notifications, imports, matching)
/src/                       ← app Lovable (React)
  /modules/{contacts,articles,vehicles,purchases,stock,sales,tradein,workshop,documents,crm,web,accounting,reports,migration}
/seed/                      ← données de démo réalistes
/tests/                     ← tests des règles critiques
```

## 4.2. CLAUDE.md — les règles à graver (résumé, à développer dans le repo)
1. Langue : UI et données en FR, code en EN. Glossaire métier obligatoire (OR, ORO, PAMP, arrêté, VIN, TVA marge, dépôt-vente, REP, COC, DCS, librairie, casier).
2. Toute table porte `company_id` ; RLS active partout ; rôles définis en M0.
3. **Stock et prix : jamais d'UPDATE direct** — tout passe par `stock_moves` / `price_changes` (append-only) ; le stock réel est une somme, pas un champ.
4. Tout document a `status` + table `events` (B7).
5. Les invariants B1-B12 de l'Annexe B sont des contraintes de conception : toute PR qui les viole est refusée.
6. Chaque exigence implémentée référence son code (ex. commit "feat(workshop): devis complémentaire ATE009").
7. Tests obligatoires sur : PAMP, TVA marge, réservations, arrêté/réintégration, encours crédit, imputation ORO.
8. Seed data dès l'epic 1 : 2 sociétés, 20 clients, 300 articles (tous types A-R), 12 véhicules, 5 OR — pour démos permanentes.
9. **Design : `/docs/charte-graphique.md` est la source de vérité visuelle.** Toutes les couleurs/typos viennent de `/src/styles/tokens.css` — aucun hex ni font-family en dur dans les composants. Le rouge Ducati est réservé aux actions primaires/identité, jamais aux statuts (impayé = `--danger`). Tout statut = couleur + icône + libellé. Densité Cond dans les tableaux, tabular-nums sur tous les montants, anti-patterns du §9 de la charte refusés en PR (pas de dégradés, pas de camemberts multicolores, radius ≤ 8px, pas d'emojis dans l'UI).
10. **i18n dès le jour 1** : tous les libellés UI passent par un dictionnaire FR (clé → texte), structure prête pour le NL (exigence charte §8 — Bruxelles). Pas de chaînes en dur dans les composants.

## 4.3. Les 12 epics (ordre de dépendances)

**EPIC 0 — Socle (M0) + design system** — sem. 1
Schéma complet (toutes les tables de tous les modules, même vides), auth + rôles + RLS, multi-société, séquences, events, recherche globale, seed.
**Design system d'abord** : `tokens.css` complet (couleurs §2, typo §3, espacements §4 de la charte), `@font-face` des 8 .ttf Ducati + JetBrains Mono (npm), composants de base (boutons 5 variantes, inputs, badges statut icône+libellé, tableau dense Cond avec tri/filtres/sélection, modal, toast, skeleton, état vide), layout topbar 56px + sidebar noire 240px repliable avec barre rouge 3px sur l'item actif, recherche globale Ctrl+K avec reconnaissance VIN/TVA. C'est l'epic qui rend toutes les démos suivantes crédibles face au client.
✅ Acceptation : login par rôle, bascule de société, recherche d'un VIN seed via Ctrl+K, audit visible ; un écran de démo affiche chaque composant de la charte (boutons, badges, tableau 50 lignes en Cond, KPI tabular-nums) et passe le contraste AA ; zéro hex en dur hors tokens.css.

**EPIC 1 — Contacts + Articles (M1, M2)** — sem. 1-2
Fiches complètes, types de gestion, équivalences, moteur d'import tarifs avec les 12 règles, listes de prix, encours/limite de crédit, validation VIES.
✅ Import d'un tarif Ducati de test : coefficient conservé, PV jamais baissé, remplacées → équivalences, rapport d'anomalies.

**EPIC 2 — Véhicules (M3)** — sem. 2-3
Fiche VIN complète, statuts parc, historique propriétaires, GED, lien articles V/O/P/D ↔ véhicules.
✅ Créer un VIN, le retrouver par recherche globale, changer de propriétaire avec historique.

**EPIC 3 — Achats & réceptions (M4)** — sem. 3-4
Réception pièces (scan + facture), routage CLIENT/OR/STOCK + notifications, réception châssis → fiche véhicule auto, propositions et commandes fournisseurs, **export DCS Excel standard/urgente**, OCR factures.
✅ Réceptionner la facture Ducati de test (Monster V2) : PAMP recalculé, fiche véhicule créée, échéance fournisseur enregistrée ; générer les 2 Excel DCS.

**EPIC 4 — Stock & inventaire (M5)** — sem. 4-6 (le plus dense)
Mouvements, triple stock, copies datées, réservations, mini/maxi, casiers, les 8 méthodes d'inventaire, arrêté + 3 modes de réajustement + réintégration, écarts, tournant, dépréciation, invendus, ruptures, étiquetage complet, pickings.
✅ Scénario G8 complet : générer un arrêté magasin ouvert, vendre pendant l'inventaire, réajuster par casier, réintégrer — le stock final est juste. Éditer des étiquettes en différé cumulé.

**EPIC 5 — Ventes & POS (M6)** — sem. 6-7
POS complet (fond de caisse, Z, détaxe, QR, terminal, Stripe), devis véhicule configuré, acomptes, signature, TVA marge + registre VO, encours, relances.
✅ Vendre une occasion type O : TVA calculée sur la marge seule, registre alimenté ; clôture Z avec ventilation par coupure ; facture UBL générée.

**EPIC 6 — Reprise/Occasion/Dépôt-vente (M7)** — sem. 7-8
Flux REP → article O/P + fiche véhicule + ORO ; imputation remise en état au coût de revient ; rentabilité par VIN ; dépôt-vente avec commission ; cessions internes typées.
✅ Reprendre une moto 6 000 €, imputer 800 € d'ORO, la vendre 8 500 € : marge affichée 1 700 €, TVA sur 2 500 €.

**EPIC 7 — Atelier (M8)** — sem. 8-10
RDV en ligne + validation, planning 3 mécaniciens + couleurs + Outlook, OR complet (photos, signature, notes internes, kits, checklists, nomenclatures modèle×km), devis complémentaire avec paiement, chronos 3 étages, garanties avec refus partiel, courtoisie/démo + contrat d'essai, notifications statut, OR assurance.
✅ Cycle complet : RDV web → OR signé sur tablette → devis complémentaire validé et payé à distance → pièce manquante reçue (alerte M4) → travaux → notification programmée → facture. Rapport heures pointées vs facturées correct.

**EPIC 8 — Documents & portails (M9)** — sem. 10-11
Les 10 templates PDF, signature canvas, GED, alias mail, portails financement + reprise avec checklist.
✅ Générer chaque document avec données seed ; un client dépose son dossier de reprise via le portail → dossier créé dans M7.

**EPIC 9 — CRM & matching (M10 cœur)** — sem. 11-12
Pipelines, leads multi-sources, classification IA des mails, chatbot proforma avec garde-fou, **matching critères clients à l'entrée d'un véhicule**, borne showroom.
✅ Entrer une Panigale V2 d'occasion en stock → les 3 clients seed matchés reçoivent un mail + le vendeur une tâche.

**EPIC 10 — Web & marketing (M11 + M10 marketing)** — sem. 12-13
Site charte Ducati, e-shop branché stock, formulaires → workflows, Brevo, réseaux sociaux, publication occasions, WhatsApp.
✅ Commander un casque sur l'e-shop décrémente le stock magasin instantanément ; formulaire RDV web → file M8.

**EPIC 11 — Compta & reporting (M12, M13)** — sem. 13-14
Journaux multi-société, exports comptable, lettrage, relances impayés escaladées, TVA préparatoire, tous les dashboards, digest IA.
✅ Le comptable du client valide un export mensuel de test ; le dashboard atelier reproduit les indicateurs G8 connus du client.

**EPIC 12 — Migration & go-live (M14)** — sem. 14-16
Imports G8 (contacts, articles, parc, historiques) en dry-run répétés, rapports d'écarts, recette sur les 140 refs (voir §5), formation, bascule week-end, G8 en lecture seule.
✅ Checklist de recette signée, stock G8 = stock DMS au centime près au jour J.

## 4.4. Méthode de travail avec Claude Code
- Une branche par epic, une PR par fonctionnalité, référence d'exigence dans chaque commit.
- Prompt type par epic : "Lis /docs/cahier-fonctionnel-v2.md sections X + Annexe B invariants Y. Implémente [exigences]. Respecte CLAUDE.md. Écris les tests de [règles critiques]. Mets à jour /docs/avancement.md."
- `/docs/avancement.md` : tableau des 140 refs avec statut (à faire / en cours / fait / recetté) — généré et tenu par Claude Code, c'est TON tableau de bord (§5).
- Toute ambiguïté = ADR courte + question dans la liste "à valider client", jamais une supposition silencieuse.

---

# 5. PLAN DE SUIVI & D'EXPLICATION CLIENT

## 5.1. Ton tableau de bord (3 artefacts, pas plus)
1. **`/docs/avancement.md`** — les 140 refs + les 12 invariants + les 10 angles morts, chacun avec statut et lien de démo. C'est à la fois ton suivi ET ta checklist de recette contractuelle. Avantage décisif : tu recettes le projet dans le langage exact du GAP analysis que le client connaît déjà.
2. **Démo hebdo de 30 min** — chaque vendredi, le scénario d'acceptation de l'epic en cours, sur les données seed, en visio ou au magasin. Le client voit du concret toutes les semaines (réponse directe au risque n°1 de Zenor : la disponibilité — 30 min/semaine, pas des ateliers de 2 jours).
3. **Liste "à valider client"** — les points que le cahier marque "à voir en magasin" : mode opératoire d'inventaire réel (ouvert/fermé ?), usage des fonctions G8 de la section 4 (ORO, cessions, tournant, OR assurance, fabrication), format exact des Excel DCS, niveau d'étiquetage, TPE en place, logiciel du comptable. À purger dans les 3 premières semaines, pendant que les epics 0-2 tournent.

## 5.2. Jalons de présentation client (5 rendez-vous structurants)
| Jalon | Semaine | Ce que le client voit | Message |
|---|---|---|---|
| Kick-off | 0 | Ce dossier + le visuel d'architecture | "Tout votre G8, plus tout votre cahier des charges, en un seul outil, un seul go-live" |
| Démo référentiels | 3 | Sa base clients/articles migrée en dry-run, import tarif Ducati | "Vos données vivent déjà dedans" |
| Démo cœur métier | 8 | Réception châssis → vente TVA marge → reprise avec ORO → rentabilité par VIN | "Ce que ni G8 ni Odoo ne montrent : la marge réelle de chaque moto" |
| Démo atelier | 11 | Cycle OR complet sur tablette, du RDV web à la facture | "Vos mécaniciens pointent, vos clients signent, vous voyez le rendement" |
| Recette & formation | 15-16 | Checklist 140 refs cochée, formation par rôle | "On bascule" |

## 5.3. Comment l'expliquer simplement (ton script)
- **L'image** : "Trois fichiers au centre — vos clients, vos motos, vos pièces. Quatorze modules autour qui les font travailler ensemble. Une seule base : quand une pièce sort au comptoir, l'e-shop le sait à la seconde."
- **vs G8** : "On garde tout ce qui fait que G8 marche pour vous — types d'articles, PAMP, arrêté d'inventaire, ORO, chronos — et on ajoute tout ce qu'il n'a jamais eu : CRM, signatures, photos, portails, e-shop, IA."
- **vs Odoo/Zenor** : "Leur propre analyse dit 34 développements spécifiques et reporte 27 exigences en phase 2. Leur risque n°2 admet qu'ils ne peuvent pas recréer G8. Nous, on livre les 140 d'un coup, on réplique G8 là où il est bon, et le récurrent n'explose pas avec le nombre d'utilisateurs ni les lignes de code (chez eux : 2 licences incluses et 16€/100 lignes de custom/an)."
- **Les 3 chiffres à retenir** : 140 exigences couvertes / 1 go-live / coût récurrent fixe.

## 5.4. Risques à garder à l'œil (les tiens, pas ceux de Zenor)
1. **TVA marge + multi-société** : faire relire les flux par le comptable du client AVANT l'epic 5, pas après.
2. **Migration** : exiger les exports G8 complets dès la semaine 1 (Futurosoft peut être lent/payant sur les extractions — anticiper).
3. **Périmètre total d'un coup** = pression sur la recette : la checklist des 140 refs est ta protection contractuelle ; tout ajout hors refs = avenant.
4. **Solo builder** : les epics 4 (stock) et 7 (atelier) sont les plus denses — ne pas paralléliser avec autre chose ces semaines-là.
5. **Dépendances client** : accès Azure (Outlook), TPE, compte Stripe, exports G8 — liste à obtenir au kick-off. Charte graphique et fontes Ducati : ✅ déjà en main (déposer les 8 .ttf dans `/public/fonts/` avant l'epic 0).

## 5.5. Correspondance navigation ↔ modules (pour cohérence charte/dossier)
La sidebar définie dans la charte (§4.1) regroupe les 14 modules ainsi : Dashboard → M13 · Véhicules → M3+M7 · Atelier & SAV → M8 · Pièces & Accessoires → M2+M4+M5 · Ventes & Facturation → M6 (devis/factures) · Clients (CRM) → M1+M10 · Caisse → M6 (POS) · E-shop → M11 · Rapports → M13 (exports compta M12) · Paramètres → M0 (+ M14 Migration, visible admin uniquement). Le breakpoint "tablette atelier" (768-1023px) de la charte correspond aux écrans mécaniciens de M8 (chronos, OR, planning jour) et à la signature client de M9.
