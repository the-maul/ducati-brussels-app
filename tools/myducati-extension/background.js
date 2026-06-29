/* Service worker — orchestre l'import My Ducati.
 *  - { type:'fetch-vin', vin } → ouvre .../vinhistory?vin=<VIN> ; scrape auto.
 *  - { type:'myducati-data', payload } → ENRICHIT les bulletins (télécharge le PDF FR depuis
 *    bulletins.ducati.com/Bulletins/Details/<bulletin_id>, avec la session du dealer), puis
 *    renvoie au DMS. Le bulletin_id capté sur My Ducati EST l'id de la page de détail Ducati.
 *  - { type:'bulletin-pdf', payload } → repli manuel (bouton sur une page bulletin).
 * Le téléchargement PDF se fait ICI car seul le service worker peut lire bulletins.ducati.com
 * en cross-origin (host_permissions) avec les cookies de session. */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const jobs = {}; // scrapeTabId -> { dmsTabId }

function bytesToBase64(bytes) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/* Pour chaque bulletin : construit l'URL de détail depuis bulletin_id, y trouve le lien de
 * téléchargement FRANÇAIS (#riepilogo_FR → /Bulletins/Download/<attId>), télécharge le PDF.
 * Best-effort : tout échec (pas de session, langue absente…) laisse simplement le bulletin sans PDF. */
async function enrichBulletins(payload) {
  const bs = (payload && payload.bulletins) || [];
  for (const b of bs) {
    const detailUrl = b.bulletin_id
      ? `https://bulletins.ducati.com/Bulletins/Details/${encodeURIComponent(b.bulletin_id)}`
      : (b.url && /bulletins\.ducati\.com/i.test(b.url) ? b.url : null);
    if (!detailUrl) continue;
    try {
      const r = await fetch(detailUrl, { credentials: 'include' });
      if (!r.ok) continue;
      const html = await r.text();
      // Lien de téléchargement de la section française (id="riepilogo_FR").
      let dl = null;
      const frIdx = html.search(/id=["']riepilogo_FR["']/i);
      if (frIdx >= 0) {
        const rest = html.slice(frIdx);
        const next = rest.slice(20).search(/id=["']riepilogo_[A-Za-z]{2}["']/i);
        const section = next >= 0 ? rest.slice(0, next + 20) : rest;
        const m = section.match(/\/Bulletins\/Download\/\d+/i);
        if (m) dl = m[0];
      }
      if (!dl) { const m = html.match(/\/Bulletins\/Download\/\d+/i); if (m) dl = m[0]; } // repli : 1er lien
      if (!dl) continue;
      const pdfRes = await fetch(new URL(dl, detailUrl).href, { credentials: 'include' });
      if (!pdfRes.ok) continue;
      const buf = new Uint8Array(await pdfRes.arrayBuffer());
      const ct = (pdfRes.headers.get('content-type') || '').toLowerCase();
      const isPdf = ct.includes('pdf') || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46); // %PDF
      if (isPdf && buf.length > 4 && buf.length < 15000000) {
        b.pdf_base64 = bytesToBase64(buf);
        b.pdf_name = String(b.number || b.bulletin_id || 'bulletin').replace(/[^\w.-]+/g, '_') + '_FR.pdf';
      }
    } catch (_) { /* laisse le bulletin sans PDF */ }
  }
}

function broadcastToDms(type, payload, sendResponse) {
  chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
    (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type, payload }));
    sendResponse({ delivered: (tabs || []).length > 0 });
  });
}

function relayMyDucati(payload, sender, sendResponse) {
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
  broadcastToDms('myducati-data', payload, sendResponse);
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
    // Télécharge les PDF FR des bulletins PUIS transmet au DMS. Réponse asynchrone.
    enrichBulletins(msg.payload).finally(() => relayMyDucati(msg.payload, sender, sendResponse));
    return true;
  }

  if (msg.type === 'bulletin-pdf') {
    broadcastToDms('bulletin-pdf', msg.payload, sendResponse);
    return true;
  }
});
