/**
 * M8 — Dossier accident : generation des pieces et ENVOI du mail a Ducati West Europe
 * (mission 09, carte 5). Meme mecanisme que l'envoi d'un document de vente : `graph-send-email`
 * (boite Outlook partagee de la societe ou adresse de l'utilisateur connecte), mode `dryRun`
 * pour verifier sans envoyer. Quatre pieces jointes, toujours regenerees au moment de l'envoi
 * (le devis peut avoir change) puis conservees dans la GED du dossier avec le mail (sent_at,
 * sent_to, sent_cc, mail_subject).
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';
import { fetchImageForPdf } from '@/lib/image-tools';
import { getDocumentFull, type DocumentFull } from '@/modules/sales/write-api';
import { generateSalesPdf } from '@/modules/sales/document-pdf-data';
import { bytesToBase64, plainTextToHtml, type DryRunPreview } from '@/modules/sales/document-mail-api';
import { contactDisplayName } from '@/modules/contacts/api';
import { accidentFileUrl, listAccidentPhotos, readGedBytes, storeAccidentFile, updateAccidentFile, type AccidentFileFull, type AccidentFilePhoto } from './api';
import { buildAccidentFormXlsx, XLSX_MIME } from './form-xlsx';
import { buildAccidentPhotosPdf } from './photos-pdf';
import { accidentAttachmentNames, photosPdfTitle, quotePartLines, type AccidentQuotePart } from './rules';

export type AccidentNames = { clientName: string; model: string; vin: string | null };

/** Nom du client, modele et VIN tels qu'ils figurent sur le dossier (ou sur l'OR / le devis). */
export function accidentNames(file: AccidentFileFull): AccidentNames {
  return {
    clientName: file.contact ? contactDisplayName(file.contact) : '',
    model: [file.vehicle?.brand, file.vehicle?.model].filter(Boolean).join(' '),
    vin: file.vehicle?.vin ?? null,
  };
}

/** Lignes pieces du devis avec la VRAIE reference article (document_lines.reference peut etre vide). */
export async function loadQuoteParts(full: DocumentFull): Promise<AccidentQuotePart[]> {
  const lines = full.lines;
  const missing = [...new Set(lines
    .filter((l) => (l.line_type ?? 'article') === 'article' && !!l.article_id && !(l.reference ?? '').trim())
    .map((l) => l.article_id as string))];
  const refs = new Map<string, string>();
  if (missing.length) {
    const { data, error } = await supabase.from('articles').select('id, reference').in('id', missing);
    if (error) throw error;
    for (const a of data ?? []) refs.set(a.id, a.reference);
  }
  return quotePartLines(lines.map((l) => ({
    ...l, reference: (l.reference ?? '').trim() || (l.article_id ? refs.get(l.article_id) ?? null : null),
  })));
}

/** Genere le formulaire Excel du dossier (depuis le devis lie) et le range dans la GED. */
export async function generateAccidentForm(file: AccidentFileFull, labels: { gedNote: string }): Promise<{ bytes: Uint8Array; fileName: string; path: string }> {
  if (!file.quote_document_id) throw new Error('accident_no_quote');
  const full = await getDocumentFull(file.quote_document_id);
  const parts = await loadQuoteParts(full);
  const names = accidentNames(file);
  const bytes = await buildAccidentFormXlsx({ chassis: names.vin ?? '', clientName: names.clientName, parts });
  const fileName = accidentAttachmentNames(names).form;
  const path = await storeAccidentFile(file.company_id, file.id, bytes, fileName, XLSX_MIME, labels.gedNote);
  await updateAccidentFile(file.id, { form_path: path });
  return { bytes, fileName, path };
}

export type SendAccidentInput = {
  file: AccidentFileFull;
  from: string | undefined;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  dryRun?: boolean;
  companyName: string;
  labels: { vin: string; photo: string; page: string; gedNote: string };
};

export type SendAccidentResult =
  | { ok: true; from: string; dryRun: boolean; preview?: DryRunPreview }
  | { ok: false; error: string };

/** La photo du chassis en JPEG (re-encodee a 2 000 px : c'est ce qui part en piece jointe a part). */
async function vinPhotoJpeg(photo: AccidentFilePhoto): Promise<string> {
  const url = await accidentFileUrl(photo.path);
  if (!url) throw new Error('accident_vin_photo_unreadable');
  const img = await fetchImageForPdf(url, 'upload');
  if (!img) throw new Error('accident_vin_photo_unreadable');
  return img.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

export async function sendAccidentFile(p: SendAccidentInput): Promise<SendAccidentResult> {
  const { file } = p;
  if (!file.quote_document_id) return { ok: false, error: 'accident_no_quote' };
  const photos = await listAccidentPhotos(file.id);
  const vin = photos.find((ph) => ph.is_vin);
  if (!vin) return { ok: false, error: 'accident_no_vin_photo' };
  const names = accidentNames(file);
  const fileNames = accidentAttachmentNames(names);

  // 1. Les quatre pieces jointes.
  const full = await getDocumentFull(file.quote_document_id);
  const parts = await loadQuoteParts(full);
  const form = await buildAccidentFormXlsx({ chassis: names.vin ?? '', clientName: names.clientName, parts });
  const quotePdf = await generateSalesPdf(full);
  const items = [];
  for (const ph of photos) {
    const url = await accidentFileUrl(ph.path);
    if (url) items.push({ url, caption: ph.caption, takenAt: ph.taken_at, isVin: ph.is_vin });
  }
  const photosPdf = await buildAccidentPhotosPdf(
    { title: photosPdfTitle(names.model, names.vin), companyName: p.companyName, generatedAt: new Date(), items },
    { vin: p.labels.vin, photo: p.labels.photo, page: p.labels.page },
  );
  const vinJpeg = await vinPhotoJpeg(vin);

  // 2. Envoi (ou simulation) depuis la boite choisie.
  const { data, error } = await supabase.functions.invoke('graph-send-email', {
    body: {
      companyId: file.company_id, to: p.to.trim(), cc: p.cc, from: p.from || undefined,
      subject: p.subject, body: plainTextToHtml(p.body), origin: clientAppUrl(), invite: false,
      attachments: [
        { name: fileNames.form, contentType: XLSX_MIME, contentBytes: bytesToBase64(form) },
        { name: fileNames.quote, contentType: 'application/pdf', contentBytes: bytesToBase64(quotePdf.bytes) },
        { name: fileNames.photos, contentType: 'application/pdf', contentBytes: bytesToBase64(photosPdf) },
        { name: fileNames.vinPhoto, contentType: 'image/jpeg', contentBytes: vinJpeg },
      ],
      trace: { entityType: 'accident_files', entityId: file.id },
      ...(p.dryRun ? { dryRun: true } : {}),
    },
  });
  if (error) {
    const ctx = (error as { context?: { body?: unknown; json?: () => Promise<unknown> } }).context;
    let code: string | undefined = (ctx?.body as { error?: string } | undefined)?.error;
    if (!code && ctx && typeof ctx.json === 'function') {
      try { code = ((await ctx.json()) as { error?: string })?.error; } catch { /* corps illisible */ }
    }
    return { ok: false, error: code ?? error.message };
  }
  const r = data as { ok?: boolean; error?: string; from?: string; dryRun?: boolean; html?: string; attachments?: DryRunPreview['attachments']; footer?: string | null };
  if (!r?.ok) return { ok: false, error: r?.error ?? 'send_failed' };
  if (r.dryRun) return { ok: true, from: r.from ?? '', dryRun: true, preview: { html: r.html ?? '', attachments: r.attachments ?? [], footer: r.footer ?? null } };

  // 3. Le mail est parti : on garde les pieces envoyees et le mail sur le dossier.
  const patch: Parameters<typeof updateAccidentFile>[1] = {
    status: 'envoye', sent_at: new Date().toISOString(), sent_to: p.to.trim(), sent_cc: p.cc.join(', ') || null,
    mail_subject: p.subject, vin_photo_path: vin.path,
  };
  try {
    patch.form_path = await storeAccidentFile(file.company_id, file.id, form, fileNames.form, XLSX_MIME, p.labels.gedNote);
    patch.photos_pdf_path = await storeAccidentFile(file.company_id, file.id, photosPdf, fileNames.photos, 'application/pdf', p.labels.gedNote);
    await storeAccidentFile(file.company_id, file.id, quotePdf.bytes, fileNames.quote, 'application/pdf', p.labels.gedNote);
  } catch { /* le mail est parti : l'archivage ne doit pas faire croire a un echec */ }
  await updateAccidentFile(file.id, patch);
  return { ok: true, from: r.from ?? '', dryRun: false };
}

/** Relit un fichier conserve (formulaire, PDF) pour le re-telecharger. */
export async function downloadStoredAccidentFile(path: string): Promise<Uint8Array> {
  return readGedBytes(path);
}
