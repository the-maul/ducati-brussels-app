/**
 * M6 — Accessoire trouvé dans l'e-catalog Ducati (mission 05, carte 4) : accès aux données.
 *
 * - Recherche EXACTE d'une référence collée (référence, réf. fournisseur, code-barres ;
 *   librairie comprise) avec stock et « en commande » : fonction SQL `sale_article_exact_lookup`.
 * - Création d'un article « à compléter » par le chemin de création existant (`createArticle`,
 *   M2) : type A en librairie (non stocké tant qu'il n'est pas réceptionné, même règle que
 *   l'import des tarifs), marque Ducati, prix de vente saisi par le vendeur. Le trigger
 *   `trg_articles_to_complete` trace la création dans `events` (origine `ecatalog`).
 */
import { supabase } from '@/integrations/supabase/client';
import { createArticle } from '@/modules/articles/api';
import type { SaleArticle } from './write-api';
import { salePricesFrom } from './ecatalog';

export type ExactMatch = SaleArticle & {
  is_library: boolean; to_complete: boolean; catalog_url: string | null; brand: string | null;
  supplier_ref: string | null; matched_on: 'reference' | 'supplier_ref' | 'barcode';
};

export async function lookupExactReference(companyId: string, reference: string): Promise<ExactMatch[]> {
  const { data, error } = await supabase.rpc('sale_article_exact_lookup', { _company: companyId, _ref: reference });
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.article_id, reference: a.reference, designation: a.designation,
    sale_price_ht: Number(a.sale_price_ht ?? 0), vat_rate: Number(a.vat_rate ?? 21),
    mgmt_type: a.mgmt_type ?? null, bin_location: a.bin_location ?? null,
    real_qty: Number(a.real_qty ?? 0), reserved_qty: Number(a.reserved_qty ?? 0), on_order_qty: Number(a.on_order_qty ?? 0),
    superseded_by_id: a.superseded_by_id ?? null, equivalence_group: a.equivalence_group ?? null,
    is_library: !!a.is_library, to_complete: !!a.to_complete, catalog_url: a.catalog_url ?? null,
    brand: a.brand ?? null, supplier_ref: a.supplier_ref ?? null,
    matched_on: (a.matched_on as ExactMatch['matched_on']) ?? 'reference',
  }));
}

export type ToCompleteInput = {
  companyId: string; reference: string; designation: string;
  /** Prix saisi par le vendeur, dans la convention de la ligne (HT ou TTC). */
  price: number; priceMode: 'ht' | 'ttc'; vatRate?: number;
  /** Lien e-catalog collé (enregistré sur l'article s'il vient d'e-catalog.ducati.com). */
  catalogUrl?: string | null;
};

/** Crée l'article minimal « à compléter » et le renvoie prêt à poser sur la ligne. */
export async function createToCompleteArticle(input: ToCompleteInput): Promise<ExactMatch> {
  const vat = input.vatRate ?? 21;
  const { ht, ttc } = salePricesFrom(input.price, input.priceMode, vat);
  const a = await createArticle({
    company_id: input.companyId,
    reference: input.reference,
    designation: input.designation.trim(),
    brand: 'Ducati',
    mgmt_type: 'A',
    is_library: true,
    supplier_ref: input.reference,
    sale_price_ht: ht,
    sale_price_ttc: ttc,
    vat_rate: vat,
    catalog_url: input.catalogUrl ?? null,
    to_complete: true,
    to_complete_source: 'ecatalog',
  });
  return {
    id: a.id, reference: a.reference, designation: a.designation,
    sale_price_ht: Number(a.sale_price_ht ?? ht), vat_rate: Number(a.vat_rate ?? vat),
    mgmt_type: a.mgmt_type, bin_location: null, real_qty: 0, reserved_qty: 0, on_order_qty: 0,
    superseded_by_id: null, equivalence_group: null,
    is_library: true, to_complete: true, catalog_url: a.catalog_url ?? null, brand: a.brand ?? 'Ducati',
    supplier_ref: a.supplier_ref ?? input.reference, matched_on: 'reference',
  };
}
