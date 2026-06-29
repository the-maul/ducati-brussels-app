/* Service worker — orchestre l'import My Ducati.
 *  - { type:'fetch-vin', vin } (depuis l'app via dms-bridge) → ouvre .../vinhistory?vin=<VIN> ;
 *    le content script y scrape automatiquement.
 *  - { type:'myducati-data', payload } (content script Ducati) → renvoie à l'onglet du DMS,
 *    referme l'onglet de scrape, refocalise le DMS.
 *  - { type:'bulletin-pdf', payload } (content script sur bulletins.ducati.com) → diffuse le PDF
 *    du bulletin aux onglets DMS ouverts (rangé par numéro côté app). */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const jobs = {}; // scrapeTabId -> { dmsTabId }

function broadcastToDms(type, payload, sendResponse) {
  chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
    (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type, payload }));
    sendResponse({ delivered: (tabs || []).length > 0 });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'fetch-vin' && msg.vin) {
    const dmsTabId = sender.tab && sender.tab.id;
    chrome.tabs.create({ url: VIN_URL(msg.vin), active: true }, (tab) => { jobs[tab.id] = { dmsTabId }; });
    sendResponse({ started: true });
    return;
  }

  if (msg.type === 'myducati-data') {
    const tabId = sender.tab && sender.tab.id;
    const job = jobs[tabId];
    if (job) {
      // Scrape automatique lancé par l'app : route vers SON onglet DMS, puis ferme/refocalise.
      delete jobs[tabId];
      if (job.dmsTabId) {
        chrome.tabs.sendMessage(job.dmsTabId, { type: 'myducati-data', payload: msg.payload });
        chrome.tabs.update(job.dmsTabId, { active: true });
      }
      setTimeout(() => { try { chrome.tabs.remove(tabId); } catch (_) {} }, 500);
      sendResponse({ delivered: true });
      return;
    }
    broadcastToDms('myducati-data', msg.payload, sendResponse);
    return true;
  }

  if (msg.type === 'bulletin-pdf') {
    broadcastToDms('bulletin-pdf', msg.payload, sendResponse);
    return true;
  }
});
