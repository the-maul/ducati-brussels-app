/**
 * Tests M10 — Interrupteur des relances (CRM011, constat du 03/11/2026) :
 *   - defaut = arrete : sans reglage (ou reglage inconnu), aucun envoi ;
 *   - mode arrete : rien ne part, meme avec une adresse client valide ;
 *   - mode test : destinataire remplace par l'adresse de test, objet prefixe
 *     « [TEST relance pour <client>] », relance marquee is_test, sent_to = adresse de test ;
 *   - mode test sans adresse de test : rien ne part ;
 *   - mode actif : destinataire reel, pas de prefixe, is_test faux ;
 *   - l'ecran : « Envoyer maintenant » possible seulement hors arrete ; chaque mode a une
 *     couleur, une icone (posee par l'ecran) et un libelle dans les quatre dictionnaires.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeFollowupMode, resolveDelivery, canSendNow, modeTone, testSubject, isEmail, FOLLOWUP_MODES } from '../supabase/functions/_shared/followups-mode.ts';
import { FOLLOWUP_MODES as FRONT_MODES } from '../src/modules/crm/followups-rules';
import { fr } from '../src/lib/i18n/fr';
import { nl } from '../src/lib/i18n/nl';
import { en } from '../src/lib/i18n/en';
import { it } from '../src/lib/i18n/it';

const base = { testRecipient: 'simon@exemple.be', to: 'client@exemple.be', subject: 'Votre Ducati Monster : entretien a prevoir', clientLabel: 'Marco Rossi' };

describe('defaut = arrete', () => {
  test('sans reglage, reglage vide ou inconnu : arrete', () => {
    expect(normalizeFollowupMode(undefined)).toBe('arrete');
    expect(normalizeFollowupMode(null)).toBe('arrete');
    expect(normalizeFollowupMode('')).toBe('arrete');
    expect(normalizeFollowupMode('tous')).toBe('arrete');
    expect(normalizeFollowupMode('ACTIF')).toBe('arrete');
    expect(normalizeFollowupMode('actif')).toBe('actif');
    expect(normalizeFollowupMode('test')).toBe('test');
  });
  test('sans reglage : aucun envoi, meme avec une adresse client valide', () => {
    const d = resolveDelivery({ ...base, mode: undefined });
    expect(d.send).toBe(false);
    expect(d.mode).toBe('arrete');
  });
});

describe('mode arrete : rien ne part', () => {
  test('aucun envoi, raison « arrete »', () => {
    const d = resolveDelivery({ ...base, mode: 'arrete' });
    expect(d).toEqual({ send: false, reason: 'arrete', mode: 'arrete' });
  });
  test('« Envoyer maintenant » est grise', () => {
    expect(canSendNow('arrete')).toBe(false);
    expect(canSendNow(undefined)).toBe(false);
  });
});

describe('mode test : tout part a l adresse de test', () => {
  test('destinataire remplace, objet prefixe, is_test, sent_to = adresse de test', () => {
    const d = resolveDelivery({ ...base, mode: 'test' });
    expect(d.send).toBe(true);
    if (!d.send) return;
    expect(d.to).toBe('simon@exemple.be');
    expect(d.sentTo).toBe('simon@exemple.be');
    expect(d.isTest).toBe(true);
    expect(d.subject).toBe('[TEST relance pour Marco Rossi] Votre Ducati Monster : entretien a prevoir');
    expect(d.to).not.toBe(base.to);
  });
  test('adresse de test normalisee (espaces, majuscules)', () => {
    const d = resolveDelivery({ ...base, mode: 'test', testRecipient: '  Simon@Exemple.BE ' });
    expect(d.send && d.to).toBe('simon@exemple.be');
  });
  test('sans adresse de test : rien ne part', () => {
    for (const tr of [null, undefined, '', 'pas-une-adresse', 'a@b', 'deux@exemple.be, trois@exemple.be']) {
      const d = resolveDelivery({ ...base, mode: 'test', testRecipient: tr });
      expect(d.send).toBe(false);
      expect(!d.send && d.reason).toBe('no_test_recipient');
    }
  });
  test('prefixe de l objet : nom du client, sinon « client »', () => {
    expect(testSubject('Objet', 'Marco Rossi')).toBe('[TEST relance pour Marco Rossi] Objet');
    expect(testSubject('Objet', null)).toBe('[TEST relance pour client] Objet');
    expect(testSubject('Objet', '  ')).toBe('[TEST relance pour client] Objet');
  });
  test('« Envoyer maintenant » reste possible', () => {
    expect(canSendNow('test')).toBe(true);
  });
});

describe('mode actif : envoi reel', () => {
  test('destinataire reel, pas de prefixe, is_test faux', () => {
    const d = resolveDelivery({ ...base, mode: 'actif' });
    expect(d).toEqual({ send: true, mode: 'actif', to: 'client@exemple.be', subject: base.subject, isTest: false, sentTo: 'client@exemple.be' });
  });
  test('l adresse de test est ignoree en actif', () => {
    const d = resolveDelivery({ ...base, mode: 'actif', testRecipient: null });
    expect(d.send && d.to).toBe('client@exemple.be');
  });
  test('client sans e-mail valide : rien ne part', () => {
    for (const to of ['', 'sans-arobase', 'a@b']) {
      const d = resolveDelivery({ ...base, mode: 'actif', to });
      expect(d.send).toBe(false);
      expect(!d.send && d.reason).toBe('no_email');
    }
  });
  test('« Envoyer maintenant » possible', () => {
    expect(canSendNow('actif')).toBe(true);
  });
});

describe('ecran', () => {
  test('une adresse e-mail plausible', () => {
    expect(isEmail('marco.rossi@exemple.be')).toBe(true);
    expect(isEmail('marco@exemple')).toBe(false);
    expect(isEmail('marco rossi@exemple.be')).toBe(false);
    expect(isEmail(null)).toBe(false);
  });
  test('les trois modes, les memes cote serveur et cote ecran', () => {
    expect(FOLLOWUP_MODES).toEqual(['arrete', 'test', 'actif']);
    expect(FRONT_MODES).toEqual(FOLLOWUP_MODES);
  });
  test('chaque mode a une couleur et un libelle dans les quatre langues (icone posee par l ecran)', () => {
    expect(modeTone('arrete')).toBe('neutral');
    expect(modeTone('test')).toBe('warning');
    expect(modeTone('actif')).toBe('success');
    for (const dict of [fr, nl, en, it]) {
      const f = dict.followups as Record<string, string>;
      for (const m of FOLLOWUP_MODES) {
        expect(f[`mode_${m}`]).toBeTruthy();
        expect(f[`modeShort_${m}`]).toBeTruthy();
        expect(f[`modeHelp_${m}`]).toBeTruthy();
      }
      expect(f.sendBlocked).toBeTruthy();
      expect(f.sendRealMsg).toContain('{client}');
      expect(f.testBadge).toBeTruthy();
    }
  });
});
