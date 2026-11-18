/**
 * M4 — Écriture des documents d'achat : commande (CMD) / réception (REC).
 * La RÉCEPTION validée crée de vraies ENTRÉES de stock et recalcule le PAMP
 * (B5) via record_stock_move — jamais d'UPDATE direct du stock (B7) — le tout
 * côté serveur, en une transaction (purchase_doc_save, 18/11/2026).
 */
import type { PurchaseSchedule } from './api';
// Import dynamique : garde computePurchaseTotals testable sans client Supabase (tests/purchases-totals.test.ts).
import type { DocLinePayload } from './g8-api';

/** Données châssis d'une ligne véhicule → crée une fiche véhicule (type V) à la réception (B9, G8 R4-R5). */
export type ChassisInput = {
  vin: string;
  brand?: string | null;
  model?: string | null;
  engine_number?: string | null;
  power_cv?: number | null;
  is_restricted?: boolean;          // bridé A2
  energy?: string | null;
  antipollution?: string | null;    // norme [V.9]
  color?: string | null;
  first_registration_date?: string | null;
  mileage?: number | null;
  model_year?: number | null;
  gps_tracker_id?: string | null;
  pin_tracker?: string | null;
  tpms_av?: string | null;
  tpms_ar?: string | null;
  warranty_end?: string | null;
};

export type PurchaseLineInput = {
  article_id?: string | null;
  designation: string;
  supplier_ref?: string | null;
  quantity: number;
  unit_price_ht: number;
  discount_pct: number;
  vat_rate: number;
  sale_price_ttc?: number | null;
  bin_location?: string | null;
  labels?: number;
  chassis?: ChassisInput | null;     // réception châssis → fiche véhicule
};

export type ScheduleInput = { seq_no: number; due_date: string | null; amount: number; note?: string | null };

export type VatRegime = 'with_vat' | 'cee' | 'outside_cee';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function lineNetHt(l: PurchaseLineInput) {
  // Calcul du brut HT sur 3 décimales (G8 R6), arrondi à 2 pour le stockage.
  return r3(l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100));
}

export function computePurchaseTotals(
  lines: PurchaseLineInput[],
  opts: { vatRegime?: VatRegime; globalDiscountPct?: number; shippingHt?: number; shippingTaxed?: boolean; shippingVatRate?: number } = {},
) {
  const withVat = (opts.vatRegime ?? 'with_vat') === 'with_vat';
  let linesHt = 0, linesVat = 0;
  for (const l of lines) {
    const ht = lineNetHt(l);
    linesHt += ht;
    linesVat += withVat ? (ht * (l.vat_rate || 0)) / 100 : 0;
  }
  const discount = opts.globalDiscountPct && opts.globalDiscountPct > 0 ? (linesHt * opts.globalDiscountPct) / 100 : 0;
  const netHt = linesHt - discount;
  const netVat = linesHt > 0 ? linesVat * (netHt / linesHt) : 0;
  const shipHt = opts.shippingHt || 0;
  const shipVat = withVat && opts.shippingTaxed !== false && shipHt > 0 ? (shipHt * (opts.shippingVatRate ?? 21)) / 100 : 0;
  const total_ht = r2(netHt + shipHt);
  const total_vat = r2(netVat + shipVat);
  return { total_ht, total_vat, total_ttc: r2(total_ht + total_vat), lines_ht: r2(linesHt), global_discount: r2(discount) };
}

/**
 * Crée (et valide) un document d'achat. Depuis le rattrapage G8 du 18/11/2026, TOUT passe par la fonction
 * serveur purchase_doc_save (une seule transaction : numéro, lignes, échéances, totaux, entrées de stock,
 * PAMP, prix d'achat, fiche moto, statut des commandes reçues). Plus aucune écriture ligne à ligne depuis
 * le navigateur (une coupure laissait une réception à moitié en stock).
 */
export async function createPurchaseOrder(p: {
  companyId: string; docType: 'CMD' | 'REC'; supplierId?: string | null; status: 'brouillon' | 'validee';
  vatRegime?: VatRegime; supplierInvoiceNo?: string | null; supplierBlNo?: string | null; intranetNo?: string | null;
  invoiceDate?: string | null; blDate?: string | null; receiptDate?: string | null; orderDate?: string | null; expectedDate?: string | null;
  shippingHt?: number; shippingTaxed?: boolean; shippingVatRate?: number; globalDiscountPct?: number;
  notes?: string | null;
  lines: PurchaseLineInput[]; schedules?: ScheduleInput[];
}): Promise<string> {
  const { savePurchaseDoc } = await import('./g8-api');
  const res = await savePurchaseDoc({
    companyId: p.companyId, validate: p.status === 'validee',
    header: {
      doc_type: p.docType, supplier_id: p.supplierId ?? null, vat_regime: p.vatRegime ?? 'with_vat',
      supplier_invoice_no: p.supplierInvoiceNo ?? null, supplier_bl_no: p.supplierBlNo ?? null, intranet_no: p.intranetNo ?? null,
      invoice_date: p.invoiceDate ?? null, bl_date: p.blDate ?? null, receipt_date: p.receiptDate ?? null,
      order_date: p.orderDate ?? null, expected_date: p.expectedDate ?? null,
      shipping_ht: p.shippingHt ?? 0, shipping_taxed: p.shippingTaxed !== false, shipping_vat_rate: p.shippingVatRate ?? 21,
      global_discount_pct: p.globalDiscountPct ?? 0, notes: p.notes ?? null,
    },
    lines: p.lines.map((l) => ({
      article_id: l.article_id ?? null, designation: l.designation, supplier_ref: l.supplier_ref ?? null, quantity: l.quantity,
      unit_price_ht: l.unit_price_ht, discount_pct: l.discount_pct || 0, vat_rate: l.vat_rate, sale_price_ttc: l.sale_price_ttc ?? null,
      bin_location: l.bin_location ?? null, labels: l.labels ?? 0,
      chassis: l.chassis?.vin?.trim() ? ({ ...l.chassis } as DocLinePayload['chassis']) : null,
    })),
    schedules: (p.schedules ?? []).map((s) => ({ seq_no: s.seq_no, due_date: s.due_date, amount: s.amount, note: s.note ?? null })),
  });
  return res.id;
}

/** Crée une commande fournisseur (CMD) validée par fournisseur à partir de lignes de réappro (PA de la fiche). */
export async function createOrdersFromProposals(
  companyId: string,
  items: { article_id: string; supplier_id: string | null; designation: string; quantity: number; unit_price_ht?: number }[],
): Promise<number> {
  const bySupplier = new Map<string, typeof items>();
  for (const it of items) {
    if (it.quantity <= 0) continue;
    const key = it.supplier_id ?? '__none__';
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(it);
  }
  let created = 0;
  for (const [supplier, group] of bySupplier) {
    // Sans fournisseur : la commande reste en brouillon (le serveur exige un fournisseur pour valider).
    await createPurchaseOrder({
      companyId, docType: 'CMD', supplierId: supplier === '__none__' ? null : supplier,
      status: supplier === '__none__' ? 'brouillon' : 'validee',
      orderDate: new Date().toISOString().slice(0, 10),
      lines: group.map((g) => ({ article_id: g.article_id, designation: g.designation, quantity: g.quantity, unit_price_ht: g.unit_price_ht ?? 0, discount_pct: 0, vat_rate: 21 })),
    });
    created++;
  }
  return created;
}

export type { PurchaseSchedule };
