/**
 * M6 (POS) — Regles pures de la vente comptoir (audit caisse du 03/11/2026, PDV000) :
 *  - un ticket ne se cree pas sans ligne ni sans montant (le TIK-2026-00001 a 0 EUR de juin 2026
 *    etait passe sans un mot) ;
 *  - le scan n ajoute un article que s il est seul a correspondre (sinon on choisit dans la liste) ;
 *  - le reste a encaisser d un ticket se calcule sur les reglements percus.
 * Testees dans tests/caisse-vente-comptoir.test.ts.
 */
import { documentValidationError, type DocumentValidationError, type LineInput } from './write-api';

export type PosCartLine = { article_id: string | null; designation: string; quantity: number; unit_price_ht: number; vat_rate: number };

/** Lignes du panier qui partent sur le ticket (quantite strictement positive, remise ligne 0). */
export function posTicketLines(cart: PosCartLine[]): LineInput[] {
  return cart.filter((l) => Number(l.quantity) > 0).map((l) => ({
    article_id: l.article_id, designation: l.designation, quantity: Number(l.quantity),
    unit_price_ht: Number(l.unit_price_ht), vat_rate: Number(l.vat_rate), discount_pct: 0, line_type: 'article',
  }));
}

/** Motif de refus d un encaissement (cle `sales.<motif>`), ou null si le ticket peut etre cree. */
export function posCartError(cart: PosCartLine[]): DocumentValidationError | null {
  return documentValidationError({ docType: 'TIK', status: 'validee', lines: posTicketLines(cart), requireAmount: true });
}

/** Article a ajouter d office sur Entree : seulement quand la recherche ne renvoie qu un resultat. */
export function scanAutoPick<T>(results: readonly T[] | null | undefined): T | null {
  return results && results.length === 1 ? results[0] : null;
}

/**
 * Date du ticket = date LOCALE du poste (AAAA-MM-JJ). `toISOString()` donnait la date UTC : un
 * ticket encaisse a 00 h 30 en hiver a Bruxelles etait date de la veille.
 */
export function localIsoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Reste a encaisser sur un ticket = TTC moins les reglements percus (jamais negatif). */
export function ticketRemaining(totalTtc: number, payments: { amount: number | string; status: string | null }[]): number {
  const paid = payments.filter((p) => (p.status ?? 'recu') === 'recu').reduce((s, p) => s + Number(p.amount), 0);
  const rest = Math.round((Number(totalTtc) - paid) * 100) / 100;
  return rest > 0 ? rest : 0;
}

/* ------------------------------------------------------------------------------------------------
 * Caisse conforme au droit belge (PDV010, 03/11/2026). Memes regles qu en base
 * (migration 20261103170000) : le navigateur refuse avant de consommer un numero, la base refuse
 * de toute facon. Testees dans tests/caisse-legale.test.ts.
 * ---------------------------------------------------------------------------------------------- */

/** Seuil de facture obligatoire pour une piece / un accessoire / une prestation du vehicule (AR n. 1, art. 1er par. 2, 9.). */
export const INVOICE_THRESHOLD_TTC = 125;
/** Types de gestion qui sont un vehicule a moteur (facture obligatoire, AR n. 1, art. 1er par. 2, 1.). */
export const VEHICLE_MGMT_TYPES = ['V', 'O', 'P', 'D'] as const;
/** Table de parametres (Parametres > Tables) : famille d article → facture obligatoire. */
export const INVOICE_FAMILY_TABLE_KEY = 'invoice_required_family';

export type InvoiceFamilyRule = { code: string; requiresInvoice: boolean; active?: boolean };

/**
 * Une famille ou un type de gestion impose-t-il la facture au-dela du seuil ? Le code de la table
 * est le DEBUT du chemin de famille de l article (`category_path`), sans tenir compte de la casse ;
 * le code le plus long l emporte (« 03-69 » avant « 03 », « ACCESSOIRES ET EQUIPEMENTS/ACC AGV »
 * avant « ACCESSOIRES ET EQUIPEMENTS »). Trois codages coexistent : rayons Ducati (R11, R12, R13...),
 * familles G8 « RR-SS-CC », libelles « RAYON/SOUS-RAYON ». Main-d oeuvre (T) = travaux sur le
 * vehicule. Famille inconnue : ticket possible. Meme regle en base (`_family_requires_invoice`).
 */
export function familyRequiresInvoice(rules: InvoiceFamilyRule[], categoryPath: string | null | undefined, mgmtType: string | null | undefined): boolean {
  if (mgmtType === 'T') return true;
  const path = (categoryPath ?? '').trim().toUpperCase();
  if (!path) return false;
  let best: InvoiceFamilyRule | null = null;
  for (const r of rules) {
    const code = r.code.trim().toUpperCase();
    if (!code || r.active === false || !path.startsWith(code)) continue;
    if (!best || code.length > best.code.trim().length) best = r;
  }
  return best ? best.requiresInvoice : false;
}

export type InvoiceRequiredLine = { category_path?: string | null; mgmt_type?: string | null; quantity: number; unit_price_ht: number; vat_rate: number };
export type InvoiceRequiredReason = 'vehicle' | 'threshold' | null;

/**
 * Pourquoi la vente doit etre une facture plutot qu un ticket : un vehicule (quel que soit le
 * montant) ou un total TTC > 125 EUR avec une piece / un accessoire / une prestation du vehicule.
 */
export function invoiceRequired(cart: InvoiceRequiredLine[], rules: InvoiceFamilyRule[]): InvoiceRequiredReason {
  const kept = cart.filter((l) => Number(l.quantity) > 0);
  if (kept.some((l) => (VEHICLE_MGMT_TYPES as readonly string[]).includes(l.mgmt_type ?? ''))) return 'vehicle';
  const ttc = kept.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price_ht) * (1 + Number(l.vat_rate) / 100), 0);
  if (Math.round(ttc * 100) / 100 <= INVOICE_THRESHOLD_TTC) return null;
  return kept.some((l) => familyRequiresInvoice(rules, l.category_path, l.mgmt_type)) ? 'threshold' : null;
}

/** La vente comptoir exige une caisse ouverte (le ticket et les especes s y rattachent). */
export const posSessionError = (session: { status: string } | null | undefined): 'noSession' | null =>
  session && session.status === 'open' ? null : 'noSession';
