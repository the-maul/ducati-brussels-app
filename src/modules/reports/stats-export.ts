/**
 * M13 — Export Excel des statistiques (G8 : bouton « Export Excel »). SheetJS (`xlsx`, déjà dans le
 * projet) chargé à la demande, comme l'import de tarif : rien n'alourdit la page tant qu'on n'exporte pas.
 */
export type SheetRows = (string | number | null)[][];

export async function downloadXlsx(fileName: string, sheets: { name: string; rows: SheetRows }[]): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((c) => (c === null ? '' : c))));
    // Largeur des colonnes : d'après le contenu (bornée), lisible à l'ouverture.
    const widths = (s.rows[0] ?? []).map((_, i) => Math.min(48, Math.max(8, ...s.rows.map((r) => String(r[i] ?? '').length + 2))));
    ws['!cols'] = widths.map((wch) => ({ wch }));
    // Nom d'onglet Excel : 31 caractères au plus, sans : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Feuille');
  }
  XLSX.writeFile(wb, fileName);
}
