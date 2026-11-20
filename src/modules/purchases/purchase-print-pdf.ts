/**
 * M4 — PDF A4 d'une commande fournisseur ou d'une réception (décision client Q65, 20/11/2026 ;
 * éditions G8 COMMANDE / RECEPTION). Même mécanisme que les documents de vente : jsPDF dans le
 * navigateur, couleurs / polices / page de `sales/pdf-print-style.ts` (charte, aucune valeur en
 * dur ici), logo et coordonnées de la société (`companies`), aperçu dans un nouvel onglet
 * (visionneuse du navigateur : lire, imprimer, télécharger), comme « Aperçu PDF » des ventes.
 *
 * Contenu : en-tête société, cadre fournisseur (nom, adresse, n° de TVA, notre n° client),
 * titre « Commande fournisseur » / « Bon de réception », n°, dates, facture / BL fournisseur,
 * opérateur (nom, jamais l'e-mail), lignes (référence, réf. fournisseur, désignation, quantité
 * commandée, reçue, reliquat, PA HT, remise, total HT), totaux HT / TVA / TTC et bloc
 * « Reliquats » quand il reste des quantités à recevoir. Langue : celle de l'utilisateur.
 * Modèle (lignes, totaux, reliquats) : `purchase-print.ts` (pur, testé).
 */
import { supabase } from '@/integrations/supabase/client';
import { patchPdfText } from '@/modules/documents/pdf-text';
import { fetchImageForPdf } from '@/lib/image-tools';
import { t, fillVars } from '@/lib/i18n';
import { eurPdf, dmy } from '@/modules/sales/document-pdf';
import { formatCompanyNumber } from '@/modules/sales/invoice-legal';
import { PDF_COLORS, PDF_FONT, PDF_PAGE, type Rgb } from '@/modules/sales/pdf-print-style';
import { supplierName, type PurchaseFull } from './api';
import { getOrderFollow } from './g8-api';
import {
  buildPurchasePrintModel, purchaseQty, purchasePdfFileName,
  type PurchasePrintKind, type PurchasePrintLineInput, type PurchasePrintModel,
} from './purchase-print';

type Pdf = import('jspdf').jsPDF;
const s = (x: unknown) => (x == null ? '' : String(x).trim());
const CLOSED = new Set(['soldee', 'annulee']);

export const purchasePrintKind = (docType: string): PurchasePrintKind => (docType === 'REC' ? 'receipt' : 'order');
export const PRINTABLE_PURCHASE_TYPES = ['CMD', 'REC'] as const;

const titleFor = (docType: string) =>
  t(docType === 'REC' ? 'purchasePrint.titleReceipt' : docType === 'PCF' ? 'purchasePrint.titleProposal'
    : docType === 'RTF' ? 'purchasePrint.titleReturn' : 'purchasePrint.titleOrder');

export type PurchasePdfInput = {
  title: string;
  number: string | null;
  docType: string;
  company: { name: string; lines: string[]; logo: { dataUrl: string; w: number; h: number } | null };
  supplierLines: string[];
  band: [string, string][];
  model: PurchasePrintModel;
  sourceOrders: string[];
  notes: string | null;
};

/** Charge tout ce qui s'imprime (société, fournisseur, références, reçus / reliquats). */
export async function loadPurchasePdfInput(full: PurchaseFull): Promise<PurchasePdfInput> {
  const { order, lines } = full;
  const kind = purchasePrintKind(order.doc_type);
  const artIds = [...new Set(lines.map((l) => l.article_id).filter(Boolean) as string[])];
  const opId = (order as { operator_id?: string | null }).operator_id ?? null;
  const [{ data: company }, { data: supplier }, { data: arts }, { data: op }, follow] = await Promise.all([
    supabase.from('companies').select('*').eq('id', order.company_id).maybeSingle(),
    order.supplier_id ? supabase.from('contacts').select('*').eq('id', order.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    artIds.length ? supabase.from('articles').select('id, reference').in('id', artIds) : Promise.resolve({ data: [] as { id: string; reference: string | null }[] }),
    opId ? supabase.from('profiles').select('full_name').eq('id', opId).maybeSingle() : Promise.resolve({ data: null }),
    order.status === 'brouillon' ? Promise.resolve(null) : getOrderFollow(order.id).catch(() => null),
  ]);
  const refOf = new Map((arts ?? []).map((a) => [a.id, a.reference]));

  // Reliquats. Commande : reste de chaque ligne. Réception : reste de la ligne de commande
  // d'origine (source_line_id), à date, et commande soldée / annulée = plus de reliquat.
  type Src = { quantity: number; remaining: number; closed: boolean; number: string | null };
  const srcLine = new Map<string, Src>();
  const sourceOrders: string[] = [];
  if (kind === 'order' && follow) {
    for (const l of follow.lines) srcLine.set(l.line_id, { quantity: l.quantity, remaining: l.remaining, closed: CLOSED.has(order.status), number: order.number });
  } else if (kind === 'receipt' && follow) {
    for (const o of follow.orders) {
      if (o.number) sourceOrders.push(o.number);
      const f = await getOrderFollow(o.id).catch(() => null);
      for (const l of f?.lines ?? []) srcLine.set(l.line_id, { quantity: l.quantity, remaining: l.remaining, closed: CLOSED.has(o.status), number: o.number });
    }
  }

  const inputs: PurchasePrintLineInput[] = lines.map((l) => {
    const key = kind === 'order' ? l.id : ((l as { source_line_id?: string | null }).source_line_id ?? '');
    const src = key ? srcLine.get(key) : undefined;
    return {
      id: l.id,
      reference: (l.article_id && refOf.get(l.article_id)) || null,
      supplierRef: l.supplier_ref ?? null,
      designation: l.designation,
      quantity: Number(l.quantity),
      unitPriceHt: Number(l.unit_price_ht),
      discountPct: Number(l.discount_pct ?? 0),
      vatRate: Number(l.vat_rate ?? 0),
      ordered: src ? src.quantity : null,
      remaining: src ? src.remaining : null,
      orderClosed: src?.closed ?? false,
      orderNumber: src?.number ?? null,
    };
  });
  const model = buildPurchasePrintModel(kind, inputs, {
    globalDiscountPct: Number(order.global_discount_pct ?? 0),
    shippingHt: Number(order.shipping_ht ?? 0),
    shippingTaxed: order.shipping_taxed,
    shippingVatRate: Number(order.shipping_vat_rate ?? 0),
    totals: { ht: order.total_ht, vat: order.total_vat, ttc: order.total_ttc },
  });

  const co = (company ?? {}) as Record<string, unknown>;
  const logoUrl = s(co.logo_url);
  const logo = logoUrl ? await fetchImageForPdf(logoUrl, 'pdf') : null;
  const coLines = [
    s(co.address), [s(co.zip), s(co.city)].filter(Boolean).join(' '),
    s(co.phone), s(co.email),
    s(co.legal_name) && s(co.legal_name) !== s(co.name) ? s(co.legal_name) : '',
    s(co.vat_number) ? `${t('purchasePrint.vat')} : ${s(co.vat_number)}` : '',
    s(co.company_number) ? formatCompanyNumber(s(co.company_number)) : '',
  ].filter(Boolean);

  const sp = (supplier ?? null) as Record<string, unknown> | null;
  const supplierLines = sp ? [
    supplierName(sp as never),
    [s(sp.street_number), s(sp.address)].filter(Boolean).join(' '),
    [s(sp.zip), s(sp.city), s(sp.country) && s(sp.country) !== 'BE' ? s(sp.country) : ''].filter(Boolean).join(' '),
    s(sp.vat_number) ? `${t('purchasePrint.vat')} : ${s(sp.vat_number)}` : '',
    s(sp.supplier_customer_no) ? `${t('purchasePrint.supplierCustomerNo')} : ${s(sp.supplier_customer_no)}` : '',
  ].filter(Boolean) : [];

  // Opérateur : son nom (profil), jamais son e-mail (décision Q63).
  const opName = s((op as { full_name?: string | null } | null)?.full_name);
  const operator = opName && !opName.includes('@') ? opName : '';
  const title = titleFor(order.doc_type);
  const band: [string, string][] = [
    [t('purchasePrint.number'), s(order.number)],
    ...(kind === 'receipt'
      ? [[t('purchasePrint.receiptDate'), dmy(order.receipt_date)] as [string, string]]
      : [[t('purchasePrint.orderDate'), dmy(order.order_date ?? order.created_at?.slice(0, 10))] as [string, string],
         ...(order.expected_date ? [[t('purchasePrint.expectedDate'), dmy(order.expected_date)] as [string, string]] : [])]),
    ...(order.supplier_invoice_no ? [[t('purchasePrint.supplierInvoice'), `${order.supplier_invoice_no}${order.invoice_date ? ` (${dmy(order.invoice_date)})` : ''}`] as [string, string]] : []),
    ...(order.supplier_bl_no ? [[t('purchasePrint.supplierBl'), `${order.supplier_bl_no}${order.bl_date ? ` (${dmy(order.bl_date)})` : ''}`] as [string, string]] : []),
    [t('purchasePrint.status'), t(`purchases.status_${order.status}`)],
    ...(operator ? [[t('purchasePrint.operator'), operator] as [string, string]] : []),
  ];

  return {
    title, number: order.number, docType: order.doc_type,
    company: { name: s(co.name) || s(co.legal_name), lines: coLines, logo },
    supplierLines, band, model, sourceOrders, notes: s(order.notes) || null,
  };
}

// Colonnes (mm, somme = largeur utile 186) : réf, réf. fourn., désignation, cdé, reçu, reliquat, PA, remise, total.
const COLS = [22, 20, 54, 13, 13, 13, 18, 13, 20];

/** Dessine le PDF (pur : aucune lecture de base). */
export function drawPurchasePdf(doc: Pdf, d: PurchasePdfInput): void {
  const { margin: M, width: W, height: H, footer: F, lineHeight: LH } = PDF_PAGE;
  const right = W - M;
  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const draw = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);
  const fill = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const font = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => { doc.setFont(PDF_FONT.family, style); doc.setFontSize(size); };
  let y = M;

  // ---- En-tête : société (gauche), fournisseur (droite) -----------------------------------
  let leftY = y;
  const co = d.company;
  if (co.logo) {
    const ratio = Math.min(60 / co.logo.w, 22 / co.logo.h);
    try { doc.addImage(co.logo.dataUrl, 'JPEG', M, leftY, co.logo.w * ratio, co.logo.h * ratio, undefined, 'FAST'); leftY += co.logo.h * ratio + 3; }
    catch { font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand); doc.text(co.name, M, leftY + 6); leftY += 10; }
  } else {
    font(PDF_FONT.brand, 'bold'); color(PDF_COLORS.brand); doc.text(co.name, M, leftY + 6); leftY += 10;
  }
  font(PDF_FONT.small); color(PDF_COLORS.soft);
  for (const l of co.lines) { doc.text(l, M, leftY + 3); leftY += 3.6; }

  const boxX = 112, boxW = right - boxX;
  font(PDF_FONT.tiny); color(PDF_COLORS.muted);
  doc.text(t('purchasePrint.supplier').toUpperCase(), boxX, y + 2);
  font(PDF_FONT.body);
  const sup = d.supplierLines.length ? d.supplierLines : ['—'];
  const wrapped = sup.flatMap((l, i) => (i === 0 ? [l] : doc.splitTextToSize(l, boxW - 8) as string[]));
  const boxY = y + 3.5;
  const boxH = Math.max(18, wrapped.length * LH + 6);
  draw(PDF_COLORS.frame); doc.setLineWidth(0.3); doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2);
  color(PDF_COLORS.ink);
  wrapped.forEach((l, i) => { font(PDF_FONT.body, i === 0 ? 'bold' : 'normal'); doc.text(l, boxX + 4, boxY + 5.5 + i * LH); });
  y = Math.max(leftY, boxY + boxH) + 4;

  // ---- Titre + bandeau ---------------------------------------------------------------------
  draw(PDF_COLORS.ink); doc.setLineWidth(0.6); doc.line(M, y, right, y);
  font(PDF_FONT.title, 'bold'); color(PDF_COLORS.ink);
  doc.text(d.title.toUpperCase(), M + 1, y + 6);
  font(PDF_FONT.body + 1); color(PDF_COLORS.frame);
  doc.text(`${t('purchasePrint.number')} ${d.number ?? ''}`, right - 1, y + 6, { align: 'right' });
  y += 8.5; doc.setLineWidth(0.3); doc.line(M, y, right, y); y += 3;

  const bandW = (right - M) / Math.max(1, d.band.length);
  draw(PDF_COLORS.frame); doc.roundedRect(M, y, right - M, 10, 2, 2);
  d.band.forEach(([label, value], i) => {
    const x = M + i * bandW;
    if (i > 0) { draw(PDF_COLORS.rule); doc.line(x, y, x, y + 10); }
    font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(String(doc.splitTextToSize(label, bandW - 3)[0] ?? ''), x + 1.5, y + 3.5);
    let size: number = PDF_FONT.small;
    font(size, 'bold'); color(PDF_COLORS.ink);
    while (size > 5 && doc.getTextWidth(value) > bandW - 3) { size -= 0.5; font(size, 'bold'); }
    doc.text(String(doc.splitTextToSize(value || ' ', bandW - 3)[0] ?? ''), x + 1.5, y + 8);
  });
  y += 14;
  if (d.sourceOrders.length) {
    font(PDF_FONT.small); color(PDF_COLORS.soft);
    doc.text(`${t('purchasePrint.fromOrders')} : ${d.sourceOrders.join(', ')}`, M, y); y += 5;
  }

  // ---- Lignes ------------------------------------------------------------------------------
  const heads = ['colRef', 'colSupplierRef', 'colDesignation', 'colOrdered', 'colReceived', 'colRemaining', 'colPuHt', 'colDiscount', 'colTotalHt']
    .map((k) => t(`purchasePrint.${k}`));
  const xs: number[] = []; COLS.reduce((x, w) => { xs.push(x); return x + w; }, M);
  const isRight = (i: number) => i >= 3;
  const cell = (txt: string, i: number, yy: number) => {
    const fit = String(doc.splitTextToSize(txt || '', COLS[i] - 1.5)[0] ?? '');
    if (isRight(i)) doc.text(fit, xs[i] + COLS[i] - 0.8, yy, { align: 'right' }); else doc.text(fit, xs[i] + 0.8, yy);
  };
  const header = () => {
    font(PDF_FONT.tiny, 'bold'); color(PDF_COLORS.muted);
    heads.forEach((h, i) => cell(h, i, y));
    y += 1.6; draw(PDF_COLORS.frame); doc.setLineWidth(0.2); doc.line(M, y, right, y); y += 3.8;
  };
  const room = (h: number) => { if (y + h > H - M - F) { doc.addPage(); y = M; header(); } };
  header();
  d.model.lines.forEach((l, idx) => {
    font(PDF_FONT.small);
    const des = doc.splitTextToSize(l.designation, COLS[2] - 1.5) as string[];
    const h = Math.max(1, des.length) * 3.6 + 1.4;
    room(h);
    if (idx % 2 === 1) { fill(PDF_COLORS.zebra); doc.rect(M, y - 3, right - M, h, 'F'); }
    color(PDF_COLORS.ink); font(PDF_FONT.small);
    cell(l.reference, 0, y); cell(l.supplierRef, 1, y);
    des.forEach((dl, k) => doc.text(dl, xs[2] + 0.8, y + k * 3.6));
    cell(purchaseQty(l.ordered), 3, y); cell(purchaseQty(l.received), 4, y);
    if (l.remaining != null && l.remaining > 0) font(PDF_FONT.small, 'bold');
    cell(purchaseQty(l.remaining), 5, y);
    font(PDF_FONT.small);
    cell(eurPdf(l.unitPriceHt), 6, y);
    cell(l.discountPct ? purchaseQty(l.discountPct) : '', 7, y);
    cell(eurPdf(l.totalHt), 8, y);
    y += h;
    draw(PDF_COLORS.rule); doc.setLineWidth(0.1); doc.line(M, y - 3, right, y - 3);
  });

  // ---- Totaux ------------------------------------------------------------------------------
  const m = d.model;
  const rows: [string, string, boolean][] = [
    [t('purchasePrint.linesHt'), eurPdf(m.linesHt), false],
    ...(m.globalDiscountPct ? [[`${t('purchasePrint.globalDiscount')} ${purchaseQty(m.globalDiscountPct)} %`, eurPdf(-m.globalDiscountAmount), false] as [string, string, boolean]] : []),
    ...(m.shippingHt ? [[t('purchasePrint.shipping'), eurPdf(m.shippingHt), false] as [string, string, boolean]] : []),
    [t('purchasePrint.totalHt'), eurPdf(m.totals.ht), true],
    [t('purchasePrint.totalVat'), eurPdf(m.totals.vat), false],
    [t('purchasePrint.totalTtc'), eurPdf(m.totals.ttc), true],
  ];
  const tw = 72, tx = right - tw, rh = 5.2;
  y += 3; room(rows.length * rh + 4);
  draw(PDF_COLORS.frame); doc.setLineWidth(0.3); doc.roundedRect(tx, y, tw, rows.length * rh + 1, 2, 2);
  rows.forEach(([label, value, strong], i) => {
    const ry = y + i * rh;
    if (strong) { fill(PDF_COLORS.zebra); doc.rect(tx + 0.3, ry + 0.3, tw - 0.6, rh, 'F'); }
    font(PDF_FONT.body, strong ? 'bold' : 'normal'); color(PDF_COLORS.ink);
    doc.text(label, tx + 3, ry + 3.8);
    doc.text(value, right - 3, ry + 3.8, { align: 'right' });
  });
  y += rows.length * rh + 8;

  // ---- Reliquats ---------------------------------------------------------------------------
  if (m.remainders.length) {
    room(12);
    font(PDF_FONT.body, 'bold'); color(PDF_COLORS.ink);
    doc.text(t('purchasePrint.remaindersTitle'), M, y); y += 1.6;
    draw(PDF_COLORS.frame); doc.setLineWidth(0.2); doc.line(M, y, right, y); y += 4;
    for (const r of m.remainders) {
      font(PDF_FONT.small);
      const label = [r.reference, r.designation].filter(Boolean).join(' — ');
      const lab = doc.splitTextToSize(label, 120) as string[];
      room(lab.length * 3.6 + 1.4);
      color(PDF_COLORS.ink);
      lab.forEach((dl, k) => doc.text(dl, M + 0.8, y + k * 3.6));
      if (r.orderNumber) { color(PDF_COLORS.muted); doc.text(`${t('purchasePrint.remaindersOrder')} ${r.orderNumber}`, M + 124, y); }
      font(PDF_FONT.small, 'bold'); color(PDF_COLORS.ink);
      doc.text(`${purchaseQty(r.remaining)}${r.ordered != null ? ` / ${purchaseQty(r.ordered)}` : ''}`, right - 0.8, y, { align: 'right' });
      y += lab.length * 3.6 + 1.4;
    }
    y += 3;
  } else if (d.docType === 'REC' && m.lines.some((l) => l.remaining != null)) {
    room(6); font(PDF_FONT.small, 'italic'); color(PDF_COLORS.soft);
    doc.text(t('purchasePrint.noRemainder'), M, y); y += 6;
  }

  if (d.notes) {
    room(10); font(PDF_FONT.small, 'bold'); color(PDF_COLORS.ink); doc.text(t('purchasePrint.notes'), M, y); y += 4;
    font(PDF_FONT.small); color(PDF_COLORS.soft);
    for (const l of doc.splitTextToSize(d.notes, right - M) as string[]) { room(4); doc.text(l, M, y); y += 3.6; }
  }

  // ---- Pied : n° de page -------------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); font(PDF_FONT.tiny); color(PDF_COLORS.muted);
    doc.text(`${d.title} ${d.number ?? ''} · ${fillVars(t('purchasePrint.page'), { n: p, total: pages })}`, right, H - M / 2, { align: 'right' });
  }
}

/** Octets du PDF + nom de fichier. */
export async function generatePurchasePdf(full: PurchaseFull): Promise<{ bytes: Uint8Array; fileName: string }> {
  const [{ jsPDF }, input] = await Promise.all([import('jspdf'), loadPurchasePdfInput(full)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  patchPdfText(doc as unknown as { text: (...a: unknown[]) => unknown });
  drawPurchasePdf(doc, input);
  return { bytes: new Uint8Array(doc.output('arraybuffer')), fileName: purchasePdfFileName(input.title, input.number) };
}

/** Bouton « Imprimer » : ouvre le PDF dans un nouvel onglet (ouvert AVANT la génération, anti-popup). */
export async function openPurchasePdf(full: PurchaseFull): Promise<void> {
  const w = window.open('', '_blank');
  try {
    const { bytes } = await generatePurchasePdf(full);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}
