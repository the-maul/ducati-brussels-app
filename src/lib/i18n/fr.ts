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

  // Authentification (M0)
  auth: {
    loginTitle: 'Connexion',
    email: 'E-mail',
    password: 'Mot de passe',
    signIn: 'Se connecter',
    signingIn: 'Connexion…',
    signOut: 'Se déconnecter',
    invalidCredentials: 'E-mail ou mot de passe incorrect.',
    genericError: 'Connexion impossible. Réessayez.',
    noAccess: 'Votre compte n’est rattaché à aucune société. Contactez un administrateur.',
    redirecting: 'Redirection…',
  },

  // Contacts (M1)
  contacts: {
    title: 'Clients',
    subtitle: 'Fiches clients, prospects et fournisseurs.',
    new: 'Nouveau client',
    edit: 'Modifier la fiche',
    create: 'Créer la fiche',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    empty: 'Aucun client',
    search: 'Rechercher un client (nom, e-mail, TVA…)',
    // sections
    secIdentity: 'Identité',
    secAddress: 'Adresse',
    secMoto: 'Permis & infos moto',
    secB2B: 'Professionnel (B2B)',
    secCategory: 'Catégorisation',
    // type
    type: 'Type',
    type_particulier: 'Particulier',
    type_professionnel: 'Professionnel',
    type_banque_leasing: 'Banque / leasing',
    type_fournisseur: 'Fournisseur',
    // champs identité
    civility: 'Civilité',
    firstName: 'Prénom',
    lastName: 'Nom',
    companyName: 'Raison sociale',
    email: 'E-mail',
    phone: 'Téléphone',
    mobile: 'Mobile',
    // adresse
    address: 'Adresse',
    zip: 'Code postal',
    city: 'Ville',
    country: 'Pays',
    // moto
    birthDate: 'Date de naissance',
    nationalId: "N° carte d'identité",
    nationalRegister: 'Registre national',
    licenseNumber: 'N° permis moto',
    licenseDate: 'Date du permis',
    licensePlace: 'Lieu du permis',
    licenseCategory: 'Catégorie',
    // B2B
    vatNumber: 'N° TVA',
    viesCheck: 'Vérifier (VIES)',
    viesValid: 'TVA valide',
    viesInvalid: 'TVA invalide',
    paymentTerms: 'Conditions de paiement',
    iban: 'IBAN',
    creditLimit: 'Limite de crédit',
    // catégorisation
    segment: 'Segment tarifaire',
    segment_standard: 'Standard',
    segment_vip: 'VIP',
    flagVip: 'VIP',
    flagDetaxe: 'Détaxé (export)',
    flagWatch: 'À surveiller',
    flagAccount: 'En compte',
    interests: "Centres d'intérêt",
    interestRoute: 'Route',
    interestSport: 'Sport',
    interestOffroad: 'Off-road',
    notes: 'Notes',
    // colonnes liste
    colName: 'Nom',
    colType: 'Type',
    colCity: 'Ville',
    colContact: 'Contact',
    colFlags: 'Drapeaux',
    // erreurs
    errLoad: 'Chargement impossible.',
    errSave: 'Enregistrement impossible.',
    requiredName: 'Le nom (ou la raison sociale) est requis.',
  },

  // Paramètres (M0)
  settings: {
    title: 'Paramètres',
    users: 'Utilisateurs',
    usersDesc: 'Comptes du personnel et attribution des rôles par société.',
    numbering: 'Numérotation des documents',
    numberingDesc: 'Préfixes et formats des séquences (factures, OR, devis…).',
    adminOnly: 'Réservé aux administrateurs.',
    notAdmin: "Vous n'avez pas les droits d'administration nécessaires.",
  },

  // Gestion des utilisateurs (M0)
  users: {
    title: 'Utilisateurs',
    subtitle: 'Créer des comptes et gérer les rôles par société.',
    newUser: 'Nouvel utilisateur',
    createTitle: 'Créer un utilisateur',
    name: 'Nom complet',
    email: 'E-mail',
    password: 'Mot de passe provisoire',
    passwordHint: '8 caractères minimum — l’utilisateur pourra le changer.',
    rolesByCompany: 'Rôles par société',
    create: 'Créer le compte',
    creating: 'Création…',
    created: 'Compte créé',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    editRoles: 'Modifier les rôles',
    editRolesTitle: 'Rôles de {name}',
    activate: 'Activer',
    deactivate: 'Désactiver',
    active: 'Actif',
    inactive: 'Inactif',
    colName: 'Nom',
    colEmail: 'E-mail',
    colRoles: 'Rôles',
    colStatus: 'Statut',
    colActions: 'Actions',
    none: 'Aucun rôle',
    empty: 'Aucun utilisateur',
    errorCreate: 'Création impossible.',
    errorLoad: 'Chargement impossible.',
    atLeastOneRole: 'Sélectionnez au moins un rôle.',
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
