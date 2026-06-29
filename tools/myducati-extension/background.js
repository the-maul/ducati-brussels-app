/* Service worker — orchestre l'import My Ducati.
 *  - Reçoit { type:'fetch-vin', vin } de l'app (via dms-bridge) → ouvre l'URL déterministe
 *    .../vinhistory?vin=<VIN> dans un onglet ; le content script y scrape automatiquement.
 *  - Reçoit { type:'myducati-data', payload } du content script Ducati → renvoie à l'onglet
 *    du DMS (qui enregistre par VIN), referme l'onglet de scrape, refocalise le DMS. */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const jobs = {}; // scrapeTabId -> { dmsTabId }

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
    // Import manuel depuis une page Ducati ouverte par l'utilisateur : diffuse aux onglets DMS.
    chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
      (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type: 'myducati-data', payload: msg.payload }));
      sendResponse({ delivered: (tabs || []).length > 0 });
    });
    return true; // réponse asynchrone
  }
});
