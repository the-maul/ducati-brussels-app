/**
 * Export comptable « EBP » identique à G8 (lot-g8-export-compta, 18/11/2026).
 *
 * Fixture : les documents du transfert n° 6 relevé dans G8 le 18/11/2026 (base FACTICE,
 * docs/g8-inventaire/export-comptable-g8.md) reconstruits un par un. Le fichier produit doit
 * contenir les 22 lignes du relevé, CARACTÈRE PAR CARACTÈRE et dans le même ordre.
 *
 * Le relevé est un extrait : il ne montre pas les pièces 00005 et 00008, ni les lignes HT / TVA des
 * pièces 00002 (F22701457) et 00003 (avoir 22701458), ni la ligne caisse 530000 de la pièce 00009.
 * La fixture les reconstitue (règlement espèces de F22701457, remboursement de l'avoir) ; ces lignes
 * sont listées ci-dessous comme « absentes du relevé » et vérifiées séparément. À confirmer sur un
 * ECRITURES.TXT complet de la base réelle.
 */
import { test, expect, describe } from 'bun:test';
import {
  buildEbpTransfer, ebpAmount, ebpLineText, ebpThirdText, ebpCity, movementLabel, vatIncluded, autoThirdAccount, onTheFlyAccount,
  type EbpSource, type EbpThird,
} from '../supabase/functions/_shared/ebp-format';
import {
  DEFAULT_EBP_SETTINGS, parseEbpSettings, resolveSalesAccount, resolveVatAccount, resolvePayment, resolveMovement, resolveCustomerThird,
  buildSaleDoc, buildPayment, buildMovement, proposeCustomerAccount, autoTransferDue, externalNumber,
  type EbpRule, type ContactRow, type ThirdAccountRow,
} from '../supabase/functions/_shared/ebp-sources';

// Les 22 lignes du relevé G8, copiées telles quelles.
const G8_LINES = [
  '00001,"18112026",VE  ,411000000   ,,"F22701456 CLIENT DIVERS            ","2701456","      1.74",D,"18112026",',
  '00001,"18112026",VE  ,411000000   ,,"F22701456  CLIENT DIVERS           ","2701456","     -1.44",C,"18112026",',
  '00001,"18112026",VE  ,411000000   ,,"F22701456 CLIENT DIVERS            ","2701456","     -0.30",C,"18112026",',
  '00002,"18112026",VE  ,41106003    ,,"F22701457 TESTCLAUDE INVENTAIRE    ","2701457","      1.74",D,"18112026",',
  '00003,"18112026",VE  ,41106003    ,,"AVOIR 22701458 TESTCLAUDE INVENTAIRE","2701458","     -1.74",C,"18112026",',
  '00004,"18112026",VE  ,200020      ,,"F22701459 GOOSSENS FREDERIC        ","2701459","    115.20",D,"18112026",',
  '00004,"18112026",VE  ,200020      ,,"F22701459  GOOSSENS FREDERIC       ","2701459","    -95.21",C,"18112026",',
  '00004,"18112026",VE  ,200020      ,,"F22701459 GOOSSENS FREDERIC        ","2701459","    -19.99",C,"18112026",',
  '00006,"18112026",RC  ,511400      ,,"ENCAISSEMENT DEPOT VTE          VIR","2       ","   7000.00",D,"20261118",',
  '00006,"18112026",RC  ,530000      ,,"ENCAISSEMENT DEPOT VTE          VIR","2       ","   7000.00",C,"20261118",',
  '00007,"13072026",CA  ,530000      ,,"ESP F22701454-MOREAU LAURENT       ","2701454","     15.90",D,"20260713",',
  '00007,"13072026",CA  ,201324      ,,"ESP F22701454-MOREAU LAURENT       ","2701454","     15.90",C,"20260713",',
  '00009,"18112026",CA  ,411000000   ,,"ESP F22701456-CLIENT DIVERS        ","2701456","      1.74",C,"20261118",',
  '00010,"18112026",RC  ,511300      ,,"CAR F22701459-GOOSSENS FREDERIC    ","2701459","    115.20",D,"20261118",',
  '00010,"18112026",RC  ,200020      ,,"CAR F22701459-GOOSSENS FREDERIC    ","2701459","    115.20",C,"20261118",',
  '00011,"18112026",RC  ,530000      ,,"ACHAT DE CONSOM.TEST CONSOMMABLE ESP","3","     10.00",C,"20261118",',
  '00011,"18112026",RC  ,530000      ,,"ACHAT DE CONSOM.TEST CONSOMMABLE ESP","3","      8.26",D,"20261118",',
  '00011,"18112026",RC  ,            ,,"ACHAT DE CONSOM.TEST CONSOMMABLE ESP","3","      1.74",D,"20261118",',
  '00012,"30072026",RC  ,511300      ,,"CAR R3000002-BETRI PASCAL          ","3000002","    722.98",D,"20260730",',
  '00012,"30072026",RC  ,200012      ,,"CAR R3000002-BETRI PASCAL          ","3000002","    722.98",C,"20260730",',
  '00013,"18112026",RC  ,530000      ,,"REMISE EN BANQUE               ESP","4","    267.64",C,"20261118",',
  '00013,"18112026",RC  ,530000      ,,"REMISE EN BANQUE               ESP","4","    267.64",D,"20261118",',
];

// Lignes que le fichier complet contient forcément mais que le relevé n'a pas recopiées.
const NOT_IN_EXTRACT = [
  '00002,"18112026",VE  ,41106003    ,,"F22701457  TESTCLAUDE INVENTAIRE   ","2701457","     -1.44",C,"18112026",',
  '00002,"18112026",VE  ,41106003    ,,"F22701457 TESTCLAUDE INVENTAIRE    ","2701457","     -0.30",C,"18112026",',
  '00003,"18112026",VE  ,41106003    ,,"AVOIR 22701458  TESTCLAUDE INVENTAIRE","2701458","      1.44",D,"18112026",',
  '00003,"18112026",VE  ,41106003    ,,"AVOIR 22701458 TESTCLAUDE INVENTAIRE","2701458","      0.30",D,"18112026",',
  '00005,"18112026",CA  ,530000      ,,"ESP F22701457-TESTCLAUDE INVENTAIRE","2701457","      1.74",D,"20261118",',
  '00005,"18112026",CA  ,41106003    ,,"ESP F22701457-TESTCLAUDE INVENTAIRE","2701457","      1.74",C,"20261118",',
  '00008,"18112026",CA  ,530000      ,,"ESP AVOIR 22701458-TESTCLAUDE INVENTAIRE","2701458","      1.74",C,"20261118",',
  '00008,"18112026",CA  ,41106003    ,,"ESP AVOIR 22701458-TESTCLAUDE INVENTAIRE","2701458","      1.74",D,"20261118",',
  '00009,"18112026",CA  ,530000      ,,"ESP F22701456-CLIENT DIVERS        ","2701456","      1.74",D,"20261118",',
];

const DIVERS: EbpThird = { account: '411000000', name: 'CLIENT DIVERS', country: 'BE' };
const TESTCLAUDE: EbpThird = { account: '41106003', name: 'TESTCLAUDE INVENTAIRE', zip: '1000', city: 'BRUXELLES', country: 'BE' };
const GOOSSENS: EbpThird = { account: '200020', name: 'GOOSSENS FREDERIC', address: '30 RUE DE FAUX', zip: '1490', city: 'Court-Saint-Étienne', country: 'BE', phone: '0474539874' };
const MOREAU: EbpThird = { account: '201324', name: 'MOREAU LAURENT', address: '2 RUE DE MERIVAUX', zip: '1490', city: 'COURT-SAINT-ETIENNE', country: 'BE', phone: '0477860918' };
const BETRI: EbpThird = { account: '200012', name: 'BETRI PASCAL', address: '23 CLOS DU RELAIS', zip: '1300', city: 'WAVRE', country: 'BE', phone: '0495744503' };
const D18 = '2026-11-18';

/** Les documents de G8 (factures 22701456 à 22701459, règlements, mouvements de caisse 2 à 4), dans l'ordre de G8. */
const FIXTURE: EbpSource[] = [
  { kind: 'sale', id: 'f456', journal: 'VE', labelRef: 'F22701456', external: '2701456', date: D18, dueDate: D18, third: DIVERS, ttc: 1.74, sales: [{ account: '411000000', amount: 1.44 }], vat: [{ account: '411000000', amount: 0.30 }] },
  { kind: 'sale', id: 'f457', journal: 'VE', labelRef: 'F22701457', external: '2701457', date: D18, dueDate: D18, third: TESTCLAUDE, ttc: 1.74, sales: [{ account: '41106003', amount: 1.44 }], vat: [{ account: '41106003', amount: 0.30 }] },
  { kind: 'sale', id: 'a458', journal: 'VE', labelRef: 'AVOIR 22701458', external: '2701458', date: D18, dueDate: D18, third: TESTCLAUDE, ttc: -1.74, sales: [{ account: '41106003', amount: -1.44 }], vat: [{ account: '41106003', amount: -0.30 }] },
  { kind: 'sale', id: 'f459', journal: 'VE', labelRef: 'F22701459', external: '2701459', date: D18, dueDate: D18, third: GOOSSENS, ttc: 115.20, sales: [{ account: '200020', amount: 95.21 }], vat: [{ account: '200020', amount: 19.99 }] },
  { kind: 'payment', id: 'p457', journal: 'CA', date: D18, modeLabel: 'ESP', treasuryAccount: '530000', third: TESTCLAUDE, labelRef: 'F22701457', external: '2701457', amount: 1.74 },
  { kind: 'cash_movement', id: 'm2', journal: 'RC', date: D18, direction: 'in', style: 'deposit', text: 'ENCAISSEMENT DEPOT VTE', modeLabel: 'VIR', modeAccount: '511400', counterAccount: '530000', vatAccount: '', amount: 7000, vat: 0, external: '2' },
  { kind: 'payment', id: 'p454', journal: 'CA', date: '2026-07-13', modeLabel: 'ESP', treasuryAccount: '530000', third: MOREAU, labelRef: 'F22701454', external: '2701454', amount: 15.90 },
  { kind: 'payment', id: 'p458', journal: 'CA', date: D18, modeLabel: 'ESP', treasuryAccount: '530000', third: TESTCLAUDE, labelRef: 'AVOIR 22701458', external: '2701458', amount: -1.74 },
  { kind: 'payment', id: 'p456', journal: 'CA', date: D18, modeLabel: 'ESP', treasuryAccount: '530000', third: DIVERS, labelRef: 'F22701456', external: '2701456', amount: 1.74 },
  { kind: 'payment', id: 'p459', journal: 'RC', date: D18, modeLabel: 'CAR', treasuryAccount: '511300', third: GOOSSENS, labelRef: 'F22701459', external: '2701459', amount: 115.20 },
  { kind: 'cash_movement', id: 'm3', journal: 'RC', date: D18, direction: 'out', style: 'generic', text: 'ACHAT DE CONSOM.TEST CONSOMMABLE', modeLabel: 'ESP', modeAccount: '530000', counterAccount: '530000', vatAccount: '', amount: 10, vat: 1.74, external: '3' },
  { kind: 'payment', id: 'r002', journal: 'RC', date: '2026-07-30', modeLabel: 'CAR', treasuryAccount: '511300', third: BETRI, labelRef: 'R3000002', external: '3000002', amount: 722.98 },
  { kind: 'cash_movement', id: 'm4', journal: 'RC', date: D18, direction: 'out', style: 'bank', text: 'REMISE EN BANQUE', modeLabel: 'ESP', modeAccount: '530000', counterAccount: '530000', vatAccount: '', amount: 267.64, vat: 0, external: '4' },
];

describe('ECRITURES.TXT identique à G8 (transfert n° 6 du 18/11/2026)', () => {
  const res = buildEbpTransfer(FIXTURE);
  const produced = res.ecritures.split('\r\n').filter(Boolean);

  test('les 22 lignes du relevé sortent caractère par caractère, dans le même ordre', () => {
    let i = 0;
    for (const line of produced) if (i < G8_LINES.length && line === G8_LINES[i]) i += 1;
    expect(i).toBe(G8_LINES.length);
    for (const l of G8_LINES) expect(produced).toContain(l);
  });

  test('les autres lignes sont exactement celles que le relevé n\'a pas recopiées', () => {
    const extra = produced.filter((l) => !G8_LINES.includes(l));
    expect(extra.sort()).toEqual([...NOT_IN_EXTRACT].sort());
  });

  test('chaque ligne finit par CR LF, chaque pièce est équilibrée', () => {
    expect(res.ecritures.endsWith('\r\n')).toBe(true);
    expect(res.ecritures.split('\r\n').length - 1).toBe(produced.length);
    expect(res.unbalanced).toEqual([]);
    expect(res.totalDebit).toBe(res.totalCredit);
    expect(res.pieces).toBe(13);
  });

  test('un compte non paramétré sort vide (comme G8) mais est signalé', () => {
    expect(res.missingAccounts.map((l) => l.pieceNo)).toEqual([11]);
  });

  test('chaque ligne garde le document d\'origine (marquage « transféré »)', () => {
    const ids = new Set(res.lines.map((l) => `${l.sourceKind}:${l.sourceId}`));
    expect(ids.has('document:f459')).toBe(true);
    expect(ids.has('payment:r002')).toBe(true);
    expect(ids.has('cash_movement:m4')).toBe(true);
  });
});

describe('mise en forme G8', () => {
  test('montant sur 10 caractères, point décimal, signe', () => {
    expect(ebpAmount(1.74)).toBe('      1.74');
    expect(ebpAmount(-95.21)).toBe('    -95.21');
    expect(ebpAmount(7000)).toBe('   7000.00');
    expect(ebpAmount(-0)).toBe('      0.00');
  });
  test('libellés des mouvements de caisse (largeurs relevées)', () => {
    expect(movementLabel('REMISE EN BANQUE', 'ESP', 'bank')).toBe('REMISE EN BANQUE               ESP');
    expect(movementLabel('ENCAISSEMENT DEPOT VTE', 'VIR', 'deposit')).toBe('ENCAISSEMENT DEPOT VTE          VIR');
    expect(movementLabel('ACHAT DE CONSOM.TEST CONSOMMABLE', 'ESP', 'generic')).toBe('ACHAT DE CONSOM.TEST CONSOMMABLE ESP');
  });
  test('accents retirés, majuscules ; ville sans tirets (COURTSAINTETIENNE)', () => {
    expect(ebpCity('Court-Saint-Étienne')).toBe('COURTSAINTETIENNE');
  });
  test('TVA comprise : 10,00 TTC à 21 % = 8,26 + 1,74', () => {
    expect(vatIncluded(10, 21)).toBe(1.74);
  });
});

describe('COMPTES.TXT', () => {
  const res = buildEbpTransfer(FIXTURE);
  const lines = res.comptes.split('\r\n').filter(Boolean);
  test('une fiche par compte de tiers utilisé, doublons gardés comme G8', () => {
    expect(lines.filter((l) => l.startsWith('"200020"')).length).toBe(2);
    expect(lines[0].startsWith('"411000000","CLIENT DIVERS",')).toBe(true);
  });
  test('fiche complète : compte, intitulé, adresse, CP, ville sans tirets, pays, téléphone', () => {
    expect(ebpThirdText(GOOSSENS)).toBe('"200020","GOOSSENS FREDERIC", ,"30 RUE DE FAUX","1490","COURTSAINTETIENNE","BE","0474539874"');
    expect(ebpThirdText(MOREAU)).toContain('"2 RUE DE MERIVAUX","1490","COURTSAINTETIENNE","BE","0477860918"');
  });
  test('option « une fiche par compte »', () => {
    const d = buildEbpTransfer(FIXTURE, { dedupeThirds: true }).comptes.split('\r\n').filter(Boolean);
    expect(d.filter((l) => l.startsWith('"200020"')).length).toBe(1);
  });
});

describe('options du transfert', () => {
  test('règlements en début de fichier', () => {
    const res = buildEbpTransfer(FIXTURE, { paymentsFirst: true });
    expect(res.lines[0].journal).toBe('CA');
    expect(res.lines[0].pieceNo).toBe(1);
  });
  test('écriture semi-globale : une pièce par jour, client détaillé, ventes et TVA cumulées', () => {
    const res = buildEbpTransfer(FIXTURE.filter((s) => s.kind === 'sale'), { writeMode: 'semi_global' });
    expect(res.pieces).toBe(1);
    expect(res.unbalanced).toEqual([]);
    const client = res.lines.filter((l) => l.label.startsWith('F2270145') || l.label.startsWith('AVOIR'));
    expect(client.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------
// Comptes G8 et documents du DMS
// ---------------------------------------------------------------------------------------------
const S = DEFAULT_EBP_SETTINGS;
const rule = (r: Partial<EbpRule>): EbpRule => ({
  kind: 'sales', key: null, family: null, vat_rate: null, tax_exempt: null, demo: null, customer_category: null, account: '',
  account2: null, account3: null, country: null, journal: null, label: null, mode_label: null, is_active: true, ...r,
});
const contact = (c: Partial<ContactRow>): ContactRow => ({
  id: 'c1', code: '6003', company_name: null, first_name: 'Inventaire', last_name: 'Testclaude', address: null, zip: '1000', city: 'Bruxelles', country: 'BE', phone: null, ...c,
});

describe('comptes clients (G8 « Gestion des comptes »)', () => {
  test('création automatique : code 20 → 200020, 1000 → 201000, 1324 → 201324', () => {
    expect(proposeCustomerAccount('20', S)).toBe('200020');
    expect(proposeCustomerAccount('1000', S)).toBe('201000');
    expect(proposeCustomerAccount('1324', S)).toBe('201324');
    expect(proposeCustomerAccount('ABC', S)).toBe(null);
    expect(autoThirdAccount('101', 40100000, 8)).toBe('40100101');
  });
  test('client sans compte : 411 + code sur 5 (41106003), client de passage : 411000000 CLIENT DIVERS', () => {
    expect(onTheFlyAccount('6003', '411', 5)).toBe('41106003');
    const none = new Map<string, ThirdAccountRow>();
    expect(resolveCustomerThird(contact({}), none, S).account).toBe('41106003');
    expect(resolveCustomerThird(null, none, S)).toEqual({ account: '411000000', name: 'CLIENT DIVERS', country: 'BE' });
  });
  test('la table des comptes clients prime sur la fiche et sur le compte à la volée', () => {
    const acc = new Map<string, ThirdAccountRow>([['C:c1', { contact_id: 'c1', kind: 'C', account: '200020', label: 'GOOSSENS FREDERIC' }]]);
    const t = resolveCustomerThird(contact({ accounting_account: '400999' }), acc, S);
    expect(t.account).toBe('200020');
    expect(t.name).toBe('GOOSSENS FREDERIC');
    expect(resolveCustomerThird(contact({ accounting_account: '400999' }), new Map(), S).account).toBe('400999');
  });
});

describe('comptes ventes, TVA, règlements, mouvements', () => {
  const ctx = { reference: 'ABC', family: 'cat-1', vatRate: 21, taxExempt: false, demo: false, customerCategory: null, articleSalesAccount: null, retro: false };
  test('défaut G8 : 707000, rétrocession 710000', () => {
    expect(resolveSalesAccount([], ctx, S)).toBe('707000');
    expect(resolveSalesAccount([], { ...ctx, retro: true }, S)).toBe('710000');
  });
  test('référence > fiche article > famille × TVA × détaxe × démo', () => {
    const rules = [
      rule({ family: 'cat-1', account: '700100' }),
      rule({ family: 'cat-1', demo: true, account: '700300' }),
      rule({ family: 'cat-1', tax_exempt: true, account: '700400' }),
      rule({ key: 'ABC', account: '700500' }),
    ];
    expect(resolveSalesAccount(rules, { ...ctx, reference: 'X' }, S)).toBe('700100');
    expect(resolveSalesAccount(rules, { ...ctx, reference: 'X', demo: true }, S)).toBe('700300');
    expect(resolveSalesAccount(rules, { ...ctx, reference: 'X', taxExempt: true }, S)).toBe('700400');
    expect(resolveSalesAccount(rules, ctx, S)).toBe('700500');
    expect(resolveSalesAccount(rules, { ...ctx, reference: 'X', articleSalesAccount: '700900' }, S)).toBe('700900');
  });
  test('TVA : 445000 par défaut, compte occasion si la distinction est cochée', () => {
    expect(resolveVatAccount([], 21, true, S)).toBe('445000');
    const s2 = parseEbpSettings({ vatMargin: { distinguish: true, vatOccasionAccount: '451100' } });
    expect(resolveVatAccount([], 21, true, s2)).toBe('451100');
    expect(resolveVatAccount([rule({ kind: 'vat', vat_rate: 6, account: '451006' })], 6, false, S)).toBe('451006');
  });
  test('règlements G8 : espèces 530000 / CA, carte 511300 / RC, virement 511400 / RC', () => {
    expect(resolvePayment([], 'ESP', S)).toEqual({ account: '530000', journal: 'CA', modeLabel: 'ESP' });
    expect(resolvePayment([], 'MAE', S)).toEqual({ account: '511300', journal: 'RC', modeLabel: 'CAR' });
    expect(resolvePayment([], 'VIR', S)).toEqual({ account: '511400', journal: 'RC', modeLabel: 'VIR' });
    expect(resolvePayment([], 'PPL', S).account).toBe('511200');
  });
  test('mouvements : compte vide → compte mouvement de caisse 530000, achat de consommables TVA 21 %', () => {
    const m = resolveMovement([], '04', S);
    expect(m).toEqual({ label: 'ACHAT DE CONSOM.', account: '530000', vatAccount: '', vatRate: 21, style: 'generic' });
    const built = buildMovement({ id: 'm3', kind: 'out', method: 'ESP', amount: 10, reason: 'TEST CONSOMMABLE', occurred_at: '2026-11-18T10:00:00Z', type_code: '04', movement_no: 3 }, [], S);
    const res = buildEbpTransfer([built]);
    expect(res.ecritures.split('\r\n')[0]).toBe('00001,"18112026",RC  ,530000      ,,"ACHAT DE CONSOM.TEST CONSOMMABLE ESP","3","     10.00",C,"20261118",');
  });
});

describe('documents du DMS → pièce VE', () => {
  const doc = {
    id: 'd1', doc_type: 'FAC', status: 'validee', number: 'FAC-2026-00012', issue_date: '2026-11-18', due_date: '2026-12-18',
    contact_id: 'c1', total_ht: 95.21, total_vat: 19.99, total_ttc: 115.20, tax_exempt: false,
  };
  const lines = [{ document_id: 'd1', article_id: 'a1', line_type: 'article', vat_rate: 21, line_ht: 95.21, line_ttc: 115.20, reference: 'X' }];
  const articles = new Map([['a1', { id: 'a1', reference: 'X', category_id: null, mgmt_type: 'A', vehicle_id: null, sales_account: null }]]);
  const accounts = new Map<string, ThirdAccountRow>([['C:c1', { contact_id: 'c1', kind: 'C', account: '200020', label: null }]]);
  const base = { doc, lines, articles, demoVehicles: new Set<string>(), contact: contact({ last_name: 'Goossens', first_name: 'Frédéric' }), accounts, rules: [], settings: S };

  test('facture : client 200020 au débit, 707000 et 445000 au crédit, n° externe sans séparateur', () => {
    const sale = buildSaleDoc(base);
    expect(sale.third.account).toBe('200020');
    expect(sale.sales).toEqual([{ account: '707000', amount: 95.21 }]);
    expect(sale.vat).toEqual([{ account: '445000', amount: 19.99 }]);
    const out = buildEbpTransfer([sale]).ecritures.split('\r\n');
    expect(out[0]).toBe('00001,"18112026",VE  ,200020      ,,"FAC-2026-00012 GOOSSENS FREDERIC   ","FAC202600012","    115.20",D,"18122026",');
    expect(out[1]).toBe('00001,"18112026",VE  ,707000      ,,"FAC-2026-00012  GOOSSENS FREDERIC  ","FAC202600012","    -95.21",C,"18122026",');
    expect(out[2]).toBe('00001,"18112026",VE  ,445000      ,,"FAC-2026-00012 GOOSSENS FREDERIC   ","FAC202600012","    -19.99",C,"18122026",');
  });
  test('avoir : libellé AVOIR, sens inversés, journal des avoirs', () => {
    const s2 = parseEbpSettings({ sales: { creditJournal: 'VA' } });
    const avo = buildSaleDoc({ ...base, settings: s2, doc: { ...doc, doc_type: 'AVO', number: 'AVO-2026-00003', total_ht: -95.21, total_vat: -19.99, total_ttc: -115.20 }, lines: [{ ...lines[0], line_ht: -95.21, line_ttc: -115.20 }] });
    const res = buildEbpTransfer([avo]);
    expect(res.lines[0]).toMatchObject({ journal: 'VA', side: 'C', account: '200020' });
    expect(res.lines[0].label.startsWith('AVOIR AVO-2026-00003')).toBe(true);
    expect(res.unbalanced).toEqual([]);
  });
  test('remise globale / arrondis : la pièce colle aux totaux du document', () => {
    const sale = buildSaleDoc({ ...base, doc: { ...doc, total_ht: 90, total_vat: 18.9, total_ttc: 108.9 } });
    expect(buildEbpTransfer([sale]).unbalanced).toEqual([]);
    expect(sale.sales[0].amount).toBe(90);
  });
  test('régime de la marge : aucune TVA, TTC au compte marge occasion', () => {
    const s2 = parseEbpSettings({ vatMargin: { marginAccount: '700200' } });
    const sale = buildSaleDoc({ ...base, settings: s2, doc: { ...doc, vat_scheme: 'marge', total_ht: 8000, total_vat: 0, total_ttc: 8000 }, lines: [{ ...lines[0], line_ht: 8000, line_ttc: 8000, vat_rate: 0 }] });
    expect(sale.sales).toEqual([{ account: '700200', amount: 8000 }]);
    expect(sale.vat).toEqual([]);
  });
  test('facture finale avec acompte facturé : client net, compte acompte et TVA de l\'acompte au débit', () => {
    const s2 = parseEbpSettings({ payments: { depositAccount: '460000' } });
    const sale = buildSaleDoc({ ...base, settings: s2, prepaid: { ht: 50, vat: 10.5, ttc: 60.5 } });
    expect(sale.ttc).toBe(54.7);
    expect(sale.extraDebits).toEqual([{ account: '460000', amount: 50 }, { account: '445000', amount: 10.5 }]);
    expect(buildEbpTransfer([sale]).unbalanced).toEqual([]);
  });
  test('règlement d\'une réservation : libellé « CAR RES-… -NOM », n° externe', () => {
    const p = buildPayment({ id: 'p1', document_id: 'r1', method: 'MAE', amount: 722.98, paid_date: '2026-07-30', doc_number: 'RES-2026-00002', doc_type: 'RES', contact_id: 'c1' }, contact({ last_name: 'Betri', first_name: 'Pascal' }), new Map(), [], S);
    const out = buildEbpTransfer([p]).ecritures.split('\r\n');
    expect(out[0]).toBe('00001,"30072026",RC  ,511300      ,,"CAR RES-2026-00002-BETRI PASCAL    ","RES202600002","    722.98",D,"20260730",');
    expect(out[1]).toContain(',41106003    ,');
  });
  test('n° externe', () => {
    expect(externalNumber('FAC-2026-00012')).toBe('FAC202600012');
  });
});

describe('paramètres', () => {
  test('défauts G8 : EBP actif, ventes + règlements cochés, achats / cessions / dépôts et automatique désactivés', () => {
    const s = parseEbpSettings(null);
    expect(s.enabled).toBe(true);
    expect([s.includeSales, s.includePayments, s.includePurchases, s.includeCessions, s.includeConsignments]).toEqual([true, true, false, false, false]);
    expect(s.auto).toEqual({ frequency: 'off', sendEmail: false, email: '' });
    expect([s.sales.defaultCustomerAccount, s.sales.salesAccount, s.sales.retroAccount, s.sales.vatAccount, s.payments.exceptionalAccount]).toEqual(['411000000', '707000', '710000', '445000', '718000']);
  });
  test('valeur invalide → défaut', () => {
    expect(parseEbpSettings({ writeMode: 'x', auto: { frequency: 'hourly' } })).toMatchObject({ writeMode: 'invoice', auto: { frequency: 'off' } });
  });
  test('transfert automatique dû selon la fréquence', () => {
    expect(autoTransferDue('off', null, '2026-11-18')).toBe(false);
    expect(autoTransferDue('daily', '2026-11-17', '2026-11-18')).toBe(true);
    expect(autoTransferDue('daily', '2026-11-18', '2026-11-18')).toBe(false);
    expect(autoTransferDue('weekly', '2026-11-12', '2026-11-18')).toBe(false);
    expect(autoTransferDue('monthly', '2026-10-31', '2026-11-01')).toBe(true);
  });
});

describe('ligne unitaire', () => {
  test('ebpLineText', () => {
    expect(ebpLineText({ pieceNo: 7, date: '2026-07-13', journal: 'CA', account: '201324', label: 'ESP F22701454-MOREAU LAURENT       ', external: '2701454', amount: 15.9, side: 'C', signed: false, dueDate: '2026-07-13', dueFormat: 'ymd', sourceKind: 'payment', sourceId: 'x' }))
      .toBe('00007,"13072026",CA  ,201324      ,,"ESP F22701454-MOREAU LAURENT       ","2701454","     15.90",C,"20260713",');
  });
});

// Décision de Simon (Q33, 18/11) : pièces sous garantie à 0 € sur la facture client, comptabilité comme G8.
describe('garantie : lignes et factures à 0 €', () => {
  const S0 = DEFAULT_EBP_SETTINGS;
  const articles = new Map([
    ['a1', { id: 'a1', reference: 'X', category_id: null, mgmt_type: 'A', vehicle_id: null, sales_account: null }],
    ['a2', { id: 'a2', reference: 'G-PIECE', category_id: null, mgmt_type: 'A', vehicle_id: null, sales_account: null }],
  ]);
  const doc = {
    id: 'g1', doc_type: 'FAC', status: 'validee', number: 'FAC-2026-00020', issue_date: '2026-11-18', due_date: null,
    contact_id: null, total_ht: 50, total_vat: 10.5, total_ttc: 60.5, tax_exempt: false,
  };
  const base = { articles, demoVehicles: new Set<string>(), contact: null, accounts: new Map<string, ThirdAccountRow>(), rules: [], settings: S0 };

  test('une ligne de garantie à 0 € ne produit ni ligne à 0.00 ni déséquilibre', () => {
    const sale = buildSaleDoc({
      ...base, doc,
      lines: [
        { document_id: 'g1', article_id: 'a1', line_type: 'article', vat_rate: 21, line_ht: 50, line_ttc: 60.5, reference: 'X' },
        { document_id: 'g1', article_id: 'a2', line_type: 'garantie', vat_rate: 21, line_ht: 0, line_ttc: 0, reference: 'G-PIECE' },
      ],
    });
    const res = buildEbpTransfer([sale]);
    expect(res.lines.length).toBe(3);
    expect(res.ecritures.includes('"      0.00"')).toBe(false);
    expect(res.unbalanced).toEqual([]);
  });

  test('une facture entièrement à 0 € (OR 100 % garantie) n\'écrit rien, ne consomme pas de n° et reste marquée transférée', () => {
    const zero = buildSaleDoc({
      ...base, doc: { ...doc, id: 'g0', number: 'FAC-2026-00021', total_ht: 0, total_vat: 0, total_ttc: 0 },
      lines: [{ document_id: 'g0', article_id: 'a2', line_type: 'garantie', vat_rate: 21, line_ht: 0, line_ttc: 0, reference: 'G-PIECE' }],
    });
    const next = buildSaleDoc({ ...base, doc, lines: [{ document_id: 'g1', article_id: 'a1', line_type: 'article', vat_rate: 21, line_ht: 50, line_ttc: 60.5, reference: 'X' }] });
    const res = buildEbpTransfer([zero, next]);
    expect(res.lines.every((l) => l.sourceId === 'g1')).toBe(true);
    expect(res.lines[0].pieceNo).toBe(1);
    expect(res.pieces).toBe(1);
    expect(res.emptySources).toEqual([{ kind: 'document', id: 'g0' }]);
    expect(res.items).toEqual([{ kind: 'document', id: 'g0', piece: null }, { kind: 'document', id: 'g1', piece: 1 }]);
    expect(res.comptes.split('\r\n').filter(Boolean).length).toBe(1);
    const alone = buildEbpTransfer([zero]);
    expect(alone.ecritures).toBe('');
    expect(alone.pieces).toBe(0);
  });
});
