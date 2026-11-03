/**
 * M6 (POS) — PDF du journal Z (PDV010, 03/11/2026) : journal des recettes d'une session de caisse,
 * dessiné depuis l'instantané FIGÉ à la clôture (`cash_sessions.z_report`) ; la réimpression
 * redonne exactement les mêmes chiffres, avec la mention « Réimpression du … ». Un rapport X
 * (session ouverte) porte « provisoire, non numéroté ».
 *
 * Mentions (AR n° 1 art. 14 § 2 et 15 § 4, AR du 13/12/2022) : identification de l'établissement
 * et de la caisse, numéro d'ordre, période, totaux par taux de TVA, réductions, remboursements,
 * chiffre d'affaires net TVAC, encaissements par mode, lignes distinctes des ventes > 500 EUR TTC,
 * fond / théorique / compté / écart et son motif.
 *
 * jsPDF dans le navigateur (comme `document-pdf.ts`) ; couleurs et polices de `pdf-print-style.ts`.
 * Libellés dans la langue de l'utilisateur (document interne, pas un document client).
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { t, fillVars } from '@/lib/i18n';
import { PDF_COLORS, PDF_FONT, PDF_PAGE, type Rgb } from './pdf-print-style';
import type { ZReport } from './z-report';

type Pdf = import('jspdf').jsPDF;

const eur = (n: number | null | undefined): string => {
  if (n == null) return '-';
  const v = Math.round(Number(n) * 100) / 100;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} EUR`;
};
const dt = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export type ZPdfOptions = { reprintAt?: Date | null };

/** Lignes de texte du Z, dans l'ordre du PDF (aussi utilisées par les tests). */
export function zPdfSections(z: ZReport): { title: string; rows: [string, ...string[]][]; head?: string[] }[] {
  const sections: { title: string; rows: [string, ...string[]][]; head?: string[] }[] = [];
  sections.push({ title: t('cash.zDocuments'), head: [t('cash.zDocType'), t('cash.zCount'), t('cash.total')],
    rows: z.documents.map((d) => [t(`sales.type_${d.doc_type}`), String(d.count), eur(d.total_ttc)]) });
  const vt = z.vat_breakdown.reduce((a, v) => ({ b: a.b + v.base_ht, v: a.v + v.vat, t: a.t + v.ttc }), { b: 0, v: 0, t: 0 });
  sections.push({ title: t('cash.vat'), head: [t('cash.vatRate'), t('cash.baseHt'), t('cash.vatAmount'), t('cash.ttc')],
    rows: [...z.vat_breakdown.map((v) => [`${v.vat_rate} %`, eur(v.base_ht), eur(v.vat), eur(v.ttc)] as [string, ...string[]]),
      [t('cash.total'), eur(vt.b), eur(vt.v), eur(vt.t)]] });
  sections.push({ title: t('cash.zTotals'), rows: [
    [t('cash.ticketCount'), String(z.ticket_count)],
    [t('cash.discounts'), eur(z.discounts_ht)],
    [t('cash.refundsTtc'), eur(z.refunds_ttc)],
    [t('cash.netSales'), eur(z.net_sales_ttc)],
  ] });
  sections.push({ title: t('cash.byMethod'), head: [t('cash.method'), t('cash.sales'), t('cash.deposits'), t('cash.refunds'), t('cash.total')],
    rows: z.payments_by_method.map((p) => [p.label, eur(p.sales), eur(p.deposits), eur(p.refunds), eur(p.total)]) });
  sections.push({ title: t('cash.largeItems'), head: [t('cash.zDocNumber'), t('pos.article'), t('pos.qty'), t('cash.ttc')],
    rows: z.large_items.length ? z.large_items.map((l) => [l.number ?? '-', l.designation, String(l.quantity), eur(l.line_ttc)])
      : [[t('cash.noLargeItems')]] });
  sections.push({ title: t('cash.zCash'), rows: [
    [t('cash.openingFloat'), eur(z.opening_float)],
    [t('cash.cashIn'), eur(z.cash_in_esp)],
    [t('cash.cashOut'), eur(z.cash_out_esp)],
    [t('cash.theoretical'), eur(z.expected_cash)],
    [t('cash.countedCash'), eur(z.counted_cash)],
    [t('cash.variance'), eur(z.variance)],
    [t('cash.varianceReason'), z.variance_reason || '-'],
  ] });
  if (z.movements.length) {
    sections.push({ title: t('cash.movements'), head: [t('cash.colOpened'), t('cash.method'), t('cash.reason'), t('cash.amount')],
      rows: z.movements.map((m) => [dt(m.occurred_at), m.method, m.reason ?? '', `${m.kind === 'out' ? '-' : '+'} ${eur(m.amount)}`]) });
  }
  return sections;
}

function draw(doc: Pdf, z: ZReport, opts: ZPdfOptions): void {
  const { margin: M, width: W, height: H, footer: F, lineHeight: LH } = PDF_PAGE;
  const right = W - M;
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' = 'normal') => { doc.setFont(PDF_FONT.family, style); doc.setFontSize(size); };
  let y = M;
  const need = (h: number) => { if (y + h > H - M - F) { doc.addPage(); y = M; } };

  font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
  doc.text(z.number ? fillVars(t('cash.pdfZTitle'), { number: z.number }) : t('cash.pdfXTitle'), M, y + 5);
  y += 10;
  font(PDF_FONT.body); color(PDF_COLORS.muted);
  const co = z.company;
  const head = [
    [co.legal_name || co.name, co.vat_number ? `${t('salesPdf.vat')} : ${co.vat_number}` : ''].filter(Boolean).join(' - '),
    [co.address, [co.zip, co.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    `${t('cash.register')} : ${z.register_code}`,
    `${t('cash.period')} : ${dt(z.opened_at)} - ${dt(z.closed_at)}`,
  ].filter(Boolean);
  for (const l of head) { doc.text(l, M, y); y += LH; }
  y += 2;

  for (const sec of zPdfSections(z)) {
    need(LH * 3);
    font(PDF_FONT.body, 'bold'); color(PDF_COLORS.ink);
    doc.text(sec.title, M, y); y += 1.5;
    doc.setDrawColor(PDF_COLORS.rule[0], PDF_COLORS.rule[1], PDF_COLORS.rule[2]); doc.setLineWidth(0.2);
    doc.line(M, y, right, y); y += LH;
    const cols = Math.max(sec.head?.length ?? 0, ...sec.rows.map((r) => r.length));
    // Première colonne large (libellé / désignation), les montants alignés à droite.
    const firstW = cols <= 2 ? 120 : 70;
    const restW = cols > 1 ? (right - M - firstW) / (cols - 1) : 0;
    const xRight = (i: number) => M + firstW + restW * i;
    const row = (cells: string[], bold = false) => {
      need(LH);
      font(PDF_FONT.small, bold ? 'bold' : 'normal'); color(bold ? PDF_COLORS.muted : PDF_COLORS.ink);
      const first = (doc.splitTextToSize(cells[0] ?? '', firstW - 2) as string[])[0] ?? '';
      doc.text(first, M, y);
      for (let i = 1; i < cells.length; i++) doc.text(cells[i], xRight(i), y, { align: 'right' });
      y += LH;
    };
    if (sec.head) row(sec.head, true);
    if (sec.rows.length === 0) row(['-']);
    for (const r of sec.rows) row(r);
    y += 2;
  }

  // Pied : statut du journal (figé / provisoire) et réimpression.
  need(LH * 3);
  font(PDF_FONT.small); color(PDF_COLORS.soft);
  doc.text(z.number ? fillVars(t('cash.pdfFrozen'), { date: dt(z.closed_at) }) : t('cash.pdfProvisional'), M, y); y += LH;
  if (opts.reprintAt) doc.text(fillVars(t('cash.pdfReprint'), { date: dt(opts.reprintAt.toISOString()) }), M, y);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(`${z.number ?? 'X'} - ${i}/${pages}`, right, H - M / 2, { align: 'right' });
  }
}

export async function buildZPdf(z: ZReport, opts: ZPdfOptions = {}, compress = true): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  draw(doc, z, opts);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Ouvre le PDF dans un nouvel onglet (aperçu / impression / réimpression). */
export function openPdfBytes(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
