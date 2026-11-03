/**
 * M6 / M9 — Mentions légales d'une facture, d'une facture d'acompte et d'un avoir (lot du 03/11/2026,
 * étude docs/etudes/2026-11-facturation-peppol-compta.md §3). Fichier PUR (testé).
 *
 * Langue (§3 ligne 16, lois linguistiques : siège d'exploitation à Waterloo) : chaque mention est
 * imprimée EN FRANÇAIS, suivie de sa traduction dans la langue du client quand elle n'est pas le
 * français. Les textes sont dans les dictionnaires (`invoiceLegal.*`, 4 langues).
 *
 * - avoir : référence « spécifique et non équivoque » à la facture rectifiée (n° + date, AR 1 art. 12)
 *   et mention AR n° 4 art. 4 §1 « TVA à reverser à l'État dans la mesure où elle a été initialement
 *   déduite » quand l'avoir porte de la TVA ;
 * - facture d'acompte : date de l'encaissement et commande d'origine (AR 1 art. 5 §1 5°), TVA exigible
 *   à l'encaissement (CTVA art. 17 §1) ;
 * - facture finale : acomptes déjà facturés, référencés et déduits (AR 1 art. 5 §1 11°) ;
 * - détaxe : exonération art. 39 CTVA (PDV005).
 * Le régime de la marge garde sa mention propre (`salesPdf.margeMention`, lot TVA marge).
 */
import { tIn, type Locale } from '@/lib/i18n';

export type PrepaidMention = { number: string | null; issueDate: string | null; ttc: number; vat: number };

export type LegalMentionInput = {
  docType: string;
  locale?: Locale;
  /** Document d'origine : facture rectifiée (avoir) ou commande (facture d'acompte). */
  source?: { number: string | null; issueDate: string | null } | null;
  totalVat: number;
  taxExempt?: boolean;
  /** Facture d'acompte : date de l'encaissement. */
  depositPaidAt?: string | null;
  /** Facture finale : factures d'acompte déduites. */
  prepaid?: PrepaidMention[];
};

export const dmyIso = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const eurTxt = (n: number) => `${(Math.round(Math.abs(n) * 100) / 100).toFixed(2).replace('.', ',')} €`;

/** N° BCE lisible : 0472540151 → 0472.540.151 (vide si absent). */
export function formatCompanyNumber(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)}.${d.slice(4, 7)}.${d.slice(7)}` : String(v ?? '').trim();
}

/** Une mention : français d'abord, puis la langue du client si différente. */
function both(locale: Locale | undefined, key: string, fill: (s: string) => string): string[] {
  const fr = fill(tIn('fr', key));
  if (!locale || locale === 'fr') return [fr];
  const other = fill(tIn(locale, key));
  return other && other !== fr ? [fr, other] : [fr];
}

export function invoiceLegalMentions(i: LegalMentionInput): string[] {
  const out: string[] = [];
  const src = i.source;
  if (i.docType === 'AVO') {
    if (src?.number) {
      out.push(...both(i.locale, 'invoiceLegal.creditRef', (s) => s.replace('{number}', src.number ?? '').replace('{date}', dmyIso(src.issueDate))));
    }
    if (Math.abs(Number(i.totalVat) || 0) > 0.004) out.push(...both(i.locale, 'invoiceLegal.ar4', (s) => s));
  }
  if (i.docType === 'FAA') {
    out.push(...both(i.locale, 'invoiceLegal.depositInvoice', (s) => s
      .replace('{paid}', dmyIso(i.depositPaidAt))
      .replace('{number}', src?.number ?? '—')
      .replace('{date}', dmyIso(src?.issueDate))));
  }
  if (i.docType === 'FAC') {
    for (const p of i.prepaid ?? []) {
      out.push(...both(i.locale, 'invoiceLegal.prepaid', (s) => s
        .replace('{number}', p.number ?? '—').replace('{date}', dmyIso(p.issueDate))
        .replace('{ttc}', eurTxt(p.ttc)).replace('{vat}', eurTxt(p.vat))));
    }
  }
  if (i.taxExempt) out.push(...both(i.locale, 'sales.taxExemptMention', (s) => s));
  return out;
}
