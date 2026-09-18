/**
 * Sous-module « Commande Excel » — spécification docs/process-commandes-pieces.md §1.6.
 * Catalogue Ducati (Demo/Courtoisie/Showroom), classeur ouvert enregistré en base,
 * numéro interne CEX au 1er téléchargement, clôture + archivage du .xlsx en GED
 * (dossier « Commandes Excel »), historique, traçabilité pièce ↔ commande ↔ client.
 * Migration : supabase/migrations/20260919220000_excel_orders_cloture.sql.
 * Types locaux (types.ts n'est pas régénéré pour ces tables).
 */
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { DEFAULT_THRESHOLDS, type ExcelTab } from './thresholds';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  storage: typeof supabase.storage;
  auth: typeof supabase.auth;
};

export const EXCEL_TABS: ExcelTab[] = ['demo', 'courtoisie', 'showroom'];
/** Dossier GED où sont rangés les classeurs archivés. */
export const EXCEL_GED_FOLDER = 'Commandes Excel';
/** Type d'entité GED des classeurs archivés. */
export const EXCEL_GED_ENTITY = 'excel_order';
/** Valeurs par défaut du classeur (surchargées par reference_values order_threshold / excel). */
const DEFAULT_DEALER = { code: '100645', name: 'Ducati Bruxelles' };

export type ExcelCatalogItem = {
  id: string;
  company_id: string;
  family: string | null;
  category: string | null;
  reference: string;
  description: string | null;
  models: string | null;
  discount_class: string | null;
  price_public_ht: number | null;
  price_dealer: number | null;
  availability: string | null;
};

export type ExcelOrderLine = {
  id: string;
  excel_order_id: string;
  tab: ExcelTab;
  reference: string;
  description: string | null;
  qty: number;
  price_dealer: number;
  extra_discount: number;
  moto_label: string | null;
  moto_vin: string | null;
  contact_id: string | null;
  sort_order: number;
  catalog_id?: string | null;
  part_order_id?: string | null;
  part_order_line_id?: string | null;
};

export type ExcelOrderStatus = 'en_cours' | 'telecharge' | 'cloture' | 'archive';

export type ExcelTabTotalsSnapshot = Partial<Record<ExcelTab, { lines: number; value: number; final: number; reached: boolean }>> & { threshold?: number };

export type ExcelOrder = {
  id: string;
  company_id: string;
  part_order_id: string | null;
  number: string | null;
  status: ExcelOrderStatus;
  dealer_code: string | null;
  dealer_name: string | null;
  downloaded_at: string | null;
  archived_at: string | null;
  archive_path: string | null;
  closed_at?: string | null;
  archive_attachment_id?: string | null;
  tab_totals?: ExcelTabTotalsSnapshot | null;
  download_count?: number;
  created_at?: string;
};

export type ExcelConfig = { minHtPerTab: number; dealerCode: string; dealerName: string };

export type ExcelTabTotal = { tab: ExcelTab; lineCount: number; totalValue: number; totalFinal: number; threshold: number; reached: boolean };

// ---------------------------------------------------------------- paramètres

/** Seuil par onglet et code concession, lus dans Paramètres → Tables (order_threshold / excel). */
export async function getExcelConfig(companyId: string): Promise<ExcelConfig> {
  const { data } = await sb.from('reference_values').select('extra')
    .eq('company_id', companyId).eq('table_key', 'order_threshold').eq('code', 'excel').maybeSingle();
  const extra = (data?.extra ?? {}) as { min_ht_per_tab?: number; dealer_code?: string; dealer_name?: string };
  return {
    minHtPerTab: Number(extra.min_ht_per_tab ?? DEFAULT_THRESHOLDS.excel.minHtPerTab),
    dealerCode: extra.dealer_code ?? DEFAULT_DEALER.code,
    dealerName: extra.dealer_name ?? DEFAULT_DEALER.name,
  };
}

// ---------------------------------------------------------------- catalogue

/** Nombre de références du catalogue Ducati (le même catalogue sert aux 3 onglets). */
export async function countExcelCatalog(companyId: string): Promise<number> {
  const { count, error } = await sb.from('excel_catalog').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if (error) throw error;
  return count ?? 0;
}

/** Recherche dans le catalogue Ducati (réf ou description). */
export async function searchExcelCatalog(companyId: string, term: string, limit = 20): Promise<ExcelCatalogItem[]> {
  const s = term.replace(/[,()%*]/g, ' ').trim();
  let q = sb.from('excel_catalog').select('*').eq('company_id', companyId).order('reference').limit(limit);
  if (s) q = q.or(`reference.ilike.%${s}%,description.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExcelCatalogItem[];
}

// ---------------------------------------------------------------- classeur ouvert

/** Classeur ouvert de la société ; un classeur vide est créé s'il n'y en a pas. */
export async function getCurrentExcelOrder(companyId: string, cfg: ExcelConfig): Promise<ExcelOrder> {
  const { data, error } = await sb.rpc('excel_order_current', { _company: companyId, _dealer_code: cfg.dealerCode, _dealer_name: cfg.dealerName });
  if (error) throw error;
  return data as ExcelOrder;
}

export async function listExcelOrderLines(excelOrderId: string): Promise<ExcelOrderLine[]> {
  const { data, error } = await sb.from('excel_order_lines').select('*').eq('excel_order_id', excelOrderId).order('sort_order').order('created_at');
  if (error) throw error;
  return ((data ?? []) as ExcelOrderLine[]).map((l) => ({ ...l, qty: Number(l.qty), price_dealer: Number(l.price_dealer), extra_discount: Number(l.extra_discount) }));
}

/** Totaux par onglet du classeur ouvert (valeur = prix dealer × qté ; seuil paramétré). */
export async function getExcelTabTotals(companyId: string): Promise<ExcelTabTotal[]> {
  const { data, error } = await sb.rpc('excel_order_tab_totals', { _company: companyId });
  if (error) throw error;
  return ((data ?? []) as { tab: ExcelTab; line_count: number; total_value: number; total_final: number; threshold: number; reached: boolean }[])
    .map((r) => ({ tab: r.tab, lineCount: r.line_count, totalValue: Number(r.total_value), totalFinal: Number(r.total_final), threshold: Number(r.threshold), reached: r.reached }));
}

export type NewExcelLine = Omit<ExcelOrderLine, 'id' | 'sort_order'> & { sort_order?: number };

export async function addExcelLines(lines: NewExcelLine[]): Promise<void> {
  if (lines.length === 0) return;
  const { error } = await sb.from('excel_order_lines').insert(lines.map((l) => ({ ...l, sort_order: l.sort_order ?? Date.now() % 1_000_000_000 })));
  if (error) throw error;
}

export async function updateExcelLine(id: string, patch: Partial<Pick<ExcelOrderLine, 'qty' | 'extra_discount' | 'moto_label' | 'moto_vin' | 'contact_id' | 'description'>>): Promise<void> {
  const { error } = await sb.from('excel_order_lines').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteExcelLine(id: string): Promise<void> {
  const { error } = await sb.from('excel_order_lines').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------- commandes clients (traçabilité)

export type ClientOrderForExcel = { id: string; number: string | null; contact_id: string | null; contact_name: string | null; created_at: string; dispatch_status: string };

/** Commandes clients de type Excel non annulées, pour charger leurs pièces dans le classeur. */
export async function listClientOrdersForExcel(companyId: string): Promise<ClientOrderForExcel[]> {
  const { data, error } = await sb.from('part_orders').select('id, number, contact_id, created_at, dispatch_status, contacts(name)')
    .eq('company_id', companyId).eq('order_kind', 'excel').neq('dispatch_status', 'annulee')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as (ClientOrderForExcel & { contacts: { name: string } | null })[])
    .map((o) => ({ id: o.id, number: o.number, contact_id: o.contact_id, contact_name: o.contacts?.name ?? null, created_at: o.created_at, dispatch_status: o.dispatch_status }));
}

/**
 * Charge les pièces d'une commande client dans un onglet du classeur ouvert.
 * Chaque ligne garde le lien vers la commande client et son client (routage à la réception).
 * Le prix dealer est repris du catalogue Ducati (référence identique), sinon 0.
 * Les lignes déjà chargées ne sont pas dupliquées. Retourne le nombre de lignes ajoutées.
 */
export async function importClientOrderIntoExcel(companyId: string, excelOrderId: string, partOrderId: string, tab: ExcelTab): Promise<number> {
  const [{ data: po, error: pe }, { data: pls, error: le }, { data: already, error: ae }] = await Promise.all([
    sb.from('part_orders').select('id, contact_id').eq('id', partOrderId).single(),
    sb.from('part_order_lines').select('id, reference, designation, qty_client, qty_shop, sort_order').eq('order_id', partOrderId).order('sort_order'),
    sb.from('excel_order_lines').select('part_order_line_id').eq('excel_order_id', excelOrderId).eq('part_order_id', partOrderId),
  ]);
  if (pe) throw pe; if (le) throw le; if (ae) throw ae;
  const done = new Set(((already ?? []) as { part_order_line_id: string | null }[]).map((r) => r.part_order_line_id));
  const todo = ((pls ?? []) as { id: string; reference: string | null; designation: string; qty_client: number; qty_shop: number; sort_order: number }[])
    .filter((l) => !done.has(l.id) && (l.reference ?? '').trim() !== '');
  if (todo.length === 0) return 0;
  const refs = [...new Set(todo.map((l) => l.reference!.trim()))];
  const { data: cat, error: ce } = await sb.from('excel_catalog').select('id, reference, description, price_dealer').eq('company_id', companyId).in('reference', refs);
  if (ce) throw ce;
  const byRef = new Map(((cat ?? []) as { id: string; reference: string; description: string | null; price_dealer: number | null }[]).map((c) => [c.reference, c]));
  const contactId = (po as { contact_id: string | null }).contact_id;
  await addExcelLines(todo.map((l, i) => {
    const c = byRef.get(l.reference!.trim());
    return {
      excel_order_id: excelOrderId, tab, reference: l.reference!.trim(), description: c?.description ?? l.designation,
      qty: Number(l.qty_client) + Number(l.qty_shop), price_dealer: Number(c?.price_dealer ?? 0), extra_discount: 0,
      moto_label: null, moto_vin: null, contact_id: contactId, catalog_id: c?.id ?? null,
      part_order_id: partOrderId, part_order_line_id: l.id, sort_order: Date.now() % 1_000_000_000 + i,
    };
  }));
  return todo.length;
}

/** Noms des clients liés aux lignes (affichage « pour qui »). */
export async function contactNames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return {};
  const { data, error } = await sb.from('contacts').select('id, name').in('id', uniq);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
}

// ---------------------------------------------------------------- numéro, téléchargement, clôture

/** Attribue le n° interne (CEX-…) au 1er téléchargement ; renvoie le même n° ensuite. */
export async function assignExcelNumber(orderId: string): Promise<string> {
  const { data, error } = await sb.rpc('excel_order_assign_number', { _order: orderId });
  if (error) throw error;
  return data as string;
}

export function excelFileName(order: Pick<ExcelOrder, 'number' | 'id'>): string {
  return `Commande_Ducati_${order.number ?? order.id.slice(0, 8)}.xlsx`;
}

/** Télécharge le classeur prérempli : attribue le numéro puis génère le fichier. */
export async function downloadCurrentExcel(order: ExcelOrder, lines: ExcelOrderLine[], minHtPerTab: number, clients: Record<string, string> = {}): Promise<string> {
  const number = await assignExcelNumber(order.id);
  const wb = buildExcelWorkbook({ ...order, number }, lines, minHtPerTab, clients);
  XLSX.writeFile(wb, excelFileName({ ...order, number }));
  return number;
}

/**
 * Clôture + archivage : n° attribué si besoin, .xlsx déposé en GED (dossier « Commandes Excel »),
 * commande passée « clôturée » puis « archivée ». Le prochain appel de getCurrentExcelOrder
 * repart d'un classeur vide.
 */
export async function closeAndArchiveExcel(companyId: string, order: ExcelOrder, lines: ExcelOrderLine[], minHtPerTab: number, clients: Record<string, string> = {}): Promise<ExcelOrder> {
  const number = await assignExcelNumber(order.id);
  const numbered = { ...order, number };
  const wb = buildExcelWorkbook(numbered, lines, minHtPerTab, clients);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const fileName = excelFileName(numbered);
  const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const path = `${companyId}/${EXCEL_GED_ENTITY}/${order.id}/${Date.now()}_${fileName}`;
  const blob = new Blob([bytes], { type: contentType });
  const { error: ue } = await sb.storage.from('ged').upload(path, blob, { upsert: false, contentType });
  if (ue) throw ue;
  const { data: { user } } = await sb.auth.getUser();
  const { data: att, error: ie } = await sb.from('attachments').insert({
    company_id: companyId, entity_type: EXCEL_GED_ENTITY, entity_id: order.id, file_name: fileName,
    storage_path: path, content_type: contentType, size_bytes: blob.size, folder: EXCEL_GED_FOLDER,
    note: `Commande Excel Ducati ${number}`, uploaded_by: user?.id ?? null,
  }).select('id').single();
  if (ie) throw ie;
  const { data, error } = await sb.rpc('excel_order_close', { _order: order.id, _attachment: (att as { id: string }).id, _archive_path: path });
  if (error) throw error;
  return data as ExcelOrder;
}

// ---------------------------------------------------------------- historique

export async function listExcelOrderHistory(companyId: string): Promise<ExcelOrder[]> {
  const { data, error } = await sb.from('excel_orders').select('*').eq('company_id', companyId)
    .in('status', ['cloture', 'archive']).order('closed_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as ExcelOrder[];
}

/** Lien de téléchargement temporaire (1 h) du classeur archivé. */
export async function archivedExcelUrl(path: string): Promise<string | null> {
  const { data, error } = await sb.storage.from('ged').createSignedUrl(path, 3600, { download: true });
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------- génération du classeur

/**
 * Construit le classeur .xlsx prérempli (3 onglets) à partir des lignes.
 * Reproduit les colonnes du template Ducati : Référence / Description / Q COMMANDE /
 * Prix dealer / Valeur / Extra-remise / Prix final + moto / VIN, et le client lié
 * (colonne interne, pour router la pièce à la réception).
 */
export function buildExcelWorkbook(order: ExcelOrder, lines: ExcelOrderLine[], minHtPerTab: number = DEFAULT_THRESHOLDS.excel.minHtPerTab, clients: Record<string, string> = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const tabLabel: Record<ExcelTab, string> = { demo: 'Demo', courtoisie: 'Courtoisie', showroom: 'Showroom' };

  for (const tab of EXCEL_TABS) {
    const tl = lines.filter((l) => l.tab === tab && l.qty > 0);
    const header = [
      ['Code concession', order.dealer_code ?? '', '', 'N° commande', order.number ?? ''],
      ['Nom concession', order.dealer_name ?? '', '', 'Montant de commande remisé minimum', `${minHtPerTab} euros`],
      [],
      ['REFERENCE', 'DESCRIPTION FR', 'Q COMMANDE', 'Dealer PRICE', 'Valeur commande', 'Extra-Discount', 'Prix concessionnaire final', 'Moto', 'VIN', 'Client (interne)'],
    ];
    const rows: (string | number)[][] = tl.map((l) => {
      const value = l.price_dealer * l.qty;
      const final = value - value * l.extra_discount;
      return [l.reference, l.description ?? '', l.qty, l.price_dealer, round2(value), l.extra_discount, round2(final), l.moto_label ?? '', l.moto_vin ?? '', l.contact_id ? clients[l.contact_id] ?? '' : ''];
    });
    const totalValue = tl.reduce((s, l) => s + l.price_dealer * l.qty, 0);
    const totalFinal = tl.reduce((s, l) => s + l.price_dealer * l.qty * (1 - l.extra_discount), 0);
    rows.push([]);
    rows.push(['', 'Montant total', '', '', round2(totalValue), '', round2(totalFinal)]);
    if (totalValue < minHtPerTab) rows.push(['', `Reste à commander pour extra-discount : ${round2(minHtPerTab - totalValue)} €`]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, tabLabel[tab]);
  }
  return wb;
}

/** Déclenche le téléchargement du classeur .xlsx dans le navigateur (sans numéro). */
export function downloadExcelWorkbook(order: ExcelOrder, lines: ExcelOrderLine[]): void {
  XLSX.writeFile(buildExcelWorkbook(order, lines), excelFileName(order));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
