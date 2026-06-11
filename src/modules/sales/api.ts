/**
 * M6 (fondation) — Documents de vente : lecture pour encours client, échéances, stats article.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type DocumentRow = Database['public']['Tables']['documents']['Row'];
export type Encours = { authorized: number; current: number; available: number };

export async function getContactEncours(contactId: string): Promise<Encours> {
  const { data, error } = await supabase.rpc('contact_encours', { _contact: contactId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { authorized: number; current_due: number; available: number } | undefined;
  return { authorized: Number(row?.authorized ?? 0), current: Number(row?.current_due ?? 0), available: Number(row?.available ?? 0) };
}

export async function listContactDocuments(contactId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents').select('*').eq('contact_id', contactId).order('issue_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Échéances non soldées d'un client (factures avec reste dû). */
export async function listContactDueItems(contactId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents').select('*').eq('contact_id', contactId).eq('doc_type', 'FAC').neq('status', 'annulee')
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).filter((d) => Number(d.total_ttc) - Number(d.paid_amount) > 0.005);
}

export type ArticleSaleLine = { issue_date: string; quantity: number; line_ht: number; number: string | null };
/** Lignes de vente d'un article (pour les statistiques). */
export async function listArticleSales(articleId: string): Promise<ArticleSaleLine[]> {
  const { data, error } = await supabase
    .from('document_lines')
    .select('quantity, line_ht, documents!inner(issue_date, number, doc_type, status)')
    .eq('article_id', articleId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => {
      const d = r.documents as unknown as { issue_date: string; number: string | null; doc_type: string; status: string };
      return d && d.doc_type === 'FAC' && d.status !== 'annulee'
        ? { issue_date: d.issue_date, quantity: Number(r.quantity), line_ht: Number(r.line_ht), number: d.number }
        : null;
    })
    .filter(Boolean) as ArticleSaleLine[];
}

/** Agrège des lignes de vente par mois (YYYY-MM). */
export function aggregateByMonth(lines: ArticleSaleLine[]): { month: string; qty: number; amount: number }[] {
  const map = new Map<string, { qty: number; amount: number }>();
  for (const l of lines) {
    const m = l.issue_date.slice(0, 7);
    const cur = map.get(m) ?? { qty: 0, amount: 0 };
    cur.qty += l.quantity; cur.amount += l.line_ht;
    map.set(m, cur);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, v]) => ({ month, ...v }));
}
