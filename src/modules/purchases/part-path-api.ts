/**
 * M4 — C2 : accès base du chemin des pièces et des étiquettes de destination (migrations 20261123110000
 * à 112000 ; pas encore dans types.ts : client non typé, comme g8-api). Migration absente : liste vide,
 * les écrans existants ne cassent pas.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DestinationKind, DestinationRow, PartPathRow, PartReceipt, PartSupply } from './part-path';

const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};
type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v == null || v === '' ? null : String(v));
const missing = (e: { message: string; code?: string }) => e.code === 'PGRST202' || e.code === '42883' || /Could not find the function/i.test(e.message);

export type PartPathScope = 'all' | 'part_order' | 'repair_order' | 'appointment' | 'basket' | 'purchase';

const toReceipt = (r: Row): PartReceipt => ({ id: String(r.id), number: s(r.number), date: s(r.date), bl: s(r.bl), invoice: s(r.invoice) });
const toSupply = (x: Row): PartSupply => ({
  kind: x.kind as PartSupply['kind'], docId: String(x.doc_id), number: s(x.number), type: s(x.type), dcs: s(x.dcs), status: String(x.status ?? ''),
  orderedAt: s(x.ordered_at), expectedAt: s(x.expected_at), qty: n(x.qty), received: n(x.received), receivedAt: s(x.received_at),
  receipts: ((x.receipts ?? []) as Row[]).map(toReceipt),
});

export async function listPartPaths(companyId: string, scope: PartPathScope, scopeId: string | null, openOnly: boolean): Promise<PartPathRow[]> {
  const { data, error } = await sb.rpc('part_path_rows', { _company: companyId, _scope: scope, _scope_id: scopeId, _open_only: openOnly, _limit: 1000 });
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    demandKind: r.demand_kind as PartPathRow['demandKind'], demandId: String(r.demand_id), articleId: s(r.article_id),
    reference: s(r.reference), designation: s(r.designation), bin: s(r.bin_location), qtyNeeded: n(r.qty_needed),
    orderKind: String(r.order_kind ?? ''), sourceId: s(r.source_id), sourceNumber: s(r.source_number), sourceStatus: s(r.source_status),
    excelTab: s(r.excel_tab), contactId: s(r.contact_id), contactName: s(r.contact_name), contactPhone: s(r.contact_phone),
    repairOrderId: s(r.repair_order_id), orNumber: s(r.or_number), appointmentId: s(r.appointment_id), appointmentAt: s(r.appointment_at),
    documentId: s(r.document_id), documentNumber: s(r.document_number), supplies: ((r.supplies ?? []) as Row[]).map(toSupply),
    qtyReserved: n(r.qty_reserved), qtyPrepared: n(r.qty_prepared), qtyDelivered: n(r.qty_delivered),
    informedAt: s(r.informed_at), informedChannel: s(r.informed_channel), noticeStatus: s(r.notice_status), noticeIsTest: !!r.notice_is_test,
    demandedAt: s(r.demanded_at),
  }));
}

export async function markPartInformed(p: {
  companyId: string; sourceKind: 'part_order' | 'repair_order' | 'document'; sourceId: string; articleId: string | null; channel: string; receiptId?: string | null;
}): Promise<void> {
  const { error } = await sb.rpc('part_path_mark_informed', {
    _company: p.companyId, _source_kind: p.sourceKind, _source_id: p.sourceId, _article: p.articleId, _channel: p.channel, _receipt: p.receiptId ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------ Étiquettes de destination */

export async function listDestinationLabels(kind: DestinationKind, id: string): Promise<DestinationRow[]> {
  const { data, error } = await sb.rpc('part_destination_labels', { _kind: kind, _id: id });
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    articleId: String(r.article_id), reference: s(r.reference), designation: s(r.designation), bin: s(r.bin_location), barcode: s(r.barcode),
    qty: n(r.qty), customerName: s(r.customer_name), docNumber: s(r.doc_number), appointmentAt: s(r.appointment_at),
    sourceKind: String(r.source_kind ?? ''), sourceId: s(r.source_id), isDirect: !!r.is_direct,
  }));
}

export async function enqueueDestinationLabels(companyId: string, items: { row: DestinationRow; qty: number }[], o: {
  workstationId: string | null; source: DestinationKind; sourceRef: string;
}): Promise<number> {
  const { data, error } = await sb.rpc('destination_labels_enqueue', {
    _company: companyId, _workstation: o.workstationId, _source: o.source, _source_ref: o.sourceRef,
    _items: items.map(({ row, qty }) => ({
      article_id: row.articleId, qty, customer_name: row.customerName, doc_number: row.docNumber,
      appointment_at: row.appointmentAt, bin_location: row.bin,
    })),
  });
  if (error) throw new Error(error.message);
  return n(data);
}

export type PendingDestination = {
  workstationId: string | null; workstationName: string | null; qty: number; ids: number[]; row: DestinationRow;
};

export async function listPendingDestinationLabels(companyId: string): Promise<PendingDestination[]> {
  const { data, error } = await sb.rpc('destination_labels_pending', { _company: companyId });
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map((r) => {
    const d = (r.destination ?? {}) as Row;
    return {
      workstationId: s(r.workstation_id), workstationName: s(r.workstation_name), qty: n(r.qty), ids: (r.ids as number[]) ?? [],
      row: {
        articleId: String(r.article_id), reference: s(r.reference), designation: s(r.designation), bin: s(d.bin_location), barcode: s(r.barcode),
        qty: n(r.qty), customerName: s(d.customer_name), docNumber: s(d.doc_number), appointmentAt: s(d.appointment_at),
        sourceKind: 'queue', sourceId: null, isDirect: true,
      },
    };
  });
}
