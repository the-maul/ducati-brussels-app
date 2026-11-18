/**
 * M1 — RGPD (G8 « RGPD - Édition fiche » et « RGPD - Portabilité »), 18/11/2026.
 *   - Édition fiche : PDF lisible des données que la concession détient sur le client
 *     (identité, coordonnées, consentements, motos, documents, échanges), à remettre au client.
 *   - Portabilité : les mêmes données, complètes, en JSON (format lisible par une machine,
 *     art. 20 RGPD) et en classeur Excel (une feuille par rubrique).
 * Les données viennent de la fonction SQL contact_gdpr_export (qui trace l'export dans events).
 */
import * as XLSX from 'xlsx';
import { patchPdfText } from '@/modules/documents/pdf-text';
import { t } from '@/lib/i18n';
import { gdprExport } from './api';
import { exportToSheets, CONSENT_CHANNELS } from './rules';

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const d10 = (v: unknown) => { const s = str(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s; };
const stamp = () => new Date().toISOString().slice(0, 10);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileBase(c: Obj): string {
  const name = [c.code, c.last_name ?? c.company_name].filter(Boolean).join('_');
  return `rgpd_${String(name).replace(/[^\w.-]+/g, '_')}_${stamp()}`;
}

/** Portabilité : JSON + Excel. */
export async function downloadPortability(contactId: string): Promise<void> {
  const data = await gdprExport(contactId, 'portabilite');
  const c = (data.contact ?? {}) as Obj;
  const base = fileBase(c);
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${base}.json`);
  const wb = XLSX.utils.book_new();
  for (const sh of exportToSheets(data as Parameters<typeof exportToSheets>[0])) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
  }
  XLSX.writeFile(wb, `${base}.xlsx`);
}

/** Champs de la fiche repris dans le PDF (clé de colonne -> clé de libellé). */
const PDF_FIELDS: [string, string][] = [
  ['code', 'g8c.pdf.code'], ['civility', 'g8c.pdf.civility'], ['first_name', 'g8c.pdf.firstName'], ['last_name', 'g8c.pdf.lastName'],
  ['birth_name', 'g8c.pdf.birthName'], ['company_name', 'g8c.pdf.company'], ['legal_form', 'g8c.pdf.legalForm'], ['vat_number', 'g8c.pdf.vat'],
  ['email', 'g8c.pdf.email'], ['email_pro', 'g8c.pdf.emailPro'], ['mobile', 'g8c.pdf.mobile'], ['phone', 'g8c.pdf.phone'],
  ['phone_pro', 'g8c.pdf.phonePro'], ['address', 'g8c.pdf.street'], ['street_number', 'g8c.pdf.number'],
  ['address_complement', 'g8c.pdf.complement'], ['po_box', 'g8c.pdf.poBox'], ['zip', 'g8c.pdf.zip'], ['city', 'g8c.pdf.city'],
  ['country', 'g8c.pdf.country'], ['birth_date', 'g8c.pdf.birthDate'], ['birth_place', 'g8c.pdf.birthPlace'],
  ['national_id', 'g8c.pdf.idCard'], ['national_register', 'g8c.pdf.nationalRegister'], ['license_number', 'g8c.pdf.license'],
  ['license_date', 'g8c.pdf.licenseDate'], ['license_category', 'g8c.pdf.licenseCategory'], ['iban', 'g8c.pdf.iban'],
  ['locale', 'g8c.pdf.locale'], ['marketing_opt_out', 'g8c.pdf.optOut'], ['created_at', 'g8c.pdf.createdAt'],
];

/** Édition de la fiche RGPD : PDF A4 téléchargé. */
export async function downloadGdprSheetPdf(contactId: string): Promise<void> {
  const data = await gdprExport(contactId, 'edition');
  const c = (data.contact ?? {}) as Obj;
  const ctrl = (data.controller ?? {}) as Obj;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const M = 15; const W = 210; let y = 18;
  const need = (h: number) => { if (y + h > 282) { doc.addPage(); y = 18; } };
  const title = (s: string) => { need(12); y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(s, M, y); y += 2; doc.setDrawColor(150); doc.line(M, y, W - M, y); y += 5; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); };
  const line = (s: string) => { const parts = doc.splitTextToSize(s, W - 2 * M) as string[]; need(parts.length * 4.2); doc.text(parts, M, y); y += parts.length * 4.2; };
  const kv = (k: string, v: string) => { need(4.5); doc.setFont('helvetica', 'bold'); doc.text(k, M, y); doc.setFont('helvetica', 'normal'); const parts = doc.splitTextToSize(v, W - 2 * M - 55) as string[]; doc.text(parts, M + 55, y); y += Math.max(1, parts.length) * 4.2; };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(t('g8c.pdf.title'), M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  line(t('g8c.pdf.intro').replace('{company}', str(ctrl.name)).replace('{date}', d10(data.generated_at)));
  if (ctrl.address) line(`${t('g8c.pdf.controller')} : ${str(ctrl.name)} — ${str(ctrl.address)}${ctrl.vat_number ? ` — ${t('g8c.pdf.vat')} ${str(ctrl.vat_number)}` : ''}`);

  title(t('g8c.pdf.secIdentity'));
  for (const [k, label] of PDF_FIELDS) {
    const v = c[k];
    if (v === null || v === undefined || v === '' || v === false) continue;
    kv(t(label), v === true ? t('g8c.yes') : (k.endsWith('_date') || k === 'created_at') ? d10(v) : str(v));
  }

  title(t('g8c.pdf.secConsents'));
  const state = (data.consent_state ?? {}) as Obj;
  line(CONSENT_CHANNELS.map((ch) => `${t(`g8c.channel.${ch}`)} : ${state[ch] ? t(`g8c.rgpd.state_${String(state[ch])}`) : t('g8c.rgpd.state_none')}`).join(' · '));
  const consents = (data.consents ?? []) as Obj[];
  if (consents.length === 0) line(t('g8c.rgpd.none'));
  for (const k of consents) {
    const acc = ((k.accepted ?? []) as string[]).map((x) => t(`g8c.channel.${x}`)).join(', ') || '—';
    const ref = ((k.refused ?? []) as string[]).map((x) => t(`g8c.channel.${x}`)).join(', ') || '—';
    line(`${d10(k.declared_at)} — ${t('g8c.rgpd.colAccepted')} : ${acc} — ${t('g8c.rgpd.colRefused')} : ${ref}${k.form ? ` — ${t(`g8c.form.${String(k.form)}`)}` : ''}${k.expires_at ? ` — ${t('g8c.rgpd.colExpiry')} ${d10(k.expires_at)}` : ''}${k.revoked_at ? ` — ${t('g8c.rgpd.status_revoquee')} ${d10(k.revoked_at)}` : ''}`);
  }

  title(t('g8c.pdf.secVehicles'));
  const vehicles = (data.vehicles ?? []) as Obj[];
  if (vehicles.length === 0) line('—');
  for (const v of vehicles) line([v.brand, v.model, v.vin, v.plate].filter(Boolean).map(str).join(' · ') + ` (${d10(v.from_date)}${v.to_date ? ` → ${d10(v.to_date)}` : ''})`);

  title(t('g8c.pdf.secDocuments'));
  const docs = (data.documents ?? []) as Obj[];
  if (docs.length === 0) line('—');
  for (const d of docs.slice(0, 200)) line(`${d10(d.issue_date)} — ${t(`sales.type_${str(d.doc_type)}`)} ${str(d.number)} — ${str(d.total_ttc)} EUR`);
  if (docs.length > 200) line(t('g8c.pdf.more').replace('{n}', String(docs.length - 200)));

  title(t('g8c.pdf.secOther'));
  const count = (k: string) => ((data[k] ?? []) as unknown[]).length;
  line(`${t('g8c.pdf.cntRepairOrders')} : ${count('repair_orders')} · ${t('g8c.pdf.cntAppointments')} : ${count('workshop_appointments')} · ${t('g8c.pdf.cntCommunications')} : ${count('communications')} · ${t('g8c.pdf.cntAttachments')} : ${count('attachments')} · ${t('g8c.pdf.cntDelivery')} : ${count('delivery_addresses')} · ${t('g8c.pdf.cntSubcontacts')} : ${count('subcontacts')}`);

  title(t('g8c.pdf.secRights'));
  line(t('g8c.pdf.rights'));

  doc.save(`${fileBase(c)}.pdf`);
}
