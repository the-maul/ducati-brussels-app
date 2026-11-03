/**
 * Commande demo / courtoisie / showroom (mission 09, carte 6) :
 *   - accessoires uniquement (piece, vetement, inconnue : refusees) ;
 *   - minimum 2 000 EUR par onglet utilise ;
 *   - remplissage du classeur Ducati : D2, blocs motos (I3..O5), Q COMMANDE (colonne L),
 *     autres onglets et formules conserves, reference absente non ecrite ;
 *   - objet du mail et nom du fichier.
 * Le classeur reel (prix concession) n'est pas dans le depot : un petit classeur de meme
 * structure est construit ici. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import * as XLSX from 'xlsx';
import {
  classifyReference, splitAccessories, checkDemoOrder, demoTabTotal, demoMailSubject, demoWorkbookFileName,
  motosForTab, filledMotos, cleanDcsNumber, normalizeRef,
} from '../src/modules/orders/demo-rules';
import {
  fillDucatiWorkbook, readDucatiWorkbook, writeDucatiWorkbook, buildFilledWorkbook, referenceRows, readQtyFor, motoCell,
} from '../src/modules/orders/demo-workbook';

// ---------------------------------------------------------------- accessoires uniquement

const SRC = {
  accessoryRefs: new Set(['96782441AA', '97380182A']),
  apparelRefs: new Set(['981085439']),
  partRefs: new Set(['67090011A']),
};

describe('accessoires uniquement', () => {
  test('un accessoire du classeur est accepte, espaces et casse ignores', () => {
    expect(classifyReference('96782441AA', SRC)).toBe('accessoire');
    expect(classifyReference(' 96782441aa ', SRC)).toBe('accessoire');
    expect(normalizeRef(' 967 824 41aa')).toBe('96782441AA');
  });
  test('une piece detachee, un vetement, une reference inconnue sont refuses avec la raison', () => {
    expect(classifyReference('67090011A', SRC)).toBe('piece');
    expect(classifyReference('981085439', SRC)).toBe('vetement');
    expect(classifyReference('ZZZ', SRC)).toBe('inconnu');
    expect(classifyReference('', SRC)).toBe('inconnu');
  });
  test('splitAccessories separe acceptees et refusees', () => {
    const r = splitAccessories(['96782441AA', '67090011A', '981085439', 'ZZZ'], SRC);
    expect(r.accepted).toEqual(['96782441AA']);
    expect(r.refused).toEqual([
      { reference: '67090011A', kind: 'piece' }, { reference: '981085439', kind: 'vetement' }, { reference: 'ZZZ', kind: 'inconnu' },
    ]);
  });
});

// ---------------------------------------------------------------- minimum par onglet

describe('minimum 2 000 EUR par onglet', () => {
  test('onglet utilise sous le minimum → bloque, avec ce qui manque', () => {
    const r = checkDemoOrder([{ tab: 'demo', priceDealer: 810.4, qty: 2 }], 2000);
    expect(r.ok).toBe(false);
    expect(r.tabsWithLines).toEqual(['demo']);
    expect(r.belowMin).toEqual([{ tab: 'demo', total: 1620.8, min: 2000, missing: 379.2 }]);
  });
  test('chaque onglet utilise doit atteindre le minimum ; un onglet vide ne compte pas', () => {
    const lines = [
      { tab: 'demo' as const, priceDealer: 810.4, qty: 3 },          // 2 431,20
      { tab: 'courtoisie' as const, priceDealer: 100, qty: 5 },      // 500
    ];
    const r = checkDemoOrder(lines, 2000);
    expect(r.ok).toBe(false);
    expect(r.belowMin.map((b) => b.tab)).toEqual(['courtoisie']);
    expect(checkDemoOrder(lines.slice(0, 1), 2000).ok).toBe(true);
  });
  test('quantite 0 ignoree, panier vide refuse, minimum 0 = pas de controle', () => {
    expect(demoTabTotal([{ tab: 'demo', priceDealer: 500, qty: 0 }], 'demo')).toBe(0);
    const empty = checkDemoOrder([{ tab: 'demo', priceDealer: 500, qty: 0 }], 2000);
    expect(empty.empty).toBe(true);
    expect(empty.ok).toBe(false);
    expect(checkDemoOrder([{ tab: 'showroom', priceDealer: 10, qty: 1 }], 0).ok).toBe(true);
  });
  test('le reglage de Parametres est suivi (minimum 2 500)', () => {
    const r = checkDemoOrder([{ tab: 'demo', priceDealer: 1100, qty: 2 }], 2500);
    expect(r.belowMin[0].missing).toBe(300);
  });
});

// ---------------------------------------------------------------- classeur

/** Classeur de test : 3 onglets a la structure Ducati + un onglet « Feuil2 » (concessions). */
function templateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const name of ['Demo', 'Courtoisie', 'Showroom']) {
    const aoa: (string | number | null)[][] = [];
    aoa[1] = ['Renseignez votre code concession >>', null, 'Code concession', null, 'Extra-remise', null, null, name.toUpperCase(), 'Moto 1', null, 'Moto 2', null, 'Moto 3', null, 'Moto 4'];
    aoa[2] = [null, null, 'Nom concession', null, null, null, null, 'Modele moto'];
    aoa[3] = [null, null, 'Concession cross', null, null, null, null, 'Numero de commande'];
    aoa[4] = [null, null, 'Montant de commande remise minimum', '2 000 euros', null, null, null, 'Numero de serie'];
    aoa[9] = ['FAMILLE', 'CATEGORIES FR', 'REFERENCE', 'DESCRIPTION FR', 'VARIANTES', 'MODELS <= MY24', 'MODELS MY25/26', 'Masterbook', 'CLASSE DE REMISE', 'PRIX AU PUBLIC', 'Dealer PRICE', 'Q COMMANDE', 'Valeur', 'Extra', 'Final'];
    aoa[10] = ['Multistrada', 'TOURING', '96782441AA', 'Valises laterales', '', '', '', 'NEW 26', 'H', 1157.72, 810.4, null, null, 0.18, null];
    aoa[11] = ['Scrambler', 'CARBONE', '97380182A', 'Grille phare', '', '', '', '', 'I', 65.16, 45.6, null, null, 0.18, null];
    aoa[12] = ['Monster', 'TOURING', ' 96780001 AB ', 'Sacoche', '', '', '', '', 'H', 100, 70, null, null, 0.18, null];
    for (let i = 0; i < aoa.length; i++) if (!aoa[i]) aoa[i] = [];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Formules du classeur Ducati (avec leur valeur en cache, comme dans le fichier reel) :
    // M = K x L, O = M - M x N, D7 total.
    for (const r of [11, 12, 13]) {
      ws[`M${r}`] = { t: 'n', v: 0, f: `(K${r}*L${r})` };
      ws[`O${r}`] = { t: 'n', v: 0, f: `M${r}-(M${r}*N${r})` };
    }
    ws.D7 = { t: 'n', v: 0, f: 'SUMPRODUCT(M11:M1803)' };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Dealer Code', 'Dealer Name'], [100645, 'Ducati Bruxelles']]), 'Feuil2');
  return wb;
}

describe('remplissage du classeur Ducati', () => {
  test('index des references : a partir de la ligne 11, normalisees', () => {
    const rows = referenceRows(templateWorkbook().Sheets.Demo);
    expect(rows.get('96782441AA')).toBe(11);
    expect(rows.get('97380182A')).toBe(12);
    expect(rows.get('96780001AB')).toBe(13);
    expect(rows.has('REFERENCE')).toBe(false);
  });
  test('cellules des blocs motos : I3/K3/M3/O3 modele, ligne 4 n° commande, ligne 5 n° serie', () => {
    expect(motoCell(0, 'model')).toBe('I3');
    expect(motoCell(1, 'orderNo')).toBe('K4');
    expect(motoCell(3, 'serial')).toBe('O5');
  });
  test('D2, Q COMMANDE (L) et H2… sont remplis ; reference absente signalee, non ecrite', () => {
    const wb = templateWorkbook();
    const report = fillDucatiWorkbook(wb, {
      dealerCode: '100645',
      lines: [
        { tab: 'demo', reference: '96782441AA', qty: 2 },
        { tab: 'demo', reference: '97380182a', qty: 1 },
        { tab: 'demo', reference: '67090011A', qty: 1 },           // piece : pas dans le classeur
        { tab: 'courtoisie', reference: '96780001AB', qty: 3 },
      ],
      motos: { demo: [{ model: 'Multistrada V4 S', orderNo: 'CMD-77', serial: 'ZDMAA00AAPB000001' }], courtoisie: [] },
    });
    expect(report.written).toEqual({ demo: 2, courtoisie: 1, showroom: 0 });
    expect(report.unknown).toEqual([{ tab: 'demo', reference: '67090011A' }]);
    const demo = wb.Sheets.Demo;
    expect(demo.D2.v).toBe(100645);
    expect(demo.L11.v).toBe(2);
    expect(demo.L12.v).toBe(1);
    expect(demo.L13).toBeUndefined();
    expect(demo.I3.v).toBe('Multistrada V4 S');
    expect(demo.I4.v).toBe('CMD-77');
    expect(demo.I5.v).toBe('ZDMAA00AAPB000001');
    expect(demo.K3).toBeUndefined();
    expect(wb.Sheets.Courtoisie.L13.v).toBe(3);
    expect(wb.Sheets.Courtoisie.D2.v).toBe(100645);
    expect(wb.Sheets.Showroom.D2.v).toBe(100645);
    // Formules et autres onglets conserves.
    expect(demo.M11.f).toBe('(K11*L11)');
    expect(demo.D7.f).toBe('SUMPRODUCT(M11:M1803)');
    expect(wb.SheetNames).toEqual(['Demo', 'Courtoisie', 'Showroom', 'Feuil2']);
  });
  test('une meme reference deux fois sur un onglet : quantites additionnees', () => {
    const wb = templateWorkbook();
    fillDucatiWorkbook(wb, { dealerCode: '100645', lines: [{ tab: 'demo', reference: '96782441AA', qty: 1 }, { tab: 'demo', reference: '96782441AA', qty: 2 }] });
    expect(wb.Sheets.Demo.L11.v).toBe(3);
  });
  test('aller-retour octets : le classeur rempli se relit avec ses valeurs, formules et onglets', () => {
    const template = writeDucatiWorkbook(templateWorkbook());
    const { bytes, report } = buildFilledWorkbook(template, {
      dealerCode: '100645', lines: [{ tab: 'showroom', reference: '97380182A', qty: 4 }],
      motos: { showroom: [{ model: 'MTS V4 PP', orderNo: '', serial: '' }, { model: 'Panigale V4', orderNo: 'X1', serial: 'S2' }] },
    });
    expect(report.written.showroom).toBe(1);
    const back = readDucatiWorkbook(bytes);
    expect(back.SheetNames).toEqual(['Demo', 'Courtoisie', 'Showroom', 'Feuil2']);
    expect(readQtyFor(back, 'showroom', '97380182A')).toBe(4);
    expect(readQtyFor(back, 'demo', '97380182A')).toBeNull();
    expect(back.Sheets.Showroom.D2.v).toBe(100645);
    expect(back.Sheets.Showroom.I3.v).toBe('MTS V4 PP');
    expect(back.Sheets.Showroom.K3.v).toBe('Panigale V4');
    expect(back.Sheets.Showroom.K4.v).toBe('X1');
    expect(back.Sheets.Showroom.M11.f).toBe('(K11*L11)');
    expect(back.Sheets.Feuil2.A2.v).toBe(100645);
  });
});

// ---------------------------------------------------------------- motos, mail, fichier, DCS

describe('motos de demo, mail, fichier, numero DCS', () => {
  test('4 blocs par onglet, completes a blanc ; motos renseignees = au moins un champ', () => {
    const motos = motosForTab({ demo: [{ model: 'V4', orderNo: '', serial: '' }] }, 'demo');
    expect(motos).toHaveLength(4);
    expect(filledMotos(motos)).toHaveLength(1);
    expect(motosForTab(null, 'courtoisie').every((m) => m.model === '' && m.orderNo === '' && m.serial === '')).toBe(true);
  });
  test('objet « Commande <onglet> — <societe> — <date> »', () => {
    expect(demoMailSubject(['demo'], 'Ducati Bruxelles', new Date(2026, 10, 3))).toBe('Commande Demo — Ducati Bruxelles — 03/11/2026');
    expect(demoMailSubject(['demo', 'courtoisie'], 'Ducati Bruxelles', new Date(2026, 10, 3))).toBe('Commande Demo + Courtoisie — Ducati Bruxelles — 03/11/2026');
    expect(demoMailSubject([], 'X', new Date(2026, 0, 9))).toBe('Commande Demo — X — 09/01/2026');
  });
  test('nom du classeur conserve', () => {
    expect(demoWorkbookFileName('CEX-2026-0001', ['showroom'], new Date(Date.UTC(2026, 10, 3)))).toBe('Commande_Showroom_CEX-2026-0001_2026-11-03.xlsx');
  });
  test('numero DCS : vide = null, sinon tronque a 40', () => {
    expect(cleanDcsNumber('  ')).toBeNull();
    expect(cleanDcsNumber(' 123456 ')).toBe('123456');
    expect(cleanDcsNumber('x'.repeat(50))!.length).toBe(40);
  });
});
