/**
 * M6 — Impression d'un document de vente (FAC/DEV/TIK/BL/AVO) au format attendu par
 * le client (cf. FACTURE 26xxxxxx.pdf, docs/migration-g8-formats.md §5) : en-tête
 * société + bloc client encadré + code-barres, bandeau (date/heure/n° client/condition/
 * échéance/opérateur/page), lignes, bloc détail véhicule, encadré totaux (BRUT/NET HT/
 * TVA/NET TTC/RESTE À PAYER), règlements datés, mention TVA marge, CGV au verso.
 * HTML imprimable, sans dépendance externe (déployable Lovable).
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import { code128Svg } from '@/modules/articles/barcode';
import type { DocumentFull } from './write-api';
import { t } from '@/lib/i18n';

const eur = (n: number) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const dmy = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('fr-BE') : '');

export async function printDocument(full: DocumentFull, companyName: string): Promise<void> {
  const { doc, lines } = full;
  const typeLabel = t(`sales.type_${doc.doc_type}`);
  const title = `${typeLabel} ${doc.number ?? ''}`.trim();

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

  // Le document est-il une vente d'occasion en TVA marge ? (article lié de type O)
  let isMarge = false;
  const artIds = lines.map((l) => l.article_id).filter(Boolean) as string[];
  if (artIds.length) {
    const { data: arts } = await supabase.from('articles').select('id, mgmt_type').in('id', artIds);
    isMarge = (arts ?? []).some((a) => a.mgmt_type === 'O');
  }

  const heure = doc.created_at ? new Date(doc.created_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  const condition = (doc.condition_reglement as string) || 'AU GRAND COMPTANT';
  const echeance = dmy(doc.due_date) || dmy(doc.issue_date);
  const numClient = (c?.legacy_code as string) || (c?.id ? String(c.id).slice(0, 8) : '');

  const clientBox = c ? [
    `<strong>${esc(contactDisplayName(c as never))}</strong>`,
    esc([c.street_number, c.address].filter(Boolean).join(' ')),
    esc([c.zip, c.city, (c.country && c.country !== 'BE') ? c.country : ''].filter(Boolean).join(' ')),
    (c.phone || c.mobile) ? `Tél : ${esc([c.phone, c.mobile].filter(Boolean).join(' / '))}` : '',
    c.vat_number ? `Identification T.V.A. : ${esc(c.vat_number)}` : '',
  ].filter(Boolean).join('<br>') : '';

  const rows = lines.map((l) => `
    <tr>
      <td>${esc((l as Record<string, unknown>).reference ?? '')}</td>
      <td>${esc(l.designation)}</td>
      <td class="r">${esc(Number(l.quantity).toFixed(2))}</td>
      <td class="r">${eur(Number(l.unit_price_ht))}</td>
      <td class="r">${eur(Number((l as Record<string, unknown>).unit_price_ttc ?? Number(l.unit_price_ht) * (1 + Number(l.vat_rate) / 100)))}</td>
      <td class="r">${esc(Number(l.discount_pct || 0))}</td>
      <td class="r">${eur(Number(l.line_ttc))}</td>
      <td class="r">${doc.tax_exempt ? '0' : esc(Number(l.vat_rate))}</td>
    </tr>`).join('');

  // Bloc détail véhicule (3 colonnes) sous les lignes, pour une vente V/O/P.
  const vehBlock = v ? `
    <div class="vehblock">
      <div>${[
        v.vin ? `N° de série : ${esc(v.vin)}` : '', v.model ? `Modèle : ${esc(v.model)}` : '',
        v.mileage != null ? `Kilométrage : ${esc(v.mileage)}` : '', v.antipollution ? `Norme antipollution : ${esc(v.antipollution)}` : '',
        v.cylinders != null ? `Nb de cylindres : ${esc(v.cylinders)}` : '',
      ].filter(Boolean).join('<br>')}</div>
      <div>${[
        v.legacy_state ? `Etat : ${esc(v.legacy_state)}` : '', v.plate ? `N° de plaque : ${esc(v.plate)}` : '',
        v.displacement != null ? `Cylindrée : ${esc(v.displacement)}` : '', v.color ? `Couleur : ${esc(v.color)}` : '',
        v.first_registration_date ? `Mise en circulation : ${dmy(v.first_registration_date as string)}` : '',
      ].filter(Boolean).join('<br>')}</div>
      <div>${[
        v.brand ? `Marque : ${esc(v.brand)}` : '', v.engine_number ? `N° de moteur : ${esc(v.engine_number)}` : '',
        v.power_cv != null ? `Puissance en CV : ${esc(v.power_cv)}` : '',
      ].filter(Boolean).join('<br>')}</div>
    </div>` : '';

  const brutTtc = lines.reduce((s, l) => s + Number(l.line_ttc), 0);
  const reste = Number(doc.total_ttc) - Number(doc.paid_amount);
  const totalsBox = `
    <table class="totals">
      <tr><td>BRUT T.T.C.</td><td class="r">${eur(brutTtc)}</td></tr>
      <tr><td>NET H.T.</td><td class="r">${eur(Number(doc.total_ht))}</td></tr>
      <tr><td>TOTAL T.V.A.</td><td class="r">${eur(Number(doc.total_vat))}</td></tr>
      <tr class="strong"><td>NET T.T.C.</td><td class="r">${eur(Number(doc.total_ttc))}</td></tr>
      <tr class="strong"><td>RESTE A PAYER</td><td class="r">${eur(reste)}</td></tr>
    </table>`;

  const payRows = (payments ?? []).filter((p) => Number(p.amount) !== 0).map((p) => `
    <tr><td>${dmy(p.paid_at)}</td><td>${esc((p.note as string) && String(p.note).toLowerCase().includes('acompte') ? 'ACOMPTE ' : '')}${esc(p.method)}</td><td class="r">${eur(Number(p.amount))}</td></tr>`).join('');
  const payBlock = payRows ? `<table class="pays"><tbody>${payRows}</tbody></table>` : '';

  const margeMention = isMarge
    ? `<p class="mention">Livraison soumise au régime particulier - Biens d'occasion - d'imposition de la marge : TVA non déductible - art. 58 §4 CTVA.</p>`
    : (doc.tax_exempt ? `<p class="mention">${esc(t('sales.taxExemptMention'))}</p>` : '');
  const footerText = co.invoice_footer ? `<p class="footer-note">${esc(co.invoice_footer)}</p>` : '';
  const cgvPage = co.cgv_text
    ? `<div class="cgv"><h3>Conditions générales de vente</h3><div>${esc(co.cgv_text)}</div><p class="signature">Mention « lu et approuvé » + signature :</p></div>`
    : '';
  const barcode = doc.number ? code128Svg(String(doc.number)) : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:14mm;font-size:12px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
  .co{max-width:46%}
  .co .brand{font-size:20px;font-weight:800;letter-spacing:.5px;color:#cc0000}
  .co .sub{font-size:11px;color:#333;margin-top:6px;line-height:1.5}
  .cli{border:1px solid #333;border-radius:8px;padding:10px 14px;min-width:300px}
  .bc svg{height:46px}
  .band{display:flex;border:1px solid #333;border-radius:8px;overflow:hidden;margin:10px 0 2px}
  .band>div{padding:5px 8px;border-right:1px solid #ccc;font-size:10px;color:#555}
  .band>div:last-child{border-right:none}
  .band b{display:block;color:#111;font-size:12px;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  .lines thead th{text-align:left;padding:5px 6px;font-size:9px;text-transform:uppercase;color:#555;border-bottom:1px solid #999}
  .lines tbody td{padding:5px 6px;border-bottom:1px solid #eee;font-size:11px}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .vehblock{display:flex;gap:24px;font-size:10px;color:#333;padding:8px 6px;border-bottom:1px solid #eee}
  .vehblock>div{flex:1}
  .bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px}
  .totals{width:280px;border:1px solid #333;border-radius:6px}
  .totals td{padding:4px 10px;font-size:12px}
  .totals .strong td{font-weight:800}
  .pays td{padding:2px 8px;font-size:10px;border-bottom:1px solid #eee}
  .mention{margin-top:12px;font-size:10px;color:#444;font-style:italic}
  .footer-note{margin-top:8px;font-size:11px}
  .cgv{page-break-before:always;font-size:10px;color:#333}
  .cgv div{white-space:pre-wrap}
  .cgv .signature{margin-top:16px;font-weight:bold}
  @media print{body{margin:12mm}}
</style></head>
<body>
  <div class="top">
    <div class="co">
      <div class="brand">${esc(companyName)}</div>
      <div class="sub">${[esc(co.address), esc([co.zip, co.city].filter(Boolean).join(' ')),
        co.phone ? esc(co.phone) : '', co.email ? esc(co.email) : '',
        co.legal_name ? esc(co.legal_name) : '', co.vat_number ? `TVA : ${esc(co.vat_number)}` : '',
        co.iban ? `IBAN : ${esc(co.iban)}` : ''].filter(Boolean).join('<br>')}</div>
    </div>
    <div style="text-align:right">
      <div class="cli">${clientBox || esc(t('sales.client'))}</div>
      <div class="bc">${barcode}</div>
    </div>
  </div>

  <div class="band">
    <div>${esc(typeLabel.toUpperCase())}<b>${esc(doc.number ?? '')}</b></div>
    <div>DATE<b>${dmy(doc.issue_date)}</b></div>
    <div>HEURE<b>${esc(heure)}</b></div>
    <div>N° CLIENT<b>${esc(numClient)}</b></div>
    <div>CONDITION ACCORDÉE<b>${esc(condition)}</b></div>
    <div>ÉCHÉANCE<b>${esc(echeance)}</b></div>
    <div>OPERATEUR<b>${esc(doc.operator ?? '')}</b></div>
  </div>

  <table class="lines">
    <thead><tr><th>REFERENCE</th><th>DESIGNATION</th><th class="r">QUANTITE</th><th class="r">P.U. HT</th><th class="r">P.U. TTC</th><th class="r">REM. %</th><th class="r">MONTANT TTC</th><th class="r">TVA</th></tr></thead>
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
