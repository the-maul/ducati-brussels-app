/**
 * M6 (POS) — Impression d'un document de vente (FAC/DEV/TIK/BL/AVO).
 * Ouvre une fenêtre HTML templatée et déclenche l'impression navigateur
 * (« Enregistrer au format PDF »). Pas de dépendance externe (déployable Lovable).
 * Réf. G8 Facturation p.40-41 (formats d'édition), DOC (édition documents).
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import type { DocumentFull } from './write-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

async function fetchContactBlock(contactId: string | null): Promise<string> {
  if (!contactId) return '';
  const { data } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
  if (!data) return '';
  const c = data as Record<string, unknown>;
  const name = contactDisplayName(data as never);
  const lines = [
    name,
    c.address, c.address_complement, [c.zip, c.city].filter(Boolean).join(' '),
    c.vat_number ? `${t('contacts.vatNumber')} : ${c.vat_number}` : '',
  ].filter(Boolean).map((l) => esc(l)).join('<br>');
  return lines;
}

/** Construit le HTML imprimable et ouvre la fenêtre d'impression. */
export async function printDocument(full: DocumentFull, companyName: string): Promise<void> {
  const { doc, lines } = full;
  const contactHtml = await fetchContactBlock(doc.contact_id);
  const typeLabel = t(`sales.type_${doc.doc_type}`);
  const title = `${typeLabel} ${doc.number ?? ''}`.trim();

  const linesHt = lines.reduce((s, l) => s + Number(l.line_ht), 0);
  const discount = Number(doc.global_discount_pct) > 0
    ? linesHt * Number(doc.global_discount_pct) / 100
    : Number(doc.global_discount_amount);
  const shippingHt = Number(doc.shipping_ht);

  const rows = lines.map((l) => `
    <tr>
      <td>${esc(l.designation)}</td>
      <td class="r">${esc(Number(l.quantity))}</td>
      <td class="r">${eur(Number(l.unit_price_ht))}</td>
      <td class="r">${doc.tax_exempt ? '0' : esc(Number(l.vat_rate))} %</td>
      <td class="r">${eur(Number(l.line_ht))}</td>
    </tr>`).join('');

  const totalRow = (label: string, value: string, opts: { strong?: boolean; muted?: boolean } = {}) =>
    `<tr class="${opts.muted ? 'muted' : ''}"><td colspan="4" class="r">${esc(label)}</td><td class="r">${opts.strong ? `<strong>${value}</strong>` : value}</td></tr>`;

  const totals = [
    discount > 0.005 ? totalRow(t('sales.totalDiscount'), `− ${eur(discount)}`, { muted: true }) : '',
    shippingHt > 0.005 ? totalRow(t('sales.totalShipping'), eur(shippingHt), { muted: true }) : '',
    totalRow(t('sales.totalHt'), eur(Number(doc.total_ht)), { strong: true }),
    totalRow(t('sales.totalVat'), eur(Number(doc.total_vat)), { muted: true }),
    totalRow(t('sales.totalTtc'), eur(Number(doc.total_ttc)), { strong: true }),
    Number(doc.paid_amount) !== 0 ? totalRow(t('sales.paid'), eur(Number(doc.paid_amount)), { muted: true }) : '',
  ].join('');

  const exemptMention = doc.tax_exempt ? `<p class="mention">${esc(t('sales.taxExemptMention'))}</p>` : '';

  // CGV (au verso) + pied de facture configurables par société.
  const { data: companyRow } = await supabase.from('companies').select('cgv_text, invoice_footer').eq('id', doc.company_id).maybeSingle();
  const footerText = companyRow?.invoice_footer ? `<p class="footer-note">${esc(companyRow.invoice_footer)}</p>` : '';
  const cgvPage = companyRow?.cgv_text
    ? `<div style="page-break-before:always"><h3>Conditions générales de vente</h3><div style="font-size:10px;white-space:pre-wrap;color:#333">${esc(companyRow.cgv_text)}</div></div>`
    : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 24px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
  .company { font-size: 18px; font-weight: bold; }
  .doc-title { font-size: 16px; font-weight: bold; text-align: right; }
  .doc-meta { text-align: right; color: #555; margin-top: 4px; }
  .parties { display: flex; justify-content: flex-end; margin-bottom: 16px; }
  .client { border: 1px solid #ccc; border-radius: 6px; padding: 10px 14px; min-width: 240px; }
  .client h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #777; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f2f2f2; text-align: left; padding: 7px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #ccc; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { padding: 5px 8px; }
  tfoot .muted td { color: #666; }
  .mention { margin-top: 14px; font-size: 11px; color: #555; font-style: italic; }
  @media print { body { margin: 12mm; } }
</style></head>
<body>
  <div class="head">
    <div><div class="company">${esc(companyName)}</div></div>
    <div><div class="doc-title">${esc(typeLabel)}${doc.number ? ` ${esc(doc.number)}` : ''}</div>
      <div class="doc-meta">${esc(doc.issue_date)}${doc.due_date ? `<br>${esc(t('sales.dueDate'))} : ${esc(doc.due_date)}` : ''}</div></div>
  </div>
  ${contactHtml ? `<div class="parties"><div class="client"><h4>${esc(t('sales.client'))}</h4>${contactHtml}</div></div>` : ''}
  <table>
    <thead><tr><th>${esc(t('sales.colDesignation'))}</th><th class="r">${esc(t('sales.colQty'))}</th><th class="r">${esc(t('sales.colPuHt'))}</th><th class="r">${esc(t('sales.colVat'))}</th><th class="r">${esc(t('sales.colLineHt'))}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${totals}</tfoot>
  </table>
  ${exemptMention}
  ${footerText}
  ${cgvPage}
  <script>window.onload = function(){ window.print(); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
