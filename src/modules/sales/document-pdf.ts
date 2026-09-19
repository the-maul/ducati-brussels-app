/**
 * M6/M9 — Vrai PDF d'un document de vente (Devis / proforma, bon de commande, réservation, BL,
 * facture, ticket, avoir). Mission 05 carte 8 « Aperçu du document et envoi par mail » et
 * mission 02 carte 6 « Envoyer au client le document de réservation en PDF par mail ».
 *
 * Fidèle à l'impression HTML (`print-document.ts`) : en-tête société (table `companies`), bloc
 * client, code-barres du n°, bandeau date / heure / n° client / condition / échéance / opérateur,
 * lignes (article, main-d'œuvre en heures, texte multi-lignes, ligne vide), bloc véhicule,
 * détail TVA par taux, totaux, règlements (acomptes) et RESTE À PAYER, mentions (TVA marge,
 * détaxe), validité (« Devis valable 1 mois », réglable), case signature, pied de facture, CGV.
 *
 * Choix technique (voir docs/bible/modules/M09-documents.md §4) : génération dans le navigateur
 * avec jsPDF, déjà utilisé par le module Reprises (M7) — aucune nouvelle dépendance, rien à
 * déployer côté serveur, le même PDF sert à l'aperçu, à l'envoi et à l'archivage en GED.
 *
 * Ce fichier est PUR (aucun accès base) : `document-pdf-data.ts` charge les données.
 * Couleurs et polices : uniquement `pdf-print-style.ts`.
 */
import { patchPdfText } from '@/modules/documents/pdf-text';
import { code128Svg } from '@/modules/articles/barcode';
import { t } from '@/lib/i18n';
import { lineHasAmount, type LineType } from './write-api';
import { PDF_COLORS, PDF_FONT, PDF_PAGE, type Rgb } from './pdf-print-style';

// ---------------------------------------------------------------------------------------------
// Données d'entrée
// ---------------------------------------------------------------------------------------------

export type SalesPdfLine = {
  lineType: LineType | string;
  reference: string | null;
  designation: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
  discountPct: number;
  lineTtc: number;
};

export type SalesPdfPayment = { date: string; label: string; amount: number; received: boolean };

export type SalesPdfLogo = { dataUrl: string; format: 'JPEG' | 'PNG'; w: number; h: number };

export type SalesPdfInput = {
  docType: string;
  number: string | null;
  issueDate: string;             // AAAA-MM-JJ
  createdAt: string | null;      // horodatage ISO (heure du bandeau)
  dueDate: string | null;
  condition: string | null;
  operator: string | null;
  clientCode: string | null;
  company: {
    name: string;
    legalName?: string | null;
    address?: string | null;
    zip?: string | null;
    city?: string | null;
    vatNumber?: string | null;
    iban?: string | null;
    bic?: string | null;
    footer?: string | null;
    cgv?: string | null;
    logo?: SalesPdfLogo | null;
  };
  /** Lignes du bloc client (nom en premier), vide si document sans client. */
  clientLines: string[];
  /** Lignes du bloc véhicule (déjà libellées), vide si aucun véhicule. */
  vehicleLines: string[];
  lines: SalesPdfLine[];
  payments: SalesPdfPayment[];
  taxExempt: boolean;
  isMarge: boolean;
  pied: VatPied;
  totals: { ht: number; vat: number; ttc: number; paid: number };
  /** Mention de validité déjà calculée (`validityMention`), ou null. */
  validity: string | null;
  notes?: string | null;
};

export type VatPied = {
  taxExempt?: boolean;
  globalDiscountPct?: number;
  globalDiscountAmount?: number;
  shippingHt?: number;
  shippingTaxed?: boolean;
  shippingVatRate?: number;
};

// ---------------------------------------------------------------------------------------------
// Calculs purs (testés)
// ---------------------------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

export type VatRow = { rate: number; base: number; vat: number };

/**
 * Détail de la TVA par taux, même règle que `computeTotals` (write-api) : HT des lignes à montant
 * (remise ligne déduite), remise globale répartie au prorata, port ajouté à son taux, détaxe = 0 %.
 * Lignes texte / vides ignorées. Trié du taux le plus haut au plus bas.
 */
export function vatBreakdown(
  lines: Pick<SalesPdfLine, 'lineType' | 'quantity' | 'unitPriceHt' | 'discountPct' | 'vatRate'>[],
  pied: VatPied = {},
): VatRow[] {
  const byRate = new Map<number, number>();
  let linesHt = 0;
  for (const l of lines) {
    if (!lineHasAmount({ line_type: l.lineType as LineType })) continue;
    const ht = Number(l.quantity) * Number(l.unitPriceHt) * (1 - (Number(l.discountPct) || 0) / 100);
    const rate = pied.taxExempt ? 0 : Number(l.vatRate) || 0;
    byRate.set(rate, (byRate.get(rate) ?? 0) + ht);
    linesHt += ht;
  }
  let discount = 0;
  if (pied.globalDiscountPct && pied.globalDiscountPct > 0) discount = (linesHt * pied.globalDiscountPct) / 100;
  else if (pied.globalDiscountAmount && pied.globalDiscountAmount > 0) discount = Math.min(pied.globalDiscountAmount, linesHt);
  const factor = linesHt > 0 ? (linesHt - discount) / linesHt : 0;
  for (const [rate, ht] of byRate) byRate.set(rate, ht * factor);
  const ship = pied.shippingHt || 0;
  if (ship > 0) {
    const rate = pied.taxExempt || pied.shippingTaxed === false ? 0 : pied.shippingVatRate ?? 21;
    byRate.set(rate, (byRate.get(rate) ?? 0) + ship);
  }
  return [...byRate.entries()]
    .filter(([, base]) => Math.abs(base) > 0.004)
    .map(([rate, base]) => ({ rate, base: r2(base), vat: r2((base * rate) / 100) }))
    .sort((a, b) => b.rate - a.rate);
}

/** Règle de validité d'un type de document (Paramètres → Tables → « Validité des documents »). */
export type ValidityRule = { docType: string; text: string; months: number; active: boolean };

/** Par défaut (aucune ligne en Paramètres) : le devis / proforma est valable 1 mois (G8, vidéo 7:19). */
export const defaultValidity = (): ValidityRule[] => [
  { docType: 'DEV', text: t('salesPdf.defaultValidity'), months: 1, active: true },
];

/** Ajoute des mois à une date AAAA-MM-JJ (fin de mois bornée : 31/01 + 1 mois = 28 ou 29/02). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export const dmy = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};

/**
 * Mention de validité : la règle de la société pour ce type (si elle existe, active ou non),
 * sinon la règle par défaut. « {date} » dans le texte est remplacé par la date limite ; sans
 * « {date} » et avec un nombre de mois, la date est ajoutée entre parenthèses.
 */
export function validityMention(docType: string, issueIso: string, rules: ValidityRule[]): string | null {
  const rule = rules.find((r) => r.docType === docType) ?? defaultValidity().find((r) => r.docType === docType);
  if (!rule || !rule.active || !rule.text.trim()) return null;
  if (!(rule.months > 0) || !issueIso) return rule.text.replace('{date}', '').trim();
  const until = dmy(addMonthsIso(issueIso, rule.months));
  return rule.text.includes('{date}')
    ? rule.text.replace('{date}', until)
    : `${rule.text} (${t('salesPdf.validUntil')} ${until})`;
}

/** Documents qui portent une case signature (accord du client, réception). */
export const SIGNATURE_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL'] as const;

export const eurPdf = (n: number): string => {
  const v = r2(Number(n) || 0);
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d} €`;
};
const num2 = (n: number) => (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',');

/** Nom de fichier du PDF : « Devis-proforma_DEV-2026-0012.pdf ». */
export function salesPdfFileName(docType: string, number: string | null): string {
  const label = t(`sales.type_${docType}`).replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-');
  const raw = `${label}_${number ?? t('salesPdf.draft')}`;
  return `${raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------------------------

type Pdf = import('jspdf').jsPDF;

/** Barres Code 128 à partir du SVG existant (même encodage que l'impression HTML). */
function barcodeBars(value: string): { x: number; w: number }[] {
  const svg = code128Svg(value, { module: 1, height: 10 });
  const bars: { x: number; w: number }[] = [];
  const re = /<rect x="([\d.]+)" y="0" width="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) bars.push({ x: Number(m[1]), w: Number(m[2]) });
  return bars;
}

/** Colonnes du tableau des lignes (mm) — mêmes colonnes que l'impression HTML. */
const COLS = [
  { key: 'ref', w: 26, align: 'left' },
  { key: 'des', w: 62, align: 'left' },
  { key: 'qty', w: 16, align: 'right' },
  { key: 'puht', w: 20, align: 'right' },
  { key: 'puttc', w: 20, align: 'right' },
  { key: 'rem', w: 12, align: 'right' },
  { key: 'mttc', w: 22, align: 'right' },
  { key: 'vat', w: 8, align: 'right' },
] as const;

/**
 * Construit le PDF et renvoie ses octets. Asynchrone : jsPDF est chargé à la demande (il ne pèse
 * pas sur le premier affichage de l'application).
 */
export async function buildSalesDocumentPdf(d: SalesPdfInput): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  drawDocument(doc, d);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Variante non compressée, pour les tests (le texte reste lisible dans le fichier). */
export async function buildSalesDocumentPdfUncompressed(d: SalesPdfInput): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  drawDocument(doc, d);
  return new Uint8Array(doc.output('arraybuffer'));
}

function drawDocument(doc: Pdf, d: SalesPdfInput): void {
  const { margin: M, width: W, height: H, footer: F, lineHeight: LH } = PDF_PAGE;
  const right = W - M;
  const typeLabel = t(`sales.type_${d.docType}`);
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const draw = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);
  const fill = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => { doc.setFont(PDF_FONT.family, style); doc.setFontSize(size); };
  let y = M;

  // ---- En-tête : société (gauche), client + code-barres (droite) ----------------------------
  const co = d.company;
  let leftY = y;
  if (co.logo) {
    const maxW = 60, maxH = 22;
    const ratio = Math.min(maxW / co.logo.w, maxH / co.logo.h);
    const w = co.logo.w * ratio, h = co.logo.h * ratio;
    try { doc.addImage(co.logo.dataUrl, co.logo.format, M, leftY, w, h, undefined, 'FAST'); leftY += h + 3; }
    catch { /* logo illisible : on écrit le nom */ font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand); doc.text(co.name, M, leftY + 6); leftY += 10; }
  } else {
    font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand);
    doc.text(co.name, M, leftY + 6);
    leftY += 10;
  }
  font(PDF_FONT.small); color(PDF_COLORS.soft);
  const coLines = [
    co.address ?? '', [co.zip, co.city].filter(Boolean).join(' '),
    co.legalName ?? '', co.vatNumber ? `${t('salesPdf.vat')} : ${co.vatNumber}` : '',
    co.iban ? `IBAN : ${co.iban}${co.bic ? ` · BIC : ${co.bic}` : ''}` : '',
  ].filter(Boolean);
  for (const l of coLines) { doc.text(l, M, leftY + 3); leftY += 3.6; }

  const boxX = 112, boxW = right - boxX;
  font(PDF_FONT.body);
  const clientText: string[] = d.clientLines.length ? d.clientLines : [t('sales.client')];
  const wrapped = clientText.flatMap((l, i) => (i === 0 ? [l] : doc.splitTextToSize(l, boxW - 8) as string[]));
  const boxH = Math.max(18, wrapped.length * LH + 6);
  draw(PDF_COLORS.frame); doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y, boxW, boxH, 2, 2);
  color(PDF_COLORS.ink);
  wrapped.forEach((l, i) => { font(PDF_FONT.body, i === 0 ? 'bold' : 'normal'); doc.text(l, boxX + 4, y + 5.5 + i * LH); });
  let rightY = y + boxH + 2;
  if (d.number) {
    const bars = barcodeBars(d.number);
    const total = bars.length ? bars[bars.length - 1].x + bars[bars.length - 1].w : 0;
    const bw = Math.min(55, total * 0.3);
    const scale = total > 0 ? bw / total : 0;
    fill(PDF_COLORS.ink);
    for (const b of bars) doc.rect(right - bw + b.x * scale, rightY, b.w * scale, 9, 'F');
    rightY += 11;
  }
  y = Math.max(leftY, rightY) + 2;

  // ---- Titre + bandeau ---------------------------------------------------------------------
  draw(PDF_COLORS.ink); doc.setLineWidth(0.6); doc.line(M, y, right, y);
  font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
  doc.text(typeLabel.toUpperCase(), M + 1, y + 6);
  font(PDF_FONT.body + 1); color(PDF_COLORS.frame);
  doc.text(`N° ${d.number ?? t('salesPdf.draft')}`, right - 1, y + 6, { align: 'right' });
  y += 8.5;
  doc.setLineWidth(0.3); doc.line(M, y, right, y);
  y += 3;

  const heure = d.createdAt ? new Date(d.createdAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '';
  const band: [string, string][] = [
    [typeLabel.toUpperCase(), d.number ?? ''],
    [t('salesPdf.date'), dmy(d.issueDate)],
    [t('salesPdf.time'), heure],
    [t('salesPdf.clientNo'), d.clientCode ?? ''],
    [t('salesPdf.condition'), d.condition || t('salesPdf.conditionDefault')],
    [t('salesPdf.dueDate'), dmy(d.dueDate) || dmy(d.issueDate)],
    [t('salesPdf.operator'), d.operator ?? ''],
  ];
  const bandW = (right - M) / band.length;
  draw(PDF_COLORS.frame); doc.roundedRect(M, y, right - M, 10, 2, 2);
  band.forEach(([label, value], i) => {
    const x = M + i * bandW;
    if (i > 0) { draw(PDF_COLORS.rule); doc.line(x, y, x, y + 10); }
    font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(doc.splitTextToSize(label, bandW - 3)[0] as string, x + 1.5, y + 3.5);
    // Valeur réduite jusqu'à tenir dans la case (ex. « AU GRAND COMPTANT »), puis coupée.
    let size: number = PDF_FONT.small;
    font(size, 'bold'); color(PDF_COLORS.ink);
    while (size > 5 && doc.getTextWidth(value) > bandW - 3) { size -= 0.5; font(size, 'bold'); }
    doc.text(String(doc.splitTextToSize(value || ' ', bandW - 3)[0] ?? ''), x + 1.5, y + 8);
  });
  y += 14;

  // ---- Lignes ------------------------------------------------------------------------------
  const bottomLimit = H - M - F;
  const headerRow = () => {
    font(PDF_FONT.tiny, 'bold'); color(PDF_COLORS.muted);
    let x = M;
    const heads = [t('salesPdf.colRef'), t('salesPdf.colDesignation'), t('salesPdf.colQty'), t('salesPdf.colPuHt'),
      t('salesPdf.colPuTtc'), t('salesPdf.colDiscount'), t('salesPdf.colAmountTtc'), t('salesPdf.colVat')];
    COLS.forEach((c, i) => {
      doc.text(heads[i], c.align === 'right' ? x + c.w - 1 : x + 1, y + 3, { align: c.align });
      x += c.w;
    });
    draw(PDF_COLORS.muted); doc.setLineWidth(0.2); doc.line(M, y + 4.5, right, y + 4.5);
    y += 6.5;
  };
  const newPage = () => { doc.addPage(); y = M; headerRow(); };
  const ensure = (h: number) => { if (y + h > bottomLimit) newPage(); };
  headerRow();

  let zebra = false;
  for (const l of d.lines) {
    if (l.lineType === 'vide') { ensure(LH); y += LH; continue; }
    if (l.lineType === 'texte') {
      font(PDF_FONT.body, 'italic'); color(PDF_COLORS.ink);
      const txt = String(l.designation ?? '').split('\n').flatMap((p) => doc.splitTextToSize(p || ' ', right - M - COLS[0].w - 2) as string[]);
      for (const part of txt) { ensure(LH); doc.text(part, M + COLS[0].w + 1, y + 3); y += LH; }
      y += 1;
      continue;
    }
    font(PDF_FONT.body);
    const desLines = doc.splitTextToSize(l.designation ?? '', COLS[1].w - 2) as string[];
    const refLines = doc.splitTextToSize(l.reference ?? '', COLS[0].w - 2) as string[];
    const rowH = Math.max(desLines.length, refLines.length, 1) * LH + 1.6;
    ensure(rowH);
    if (zebra) { fill(PDF_COLORS.zebra); doc.rect(M, y - 0.4, right - M, rowH, 'F'); }
    zebra = !zebra;
    const vat = d.taxExempt ? 0 : Number(l.vatRate) || 0;
    const qty = num2(l.quantity) + (l.lineType === 'main_oeuvre' ? ` ${t('sales.hoursUnit')}` : '');
    const cells = [
      refLines, desLines, [qty], [eurPdf(l.unitPriceHt)], [eurPdf(Number(l.unitPriceHt) * (1 + vat / 100))],
      [String(Number(l.discountPct || 0)).replace('.', ',')], [eurPdf(l.lineTtc)], [String(vat).replace('.', ',')],
    ];
    color(PDF_COLORS.ink);
    let x = M;
    COLS.forEach((c, i) => {
      cells[i].forEach((txt, k) => doc.text(txt, c.align === 'right' ? x + c.w - 1 : x + 1, y + 3 + k * LH, { align: c.align }));
      x += c.w;
    });
    y += rowH;
    draw(PDF_COLORS.rule); doc.setLineWidth(0.1); doc.line(M, y - 0.4, right, y - 0.4);
  }

  // ---- Bloc véhicule -----------------------------------------------------------------------
  if (d.vehicleLines.length) {
    y += 2;
    font(PDF_FONT.small); color(PDF_COLORS.soft);
    const colW = (right - M) / 3;
    const perCol = Math.ceil(d.vehicleLines.length / 3);
    ensure(perCol * 3.6 + 2);
    d.vehicleLines.forEach((l, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      doc.text(l, M + 1 + col * colW, y + 3 + row * 3.6);
    });
    y += perCol * 3.6 + 2;
  }

  // ---- Bas de document : TVA + règlements (gauche), totaux (droite) --------------------------
  const vatRows = vatBreakdown(d.lines, { ...d.pied, taxExempt: d.taxExempt });
  const reste = r2(d.totals.ttc - d.totals.paid);
  const brutTtc = d.lines.reduce((s, l) => s + (lineHasAmount({ line_type: l.lineType as LineType }) ? Number(l.lineTtc) || 0 : 0), 0);
  const totalRows: [string, string, boolean][] = [
    [t('salesPdf.grossTtc'), eurPdf(brutTtc), false],
    [t('salesPdf.netHt'), eurPdf(d.totals.ht), false],
    [t('salesPdf.totalVat'), eurPdf(d.totals.vat), false],
    [t('salesPdf.netTtc'), eurPdf(d.totals.ttc), true],
    ...(d.totals.paid !== 0 ? [[t('salesPdf.paid'), eurPdf(d.totals.paid), false] as [string, string, boolean]] : []),
    [t('salesPdf.due'), eurPdf(reste), true],
  ];
  const leftBlockH = 6 + (vatRows.length + 1) * 4 + (d.payments.length ? 6 + d.payments.length * 3.8 : 0);
  const totalsH = totalRows.length * 6 + 2;
  ensure(Math.max(leftBlockH, totalsH) + 6);
  y += 5;
  const blockTop = y;

  // Détail TVA
  const tvX = M, tvW = 92;
  font(PDF_FONT.tiny, 'bold'); color(PDF_COLORS.muted);
  doc.text(t('salesPdf.vatRate'), tvX + 1, y + 3);
  doc.text(t('salesPdf.vatBase'), tvX + 55, y + 3, { align: 'right' });
  doc.text(t('salesPdf.vatAmount'), tvX + tvW - 1, y + 3, { align: 'right' });
  draw(PDF_COLORS.muted); doc.setLineWidth(0.2); doc.line(tvX, y + 4.3, tvX + tvW, y + 4.3);
  y += 5.5;
  font(PDF_FONT.small); color(PDF_COLORS.ink);
  if (!vatRows.length) { doc.text('—', tvX + 1, y + 3); y += 4; }
  for (const r of vatRows) {
    doc.text(`${String(r.rate).replace('.', ',')} %`, tvX + 1, y + 3);
    doc.text(eurPdf(r.base), tvX + 55, y + 3, { align: 'right' });
    doc.text(eurPdf(r.vat), tvX + tvW - 1, y + 3, { align: 'right' });
    y += 4;
  }

  // Règlements / acomptes
  if (d.payments.length) {
    y += 2;
    font(PDF_FONT.tiny, 'bold'); color(PDF_COLORS.muted);
    doc.text(t('salesPdf.payments'), tvX + 1, y + 3);
    y += 4.5;
    font(PDF_FONT.small); color(PDF_COLORS.ink);
    for (const p of d.payments) {
      doc.text(dmy(p.date), tvX + 1, y + 3);
      doc.text(`${p.label}${p.received ? '' : ` (${t('salesPdf.expected')})`}`, tvX + 20, y + 3);
      doc.text(eurPdf(p.amount), tvX + tvW - 1, y + 3, { align: 'right' });
      y += 3.8;
    }
  }
  const leftEnd = y;

  // Totaux
  const tX = right - 72, tW = 72;
  let ty = blockTop;
  draw(PDF_COLORS.frame); doc.setLineWidth(0.3);
  doc.roundedRect(tX, ty, tW, totalRows.length * 6, 1.5, 1.5);
  totalRows.forEach(([label, value, strong], i) => {
    if (strong) { fill(PDF_COLORS.zebra); doc.rect(tX + 0.3, ty + 0.3, tW - 0.6, 5.4, 'F'); }
    font(PDF_FONT.body, strong ? 'bold' : 'normal'); color(PDF_COLORS.ink);
    doc.text(label, tX + 3, ty + 4);
    doc.text(value, tX + tW - 3, ty + 4, { align: 'right' });
    ty += 6;
    if (i < totalRows.length - 1) { draw(PDF_COLORS.rule); doc.setLineWidth(0.1); doc.line(tX, ty, tX + tW, ty); }
  });
  y = Math.max(leftEnd, ty) + 4;

  // ---- Mentions, validité, notes, pied -----------------------------------------------------
  const paragraphs: { text: string; style: 'normal' | 'italic' | 'bold' }[] = [];
  if (d.isMarge) paragraphs.push({ text: t('salesPdf.margeMention'), style: 'italic' });
  else if (d.taxExempt) paragraphs.push({ text: t('sales.taxExemptMention'), style: 'italic' });
  if (d.validity) paragraphs.push({ text: d.validity, style: 'bold' });
  if (d.notes) paragraphs.push({ text: d.notes, style: 'normal' });
  if (co.footer) paragraphs.push({ text: co.footer, style: 'normal' });
  for (const p of paragraphs) {
    font(PDF_FONT.small, p.style); color(PDF_COLORS.soft);
    const parts = doc.splitTextToSize(p.text, right - M) as string[];
    for (const part of parts) { if (y + 3.6 > bottomLimit) { doc.addPage(); y = M; } doc.text(part, M, y + 3); y += 3.6; }
    y += 1.2;
  }

  // ---- Case signature ----------------------------------------------------------------------
  if ((SIGNATURE_DOC_TYPES as readonly string[]).includes(d.docType)) {
    const sh = 26;
    if (y + sh + 3 > bottomLimit) { doc.addPage(); y = M; }
    y += 3;
    const sx = right - 90;
    draw(PDF_COLORS.frame); doc.setLineWidth(0.3); doc.roundedRect(sx, y, 90, sh, 2, 2);
    font(PDF_FONT.small, 'bold'); color(PDF_COLORS.ink);
    doc.text(t('salesPdf.signatureTitle'), sx + 3, y + 4.5);
    font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(t('salesPdf.signatureHint'), sx + 3, y + 8.5);
    y += sh + 2;
  }

  // ---- CGV au verso ------------------------------------------------------------------------
  if (co.cgv) {
    doc.addPage(); y = M;
    font(PDF_FONT.body + 1, 'bold'); color(PDF_COLORS.ink);
    doc.text(t('salesPdf.cgvTitle'), M, y + 4); y += 8;
    font(PDF_FONT.small); color(PDF_COLORS.soft);
    for (const part of String(co.cgv).split('\n').flatMap((p) => doc.splitTextToSize(p || ' ', right - M) as string[])) {
      if (y + 3.4 > bottomLimit) { doc.addPage(); y = M; }
      doc.text(part, M, y + 3); y += 3.4;
    }
  }

  // ---- Pied de page : n° du document et page i / n ----------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(`${typeLabel} ${d.number ?? ''}`.trim(), M, H - M + 2);
    doc.text(t('salesPdf.page').replace('{i}', String(i)).replace('{n}', String(pages)), right, H - M + 2, { align: 'right' });
  }
}
