/**
 * Tests M8 — decisions du client Q57 a Q60 (20/11/2026).
 *  - Q57 fin de journee : heure de la question (fin d'horaire, « je continue » + 1 h, heures sup),
 *    pause automatique a la fin + 5 min, questions montrees a qui, ecrans concernes, libelle du motif ;
 *  - Q58 veille ouvree : RDV du mardi → samedi (dimanche, lundi fermes), feries, veille calendaire,
 *    liste due a l'heure reglee de la veille, rattrapage ;
 *  - Q59 « Reserver » ajoute la ligne : creation, ajustement sans doublon, ligne deja suffisante,
 *    lignes du check-up ignorees, fusion dans l'editeur (regle critique « reservations », regle 7) ;
 *  - Q60 tablette partagee : mode effectif compte / poste, identite collee 2 min, clavier, reponses
 *    de l'identification, identite redemandee sur 28000, geste annule.
 * Memes regles que les migrations 20261120100000 a 20261120103000 (essais a blanc dans
 * supabase/tests/). Execution : `bun test`.
 */
import { test, expect, describe, beforeEach } from 'bun:test';
import { countdownLabel, dueForViewer, endOfDayAskAt, endOfDayPauseAt, isEndOfDayScreen, secondsUntil, type EndOfDayDue } from '../src/modules/workshop/end-of-day/rules';
import { reasonLabel, stopLabel } from '../src/modules/workshop/pointage/rules';
import { addDaysYmd, DEFAULT_PARTS_SETTINGS, eveDate, isPickingEveBasis, pickingDue } from '../src/modules/workshop/reservations/parts-flow';
import { belgianHolidayOn } from '../src/modules/workshop/planning/rules';
import { mergeReservedLine, reserveLinePlan, type CatalogOrLine } from '../src/modules/workshop/exploded/rules';
import {
  effectiveTabletMode, identifyOutcome, identitySecondsLeft, identityValid, isFullPin, isIdentityError, keypadPress, renewIdentity,
  sortSharedMechanics, type SharedIdentity,
} from '../src/modules/workshop/shared-tablet/rules';
import {
  __resetSharedTablet, cancelIdentityPrompt, getSharedTabletState, IdentityCancelled, resolveIdentityPrompt, sharedModeActive,
  withIdentity, withIdentityIfShared,
} from '../src/modules/workshop/shared-tablet/store';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it as itDict } from '../src/lib/i18n/it';

const tr = (k: string) => {
  const v = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], fr);
  return typeof v === 'string' ? v : k;
};

// ============================================================== Q57
describe('Q57 — fin de journee « Vous etes toujours la ? »', () => {
  const end = new Date('2026-11-20T17:00:00Z'); // 18:00 a Bruxelles
  test('la question est posee a la fin de l horaire', () => {
    expect(endOfDayAskAt({ scheduleEnd: end, startedAt: new Date('2026-11-20T13:00:00Z') }).toISOString()).toBe(end.toISOString());
  });
  test('pause automatique a la fin + 5 min', () => {
    expect(endOfDayPauseAt(end).toISOString()).toBe('2026-11-20T17:05:00.000Z');
    expect(endOfDayPauseAt(end, 10).toISOString()).toBe('2026-11-20T17:10:00.000Z');
  });
  test('« Oui, je continue » repousse la question (et vaut pour un autre pointage du jour)', () => {
    const later = new Date('2026-11-20T18:02:00Z');
    expect(endOfDayAskAt({ scheduleEnd: end, startedAt: new Date('2026-11-20T13:00:00Z'), lastContinue: later }).getTime()).toBe(later.getTime());
    // pointage commence a 17:30 locale (16:30Z, avant la fin) apres un changement d'OR : meme reponse.
    expect(endOfDayAskAt({ scheduleEnd: end, startedAt: new Date('2026-11-20T16:30:00Z'), lastContinue: later }).getTime()).toBe(later.getTime());
  });
  test('pointage commence apres la fin de l horaire : question un report (1 h) apres son debut', () => {
    const start = new Date('2026-11-20T17:30:00Z');
    expect(endOfDayAskAt({ scheduleEnd: end, startedAt: start }).toISOString()).toBe('2026-11-20T18:30:00.000Z');
    expect(endOfDayAskAt({ scheduleEnd: end, startedAt: start, snoozeMinutes: 30 }).toISOString()).toBe('2026-11-20T18:00:00.000Z');
  });
  test('compte a rebours', () => {
    expect(secondsUntil('2026-11-20T17:05:00Z', Date.parse('2026-11-20T17:00:00Z'))).toBe(300);
    expect(secondsUntil('2026-11-20T17:05:00Z', Date.parse('2026-11-20T17:06:00Z'))).toBe(0);
    expect(countdownLabel(299)).toBe('4:59');
    expect(countdownLabel(5)).toBe('0:05');
  });
  const row = (p: Partial<EndOfDayDue>): EndOfDayDue => ({
    entry_id: 'e', kind: 'travail', or_id: 'o', or_number: 'OR-1', task_code: null, mechanic_id: null, mechanic_code: null,
    workshop_mechanic_id: null, mechanic_name: 'X', started_at: '', ask_at: '', pause_at: '', ...p,
  });
  test('compte personnel : seulement ses pointages ; tablette partagee : tout l atelier', () => {
    const rows = [row({ entry_id: '1', mechanic_id: 'me' }), row({ entry_id: '2', mechanic_id: 'other' }), row({ entry_id: '3', mechanic_code: 'JOHN' })];
    expect(dueForViewer(rows, { shared: false, userId: 'me' }).map((r) => r.entry_id)).toEqual(['1']);
    expect(dueForViewer(rows, { shared: false, userId: 'me', codes: ['JOHN'] }).map((r) => r.entry_id)).toEqual(['1', '3']);
    expect(dueForViewer(rows, { shared: true, userId: 'tablet' }).map((r) => r.entry_id)).toEqual(['1', '2', '3']);
  });
  test('ecrans : Mon atelier, fiche OR, parcours, pointeuse (pas le planning)', () => {
    expect(isEndOfDayScreen('/workshop/my-workshop')).toBe(true);
    expect(isEndOfDayScreen('/workshop/chrono')).toBe(true);
    expect(isEndOfDayScreen('/workshop/journey/abc')).toBe(true);
    expect(isEndOfDayScreen('/workshop/7d1b2c3a-0000-4000-8000-000000000000')).toBe(true);
    expect(isEndOfDayScreen('/workshop/planning')).toBe(false);
    expect(isEndOfDayScreen('/workshop/new')).toBe(false);
    expect(isEndOfDayScreen('/workshop')).toBe(false);
    expect(isEndOfDayScreen('/sales/x')).toBe(false);
  });
  test('motif « Fin de journee (automatique) » affiche partout', () => {
    expect(stopLabel('auto_stop', 'fin_journee_auto', [], tr)).toBe('Fin de journée (automatique)');
    expect(stopLabel('auto_stop', 'fin_journee', [], tr)).toBe(fr.pointage.stop_auto_stop);
    expect(reasonLabel('fin_journee_auto', [], tr)).toBe('Fin de journée (automatique)');
    expect(stopLabel('pause', 'attente_piece', [{ code: 'attente_piece', label: 'Attente pièce', orStatus: null }], tr)).toBe('Attente pièce');
  });
});

// ============================================================== Q58
describe('Q58 — picking list la veille ouvree', () => {
  // Atelier mardi → samedi, feries belges.
  const isoDow = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
  const open = (ymd: string) => isoDow(ymd) >= 2 && isoDow(ymd) <= 6 && !belgianHolidayOn(new Date(`${ymd}T12:00:00`));
  test('reglage par defaut : veille ouvree', () => {
    expect(DEFAULT_PARTS_SETTINGS.eveBasis).toBe('ouvree');
    expect(isPickingEveBasis('ouvree') && isPickingEveBasis('calendaire') && !isPickingEveBasis('lendemain')).toBe(true);
  });
  test('RDV du mardi → samedi (dimanche et lundi fermes)', () => {
    expect(eveDate('2026-12-08', 'ouvree', open)).toBe('2026-12-05');
  });
  test('RDV du samedi 26/12 → jeudi 24/12 (Noel ferie)', () => {
    expect(eveDate('2026-12-26', 'ouvree', open)).toBe('2026-12-24');
  });
  test('veille calendaire : le jour d avant', () => {
    expect(eveDate('2026-12-08', 'calendaire', open)).toBe('2026-12-07');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('aucun jour ouvert trouve : repli sur la veille calendaire', () => {
    expect(eveDate('2026-12-08', 'ouvree', () => false)).toBe('2026-12-07');
  });
  const rdv = '2026-12-08T09:00:00Z';
  const due = (now: string, eve: string | null) => pickingDue({ mode: 'veille', eveHour: 16, startsAt: rdv, now: new Date(now), eveDate: eve });
  test('due le samedi a partir de 16 h, pas avant, pas le vendredi', () => {
    expect(due('2026-12-05T15:30:00Z', '2026-12-05')).toBe(true);   // 16:30 Bruxelles
    expect(due('2026-12-05T09:00:00Z', '2026-12-05')).toBe(false);
    expect(due('2026-12-04T16:00:00Z', '2026-12-05')).toBe(false);
  });
  test('rattrapage : dimanche, lundi et le jour meme ; jamais apres', () => {
    expect(due('2026-12-06T08:00:00Z', '2026-12-05')).toBe(true);
    expect(due('2026-12-07T08:00:00Z', '2026-12-05')).toBe(true);
    expect(due('2026-12-08T06:00:00Z', '2026-12-05')).toBe(true);
    expect(due('2026-12-09T06:00:00Z', '2026-12-05')).toBe(false);
  });
  test('sans veille calculee : veille calendaire (comportement du lot B)', () => {
    expect(due('2026-12-07T15:30:00Z', null)).toBe(true);
    expect(due('2026-12-05T15:30:00Z', null)).toBe(false);
    expect(pickingDue({ mode: 'reception', eveHour: 16, startsAt: rdv, now: new Date('2026-12-07T20:00:00Z') })).toBe(false);
  });
});

// ============================================================== Q59
describe('Q59 — « Reserver » ajoute aussi la ligne a l OR (reservations, regle 7)', () => {
  const A = 'art-a';
  test('pas de ligne : une ligne est creee pour le besoin', () => {
    expect(reserveLinePlan([], A, 2)).toEqual({ kind: 'create', quantity: 2 });
  });
  test('ligne existante plus petite : la meme ligne est ajustee, pas de doublon', () => {
    expect(reserveLinePlan([{ kind: 'piece', article_id: A, quantity: 2 }], A, 3)).toEqual({ kind: 'adjust', index: 0, quantity: 3 });
  });
  test('la ligne couvre deja le besoin : rien ne change', () => {
    expect(reserveLinePlan([{ kind: 'piece', article_id: A, quantity: 5 }], A, 1)).toEqual({ kind: 'kept' });
  });
  test('plusieurs lignes : le total compte ; la ligne hors garantie recoit la difference', () => {
    const lines = [
      { kind: 'piece', article_id: A, quantity: 1, is_warranty: true },
      { kind: 'piece', article_id: A, quantity: 1 },
    ];
    expect(reserveLinePlan(lines, A, 3)).toEqual({ kind: 'adjust', index: 1, quantity: 2 });
  });
  test('cartes du check-up OK / reportees et autres articles ignores', () => {
    const lines = [
      { kind: 'piece', article_id: A, quantity: 4, checkup_state: 'reporte' },
      { kind: 'piece', article_id: 'b', quantity: 4 },
      { kind: 'mo', article_id: A, quantity: 4 },
    ];
    expect(reserveLinePlan(lines, A, 1)).toEqual({ kind: 'create', quantity: 1 });
  });
  const line: CatalogOrLine = { kind: 'piece', article_id: A, designation: 'Levier', quantity: 2, unit_price_ht: 18, vat_rate: 21, discount_pct: 10, is_warranty: false };
  type L = { _key: string; kind: string; article_id: string | null; quantity: number; designation: string };
  const make = (l: CatalogOrLine): L => ({ _key: 'new', kind: l.kind, article_id: l.article_id, quantity: l.quantity, designation: l.designation });
  test('editeur ouvert : la ligne enregistree par « Reserver » arrive une seule fois', () => {
    const out = mergeReservedLine<L>([], line, 2, make);
    expect(out).toEqual([{ _key: 'new', kind: 'piece', article_id: A, quantity: 2, designation: 'Levier' }]);
    const again = mergeReservedLine<L>(out, line, 3, make);
    expect(again.length).toBe(1);
    expect(again[0].quantity).toBe(3);
    expect(mergeReservedLine<L>(again, line, 3, make)).toEqual(again);
  });
  test('editeur avec la meme piece non enregistree (5) : rien n est ajoute', () => {
    const cur: L[] = [{ _key: 'k', kind: 'piece', article_id: A, quantity: 5, designation: 'Levier' }];
    expect(mergeReservedLine<L>(cur, line, 2, make)).toEqual(cur);
  });
});

// ============================================================== Q60
describe('Q60 — tablette partagee « Qui etes-vous ? »', () => {
  const id = (p: Partial<SharedIdentity> = {}): SharedIdentity => ({
    session: 's1', mechanicId: 'm1', name: 'John', code: 'JOHN', userId: null, expiresAt: Date.now() + 120_000, ttlSeconds: 120, ...p,
  });
  test('mode effectif : compte partage, ou poste declare partage ; jamais l inverse', () => {
    expect(effectiveTabletMode('personal', false)).toBe('personal');
    expect(effectiveTabletMode('shared', false)).toBe('shared');
    expect(effectiveTabletMode('personal', true)).toBe('shared');
    expect(effectiveTabletMode(null, false)).toBe('personal');
  });
  test('identite collee 2 min, prolongee a chaque geste', () => {
    const now = 1_000_000;
    const a = id({ expiresAt: now + 120_000 });
    expect(identityValid(a, now)).toBe(true);
    expect(identityValid(a, now + 119_000)).toBe(false); // marge reseau de 2 s
    expect(identitySecondsLeft(a, now)).toBe(120);
    expect(renewIdentity(a, now + 60_000).expiresAt).toBe(now + 180_000);
    expect(identityValid(null)).toBe(false);
  });
  test('clavier : 4 chiffres au plus, effacer, vider', () => {
    let p = '';
    for (const k of ['1', '2', 'x', '3', '4', '5']) p = keypadPress(p, k);
    expect(p).toBe('1234');
    expect(isFullPin(p)).toBe(true);
    expect(keypadPress(p, 'back')).toBe('123');
    expect(keypadPress(p, 'clear')).toBe('');
  });
  test('reponses de l identification', () => {
    const ok = identifyOutcome({ status: 'ok', session: 's', expires_at: '2026-11-20T10:02:00Z', ttl_seconds: 120, mechanic_id: 'm', mechanic_name: 'John', mechanic_code: 'JOHN', mechanic_user_id: null });
    expect(ok.ok && ok.identity.name === 'John' && ok.identity.code === 'JOHN' && ok.identity.expiresAt === Date.parse('2026-11-20T10:02:00Z')).toBe(true);
    expect(identifyOutcome({ status: 'wrong_code', mechanic_name: 'John', attempts_left: 3 })).toEqual({ ok: false, messageKey: 'sharedTablet.wrongCode', attemptsLeft: 3 });
    expect(identifyOutcome({ status: 'locked', mechanic_name: 'John' })).toEqual({ ok: false, messageKey: 'sharedTablet.locked' });
    expect(identifyOutcome({ status: 'no_code', mechanic_name: 'John' })).toEqual({ ok: false, messageKey: 'sharedTablet.noCode' });
  });
  test('erreur d identite de la base reconnue (28000)', () => {
    expect(isIdentityError({ code: '28000', message: 'x' })).toBe(true);
    expect(isIdentityError(new Error('Identification expiree : touchez votre nom'))).toBe(true);
    expect(isIdentityError(new Error('Acces refuse.'))).toBe(false);
  });
  test('compagnons sans code en dernier, puis ordre du planning', () => {
    const out = sortSharedMechanics([
      { id: 'a', name: 'Luis', sort_order: 30, has_pin: false, has_pointeuse_code: false, linked: false },
      { id: 'b', name: 'John', sort_order: 20, has_pin: true, has_pointeuse_code: false, linked: false },
      { id: 'c', name: 'Livio', sort_order: 10, has_pin: true, has_pointeuse_code: false, linked: false },
    ]);
    expect(out.map((m) => m.name)).toEqual(['Livio', 'John', 'Luis']);
  });

  describe('store : chaque geste demande l identite en mode partage', () => {
    beforeEach(() => __resetSharedTablet());
    test('mode personnel : le geste part tel quel (identite null)', async () => {
      expect(sharedModeActive()).toBe(false);
      expect(await withIdentityIfShared(async (i) => i)).toBeNull();
    });
    test('mode partage sans identite : « Qui etes-vous ? » s ouvre, le geste attend puis part sous l identite', async () => {
      __resetSharedTablet({ accountMode: 'shared' });
      expect(sharedModeActive()).toBe(true);
      const p = withIdentityIfShared(async (i) => i?.name);
      expect(getSharedTabletState().prompting).toBe(true);
      resolveIdentityPrompt(id());
      expect(await p).toBe('John');
      expect(getSharedTabletState().identity?.name).toBe('John');
    });
    test('identite valable : pas de nouvelle question', async () => {
      __resetSharedTablet({ accountMode: 'shared', identity: id() });
      expect(await withIdentity(async (i) => i.session)).toBe('s1');
      expect(getSharedTabletState().prompting).toBe(false);
    });
    test('identite expiree cote base (28000) : redemandee puis le geste est rejoue', async () => {
      __resetSharedTablet({ accountMode: 'shared', identity: id() });
      let calls = 0;
      const p = withIdentity(async (i) => {
        calls += 1;
        if (i.session === 's1') throw Object.assign(new Error('expiree'), { code: '28000' });
        return i.session;
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getSharedTabletState().prompting).toBe(true);
      resolveIdentityPrompt(id({ session: 's2' }));
      expect(await p).toBe('s2');
      expect(calls).toBe(2);
    });
    test('« Annuler » : le geste est annule', async () => {
      __resetSharedTablet({ posteShared: true });
      const p = withIdentityIfShared(async () => 'fait');
      cancelIdentityPrompt();
      await expect(p).rejects.toBeInstanceOf(IdentityCancelled);
    });
  });
});

// ============================================================== libelles
describe('libelles FR / NL / EN / IT', () => {
  const keys = ['endOfDay.title', 'endOfDay.yesContinue', 'endOfDay.pauseNow', 'endOfDay.reasonAuto', 'sharedTablet.whoTitle',
    'sharedTablet.badge', 'pickingEve.basis_ouvree', 'reserveLine.created'];
  const get = (d: unknown, k: string) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], d);
  for (const [name, d] of [['fr', fr], ['nl', nl], ['en', en], ['it', itDict]] as const) {
    test(`${name} : les cles des decisions existent`, () => {
      for (const k of keys) expect(typeof get(d, k)).toBe('string');
    });
  }
  test('pas d apostrophe typographique dans les nouveaux libelles', () => {
    const all = JSON.stringify([fr.endOfDay, fr.sharedTablet, fr.pickingEve, fr.reserveLine, nl.endOfDay, en.sharedTablet, itDict.endOfDay]);
    expect(all.includes('’')).toBe(false);
  });
});
