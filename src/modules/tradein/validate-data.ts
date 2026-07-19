/**
 * M7 — Validation de reprise (B2/B3) : logique pure des 3 étapes.
 * Étape 1 : checklist « L'acheteur confirme avoir reçu ».
 * Étape 2 : statut TVA du vendeur → attestation « régime de la marge » requise ?
 * Étape 3 : montants (TVAC ⇄ HTVA), prix minimum, classement.
 * Testé dans tests/tradein-validate.test.ts (bun) + vérification JScript.
 */

/** Checklist de réception — clés stables (stockées en jsonb), libellés i18n. */
export const CHECKLIST_KEYS = [
  'coc', 'registration', 'main_key', 'second_key', 'code_card',
  'original_parts', 'service_book', 'user_manual', 'service_invoices',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export type Checklist = Record<ChecklistKey, boolean>;

export function emptyChecklist(): Checklist {
  return Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, false])) as Checklist;
}

/** Statut TVA du vendeur (cases de l'attestation + pro assujetti classique). */
export const SELLER_VAT_STATUSES = [
  'particulier', 'morale_non_assujettie', 'assujetti_44', 'assujetti_56', 'assujetti',
] as const;
export type SellerVatStatus = (typeof SELLER_VAT_STATUSES)[number];

/** L'attestation « régime particulier de la marge » est requise pour tout
 *  vendeur SANS droit à déduction (tout sauf l'assujetti classique). */
export function needsAttestation(s: SellerVatStatus): boolean {
  return s !== 'assujetti';
}

/** Taux de TVA par défaut : 0 % (marge) sauf professionnel assujetti → 21 %. */
export function defaultVatRate(s: SellerVatStatus): number {
  return s === 'assujetti' ? 21 : 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Prix TVAC → HTVA au taux donné (2 décimales). */
export function ttcToHt(ttc: number, rate: number): number {
  if (!Number.isFinite(ttc)) return 0;
  return r2(ttc / (1 + (rate || 0) / 100));
}

/** Prix HTVA → TVAC au taux donné (2 décimales). */
export function htToTtc(ht: number, rate: number): number {
  if (!Number.isFinite(ht)) return 0;
  return r2(ht * (1 + (rate || 0) / 100));
}

/** Vente sous le prix de vente minimum ? (alerte + notification Domenico) */
export function belowMinimum(salePrice: number, minPrice: number): boolean {
  return minPrice > 0 && salePrice > 0 && salePrice < minPrice;
}

export const MIN_PRICE_ALERT_EMAIL = 'domenico@ducatibxl.be';

/** Classement G8 par défaut (fournisseur / rayon / sous-rayon / catégorie). */
export type Classification = { supplier: string; rayon: string; sub_rayon: string; category: string };
export function defaultClassification(isPro: boolean): Classification {
  return {
    supplier: 'DUCATI BRUXELLES',
    rayon: '08 - OCCASIONS',
    sub_rayon: isPro ? '02 - OCCASIONS PROFESSIONNELS' : '01 - OCCASIONS PARTICULIERS',
    category: isPro ? '02 - OCCASIONS PROFESSIONNELS' : '01 - OCCASIONS PARTICULIERS',
  };
}

/** Données consolidées de la validation (stockées sur le dossier de reprise). */
export type ValidationData = {
  checklist: Checklist;
  seller_vat_status: SellerVatStatus;
  attestation_place: string;
  attestation_date: string;         // ISO YYYY-MM-DD
  vat_rate: number;
  buy_price_ttc: number;
  buy_price_ht: number;
  sale_price: number;
  min_sale_price: number;
  classification: Classification;
};

/**
 * PAHT retenu pour la valorisation du stock (B5) :
 * — TVA marge (0 %) : pas de TVA déductible → le coût est le prix payé TVAC ;
 * — assujetti 21 % : la TVA se déduit → coût = HTVA.
 */
export function stockUnitCost(v: Pick<ValidationData, 'vat_rate' | 'buy_price_ttc' | 'buy_price_ht'>): number {
  return v.vat_rate > 0 ? v.buy_price_ht : v.buy_price_ttc;
}
