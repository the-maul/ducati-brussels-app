/**
 * M1 — Onglets de la fiche client (lot design des fiches, 20/11/2026, revue UX/UI validée).
 *
 * Avant : 20 onglets sur 2 lignes (+ 3 dans le formulaire), avec des doublons
 * (« Documents » / « Documents & photos » ; « Échéances » / « Relances et échéances » / « Relances »).
 * Après : 5 onglets + « Plus » (menu qui regroupe le reste). Rien ne disparaît, tout se range :
 *   L'essentiel → le formulaire de la fiche (seul bouton rouge : Enregistrer)
 *   Motos       → le parc du client
 *   Atelier     → rendez-vous atelier, interventions reportées, pièces commandées ou réservées
 *   Documents   → devis / factures / tickets, documents et photos joints (GED), images
 *   Relances    → factures à payer, paiements différés / lettres / bons d'achat, relances d'entretien
 *   Plus        → livraisons, interlocuteurs, tarifs, communications, e-mail / SMS, RGPD,
 *                 groupes, vente groupement, archives
 * Règles pures (testées) : l'onglet est gardé dans l'adresse (?tab=), comme la fiche OR.
 */

export const CLIENT_MAIN_TABS = ['essentiel', 'motos', 'atelier', 'documents', 'relances'] as const;
export const CLIENT_MORE_TABS = [
  'livraisons', 'interlocuteurs', 'tarifs', 'communications', 'emails', 'rgpd', 'groupes', 'groupement', 'archives',
] as const;

export type ClientMainTab = (typeof CLIENT_MAIN_TABS)[number];
export type ClientMoreTab = (typeof CLIENT_MORE_TABS)[number];
export type ClientTab = ClientMainTab | ClientMoreTab;

export const CLIENT_DEFAULT_TAB: ClientTab = 'essentiel';

const ALL: readonly string[] = [...CLIENT_MAIN_TABS, ...CLIENT_MORE_TABS];

export const isClientTab = (v: unknown): v is ClientTab => typeof v === 'string' && ALL.includes(v);
export const parseClientTab = (v: unknown): ClientTab | undefined => (isClientTab(v) ? v : undefined);
export const isMoreTab = (v: ClientTab): v is ClientMoreTab => (CLIENT_MORE_TABS as readonly string[]).includes(v);

/** Clé i18n du libellé de chaque onglet (les rubriques de « Plus » gardent leur libellé d'avant). */
export const CLIENT_TAB_LABEL: Record<ClientTab, string> = {
  essentiel: 'designFiches.tabEssentials',
  motos: 'designFiches.tabMotos',
  atelier: 'designFiches.tabWorkshop',
  documents: 'designFiches.tabDocuments',
  relances: 'designFiches.tabFollowups',
  livraisons: 'clientTabs.tabDeliveries',
  interlocuteurs: 'clientTabs.tabContacts',
  tarifs: 'clientTabs.tabPricing',
  communications: 'crm.history',
  emails: 'g8c.tabs.mailSms',
  rgpd: 'g8c.tabs.rgpd',
  groupes: 'g8c.tabs.groups',
  groupement: 'g8c.tabs.groupSales',
  archives: 'g8c.tabs.archives',
};

/**
 * Où est passé chaque ancien onglet (valeur de l'ancien `<TabsTrigger>` → nouvel onglet).
 * Sert de liste de contrôle « rien ne disparaît » (tests/design-fiches.test.ts).
 */
export const LEGACY_CLIENT_TAB: Record<string, ClientTab> = {
  fiche: 'essentiel',
  parc: 'motos',
  documents: 'documents',
  'documents-ged': 'documents',
  'g8-images': 'documents',
  echeances: 'relances',
  relances: 'relances',
  'g8-relances': 'relances',
  reportees: 'atelier',
  'g8-rdv': 'atelier',
  'g8-dispo': 'atelier',
  livraisons: 'livraisons',
  contacts: 'interlocuteurs',
  tarifs: 'tarifs',
  comms: 'communications',
  'g8-mail': 'emails',
  'g8-rgpd': 'rgpd',
  'g8-groupes': 'groupes',
  'g8-groupement': 'groupement',
  'g8-archives': 'archives',
};

/* ---------------- Tuile d'encours (une seule tuile au lieu de 4) ---------------- */

export type EncoursTileInput = {
  /** Reste à payer par le client (hors part de l'organisme de financement). */
  clientDue: number;
  overdue: boolean;
  toReceiveFromOrg: number;
  financingPending: number;
  /** Crédit autorisé / utilisé / disponible (RPC contact_encours), absent si non chargé. */
  credit?: { authorized: number; current: number; available: number } | null;
};

export type EncoursTile = {
  kind: 'nothing' | 'due';
  tone: 'success' | 'warning' | 'danger';
  due: number;
  overdue: boolean;
  /** Ligne de crédit seulement si un crédit est accordé ou dépassé. */
  showCredit: boolean;
  creditOver: number;
  toReceiveFromOrg: number;
  financingPending: number;
};

const EPS = 0.005;

export function encoursTile(i: EncoursTileInput): EncoursTile {
  const due = Math.max(0, i.clientDue);
  const nothing = due <= EPS;
  const creditOver = i.credit && i.credit.available < -EPS ? -i.credit.available : 0;
  return {
    kind: nothing ? 'nothing' : 'due',
    tone: nothing ? (creditOver > 0 ? 'danger' : 'success') : i.overdue || creditOver > 0 ? 'danger' : 'warning',
    due: nothing ? 0 : due,
    overdue: !nothing && i.overdue,
    showCredit: !!i.credit && (i.credit.authorized > EPS || creditOver > 0),
    creditOver,
    toReceiveFromOrg: i.toReceiveFromOrg > EPS ? i.toReceiveFromOrg : 0,
    financingPending: i.financingPending > EPS ? i.financingPending : 0,
  };
}
