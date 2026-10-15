/* Content script — e-catalog.ducati.com : import du catalogue Ducati dans le DMS (mission 06).
 *
 * Principe (comme My Ducati) : l'extension lit l'e-catalog AVEC LA SESSION de l'utilisateur déjà
 * connecté (cookies du site, même origine), n'enregistre AUCUN identifiant, et transmet au DMS
 * (onglet du DMS ouvert et connecté) qui enregistre sous la session DMS de l'utilisateur.
 *
 *  1. « Importer le catalogue » → lecture de l'arbre (familles → cylindrées → modèles → millésimes),
 *     filtre Europe + millésimes depuis 2000, liste modifiable (familles / modèles à cocher).
 *  2. « Lancer » → parcours EN SÉRIE (une requête à la fois, ~1/s réglable), planches déjà connues
 *     du DMS sautées, envoi au DMS par petits paquets.
 *  3. Barre de progression, Pause / Reprendre, reprise automatique après fermeture (état dans
 *     chrome.storage.local, sans identifiant), arrêt immédiat sur 401/403/429 ou session expirée.
 *
 * Règles pures : catalog-core.js (DmsCatalogCore), testées par bun test.
 */
(() => {
  if (window.__dmsCatalogLoaded) return;
  window.__dmsCatalogLoaded = true;
  const C = globalThis.DmsCatalogCore;
  if (!C) return;

  const API = '/EPC/api/spareparts';
  const LANG = 'fr-FR';
  // Un import par onglet : l'onglet ouvert sur #run=usa travaille sur sa propre
  // reprise et son propre verrou, sans ecraser celui des autres onglets. Sans
  // #run=..., on garde les cles historiques (un seul import, comportement d'avant).
  // Le nom du run est donne une fois dans l'URL (#run=usa) puis retenu pour
  // l'onglet : le site est une SPA qui reecrit le hash, on ne peut pas s'y fier
  // apres la premiere seconde. sessionStorage est propre a l'onglet.
  // Reglages donnes une fois dans l'URL, par exemple
  //   #run=s3&shard=3/10&markets=*&minYear=1985&delay=1&auto=1
  // puis retenus pour l'onglet : le site est une SPA qui reecrit le hash, on ne
  // peut pas s'y fier apres la premiere seconde. sessionStorage est par onglet.
  const OPT = (function () {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem('dmsCatalogOpt') || '{}') || {}; } catch (e) { saved = {}; }
    const h = String(location.hash || '').replace(/^#/, '');
    if (h) {
      const got = {};
      h.split('&').forEach(function (kv) {
        const i = kv.indexOf('=');
        if (i > 0) got[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
      if (Object.keys(got).length) {
        saved = got;
        try { sessionStorage.setItem('dmsCatalogOpt', JSON.stringify(got)); } catch (e) {}
      }
    }
    return saved;
  })();
  const RUN = (function () {
    const m = /^[A-Za-z0-9_-]{1,16}$/.exec(String(OPT.run || ''));
    return m ? ':' + m[0].toLowerCase() : '';
  })();
  const RUN_LABEL = RUN ? RUN.slice(1) : '';
  const STATE_KEY = 'dmsCatalogImport' + RUN;
  const TREE_KEY = 'dmsCatalogTree';          // l'arbre est le meme pour tous les onglets
  const LOCK_KEY = 'dmsCatalogLock' + RUN;
  const CHUNK = 10;                 // planches par envoi au DMS
  const ME = Math.random().toString(36).slice(2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- stockage (sans identifiant)
  const store = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, (o) => r(o ? o[k] : undefined))),
    set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: C.sanitizeState(v) }, r)),
    del: (k) => new Promise((r) => chrome.storage.local.remove(k, r)),
  };

  // ---------------------------------------------------------------- e-catalog (GET, série, rythme)
  let lastRequestAt = 0;
  let requestCount = 0;
  class StopError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

  const MSG = {
    auth: 'Session Ducati expirée ou accès refusé. Reconnectez-vous à l’e-catalog (rechargez la page et connectez-vous), puis cliquez « Reprendre ».',
    rate: 'L’e-catalog demande de ralentir (trop de requêtes). Attendez une dizaine de minutes, augmentez le délai, puis cliquez « Reprendre ».',
    server: 'L’e-catalog ne répond pas correctement (erreur serveur répétée). Réessayez plus tard avec « Reprendre ».',
    network: 'Connexion internet interrompue. Cliquez « Reprendre » quand elle est revenue.',
    nodms: 'Onglet du DMS introuvable : ouvrez le DMS dans un autre onglet (connecté, société choisie), puis cliquez « Reprendre ».',
    forbidden: 'Le compte DMS connecté n’a pas le droit d’importer (administrateur requis).',
  };

  // Cadence : une file qui ne laisse partir qu'une requete tous les delayMs. Les
  // reponses, elles, peuvent se chevaucher : l'e-catalog met ~2 s a repondre, donc
  // attendre la reponse precedente avant de partir laissait la ligne vide 80 % du
  // temps. Le rythme vu par Ducati reste exactement celui du delai affiche.
  let startGate = Promise.resolve();
  function waitTurn(delayMs) {
    const turn = startGate.then(async () => {
      const wait = lastRequestAt + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
    });
    startGate = turn.catch(() => {});
    return turn;
  }

  async function getJson(path, delayMs) {
    await waitTurn(delayMs);
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await waitTurn(delayMs);
      requestCount++;
      let res;
      try {
        res = await fetch(path, { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
      } catch (_) {
        if (attempt < 2) { await sleep(15000); continue; }
        throw new StopError('network', MSG.network);
      }
      const kind = C.classifyResponse({ status: res.status, type: res.type, redirected: res.redirected, url: res.url, contentType: res.headers.get('content-type') });
      if (kind === 'ok') return res.json();
      if (kind === 'notfound') return null;
      if (kind === 'auth') throw new StopError('auth', MSG.auth);
      if (kind === 'rate') throw new StopError('rate', MSG.rate);
      if (attempt < 3) { await sleep([10000, 30000, 60000][attempt]); continue; }
      throw new StopError('server', MSG.server + ' (HTTP ' + res.status + ')');
    }
  }

  // ---------------------------------------------------------------- DMS (via le service worker)
  function dms(fn, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'catalog-dms', fn, args: args || {} }, (resp) => {
        if (chrome.runtime.lastError || !resp) return reject(new StopError('nodms', MSG.nodms));
        if (resp.ok) return resolve(resp.data);
        if (resp.code === 'no-dms' || resp.code === 'timeout') return reject(new StopError('nodms', MSG.nodms));
        if (resp.code === 'forbidden' || resp.code === 'no-company') return reject(new StopError('forbidden', resp.error || MSG.forbidden));
        reject(new StopError('dms', 'Le DMS a refusé l’envoi : ' + (resp.error || 'erreur inconnue')));
      });
    });
  }

  // ---------------------------------------------------------------- verrou (un seul import à la fois)
  async function takeLock() {
    const l = await store.get(LOCK_KEY);
    if (l && l.owner !== ME && Date.now() - l.at < 20000) return false;
    await store.set(LOCK_KEY, { owner: ME, at: Date.now() });
    return true;
  }
  let heartbeat = null;
  function startHeartbeat() { stopHeartbeat(); heartbeat = setInterval(() => store.set(LOCK_KEY, { owner: ME, at: Date.now() }), 5000); }
  function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; store.del(LOCK_KEY); }

  // ---------------------------------------------------------------- 1. lecture de l'arbre
  async function readTree(delayMs, onStep) {
    const t = (await store.get(TREE_KEY)) || { families: null, sm: {}, models: {}, done: false };
    if (t.done && t.families) return t;
    if (!t.families) { t.families = (await getJson(API + '/browsing/families', delayMs)) || []; await store.set(TREE_KEY, t); }
    let n = 0;
    const total = () => t.families.length + Object.values(t.sm).reduce((a, l) => a + (l ? l.length : 0), 0);
    for (const f of t.families) {
      if (!t.sm[f.id]) { t.sm[f.id] = (await getJson(API + '/browsing/superModels/1/' + encodeURIComponent(f.id), delayMs)) || []; await store.set(TREE_KEY, t); }
      onStep(++n, total(), f.description);
      for (const s of t.sm[f.id]) {
        const key = f.id + '/' + s.id;
        if (!t.models[key]) {
          const list = (await getJson(API + '/browsing/models/1/' + encodeURIComponent(f.id) + '/' + encodeURIComponent(s.id) + '?lang=' + LANG, delayMs)) || [];
          // on ne garde que ce qui sert (pas de réponse brute) : ids, noms, millésimes
          t.models[key] = list.map((m) => ({ id: m.id, description: m.description, modelYears: (m.modelYears || []).map((y) => ({ id: y.id, code: y.code, year: y.year, path: y.path })) }));
          await store.set(TREE_KEY, t);
        }
        onStep(++n, total(), f.description + ' ' + (s.description || ''));
      }
    }
    t.done = true;
    await store.set(TREE_KEY, t);
    return t;
  }
  const treeOf = (t) => C.buildTree(t.families, t.sm, t.models);

  // ---------------------------------------------------------------- 2. import des planches
  let state = null;
  let pauseRequested = false;
  let running = false;

  async function save() { state.updatedAt = new Date().toISOString(); state.requests = requestCount; await store.set(STATE_KEY, state); render(); }

  async function run() {
    if (running) return;
    if (!(await takeLock())) { alert('Un import du catalogue tourne déjà dans un autre onglet de l’e-catalog.'); return; }
    running = true; pauseRequested = false; startHeartbeat();
    state.status = 'running'; state.lastError = null; state.errorKind = null; requestCount = state.requests || 0;
    state.conc = C.clampConc(state.conc || concNow);
    await save();
    try {
      const hello = await dms('hello');
      if (!hello || !hello.canImport) throw new StopError('forbidden', MSG.forbidden);
      const complete = new Set((hello.state && hello.state.completeModelYears) || []);
      if (!state.batchId) {
        const t = await store.get(TREE_KEY);
        state.batchId = (await dms('start', { scope: { markets: state.selection.markets || ['EU'], shard: state.selection.shard || null, minYear: state.selection.minYear, excludedFamilies: state.selection.excludedFamilies, excludedModels: state.selection.excludedModels, includedModels: state.selection.includedModels, delayMs: state.delayMs, modelYears: state.jobs.length }, total: state.jobs.length })).batchId;
        await save();
        await dms('tree', { batchId: state.batchId, tree: treeOf(t) });
      } else {
        await dms('progress', { batchId: state.batchId, status: 'running', counters: { requests: requestCount } });
      }

      for (;;) {
        if (pauseRequested) { state.status = 'paused'; await save(); await dms('progress', { batchId: state.batchId, status: 'paused', position: { cursor: state.cursor }, counters: { requests: requestCount } }).catch(() => {}); return; }
        const rp = C.resumePoint(state);
        if (!rp) break;
        const job = rp.job;
        let remaining = rp.remaining;
        if (!remaining) {
          if (complete.has(String(job.modelYearId))) { state = C.modelYearDone(state, true); await save(); continue; }
          const base = [job.familyId, job.superModelId, job.modelId, job.modelYearId].map(encodeURIComponent).join('/');
          const groups = (await getJson(API + '/drawing/groups/1/' + base + '?lang=' + LANG, state.delayMs)) || [];
          const slim = groups.map((g) => ({ id: g.id, code: g.code, description: g.description,
            drawings: (g.drawings || []).map((d) => ({ id: d.id, code: d.code, description: d.description, imageUrl: d.imageUrl, originalImageUrl: d.originalImageUrl })) }));
          const r = await dms('modelYear', { batchId: state.batchId, modelYearId: job.modelYearId, groups: slim });
          // Dédoublonnage : on ne lit que les planches que le DMS n'a pas encore (une planche
          // partagée avec un modèle déjà importé est sautée), chacune une seule fois.
          const missing = new Set((r.missing || []).map((m) => String(m.drawingId)));
          const known = C.uniqueDrawings(slim).map((x) => x.drawingId).filter((id) => !missing.has(id));
          remaining = C.withoutKnown(C.uniqueDrawings(slim), known);
          state = C.startModelYear(state, job.modelYearId, remaining);
          state.current.label = job.label;
          await save();
          if (!remaining.length) { state = C.modelYearDone(state, false); await save(); continue; }
        }
        const base = [job.familyId, job.superModelId, job.modelId, job.modelYearId].map(encodeURIComponent).join('/');
        // Les planches sont lues par paquets de `conc` en parallele, mais conservees
        // dans l'ordre : la reprise compte les planches envoyees, elle doit retrouver
        // exactement la meme suite si on s'arrete au milieu.
        const conc = C.clampConc(state.conc || concNow);
        let buf = [];
        let done = 0;
        for (let i = 0; i < remaining.length && !pauseRequested; i += conc) {
          const win = remaining.slice(i, i + conc);
          const dets = await Promise.all(win.map((d) => getJson(
            API + '/drawing/drawing/1/' + base + '/' + encodeURIComponent(d.groupId) + '/' + encodeURIComponent(d.drawingId) + '?lang=' + LANG,
            state.delayMs)));
          for (let k = 0; k < win.length; k++) buf.push(dets[k] ? slimDrawing(dets[k], win[k].drawingId) : null);
          done += win.length;
          const last = done >= remaining.length;
          if (buf.length >= CHUNK || last) {
            await dms('drawings', { batchId: state.batchId, modelYearId: job.modelYearId, drawings: buf.filter(Boolean), complete: last });
            state = C.drawingsSent(state, buf.length);
            buf = [];
            await save();
          }
        }
        if (buf.length) { // pause au milieu d'un paquet : on envoie ce qui est lu
          await dms('drawings', { batchId: state.batchId, modelYearId: job.modelYearId, drawings: buf.filter(Boolean), complete: false });
          state = C.drawingsSent(state, buf.length); await save();
        }
        if (pauseRequested) continue;
        state = C.modelYearDone(state, false);
        await save();
        await dms('progress', { batchId: state.batchId, status: 'running', position: { cursor: state.cursor, modelYearId: job.modelYearId }, counters: { requests: requestCount } });
      }
      state.status = 'done'; await save();
      await dms('progress', { batchId: state.batchId, status: 'done', position: { cursor: state.cursor }, counters: { requests: requestCount } });
    } catch (e) {
      const kind = e && e.kind ? e.kind : 'error';
      state.status = kind === 'nodms' ? 'paused' : 'error';
      state.errorKind = kind; state.lastError = (e && e.message) || String(e);
      await save();
      if (kind !== 'nodms' && state.batchId) await dms('progress', { batchId: state.batchId, status: 'error', counters: { requests: requestCount }, error: state.lastError }).catch(() => {});
    } finally {
      running = false; stopHeartbeat(); render();
    }
  }

  /** On n'envoie au DMS que ce qui sert (aucune donnée de compte ni de panier). */
  function slimDrawing(det, id) {
    return {
      id: det.id != null ? det.id : id, code: det.code, description: det.description, imageUrl: det.imageUrl,
      originalImageUrl: det.originalImageUrl, hotspots: det.hotspots || [], validities: det.validities,
      parts: (det.parts || []).map((p) => ({
        code: p.code, description: p.description, position: p.position, quantity: p.quantity, price: p.price,
        vatPrice: p.vatPrice, discountGroup: p.discountGroup, replaced: p.replaced, replacedPart: p.replacedPart,
        partReplacementTree: p.partReplacementTree, notes: p.notes, partNotes: p.partNotes, minQuantity: p.minQuantity,
        eanCode: p.eanCode, hasTempario: p.hasTempario, startDate: p.startDate, endDate: p.endDate, validities: p.validities,
      })),
    };
  }

  async function stopImport() {
    pauseRequested = true;
    const batchId = state && state.batchId;
    state = Object.assign(state || {}, { status: 'stopped' });
    await save();
    if (batchId) await dms('progress', { batchId, status: 'stopped', counters: { requests: requestCount } }).catch(() => {});
  }

  async function resetAll() {
    await store.del(STATE_KEY); await store.del(TREE_KEY);
    state = null; plan = null; render();
  }

  // ---------------------------------------------------------------- interface (panneau flottant)
  let panel = null, plan = null, treeCache = null;
  const MARKETS = [
    { v: 'EU', label: 'Europe seulement' },
    { v: 'USA', label: 'USA seulement' },
    { v: 'THAILAND', label: 'Thailande seulement' },
    { v: 'BRASIL', label: 'Bresil seulement' },
    { v: 'ARGENTINA,AUSTRALIA,TAIWAN,CHINA,JAPAN', label: 'Autres marches' },
    { v: '*', label: 'Tous les marches' },
  ];
  const sel = { minYear: 2000, markets: ['EU'], excludedFamilies: [], excludedModels: [], includedModels: [] };
  if (OPT.markets) sel.markets = OPT.markets === '*' ? ['*'] : OPT.markets.split(',').filter(Boolean);
  if (OPT.minYear) sel.minYear = Math.min(2030, Math.max(1985, Math.round(Number(OPT.minYear) || 2000)));
  if (C.parseShard(OPT.shard)) sel.shard = C.parseShard(OPT.shard);
  let delaySec = OPT.delay ? Math.max(0.5, Number(OPT.delay) || 1) : 1;
  let concNow = C.clampConc(OPT.conc);
  let treeProgress = null;
  let autoResumeTimer = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const btn = (id, label, primary) => `<button data-a="${id}" style="margin:4px 6px 0 0;padding:7px 12px;border-radius:6px;border:1px solid ${primary ? '#cc0000' : '#bbb'};background:${primary ? '#cc0000' : '#fff'};color:${primary ? '#fff' : '#222'};font:600 12px system-ui;cursor:pointer">${label}</button>`;

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:70px;right:16px;width:440px;max-height:calc(100vh - 100px);overflow:auto;z-index:2147483647;background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:13px/1.45 system-ui;padding:14px';
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', onChange);
    document.documentElement.appendChild(panel);
    return panel;
  }

  function header() {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:14px">Import du catalogue Ducati → DMS</b>'
      + (RUN_LABEL ? '<span style="margin-left:8px;padding:1px 7px;border-radius:999px;background:#eee;font:600 11px system-ui">' + esc(RUN_LABEL) + '</span>' : '') + btn('close', 'Fermer') + '</div>';
  }

  function render() {
    if (!panel) return;
    let h = header();
    if (treeProgress) {
      h += `<p>Lecture de la liste des modèles… ${treeProgress.n} / ${treeProgress.total}<br><small>${esc(treeProgress.label)}</small></p>`;
    } else if (state && state.status !== 'ready') {
      h += renderRun();
    } else if (plan) {
      h += renderPlan();
    } else {
      h += '<p>1. Lire la liste des modèles Ducati (familles, cylindrées, modèles, millésimes). Environ 150 pages, 3 minutes.</p>' + btn('readTree', 'Lire la liste des modèles', true);
      h += '<p style="margin-top:10px;color:#666"><small>Aucun identifiant n’est lu ni enregistré : l’extension utilise votre session e-catalog. Le DMS doit être ouvert dans un autre onglet.</small></p>';
    }
    panel.innerHTML = h;
  }

  function renderPlan() {
    const s = plan.summary;
    const hours = C.estimateHours(s.modelYearsKept, delaySec * 1000, 76, 1);
    const hoursShared = C.estimateHours(s.modelYearsKept, delaySec * 1000, 76, 4);
    const mkNow = (sel.markets || ['EU']).join(',');
    const mkLabel = (MARKETS.find((x) => x.v === mkNow) || { label: mkNow }).label;
    let h = `<p><b>${s.modelsKept}</b> modèles gardés (${esc(mkLabel.toLowerCase())}, depuis ${sel.minYear}) · <b>${s.modelYearsKept}</b> modèles-années à lire.<br>`
      + `<small>${s.modelsOutsideMarkets || 0} modèles d'autres marchés exclus · ${s.modelYearsBeforeMin} millésimes avant ${sel.minYear} exclus`
      + (s.modelYearsNoYear ? ` · ${s.modelYearsNoYear} sans année (gardés)` : '') + `</small></p>`
      + `<p>Marchés : <select data-f="markets">`
      + MARKETS.map((x) => `<option value="${esc(x.v)}" ${x.v === mkNow ? 'selected' : ''}>${esc(x.label)}</option>`).join('')
      + `</select><br><small>Un onglet par marché permet de lire plusieurs marchés en parallèle (ouvrir l'onglet sur #run=usa, #run=thai…).</small></p>`
      + `<p>Millésimes depuis : <input data-f="minYear" type="number" min="1985" max="2030" step="1" value="${sel.minYear}" style="width:70px">`
      + `<br><small>Le catalogue Ducati descend jusqu'à 1990. Les millésimes déjà importés sont sautés.</small></p>`
      + `<p>Délai entre deux pages : <input data-f="delay" type="number" min="0.5" step="0.5" value="${delaySec}" style="width:60px"> s`
      + `<br><small>Durée estimée : ${hoursShared} à ${hours} h (moins si beaucoup de planches sont communes entre modèles).</small></p>`
      + btn('launch', 'Lancer l’import', true) + btn('rereadTree', 'Relire la liste') + '<hr style="margin:10px 0">';
    const byFam = {};
    plan.models.forEach((m) => { (byFam[m.familyId] = byFam[m.familyId] || { name: m.family, models: [] }).models.push(m); });
    for (const fid of Object.keys(byFam)) {
      const f = byFam[fid];
      const famOff = sel.excludedFamilies.includes(fid);
      const kept = f.models.filter((m) => m.kept).length;
      h += `<details style="margin:4px 0"><summary><label><input type="checkbox" data-f="fam" data-id="${esc(fid)}" ${famOff ? '' : 'checked'}> <b>${esc(f.name)}</b></label> <small>(${kept} / ${f.models.length} modèles)</small></summary><div style="padding-left:18px">`;
      for (const m of f.models) {
        const checked = m.kept || (m.reason === 'years' && !sel.excludedModels.includes(m.id));
        const tag = m.reason === 'market' ? ` <small style="color:#a15c00">marché ${esc(m.market)}</small>`
          : m.reason === 'years' ? ' <small style="color:#666">avant ' + sel.minYear + '</small>'
          : !m.isEurope ? ` <small style="color:#666">${esc(m.market)}</small>` : '';
        const years = m.years.length ? ` <small style="color:#666">${Math.min(...m.years)}–${Math.max(...m.years)}</small>` : '';
        h += `<div><label><input type="checkbox" data-f="model" data-id="${esc(m.id)}" data-eu="${m.isEurope ? 1 : 0}" ${checked ? 'checked' : ''} ${famOff ? 'disabled' : ''}> ${esc(m.description)}</label>${years}${tag}</div>`;
      }
      h += '</div></details>';
    }
    return h;
  }

  function renderRun() {
    const pct = C.progress(state);
    const labels = { running: 'En cours', paused: 'En pause', error: 'Arrêté', done: 'Terminé', stopped: 'Arrêté (lot clos)' };
    const cur = state.current && state.current.label ? ` · ${esc(state.current.label)}` : '';
    let h = `<p><b>${labels[state.status] || state.status}</b> — ${state.cursor} / ${state.jobs.length} modèles-années${cur}</p>`
      + `<div style="height:10px;background:#eee;border-radius:4px;overflow:hidden"><div style="height:10px;width:${pct}%;background:#cc0000"></div></div>`
      + `<p><small>${pct} % · ${state.drawings} planches importées · ${state.skipped} modèles-années déjà complets · ${state.requests || 0} pages lues · délai ${state.delayMs / 1000} s${state.conc > 1 ? ' · ' + state.conc + ' planches à la fois' : ''}</small></p>`;
    if (state.lastError) h += `<p style="background:#fff4e5;border:1px solid #f0c36d;border-radius:6px;padding:8px">${esc(state.lastError)}</p>`;
    if (autoResumeTimer) h += '<p>Reprise automatique dans quelques secondes…</p>' + btn('pause', 'Ne pas reprendre');
    else if (state.status === 'running') h += btn('pause', 'Pause');
    else if (state.status === 'paused' || state.status === 'error') h += btn('resume', 'Reprendre', true) + btn('stop', 'Arrêter l’import');
    if (state.status === 'paused' || state.status === 'error') h += `<p>Délai : <input data-f="delayRun" type="number" min="0.5" step="0.5" value="${state.delayMs / 1000}" style="width:60px"> s</p>`;
    if (state.status === 'done' || state.status === 'stopped') h += btn('reset', 'Nouvel import');
    return h;
  }

  function rebuildPlan() { if (treeCache) plan = C.buildPlan(treeOf(treeCache), sel); }

  async function onClick(ev) {
    const a = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-a');
    if (!a) return;
    if (a === 'close') { panel.remove(); panel = null; return; }
    if (a === 'readTree' || a === 'rereadTree') {
      if (a === 'rereadTree') await store.del(TREE_KEY);
      treeProgress = { n: 0, total: 1, label: '' }; render();
      try {
        treeCache = await readTree(delaySec * 1000, (n, total, label) => { treeProgress = { n, total, label }; render(); });
        treeProgress = null; rebuildPlan();
      } catch (e) { treeProgress = null; alert((e && e.message) || String(e)); }
      render();
    }
    if (a === 'launch') {
      if (!plan || !plan.jobs.length) return;
      if (!confirm(`Lancer l’import de ${plan.jobs.length} modèles-années ? Vous pourrez mettre en pause à tout moment.`)) return;
      state = C.newState(plan, { delayMs: delaySec * 1000, conc: concNow });
      state.selection = Object.assign({}, sel);
      await save();
      run();
    }
    if (a === 'pause') {
      if (autoResumeTimer) { clearTimeout(autoResumeTimer); autoResumeTimer = null; state.status = 'paused'; await save(); return; }
      pauseRequested = true; render();
    }
    if (a === 'resume') run();
    if (a === 'stop') { if (confirm('Arrêter définitivement ce lot ? (Les données déjà importées restent dans le DMS.)')) await stopImport(); }
    if (a === 'reset') await resetAll();
  }

  async function onChange(ev) {
    const el = ev.target; const f = el.getAttribute('data-f'); const id = el.getAttribute('data-id');
    const toggle = (arr, v, on) => { const i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); };
    if (f === 'delay') delaySec = Math.max(0.5, Number(el.value) || 1);
    // Millésime le plus ancien à importer. Figé à 2000 jusqu'au 13/10/2026 ; or le catalogue
    // Ducati descend à 1990, et 123 millésimes nous manquaient de ce seul fait.
    if (f === 'minYear') sel.minYear = Math.min(2030, Math.max(1985, Math.round(Number(el.value) || 2000)));
    // Marchés gardés. Le filtre Europe était un réglage par défaut, pas une limite :
    // Ducati publie aussi USA, Thailande, Bresil… soit 1439 millésimes de plus.
    if (f === 'markets') {
      const v = String(el.value || 'EU');
      sel.markets = v === '*' ? ['*'] : v.split(',').filter(Boolean);
      sel.includedModels.length = 0;
    }
    if (f === 'delayRun' && state) { state.delayMs = C.clampDelay(Number(el.value) * 1000); await save(); return; }
    if (f === 'fam') toggle(sel.excludedFamilies, id, !el.checked);
    if (f === 'model') {
      const eu = el.getAttribute('data-eu') === '1';
      if (eu) toggle(sel.excludedModels, id, !el.checked); else toggle(sel.includedModels, id, el.checked);
    }
    rebuildPlan(); render();
  }

  // ---------------------------------------------------------------- bouton + reprise automatique
  const launcher = document.createElement('button');
  launcher.textContent = 'Importer le catalogue';
  launcher.title = 'DMS Ducati : importer les modèles, vues éclatées et pièces dans le DMS';
  launcher.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483646;background:#cc0000;color:#fff;border:0;border-radius:6px;padding:10px 14px;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  launcher.addEventListener('click', async () => {
    ensurePanel();
    if (!state) state = (await store.get(STATE_KEY)) || null;
    if (!treeCache) { const t = await store.get(TREE_KEY); if (t && t.done) { treeCache = t; rebuildPlan(); } }
    render();
  });
  document.documentElement.appendChild(launcher);

  // Pont pour les autres sections de l'extension (ex. accessoires et vêtements).
  globalThis.DmsCatalogRuntime = { getJson, dms, store, sleep, StopError, takeLock, startHeartbeat, stopHeartbeat, requests: () => requestCount, ensurePanel: () => ensurePanel() };

  (async () => {
    const s = await store.get(STATE_KEY);
    if (s && s.status === 'running') {
      const l = await store.get(LOCK_KEY);
      if (l && Date.now() - l.at < 20000) return; // un autre onglet s'en occupe
      state = s; ensurePanel();
      autoResumeTimer = setTimeout(() => { autoResumeTimer = null; run(); }, 8000);
      render();
      return;
    }
    // Demarrage automatique (#auto=1), pour ouvrir dix onglets d'un coup sans
    // regler chaque panneau a la main. Jamais si cet onglet a deja un import en
    // cours, en pause ou arrete : sa reprise passe avant.
    if (!OPT.auto || s) return;
    const t = await store.get(TREE_KEY);
    if (!t || !t.done) return;                  // la liste des modeles doit deja etre lue
    treeCache = t; rebuildPlan(); ensurePanel(); render();
    if (!plan || !plan.jobs.length) return;
    state = C.newState(plan, { delayMs: delaySec * 1000, conc: concNow });
    state.selection = Object.assign({}, sel);
    await save();
    const stagger = 2000 + (sel.shard ? sel.shard.i : 0) * 700;   // les onglets ne partent pas tous ensemble
    autoResumeTimer = setTimeout(() => { autoResumeTimer = null; run(); }, stagger);
  })();
})();
