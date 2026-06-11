/**
 * M8 — Atelier : écriture des OR + transformation en facture (via M6).
 * Garantie B10 : statut de prise en charge + garantie par ligne (prix 0). La
 * transformation en facture est bloquée tant que la garantie est « en attente ».
 * Le stock réel est débité par la facture (M6), pas par l'OR (append-only B7).
 */
import { supabase } from '@/integrations/supabase/client';
import { createDocument, type LineInput } from '@/modules/sales/write-api';

export type RoLineInput = {
  kind: 'piece' | 'mo' | 'texte';
  article_id?: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  discount_pct: number;
  is_warranty: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function lineTotals(l: RoLineInput) {
  const price = l.is_warranty ? 0 : l.unit_price_ht;
  const ht = l.quantity * price * (1 - (l.discount_pct || 0) / 100);
  const ttc = ht * (1 + (l.vat_rate || 0) / 100);
  return { ht: r2(ht), ttc: r2(ttc) };
}

export function computeRoTotals(lines: RoLineInput[]) {
  let ht = 0, ttc = 0;
  for (const l of lines) { const tot = lineTotals(l); ht += tot.ht; ttc += tot.ttc; }
  ht = r2(ht); ttc = r2(ttc);
  return { total_ht: ht, total_vat: r2(ttc - ht), total_ttc: ttc };
}

async function nextNumber(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: 'OR' });
  if (error) throw error;
  return data as string;
}

export type RoInput = {
  companyId: string; contactId?: string | null; vehicleId?: string | null; mileage?: number | null;
  operator?: string | null; repairType?: string | null; workDescription?: string | null; receptionNotes?: string | null;
  status: string; warrantyStatus: string; expertName?: string | null; expertDate?: string | null;
  lines: RoLineInput[];
};

async function writeLines(orId: string, lines: RoLineInput[]) {
  await supabase.from('repair_order_lines').delete().eq('or_id', orId);
  if (lines.length) {
    const rows = lines.map((l, i) => {
      const tot = lineTotals(l);
      return {
        or_id: orId, kind: l.kind, article_id: l.article_id ?? null, designation: l.designation,
        quantity: l.quantity, unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate, discount_pct: l.discount_pct || 0,
        is_warranty: l.is_warranty, line_ht: tot.ht, line_ttc: tot.ttc, sort_order: i,
      };
    });
    const { error } = await supabase.from('repair_order_lines').insert(rows);
    if (error) throw error;
  }
}

export async function createRepairOrder(p: RoInput): Promise<string> {
  const totals = computeRoTotals(p.lines);
  const number = await nextNumber(p.companyId);
  const { data, error } = await supabase.from('repair_orders').insert({
    company_id: p.companyId, number, contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null,
    mileage: p.mileage ?? null, operator: p.operator ?? null, repair_type: p.repairType ?? null,
    work_description: p.workDescription ?? null, reception_notes: p.receptionNotes ?? null,
    status: p.status, warranty_status: p.warrantyStatus, expert_name: p.expertName ?? null, expert_date: p.expertDate ?? null,
    ...totals,
  }).select('id').single();
  if (error) throw error;
  const orId = data.id as string;
  await writeLines(orId, p.lines);
  return orId;
}

export async function updateRepairOrder(orId: string, p: RoInput): Promise<void> {
  const totals = computeRoTotals(p.lines);
  const { error } = await supabase.from('repair_orders').update({
    contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null, mileage: p.mileage ?? null,
    operator: p.operator ?? null, repair_type: p.repairType ?? null, work_description: p.workDescription ?? null,
    reception_notes: p.receptionNotes ?? null, status: p.status, warranty_status: p.warrantyStatus,
    expert_name: p.expertName ?? null, expert_date: p.expertDate ?? null, ...totals,
  }).eq('id', orId);
  if (error) throw error;
  await writeLines(orId, p.lines);
}

export async function setRepairOrderStatus(orId: string, status: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').update({ status }).eq('id', orId);
  if (error) throw error;
}

export async function setWarrantyStatus(orId: string, warranty_status: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').update({ warranty_status }).eq('id', orId);
  if (error) throw error;
}

/**
 * Transforme un OR en facture (M6). Bloqué si la garantie est en attente de décision (B10).
 * Les pièces en garantie passent à prix 0 (cession garantie) ; la facture débite le stock réel.
 */
export async function transformToInvoice(orId: string): Promise<string> {
  const { data: or, error: oe } = await supabase.from('repair_orders').select('*').eq('id', orId).single();
  if (oe) throw oe;
  if (or.warranty_status === 'en_attente') throw new Error('Garantie en attente : décision requise avant facturation (B10)');
  if (or.status === 'facture') throw new Error('OR déjà facturé');
  const { data: lines, error: le } = await supabase.from('repair_order_lines').select('*').eq('or_id', orId).order('sort_order');
  if (le) throw le;

  const lineInputs: LineInput[] = (lines ?? []).map((l) => ({
    article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity),
    unit_price_ht: l.is_warranty ? 0 : Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct),
  }));

  const docId = await createDocument({
    companyId: or.company_id, docType: 'FAC', contactId: or.contact_id, vehicleId: or.vehicle_id,
    issueDate: new Date().toISOString().slice(0, 10), status: 'validee', notes: `OR ${or.number ?? ''}`.trim(),
    lines: lineInputs, pied: { priceMode: (or.price_mode as 'ht' | 'ttc') ?? 'ttc' },
  });

  const { error: ue } = await supabase.from('repair_orders').update({ status: 'facture', invoice_document_id: docId }).eq('id', orId);
  if (ue) throw ue;
  return docId;
}
