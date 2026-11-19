/**
 * Encaissements (rattrapage G8, 18/11/2026) — préparer, éditer et ENVOYER EN TEST les relances.
 *
 * Mail : canal existant du DMS (Outlook / Microsoft Graph, `graph-send-email`), avec
 * `purpose: 'dunning'`. TOUT part à l'adresse de test (jamais au client, voir `dunning.ts`), objet
 * préfixé « [TEST relance pour <client>] », sans pied d'invitation, sans copie, sans trace dans
 * l'historique d'échanges du client (il n'a rien reçu). La relance est notée dans l'historique des
 * relances avec `is_test = true` et l'adresse réellement utilisée.
 * Courrier : un seul PDF pour toutes les lettres (« Éditer relance(s) »), noté `courrier`.
 */
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/i18n';
import { getDocumentFull } from '@/modules/sales/write-api';
import { generateSalesPdf } from '@/modules/sales/document-pdf-data';
import { bytesToBase64, plainTextToHtml } from '@/modules/sales/document-mail-api';
import { clientAppUrl } from '@/lib/client-app-url';
import { dunningFees, fillDunningText, resolveDunningDelivery, type DunningLetter, type DunningTemplate } from './dunning';
import { buildDunningLettersPdf, type DunningLetterPdf, type PdfCompany } from './receivables-pdf';
import { recordDunningLetters, type DunningLetterRow } from './api';
import { eur } from './helpers';

export type LetterOptions = {
  dateIso: string;
  /** Frais / majoration saisis à l'envoi (G8 « montant frais », « majorer de % ») ; null = ceux du modèle. */
  feeFixed: number | null; surchargePct: number | null;
};

export type PreparedLetter = { letter: DunningLetter; template: DunningTemplate; fees: number; pdf: DunningLetterPdf };

const pdfLabels = () => ({
  place: t('receivables.pdfPlace'), colNumber: t('receivables.colNumber'), colDate: t('receivables.colDate'),
  colDue: t('receivables.colDueDate'), colAmount: t('receivables.colAmountDue'), totalDue: t('receivables.pdfTotalDue'),
  fees: t('receivables.pdfFees'), totalToPay: t('receivables.pdfTotalToPay'), testBanner: t('receivables.pdfTestBanner'),
  letterTitle: t('receivables.pdfLetterTitle'),
});

async function loadAddressees(ids: string[]): Promise<Map<string, { address: string | null; zip: string | null; city: string | null }>> {
  const map = new Map<string, { address: string | null; zip: string | null; city: string | null }>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from('contacts').select('id, address, zip, city').in('id', ids);
  for (const c of data ?? []) map.set(c.id, { address: c.address, zip: c.zip, city: c.city });
  return map;
}

export async function prepareLetters(
  company: PdfCompany, letters: DunningLetter[], templates: Map<string, DunningTemplate>, opts: LetterOptions, isTest: boolean,
): Promise<PreparedLetter[]> {
  const addr = await loadAddressees([...new Set(letters.map((l) => l.contactId))]);
  const out: PreparedLetter[] = [];
  for (const letter of letters) {
    const template = templates.get(letter.templateCode);
    if (!template) continue;
    const fees = dunningFees(letter.totalDue, opts.feeFixed ?? template.fee_fixed, opts.surchargePct ?? template.surcharge_pct);
    const vars = {
      client: letter.contactName, date: new Date(`${opts.dateIso}T00:00:00`).toLocaleDateString('fr-BE'),
      total_du: eur(letter.totalDue), frais: eur(fees), total_a_payer: eur(letter.totalDue + fees),
      societe: company.name, iban: company.iban ?? '',
    };
    const a = addr.get(letter.contactId);
    out.push({
      letter, template, fees,
      pdf: {
        format: template.format, company, addressee: { name: letter.contactName, address: a?.address, zip: a?.zip, city: a?.city },
        dateIso: opts.dateIso, subject: fillDunningText(template.subject, vars),
        header: fillDunningText(template.header_text, vars), body: fillDunningText(template.body_text, vars),
        closing: fillDunningText(template.closing_text, vars), footer: fillDunningText(template.footer_text, vars),
        rows: letter.rows.map((r) => ({ number: r.number, issueDate: r.issue_date, dueDate: r.due_date, amountDue: Number(r.amount_due) })),
        totalDue: letter.totalDue, fees, isTest, labels: pdfLabels(),
      },
    });
  }
  return out;
}

function historyRows(p: PreparedLetter, batchId: string, media: DunningLetterRow['media'], sentTo: string | null, isTest: boolean, withInvoice: boolean, subject: string) {
  return p.letter.rows.map((r) => ({
    batch_id: batchId, contact_id: p.letter.contactId, document_id: r.document_id, template_code: p.template.code,
    template_label: p.template.label, level: p.template.level, media, sent_to: sentTo, is_test: isTest, with_invoice: withInvoice,
    amount_due: Number(r.amount_due), fees: p.letter.rows.length ? Math.round((p.fees / p.letter.rows.length) * 100) / 100 : 0, subject,
  }));
}

/** Aperçu (rien n'est noté). */
export async function previewLetters(prepared: PreparedLetter[]): Promise<Uint8Array> {
  return buildDunningLettersPdf(prepared.map((p) => p.pdf));
}

/** « Éditer relance(s) » : un PDF pour toutes les lettres, noté « courrier » dans l'historique. */
export async function printLetters(companyId: string, prepared: PreparedLetter[]): Promise<Uint8Array> {
  const bytes = await buildDunningLettersPdf(prepared.map((p) => p.pdf));
  const batch = crypto.randomUUID();
  await recordDunningLetters(companyId, prepared.flatMap((p) => historyRows(p, batch, 'courrier', null, false, false, p.pdf.subject)));
  return bytes;
}

export type SendResult = { sent: number; failed: { client: string; error: string }[]; skipped: 'arrete' | 'no_test_recipient' | null; to: string | null };

/**
 * Envoi par mail EN TEST : chaque lettre part à l'adresse de test, avec son PDF et, en option, les
 * factures concernées. `message` : texte personnalisé (G8 « Envoi e-mail avec message personnalisé »),
 * sinon le corps de la lettre.
 */
export async function sendLettersByMail(p: {
  companyId: string; prepared: PreparedLetter[]; mode: unknown; testRecipient: string | null;
  withInvoice: boolean; message: string; from?: string;
}): Promise<SendResult> {
  const res: SendResult = { sent: 0, failed: [], skipped: null, to: null };
  for (const prep of p.prepared) {
    const delivery = resolveDunningDelivery(p.mode, p.testRecipient, prep.pdf.subject, prep.letter.contactName, prep.letter.email);
    if (!delivery.send) {
      const reason = delivery.reason;
      // Envoi reel (mise en production) : un client sans adresse e-mail n'arrete pas les autres.
      if (reason === 'no_email') { res.failed.push({ client: prep.letter.contactName, error: 'no_email' }); continue; }
      res.skipped = reason;
      return res;
    }
    res.to = delivery.to;
    try {
      const letterBytes = await buildDunningLettersPdf([prep.pdf]);
      const attachments = [{ name: `Relance-${prep.template.code}-${prep.letter.contactName.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`, contentType: 'application/pdf', contentBytes: bytesToBase64(letterBytes) }];
      if (p.withInvoice) {
        for (const r of prep.letter.rows) {
          const pdf = await generateSalesPdf(await getDocumentFull(r.document_id));
          attachments.push({ name: pdf.fileName, contentType: 'application/pdf', contentBytes: bytesToBase64(pdf.bytes) });
        }
      }
      const text = p.message.trim() || [prep.pdf.header, prep.pdf.body, prep.pdf.closing].filter((x) => x.trim()).join('\n\n');
      const { data, error } = await supabase.functions.invoke('graph-send-email', {
        body: {
          companyId: p.companyId, to: delivery.to, from: p.from || undefined, subject: delivery.subject,
          body: plainTextToHtml(text), origin: clientAppUrl(), invite: false, purpose: 'dunning',
          clientLabel: prep.letter.contactName, attachments,
        },
      });
      const r = data as { ok?: boolean; error?: string } | null;
      if (error || !r?.ok) throw new Error(r?.error ?? (error as Error | null)?.message ?? 'send_failed');
      await recordDunningLetters(p.companyId, historyRows(prep, crypto.randomUUID(), 'mail', delivery.to, delivery.isTest, p.withInvoice, delivery.subject));
      res.sent += 1;
    } catch (e) {
      res.failed.push({ client: prep.letter.contactName, error: (e as Error).message });
    }
  }
  return res;
}
