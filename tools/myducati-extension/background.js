/* Service worker — orchestre l'import My Ducati.
 *  - { type:'fetch-vin', vin } → ouvre .../vinhistory?vin=<VIN> ; scrape auto.
 *  - { type:'myducati-data', payload } → transmet les données au DMS IMMÉDIATEMENT, PUIS télécharge
 *    en tâche de fond le PDF FR de chaque bulletin (bulletins.ducati.com/Bulletins/Details/<bulletin_id>,
 *    avec la session du dealer) et l'envoie au DMS par numéro. Le téléchargement NE BLOQUE JAMAIS le
 *    scrape (timeouts), pour éviter que les données n'arrivent pas.
 *  - { type:'bulletin-pdf', payload } → range un PDF de bulletin (auto OU bouton manuel) côté DMS. */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const jobs = {}; // scrapeTabId -> { dmsTabId }

function bytesToBase64(bytes) {
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
async function fetchText(url, ms) { try { const r = await fetch(url, { credentials: 'include', signal: timeoutSignal(ms) }); return r.ok ? await r.text() : null; } catch (_) { return null; } }
async function fetchBytes(url, ms) { try { const r = await fetch(url, { credentials: 'include', signal: timeoutSignal(ms) }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch (_) { return null; } }

/* Télécharge le PDF FRANÇAIS d'un bulletin depuis sa page de détail (bulletin_id = id Details). */
async function fetchFrPdf(b) {
  const detailUrl = b.bulletin_id
    ? `https://bulletins.ducati.com/Bulletins/Details/${encodeURIComponent(b.bulletin_id)}`
    : (b.url && /bulletins\.ducati\.com/i.test(b.url) ? b.url : null);
  if (!detailUrl) return null;
  const html = await fetchText(detailUrl, 8000);
  if (!html) return null;
  // lien de téléchargement de la section française (id="riepilogo_FR")
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
  if (!dl) return null;
  const buf = await fetchBytes(new URL(dl, detailUrl).href, 12000);
  if (!buf || buf.length < 5) return null;
  const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
  if (!isPdf || buf.length > 15000000) return null;
  return { pdf_base64: bytesToBase64(buf), pdf_name: String(b.number || b.bulletin_id || 'bulletin').replace(/[^\w.-]+/g, '_') + '_FR.pdf' };
}

function broadcastToDms(type, payload, sendResponse) {
  chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
    (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type, payload }));
    if (sendResponse) sendResponse({ delivered: (tabs || []).length > 0 });
  });
}

/* Après le scrape : télécharge chaque PDF de bulletin et l'envoie au DMS (par numéro). En fond. */
async function downloadBulletinPdfs(payload) {
  const bs = (payload && payload.bulletins) || [];
  for (const b of bs) {
    if (!b.number && !b.bulletin_id) continue;
    const pdf = await fetchFrPdf(b);
    if (pdf && b.number) broadcastToDms('bulletin-pdf', { number: b.number, ...pdf });
  }
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
    relayMyDucati(msg.payload, sender, sendResponse);          // 1) données tout de suite (non bloquant)
    setTimeout(() => { downloadBulletinPdfs(msg.payload).catch(() => {}); }, 2000); // 2) PDF en fond, après l'enregistrement
    return true;
  }

  if (msg.type === 'bulletin-pdf') {
    broadcastToDms('bulletin-pdf', msg.payload, sendResponse);
    return true;
  }
});
