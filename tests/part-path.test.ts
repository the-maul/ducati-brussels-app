/**
 * C2 (23/11/2026) — Règle du chemin d'une pièce : tous les états, reliquat, plusieurs commandes, retard,
 * « client prévenu », colonne « Étiq. » et étiquette de destination. La base est testée dans
 * supabase/tests/c2_chemin_pieces.sql.
 */
import { describe, expect, test } from 'bun:test';
import {
  countByStatus, destinationDefaultQty, destinationDocLine, destinationLabelData, destinationLabelsSearch, effectiveLabels, filterPartPaths,
  labelsForQty, partPath, partStatusTone, PART_STATUSES, type DestinationRow, type PartPathRow, type PartSupply,
} from '../src/modules/purchases/part-path';
import { zplFromLabelData } from '../src/modules/articles/labels/device-print';
import { zplLabels } from '../src/lib/devices/protocols';

const TODAY = '2026-11-23';
const row = (p: Partial<PartPathRow> = {}): PartPathRow => ({
  demandKind: 'part_order', demandId: 'l1', articleId: 'a1', reference: 'REF1', designation: 'Filtre', bin: 'A1', qtyNeeded: 2,
  orderKind: 'standard', sourceId: 'o1', sourceNumber: 'CP-1', sourceStatus: 'envoyee', excelTab: null, contactId: 'c1', contactName: 'Jean Dupont',
  contactPhone: '0470', repairOrderId: null, orNumber: null, appointmentId: null, appointmentAt: null, documentId: null, documentNumber: null,
  supplies: [], qtyReserved: 0, qtyPrepared: 0, qtyDelivered: 0, informedAt: null, informedChannel: null, noticeStatus: null, noticeIsTest: false,
  demandedAt: '2026-11-20T10:00:00Z', ...p,
});
const sup = (p: Partial<PartSupply> = {}): PartSupply => ({
  kind: 'cmd', docId: 'd1', number: 'CMD-1', type: 'standard', dcs: null, status: 'validee', orderedAt: '2026-11-20', expectedAt: null,
  qty: 2, received: 0, receipts: [], ...p,
});
const rec = (id: string, date: string, bl: string | null = null) => ({ id, number: `REC-${id}`, date, bl, invoice: null });

describe('chemin : chaque statut', () => {
  test('rien de commandé : à commander', () => {
    const p = partPath(row(), TODAY);
    expect(p.status).toBe('a_commander');
    expect(p.steps).toEqual({ demand: 'done', order: 'todo', received: 'todo', prepared: 'todo', informed: 'todo', delivered: 'todo' });
  });
  test('dans un panier ouvert : au panier, pas encore commandée', () => {
    const p = partPath(row({ supplies: [sup({ kind: 'basket', status: 'ouvert' })] }), TODAY);
    expect(p.status).toBe('au_panier');
    expect(p.qtyInBasket).toBe(2);
    expect(p.qtyOrdered).toBe(0);
    expect(p.steps.order).toBe('partial');
  });
  test('classeur Excel pas encore passé : au panier ; passé : commandée', () => {
    expect(partPath(row({ supplies: [sup({ kind: 'excel', status: 'telecharge' })] }), TODAY).status).toBe('au_panier');
    expect(partPath(row({ supplies: [sup({ kind: 'excel', status: 'commandee' })] }), TODAY).status).toBe('commandee');
  });
  test('commandée, puis reliquat, puis reçue', () => {
    expect(partPath(row({ supplies: [sup()] }), TODAY).status).toBe('commandee');
    const partial = partPath(row({ supplies: [sup({ status: 'partielle', received: 1, receipts: [rec('1', '2026-11-21', 'BL1')] })] }), TODAY);
    expect(partial.status).toBe('reliquat');
    expect(partial.qtyRemaining).toBe(1);
    expect(partial.steps.received).toBe('partial');
    expect(partial.lastReceivedAt).toBe('2026-11-21');
    expect(partial.canInform).toBe(false);
    const full = partPath(row({ supplies: [sup({ status: 'recue', received: 2 })] }), TODAY);
    expect(full.status).toBe('recue');
    expect(full.qtyRemaining).toBe(0);
    expect(full.canInform).toBe(true);
  });
  test('préparée, client prévenu, remise', () => {
    const s = [sup({ status: 'recue', received: 2 })];
    expect(partPath(row({ supplies: s, qtyPrepared: 2 }), TODAY).status).toBe('preparee');
    const inf = partPath(row({ supplies: s, qtyPrepared: 2, informedAt: '2026-11-22T09:00:00Z', informedChannel: 'telephone' }), TODAY);
    expect(inf.status).toBe('client_prevenu');
    expect(inf.steps.informed).toBe('done');
    expect(inf.canInform).toBe(false);
    const done = partPath(row({ supplies: s, qtyDelivered: 2, informedAt: '2026-11-22T09:00:00Z' }), TODAY);
    expect(done.status).toBe('remise');
    expect(done.steps.delivered).toBe('done');
  });
  test('chaque statut a une couleur, jamais le rouge de la marque', () => {
    for (const s of PART_STATUSES) expect(['success', 'warning', 'info', 'neutral']).toContain(partStatusTone(s));
  });
});

describe('chemin : plusieurs commandes et reliquat', () => {
  test('deux commandes pour une ligne : les quantités s\'additionnent', () => {
    const p = partPath(row({ qtyNeeded: 5, supplies: [
      sup({ qty: 3, received: 3, status: 'recue', receipts: [rec('1', '2026-11-20')] }),
      sup({ kind: 'basket', docId: 'b1', qty: 2, received: 1, status: 'commande', receipts: [rec('2', '2026-11-22')] }),
    ] }), TODAY);
    expect(p.qtyOrdered).toBe(5);
    expect(p.qtyReceived).toBe(4);
    expect(p.qtyRemaining).toBe(1);
    expect(p.status).toBe('reliquat');
    expect(p.receipts.map((r) => r.id)).toEqual(['1', '2']);
    expect(p.lastReceivedAt).toBe('2026-11-22');
  });
  test('une même réception sur deux commandes n\'apparaît qu\'une fois', () => {
    const r1 = rec('1', '2026-11-20');
    const p = partPath(row({ qtyNeeded: 4, supplies: [sup({ received: 2, receipts: [r1] }), sup({ docId: 'd2', received: 2, receipts: [r1] })] }), TODAY);
    expect(p.receipts).toHaveLength(1);
  });
  test('trop reçu : plafonné à la quantité demandée', () => {
    const p = partPath(row({ supplies: [sup({ qty: 5, received: 5, status: 'recue' })] }), TODAY);
    expect(p.qtyReceived).toBe(2);
    expect(p.qtyRemaining).toBe(0);
  });
  test('reliquat soldé : il ne viendra plus, la pièce est de nouveau à commander pour le reste', () => {
    const p = partPath(row({ qtyNeeded: 3, supplies: [sup({ qty: 3, received: 1, status: 'soldee' })] }), TODAY);
    expect(p.qtyOrdered).toBe(1);
    expect(p.qtyRemaining).toBe(2);
    expect(p.steps.order).toBe('partial');
    expect(p.status).toBe('reliquat');
  });
  test('panier ouvert en plus d\'une commande : seul le manque compte au panier', () => {
    const p = partPath(row({ qtyNeeded: 3, supplies: [sup({ qty: 2 }), sup({ kind: 'basket', docId: 'b', status: 'ouvert', qty: 4 })] }), TODAY);
    expect(p.qtyOrdered).toBe(2);
    expect(p.qtyInBasket).toBe(1);
  });
});

describe('chemin : pour qui', () => {
  test('stock : ni préparation, ni client, ni remise ; finie une fois reçue', () => {
    const p = partPath(row({ demandKind: 'stock', contactId: null, supplies: [sup({ status: 'recue', received: 2 })] }), TODAY);
    expect(p.status).toBe('recue');
    expect([p.steps.prepared, p.steps.informed, p.steps.delivered]).toEqual(['na', 'na', 'na']);
    expect(p.canInform).toBe(false);
    expect(p.informTarget).toBeNull();
  });
  test('réservation d\'atelier déjà couverte par le stock : pas de commande à faire', () => {
    const p = partPath(row({ demandKind: 'reservation', repairOrderId: 'or1', qtyReserved: 2 }), TODAY);
    expect(p.steps.order).toBe('na');
    expect(p.steps.received).toBe('na');
    expect(p.steps.prepared).toBe('todo');
    expect(p.status).toBe('reservee');
    expect(p.informTarget).toEqual({ kind: 'repair_order', id: 'or1' });
  });
  test('réservée puis sortie du casier : la pièce devient préparée', () => {
    const p = partPath(row({ demandKind: 'reservation', repairOrderId: 'or1', qtyReserved: 2, qtyPrepared: 2 }), TODAY);
    expect(p.steps.prepared).toBe('done');
    expect(p.status).toBe('preparee');
  });
  test('sans client : pas de « client prévenu »', () => {
    const p = partPath(row({ contactId: null, supplies: [sup({ status: 'recue', received: 2 })] }), TODAY);
    expect(p.steps.informed).toBe('na');
    expect(p.canInform).toBe(false);
  });
});

describe('chemin : retard', () => {
  test('date prévue dépassée et pièce pas là', () => {
    expect(partPath(row({ supplies: [sup({ expectedAt: '2026-11-22' })] }), TODAY).isLate).toBe(true);
    expect(partPath(row({ supplies: [sup({ expectedAt: TODAY })] }), TODAY).isLate).toBe(false);
  });
  test('RDV passé et pièce manquante ; reçue : plus de retard', () => {
    expect(partPath(row({ appointmentAt: '2026-11-20T08:00:00Z' }), TODAY).isLate).toBe(true);
    expect(partPath(row({ appointmentAt: '2026-11-20T08:00:00Z', supplies: [sup({ received: 2, status: 'recue' })] }), TODAY).isLate).toBe(false);
  });
  test('aucune date connue : on n\'invente pas de retard', () => {
    expect(partPath(row({ supplies: [sup({ kind: 'basket', status: 'commande' })] }), TODAY).isLate).toBe(false);
  });
});

describe('vue d\'ensemble : filtres', () => {
  const items = [
    row({ demandId: '1', orderKind: 'urgente', contactName: 'Élise Martin', supplies: [sup({ dcs: 'DCS77', expectedAt: '2026-11-01' })] }),
    row({ demandId: '2', orderKind: 'standard', orNumber: 'OR-2026-5', contactName: 'Paul', supplies: [sup({ received: 2, status: 'recue' })] }),
    row({ demandId: '3', orderKind: 'excel', contactName: 'Ana' }),
  ].map((r) => ({ row: r, path: partPath(r, TODAY) }));
  const ids = (f: Parameters<typeof filterPartPaths>[1]) => filterPartPaths(items, f).map((i) => i.row.demandId);
  test('type, statut, retard', () => {
    expect(ids({ type: 'excel' })).toEqual(['3']);
    expect(ids({ status: 'recue' })).toEqual(['2']);
    expect(ids({ late: true })).toEqual(['1']);
  });
  test('recherche sans accent : client, OR, n° DCS', () => {
    expect(ids({ search: 'elise' })).toEqual(['1']);
    expect(ids({ search: 'or-2026' })).toEqual(['2']);
    expect(ids({ search: 'dcs77' })).toEqual(['1']);
  });
  test('compteurs par statut', () => {
    const c = countByStatus(items);
    expect(c.commandee).toBe(1);
    expect(c.recue).toBe(1);
    expect(c.a_commander).toBe(1);
  });
});

describe('étiquettes : colonne « Étiq. » (PIE-04)', () => {
  test('case cochée : la colonne suit la quantité reçue, même modifiée ensuite', () => {
    expect(effectiveLabels({ article_id: 'a', quantity: 3, labels: 0 }, true)).toBe(3);
    expect(effectiveLabels({ article_id: 'a', quantity: 5, labels: 3 }, true)).toBe(5);
  });
  test('quantité décimale : arrondie au-dessus', () => {
    expect(labelsForQty(0.4)).toBe(1);
    expect(labelsForQty(0)).toBe(0);
    expect(effectiveLabels({ article_id: 'a', quantity: 1.5 }, true)).toBe(2);
  });
  test('nombre saisi à la main : prioritaire ; ligne sans article : rien d\'imposé', () => {
    expect(effectiveLabels({ article_id: 'a', quantity: 5, labels: 1, labelsManual: true }, true)).toBe(1);
    expect(effectiveLabels({ article_id: null, quantity: 5, labels: 0 }, true)).toBe(0);
  });
  test('case décochée : le nombre de la ligne', () => {
    expect(effectiveLabels({ article_id: 'a', quantity: 5, labels: 2 }, false)).toBe(2);
  });
});

describe('étiquette de destination', () => {
  const d: DestinationRow = {
    articleId: 'a', reference: 'REF1', designation: 'Filtre à huile', bin: 'A1', barcode: '3000000000017', qty: 1.5,
    customerName: 'Jean Dupont', docNumber: 'OR-2026-12', appointmentAt: '2026-11-25T08:30:00Z', sourceKind: 'repair_order', sourceId: 'or', isDirect: true,
  };
  test('client, n°, date du RDV, référence, désignation, casier ; jamais de prix', () => {
    const l = destinationLabelData(d, 'Ducati Bruxelles', 'RDV');
    expect(l.customerName).toBe('Jean Dupont');
    expect(l.docNumber).toBe('OR-2026-12 · RDV 25/11/2026');
    expect([l.reference, l.designation, l.bin]).toEqual(['REF1', 'Filtre à huile', 'A1']);
    expect([l.price_ttc, l.price_ht, l.price_promo]).toEqual([null, null, null]);
    expect(l.barcode_value).toBe('3000000000017');
  });
  test('sans RDV ni n° : ligne vide ; sans code-barres : la référence', () => {
    expect(destinationDocLine('CP-1', null, 'RDV')).toBe('CP-1');
    expect(destinationDocLine(null, null, 'RDV')).toBeNull();
    expect(destinationLabelData({ ...d, barcode: null }, 'X', 'RDV').barcode_value).toBe('REF1');
  });
  test('quantité par défaut = ce qui est destiné au client, en entier', () => {
    expect(destinationDefaultQty(d)).toBe(2);
    expect(destinationDefaultQty({ qty: 0 })).toBe(1);
  });
  test('imprimante Zebra : la destination est bien imprimée', () => {
    const zl = zplFromLabelData(destinationLabelData(d, 'X', 'RDV'), 2);
    expect(zl.destination).toBe('OR-2026-12 · RDV 25/11/2026 — Jean Dupont');
    expect(zl.price).toBeNull();
    const zpl = zplLabels([zl], { dpi: 203, labelWidthMm: 50, labelHeightMm: 30 } as Parameters<typeof zplLabels>[1]);
    expect(zpl).toContain('Jean Dupont');
  });
  test('étiquette ordinaire : aucune ligne de destination', () => {
    const zl = zplFromLabelData({ ...destinationLabelData(d, 'X', 'RDV'), customerName: undefined, docNumber: undefined }, 1);
    expect(zl.destination).toBeUndefined();
  });
  test('lien réutilisable par le dossier atelier', () => {
    expect(destinationLabelsSearch('repair_order', 'or1')).toEqual({ destKind: 'repair_order', destId: 'or1' });
  });
});
