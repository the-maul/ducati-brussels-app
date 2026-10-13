/**
 * M0 — « Qualité des données » : les chantiers de maintenance du DMS.
 * Un seul appel pour les quatre compteurs (cf. migration 20261013160000) :
 * la barre latérale l'interroge sur chaque page, il doit rester léger.
 */
import { supabase } from '@/integrations/supabase/client';

// La fonction vient d'une migration recente : les types generes ne la connaissent
// pas encore (ils seront regeneres apres application en production).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcUntyped = supabase.rpc.bind(supabase) as any;

export type DataQualityCounts = {
  /** Rapprochements proposés qui attendent une décision. */
  links: number;
  /** Produits du site sans article dans le DMS. */
  shopify_unlinked: number;
  /** Motos déclarées par les clients, en attente de validation. */
  declarations: number;
  /** Numéros fixes qui sont en réalité des GSM (reprise G8). */
  phone_gsm: number;
  total: number;
};

export const EMPTY_COUNTS: DataQualityCounts = {
  links: 0, shopify_unlinked: 0, declarations: 0, phone_gsm: 0, total: 0,
};

export async function getDataQualityCounts(companyId: string): Promise<DataQualityCounts> {
  const { data, error } = await rpcUntyped('data_quality_counts', { _company: companyId });
  if (error) throw error;
  return { ...EMPTY_COUNTS, ...(data as unknown as DataQualityCounts) };
}

/**
 * Le nombre de CHANTIERS à traiter, pas le nombre de lignes : la pastille du
 * menu doit rester lisible (2 934 numéros à reprendre ne veulent pas dire
 * 2 934 choses à faire aujourd'hui).
 */
export function pendingTopics(c: DataQualityCounts | undefined): number {
  if (!c) return 0;
  return [c.links, c.shopify_unlinked, c.declarations, c.phone_gsm].filter((n) => n > 0).length;
}
