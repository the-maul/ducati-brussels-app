/**
 * M2 — Lecture d'un fichier tarif (.xlsx / .xls / .csv) côté navigateur.
 * Excel : SheetJS (import dynamique — chargé uniquement à l'usage, hors bundle initial).
 * CSV : réutilise parseCsv. Sortie unifiée au format ParsedCsv (headers + rows texte).
 */
import { parseCsv, type ParsedCsv } from './parse';

export async function parseTariffFile(file: File): Promise<ParsedCsv> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // raw:false → valeurs formatées en texte (« 49,11 € ») ; parseNum les digère.
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
    if (aoa.length === 0) return { headers: [], rows: [] };
    const headers = aoa[0].map((c) => String(c ?? '').trim());
    const rows = aoa.slice(1)
      .map((r) => headers.map((_, i) => String(r[i] ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''));
    return { headers, rows };
  }
  // CSV / texte
  return parseCsv(await file.text());
}
