# Extraction des champs G8 (manuels Fichiers/Stock + captures)

> Référence interne pour compléter les modules. Source : `docs/reference-g8/` (manuels G8,
> captures Fiche Client / Identification Véhicule). Tenu par Claude Code lors de l'Epic 1.

## M1 — Fiche CLIENT (capture `Fiche Client sur G8.JPG`)

Champs G8 **à ajouter** à notre table `contacts` :
- **`code`** — code client (carte d'identité de la fiche).
- **`statut`** — Prospect / Client (cycle de vie commercial, distinct du `type`).
- **`is_blocked`** (Client bloqué) — blocage facturation.
- **`mode_ht`** (Mode H.T.) — facturation hors taxe par défaut.
- Adresse : **`address_complement`** (complément), **`po_box`** (boîte postale),
  **`address_mismatch`** (N'habite pas à l'adresse indiquée).
- **`marketing_opt_out`** (Opposé au marketing direct — RGPD).
- **`price_list`** (Tarif — grille tarifaire nommée) + **`category`** (Catégorie client) —
  plus fin que notre `segment` standard/vip.
- POS : **`receipt_copies`** (nb d'exemplaires en caisse), **`show_discounts_pos`** (afficher remises).
- Compta : **`accounting_account`** (compte comptable), **`domiciliation`**, **`bic`**,
  **`factoring_code`** (code affacturage), **`payment_terms`** en liste (déjà en texte).
- TVA : **`sale_type`** = intracommunautaire / exportation (radio) — en plus de `vies_valid`.
- Encours : `encours_autorisé` = notre `credit_limit` ✅ ; `solde`/`encours_actuel` = **calculés** (M6).

Onglets G8 (sous-objets, à modéliser au fil des epics) : **Contacts** (sous-contacts), **Adresses
de livraison**, **Parc** (véhicules → M3), **Relances** (M12), **Groupes**, **Histo Email/SMS** (M10),
**Documents/GED** (M9), **Pièce d'identité** (M9).

## M2 — Fiche ARTICLE (manuel Fichiers §1.2, Stock)

Champs G8 **à ajouter** à notre table `articles` :
- **`descriptif`** (texte long) + **`show_descriptif_on_documents`**.
- **`note`** (note courte, distincte du descriptif).
- **`size`** (Taille, liste), **`color`** (Couleur).
- **`weight_volume_length`** + **`measure_unit`** (poids/volume/longueur + unité).
- **`eco_tax_ttc`** (DEEE / Éco-participation) + **`deee`** (flag).
- **`sale_price_ht`** (PVHT — on ne stockait que le TTC ; G8 garde les deux + coef).
- Compta : **`sales_account`** (compte vente) + **`purchase_account`** (compte achat).
- **Multi-casier** : remplacer `bin_location text` par une table fille **`article_bins`**
  (casier + qté par casier — base du réajustement par cumul, B6).
- **`origin_reference_id`** (Référence d'origine — lien grossiste↔fournisseur principal,
  distinct de `equivalence_group`).
- Dates métier : **`last_sold_at`**, **`last_purchased_at`**, **`last_tariff_at`**.
- **Onglet Reprise** (types R/P) : préfixe + fournisseur/rayon/sous-rayon/catégorie de
  rattachement des occasions générées (config de reprise, flux B3).
- **Kit** : ajouter le **mode de facturation** sur l'article kit — `forfait` (1 ligne, prix global)
  vs `nomenclature` (détail ligne par ligne).
- **Type de gestion `T` = Main d'œuvre** (présent dans G8, ABSENT de notre enum A–R) → **ADR à trancher**.

Champs **calculés** (ne PAS stocker, dériver de `stock_moves` en M5, règle 3) : stock réel/disponible/
arrêté, cde fourni, cde client, valeur stock, marges PAHT/PAMP.

Patterns d'articles spéciaux G8 (comportements POS, pour M6) : réf. `+x` = % du total ;
réf. `*coef` = coefficient fixe saisi en caisse ; `F`/`LB` = lignes texte ; `FRAIS_BL` = majoration.

Familles : **Rayon → Sous-rayon → Catégorie** (3 niveaux, codes numériques 99/99/99, portent les
comptes comptables de vente). Notre `article_categories` (parent_id) le permet ; rattacher les comptes.

## M3 — Fiche VÉHICULE (capture `Identification Véhicule Moto`) — pour Epic 2

Identification : n° de série (VIN), référence, marque, modèle, immatriculation, **type mine**,
type/variante/version, **genre**, n° moteur, immat WW, marquage/origine, date marquage, code production,
n° de clé, assurance, n° de formule.
Caractéristiques : cylindrée, **puissance Kw**, **bridé (35KW/FULL)**, énergie, **puissance fiscale**,
**norme antipollution**, couleur + code couleur, type de segment, **ID tracker GPS**, catégorie,
nb de cylindres, autonomie, n° batterie, **TPMS AV/AR**.
Infos suppl. : **date de mise en circulation**, **date prochain CT**, kilométrage, nombre d'heures,
**n° de clé ×2**, **code antidémarrage**, année modèle, **n° livre de police**, garantie + **fin garantie**.

## Compléments issus des captures `infos app/` (37 écrans G8)

### M1 — encore à compléter
- **Statut à 4 valeurs** : `Client pièce` / `Client atelier` / `Client` / `Prospect` (pas seulement prospect/client).
- **3 téléphones** : Téléphone / Portable / **GSM** (on n'a que phone+mobile).
- **Adresse éclatée** : N° rue, Rue, **Complément**, **Complément 2**, Boîte postale (2 lignes de complément).
- **Civilité = entité paramétrable** portant le flag **Professionnel** (SPRL/SA/ASBL… ⇒ B2B). Table M0.
- **Adresse de livraison séparée** (sous-objet — à faire avec M6/M9).
- **Catégorie INTERNET** (origine e-shop) en plus de GENERAL.
- Date de création (auto). Véhicules rattachés affichés sur la fiche (lien M3).

### M2 — encore à compléter
- **P.P.C. HT / P.P.C. TTC** (prix public conseillé constructeur, distinct du PV pratiqué).
- **Prix achat bloqué / Prix vente bloqué** (verrouillage tarif).
- Confirmé déjà couvert : conditionnement, remplacement (`superseded_by`), rayon/sous-rayon/cat,
  flag e-shop (`publishable`), dates dernier achat/vente, fournisseur+réf.
- Marque **typée** (Produit fini / Pneumatique / pièce) — table Marques M0.
- Pseudo-articles préfixés `*` (services : `*1CG` carte grise, `*REPMOTO` reprise) + suffixe `OCC`.

### M0 — tables de paramètres G8 à prévoir (écran « Tables »)
Taux TVA (01=21%, 04=intracom, 05=export…), Modes de règlement (dont **REPRISE MOTO**, visible-caisse O/N),
Conditions de règlement, **Types de cession** (CESSION VO/VN, besoin atelier, vol/casse, garantie
fourn./magasin, geste commercial — comptabilisée O/N → cessions internes B10), Catégorie client,
**Civilités** (flag pro), **Marques** (typées), Opérations atelier (checklist), Tailles, Couleurs,
**Tâches atelier hors facturation** (productivité B11), **Catégorie produit fini** (gammes Ducati :
Panigale/Monster/Multistrada/Scrambler/DesertX…), Code exposition, Pays, Organisme de financement,
**Cabinets d'assurance**, **Experts assurance**, Nature produit fini, Entête remises en banque,
Mouvement fond de caisse.

### M3 / M8 — fiche véhicule & OR (captures Parc + OR)
Parc : états **VENDU NEUF / RÉPARÉ / VENDU D'OCCASION** + filtres En stock/En commande/Repris ;
**N° livre de police**, **marquage** antivol, code expo, **QR MyMeca / www.MyMeca.info**, châssis,
n° clé, 1ère M.C. OR : onglets **Produit fini / Assurance / Garantie** ; champs alignés **carte grise
belge** (repères A/B/D.1/E/P.1/P.2/P.3/V.9), case **Bridé** (A2), **GPS/PIN Tracker**, **TPMS AV/AR**,
kilométrage **N.C./Réel/N.G.**, fin garantie, année modèle. **Planning** hebდo par compagnon avec
**taux de charge %** (B11).

### M4 — fournisseurs (capture Gestion fournisseurs)
Code, raison sociale, ville/pays, tel/tel2/fax, email, **compte comptable**, contact, **franco de port**,
**minimum de commande (montant + quantité)**, **N° client achat** (notre n° chez le fournisseur).
Canal **DUCATI WEST EUROPE** = source DCS (aucun écran d'export DCS capturé → à confirmer client).

### M6 — types de documents de vente (menu Ventes)
**Express** (vente rapide), **Facture**, **Réservation/Commande**, **Livraison BL**, **Proforma/Devis**,
**Réparation OR**, **Acompte direct** ; chaque type a son « Rappel » (reprise). Encaissements : multi-échéances,
multi-modes, **TPE**, **ouverture tiroir**, rendu monnaie, paiement partiel. Édition de **chèque** fournisseur.

### M12/M13 — journaux (capture Journaux ventes/encaissements)
Journaux paramétrables : liste factures (+règlements), encaissements par mode/famille/opérateur, récap
journée/mois, journal de caisse, **ventilation TVA** simplifiée/par famille, ventilation mensuelle,
détail ventes par référence, historique recette caisse. Option éditer marges. Récap par facture (HT/TTC/TVA).

## M5 — STOCK (manuel Stock) — pour Epic 4

Triple stock (réel/arrêté/disponible) + copies datées (15 et fin de mois). **Arrêté d'inventaire** :
génération → réajustement (3 modes : annule-remplace / cumul / par casier) → réintégration unique →
effacement. **8 méthodes d'inventaire** = 8 éditions (par rayon/fournisseur · produit fini V/O ·
par casier · par référence · écart d'inventaire · dépréciation/invendus · tournant · comptage), chacune
avec base réel/arrêté/date/comptage et sortie visualiser/imprimer/Excel. **Dépréciation** par fourchette
de dates d'entrée + taux → baisse PAMP (effet compta uniquement). **Étiquetage** : qté défaut = stock réel,
avec/sans code-barres, avec/sans prix, immédiat ou différé cumulable par poste.
