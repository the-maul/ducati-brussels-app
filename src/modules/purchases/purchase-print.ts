/**
 * M4 — Impression d'une commande fournisseur ou d'une réception (décision client Q65, 20/11/2026 ;
 * éditions G8 COMMANDE / RECEPTION). Modèle PUR (aucun accès base, aucune mise en page) : lignes,
 * totaux et reliquats à imprimer. Les données sont chargées et dessinées par `purchase-print-pdf.ts`.
 *
 * Règles :
 *  - total HT d'une ligne = quantité × PA HT × (1 − remise %), arrondi au centime. Pour une
 *    réception, la quantité facturée est la quantité REÇUE sur ce bon ;
 *  - totaux : ceux de l'en-tête enregistré quand ils sont connus (vérité de la base, mêmes chiffres
 *    qu'à l'écran), sinon recalculés : lignes − remise globale % + port (TVA au taux de chaque
 *    ligne, port taxé au taux du port) ;
 *  - reliquat d'une ligne = reste à recevoir sur la ligne de commande (jamais négatif), à zéro si la
 *    commande est soldée ou annulée (G8 : le reliquat soldé ne s'imprime plus) ;
 *  - le bloc « Reliquats » liste les lignes dont le reliquat est > 0.
 */

export type PurchasePrintKind = 'order' | 'receipt';

export type PurchasePrintLineInput = {
  id: string;
  reference: string | null;
  supplierRef: string | null;
  designation: string;
  /** Quantité de la ligne du document (commandée pour une commande, reçue pour une réception). */
  quantity: number;
  unitPriceHt: number;
  discountPct: number;
  vatRate: number;
  /** Quantité commandée (ligne de commande d'origine pour une réception), null si inconnue. */
  ordered?: number | null;
  /** Reste à recevoir sur la ligne de commande, null si inconnu. */
  remaining?: number | null;
  /** Commande d'origine soldée / annulée : plus de reliquat. */
  orderClosed?: boolean;
  /** N° de la commande d'origine (bloc reliquats d'une réception). */
  orderNumber?: string | null;
};

export type PurchasePrintHeaderInput = {
  globalDiscountPct?: number | null;
  shippingHt?: number | null;
  shippingTaxed?: boolean | null;
  shippingVatRate?: number | null;
  /** Totaux enregistrés (en-tête) : imprimés tels quels quand ils sont fournis. */
  totals?: { ht: number | null; vat: number | null; ttc: number | null } | null;
};

export type PurchasePrintLine = {
  id: string;
  reference: string;
  supplierRef: string;
  designation: string;
  ordered: number | null;
  received: number | null;
  remaining: number | null;
  unitPriceHt: number;
  discountPct: number;
  totalHt: number;
};

export type PurchasePrintModel = {
  kind: PurchasePrintKind;
  lines: PurchasePrintLine[];
  linesHt: number;
  globalDiscountPct: number;
  globalDiscountAmount: number;
  shippingHt: number;
  totals: { ht: number; vat: number; ttc: number };
  remainders: { reference: string; designation: string; orderNumber: string | null; ordered: number | null; remaining: number }[];
  /** Au moins une ligne a encore un reliquat (réception partielle / commande reçue en partie). */
  partial: boolean;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };

/** Total HT d'une ligne : quantité × PA HT × (1 − remise %), au centime. */
export function purchaseLineHt(quantity: number, unitPriceHt: number, discountPct: number): number {
  return r2(num(quantity) * num(unitPriceHt) * (1 - num(discountPct) / 100));
}

export function buildPurchasePrintModel(
  kind: PurchasePrintKind,
  lines: PurchasePrintLineInput[],
  header: PurchasePrintHeaderInput = {},
): PurchasePrintModel {
  const out: PurchasePrintLine[] = lines.map((l) => {
    const qty = num(l.quantity);
    const remaining = l.orderClosed ? 0 : l.remaining == null ? null : Math.max(0, r3(num(l.remaining)));
    return {
      id: l.id,
      reference: l.reference ?? '',
      supplierRef: l.supplierRef ?? '',
      designation: l.designation,
      ordered: kind === 'order' ? qty : l.ordered == null ? null : num(l.ordered),
      // Commande : reçu = commandé − reste (connu seulement si le reste l'est). Réception : ce bon.
      received: kind === 'receipt' ? qty : remaining == null || l.orderClosed ? null : r3(Math.max(0, qty - remaining)),
      remaining,
      unitPriceHt: num(l.unitPriceHt),
      discountPct: num(l.discountPct),
      totalHt: purchaseLineHt(qty, l.unitPriceHt, l.discountPct),
    };
  });

  const linesHt = r2(out.reduce((s, l) => s + l.totalHt, 0));
  const gd = num(header.globalDiscountPct);
  const globalDiscountAmount = r2(linesHt * gd / 100);
  const shippingHt = r2(num(header.shippingHt));
  const factor = 1 - gd / 100;
  const linesVat = lines.reduce((s, l) => s + purchaseLineHt(l.quantity, l.unitPriceHt, l.discountPct) * factor * num(l.vatRate) / 100, 0);
  const shippingVat = header.shippingTaxed === false ? 0 : shippingHt * num(header.shippingVatRate) / 100;
  const computed = { ht: r2(linesHt - globalDiscountAmount + shippingHt), vat: r2(linesVat + shippingVat), ttc: 0 };
  computed.ttc = r2(computed.ht + computed.vat);
  const ht0 = header.totals?.ht, vat0 = header.totals?.vat, ttc0 = header.totals?.ttc;
  const totals = ht0 != null && vat0 != null && ttc0 != null ? { ht: r2(num(ht0)), vat: r2(num(vat0)), ttc: r2(num(ttc0)) } : computed;

  const remainders = out
    .map((l, i) => ({ l, src: lines[i] }))
    .filter(({ l }) => (l.remaining ?? 0) > 0)
    .map(({ l, src }) => ({ reference: l.reference, designation: l.designation, orderNumber: src.orderNumber ?? null, ordered: l.ordered, remaining: l.remaining as number }));

  return { kind, lines: out, linesHt, globalDiscountPct: gd, globalDiscountAmount, shippingHt, totals, remainders, partial: remainders.length > 0 };
}

/** Quantité affichée (3 décimales au plus, virgule). */
export const purchaseQty = (n: number | null | undefined): string => (n == null ? '' : String(r3(n)).replace('.', ','));

/** Nom du fichier PDF : « Commande-fournisseur_CMD-2026-00012.pdf ». */
export function purchasePdfFileName(title: string, number: string | null): string {
  const safe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe(title)}_${safe(number ?? 'brouillon')}.pdf`;
}
