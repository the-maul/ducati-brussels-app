/* Service worker — orchestre l'import My Ducati.
 *  - Reçoit { type:'fetch-vin', vin } de l'app (via dms-bridge) → ouvre l'URL déterministe
 *    .../vinhistory?vin=<VIN> dans un onglet ; le content script y scrape automatiquement.
 *  - Reçoit { type:'myducati-data', payload } du content script Ducati → ENRICHIT les bulletins
 *    (télécharge le PDF FR depuis bulletins.ducati.com avec la session du dealer), puis renvoie
 *    à l'onglet du DMS (qui enregistre par VIN), referme l'onglet de scrape, refocalise le DMS.
 * Le téléchargement PDF se fait ICI (service worker) car lui seul peut lire bulletins.ducati.com
 * en cross-origin (host_permissions) avec les cookies de session. */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const jobs = {}; // scrapeTabId -> { dmsTabId }

// Encode des octets en base64 (par tranches, anti-débordement de pile).
function bytesToBase64(bytes) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/* Pour un bulletin (page de détail bulletins.ducati.com/Bulletins/Details/<id>), retrouve le lien
 * de téléchargement FRANÇAIS (/Bulletins/Download/<attId>) dans le HTML puis télécharge le PDF.
 * Tout est best-effort : en cas d'échec on garde juste le lien (b.url). */
async function enrichBulletins(payload) {
  const bs = (payload && payload.bulletins) || [];
  for (const b of bs) {
    if (!b.url || !/bulletins\.ducati\.com/i.test(b.url)) continue;
    try {
      const html = await (await fetch(b.url, { credentials: 'include' })).text();
      // tous les liens de téléchargement présents dans la page de détail
      const links = [];
      const re = /\/Bulletins\/Download\/\d+/gi; let m;
      while ((m = re.exec(html))) links.push({ u: m[0], i: m.index });
      if (!links.length) continue;
      // on privilégie celui le plus proche d'une mention « French / Français »
      const fr = [];
      const reFr = /fran[cç]ais|french/gi; let mf;
      while ((mf = reFr.exec(html))) fr.push(mf.index);
      let pick = links[0];
      if (fr.length) {
        const dist = (l) => Math.min(...fr.map((f) => Math.abs(f - l.i)));
        pick = links.reduce((a, l) => (dist(l) < dist(a) ? l : a), links[0]);
      }
      const dlUrl = new URL(pick.u, b.url).href;
      const res = await fetch(dlUrl, { credentials: 'include' });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const isPdf = ct.includes('pdf') || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46); // %PDF
      if (isPdf && buf.length > 4 && buf.length < 15000000) {
        b.pdf_base64 = bytesToBase64(buf);
        b.pdf_name = String(b.number || b.bulletin_id || 'bulletin').replace(/[^\w.-]+/g, '_').slice(0, 50) + '_FR.pdf';
      }
    } catch (_) { /* garde juste le lien */ }
  }
}

function relay(payload, sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  const job = jobs[tabId];
  if (job) {
    delete jobs[tabId];
    if (job.dmsTabId) {
      chrome.tabs.sendMessage(job.dmsTabId, { type: 'myducati-data', payload });
      chrome.tabs.update(job.dmsTabId, { active: true });
    }
    setTimeout(() => { try { chrome.tabs.remove(tabId); } catch (_) {} }, 500);
    sendResponse({ delivered: true });
    return;
  }
  chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
    (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type: 'myducati-data', payload }));
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
    // Enrichit (PDF FR des bulletins) PUIS transmet au DMS. Réponse asynchrone.
    enrichBulletins(msg.payload).finally(() => relay(msg.payload, sender, sendResponse));
    return true;
  }
});
