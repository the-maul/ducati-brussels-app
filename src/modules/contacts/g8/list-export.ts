/**
 * M1 — Exports de listes de clients (G8 : « Export Excel », « Imprimer étiquettes »,
 * « Imprimer liste »), 18/11/2026. Tout se fait dans le navigateur (xlsx, jsPDF).
 */
import * as XLSX from 'xlsx';
import { patchPdfText } from '@/modules/documents/pdf-text';
import { t } from '@/lib/i18n';
import { addressLines, labelSlot, LABEL_SHEET_3x8, type AddressContact } from './rules';

/** Classeur Excel d'une feuille : en-têtes + lignes. */
export function downloadXlsx(fileName: string, sheetName: string, header: string[], rows: (string | number | boolean | null)[][]): void {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows.map((r) => r.map((v) => (v === null ? '' : v)))]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.min(40, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

/** Planche d'étiquettes d'adresse A4 (3 x 8, 70 x 37 mm). */
export async function downloadAddressLabels(contacts: AddressContact[], fileName: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  let page = 0;
  contacts.forEach((c, i) => {
    const s = labelSlot(i, LABEL_SHEET_3x8);
    if (s.page > page) { doc.addPage(); page = s.page; }
    const lines = addressLines(c).slice(0, 6);
    const pad = 6;
    let y = s.y + pad + 3;
    lines.forEach((l, k) => {
      doc.setFont('helvetica', k === 0 ? 'bold' : 'normal');
      const cut = doc.splitTextToSize(l, LABEL_SHEET_3x8.width - 2 * pad) as string[];
      doc.text(cut[0] ?? '', s.x + pad, y);
      y += 4.4;
    });
  });
  doc.save(fileName);
}

/** Liste imprimable (A4 paysage) : code, nom, adresse, e-mail, mobile. */
export async function downloadContactListPdf(
  title: string,
  rows: (AddressContact & { email?: string | null; mobile?: string | null })[],
  fileName: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  const M = 12; const W = 297; let y = 16;
  const cols = [{ x: M, w: 18 }, { x: M + 18, w: 62 }, { x: M + 80, w: 95 }, { x: M + 175, w: 65 }, { x: M + 240, w: 33 }];
  const heads = [t('g8c.list.colCode'), t('g8c.list.colName'), t('g8c.list.colAddress'), t('g8c.list.colEmail'), t('g8c.list.colMobile')];
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    heads.forEach((h, i) => doc.text(h, cols[i].x, y));
    y += 1.5; doc.setDrawColor(120); doc.line(M, y, W - M, y); y += 4; doc.setFont('helvetica', 'normal');
  };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(title, M, y);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${rows.length} · ${new Date().toLocaleDateString('fr-BE')}`, W - M, y, { align: 'right' });
  y += 8; header();
  for (const r of rows) {
    if (y > 198) { doc.addPage(); y = 16; header(); }
    const person = [r.first_name, r.last_name].filter((x) => x && String(x).trim()).join(' ');
    const name = r.type !== 'particulier' && r.company_name ? [r.company_name, person].filter(Boolean).join(' / ') : person;
    const nameLines = new Set(addressLines({ ...r, address: null, street_number: null, address_complement: null, zip: null, city: null, country: null }));
    const addr = addressLines(r).filter((l) => !nameLines.has(l)).join(', ');
    const cells = [String((r as { code?: string | null }).code ?? ''), name, addr, r.email ?? '', r.mobile ?? ''];
    cells.forEach((v, i) => doc.text((doc.splitTextToSize(v, cols[i].w - 2) as string[])[0] ?? '', cols[i].x, y));
    y += 4.6;
  }
  doc.save(fileName);
}

/**
 * Export Excel de la liste Clients (G8 « Export Excel », 32 colonnes) : toutes les fiches qui
 * répondent à la recherche affichée, pas seulement la page (lecture par lots de 1 000).
 */
export async function downloadClientListXlsx(
  fetchPage: (page: number, size: number) => Promise<{ rows: import('../api').Contact[]; total: number }>,
  showArchived: boolean,
): Promise<number> {
  const all: import('../api').Contact[] = [];
  const size = 1000;
  for (let page = 0; page < 50; page++) {
    const { rows, total } = await fetchPage(page, size);
    all.push(...rows);
    if (rows.length < size || all.length >= total) break;
  }
  const rows = showArchived ? all : all.filter((c) => c.is_active);
  const yes = t('g8c.yes');
  const b = (v: boolean | null | undefined) => (v ? yes : '');
  downloadXlsx(`clients_${new Date().toISOString().slice(0, 10)}.xlsx`, t('g8c.list.sheet'),
    [t('g8c.list.colCode'), t('g8c.list.colStatus'), t('g8c.list.colType'), t('g8c.list.colCivility'), t('g8c.list.colLastName'), t('g8c.list.colFirstName'),
      t('g8c.list.colCompany'), t('g8c.list.colNumber'), t('g8c.list.colStreet'), t('g8c.list.colComplement'), t('g8c.list.colComplement2'), t('g8c.list.colPoBox'),
      t('g8c.list.colZip'), t('g8c.list.colCity'), t('g8c.list.colCountry'), t('g8c.list.colPhone'), t('g8c.list.colMobile'), t('g8c.list.colPhonePro'),
      t('g8c.list.colMobilePro'), t('g8c.list.colEmail'), t('g8c.list.colEmailPro'), t('g8c.list.colPriceList'), t('g8c.list.colCategory'),
      t('g8c.list.colTerms'), t('g8c.list.colCreated'), t('g8c.list.colBirth'), t('g8c.list.colAccount'), t('g8c.list.colDetaxe'),
      t('g8c.list.colNpai'), t('g8c.list.colVat'), t('g8c.list.colWatch'), t('g8c.list.colArchived')],
    rows.map((c) => [c.code, t(`contacts.status_${c.status}`), t(`contacts.type_${c.type}`), c.civility ?? c.legal_form, c.last_name, c.first_name,
      c.company_name, (c as { street_number?: string | null }).street_number ?? '', c.address, c.address_complement, c.address_complement2, c.po_box,
      c.zip, c.city, c.country, c.phone, c.mobile, c.phone_pro, c.mobile_pro, c.email, c.email_pro, c.price_list, c.category,
      c.payment_terms, c.created_at ? c.created_at.slice(0, 10) : '', c.birth_date, c.accounting_account, b(c.is_detaxe),
      b(c.address_mismatch), c.vat_number, b(c.is_watch), b(!c.is_active)]));
  return rows.length;
}
