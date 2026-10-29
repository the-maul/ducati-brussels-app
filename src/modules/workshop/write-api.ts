/**
 * M8 — Atelier : écriture des OR + transformation en facture (via M6).
 * Garantie B10 : statut de prise en charge + garantie par ligne (prix 0). La
 * transformation en facture est bloquée tant que la garantie est « en attente ».
 * Le stock réel est débité par la facture (M6), pas par l'OR (append-only B7).
 *
 * Check-up (31/10, ATE008 / ATE009) : les lignes portent en plus l'état du check-up, la
 * photo (GED) et le lien vers la ligne de la proposition envoyée au client ; les lignes sont
 * réécrites EN UNE TRANSACTION par `repair_order_write_lines` (piège §7 de M08). Tant que la
 * migration 20261031110000 n'est pas appliquée, on retombe sur l'ancien chemin (sans ces
 * colonnes) : l'OR classique continue de s'enregistrer.
 */
import { supabase } from '@/integrations/supabase/client';
import { createDocument, type LineInput } from '@/modules/sales/write-api';
import { invoiceableRoLines } from './checkup/rules';

export type RoLineInput = {
  kind: 'piece' | 'mo' | 'texte';
  article_id?: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  discount_pct: number;
  is_warranty: boolean;
  /** Check-up (migration 20261031110000) : carte, état, photo, ligne de la proposition. */
  checkup_key?: string | null;
  checkup_state?: string | null;
  photo_path?: string | null;
  proposal_line_id?: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function lineTotals(l: RoLineInput) {
  const price = l.is_warranty ? 0 : l.unit_price_ht;
  const ht = l.quantity * price * (1 - (l.discount_pct || 0) / 100);
  const ttc = ht * (1 + (l.vat_rate || 0) / 100);
  return { ht: r2(ht), ttc: r2(ttc) };
}

/** Totaux de l'OR : les actions du check-up « OK » ou « reportées » ne comptent pas. */
export function computeRoTotals(lines: RoLineInput[]) {
  let ht = 0, ttc = 0;
  for (const l of lines) {
    if (l.checkup_state === 'ok' || l.checkup_state === 'reporte') continue;
    const tot = lineTotals(l); ht += tot.ht; ttc += tot.ttc;
  }
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
  /** Motif d'entrée (reference_values `workshop_reason`), undefined = ne pas toucher. */
  reasonCode?: string | null;
  lines: RoLineInput[];
};

// ---------------------------------------------------------------------------------------------
// Les colonnes du check-up existent-elles en base ? (sondé une fois par session)
// ---------------------------------------------------------------------------------------------
let schemaProbe: Promise<boolean> | null = null;

/** true quand la migration 20261031110000 est appliquée (colonne repair_orders.customer_approval). */
export function checkupSchemaReady(): Promise<boolean> {
  schemaProbe ??= (async () => {
    try {
      const { error } = await supabase.from('repair_orders').select('customer_approval' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return schemaProbe;
}

/** Erreur « fonction / colonne inconnue » (migration non appliquée) → on retombe sur l'ancien chemin. */
const isMissingSchema = (e: unknown): boolean => {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  return code === 'PGRST202' || code === 'PGRST204' || code === '42883' || code === '42703' || /does not exist|Could not find/i.test(msg);
};

async function writeLinesLegacy(orId: string, lines: RoLineInput[]) {
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

/**
 * Réécrit les lignes de l'OR en une transaction (`repair_order_write_lines`). Si la fonction
 * n'est pas encore en base, ancien chemin (suppression puis insertion, sans les colonnes check-up).
 */
async function writeLines(orId: string, lines: RoLineInput[]) {
  const payload = lines.map((l) => {
    const tot = lineTotals(l);
    return {
      kind: l.kind, article_id: l.article_id ?? null, designation: l.designation, quantity: l.quantity,
      unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate, discount_pct: l.discount_pct || 0, is_warranty: l.is_warranty,
      line_ht: tot.ht, line_ttc: tot.ttc, checkup_key: l.checkup_key ?? null, checkup_state: l.checkup_state ?? null,
      photo_path: l.photo_path ?? null, proposal_line_id: l.proposal_line_id ?? null,
    };
  });
  const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>)(
    'repair_order_write_lines', { _or: orId, _lines: payload },
  );
  if (!error) return;
  if (!isMissingSchema(error)) throw error;
  await writeLinesLegacy(orId, lines);
}

/** En-tête de l'OR : les colonnes du check-up ne sont écrites que si la base les connaît. */
async function headerPatch(p: RoInput): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null, mileage: p.mileage ?? null,
    operator: p.operator ?? null, repair_type: p.repairType ?? null, work_description: p.workDescription ?? null,
    reception_notes: p.receptionNotes ?? null, status: p.status, warranty_status: p.warrantyStatus,
    expert_name: p.expertName ?? null, expert_date: p.expertDate ?? null, ...computeRoTotals(p.lines),
  };
  if (p.reasonCode !== undefined && await checkupSchemaReady()) base.reason_code = p.reasonCode || null;
  return base;
}

export async function createRepairOrder(p: RoInput): Promise<string> {
  const number = await nextNumber(p.companyId);
  const patch = await headerPatch(p);
  const { data, error } = await supabase.from('repair_orders')
    .insert({ company_id: p.companyId, number, ...patch } as never).select('id').single();
  if (error) throw error;
  const orId = (data as { id: string }).id;
  await writeLines(orId, p.lines);
  return orId;
}

export async function updateRepairOrder(orId: string, p: RoInput): Promise<void> {
  const patch = await headerPatch(p);
  const { error } = await supabase.from('repair_orders').update(patch as never).eq('id', orId);
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
 * Check-up : les actions « OK » et « reportées » (décochées par le client) ne sont jamais
 * facturées ; une carte sans main-d'oeuvre devient une ligne texte.
 */
export async function transformToInvoice(orId: string): Promise<string> {
  const { data: or, error: oe } = await supabase.from('repair_orders').select('*').eq('id', orId).single();
  if (oe) throw oe;
  if (or.warranty_status === 'en_attente') throw new Error('Garantie en attente : décision requise avant facturation (B10)');
  if (or.status === 'facture') throw new Error('OR déjà facturé');
  const { data: lines, error: le } = await supabase.from('repair_order_lines').select('*').eq('or_id', orId).order('sort_order');
  if (le) throw le;

  type RoRow = NonNullable<typeof lines>[number] & { checkup_state?: string | null };
  const lineInputs: LineInput[] = invoiceableRoLines((lines ?? []) as RoRow[]).map((l) => ({
    article_id: l.as_text ? null : l.article_id, designation: l.designation,
    quantity: l.as_text ? 0 : Number(l.quantity),
    unit_price_ht: l.as_text || l.is_warranty ? 0 : Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct),
    line_type: l.as_text ? 'texte' : l.kind === 'mo' ? 'main_oeuvre' : 'article',
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
