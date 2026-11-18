/**
 * M6 — Options d'édition d'un document (G8 « Édition d'un document » après validation) :
 * sans références, sans règlements, preuve d'achat (sans prix), totaux uniquement, recto-verso,
 * titre imprimé au choix (Proforma / Devis / Estimation ; Réservation / Commande ; BL chiffré ou
 * non). Règles pures, partagées par l'impression navigateur et le PDF. Lot G8 du 18/11/2026.
 */

export type PrintTitle = 'default' | 'proforma' | 'devis' | 'estimation' | 'reservation' | 'commande';

export type PrintOptions = {
  /** Colonne « Réf. » vide (G8 « Édition sans références »). */
  noReferences: boolean;
  /** Bloc des règlements masqué (G8 « Édition sans règlements »). */
  noPayments: boolean;
  /** Preuve d'achat / BL non chiffré : aucun prix, aucun total (G8 « Édition preuve d'achat (sans prix) »). */
  noPrices: boolean;
  /** Totaux seuls, sans le détail des lignes (G8 « Édition des totaux uniquement »). */
  totalsOnly: boolean;
  /** Recto-verso : les CGV au verso de la dernière page, chaque document commence sur un recto. */
  duplex: boolean;
  /** Titre imprimé à la place du type. */
  title: PrintTitle;
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  noReferences: false, noPayments: false, noPrices: false, totalsOnly: false, duplex: false, title: 'default',
};

/** Titres proposés selon le type (G8 : Proforma / Devis / Estimation ; Réservation / Commande). */
export function titleChoicesFor(docType: string): PrintTitle[] {
  if (docType === 'DEV') return ['default', 'proforma', 'devis', 'estimation'];
  if (docType === 'RES' || docType === 'BC') return ['default', 'reservation', 'commande'];
  return ['default'];
}

/** Clé i18n du titre choisi (null = libellé du type, comportement d'avant). */
export function titleKey(title: PrintTitle): string | null {
  return title === 'default' ? null : `printOptions.title_${title}`;
}

/**
 * Options réellement applicables : un titre qui ne correspond pas au type est ignoré ; « sans
 * prix » et « totaux uniquement » s'excluent (une preuve d'achat montre les lignes, pas les prix).
 */
export function normalizePrintOptions(docType: string, o: Partial<PrintOptions> | null | undefined): PrintOptions {
  const base = { ...DEFAULT_PRINT_OPTIONS, ...(o ?? {}) };
  if (!titleChoicesFor(docType).includes(base.title)) base.title = 'default';
  if (base.noPrices) base.totalsOnly = false;
  return base;
}

/** Une option au moins diffère de l'édition standard. */
export const hasPrintOptions = (o: PrintOptions): boolean =>
  o.noReferences || o.noPayments || o.noPrices || o.totalsOnly || o.duplex || o.title !== 'default';

/**
 * Page blanche à insérer avant les CGV pour qu'elles tombent au verso (page paire) en recto-verso :
 * le document finit sur la page `pagesBeforeCgv` ; les CGV commencent page suivante. Si cette page
 * suivante est impaire (un recto), on insère une page blanche.
 */
export function blankPageBeforeCgv(pagesBeforeCgv: number, duplex: boolean): boolean {
  return duplex && (pagesBeforeCgv + 1) % 2 === 1;
}

/** Lignes du document à imprimer selon les options (totaux seuls : aucune ligne). */
export function printableLines<T>(lines: T[], o: Pick<PrintOptions, 'totalsOnly'>): T[] {
  return o.totalsOnly ? [] : lines;
}
