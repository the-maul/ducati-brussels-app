/**
 * Tests M10 — construction du message Graph de `graph-send-email` SANS envoi (mission 05 carte 8) :
 * PDF joint, pied de mail P-5 / P-6 conservé, résumé de trace sans le contenu des fichiers.
 */
import { test, expect } from 'bun:test';
import {
  buildGraphMessage, toGraphAttachments, attachmentsSummary, footerHtml, base64Size,
} from '../supabase/functions/_shared/mail-message.ts';
import { bytesToBase64, plainTextToHtml } from '../src/modules/sales/document-mail-api';
import { buildSalesDocumentPdf } from '../src/modules/sales/document-pdf';

test('le PDF du document part en pièce jointe, avec le pied de mail sous le message', async () => {
  const pdf = await buildSalesDocumentPdf({
    docType: 'RES', number: 'RES-2026-0003', issueDate: '2026-09-19', createdAt: null, dueDate: null,
    condition: null, operator: 'Simon', clientCode: null, company: { name: 'ITALBIKE STORE' },
    clientLines: ['Client test'], vehicleLines: [], payments: [], taxExempt: false, isMarge: false, pied: {},
    lines: [{ lineType: 'article', reference: 'A1', designation: 'Filtre', quantity: 1, unitPriceHt: 10, vatRate: 21, discountPct: 0, lineTtc: 12.1 }],
    totals: { ht: 10, vat: 2.1, ttc: 12.1, paid: 0 }, validity: null,
  });
  const b64 = bytesToBase64(pdf);
  expect(base64Size(b64)).toBe(pdf.length);

  const atts = toGraphAttachments([
    { name: 'Reservation_RES-2026-0003.pdf', contentType: 'application/pdf', contentBytes: b64 },
    { name: '', contentBytes: 'x' },                 // ignorée : sans nom
  ]);
  expect(atts).toHaveLength(1);
  expect(atts[0]['@odata.type']).toBe('#microsoft.graph.fileAttachment');

  const footer = footerHtml('join', 'https://app.example.be', 'client@exemple.be');
  const msg = buildGraphMessage({
    subject: 'Réservation', bodyHtml: plainTextToHtml('Bonjour,\n<b>merci</b>'), footer, to: 'client@exemple.be', attachments: atts,
  });
  expect(msg.saveToSentItems).toBe(true);
  expect(msg.message.toRecipients[0].emailAddress.address).toBe('client@exemple.be');
  expect(msg.message.body.content.startsWith('Bonjour,<br>&lt;b&gt;merci&lt;/b&gt;')).toBe(true);
  expect(msg.message.body.content).toContain('inscription?email=client%40exemple.be');
  expect(msg.message.body.content).toContain('Créer mon compte');
  expect(msg.message.attachments?.[0].contentBytes).toBe(b64);

  const summary = attachmentsSummary(atts);
  expect(summary).toEqual([{ name: 'Reservation_RES-2026-0003.pdf', contentType: 'application/pdf', size: pdf.length }]);
  expect(JSON.stringify(summary)).not.toContain(b64.slice(0, 40));
});

test('variante « Me connecter » et message sans pièce jointe (appelants existants inchangés)', () => {
  const footer = footerHtml('login', 'https://app.example.be', 'a@b.be');
  expect(footer).toContain('/login');
  expect(footer).toContain('Me connecter');
  const msg = buildGraphMessage({ subject: 's', bodyHtml: '<p>x</p>', footer: '', to: 'a@b.be', attachments: toGraphAttachments(undefined) });
  expect(msg.message.body.content).toBe('<p>x</p>');
  expect('attachments' in msg.message).toBe(false);
});
