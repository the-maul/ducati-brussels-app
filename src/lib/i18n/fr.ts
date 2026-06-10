/**
 * Dictionnaire FR — source unique des libellés UI (CLAUDE.md règle 10).
 * Aucune chaîne en dur dans les composants : tout passe par t('clé').
 * Structure prête pour le NL (Bruxelles) : dupliquer ce fichier en `nl.ts`
 * avec les mêmes clés et brancher dans i18n/index.ts.
 */
export const fr = {
  app: {
    name: 'Ducati Bruxelles',
    shortName: 'Ducati BXL',
    tagline: 'DMS — Gestion concession',
  },

  // Modules de la sidebar (charte §4.1)
  nav: {
    dashboard: 'Tableau de bord',
    vehicles: 'Véhicules',
    workshop: 'Atelier & SAV',
    parts: 'Pièces & Accessoires',
    sales: 'Ventes & Facturation',
    clients: 'Clients (CRM)',
    pos: 'Caisse',
    eshop: 'E-shop',
    reports: 'Rapports',
    settings: 'Paramètres',
    demo: 'Charte (démo)',
  },

  // Actions courantes
  action: {
    create: 'Créer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    duplicate: 'Dupliquer',
    export: 'Exporter',
    search: 'Rechercher',
    confirm: 'Confirmer',
    close: 'Fermer',
    invoice: 'Facturer',
    cash: 'Encaisser',
  },

  // Société / contexte (multi-société COM005)
  company: {
    switch: 'Changer de société',
    italbike: 'ITALBIKE STORE',
    nlinvest: 'NL INVEST',
  },

  // Recherche globale (charte §5.9)
  search: {
    placeholder: 'VIN, client, réf. pièce, n° facture…',
    empty: 'Aucun résultat',
    hint: 'Tapez pour rechercher — un VIN (17 car.) ou un n° TVA est reconnu automatiquement',
    groupVehicles: 'Véhicules',
    groupClients: 'Clients',
    groupParts: 'Pièces',
    groupDocuments: 'Documents',
    detectedVin: 'VIN détecté',
    detectedVat: 'N° TVA détecté',
  },

  // Statuts (charte §5.4) — toujours couleur + icône + libellé
  status: {
    // OR atelier
    or_planned: 'Planifié',
    or_inprogress: 'En cours',
    or_waitingparts: 'Attente pièces',
    or_tobill: 'À facturer',
    or_closed: 'Clôturé',
    or_blocked: 'Bloqué',
    // Véhicule
    veh_instock: 'En stock',
    veh_reserved: 'Réservé',
    veh_sold: 'Vendu',
    veh_prep: 'En préparation',
    veh_ordered: 'En commande',
    // Facture
    inv_paid: 'Payée',
    inv_partial: 'Partielle',
    inv_unpaid: 'Impayée',
    inv_credit: 'Avoir',
    inv_draft: 'Brouillon',
    // Pièce
    part_instock: 'En stock',
    part_low: 'Stock bas',
    part_out: 'Rupture',
    part_ordered: 'En commande',
  },

  // Rôles (M0)
  role: {
    admin: 'Administrateur',
    vendeur: 'Vendeur',
    magasinier: 'Magasinier',
    mecanicien: 'Mécanicien',
    chef_atelier: "Chef d'atelier",
    comptable: 'Comptable',
    marketing: 'Marketing',
  },

  // États génériques
  state: {
    loading: 'Chargement…',
    empty: 'Aucune donnée',
    error: 'Une erreur est survenue',
    retry: 'Réessayer',
  },

  // Écran démo charte (Epic 0)
  demo: {
    title: 'Charte graphique',
    subtitle: 'Démonstration des composants du design system Ducati Bruxelles',
    sectionButtons: 'Boutons',
    sectionBadges: 'Badges de statut',
    sectionTypography: 'Typographie',
    sectionTable: 'Tableau dense (Cond)',
    sectionKpi: 'Indicateurs (KPI)',
    sectionColors: 'Couleurs',
    btnPrimary: 'Action primaire',
    btnSecondary: 'Secondaire',
    btnGhost: 'Tertiaire',
    btnDanger: 'Supprimer',
    btnDisabled: 'Désactivé',
    kpiRevenueDay: 'CA du jour',
    kpiOrOpen: 'OR ouverts',
    kpiOccupancy: 'Occupation atelier',
    kpiStockVehicles: 'Véhicules en stock',
    colVin: 'VIN',
    colModel: 'Modèle',
    colStatus: 'Statut',
    colPrice: 'Prix',
  },
} as const;

export type Dictionary = typeof fr;
