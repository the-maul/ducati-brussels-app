/* Pure rules of the nightly DCS certification: no browser API here.
 * Loaded by the service worker (importScripts: globalThis.DcsNightCore) and by `bun test`
 * (tests/dcs-night-core.test.ts). */
(function (root) {
  'use strict';

  var TIME_ZONE = 'Europe/Brussels';
  var WINDOW_START_HOUR = 22;
  var WINDOW_END_HOUR = 8;
  var MIN_GAP_MS = 25000;
  var MAX_GAP_MS = 30000;
  var JOB_TIMEOUT_MS = 90000;
  var WAIT_RETRY_MS = 5 * 60000;
  var VIN_RE = /^ZDM[A-HJ-NPR-Z0-9]{14}$/;

  var clockFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  /** Brussels wall clock of an instant. */
  function brusselsClock(date) {
    var out = {};
    clockFormat.formatToParts(date).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = Number(p.value);
    });
    return out;
  }

  function isInNightWindow(date) {
    var h = brusselsClock(date).hour;
    return h >= WINDOW_START_HOUR || h < WINDOW_END_HOUR;
  }

  /** Instant of a Brussels wall-clock time. 22:00 and 08:00 never fall in a clock change. */
  function brusselsInstant(year, month, day, hour) {
    var wanted = Date.UTC(year, month - 1, day, hour);
    var guess = wanted;
    for (var i = 0; i < 3; i++) {
      var c = brusselsClock(new Date(guess));
      var shown = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
      guess += wanted - shown;
    }
    return new Date(guess);
  }

  /** First time the wall clock reaches `hour`, strictly after `date`. */
  function nextOccurrence(date, hour) {
    var c = brusselsClock(date);
    for (var add = 0; add < 3; add++) {
      var day = new Date(Date.UTC(c.year, c.month - 1, c.day + add));
      var at = brusselsInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour);
      if (at.getTime() > date.getTime()) return at;
    }
    return null;
  }

  function nextNightStart(date) { return nextOccurrence(date, WINDOW_START_HOUR); }
  function nextNightEnd(date) { return nextOccurrence(date, WINDOW_END_HOUR); }

  /** Pause between two bikes: 25 to 30 seconds. */
  function nextGapMs(random) {
    var r = typeof random === 'number' ? random : Math.random();
    var bounded = Math.min(Math.max(r, 0), 1);
    return MIN_GAP_MS + Math.round(bounded * (MAX_GAP_MS - MIN_GAP_MS));
  }

  function isCertifiableVin(vin) {
    return typeof vin === 'string' && VIN_RE.test(vin);
  }

  /** 1: open appointment or repair order, 2: workshop visit in the last 24 months, 3: the rest. */
  function priorityFor(visit) {
    if (visit && visit.open) return 1;
    if (visit && visit.recent) return 2;
    return 3;
  }

  /** Portal login redirect? Only host and path are read: the VIN in the query is irrelevant. */
  function isDcsLoginUrl(url) {
    var parsed;
    try { parsed = new URL(url); } catch (_) { return false; }
    if (/^(login|sso|auth|identity|signin)\./i.test(parsed.hostname)) return true;
    return /(^|\/)(login|logout|signin|sign-in|secur|sso|saml|oauth2?|authorize)(\/|$|\.)/i.test(parsed.pathname);
  }

  /** Checks what the portal returned before anything is sent to the DMS. */
  function classifyScrape(requestedVin, payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'no_data' };
    var read = String(payload.vin || '').trim().toUpperCase();
    if (!read) return { ok: false, error: 'no_data' };
    if (read !== requestedVin) return { ok: false, error: 'vin_mismatch' };
    return { ok: true };
  }

  /** What the alarm should do now. */
  function decideTick(state, nowMs) {
    if (!state || !state.armed) return 'idle';
    var inWindow = isInNightWindow(new Date(nowMs));
    if (state.job) {
      if (!inWindow) return 'abort-job';
      if (nowMs - state.job.startedAt >= JOB_TIMEOUT_MS) return 'job-timeout';
      return 'wait-job';
    }
    if (!inWindow) return 'sleep';
    if (state.nextAt && nowMs < state.nextAt) return 'wait';
    return 'take-next';
  }

  /** The PC stays awake only during the window of a run that can still progress. */
  function shouldKeepAwake(state, nowMs) {
    if (!state || !state.armed) return false;
    if (state.serverState === 'paused' || state.serverState === 'pilot_wait' || state.serverState === 'finished') return false;
    return isInNightWindow(new Date(nowMs));
  }

  var api = {
    TIME_ZONE: TIME_ZONE, WINDOW_START_HOUR: WINDOW_START_HOUR, WINDOW_END_HOUR: WINDOW_END_HOUR,
    MIN_GAP_MS: MIN_GAP_MS, MAX_GAP_MS: MAX_GAP_MS, JOB_TIMEOUT_MS: JOB_TIMEOUT_MS, WAIT_RETRY_MS: WAIT_RETRY_MS,
    brusselsClock: brusselsClock, isInNightWindow: isInNightWindow, nextNightStart: nextNightStart, nextNightEnd: nextNightEnd,
    nextGapMs: nextGapMs, isCertifiableVin: isCertifiableVin, priorityFor: priorityFor, isDcsLoginUrl: isDcsLoginUrl,
    classifyScrape: classifyScrape, decideTick: decideTick, shouldKeepAwake: shouldKeepAwake,
  };
  root.DcsNightCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
