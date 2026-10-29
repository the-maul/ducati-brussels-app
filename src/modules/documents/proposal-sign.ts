/**
 * M9 — Signature d'une proposition d'intervention (ATE008 / ATE009) : REGLES PURES de l'ecran
 * /signer/<jeton> (espace client, lien du mail, tablette du comptoir). Aucun acces base :
 * la fonction serveur `proposal-sign` fournit la proposition (`ProposalPayload`) et enregistre
 * la signature ; ici on construit le PDF signe et le texte accepte.
 */
import { tIn, DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n';
import { designationFor } from '@/lib/i18n/client-locale';
import type { SalesPdfInput, SalesPdfSignature } from '@/modules/sales/document-pdf';
import { acceptedTextFor, proposalGroups, partitionProposal, type ProposalGroup, type ProposalLine } from '@/modules/workshop/checkup/rules';

export type ProposalStatus = 'en_attente' | 'accepte' | 'expire' | 'annulee';

export type ProposalPayloadLine = ProposalLine & {
  designation_i18n?: unknown;
  /** URL signee (1 h) de la photo du check-up, posee par la fonction serveur. */
  photo_url?: string | null;
};

export type ProposalPayload = {
  document_id: string;
  number: string | null;
  issue_date: string;
  created_at: string | null;
  status: ProposalStatus;
  accepted_at: string | null;
  expires_at: string | null;
  total_ht: number | string;
  total_vat: number | string;
  total_ttc: number | string;
  notes: string | null;
  operator: string | null;
  company: {
    id: string; name: string | null; legal_name: string | null; address: string | null; zip: string | null; city: string | null;
    vat_number: string | null; iban: string | null; bic: string | null; invoice_footer: string | null; cgv_text: string | null;
    logo_url: string | null;
  } | null;
  contact: {
    id: string; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null;
    locale: string | null; address: string | null; street_number: string | null; zip: string | null; city: string | null;
    country: string | null; legacy_code: string | null;
  } | null;
  vehicle: { id: string; brand: string | null; model: string | null; vin: string | null; plate: string | null; mileage: number | null } | null;
  repair_order: { id: string; number: string | null; mileage: number | null; reason_code: string | null } | null;
  lines: ProposalPayloadLine[];
  signature: {
    id: string; signer_name: string | null; signed_at: string; mode: 'distance' | 'comptoir' | null; signed_ip: string | null;
    accepted_text_hash: string | null; signature_data: string | null;
  } | null;
};

export type SignatureRecord = {
  signature_id: string; signed_at: string; hash: string; ip?: string | null; kept: number; deferred: number;
  contact_email?: string | null; locale?: string;
};

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function proposalLocale(p: Pick<ProposalPayload, 'contact'> | null | undefined): Locale {
  const raw = p?.contact?.locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export function clientName(c: ProposalPayload['contact']): string {
  if (!c) return '';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return c.company_name ? (person ? `${c.company_name} - ${person}` : c.company_name) : person;
}

export function vehicleLabel(v: ProposalPayload['vehicle']): string | null {
  if (!v) return null;
  const s = [v.brand, v.model, v.plate ? `(${v.plate})` : ''].filter(Boolean).join(' ').trim();
  return s || v.vin || null;
}

/** Groupes a cocher (une case par carte du check-up), libelles dans la langue du client. */
export function groupsFor(p: ProposalPayload): ProposalGroup[] {
  const locale = proposalLocale(p);
  const lines = p.lines.map((l) => ({ ...l, designation: designationFor(locale, l.designation, l.designation_i18n) }));
  return proposalGroups(lines);
}

/** Cases cochees par defaut : tout (le client decoche ce qu'il ne veut pas tout de suite). */
export function defaultKept(groups: ProposalGroup[]): Set<string> {
  return new Set(groups.map((g) => g.id));
}

/** Le texte exact que le client accepte, dans sa langue. */
export function acceptedText(p: ProposalPayload, groups: ProposalGroup[], keptIds: Iterable<string>, signerName: string, dateIso = new Date().toISOString()): string {
  const locale = proposalLocale(p);
  const part = partitionProposal(groups, keptIds);
  return acceptedTextFor({
    number: p.number, companyName: p.company?.name ?? '', clientName: clientName(p.contact), vehicleLabel: vehicleLabel(p.vehicle),
    kept: part.kept, totalTtc: part.totalTtc, signerName, sentence: tIn(locale, 'checkup.signSentence'), dateIso,
  });
}

/**
 * Entree du PDF signe : la proposition (lignes gardees et barrees), les photos deja chargees
 * (`photos` : id de ligne → image), la signature enregistree par la base.
 */
export function proposalPdfInput(
  p: ProposalPayload,
  opts: { keptLineIds: Set<string> | null; photos: Map<string, { dataUrl: string; w: number; h: number }>; signature: SalesPdfSignature | null; logo?: SalesPdfInput['company']['logo'] },
): SalesPdfInput {
  const locale = proposalLocale(p);
  const t = (key: string) => tIn(locale, key);
  const co = p.company;
  const c = p.contact;
  const v = p.vehicle;
  const s = (x: unknown) => (x == null ? '' : String(x));
  const clientLines = c ? [
    clientName(c),
    [c.street_number, c.address].filter(Boolean).join(' '),
    [c.zip, c.city, c.country && c.country !== 'BE' ? c.country : ''].filter(Boolean).join(' '),
    c.email ? s(c.email) : '',
  ].map(s).filter(Boolean) : [];
  const vehicleLines = v ? [
    v.vin ? `${t('salesPdf.vin')} : ${s(v.vin)}` : '',
    v.brand ? `${t('salesPdf.brand')} : ${s(v.brand)}` : '',
    v.model ? `${t('salesPdf.model')} : ${s(v.model)}` : '',
    v.plate ? `${t('salesPdf.plate')} : ${s(v.plate)}` : '',
    (p.repair_order?.mileage ?? v.mileage) != null ? `${t('salesPdf.mileage')} : ${s(p.repair_order?.mileage ?? v.mileage)}` : '',
  ].filter(Boolean) : [];
  const keptIds = opts.keptLineIds;
  const lines = [...p.lines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((l) => {
    const accepted = keptIds ? keptIds.has(l.id) : l.accepted ?? null;
    return {
      lineType: l.line_type, reference: l.reference ?? null,
      designation: designationFor(locale, l.designation, l.designation_i18n),
      quantity: num(l.quantity), unitPriceHt: num(l.unit_price_ht), vatRate: num(l.vat_rate),
      discountPct: num(l.discount_pct ?? 0), lineTtc: num(l.line_ttc),
      photo: opts.photos.get(l.id) ?? null, accepted,
    };
  });
  const keptLines = lines.filter((l) => l.accepted !== false);
  const ht = Math.round(keptLines.reduce((acc, l) => acc + num(l.quantity) * num(l.unitPriceHt) * (1 - num(l.discountPct) / 100), 0) * 100) / 100;
  const ttc = Math.round(keptLines.reduce((acc, l) => acc + num(l.lineTtc), 0) * 100) / 100;
  return {
    docType: 'DEV', number: p.number, issueDate: p.issue_date, createdAt: p.created_at, dueDate: null, condition: null,
    operator: p.operator, clientCode: c?.legacy_code ?? (c?.id ? c.id.slice(0, 8) : null),
    company: {
      name: s(co?.name) || s(co?.legal_name), legalName: co?.legal_name && co.legal_name !== co.name ? co.legal_name : null,
      address: co?.address ?? null, zip: co?.zip ?? null, city: co?.city ?? null, vatNumber: co?.vat_number ?? null,
      iban: co?.iban ?? null, bic: co?.bic ?? null, footer: co?.invoice_footer ?? null, cgv: co?.cgv_text ?? null, logo: opts.logo ?? null,
    },
    clientLines, vehicleLines, lines, payments: [], taxExempt: false, isMarge: false, pied: {},
    totals: { ht, vat: Math.round((ttc - ht) * 100) / 100, ttc, paid: 0 },
    validity: null, notes: p.notes, locale,
    titleOverride: t('checkup.pdfTitle'), signature: opts.signature,
  };
}

/** Nom du fichier PDF signe, dans la langue du client. */
export function signedPdfFileName(p: ProposalPayload): string {
  const locale = proposalLocale(p);
  const label = tIn(locale, 'checkup.pdfTitle').replace(/\s+/g, '-');
  const raw = `${label}_${p.number ?? ''}_${tIn(locale, 'checkup.pdfSignedSuffix')}`;
  return `${raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_')}.pdf`;
}
