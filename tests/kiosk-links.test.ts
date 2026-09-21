/**
 * Mission 01, lot 4 — liens de l'écran d'accueil de la borne. Exécution : `bun test`.
 */
import { test, expect } from 'bun:test';
import {
  DEFAULT_CONFIGURATOR_URL, DEFAULT_USED_URL, checkKioskUrl, kioskHasHome, kioskUrlHost, resolveKioskLinks,
} from '../src/modules/signup/kiosk-links';

test('réglage absent (migration non appliquée) ou jamais fait : adresses par défaut', () => {
  expect(resolveKioskLinks(null)).toEqual({ configurator: DEFAULT_CONFIGURATOR_URL, used: DEFAULT_USED_URL });
  expect(resolveKioskLinks({ company_id: 'x' })).toEqual({ configurator: DEFAULT_CONFIGURATOR_URL, used: DEFAULT_USED_URL });
  expect(resolveKioskLinks({ kiosk_configurator_url: null, kiosk_used_url: null }))
    .toEqual({ configurator: DEFAULT_CONFIGURATOR_URL, used: DEFAULT_USED_URL });
});

test('adresse vidée : tuile masquée ; les deux masquées : pas d’écran d’accueil', () => {
  const links = resolveKioskLinks({ kiosk_configurator_url: '', kiosk_used_url: 'https://ducatibruxelles.be/collections/all' });
  expect(links.configurator).toBeNull();
  expect(links.used).toBe('https://ducatibruxelles.be/collections/all');
  expect(kioskHasHome(links)).toBe(true);
  expect(kioskHasHome(resolveKioskLinks({ kiosk_configurator_url: '', kiosk_used_url: '  ' }))).toBe(false);
});

test('adresse invalide en base : repli sur la valeur par défaut, jamais de lien dangereux', () => {
  expect(resolveKioskLinks({ kiosk_configurator_url: 'javascript:alert(1)' }).configurator).toBe(DEFAULT_CONFIGURATOR_URL);
  expect(resolveKioskLinks({ kiosk_used_url: 'http://ducatibruxelles.be' }).used).toBe(DEFAULT_USED_URL);
});

test('validation de la saisie', () => {
  expect(checkKioskUrl('')).toEqual({ ok: true, value: '' });
  expect(checkKioskUrl('  https://configurator.ducati.com/bikes/be/fr ')).toEqual({ ok: true, value: 'https://configurator.ducati.com/bikes/be/fr' });
  expect(checkKioskUrl('ducatibruxelles.be/collections/motos-doccasion-new'))
    .toEqual({ ok: true, value: 'https://ducatibruxelles.be/collections/motos-doccasion-new' });
  expect(checkKioskUrl('http://ducatibruxelles.be')).toEqual({ ok: false, code: 'not_https' });
  expect(checkKioskUrl('javascript:alert(1)')).toEqual({ ok: false, code: 'not_https' });
  expect(checkKioskUrl('/borne')).toEqual({ ok: false, code: 'invalid' });
  expect(checkKioskUrl('https://localhost')).toEqual({ ok: false, code: 'invalid' });
  expect(checkKioskUrl('https://user:pw@ducati.com')).toEqual({ ok: false, code: 'invalid' });
  expect(checkKioskUrl(`https://a.be/${'x'.repeat(600)}`)).toEqual({ ok: false, code: 'too_long' });
});

test('domaine affiché et à mettre en liste blanche', () => {
  expect(kioskUrlHost(DEFAULT_CONFIGURATOR_URL)).toBe('configurator.ducati.com');
  expect(kioskUrlHost(DEFAULT_USED_URL)).toBe('ducatibruxelles.be');
  expect(kioskUrlHost('pas une adresse')).toBe('');
});
