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
        bulletinTabs[tab.id] = { resolve, number: b.number || null }; // numéro AUTORITAIRE (issu du scrape)
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
    const tid = sender.tab && sender.tab.id;
    const tracked = bulletinTabs[tid];
    // Onglet ouvert par l'extension : on impose le numéro AUTORITAIRE du scrape
    // (la page peut citer d'autres numéros → ne pas se fier à celui lu sur la page).
    const payload = tracked && tracked.number ? { ...msg.payload, number: tracked.number } : msg.payload;
    broadcastToDms('bulletin-pdf', payload, sendResponse);
    if (tracked) finishBulletinTab(tid, true);                       // referme l'onglet auto
    return true;
  }

  if (msg.type === 'bulletin-done') {
    const tid = sender.tab && sender.tab.id;
    if (bulletinTabs[tid]) finishBulletinTab(tid, false);
    if (sendResponse) sendResponse({ ok: true });
    return;
  }
});

/* ===== Import du catalogue Ducati (mission 06) =====
 * catalog.js (onglet e-catalog) → { type:'catalog-dms', fn, args } → ce relais → onglet du DMS
 * (dms-bridge.js → l'application, qui enregistre sous la session DMS) → réponse renvoyée telle quelle.
 * On retrouve l'onglet du DMS en lui demandant « hello » (seul le DMS y répond). */
let catalogDmsTabId = null;

function callDmsTab(tabId, fn, args) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'catalog-call', fn, args: args || {} }, (resp) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp || null);
      });
    } catch (_) { resolve(null); }
  });
}

async function findCatalogDmsTab() {
  const tabs = await new Promise((r) => chrome.tabs.query({ url: DMS_MATCH }, (t) => r(t || [])));
  tabs.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  for (const t of tabs) {
    const r = await callDmsTab(t.id, 'hello');
    if (r && r.ok) { catalogDmsTabId = t.id; return t.id; }
  }
  catalogDmsTabId = null;
  return null;
}

async function relayCatalog(msg) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tabId = catalogDmsTabId != null ? catalogDmsTabId : await findCatalogDmsTab();
    if (tabId == null) return { ok: false, code: 'no-dms', error: 'Onglet du DMS introuvable.' };
    const resp = await callDmsTab(tabId, msg.fn, msg.args);
    if (resp) return resp;
    catalogDmsTabId = null; // onglet fermé ou rechargé : on cherche à nouveau
  }
  return { ok: false, code: 'no-dms', error: 'Onglet du DMS introuvable.' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'catalog-dms') return;
  relayCatalog(msg).then(sendResponse);
  return true;
});
