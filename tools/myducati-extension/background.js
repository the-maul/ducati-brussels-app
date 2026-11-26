/* Service worker — orchestre l'import My Ducati.
 *  - { type:'fetch-vin', vin } → ouvre .../vinhistory?vin=<VIN> ; scrape auto.
 *  - { type:'myducati-data', payload } → transmet les données au DMS IMMÉDIATEMENT, puis OUVRE
 *    en arrière-plan la page de chaque bulletin (bulletins.ducati.com/Bulletins/Details/<bulletin_id>) ;
 *    le content script y récupère le PDF FR (session auto via SSO) et l'envoie au DMS, puis l'onglet
 *    est refermé. Le bulletin_id capté sur My Ducati EST l'id de la page de détail.
 *  - { type:'bulletin-pdf' | 'bulletin-done' } → range le PDF côté DMS et referme l'onglet auto.
 * Aucune page à garder ouverte : l'extension ouvre/ferme les onglets elle-même. */
const DMS_MATCH = ['https://dms.ducatibruxelles.be/*', 'https://*.ducati-bruxelles.workers.dev/*', 'http://localhost:8080/*'];
const VIN_URL = (vin) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${encodeURIComponent(vin)}`;
const DETAIL_URL = (id) => `https://bulletins.ducati.com/Bulletins/Details/${encodeURIComponent(id)}`;
const jobs = {};          // scrapeTabId -> { dmsTabId }
const bulletinTabs = {};  // bulletinTabId -> { resolve }

/* Nightly fleet certification (dcs-night.js). Listeners are registered on the first turn, as MV3 requires. */
importScripts('dcs-night-core.js', 'dcs-night.js');
const dcsNight = DcsNightRuntime.create(chrome, { core: DcsNightCore, dmsMatch: DMS_MATCH, vinUrl: VIN_URL });
chrome.alarms.onAlarm.addListener((alarm) => { dcsNight.onAlarm(alarm).catch(() => {}); });
chrome.tabs.onRemoved.addListener((id) => { dcsNight.onTabRemoved(id).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { dcsNight.restoreAfterRestart().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { dcsNight.restoreAfterRestart().catch(() => {}); });
const isDmsSender = (sender) => !!(sender && sender.id === chrome.runtime.id && sender.tab && sender.tab.url
  && /^(https:\/\/dms\.ducatibruxelles\.be\/|https:\/\/[^/]+\.ducati-bruxelles\.workers\.dev\/|http:\/\/localhost:8080\/)/.test(sender.tab.url));

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
}

function withRequestedVin(payload, vin) {
  const wanted = String(vin).toUpperCase();
  const read = payload.read_vin ? String(payload.read_vin).toUpperCase() : null;
  const mismatch = read && read !== wanted;
  return { ...payload, requested_vin: wanted, read_error: mismatch ? 'vin_mismatch' : payload.read_error };
}

function relayMyDucati(payload, sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  const job = jobs[tabId];
  if (job) {
    delete jobs[tabId];
    // Le VIN demandé par le DMS fait foi, pas celui que la page prétend afficher.
    const checked = job.vin ? withRequestedVin(payload, job.vin) : payload;
    if (job.dmsTabId) {
      chrome.tabs.sendMessage(job.dmsTabId, { type: 'myducati-data', payload: checked });
    }
    // Lecture en échec (connexion à refaire, VIN inconnu) : l'onglet passe devant pour que l'on voie pourquoi.
    if (checked.read_error) { try { chrome.tabs.update(tabId, { active: true }); } catch (_) {} }
    else setTimeout(() => { try { chrome.tabs.remove(tabId); } catch (_) {} }, 500);
    sendResponse({ delivered: true });
    return;
  }
  broadcastToDms('myducati-data', payload, sendResponse);
}

/* Sign-in page instead of the bike: nobody is connected to the DCS in this Chrome. Even with a valid
 * session, the portal's SSO passes through sign-in-like URLs for a moment: only a tab that is STILL
 * on a sign-in page 12 s later is reported. Then the DMS is told and the DCS tab comes to the front. */
const LOGIN_WAIT_MS = 12000;
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const job = jobs[tabId];
  const url = info.url || (tab && tab.url) || '';
  if (!job || !url) return;
  if (!DcsNightCore.isDcsLoginUrl(url)) {
    if (job.loginTimer) { clearTimeout(job.loginTimer); job.loginTimer = null; }
    return;
  }
  if (job.loginTimer) return;
  job.loginTimer = setTimeout(() => {
    job.loginTimer = null;
    if (jobs[tabId] !== job) return;
    chrome.tabs.get(tabId, (current) => {
      if (chrome.runtime.lastError || !current || !DcsNightCore.isDcsLoginUrl(current.url || '')) return;
      if (jobs[tabId] !== job) return;
      delete jobs[tabId];
      const wanted = String(job.vin || '').toUpperCase();
      if (job.dmsTabId) {
        chrome.tabs.sendMessage(job.dmsTabId, { type: 'myducati-data', payload: {
          format: 2, vin: wanted, read_vin: null, requested_vin: wanted, read_error: 'not_connected', issues: [],
        } });
      }
      try { chrome.tabs.update(tabId, { active: true }); } catch (_) {}
    });
  }, LOGIN_WAIT_MS);
});

/* 'connected' : un onglet du portail concession est ouvert hors page de connexion ;
 * 'login' : seul un onglet de connexion Ducati est ouvert ; 'none' : aucun onglet DCS. */
async function dcsPortalStatus() {
  const tabs = await new Promise((r) => chrome.tabs.query({ url: ['https://ducati.my.site.com/*', 'https://idp.ducati.com/*'] }, (t) => r(t || [])));
  let portal = 'none';
  for (const tab of tabs) {
    const url = tab.url || '';
    if (!url) continue;
    if (/^https:\/\/ducati\.my\.site\.com\/dealer\//.test(url) && !DcsNightCore.isDcsLoginUrl(url)) { portal = 'connected'; break; }
    portal = 'login';
  }
  return { installed: true, version: chrome.runtime.getManifest().version, portal };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'fetch-vin' && msg.vin) {
    const dmsTabId = sender.tab && sender.tab.id;
    chrome.tabs.create({ url: VIN_URL(msg.vin), active: false }, (tab) => { jobs[tab.id] = { dmsTabId, vin: msg.vin }; });
    sendResponse({ started: true });
    return;
  }

  if (msg.type === 'dcs-night-cmd') {
    if (!isDmsSender(sender)) { sendResponse(null); return; }
    // Voyant DCS de la barre du haut du DMS : une page DCS connectée est-elle ouverte ?
    if (msg.cmd === 'status') { dcsPortalStatus().then(sendResponse, () => sendResponse(null)); return true; }
    dcsNight.handleCommand(msg).then(sendResponse, () => sendResponse(null));
    return true;
  }

  if (msg.type === 'myducati-data') {
    const scrapeTabId = sender.tab && sender.tab.id;
    // A night-run tab goes through its own checked path, never through the active-company import.
    dcsNight.handleScrape(scrapeTabId, msg.payload).catch(() => false).then((handled) => {
      if (handled) { sendResponse({ delivered: true }); return; }
      const dmsTabId = (jobs[scrapeTabId] && jobs[scrapeTabId].dmsTabId) || null;
      relayMyDucati(msg.payload, sender, sendResponse);                 // 1) données tout de suite
      // 2) PDF en fond, seulement si la lecture est bonne.
      if (!msg.payload || !msg.payload.read_error) setTimeout(() => { autoFetchBulletins(msg.payload, dmsTabId).catch(() => {}); }, 1500);
    });
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
