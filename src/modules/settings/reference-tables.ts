/**
 * M0 — Configuration des tables de paramètres (référentiels G8).
 * Une définition par table_key ; l'éditeur générique s'appuie dessus.
 */
export type RefColType = 'text' | 'number' | 'bool' | 'select';
export type RefColumn = {
  key: string;
  label: string;
  type: RefColType;
  options?: { value: string; label: string }[];
};
export type RefTableDef = {
  key: string;
  label: string;
  group: 'vente' | 'achat' | 'article' | 'vehicule' | 'atelier' | 'autre';
  extraColumns: RefColumn[];
};

export const REFERENCE_TABLES: RefTableDef[] = [
  {
    key: 'vat_rate', label: 'Taux de TVA', group: 'vente',
    extraColumns: [
      { key: 'rate', label: 'Taux %', type: 'number' },
      { key: 'regime', label: 'Régime', type: 'select', options: [
        { value: 'standard', label: 'Standard' }, { value: 'exempt', label: 'Exonéré' },
        { value: 'intracom', label: 'Intracom' }, { value: 'export', label: 'Export' },
        { value: 'marge', label: 'TVA marge (VO)' },
      ] },
    ],
  },
  { key: 'payment_method', label: 'Modes de règlement', group: 'vente',
    extraColumns: [{ key: 'visible_pos', label: 'Visible caisse', type: 'bool' }] },
  // Mouvements de fond de caisse (rattrapage G8 du 18/11/2026, G8 Compta > Comptes mouvements fond de caisse) :
  // sens imposé (entrée / sortie / les deux), TVA comprise dans le montant (achat de consommables 21 %),
  // compte comptable. « Réservé » = posé par la remise en banque (01), masqué à la saisie.
  { key: 'cash_movement_type', label: 'Types de mouvement de caisse', group: 'vente',
    extraColumns: [
      { key: 'direction', label: 'Sens', type: 'select', options: [
        { value: 'in', label: 'Entrée' }, { value: 'out', label: 'Sortie' }, { value: 'both', label: 'Entrée ou sortie' },
      ] },
      { key: 'vat_rate', label: 'TVA comprise %', type: 'number' },
      { key: 'account', label: 'Compte comptable', type: 'text' },
      { key: 'system', label: 'Réservé (remise en banque)', type: 'bool' },
    ] },
  // Banques de remise en banque (G8 : code, domiciliation, BIC, IBAN) : libellé = domiciliation.
  { key: 'bank_account', label: 'Banques de remise', group: 'vente',
    extraColumns: [
      { key: 'iban', label: 'IBAN', type: 'text' },
      { key: 'bic', label: 'BIC', type: 'text' },
    ] },
  { key: 'payment_term', label: 'Conditions de règlement', group: 'vente',
    extraColumns: [
      { key: 'days', label: 'Jours', type: 'number' },
      { key: 'eom', label: 'Fin de mois', type: 'bool' },
      { key: 'lcr', label: 'Géré en LCR', type: 'bool' },
    ] },
  // Mention de validité imprimée sur le PDF (mission 05, carte 8) : code = type de document
  // (DEV, BC…), libellé = texte imprimé (« {date} » = date limite), mois = durée (0 = sans date).
  // Sans ligne pour DEV : « Devis valable 1 mois ». Ligne inactive = aucune mention.
  { key: 'sales_document_validity', label: 'Validité des documents (PDF)', group: 'vente',
    extraColumns: [{ key: 'months', label: 'Durée (mois)', type: 'number' }] },
  // Type proposé à l'ouverture de l'éditeur de vente (mission 08, carte 3) : code = DEV, BC, RES,
  // BL, FAC ou TIK ; la première ligne active compte. Sans ligne : « Devis / proforma ».
  { key: 'sales_default_doc_type', label: 'Type de document par défaut (Ventes)', group: 'vente', extraColumns: [] },
  // TVA sur la marge des occasions (B2, M-89) : code = réglage, libellé = valeur. Codes lus :
  // `rate` (21), `period` (month | quarter = période de déclaration), `grid_sales` (00),
  // `grid_base` (03), `grid_vat` (54), `winbooks_vat_code` (code TVA de l'OD, ex. MARGE),
  // `winbooks_journal` (OD). Grilles et code TVA à confirmer par le comptable.
  { key: 'vat_margin_settings', label: 'TVA marge (occasions) — réglages', group: 'vente', extraColumns: [] },
  // Dépôt-vente (rattrapage G8 du 18/11/2026, VEN008) : code = réglage, libellé = valeur. Codes lus :
  // commission_mode (ecart | pourcentage | forfait), commission_pct, commission_fixed, commission_vat_rate (21),
  // deposit_fee, buyer_invoice (oui / non), buyer_vat_rate_particulier (0), buyer_vat_rate_professionnel (21),
  // buyer_mention_particulier / _professionnel ({numero} = n° DEP), commission_invoice, commission_compensation,
  // auto_credit_note (avoir au déposant, G8), distinguish_pro, conditions_particulier / _professionnel, legal_mention.
  // Comptes : Comptabilité → correspondances, dimension « consignment » (+ règlement DEP).
  { key: 'consignment_settings', label: 'Dépôt-vente — réglages', group: 'vente', extraColumns: [] },
  // Facture obligatoire au-delà de 125 € TTC (PDV010, AR n° 1 art. 1er § 2, 9°) : code = début de la
  // famille de l'article (R11, 03-05, « ACCESSOIRES ET EQUIPEMENTS/ACC AGV »…), le plus long l'emporte ;
  // coché = pièce / accessoire / prestation DU VÉHICULE (facture), décoché = équipement du pilote,
  // cadeau (ticket possible). Une moto exige toujours une facture. Préchargement à vérifier avec Domenico.
  { key: 'invoice_required_family', label: 'Facture obligatoire par famille (> 125 €)', group: 'vente',
    extraColumns: [{ key: 'requires_invoice', label: 'Facture obligatoire', type: 'bool' }] },
  { key: 'civility', label: 'Civilités', group: 'autre',
    extraColumns: [
      { key: 'professional', label: 'Professionnel', type: 'bool' },
      { key: 'default', label: 'Par défaut', type: 'bool' },
    ] },
  { key: 'client_category', label: 'Catégories client', group: 'autre', extraColumns: [] },
  // Rattrapage G8 (18/11/2026) : groupes de la fiche client (onglet Groupes, extraction, cascade).
  { key: 'contact_group', label: 'Groupes de clients', group: 'autre',
    extraColumns: [{ key: 'category', label: 'Rubrique', type: 'select', options: [
      { value: 'interets', label: "Centres d'intérêt" }, { value: 'origine', label: 'Origine du contact' },
      { value: 'situation', label: 'Situation familiale' }, { value: 'autre', label: 'Autre' },
    ] }] },
  // RGPD - Purge (G8) : une ligne code « default ». Années sans activité avant purge, et durée
  // légale de conservation des factures (nom, adresse et TVA gardés en deçà).
  { key: 'gdpr_purge', label: 'RGPD - Purge (durées)', group: 'autre',
    extraColumns: [
      { key: 'prospect_years', label: 'Prospects : années sans activité', type: 'number' },
      { key: 'client_years', label: 'Clients : années sans facture', type: 'number' },
      { key: 'legal_years', label: 'Conservation légale des factures (années)', type: 'number' },
    ] },
  { key: 'brand', label: 'Marques', group: 'article',
    extraColumns: [{ key: 'kind', label: 'Type', type: 'select', options: [
      { value: 'produit_fini', label: 'Produit fini' }, { value: 'pneu', label: 'Pneumatique' }, { value: 'piece', label: 'Pièce' },
    ] }] },
  { key: 'rounding', label: "Table d'arrondis (PV)", group: 'article',
    extraColumns: [
      { key: 'up_to', label: 'PVTTC ≤ (0 = ∞)', type: 'number' },
      { key: 'step', label: "Pas d'arrondi", type: 'number' },
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'up', label: 'Tranche supérieure' }, { value: 'nearest', label: 'Au plus proche' },
      ] },
    ] },
  { key: 'color', label: 'Couleurs', group: 'article', extraColumns: [] },
  { key: 'size', label: 'Tailles', group: 'article', extraColumns: [] },
  // G8 « Types de cessions » : comptabilisée (s'impute au coût de revient de la moto), compte, journal.
  { key: 'cession_type', label: 'Types de cession interne', group: 'vente',
    extraColumns: [
      { key: 'accounted', label: 'Comptabilisée', type: 'bool' },
      { key: 'account', label: 'Compte de cession', type: 'text' },
      { key: 'journal', label: 'Journal', type: 'text' },
    ] },
  // Cessions internes / O.R.O (rattrapage G8, 18/11/2026) : code = réglage, libellé = valeur. Codes lus :
  // `cost_basis` (pamp | pa), `auto_archive_on_sale` (oui | non), `auto_open_on_reprise` (oui | non),
  // `reprise_cession_type` (01), `internal_hourly_rate` (coût horaire interne). Aussi modifiables dans
  // Stock → Cessions internes → Réglages.
  { key: 'cession_settings', label: 'Cessions internes — réglages', group: 'atelier', extraColumns: [] },
  { key: 'product_category', label: 'Catégories produit fini', group: 'vehicule', extraColumns: [] },
  { key: 'country', label: 'Pays', group: 'autre',
    extraColumns: [{ key: 'default', label: 'Par défaut', type: 'bool' }] },
  { key: 'exposition_code', label: "Codes d'exposition", group: 'vehicule', extraColumns: [] },
  // M3, registre des vehicules a moteur (AR n° 1 art. 28) : codes de nature d'operation (a confirmer par le comptable).
  { key: 'vehicle_register_nature', label: "Registre des véhicules : natures d'opération", group: 'vehicule', extraColumns: [] },
  { key: 'financing_org', label: 'Organismes de financement', group: 'autre', extraColumns: [] },
  { key: 'insurance_firm', label: "Cabinets d'assurance", group: 'atelier', extraColumns: [] },
  { key: 'insurance_expert', label: 'Experts assurance', group: 'atelier', extraColumns: [] },
  // Type de réparation de l'OR (liste de la fiche OR, ATE001b, 03/11/2026) : code enregistré sur l'OR,
  // préchargé par la migration 20261103230000 (ancienne clé `repair_type`, jamais utilisée, vide en base).
  { key: 'workshop_repair_type', label: 'Types de réparation', group: 'atelier', extraColumns: [] },
  // Motif d'entrée de la moto à l'accueil de l'atelier (check-up, ATE009) : un code commençant par
  // « entretien » (ou « vidange ») pré-remplit les actions du plan d'entretien de la moto.
  // Entretien donné par le motif (mission 10, M-109 / M-110) : il pilote le kit, la réservation des
  // pièces au RDV, le check-up, la picking list et le parcours. Vide = motif sans entretien.
  { key: 'workshop_reason', label: "Motifs d'entrée atelier", group: 'atelier',
    extraColumns: [{ key: 'service_code', label: 'Entretien', type: 'select', options: [
      { value: 'annual', label: 'Entretien annuel (Annual Service)' },
      { value: 'oil', label: 'Entretien annuel + huile (Oil Service)' },
      { value: 'first_1000', label: '1er entretien 1 000 km' },
      { value: 'desmo', label: 'Desmo Service' },
    ] }] },
  // Types de rendez-vous du planning (rattrapage G8 du 18/11/2026, migration 20261118120000) :
  // couleur du type et temps prevu propose a la prise du RDV. Decision Q47 (18/11, comme G8) : la
  // couleur colore le FOND de la case du RDV au planning. Palette FERMEE de tokens --job-* (charte
  // §2.4, lisible en clair et en sombre, rouge Ducati exclu) ; sans couleur = gris neutre.
  { key: 'workshop_appointment_type', label: 'Types de rendez-vous atelier', group: 'atelier',
    extraColumns: [
      { key: 'color', label: 'Couleur de la case au planning', type: 'select', options: [
        { value: 'entretien', label: 'Bleu acier (entretien)' }, { value: 'reparation', label: 'Brique (réparation)' },
        { value: 'garantie', label: 'Violet (garantie)' }, { value: 'pneus', label: 'Vert (pneus)' },
        { value: 'prepa', label: 'Ocre (préparation)' }, { value: 'carrosserie', label: 'Gris (carrosserie)' },
        { value: 'neutre', label: 'Neutre (par défaut)' },
      ] },
      { key: 'default_minutes', label: 'Temps prévu proposé (min)', type: 'number' },
    ] },
  { key: 'workshop_operation', label: 'Opérations atelier', group: 'atelier', extraColumns: [] },
  // Pointeuse (rattrapage G8 du 18/11/2026) : taches improductives pointables (code = tache ;
  // nettoyage atelier, nettoyage motos, entree / sortie motos expo precharges par la migration
  // 20261118110000) et codes mecano (code scanne ou tape a la pointeuse, libelle = nom du mecanicien).
  { key: 'workshop_task', label: 'Tâches improductives (pointeuse)', group: 'atelier', extraColumns: [] },
  { key: 'workshop_mechanic', label: 'Codes mécano (pointeuse)', group: 'atelier', extraColumns: [] },
  // Parcours mecanicien, lot A (19/11/2026, migration 20261119241000) : motifs de la « Pause »
  // (code = motif). Le statut d'OR propose a la pause (attente piece → pieces en commande,
  // attente accord client → attente devis) ; vide = l'OR garde son statut.
  { key: 'workshop_pause_reason', label: 'Motifs de pause (pointeuse)', group: 'atelier',
    extraColumns: [
      { key: 'or_status', label: "Statut d'OR proposé à la pause", type: 'select', options: [
        { value: 'attente_pieces', label: 'Pièces en commande' }, { value: 'attente_devis', label: 'Attente devis / accord client' },
      ] },
    ] },
  // Parcours mecanicien, lot D (19/11/2026, migration 20261119271000) : motifs d'une operation du
  // plan d'entretien marquee « non faite » (code = motif). « Reporter » = cree une intervention
  // reportee sur la moto (relance, date demandee a la facturation), comme une action refusee au check-up.
  { key: 'workshop_op_not_done_reason', label: "Motifs d'opération non faite (atelier)", group: 'atelier',
    extraColumns: [{ key: 'defer', label: 'Créer une intervention reportée', type: 'bool' }] },
  // Frais de devis atelier (mission 02, §1.4) : codes « accident » et « diagnostic ».
  { key: 'workshop_quote_fee', label: 'Frais de devis atelier', group: 'atelier',
    extraColumns: [
      { key: 'amount_ht', label: 'Montant fixe HTVA (accident)', type: 'number' },
      { key: 'hourly_rate_ht', label: 'Tarif horaire HTVA (0 = prix article MO)', type: 'number' },
      { key: 'max_hours', label: 'Heures max (diagnostic)', type: 'number' },
      { key: 'vat_rate', label: 'TVA %', type: 'number' },
    ] },
  // Dossier accident (mission 09 carte 5) : code `to` = destinataire du mail (libellé = adresse),
  // code `cc` = copie facultative (aucune par défaut, décision client du 03/11/2026).
  { key: 'accident_file_mail', label: 'Mail du dossier accident', group: 'atelier', extraColumns: [] },
  // Commandes de pièces (mission 02) : une ligne par type de commande, code = type (standard, urgente,
  // accident, excel…). Lu et contrôlé côté serveur par part_order_rules / part_order_check_rules.
  { key: 'order_threshold', label: 'Règles des types de commande', group: 'achat',
    extraColumns: [
      { key: 'min_ht', label: 'Minimum € HTVA', type: 'number' },
      { key: 'surcharge_pct', label: 'Supplément client %', type: 'number' },
      { key: 'max_per_day', label: 'Maximum par jour', type: 'number' },
      { key: 'fallback', label: 'Sous le minimum, repasse en (code)', type: 'text' },
      { key: 'min_ht_per_tab', label: 'Minimum € HTVA par onglet Excel', type: 'number' },
      // Mission 09 carte 6 (ligne « excel ») : adresse Ducati qui reçoit le classeur démo / courtoisie.
      { key: 'mail_to', label: 'Adresse Ducati du classeur démo (ligne excel)', type: 'text' },
      // Mission 09 carte 3 (ligne « urgente ») : popup entretien → urgente si le RDV est à moins de N jours.
      { key: 'urgent_within_days', label: 'Pièces d\'entretien : urgente si RDV à moins de (jours, ligne urgente)', type: 'number' },
    ] },
];

export const REFERENCE_GROUPS: { key: RefTableDef['group']; label: string }[] = [
  { key: 'vente', label: 'Ventes & règlements' },
  { key: 'achat', label: 'Achats & commandes de pièces' },
  { key: 'article', label: 'Articles' },
  { key: 'vehicule', label: 'Véhicules' },
  { key: 'atelier', label: 'Atelier' },
  { key: 'autre', label: 'Divers' },
];

export function refTableDef(key: string): RefTableDef | undefined {
  return REFERENCE_TABLES.find((t) => t.key === key);
}
