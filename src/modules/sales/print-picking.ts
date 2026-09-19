/**
 * M6 — Impression A4 d'une liste de préparation (mission 02, carte « picking list »).
 * Feuille lisible debout à l'atelier : client, moto, document, vendeur, emplacement de préparation
 * en gros, puis une ligne par article avec casier(s) et deux cases à cocher « Préparé » / « Monté ».
 * HTML imprimable sans dépendance (comme print-document.ts) ; noir et gris seulement (mots-clés
 * CSS, pas de couleur de charte : une feuille d'atelier s'imprime en noir et blanc).
 */
import { t } from '@/lib/i18n';
import type { PickingOverviewRow, PickingLine } from './picking-api';
import { prepDisplayState } from './preparation';
import { SALE_STOCK_META } from './availability';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const qty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const dmy = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-BE') : '');

function stateLabel(l: PickingLine): string {
  const s = prepDisplayState(l);
  if (s === 'na') return '';
  if (s === 'commande' || s === 'prepare' || s === 'monte') return t(`picking.step_${s}`);
  return t(SALE_STOCK_META[s].labelKey);
}

export function printPicking(header: PickingOverviewRow, lines: PickingLine[], companyName: string): void {
  const docLabel = header.doc_type ? `${t(`sales.type_${header.doc_type}`)} ${header.doc_number ?? t('sales.draftSuffix')}` : t('picking.noDocument');
  const title = `${t('picking.printTitle')} — ${docLabel}`;
  const box = (checked: boolean) => `<span class="box">${checked ? '&#10003;' : ''}</span>`;

  const rows = lines.map((l) => `
    <tr class="${l.removed ? 'removed' : ''}">
      <td class="c">${box(l.prep_step === 'prepare' || l.prep_step === 'monte')}</td>
      <td class="c">${box(l.prep_step === 'monte')}</td>
      <td class="bins">${l.bins.length ? l.bins.map(esc).join('<br>') : '—'}</td>
      <td class="mono">${esc(l.reference ?? '')}</td>
      <td>${esc(l.designation ?? '')}${l.removed ? `<div class="note">${esc(t('picking.printRemoved'))}</div>` : ''}</td>
      <td class="r">${qty(l.qty_ordered)}</td>
      <td>${esc(stateLabel(l))}</td>
    </tr>`).join('');

  const info = (label: string, value: string | null | undefined) =>
    `<div><span class="lbl">${esc(label)}</span><b>${esc(value || '—')}</b></div>`;

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:black;margin:12mm;font-size:13px;line-height:1.35}
  .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid black;padding-bottom:6px;margin-bottom:10px}
  .top h1{font-size:20px;margin:0;text-transform:uppercase;letter-spacing:.5px}
  .top .co{font-size:12px;color:dimgray}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-bottom:10px}
  .grid .lbl{display:block;font-size:10px;text-transform:uppercase;color:dimgray;letter-spacing:.03em}
  .grid b{font-size:15px}
  .loc{border:2px solid black;border-radius:6px;padding:8px 12px;margin-bottom:12px;display:flex;gap:12px;align-items:baseline}
  .loc .lbl{font-size:11px;text-transform:uppercase;color:dimgray}
  .loc b{font-size:22px;font-family:monospace}
  table{width:100%;border-collapse:collapse}
  thead th{text-align:left;font-size:10px;text-transform:uppercase;color:dimgray;border-bottom:1px solid black;padding:6px 4px}
  tbody td{border-bottom:1px solid silver;padding:8px 4px;vertical-align:top;font-variant-numeric:tabular-nums}
  .c{text-align:center;width:52px}
  .r{text-align:right}
  .mono{font-family:monospace;font-size:12px}
  .bins{font-family:monospace;font-size:15px;font-weight:bold;width:90px}
  .box{display:inline-block;width:20px;height:20px;border:2px solid black;border-radius:3px;text-align:center;line-height:17px;font-weight:bold}
  tr.removed td{color:dimgray;text-decoration:line-through}
  tr.removed .note{text-decoration:none;font-style:italic;font-size:11px}
  .sign{margin-top:28px;display:flex;gap:24px;font-size:12px}
  .sign div{flex:1;border-top:1px solid black;padding-top:4px}
  .foot{margin-top:14px;font-size:10px;color:dimgray}
  @media print{body{margin:10mm}}
</style></head>
<body>
  <div class="top"><h1>${esc(t('picking.printTitle'))}</h1><span class="co">${esc(companyName)}</span></div>
  <div class="grid">
    ${info(t('picking.printClient'), header.client_name)}
    ${info(t('picking.printDocument'), docLabel)}
    ${info(t('picking.printVehicle'), header.vehicle_label)}
    ${info(t('picking.printSeller'), header.seller_name)}
    ${info(t('picking.printDate'), dmy(header.doc_issue_date ?? header.created_at))}
    ${info(t('picking.printStatus'), `${header.lines_prepared} / ${header.lines_total} · ${t('picking.printMountedCount').replace('{n}', String(header.lines_mounted))}`)}
  </div>
  <div class="loc"><span class="lbl">${esc(t('picking.prepLocation'))}</span><b>${esc(header.location || '______________')}</b></div>
  <table>
    <thead><tr>
      <th class="c">${esc(t('picking.step_prepare'))}</th><th class="c">${esc(t('picking.step_monte'))}</th>
      <th>${esc(t('picking.bins'))}</th><th>${esc(t('picking.printRef'))}</th><th>${esc(t('picking.printDesignation'))}</th>
      <th class="r">${esc(t('picking.printQty'))}</th><th>${esc(t('picking.printState'))}</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="7">${esc(t('picking.tabletEmpty'))}</td></tr>`}</tbody>
  </table>
  <div class="sign">
    <div>${esc(t('picking.printPreparedBy'))}</div>
    <div>${esc(t('picking.printMountedBy'))}</div>
    <div>${esc(t('picking.printCheckedBy'))}</div>
  </div>
  <p class="foot">${esc(t('picking.noStockMove'))} ${esc(t('picking.printPrintedAt').replace('{when}', new Date().toLocaleString('fr-BE')))}</p>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
