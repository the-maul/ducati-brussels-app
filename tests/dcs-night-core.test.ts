/**
 * Nightly DCS certification (VEH001): time window, priorities, safety stops and orchestration
 * of the service worker against a fake Chrome. Fictitious VINs only.
 */
import { describe, expect, test } from 'bun:test';
import '../tools/myducati-extension/dcs-night-core.js';
import '../tools/myducati-extension/dcs-night.js';
import { dcsNightApplyError, dcsNightDisplay, estimateNights } from '../src/modules/vehicles/dcs-night-rules';
import { handleDcsNightCall, isDcsNightCall, type DcsNightCall, type DcsNightDeps } from '../src/modules/vehicles/dcs-night-bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */
const core = (globalThis as any).DcsNightCore;
const runtime = (globalThis as any).DcsNightRuntime;

const VIN_A = 'ZDM1234567890ABCD'.replace('O', '0');
const VIN_B = 'ZDM1234567890ABCE';
const at = (iso: string) => new Date(iso);

describe('fenetre 22:00-08:00, heure de Bruxelles', () => {
  test('hiver (UTC+1) : bornes exactes', () => {
    expect(core.isInNightWindow(at('2026-11-23T20:59:59Z'))).toBe(false);
    expect(core.isInNightWindow(at('2026-11-23T21:00:00Z'))).toBe(true);
    expect(core.isInNightWindow(at('2026-11-24T06:59:59Z'))).toBe(true);
    expect(core.isInNightWindow(at('2026-11-24T07:00:00Z'))).toBe(false);
  });
  test('ete (UTC+2) : bornes exactes', () => {
    expect(core.isInNightWindow(at('2026-07-01T19:59:59Z'))).toBe(false);
    expect(core.isInNightWindow(at('2026-07-01T20:00:00Z'))).toBe(true);
    expect(core.isInNightWindow(at('2026-07-02T05:59:59Z'))).toBe(true);
    expect(core.isInNightWindow(at('2026-07-02T06:00:00Z'))).toBe(false);
  });
  test('a cheval sur minuit', () => {
    expect(core.isInNightWindow(at('2026-11-23T22:59:00Z'))).toBe(true);
    expect(core.isInNightWindow(at('2026-11-23T23:01:00Z'))).toBe(true);
  });
  test('passage a l\'heure d\'ete (29/03/2026) : nuit de 9 h', () => {
    const start = core.nextNightStart(at('2026-03-28T12:00:00Z'));
    const end = core.nextNightEnd(start);
    expect(start.toISOString()).toBe('2026-03-28T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3600000).toBe(9);
  });
  test('passage a l\'heure d\'hiver (25/10/2026) : nuit de 11 h', () => {
    const start = core.nextNightStart(at('2026-10-24T12:00:00Z'));
    const end = core.nextNightEnd(start);
    expect(start.toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3600000).toBe(11);
  });
  test('prochaine ouverture : le soir meme, ou le lendemain une fois passee', () => {
    expect(core.nextNightStart(at('2026-11-23T16:00:00Z')).toISOString()).toBe('2026-11-23T21:00:00.000Z');
    expect(core.nextNightStart(at('2026-11-23T21:00:00Z')).toISOString()).toBe('2026-11-24T21:00:00.000Z');
  });
});

describe('regles de la file', () => {
  test('pause de 25 a 30 s, avec alea', () => {
    expect(core.nextGapMs(0)).toBe(25000);
    expect(core.nextGapMs(1)).toBe(30000);
    expect(core.nextGapMs(0.5)).toBe(27500);
    for (let i = 0; i < 200; i++) {
      const gap = core.nextGapMs();
      expect(gap).toBeGreaterThanOrEqual(25000);
      expect(gap).toBeLessThanOrEqual(30000);
    }
  });
  test('VIN : 17 caracteres Ducati seulement', () => {
    expect(core.isCertifiableVin(VIN_B)).toBe(true);
    expect(core.isCertifiableVin('ZDM123')).toBe(false);
    expect(core.isCertifiableVin('WB1234567890ABCDE')).toBe(false);
    expect(core.isCertifiableVin('ZDM12345678901234O')).toBe(false);
    expect(core.isCertifiableVin(null)).toBe(false);
  });
  test('priorite : RDV ou OR ouvert, puis atelier 24 mois, puis le reste', () => {
    expect(core.priorityFor({ open: true, recent: true })).toBe(1);
    expect(core.priorityFor({ open: true })).toBe(1);
    expect(core.priorityFor({ recent: true })).toBe(2);
    expect(core.priorityFor({})).toBe(3);
  });
  test('page de connexion reconnue, fiche moto non', () => {
    expect(core.isDcsLoginUrl('https://ducati.my.site.com/dealer/s/login/?startURL=x')).toBe(true);
    expect(core.isDcsLoginUrl('https://login.example.com/x')).toBe(true);
    expect(core.isDcsLoginUrl(`https://ducati.my.site.com/dealer/s/vinhistory?vin=${VIN_B}`)).toBe(false);
    expect(core.isDcsLoginUrl('pas une url')).toBe(false);
  });
  test('lecture refusee si le VIN lu differe', () => {
    expect(core.classifyScrape(VIN_B, { vin: VIN_B }).ok).toBe(true);
    expect(core.classifyScrape(VIN_B, { vin: 'ZDM0000000000AAAA' }).error).toBe('vin_mismatch');
    expect(core.classifyScrape(VIN_B, {}).error).toBe('no_data');
    expect(core.classifyScrape(VIN_B, null).error).toBe('no_data');
  });
  test('decision de l\'alarme', () => {
    const night = at('2026-11-23T22:00:00Z').getTime();
    const day = at('2026-11-23T12:00:00Z').getTime();
    expect(core.decideTick({ armed: false }, night)).toBe('idle');
    expect(core.decideTick({ armed: true }, day)).toBe('sleep');
    expect(core.decideTick({ armed: true, nextAt: night + 1000 }, night)).toBe('wait');
    expect(core.decideTick({ armed: true, nextAt: night - 1 }, night)).toBe('take-next');
    expect(core.decideTick({ armed: true, job: { startedAt: night } }, night + 1000)).toBe('wait-job');
    expect(core.decideTick({ armed: true, job: { startedAt: night } }, night + core.JOB_TIMEOUT_MS)).toBe('job-timeout');
    expect(core.decideTick({ armed: true, job: { startedAt: day } }, day + 1000)).toBe('abort-job');
  });
  test('veille empechee seulement la nuit, sur une tournee active', () => {
    const night = at('2026-11-23T22:00:00Z').getTime();
    const day = at('2026-11-23T12:00:00Z').getTime();
    expect(core.shouldKeepAwake({ armed: true, serverState: 'running' }, night)).toBe(true);
    expect(core.shouldKeepAwake({ armed: true, serverState: 'running' }, day)).toBe(false);
    expect(core.shouldKeepAwake({ armed: true, serverState: 'paused' }, night)).toBe(false);
    expect(core.shouldKeepAwake({ armed: true, serverState: 'pilot_wait' }, night)).toBe(false);
    expect(core.shouldKeepAwake({ armed: false }, night)).toBe(false);
  });
  test('estimation du nombre de nuits', () => {
    expect(estimateNights(0)).toBe(0);
    expect(estimateNights(1)).toBe(1);
    expect(estimateNights(750)).toBe(1);
    expect(estimateNights(751)).toBe(2);
    expect(estimateNights(3000)).toBe(4);
  });
  test('etat affiche', () => {
    const run = { status: 'running', pause_reason: null, pilot_limit: 10, pilot_approved: false, consecutive_failures: 0 } as const;
    expect(dcsNightDisplay({ eligible: true, run: null })).toBe('not_started');
    expect(dcsNightDisplay({ eligible: true, in_window: false, run })).toBe('waiting');
    expect(dcsNightDisplay({ eligible: true, in_window: true, run })).toBe('running');
    expect(dcsNightDisplay({ eligible: true, in_window: true, run: { ...run, status: 'pilot_wait' } })).toBe('pilot_wait');
  });
  test('un import refuse ou introuvable ne certifie pas la moto', () => {
    expect(dcsNightApplyError({ matched: true })).toBeNull();
    expect(dcsNightApplyError({ matched: false })).toBe('not_found');
    expect(dcsNightApplyError(null)).toBe('not_found');
    expect(dcsNightApplyError({ matched: true, refused: true })).toBe('refused');
  });
});

describe('pont DMS', () => {
  const COMPANY = 'company-real';
  const call = (fn: string, args: Record<string, unknown> = {}): DcsNightCall => ({ source: 'dms-ducati-ext', action: 'dcs-night-call', id: 'x', fn, args });
  const deps = () => {
    const log: { marks: unknown[][]; applied: string[] } = { marks: [], applied: [] };
    const d: DcsNightDeps = {
      next: async () => ({ state: 'wait' }),
      mark: async (...a) => { log.marks.push(a); return { run_status: 'running' }; },
      apply: async (company) => { log.applied.push(company); return { matched: true }; },
    };
    return { d, log };
  };
  const applyArgs = { companyId: COMPANY, queueId: 'q1', vin: VIN_B, payload: { vin: VIN_B, contact: {}, vehicle: {} } };

  test('import pour une autre societe : refuse, rien n\'est ecrit', async () => {
    const { d, log } = deps();
    await handleDcsNightCall(call('apply', applyArgs), { companyId: 'company-test', isAdmin: true }, d);
    expect(log.applied).toEqual([]);
    expect(log.marks).toEqual([[COMPANY, 'q1', false, 'company_mismatch']]);
  });
  test('VIN different : refuse, rien n\'est ecrit', async () => {
    const { d, log } = deps();
    await handleDcsNightCall(call('apply', { ...applyArgs, vin: VIN_A }), { companyId: COMPANY, isAdmin: true }, d);
    expect(log.applied).toEqual([]);
    expect(log.marks[0][3]).toBe('vin_mismatch');
  });
  test('import reussi : moto marquee faite', async () => {
    const { d, log } = deps();
    await handleDcsNightCall(call('apply', applyArgs), { companyId: COMPANY, isAdmin: true }, d);
    expect(log.applied).toEqual([COMPANY]);
    expect(log.marks).toEqual([[COMPANY, 'q1', true, null]]);
  });
  test('erreur d\'ecriture : moto en echec', async () => {
    const { d, log } = deps();
    d.apply = async () => { throw new Error('boom'); };
    await handleDcsNightCall(call('apply', applyArgs), { companyId: COMPANY, isAdmin: true }, d);
    expect(log.marks[0][3]).toBe('apply_error');
  });
  test('liste fermee : le pilote ne peut pas etre valide par l\'extension', async () => {
    const { d } = deps();
    for (const fn of ['approve', 'approvePilot', 'start', 'resume', 'constructor']) {
      const r = await handleDcsNightCall(call(fn, { companyId: COMPANY }), { companyId: COMPANY, isAdmin: true }, d);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('unknown');
    }
  });
  test('prochaine moto refusee sur une autre societe ou sans droit admin', async () => {
    const { d } = deps();
    expect((await handleDcsNightCall(call('next', { companyId: COMPANY }), { companyId: 'other', isAdmin: true }, d)).code).toBe('company_mismatch');
    expect((await handleDcsNightCall(call('next', { companyId: COMPANY }), { companyId: COMPANY, isAdmin: false }, d)).code).toBe('forbidden');
  });
  test('seule la meme origine est ecoutee', () => {
    const win = { location: { origin: 'https://dms.example' } };
    expect(isDcsNightCall({ data: call('hello'), origin: 'https://dms.example' }, win)).toBe(true);
    expect(isDcsNightCall({ data: call('hello'), origin: 'https://evil.example' }, win)).toBe(false);
  });
});

/** Minimal Chrome: tabs, alarms, storage and a scripted DMS tab. */
function fakeChrome(dms: (fn: string, args: any) => any) {
  const store: Record<string, unknown> = {};
  const tabs = new Map<number, any>([[1, { id: 1, url: 'https://dms.example/settings' }]]);
  const created: any[] = [];
  const dmsCalls: { fn: string; args: any }[] = [];
  const alarms = new Map<string, any>();
  const power: string[] = [];
  let nextId = 100;
  const api: any = {
    runtime: { lastError: undefined },
    storage: { local: {
      get: async (k: string) => ({ [k]: store[k] ? JSON.parse(JSON.stringify(store[k])) : undefined }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    } },
    alarms: {
      create: (name: string, info: any) => { alarms.set(name, info); },
      get: async (name: string) => alarms.get(name),
      clear: async (name: string) => alarms.delete(name),
    },
    notifications: { create: (_id: string, _o: unknown, cb?: () => void) => { if (cb) cb(); } },
    power: { requestKeepAwake: (l: string) => power.push(l), releaseKeepAwake: () => power.push('release') },
    tabs: {
      query: async () => [...tabs.values()].filter((t) => t.id === 1),
      create: async (o: any) => { const t = { id: nextId++, url: o.url, active: o.active }; tabs.set(t.id, t); created.push(t); return t; },
      update: async (id: number, o: any) => { const t = tabs.get(id); if (t) Object.assign(t, o); return t; },
      get: async (id: number) => { if (!tabs.has(id)) throw new Error('gone'); return tabs.get(id); },
      remove: async (id: number) => { tabs.delete(id); },
      sendMessage: (_id: number, msg: any, cb: (r: unknown) => void) => {
        dmsCalls.push({ fn: msg.fn, args: msg.args });
        if (msg.fn === 'hello') { cb({ ok: true, data: { companyId: 'c1', isAdmin: true } }); return; }
        cb({ ok: true, data: dms(msg.fn, msg.args) });
      },
    },
  };
  return { api, tabs, created, dmsCalls, alarms, power, store };
}

describe('tournee dans le service worker', () => {
  const NIGHT = at('2026-11-23T22:00:00Z').getTime();
  const go = (id: string, vin: string) => ({ state: 'go', item: { id, vehicle_id: 'v', vin, attempt: 1 } });
  const setup = (dms: (fn: string, args: any) => any, start = NIGHT) => {
    const clock = { now: start };
    const fake = fakeChrome(dms);
    const night = runtime.create(fake.api, {
      core, dmsMatch: ['https://dms.example/*'],
      vinUrl: (v: string) => `https://ducati.my.site.com/dealer/s/vinhistory?vin=${v}`,
      now: () => clock.now, random: () => 0.5,
    });
    return { clock, fake, night };
  };

  test('une seule moto, onglet en arriere-plan, import verifie puis pause de 25-30 s', async () => {
    const { clock, fake, night } = setup((fn) => (fn === 'next' ? go('q1', VIN_B) : { run_status: 'running' }));
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].active).toBe(false);
    expect(fake.tabs.get(100).url).toContain(VIN_B);
    await night.tick();
    expect(fake.created).toHaveLength(1);
    expect(await night.handleScrape(100, { vin: VIN_B })).toBe(true);
    expect(fake.tabs.has(100)).toBe(false);
    const apply = fake.dmsCalls.find((c) => c.fn === 'apply');
    expect(apply?.args.companyId).toBe('c1');
    expect(fake.alarms.get('dcs-night-step').when).toBe(clock.now + 27500);
    await night.tick();
    expect(fake.created).toHaveLength(1);
  });

  test('VIN lu different : aucun import, moto en echec', async () => {
    const { fake, night } = setup((fn) => (fn === 'next' ? go('q1', VIN_B) : { run_status: 'running' }));
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    await night.handleScrape(100, { vin: 'ZDM0000000000AAAA' });
    expect(fake.dmsCalls.some((c) => c.fn === 'apply')).toBe(false);
    expect(fake.dmsCalls.find((c) => c.fn === 'mark')?.args.error).toBe('vin_mismatch');
  });

  test('session expiree : signalee au DMS, pas d\'autre onglet', async () => {
    const { clock, fake, night } = setup((fn) => {
      if (fn === 'next') return fake2.paused ? { state: 'wait', reason: 'paused', pause_reason: 'session_expired' } : go('q1', VIN_B);
      fake2.paused = true;
      return { run_status: 'paused', pause_reason: 'session_expired' };
    });
    const fake2 = { paused: false };
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    fake.tabs.get(100).url = 'https://ducati.my.site.com/dealer/s/login/';
    clock.now += core.JOB_TIMEOUT_MS;
    await night.tick();
    expect(fake.dmsCalls.find((c) => c.fn === 'mark')?.args.error).toBe('session_expired');
    clock.now += core.WAIT_RETRY_MS;
    await night.tick();
    expect(fake.created).toHaveLength(1);
    expect(fake.power.at(-1)).toBe('release');
  });

  test('message tardif d\'un onglet ferme : jamais transmis a l\'import normal', async () => {
    const { clock, night } = setup((fn) => (fn === 'next' ? go('q1', VIN_B) : { run_status: 'running' }));
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    clock.now += core.JOB_TIMEOUT_MS;
    await night.tick();
    expect(await night.handleScrape(100, { vin: VIN_B })).toBe(true);
    expect(await night.handleScrape(999, { vin: VIN_B })).toBe(false);
  });

  test('08:00 : l\'onglet en cours est ferme et la moto rendue sans compter d\'echec', async () => {
    const end = at('2026-11-24T06:59:30Z').getTime();
    const { clock, fake, night } = setup((fn) => (fn === 'next' ? go('q1', VIN_B) : { run_status: 'running' }), end);
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    clock.now = at('2026-11-24T07:00:01Z').getTime();
    await night.tick();
    expect(fake.tabs.has(100)).toBe(false);
    expect(fake.dmsCalls.find((c) => c.fn === 'mark')?.args.error).toBe('window_closed');
    clock.now += 3600000;
    await night.tick();
    expect(fake.created).toHaveLength(1);
  });

  test('en journee : aucun appel au portail ni au DMS', async () => {
    const { fake, night } = setup(() => go('q1', VIN_B), at('2026-11-23T12:00:00Z').getTime());
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    expect(fake.created).toHaveLength(0);
    expect(fake.dmsCalls).toHaveLength(0);
  });

  test('pilote termine : aucun onglet tant que l\'administrateur n\'a pas continue', async () => {
    const { clock, fake, night } = setup((fn) => (fn === 'next' ? { state: 'wait', reason: 'pilot_wait' } : {}));
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    clock.now += core.WAIT_RETRY_MS;
    await night.tick();
    expect(fake.created).toHaveLength(0);
    expect(fake.power.at(-1)).toBe('release');
  });

  test('file vide : la tournee se desarme', async () => {
    const { fake, night } = setup((fn) => (fn === 'next' ? { state: 'wait', reason: 'finished' } : {}));
    await night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await night.tick();
    expect((fake.store.dcsNight as any).armed).toBe(false);
    expect(fake.alarms.has('dcs-night-tick')).toBe(false);
  });

  test('reprise apres redemarrage du service worker', async () => {
    const first = setup((fn) => (fn === 'next' ? go('q1', VIN_B) : { run_status: 'running' }));
    await first.night.handleCommand({ cmd: 'arm', companyId: 'c1' });
    await first.night.tick();
    const reborn = runtime.create(first.fake.api, {
      core, dmsMatch: ['https://dms.example/*'], vinUrl: (v: string) => v, now: () => first.clock.now, random: () => 0.5,
    });
    expect(await reborn.handleScrape(100, { vin: VIN_B })).toBe(true);
    expect(first.fake.dmsCalls.some((c) => c.fn === 'apply')).toBe(true);
  });
});
