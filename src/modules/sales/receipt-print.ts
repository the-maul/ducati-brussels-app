/**
 * M6 (POS) — Impression du ticket par le pilote du poste (PDV030) : charge le document, la societe,
 * les reglements, la session (caisse, Z) et les mentions legales, construit le ticket 80 / 58 mm
 * (receipt-ticket.ts) et l'envoie a l'imprimante ticket du poste (src/lib/devices). Aucun poste
 * regle (ou migration absente) : impression A4 historique (print-document.ts), rien ne change.
 */
import { supabase } from '@/integrations/supabase/client';
import { tIn } from '@/lib/i18n';
import { contactLocale, designationFor } from '@/lib/i18n/client-locale';
import { contactDisplayName } from '@/modules/contacts/api';
import { printReceipt, type DeviceContext, type ReceiptDoc } from '@/lib/devices';
import { logDeviceEvent } from '@/lib/devices/api';
import type { ReceiptResult } from '@/lib/devices';
import { getDocumentFull, isMargeDocument, type DocumentFull, type DocumentMargeExtra } from './write-api';
import { vatBreakdown } from './document-pdf';
import { loadLegalMentions } from './document-pdf-data';
import { formatCompanyNumber } from './invoice-legal';
import { printDocument } from './print-document';
import { CASH_METHOD } from './cash-rounding';
import { buildTicketReceipt, type TicketReceiptInput } from './receipt-ticket';

/** Construit le ticket d'un document (lecture seule). */
export async function loadTicketReceipt(
  full: DocumentFull, companyName: string, ctx: DeviceContext, duplicate: boolean,
): Promise<ReceiptDoc> {
  const { doc, lines } = full;
  const d = doc as typeof doc & DocumentMargeExtra & { cash_session_id?: string | null };
  const [{ data: company }, { data: contact }, { data: payments }, { data: methods }, session] = await Promise.all([
    supabase.from('companies').select('*').eq('id', doc.company_id).maybeSingle(),
    doc.contact_id ? supabase.from('contacts').select('*').eq('id', doc.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('document_payments').select('*').eq('document_id', doc.id).order('paid_at'),
    supabase.from('reference_values').select('code, label').eq('company_id', doc.company_id).eq('table_key', 'payment_method'),
    d.cash_session_id
      ? supabase.from('cash_sessions').select('*').eq('id', d.cash_session_id).maybeSingle().then((r) => r.data as Record<string, unknown> | null)
      : Promise.resolve(null),
  ]);
  const co = (company ?? {}) as Record<string, unknown>;
  const c = (contact ?? null) as Record<string, unknown> | null;
  const locale = contactLocale(c);
  const methodLabel = new Map((methods ?? []).map((m) => [m.code, m.label]));

  // Regime de la marge : colonne du document, sinon detection par article O (comme print-document).
  let marge = isMargeDocument(doc);
  const artIds = lines.map((l) => l.article_id).filter(Boolean) as string[];
  const i18nByArticle = new Map<string, unknown>();
  if (artIds.length) {
    const { data: arts } = await supabase.from('articles').select('id, mgmt_type').in('id', artIds);
    if (d.vat_scheme == null) marge = (arts ?? []).some((a) => a.mgmt_type === 'O');
    if (locale !== 'fr') {
      const { data: trs } = await supabase.from('articles').select('id, designation_i18n').in('id', artIds);
      for (const a of (trs ?? []) as { id: string; designation_i18n: unknown }[]) i18nByArticle.set(a.id, a.designation_i18n);
    }
  }

  const vatRows = marge ? [] : vatBreakdown(
    lines.map((l) => ({ lineType: l.line_type, quantity: Number(l.quantity), unitPriceHt: Number(l.unit_price_ht), discountPct: Number(l.discount_pct || 0), vatRate: Number(l.vat_rate) })),
    {
      taxExempt: !!doc.tax_exempt, globalDiscountPct: Number(doc.global_discount_pct), globalDiscountAmount: Number(doc.global_discount_amount),
      shippingHt: Number(doc.shipping_ht), shippingTaxed: doc.shipping_taxed !== false, shippingVatRate: Number(doc.shipping_vat_rate),
    },
  );

  const legal = await loadLegalMentions(doc, (payments ?? []) as Record<string, unknown>[], locale);
  const mentions = [
    ...(marge ? [tIn(locale, 'salesPdf.margeMention')] : doc.tax_exempt && !legal ? [tIn(locale, 'sales.taxExemptMention')] : []),
    ...(legal ?? []),
  ];

  const createdAt = doc.created_at ? new Date(doc.created_at) : new Date();
  const input: TicketReceiptInput = {
    company: {
      name: String(co.name ?? companyName), legalName: (co.legal_name as string) ?? null,
      address: [co.address].filter(Boolean).join(' ') || null, zip: (co.zip as string) ?? null, city: (co.city as string) ?? null,
      vatNumber: (co.vat_number as string) ?? null,
      companyNumber: co.company_number ? formatCompanyNumber(String(co.company_number)) : null,
      phone: (co.phone as string) ?? null,
    },
    doc: {
      docType: doc.doc_type, number: doc.number, issuedAt: createdAt, operator: doc.operator ?? null,
      totalHt: Number(doc.total_ht), totalVat: Number(doc.total_vat), totalTtc: Number(doc.total_ttc),
      taxExempt: !!doc.tax_exempt, marge,
      globalDiscountPct: Number(doc.global_discount_pct || 0), globalDiscountAmount: Number(doc.global_discount_amount || 0),
    },
    client: c ? { name: contactDisplayName(c as never), vatNumber: (c.vat_number as string) ?? null } : null,
    lines: lines.map((l) => ({
      lineType: l.line_type, reference: l.reference ?? null,
      designation: l.article_id ? designationFor(locale, l.designation, i18nByArticle.get(l.article_id)) : l.designation,
      quantity: Number(l.quantity), unitPriceHt: Number(l.unit_price_ht), vatRate: Number(l.vat_rate),
      discountPct: Number(l.discount_pct || 0), lineTtc: Number(l.line_ttc),
    })),
    vatRows,
    payments: (payments ?? []).map((p) => ({
      label: methodLabel.get(p.method) ?? p.method, amount: Number(p.amount), given: p.given_amount != null ? Number(p.given_amount) : null,
      isCash: p.method === CASH_METHOD, status: p.status,
    })),
    register: {
      code: ctx.workstation?.register_code || (session?.register_code as string | undefined) || null,
      workstation: ctx.workstation?.name ?? null,
      zNumber: (session?.z_number as string | null | undefined) ?? null,
    },
    mentions,
    footer: ctx.settings.receipt_footer ?? (co.invoice_footer as string | null) ?? null,
    duplicate,
  };
  return buildTicketReceipt(input, (key, vars) => {
    let s = tIn(locale, `devices.receipt.${key}`);
    for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
    return s;
  });
}

/**
 * Imprime le ticket d'un document au comptoir. `duplicate` : reimpression (« DUPLICATA »).
 * Trace `receipt_printed` / `receipt_reprinted` dans `events` (jamais bloquant).
 */
export async function printTicket(
  documentId: string, companyName: string, ctx: DeviceContext, duplicate = false,
): Promise<ReceiptResult> {
  const full = await getDocumentFull(documentId);
  const receipt = await loadTicketReceipt(full, companyName, ctx, duplicate);
  const result = await printReceipt(ctx, receipt, { legacyA4: () => printDocument(full, companyName) });
  if (result.ok) {
    void logDeviceEvent(full.doc.company_id, duplicate ? 'receipt_reprinted' : 'receipt_printed', ctx.workstation?.id ?? null, {
      document_id: full.doc.id, number: full.doc.number, driver: result.driver,
    });
  }
  return result;
}
