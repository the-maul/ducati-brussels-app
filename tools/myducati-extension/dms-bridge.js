/* Content script — page du DMS. Reçoit les données du service worker et les transmet à
 * l'application via window.postMessage (l'app, authentifiée, les enregistre par VIN). */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'myducati-data') {
    window.postMessage({ source: 'dms-ducati-ext', action: 'myducati-data', payload: msg.payload }, location.origin);
  }
});
