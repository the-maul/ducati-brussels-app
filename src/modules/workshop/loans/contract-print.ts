/**
 * M8 — Contrat de pret imprimable, repris de G8 (19/11/2026, a-trancher T10 : « contrat G8 + nos CG »).
 *
 * Recto (une page A4, comme G8 « CONTRAT DE PRET DE VEHICULE DE REMPLACEMENT ») : date, mention
 * police, conducteur, moto du client (OR n° / du, livraison prevue), moto de pret (MEC, chassis,
 * puissance, depart / retour : date, heure, km, carburant), franchise, declaration, « Fait en double
 * exemplaire a … le … », signature « lu et approuve ». Verso : nos conditions generales.
 * Le tout dans la langue du contrat (fiche client), deux exemplaires par defaut.
 *
 * Couleurs et polices : lues dans les tokens de la charte (`src/styles/tokens.css`) au moment de
 * l'impression (`readPrintTokens`) et passees a la fenetre d'impression en variables CSS : aucun
 * hex ni nom de police ecrit ici.
 */
import { tIn, fillVars, type Locale } from '@/lib/i18n';
import type { ContractLeg, ContractMoto, DriverFields } from './contract-rules';
import { contractDate } from './contract-rules';

export type LoanContract = {
  locale: Locale;
  company: { name: string; address: string; logoUrl: string | null };
  number: string;
  date: string;
  driver: DriverFields;
  customerVehicle: ContractMoto;
  orNumber: string;
  orDate: string;
  deliveryDate: string;
  deliveryTime: string;
  loaner: ContractMoto;
  out: ContractLeg;
  back: ContractLeg;
  deductible: string;
  place: string;
  terms: string;
  copies: 1 | 2;
};

/** Valeurs de la charte transmises a la fenetre d'impression (variables CSS). */
export type PrintTokens = { brand: string; ink: string; muted: string; rule: string; fontUi: string; fontMono: string; ruleWidth: string };

/** Lit les tokens de la charte sur la page de l'application (vide hors navigateur). */
export function readPrintTokens(): PrintTokens {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (name: string) => css?.getPropertyValue(name).trim() ?? '';
  return {
    brand: v('--ducati-red'), ink: v('--ducati-black'), muted: v('--gray-600'), rule: v('--gray-200'),
    fontUi: v('--ff-ui'), fontMono: v('--ff-mono'), ruleWidth: v('--print-rule'),
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
/** Valeur imprimee, ou pointilles a remplir a la main (comme le formulaire G8). */
const val = (s: string | null | undefined, wide = false) =>
  s && String(s).trim() ? `<b>${esc(s)}</b>` : `<span class="dots${wide ? ' wide' : ''}"></span>`;

function tokensCss(tk: PrintTokens): string {
  // Repli neutre (mots-cles CSS) si un token manque, jamais de valeur ecrite en dur.
  const or = (x: string, fallback: string) => (x ? x : fallback);
  return `:root{--c-brand:${or(tk.brand, 'currentColor')};--c-ink:${or(tk.ink, 'CanvasText')};--c-muted:${or(tk.muted, 'GrayText')};`
    + `--c-rule:${or(tk.rule, 'GrayText')};--f-ui:${or(tk.fontUi, 'sans-serif')};--f-mono:${or(tk.fontMono, 'monospace')};--w-rule:${or(tk.ruleWidth, '2px')};}`;
}

function rectoPage(c: LoanContract, copyLabel: string): string {
  const T = (k: string) => tIn(c.locale, `loans.contract.${k}`);
  const d = c.driver;
  const line = (...cells: string[]) => `<div class="line">${cells.join('')}</div>`;
  const cell = (label: string, value: string | null | undefined, wide = false) =>
    `<span class="cell${wide ? ' grow' : ''}"><span class="lbl">${esc(label)}</span> ${val(value, wide)}</span>`;
  const leg = (title: string, g: ContractLeg) => `<tr><th>${esc(title)}</th><td>${val(g.date)}</td><td>${val(g.time)}</td><td class="num">${val(g.km)}</td><td>${val(g.fuel)}</td></tr>`;
  const motoLines = (m: ContractMoto, withPower: boolean) =>
    line(cell(T('brand'), m.brand), cell(T('model'), m.model, true), cell(T('firstRegistration'), m.firstRegistration))
    + line(cell(T('plate'), m.plate), cell(T('vin'), m.vin, true), withPower ? cell(T('power'), m.power) : '');
  return `<section class="page">
  <div class="head">
    <div class="brand">${c.company.logoUrl ? `<img src="${esc(c.company.logoUrl)}" alt="">` : ''}<div><div class="cname">${esc(c.company.name)}</div><div class="caddr">${esc(c.company.address)}</div></div></div>
    <div class="doc"><div class="copy">${esc(copyLabel)}</div><div>${esc(T('number'))} <span class="n">${esc(c.number)}</span></div><div>${esc(T('date'))} ${val(c.date)}</div></div>
  </div>
  <h1>${esc(T('title'))}</h1>
  <p class="police">${esc(T('policeNotice'))}</p>

  <h2>${esc(T('driverTitle'))}</h2>
  ${line(cell(T('name'), d.driver_name, true))}
  ${line(cell(T('bornOn'), contractDate(d.driver_birth_date)), cell(T('bornAt'), d.driver_birth_place, true))}
  ${line(cell(T('address'), d.driver_address, true))}
  ${line(cell(T('phone'), d.driver_phone), cell(T('licence'), d.driver_licence_number))}
  ${line(cell(T('license'), d.driver_license_number), cell(T('issuedOn'), contractDate(d.driver_license_date)), cell(T('issuedBy'), d.driver_license_issued_by, true))}

  <h2>${esc(T('customerVehicleTitle'))}</h2>
  ${motoLines(c.customerVehicle, false)}
  ${line(cell(T('inRepair'), c.orNumber), cell(T('inRepairOn'), c.orDate))}
  ${line(cell(T('delivery'), c.deliveryDate), cell(T('deliveryAt'), c.deliveryTime))}

  <h2>${esc(T('loanerTitle'))}</h2>
  ${motoLines(c.loaner, true)}
  <table class="legs">
    <thead><tr><th></th><th>${esc(T('day'))}</th><th>${esc(T('time'))}</th><th class="num">${esc(T('km'))}</th><th>${esc(T('fuel'))}</th></tr></thead>
    <tbody>${leg(T('departure'), c.out)}${leg(T('back'), c.back)}</tbody>
  </table>

  <p class="deductible">${esc(fillVars(T('deductible'), { amount: c.deductible }))}</p>
  <p>${esc(T('declaration'))}</p>
  ${line(cell(T('doneAt'), c.place, true), cell(T('doneOn'), c.date))}
  <div class="sign">
    <div><div class="lbl">${esc(T('signUser'))}</div><div class="hint">${esc(T('signUserHint'))}</div></div>
    <div><div class="lbl">${esc(T('signCompany'))}</div></div>
  </div>
</section>`;
}

function versoPage(c: LoanContract): string {
  const T = (k: string) => tIn(c.locale, `loans.contract.${k}`);
  return `<section class="page verso">
  <div class="head small"><div class="cname">${esc(c.company.name)}</div><div class="doc">${esc(fillVars(T('termsOf'), { number: c.number }))}</div></div>
  <h1>${esc(T('termsTitle'))}</h1>
  <div class="terms">${esc(c.terms.trim() || T('noTerms'))}</div>
</section>`;
}

export function loanContractHtml(c: LoanContract, tokens: PrintTokens): string {
  const T = (k: string) => tIn(c.locale, `loans.contract.${k}`);
  const copies = c.copies === 2 ? [T('copyUser'), T('copyCompany')] : [''];
  const body = copies.map((label) => rectoPage(c, label) + versoPage(c)).join('');
  return `<!doctype html><html lang="${esc(c.locale)}"><head><meta charset="utf-8">
<title>${esc(T('title'))} ${esc(c.number)} - ${esc(c.company.name)}</title>
<style>
  ${tokensCss(tokens)}
  * { box-sizing: border-box; margin: 0; }
  @page { size: A4; margin: 10mm 12mm; }
  body { font-family: var(--f-ui); color: var(--c-ink); font-size: 11px; line-height: 1.35; }
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: var(--w-rule) solid var(--c-brand); padding-bottom: 6px; }
  .head.small { align-items: baseline; }
  .brand { display: flex; gap: 10px; align-items: center; }
  .brand img { max-height: 16mm; max-width: 45mm; }
  .cname { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .caddr { color: var(--c-muted); }
  .doc { text-align: right; }
  .doc .n { font-family: var(--f-mono); font-weight: 800; font-size: 13px; }
  .copy { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--c-muted); }
  h1 { font-size: 15px; text-transform: uppercase; text-align: center; margin: 8px 0 4px; }
  h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--c-brand); margin: 9px 0 3px; border-bottom: 1px solid var(--c-rule); padding-bottom: 2px; }
  .police { font-style: italic; text-align: center; border: 1px solid var(--c-rule); padding: 4px 8px; }
  .line { display: flex; gap: 14px; margin: 3.5px 0; }
  .cell { display: flex; gap: 4px; align-items: baseline; white-space: nowrap; }
  .cell.grow { flex: 1; }
  .cell.grow b, .cell.grow .dots { flex: 1; white-space: normal; }
  .lbl { color: var(--c-muted); }
  .dots { display: inline-block; min-width: 28mm; border-bottom: 1px dotted var(--c-muted); height: 1em; }
  table.legs { width: 100%; border-collapse: collapse; margin-top: 5px; }
  table.legs th, table.legs td { border: 1px solid var(--c-rule); padding: 4px 6px; text-align: left; }
  table.legs thead th { font-size: 9.5px; text-transform: uppercase; color: var(--c-muted); }
  table.legs .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.legs .dots { min-width: 18mm; }
  p { margin: 6px 0; }
  .deductible { font-weight: 700; margin-top: 9px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  .sign > div { border: 1px solid var(--c-rule); height: 30mm; padding: 4px 6px; }
  .sign .hint { color: var(--c-muted); font-style: italic; }
  .terms { white-space: pre-wrap; font-size: 10.5px; line-height: 1.5; margin-top: 6px; }
</style></head><body>
${body}
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
}

/** Fenetre d'impression, ouverte AU CLIC (avant tout appel reseau) pour ne pas etre bloquee. */
export function openPrintWindow(): Window | null {
  return window.open('', '_blank', 'width=900,height=1000');
}
export function printLoanContract(c: LoanContract, w: Window): void {
  w.document.open(); w.document.write(loanContractHtml(c, readPrintTokens())); w.document.close();
}
