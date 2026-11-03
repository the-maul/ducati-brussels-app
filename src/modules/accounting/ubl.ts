/**
 * M12 — Génération UBL (Peppol BIS Billing 3.0) d'une facture, d'une facture d'acompte ou d'un avoir,
 * pour transmission via Falco sur le réseau Peppol. Fichier PUR (testé : tests/ubl.test.ts).
 *
 * Règles appliquées (étude docs/etudes/2026-11-facturation-peppol-compta.md §2.4, lot du 03/11/2026) :
 * - `EndpointID schemeID="0208"` = n° BCE (10 chiffres) du vendeur et de l'acheteur belge ; repli
 *   sur le schéma TVA du pays (FR 9957, NL 9944, CH 9927…) pour un acheteur étranger assujetti ; aucun
 *   pour un particulier (la liste EAS n'admet plus l'e-mail) ;
 * - `BuyerReference` toujours présent (« NA » sans référence client, scénario BEG) ; `OrderReference`
 *   = n° de la commande d'origine quand il existe ;
 * - catégories de TVA : `S` (taux > 0), `Z` (0 % normal), `G` + `VATEX-EU-G` (détaxe export),
 *   `E` 0 % + texte légal (régime de la marge, scénario BEG 9 : aucune TVA sur la facture) ;
 * - avoir : racine `CreditNote` 381 + `BillingReference` vers la facture d'origine (BR-55) ;
 * - facture d'acompte : type 386 ; facture finale : `PrepaidAmount` (BT-113) et référence aux
 *   factures d'acompte, `PayableAmount = TaxInclusive − Prepaid` (BR-CO-16) ;
 * - remise de ligne en `AllowanceCharge` (le montant de ligne = qté × prix − remise, BR-LIN) ;
 *   écart de pied (remise globale, port, net forcé) en `AllowanceCharge` / charge de document ;
 * - lignes texte / vides exclues ; aucun élément vide (PEPPOL-EN16931-R008) ; ordre des éléments
 *   conforme aux schémas UBL 2.1.
 */
export type UblParty = {
  name: string; vat: string | null; street: string | null; zip: string | null; city: string | null; country: string;
  peppolId: string | null;
  /** N° BCE (10 chiffres, sans BE) : identifiant Peppol 0208 et n° d'entreprise (BT-30 / BT-47). */
  companyNumber?: string | null;
  /** Adresse e-mail (EndpointID EM d'un particulier). */
  email?: string | null;
};
/** `vatScheme: 'margin'` : ligne au régime de la marge (catégorie E, montant TTC, aucune TVA). */
export type UblLine = {
  id: number; designation: string; quantity: number; unitPriceHt: number; lineHt: number; vatRate: number;
  discountPct?: number; vatScheme?: 'normal' | 'margin' | null;
};
export type UblReference = { number: string; issueDate: string | null };
export type UblInvoice = {
  number: string; issueDate: string; dueDate: string | null; isCredit: boolean;
  supplier: UblParty; customer: UblParty; iban: string | null;
  totalHt: number; totalVat: number; totalTtc: number; lines: UblLine[]; taxExempt: boolean;
  /** Facture d'acompte (FAA) : type 386. */
  isPrepayment?: boolean;
  /** Référence acheteur (BT-10) ; « NA » par défaut. */
  buyerReference?: string | null;
  /** N° de la commande / réservation d'origine (BT-13). */
  orderReference?: string | null;
  /** Avoir : facture d'origine ; facture finale : factures d'acompte déduites (BG-3). */
  billingReferences?: UblReference[];
  /** Acomptes déjà facturés, TTC (BT-113). */
  prepaidAmount?: number;
  /** Note de document (BT-22), ex. référence légale. */
  note?: string | null;
  /**
   * Régime de la marge (B2, M-89, lot TVA marge ef3f953, scénario BEG 9 du 25/02/2026) : catégorie `E`
   * à 0 % sur toutes les lignes, aucune TVA, `TaxExemptionReason` = mention légale, **sans** code VATEX
   * et jamais la catégorie `O`. La TVA due se calcule hors facture (registre de la marge).
   */
  vatScheme?: 'normal' | 'marge';
  /** Texte de la mention (langue du client) ; FR par défaut. */
  marginReason?: string | null;
};

/** Mention légale de référence (FR) du régime de la marge, art. 58 §4 CTVA (lot TVA marge). */
export const UBL_MARGIN_REASON_FR = 'Livraison soumise au regime particulier d imposition de la marge beneficiaire. TVA non deductible.';

/** Texte d'exonération du régime de la marge (scénario BEG 9 du 25/02/2026). */
export const MARGIN_EXEMPTION_TEXT = "Livraison soumise au régime particulier d'imposition de la marge bénéficiaire. TVA non déductible.";
/** Texte de la détaxe export (art. 39 §1 CTVA). */
export const EXPORT_EXEMPTION_TEXT = 'Exonération art. 39 §1 CTVA - exportation.';

const x = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n2 = (n: number) => r2(n).toFixed(2);
const q4 = (n: number) => String(Math.round(n * 10000) / 10000);
const tag = (name: string, value: unknown, attrs = '') => {
  const v = String(value ?? '').trim();
  return v ? `<${name}${attrs}>${x(v)}</${name}>` : '';
};

/** N° BCE à partir d'un n° de TVA belge (BE0123456789 → 0123456789), null sinon. */
export function belgianCompanyNumber(vat: string | null | undefined): string | null {
  const v = String(vat ?? '').replace(/[\s.\-]/g, '').toUpperCase();
  const m = /^BE([01]\d{9})$/.exec(v);
  return m ? m[1] : null;
}

/** Schémas Peppol (EAS) des n° de TVA des pays voisins ; ailleurs on ne devine pas. */
const VAT_EAS: Record<string, string> = { BE: '9925', FR: '9957', NL: '9944', DE: '9930', LU: '9938', IT: '9906', ES: '9920', AT: '9914', CH: '9927' };

/** Identifiant Peppol d'une partie : 0208:BCE en priorité (règle belge), sinon l'existant, sinon la TVA (schéma du pays). */
export function peppolEndpoint(p: UblParty): { scheme: string; id: string } | null {
  const bce = (p.companyNumber ?? '').replace(/\D/g, '') || (p.country === 'BE' || !p.country ? belgianCompanyNumber(p.vat) : null);
  if (bce && bce.length === 10) return { scheme: '0208', id: bce };
  if (p.peppolId && p.peppolId.includes(':')) {
    const [s, ...rest] = p.peppolId.split(':');
    if (s.trim() && rest.join(':').trim()) return { scheme: s.trim(), id: rest.join(':').trim() };
  }
  const vat = (p.vat ?? '').replace(/\s/g, '').toUpperCase();
  const scheme = VAT_EAS[vat.slice(0, 2)];
  if (vat && scheme) return { scheme, id: vat };
  // Particulier sans identifiant : pas d EndpointID (la liste EAS n admet plus « EM ») ; il reçoit le PDF,
  // l UBL ne sert qu a l archive et au comptable (Peppol B2C non obligatoire, étude §2.2).
  return null;
}

/** Contrôles avant export (fiche société incomplète) : codes d'erreur traduits par l'appelant. */
export function ublExportBlockers(supplier: UblParty): string[] {
  const out: string[] = [];
  const bce = (supplier.companyNumber ?? '').replace(/\D/g, '');
  if (bce.length !== 10) out.push('missingCompanyNumber');
  if (!/^0208:\d{10}$/.test((supplier.peppolId ?? '').replace(/\s/g, ''))) out.push('missingPeppolId');
  if (!supplier.vat) out.push('missingVat');
  return out;
}

type Cat = { id: 'S' | 'Z' | 'G' | 'E'; rate: number; reasonCode?: string; reason?: string };

function lineCategory(inv: UblInvoice, l: UblLine): Cat {
  if (inv.vatScheme === 'marge') return { id: 'E', rate: 0, reason: inv.marginReason || UBL_MARGIN_REASON_FR };
  if (l.vatScheme === 'margin') return { id: 'E', rate: 0, reason: inv.marginReason || MARGIN_EXEMPTION_TEXT };
  if (inv.taxExempt) return { id: 'G', rate: 0, reasonCode: 'VATEX-EU-G', reason: EXPORT_EXEMPTION_TEXT };
  if (!l.vatRate) return { id: 'Z', rate: 0 };
  return { id: 'S', rate: l.vatRate };
}
const catKey = (c: Cat) => `${c.id}|${c.rate}`;
const catXml = (c: Cat, withReason: boolean, el = 'cac:TaxCategory') => `<${el}><cbc:ID>${c.id}</cbc:ID><cbc:Percent>${n2(c.rate)}</cbc:Percent>${
  withReason && c.reasonCode ? `<cbc:TaxExemptionReasonCode>${c.reasonCode}</cbc:TaxExemptionReasonCode>` : ''}${
  withReason && c.reason ? `<cbc:TaxExemptionReason>${x(c.reason)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></${el}>`;

function party(role: 'Supplier' | 'Customer', p: UblParty): string {
  const ep = peppolEndpoint(p);
  const bce = (p.companyNumber ?? '').replace(/\D/g, '') || belgianCompanyNumber(p.vat);
  const vat = p.vat ? p.vat.replace(/\s/g, '').toUpperCase() : '';
  const addr = `${tag('cbc:StreetName', p.street)}${tag('cbc:CityName', p.city)}${tag('cbc:PostalZone', p.zip)}<cac:Country><cbc:IdentificationCode>${x(p.country || 'BE')}</cbc:IdentificationCode></cac:Country>`;
  return `<cac:Accounting${role}Party><cac:Party>${ep ? `<cbc:EndpointID schemeID="${x(ep.scheme)}">${x(ep.id)}</cbc:EndpointID>` : ''}`
    + `<cac:PostalAddress>${addr}</cac:PostalAddress>`
    + (vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${x(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '')
    + `<cac:PartyLegalEntity><cbc:RegistrationName>${x(p.name || '-')}</cbc:RegistrationName>${bce ? `<cbc:CompanyID schemeID="0208">${x(bce)}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>`
    + `</cac:Party></cac:Accounting${role}Party>`;
}

export type UblComputed = {
  lines: { l: UblLine; cat: Cat; qty: number; price: number; amount: number; allowance: number }[];
  subtotals: { cat: Cat; base: number; vat: number }[];
  lineTotal: number; docAllowance: number; docCharge: number; taxExclusive: number; taxTotal: number;
  taxInclusive: number; prepaid: number; rounding: number; payable: number;
};

/**
 * Montants du fichier (pure, testée) : tout est recalculé depuis les lignes pour respecter les règles de
 * cohérence BR-CO-10 à BR-CO-16 ; l'écart éventuel avec le TTC du document (arrondi, net forcé) passe
 * en `PayableRoundingAmount`, l'écart HT (remise globale, port) en remise / frais de document.
 */
export function computeUbl(inv: UblInvoice): UblComputed {
  const lines: UblComputed['lines'] = [];
  for (const l of inv.lines) {
    const cat = lineCategory(inv, l);
    let qty = Number(l.quantity) || 0;
    let price = Number(l.unitPriceHt) || 0;
    // Marge : prix TTC, aucune TVA (la ligne porte déjà le TTC dans lineHt côté appelant).
    const amount = r2(Number(l.lineHt) || 0);
    if (!qty && !amount) continue;
    if (price < 0) { price = -price; qty = -qty; }          // BR-27 : prix jamais négatif
    if (!qty) qty = amount < 0 ? -1 : 1;
    let allowance = r2(qty * price - amount);
    if (Math.abs(allowance) < 0.005) allowance = 0;
    if (allowance < 0 || (allowance > 0 && Math.sign(qty) < 0)) { price = Math.abs(amount / qty); allowance = 0; } // pas de « remise négative »
    lines.push({ l, cat, qty, price, amount, allowance });
  }
  const lineTotal = r2(lines.reduce((s, x2) => s + x2.amount, 0));
  const totalHt = r2(Math.abs(Number(inv.totalHt) || 0) * (lineTotal < 0 ? -1 : 1));
  const diff = r2(totalHt - lineTotal);
  const docAllowance = diff < 0 ? -diff : 0;
  const docCharge = diff > 0 ? diff : 0;

  // Base par catégorie ; l'écart de pied va sur la catégorie principale (plus grosse base).
  const byCat = new Map<string, { cat: Cat; base: number }>();
  for (const x2 of lines) {
    const k = catKey(x2.cat);
    const cur = byCat.get(k) ?? { cat: x2.cat, base: 0 };
    cur.base = r2(cur.base + x2.amount);
    byCat.set(k, cur);
  }
  const main = [...byCat.values()].sort((a, b) => Math.abs(b.base) - Math.abs(a.base))[0];
  if (main && diff) main.base = r2(main.base + diff);
  const subtotals = [...byCat.values()].map((s) => ({ cat: s.cat, base: s.base, vat: r2((s.base * s.cat.rate) / 100) }));
  const taxExclusive = r2(lineTotal - docAllowance + docCharge);
  const taxTotal = r2(subtotals.reduce((s, x2) => s + x2.vat, 0));
  const taxInclusive = r2(taxExclusive + taxTotal);
  const prepaid = r2(Number(inv.prepaidAmount) || 0);
  const wantedTtc = r2(Math.abs(Number(inv.totalTtc) || 0) * (taxInclusive < 0 ? -1 : 1));
  const rounding = Math.abs(wantedTtc - taxInclusive) <= 0.05 ? r2(wantedTtc - taxInclusive) : 0;
  const payable = r2(taxInclusive - prepaid + rounding);
  return { lines, subtotals, lineTotal, docAllowance, docCharge, taxExclusive, taxTotal, taxInclusive, prepaid, rounding, payable };
}

export function buildUblInvoice(inv: UblInvoice): string {
  const c = computeUbl(inv);
  const credit = inv.isCredit;
  const L = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const Q = credit ? 'CreditedQuantity' : 'InvoicedQuantity';

  const lines = c.lines.map((x2, i) => `<cac:${L}><cbc:ID>${i + 1}</cbc:ID>`
    + `<cbc:${Q} unitCode="C62">${q4(x2.qty)}</cbc:${Q}>`
    + `<cbc:LineExtensionAmount currencyID="EUR">${n2(x2.amount)}</cbc:LineExtensionAmount>`
    + (x2.allowance > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode><cbc:AllowanceChargeReason>Remise</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">${n2(x2.allowance)}</cbc:Amount></cac:AllowanceCharge>` : '')
    + `<cac:Item><cbc:Name>${x(x2.l.designation || '-')}</cbc:Name>${catXml(x2.cat, false, 'cac:ClassifiedTaxCategory')}</cac:Item>`
    + `<cac:Price><cbc:PriceAmount currencyID="EUR">${q4(x2.price)}</cbc:PriceAmount></cac:Price></cac:${L}>`).join('');

  const mainCat = c.subtotals.slice().sort((a, b) => Math.abs(b.base) - Math.abs(a.base))[0]?.cat ?? { id: 'S', rate: 21 } as Cat;
  const docAc = [
    c.docAllowance > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode><cbc:AllowanceChargeReason>Remise</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">${n2(c.docAllowance)}</cbc:Amount>${catXml(mainCat, false)}</cac:AllowanceCharge>` : '',
    c.docCharge > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReasonCode>DL</cbc:AllowanceChargeReasonCode><cbc:AllowanceChargeReason>Frais de port</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">${n2(c.docCharge)}</cbc:Amount>${catXml(mainCat, false)}</cac:AllowanceCharge>` : '',
  ].join('');

  const subtotals = c.subtotals.map((s) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${n2(s.base)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${n2(s.vat)}</cbc:TaxAmount>${catXml(s.cat, true)}</cac:TaxSubtotal>`).join('');

  const refs = (inv.billingReferences ?? []).filter((r) => r.number)
    .map((r) => `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(r.number)}</cbc:ID>${tag('cbc:IssueDate', r.issueDate)}</cac:InvoiceDocumentReference></cac:BillingReference>`).join('');
  const due = c.payable > 0.004;
  const paymentTerms = due && !inv.dueDate ? '<cac:PaymentTerms><cbc:Note>Payable à réception</cbc:Note></cac:PaymentTerms>' : '';
  const paymentMeans = inv.iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${tag('cbc:PaymentID', inv.number)}<cac:PayeeFinancialAccount><cbc:ID>${x(inv.iban.replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : '';

  const root = credit ? 'CreditNote' : 'Invoice';
  const ns = credit ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const head = credit
    ? `<cbc:IssueDate>${x(inv.issueDate)}</cbc:IssueDate><cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>`
    : `<cbc:IssueDate>${x(inv.issueDate)}</cbc:IssueDate>${tag('cbc:DueDate', inv.dueDate)}<cbc:InvoiceTypeCode>${inv.isPrepayment ? '386' : '380'}</cbc:InvoiceTypeCode>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${x(inv.number)}</cbc:ID>
  ${head}${tag('cbc:Note', inv.note ?? (inv.vatScheme === 'marge' ? inv.marginReason || UBL_MARGIN_REASON_FR : null))}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${x((inv.buyerReference ?? '').trim() || 'NA')}</cbc:BuyerReference>
  ${inv.orderReference ? `<cac:OrderReference><cbc:ID>${x(inv.orderReference)}</cbc:ID></cac:OrderReference>` : ''}${refs}
  ${party('Supplier', inv.supplier)}
  ${party('Customer', inv.customer)}
  ${paymentMeans}${paymentTerms}${docAc}
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${n2(c.taxTotal)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${n2(c.lineTotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${n2(c.taxExclusive)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${n2(c.taxInclusive)}</cbc:TaxInclusiveAmount>${
    c.docAllowance > 0 ? `<cbc:AllowanceTotalAmount currencyID="EUR">${n2(c.docAllowance)}</cbc:AllowanceTotalAmount>` : ''}${
    c.docCharge > 0 ? `<cbc:ChargeTotalAmount currencyID="EUR">${n2(c.docCharge)}</cbc:ChargeTotalAmount>` : ''}${
    c.prepaid ? `<cbc:PrepaidAmount currencyID="EUR">${n2(c.prepaid)}</cbc:PrepaidAmount>` : ''}${
    c.rounding ? `<cbc:PayableRoundingAmount currencyID="EUR">${n2(c.rounding)}</cbc:PayableRoundingAmount>` : ''}<cbc:PayableAmount currencyID="EUR">${n2(c.payable)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  ${lines}
</${root}>`;
}
