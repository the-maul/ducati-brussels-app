/* Nightly DCS certification: orchestration in the service worker.
 * The worker can stop at any moment, so all state is in chrome.storage and every wake-up comes
 * from chrome.alarms. The DMS tab holds the user's session and owns the queue (dcs_night_* SQL).
 * No Ducati credential is read or stored: a login redirect simply pauses the run. */
(function (root) {
  'use strict';

  var KEY = 'dcsNight';
  var TICK = 'dcs-night-tick';
  var STEP = 'dcs-night-step';
  var RETIRED_MAX = 20;
  // chrome.notifications requires an icon; the extension ships none.
  var ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  var NOTICES = {
    pilot_wait: 'Pilote terminé : vérifiez les 10 motos, puis cliquez sur Continuer dans le DMS.',
    finished: 'Certification DCS terminée : la file est vide.',
    session_expired: 'Tournée en pause : la session DCS a expiré. Reconnectez-vous, puis reprenez dans le DMS.',
    failures: 'Tournée en pause : 3 échecs de suite. Vérifiez le DCS, puis reprenez dans le DMS.',
    company_mismatch: 'Tournée en pause : le DMS est sur une autre société.',
    no_dms: 'Tournée bloquée : aucun onglet DMS connecté sur la bonne société.',
    dms_error: 'Tournée bloquée : le DMS ne répond pas.',
  };

  function create(chromeApi, options) {
    var core = options.core;
    var now = options.now || function () { return Date.now(); };
    var random = options.random || Math.random;
    var chain = Promise.resolve();

    /* Alarms, tab events and messages must not interleave on the same state. */
    function locked(fn) {
      var run = chain.then(fn);
      chain = run.catch(function () {});
      return run;
    }

    async function load() {
      var stored = await chromeApi.storage.local.get(KEY);
      return Object.assign({
        armed: false, companyId: null, job: null, nextAt: 0, serverState: null, blocked: null, notified: null, retired: [],
      }, stored[KEY] || {});
    }
    function save(state) {
      var patch = {};
      patch[KEY] = state;
      return chromeApi.storage.local.set(patch);
    }

    function notify(state, code) {
      if (!NOTICES[code] || state.notified === code) return;
      state.notified = code;
      try {
        chromeApi.notifications.create('dcs-night-' + code, {
          type: 'basic', iconUrl: ICON, title: 'Certification DCS', message: NOTICES[code],
        }, function () { void chromeApi.runtime.lastError; });
      } catch (_) { /* a missing notification must never stop the run */ }
    }

    function syncPower(state) {
      if (!chromeApi.power) return;
      try {
        if (core.shouldKeepAwake(state, now())) chromeApi.power.requestKeepAwake('system');
        else chromeApi.power.releaseKeepAwake();
      } catch (_) { /* optional API */ }
    }

    function callDms(tabId, fn, args) {
      return new Promise(function (resolve) {
        try {
          chromeApi.tabs.sendMessage(tabId, { type: 'dcs-night-call', fn: fn, args: args || {} }, function (resp) {
            if (chromeApi.runtime.lastError) { resolve(null); return; }
            resolve(resp || null);
          });
        } catch (_) { resolve(null); }
      });
    }

    async function findDmsTab(companyId) {
      var tabs = await chromeApi.tabs.query({ url: options.dmsMatch });
      for (var i = 0; i < (tabs || []).length; i++) {
        var reply = await callDms(tabs[i].id, 'hello');
        var data = reply && reply.ok ? reply.data : null;
        if (data && data.isAdmin && data.companyId === companyId) {
          // Chrome's memory saver must not unload the tab that holds the DMS session overnight.
          try { await chromeApi.tabs.update(tabs[i].id, { autoDiscardable: false }); } catch (_) { /* best effort */ }
          return tabs[i].id;
        }
      }
      return null;
    }

    function schedule(state, delayMs) {
      state.nextAt = now() + delayMs;
      chromeApi.alarms.create(STEP, { when: state.nextAt });
    }

    async function ensureTick() {
      var existing = await chromeApi.alarms.get(TICK);
      if (!existing) chromeApi.alarms.create(TICK, { periodInMinutes: 1 });
    }

    function closeTab(tabId) {
      try {
        var closing = chromeApi.tabs.remove(tabId);
        if (closing && closing.catch) closing.catch(function () {});
      } catch (_) { /* already closed */ }
    }

    /* Forget the tab first: a late message from it must never reach the normal import path. */
    function retireJob(state) {
      var job = state.job;
      state.job = null;
      state.retired = (state.retired || []).concat(job.tabId).slice(-RETIRED_MAX);
      closeTab(job.tabId);
      return job;
    }

    function applyRunReply(state, reply) {
      var data = reply && reply.ok ? reply.data : null;
      if (!data || !data.run_status) return;
      state.serverState = data.run_status;
      if (data.run_status === 'paused') notify(state, data.pause_reason);
    }

    async function finishJob(state, outcome, payload) {
      var job = retireJob(state);
      await save(state);
      var args = { companyId: state.companyId, queueId: job.queueId, vin: job.vin };
      var reply = outcome.ok
        ? await callDms(job.dmsTabId, 'apply', Object.assign({ payload: payload }, args))
        : await callDms(job.dmsTabId, 'mark', Object.assign({ ok: false, error: outcome.error }, args));
      if (!reply) {
        // DMS tab reloaded meanwhile. If none is back, the SQL stale-claim rule takes over.
        var tabId = await findDmsTab(state.companyId);
        if (tabId != null) {
          reply = await callDms(tabId, 'mark', Object.assign({ ok: false, error: outcome.ok ? 'dms_error' : outcome.error }, args));
        }
      }
      applyRunReply(state, reply);
      schedule(state, core.nextGapMs(random()));
      syncPower(state);
      await save(state);
    }

    async function block(state, code) {
      state.blocked = code;
      notify(state, code);
      schedule(state, core.WAIT_RETRY_MS);
      await save(state);
    }

    async function takeNext(state) {
      var dmsTabId = await findDmsTab(state.companyId);
      if (dmsTabId == null) { await block(state, 'no_dms'); return; }
      var reply = await callDms(dmsTabId, 'next', { companyId: state.companyId });
      if (!reply || !reply.ok || !reply.data) { await block(state, 'dms_error'); return; }
      state.blocked = null;

      var data = reply.data;
      if (data.state !== 'go') {
        state.serverState = data.reason;
        if (data.reason === 'finished') {
          notify(state, 'finished');
          state.armed = false;
          await chromeApi.alarms.clear(TICK);
          await chromeApi.alarms.clear(STEP);
        } else {
          if (data.reason === 'pilot_wait') notify(state, 'pilot_wait');
          if (data.reason === 'paused') notify(state, data.pause_reason);
          schedule(state, core.WAIT_RETRY_MS);
        }
        syncPower(state);
        await save(state);
        return;
      }

      state.serverState = 'running';
      state.notified = null;
      var item = data.item;
      var args = { companyId: state.companyId, queueId: item.id, vin: item.vin, ok: false };
      if (!core.isCertifiableVin(item.vin)) {
        applyRunReply(state, await callDms(dmsTabId, 'mark', Object.assign({ error: 'invalid_vin' }, args)));
        schedule(state, core.nextGapMs(random()));
        await save(state);
        return;
      }

      // The job is saved before the portal is loaded: the worker can die between the two.
      var tab = null;
      try { tab = await chromeApi.tabs.create({ url: 'about:blank', active: false }); } catch (_) { tab = null; }
      if (!tab) {
        applyRunReply(state, await callDms(dmsTabId, 'mark', Object.assign({ error: 'tab_error' }, args)));
        schedule(state, core.nextGapMs(random()));
        await save(state);
        return;
      }
      state.job = { queueId: item.id, vin: item.vin, tabId: tab.id, dmsTabId: dmsTabId, startedAt: now() };
      await save(state);
      try {
        await chromeApi.tabs.update(tab.id, { url: options.vinUrl(item.vin) });
      } catch (_) {
        await finishJob(state, { ok: false, error: 'tab_error' });
      }
    }

    /* Read only at timeout: SSO can pass through login-like URLs on a valid session. */
    async function timeoutOutcome(job) {
      try {
        var tab = await chromeApi.tabs.get(job.tabId);
        if (tab && core.isDcsLoginUrl(tab.url || '')) return { ok: false, error: 'session_expired' };
      } catch (_) { /* tab gone */ }
      return { ok: false, error: 'timeout' };
    }

    function tick() {
      return locked(async function () {
        var state = await load();
        syncPower(state);
        var action = core.decideTick(state, now());
        if (action === 'take-next') await takeNext(state);
        else if (action === 'job-timeout') await finishJob(state, await timeoutOutcome(state.job));
        else if (action === 'abort-job') await finishJob(state, { ok: false, error: 'window_closed' });
      });
    }

    /* True when the message belongs to the run: it must then skip the normal import. */
    function handleScrape(tabId, payload) {
      if (tabId == null) return Promise.resolve(false);
      return locked(async function () {
        var state = await load();
        if ((state.retired || []).indexOf(tabId) >= 0) return true;
        if (!state.job || state.job.tabId !== tabId) return false;
        await finishJob(state, core.classifyScrape(state.job.vin, payload), payload);
        return true;
      });
    }

    function onTabRemoved(tabId) {
      return locked(async function () {
        var state = await load();
        if (state.job && state.job.tabId === tabId) await finishJob(state, { ok: false, error: 'tab_closed' });
      });
    }

    function handleCommand(msg) {
      return locked(async function () {
        var state = await load();
        if (msg.cmd === 'arm' && msg.companyId) {
          state.armed = true;
          state.companyId = msg.companyId;
          state.nextAt = 0;
          state.blocked = null;
          state.serverState = 'running';
          state.notified = null;
          await ensureTick();
          chromeApi.alarms.create(STEP, { when: now() + 1000 });
        } else if (msg.cmd === 'abort' && state.job) {
          // The DMS has already released the bike on its side.
          retireJob(state);
          state.serverState = 'paused';
        }
        syncPower(state);
        await save(state);
        return { installed: true, armed: state.armed, working: !!state.job, blocked: state.blocked };
      });
    }

    function restoreAfterRestart() {
      return locked(async function () {
        var state = await load();
        if (state.armed) await ensureTick();
        syncPower(state);
      });
    }

    function onAlarm(alarm) {
      if (alarm && (alarm.name === TICK || alarm.name === STEP)) return tick();
      return Promise.resolve();
    }

    return {
      tick: tick, onAlarm: onAlarm, handleScrape: handleScrape, handleCommand: handleCommand,
      onTabRemoved: onTabRemoved, restoreAfterRestart: restoreAfterRestart,
    };
  }

  root.DcsNightRuntime = { create: create };
  if (typeof module === 'object' && module.exports) module.exports = root.DcsNightRuntime;
})(typeof globalThis !== 'undefined' ? globalThis : this);
