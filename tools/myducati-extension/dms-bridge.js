/* Content script — page du DMS. Pont bidirectionnel app ↔ extension.
 *  - app → extension : window.postMessage({ source:'dms-ducati', action:'fetch-myducati', vin })
 *    → demande au service worker d'aller scraper l'URL VIN.
 *  - extension → app : retransmet les données scrapées via window.postMessage pour que
 *    l'app les enregistre (par VIN). */
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (d && d.source === 'dms-ducati' && d.action === 'fetch-myducati' && d.vin) {
    chrome.runtime.sendMessage({ type: 'fetch-vin', vin: d.vin });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'myducati-data') {
    window.postMessage({ source: 'dms-ducati-ext', action: 'myducati-data', payload: msg.payload }, location.origin);
  }
});
