/**
 * Tests M6 — mission 08, cartes 1 à 4 (03/11/2026, VEN002) :
 *  - un brouillon se rouvre, se modifie puis se valide : le numéro n'est pris qu'une seule fois,
 *    à la validation ; un document validé ne se modifie plus et ne se supprime plus ;
 *  - la moto choisie est enregistrée sur le document et son bloc (modèle, année, VIN, plaque,
 *    km) sort sur le PDF dans la langue du client ;
 *  - « Devis / proforma » est proposé par défaut (lien `?docType=` et devis atelier prioritaires,
 *    réglage par société) ;
 *  - aucune facture ni aucun avoir sans passer par la confirmation (logique, pas le DOM).
 * La base est simulée (mock du client Supabase) : aucune écriture réelle.
 */
import { test, expect, describe, mock } from 'bun:test';

// ---------------------------------------------------------------------------------------------
// Base simulée : documents + lignes, séquence de numéros, mouvements de stock.
// ---------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { documents: [], document_lines: [] };
const calls = { nextNumber: 0, stockMoves: [] as Row[] };
let ids = 0;

type Filter = { col: string; op: 'eq' | 'in'; val: unknown };
function builder(tableName: string) {
  const rows = () => db[tableName] ?? (db[tableName] = []);
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Row | Row[] | null = null;
  const filters: Filter[] = [];
  let returning = false;
  let single = false;
  const match = (r: Row) => filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col])));
  const api: Row = {
    select() { if (op !== 'select') returning = true; return api; },
    insert(p: Row | Row[]) { op = 'insert'; payload = p; return api; },
    update(p: Row) { op = 'update'; payload = p; return api; },
    delete() { op = 'delete'; return api; },
    eq(col: string, val: unknown) { filters.push({ col, op: 'eq', val }); return api; },
    in(col: string, val: unknown[]) { filters.push({ col, op: 'in', val }); return api; },
    order() { return api; }, limit() { return api; }, maybeSingle() { single = true; return api; },
    single() { single = true; return api; },
    then(resolve: (v: { data: unknown; error: unknown }) => void) {
      let data: unknown = null;
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const inserted = list.map((r) => ({ id: `${tableName}-${++ids}`, ...r }));
        rows().push(...inserted);
        data = single ? inserted[0] : inserted;
      } else if (op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, payload);
        data = returning ? hit : null;
      } else if (op === 'delete') {
        const hit = rows().filter(match);
        db[tableName] = rows().filter((r) => !hit.includes(r));
        data = returning ? hit : null;
      } else {
        const hit = rows().filter(match);
        data = single ? hit[0] ?? null : hit;
      }
      resolve({ data, error: null });
    },
  };
  return api;
}

mock.module('@/integrations/supabase/client', () => ({
  supabase: {
    from: (name: string) => builder(name),
    rpc: async (name: string, args: Row) => {
      if (name === 'next_document_number') return { data: `${args._doc_type}-2026-${String(++calls.nextNumber).padStart(5, '0')}`, error: null };
      if (name === 'record_stock_move') { calls.stockMoves.push(args); return { data: null, error: null }; }
      return { data: null, error: null };
    },
  },
}));

const {
  createDocument, updateDraftDocument, deleteDocument, isDraftDocument, canEditDocument, canDeleteDocument, CONVERSIONS,
} = await import('../src/modules/sales/write-api');
const { vehicleBlockLines } = await import('../src/modules/sales/document-pdf');
const { resolveInitialDocType, FALLBACK_DOC_TYPE } = await import('../src/modules/sales/default-doc-type');
const { requiresConfirmation, confirmedConversions, buildConfirmSummary, visibleConfirmLines, CONFIRMED_DOC_TYPES } = await import('../src/modules/sales/confirm');

const line = (designation: string, price: number, article_id: string | null = null) => ({
  designation, quantity: 1, unit_price_ht: price, vat_rate: 21, discount_pct: 0, line_type: 'article' as const, article_id,
});
const doc = (id: string) => db.documents.find((d) => d.id === id) as Row;
const linesOf = (id: string) => db.document_lines.filter((l) => l.document_id === id);

// ---------------------------------------------------------------------------------------------
describe('carte 1 — un brouillon se rouvre, se modifie, se valide (numero pris une seule fois)', () => {
  test('brouillon -> modification -> validation : pas de numero avant, un seul numero apres', async () => {
    calls.nextNumber = 0;
    const id = await createDocument({
      companyId: 'co', docType: 'DEV', contactId: null, issueDate: '2026-11-03', status: 'brouillon',
      lines: [line('Scrambler Icon', 8256.2, 'art-moto')],
    });
    expect(doc(id).status).toBe('brouillon');
    expect(doc(id).number).toBeNull();
    expect(calls.nextNumber).toBe(0);
    expect(isDraftDocument(doc(id) as { status: string })).toBe(true);

    // Rouvert : client choisi, moto posee, une ligne de plus, toujours en brouillon.
    await updateDraftDocument({
      documentId: id, companyId: 'co', docType: 'DEV', contactId: 'client-1', vehicleId: 'moto-1', issueDate: '2026-11-03', status: 'brouillon',
      lines: [line('Scrambler Icon', 8256.2, 'art-moto'), line('Poignees chauffantes', 180, 'art-opt')],
    });
    expect(doc(id).status).toBe('brouillon');
    expect(doc(id).number).toBeNull();
    expect(doc(id).contact_id).toBe('client-1');
    expect(doc(id).vehicle_id).toBe('moto-1');
    expect(linesOf(id).map((l) => l.designation)).toEqual(['Scrambler Icon', 'Poignees chauffantes']);
    expect(Number(doc(id).total_ht)).toBe(8436.2);
    expect(calls.nextNumber).toBe(0);

    // Valide : le numero est pris maintenant, une seule fois ; le document garde son identifiant.
    const same = await updateDraftDocument({
      documentId: id, companyId: 'co', docType: 'DEV', contactId: 'client-1', vehicleId: 'moto-1', issueDate: '2026-11-03', status: 'validee',
      lines: [line('Scrambler Icon', 8256.2, 'art-moto'), line('Poignees chauffantes', 180, 'art-opt')],
    });
    expect(same).toBe(id);
    expect(doc(id).status).toBe('validee');
    expect(doc(id).number).toBe('DEV-2026-00001');
    expect(calls.nextNumber).toBe(1);
    // Un devis ne touche pas au stock.
    expect(calls.stockMoves).toHaveLength(0);
    // Les anciennes lignes ont ete remplacees, pas dupliquees.
    expect(linesOf(id)).toHaveLength(2);
  });

  test('un document valide ne se modifie plus : refus, aucun numero supplementaire', async () => {
    const before = calls.nextNumber;
    const validated = db.documents.find((d) => d.status === 'validee') as Row;
    await expect(updateDraftDocument({
      documentId: validated.id as string, companyId: 'co', docType: 'DEV', contactId: 'client-1', issueDate: '2026-11-03', status: 'validee',
      lines: [line('x', 10)],
    })).rejects.toThrow();
    expect(calls.nextNumber).toBe(before);
    expect(canEditDocument(validated as { status: string })).toBe(false);
  });

  test('la validation d un brouillon applique les regles du 31/10 (client, ligne, montant)', async () => {
    const id = await createDocument({ companyId: 'co', docType: 'DEV', issueDate: '2026-11-03', status: 'brouillon', lines: [line('TEST', 0)] });
    await expect(updateDraftDocument({
      documentId: id, companyId: 'co', docType: 'DEV', contactId: null, issueDate: '2026-11-03', status: 'validee', lines: [line('TEST', 0)],
    })).rejects.toThrow();
    expect(doc(id).status).toBe('brouillon');
  });

  test('suppression : un brouillon seulement, un document valide refuse', async () => {
    const draft = await createDocument({ companyId: 'co', docType: 'DEV', issueDate: '2026-11-03', status: 'brouillon', lines: [line('a', 10)] });
    expect(canDeleteDocument(doc(draft) as { status: string })).toBe(true);
    await deleteDocument(draft);
    expect(db.documents.find((d) => d.id === draft)).toBeUndefined();

    const validated = db.documents.find((d) => d.status === 'validee') as Row;
    expect(canDeleteDocument(validated as { status: string })).toBe(false);
    await expect(deleteDocument(validated.id as string)).rejects.toThrow();
    expect(db.documents.find((d) => d.id === validated.id)).toBeDefined();
  });

  test('une facture validee depuis un brouillon sort le stock reel, avec le numero en reference', async () => {
    calls.stockMoves = [];
    const id = await createDocument({ companyId: 'co', docType: 'FAC', issueDate: '2026-11-03', status: 'brouillon', lines: [line('Pneu', 150, 'art-pneu')] });
    await updateDraftDocument({
      documentId: id, companyId: 'co', docType: 'FAC', contactId: 'client-1', issueDate: '2026-11-03', status: 'validee', lines: [line('Pneu', 150, 'art-pneu')],
    });
    expect(doc(id).number).toMatch(/^FAC-2026-/);
    expect(calls.stockMoves).toHaveLength(1);
    expect(calls.stockMoves[0]).toMatchObject({ _article: 'art-pneu', _type: 'sortie', _qty: -1, _ref: doc(id).number });
  });
});

// ---------------------------------------------------------------------------------------------
describe('carte 2 — la moto sur le document (donnees du PDF)', () => {
  const moto = { vin: 'ZDMAA00AAXB000001', brand: 'Ducati', model: 'Monster 937', model_year: 2024, plate: '1-ABC-123', mileage: 1250 };

  test('bloc vehicule en francais : modele, annee, VIN, plaque, km', () => {
    const lines = vehicleBlockLines(moto, 'fr');
    expect(lines).toEqual([
      'Marque : Ducati', 'Modèle : Monster 937', 'Année : 2024', 'N° de série : ZDMAA00AAXB000001', 'N° de plaque : 1-ABC-123', 'Kilométrage : 1250 km',
    ]);
  });

  test('dans la langue du client (I18N004) : neerlandais', () => {
    const lines = vehicleBlockLines(moto, 'nl');
    expect(lines).toContain('Bouwjaar : 2024');
    expect(lines).toContain('Serienummer : ZDMAA00AAXB000001');
    expect(lines.some((l) => l.startsWith('Kilometerstand : 1250'))).toBe(true);
  });

  test('km inconnu : pas de ligne ; sans moto : rien', () => {
    expect(vehicleBlockLines({ ...moto, mileage: null }, 'fr').some((l) => l.startsWith('Kilométrage'))).toBe(false);
    expect(vehicleBlockLines(null, 'fr')).toEqual([]);
  });

  test('la moto choisie est enregistree sur le document des la creation', async () => {
    const id = await createDocument({ companyId: 'co', docType: 'DEV', vehicleId: 'moto-2', issueDate: '2026-11-03', status: 'brouillon', lines: [line('a', 10)] });
    expect(doc(id).vehicle_id).toBe('moto-2');
  });
});

// ---------------------------------------------------------------------------------------------
describe('carte 3 — « Devis / proforma » propose par defaut', () => {
  test('sans rien : devis', () => {
    expect(FALLBACK_DOC_TYPE).toBe('DEV');
    expect(resolveInitialDocType({})).toBe('DEV');
    expect(resolveInitialDocType({ requested: null, companyDefault: null })).toBe('DEV');
  });
  test('le lien ?docType= garde la priorite (la facture reste a un clic)', () => {
    expect(resolveInitialDocType({ requested: 'FAC', companyDefault: 'BC' })).toBe('FAC');
    expect(resolveInitialDocType({ requested: 'fac' })).toBe('FAC');
  });
  test('devis atelier depuis un OR : toujours un devis', () => {
    expect(resolveInitialDocType({ workshop: true, requested: 'FAC' })).toBe('DEV');
  });
  test('reglage par societe (Parametres -> Tables), valeur inconnue ignoree', () => {
    expect(resolveInitialDocType({ companyDefault: 'BC' })).toBe('BC');
    expect(resolveInitialDocType({ companyDefault: 'XYZ' })).toBe('DEV');
    expect(resolveInitialDocType({ requested: 'AVO' })).toBe('DEV');
  });
});

// ---------------------------------------------------------------------------------------------
describe('cartes 4 et 6 — aucune facture ni avoir sans confirmation', () => {
  test('facture et avoir demandent confirmation ; devis, BC, reservation, BL et ticket non', () => {
    expect([...CONFIRMED_DOC_TYPES]).toEqual(['FAC', 'AVO']);
    expect(requiresConfirmation('FAC')).toBe(true);
    expect(requiresConfirmation('AVO')).toBe(true);
    for (const t of ['DEV', 'BC', 'RES', 'BL', 'TIK']) expect(requiresConfirmation(t)).toBe(false);
  });

  test('toute conversion vers une facture passe par la confirmation, quel que soit le document source', () => {
    for (const src of Object.keys(CONVERSIONS)) {
      expect(confirmedConversions(src)).toEqual(CONVERSIONS[src].includes('FAC') ? ['FAC'] : []);
    }
    expect(confirmedConversions('DEV')).toEqual(['FAC']);
  });

  test('recapitulatif facture : prochain numero affiche, stock debite, irreversible, bouton « Creer la facture »', () => {
    const s = buildConfirmSummary({
      action: 'convert', docType: 'FAC', clientName: 'Simon', totalTtc: 10183.6,
      lines: [{ designation: 'Scrambler', quantity: 1, lineTtc: 9990 }],
      sequence: { prefix: 'FAC', separator: '-', padding: 5, reset_yearly: true, next_value: 6, current_year: new Date().getFullYear(), suffix: null },
    });
    expect(s.nextNumber).toBe(`FAC-${new Date().getFullYear()}-00006`);
    expect(s.consequences).toEqual(['confirmStockOut', 'confirmSourceConverted', 'confirmIrreversible']);
    expect(s.primaryKey).toBe('confirmCreateInvoice');
    expect(s.titleKey).toBe('confirmInvoiceTitle');
    expect(s.clientName).toBe('Simon');
  });

  test('recapitulatif avoir : stock reintegre, facture compensee (reste au journal), remboursements, bouton « Creer l avoir »', () => {
    const s = buildConfirmSummary({ action: 'creditNote', docType: 'AVO', totalTtc: -121, lines: [{ designation: 'x', quantity: -1, lineTtc: -121 }], sequence: null });
    expect(s.nextNumber).toBeNull();
    expect(s.consequences).toEqual(['confirmStockBack', 'confirmInvoiceCredited', 'confirmRefunds', 'confirmIrreversible']);
    expect(s.primaryKey).toBe('confirmCreateCredit');
  });

  test('validation d une facture depuis l editeur : meme recapitulatif, sans « converti »', () => {
    const s = buildConfirmSummary({ action: 'validate', docType: 'FAC', totalTtc: 100, lines: [] });
    expect(s.consequences).toEqual(['confirmStockOut', 'confirmIrreversible']);
  });

  test('au plus 8 lignes montrees, les lignes vides ignorees, le reste compte', () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ designation: i === 3 ? '' : `l${i}`, quantity: 1, lineTtc: 1 }));
    const { shown, hidden } = visibleConfirmLines(lines);
    expect(shown).toHaveLength(8);
    expect(hidden).toBe(2);
  });
});
