/**
 * M4 — Écriture des documents d'achat : commande (CMD) / réception (REC).
 * La RÉCEPTION validée crée de vraies ENTRÉES de stock et recalcule le PAMP
 * (B5) via record_stock_move — jamais d'UPDATE direct du stock (B7).
 */
import { supabase } from '@/integrations/supabase/client';
import type { PurchaseSchedule } from './api';

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

async function nextNumber(companyId: string, docType: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: docType });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function createPurchaseOrder(p: {
  companyId: string; docType: 'CMD' | 'REC'; supplierId?: string | null; status: 'brouillon' | 'validee';
  vatRegime?: VatRegime; supplierInvoiceNo?: string | null; supplierBlNo?: string | null; intranetNo?: string | null;
  invoiceDate?: string | null; blDate?: string | null; receiptDate?: string | null; orderDate?: string | null; expectedDate?: string | null;
  shippingHt?: number; shippingTaxed?: boolean; shippingVatRate?: number; globalDiscountPct?: number;
  notes?: string | null; sourceOrderId?: string | null;
  lines: PurchaseLineInput[]; schedules?: ScheduleInput[];
}): Promise<string> {
  const totals = computePurchaseTotals(p.lines, {
    vatRegime: p.vatRegime, globalDiscountPct: p.globalDiscountPct,
    shippingHt: p.shippingHt, shippingTaxed: p.shippingTaxed, shippingVatRate: p.shippingVatRate,
  });
  const number = p.status === 'validee' ? await nextNumber(p.companyId, p.docType) : null;

  const { data: order, error } = await supabase.from('purchase_orders').insert({
    company_id: p.companyId, doc_type: p.docType, number, supplier_id: p.supplierId ?? null,
    status: p.status === 'validee' && p.docType === 'REC' ? 'recue' : p.status,
    vat_regime: p.vatRegime ?? 'with_vat',
    supplier_invoice_no: p.supplierInvoiceNo ?? null, supplier_bl_no: p.supplierBlNo ?? null, intranet_no: p.intranetNo ?? null,
    invoice_date: p.invoiceDate ?? null, bl_date: p.blDate ?? null, receipt_date: p.receiptDate ?? null,
    order_date: p.orderDate ?? null, expected_date: p.expectedDate ?? null,
    shipping_ht: p.shippingHt ?? 0, shipping_taxed: p.shippingTaxed !== false, shipping_vat_rate: p.shippingVatRate ?? 21,
    global_discount_pct: p.globalDiscountPct ?? 0, source_order_id: p.sourceOrderId ?? null, notes: p.notes ?? null,
    ...totals,
  }).select('id').single();
  if (error) throw error;
  const orderId = order.id as string;

  if (p.lines.length) {
    const rows = p.lines.map((l, i) => ({
      order_id: orderId, article_id: l.article_id ?? null, designation: l.designation, supplier_ref: l.supplier_ref ?? null,
      quantity: l.quantity, unit_price_ht: l.unit_price_ht, discount_pct: l.discount_pct || 0, vat_rate: l.vat_rate,
      sale_price_ttc: l.sale_price_ttc ?? null, bin_location: l.bin_location ?? null, labels: l.labels ?? 0,
      line_ht: lineNetHt(l), sort_order: i,
    }));
    const { error: le } = await supabase.from('purchase_lines').insert(rows);
    if (le) throw le;
  }

  if (p.schedules?.length) {
    const rows = p.schedules.filter((s) => s.amount > 0 || s.due_date).map((s) => ({
      order_id: orderId, company_id: p.companyId, seq_no: s.seq_no, due_date: s.due_date, amount: s.amount, note: s.note ?? null,
    }));
    if (rows.length) { const { error: se } = await supabase.from('purchase_schedules').insert(rows); if (se) throw se; }
  }

  // Réception validée → ENTRÉES de stock + recalcul PAMP (B5/B7). Coût = PU net.
  if (p.status === 'validee' && p.docType === 'REC') {
    for (const l of p.lines) {
      if (!l.article_id || l.quantity <= 0) continue;
      const unitNet = r3(l.unit_price_ht * (1 - (l.discount_pct || 0) / 100));
      const { error: me } = await supabase.rpc('record_stock_move', {
        _article: l.article_id, _type: 'entree', _qty: Math.abs(l.quantity), _unit_cost: unitNet,
        _is_reservation: false, _bin: l.bin_location ?? null, _origin: 'reception', _ref: number, _note: null,
      });
      if (me) throw me;

      // Réception châssis → création de la fiche véhicule (type V) liée à l'article (B9, G8 R5).
      if (l.chassis?.vin?.trim()) {
        const ch = l.chassis;
        const { error: ve } = await supabase.from('vehicles').insert({
          company_id: p.companyId, article_id: l.article_id, vin: ch.vin.trim(),
          brand: ch.brand ?? null, model: ch.model ?? l.designation, engine_number: ch.engine_number ?? null,
          power_cv: ch.power_cv ?? null, is_restricted: !!ch.is_restricted, energy: ch.energy ?? null,
          antipollution: ch.antipollution ?? null, color: ch.color ?? null,
          first_registration_date: ch.first_registration_date ?? null, mileage: ch.mileage ?? null,
          model_year: ch.model_year ?? null, gps_tracker_id: ch.gps_tracker_id ?? null, pin_tracker: ch.pin_tracker ?? null,
          tpms_av: ch.tpms_av ?? null, tpms_ar: ch.tpms_ar ?? null, warranty_end: ch.warranty_end ?? null,
          purchase_price: unitNet, cost_price: unitNet, display_price: l.sale_price_ttc ?? null,
          status: 'stock_vn',
        });
        if (ve) throw ve;
      }
    }
  }
  return orderId;
}

export type { PurchaseSchedule };
