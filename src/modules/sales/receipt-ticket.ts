/**
 * M6 (POS) — Ticket de caisse 80 / 58 mm (PDV030, carte K12 de la synthese caisse). Pur et teste.
 *
 * Mentions du ticket (etude legale C6 ; caisse conforme PDV010) : societe (raison sociale, adresse,
 * n° de TVA, n° d'entreprise), type et n° d'ordre du document (TIK-...), date ET heure, caisse
 * (`cash_sessions.register_code`) et poste, n° du Z quand la session est cloturee, operateur,
 * lignes (quantite, prix unitaire TTC, remise, taux), remise globale, total TTC, TVA PAR TAUX
 * (base HT et TVA), mode(s) de paiement en clair, especes recues / rendu, arrondi legal 5 cents
 * (reglement ARR), reste a payer, mentions legales (TVA marge, detaxe, avoir...), « DUPLICATA »
 * en tete et en pied d'une reimpression, code-barres du n° (retour / echange par scan).
 * Regime de la marge (M-89) : aucune TVA ni taux sur le ticket.
 */
import type { ReceiptBlock, ReceiptDoc } from '@/lib/devices/receipt';
import { receiptAmount } from '@/lib/devices/receipt';
import type { PaperWidth } from '@/lib/devices/types';

export type TicketLine = {
  lineType: string; designation: string; reference?: string | null;
  quantity: number; unitPriceHt: number; vatRate: number; discountPct: number; lineTtc: number;
};

export type TicketPayment = {
  label: string; amount: number; given?: number | null;
  isCash: boolean; status: 'recu' | 'attendu' | 'annule' | string;
};

export type TicketReceiptInput = {
  company: {
    name: string; legalName?: string | null; address?: string | null; zip?: string | null; city?: string | null;
    vatNumber?: string | null; companyNumber?: string | null; phone?: string | null;
  };
  doc: {
    docType: string; number: string | null; issuedAt: Date; operator?: string | null;
    totalHt: number; totalVat: number; totalTtc: number;
    taxExempt: boolean; marge: boolean;
    globalDiscountPct?: number; globalDiscountAmount?: number;
  };
  client?: { name: string; vatNumber?: string | null } | null;
  lines: TicketLine[];
  vatRows: { rate: number; base: number; vat: number }[];
  payments: TicketPayment[];
  register: { code: string | null; workstation: string | null; zNumber: string | null };
  mentions: string[];
  footer?: string | null;
  duplicate?: boolean;
  widthMm?: PaperWidth;
};

/** Libelles du ticket : `tr('cle')` lit `devices.receipt.cle` dans la langue du ticket. */
export type TicketTranslate = (key: string, vars?: Record<string, string | number>) => string;

const two = (n: number) => String(n).padStart(2, '0');
export const ticketDateTime = (d: Date) =>
  `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace('.', ','));
const pct = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

const TITLE_TYPES = ['TIK', 'FAC', 'AVO', 'FAA'];

export function buildTicketReceipt(i: TicketReceiptInput, tr: TicketTranslate): ReceiptDoc {
  const b: ReceiptBlock[] = [];
  const noVat = i.doc.marge || i.doc.taxExempt;
  const dup = () => { b.push({ kind: 'text', text: tr('duplicate'), align: 'center', bold: true, large: true }); };

  if (i.duplicate) { dup(); b.push({ kind: 'feed' }); }

  // En-tete societe
  const c = i.company;
  b.push({ kind: 'text', text: c.name, align: 'center', bold: true, large: true });
  if (c.legalName && c.legalName.trim().toUpperCase() !== c.name.trim().toUpperCase()) b.push({ kind: 'text', text: c.legalName, align: 'center' });
  if (c.address) b.push({ kind: 'text', text: c.address, align: 'center' });
  const zc = [c.zip, c.city].filter(Boolean).join(' ');
  if (zc) b.push({ kind: 'text', text: zc, align: 'center' });
  if (c.vatNumber) b.push({ kind: 'text', text: `${tr('vatId')} ${c.vatNumber}`, align: 'center' });
  if (c.companyNumber) b.push({ kind: 'text', text: `${tr('companyNumber')} ${c.companyNumber}`, align: 'center' });
  if (c.phone) b.push({ kind: 'text', text: c.phone, align: 'center' });
  b.push({ kind: 'rule' });

  // Identification du document, de la caisse, du Z
  const titleKey = TITLE_TYPES.includes(i.doc.docType) ? `title_${i.doc.docType}` : 'title_other';
  b.push({ kind: 'text', text: tr(titleKey), align: 'center', bold: true });
  b.push({ kind: 'pair', left: tr('number'), right: i.doc.number ?? '-' });
  b.push({ kind: 'pair', left: tr('date'), right: ticketDateTime(i.doc.issuedAt) });
  if (i.register.code) b.push({ kind: 'pair', left: tr('register'), right: i.register.code });
  if (i.register.workstation) b.push({ kind: 'pair', left: tr('workstation'), right: i.register.workstation });
  if (i.register.zNumber) b.push({ kind: 'pair', left: tr('z'), right: i.register.zNumber });
  if (i.doc.operator) b.push({ kind: 'pair', left: tr('operator'), right: i.doc.operator });
  if (i.client) {
    b.push({ kind: 'pair', left: tr('client'), right: i.client.name });
    if (i.client.vatNumber) b.push({ kind: 'pair', left: tr('vatId'), right: i.client.vatNumber });
  }
  b.push({ kind: 'rule', char: '=' });

  // Lignes
  for (const l of i.lines) {
    if (l.lineType === 'vide') continue;
    if (l.lineType === 'texte') { b.push({ kind: 'text', text: l.designation }); continue; }
    b.push({ kind: 'text', text: l.reference ? `${l.designation} (${l.reference})` : l.designation });
    const rate = noVat ? 0 : Number(l.vatRate) || 0;
    const puTtc = Number(l.unitPriceHt) * (1 + rate / 100);
    const unit = l.lineType === 'main_oeuvre' ? ` ${tr('hours')}` : '';
    const parts = [`  ${qtyText(Number(l.quantity))}${unit} x ${receiptAmount(puTtc)}`];
    if (Number(l.discountPct) > 0) parts.push(tr('lineDiscount', { pct: pct(Number(l.discountPct)) }));
    if (!i.doc.marge) parts.push(`${pct(rate)}%`);
    b.push({ kind: 'pair', left: parts.join(' '), right: receiptAmount(Number(l.lineTtc)) });
  }
  b.push({ kind: 'rule' });

  // Remise globale (la ligne d'origine porte deja la remise par ligne)
  // Montant TTC de la remise globale = somme des lignes TTC - total TTC du document.
  const gPct = Number(i.doc.globalDiscountPct ?? 0);
  const gAmt = Number(i.doc.globalDiscountAmount ?? 0);
  const linesTtc = i.lines.reduce((s, l) => s + (l.lineType === 'vide' || l.lineType === 'texte' ? 0 : Number(l.lineTtc)), 0);
  const gDiff = Math.round((linesTtc - i.doc.totalTtc) * 100) / 100;
  if ((gPct > 0 || gAmt > 0) && gDiff > 0.005) {
    b.push({ kind: 'pair', left: gPct > 0 ? `${tr('discount')} ${pct(gPct)} %` : tr('discount'), right: `-${receiptAmount(gDiff)}` });
  }

  b.push({ kind: 'pair', left: tr('total'), right: `${receiptAmount(i.doc.totalTtc)} EUR`, bold: true, large: true });

  // TVA par taux (mention obligatoire), sauf regime de la marge
  if (!i.doc.marge) {
    b.push({ kind: 'pair', left: tr('subtotalHt'), right: receiptAmount(i.doc.totalHt) });
    for (const v of i.vatRows) {
      b.push({ kind: 'pair', left: tr('vatLine', { rate: pct(v.rate), base: receiptAmount(v.base) }), right: receiptAmount(v.vat) });
    }
    b.push({ kind: 'pair', left: tr('totalVat'), right: receiptAmount(i.doc.totalVat) });
  }
  b.push({ kind: 'rule' });

  // Reglements, especes recues et rendu, reste a payer
  let paid = 0;
  for (const p of i.payments) {
    if (p.status === 'annule' || Math.abs(Number(p.amount)) < 0.005) continue;
    const deferred = p.status === 'attendu';
    b.push({ kind: 'pair', left: deferred ? `${p.label} (${tr('deferred')})` : p.label, right: receiptAmount(Number(p.amount)) });
    if (!deferred) paid += Number(p.amount);
    if (!deferred && p.isCash && p.given != null && Number(p.given) > 0) {
      b.push({ kind: 'pair', left: `  ${tr('given')}`, right: receiptAmount(Number(p.given)) });
      const change = Math.max(0, Math.round((Number(p.given) - Number(p.amount)) * 100) / 100);
      b.push({ kind: 'pair', left: `  ${tr('change')}`, right: receiptAmount(change) });
    }
  }
  const remaining = Math.round((i.doc.totalTtc - paid) * 100) / 100;
  if (remaining > 0.005) b.push({ kind: 'pair', left: tr('remaining'), right: receiptAmount(remaining), bold: true });

  // Mentions legales, pied
  if (i.mentions.length) {
    b.push({ kind: 'feed' });
    for (const m of i.mentions) b.push({ kind: 'text', text: m });
  }
  if (i.footer?.trim()) { b.push({ kind: 'feed' }); b.push({ kind: 'text', text: i.footer.trim(), align: 'center' }); }
  b.push({ kind: 'feed' });
  b.push({ kind: 'text', text: tr('thanks'), align: 'center' });
  if (i.doc.number) b.push({ kind: 'barcode', value: i.doc.number });
  if (i.duplicate) { b.push({ kind: 'feed' }); dup(); }

  return { title: `${tr(titleKey)} ${i.doc.number ?? ''}`.trim(), blocks: b, widthMm: i.widthMm };
}

/** Ticket d'essai du bouton « Tester » (largeur, accents, euro, colonnes, coupe). */
export function buildTestReceipt(tr: TicketTranslate, workstation: string | null, now = new Date()): ReceiptDoc {
  const blocks: ReceiptBlock[] = [
    { kind: 'text', text: tr('testTitle'), align: 'center', bold: true, large: true },
    { kind: 'text', text: workstation ?? '', align: 'center' },
    { kind: 'text', text: ticketDateTime(now), align: 'center' },
    { kind: 'rule' },
    { kind: 'text', text: tr('testAccents') },
    { kind: 'pair', left: tr('testLeft'), right: `${receiptAmount(1234.5)} EUR` },
    { kind: 'pair', left: tr('total'), right: '12,50 EUR', bold: true, large: true },
    { kind: 'rule', char: '=' },
    { kind: 'text', text: tr('testEnd'), align: 'center' },
    { kind: 'barcode', value: 'TIK-TEST-0001' },
  ];
  return { title: tr('testTitle'), blocks };
}
