/**
 * Remplissage du classeur Ducati « Fichier de commande Demo Crtsy Shwrm <annee>_FR VIERGE.xlsx »
 * (mission 09, carte 6). Le classeur vierge n'est PAS dans le depot (prix concession) : il est
 * depose une fois par an dans la GED privee (Parametres → « Deposer le classeur Ducati de
 * l'annee ») et rempli ici, cellule par cellule, avec SheetJS :
 *
 *   - D2 : code concession (100645) sur chaque onglet ;
 *   - blocs « Moto 1..4 » (I2, K2, M2, O2) : modele en ligne 3, n° de commande en ligne 4,
 *     n° de serie en ligne 5 ;
 *   - colonne L « Q COMMANDE » de la ligne dont la colonne C porte la reference ;
 *   - les autres onglets (Feuil12, Feuil2 : liste des concessions) et les formules
 *     (M = K x L, O = M - M x N, D7, E7…) restent dans le fichier.
 *
 * Limite connue : SheetJS (edition communautaire) ne reecrit pas la mise en forme
 * (couleurs, largeurs). Les valeurs, formules, noms definis et onglets sont conserves.
 * Fonctions pures, testees par tests/orders-demo.test.ts.
 */
import * as XLSX from 'xlsx';
import type { ExcelTab } from './thresholds';
import { DEMO_MOTO_SLOTS, DEMO_TAB_LABELS, normalizeRef, type DemoMoto, type DemoMotos } from './demo-rules';

/** Cellule du code concession. */
export const DEALER_CODE_CELL = 'D2';
/** Premiere ligne de donnees (la ligne 10 porte les en-tetes). */
export const FIRST_DATA_ROW = 11;
/** Colonne des references et colonne « Q COMMANDE ». */
export const REFERENCE_COL = 'C';
export const QTY_COL = 'L';
/** Colonnes des blocs « Moto 1..4 » (I2, K2, M2, O2) ; lignes 3 (modele), 4 (n° commande), 5 (n° serie). */
export const MOTO_COLS = ['I', 'K', 'M', 'O'] as const;
export const MOTO_ROWS = { model: 3, orderNo: 4, serial: 5 } as const;

export type FillLine = { tab: ExcelTab; reference: string; qty: number };

export type FillInput = {
  dealerCode: string;
  lines: FillLine[];
  motos?: DemoMotos | null;
  /** nom des onglets du classeur (par defaut Demo / Courtoisie / Showroom) */
  sheetNames?: Partial<Record<ExcelTab, string>>;
};

export type FillReport = {
  /** lignes ecrites par onglet */
  written: Record<ExcelTab, number>;
  /** references absentes de l'onglet (refusees : pas un accessoire du classeur) */
  unknown: { tab: ExcelTab; reference: string }[];
};

/** Adresse de la cellule du bloc moto n (0..3). */
export function motoCell(slot: number, field: keyof typeof MOTO_ROWS): string {
  return `${MOTO_COLS[slot]}${MOTO_ROWS[field]}`;
}

/** Index reference normalisee → numero de ligne (premiere occurrence) d'une feuille. */
export function referenceRows(ws: XLSX.WorkSheet): Map<string, number> {
  const out = new Map<string, number>();
  const ref = ws['!ref'];
  if (!ref) return out;
  const range = XLSX.utils.decode_range(ref);
  for (let r = FIRST_DATA_ROW - 1; r <= range.e.r; r++) {
    const cell = ws[`${REFERENCE_COL}${r + 1}`] as XLSX.CellObject | undefined;
    const v = cell?.v;
    if (v == null || v === '') continue;
    const key = normalizeRef(String(v));
    if (!out.has(key)) out.set(key, r + 1);
  }
  return out;
}

function setCell(ws: XLSX.WorkSheet, addr: string, value: string | number | null): void {
  if (value == null || value === '') { delete ws[addr]; return; }
  ws[addr] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: value };
  // La cellule doit etre dans la zone de la feuille (sinon SheetJS ne l'ecrit pas).
  const cur = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const a = XLSX.utils.decode_cell(addr);
  cur.s.r = Math.min(cur.s.r, a.r); cur.s.c = Math.min(cur.s.c, a.c);
  cur.e.r = Math.max(cur.e.r, a.r); cur.e.c = Math.max(cur.e.c, a.c);
  ws['!ref'] = XLSX.utils.encode_range(cur);
}

/** Le code concession se saisit en nombre dans le classeur (D2 = 100645). */
function dealerValue(code: string): string | number {
  const s = code.trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

/**
 * Remplit un classeur deja lu (XLSX.read). Retourne le rapport ; le classeur est modifie en place.
 * Une reference absente de l'onglet n'est pas ecrite (et figure dans `unknown`).
 */
export function fillDucatiWorkbook(wb: XLSX.WorkBook, input: FillInput): FillReport {
  const names: Record<ExcelTab, string> = { ...DEMO_TAB_LABELS, ...(input.sheetNames ?? {}) } as Record<ExcelTab, string>;
  const report: FillReport = { written: { demo: 0, courtoisie: 0, showroom: 0 }, unknown: [] };
  for (const tab of Object.keys(names) as ExcelTab[]) {
    const ws = wb.Sheets[names[tab]];
    if (!ws) {
      for (const l of input.lines.filter((x) => x.tab === tab)) report.unknown.push({ tab, reference: l.reference });
      continue;
    }
    setCell(ws, DEALER_CODE_CELL, dealerValue(input.dealerCode));
    const motos: DemoMoto[] = (input.motos?.[tab] ?? []).slice(0, DEMO_MOTO_SLOTS);
    for (let i = 0; i < DEMO_MOTO_SLOTS; i++) {
      const m = motos[i];
      setCell(ws, motoCell(i, 'model'), m?.model?.trim() || null);
      setCell(ws, motoCell(i, 'orderNo'), m?.orderNo?.trim() || null);
      setCell(ws, motoCell(i, 'serial'), m?.serial?.trim() || null);
    }
    const rows = referenceRows(ws);
    // Une meme reference deux fois sur l'onglet : les quantites s'additionnent.
    const qtyByRow = new Map<number, number>();
    for (const l of input.lines.filter((x) => x.tab === tab && x.qty > 0)) {
      const row = rows.get(normalizeRef(l.reference));
      if (!row) { report.unknown.push({ tab, reference: l.reference }); continue; }
      qtyByRow.set(row, (qtyByRow.get(row) ?? 0) + l.qty);
    }
    for (const [row, qty] of qtyByRow) {
      setCell(ws, `${QTY_COL}${row}`, qty);
      report.written[tab] += 1;
    }
  }
  return report;
}

/** Lit le classeur vierge (octets) en conservant formules et noms definis. */
export function readDucatiWorkbook(bytes: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellText: false });
}

/** Ecrit le classeur rempli en .xlsx (octets), compresse (piece jointe Outlook : ~1 Mo au lieu de 4). */
export function writeDucatiWorkbook(wb: XLSX.WorkBook): Uint8Array {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** Lecture + remplissage + ecriture en une fois. */
export function buildFilledWorkbook(template: ArrayBuffer | Uint8Array, input: FillInput): { bytes: Uint8Array; report: FillReport } {
  const wb = readDucatiWorkbook(template);
  const report = fillDucatiWorkbook(wb, input);
  return { bytes: writeDucatiWorkbook(wb), report };
}

/** Reference « Q COMMANDE » lue dans un classeur rempli (controle / tests). */
export function readQtyFor(wb: XLSX.WorkBook, tab: ExcelTab, reference: string, sheetNames?: Partial<Record<ExcelTab, string>>): number | null {
  const ws = wb.Sheets[{ ...DEMO_TAB_LABELS, ...(sheetNames ?? {}) }[tab]];
  if (!ws) return null;
  const row = referenceRows(ws).get(normalizeRef(reference));
  if (!row) return null;
  const c = ws[`${QTY_COL}${row}`] as XLSX.CellObject | undefined;
  return c?.v == null ? null : Number(c.v);
}
