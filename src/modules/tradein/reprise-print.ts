/**
 * M7 — Fiche de reprise imprimable (présentation professionnelle style
 * Ducati Bruxelles). Ouvre une fenêtre d'impression → imprimante / PDF A4.
 * CONFIDENTIALITÉ : aucune donnée nominative du client sur le document —
 * seule la référence interne (code client) apparaît ; l'identité reste dans l'ERP.
 * Photos et documents en PLEINE LARGEUR pour une offre marchand objective.
 */

export type RepriseSheetRow = { label: string; value: string };
export type RepriseSheetSection = { title: string; rows: RepriseSheetRow[] };
export type RepriseSheetPhoto = { label: string; url: string };

export type RepriseSheet = {
  companyName: string;
  number: string;          // référence REP-AAAA-NNNNN
  date: string;            // date formatée FR
  clientRef: string | null; // code client INTERNE uniquement (jamais le nom)
  title: string;           // marque + modèle
  sections: RepriseSheetSection[];
  accessories: string[];
  remarks: string | null;
  photos: RepriseSheetPhoto[];     // photos du véhicule — pleine largeur
  documents: RepriseSheetPhoto[];  // factures / immat / COC — à la fin
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

  const photoBlock = (title: string, items: RepriseSheetPhoto[]) => items.length ? `
  <div class="section">
    <div class="section-title">${esc(title)} (${items.length})</div>
    <div class="photos">${items.map((p) => `<div class="ph"><img src="${esc(p.url)}" alt=""><div class="cap">${esc(p.label)}</div></div>`).join('')}</div>
  </div>` : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Reprise ${esc(s.number)} — ${esc(s.companyName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 12mm 10mm; font-size: 12.5px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #C8102E; padding-bottom: 10px; }
  .brand { font-size: 21px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  .brand small { display: block; font-size: 11px; font-weight: 400; letter-spacing: .12em; color: #666; }
  .doc { text-align: right; }
  .doc .n { font-size: 16px; font-weight: 800; font-family: 'Courier New', monospace; }
  .doc .d { color: #666; margin-top: 2px; }
  .doc .c { color: #666; margin-top: 2px; font-size: 11px; }
  h1 { font-size: 19px; text-transform: uppercase; letter-spacing: .03em; margin: 14px 0 2px; }
  .section { margin-top: 13px; page-break-inside: avoid; }
  .section-title { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #C8102E; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 6px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 3.5px 6px 3.5px 0; vertical-align: top; font-size: 12.5px; }
  table.kv td:first-child { width: 42%; color: #666; }
  table.kv td:last-child { font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .chip { border: 1px solid #ccc; border-radius: 10px; padding: 2.5px 9px; font-size: 11px; }
  .remarks { white-space: pre-wrap; background: #f6f6f6; border-radius: 6px; padding: 9px 11px; margin-top: 4px; }
  /* Photos en PLEINE LARGEUR A4 — l'offre du marchand doit être objective */
  .photos { display: block; margin-top: 6px; }
  .ph { page-break-inside: avoid; margin-bottom: 6mm; }
  .ph img { width: 100%; max-height: 200mm; object-fit: contain; border-radius: 4px; border: 1px solid #ddd; background: #fafafa; }
  .ph .cap { font-size: 11px; color: #666; margin-top: 2mm; text-align: center; text-transform: uppercase; letter-spacing: .04em; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; color: #888; font-size: 10px; text-align: center; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <div class="head">
    <div class="brand">${esc(s.companyName)}<small>Fiche de reprise moto</small></div>
    <div class="doc">
      <div class="n">${esc(s.number)}</div>
      <div class="d">${esc(s.date)}</div>
      ${s.clientRef ? `<div class="c">Réf. client interne : ${esc(s.clientRef)}</div>` : ''}
    </div>
  </div>

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

  ${photoBlock('Photos du véhicule', s.photos)}
  ${photoBlock('Documents', s.documents)}

  <div class="foot">${esc(s.companyName)} — fiche générée par le DMS · ${esc(s.date)} · ${esc(s.number)}</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 500); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
