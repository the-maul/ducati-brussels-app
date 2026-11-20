/**
 * M6 — Opérateurs (vendeurs) de la société, comme G8 (décision Q63, 20/11/2026). PDV001 VEN016
 * Lecture : Paramètres → Tables → « Opérateurs (vendeurs) » (reference_values, sales_operator).
 * Colonne documents.operator_id : migration 20261120150000 ; tant qu'elle n'est pas posée,
 * l'opérateur choisi n'est pas envoyé (la base pose l'utilisateur connecté, comme avant).
 */
import { supabase } from '@/integrations/supabase/client';
import { schemaProbe as batchedSchemaProbe } from '@/lib/schema-probe';
import { listRef } from '@/modules/settings/reference-api';
import { SALES_OPERATOR_TABLE, toSalesOperators, type SalesOperator } from './operators';

export async function listSalesOperators(companyId: string): Promise<SalesOperator[]> {
  return toSalesOperators(await listRef(companyId, SALES_OPERATOR_TABLE));
}

let columnProbe: Promise<boolean> | null = null;
/** true quand la colonne documents.operator_id existe (migration 20261120150000 posée). */
export function operatorColumnReady(): Promise<boolean> {
  columnProbe ??= batchedSchemaProbe('documents.operator_id', async () => {
    try {
      const { error } = await supabase.from('documents').select('operator_id' as never).limit(1);
      return !error;
    } catch {
      return false;
    }
  });
  return columnProbe;
}

/** Colonne `operator_id` à envoyer (ou rien si absente en base / pas de choix). */
export async function operatorColumns(operatorId: string | null | undefined): Promise<{ operator_id?: string }> {
  if (!operatorId) return {};
  return (await operatorColumnReady()) ? { operator_id: operatorId } : {};
}
