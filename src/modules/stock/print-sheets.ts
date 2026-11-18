/**
 * M5 — Éditions imprimables A4 du stock (rattrapage G8 du 18/11/2026) : feuille de comptage
 * (arrêté initial / final, inventaire par rayon / fournisseur / casier / référence),
 * édition du stock avec sous-totaux, écarts, procédure d'inventaire.
 * Page HTML autonome (document imprimé, hors charte écran) ouverte dans la fenêtre
 * d'impression du navigateur (`printHtmlInWindow`, même porte que les tickets).
 */
import { printHtmlInWindow } from '@/lib/devices/drivers';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export type SheetColumn = { label: string; align?: 'left' | 'right'; blank?: boolean };
export type SheetGroup = { title: string | null; rows: (string | number | null)[][]; subtotal?: (string | number | null)[] };

/** Nombre au format belge (2 décimales pour les montants, sinon tel quel). */
export const fmtNum = (n: number | null | undefined, decimals = 0) =>
  n == null ? '' : n.toLocaleString('fr-BE', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 3) });

export function printSheet(p: { title: string; subtitle?: string; printedOn: string; columns: SheetColumn[]; groups: SheetGroup[]; total?: (string | number | null)[] }): void {
  const head = p.columns.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const cell = (v: unknown, i: number) => {
    const c = p.columns[i];
    return `<td class="${c?.align === 'right' ? 'r' : ''}${c?.blank ? ' blank' : ''}">${esc(v)}</td>`;
  };
  const body = p.groups.map((g) => [
    g.title ? `<tr class="grp"><td colspan="${p.columns.length}">${esc(g.title)}</td></tr>` : '',
    ...g.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`),
    g.subtotal ? `<tr class="sub">${g.subtotal.map(cell).join('')}</tr>` : '',
  ].join('')).join('');
  const total = p.total ? `<tr class="tot">${p.total.map(cell).join('')}</tr>` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: sans-serif; font-size: 9pt; color: black; }
  h1 { font-size: 13pt; margin: 0 0 2mm; } p { margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 0.2mm solid gray; padding: 1mm 1.5mm; text-align: left; vertical-align: top; }
  th { font-size: 8pt; text-transform: uppercase; border-bottom: 0.4mm solid black; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .blank { min-width: 18mm; border-bottom: 0.3mm solid black; }
  tr.grp td { font-weight: bold; padding-top: 3mm; border-bottom: 0.4mm solid black; }
  tr.sub td { font-weight: bold; } tr.tot td { font-weight: bold; border-top: 0.5mm solid black; }
  thead { display: table-header-group; }
</style></head><body>
<h1>${esc(p.title)}</h1>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ''}<p>${esc(p.printedOn)}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
  printHtmlInWindow(html, 'width=1000,height=900');
}

/** Procédure d'inventaire (étapes numérotées + explication), à imprimer ou enregistrer en PDF. */
export function printProcedure(title: string, method: string, steps: { label: string; help: string }[],
  cols: { no: string; step: string; help: string; done: string }): void {
  printSheet({
    title, subtitle: method, printedOn: '',
    columns: [{ label: cols.no }, { label: cols.step }, { label: cols.help }, { label: cols.done, blank: true }],
    groups: [{ title: null, rows: steps.map((s, i) => [i + 1, s.label, s.help, '']) }],
  });
}
