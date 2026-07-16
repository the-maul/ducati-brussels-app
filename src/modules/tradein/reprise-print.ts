/**
 * M7 — Fiche de reprise imprimable (présentation professionnelle style
 * Ducati Bruxelles). Ouvre une fenêtre d'impression → imprimante / PDF.
 * Sections : en-tête, client, données de base, historique, caractéristiques
 * techniques, état, accessoires, remarques, photos.
 */

export type RepriseSheetRow = { label: string; value: string };
export type RepriseSheetSection = { title: string; rows: RepriseSheetRow[] };

export type RepriseSheet = {
  companyName: string;
  number: string;          // n° OCC / dossier
  date: string;            // date formatée FR
  clientName: string;
  clientDetails: string[]; // lignes contact (tél, e-mail, adresse…)
  title: string;           // marque + modèle
  sections: RepriseSheetSection[];
  accessories: string[];
  remarks: string | null;
  photos: { label: string; url: string }[];
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export function printRepriseSheet(s: RepriseSheet): void {
  const sectionHtml = (sec: RepriseSheetSection) => `
    <div class="section">
      <div class="section-title">${esc(sec.title)}</div>
      <table class="kv">
        ${sec.rows.filter((r) => r.value).map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}
      </table>
    </div>`;

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Reprise ${esc(s.number)} — ${esc(s.companyName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 14mm 12mm; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #C8102E; padding-bottom: 10px; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  .brand small { display: block; font-size: 11px; font-weight: 400; letter-spacing: .12em; color: #666; }
  .doc { text-align: right; }
  .doc .n { font-size: 15px; font-weight: 800; font-family: 'Courier New', monospace; }
  .doc .d { color: #666; margin-top: 2px; }
  h1 { font-size: 17px; text-transform: uppercase; letter-spacing: .03em; margin: 14px 0 2px; }
  .client { margin: 10px 0 4px; padding: 8px 10px; background: #f6f6f6; border-radius: 6px; }
  .client b { display: block; font-size: 13px; }
  .client span { color: #555; font-size: 11px; }
  .section { margin-top: 12px; page-break-inside: avoid; }
  .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #C8102E; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 5px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 3px 6px 3px 0; vertical-align: top; }
  table.kv td:first-child { width: 42%; color: #666; }
  table.kv td:last-child { font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chip { border: 1px solid #ccc; border-radius: 10px; padding: 2px 8px; font-size: 10.5px; }
  .remarks { white-space: pre-wrap; background: #f6f6f6; border-radius: 6px; padding: 8px 10px; margin-top: 4px; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-top: 6px; }
  .ph { page-break-inside: avoid; }
  .ph img { width: 100%; height: 52mm; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
  .ph .cap { font-size: 10px; color: #666; margin-top: 2px; text-align: center; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; color: #888; font-size: 10px; text-align: center; }
  @media print { body { padding: 8mm; } }
</style></head>
<body>
  <div class="head">
    <div class="brand">${esc(s.companyName)}<small>Reprise moto client</small></div>
    <div class="doc"><div class="n">${esc(s.number)}</div><div class="d">${esc(s.date)}</div></div>
  </div>

  <div class="client"><b>${esc(s.clientName)}</b><span>${s.clientDetails.map(esc).join(' · ')}</span></div>

  <h1>${esc(s.title)}</h1>

  ${s.sections.map(sectionHtml).join('')}

  ${s.accessories.length ? `
  <div class="section">
    <div class="section-title">Accessoires &amp; options</div>
    <div class="chips">${s.accessories.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
  </div>` : ''}

  ${s.remarks ? `
  <div class="section">
    <div class="section-title">Remarques</div>
    <div class="remarks">${esc(s.remarks)}</div>
  </div>` : ''}

  ${s.photos.length ? `
  <div class="section">
    <div class="section-title">Photos (${s.photos.length})</div>
    <div class="photos">${s.photos.map((p) => `<div class="ph"><img src="${esc(p.url)}" alt=""><div class="cap">${esc(p.label)}</div></div>`).join('')}</div>
  </div>` : ''}

  <div class="foot">${esc(s.companyName)} — fiche générée par le DMS · ${esc(s.date)}</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
