/**
 * M8 — Contrat de pret imprimable (G8 « contrat de pret », logos + conditions generales).
 * Ouvre une fenetre d'impression A4 (meme principe que la fiche de reprise `tradein/reprise-print.ts`) :
 * en-tete societe, n° de contrat, emprunteur (nom, adresse, telephone, permis), moto de pret,
 * periode, sortie (date, km, carburant), retour (date, km, carburant ; a remplir a la main s'il
 * n'a pas eu lieu), lien RDV / OR, conditions generales (Planning → Reglages), signatures.
 * Les couleurs de ce document imprime sont celles des autres documents imprimes (filet rouge
 * marque sous l'en-tete, charte §2 « headers impression »).
 */
import { t } from '@/lib/i18n';

export type LoanContract = {
  companyName: string;
  number: string;
  issuedAt: string;
  borrower: { name: string; address: string; phone: string; email: string; license: string };
  moto: { label: string; brand: string; plate: string; vin: string; color: string };
  plannedStart: string;
  plannedEnd: string;
  out: { at: string; km: string; fuel: string } | null;
  back: { at: string; km: string; fuel: string } | null;
  orNumber: string | null;
  terms: string;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const BLANK = '..............................';

export function loanContractHtml(c: LoanContract): string {
  const row = (label: string, value: string) => `<tr><td>${esc(label)}</td><td>${value ? esc(value) : BLANK}</td></tr>`;
  const leg = (title: string, d: { at: string; km: string; fuel: string } | null) => `
    <div class="box"><div class="section-title">${esc(title)}</div>
      <table class="kv">${row(t('loans.contract.date'), d?.at ?? '')}${row(t('loans.contract.km'), d?.km ?? '')}${row(t('loans.contract.fuel'), d?.fuel ?? '')}</table>
    </div>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(t('loans.contract.title'))} ${esc(c.number)} — ${esc(c.companyName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; padding: 10mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #C8102E; padding-bottom: 8px; }
  .brand { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .doc { text-align: right; }
  .doc .n { font-size: 15px; font-weight: 800; font-family: 'Courier New', monospace; }
  .doc .d { color: #666; margin-top: 2px; }
  h1 { font-size: 17px; text-transform: uppercase; margin: 12px 0 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .box { border: 1px solid #ccc; padding: 8px 10px; page-break-inside: avoid; }
  .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #C8102E; margin-bottom: 5px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 2.5px 6px 2.5px 0; vertical-align: top; }
  table.kv td:first-child { width: 42%; color: #555; }
  table.kv td:last-child { font-weight: 700; }
  .terms { white-space: pre-wrap; font-size: 10.5px; line-height: 1.45; margin-top: 4px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px; }
  .sign div { border-top: 1px solid #999; padding-top: 4px; height: 26mm; color: #555; }
  @media print { body { padding: 0; } }
</style></head><body>
  <div class="head">
    <div class="brand">${esc(c.companyName)}</div>
    <div class="doc"><div class="n">${esc(c.number)}</div><div class="d">${esc(c.issuedAt)}</div></div>
  </div>
  <h1>${esc(t('loans.contract.title'))}</h1>
  <div class="grid">
    <div class="box"><div class="section-title">${esc(t('loans.contract.borrower'))}</div>
      <table class="kv">${row(t('loans.contract.name'), c.borrower.name)}${row(t('loans.contract.address'), c.borrower.address)}${row(t('loans.contract.phone'), c.borrower.phone)}${row(t('loans.contract.email'), c.borrower.email)}${row(t('loans.contract.license'), c.borrower.license)}</table>
    </div>
    <div class="box"><div class="section-title">${esc(t('loans.contract.moto'))}</div>
      <table class="kv">${row(t('loans.contract.model'), [c.moto.brand, c.moto.label].filter(Boolean).join(' '))}${row(t('loans.contract.plate'), c.moto.plate)}${row(t('loans.contract.vin'), c.moto.vin)}${row(t('loans.contract.color'), c.moto.color)}</table>
    </div>
    <div class="box"><div class="section-title">${esc(t('loans.contract.period'))}</div>
      <table class="kv">${row(t('loans.contract.from'), c.plannedStart)}${row(t('loans.contract.to'), c.plannedEnd)}${row(t('loans.contract.or'), c.orNumber ?? '')}</table>
    </div>
    <div></div>
    ${leg(t('loans.contract.out'), c.out)}
    ${leg(t('loans.contract.back'), c.back)}
  </div>
  <div class="box" style="margin-top:10px"><div class="section-title">${esc(t('loans.contract.terms'))}</div>
    <div class="terms">${esc(c.terms || t('loans.contract.noTerms'))}</div>
  </div>
  <div class="sign"><div>${esc(t('loans.contract.signBorrower'))}</div><div>${esc(t('loans.contract.signCompany'))}</div></div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`;
}

export function printLoanContract(c: LoanContract): void {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) throw new Error(t('loans.popupBlocked'));
  w.document.open(); w.document.write(loanContractHtml(c)); w.document.close();
}
