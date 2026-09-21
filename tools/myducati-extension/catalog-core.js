/* Règles pures de l'import du catalogue Ducati (e-catalog) — sans navigateur, testées par
 * `bun test` (tests/ducati-catalog-core.test.ts).
 *
 * Chargé AVANT catalog.js dans la page e-catalog (content script classique : expose
 * globalThis.DmsCatalogCore) et importable en CommonJS par les tests.
 *
 * Aucune donnée d'identification n'est manipulée ici : l'état de reprise ne contient que des
 * identifiants Ducati de catalogue (familles, modèles, planches) et des compteurs.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------------------
  // 1. Filtre Europe (décision M-15) : un modèle est « hors Europe » si son nom contient un
  //    marché non européen comme mot entier (« ICON 2G USA », « … THAILAND », « … BRASIL »).
  //    Les modèles européens n'ont en général pas de suffixe : tout le reste est gardé.
  // ---------------------------------------------------------------------------------------
  /** [motif dans le nom, marché retenu]. Ordre = priorité (le 1er trouvé donne le marché). */
  var NON_EU_MARKETS = [
    ['THAILAND', 'THAILAND'], ['THAI', 'THAILAND'],
    ['USA', 'USA'], ['U.S.A.', 'USA'], ['US', 'USA'], ['CALIFORNIA', 'USA'], ['CAL', 'USA'],
    ['NORTH AMERICA', 'USA'], ['NAFTA', 'USA'],
    ['CANADA', 'CANADA'], ['CDN', 'CANADA'],
    ['BRASIL', 'BRASIL'], ['BRAZIL', 'BRASIL'],
    ['ARGENTINA', 'ARGENTINA'], ['MEXICO', 'MEXICO'], ['CHILE', 'CHILE'], ['COLOMBIA', 'COLOMBIA'],
    ['PERU', 'PERU'], ['LATAM', 'LATAM'], ['LATIN AMERICA', 'LATAM'],
    ['CHINA', 'CHINA'], ['CHN', 'CHINA'], ['HONG KONG', 'HONG KONG'], ['TAIWAN', 'TAIWAN'],
    ['JAPAN', 'JAPAN'], ['JAP', 'JAPAN'], ['JPN', 'JAPAN'],
    ['KOREA', 'KOREA'], ['INDIA', 'INDIA'], ['MALAYSIA', 'MALAYSIA'], ['INDONESIA', 'INDONESIA'],
    ['PHILIPPINES', 'PHILIPPINES'], ['VIETNAM', 'VIETNAM'], ['SINGAPORE', 'SINGAPORE'], ['ASIA', 'ASIA'],
    ['AUSTRALIA', 'AUSTRALIA'], ['AUS', 'AUSTRALIA'], ['NEW ZEALAND', 'NEW ZEALAND'], ['NZ', 'NEW ZEALAND'],
    ['SOUTH AFRICA', 'SOUTH AFRICA'], ['ISRAEL', 'ISRAEL'],
  ];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var MARKET_RES = NON_EU_MARKETS.map(function (m) {
    // mot entier : bordé par le début/la fin ou un caractère non alphanumérique
    return { re: new RegExp('(^|[^A-Z0-9])' + escapeRe(m[0]) + '(?=$|[^A-Z0-9])'), market: m[1] };
  });

  /** Marché déduit du nom du modèle : 'EU' (par défaut) ou le marché hors Europe trouvé. */
  function marketOf(description) {
    var s = String(description == null ? '' : description).toUpperCase();
    for (var i = 0; i < MARKET_RES.length; i++) {
      if (MARKET_RES[i].re.test(s)) return MARKET_RES[i].market;
    }
    return 'EU';
  }
  function isEuropeModel(description) { return marketOf(description) === 'EU'; }

  /** Millésime d'un modèle-année Ducati : champ year (nombre ou texte), sinon 4 chiffres du code. */
  function yearOf(my) {
    if (!my) return null;
    var y = my.year;
    if (typeof y === 'number' && isFinite(y)) return Math.trunc(y);
    var m = String(y == null ? '' : y).match(/(19|20)\d{2}/) || String(my.code || '').match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : null;
  }

  // ---------------------------------------------------------------------------------------
  // 2. Arbre et plan d'import
  // ---------------------------------------------------------------------------------------
  var str = function (v) { return v == null ? '' : String(v); };

  /**
   * Arbre normalisé à envoyer au DMS (ducati_catalog_ingest_tree), à partir des réponses brutes :
   *   families : [{id, description}]
   *   superModelsByFamily : { [familyId]: [{id, description}] }
   *   modelsByKey : { ['fam/sm']: [{id, description, modelYears: [{id, code, year, path}]}] }
   */
  function buildTree(families, superModelsByFamily, modelsByKey) {
    return {
      families: (families || []).map(function (f) {
        var fid = str(f.id);
        return {
          id: fid, description: str(f.description || f.id),
          superModels: ((superModelsByFamily || {})[fid] || []).map(function (s) {
            var sid = str(s.id);
            return {
              id: sid, description: str(s.description || s.id),
              models: ((modelsByKey || {})[fid + '/' + sid] || []).map(function (m) {
                var market = marketOf(m.description);
                return {
                  id: str(m.id), description: str(m.description || m.id), market: market, isEurope: market === 'EU',
                  modelYears: (m.modelYears || []).map(function (y) {
                    return { id: str(y.id), code: y.code == null ? null : str(y.code), year: yearOf(y), path: y.path == null ? null : str(y.path) };
                  }),
                };
              }),
            };
          }),
        };
      }),
    };
  }

  /**
   * Plan d'import : liste ordonnée des modèles-années à lire, après filtre.
   * sel = { minYear (2000), excludedFamilies: [ids], excludedModels: [ids], includedModels: [ids] }
   *  - un modèle hors Europe est exclu sauf s'il est dans includedModels ;
   *  - un modèle d'excludedModels ou d'une famille d'excludedFamilies est exclu ;
   *  - un millésime < minYear est toujours exclu ; un millésime inconnu est gardé (signalé).
   * Renvoie { jobs, models, summary }.
   */
  function buildPlan(tree, sel) {
    sel = sel || {};
    var minYear = sel.minYear == null ? 2000 : sel.minYear;
    var exFam = toSet(sel.excludedFamilies), exMod = toSet(sel.excludedModels), inMod = toSet(sel.includedModels);
    var jobs = [], models = [];
    var summary = { families: 0, models: 0, modelsKept: 0, modelsOutsideEurope: 0, modelsUnchecked: 0,
                    modelYears: 0, modelYearsKept: 0, modelYearsBeforeMin: 0, modelYearsNoYear: 0 };
    ((tree && tree.families) || []).forEach(function (f) {
      summary.families++;
      (f.superModels || []).forEach(function (s) {
        (s.models || []).forEach(function (m) {
          summary.models++;
          var europe = m.isEurope !== undefined ? !!m.isEurope : isEuropeModel(m.description);
          var reason = null;
          if (exFam.has(f.id)) reason = 'family';
          else if (exMod.has(m.id)) reason = 'unchecked';
          else if (!europe && !inMod.has(m.id)) reason = 'market';
          var years = (m.modelYears || []).map(function (y) { return { y: y, year: y.year != null ? y.year : yearOf(y) }; });
          var keptYears = years.filter(function (x) { return x.year == null || x.year >= minYear; });
          summary.modelYears += years.length;
          summary.modelYearsBeforeMin += years.length - keptYears.length;
          if (!europe) summary.modelsOutsideEurope++;
          if (reason === 'unchecked') summary.modelsUnchecked++;
          var kept = !reason && keptYears.length > 0;
          if (!reason && keptYears.length === 0) reason = 'years';
          models.push({ familyId: f.id, family: f.description, superModelId: s.id, superModel: s.description,
                        id: m.id, description: m.description, market: m.market || marketOf(m.description),
                        isEurope: europe, kept: kept, reason: reason,
                        years: keptYears.map(function (x) { return x.year; }).filter(function (y) { return y != null; }) });
          if (!kept) return;
          summary.modelsKept++;
          keptYears.forEach(function (x) {
            if (x.year == null) summary.modelYearsNoYear++;
            summary.modelYearsKept++;
            jobs.push({ familyId: f.id, superModelId: s.id, modelId: m.id, modelYearId: x.y.id,
                        label: m.description + (x.year ? ' ' + x.year : ''), year: x.year });
          });
        });
      });
    });
    return { jobs: jobs, models: models, summary: summary };
  }

  function toSet(a) { return new Set((a || []).map(String)); }

  // ---------------------------------------------------------------------------------------
  // 3. Planches : dédoublonnage
  // ---------------------------------------------------------------------------------------
  /** Planches d'un modèle-année (réponse « groups »), une seule fois par id de planche. */
  function uniqueDrawings(groups) {
    var seen = new Set(), out = [];
    (groups || []).forEach(function (g) {
      (g.drawings || []).forEach(function (d) {
        var id = str(d.id);
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push({ drawingId: id, groupId: str(g.id) });
      });
    });
    return out;
  }

  /** Retire les planches déjà connues (ids renvoyés par le DMS ou déjà lus pendant ce lot). */
  function withoutKnown(list, known) {
    var k = known instanceof Set ? known : toSet(known);
    return (list || []).filter(function (x) { return !k.has(str(x.drawingId)); });
  }

  // ---------------------------------------------------------------------------------------
  // 4. Référence normalisée : même forme que la base (ducati_catalog_norm_ref,
  //    index idx_articles_ref_compact) : majuscules, uniquement A-Z et 0-9.
  // ---------------------------------------------------------------------------------------
  function normalizeReference(ref) {
    return String(ref == null ? '' : ref).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // ---------------------------------------------------------------------------------------
  // 5. Réponses de l'e-catalog : quand faut-il s'arrêter ?
  //    r = { status, type, redirected, url, contentType }
  //    'ok' | 'auth' (401/403, ou redirection vers la connexion Ducati, ou page HTML = session
  //    expirée) | 'rate' (429) | 'notfound' (404 : on saute) | 'server' (5xx, réessai) | 'other'
  // ---------------------------------------------------------------------------------------
  function classifyResponse(r) {
    var status = r && r.status;
    var url = String((r && r.url) || '');
    var ct = String((r && r.contentType) || '').toLowerCase();
    if (r && r.type === 'opaqueredirect') return 'auth'; // redirection (vers la connexion Ducati) bloquée
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate';
    if ((r && r.redirected && /idp\.ducati\.com|oauth2|login/i.test(url)) || /idp\.ducati\.com/i.test(url)) return 'auth';
    if (status === 404) return 'notfound';
    if (status >= 500) return 'server';
    if (status >= 200 && status < 300) {
      if (ct && ct.indexOf('json') === -1) return 'auth'; // page de connexion HTML à la place du JSON
      return 'ok';
    }
    return 'other';
  }

  // ---------------------------------------------------------------------------------------
  // 6. État de reprise (chrome.storage.local) — jamais d'identifiant
  // ---------------------------------------------------------------------------------------
  var STATE_VERSION = 1;
  var DEFAULT_DELAY_MS = 1000;
  var MIN_DELAY_MS = 500;

  function newState(plan, opts) {
    opts = opts || {};
    return {
      version: STATE_VERSION,
      status: 'ready',                 // ready | running | paused | error | done | stopped
      batchId: null,
      delayMs: clampDelay(opts.delayMs),
      jobs: (plan && plan.jobs) || [],
      cursor: 0,                       // index du modèle-année en cours
      current: null,                   // { modelYearId, pending: [{drawingId, groupId}], sent: n }
      done: 0, skipped: 0, drawings: 0, requests: 0,
      lastError: null, errorKind: null,
      updatedAt: null,
    };
  }

  function clampDelay(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return DEFAULT_DELAY_MS;
    return Math.max(MIN_DELAY_MS, Math.round(n));
  }

  /** Début d'un modèle-année : les planches encore à lire (déjà filtrées par le DMS). */
  function startModelYear(state, modelYearId, pending) {
    return assign(state, { current: { modelYearId: String(modelYearId), pending: (pending || []).slice(), sent: 0 } });
  }

  /** n planches envoyées au DMS : on avance dans current.pending. */
  function drawingsSent(state, n) {
    var c = state.current;
    if (!c) return state;
    return assign(state, { current: assign(c, { sent: Math.min(c.pending.length, c.sent + n) }), drawings: state.drawings + n });
  }

  /** Modèle-année terminé (ou sauté) : passe au suivant. */
  function modelYearDone(state, skipped) {
    var next = assign(state, { cursor: state.cursor + 1, current: null, done: state.done + 1, skipped: state.skipped + (skipped ? 1 : 0) });
    if (next.cursor >= next.jobs.length) next.status = 'done';
    return next;
  }

  /** Où reprendre : { job, remaining } (planches restantes du modèle-année en cours) ; null si fini. */
  function resumePoint(state) {
    if (!state || state.cursor >= (state.jobs || []).length) return null;
    var job = state.jobs[state.cursor];
    var c = state.current;
    var remaining = c && c.modelYearId === String(job.modelYearId) ? c.pending.slice(c.sent) : null;
    return { job: job, remaining: remaining };
  }

  function progress(state) {
    var total = (state && state.jobs && state.jobs.length) || 0;
    if (!total) return 0;
    var part = 0;
    var c = state.current;
    if (c && c.pending.length) part = c.sent / c.pending.length;
    return Math.min(100, Math.round(((state.cursor + part) / total) * 1000) / 10);
  }

  /** Clés interdites dans l'état stocké : rien qui ressemble à un identifiant ou un jeton. */
  var FORBIDDEN_KEY = /pass|token|cookie|auth|secret|session|credential|xsrf|csrf|login|email/i;
  function sanitizeState(state) {
    return JSON.parse(JSON.stringify(state, function (k, v) { return k && FORBIDDEN_KEY.test(k) ? undefined : v; }));
  }

  /** Durée estimée (heures) : 1 requête « groupes » par modèle-année + ses planches. */
  function estimateHours(modelYears, delayMs, drawingsPerModelYear, shareFactor) {
    var d = clampDelay(delayMs) / 1000;
    var perMy = drawingsPerModelYear == null ? 76 : drawingsPerModelYear;
    var share = shareFactor == null ? 1 : Math.max(1, shareFactor);
    var requests = modelYears * (1 + perMy / share);
    return Math.round((requests * (d + 0.25)) / 360) / 10; // +0,25 s par requête (réponse + envoi au DMS)
  }

  function assign(a, b) { var o = {}; var k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  var api = {
    NON_EU_MARKETS: NON_EU_MARKETS, DEFAULT_DELAY_MS: DEFAULT_DELAY_MS, MIN_DELAY_MS: MIN_DELAY_MS,
    marketOf: marketOf, isEuropeModel: isEuropeModel, yearOf: yearOf,
    buildTree: buildTree, buildPlan: buildPlan,
    uniqueDrawings: uniqueDrawings, withoutKnown: withoutKnown,
    normalizeReference: normalizeReference, classifyResponse: classifyResponse,
    newState: newState, clampDelay: clampDelay, startModelYear: startModelYear, drawingsSent: drawingsSent,
    modelYearDone: modelYearDone, resumePoint: resumePoint, progress: progress, sanitizeState: sanitizeState,
    estimateHours: estimateHours,
  };
  root.DmsCatalogCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
