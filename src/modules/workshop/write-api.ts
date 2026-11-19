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
import { operatorIdSchemaReady } from './or-page-api';
import { clientUnitPrice, lineCoveredByWarranty, lineDecisionToSave } from './warranty/rules';
import { orBaseSchemaReady } from './or-base/api';
import { invoiceQuantity } from './labour-time/rules';
import { insurerPricingSchemaReady } from './or-line-pricing-api';

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
  /** Refus partiel (migration 20261118130000) : accepte / refuse (re-routee vers le client). */
  warranty_decision?: string | null;
  /**
   * « Gestion du temps atelier » d'une ligne MO (migration 20261118110000, rattrapage G8) :
   * mécanicien, date des travaux, heures facturées (= la quantité), passées, internes, garanties.
   * undefined = la ligne ne les porte pas (carte du check-up : la base garde les anciennes valeurs).
   */
  mechanic_code?: string | null;
  mechanic_name?: string | null;
  work_date?: string | null;
  billed_hours?: number | null;
  worked_hours?: number | null;
  internal_hours?: number | null;
  warranty_hours?: number | null;
};

/** Colonnes du temps MO, envoyées seulement quand la ligne les porte (clé présente). */
const TIME_KEYS = ['mechanic_code', 'mechanic_name', 'work_date', 'billed_hours', 'worked_hours', 'internal_hours', 'warranty_hours'] as const;
function timeColumns(l: RoLineInput): Record<string, unknown> {
  if (l.kind !== 'mo') return {};
  const out: Record<string, unknown> = {};
  for (const k of TIME_KEYS) if (l[k] !== undefined) out[k] = l[k];
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totaux d'une ligne. Garantie (B10) : une ligne couverte vaut 0 pour le client ; en refus total,
 * ou refusee ligne par ligne en refus partiel, elle est re-routee vers le client (son prix).
 * Sans statut (ancien appel) : une ligne cochee garantie vaut 0, comme avant.
 */
function lineTotals(l: RoLineInput, warrantyStatus?: string | null) {
  const price = lineCoveredByWarranty(l, warrantyStatus) ? 0 : l.unit_price_ht;
  const ht = l.quantity * price * (1 - (l.discount_pct || 0) / 100);
  const ttc = ht * (1 + (l.vat_rate || 0) / 100);
  return { ht: r2(ht), ttc: r2(ttc) };
}

/** Totaux de l'OR : les actions du check-up « OK » ou « reportées » ne comptent pas. */
export function computeRoTotals(lines: RoLineInput[], warrantyStatus?: string | null) {
  let ht = 0, ttc = 0;
  for (const l of lines) {
    if (l.checkup_state === 'ok' || l.checkup_state === 'reporte') continue;
    const tot = lineTotals(l, warrantyStatus); ht += tot.ht; ttc += tot.ttc;
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
  /** Membre de l'equipe (migration 20261103230000) ; undefined = ne pas toucher. `operator` garde son nom. */
  operatorId?: string | null;
  status: string; warrantyStatus: string;
  /** Expert / date de passage ; undefined = ne pas toucher (geres par le volet assurance du dossier accident). */
  expertName?: string | null; expertDate?: string | null;
  /** Type de cession garantie (05 / 06 / 07) et commentaire de la demande (migration 20261118130000) ; undefined = ne pas toucher. */
  warrantyCessionCode?: string | null; warrantyNote?: string | null;
  /** Motif d'entrée (reference_values `workshop_reason`), undefined = ne pas toucher. */
  reasonCode?: string | null;
  lines: RoLineInput[];
  /** Rattrapage G8 (18/11) : undefined = ne pas toucher. Notes internes = colonne `notes` (non imprimee). */
  internalNotes?: string | null;
  /** Migration 20261118100000 : ecrits seulement si la base les connait. */
  promisedAt?: string | null;
  checkPoints?: Partial<Record<string, string>>;
  mileageAckPrevious?: number | null;
  /** T4 (migration 20261119200000) : tarif assureur applique aux lignes (null = tarif du client) ; undefined = ne pas toucher. */
  insurerPriceListId?: string | null;
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

let warrantyProbe: Promise<boolean> | null = null;

/** true quand la migration 20261118130000 est appliquee (colonne repair_orders.warranty_cession_code). */
export function warrantySchemaReady(): Promise<boolean> {
  warrantyProbe ??= (async () => {
    try {
      const { error } = await supabase.from('repair_orders').select('warranty_cession_code' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  return warrantyProbe;
}

async function writeLinesLegacy(orId: string, lines: RoLineInput[], warrantyStatus?: string | null) {
  await supabase.from('repair_order_lines').delete().eq('or_id', orId);
  if (lines.length) {
    const rows = lines.map((l, i) => {
      const tot = lineTotals(l, warrantyStatus);
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
async function writeLines(orId: string, lines: RoLineInput[], warrantyStatus?: string | null) {
  const payload = lines.map((l) => {
    const tot = lineTotals(l, warrantyStatus);
    return {
      kind: l.kind, article_id: l.article_id ?? null, designation: l.designation, quantity: l.quantity,
      unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate, discount_pct: l.discount_pct || 0, is_warranty: l.is_warranty,
      line_ht: tot.ht, line_ttc: tot.ttc, checkup_key: l.checkup_key ?? null, checkup_state: l.checkup_state ?? null,
      photo_path: l.photo_path ?? null, proposal_line_id: l.proposal_line_id ?? null,
      // Ignoree par la fonction tant que la migration 20261118130000 n'est pas posee.
      warranty_decision: lineDecisionToSave(l),
      ...timeColumns(l),
    };
  });
  const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>)(
    'repair_order_write_lines', { _or: orId, _lines: payload },
  );
  if (!error) return;
  if (!isMissingSchema(error)) throw error;
  await writeLinesLegacy(orId, lines, warrantyStatus);
}

/** En-tête de l'OR : les colonnes du check-up ne sont écrites que si la base les connaît. */
async function headerPatch(p: RoInput): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = {
    contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null, mileage: p.mileage ?? null,
    operator: p.operator ?? null, repair_type: p.repairType ?? null, work_description: p.workDescription ?? null,
    reception_notes: p.receptionNotes ?? null, status: p.status, warranty_status: p.warrantyStatus,
    ...computeRoTotals(p.lines, p.warrantyStatus),
  };
  if (p.expertName !== undefined) base.expert_name = p.expertName ?? null;
  if (p.expertDate !== undefined) base.expert_date = p.expertDate ?? null;
  // Type de cession garantie et commentaire : seulement si la migration 20261118130000 est en base.
  if ((p.warrantyCessionCode !== undefined || p.warrantyNote !== undefined) && await warrantySchemaReady()) {
    if (p.warrantyCessionCode !== undefined) base.warranty_cession_code = p.warrantyCessionCode || null;
    if (p.warrantyNote !== undefined) base.warranty_note = p.warrantyNote?.trim() || null;
  }
  if (p.reasonCode !== undefined && await checkupSchemaReady()) base.reason_code = p.reasonCode || null;
  // Operateur choisi dans l'equipe : l'id n'est ecrit que si la colonne existe (sinon le nom suffit).
  if (p.operatorId !== undefined && await operatorIdSchemaReady()) base.operator_id = p.operatorId || null;
  // Informations complementaires non imprimees (colonne d'origine `notes`).
  if (p.internalNotes !== undefined) base.notes = (p.internalNotes ?? '').trim() || null;
  // Promis le, 30 points V / R, km inferieur confirme : migration 20261118100000.
  if ((p.promisedAt !== undefined || p.checkPoints !== undefined || p.mileageAckPrevious !== undefined) && await orBaseSchemaReady()) {
    if (p.promisedAt !== undefined) base.promised_at = p.promisedAt || null;
    if (p.checkPoints !== undefined) base.check_points = p.checkPoints;
    if (p.mileageAckPrevious !== undefined) base.mileage_ack_previous = p.mileageAckPrevious;
  }
  // Tarif assureur avec lequel les lignes ont ete calculees (T4) : seulement si la colonne existe.
  if (p.insurerPriceListId !== undefined && await insurerPricingSchemaReady()) base.insurer_price_list_id = p.insurerPriceListId || null;
  return base;
}

export async function createRepairOrder(p: RoInput): Promise<string> {
  const number = await nextNumber(p.companyId);
  const patch = await headerPatch(p);
  const { data, error } = await supabase.from('repair_orders')
    .insert({ company_id: p.companyId, number, ...patch } as never).select('id').single();
  if (error) throw error;
  const orId = (data as { id: string }).id;
  await writeLines(orId, p.lines, p.warrantyStatus);
  return orId;
}

export async function updateRepairOrder(orId: string, p: RoInput): Promise<void> {
  const patch = await headerPatch(p);
  const { error } = await supabase.from('repair_orders').update(patch as never).eq('id', orId);
  if (error) throw error;
  await writeLines(orId, p.lines, p.warrantyStatus);
}

export async function setRepairOrderStatus(orId: string, status: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').update({ status }).eq('id', orId);
  if (error) throw error;
}

/**
 * « Demarrer » (decision Q43 du 18/11, comme G8) : l'OR passe « en cours » (le RDV suit), trace
 * `events` repair_order_work_started. Le premier pointage d'un mecanicien fait la meme chose en
 * base. Avant la migration 20261119190000 : simple changement de statut (audite par trg_ro_audit).
 */
export async function startRepairOrder(orId: string): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>)(
    'repair_order_start', { _or: orId },
  );
  if (!error) return;
  if (!isMissingSchema(error)) throw error;
  await setRepairOrderStatus(orId, 'en_cours');
}

export async function setWarrantyStatus(orId: string, warranty_status: string): Promise<void> {
  const { error } = await supabase.from('repair_orders').update({ warranty_status }).eq('id', orId);
  if (error) throw error;
}

/**
 * Facture d'OR déjà en base (lien `documents.repair_order_id`) : une facture validée bloque, un
 * brouillon orphelin (navigateur fermé entre l'en-tête et la validation) est retiré.
 * Renvoie l'id de la facture validée existante, sinon null. Sans la colonne : null (ancien chemin).
 */
async function existingOrInvoice(orId: string): Promise<string | null> {
  const { data, error } = await supabase.from('documents').select('id, status')
    .eq('repair_order_id' as never, orId as never).eq('doc_type', 'FAC').neq('status', 'annulee');
  if (error) return null;
  const rows = (data ?? []) as { id: string; status: string }[];
  const done = rows.find((d) => d.status !== 'brouillon');
  if (done) return done.id;
  for (const d of rows) await supabase.from('documents').delete().eq('id', d.id).eq('status', 'brouillon');
  return null;
}

/**
 * Transforme un OR en facture (M6). Bloqué si la garantie est en attente de décision (B10).
 * Les pièces en garantie passent à prix 0 (cession garantie) ; la facture débite le stock réel.
 * Check-up : les actions « OK » et « reportées » (décochées par le client) ne sont jamais
 * facturées ; une carte sans main-d'oeuvre devient une ligne texte.
 *
 * Rattrapage G8 (18/11/2026) : la quantité facturée de la MO = les heures facturées du
 * « Contrôle du temps atelier ». Facture UNIQUE : la facture porte `repair_order_id` ; en base
 * (migration 20261118110000) un index unique + une garde avec verrou refusent une 2e facture, et
 * la validation de la facture passe l'OR « facturé » dans la même transaction. La mise à jour
 * finale de l'OR reste (idempotente) pour le fonctionnement avant la migration.
 */
export async function transformToInvoice(orId: string): Promise<string> {
  const { data: or, error: oe } = await supabase.from('repair_orders').select('*').eq('id', orId).single();
  if (oe) throw oe;
  if (or.warranty_status === 'en_attente') throw new Error('Garantie en attente : décision requise avant facturation (B10)');
  if (or.status === 'facture') throw new Error('OR déjà facturé');
  const already = await existingOrInvoice(orId);
  if (already) {
    await supabase.from('repair_orders').update({ status: 'facture', invoice_document_id: already }).eq('id', orId);
    throw new Error('OR déjà facturé');
  }
  const { data: lines, error: le } = await supabase.from('repair_order_lines').select('*').eq('or_id', orId).order('sort_order');
  if (le) throw le;

  // Garantie (B10) : ligne couverte a 0 ; refus total ou ligne refusee en refus partiel =
  // re-routee vers le client, facturee a son prix. L'imputation (couts figes, suivi des retours
  // fournisseur) se fait en base au passage « facture » (declencheur, migration 20261118130000).
  // Temps MO (18/11, rattrapage G8) : quantite facturee de la MO = heures facturees du controle.
  type RoRow = NonNullable<typeof lines>[number] & { checkup_state?: string | null; warranty_decision?: string | null; billed_hours?: number | null };
  const lineInputs: LineInput[] = invoiceableRoLines((lines ?? []) as RoRow[]).map((l) => ({
    article_id: l.as_text ? null : l.article_id, designation: l.designation,
    quantity: l.as_text ? 0 : invoiceQuantity({ ...l, is_warranty: lineCoveredByWarranty(l, or.warranty_status) }),
    unit_price_ht: l.as_text ? 0 : clientUnitPrice({ ...l, unit_price_ht: Number(l.unit_price_ht) }, or.warranty_status), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct),
    line_type: l.as_text ? 'texte' : l.kind === 'mo' ? 'main_oeuvre' : 'article',
  }));

  const docId = await createDocument({
    companyId: or.company_id, docType: 'FAC', contactId: or.contact_id, vehicleId: or.vehicle_id,
    issueDate: new Date().toISOString().slice(0, 10), status: 'validee', notes: `OR ${or.number ?? ''}`.trim(),
    lines: lineInputs, pied: { priceMode: (or.price_mode as 'ht' | 'ttc') ?? 'ttc' },
    repairOrderId: orId,
  });

  const { error: ue } = await supabase.from('repair_orders').update({ status: 'facture', invoice_document_id: docId }).eq('id', orId);
  if (ue) throw ue;
  return docId;
}
