/**
 * M2 — Rattrapage G8 (18/11/2026) : import « microfiches » générique.
 *
 * G8 (09-parametres.md, Microfiches) : « Import stock - fichier CSV 3 colonnes
 * (ligne ; référence ; quantité) ». Sert au bouton « Import microfiches » des ventes, des OR,
 * des commandes et de l'inventaire : un catalogue pièces exporte la liste de la vue éclatée,
 * on la recolle dans le document au lieu de ressaisir chaque référence.
 *
 * Tolérances (fichiers réels) : séparateur « ; », « , » ou tabulation ; 2 colonnes
 * (référence ; quantité) acceptées ; ligne d'en-tête ignorée ; quantité à virgule décimale ;
 * quantité absente = 1. Les références identiques sont cumulées (une ligne par référence,
 * dans l'ordre de première apparition).
 */

export type MicroficheLine = { line: number; reference: string; quantity: number };
export type MicroficheError = { line: number; raw: string; reason: 'no_reference' | 'bad_quantity' };
export type MicroficheParse = { lines: MicroficheLine[]; errors: MicroficheError[] };

function delimiterOf(line: string): string {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  return ',';
}

function cleanCell(s: string | undefined): string {
  return (s ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
}

function parseQty(s: string): number | null {
  const v = s.replace(/\s/g, '').replace(',', '.');
  if (v === '') return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const HEADER_WORDS = /^(ligne|line|lijn|riga|n°|no|#|ref|réf|reference|référence|referentie|riferimento|code|qte|qté|quantite|quantité|quantity|aantal|quantita)/i;

export function parseMicrofiche(text: string): MicroficheParse {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: MicroficheLine[] = [];
  const errors: MicroficheError[] = [];
  const byRef = new Map<string, MicroficheLine>();
  rows.forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = raw.split(delimiterOf(raw)).map(cleanCell);
    let ref: string;
    let qtyCell: string;
    let lineNo = idx + 1;
    if (cells.length >= 3) {
      const n = Number(cells[0]);
      if (Number.isInteger(n) && n > 0) lineNo = n;
      ref = cells[1];
      qtyCell = cells[2];
    } else if (cells.length === 2) {
      ref = cells[0];
      qtyCell = cells[1];
    } else {
      ref = cells[0];
      qtyCell = '';
    }
    // En-tête (première ligne non vide dont la quantité n'est pas un nombre et qui ressemble à des titres).
    if (lines.length === 0 && errors.length === 0 && HEADER_WORDS.test(ref) && parseQty(qtyCell) === null) return;
    if (!ref) { errors.push({ line: idx + 1, raw, reason: 'no_reference' }); return; }
    const qty = parseQty(qtyCell);
    if (qty === null) { errors.push({ line: idx + 1, raw, reason: 'bad_quantity' }); return; }
    const key = ref.toUpperCase();
    const prev = byRef.get(key);
    if (prev) { prev.quantity = Math.round((prev.quantity + qty) * 1000) / 1000; return; }
    const l: MicroficheLine = { line: lineNo, reference: ref, quantity: qty };
    byRef.set(key, l);
    lines.push(l);
  });
  return { lines, errors };
}

/** Clé de rapprochement d'une référence (majuscules, sans espaces). */
export const normalizeRef = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
