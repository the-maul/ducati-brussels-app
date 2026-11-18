/**
 * Rattrapage G8 (18/11/2026, lot parc) — devis de reparation depuis l'OR et duplication d'un OR.
 * Regles : or-copy-rules.ts. Aucune ecriture de stock : un devis (DEV) ne bouge pas le stock, et
 * l'OR duplique repart « a faire » (la facture de l'OR sortira le stock, B7).
 */
import { supabase } from '@/integrations/supabase/client';
import { createDocument } from '@/modules/sales/write-api';
import { createRepairOrder } from './write-api';
import { duplicateRoLines, roLinesToQuoteLines, type RoRowLike } from './or-copy-rules';

async function loadOr(orId: string) {
  const [{ data: or, error: oe }, { data: lines, error: le }] = await Promise.all([
    supabase.from('repair_orders').select('*').eq('id', orId).single(),
    supabase.from('repair_order_lines').select('*').eq('or_id', orId).order('sort_order'),
  ]);
  if (oe) throw oe;
  if (le) throw le;
  return { or, lines: (lines ?? []) as unknown as RoRowLike[] };
}

/** Devis de reparation (DEV, brouillon) qui recopie les lignes de l'OR ; renvoie l'id du document. */
export async function createRepairQuoteFromOr(orId: string, notePrefix: string): Promise<string> {
  const { or, lines } = await loadOr(orId);
  const quoteLines = roLinesToQuoteLines(lines);
  return createDocument({
    companyId: or.company_id, docType: 'DEV', contactId: or.contact_id, vehicleId: or.vehicle_id,
    issueDate: new Date().toISOString().slice(0, 10), status: 'brouillon',
    notes: `${notePrefix} ${or.number ?? ''}`.trim(),
    lines: quoteLines.length ? quoteLines : [{ designation: `${notePrefix} ${or.number ?? ''}`.trim(), quantity: 0, unit_price_ht: 0, vat_rate: 21, discount_pct: 0, line_type: 'texte' }],
    pied: { priceMode: ((or as { price_mode?: string }).price_mode as 'ht' | 'ttc') ?? 'ttc' },
  });
}

/** Nouvel OR « a faire » : meme client, moto, travaux et lignes (sans check-up ni garantie). */
export async function duplicateRepairOrder(orId: string): Promise<string> {
  const { or, lines } = await loadOr(orId);
  const ox = or as unknown as Record<string, unknown>;
  return createRepairOrder({
    companyId: or.company_id, contactId: or.contact_id, vehicleId: or.vehicle_id, mileage: null,
    operator: or.operator, repairType: or.repair_type, workDescription: or.work_description, receptionNotes: or.reception_notes,
    status: 'a_faire', warrantyStatus: 'aucune', expertName: null, expertDate: null,
    reasonCode: (ox.reason_code as string | null | undefined) ?? undefined,
    lines: duplicateRoLines(lines),
  });
}
