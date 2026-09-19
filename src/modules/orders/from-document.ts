/**
 * Commande de pièces depuis un document de vente — mission 02, carte 3 (parité G8 « Mise en
 * proposition de commande », spécification §2.2 / §4.1). Règles pures testées par
 * tests/orders-from-document.test.ts ; le serveur fait foi (fonctions SQL
 * `document_order_needs`, `part_order_create_from_document`, migration 20260919350000).
 *
 * On ne propose que les pièces MANQUANTES pour le client du document :
 *   besoin      = Σ quantités des lignes « article » du document pour cet article ;
 *   libre       = réel − réservé, en rendant au document ce qu'il a lui-même réservé (RES / BL)
 *                 ou sorti (FAC) ;
 *   en commande = article_on_order_for(article, client, document) (mission 05, carte 7 :
 *                 jamais la commande d'un autre client) ;
 *   déjà lancé  = quantité client des commandes de pièces encore en brouillon de ce client ou
 *                 liées à ce document ;
 *   manquant    = max(besoin − max(libre, 0) − en commande − déjà lancé, 0).
 * Pièces seulement (types A et N) : motos, non stockés (M), texte (F) et main-d'œuvre (T) exclus.
 */
import { supabase } from '@/integrations/supabase/client';
import { lineHt } from './lines';
import type { OrderKind } from './api';

/** Documents depuis lesquels on commande : devis / proforma, bon de commande, réservation, BL, facture. */
export const ORDERABLE_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL', 'FAC'] as const;
/** Types de gestion commandables par ce chemin : pièce stockée (A), composant de kit (N). */
export const ORDERABLE_MGMT_TYPES = ['A', 'N'] as const;

export function canOrderFromDocument(doc: { doc_type: string; status: string }): boolean {
  return (ORDERABLE_DOC_TYPES as readonly string[]).includes(doc.doc_type)
    && !['brouillon', 'annulee', 'converti'].includes(doc.status);
}

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type NeedInput = {
  mgmtType: string | null;
  qtyNeeded: number;
  realQty: number;
  reservedQty: number;
  /** Mouvements du document lui-même (référence = son n°) : sortie réelle (négative) et réservation (positive). */
  ownRealDelta?: number;
  ownReservedDelta?: number;
  onOrderQty: number;
  draftQty: number;
};

/** Libre pour ce document : réel − réservé, ce que le document a réservé ou sorti lui étant rendu. */
export function freeForDocument(n: Pick<NeedInput, 'realQty' | 'reservedQty' | 'ownRealDelta' | 'ownReservedDelta'>): number {
  return (num(n.realQty) - num(n.ownRealDelta)) - (num(n.reservedQty) - num(n.ownReservedDelta));
}

/** Quantité manquante (même formule que la fonction SQL _document_order_needs). */
export function missingQty(n: NeedInput): number {
  if (!n.mgmtType || !(ORDERABLE_MGMT_TYPES as readonly string[]).includes(n.mgmtType)) return 0;
  const free = Math.max(freeForDocument(n), 0);
  return Math.max(num(n.qtyNeeded) - free - num(n.onOrderQty) - num(n.draftQty), 0);
}

/** Pièce d'un document avec son calcul (réponse de `document_order_needs`). */
export type OrderNeed = {
  articleId: string;
  reference: string;
  designation: string;
  mgmtType: string;
  lineIds: string[];
  qtyNeeded: number;
  realQty: number;
  reservedQty: number;
  freeQty: number;
  onOrderQty: number;
  draftQty: number;
  missingQty: number;
  supplierId: string | null;
  supplierName: string | null;
  unitPriceHt: number;
  vatRate: number;
  bin: string | null;
};

/** Seules les pièces manquantes sont proposées. */
export function missingNeeds(needs: OrderNeed[]): OrderNeed[] {
  return needs.filter((n) => n.missingQty > 0.0005);
}

/** Nombre de pièces (lignes) à commander. */
export function missingCount(needs: OrderNeed[]): number {
  return missingNeeds(needs).length;
}

/** Ligne de la proposition, telle que saisie dans la fenêtre. */
export type ProposalLine = {
  articleId: string;
  selected: boolean;
  qtyClient: number;
  qtyShop: number;
  supplierId: string | null;
  unitPriceHt: number;
  vatRate: number;
};

/**
 * Proposition par défaut (G8 : « Prop. cmd client / Prop. cmd magasin ») : quantité client = manquant,
 * quantité magasin = 0, fournisseur principal de l'article, prix HTVA net du document.
 * `only` : ne cocher que ces articles (bouton d'une ligne ou d'une sélection) ; sinon tout le document.
 */
export function defaultProposal(needs: OrderNeed[], only?: string[] | null): ProposalLine[] {
  return missingNeeds(needs).map((n) => ({
    articleId: n.articleId,
    selected: !only || only.length === 0 || only.includes(n.articleId),
    qtyClient: n.missingQty,
    qtyShop: 0,
    supplierId: n.supplierId,
    unitPriceHt: n.unitPriceHt,
    vatRate: n.vatRate,
  }));
}

/** Lignes cochées avec au moins une quantité : ce qui part au serveur. */
export function selectedLines(lines: ProposalLine[]): ProposalLine[] {
  return lines.filter((l) => l.selected && num(l.qtyClient) >= 0 && num(l.qtyShop) >= 0 && num(l.qtyClient) + num(l.qtyShop) > 0);
}

/** Total HTVA de la proposition (Σ (qté client + qté magasin) × PU HTVA, comme les règles du type). */
export function proposalTotalHt(lines: ProposalLine[]): number {
  return Math.round(selectedLines(lines).reduce((s, l) => s + lineHt({ qtyClient: l.qtyClient, qtyShop: l.qtyShop, unitPriceHt: l.unitPriceHt }), 0) * 100) / 100;
}

export function proposalPayload(lines: ProposalLine[]) {
  return selectedLines(lines).map((l) => ({
    article_id: l.articleId,
    qty_client: num(l.qtyClient),
    qty_shop: num(l.qtyShop),
    supplier_id: l.supplierId,
    unit_price_ht: num(l.unitPriceHt),
  }));
}

// ---- Accès serveur ----

export async function getDocumentOrderNeeds(documentId: string): Promise<OrderNeed[]> {
  const { data, error } = await supabase.rpc('document_order_needs', { _document: documentId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    articleId: r.article_id,
    reference: r.reference,
    designation: r.designation,
    mgmtType: r.mgmt_type,
    lineIds: r.line_ids ?? [],
    qtyNeeded: num(r.qty_needed),
    realQty: num(r.real_qty),
    reservedQty: num(r.reserved_qty),
    freeQty: num(r.free_qty),
    onOrderQty: num(r.on_order_qty),
    draftQty: num(r.draft_qty),
    missingQty: num(r.missing_qty),
    supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    unitPriceHt: num(r.unit_price_ht),
    vatRate: num(r.vat_rate),
    bin: r.bin_location ?? null,
  }));
}

/** Crée la commande (brouillon) liée au client, au véhicule et au document. Retourne son id. */
export async function createPartOrderFromDocument(p: {
  documentId: string; kind: OrderKind; channel: 'comptoir' | 'mail'; lines: ProposalLine[]; notes?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('part_order_create_from_document', {
    _document: p.documentId,
    _kind: p.kind,
    _channel: p.channel,
    _lines: proposalPayload(p.lines),
    _notes: p.notes ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export type DocumentPartOrder = {
  id: string;
  number: string | null;
  orderKind: OrderKind;
  dispatchStatus: string;
  channel: string;
  totalHt: number;
  totalTtc: number;
  createdAt: string;
  sourceDocumentId: string;
  sourceDocType: string;
  sourceNumber: string | null;
  lineCount: number;
};

/** Commandes de pièces liées au document (ou au document dont il est issu : DEV → BC → RES). */
export async function listDocumentPartOrders(documentId: string): Promise<DocumentPartOrder[]> {
  const { data, error } = await supabase.rpc('document_part_orders', { _document: documentId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    number: r.number ?? null,
    orderKind: r.order_kind,
    dispatchStatus: r.dispatch_status,
    channel: r.channel,
    totalHt: num(r.total_ht),
    totalTtc: num(r.total_ttc),
    createdAt: r.created_at,
    sourceDocumentId: r.source_document_id,
    sourceDocType: r.source_doc_type,
    sourceNumber: r.source_number ?? null,
    lineCount: num(r.line_count),
  }));
}
