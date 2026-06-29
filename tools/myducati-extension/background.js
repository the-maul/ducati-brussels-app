/* Service worker — relais entre l'onglet My Ducati (scrape) et l'onglet du DMS.
 * Reçoit { type:'myducati-data', payload } du content script Ducati, retransmet au(x)
 * onglet(s) DMS ouverts (où dms-bridge.js l'injecte dans l'app, authentifiée). */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'myducati-data') {
    chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        chrome.storage.local.set({ pending: msg.payload });
        try { chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'DMS Ducati', message: 'Ouvrez l’onglet du DMS puis recliquez pour importer.' }); } catch (_) {}
        sendResponse({ delivered: false });
        return;
      }
      let delivered = 0;
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: 'myducati-data', payload: msg.payload }, () => { delivered++; });
      });
      sendResponse({ delivered: true, tabs: tabs.length });
    });
    return true; // réponse asynchrone
  }
});
