/**
 * M12 — Génération UBL (Peppol BIS Billing 3.0) d'une facture, pour transmission
 * via Falco sur le réseau Peppol. Facture (380) ou avoir (381). Le profil et la
 * structure sont conformes BIS 3.0 ; les règles de validation fines pourront être
 * affinées avec Falco (clés/identifiants Peppol à fournir).
 */
export type UblParty = { name: string; vat: string | null; street: string | null; zip: string | null; city: string | null; country: string; peppolId: string | null };
export type UblLine = { id: number; designation: string; quantity: number; unitPriceHt: number; lineHt: number; vatRate: number };
export type UblInvoice = {
  number: string; issueDate: string; dueDate: string | null; isCredit: boolean;
  supplier: UblParty; customer: UblParty; iban: string | null;
  totalHt: number; totalVat: number; totalTtc: number; lines: UblLine[]; taxExempt: boolean;
};

const x = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
const n2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function endpoint(p: UblParty): string {
  if (p.peppolId && p.peppolId.includes(':')) { const [s, v] = p.peppolId.split(':'); return `<cbc:EndpointID schemeID="${x(s)}">${x(v)}</cbc:EndpointID>`; }
  if (p.vat) return `<cbc:EndpointID schemeID="9925">${x(p.vat.replace(/\s/g, ''))}</cbc:EndpointID>`; // 9925 = TVA belge
  return '';
}
function party(role: 'Supplier' | 'Customer', p: UblParty): string {
  return `<cac:Accounting${role}Party><cac:Party>
    ${endpoint(p)}
    <cac:PostalAddress><cbc:StreetName>${x(p.street)}</cbc:StreetName><cbc:CityName>${x(p.city)}</cbc:CityName><cbc:PostalZone>${x(p.zip)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${x(p.country || 'BE')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    ${p.vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${x(p.vat.replace(/\s/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
    <cac:PartyLegalEntity><cbc:RegistrationName>${x(p.name)}</cbc:RegistrationName>${p.vat ? `<cbc:CompanyID>${x(p.vat.replace(/\s/g, ''))}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
  </cac:Party></cac:Accounting${role}Party>`;
}

export function buildUblInvoice(inv: UblInvoice): string {
  const cat = (rate: number) => (inv.taxExempt || rate === 0 ? 'E' : 'S');
  // Regroupe la TVA par taux
  const byRate = new Map<number, { base: number; vat: number }>();
  for (const l of inv.lines) {
    const r = inv.taxExempt ? 0 : l.vatRate;
    const cur = byRate.get(r) ?? { base: 0, vat: 0 };
    cur.base += l.lineHt; cur.vat += inv.taxExempt ? 0 : (l.lineHt * l.vatRate) / 100;
    byRate.set(r, cur);
  }
  const subtotals = [...byRate.entries()].map(([rate, v]) => `<cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">${n2(v.base)}</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">${n2(v.vat)}</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>${cat(rate)}</cbc:ID><cbc:Percent>${n2(rate)}</cbc:Percent>${cat(rate) === 'E' ? '<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>' : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:TaxSubtotal>`).join('');

  const lines = inv.lines.map((l) => `<cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${n2(l.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${n2(l.lineHt)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${x(l.designation)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat(l.vatRate)}</cbc:ID><cbc:Percent>${n2(inv.taxExempt ? 0 : l.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${n2(l.unitPriceHt)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`).join('');

  const root = inv.isCredit ? 'CreditNote' : 'Invoice';
  const ns = inv.isCredit
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const typeTag = inv.isCredit ? '' : '<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>';
  const creditTag = inv.isCredit ? '<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>' : '';
  const lineWrapOpen = inv.isCredit ? lines.replace(/InvoiceLine/g, 'CreditNoteLine').replace(/InvoicedQuantity/g, 'CreditedQuantity') : lines;

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${x(inv.number)}</cbc:ID>
  <cbc:IssueDate>${x(inv.issueDate)}</cbc:IssueDate>
  ${inv.dueDate ? `<cbc:DueDate>${x(inv.dueDate)}</cbc:DueDate>` : ''}
  ${typeTag}${creditTag}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  ${party('Supplier', inv.supplier)}
  ${party('Customer', inv.customer)}
  ${inv.iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${x(inv.iban.replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : ''}
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${n2(inv.totalVat)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${n2(inv.totalHt)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${n2(inv.totalHt)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${n2(inv.totalTtc)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${n2(inv.totalTtc)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineWrapOpen}
</${root}>`;
}
