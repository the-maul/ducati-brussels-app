/**
 * M6 — Écriture des documents de vente : création, totaux, numérotation, décrément stock, règlement.
 * Le POS complet (encaissement multi-modes, clôture Z, avoirs) viendra étoffer ce socle.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { t } from '@/lib/i18n';
import {
  detectVatScheme, vatSchemeError, marginPurchasePrice, MARGIN_SALE_DOC_TYPES,
  type VatScheme, type ArticleVatInfo,
} from './vat-scheme';
import { applyCashRounding, CASH_ROUNDING_METHOD } from './cash-rounding';
import { reversalLine } from './cash-rules';
import { INVOICE_FAMILY_TABLE_KEY, type InvoiceFamilyRule } from './pos-rules';

export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type DocumentLine = Database['public']['Tables']['document_lines']['Row'];

/**
 * Colonnes du regime de la marge (migration 20261103160000, absentes de types.ts tant qu elle
 * n est pas posee) : `vat_scheme` 'normal' | 'marge', `margin_purchase_price` = prix de reprise
 * fige a la vente (base du registre, M12). Lues de facon tolerante.
 */
export type DocumentMargeExtra = { vat_scheme?: string | null; margin_purchase_price?: number | null };
export const docVatScheme = (doc: object | null | undefined): VatScheme =>
  ((doc as DocumentMargeExtra | null | undefined)?.vat_scheme === 'marge' ? 'marge' : 'normal');
export const isMargeDocument = (doc: object | null | undefined): boolean => docVatScheme(doc) === 'marge';

/**
 * Type de ligne (mission 05, carte 5) :
 *  - article     : article ou texte libre avec montant (défaut, toutes les lignes historiques) ;
 *  - main_oeuvre : article de type T, quantité = heures décimales, jamais de mouvement de stock ;
 *  - texte       : commentaire (multi-lignes), aucun montant ;
 *  - vide        : ligne blanche de séparation, aucun montant.
 */
export type LineType = 'article' | 'main_oeuvre' | 'texte' | 'vide';
export const LINE_TYPES: readonly LineType[] = ['article', 'main_oeuvre', 'texte', 'vide'];

export type LineInput = {
  article_id?: string | null;
  designation: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  discount_pct: number;
  line_type?: LineType;
  reference?: string | null;
};

/** Une ligne texte ou vide ne porte jamais de montant (contrôlé aussi en base). */
export function lineHasAmount(l: Pick<LineInput, 'line_type'>): boolean {
  return l.line_type !== 'texte' && l.line_type !== 'vide';
}

/** Seules les lignes « article » rattachées à un article bougent le stock (pas la main-d'œuvre). */
export function lineMovesStock(l: { line_type?: string | null; article_id?: string | null; quantity: number | string }): boolean {
  return (l.line_type ?? 'article') === 'article' && !!l.article_id && Number(l.quantity) > 0;
}

/** Seul document vendu sans client identifié : le ticket de caisse du comptoir. */
export const NO_CLIENT_DOC_TYPES = ['TIK'] as const;

export type DocumentValidationError = 'needLine' | 'needClient' | 'needAmount';

/**
 * Contrôles avant écriture d'un document (audit du parcours de vente, 31/10/2026, VEN001) :
 *  - au moins une ligne qui n'est pas une ligne vide (brouillon comme validation) ;
 *  - à la validation, un client, sauf pour un ticket de caisse ;
 *  - à la validation, au moins une ligne qui porte un montant (`requireAmount`, demandé par
 *    l'écran de vente : un devis « TEST » à 0 € ne se valide plus ; pas exigé par la facture
 *    d'un OR en garantie, légitimement à 0 €).
 * Retourne la clé du message (`sales.<clé>`) ou null si tout va bien.
 */
export function documentValidationError(p: {
  docType: string; status: 'brouillon' | 'validee'; contactId?: string | null; lines: LineInput[]; requireAmount?: boolean;
  /** Type du document d'origine : l'avoir d'un ticket anonyme reste sans client (PDV010, remboursement au comptoir). */
  sourceDocType?: string | null;
}): DocumentValidationError | null {
  const kept = p.lines.filter((l) => l.line_type === 'vide' || l.designation.trim());
  if (!kept.some((l) => l.line_type !== 'vide')) return 'needLine';
  if (p.status !== 'validee') return null;
  const anonymousCreditNote = p.docType === 'AVO' && (NO_CLIENT_DOC_TYPES as readonly string[]).includes(p.sourceDocType ?? '');
  if (!p.contactId && !anonymousCreditNote && !(NO_CLIENT_DOC_TYPES as readonly string[]).includes(p.docType)) return 'needClient';
  if (p.requireAmount && !kept.some((l) => lineHasAmount(l) && Math.abs(lineHtRaw(l)) > 0.004)) return 'needAmount';
  return null;
}

/** Message lisible d'un refus de validation, dans la langue de l'utilisateur. */
export const documentValidationMessage = (e: DocumentValidationError): string => t(`sales.${e}`);

/**
 * Un brouillon se rouvre, se modifie, se valide ou se supprime ; un document validé est figé
 * (B7 : il s'annule par un avoir, il ne se modifie pas). Mission 08, carte 1 (03/11/2026).
 */
export const isDraftDocument = (doc: Pick<DocumentRow, 'status'>): boolean => doc.status === 'brouillon';
export const canEditDocument = isDraftDocument;
export const canDeleteDocument = isDraftDocument;

/** Ligne enregistrée → ligne à recopier (conversion, duplication, avoir). */
export function rowToLineInput(l: DocumentLine, sign: 1 | -1 = 1): LineInput {
  const lt = (LINE_TYPES as readonly string[]).includes(l.line_type) ? (l.line_type as LineType) : 'article';
  const q = Number(l.quantity);
  return {
    article_id: l.article_id, designation: l.designation, reference: l.reference ?? null, line_type: lt,
    quantity: lineHasAmount({ line_type: lt }) ? (sign === -1 ? -Math.abs(q) : q) : 0,
    unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: Number(l.discount_pct),
  };
}

// Stock par type de document (triple stock B4, G8 p.74/p.81) :
//  - FAC/TIK débitent le stock RÉEL ;
//  - RES (réservation/commande) et BL débitent le DISPONIBLE (réservé), le réel ne bouge
//    qu'à la facturation ;
//  - DEV (devis / proforma) et BC (bon de commande, commande ferme signée) : aucun
//    mouvement de stock — la réservation se fait en convertissant en RES ou BL.
export const REAL_OUT_DOC_TYPES = ['FAC', 'TIK'] as const;
export const RESERVE_DOC_TYPES = ['RES', 'BL'] as const;
export const SALE_DOC_TYPES = [...REAL_OUT_DOC_TYPES, ...RESERVE_DOC_TYPES] as const; // tout document qui touche le stock
/** Documents sur lesquels on verse un acompte (reporté à la conversion, G8 p.96). */
export const DEPOSIT_DOC_TYPES = ['RES', 'BC'] as const;

/** Paramètres du pied de facture (remise globale, mode HT/TTC, détaxe, port, net forcé). */
export type PiedInput = {
  priceMode?: 'ht' | 'ttc';
  taxExempt?: boolean;                 // détaxe : inhibe la TVA (export 0 %)
  vatScheme?: VatScheme;               // régime de la marge (moto O) : aucune TVA sur le document (B2)
  globalDiscountPct?: number;          // remise globale en %
  globalDiscountAmount?: number;       // OU remise globale en montant HT
  shippingHt?: number;                 // frais de port HT
  shippingTaxed?: boolean;             // port taxé (défaut) ou non
  shippingVatRate?: number;            // taux TVA du port
  forcedTtc?: number | null;           // net TTC forcé (arrondi facture)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function lineHtRaw(l: LineInput) {
  if (!lineHasAmount(l)) return 0;
  return l.quantity * l.unit_price_ht * (1 - (l.discount_pct || 0) / 100);
}
/** Aucune TVA sur le document : détaxe export (art. 39) ou régime de la marge (art. 58 §4, B2). */
export const piedWithoutVat = (pied: Pick<PiedInput, 'taxExempt' | 'vatScheme'>): boolean =>
  !!pied.taxExempt || pied.vatScheme === 'marge';

function lineTotals(l: LineInput, noVat = false) {
  const ht = lineHtRaw(l);
  const ttc = ht * (1 + (noVat ? 0 : l.vat_rate || 0) / 100);
  return { ht: r2(ht), ttc: r2(ttc) };
}

/**
 * Totaux d'un document, pied compris. La remise globale s'applique sur le HT des
 * lignes (pas sur le port, G8 p.66) et réduit la TVA au prorata ; la détaxe force la
 * TVA à 0 ; le net TTC forcé écrase le TTC et recalcule la TVA (arrondi de facture).
 * Régime de la marge (M-89) : aucune TVA, le « HT » est le prix convenu lui-même
 * (TTC = HT) ; un net forcé remplace le prix, jamais la TVA.
 */
export function computeTotals(lines: LineInput[], pied: PiedInput = {}) {
  const noVat = piedWithoutVat(pied);
  let linesHt = 0, linesVat = 0;
  for (const l of lines) {
    const ht = lineHtRaw(l);
    linesHt += ht;
    linesVat += noVat ? 0 : (ht * (l.vat_rate || 0)) / 100;
  }
  // remise globale (sur le HT des lignes uniquement). Un avoir a des lignes négatives : la remise
  // en € suit le signe du document et la TVA est répartie dès que le HT n'est pas nul (avant le
  // 31/10/2026, un avoir sortait avec une TVA à 0 et, avec une remise en €, un HT à 0).
  let discount = 0;
  if (pied.globalDiscountPct && pied.globalDiscountPct > 0) discount = (linesHt * pied.globalDiscountPct) / 100;
  else if (pied.globalDiscountAmount && pied.globalDiscountAmount > 0) discount = Math.sign(linesHt) * Math.min(pied.globalDiscountAmount, Math.abs(linesHt));
  const netLinesHt = linesHt - discount;
  const netLinesVat = linesHt !== 0 ? linesVat * (netLinesHt / linesHt) : 0;
  // frais de port
  const shipHt = pied.shippingHt || 0;
  const shipVat = !noVat && pied.shippingTaxed !== false && shipHt > 0
    ? (shipHt * (pied.shippingVatRate ?? 21)) / 100 : 0;

  let total_ht = r2(netLinesHt + shipHt);
  let total_vat = r2(netLinesVat + shipVat);
  let total_ttc = r2(total_ht + total_vat);
  // net TTC forcé → la TVA absorbe l'écart (régime de la marge : c'est le prix qui bouge, TVA 0)
  if (pied.forcedTtc != null && pied.forcedTtc > 0) {
    total_ttc = r2(pied.forcedTtc);
    if (pied.vatScheme === 'marge') { total_ht = total_ttc; total_vat = 0; }
    else total_vat = r2(total_ttc - total_ht);
  }
  return {
    total_ht, total_vat, total_ttc,
    lines_ht: r2(linesHt), global_discount: r2(discount),
    shipping_vat: r2(shipVat),
  };
}

async function nextNumber(companyId: string, docType: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('next_document_number', { _company: companyId, _doc_type: docType });
  if (error) throw error;
  return (data as string) ?? null;
}

/**
 * Colonnes d'en-tête communes à la création et à la modification d'un brouillon.
 * Les colonnes du régime de la marge (`vat_scheme`, `margin_purchase_price`) ne sont envoyées
 * que pour un document en marge : un document ordinaire ne les touche pas, il reste écrit tel
 * quel tant que la migration 20261103160000 n'est pas posée ; un document en marge est alors
 * réécrit sans ces colonnes (`isMissingMargeColumn`), ses lignes restant à 0 % de TVA.
 */
function headerColumns(p: {
  docType: string; contactId?: string | null; vehicleId?: string | null; issueDate: string; dueDate?: string | null;
  notes?: string | null; lines: LineInput[]; pied: PiedInput; marginPurchasePrice?: number | null;
}) {
  const { total_ht, total_vat, total_ttc } = computeTotals(p.lines, p.pied);
  const marge = p.pied.vatScheme === 'marge';
  const base = {
    doc_type: p.docType, contact_id: p.contactId ?? null, vehicle_id: p.vehicleId ?? null,
    issue_date: p.issueDate, due_date: p.dueDate ?? null, notes: p.notes ?? null, total_ht, total_vat, total_ttc,
    price_mode: p.pied.priceMode ?? 'ttc', tax_exempt: !!p.pied.taxExempt,
    global_discount_pct: p.pied.globalDiscountPct ?? 0, global_discount_amount: p.pied.globalDiscountAmount ?? 0,
    shipping_ht: p.pied.shippingHt ?? 0, shipping_taxed: p.pied.shippingTaxed !== false,
    shipping_vat_rate: p.pied.shippingVatRate ?? 21, forced_ttc: p.pied.forcedTtc ?? null,
  };
  // Colonnes absentes de types.ts tant que la migration n'est pas posée : ajoutées hors typage.
  return marge ? Object.assign(base, margeColumns('marge', p.marginPurchasePrice ?? null)) : base;
}

/** Colonnes du régime de la marge, hors typage `types.ts` (migration 20261103160000). */
function margeColumns(scheme: VatScheme, marginPurchasePrice: number | null): object {
  return { vat_scheme: scheme, margin_purchase_price: marginPurchasePrice };
}
/** Colonne du régime absente en base (migration non posée) : PostgREST répond PGRST204 / 42703. */
export const isMissingMargeColumn = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === 'PGRST204' || e.code === '42703') && /vat_scheme|margin_purchase_price/.test(e.message ?? '');
function stripMargeColumns<T extends object>(header: T): T {
  const { vat_scheme: _s, margin_purchase_price: _m, ...rest } = header as T & DocumentMargeExtra;
  return rest as T;
}

/**
 * Lignes à insérer dans `document_lines` (une ligne texte ou vide ne porte aucun montant).
 * Régime de la marge : le taux de la ligne est écrit à 0 (aucune TVA, TTC = prix), quoi que
 * l'écran ait affiché.
 */
function lineRows(docId: string, lines: LineInput[], pied: PiedInput) {
  const noVat = piedWithoutVat(pied);
  return lines.map((l, i) => {
    const tot = lineTotals(l, noVat);
    const amount = lineHasAmount(l);
    return {
      document_id: docId, article_id: amount ? l.article_id ?? null : null, designation: l.designation,
      reference: l.reference ?? null, line_type: l.line_type ?? 'article',
      quantity: amount ? l.quantity : 0, unit_price_ht: amount ? l.unit_price_ht : 0,
      vat_rate: pied.vatScheme === 'marge' ? 0 : l.vat_rate,
      discount_pct: amount ? l.discount_pct || 0 : 0, line_ht: tot.ht, line_ttc: tot.ttc, sort_order: i,
    };
  });
}

/** Type de gestion et prix de reprise des articles référencés par les lignes (un seul aller-retour). */
async function loadArticleVatInfo(lines: LineInput[]): Promise<Map<string, ArticleVatInfo>> {
  const ids = [...new Set(lines.map((l) => l.article_id).filter(Boolean) as string[])];
  const map = new Map<string, ArticleVatInfo>();
  if (!ids.length) return map;
  const { data, error } = await supabase.from('articles').select('id, mgmt_type, purchase_price').in('id', ids);
  if (error) throw error;
  for (const a of data ?? []) map.set(a.id, { mgmt_type: a.mgmt_type ?? null, purchase_price: a.purchase_price == null ? null : Number(a.purchase_price) });
  return map;
}

/**
 * Régime de TVA d'un document d'après ses lignes (B2, M-89) : une moto d'occasion de
 * particulier (article O) fait passer le document en régime de la marge, sans TVA. Refus clair
 * si le document mélange d'autres lignes, porte du port, ou si une facture / un ticket part
 * sans prix de reprise connu. Retourne le pied complété et le prix d'achat à figer.
 */
export async function resolveVatScheme(p: {
  lines: LineInput[]; pied: PiedInput; docType: string; status: 'brouillon' | 'validee'; knownPurchasePrice?: number | null;
  /** Régime imposé par le document d'origine (avoir) : un avoir suit sa facture, jamais l'inverse. */
  forcedScheme?: VatScheme | null;
}): Promise<{ pied: PiedInput; marginPurchasePrice: number | null }> {
  if (p.forcedScheme === 'normal') return { pied: { ...p.pied, vatScheme: 'normal' }, marginPurchasePrice: null };
  const articles = await loadArticleVatInfo(p.lines);
  const scheme = p.forcedScheme ?? detectVatScheme(p.lines, articles);
  if (scheme !== 'marge') return { pied: { ...p.pied, vatScheme: 'normal' }, marginPurchasePrice: null };
  const requirePurchasePrice = p.status === 'validee' && MARGIN_SALE_DOC_TYPES.includes(p.docType);
  const refused = vatSchemeError({ lines: p.lines, pied: p.pied, articles, requirePurchasePrice, knownPurchasePrice: p.knownPurchasePrice });
  if (refused) throw new Error(t(`sales.${refused}`));
  const known = p.knownPurchasePrice != null && p.knownPurchasePrice > 0 ? p.knownPurchasePrice : null;
  // Détaxe et marge ne se cumulent pas : la marge l'emporte (aucune TVA de toute façon).
  return { pied: { ...p.pied, vatScheme: 'marge', taxExempt: false }, marginPurchasePrice: known ?? marginPurchasePrice(p.lines, articles) };
}

/**
 * Mouvements de stock à la validation (B4 triple stock, B7 traçabilité append-only) :
 * FAC / TIK débitent le réel, RES / BL réservent, les autres types ne touchent à rien.
 * Un échec ici laisse le document validé avec un stock partiel : connu, voir M06 §7.
 */
async function recordSaleStockMoves(docType: string, lines: LineInput[], number: string | null): Promise<void> {
  const realOut = (REAL_OUT_DOC_TYPES as readonly string[]).includes(docType);
  const reserve = (RESERVE_DOC_TYPES as readonly string[]).includes(docType);
  if (!realOut && !reserve) return;
  for (const l of lines) {
    if (!lineMovesStock(l) || !l.article_id) continue;
    const qty = Math.abs(l.quantity);
    const args = realOut
      ? { _type: 'sortie' as const, _qty: -qty, _is_reservation: false }      // débite le réel
      : { _type: 'reservation' as const, _qty: qty, _is_reservation: true };  // débite le disponible (réservé)
    const { error: se } = await supabase.rpc('record_stock_move', {
      // undefined : ces parametres sont DEFAULT NULL cote SQL, les omettre equivaut a NULL.
      _article: l.article_id, _unit_cost: undefined, _bin: undefined, _origin: 'sale',
      _ref: number ?? undefined, _note: undefined, ...args,
    });
    if (se) throw se;
  }
}

export async function createDocument(p: {
  companyId: string; docType: string; contactId?: string | null; vehicleId?: string | null;
  issueDate: string; dueDate?: string | null; status: 'brouillon' | 'validee'; notes?: string | null;
  lines: LineInput[]; pied?: PiedInput; sourceDocumentId?: string | null;
  /** Prix de reprise déjà figé sur le document d'origine (avoir d'une vente en marge). */
  marginPurchasePrice?: number | null;
  /** Régime imposé par le document d'origine (avoir), sinon déduit des articles. */
  vatSchemeOverride?: VatScheme | null;
  /** Session de caisse (PDV010) : un ticket s'y rattache d'office en base ; une facture ou un avoir du comptoir sur demande. */
  cashSessionId?: string | null;
  /** Type du document d'origine (avoir d'un ticket sans client). */
  sourceDocType?: string | null;
}): Promise<string> {
  const validated = p.status === 'validee';

  // Refus clair plutôt qu'un document validé sans client ou sans ligne (audit du 31/10/2026).
  if (validated) {
    const refused = documentValidationError({ docType: p.docType, status: 'validee', contactId: p.contactId, lines: p.lines, sourceDocType: p.sourceDocType });
    if (refused) throw new Error(documentValidationMessage(refused));
  }
  // Régime de TVA d'après les articles (moto O → marge, sans TVA ; refus des mélanges, B2).
  const { pied, marginPurchasePrice: mpp } = await resolveVatScheme({
    lines: p.lines, pied: p.pied ?? {}, docType: p.docType, status: p.status, knownPurchasePrice: p.marginPurchasePrice,
    forcedScheme: p.vatSchemeOverride ?? null,
  });
  // Un ticket ne se valide pas caisse fermée (PDV010) : la base le refuse aussi, mais après le
  // numéro ; on vérifie avant pour ne pas consommer un numéro de ticket pour rien.
  if (validated && p.docType === 'TIK') {
    const { getOpenSession } = await import('./cash-api');
    const open = await getOpenSession(p.companyId);
    if (!open) throw new Error(t('pos.noSessionBody'));
    if (p.cashSessionId && p.cashSessionId !== open.id) throw new Error(t('pos.sessionMismatch'));
  }

  // Ordre d'écriture (pas de transaction côté navigateur) : en-tête en brouillon SANS numéro,
  // puis les lignes, puis seulement le numéro et le statut « validée », puis le stock. Si les
  // lignes sont refusées (ex. moto sans VIN, trigger en base), l'en-tête orphelin est retiré et
  // aucun numéro n'a été consommé : plus de document validé vide avec un numéro (constat du 30/10).
  const header = {
    company_id: p.companyId, number: null, status: 'brouillon', source_document_id: p.sourceDocumentId ?? null,
    // Colonne posée par la migration 20261103170000 : envoyée seulement quand elle sert (un ticket
    // est rattaché en base par le trigger), pour que la vente marche aussi avant la migration.
    ...(p.cashSessionId ? { cash_session_id: p.cashSessionId } : {}),
    ...headerColumns({ ...p, pied, marginPurchasePrice: mpp }),
  };
  let { data: doc, error } = await supabase.from('documents').insert(header).select('id').single();
  // Migration 20261103160000 pas encore posée : en-tête sans les colonnes du régime (les lignes
  // partent quand même à 0 % et le PDF retrouve la marge par l'article O).
  if (isMissingMargeColumn(error)) ({ data: doc, error } = await supabase.from('documents').insert(stripMargeColumns(header)).select('id').single());
  if (error || !doc) throw error;
  const docId = doc.id as string;
  // En-tête posé mais suite refusée : on retire le brouillon orphelin avant de remonter l'erreur.
  const discard = async (e: unknown): Promise<never> => {
    await supabase.from('documents').delete().eq('id', docId);
    throw e;
  };

  if (p.lines.length) {
    const { error: le } = await supabase.from('document_lines').insert(lineRows(docId, p.lines, pied));
    if (le) return discard(le);
  }

  if (!validated) return docId;

  // Facture obligatoire (PDV010, AR n° 1 art. 1er § 2) : vérifiée en base sur le brouillon AVANT de
  // prendre un numéro de ticket (le trigger de validation refuserait de toute façon).
  if (p.docType === 'TIK') {
    const { data: why, error: we } = await supabase.rpc('document_invoice_required', { _document: docId });
    // Fonction absente (migration 20261103170000 pas encore posée) : la vente continue comme avant.
    if (we && !isMissingDbObject(we)) return discard(we);
    if (!we && why) return discard(new Error(invoiceRequiredMessage(why as 'vehicle' | 'threshold')));
  }

  // Numéro attribué à la validation seulement (par société et par type, séquences M0).
  let number: string | null = null;
  try { number = await nextNumber(p.companyId, p.docType); } catch (e) { return discard(e); }
  const { error: ve } = await supabase.from('documents').update({ status: 'validee', number }).eq('id', docId);
  if (ve) return discard(ve);

  await recordSaleStockMoves(p.docType, p.lines, number);
  return docId;
}

/**
 * Objet de base absent (colonne, fonction RPC) : migration pas encore appliquée. PGRST204 / 42703
 * colonne, PGRST202 / 42883 fonction, PGRST205 / 42P01 table.
 */
export function isMissingDbObject(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'PGRST204' || code === '42703' || code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01';
}

/** Message au vendeur quand la loi impose une facture à la place du ticket (PDV010). */
export const invoiceRequiredMessage = (why: 'vehicle' | 'threshold'): string => t(why === 'vehicle' ? 'pos.invoiceVehicle' : 'pos.invoiceThreshold');

/**
 * Rouvre un brouillon (mission 08, carte 1, 03/11/2026) : en-tête, lignes, pied, client, moto et
 * type sont réécrits ; le document reste en brouillon ou est validé (numéro pris une seule fois,
 * mêmes contrôles qu'à la création). Refusé si le document n'est plus un brouillon.
 * Ordre d'écriture : en-tête → nouvelles lignes insérées → anciennes lignes retirées → numéro +
 * statut → stock. Si les nouvelles lignes sont refusées, les anciennes restent en place.
 */
export async function updateDraftDocument(p: {
  documentId: string; companyId: string; docType: string; contactId?: string | null; vehicleId?: string | null;
  issueDate: string; dueDate?: string | null; status: 'brouillon' | 'validee'; notes?: string | null;
  lines: LineInput[]; pied?: PiedInput;
}): Promise<string> {
  const validated = p.status === 'validee';
  const { doc, lines: oldLines } = await getDocumentFull(p.documentId);
  if (!isDraftDocument(doc)) throw new Error(t('sales.notDraft'));
  if (validated) {
    const refused = documentValidationError({ docType: p.docType, status: 'validee', contactId: p.contactId, lines: p.lines });
    if (refused) throw new Error(documentValidationMessage(refused));
  }
  const { pied, marginPurchasePrice: mpp } = await resolveVatScheme({ lines: p.lines, pied: p.pied ?? {}, docType: p.docType, status: p.status });

  // Un brouillon qui quitte le régime de la marge repasse explicitement en 'normal'.
  const header = headerColumns({ ...p, pied, marginPurchasePrice: mpp });
  if (isMargeDocument(doc) && pied.vatScheme !== 'marge') Object.assign(header, margeColumns('normal', null));
  let { error: he } = await supabase.from('documents').update(header)
    .eq('id', p.documentId).eq('status', 'brouillon');
  if (isMissingMargeColumn(he)) ({ error: he } = await supabase.from('documents').update(stripMargeColumns(header)).eq('id', p.documentId).eq('status', 'brouillon'));
  if (he) throw he;

  if (p.lines.length) {
    const { error: le } = await supabase.from('document_lines').insert(lineRows(p.documentId, p.lines, pied));
    if (le) throw le;
  }
  if (oldLines.length) {
    const { error: de } = await supabase.from('document_lines').delete().in('id', oldLines.map((l) => l.id));
    if (de) throw de;
  }

  if (!validated) return p.documentId;

  // Le numéro n'est pris qu'ici, une seule fois : un brouillon rouvert dix fois n'en consomme aucun.
  const number = await nextNumber(p.companyId, p.docType);
  const { error: ve } = await supabase.from('documents').update({ status: 'validee', number }).eq('id', p.documentId);
  if (ve) throw ve;

  await recordSaleStockMoves(p.docType, p.lines, number);
  return p.documentId;
}

/**
 * Libère les réservations d'un document RES/BL (transformation en facture ou suppression) :
 * réplique chaque ligne en mouvement de libération (réservé −qty), append-only (B7).
 */
export async function liberateReservation(docId: string): Promise<void> {
  const { doc, lines } = await getDocumentFull(docId);
  if (!(RESERVE_DOC_TYPES as readonly string[]).includes(doc.doc_type)) return;
  for (const l of lines) {
    if (!lineMovesStock(l) || !l.article_id) continue;
    const { error } = await supabase.rpc('record_stock_move', {
      _article: l.article_id, _type: 'liberation', _qty: -Math.abs(Number(l.quantity)), _unit_cost: undefined,
      _is_reservation: true, _bin: undefined, _origin: 'sale', _ref: doc.number ?? undefined, _note: 'Libération réservation',
    });
    if (error) throw error;
  }
}

/**
 * Article proposé dans la recherche d'une ligne de vente, avec son stock (triple stock B4) :
 * réel, réservé et « en commande » (commandes fournisseur CMD validées sans réception reçue).
 * Le statut disponible / en commande / à commander se calcule avec `saleStockStatus`
 * (availability.ts) selon la quantité de la ligne.
 */
export type SaleArticle = {
  id: string; reference: string; designation: string; sale_price_ht: number; vat_rate: number;
  mgmt_type: string | null; real_qty: number; reserved_qty: number; on_order_qty: number;
  bin_location: string | null;
  /** Référence remplacée (mission 05, carte 3) et groupe d'équivalences. */
  superseded_by_id: string | null; equivalence_group: string | null;
  /** Famille « RR-SS-CC » : facture obligatoire au-delà de 125 € pour une pièce du véhicule (PDV010). */
  category_path?: string | null;
};
/**
 * Recherche d'article pour une ligne de vente (référence, désignation, réf. fournisseur,
 * code-barres). Réutilise la fonction SQL de la mission 02 `part_order_article_search`
 * (même calcul du stock et de l'« en commande » que l'écran des commandes de pièces).
 */
export async function searchSaleArticles(companyId: string, term: string, limit = 8): Promise<SaleArticle[]> {
  const s = term.trim();
  if (s.length < 2) return [];
  const { data, error } = await supabase.rpc('part_order_article_search', { _company: companyId, _term: s, _limit: limit });
  if (error) throw error;
  const rows = data ?? [];
  // Remplacement / équivalences (non renvoyés par la fonction SQL) : un seul aller-retour.
  const links = new Map<string, { superseded_by_id: string | null; equivalence_group: string | null; category_path: string | null }>();
  if (rows.length) {
    const { data: l, error: le } = await supabase
      .from('articles').select('id, superseded_by_id, equivalence_group, category_path').in('id', rows.map((a) => a.article_id));
    if (le) throw le;
    for (const x of l ?? []) links.set(x.id, { superseded_by_id: x.superseded_by_id, equivalence_group: x.equivalence_group, category_path: x.category_path });
  }
  return rows.map((a) => ({
    id: a.article_id, reference: a.reference, designation: a.designation,
    sale_price_ht: Number(a.sale_price_ht ?? 0), vat_rate: Number(a.vat_rate ?? 21),
    mgmt_type: a.mgmt_type ?? null, bin_location: a.bin_location ?? null,
    real_qty: Number(a.real_qty ?? 0), reserved_qty: Number(a.reserved_qty ?? 0), on_order_qty: Number(a.on_order_qty ?? 0),
    superseded_by_id: links.get(a.article_id)?.superseded_by_id ?? null,
    equivalence_group: links.get(a.article_id)?.equivalence_group ?? null,
    category_path: links.get(a.article_id)?.category_path ?? null,
  }));
}

/**
 * Articles de main-d'œuvre (type de gestion T, ADR-002) pour une ligne « main d'œuvre » :
 * taux horaire en prix de vente, quantité en heures décimales. Sans terme : les 20 premiers.
 */
export async function searchLabourArticles(companyId: string, term: string): Promise<SaleArticle[]> {
  const s = term.replace(/[,()%*\\]/g, ' ').trim();
  let q = supabase.from('articles')
    .select('id, reference, designation, sale_price_ht, vat_rate, superseded_by_id, equivalence_group')
    .eq('company_id', companyId).eq('mgmt_type', 'T').eq('is_active', true).order('reference').limit(20);
  if (s) q = q.or(`reference.ilike.%${s}%,designation.ilike.%${s}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id, reference: a.reference, designation: a.designation,
    sale_price_ht: Number(a.sale_price_ht ?? 0), vat_rate: Number(a.vat_rate ?? 21),
    mgmt_type: 'T', bin_location: null, real_qty: 0, reserved_qty: 0, on_order_qty: 0,
    superseded_by_id: a.superseded_by_id, equivalence_group: a.equivalence_group, category_path: null,
  }));
}

/**
 * Conversions autorisées (G8 p.96, p.101-109). Chaîne mission 05 : DEV (devis / proforma)
 * → BC (bon de commande) → RES/BL/FAC ; DEV peut aussi aller directement en RES/BL/FAC.
 * RES→FAC/BL ; BL→FAC. Les acomptes perçus suivent le document (convertDocument).
 */
export const CONVERSIONS: Record<string, readonly string[]> = {
  DEV: ['BC', 'RES', 'BL', 'FAC'],
  BC: ['RES', 'BL', 'FAC'],
  RES: ['FAC', 'BL'],
  BL: ['FAC'],
};

/** Reconstruit les paramètres de pied à partir d'une ligne `documents`. */
function docRowToPied(d: DocumentRow): PiedInput {
  return {
    priceMode: (d.price_mode as 'ht' | 'ttc') ?? 'ttc', taxExempt: !!d.tax_exempt, vatScheme: docVatScheme(d),
    globalDiscountPct: Number(d.global_discount_pct), globalDiscountAmount: Number(d.global_discount_amount),
    shippingHt: Number(d.shipping_ht), shippingTaxed: d.shipping_taxed !== false,
    shippingVatRate: Number(d.shipping_vat_rate), forcedTtc: d.forced_ttc != null ? Number(d.forced_ttc) : null,
  };
}

/**
 * Convertit un document source (DEV/RES/BL) en un document cible (FAC/RES/BL) :
 * clone les lignes + le pied, libère la réservation source (RES/BL), reporte les acomptes
 * perçus sur la cible (déduction auto, G8 p.96), et passe la source en statut 'converti'.
 * Retourne l'id du document créé.
 */
export async function convertDocument(sourceId: string, targetType: string): Promise<string> {
  const { doc, lines } = await getDocumentFull(sourceId);
  const allowed = CONVERSIONS[doc.doc_type] ?? [];
  if (!allowed.includes(targetType)) throw new Error(`Conversion ${doc.doc_type}→${targetType} non autorisée`);

  const lineInputs: LineInput[] = lines.map((l) => rowToLineInput(l));

  const today = new Date().toISOString().slice(0, 10);
  const newId = await createDocument({
    companyId: doc.company_id, docType: targetType, contactId: doc.contact_id, vehicleId: doc.vehicle_id,
    issueDate: today, dueDate: doc.due_date, status: 'validee', notes: doc.notes,
    lines: lineInputs, pied: docRowToPied(doc), sourceDocumentId: sourceId,
  });

  // Report des acomptes perçus de la source (réservation) sur la cible → déduction auto.
  const srcPayments = await listPayments(sourceId);
  const acomptes = srcPayments.filter((p) => p.status === 'recu' && Number(p.amount) !== 0);
  if (acomptes.length > 0) {
    // `transferredFrom` (PDV010) : l'argent a déjà été encaissé le jour de l'acompte ; le report n'est
    // pas un nouvel encaissement (hors journal Z, hors plafond espèces).
    await addPayments(newId, acomptes.map((p) => ({
      method: p.method, amount: Number(p.amount), status: 'recu',
      note: `Acompte reporté ${doc.doc_type} ${doc.number ?? ''}`.trim(),
      fromFinancing: !!p.from_financing, transferredFrom: p.id,
    })));
  }

  // Report du financement en cours (mission 05, carte 9) : même organisme, montant et statut.
  if (doc.financing_org_id && doc.financing_status && Number(doc.financing_amount) > 0) {
    const { error: fe } = await supabase.rpc('document_set_financing', {
      _document: newId, _org: doc.financing_org_id, _amount: Number(doc.financing_amount), _status: doc.financing_status,
    });
    if (fe) throw fe;
  }

  // Libère la réservation de la source (RES/BL) puis marque la source convertie.
  await liberateReservation(sourceId);
  const { error } = await supabase.from('documents').update({ status: 'converti' }).eq('id', sourceId);
  if (error) throw error;

  return newId;
}

/**
 * Génère un avoir (type AVO) depuis une facture (G8 Facturation p.88, p.113, p.135) :
 * lignes en négatif, **réintégration du stock** (entrée réel), **remboursement** des règlements
 * perçus (règlements négatifs sur l'avoir), filiation, et passage de la facture en 'annulee'.
 * Mouvements append-only (B7). Retourne l'id de l'avoir.
 */
/**
 * Documents qu un avoir peut annuler : la facture et le ticket de caisse (G8 : la vente Express est
 * une « facture Express », annulee comme une facture). Avant l audit caisse du 03/11/2026, le bouton
 * « Generer un avoir » d un ticket repondait « document source non facturable ».
 */
export const CREDIT_NOTE_SOURCE_TYPES = ['FAC', 'TIK'] as const;
export function canGenerateCreditNote(doc: Pick<DocumentRow, 'doc_type' | 'status'>): boolean {
  return (CREDIT_NOTE_SOURCE_TYPES as readonly string[]).includes(doc.doc_type)
    && !['brouillon', 'annulee', 'converti'].includes(doc.status);
}

export async function generateCreditNote(invoiceId: string): Promise<string> {
  const { doc, lines } = await getDocumentFull(invoiceId);
  if (!(CREDIT_NOTE_SOURCE_TYPES as readonly string[]).includes(doc.doc_type)) throw new Error(t('sales.creditNoteSource'));
  if (!canGenerateCreditNote(doc)) throw new Error(t('sales.creditNoteAlready'));

  // Lignes en négatif (qté inversée → totaux négatifs via computeTotals).
  const lineInputs: LineInput[] = lines.map((l) => rowToLineInput(l, -1));

  // Avoir d'une vente en régime de la marge (M-89) : même régime, aucune TVA, prix de reprise
  // figé repris tel quel (le registre de la marge retire la vente de la période de l'avoir).
  const mpp = (doc as DocumentMargeExtra).margin_purchase_price;
  // Un ticket annulé au comptoir : l'avoir et son remboursement entrent dans le journal Z de la
  // caisse ouverte (« remboursements », PDV010). Caisse fermée : l'avoir se rattache à rien et le
  // remboursement en espèces sera refusé par la base (les espèces passent par le tiroir).
  const { getOpenSession } = await import('./cash-api');
  const open = doc.cash_session_id ? await getOpenSession(doc.company_id) : null;

  const today = new Date().toISOString().slice(0, 10);
  const avoId = await createDocument({
    companyId: doc.company_id, docType: 'AVO', contactId: doc.contact_id, vehicleId: doc.vehicle_id,
    issueDate: today, dueDate: null, status: 'validee', notes: doc.notes,
    lines: lineInputs, pied: docRowToPied(doc), sourceDocumentId: invoiceId,
    marginPurchasePrice: mpp == null ? null : Number(mpp), vatSchemeOverride: docVatScheme(doc),
    cashSessionId: open?.id ?? null, sourceDocType: doc.doc_type,
  });

  // Réintégration du stock : entrée réel +qté pour chaque ligne article (B4).
  for (const l of lines) {
    if (!lineMovesStock(l) || !l.article_id) continue;
    const { error } = await supabase.rpc('record_stock_move', {
      _article: l.article_id, _type: 'entree', _qty: Math.abs(Number(l.quantity)), _unit_cost: undefined,
      _is_reservation: false, _bin: undefined, _origin: 'sale', _ref: doc.number ?? undefined, _note: 'Avoir / réintégration',
    });
    if (error) throw error;
  }

  // Remboursement : règlements négatifs reprenant les règlements perçus de la facture (les
  // contre-passations et leurs cibles s'annulent, l'arrondi « ARR » d'origine n'est pas repris :
  // le remboursement en espèces est lui-même arrondi à 5 cents, PDV010).
  const paid = await listPayments(invoiceId);
  const refunds = refundLines(paid, doc.number);
  if (refunds.length > 0) await addPayments(avoId, refunds);

  // La facture est annulée par l'avoir.
  const { error: ue } = await supabase.from('documents').update({ status: 'annulee' }).eq('id', invoiceId);
  if (ue) throw ue;

  return avoId;
}

/**
 * Lignes de remboursement d'un avoir (PDV010) : un règlement négatif par mode réellement perçu
 * (somme des perçus du mode, contre-passations déduites, arrondi `ARR` ignoré), puis l'arrondi
 * légal à 5 cents appliqué au remboursement en espèces comme à l'encaissement. Logique pure,
 * testée dans tests/caisse-legale.test.ts.
 */
export function refundLines(paid: { method: string; amount: number | string; status: string | null }[], sourceNumber: string | null): NewPayment[] {
  const byMethod = new Map<string, number>();
  for (const p of paid) {
    if ((p.status ?? 'recu') !== 'recu' || p.method === CASH_ROUNDING_METHOD) continue;
    byMethod.set(p.method, Math.round(((byMethod.get(p.method) ?? 0) + Number(p.amount)) * 100) / 100);
  }
  const note = `Remboursement ${sourceNumber ?? ''}`.trim();
  const lines: NewPayment[] = [...byMethod].filter(([, amount]) => amount > 0.004)
    .map(([method, amount]) => ({ method, amount: -amount, status: 'recu', note }));
  return applyCashRounding(lines).map((l) => ({ ...l, note: l.note ?? note }));
}

export type DocumentFull = { doc: DocumentRow; lines: DocumentLine[] };
export async function getDocumentFull(id: string): Promise<DocumentFull> {
  const [{ data: doc, error: de }, { data: lines, error: le }] = await Promise.all([
    supabase.from('documents').select('*').eq('id', id).single(),
    supabase.from('document_lines').select('*').eq('document_id', id).order('sort_order'),
  ]);
  if (de) throw de; if (le) throw le;
  return { doc: doc as DocumentRow, lines: lines ?? [] };
}

/**
 * Duplique un document (en-tête + lignes) en un nouveau brouillon, sans numéro ni
 * règlements (G8 : « dupliquer » repart d'une page blanche à valider). Retourne l'id créé.
 */
export async function duplicateDocument(id: string): Promise<string> {
  const { doc, lines } = await getDocumentFull(id);
  const lineInputs: LineInput[] = lines.map((l) => rowToLineInput(l));
  const today = new Date().toISOString().slice(0, 10);
  return createDocument({
    companyId: doc.company_id, docType: doc.doc_type, contactId: doc.contact_id, vehicleId: doc.vehicle_id,
    issueDate: today, dueDate: null, status: 'brouillon', notes: doc.notes,
    lines: lineInputs, pied: docRowToPied(doc),
  });
}

/**
 * Supprime un document brouillon (lignes + règlements cascadent en base). Réservé aux
 * brouillons : un document validé/payé ne se supprime pas (B7, avoir/annulation sinon).
 */
export async function deleteDocument(id: string): Promise<void> {
  // La suppression est tracée dans `events` par le trigger d'audit de `documents` (M06 §7).
  const { data, error } = await supabase.from('documents').delete().eq('id', id).eq('status', 'brouillon').select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(t('sales.notDraft'));
}

/**
 * Purge des devis anciens (trop nombreux au fil du temps) : supprime les DEV
 * antérieurs à `dateIso`, uniquement à l'état brouillon/validée — jamais un devis
 * converti en facture (B7 : un document facturé ne se supprime pas). Retourne le
 * nombre de devis supprimés.
 */
export async function purgeQuotesBefore(companyId: string, dateIso: string): Promise<number> {
  const { data, error } = await supabase
    .from('documents')
    .delete()
    .eq('company_id', companyId)
    .eq('doc_type', 'DEV')
    .in('status', ['brouillon', 'validee'])
    .lt('issue_date', dateIso)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

export async function listDocuments(companyId: string, docType?: string): Promise<DocumentRow[]> {
  let q = supabase.from('documents').select('*').eq('company_id', companyId).order('issue_date', { ascending: false }).limit(100);
  if (docType) q = q.eq('doc_type', docType);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type AvailabilityLineRow = { document_id: string; article_id: string | null; quantity: number; line_type: string };
/**
 * Lignes (article_id, quantity) d'un lot de documents, en un seul aller-retour — utilisé
 * par la liste des ventes pour calculer la pastille de disponibilité (B4) sans requête N+1
 * par document. Bornée par la liste appelante (max 100 documents, cf. listDocuments).
 */
export async function listDocumentLinesFor(documentIds: string[]): Promise<AvailabilityLineRow[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await supabase
    .from('document_lines').select('document_id, article_id, quantity, line_type').in('document_id', documentIds);
  if (error) throw error;
  return data ?? [];
}

export type PaymentRow = Database['public']['Tables']['document_payments']['Row'];
/** Une ligne de règlement à enregistrer (un mode). */
export type NewPayment = {
  method: string; amount: number;
  status?: 'recu' | 'attendu';   // 'attendu' = chèque/LCR différé (le client reste débiteur)
  dueDate?: string | null;       // échéance d'un règlement différé
  givenAmount?: number | null;   // espèces remises (pour le rendu de monnaie)
  note?: string | null;
  fromFinancing?: boolean;       // versé par l'organisme de financement (mission 05, carte 9)
  reversalOf?: string | null;    // contre-passation du règlement visé (PDV010 : jamais de suppression)
  transferredFrom?: string | null; // acompte reporté à la conversion (pas un nouvel encaissement)
};

/** Modes de règlement paramétrés (reference_values), visibles en caisse en premier. */
export type PaymentMethod = { code: string; label: string; visiblePos: boolean };
export async function listPaymentMethods(companyId: string): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('reference_values').select('code, label, is_active, sort_order, extra')
    .eq('company_id', companyId).eq('table_key', 'payment_method').eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    code: r.code, label: r.label,
    visiblePos: (r.extra as { visible_pos?: boolean } | null)?.visible_pos !== false,
  }));
}

/**
 * Facture obligatoire par famille d'article (PDV010) : Paramètres → Tables → « Facture obligatoire
 * par famille » (`invoice_required_family`, extra.requires_invoice). Table absente : aucune règle.
 */
export async function listInvoiceFamilyRules(companyId: string): Promise<InvoiceFamilyRule[]> {
  const { data, error } = await supabase
    .from('reference_values').select('code, is_active, extra')
    .eq('company_id', companyId).eq('table_key', INVOICE_FAMILY_TABLE_KEY);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    code: r.code, active: r.is_active !== false,
    requiresInvoice: (r.extra as { requires_invoice?: boolean } | null)?.requires_invoice === true,
  }));
}

export async function listPayments(documentId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from('document_payments').select('*').eq('document_id', documentId).order('paid_at');
  if (error) throw error;
  return data ?? [];
}

/** Enregistre un ou plusieurs règlements puis recalcule le montant réglé / le statut (DB). */
export async function addPayments(documentId: string, lines: NewPayment[]): Promise<void> {
  const rows = lines
    .filter((l) => Math.abs(l.amount) > 0.0001)
    .map((l) => ({
      document_id: documentId, method: l.method, amount: l.amount,
      status: l.status ?? 'recu', due_date: l.dueDate ?? null,
      given_amount: l.givenAmount ?? null, note: l.note ?? null,
      from_financing: !!l.fromFinancing,
      // Colonnes de la migration 20261103170000 : envoyées seulement si renseignées.
      ...(l.reversalOf ? { reversal_of: l.reversalOf } : {}),
      ...(l.transferredFrom ? { transferred_from: l.transferredFrom } : {}),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('document_payments').insert(rows);
  if (error) throw error;
  await recomputePaid(documentId);
}

/**
 * Annule un règlement PERÇU par contre-passation (PDV010, CDE art. III.86 : on ne corrige pas, on
 * contre-passe) : ligne inverse datée, même mode, motif obligatoire, auteur tracé par l'audit. La
 * suppression physique (`deletePayment`) n'existe plus ; la base la refuse de toute façon.
 */
export async function reversePayment(payment: Pick<PaymentRow, 'id' | 'method' | 'amount' | 'status'>, documentId: string, reason: string): Promise<void> {
  let line;
  try { line = reversalLine(payment, reason); } catch (e) {
    throw new Error(t((e as Error).message === 'needReason' ? 'sales.reverseNeedReason' : 'sales.reverseNotReceived'));
  }
  await addPayments(documentId, [{ method: line.method, amount: line.amount, status: 'recu', note: line.note, reversalOf: line.reversalOf }]);
}

/** Annule un règlement ATTENDU (différé jamais perçu) : statut « annulé » motivé, rien n'est effacé. */
export async function cancelDeferredPayment(paymentId: string, documentId: string, reason: string): Promise<void> {
  const motif = reason.trim();
  if (!motif) throw new Error(t('sales.reverseNeedReason'));
  const { data, error } = await supabase.from('document_payments')
    .update({ status: 'annule', note: motif }).eq('id', paymentId).eq('status', 'attendu').select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(t('sales.reverseNotDeferred'));
  await recomputePaid(documentId);
}

/** Passe un règlement « attendu » (différé) en « perçu » → réduit le dû. */
export async function markPaymentReceived(paymentId: string, documentId: string): Promise<void> {
  const { error } = await supabase.from('document_payments').update({ status: 'recu' }).eq('id', paymentId);
  if (error) throw error;
  await recomputePaid(documentId);
}

async function recomputePaid(documentId: string): Promise<void> {
  const { error } = await supabase.rpc('recompute_document_paid', { _document: documentId });
  if (error) throw error;
}

/** Compat : enregistrement d'un règlement perçu unique. */
export async function recordPayment(documentId: string, method: string, amount: number): Promise<void> {
  await addPayments(documentId, [{ method, amount }]);
}
