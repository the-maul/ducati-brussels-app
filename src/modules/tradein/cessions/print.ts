/**
 * M7 — Impression d'une cession interne / O.R.O et de sa fiche de travail (G8 : « Cession
 * interne + fiche de travail », edition en PAMP / prix de vente / prix d'achat, coordonnees de
 * l'ancien proprietaire en option). Fenetre d'impression du navigateur → imprimante ou PDF A4,
 * meme principe que la fiche de reprise (`reprise-print.ts`). TVA 0 : une cession ne se facture pas.
 */
import { t } from '@/lib/i18n';
import type { CessionFull } from './api';
import { printLineTotal, printTotal, printUnitPrice, type PrintPriceMode } from './rules';

export type CessionPrintKind = 'cession' | 'fiche' | 'both';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const qty = (n: number) => String(Math.round(Number(n) * 1000) / 1000).replace('.', ',');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');

function contactBlock(c: CessionFull['contact']): string {
  if (!c) return '';
  const name = c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ');
  const lines = [name, c.address, [c.zip, c.city].filter(Boolean).join(' '), c.phone, c.email].filter(Boolean);
  return `<div class="box"><div class="lbl">${esc(t('cession.printOwner'))}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

function head(c: CessionFull, companyName: string, title: string): string {
  const v = c.vehicle;
  const moto = v ? [v.brand, v.model].filter(Boolean).join(' ') : '';
  return `
  <div class="head">
    <div class="brand">${esc(companyName)}<small>${esc(title)}</small></div>
    <div class="doc"><div class="n">${esc(c.number ?? '')}</div><div class="d">${esc(day(c.validated_at ?? c.created_at))}</div>
      <div class="d">${esc(c.type_label ?? c.cession_type)} · ${esc(c.accounted ? t('cession.accounted') : t('cession.notAccounted'))}</div></div>
  </div>
  <div class="grid">
    <div class="box"><div class="lbl">${esc(t('cession.vehicle'))}</div>
      <div><b>${esc(moto || '—')}</b></div>
      ${v?.vin ? `<div>${esc(t('cession.vin'))} : ${esc(v.vin)}</div>` : ''}
      ${v?.plate ? `<div>${esc(t('cession.plate'))} : ${esc(v.plate)}</div>` : ''}
      ${v?.reference ? `<div>${esc(t('cession.reference'))} : ${esc(v.reference)}</div>` : ''}
      ${v?.mileage != null ? `<div>${esc(t('cession.mileage'))} : ${esc(v.mileage)}</div>` : ''}
    </div>
    <div class="box"><div class="lbl">${esc(t('cession.operator'))}</div><div>${esc(c.operator_name ?? '—')}</div>
      <div class="lbl" style="margin-top:6px">${esc(t('cession.work'))}</div><div>${esc(c.work_description ?? '—')}</div></div>
  </div>`;
}

function cessionPage(c: CessionFull, mode: PrintPriceMode, companyName: string, withOwner: boolean): string {
  const modeLabel = t(`cession.printMode_${mode}`);
  const rows = c.lines.map((l) => `
    <tr><td>${esc(l.reference ?? '')}</td><td>${esc(l.designation)}${l.kind === 'mo' && l.mechanic_name ? ` <span class="m">(${esc(l.mechanic_name)})</span>` : ''}</td>
      <td class="r">${l.kind === 'texte' ? '' : esc(qty(l.quantity))}</td>
      <td class="r">${l.kind === 'texte' ? '' : esc(eur(printUnitPrice(l, mode)))}</td>
      <td class="r">${l.kind === 'texte' ? '' : '0 %'}</td>
      <td class="r">${l.kind === 'texte' ? '' : esc(eur(printLineTotal(l, mode)))}</td></tr>`).join('');
  const total = printTotal(c.lines, mode);
  return `<section class="page">
    ${head(c, companyName, `${t('cession.printTitle')} — ${modeLabel}`)}
    ${withOwner ? contactBlock(c.contact) : ''}
    <table class="lines"><thead><tr><th>${esc(t('cession.colRef'))}</th><th>${esc(t('cession.colDesignation'))}</th>
      <th class="r">${esc(t('cession.colQty'))}</th><th class="r">${esc(modeLabel)}</th><th class="r">${esc(t('cession.colVat'))}</th><th class="r">${esc(t('cession.colTotal'))}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="tot">${esc(t('cession.totalHt'))} (${esc(modeLabel)}) : <b>${esc(eur(total))}</b></div>
    ${Number(c.options_amount) > 0 ? `<div class="tot">${esc(t('cession.options'))} : <b>${esc(eur(Number(c.options_amount)))}</b></div>` : ''}
    ${c.cost_after != null ? `<div class="tot">${esc(t('cession.costBefore'))} ${esc(eur(Number(c.cost_before ?? 0)))} → ${esc(t('cession.costAfter'))} <b>${esc(eur(Number(c.cost_after)))}</b></div>` : ''}
  </section>`;
}

function workSheetPage(c: CessionFull, companyName: string): string {
  const rows = c.lines.map((l) => `
    <tr><td class="ck">&#9744;</td><td>${esc(l.reference ?? '')}</td><td>${esc(l.designation)}</td>
      <td class="r">${l.kind === 'texte' ? '' : esc(qty(l.quantity))}</td><td>${esc(l.mechanic_name ?? '')}</td><td class="w"></td></tr>`).join('');
  return `<section class="page">
    ${head(c, companyName, t('cession.printWorkSheet'))}
    <table class="lines"><thead><tr><th></th><th>${esc(t('cession.colRef'))}</th><th>${esc(t('cession.colDesignation'))}</th>
      <th class="r">${esc(t('cession.colQty'))}</th><th>${esc(t('cession.colMechanic'))}</th><th>${esc(t('cession.colHoursSpent'))}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${c.internal_note ? `<div class="box"><div class="lbl">${esc(t('cession.internalNote'))}</div><div>${esc(c.internal_note)}</div></div>` : ''}
    <div class="sign"><div>${esc(t('cession.printMechanicSign'))}</div><div>${esc(t('cession.printWorkshopSign'))}</div></div>
  </section>`;
}

/** HTML complet du document (pur, sans effet de bord). */
export function buildCessionPrintHtml(c: CessionFull, opts: { mode: PrintPriceMode; kind: CessionPrintKind; companyName: string; withOwner: boolean }): string {
  const pages: string[] = [];
  if (opts.kind !== 'fiche') pages.push(cessionPage(c, opts.mode, opts.companyName, opts.withOwner));
  if (opts.kind !== 'cession') pages.push(workSheetPage(c, opts.companyName));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(c.number ?? '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
  .page { padding: 6mm 4mm; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #C8102E; padding-bottom: 8px; margin-bottom: 10px; }
  .brand { font-size: 18px; font-weight: 800; text-transform: uppercase; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #555; letter-spacing: .08em; }
  .doc { text-align: right; } .doc .n { font-size: 15px; font-weight: 800; font-family: 'Courier New', monospace; } .doc .d { color: #555; }
  .grid { display: flex; gap: 10px; margin-bottom: 10px; } .grid .box { flex: 1; }
  .box { border: 1px solid #ccc; border-radius: 4px; padding: 6px 8px; margin-bottom: 8px; }
  .lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #555; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.lines th { text-align: left; font-size: 10px; text-transform: uppercase; color: #555; border-bottom: 1px solid #999; padding: 4px; }
  table.lines td { border-bottom: 1px solid #ddd; padding: 4px; vertical-align: top; }
  .r { text-align: right; } .m { color: #555; } .ck { width: 18px; font-size: 14px; } .w { width: 90px; }
  .tot { text-align: right; margin-top: 6px; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; } .sign div { width: 45%; border-top: 1px solid #999; padding-top: 4px; color: #555; }
</style></head><body>${pages.join('')}</body></html>`;
}

export function printCession(c: CessionFull, opts: { mode: PrintPriceMode; kind: CessionPrintKind; companyName: string; withOwner: boolean }): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(buildCessionPrintHtml(c, opts));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
