/**
 * M6/M9 — Chargement des données d'un document de vente pour son PDF (`document-pdf.ts`) :
 * société (table `companies` : nom, raison sociale, adresse, TVA, IBAN, logo, pied, CGV),
 * client, véhicule, règlements, détection TVA marge (article de type O), règle de validité
 * (Paramètres → Tables → « Validité des documents », `reference_values.sales_document_validity`).
 * Mêmes lectures que l'impression HTML (`print-document.ts`), qui reste inchangée.
 */
import { supabase } from '@/integrations/supabase/client';
import { contactDisplayName } from '@/modules/contacts/api';
import { fetchImageForPdf } from '@/lib/image-tools';
import { t } from '@/lib/i18n';
import type { DocumentFull } from './write-api';
import {
  buildSalesDocumentPdf, validityMention, salesPdfFileName, dmy,
  type SalesPdfInput, type ValidityRule,
} from './document-pdf';

/** Clé de la table de paramètres des mentions de validité (code = type de document). */
export const VALIDITY_TABLE_KEY = 'sales_document_validity';

export async function loadValidityRules(companyId: string): Promise<ValidityRule[]> {
  const { data, error } = await supabase
    .from('reference_values').select('code, label, is_active, extra')
    .eq('company_id', companyId).eq('table_key', VALIDITY_TABLE_KEY);
  if (error) return [];
  return (data ?? []).map((r) => ({
    docType: String(r.code).toUpperCase(),
    text: r.label,
    months: Number((r.extra as { months?: number } | null)?.months ?? 0),
    active: r.is_active,
  }));
}

export async function loadSalesPdfInput(full: DocumentFull): Promise<SalesPdfInput> {
  const { doc, lines } = full;
  const [{ data: company }, { data: contact }, { data: payments }, { data: vehicle }, rules] = await Promise.all([
    supabase.from('companies').select('*').eq('id', doc.company_id).maybeSingle(),
    doc.contact_id ? supabase.from('contacts').select('*').eq('id', doc.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('document_payments').select('*').eq('document_id', doc.id).order('paid_at'),
    doc.vehicle_id ? supabase.from('vehicles').select('*').eq('id', doc.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    loadValidityRules(doc.company_id),
  ]);
  const co = (company ?? {}) as Record<string, unknown>;
  const c = (contact ?? null) as Record<string, unknown> | null;
  const v = (vehicle ?? null) as Record<string, unknown> | null;
  const s = (x: unknown) => (x == null ? '' : String(x));

  let isMarge = false;
  const artIds = lines.map((l) => l.article_id).filter(Boolean) as string[];
  if (artIds.length) {
    const { data: arts } = await supabase.from('articles').select('id, mgmt_type').in('id', artIds);
    isMarge = (arts ?? []).some((a) => a.mgmt_type === 'O');
  }

  const logoUrl = s(co.logo_url);
  const logoImg = logoUrl ? await fetchImageForPdf(logoUrl, 'pdf') : null;

  const clientLines = c ? [
    contactDisplayName(c as never),
    [c.street_number, c.address].filter(Boolean).join(' '),
    [c.zip, c.city, c.country && c.country !== 'BE' ? c.country : ''].filter(Boolean).join(' '),
    c.phone || c.mobile ? `${t('salesPdf.phone')} : ${[c.phone, c.mobile].filter(Boolean).join(' / ')}` : '',
    c.email ? s(c.email) : '',
    c.vat_number ? `${t('salesPdf.vat')} : ${s(c.vat_number)}` : '',
  ].map(s).filter(Boolean) : [];

  const vehicleLines = v ? [
    v.vin ? `${t('salesPdf.vin')} : ${s(v.vin)}` : '',
    v.brand ? `${t('salesPdf.brand')} : ${s(v.brand)}` : '',
    v.model ? `${t('salesPdf.model')} : ${s(v.model)}` : '',
    v.plate ? `${t('salesPdf.plate')} : ${s(v.plate)}` : '',
    v.mileage != null ? `${t('salesPdf.mileage')} : ${s(v.mileage)}` : '',
    v.color ? `${t('salesPdf.color')} : ${s(v.color)}` : '',
    v.displacement != null ? `${t('salesPdf.displacement')} : ${s(v.displacement)}` : '',
    v.first_registration_date ? `${t('salesPdf.firstRegistration')} : ${dmy(s(v.first_registration_date))}` : '',
    v.engine_number ? `${t('salesPdf.engineNumber')} : ${s(v.engine_number)}` : '',
  ].filter(Boolean) : [];

  const pays = (payments ?? []).filter((p) => Number(p.amount) !== 0).map((p) => ({
    date: String(p.paid_at).slice(0, 10),
    label: `${String(p.note ?? '').toLowerCase().includes('acompte') ? `${t('salesPdf.deposit')} ` : ''}${p.method}`,
    amount: Number(p.amount),
    received: p.status !== 'attendu',
  }));

  return {
    docType: doc.doc_type,
    number: doc.number,
    issueDate: doc.issue_date,
    createdAt: doc.created_at,
    dueDate: doc.due_date,
    condition: doc.condition_reglement,
    operator: doc.operator,
    clientCode: s(c?.legacy_code) || (c?.id ? s(c.id).slice(0, 8) : doc.code_client_legacy),
    company: {
      name: s(co.name) || s(co.legal_name),
      legalName: s(co.legal_name) && s(co.legal_name) !== s(co.name) ? s(co.legal_name) : null,
      address: s(co.address) || null, zip: s(co.zip) || null, city: s(co.city) || null,
      vatNumber: s(co.vat_number) || null, iban: s(co.iban) || null, bic: s(co.bic) || null,
      footer: s(co.invoice_footer) || null, cgv: s(co.cgv_text) || null,
      logo: logoImg ? { dataUrl: logoImg.dataUrl, format: 'JPEG', w: logoImg.w, h: logoImg.h } : null,
    },
    clientLines,
    vehicleLines,
    lines: lines.map((l) => ({
      lineType: l.line_type, reference: l.reference, designation: l.designation,
      quantity: Number(l.quantity), unitPriceHt: Number(l.unit_price_ht), vatRate: Number(l.vat_rate),
      discountPct: Number(l.discount_pct || 0), lineTtc: Number(l.line_ttc),
    })),
    payments: pays,
    taxExempt: !!doc.tax_exempt,
    isMarge,
    pied: {
      globalDiscountPct: Number(doc.global_discount_pct), globalDiscountAmount: Number(doc.global_discount_amount),
      shippingHt: Number(doc.shipping_ht), shippingTaxed: doc.shipping_taxed !== false,
      shippingVatRate: Number(doc.shipping_vat_rate),
    },
    totals: { ht: Number(doc.total_ht), vat: Number(doc.total_vat), ttc: Number(doc.total_ttc), paid: Number(doc.paid_amount) },
    validity: validityMention(doc.doc_type, doc.issue_date, rules),
    notes: doc.notes,
  };
}

export type SalesPdf = { bytes: Uint8Array; fileName: string };

/** Génère le PDF d'un document de vente (données fraîches de la base). */
export async function generateSalesPdf(full: DocumentFull): Promise<SalesPdf> {
  const input = await loadSalesPdfInput(full);
  const bytes = await buildSalesDocumentPdf(input);
  return { bytes, fileName: salesPdfFileName(full.doc.doc_type, full.doc.number) };
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Aperçu : ouvre le PDF dans un nouvel onglet (visionneuse PDF du navigateur : lire, imprimer,
 * télécharger). L'onglet est ouvert AVANT la génération pour ne pas être bloqué par le navigateur.
 */
export async function openSalesPdfPreview(full: DocumentFull): Promise<void> {
  const w = window.open('', '_blank');
  try {
    const { bytes } = await generateSalesPdf(full);
    const url = URL.createObjectURL(pdfBlob(bytes));
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}
