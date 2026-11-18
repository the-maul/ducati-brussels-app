/**
 * M13 — Statistiques : filtres de sélection et lecture des erreurs de la base (logique pure,
 * sans client Supabase : testée dans tests/statistiques-g8.test.ts).
 */
/** Filtres de sélection (G8 : famille, fournisseur, marque, référence, désignation, casier, client, opérateur...). */
export type StatsFilters = {
  family?: string; supplier_id?: string; brand?: string; reference?: string; designation?: string; bin?: string;
  article_id?: string; contact_id?: string; operator?: string; cession_type?: string; doc_type?: string;
  /** Nature de ligne, plusieurs séparées par des virgules : article, labour, other, shipping, header. */
  kind?: string; vehicles?: 'all' | 'only' | 'exclude'; exclude_reprises?: boolean;
};

/** Ne garde que les filtres renseignés (la base ignore les autres). */
export function cleanFilters(f: StatsFilters): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (k === 'vehicles' && v === 'all') || (k === 'exclude_reprises' && v === false)) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** La migration n'est pas encore posée (fonction inconnue). */
export function isStatsMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = (e as { message?: string } | null)?.message ?? '';
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg);
}

/** Refus de la base : rôle sans accès aux statistiques. */
export function isStatsForbidden(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = (e as { message?: string } | null)?.message ?? '';
  return code === '42501' || /stats_forbidden/.test(msg);
}
