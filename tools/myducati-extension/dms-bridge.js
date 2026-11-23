/* Content script — page du DMS. Pont bidirectionnel app ↔ extension.
 *  - app → extension : window.postMessage({ source:'dms-ducati', action:'fetch-myducati', vin })
 *    → demande au service worker d'aller scraper l'URL VIN.
 *  - extension → app : retransmet les données scrapées via window.postMessage pour que
 *    l'app les enregistre (par VIN). */
window.addEventListener('message', (ev) => {
  // Seule la page du DMS elle-même peut demander une moto (jamais un cadre d'un autre site).
  if (ev.origin !== location.origin) return;
  const d = ev.data;
  if (d && d.source === 'dms-ducati' && d.action === 'fetch-myducati' && d.vin) {
    chrome.runtime.sendMessage({ type: 'fetch-vin', vin: d.vin });
    // accusé de réception : l'app sait que l'extension est installée et active
    window.postMessage({ source: 'dms-ducati-ext', action: 'fetch-ack' }, location.origin);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && (msg.type === 'myducati-data' || msg.type === 'bulletin-pdf')) {
    window.postMessage({ source: 'dms-ducati-ext', action: msg.type, payload: msg.payload }, location.origin);
  }
});

/* Import du catalogue Ducati (mission 06) : relais extension → application → extension.
 * L'application répond par { source:'dms-ducati', action:'catalog-reply', id, ok, data|error }. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'catalog-call') return;
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  let done = false;
  const onReply = (ev) => {
    const d = ev.data;
    if (ev.origin !== location.origin || !d || d.source !== 'dms-ducati' || d.action !== 'catalog-reply' || d.id !== id) return;
    done = true;
    window.removeEventListener('message', onReply);
    sendResponse(d);
  };
  window.addEventListener('message', onReply);
  window.postMessage({ source: 'dms-ducati-ext', action: 'catalog-call', id, fn: msg.fn, args: msg.args || {} }, location.origin);
  // « hello » : réponse rapide attendue (sinon ce n'est pas l'onglet du DMS) ; envoi de données : 2 min.
  setTimeout(() => {
    if (done) return;
    window.removeEventListener('message', onReply);
    sendResponse(msg.fn === 'hello' ? null : { ok: false, code: 'timeout', error: 'Le DMS ne répond pas.' });
  }, msg.fn === 'hello' ? 4000 : 120000);
  return true;
});

/* Nightly DCS certification.
 *  - page -> extension: { source:'dms-ducati', action:'dcs-night-cmd', id, cmd, companyId }
 *  - extension -> page -> extension: 'dcs-night-call' / 'dcs-night-reply' (closed list on the DMS side). */
window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin || ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== 'dms-ducati' || d.action !== 'dcs-night-cmd' || typeof d.id !== 'string') return;
  chrome.runtime.sendMessage({ type: 'dcs-night-cmd', cmd: d.cmd, companyId: d.companyId }, (resp) => {
    const failed = !!chrome.runtime.lastError || !resp;
    window.postMessage({ source: 'dms-ducati-ext', action: 'dcs-night-cmd-reply', id: d.id, ok: !failed, data: failed ? null : resp }, location.origin);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'dcs-night-call') return;
  const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  let done = false;
  const onReply = (ev) => {
    const d = ev.data;
    if (ev.origin !== location.origin || !d || d.source !== 'dms-ducati' || d.action !== 'dcs-night-reply' || d.id !== id) return;
    done = true;
    window.removeEventListener('message', onReply);
    sendResponse(d);
  };
  window.addEventListener('message', onReply);
  window.postMessage({ source: 'dms-ducati-ext', action: 'dcs-night-call', id, fn: msg.fn, args: msg.args || {} }, location.origin);
  setTimeout(() => {
    if (done) return;
    window.removeEventListener('message', onReply);
    sendResponse(null);
  }, msg.fn === 'hello' ? 4000 : 60000);
  return true;
});
