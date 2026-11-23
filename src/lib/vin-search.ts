/**
 * Recherche d'une moto par son n° de châssis (retour de Domenico, 23/11/2026) :
 *   1234    le VIN commence par 1234
 *   *1234   1234 se trouve dans les 6 derniers caractères du VIN
 *   *1234*  le VIN contient 1234
 */
export type VinQueryMode = 'starts' | 'last6' | 'contains';
export type VinQuery = { mode: VinQueryMode; text: string };

export const VIN_SEARCH_MIN = 2;
const VIN_TAIL = 6;

const clean = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function parseVinQuery(raw: string | null | undefined): VinQuery | null {
  const s = (raw ?? '').toUpperCase().replace(/[^A-Z0-9*]/g, '');
  const text = clean(s);
  if (text.length < VIN_SEARCH_MIN) return null;
  const first = s.startsWith('*');
  const last = s.endsWith('*');
  if (first && last) return { mode: 'contains', text };
  if (first) return { mode: 'last6', text };
  return { mode: 'starts', text };
}

export function vinMatchesQuery(vin: string | null | undefined, q: VinQuery): boolean {
  const v = clean(vin);
  if (!v) return false;
  if (q.mode === 'starts') return v.startsWith(q.text);
  if (q.mode === 'contains') return v.includes(q.text);
  return q.text.length >= VIN_TAIL ? v.endsWith(q.text) : v.slice(-VIN_TAIL).includes(q.text);
}

/** Filtre large côté base ; `vinMatchesQuery` tranche ensuite pour les 6 derniers. */
export function vinLikePattern(q: VinQuery): string {
  return q.mode === 'starts' ? `${q.text}%` : `%${q.text}%`;
}
