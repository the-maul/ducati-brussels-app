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
  { key: 'civility', label: 'Civilités', group: 'autre',
    extraColumns: [
      { key: 'professional', label: 'Professionnel', type: 'bool' },
      { key: 'default', label: 'Par défaut', type: 'bool' },
    ] },
  { key: 'client_category', label: 'Catégories client', group: 'autre', extraColumns: [] },
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
  { key: 'cession_type', label: 'Types de cession interne', group: 'vente',
    extraColumns: [{ key: 'accounted', label: 'Comptabilisée', type: 'bool' }] },
  { key: 'product_category', label: 'Catégories produit fini', group: 'vehicule', extraColumns: [] },
  { key: 'country', label: 'Pays', group: 'autre',
    extraColumns: [{ key: 'default', label: 'Par défaut', type: 'bool' }] },
  { key: 'exposition_code', label: "Codes d'exposition", group: 'vehicule', extraColumns: [] },
  { key: 'financing_org', label: 'Organismes de financement', group: 'autre', extraColumns: [] },
  { key: 'insurance_firm', label: "Cabinets d'assurance", group: 'atelier', extraColumns: [] },
  { key: 'insurance_expert', label: 'Experts assurance', group: 'atelier', extraColumns: [] },
  { key: 'repair_type', label: 'Types de réparation', group: 'atelier', extraColumns: [] },
  { key: 'workshop_operation', label: 'Opérations atelier', group: 'atelier', extraColumns: [] },
  { key: 'workshop_task', label: 'Tâches hors facturation', group: 'atelier', extraColumns: [] },
  // Frais de devis atelier (mission 02, §1.4) : codes « accident » et « diagnostic ».
  { key: 'workshop_quote_fee', label: 'Frais de devis atelier', group: 'atelier',
    extraColumns: [
      { key: 'amount_ht', label: 'Montant fixe HTVA (accident)', type: 'number' },
      { key: 'hourly_rate_ht', label: 'Tarif horaire HTVA (0 = prix article MO)', type: 'number' },
      { key: 'max_hours', label: 'Heures max (diagnostic)', type: 'number' },
      { key: 'vat_rate', label: 'TVA %', type: 'number' },
    ] },
  // Commandes de pièces (mission 02) : une ligne par type de commande, code = type (standard, urgente,
  // accident, excel…). Lu et contrôlé côté serveur par part_order_rules / part_order_check_rules.
  { key: 'order_threshold', label: 'Règles des types de commande', group: 'achat',
    extraColumns: [
      { key: 'min_ht', label: 'Minimum € HTVA', type: 'number' },
      { key: 'surcharge_pct', label: 'Supplément client %', type: 'number' },
      { key: 'max_per_day', label: 'Maximum par jour', type: 'number' },
      { key: 'fallback', label: 'Sous le minimum, repasse en (code)', type: 'text' },
      { key: 'min_ht_per_tab', label: 'Minimum € HTVA par onglet Excel', type: 'number' },
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
