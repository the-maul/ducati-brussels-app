/* Service worker — orchestre l'import My Ducati.
 *  - { type:'fetch-vin', vin } → ouvre .../vinhistory?vin=<VIN> ; scrape auto.
 *  - { type:'myducati-data', payload } → transmet les données au DMS IMMÉDIATEMENT, puis OUVRE
 *    en arrière-plan la page de chaque bulletin (bulletins.ducati.com/Bulletins/Details/<bulletin_id>) ;
 *    le content script y récupère le PDF FR (session auto via SSO) et l'envoie au DMS, puis l'onglet
 *    est refermé. Le bulletin_id capté sur My Ducati EST l'id de la page de détail.
 *  - { type:'bulletin-pdf' | 'bulletin-done' } → range le PDF côté DMS et referme l'onglet auto.
 * Aucune page à garder ouverte : l'extension ouvre/ferme les onglets elle-même. */
const DMS_MATCH = ['https://*.netlify.app/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const DETAIL_URL = (id) => `https://bulletins.ducati.com/Bulletins/Details/${encodeURIComponent(id)}`;
const jobs = {};          // scrapeTabId -> { dmsTabId }
const bulletinTabs = {};  // bulletinTabId -> { resolve }

function broadcastToDms(type, payload, sendResponse) {
  chrome.tabs.query({ url: DMS_MATCH }, (tabs) => {
    (tabs || []).forEach((t) => chrome.tabs.sendMessage(t.id, { type, payload }));
    if (sendResponse) sendResponse({ delivered: (tabs || []).length > 0 });
  });
}

function finishBulletinTab(tid, gotPdf) {
  const e = bulletinTabs[tid]; if (!e) return;
  delete bulletinTabs[tid];
  try { chrome.tabs.remove(tid); } catch (_) {}
  e.resolve(gotPdf);
}

/* Ouvre la page de chaque bulletin en arrière-plan, attend la récup du PDF (ou un échec/timeout),
 * referme l'onglet, passe au suivant. S'arrête après 2 échecs consécutifs (session probablement absente). */
async function autoFetchBulletins(payload, dmsTabId) {
  const bs = ((payload && payload.bulletins) || []).filter((b) => b.bulletin_id);
  let miss = 0;
  for (const b of bs) {
    if (miss >= 2) break;
    const got = await new Promise((resolve) => {
      chrome.tabs.create({ url: DETAIL_URL(b.bulletin_id), active: false }, (tab) => {
        if (!tab) { resolve(false); return; }
        bulletinTabs[tab.id] = { resolve };
        setTimeout(() => finishBulletinTab(tab.id, false), 15000); // failsafe (login/SSO lent)
      });
    });
    miss = got ? 0 : miss + 1;
  }
  if (dmsTabId) { try { chrome.tabs.update(dmsTabId, { active: true }); } catch (_) {} }
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
    const scrapeTabId = sender.tab && sender.tab.id;
    const dmsTabId = (jobs[scrapeTabId] && jobs[scrapeTabId].dmsTabId) || null;
    relayMyDucati(msg.payload, sender, sendResponse);                 // 1) données tout de suite
    setTimeout(() => { autoFetchBulletins(msg.payload, dmsTabId).catch(() => {}); }, 1500); // 2) PDF en fond
    return true;
  }

  if (msg.type === 'bulletin-pdf') {
    broadcastToDms('bulletin-pdf', msg.payload, sendResponse);
    const tid = sender.tab && sender.tab.id;
    if (bulletinTabs[tid]) finishBulletinTab(tid, true);             // referme l'onglet auto
    return true;
  }

  if (msg.type === 'bulletin-done') {
    const tid = sender.tab && sender.tab.id;
    if (bulletinTabs[tid]) finishBulletinTab(tid, false);
    if (sendResponse) sendResponse({ ok: true });
    return;
  }
});
