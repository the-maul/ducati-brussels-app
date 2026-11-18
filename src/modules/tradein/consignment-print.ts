/**
 * M7 — Dépôt-vente : documents imprimables (18/11/2026).
 *  - « Document de dépôt » (G8 « édition fiche de dépôt-vente ») : moto, déposant, prix, conditions,
 *    mention légale, documents remis, deux cadres de signature ;
 *  - « Décompte au déposant » : prix de vente − commission − frais − réparations = net, versement.
 * Fenêtre d'impression du navigateur (imprimante ou PDF A4), comme la fiche de reprise.
 * Feuille imprimée hors application : noir et gris uniquement, aucune couleur de la charte.
 */
import { t } from '@/lib/i18n';
import { CHECKLIST_KEYS } from './validate-data';
import type { ConsignmentFull, PartyBrief } from './consignment-api';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const eur = (n: number | null | undefined) =>
  `${(Math.round(Number(n ?? 0) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '—');
export const partyName = (p: PartyBrief | null | undefined): string => {
  if (!p) return '—';
  const person = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return p.company_name ? (person ? `${p.company_name} (${person})` : p.company_name) : person || '—';
};

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: black; font-size: 12.5px; padding: 8mm; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid black; padding-bottom: 8px; }
  .brand { font-size: 19px; font-weight: 800; text-transform: uppercase; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: gray; letter-spacing: .1em; }
  .doc { text-align: right; } .doc .n { font-size: 16px; font-weight: 800; font-family: 'Courier New', monospace; }
  h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid silver; margin: 14px 0 6px; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 6px 3px 0; vertical-align: top; }
  td.k { width: 42%; color: gray; } td.v { font-weight: 700; } td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-top: 1px solid black; font-weight: 800; padding-top: 5px; }
  .txt { white-space: pre-wrap; } .muted { color: gray; font-size: 11px; }
  .checks span { display: inline-block; margin: 0 14px 4px 0; }
  .sign { display: flex; gap: 12mm; margin-top: 16px; } .sign div { flex: 1; border: 1px solid silver; height: 30mm; padding: 4px 6px; color: gray; font-size: 11px; }
  .foot { margin-top: 14px; border-top: 1px solid silver; padding-top: 6px; color: gray; font-size: 10px; text-align: center; }
  @media print { body { padding: 0; } }`;

function open(title: string, body: string): void {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

const kv = (rows: [string, string][]) =>
  `<table>${rows.filter(([, v]) => v && v !== '—').map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>`;

function header(companyName: string, subtitle: string, c: ConsignmentFull, date: string): string {
  return `<div class="head"><div class="brand">${esc(companyName)}<small>${esc(subtitle)}</small></div>
    <div class="doc"><div class="n">${esc(c.number)}</div><div>${esc(date)}</div></div></div>`;
}

function motoRows(c: ConsignmentFull): [string, string][] {
  const v = c.vehicle;
  return [
    [t('consign.vin'), v?.vin ?? '—'],
    [t('consign.moto'), [v?.brand, v?.model, v?.model_year].filter(Boolean).join(' ') || '—'],
    [t('consign.plate'), v?.plate ?? '—'],
    [t('consign.mileage'), v?.mileage != null ? `${v.mileage} km` : '—'],
    [t('consign.firstReg'), day(v?.first_registration_date)],
    [t('consign.reference'), c.article?.reference ?? v?.reference ?? '—'],
    [t('consign.policeBook'), c.police_book_number ?? '—'],
  ];
}

/** Document de dépôt, à faire signer par le déposant (deux exemplaires). */
export function printDepositSheet(c: ConsignmentFull, companyName: string): void {
  const commission = c.commission_mode === 'pourcentage' ? `${c.commission_pct} % ${t('consign.ofSalePrice')}`
    : c.commission_mode === 'forfait' ? eur(c.commission_amount) : t('consign.mode_ecart_long');
  const checks = CHECKLIST_KEYS.map((k) => `<span>${c.checklist?.[k] ? '[X]' : '[ ]'} ${esc(t(`tradein.chk_${k}`))}</span>`).join('');
  const body = `${header(companyName, t('consign.sheetTitle'), c, day(c.entry_date))}
  <h2>${esc(t('consign.depositor'))}</h2>${kv([
    [t('consign.name'), partyName(c.depositor)], [t('consign.clientCode'), c.depositor?.code ?? '—'],
    [t('consign.kind'), t(`consign.kind_${c.depositor_kind}`)],
  ])}
  <h2>${esc(t('consign.moto'))}</h2>${kv(motoRows(c))}
  <h2>${esc(t('consign.conditionsTitle'))}</h2>${kv([
    [t('consign.asked'), eur(c.asked_price)], [t('consign.salePrice'), eur(c.agreed_price)],
    [t('consign.minPrice'), c.min_price > 0 ? eur(c.min_price) : '—'],
    [t('consign.commission'), commission], [t('consign.depositFee'), c.deposit_fee > 0 ? eur(c.deposit_fee) : '—'],
    [t('consign.entryDate'), day(c.entry_date)],
  ])}
  ${c.conditions ? `<p class="txt" style="margin-top:6px">${esc(c.conditions)}</p>` : ''}
  <h2>${esc(t('consign.checklistTitle'))}</h2><div class="checks">${checks}</div>
  ${c.notes ? `<h2>${esc(t('consign.notes'))}</h2><p class="txt">${esc(c.notes)}</p>` : ''}
  ${c.legal_mention ? `<p class="txt muted" style="margin-top:12px">${esc(c.legal_mention)}</p>` : ''}
  <div class="sign"><div>${esc(t('consign.signDepositor'))}</div><div>${esc(t('consign.signCompany'))}</div></div>
  <div class="foot">${esc(companyName)} · ${esc(c.number)} · ${esc(t('consign.sheetTitle'))}</div>`;
  open(`${c.number} — ${t('consign.sheetTitle')}`, body);
}

/** Décompte au déposant après la vente (et trace du versement). */
export function printSettlementSheet(c: ConsignmentFull, companyName: string): void {
  const line = (k: string, v: number | null | undefined, sign = '') => `<tr><td class="k">${esc(k)}</td><td class="num">${sign}${esc(eur(v))}</td></tr>`;
  const body = `${header(companyName, t('consign.settlementTitle'), c, day(c.sold_at))}
  <h2>${esc(t('consign.depositor'))}</h2>${kv([[t('consign.name'), partyName(c.depositor)], [t('consign.clientCode'), c.depositor?.code ?? '—']])}
  <h2>${esc(t('consign.moto'))}</h2>${kv(motoRows(c))}
  <h2>${esc(t('consign.settlementTitle'))}</h2>
  <table>
    ${line(t('consign.salePrice'), c.sold_price)}
    ${line(`${t('consign.commission')} (${t('consign.vatIncluded')} ${eur(c.sold_commission_vat)})`, c.sold_commission, '− ')}
    ${(c.sold_fees ?? 0) > 0 ? line(t('consign.fees'), c.sold_fees, '− ') : ''}
    ${(c.sold_repairs ?? 0) > 0 ? line(t('consign.repairs'), c.sold_repairs, '− ') : ''}
    <tr class="total"><td class="k">${esc(t('consign.net'))}</td><td class="num">${esc(eur(c.sold_reversal))}</td></tr>
  </table>
  ${kv([
    [t('consign.saleInvoice'), c.sale_doc?.number ?? '—'],
    [t('consign.commissionInvoice'), c.commission_doc?.number ?? '—'],
    [t('consign.creditNote'), c.credit_doc?.number ?? '—'],
    [t('consign.payout'), c.payout_at ? `${day(c.payout_at)} · ${c.payout_method ?? ''} · ${eur(c.payout_amount)}${c.payout_reference ? ` · ${c.payout_reference}` : ''}` : t('consign.payoutPending')],
  ])}
  <div class="sign"><div>${esc(t('consign.signDepositorReceived'))}</div><div>${esc(t('consign.signCompany'))}</div></div>
  <div class="foot">${esc(companyName)} · ${esc(c.number)} · ${esc(t('consign.settlementTitle'))}</div>`;
  open(`${c.number} — ${t('consign.settlementTitle')}`, body);
}
