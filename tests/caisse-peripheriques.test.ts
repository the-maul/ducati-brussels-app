/**
 * Tests PDV030 (03/11/2026) — postes et peripheriques, « aucun materiel impose » :
 *  - generation ESC/POS d'un ticket : octets attendus (initialisation, table PC858, accents, euro),
 *    coupe du papier, impulsion du tiroir (broche 2 / 5) ;
 *  - choix du pilote par role (A4 historique sans poste, navigateur, Epson, Star, Web Serial,
 *    WebUSB, relais, contenu mixte HTTP sous HTTPS) ;
 *  - mise en page 80 / 58 mm (colonnes, lignes jamais plus longues que le papier, page HTML) ;
 *  - ticket legal (societe, TVA, n°, date et heure, caisse, Z, TVA par taux, paiements, rendu,
 *    duplicata, regime de la marge) ; protocoles Epson ePOS / Star WebPRNT / Zebra ZPL.
 */
import { test, expect, describe } from 'bun:test';
import {
  CMD_CUT_PARTIAL, CMD_INIT, CMD_CODEPAGE_PC858, cmdPulse, encodePc858, escposDrawerOnly, escposReceipt, toHex, cmdBarcode128,
} from '../src/lib/devices/escpos';
import { layoutReceipt, pairLines, receiptAmount, receiptColumns, wrapText, plainText, type ReceiptLine } from '../src/lib/devices/receipt';
import { browserReceiptGeometry, receiptHtml } from '../src/lib/devices/receipt-html';
import { resolveDrawer, resolveLabel, resolveReceipt, receiptWidth } from '../src/lib/devices/resolve';
import {
  CONNECTIONS, DEVICE_ROLES, ROLE_CONNECTIONS, connectionProblem, parseDeviceConfig,
  type BrowserCaps, type Connection, type DeviceConfig, type DeviceRole, type WorkstationDevice,
} from '../src/lib/devices/types';
import {
  eposEnvelope, eposUrl, parseEposResponse, parseStarResponse, starEnvelope, starRequest, starUrl, zebraUrl, zplLabels,
} from '../src/lib/devices/protocols';
import { printReceipt, EMPTY_DEVICE_CONTEXT } from '../src/lib/devices';
import { buildTicketReceipt, buildTestReceipt, type TicketReceiptInput } from '../src/modules/sales/receipt-ticket';
import { zplFromLabelData } from '../src/modules/articles/labels/device-print';
import { fr } from '../src/lib/i18n/fr';

const HTTPS_PAGE: BrowserCaps = { secureContext: true, pageHttps: true, webSerial: true, webUsb: true };
const PLAIN_BROWSER: BrowserCaps = { secureContext: true, pageHttps: true, webSerial: false, webUsb: false };

const dev = (role: DeviceRole, connection: Connection, config: DeviceConfig = {}): WorkstationDevice => ({
  id: `d-${role}`, company_id: 'c', workstation_id: 'w', role, connection, label: null, config, is_active: true,
  last_test_at: null, last_test_ok: null, last_test_message: null,
});

const bytesOf = (u: Uint8Array) => Array.from(u);
const indexOfSeq = (hay: number[], needle: number[]) => {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((b, j) => hay[i + j] === b)) return i;
  return -1;
};

// ------------------------------------------------------------------ ESC/POS
describe('ESC/POS : octets du ticket', () => {
  const lines: ReceiptLine[] = [
    { kind: 'text', text: 'ITALBIKE', align: 'center', bold: true, large: true },
    { kind: 'text', text: 'Café 12,50 €', align: 'left', bold: false, large: false },
  ];

  test('initialisation ESC @ puis table PC858 (ESC t 19) en tete', () => {
    const b = bytesOf(escposReceipt(lines));
    expect(b.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(b.slice(2, 5)).toEqual([0x1b, 0x74, 19]);
    expect(CMD_INIT).toEqual([0x1b, 0x40]);
    expect(CMD_CODEPAGE_PC858).toEqual([0x1b, 0x74, 0x13]);
  });

  test('coupe partielle GS V 66 0 apres 4 lignes d avance, en fin de ticket', () => {
    const b = bytesOf(escposReceipt(lines));
    expect(b.slice(-7)).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00]);
    expect(CMD_CUT_PARTIAL).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  test('sans coupe : pas de GS V', () => {
    const b = bytesOf(escposReceipt(lines, { cut: false }));
    expect(indexOfSeq(b, [0x1d, 0x56])).toBe(-1);
  });

  test('impulsion tiroir ESC p 0 25 250 (broche 2) juste apres l initialisation', () => {
    expect(cmdPulse(2)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(cmdPulse(5)).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
    const b = bytesOf(escposReceipt(lines, { drawer: true }));
    expect(b.slice(5, 10)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(indexOfSeq(bytesOf(escposReceipt(lines)), [0x1b, 0x70])).toBe(-1);
  });

  test('tiroir seul : ESC @ + impulsion, rien d autre (pas de papier)', () => {
    expect(bytesOf(escposDrawerOnly())).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(bytesOf(escposDrawerOnly(5))).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });

  test('accents et euro en PC858, ligature oe, caractere inconnu = « ? »', () => {
    expect(encodePc858('é')).toEqual([0x82]);
    expect(encodePc858('è à ç')).toEqual([0x8a, 0x20, 0x85, 0x20, 0x87]);
    expect(encodePc858('€')).toEqual([0xd5]);
    expect(encodePc858('É')).toEqual([0x90]);
    expect(encodePc858('œ')).toEqual([0x6f, 0x65]);
    expect(encodePc858('ā')).toEqual([0x61]); // accent inconnu : lettre de base
    expect(encodePc858('✓')).toEqual([0x3f]);
  });

  test('alignement centre + gras + double taille sur la 1re ligne, retour a la normale ensuite', () => {
    const b = bytesOf(escposReceipt(lines));
    const first = indexOfSeq(b, [0x1b, 0x61, 1]);
    expect(first).toBeGreaterThan(0);
    expect(indexOfSeq(b, [0x1b, 0x45, 1])).toBeGreaterThan(first);
    expect(indexOfSeq(b, [0x1d, 0x21, 0x11])).toBeGreaterThan(first);
    const text = encodePc858('Café 12,50 €');
    const at = indexOfSeq(b, text);
    expect(at).toBeGreaterThan(0);
    expect(b[at + text.length]).toBe(0x0a);
    // avant la 2e ligne : alignement gauche, gras off, taille normale
    const before = b.slice(0, at);
    expect(indexOfSeq(before, [0x1b, 0x61, 0])).toBeGreaterThan(first);
    expect(indexOfSeq(before, [0x1b, 0x45, 0])).toBeGreaterThan(0);
    expect(indexOfSeq(before, [0x1d, 0x21, 0x00])).toBeGreaterThan(0);
  });

  test('code-barres CODE128 jeu B : GS k 73 n {B + donnees', () => {
    const b = cmdBarcode128('TIK-2026-00012');
    const k = indexOfSeq(b, [0x1d, 0x6b, 73]);
    expect(k).toBeGreaterThan(0);
    expect(b[k + 3]).toBe(2 + 'TIK-2026-00012'.length);
    expect(b.slice(k + 4, k + 6)).toEqual([0x7b, 0x42]);
    expect(String.fromCharCode(...b.slice(k + 6, k + 6 + 14))).toBe('TIK-2026-00012');
    expect(cmdBarcode128('')).toEqual([]);
  });

  test('hexadecimal pour la balise <command> d Epson', () => {
    expect(toHex(Uint8Array.from([0x1b, 0x40, 0x0a, 0xd5]))).toBe('1B400AD5');
  });
});

// ------------------------------------------------------------------ Mise en page
describe('Mise en page 80 / 58 mm', () => {
  test('colonnes : imprimante 48 / 32, navigateur 42 / 32', () => {
    expect(receiptColumns(80)).toBe(48);
    expect(receiptColumns(58)).toBe(32);
    expect(receiptColumns(80, 'browser')).toBe(42);
    expect(receiptColumns(58, 'browser')).toBe(32);
  });

  test('paire libelle / montant : exactement la largeur, montant a droite', () => {
    const [l] = pairLines('Total', '12,50', 32);
    expect(l.length).toBe(32);
    expect(l.startsWith('Total')).toBe(true);
    expect(l.endsWith('12,50')).toBe(true);
    const long = pairLines('Huile moteur Shell Advance 4T Ultra 15W-50 synthetique 4 litres', '89,90', 32);
    expect(long.every((x) => x.length <= 32)).toBe(true);
    expect(long[long.length - 1].endsWith('89,90')).toBe(true);
  });

  test('retour a la ligne : aucun morceau plus long que la largeur, mot trop long coupe', () => {
    const w = wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 fin', 10);
    expect(w.every((x) => x.length <= 10)).toBe(true);
    expect(w.join('')).toContain('ABCDEFGHIJ');
  });

  test('ligne large = moitie des colonnes', () => {
    const lines = layoutReceipt([{ kind: 'pair', left: 'TOTAL', right: '1 234,56 EUR', large: true }], 48);
    expect(lines).toHaveLength(1);
    expect((lines[0] as { text: string }).text.length).toBe(24);
  });

  test('espaces insecables et guillemets courbes ramenes au papier', () => {
    expect(plainText('1\u202f234,50\u00a0€ \u2019a\u2019 \u2013')).toBe("1 234,50 € 'a' -");
    expect(receiptAmount(1234.5)).toBe('1 234,50');
    expect(receiptAmount(-3)).toBe('-3,00');
  });

  test('page HTML du navigateur : @page a la largeur du rouleau et a la hauteur du ticket', () => {
    const doc = buildTestReceipt((k) => k, 'Caisse 1', new Date(2026, 10, 3, 14, 5));
    const h80 = receiptHtml(doc, 80, false);
    expect(h80).toMatch(/@page \{ size: 80mm \d+mm; margin: 0; \}/);
    expect(h80).toContain('data-cols="42"');
    const h58 = receiptHtml(doc, 58, false);
    expect(h58).toMatch(/@page \{ size: 58mm \d+mm; margin: 0; \}/);
    expect(h58).toContain('data-cols="32"');
    expect(h80).not.toContain('window.print');
    expect(receiptHtml(doc, 80)).toContain('window.print');
    // 32 caracteres Courier (0,6 em) tiennent dans 54 mm imprimables
    const g = browserReceiptGeometry(58);
    expect(g.cols * g.fontMm * 0.6).toBeLessThanOrEqual(g.printableMm + 0.01);
  });
});

// ------------------------------------------------------------------ Choix du pilote
describe('Choix du pilote', () => {
  test('aucun poste / aucun appareil : impression A4 historique (rien ne casse avant la migration)', () => {
    expect(resolveReceipt([], HTTPS_PAGE).kind).toBe('legacy_a4');
    expect(resolveReceipt(null, HTTPS_PAGE).kind).toBe('legacy_a4');
    expect(resolveDrawer([], HTTPS_PAGE).kind).toBe('none');
    expect(resolveLabel([], HTTPS_PAGE).kind).toBe('browser');
  });

  test('imprimante ticket : navigateur, Epson, Star, Web Serial, WebUSB, aucun', () => {
    expect(resolveReceipt([dev('receipt_printer', 'browser')], HTTPS_PAGE).kind).toBe('browser');
    expect(resolveReceipt([dev('receipt_printer', 'epson_epos', { host: '192.168.1.50', https: true })], HTTPS_PAGE).kind).toBe('epson');
    expect(resolveReceipt([dev('receipt_printer', 'star_webprnt', { host: '192.168.1.51', https: true })], HTTPS_PAGE).kind).toBe('star');
    expect(resolveReceipt([dev('receipt_printer', 'web_serial')], HTTPS_PAGE).kind).toBe('serial');
    expect(resolveReceipt([dev('receipt_printer', 'web_usb')], HTTPS_PAGE).kind).toBe('usb');
    expect(resolveReceipt([dev('receipt_printer', 'none')], HTTPS_PAGE).kind).toBe('none');
  });

  test('indisponible : HTTP sous HTTPS, IP manquante, ESC/POS brut, relais prevu, Web Serial absent', () => {
    expect(resolveReceipt([dev('receipt_printer', 'epson_epos', { host: '192.168.1.50', https: false })], HTTPS_PAGE).problem).toBe('mixedContent');
    expect(resolveReceipt([dev('receipt_printer', 'epson_epos', { host: '192.168.1.50' })], { ...HTTPS_PAGE, pageHttps: false }).kind).toBe('epson');
    expect(resolveReceipt([dev('receipt_printer', 'star_webprnt', {})], HTTPS_PAGE).problem).toBe('noHost');
    expect(resolveReceipt([dev('receipt_printer', 'escpos_network', { host: '10.0.0.9', port: 9100 })], HTTPS_PAGE).problem).toBe('needsRelay');
    expect(resolveReceipt([dev('receipt_printer', 'relay_qz')], HTTPS_PAGE).problem).toBe('planned');
    expect(resolveReceipt([dev('receipt_printer', 'web_serial')], PLAIN_BROWSER).problem).toBe('noWebSerial');
    expect(resolveReceipt([dev('receipt_printer', 'web_usb')], PLAIN_BROWSER).problem).toBe('noWebUsb');
  });

  test('appareil inactif = ignore', () => {
    const d = { ...dev('receipt_printer', 'epson_epos', { host: 'x', https: true }), is_active: false };
    expect(resolveReceipt([d], HTTPS_PAGE).kind).toBe('legacy_a4');
  });

  test('tiroir via l imprimante : impulsion ESC/POS (Epson, serie, USB), Star, pilote Windows', () => {
    const epson = dev('receipt_printer', 'epson_epos', { host: '192.168.1.50', https: true, drawerViaPrinter: true });
    expect(resolveDrawer([epson], HTTPS_PAGE)).toMatchObject({ kind: 'escpos', via: 'epson', pin: 2 });
    expect(resolveDrawer([dev('receipt_printer', 'web_usb', { drawerViaPrinter: true, drawerPin: 5 })], HTTPS_PAGE)).toMatchObject({ kind: 'escpos', via: 'usb', pin: 5 });
    expect(resolveDrawer([dev('receipt_printer', 'star_webprnt', { host: 'x', https: true, drawerViaPrinter: true })], HTTPS_PAGE).kind).toBe('star');
    expect(resolveDrawer([dev('receipt_printer', 'browser', { drawerViaPrinter: true })], HTTPS_PAGE).kind).toBe('driver_setting');
    // case decochee et pas de ligne tiroir : rien
    expect(resolveDrawer([dev('receipt_printer', 'epson_epos', { host: 'x', https: true })], HTTPS_PAGE).kind).toBe('none');
    // ligne tiroir « branche sur l imprimante » : prime sur la case
    expect(resolveDrawer([dev('receipt_printer', 'epson_epos', { host: 'x', https: true }), dev('cash_drawer', 'via_receipt_printer')], HTTPS_PAGE).kind).toBe('escpos');
    // ligne tiroir « aucun » : prime sur la case cochee
    expect(resolveDrawer([epson, dev('cash_drawer', 'none')], HTTPS_PAGE).kind).toBe('none');
    // tiroir USB serie autonome
    expect(resolveDrawer([dev('cash_drawer', 'web_serial')], HTTPS_PAGE).kind).toBe('serial_drawer');
    // tiroir via l imprimante mais pas d imprimante
    expect(resolveDrawer([dev('cash_drawer', 'via_receipt_printer')], HTTPS_PAGE)).toMatchObject({ kind: 'unavailable', problem: 'noPrinter' });
  });

  test('etiquettes : Zebra reseau, Web Serial, navigateur, aucun', () => {
    expect(resolveLabel([dev('label_printer', 'zebra_zpl_network', { host: '192.168.1.60', https: true })], HTTPS_PAGE).kind).toBe('zebra');
    expect(resolveLabel([dev('label_printer', 'web_serial')], HTTPS_PAGE).kind).toBe('serial');
    expect(resolveLabel([dev('label_printer', 'browser')], HTTPS_PAGE).kind).toBe('browser');
    expect(resolveLabel([dev('label_printer', 'none')], HTTPS_PAGE).kind).toBe('none');
  });

  test('largeur : celle de l imprimante, sinon le reglage de la societe', () => {
    expect(receiptWidth(dev('receipt_printer', 'browser', { paperWidth: 58 }), 80)).toBe(58);
    expect(receiptWidth(dev('receipt_printer', 'browser'), 58)).toBe(58);
    expect(receiptWidth(null, 80)).toBe(80);
  });

  test('chaque role propose « aucun » et des connexions connues ; chaque libelle existe en FR', () => {
    for (const role of DEVICE_ROLES) {
      expect(ROLE_CONNECTIONS[role][0]).toBe('none');
      for (const c of ROLE_CONNECTIONS[role]) expect(CONNECTIONS).toContain(c);
      expect((fr.devices as Record<string, unknown>)[`role_${role}`]).toBeTruthy();
    }
    for (const c of CONNECTIONS) expect((fr.devices as Record<string, unknown>)[`conn_${c}`]).toBeTruthy();
    for (const w of ['planned', 'needsRelay', 'noWebSerial', 'noWebUsb', 'noHost', 'mixedContent']) {
      expect((fr.devices as Record<string, unknown>)[`why_${w}`]).toBeTruthy();
      expect((fr.devices.result as Record<string, unknown>)[w]).toBeTruthy();
    }
    expect(connectionProblem('browser', {}, PLAIN_BROWSER)).toBeNull();
  });

  test('configuration enregistree : valeurs invalides ecartees, IP nettoyee', () => {
    expect(parseDeviceConfig({ host: ' https://192.168.1.50/ ', port: '9100', paperWidth: 76, drawerPin: 3, https: 'oui', dpi: 300, baudRate: 1234 }))
      .toEqual({ host: '192.168.1.50', port: 9100, dpi: 300 });
    expect(parseDeviceConfig(null)).toEqual({});
    expect(parseDeviceConfig({ paperWidth: '58', drawerViaPrinter: true, drawerPin: 5 })).toEqual({ paperWidth: 58, drawerViaPrinter: true, drawerPin: 5 });
  });

  test('facade : sans poste, printReceipt appelle l impression A4 historique', async () => {
    let called = 0;
    const r = await printReceipt({ ...EMPTY_DEVICE_CONTEXT, caps: HTTPS_PAGE }, buildTestReceipt((k) => k, null), { legacyA4: () => { called++; } });
    expect(called).toBe(1);
    expect(r).toMatchObject({ ok: true, driver: 'legacy_a4' });
  });

  test('facade : HTTP sous HTTPS refuse avant tout envoi (message clair)', async () => {
    const ctx = { ...EMPTY_DEVICE_CONTEXT, caps: HTTPS_PAGE, devices: [dev('receipt_printer', 'epson_epos', { host: '192.168.1.50' })] };
    const r = await printReceipt(ctx, buildTestReceipt((k) => k, null));
    expect(r).toMatchObject({ ok: false, code: 'mixedContent', driver: 'unavailable' });
  });
});

// ------------------------------------------------------------------ Protocoles reseau
describe('Protocoles Epson ePOS / Star WebPRNT / Zebra', () => {
  const cfg: DeviceConfig = { host: '192.168.1.50', https: true };

  test('Epson : adresse service.cgi, enveloppe SOAP avec <command> hexadecimal', () => {
    expect(eposUrl(cfg)).toBe('https://192.168.1.50/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000');
    expect(eposUrl({ ...cfg, https: false, port: 8008, deviceId: 'printer2' })).toBe('http://192.168.1.50:8008/cgi-bin/epos/service.cgi?devid=printer2&timeout=10000');
    const env = eposEnvelope(escposDrawerOnly());
    expect(env).toContain('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">');
    expect(env).toContain('<command>1B401B700019FA</command>');
    expect(parseEposResponse('<response success="true" code="" status="251658262" battery="0"/>')).toEqual({ ok: true, code: null });
    expect(parseEposResponse('<response success="false" code="EPTR_COVER_OPEN" status="0"/>')).toEqual({ ok: false, code: 'EPTR_COVER_OPEN' });
  });

  test('Star : SendMessage, <root>, impulsion <peripheral>, coupe, requete echappee dans l enveloppe', () => {
    expect(starUrl(cfg)).toBe('https://192.168.1.50/StarWebPRNT/SendMessage');
    const lines = layoutReceipt([{ kind: 'text', text: 'A & B <ok>', bold: true }], 48);
    const req = starRequest(lines, { drawer: true });
    expect(req.startsWith('<root><initialization/><peripheral channel="1" on="200"/>')).toBe(true);
    expect(req).toContain('<text emphasis="true" width="1" height="1">A &amp; B &lt;ok&gt;&#10;</text>');
    expect(req.endsWith('<cutpaper feed="true" type="partial"/></root>')).toBe(true);
    expect(starRequest(lines, { drawer: true, drawerPin: 5 })).toContain('<peripheral channel="2"');
    const env = starEnvelope(req);
    expect(env).toContain('<Request>&lt;root&gt;');
    expect(env).not.toContain('<Request><root>');
    expect(parseStarResponse('<root><success>true</success><code>0</code></root>').ok).toBe(true);
    expect(parseStarResponse('<root><success>false</success><code>2001</code></root>')).toEqual({ ok: false, code: '2001' });
  });

  test('Zebra : /pstprnt, ZPL a la taille de l etiquette, quantite, caracteres de commande retires', () => {
    expect(zebraUrl(cfg)).toBe('https://192.168.1.50/pstprnt');
    const zpl = zplLabels([{ reference: 'ABC^1', designation: 'Gants ~ cuir', price: '49,90 EUR', barcode: 'ABC1', qty: 3 }], { labelWidthMm: 50, labelHeightMm: 30, dpi: 203 });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl).toContain('^CI28');
    expect(zpl).toContain('^PW400');
    expect(zpl).toContain('^LL240');
    expect(zpl).toContain('^FDABC 1^FS');
    expect(zpl).toContain('^FDGants   cuir^FS');
    expect(zpl).toContain('^BCN');
    expect(zpl).toContain('^PQ3');
    expect(zpl.trim().endsWith('^XZ')).toBe(true);
    expect(zplLabels([{ reference: 'X', designation: 'Y', price: null, barcode: '', qty: 1 }], { dpi: 300 })).toContain('^PW600');
  });

  test('etiquette ZPL depuis les donnees du gabarit (promo > TTC)', () => {
    const z = zplFromLabelData({
      reference: '96780', designation: 'Casque', price_ttc: 450, price_ht: 371.9, price_promo: 399, discount: null,
      store_name: 'X', bin: null, bin2: null, pack_qty: null, barcode_value: '96780',
    }, 2);
    expect(z).toEqual({ reference: '96780', designation: 'Casque', barcode: '96780', price: '399,00 EUR', qty: 2 });
  });
});

// ------------------------------------------------------------------ Ticket legal
const tr = (key: string, vars?: Record<string, string | number>) => {
  let s = String((fr.devices.receipt as Record<string, string>)[key] ?? key);
  for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
  return s;
};

const baseTicket = (over: Partial<TicketReceiptInput> = {}): TicketReceiptInput => ({
  company: { name: 'ITALBIKE STORE', legalName: 'ITALBIKE STORE SRL', address: 'Chaussee de Bruxelles 1', zip: '1410', city: 'Waterloo', vatNumber: 'BE0123456789', companyNumber: '0123.456.789', phone: '02 000 00 00' },
  doc: {
    docType: 'TIK', number: 'TIK-2026-00012', issuedAt: new Date(2026, 10, 3, 14, 32), operator: 'Simon',
    totalHt: 61.98, totalVat: 12.02, totalTtc: 74, taxExempt: false, marge: false,
  },
  client: null,
  lines: [
    { lineType: 'article', designation: 'Gants Ducati Corse', reference: '981073', quantity: 1, unitPriceHt: 49.5868, vatRate: 21, discountPct: 0, lineTtc: 60 },
    { lineType: 'article', designation: 'Livre Ducati', reference: null, quantity: 2, unitPriceHt: 6.6038, vatRate: 6, discountPct: 0, lineTtc: 14 },
    { lineType: 'vide', designation: '', quantity: 0, unitPriceHt: 0, vatRate: 0, discountPct: 0, lineTtc: 0 },
  ],
  vatRows: [{ rate: 21, base: 49.59, vat: 10.41 }, { rate: 6, base: 13.21, vat: 0.79 }],
  payments: [
    { label: 'Especes', amount: 74, given: 80, isCash: true, status: 'recu' },
    { label: 'Carte', amount: 0, isCash: false, status: 'recu' },
  ],
  register: { code: 'CAISSE-1', workstation: 'Caisse 1', zNumber: null },
  mentions: [],
  footer: 'Echange sous 15 jours avec le ticket.',
  ...over,
});

const textOf = (t: TicketReceiptInput, cols = 48) =>
  layoutReceipt(buildTicketReceipt(t, tr).blocks, cols).map((l) => (l.kind === 'text' ? l.text : `[barcode ${l.value}]`));

describe('Ticket de caisse : mentions', () => {
  test('societe, TVA, n° d entreprise, n° du ticket, date et heure, caisse, poste, vendeur', () => {
    const txt = textOf(baseTicket()).join('\n');
    expect(txt).toContain('ITALBIKE STORE');
    expect(txt).toContain('ITALBIKE STORE SRL');
    expect(txt).toContain('TVA BE0123456789');
    expect(txt).toContain('N° entreprise 0123.456.789');
    expect(txt).toContain('TICKET DE CAISSE');
    expect(txt).toMatch(/N°\s+TIK-2026-00012/);
    expect(txt).toMatch(/Date\s+03\/11\/2026 14:32/);
    expect(txt).toMatch(/Caisse\s+CAISSE-1/);
    expect(txt).toMatch(/Poste\s+Caisse 1/);
    expect(txt).toMatch(/Vendeur\s+Simon/);
    expect(txt).not.toMatch(/^Z\s/m); // pas de Z tant que la session est ouverte
    expect(txt).toContain('[barcode TIK-2026-00012]');
  });

  test('n° du Z quand la session est cloturee', () => {
    expect(textOf(baseTicket({ register: { code: 'CAISSE-1', workstation: null, zNumber: 'Z-2026-00003' } })).join('\n')).toMatch(/Z\s+Z-2026-00003/);
  });

  test('lignes (qte x PU TTC, taux), total, TVA par taux, total TVA', () => {
    const txt = textOf(baseTicket()).join('\n');
    expect(txt).toContain('Gants Ducati Corse (981073)');
    expect(txt).toMatch(/1 x 60,00 21%\s+60,00/);
    expect(txt).toMatch(/2 x 7,00 6%\s+14,00/);
    expect(txt).toMatch(/TOTAL\s+74,00 EUR/);
    expect(txt).toMatch(/Total HTVA\s+61,98/);
    expect(txt).toMatch(/TVA 21 % sur 49,59\s+10,41/);
    expect(txt).toMatch(/TVA 6 % sur 13,21\s+0,79/);
    expect(txt).toMatch(/Total TVA\s+12,02/);
  });

  test('paiement en clair, especes recues et rendu ; montant nul ignore ; pied et merci', () => {
    const txt = textOf(baseTicket()).join('\n');
    expect(txt).toMatch(/Especes\s+74,00/);
    expect(txt).toMatch(/Reçu\s+80,00/);
    expect(txt).toMatch(/Rendu\s+6,00/);
    expect(txt).not.toContain('Carte');
    expect(txt).not.toContain('Reste à payer');
    expect(txt).toContain('Echange sous 15 jours avec le ticket.');
    expect(txt).toContain('Merci de votre visite');
  });

  test('reste a payer et reglement a echeance', () => {
    const txt = textOf(baseTicket({ payments: [{ label: 'Especes', amount: 50, isCash: true, status: 'recu' }, { label: 'Cheque', amount: 24, isCash: false, status: 'attendu' }] })).join('\n');
    expect(txt).toMatch(/Cheque \(à échéance\)\s+24,00/);
    expect(txt).toMatch(/Reste à payer\s+24,00/);
  });

  test('duplicata en tete et en pied', () => {
    const lines = textOf(baseTicket({ duplicate: true }));
    expect(lines[0]).toBe('DUPLICATA');
    expect(lines[lines.length - 1]).toBe('DUPLICATA');
    expect(textOf(baseTicket())).not.toContain('DUPLICATA');
  });

  test('regime de la marge : ni TVA ni taux, mention legale', () => {
    const t = baseTicket({
      doc: { ...baseTicket().doc, marge: true, totalHt: 8500, totalVat: 0, totalTtc: 8500 },
      lines: [{ lineType: 'article', designation: 'Ducati Monster 2019', quantity: 1, unitPriceHt: 8500, vatRate: 0, discountPct: 0, lineTtc: 8500 }],
      vatRows: [], payments: [], mentions: ['Livraison soumise au régime particulier d imposition de la marge bénéficiaire.'],
    });
    const txt = textOf(t).join('\n');
    expect(txt).not.toContain('TVA 21');
    expect(txt).not.toContain('Total TVA');
    expect(txt).not.toMatch(/\d%/);
    expect(txt).toContain('régime particulier');
  });

  test('remise globale affichee en montant TTC', () => {
    const t = baseTicket({ doc: { ...baseTicket().doc, totalTtc: 66.6, globalDiscountPct: 10 } });
    expect(textOf(t).join('\n')).toMatch(/Remise 10 %\s+-7,40/);
  });

  test('aucune ligne plus large que le papier (80 et 58 mm, imprimante et navigateur)', () => {
    for (const cols of [48, 42, 32]) {
      const lines = layoutReceipt(buildTicketReceipt(baseTicket({ duplicate: true }), tr).blocks, cols);
      for (const l of lines) if (l.kind === 'text') expect(l.text.length).toBeLessThanOrEqual(l.large ? Math.floor(cols / 2) : cols);
    }
  });

  test('ticket complet en ESC/POS : commence par ESC @, finit par la coupe', () => {
    const doc = buildTicketReceipt(baseTicket(), tr);
    const b = bytesOf(escposReceipt(layoutReceipt(doc.blocks, receiptColumns(80))));
    expect(b.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(indexOfSeq(b, encodePc858('Reçu'))).toBeGreaterThan(0);
  });
});
