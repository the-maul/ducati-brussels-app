/**
 * M6 — Type de document proposé à l'ouverture de l'éditeur (mission 08, carte 3, 03/11/2026).
 * « Devis / proforma » par défaut : un « Valider » par réflexe ne numérote plus une facture et ne
 * sort plus le stock. Réglage par société dans Paramètres → Tables → « Type de document par
 * défaut (Ventes) » (`reference_values`, `sales_default_doc_type`, code = DEV / FAC / BC…) ;
 * sans ligne active, DEV. Le lien `?docType=` (31/10) et le devis atelier gardent la priorité.
 */
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_DOC_TYPE_TABLE_KEY = 'sales_default_doc_type';
export const EDITOR_DOC_TYPES = ['DEV', 'BC', 'RES', 'BL', 'FAC', 'TIK'] as const;
export const FALLBACK_DOC_TYPE = 'DEV';

const known = (v: string | null | undefined): v is string => !!v && (EDITOR_DOC_TYPES as readonly string[]).includes(v);

/**
 * Type proposé : devis atelier (depuis un OR) → DEV ; sinon le type demandé par le lien ;
 * sinon le réglage de la société ; sinon « Devis / proforma ». Une valeur inconnue est ignorée.
 */
export function resolveInitialDocType(p: { requested?: string | null; workshop?: boolean; companyDefault?: string | null }): string {
  if (p.workshop) return 'DEV';
  const requested = p.requested?.toUpperCase();
  if (known(requested)) return requested;
  const companyDefault = p.companyDefault?.toUpperCase();
  if (known(companyDefault)) return companyDefault;
  return FALLBACK_DOC_TYPE;
}

/** Réglage de la société : première ligne active de la table, ou null (→ DEV). */
export async function loadDefaultDocType(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('reference_values').select('code, sort_order')
    .eq('company_id', companyId).eq('table_key', DEFAULT_DOC_TYPE_TABLE_KEY).eq('is_active', true)
    .order('sort_order').limit(1);
  if (error) return null;
  const code = data?.[0]?.code?.toUpperCase();
  return known(code) ? code : null;
}
