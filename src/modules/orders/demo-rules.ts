/**
 * Commande DEMO / COURTOISIE / SHOWROOM (mission 09, carte 6, decision du 30/10/2026) :
 * regles pures, testees par tests/orders-demo.test.ts.
 *
 *  - accessoires uniquement : une reference n'entre dans le panier que si elle figure dans le
 *    classeur accessoires Ducati (excel_catalog). Une piece detachee ou un vetement est refuse
 *    avec un message clair (la hierarchie / famille du catalogue dit laquelle des deux) ;
 *  - minimum 2 000 EUR remises par onglet (reglable dans Parametres → Tables → Regles des types
 *    de commande, ligne « excel », colonne « Minimum EUR HTVA par onglet Excel ») : chaque onglet
 *    qui a des lignes doit atteindre le minimum ;
 *  - motos de demo par onglet (modele, n° de commande, n° de serie), 4 blocs comme le classeur ;
 *  - objet du mail « Commande <onglet> — <societe> — <date> ».
 * Le serveur fait foi (fonction SQL excel_order_mark_ordered, trigger excel_order_lines_accessory_guard).
 */
import { EXCEL_TABS, type ExcelTab } from './thresholds';

export const DEMO_TAB_LABELS: Record<ExcelTab, string> = { demo: 'Demo', courtoisie: 'Courtoisie', showroom: 'Showroom' };

/** Adresse Ducati par defaut (reglable : reference_values order_threshold / excel, extra.mail_to). */
export const DEFAULT_DEMO_MAIL_TO = 'cas.dwe@ducati.com';

/** Nombre de blocs « Moto n » du classeur Ducati (I2, K2, M2, O2). */
export const DEMO_MOTO_SLOTS = 4;

export type DemoMoto = { model: string; orderNo: string; serial: string };
export type DemoMotos = Partial<Record<ExcelTab, DemoMoto[]>>;

export const blankMoto = (): DemoMoto => ({ model: '', orderNo: '', serial: '' });

/** Les 4 blocs d'un onglet, completes a blanc. */
export function motosForTab(all: DemoMotos | null | undefined, tab: ExcelTab): DemoMoto[] {
  const given = (all?.[tab] ?? []).slice(0, DEMO_MOTO_SLOTS).map((m) => ({
    model: String(m?.model ?? ''), orderNo: String(m?.orderNo ?? ''), serial: String(m?.serial ?? ''),
  }));
  while (given.length < DEMO_MOTO_SLOTS) given.push(blankMoto());
  return given;
}

/** Une moto est « renseignee » des qu'un de ses trois champs est rempli. */
export function filledMotos(motos: DemoMoto[]): DemoMoto[] {
  return motos.filter((m) => (m.model + m.orderNo + m.serial).trim() !== '');
}

// ---------------------------------------------------------------------------------------------
// Accessoires uniquement
// ---------------------------------------------------------------------------------------------

export type ReferenceKind = 'accessoire' | 'vetement' | 'piece' | 'inconnu';

export type ReferenceSources = {
  /** references du classeur accessoires Ducati (excel_catalog) */
  accessoryRefs: Set<string>;
  /** references (SKU) des produits du catalogue Ducati de type « apparel » */
  apparelRefs?: Set<string>;
  /** references d'articles du DMS (pieces detachees, type de gestion A / N) */
  partRefs?: Set<string>;
};

export const normalizeRef = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/** Classe une reference : accessoire (acceptee), vetement, piece, ou inconnue (toutes refusees). */
export function classifyReference(reference: string, src: ReferenceSources): ReferenceKind {
  const r = normalizeRef(reference);
  if (!r) return 'inconnu';
  if (src.accessoryRefs.has(r)) return 'accessoire';
  if (src.apparelRefs?.has(r)) return 'vetement';
  if (src.partRefs?.has(r)) return 'piece';
  return 'inconnu';
}

export function isAccessory(reference: string, src: ReferenceSources): boolean {
  return classifyReference(reference, src) === 'accessoire';
}

/** Repartit une liste de references entre acceptees et refusees (avec leur raison). */
export function splitAccessories(references: string[], src: ReferenceSources): { accepted: string[]; refused: { reference: string; kind: Exclude<ReferenceKind, 'accessoire'> }[] } {
  const accepted: string[] = [];
  const refused: { reference: string; kind: Exclude<ReferenceKind, 'accessoire'> }[] = [];
  for (const ref of references) {
    const k = classifyReference(ref, src);
    if (k === 'accessoire') accepted.push(ref); else refused.push({ reference: ref, kind: k });
  }
  return { accepted, refused };
}

// ---------------------------------------------------------------------------------------------
// Minimum par onglet
// ---------------------------------------------------------------------------------------------

export type DemoLine = { tab: ExcelTab; priceDealer: number; qty: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total (prix dealer x qte) d'un onglet, lignes a quantite nulle ignorees. */
export function demoTabTotal(lines: DemoLine[], tab: ExcelTab): number {
  return round2(lines.filter((l) => l.tab === tab && l.qty > 0).reduce((s, l) => s + l.priceDealer * l.qty, 0));
}

export type DemoTabIssue = { tab: ExcelTab; total: number; min: number; missing: number };

export type DemoCheck = {
  ok: boolean;
  /** onglets qui ont au moins une ligne a commander */
  tabsWithLines: ExcelTab[];
  /** onglets avec lignes sous le minimum */
  belowMin: DemoTabIssue[];
  /** aucune ligne du tout */
  empty: boolean;
};

/** Controle de validation : au moins une ligne, et chaque onglet utilise atteint le minimum. */
export function checkDemoOrder(lines: DemoLine[], minPerTab: number): DemoCheck {
  const tabsWithLines = EXCEL_TABS.filter((tab) => lines.some((l) => l.tab === tab && l.qty > 0));
  const belowMin: DemoTabIssue[] = [];
  for (const tab of tabsWithLines) {
    const total = demoTabTotal(lines, tab);
    if (minPerTab > 0 && total < minPerTab) belowMin.push({ tab, total, min: minPerTab, missing: round2(minPerTab - total) });
  }
  const empty = tabsWithLines.length === 0;
  return { ok: !empty && belowMin.length === 0, tabsWithLines, belowMin, empty };
}

// ---------------------------------------------------------------------------------------------
// Mail a Ducati
// ---------------------------------------------------------------------------------------------

/** « Commande Demo — Ducati Bruxelles — 03/11/2026 » ; plusieurs onglets : « Demo + Courtoisie ». */
export function demoMailSubject(tabs: ExcelTab[], companyName: string, date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const label = (tabs.length ? tabs : ['demo' as ExcelTab]).map((t) => DEMO_TAB_LABELS[t]).join(' + ');
  return `Commande ${label} — ${companyName} — ${dd}/${mm}/${d.getFullYear()}`;
}

/** Nom du classeur envoye / conserve. */
export function demoWorkbookFileName(number: string | null, tabs: ExcelTab[], date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const label = (tabs.length ? tabs : ['demo' as ExcelTab]).map((t) => DEMO_TAB_LABELS[t]).join('-');
  return `Commande_${label}_${number ?? 'brouillon'}_${stamp}.xlsx`;
}

/** Numero DCS : saisi a la main apres l'envoi ; vide = pas encore recu. */
export function cleanDcsNumber(s: string | null | undefined): string | null {
  const v = String(s ?? '').trim();
  return v === '' ? null : v.slice(0, 40);
}
