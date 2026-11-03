/**
 * Tests M8 — Dossier accident (mission 09, carte 5, ACH005) : formulaire Excel « Aide Reparation
 * Moto Accidentee » au format exact du modele Ducati (C4, C5, blocs B / I / P), seuil 1 500 € HTVA,
 * checklist « un dossier part complet ou ne part pas », objet et corps du mail, statuts, copie du
 * mail dans le message Graph. Execution : `bun test`.
 */
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import {
  accidentAmounts, accidentChecklist, accidentFormCells, accidentMailBody, accidentMailSubject,
  accidentNextStatuses, accidentStatusTone, accidentAttachmentNames, fillAccidentFormSheetXml, isAccidentFileStatus,
  photosPdfTitle, quotePartLines, readSheetCell, splitAddresses, vinLast6,
  ACCIDENT_FORM_CAPACITY, ACCIDENT_FORM_ROWS_PER_BLOCK, ACCIDENT_FILE_MIN_HT, ACCIDENT_FILE_STATUSES,
} from '../src/modules/workshop/accident/rules';
import { fillAccidentFormTemplate } from '../src/modules/workshop/accident/form-xlsx';
import { buildGraphMessage } from '../supabase/functions/_shared/mail-message.ts';

const TEMPLATE = new URL('../docs/modeles/formulaire-commande-moto-accidentee.xlsx', import.meta.url);
const parts = (n: number) => Array.from({ length: n }, (_, i) => ({ reference: `REF${String(i + 1).padStart(3, '0')}`, designation: `Piece ${i + 1}`, qty: (i % 3) + 1 }));

describe('formulaire Excel — cellules du modele', () => {
  test('chassis en C4, client en C5, pieces en B/C/D a partir de la ligne 8', () => {
    const cells = accidentFormCells({ chassis: 'zdmtest0000000321', clientName: 'Client Test', parts: parts(3) });
    const by = Object.fromEntries(cells.map((c) => [c.cell, c.value]));
    expect(by.C4).toBe('ZDMTEST0000000321');
    expect(by.C5).toBe('Client Test');
    expect(by.B8).toBe('REF001'); expect(by.C8).toBe('Piece 1'); expect(by.D8).toBe(1);
    expect(by.B10).toBe('REF003'); expect(by.D10).toBe(3);
    expect(by.J4).toBeUndefined(); // bloc 2 inutilise : pas d'en-tete recopie
    expect(by.I8).toBeUndefined();
  });

  test('39 lignes par bloc : la 40e piece passe en I/J/K ligne 8, la 79e en P/Q/R', () => {
    expect(ACCIDENT_FORM_ROWS_PER_BLOCK).toBe(39);
    const cells = accidentFormCells({ chassis: 'X', clientName: 'Y', parts: parts(80) });
    const by = Object.fromEntries(cells.map((c) => [c.cell, c.value]));
    expect(by.B46).toBe('REF039');
    expect(by.I8).toBe('REF040'); expect(by.J8).toBe('Piece 40'); expect(by.K8).toBe(1);
    expect(by.I46).toBe('REF078');
    expect(by.P8).toBe('REF079'); expect(by.P9).toBe('REF080');
    expect(by.J4).toBe('X'); expect(by.Q5).toBe('Y'); // en-tetes recopies sur les blocs utilises
  });

  test('45 lignes : bloc 1 plein (39) puis 6 lignes dans le bloc 2 ; jamais au-dela des 3 blocs', () => {
    const cells = accidentFormCells({ chassis: 'X', clientName: 'Y', parts: parts(45) });
    const by = Object.fromEntries(cells.map((c) => [c.cell, c.value]));
    expect(by.B46).toBe('REF039');
    expect(by.I8).toBe('REF040'); expect(by.I13).toBe('REF045');
    expect(by.P8).toBeUndefined();
    expect(ACCIDENT_FORM_CAPACITY).toBe(117);
    expect(() => accidentFormCells({ chassis: 'X', clientName: 'Y', parts: parts(118) })).toThrow(/accident_form_overflow/);
  });

  test('le XML de la feuille garde le style des cellules et recoit les valeurs (inlineStr / nombre)', () => {
    const xml = '<sheetData><row r="4"><c r="B4" s="8" t="s"><v>4</v></c><c r="C4" s="6"/></row><row r="8"><c r="B8" s="3"/><c r="C8" s="3"/><c r="D8" s="3"/></row></sheetData>';
    const out = fillAccidentFormSheetXml(xml, [
      { cell: 'C4', value: 'VIN&<1>' }, { cell: 'B8', value: 'REF' }, { cell: 'C8', value: 'Garde-boue "AV"' }, { cell: 'D8', value: 2 },
    ]);
    expect(out).toContain('<c r="C4" s="6" t="inlineStr"><is><t xml:space="preserve">VIN&amp;&lt;1&gt;</t></is></c>');
    expect(out).toContain('<c r="B8" s="3" t="inlineStr">');
    expect(out).toContain('<c r="D8" s="3"><v>2</v></c>');
    expect(readSheetCell(out, 'C4')).toBe('VIN&<1>');
    expect(readSheetCell(out, 'C8')).toBe('Garde-boue "AV"');
    expect(readSheetCell(out, 'D8')).toBe(2);
    expect(readSheetCell(out, 'B4')).toBe(4); // chaine partagee : index, intact
  });

  test('le vrai modele Ducati est rempli sans toucher au reste de l\'archive (styles, logo, 3 feuilles)', () => {
    const template = new Uint8Array(readFileSync(TEMPLATE));
    const before = unzipSync(template);
    const out = fillAccidentFormTemplate(template, { chassis: 'ZDMTEST0000000001', clientName: 'DUPONT Jean', parts: parts(45) });
    const after = unzipSync(out);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      if (name === 'xl/worksheets/sheet1.xml') continue;
      expect(after[name]).toEqual(before[name]);
    }
    const sheet = strFromU8(after['xl/worksheets/sheet1.xml']);
    expect(readSheetCell(sheet, 'C4')).toBe('ZDMTEST0000000001');
    expect(readSheetCell(sheet, 'C5')).toBe('DUPONT Jean');
    expect(readSheetCell(sheet, 'B8')).toBe('REF001');
    expect(readSheetCell(sheet, 'D8')).toBe(1);
    expect(readSheetCell(sheet, 'B46')).toBe('REF039');
    expect(readSheetCell(sheet, 'I8')).toBe('REF040');
    expect(readSheetCell(sheet, 'K13')).toBe(3);
    expect(readSheetCell(sheet, 'J4')).toBe('ZDMTEST0000000001');
    // Les styles d'origine restent sur les cellules remplies (bordures du modele).
    expect(sheet).toContain('<c r="B8" s="3" t="inlineStr">');
    expect(sheet).toContain('<c r="C4" s="6" t="inlineStr">');
    // Titre et en-tetes du modele intacts (chaines partagees).
    expect(sheet).toContain('<c r="B2" s="7" t="s">');
    expect(sheet).toContain('<c r="B7" s="4" t="s"><v>0</v></c>');
  });
});

describe('seuil 1 500 € HTVA et remise prevue', () => {
  const lines = [
    { line_type: 'article', article_id: 'a1', reference: 'R1', designation: 'Carenage', quantity: 1, unit_price_ht: 1200 },
    { line_type: 'article', article_id: 'a2', reference: null, designation: 'Retro', quantity: 2, unit_price_ht: 150 },
    { line_type: 'main_oeuvre', article_id: 'mo', reference: 'MO', designation: 'Main-d\'oeuvre', quantity: 9, unit_price_ht: 80 },
    { line_type: 'article', article_id: null, reference: null, designation: 'Frais de devis accident', quantity: 1, unit_price_ht: 125 },
    { line_type: 'texte', article_id: null, reference: null, designation: 'Note', quantity: 0, unit_price_ht: 0 },
  ];
  test('seules les lignes pieces (article rattache) vont dans le formulaire : pas la MO, pas les frais, pas les textes', () => {
    const p = quotePartLines(lines);
    expect(p.map((x) => x.designation)).toEqual(['Carenage', 'Retro']);
    expect(p[1].reference).toBe('');
  });
  test('sous 1 500 € HTVA : commande standard, pas de remise ; au-dessus : 15 % des pieces', () => {
    const p = quotePartLines(lines);
    const low = accidentAmounts(1499.99, p);
    expect(low.belowThreshold).toBe(true); expect(low.expectedDiscount).toBe(0);
    const ok = accidentAmounts(1500, p);
    expect(ok.belowThreshold).toBe(false);
    expect(ok.partsTotalHt).toBe(1500);
    expect(ok.expectedDiscount).toBe(225);
    expect(ACCIDENT_FILE_MIN_HT).toBe(1500);
  });
});

describe('checklist « un dossier part complet ou ne part pas »', () => {
  const full = { hasQuote: true, hasForm: true, photoCount: 4, hasVinPhoto: true, quoteTotalHt: 5277.74 };
  test('complet avec devis, formulaire, 4 photos, photo du chassis, >= 1 500 €', () => {
    expect(accidentChecklist(full).complete).toBe(true);
  });
  test('chaque manque bloque', () => {
    expect(accidentChecklist({ ...full, hasQuote: false }).complete).toBe(false);
    expect(accidentChecklist({ ...full, hasForm: false }).complete).toBe(false);
    expect(accidentChecklist({ ...full, photoCount: 3 }).photos).toBe(false);
    expect(accidentChecklist({ ...full, hasVinPhoto: false }).vinPhoto).toBe(false);
    expect(accidentChecklist({ ...full, quoteTotalHt: 1200 }).amount).toBe(false);
    expect(accidentChecklist({ ...full, quoteTotalHt: null }).amount).toBe(false);
  });
});

describe('mail a Ducati West Europe', () => {
  const base = { clientName: 'Dupont', model: 'MTSV4Rally', vin: 'ZDMTEST0000000321', isUrgent: false, urgentNote: null };
  test('objet « Dossier Accident : CLIENT - modele 6 derniers du VIN »', () => {
    expect(vinLast6(' zdmtest0000000321 ')).toBe('000321');
    expect(accidentMailSubject(base)).toBe('Dossier Accident : DUPONT - MTSV4Rally 000321');
  });
  test('corps : texte de Domenico, ligne « Dossier urgent » seulement si urgent', () => {
    const calm = accidentMailBody(base);
    expect(calm).toContain('Pourrais-tu faire suivre ce dossier accident');
    expect(calm).not.toContain('urgent');
    const hot = accidentMailBody({ ...base, isUrgent: true, urgentNote: 'le client part en voyage mi-juillet' });
    expect(hot).toContain('Dossier urgent : le client part en voyage mi-juillet');
    expect(hot.endsWith('Bien à toi,')).toBe(true);
    expect(accidentMailBody({ ...base, isUrgent: true, urgentNote: '' })).toContain('Dossier urgent.');
  });
  test('copie : vide par defaut, saisie libre nettoyee, jamais le destinataire en double dans Graph', () => {
    expect(splitAddresses('')).toEqual([]);
    expect(splitAddresses(' A@ducati.com, a@ducati.com ; b@ducati.com x')).toEqual(['a@ducati.com', 'b@ducati.com']);
    const msg = buildGraphMessage({ subject: 's', bodyHtml: 'b', footer: '', to: 'technique.dwe@ducati.com', cc: ['x@ducati.com', 'Technique.DWE@ducati.com'], attachments: [] });
    expect(msg.message.ccRecipients).toEqual([{ emailAddress: { address: 'x@ducati.com' } }]);
    const none = buildGraphMessage({ subject: 's', bodyHtml: 'b', footer: '', to: 'technique.dwe@ducati.com', attachments: [] });
    expect('ccRecipients' in none.message).toBe(false);
  });
  test('quatre pieces jointes nommees d\'apres le client, le modele et le VIN', () => {
    const n = accidentAttachmentNames(base);
    expect(n).toEqual({
      form: 'Formulaire_Commande_DUPONT_MTSV4Rally_000321.xlsx', quote: 'Devis_DUPONT_MTSV4Rally_000321.pdf',
      photos: 'Photos_DUPONT_MTSV4Rally_000321.pdf', vinPhoto: 'Chassis_DUPONT_MTSV4Rally_000321.jpg',
    });
    expect(photosPdfTitle('Ducati MTSV4Rally', 'ZDMTEST0000000321')).toBe('Photos avant réparation — Ducati MTSV4Rally — ZDMTEST0000000321');
  });
});

describe('statuts', () => {
  test('brouillon → envoye (par le mail seulement) → accorde → pieces_recues → repare → clos', () => {
    expect([...ACCIDENT_FILE_STATUSES]).toEqual(['brouillon', 'envoye', 'accorde', 'pieces_recues', 'repare', 'clos']);
    expect(accidentNextStatuses('brouillon')).toEqual([]);
    expect(accidentNextStatuses('envoye')).toEqual(['accorde', 'clos']);
    expect(accidentNextStatuses('accorde')).toEqual(['pieces_recues', 'clos']);
    expect(accidentNextStatuses('pieces_recues')).toEqual(['repare', 'clos']);
    expect(accidentNextStatuses('repare')).toEqual(['clos']);
    expect(accidentNextStatuses('clos')).toEqual([]);
    expect(isAccidentFileStatus('envoye')).toBe(true);
    expect(isAccidentFileStatus('perdu')).toBe(false);
    expect(accidentStatusTone('accorde')).toBe('success');
    expect(accidentStatusTone('envoye')).toBe('info');
  });
});
