/**
 * Commande DEMO / COURTOISIE / SHOWROOM — acces base (mission 09, carte 6).
 *
 * Le panier demo est le classeur ouvert `excel_orders` (kind = 'demo', mission 02 carte 7),
 * complete par la migration 20261103120000_m4_commande_demo.sql :
 *   - onglet choisi et motos de demo (modele, n° de commande, n° de serie) ;
 *   - classeur Ducati VIERGE depose une fois par an en GED privee (Parametres), rempli ici
 *     (demo-workbook.ts) et conserve avec la commande ;
 *   - envoi par mail a cas.dwe@ducati.com (reglable) depuis la boite Outlook de l'utilisateur
 *     (`graph-send-email`), statut « commandee », numero DCS saisi a la main apres.
 * Accessoires uniquement : le trigger `excel_order_lines_accessory_guard` refuse le reste ;
 * `classifyReferences` donne le meme verdict avant l'ajout, avec la raison (piece / vetement).
 * Types locaux : types.ts n'est pas regenere pour ces colonnes.
 */
import { supabase } from '@/integrations/supabase/client';
import { uploadAttachment, signedUrl } from '@/modules/documents/ged-api';
import type { ExcelTab } from './thresholds';
import { EXCEL_GED_ENTITY, EXCEL_GED_FOLDER, type ExcelOrder, type ExcelOrderLine } from './excel-api';
import {
  DEFAULT_DEMO_MAIL_TO, classifyReference, normalizeRef, type DemoMotos, type ReferenceKind,
} from './demo-rules';
import { buildFilledWorkbook, type FillReport } from './demo-workbook';

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  storage: typeof supabase.storage;
};

/** Entite GED du classeur vierge de l'annee (entity_id = societe). */
export const DEMO_TEMPLATE_ENTITY = 'excel_template';
export const DEMO_TEMPLATE_FOLDER = 'Classeur Ducati';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type DemoOrderStatus = ExcelOrder['status'] | 'commandee';

export type DemoOrder = Omit<ExcelOrder, 'status'> & {
  status: DemoOrderStatus;
  kind?: string;
  tab?: ExcelTab;
  demo_motos?: DemoMotos | null;
  ordered_at?: string | null;
  ordered_by?: string | null;
  dcs_number?: string | null;
  mail_to?: string | null;
  mail_from?: string | null;
  mail_subject?: string | null;
  mail_sent_at?: string | null;
  workbook_attachment_id?: string | null;
  workbook_path?: string | null;
};

// ---------------------------------------------------------------- reglages

/** Adresse Ducati du classeur demo (Parametres → Tables → Regles des types de commande, ligne excel). */
export async function getDemoMailTo(companyId: string): Promise<string> {
  const { data } = await sb.from('reference_values').select('extra')
    .eq('company_id', companyId).eq('table_key', 'order_threshold').eq('code', 'excel').maybeSingle();
  const v = String((data?.extra as { mail_to?: string } | null)?.mail_to ?? '').trim();
  return v || DEFAULT_DEMO_MAIL_TO;
}

// ---------------------------------------------------------------- classeur vierge (GED privee)

export type DemoTemplate = { id: string; file_name: string; storage_path: string; size_bytes: number | null; created_at: string; uploaded_by: string | null; note: string | null };

/** Dernier classeur vierge depose pour la societe (null = pas encore depose). */
export async function getDemoTemplate(companyId: string): Promise<DemoTemplate | null> {
  const { data, error } = await sb.from('attachments').select('id, file_name, storage_path, size_bytes, created_at, uploaded_by, note')
    .eq('company_id', companyId).eq('entity_type', DEMO_TEMPLATE_ENTITY).eq('entity_id', companyId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as DemoTemplate | null) ?? null;
}

/** Depose le classeur vierge de l'annee (Parametres, administrateur). */
export async function uploadDemoTemplate(companyId: string, file: File, note: string): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('xlsx_only');
  return uploadAttachment(companyId, DEMO_TEMPLATE_ENTITY, companyId, file, Date.now(), note, DEMO_TEMPLATE_FOLDER);
}

/** Octets du classeur vierge. */
export async function downloadTemplateBytes(path: string): Promise<ArrayBuffer> {
  const { data, error } = await sb.storage.from('ged').download(path);
  if (error) throw error;
  return await (data as Blob).arrayBuffer();
}

// ---------------------------------------------------------------- panier : onglet, motos, numero DCS

export async function setDemoTab(orderId: string, tab: ExcelTab): Promise<void> {
  const { error } = await sb.from('excel_orders').update({ tab }).eq('id', orderId);
  if (error) throw error;
}

export async function setDemoMotos(orderId: string, motos: DemoMotos): Promise<void> {
  const { error } = await sb.from('excel_orders').update({ demo_motos: motos }).eq('id', orderId);
  if (error) throw error;
}

export async function setDcsNumber(orderId: string, number: string | null): Promise<DemoOrder> {
  const { data, error } = await sb.rpc('excel_order_set_dcs_number', { _order: orderId, _number: number });
  if (error) throw new Error(error.message);
  return data as DemoOrder;
}

// ---------------------------------------------------------------- accessoires uniquement

export type ReferenceVerdict = { reference: string; kind: ReferenceKind; catalogId: string | null; description: string | null; priceDealer: number };

/**
 * Verdict par reference : accessoire du classeur (acceptee, avec son prix dealer), vetement
 * (catalogue Ducati « apparel »), piece (article A / N du DMS) ou inconnue.
 */
export async function classifyReferences(companyId: string, references: string[]): Promise<ReferenceVerdict[]> {
  const refs = [...new Set(references.map((r) => r.trim()).filter(Boolean))];
  if (refs.length === 0) return [];
  const norm = refs.map(normalizeRef);
  const [cat, art, app] = await Promise.all([
    sb.from('excel_catalog').select('id, reference, description, price_dealer').eq('company_id', companyId).in('reference', refs),
    sb.from('articles').select('reference, mgmt_type').eq('company_id', companyId).in('reference', refs),
    sb.from('ducati_catalog_product_variants').select('sku_norm, ducati_catalog_products!inner(kind)').in('sku_norm', norm.map((n) => n.replace(/[^A-Z0-9]/g, ''))),
  ]);
  if (cat.error) throw cat.error;
  const byRef = new Map<string, { id: string; description: string | null; price_dealer: number | null }>();
  for (const c of (cat.data ?? []) as { id: string; reference: string; description: string | null; price_dealer: number | null }[]) byRef.set(normalizeRef(c.reference), c);
  const partRefs = new Set(((art.data ?? []) as { reference: string; mgmt_type: string }[]).filter((a) => ['A', 'N'].includes(String(a.mgmt_type))).map((a) => normalizeRef(a.reference)));
  const apparelRefs = new Set(((app.data ?? []) as { sku_norm: string; ducati_catalog_products: { kind: string } | null }[])
    .filter((v) => v.ducati_catalog_products?.kind === 'apparel').map((v) => v.sku_norm));
  const src = { accessoryRefs: new Set(byRef.keys()), partRefs, apparelRefs: new Set([...apparelRefs].map((s) => s)) };
  return refs.map((reference) => {
    const n = normalizeRef(reference);
    const kind = classifyReference(reference, { ...src, apparelRefs: new Set(apparelRefs.has(n.replace(/[^A-Z0-9]/g, '')) ? [n] : []) });
    const c = byRef.get(n);
    return { reference, kind, catalogId: c?.id ?? null, description: c?.description ?? null, priceDealer: Number(c?.price_dealer ?? 0) };
  });
}

// ---------------------------------------------------------------- classeur rempli, commande passee

export type BuiltWorkbook = { bytes: Uint8Array; report: FillReport; fileName: string };

/** Remplit le classeur vierge avec les lignes du panier (D2, blocs motos, Q COMMANDE). */
export async function buildDemoWorkbook(template: DemoTemplate, order: DemoOrder, lines: ExcelOrderLine[], dealerCode: string, fileName: string): Promise<BuiltWorkbook> {
  const bytes = await downloadTemplateBytes(template.storage_path);
  const built = buildFilledWorkbook(bytes, {
    dealerCode,
    lines: lines.filter((l) => l.qty > 0).map((l) => ({ tab: l.tab, reference: l.reference, qty: l.qty })),
    motos: order.demo_motos ?? null,
  });
  return { ...built, fileName };
}

/** Telechargement navigateur d'un classeur deja construit. */
export function saveWorkbookToDisk(built: BuiltWorkbook): void {
  const blob = new Blob([built.bytes as BlobPart], { type: XLSX_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = built.fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Depose le classeur rempli en GED (dossier « Commandes Excel »), relie a la commande. */
export async function keepWorkbookWithOrder(companyId: string, order: DemoOrder, built: BuiltWorkbook, note: string): Promise<{ attachmentId: string; path: string }> {
  const path = `${companyId}/${EXCEL_GED_ENTITY}/${order.id}/${Date.now()}_${built.fileName}`;
  const blob = new Blob([built.bytes as BlobPart], { type: XLSX_TYPE });
  const { error: ue } = await sb.storage.from('ged').upload(path, blob, { upsert: false, contentType: XLSX_TYPE });
  if (ue) throw ue;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: att, error: ie } = await sb.from('attachments').insert({
    company_id: companyId, entity_type: EXCEL_GED_ENTITY, entity_id: order.id, file_name: built.fileName,
    storage_path: path, content_type: XLSX_TYPE, size_bytes: blob.size, folder: EXCEL_GED_FOLDER,
    note, uploaded_by: user?.id ?? null,
  }).select('id').single();
  if (ie) throw ie;
  return { attachmentId: (att as { id: string }).id, path };
}

/** Statut « commandee » (controles serveur : minimum par onglet, accessoires, classeur conserve). */
export async function markDemoOrdered(p: { orderId: string; attachmentId: string; path: string; mailTo: string; mailFrom: string | null; mailSubject: string }): Promise<DemoOrder> {
  const { data, error } = await sb.rpc('excel_order_mark_ordered', {
    _order: p.orderId, _attachment: p.attachmentId, _workbook_path: p.path,
    _mail_to: p.mailTo, _mail_from: p.mailFrom, _mail_subject: p.mailSubject,
  });
  if (error) throw new Error(error.message);
  return data as DemoOrder;
}

/** Commandes passees (commandee) et anciens classeurs clotures / archives. */
export async function listDemoHistory(companyId: string): Promise<DemoOrder[]> {
  const { data, error } = await sb.from('excel_orders').select('*').eq('company_id', companyId)
    .in('status', ['commandee', 'cloture', 'archive']).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as DemoOrder[];
}

/** Lien temporaire vers le classeur conserve (envoye ou archive). */
export async function keptWorkbookUrl(path: string): Promise<string | null> {
  return signedUrl(path);
}
