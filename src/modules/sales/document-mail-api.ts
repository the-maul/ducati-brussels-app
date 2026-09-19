/**
 * M6/M10 — Envoi d'un document de vente par e-mail AVEC son PDF (mission 05 carte 8, mission 02
 * carte 6), depuis une boîte Outlook au choix, puis archivage du PDF envoyé en GED.
 *
 * 1. PDF généré dans le navigateur (`document-pdf.ts`), joint en base64.
 * 2. `graph-send-email` vérifie la boîte (partagée de la société ou adresse de l'utilisateur),
 *    ajoute le pied de mail P-5 / P-6, envoie, et écrit la trace `events` (`email_sent` sur le
 *    document : qui, quand, à qui, quelle boîte, fichiers). Mode `dryRun` : rien n'est envoyé.
 * 3. Après un envoi réussi : le PDF est déposé dans la GED du client (dossier « Documents de
 *    vente ») ET dans celle du document de vente (onglet GED du document), avec une note
 *    « Envoyé par e-mail à … ». Deux fichiers distincts : supprimer l'un ne casse pas l'autre.
 */
import { supabase } from '@/integrations/supabase/client';
import { clientAppUrl } from '@/lib/client-app-url';
import { uploadAttachment } from '@/modules/documents/ged-api';
import { t } from '@/lib/i18n';
import type { DocumentFull } from './write-api';
import { generateSalesPdf, pdfBlob, type SalesPdf } from './document-pdf-data';

/** Dossier GED du client où sont rangés les documents de vente envoyés. */
export const SALES_GED_FOLDER = 'Documents de vente';

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Texte saisi (textarea) → HTML simple et sûr pour le corps du mail. */
export function plainTextToHtml(text: string): string {
  const esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  return esc.replace(/\r?\n/g, '<br>');
}

export type SendDocumentMailInput = {
  full: DocumentFull;
  contactId: string;
  to: string;
  from: string | undefined;
  subject: string;
  body: string;          // texte brut saisi
  dryRun?: boolean;
  /** PDF déjà généré (aperçu) ; sinon généré ici. */
  pdf?: SalesPdf;
};

export type SendDocumentMailResult =
  | { ok: true; from: string; dryRun: boolean; archived: boolean; preview?: DryRunPreview }
  | { ok: false; error: string };

export type DryRunPreview = { html: string; attachments: { name: string; contentType: string; size: number }[]; footer: string | null };

export async function sendDocumentMail(p: SendDocumentMailInput): Promise<SendDocumentMailResult> {
  const { doc } = p.full;
  const pdf = p.pdf ?? await generateSalesPdf(p.full);
  const { data, error } = await supabase.functions.invoke('graph-send-email', {
    body: {
      companyId: doc.company_id, contactId: p.contactId, to: p.to.trim(), from: p.from || undefined,
      subject: p.subject, body: plainTextToHtml(p.body), origin: clientAppUrl(),
      attachments: [{ name: pdf.fileName, contentType: 'application/pdf', contentBytes: bytesToBase64(pdf.bytes) }],
      trace: { entityType: 'documents', entityId: doc.id },
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
  if (r.dryRun) {
    return { ok: true, from: r.from ?? '', dryRun: true, archived: false, preview: { html: r.html ?? '', attachments: r.attachments ?? [], footer: r.footer ?? null } };
  }

  // Archivage en GED (le mail est parti : une erreur ici ne doit pas faire croire à un échec d'envoi).
  let archived = true;
  try {
    const note = t('salesMail.gedNote').replace('{to}', p.to.trim()).replace('{from}', r.from ?? '').replace('{date}', new Date().toLocaleString('fr-BE'));
    const stamp = Date.now();
    const file = new File([pdfBlob(pdf.bytes)], pdf.fileName, { type: 'application/pdf' });
    await uploadAttachment(doc.company_id, 'contact', p.contactId, file, stamp, note, SALES_GED_FOLDER);
    await uploadAttachment(doc.company_id, 'document', doc.id, file, stamp, note, null);
  } catch {
    archived = false;
  }
  // La relève enregistre tout de suite l'envoi depuis une boîte partagée (best-effort, le cron le fera sinon).
  void supabase.functions.invoke('outlook-poll', { body: {} }).catch(() => undefined);
  return { ok: true, from: r.from ?? '', dryRun: false, archived };
}

/** Libellé d'erreur lisible pour un code renvoyé par `graph-send-email`. */
export function mailErrorLabel(code: string): string {
  const known = ['graph_not_configured', 'not_signed_in', 'not_a_member', 'unknown_mailbox', 'no_mailbox', 'send_failed', 'graph_auth_failed', 'unknown_document', 'missing_params'];
  return known.includes(code) ? t(`salesMail.err_${code}`) : `${t('salesMail.errGeneric')} (${code})`;
}
