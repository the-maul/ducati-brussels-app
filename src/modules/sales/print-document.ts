/**
 * M6 — Impression d'un document de vente (FAC / DEV devis-proforma / BC bon de commande / RES /
 * TIK / BL / AVO) au format attendu par
 * le client (cf. FACTURE 26xxxxxx.pdf, docs/migration-g8-formats.md §5) : en-tête
 * société + bloc client encadré + code-barres, bandeau (date/heure/n° client/condition/
 * échéance/opérateur/page), lignes, bloc détail véhicule, encadré totaux (BRUT/NET HT/
 * TVA/NET TTC/RESTE À PAYER), règlements datés, mention TVA marge, CGV au verso.
 * Opérateur : documents.operator (utilisateur connecté à la création, ou texte G8 repris).
 * HTML imprimable, sans dépendance externe.
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import { code128Svg } from '@/modules/articles/barcode';
import type { DocumentFull } from './write-api';
import { tIn } from '@/lib/i18n';
import { contactLocale, designationFor } from '@/lib/i18n/client-locale';

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dmy = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-BE') : '');

export async function printDocument(full: DocumentFull, companyName: string): Promise<void> {
  const { doc, lines } = full;

  // Données société, client, véhicule, règlements + détection occasion (TVA marge).
  const [{ data: company }, { data: contact }, { data: payments }, { data: vehicle }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', doc.company_id).maybeSingle(),
    doc.contact_id ? supabase.from('contacts').select('*').eq('id', doc.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('document_payments').select('*').eq('document_id', doc.id).order('paid_at'),
    doc.vehicle_id ? supabase.from('vehicles').select('*').eq('id', doc.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const co = (company ?? {}) as Record<string, unknown>;
  const c = (contact ?? null) as Record<string, unknown> | null;
  const v = (vehicle ?? null) as Record<string, unknown> | null;

  // Langue du client (I18N004) : le papier remis au client est dans SA langue (fiche contact),
  // mêmes libellés que le PDF (`salesPdf.*`), pas ceux de l'écran de l'utilisateur.
  const locale = contactLocale(c);
  const t = (key: string) => tIn(locale, key);
  const typeLabel = t(`sales.type_${doc.doc_type}`);
  const title = `${typeLabel} ${doc.number ?? ''}`.trim();

  // Le document est-il une vente d'occasion en TVA marge ? (article lié de type O)
  let isMarge = false;
  const i18nByArticle = new Map<string, unknown>();
  const artIds = lines.map((l) => l.article_id).filter(Boolean) as string[];
  if (artIds.length) {
    const { data: arts } = await supabase.from('articles').select('id, mgmt_type').in('id', artIds);
    isMarge = (arts ?? []).some((a) => a.mgmt_type === 'O');
    if (locale !== 'fr') {
      // Désignations traduites (M-67) ; colonne absente tant que la migration 20261030140000 n'est pas posée.
      const { data: tr } = await supabase.from('articles').select('id, designation_i18n').in('id', artIds);
      for (const a of (tr ?? []) as { id: string; designation_i18n: unknown }[]) i18nByArticle.set(a.id, a.designation_i18n);
    }
  }
  const designationOf = (l: { article_id: string | null; designation: string }) =>
    l.article_id ? designationFor(locale, l.designation, i18nByArticle.get(l.article_id)) : l.designation;

  const heure = doc.created_at ? new Date(doc.created_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  const condition = (doc.condition_reglement as string) || t('salesPdf.conditionDefault');
  const echeance = dmy(doc.due_date) || dmy(doc.issue_date);
  const numClient = (c?.legacy_code as string) || (c?.id ? String(c.id).slice(0, 8) : '');

  const clientBox = c ? [
    `<strong>${esc(contactDisplayName(c as never))}</strong>`,
    esc([c.street_number, c.address].filter(Boolean).join(' ')),
    esc([c.zip, c.city, (c.country && c.country !== 'BE') ? c.country : ''].filter(Boolean).join(' ')),
    (c.phone || c.mobile) ? `${esc(t('salesPdf.phone'))} : ${esc([c.phone, c.mobile].filter(Boolean).join(' / '))}` : '',
    c.vat_number ? `${esc(t('salesPdf.vatId'))} : ${esc(c.vat_number)}` : '',
  ].filter(Boolean).join('<br>') : '';

  // Lignes selon leur type (mission 05, carte 5) : ligne vide = séparation, texte = commentaire
  // multi-lignes sans montant, main-d'œuvre = quantité en heures.
  const rows = lines.map((l) => {
    if (l.line_type === 'vide') return `<tr class="blank"><td colspan="8">&nbsp;</td></tr>`;
    if (l.line_type === 'texte') return `<tr class="text"><td></td><td colspan="7">${esc(l.designation)}</td></tr>`;
    const qty = Number(l.quantity).toFixed(2).replace('.', ',') + (l.line_type === 'main_oeuvre' ? ` ${esc(t('sales.hoursUnit'))}` : '');
    return `
    <tr>
      <td>${esc(l.reference ?? '')}</td>
      <td>${esc(designationOf(l))}</td>
      <td class="r">${qty}</td>
      <td class="r">${eur(Number(l.unit_price_ht))}</td>
      <td class="r">${eur(Number(l.unit_price_ht) * (1 + (doc.tax_exempt ? 0 : Number(l.vat_rate)) / 100))}</td>
      <td class="r">${esc(Number(l.discount_pct || 0))}</td>
      <td class="r">${eur(Number(l.line_ttc))}</td>
      <td class="r">${doc.tax_exempt ? '0' : esc(Number(l.vat_rate))}</td>
    </tr>`;
  }).join('');

  // Bloc détail véhicule (3 colonnes) sous les lignes, pour une vente V/O/P.
  const vehBlock = v ? `
    <div class="vehblock">
      <div>${[
        v.vin ? `${esc(t('salesPdf.vin'))} : ${esc(v.vin)}` : '', v.model ? `${esc(t('salesPdf.model'))} : ${esc(v.model)}` : '',
        v.mileage != null ? `${esc(t('salesPdf.mileage'))} : ${esc(v.mileage)}` : '', v.antipollution ? `${esc(t('salesPdf.antipollution'))} : ${esc(v.antipollution)}` : '',
        v.cylinders != null ? `${esc(t('salesPdf.cylinders'))} : ${esc(v.cylinders)}` : '',
      ].filter(Boolean).join('<br>')}</div>
      <div>${[
        v.legacy_state ? `${esc(t('salesPdf.state'))} : ${esc(v.legacy_state)}` : '', v.plate ? `${esc(t('salesPdf.plate'))} : ${esc(v.plate)}` : '',
        v.displacement != null ? `${esc(t('salesPdf.displacement'))} : ${esc(v.displacement)}` : '', v.color ? `${esc(t('salesPdf.color'))} : ${esc(v.color)}` : '',
        v.first_registration_date ? `${esc(t('salesPdf.firstRegistration'))} : ${dmy(v.first_registration_date as string)}` : '',
      ].filter(Boolean).join('<br>')}</div>
      <div>${[
        v.brand ? `${esc(t('salesPdf.brand'))} : ${esc(v.brand)}` : '', v.engine_number ? `${esc(t('salesPdf.engineNumber'))} : ${esc(v.engine_number)}` : '',
        v.power_cv != null ? `${esc(t('salesPdf.powerCv'))} : ${esc(v.power_cv)}` : '',
      ].filter(Boolean).join('<br>')}</div>
    </div>` : '';

  const brutTtc = lines.reduce((s, l) => s + Number(l.line_ttc), 0);
  const reste = Number(doc.total_ttc) - Number(doc.paid_amount);
  const totalsBox = `
    <table class="totals">
      <tr><td>${esc(t('salesPdf.grossTtc'))}</td><td class="r">${eur(brutTtc)}</td></tr>
      <tr><td>${esc(t('salesPdf.netHt'))}</td><td class="r">${eur(Number(doc.total_ht))}</td></tr>
      <tr><td>${esc(t('salesPdf.totalVat'))}</td><td class="r">${eur(Number(doc.total_vat))}</td></tr>
      <tr class="strong"><td>${esc(t('salesPdf.netTtc'))}</td><td class="r">${eur(Number(doc.total_ttc))}</td></tr>
      <tr class="strong"><td>${esc(t('salesPdf.due'))}</td><td class="r">${eur(reste)}</td></tr>
    </table>`;

  const payRows = (payments ?? []).filter((p) => Number(p.amount) !== 0).map((p) => `
    <tr><td>${dmy(p.paid_at)}</td><td>${esc((p.note as string) && String(p.note).toLowerCase().includes('acompte') ? `${t('salesPdf.deposit')} ` : '')}${esc(p.method)}</td><td class="r">${eur(Number(p.amount))}</td></tr>`).join('');
  const payBlock = payRows ? `<table class="pays"><tbody>${payRows}</tbody></table>` : '';

  // Mentions légales (TVA marge, détaxe) : textes du dictionnaire, FR de référence, NL/EN/IT fidèles.
  const margeMention = isMarge
    ? `<p class="mention">${esc(t('salesPdf.margeMention'))}</p>`
    : (doc.tax_exempt ? `<p class="mention">${esc(t('sales.taxExemptMention'))}</p>` : '');
  const footerText = co.invoice_footer ? `<p class="footer-note">${esc(co.invoice_footer)}</p>` : '';
  const cgvPage = co.cgv_text
    ? `<div class="cgv"><h3>${esc(t('salesPdf.cgvTitle'))}</h3><div>${esc(co.cgv_text)}</div><p class="signature">${esc(t('salesPdf.cgvSignature'))}</p></div>`
    : '';
  const barcode = doc.number ? code128Svg(String(doc.number)) : '';

  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:14mm;font-size:12px;line-height:1.4}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .co{max-width:46%}
  .co .brand{font-size:21px;font-weight:800;letter-spacing:.5px;color:#cc0000}
  .co .sub{font-size:11px;color:#333;margin-top:6px;line-height:1.6}
  .cli{border:1px solid #333;border-radius:8px;padding:10px 14px;min-width:300px}
  .bc svg{height:46px}
  .doctitle{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #111;border-bottom:1px solid #111;padding:6px 2px;margin:2px 0 10px}
  .doctitle .type{font-size:17px;font-weight:800;letter-spacing:.6px;text-transform:uppercase}
  .doctitle .num{font-size:13px;color:#333;font-variant-numeric:tabular-nums}
  .band{display:flex;border:1px solid #333;border-radius:8px;overflow:hidden;margin:0 0 12px}
  .band>div{padding:5px 8px;border-right:1px solid #ccc;font-size:10px;color:#555}
  .band>div:last-child{border-right:none}
  .band b{display:block;color:#111;font-size:12px;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  .lines thead th{text-align:left;padding:6px;font-size:9px;text-transform:uppercase;letter-spacing:.03em;color:#555;border-bottom:1px solid #999}
  .lines tbody td{padding:6px;border-bottom:1px solid #eee;font-size:11px;font-variant-numeric:tabular-nums}
  .lines tbody tr:nth-child(even){background:#fafafa}
  .lines tbody tr.text td{white-space:pre-wrap;font-style:italic;border-bottom:none}
  .lines tbody tr.blank td{border-bottom:none;background:transparent}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .vehblock{display:flex;gap:24px;font-size:10px;color:#333;padding:8px 6px;border-bottom:1px solid #eee}
  .vehblock>div{flex:1}
  .bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:20px}
  .totals{width:280px;border:1px solid #333;border-radius:6px;overflow:hidden}
  .totals td{padding:5px 10px;font-size:12px;font-variant-numeric:tabular-nums}
  .totals tr:not(:last-child) td{border-bottom:1px solid #eee}
  .totals .strong td{font-weight:800;background:#f5f5f5}
  .pays td{padding:2px 8px;font-size:10px;border-bottom:1px solid #eee;font-variant-numeric:tabular-nums}
  .mention{margin-top:12px;font-size:10px;color:#444;font-style:italic}
  .footer-note{margin-top:8px;font-size:11px;color:#333}
  .cgv{page-break-before:always;font-size:10px;color:#333}
  .cgv div{white-space:pre-wrap}
  .cgv .signature{margin-top:16px;font-weight:bold}
  @media print{body{margin:12mm}}
</style></head>
<body>
  <div class="top">
    <div class="co">
      ${co.logo_url ? `<img src="${esc(co.logo_url)}" alt="${esc(companyName)}" style="max-height:96px;max-width:300px;display:block">` : `<div class="brand">${esc(companyName)}</div>`}
      <div class="sub">${[esc(co.address), esc([co.zip, co.city].filter(Boolean).join(' ')),
        co.phone ? esc(co.phone) : '', co.email ? esc(co.email) : '',
        co.legal_name ? esc(co.legal_name) : '', co.vat_number ? `${esc(t('salesPdf.vat'))} : ${esc(co.vat_number)}` : '',
        co.iban ? `IBAN : ${esc(co.iban)}` : ''].filter(Boolean).join('<br>')}</div>
    </div>
    <div style="text-align:right">
      <div class="cli">${clientBox || esc(t('sales.client'))}</div>
      <div class="bc">${barcode}</div>
    </div>
  </div>

  <div class="doctitle"><span class="type">${esc(typeLabel)}</span><span class="num">N° ${esc(doc.number ?? '')}</span></div>

  <div class="band">
    <div>${esc(typeLabel.toUpperCase())}<b>${esc(doc.number ?? '')}</b></div>
    <div>${esc(t('salesPdf.date'))}<b>${dmy(doc.issue_date)}</b></div>
    <div>${esc(t('salesPdf.time'))}<b>${esc(heure)}</b></div>
    <div>${esc(t('salesPdf.clientNo'))}<b>${esc(numClient)}</b></div>
    <div>${esc(t('salesPdf.condition'))}<b>${esc(condition)}</b></div>
    <div>${esc(t('salesPdf.dueDate'))}<b>${esc(echeance)}</b></div>
    <div>${esc(t('salesPdf.operator'))}<b>${esc(doc.operator ?? '')}</b></div>
  </div>

  <table class="lines">
    <thead><tr><th>${esc(t('salesPdf.colRef'))}</th><th>${esc(t('salesPdf.colDesignation'))}</th><th class="r">${esc(t('salesPdf.colQty'))}</th><th class="r">${esc(t('salesPdf.colPuHt'))}</th><th class="r">${esc(t('salesPdf.colPuTtc'))}</th><th class="r">${esc(t('salesPdf.colDiscount'))}</th><th class="r">${esc(t('salesPdf.colAmountTtc'))}</th><th class="r">${esc(t('salesPdf.colVat'))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${vehBlock}

  <div class="bottom">
    <div style="max-width:55%">${payBlock}${margeMention}${footerText}</div>
    ${totalsBox}
  </div>
  ${cgvPage}
  <script>window.onload=function(){window.print();};</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
