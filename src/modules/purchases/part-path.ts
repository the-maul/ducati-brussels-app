/**
 * M4 — C2 (23/11/2026, PIE-01 à PIE-06) : règle PURE du chemin d'une pièce commandée.
 * pour qui → panier ou commande (type, n° DCS) → reçue (quantité, reliquat, date) → réservée / préparée
 * → client prévenu → remise. La base donne les faits (`part_path_rows`), ce module en déduit les étapes
 * et le statut. Aucun calcul de stock, de PAMP ni de prix ici. Testé dans tests/part-path.test.ts.
 */

export type SupplyKind = 'cmd' | 'basket' | 'excel';
export type PartReceipt = { id: string; number: string | null; date: string | null; bl: string | null; invoice: string | null };
export type PartSupply = {
  kind: SupplyKind; docId: string; number: string | null; type: string | null; dcs: string | null; status: string;
  orderedAt: string | null; expectedAt: string | null; qty: number; received: number; receivedAt?: string | null; receipts: PartReceipt[];
};
export type DemandKind = 'part_order' | 'reservation' | 'stock';

export type PartPathRow = {
  demandKind: DemandKind; demandId: string; articleId: string | null; reference: string | null; designation: string | null;
  bin: string | null; qtyNeeded: number; orderKind: string; sourceId: string | null; sourceNumber: string | null; sourceStatus: string | null;
  excelTab: string | null; contactId: string | null; contactName: string | null; contactPhone: string | null;
  repairOrderId: string | null; orNumber: string | null; appointmentId: string | null; appointmentAt: string | null;
  documentId: string | null; documentNumber: string | null; supplies: PartSupply[];
  qtyReserved: number; qtyPrepared: number; qtyDelivered: number;
  informedAt: string | null; informedChannel: string | null; noticeStatus: string | null; noticeIsTest: boolean; demandedAt: string | null;
};

export const PATH_STEPS = ['demand', 'order', 'received', 'prepared', 'informed', 'delivered'] as const;
export type PathStep = (typeof PATH_STEPS)[number];
export type StepState = 'done' | 'partial' | 'todo' | 'na';

export const PART_STATUSES = ['a_commander', 'au_panier', 'commandee', 'reliquat', 'recue', 'reservee', 'preparee', 'client_prevenu', 'remise'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export type PartPath = {
  status: PartStatus;
  steps: Record<PathStep, StepState>;
  qtyOrdered: number; qtyInBasket: number; qtyReceived: number; qtyRemaining: number;
  lastReceivedAt: string | null;
  receipts: PartReceipt[];
  isLate: boolean;
  /** « Client prévenu » peut être coché : tout est là, un client attend, rien n'est encore noté. */
  canInform: boolean;
  /** Document sur lequel noter « client prévenu ». */
  informTarget: { kind: 'part_order' | 'repair_order' | 'document'; id: string } | null;
};

const ORDERED: Record<SupplyKind, readonly string[]> = {
  cmd: ['validee', 'partielle', 'recue', 'soldee'],
  basket: ['commande', 'recu'],
  excel: ['commandee', 'cloture', 'archive'],
};
const IN_BASKET: Record<SupplyKind, readonly string[]> = { cmd: [], basket: ['ouvert'], excel: ['en_cours', 'telecharge'] };

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Quantité réellement attendue d'une commande : un reliquat soldé ne viendra plus. */
function orderedQty(s: PartSupply): number {
  if (!ORDERED[s.kind].includes(s.status)) return 0;
  return s.kind === 'cmd' && s.status === 'soldee' ? Math.min(s.qty, s.received) : s.qty;
}

function lastDate(s: PartSupply[]): string | null {
  const dates = s.flatMap((x) => [...x.receipts.map((r) => r.date), x.receivedAt ? x.receivedAt.slice(0, 10) : null]).filter(Boolean) as string[];
  return dates.length ? dates.sort().at(-1)! : null;
}

export function partPath(r: PartPathRow, today: string): PartPath {
  const need = r.qtyNeeded;
  const isStock = r.demandKind === 'stock';
  const qtyReceived = round(Math.min(need, r.supplies.reduce((t, s) => t + s.received, 0)));
  const qtyOrdered = round(Math.min(need, Math.max(r.supplies.reduce((t, s) => t + orderedQty(s), 0), qtyReceived)));
  const qtyInBasket = round(Math.min(Math.max(need - qtyOrdered, 0),
    r.supplies.reduce((t, s) => t + (IN_BASKET[s.kind].includes(s.status) ? s.qty : 0), 0)));
  // Une pièce déjà réservée sur le stock n'a pas besoin d'être reçue.
  const covered = Math.min(need, Math.max(qtyReceived, r.qtyReserved, r.qtyPrepared));
  const fromStock = r.supplies.length === 0 && r.qtyReserved >= need;
  // « Préparée » = sortie du casier (liste de préparation). Une réservation seule ne l'est pas encore.
  const prepared = Math.min(need, r.qtyPrepared);
  const delivered = Math.min(need, r.qtyDelivered);
  const hasClient = !isStock && !!r.contactId;
  const informed = !!r.informedAt;

  const steps: Record<PathStep, StepState> = {
    demand: 'done',
    order: fromStock ? 'na' : qtyOrdered >= need ? 'done' : qtyOrdered > 0 || qtyInBasket > 0 ? 'partial' : 'todo',
    received: fromStock ? 'na' : qtyReceived >= need ? 'done' : qtyReceived > 0 ? 'partial' : 'todo',
    prepared: isStock ? 'na' : prepared >= need ? 'done' : prepared > 0 ? 'partial' : 'todo',
    informed: !hasClient ? 'na' : informed ? 'done' : 'todo',
    delivered: isStock ? 'na' : delivered >= need ? 'done' : delivered > 0 ? 'partial' : 'todo',
  };

  let status: PartStatus;
  if (!isStock && delivered >= need) status = 'remise';
  else if (covered >= need && hasClient && informed) status = 'client_prevenu';
  else if (!isStock && covered >= need && prepared >= need) status = 'preparee';
  else if (!isStock && r.qtyReserved >= need) status = 'reservee';
  else if (covered >= need) status = 'recue';
  else if (qtyReceived > 0) status = 'reliquat';
  else if (qtyOrdered > 0) status = 'commandee';
  else if (qtyInBasket > 0) status = 'au_panier';
  else status = 'a_commander';

  const openSupplies = r.supplies.filter((s) => orderedQty(s) > s.received);
  const lateOrder = openSupplies.some((s) => !!s.expectedAt && s.expectedAt.slice(0, 10) < today);
  const lateAppointment = !!r.appointmentAt && r.appointmentAt.slice(0, 10) < today;
  const isLate = covered < need && (lateOrder || lateAppointment);

  const informTarget: PartPath['informTarget'] = isStock ? null
    : r.demandKind === 'part_order' && r.sourceId ? { kind: 'part_order', id: r.sourceId }
    : r.repairOrderId ? { kind: 'repair_order', id: r.repairOrderId }
    : r.documentId ? { kind: 'document', id: r.documentId }
    : null;

  const seen = new Set<string>();
  const receipts = r.supplies.flatMap((s) => s.receipts).filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));

  return {
    status, steps, qtyOrdered, qtyInBasket, qtyReceived,
    qtyRemaining: round(Math.max(need - covered, 0)),
    lastReceivedAt: lastDate(r.supplies),
    receipts, isLate,
    canInform: hasClient && !informed && covered >= need && delivered < need && !!informTarget,
    informTarget,
  };
}

/** Couleur du statut (jamais le rouge de la marque). */
export function partStatusTone(s: PartStatus): 'success' | 'warning' | 'info' | 'neutral' {
  if (s === 'remise' || s === 'client_prevenu') return 'success';
  if (s === 'recue' || s === 'reservee' || s === 'preparee') return 'info';
  if (s === 'reliquat' || s === 'a_commander') return 'warning';
  return 'neutral';
}

export type PartPathFilter = { type?: string; status?: PartStatus | ''; late?: boolean; search?: string };

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Vue « Pièces en cours » : type, statut, en retard, et une recherche client / OR / commande / référence. */
export function filterPartPaths<T extends { row: PartPathRow; path: PartPath }>(items: T[], f: PartPathFilter): T[] {
  const q = norm(f.search).trim();
  return items.filter(({ row, path }) => {
    if (f.type && row.orderKind !== f.type) return false;
    if (f.status && path.status !== f.status) return false;
    if (f.late && !path.isLate) return false;
    if (!q) return true;
    const hay = [row.contactName, row.orNumber, row.sourceNumber, row.documentNumber, row.reference, row.designation,
      ...row.supplies.flatMap((s) => [s.number, s.dcs])].map(norm).join(' ');
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

/** Compteurs par statut, pour les filtres de la vue d'ensemble. */
export function countByStatus(items: { path: PartPath }[]): Record<PartStatus, number> {
  const out = Object.fromEntries(PART_STATUSES.map((s) => [s, 0])) as Record<PartStatus, number>;
  for (const { path } of items) out[path.status] += 1;
  return out;
}

/* ------------------------------------------------------------ Étiquettes (colonne « Étiq. », PIE-04) */

/** Étiquettes d'une ligne reçue : quantité arrondie au-dessus, jamais négative. */
export const labelsForQty = (qty: number) => Math.max(0, Math.ceil(Number.isFinite(qty) ? qty : 0));

/**
 * « Étiquettes = quantités reçues » coché : la colonne suit la quantité de chaque ligne article, y compris
 * les lignes rappelées ou modifiées ensuite. Un nombre saisi à la main sur une ligne reste prioritaire.
 */
export function effectiveLabels(l: { article_id?: string | null; quantity: number; labels?: number | null; labelsManual?: boolean }, follow: boolean): number {
  if (!follow || l.labelsManual || !l.article_id) return Math.max(0, Math.round(l.labels ?? 0));
  return labelsForQty(l.quantity);
}

/* ------------------------------------------------------------ Étiquette de destination */

export type DestinationRow = {
  articleId: string; reference: string | null; designation: string | null; bin: string | null; barcode: string | null; qty: number;
  customerName: string | null; docNumber: string | null; appointmentAt: string | null; sourceKind: string; sourceId: string | null; isDirect: boolean;
};

const shortDate = (iso: string) => {
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
};

/** Ligne de l'étiquette : « OR-2026-12 · RDV 25/11/2026 ». `rdvLabel` vient du dictionnaire. */
export function destinationDocLine(docNumber: string | null, appointmentAt: string | null, rdvLabel: string): string | null {
  const parts = [docNumber?.trim() || null, appointmentAt ? `${rdvLabel} ${shortDate(appointmentAt)}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Données d'étiquette : le système existant imprime déjà « n° — client » ; jamais de prix sur cette étiquette. */
export function destinationLabelData(r: DestinationRow, storeName: string, rdvLabel: string) {
  return {
    reference: r.reference ?? '', designation: r.designation ?? '',
    price_ttc: null, price_ht: null, price_promo: null, discount: null,
    store_name: storeName, bin: r.bin, bin2: null, pack_qty: null,
    barcode_value: r.barcode || r.reference || '',
    customerName: r.customerName?.trim() || undefined,
    docNumber: destinationDocLine(r.docNumber, r.appointmentAt, rdvLabel) ?? undefined,
  };
}

/** Quantité par défaut : ce qui est destiné à ce client, en nombre entier d'étiquettes. */
export const destinationDefaultQty = (r: Pick<DestinationRow, 'qty'>) => Math.max(1, Math.ceil(r.qty || 1));

/** Lien réutilisable (dossier atelier, C1) vers les étiquettes « pour qui » d'un OR, d'une réception… */
export type DestinationKind = 'receipt' | 'picking' | 'repair_order' | 'part_order';
export const destinationLabelsSearch = (kind: DestinationKind, id: string) => ({ destKind: kind, destId: id });
